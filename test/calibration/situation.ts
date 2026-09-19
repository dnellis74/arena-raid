import { buildDigest, type DecideDigest } from '../../src/net/digest.ts';
import type { Actor } from '../../src/sim/types.ts';
import { createReferenceFight, type World } from '../../src/sim/world.ts';

/**
 * Case A reference fight at the moment the goblin is "a short run away"
 * (edge gap ≈ 4u). Player standing order left empty — calibration injects
 * `orders.given_directly_to_this_character` per case.
 */
export function createGoblinClosingWorld(seed = 1): { world: World; player: Actor } {
  const world = createReferenceFight(seed);
  const player = world.actors.find((a) => a.side === 'player')!;
  const goblin = world.actors.find((a) => a.side === 'enemy')!;
  // Centers 5u apart → edge gap 4u → how_close "a short run away"
  player.pos = { x: 8, y: 8 };
  goblin.pos = { x: 8, y: 13 };
  goblin.vel = { x: 0, y: -3.6 };
  player.standingOrder = null;
  player.partyOrder = null;
  world.partyOrder = null;
  return { world, player };
}

export function buildGoblinClosingDigest(seed = 1): DecideDigest {
  const { world, player } = createGoblinClosingWorld(seed);
  return buildDigest(world, player);
}
