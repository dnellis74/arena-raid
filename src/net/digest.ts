import { getAbility } from '../sim/actor.ts';
import {
  healthBucket,
  howCloseBucket,
  roomToBackAway,
} from '../sim/buckets.ts';
import type { Actor, StateId } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { gapTo, nearestHostile } from '../sim/world.ts';

const BEHAVIOR_LABEL: Record<StateId, string> = {
  hold_and_shoot: 'standing still and shooting',
  close_and_attack: 'walking at the enemy to fight up close',
  skirmish: 'keeping distance while attacking',
  retreat: 'running away',
};

/** Enemy situation block — full for AI; slim (kind only) for player-controlled. */
export interface DigestEnemy {
  kind: string;
  health?: string;
  how_close?: string;
  moving_toward_the_character?: boolean;
  reach?: string;
  about_to_attack?: boolean;
}

export interface DecideDigest {
  character: {
    role: string;
    /** Omitted for player-controlled: health urgency steers Jev off orders. */
    health?: string;
    current_behavior: string;
    ready_abilities: string[];
    unavailable_abilities: string[];
    /** Omitted for player-controlled. */
    room_to_back_away?: string;
  };
  orders?: {
    given_directly_to_this_character?: string;
    given_to_the_whole_party?: string;
  };
  enemy: DigestEnemy;
}

/**
 * Build Jev state for one actor. Never includes opposing orders or raw numbers.
 *
 * Player-controlled digests are prompt-first: orders + role/abilities, without
 * danger/situation framing that encourages disobeying standing orders.
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

  const digest: DecideDigest = {
    character: {
      role: actor.role,
      current_behavior: BEHAVIOR_LABEL[actor.state],
      ready_abilities: ready,
      unavailable_abilities: unavailable,
      ...(playerControlled
        ? {}
        : {
            health: healthBucket(actor.hp, actor.hpMax),
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
      ? { kind: enemy?.kind ?? 'none' }
      : enemy
        ? {
            kind: enemy.kind,
            health: healthBucket(enemy.hp, enemy.hpMax),
            how_close: howCloseBucket(gapTo(actor, enemy)),
            moving_toward_the_character: isMovingToward(enemy, actor),
            reach: 'can only attack from close enough to touch',
            about_to_attack: enemy.casting !== null,
          }
        : {
            kind: 'none',
            health: 'unhurt',
            how_close: 'across the arena',
            moving_toward_the_character: false,
            reach: 'unknown',
            about_to_attack: false,
          },
  };

  const orders: NonNullable<DecideDigest['orders']> = {};
  // Fog of war: only this actor's own orders — never the opposing side's
  if (actor.standingOrder) {
    orders.given_directly_to_this_character = actor.standingOrder;
  }
  if (actor.side === 'player' && (actor.partyOrder || world.partyOrder)) {
    orders.given_to_the_whole_party = actor.partyOrder ?? world.partyOrder ?? undefined;
  }
  // Enemy standing order is THEIR order — include for enemy actors only
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
