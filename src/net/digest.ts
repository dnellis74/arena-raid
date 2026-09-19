import { getAbility } from '../sim/actor.ts';
import {
  conditionOf,
  hitsToFinishCount,
  hitsToFinishPhrase,
  howCloseBucket,
  roomToBackAway,
  survivableHitsCount,
  survivableHitsPhrase,
  type ConditionLabel,
} from '../sim/buckets.ts';
import type { Actor, StateId } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { gapTo, hostiles, nearestHostile } from '../sim/world.ts';

const BEHAVIOR_LABEL: Record<StateId, string> = {
  hold_and_shoot: 'standing still and shooting',
  close_and_attack: 'walking at the enemy to fight up close',
  skirmish: 'keeping distance while attacking',
  retreat: 'running away',
};

/** Enemy situation block — full for AI; kind + lethality for player. */
export interface DigestEnemy {
  kind: string;
  condition?: string;
  hits_to_finish?: string;
  how_close?: string;
  moving_toward_the_character?: boolean;
  reach?: string;
  about_to_attack?: boolean;
}

export interface DecideDigest {
  character: {
    role: string;
    condition?: string;
    /** Omitted when no living hostile can deal damage. */
    survivable_hits?: string;
    current_behavior: string;
    ready_abilities: string[];
    unavailable_abilities: string[];
    /** Omitted for player-controlled (danger/room framing). */
    room_to_back_away?: string;
  };
  orders?: {
    given_directly_to_this_character?: string;
    given_to_the_whole_party?: string;
  };
  enemy: DigestEnemy;
}

/** Highest single-hit damage among living hostiles' abilities (any CD). */
export function worstIncomingHit(world: World, actor: Actor): number | null {
  let best = 0;
  for (const h of hostiles(world, actor)) {
    for (const id of h.abilities) {
      const d = getAbility(id).damage ?? 0;
      if (d > best) best = d;
    }
  }
  return best > 0 ? best : null;
}

/** Highest damage among this actor's ready (cooldown ≤ 0) abilities. */
export function bestReadyAttackDamage(actor: Actor): number | null {
  let best = 0;
  for (const id of actor.abilities) {
    if ((actor.cooldowns[id] ?? 0) > 0) continue;
    const d = getAbility(id).damage ?? 0;
    if (d > best) best = d;
  }
  return best > 0 ? best : null;
}

function nextCondition(actor: Actor): ConditionLabel {
  const label = conditionOf(
    actor.hp,
    actor.hpMax,
    (actor.lastCondition as ConditionLabel) || null,
  );
  actor.lastCondition = label;
  return label;
}

/**
 * Build Jev state for one actor. Never includes opposing orders or raw numbers.
 *
 * Player digests include condition + lethality (survivable_hits / hits_to_finish)
 * but omit danger framing (how_close, about_to_attack, room_to_back_away).
 * Enemy/AI digests keep the full situational picture for autonomous decisions.
 *
 * When `actor.standingOrder` is non-empty, it MUST appear as
 * `orders.given_directly_to_this_character` (verbatim) — this is the prompt
 * Jev follows on the player path.
 */
export function buildDigest(world: World, actor: Actor): DecideDigest {
  const enemy = nearestHostile(world, actor);
  const ready: string[] = [];
  const unavailable: string[] = [];
  for (const id of actor.abilities) {
    const ab = getAbility(id);
    const label = `${ab.name}: ${ab.blurb}`;
    if ((actor.cooldowns[id] ?? 0) <= 0) ready.push(label);
    else unavailable.push(ab.name);
  }

  const playerControlled = actor.side === 'player';
  const condition = nextCondition(actor);
  const worst = worstIncomingHit(world, actor);
  const hits = survivableHitsCount(actor.hp, worst);
  actor.lastSurvivableHits = hits;
  const survivable =
    hits !== null ? { survivable_hits: survivableHitsPhrase(hits) } : {};

  const enemyCondition = enemy ? nextCondition(enemy) : undefined;
  const finish =
    enemy !== null
      ? hitsToFinishCount(enemy.hp, bestReadyAttackDamage(actor))
      : null;
  const finishField =
    finish !== null ? { hits_to_finish: hitsToFinishPhrase(finish) } : {};

  const digest: DecideDigest = {
    character: {
      role: actor.role,
      condition,
      ...survivable,
      current_behavior: BEHAVIOR_LABEL[actor.state],
      ready_abilities: ready,
      unavailable_abilities: unavailable,
      ...(playerControlled
        ? {}
        : {
            room_to_back_away: enemy
              ? roomToBackAway(
                  actor.pos,
                  enemy.pos,
                  world.encounter.arenaW,
                  world.encounter.arenaH,
                )
              : 'open',
          }),
    },
    enemy: playerControlled
      ? enemy
        ? {
            kind: enemy.kind,
            condition: enemyCondition,
            ...finishField,
          }
        : { kind: 'none' }
      : enemy
        ? {
            kind: enemy.kind,
            condition: enemyCondition,
            ...finishField,
            how_close: howCloseBucket(gapTo(actor, enemy)),
            moving_toward_the_character: isMovingToward(enemy, actor),
            reach: 'can only attack from close enough to touch',
            about_to_attack: enemy.casting !== null,
          }
        : {
            kind: 'none',
            condition: 'untouched',
            how_close: 'across the arena',
            moving_toward_the_character: false,
            reach: 'unknown',
            about_to_attack: false,
          },
  };

  const orders: NonNullable<DecideDigest['orders']> = {};
  // Fog of war: only this actor's own orders — never the opposing side's.
  // Character order only when the player actually specified one (trimmed).
  const direct = actor.standingOrder?.trim();
  if (direct) {
    orders.given_directly_to_this_character = direct;
  }
  // Party order for player-side actors — always include when present.
  if (actor.side === 'player') {
    const party = (actor.partyOrder ?? world.partyOrder)?.trim();
    if (party) {
      orders.given_to_the_whole_party = party;
    }
  }
  if (Object.keys(orders).length > 0) digest.orders = orders;

  return digest;
}

function isMovingToward(mover: Actor, toward: Actor): boolean {
  const dx = toward.pos.x - mover.pos.x;
  const dy = toward.pos.y - mover.pos.y;
  const dot = dx * mover.vel.x + dy * mover.vel.y;
  return dot > 0.5;
}

/** Assert helpers for tests: no numeric coordinates/HP/distances leak. */
export function assertDigestClean(digest: DecideDigest): void {
  walkNoNumbers(digest);
  const json = JSON.stringify(digest);
  if (/%/.test(json) || /\b\d+(\.\d+)?%\b/.test(json)) {
    throw new Error(`HP percentage leaked into digest: ${json}`);
  }
}

function walkNoNumbers(value: unknown, path = ''): void {
  if (typeof value === 'number') {
    throw new Error(`Numeric value leaked into digest at ${path}: ${value}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkNoNumbers(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkNoNumbers(v, path ? `${path}.${k}` : k);
    }
  }
}
