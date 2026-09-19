import { TypeSafeClient, choice, noul, type EntryType } from '@typesafe-ai/sdk';
import {
  offlineProxyAnswers,
  type ProxyDigest,
  type ProxyQuestion,
} from '../src/net/offlineProxyAnswers.ts';

export const config = {
  maxDuration: 10,
};

type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } };

interface DecideBody {
  state?: EntryType;
  questions?: Record<string, Question>;
  model?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: DecideBody;
  try {
    body = (await request.json()) as DecideBody;
  } catch {
    return json({ error: 'invalid json' }, 422);
  }

  if (body.state === undefined || body.state === null || !body?.questions) {
    return json({ error: 'state and questions required' }, 422);
  }

  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    console.info('[api/decide] no TYPESAFE_API_KEY — degraded offline response');
    return json(
      offlineProxyAnswers(body.questions as Record<string, ProxyQuestion>, body.state as ProxyDigest, {
        reason: 'no_TYPESAFE_API_KEY',
      }),
    );
  }

  try {
    const client = new TypeSafeClient({ apiKey, timeout: 1200 });
    const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === 'choice') {
        questions[id] = choice(q.instructions, q.criteria);
      } else if (q.type === 'noul') {
        questions[id] = noul(q.instructions, q.criteria);
      }
    }

    const response = await client.systemOne({
      state: body.state,
      model: body.model ?? 'jev-latest',
      questions,
    });

    return json({
      model: response.model,
      answers: response.answers,
      usage: response.usage,
    });
  } catch (err) {
    console.error('[api/decide]', err);
    const msg = String(err);
    return json({
      ...offlineProxyAnswers(body.questions as Record<string, ProxyQuestion>, body.state as ProxyDigest, {
        reason: `typesafe_sdk_error: ${msg}`,
      }),
      error: msg,
    });
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
