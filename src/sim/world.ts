import encounters from '../data/encounters.json' with { type: 'json' };
import { createActor } from './actor.ts';
import { edgeGap } from './buckets.ts';
import { mulberry32, type Rng } from './rng.ts';
import type {
  Actor,
  ActorId,
  DecisionEntry,
  Encounter,
  FloatingText,
  GroundEffect,
  PendingStrike,
  Side,
  StateId,
  Vec2,
} from './types.ts';
import { ARENA_H, ARENA_W } from './types.ts';
import { dist } from './vec.ts';

export interface World {
  encounter: Encounter;
  actors: Actor[];
  tick: number;
  time: number;
  rng: Rng;
  groundEffects: GroundEffect[];
  pendingStrikes: PendingStrike[];
  floatingTexts: FloatingText[];
  decisionLog: DecisionEntry[];
  partyOrder: string | null;
  matchOver: boolean;
  winner: Side | null;
  degraded: boolean;
  nextFloatId: number;
  nextGroundId: number;
}

export function createReferenceFight(
  seed: number,
  opts?: { players?: string[]; enemies?: number },
): World {
  const ref = encounters.referenceFight;
  const encounter: Encounter = {
    id: ref.id,
    seed,
    allowedStates: [...ref.allowedStates] as StateId[],
    arenaW: ARENA_W,
    arenaH: ARENA_H,
    partyOrder: null,
  };

  let enemySeen = 0;
  const actors = ref.actors
    .filter((spawn) => {
      if (spawn.side === 'player') {
        return !opts?.players || opts.players.includes(spawn.kind);
      }
      if (opts?.enemies !== undefined) {
        enemySeen += 1;
        return enemySeen <= opts.enemies;
      }
      return true;
    })
    .map((spawn) => {
      const pos = spawn.pos as { x?: number; y: number; xCenter?: boolean };
      const y = pos.y;
      const x = pos.xCenter || pos.x === undefined ? ARENA_W / 2 : pos.x;
      return createActor({
        id: spawn.id,
        side: spawn.side as Side,
        kind: spawn.kind,
        pos: { x, y },
      });
    });

  const world: World = {
    encounter,
    actors,
    tick: 0,
    time: 0,
    rng: mulberry32(seed),
    groundEffects: [],
    pendingStrikes: [],
    floatingTexts: [],
    decisionLog: [],
    partyOrder: null,
    matchOver: false,
    winner: null,
    degraded: false,
    nextFloatId: 1,
    nextGroundId: 1,
  };
  return world;
}

export function getActor(world: World, id: ActorId): Actor | undefined {
  return world.actors.find((a) => a.id === id);
}

export function living(world: World): Actor[] {
  return world.actors.filter((a) => a.alive);
}

export function hostiles(world: World, actor: Actor): Actor[] {
  return living(world).filter((a) => a.side !== actor.side);
}

export function allies(world: World, actor: Actor): Actor[] {
  return living(world).filter((a) => a.side === actor.side && a.id !== actor.id);
}

export function nearestHostile(world: World, actor: Actor): Actor | null {
  const hs = hostiles(world, actor);
  if (hs.length === 0) return null;
  let best = hs[0]!;
  let bestD = dist(actor.pos, best.pos);
  for (let i = 1; i < hs.length; i++) {
    const h = hs[i]!;
    const d = dist(actor.pos, h.pos);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

export function gapTo(actor: Actor, other: Actor): number {
  return edgeGap(actor.pos, actor.radius, other.pos, other.radius);
}

export function pushFloating(
  world: World,
  pos: Vec2,
  text: string,
  color: string,
): void {
  world.floatingTexts.push({
    id: `ft${world.nextFloatId++}`,
    pos: { ...pos },
    text,
    color,
    age: 0,
    life: 0.6,
  });
}

export function recordDecision(world: World, entry: DecisionEntry): void {
  world.decisionLog.push(entry);
  const actor = getActor(world, entry.actorId);
  if (!actor) return;
  actor.lastDecision = entry;
  actor.decisionLog.push(entry);
  if (actor.decisionLog.length > 10) actor.decisionLog.shift();
  if (actor.state !== entry.state) {
    actor.lastStateChangeTick = world.tick;
  }
  actor.state = entry.state;
  actor.stateParams = { ...actor.stateParams, ...entry.params };
  if (entry.ability) {
    actor.stateParams.abilityPriority = [
      entry.ability,
      ...(actor.stateParams.abilityPriority ?? []).filter((a) => a !== entry.ability),
    ];
  }
  if (entry.rangeBand) actor.stateParams.rangeBand = entry.rangeBand;
}

export function setPartyOrder(world: World, order: string | null): void {
  world.partyOrder = order;
  world.encounter.partyOrder = order;
  for (const a of world.actors) {
    if (a.side === 'player') a.partyOrder = order;
  }
}

export function checkMatchOver(world: World): void {
  const players = living(world).filter((a) => a.side === 'player');
  const enemies = living(world).filter((a) => a.side === 'enemy');
  if (players.length === 0) {
    world.matchOver = true;
    world.winner = 'enemy';
  } else if (enemies.length === 0) {
    world.matchOver = true;
    world.winner = 'player';
  }
}

export function observeBehavior(actor: Actor): StateId {
  // Derive from velocity + casting for fog-of-war enemy sheets.
  const speed = Math.hypot(actor.vel.x, actor.vel.y);
  if (actor.state === 'retreat' || (speed > actor.moveSpeed * 0.4 && actor.casting === null)) {
    // Keep actual state for player; for observation we mirror state when known in debug.
  }
  return actor.state;
}
