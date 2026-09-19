import type { World } from '../sim/world.ts';
import { session, sessionAvgMs } from '../net/telemetry.ts';

export interface HudState {
  seed: number;
  timeScale: number;
  degraded: boolean;
  matchOver: boolean;
  winner: string | null;
  debug: boolean;
  p95Warning: boolean;
  rateLimitWarning: boolean;
  lastTelemetry: string | null;
}

export function createHud(root: HTMLElement): {
  el: HTMLElement;
  update: (world: World, hud: HudState) => void;
} {
  const el = document.createElement('div');
  el.id = 'status-bar';
  el.style.cssText = `
    flex: 0 0 auto; min-height: 6%; padding: 8px 12px;
    display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center;
    background: #0f172a; border-bottom: 1px solid #1e293b; font-size: 12px;
  `;
  root.appendChild(el);

  return {
    el,
    update(world, hud) {
      const timer = world.time.toFixed(1);
      const mode = hud.degraded || world.degraded ? 'DEGRADED' : 'live';
      const modeColor = mode === 'DEGRADED' ? '#fbbf24' : '#4ade80';
      const warn =
        (hud.p95Warning || session.p95Warning ? ' ⚠ p95' : '') +
        (hud.rateLimitWarning || session.rateLimitWarning ? ' ⚠ rate' : '');
      el.innerHTML = `
        <span>seed <strong id="seed-display">${hud.seed}</strong></span>
        <span>t=${timer}s</span>
        <span>speed ×${hud.timeScale}</span>
        <span style="color:${modeColor}">backend ${mode}${warn}</span>
        <span title="session tokens">tok ${session.tokensIn}/${session.tokensOut} · avg ${sessionAvgMs()}ms · n=${session.calls}</span>
        ${hud.debug ? '<span style="color:#f472b6">DEBUG</span>' : ''}
        ${hud.matchOver ? `<span style="color:#f87171">MATCH OVER — ${hud.winner} wins</span>` : ''}
      `;
    },
  };
}
