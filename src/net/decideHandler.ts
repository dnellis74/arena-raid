import { TypeSafeClient, type EntryType } from '@typesafe-ai/sdk';
import { toSdkQuestions } from './jev.ts';
import {
  offlineProxyAnswers,
  type ProxyDigest,
  type ProxyQuestion,
} from './offlineProxyAnswers.ts';
import type { QuestionMap } from './questions.ts';

export interface DecideRequestBody {
  state?: ProxyDigest | EntryType;
  questions?: Record<string, ProxyQuestion>;
  model?: string;
}

export interface DecideHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Shared `/api/decide` core for the Vercel function and Vite middleware.
 * Returns a status + JSON body; adapters wrap into Response / Connect res.
 */
export async function runDecide(
  body: DecideRequestBody,
  apiKey: string | undefined,
): Promise<DecideHandlerResult> {
  if (body.state === undefined || body.state === null || !body.questions) {
    return { status: 422, body: { error: 'state and questions required' } };
  }

  const key = apiKey?.trim();
  const questions = body.questions;
  const state = body.state as ProxyDigest;

  if (!key) {
    return {
      status: 200,
      body: offlineProxyAnswers(questions, state, { reason: 'no_TYPESAFE_API_KEY' }),
    };
  }

  try {
    const client = new TypeSafeClient({ apiKey: key, timeout: 1200 });
    const response = await client.systemOne({
      state: body.state as EntryType,
      model: body.model ?? 'jev-latest',
      questions: toSdkQuestions(questions as QuestionMap),
    });
    return {
      status: 200,
      body: {
        model: response.model,
        answers: response.answers,
        usage: response.usage,
      },
    };
  } catch (err) {
    const msg = String(err);
    return {
      status: 200,
      body: {
        ...offlineProxyAnswers(questions, state, {
          reason: `typesafe_sdk_error: ${msg}`,
        }),
        error: msg,
      },
    };
  }
}
