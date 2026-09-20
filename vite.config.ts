import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import { runDecide } from './src/net/decideHandler.ts';

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
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            res.statusCode = 422;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid json' }));
            return;
          }

          const result = await runDecide(
            body as Parameters<typeof runDecide>[0],
            apiKey,
          );
          if (result.body.error) {
            console.error('[vite decide]', result.body.error);
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.body));
        } catch (err) {
          console.error('[vite decide]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
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
