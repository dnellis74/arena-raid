import { choice, noul, TypeSafeClient, type EntryType } from '@typesafe-ai/sdk';
import { z } from 'zod';
import type { ActorId } from '../sim/types.ts';
import type { QuestionMap } from './questions.ts';
import type { DecideDigest } from './digest.ts';
import { recordSample, type CallSample } from './telemetry.ts';

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
  degradedReason: z.string().optional(),
  error: z.string().optional(),
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

/** Convert QuestionMap into SDK question objects (shared by proxy + direct client). */
export function toSdkQuestions(
  questions: QuestionMap,
): Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> {
  const out: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'choice') {
      out[id] = choice(q.instructions, q.criteria);
    } else if (q.type === 'noul') {
      out[id] = noul(q.instructions);
    }
  }
  return out;
}

/**
 * Direct Jev client for Node scripts (calibration). Uses TYPESAFE_API_KEY —
 * does not go through `/api/decide` or the Vite proxy.
 */
export function createJevClient(apiKey: string, opts: { timeoutMs?: number } = {}) {
  const client = new TypeSafeClient({
    apiKey,
    timeout: opts.timeoutMs ?? 30_000,
  });

  return {
    async ask(state: DecideDigest, questions: QuestionMap): Promise<DecideResponse> {
      const response = await client.systemOne({
        state: state as unknown as EntryType,
        model: 'jev-latest',
        questions: toSdkQuestions(questions),
      });
      const parsed = DecideResponseSchema.safeParse({
        answers: response.answers,
        usage: response.usage,
      });
      if (!parsed.success) {
        throw new DecideError('schema parse failure', 'schema');
      }
      return parsed.data;
    },
  };
}

export type JevClient = ReturnType<typeof createJevClient>;

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

    if (res.status === 429) {
      throw new DecideError(`rate limit 429 ${res.statusText}`.trim(), 'rate_limit');
    }
    if (!res.ok) {
      throw new DecideError(`HTTP ${res.status} ${res.statusText}`.trim(), 'http');
    }

    const json: unknown = await res.json();
    const parsed = DecideResponseSchema.safeParse(json);
    if (!parsed.success) throw new DecideError('schema parse failure', 'schema');

    inputTokens = parsed.data.usage?.input_tokens ?? 0;
    outputTokens = parsed.data.usage?.output_tokens ?? 0;
    ok = true;
    return parsed.data;
  } catch (err) {
    if (err instanceof DecideError) {
      errorKind = err.kind;
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      errorKind = 'timeout';
      throw new DecideError('timeout/abort', 'timeout');
    }
    if (err instanceof TypeError) {
      errorKind = 'connection';
      throw new DecideError(`network TypeError: ${err.message}`, 'connection');
    }
    errorKind = 'http';
    throw new DecideError(String(err), errorKind);
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

/** Human-readable reason for a failed/degraded decide response. */
export function degradedReasonFromResponse(response: DecideResponse): string {
  if (response.degradedReason) return response.degradedReason;
  if (response.error) return `typesafe_sdk_error: ${response.error}`;
  return 'response.body.degraded';
}
