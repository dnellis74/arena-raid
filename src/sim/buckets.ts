import bands from '../data/bands.json' with { type: 'json' };
import digestBuckets from '../data/digestBuckets.json' with { type: 'json' };
import type { RangeBandId, Vec2 } from './types.ts';
import { ARENA_H, ARENA_W } from './types.ts';
import { clamp, dist, len, norm, sub } from './vec.ts';

export type ConditionLabel =
  | 'untouched'
  | 'scratched'
  | 'bloodied'
  | 'badly hurt'
  | "at death's door";

/** Condition labels — no shared word stems across bands. */
export const CONDITION_BANDS = digestBuckets.conditionBands as readonly {
  label: ConditionLabel;
  enterAbove: number;
  exitBelow: number;
}[];

export type HowCloseBucket =
  | 'within reach'
  | 'almost within reach'
  | 'a short run away'
  | 'a long way off'
  | 'across the arena';

export type RoomBucket = 'open' | 'limited' | 'cornered';

/** Open-loop (no hysteresis) band from HP fraction — uses CONDITION_BANDS enterAbove. */
export function conditionFromFraction(f: number): ConditionLabel {
  for (const b of CONDITION_BANDS) {
    if (f > b.enterAbove) return b.label;
  }
  return CONDITION_BANDS[CONDITION_BANDS.length - 1]!.label;
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

function phraseForHits(
  hits: number,
  phrases: { '1': string; '2': string; '3': string; default: string },
): string {
  if (hits <= 1) return phrases['1'];
  if (hits === 2) return phrases['2'];
  if (hits === 3) return phrases['3'];
  return phrases.default;
}

export function survivableHitsPhrase(hits: number): string {
  return phraseForHits(hits, digestBuckets.survivableHitsPhrases);
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
  return phraseForHits(hits, digestBuckets.hitsToFinishPhrases);
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

/** Edge gap at or below this is "within reach" / contact trigger — shared with bands.contact.max. */
export const CONTACT_GAP = bands.contact.max;

function resolveHowCloseMax(maxGap: number | 'contact' | undefined): number | null {
  if (maxGap === undefined) return null;
  if (maxGap === 'contact') return bands.contact.max;
  return maxGap;
}

export function howCloseBucket(gap: number): HowCloseBucket {
  for (const row of digestBuckets.howClose) {
    const max = resolveHowCloseMax(
      'maxGap' in row ? (row.maxGap as number | 'contact') : undefined,
    );
    if (max === null || gap <= max) return row.label as HowCloseBucket;
  }
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
  for (const row of digestBuckets.roomToBackAway) {
    const min = 'minDistance' in row ? row.minDistance : undefined;
    if (min === undefined || t >= min) return row.label as RoomBucket;
  }
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
