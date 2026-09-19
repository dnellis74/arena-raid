import type { World } from '../sim/world.ts';
import { formatBackendMode, session, sessionAvgMs } from '../net/telemetry.ts';

export interface HudState {
  seed: number;
  timeScale: number;
  degraded: boolean;
  matchOver: boolean;
  winner: string | null;
  debug: boolean;
  p95Warning: boolean;
  rateLimitWarning: boolean;
}

const LOG_INTERVAL_MS = 5000;
let lastLog = 0;

/** Console-only status logger (former top status bar). No DOM. */
export function createHud(): {
  update: (world: World, hud: HudState) => void;
} {
  return {
    update(world, hud) {
      const now = performance.now();
      if (lastLog !== 0 && now - lastLog < LOG_INTERVAL_MS) return;
      lastLog = now;

      const mode = formatBackendMode(hud.degraded || world.degraded);
      const warn =
        (hud.p95Warning || session.p95Warning ? ' p95⚠' : '') +
        (hud.rateLimitWarning || session.rateLimitWarning ? ' rate⚠' : '');
      const match = hud.matchOver ? ` | MATCH OVER — ${hud.winner} wins` : '';
      const dbg = hud.debug ? ' | DEBUG' : '';

      console.info(
        `[hud 5s] seed ${hud.seed} | t=${world.time.toFixed(1)}s | speed ×${hud.timeScale}` +
          ` | backend ${mode}${warn}` +
          ` | tok ${session.tokensIn}/${session.tokensOut} · avg ${sessionAvgMs()}ms · n=${session.calls}` +
          `${dbg}${match}`,
      );
    },
  };
}

export function resetHudLogClock(): void {
  lastLog = 0;
}
