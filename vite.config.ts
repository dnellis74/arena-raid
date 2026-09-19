import { defineConfig, type Plugin } from 'vitest/config';
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';
import {
  offlineProxyAnswers,
  type ProxyDigest,
  type ProxyQuestion,
} from './src/net/offlineProxyAnswers.ts';

/** Local /api/decide during `vite` — mirrors the Vercel function. */
function decideApiPlugin(): Plugin {
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

          const apiKey = process.env.TYPESAFE_API_KEY;
          if (!apiKey || !body.questions) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(offlineProxyAnswers(body.questions ?? {}, body.state)));
            return;
          }

          const client = new TypeSafeClient({ apiKey, timeout: 1200 });
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
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ...offlineProxyAnswers({}), error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [decideApiPlugin()],
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/calibration/**', '**/node_modules/**'],
  },
});
