import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StateId } from '../../src/sim/types.ts';
import type { CalibrationTier } from './cases.ts';
import type { ClosingPlayerKind } from './situation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(HERE, 'snapshots');
const QUESTIONS_PATH = join(HERE, '../../src/net/questions.ts');

export interface RunRow {
  kind: ClosingPlayerKind;
  tier: CalibrationTier;
  id: string;
  order: string;
  /** Behavior after hysteresis (console "picked" column). */
  picked: StateId;
  /** Raw Choice label from Jev (snapshot only). */
  choice: StateId;
  pSkirmish: number;
  confidence: number;
  probabilities: Record<string, number>;
  resolved: StateId;
  /** PASS / FAIL for asserted cases; observed for tier 2 */
  result: 'PASS' | 'FAIL' | 'observed';
  repeatIndex: number;
}

type PassCounts = {
  tier1Pass: string;
  negativePass: string;
  tier2SkirmishRate: string;
};

export interface SnapshotPayload {
  generatedAt: string;
  questionsGitSha: string;
  rows: Array<{
    kind: ClosingPlayerKind;
    tier: CalibrationTier;
    id: string;
    order: string;
    repeatIndex: number;
    probabilities: Record<string, number>;
    confidence: number;
    /** Raw Choice label from Jev. */
    choice: StateId;
    /** Behavior after hysteresis (what the game adopts). */
    resolvedBehavior: StateId;
    result: RunRow['result'];
  }>;
  summary: PassCounts & {
    byClass: Partial<Record<ClosingPlayerKind, PassCounts>>;
  };
}

export function questionsGitSha(): string {
  try {
    return execSync(`git log -1 --format=%H -- "${QUESTIONS_PATH}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function printTable(rows: RunRow[]): void {
  const header = [
    pad('class', 10),
    pad('tier', 5),
    pad('#', 4),
    pad('order', 48),
    pad('picked', 18),
    pad('P(skirm)', 10),
    pad('conf', 8),
    pad('result', 10),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      [
        pad(r.kind, 10),
        pad(String(r.tier), 5),
        pad(r.id, 4),
        pad(r.order, 48),
        pad(r.picked, 18),
        pad(r.pSkirmish.toFixed(2), 10),
        pad(r.confidence.toFixed(2), 8),
        pad(r.result, 10),
      ].join(' '),
    );
  }
}

function summarize(rows: RunRow[]): PassCounts {
  const tier1 = rows.filter((r) => r.tier === 1);
  const negatives = rows.filter((r) => r.tier === 'N');
  const tier2 = rows.filter((r) => r.tier === 2);
  const tier2Skirmish = tier2.filter((r) => r.resolved === 'skirmish').length;
  return {
    tier1Pass: `${tier1.filter((r) => r.result === 'PASS').length}/${tier1.length}`,
    negativePass: `${negatives.filter((r) => r.result === 'PASS').length}/${negatives.length}`,
    tier2SkirmishRate: `${tier2Skirmish}/${tier2.length}`,
  };
}

export function printSummary(rows: RunRow[]): SnapshotPayload['summary'] {
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const byClass: SnapshotPayload['summary']['byClass'] = {};
  console.log('');
  for (const kind of kinds) {
    const stats = summarize(rows.filter((r) => r.kind === kind));
    byClass[kind] = stats;
    console.log(
      `summary ${kind}: tier1 ${stats.tier1Pass}  negatives ${stats.negativePass}  tier2 skirmish ${stats.tier2SkirmishRate}`,
    );
  }
  const overall = summarize(rows);
  if (kinds.length > 1) {
    console.log(
      `summary: tier1 ${overall.tier1Pass}  negatives ${overall.negativePass}  tier2 skirmish ${overall.tier2SkirmishRate}`,
    );
  }
  return { ...overall, byClass };
}

export function writeSnapshot(rows: RunRow[], summary: SnapshotPayload['summary']): string {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const payload: SnapshotPayload = {
    generatedAt,
    questionsGitSha: questionsGitSha(),
    rows: rows.map((r) => ({
      kind: r.kind,
      tier: r.tier,
      id: r.id,
      order: r.order,
      repeatIndex: r.repeatIndex,
      probabilities: r.probabilities,
      confidence: r.confidence,
      choice: r.choice,
      resolvedBehavior: r.resolved,
      result: r.result,
    })),
    summary,
  };
  const file = join(SNAPSHOT_DIR, `skirmish.${generatedAt}.json`);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file}`);
  return file;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}
