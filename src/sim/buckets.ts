import bands from '../data/bands.json';
import type { RangeBandId, Vec2 } from './types.ts';
import { ARENA_H, ARENA_W } from './types.ts';
import { clamp, dist, len, norm, sub } from './vec.ts';

/** Condition labels — no shared word stems across bands. */
export const CONDITION_BANDS = [
  { label: 'untouched' as const, enterAbove: 0.85, exitBelow: 0.81 },
  { label: 'scratched' as const, enterAbove: 0.6, exitBelow: 0.56 },
  { label: 'bloodied' as const, enterAbove: 0.35, exitBelow: 0.31 },
  { label: 'badly hurt' as const, enterAbove: 0.15, exitBelow: 0.11 },
  { label: "at death's door" as const, enterAbove: 0, exitBelow: 0 },
] as const;

export type ConditionLabel = (typeof CONDITION_BANDS)[number]['label'];

export type HowCloseBucket =
  | 'within reach'
  | 'almost within reach'
  | 'a short run away'
  | 'a long way off'
  | 'across the arena';

export type RoomBucket = 'open' | 'limited' | 'cornered';

/** Open-loop (no hysteresis) band from HP fraction. */
export function conditionFromFraction(f: number): ConditionLabel {
  if (f > 0.85) return 'untouched';
  if (f > 0.6) return 'scratched';
  if (f > 0.35) return 'bloodied';
  if (f > 0.15) return 'badly hurt';
  return "at death's door";
}

/**
 * Schmitt-trigger condition band. Keep `previous` on the actor for
 * deterministic replays; rising and falling disagree inside the 4pt gap.
 */
export function conditionOf(
  hp: number,
  hpMax: number,
  previous: ConditionLabel | null,
): ConditionLabel {
  const f = hpMax <= 0 ? 0 : hp / hpMax;
  if (previous === null) return conditionFromFraction(f);

  const prevIdx = CONDITION_BANDS.findIndex((b) => b.label === previous);
  if (prevIdx < 0) return conditionFromFraction(f);

  // Rising: promote only after clearing a healthier band's enterAbove
  for (let i = 0; i < prevIdx; i++) {
    if (f > CONDITION_BANDS[i]!.enterAbove) return CONDITION_BANDS[i]!.label;
  }

  // Falling: hold previous until below its exitBelow
  if (f > CONDITION_BANDS[prevIdx]!.exitBelow) return previous;

  return conditionFromFraction(f);
}

/** ceil(hp / worstIncomingHit); omit when no living hostile damage. */
export function survivableHitsCount(
  hp: number,
  worstIncomingHit: number | null,
): number | null {
  if (worstIncomingHit === null || worstIncomingHit <= 0) return null;
  return Math.ceil(hp / worstIncomingHit);
}

export function survivableHitsPhrase(hits: number): string {
  if (hits <= 1) return 'the next hit will kill this character';
  if (hits === 2) return 'two more hits would kill this character';
  if (hits === 3) return 'three more hits would kill this character';
  return 'can take several more hits';
}

/** ceil(enemyHp / bestReadyAttackDamage). */
export function hitsToFinishCount(
  enemyHp: number,
  bestReadyAttackDamage: number | null,
): number | null {
  if (bestReadyAttackDamage === null || bestReadyAttackDamage <= 0) return null;
  return Math.ceil(enemyHp / bestReadyAttackDamage);
}

export function hitsToFinishPhrase(hits: number): string {
  if (hits <= 1) return 'one more hit will kill it';
  if (hits === 2) return 'two more hits will kill it';
  if (hits === 3) return 'three more hits will kill it';
  return 'it will take several more hits to kill';
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
