import { runDecide } from '../src/net/decideHandler.ts';

export const config = {
  maxDuration: 10,
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 422);
  }

  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  const result = await runDecide(
    body as Parameters<typeof runDecide>[0],
    apiKey,
  );
  if (!apiKey && result.status === 200) {
    console.info('[api/decide] no TYPESAFE_API_KEY — degraded offline response');
  }
  if (result.body.error) {
    console.error('[api/decide]', result.body.error);
  }
  return json(result.body, result.status);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
