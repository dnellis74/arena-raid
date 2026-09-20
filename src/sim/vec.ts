import type { Vec2 } from './types.ts';

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rotate(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** True when `mover` velocity has a component toward `toward`. */
export function isApproaching(
  mover: { pos: Vec2; vel: Vec2 },
  toward: { pos: Vec2 },
  threshold = 0.5,
): boolean {
  const dx = toward.pos.x - mover.pos.x;
  const dy = toward.pos.y - mover.pos.y;
  return dx * mover.vel.x + dy * mover.vel.y > threshold;
}

export function zero(): Vec2 {
  return { x: 0, y: 0 };
}
