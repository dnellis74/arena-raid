import bands from '../data/bands.json';
import type { RangeBandId, Vec2 } from './types.ts';
import { ARENA_H, ARENA_W } from './types.ts';
import { clamp, dist, len, norm, sub } from './vec.ts';

export type HealthBucket =
  | 'unhurt'
  | 'lightly wounded'
  | 'wounded'
  | 'badly wounded'
  | 'near death';

export type HowCloseBucket =
  | 'within reach'
  | 'almost within reach'
  | 'a short run away'
  | 'a long way off'
  | 'across the arena';

export type RoomBucket = 'open' | 'limited' | 'cornered';

export function healthBucket(hp: number, hpMax: number): HealthBucket {
  const f = hpMax <= 0 ? 0 : hp / hpMax;
  if (f > 0.85) return 'unhurt';
  if (f > 0.6) return 'lightly wounded';
  if (f > 0.35) return 'wounded';
  if (f > 0.15) return 'badly wounded';
  return 'near death';
}

/** Gap = center distance minus both radii (edge-to-edge). */
export function edgeGap(
  selfPos: Vec2,
  selfR: number,
  otherPos: Vec2,
  otherR: number,
): number {
  return dist(selfPos, otherPos) - selfR - otherR;
}

export function howCloseBucket(gap: number): HowCloseBucket {
  if (gap <= 1.4) return 'within reach';
  if (gap <= 2.5) return 'almost within reach';
  if (gap <= 5) return 'a short run away';
  if (gap <= 9) return 'a long way off';
  return 'across the arena';
}

/** Room along the away-from-enemy vector toward walls. */
export function roomToBackAway(
  selfPos: Vec2,
  enemyPos: Vec2,
  arenaW = ARENA_W,
  arenaH = ARENA_H,
): RoomBucket {
  const away = norm(sub(selfPos, enemyPos));
  if (len(away) < 1e-6) return 'limited';
  // Distance to wall along away direction (ray to AABB).
  let t = Infinity;
  if (away.x > 1e-6) t = Math.min(t, (arenaW - selfPos.x) / away.x);
  else if (away.x < -1e-6) t = Math.min(t, (0 - selfPos.x) / away.x);
  if (away.y > 1e-6) t = Math.min(t, (arenaH - selfPos.y) / away.y);
  else if (away.y < -1e-6) t = Math.min(t, (0 - selfPos.y) / away.y);
  if (!Number.isFinite(t)) t = 0;
  if (t >= 6) return 'open';
  if (t >= 2.5) return 'limited';
  return 'cornered';
}

export function bandToUnits(band: RangeBandId): [number, number] {
  const b = bands[band];
  return [b.min, b.max];
}

export function wallDistance(pos: Vec2, arenaW = ARENA_W, arenaH = ARENA_H): number {
  return Math.min(pos.x, arenaW - pos.x, pos.y, arenaH - pos.y);
}

export function clampToArena(pos: Vec2, r: number, w = ARENA_W, h = ARENA_H): Vec2 {
  return {
    x: clamp(pos.x, r, w - r),
    y: clamp(pos.y, r, h - r),
  };
}
