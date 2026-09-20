import type { Actor, FloatingText, GroundEffect } from '../sim/types.ts';
import { ARENA_H, ARENA_W, STATE_ABBREV } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

export interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
  canvasW: number;
  canvasH: number;
}

export function computeTransform(canvasW: number, canvasH: number): ViewTransform {
  const scale = Math.min(canvasW / ARENA_W, canvasH / ARENA_H);
  const ox = (canvasW - ARENA_W * scale) / 2;
  const oy = (canvasH - ARENA_H * scale) / 2;
  return { scale, ox, oy, canvasW, canvasH };
}

export function worldToScreen(t: ViewTransform, x: number, y: number): { x: number; y: number } {
  return { x: t.ox + x * t.scale, y: t.oy + y * t.scale };
}

export function screenToWorld(t: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - t.ox) / t.scale, y: (sy - t.oy) / t.scale };
}

export function renderArena(
  ctx: CanvasRenderingContext2D,
  world: World,
  selectedId: string | null,
  t: ViewTransform,
): void {
  const { canvasW, canvasH, scale, ox, oy } = t;
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Letterbox
  ctx.fillStyle = '#0a0e12';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Floor
  ctx.fillStyle = '#1a2332';
  ctx.fillRect(ox, oy, ARENA_W * scale, ARENA_H * scale);

  // Grid 1u at 8% opacity
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= ARENA_W; x++) {
    const p = worldToScreen(t, x, 0);
    ctx.beginPath();
    ctx.moveTo(p.x, oy);
    ctx.lineTo(p.x, oy + ARENA_H * scale);
    ctx.stroke();
  }
  for (let y = 0; y <= ARENA_H; y++) {
    const p = worldToScreen(t, 0, y);
    ctx.beginPath();
    ctx.moveTo(ox, p.y);
    ctx.lineTo(ox + ARENA_W * scale, p.y);
    ctx.stroke();
  }

  // Ground effects
  for (const g of world.groundEffects) drawGround(ctx, g, t);

  // Pucks
  for (const a of world.actors) {
    if (!a.alive) continue;
    drawPuck(ctx, a, t, a.id === selectedId, world.time);
  }

  // Floating damage
  for (const ft of world.floatingTexts) drawFloat(ctx, ft, t);
}

function drawGround(ctx: CanvasRenderingContext2D, g: GroundEffect, t: ViewTransform): void {
  const p = worldToScreen(t, g.pos.x, g.pos.y);
  ctx.beginPath();
  ctx.arc(p.x, p.y, g.radius * t.scale, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(168,85,247,0.25)';
  ctx.fill();
}

/** Reticle + asterisk — shape, not just color, so a marked enemy is readable. */
function drawArcaneMark(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  r: number,
): void {
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * (r + 5), p.y + Math.sin(a) * (r + 5));
    ctx.lineTo(p.x + Math.cos(a) * (r + 11), p.y + Math.sin(a) * (r + 11));
    ctx.stroke();
  }
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `bold ${Math.max(11, r * 0.95)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('*', p.x, p.y - r - 5);
}

/** Shield brackets — shape, not just color. */
function drawBulwark(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  r: number,
): void {
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  const h = r + 6;
  ctx.beginPath();
  ctx.moveTo(p.x - r - 4, p.y - h);
  ctx.lineTo(p.x - r - 7, p.y);
  ctx.lineTo(p.x - r - 4, p.y + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x + r + 4, p.y - h);
  ctx.lineTo(p.x + r + 7, p.y);
  ctx.lineTo(p.x + r + 4, p.y + h);
  ctx.stroke();
}

/** Carets above the puck for a damage buff. */
function drawShout(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  r: number,
): void {
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  const y = p.y - r - 6;
  ctx.beginPath();
  ctx.moveTo(p.x - 5, y);
  ctx.lineTo(p.x, y - 6);
  ctx.lineTo(p.x + 5, y);
  ctx.stroke();
}

/** "!" on a taunted enemy so aggro isn't color-only. */
function drawTaunt(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  r: number,
): void {
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `bold ${Math.max(12, r * 1.1)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('!', p.x + r + 6, p.y - r);
}

function drawPuck(
  ctx: CanvasRenderingContext2D,
  a: Actor,
  t: ViewTransform,
  selected: boolean,
  now: number,
): void {
  const p = worldToScreen(t, a.pos.x, a.pos.y);
  const r = a.radius * t.scale;

  // Selection
  if (selected) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (a.stateParams.targetId) {
      // thin line drawn by caller with world actors — skip if no target pos
    }
  }

  if (a.side === 'player') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = a.color;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.strokeStyle = a.outline ?? '#84CC16';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (a.statuses.some((s) => s.type === 'damage_taken_up')) {
    drawArcaneMark(ctx, p, r);
  }
  if (a.statuses.some((s) => s.type === 'damage_reduction')) {
    drawBulwark(ctx, p, r);
  }
  if (a.statuses.some((s) => s.type === 'damage_up')) {
    drawShout(ctx, p, r);
  }
  if (a.forceRetargetTo && now < a.forceRetargetUntil) {
    drawTaunt(ctx, p, r);
  }

  // Glyph
  ctx.fillStyle = a.side === 'player' ? '#ffffff' : a.outline ?? '#84CC16';
  ctx.font = `bold ${Math.max(10, r * 1.2)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.glyph, p.x, p.y + 1);

  // Health arc
  const frac = a.hp / a.hpMax;
  ctx.strokeStyle = frac > 0.35 ? '#4ade80' : '#f87171';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.stroke();

  // Wind-up ring
  if (a.casting) {
    const prog = 1 - a.casting.remaining / a.casting.total;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (1 + prog), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Deciding spinner
  if (a.deciding) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 1.5);
    ctx.stroke();
  }

  // Behavior tag — selected only
  if (selected) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(STATE_ABBREV[a.state], p.x, p.y + r + 14);
  }
}

export function drawTargetLine(
  ctx: CanvasRenderingContext2D,
  from: Actor,
  to: Actor,
  t: ViewTransform,
): void {
  const a = worldToScreen(t, from.pos.x, from.pos.y);
  const b = worldToScreen(t, to.pos.x, to.pos.y);
  ctx.strokeStyle = 'rgba(226,232,240,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawFloat(ctx: CanvasRenderingContext2D, ft: FloatingText, t: ViewTransform): void {
  const p = worldToScreen(t, ft.pos.x, ft.pos.y);
  const alpha = 1 - ft.age / ft.life;
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = ft.color;
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(ft.text, p.x, p.y);
  ctx.globalAlpha = 1;
}

/** Hit-test puck; returns actor id or null. */
export function hitTest(
  world: World,
  t: ViewTransform,
  sx: number,
  sy: number,
): string | null {
  const w = screenToWorld(t, sx, sy);
  let best: string | null = null;
  let bestD = Infinity;
  for (const a of world.actors) {
    if (!a.alive) continue;
    const visualR = a.radius * t.scale;
    const hitR = Math.max(visualR * 1.4, 22) / t.scale;
    const d = Math.hypot(a.pos.x - w.x, a.pos.y - w.y);
    if (d <= hitR && d < bestD) {
      best = a.id;
      bestD = d;
    }
  }
  return best;
}
