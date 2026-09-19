import { z } from 'zod';
import type { ActorId } from '../sim/types.ts';
import type { QuestionMap } from './questions.ts';
import type { DecideDigest } from './digest.ts';
import { recordSample, setTelemetryMode, type CallSample } from './telemetry.ts';

const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number(),
});

const DecideResponseSchema = z.object({
  answers: z.record(z.string(), z.union([ChoiceAnswerSchema, NoulAnswerSchema])),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
    })
    .optional(),
  degraded: z.boolean().optional(),
});

export type DecideResponse = z.infer<typeof DecideResponseSchema>;

export class DecideError extends Error {
  constructor(
    message: string,
    public kind: CallSample['errorKind'],
  ) {
    super(message);
    this.name = 'DecideError';
  }
}

export async function callDecide(
  digest: DecideDigest,
  questions: QuestionMap,
  actorId: ActorId,
  signal?: AbortSignal,
): Promise<DecideResponse> {
  const t0 = performance.now();
  let ok = false;
  let errorKind: CallSample['errorKind'];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const res = await fetch('/api/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: digest, questions, model: 'jev-latest' }),
      signal,
    });

    if (res.status === 429) throw new DecideError('rate limited', 'rate_limit');
    if (!res.ok) throw new DecideError(`http ${res.status}`, 'http');

    const json: unknown = await res.json();
    const parsed = DecideResponseSchema.safeParse(json);
    if (!parsed.success) throw new DecideError('schema', 'schema');

    inputTokens = parsed.data.usage?.input_tokens ?? 0;
    outputTokens = parsed.data.usage?.output_tokens ?? 0;
    ok = true;
    if (parsed.data.degraded) setTelemetryMode('degraded');
    else setTelemetryMode('live');
    return parsed.data;
  } catch (err) {
    if (err instanceof DecideError) {
      errorKind = err.kind;
    } else if (err instanceof DOMException && err.name === 'AbortError') {
      errorKind = 'timeout';
    } else if (err instanceof TypeError) {
      errorKind = 'connection';
    } else {
      errorKind = 'http';
    }
    setTelemetryMode('degraded');
    throw err instanceof DecideError
      ? err
      : new DecideError(String(err), errorKind);
  } finally {
    recordSample({
      t: t0,
      kind: 'decide',
      actorId,
      ms: performance.now() - t0,
      inputTokens,
      outputTokens,
      ok,
      errorKind: ok ? undefined : errorKind,
    });
  }
}
