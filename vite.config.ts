import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';
import {
  offlineProxyAnswers,
  type ProxyDigest,
  type ProxyQuestion,
} from './src/net/offlineProxyAnswers.ts';

/**
 * Local /api/decide during `vite` — mirrors the Vercel function.
 * Key must come from loadEnv(.env); Vite does not put non-VITE_ vars into process.env.
 */
function decideApiPlugin(apiKey: string | undefined): Plugin {
  return {
    name: 'decide-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/decide' || req.method !== 'POST') return next();
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            state?: ProxyDigest;
            questions?: Record<string, ProxyQuestion>;
            model?: string;
          };

          const key = apiKey?.trim();
          if (!key || !body.questions) {
            const reason = !key ? 'no_TYPESAFE_API_KEY' : 'missing_questions';
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify(
                offlineProxyAnswers(body.questions ?? {}, body.state, { reason }),
              ),
            );
            return;
          }

          const client = new TypeSafeClient({ apiKey: key, timeout: 1200 });
          const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
          for (const [id, q] of Object.entries(body.questions)) {
            if (q.type === 'choice' && 'criteria' in q && q.criteria) {
              questions[id] = choice(
                (q as { instructions?: string }).instructions ?? '',
                q.criteria as Record<string, string | null>,
              );
            } else if (q.type === 'noul') {
              questions[id] = noul((q as { instructions?: string }).instructions ?? '');
            }
          }
          const response = await client.systemOne({
            state: body.state as import('@typesafe-ai/sdk').EntryType,
            model: body.model ?? 'jev-latest',
            questions,
          });
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              model: response.model,
              answers: response.answers,
              usage: response.usage,
            }),
          );
        } catch (err) {
          console.error('[vite decide]', err);
          const msg = String(err);
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              ...offlineProxyAnswers({}, undefined, { reason: `typesafe_sdk_error: ${msg}` }),
              error: msg,
            }),
          );
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Empty prefix: load all keys from .env / .env.local (not only VITE_*).
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.TYPESAFE_API_KEY?.trim() || process.env.TYPESAFE_API_KEY?.trim();
  console.info(`[vite] TYPESAFE_API_KEY ${apiKey ? 'present' : 'missing (offline stub)'}`);

  return {
    plugins: [decideApiPlugin(apiKey)],
    server: { port: 5173 },
    test: {
      environment: 'node',
      include: ['test/**/*.spec.ts'],
      exclude: ['test/calibration/**', '**/node_modules/**'],
    },
  };
});
