import type { ActorId } from '../sim/types.ts';

export interface CallSample {
  t: number;
  kind: 'decide';
  actorId: ActorId | null;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
  errorKind?: 'timeout' | 'rate_limit' | 'connection' | 'http' | 'schema';
}

export interface SessionTotals {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  totalMs: number;
  errors: number;
  rateLimitErrors: number;
  p95Warning: boolean;
  rateLimitWarning: boolean;
}

const samples: CallSample[] = [];
let windowSamples: CallSample[] = [];
let lastEmit = 0;
let mode: 'live' | 'degraded' = 'live';
/** Last known reason for degraded mode; kept while mode stays degraded. */
let lastDegradedReason: string | null = null;
/** Warn once per distinct reason while degraded. */
let lastWarnedReason: string | null = null;

export const session: SessionTotals = {
  calls: 0,
  tokensIn: 0,
  tokensOut: 0,
  totalMs: 0,
  errors: 0,
  rateLimitErrors: 0,
  p95Warning: false,
  rateLimitWarning: false,
};

export function getTelemetryMode(): 'live' | 'degraded' {
  return mode;
}

export function getLastDegradedReason(): string | null {
  return lastDegradedReason;
}

/**
 * Sets backend mode. On degrade: stores reason and warns once per distinct
 * reason. On live: clears reason (no recovery log).
 */
export function setTelemetryMode(
  m: 'live' | 'degraded',
  detail: { reason?: string } = {},
): void {
  if (m === 'live') {
    mode = 'live';
    lastDegradedReason = null;
    lastWarnedReason = null;
    return;
  }

  const reason = detail.reason ?? lastDegradedReason ?? 'unknown';
  mode = 'degraded';
  lastDegradedReason = reason;

  if (lastWarnedReason !== reason) {
    console.warn(`[jev] degraded: ${reason}`);
    lastWarnedReason = reason;
  }
}

export function recordSample(sample: CallSample): void {
  samples.push(sample);
  windowSamples.push(sample);
  session.calls += 1;
  session.tokensIn += sample.inputTokens;
  session.tokensOut += sample.outputTokens;
  session.totalMs += sample.ms;
  if (!sample.ok) {
    session.errors += 1;
    if (sample.errorKind === 'rate_limit') {
      session.rateLimitErrors += 1;
      session.rateLimitWarning = true;
    }
  }
}

export function tickTelemetry(now = performance.now()): string | null {
  if (lastEmit === 0) lastEmit = now;
  if (now - lastEmit < 5000) return null;
  const line = emitWindow(now);
  lastEmit = now;
  windowSamples = [];
  return line;
}

function formatModeLabel(): string {
  if (mode !== 'degraded') return `mode ${mode}`;
  return `mode degraded (${lastDegradedReason ?? 'unknown'})`;
}

/** Backend label for HUD: includes degraded reason when known. */
export function formatBackendMode(degraded: boolean): string {
  if (!degraded && mode !== 'degraded') return 'live';
  return `DEGRADED (${lastDegradedReason ?? 'unknown'})`;
}

function emitWindow(now: number): string {
  const n = windowSamples.length;
  const msArr = windowSamples.map((s) => s.ms).sort((a, b) => a - b);
  const avg = n ? msArr.reduce((a, b) => a + b, 0) / n : 0;
  const p95 = n ? msArr[Math.min(n - 1, Math.floor(n * 0.95))]! : 0;
  const max = n ? msArr[n - 1]! : 0;
  const tin = windowSamples.reduce((a, s) => a + s.inputTokens, 0);
  const tout = windowSamples.reduce((a, s) => a + s.outputTokens, 0);
  const errs = windowSamples.filter((s) => !s.ok).length;
  const inPer = n ? Math.round(tin / n) : 0;

  if (p95 > 1200) session.p95Warning = true;

  const line =
    `[jev 5s] calls ${n} | ms avg ${Math.round(avg)} p95 ${Math.round(p95)} max ${Math.round(max)}\n` +
    `         tokens in ${tin.toLocaleString()} out ${tout.toLocaleString()} | in/call ${inPer} | errors ${errs} | ${formatModeLabel()}`;

  console.info(line);
  void now;
  return line;
}

export function sessionAvgMs(): number {
  return session.calls ? Math.round(session.totalMs / session.calls) : 0;
}

export function printMatchEnd(seed: number): void {
  console.info(
    `[jev match end] seed ${seed} | calls ${session.calls} | tokens in ${session.tokensIn} out ${session.tokensOut} | avg ms ${sessionAvgMs()}`,
  );
}

export function resetTelemetry(): void {
  samples.length = 0;
  windowSamples = [];
  lastEmit = 0;
  session.calls = 0;
  session.tokensIn = 0;
  session.tokensOut = 0;
  session.totalMs = 0;
  session.errors = 0;
  session.rateLimitErrors = 0;
  session.p95Warning = false;
  session.rateLimitWarning = false;
  mode = 'live';
  lastDegradedReason = null;
  lastWarnedReason = null;
}
