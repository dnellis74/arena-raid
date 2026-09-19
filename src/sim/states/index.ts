import { tryBeginCast } from '../abilities.ts';
import { bandToUnits, wallDistance } from '../buckets.ts';
import { getAbility } from '../actor.ts';
import { headingHitsWall, steer } from '../steering.ts';
import type { AbilityId, Actor, StateId, Vec2 } from '../types.ts';
import { ARENA_H, ARENA_W } from '../types.ts';
import type { World } from '../world.ts';
import { gapTo, hostiles, nearestHostile } from '../world.ts';
import { len, norm, rotate, scale, sub, zero } from '../vec.ts';

function roomAlong(pos: Vec2, dir: Vec2): number {
  const n = norm(dir);
  if (len(n) < 1e-6) return 0;
  let t = Infinity;
  if (n.x > 1e-6) t = Math.min(t, (ARENA_W - pos.x) / n.x);
  else if (n.x < -1e-6) t = Math.min(t, -pos.x / n.x);
  if (n.y > 1e-6) t = Math.min(t, (ARENA_H - pos.y) / n.y);
  else if (n.y < -1e-6) t = Math.min(t, -pos.y / n.y);
  return Number.isFinite(t) ? t : 0;
}

function skirmishFleeIntent(world: World, actor: Actor, away: Vec2): Vec2 {
  const wd = wallDistance(actor.pos);
  // Near a wall, cut a wider arc (or pure lateral) so we don't pin ourselves.
  const deg = wd < 2.5 ? 80 : wd < 4 ? 55 : 35;
  const sign = actor.stateParams.skirmishSign ?? 1;
  let intent = rotate(away, ((deg * Math.PI) / 180) * sign);
  if (headingHitsWall(actor.pos, intent, 3) || wd < 2.0) {
    const flipped = (sign === 1 ? -1 : 1) as 1 | -1;
    const alt = rotate(away, ((deg * Math.PI) / 180) * flipped);
    if (!headingHitsWall(actor.pos, alt, 3) && wd >= 2.0) {
      actor.stateParams.skirmishSign = flipped;
      return alt;
    }
    const right = rotate(away, Math.PI / 2);
    const left = rotate(away, -Math.PI / 2);
    const roomR = roomAlong(actor.pos, right);
    const roomL = roomAlong(actor.pos, left);
    actor.stateParams.skirmishSign = roomR >= roomL ? 1 : -1;
    // Bias slightly away from enemy so lateral slide still opens gap
    const lateral = roomR >= roomL ? right : left;
    return norm({ x: lateral.x + away.x * 0.35, y: lateral.y + away.y * 0.35 });
  }
  void world;
  return intent;
}

export type StateHandler = (world: World, actor: Actor, dt: number) => void;

function pickTarget(world: World, actor: Actor): Actor | null {
  if (actor.forceRetargetTo && world.time < actor.forceRetargetUntil) {
    const forced = world.actors.find((a) => a.id === actor.forceRetargetTo && a.alive);
    if (forced) return forced;
  }
  const tid = actor.stateParams.targetId;
  if (tid) {
    const t = world.actors.find((a) => a.id === tid && a.alive);
    if (t) return t;
  }
  return nearestHostile(world, actor);
}

function readyAbility(
  actor: Actor,
  priority: AbilityId[] | undefined,
  minRange?: number,
): AbilityId | null {
  const order = priority ?? actor.abilities;
  for (const id of order) {
    if (!actor.abilities.includes(id)) continue;
    if ((actor.cooldowns[id] ?? 0) > 0) continue;
    const ab = getAbility(id);
    if (minRange !== undefined && ab.range < minRange) continue;
    return id;
  }
  return null;
}

function applyMove(world: World, actor: Actor, intent: Vec2, moveScale = 1): void {
  if (actor.casting) {
    actor.vel = zero();
    return;
  }
  const slow = actor.statuses.find((s) => s.type === 'slow');
  const factor = slow?.factor ?? 1;
  const others = world.actors.filter((a) => a.alive);
  actor.vel = steer(actor, intent, others, moveScale * factor);
}

export const closeAndAttack: StateHandler = (world, actor) => {
  const target = pickTarget(world, actor);
  if (!target) {
    actor.vel = zero();
    return;
  }
  actor.stateParams.targetId = target.id;
  const gap = gapTo(actor, target);
  const priority = actor.stateParams.abilityPriority ?? actor.abilities;
  const ranges = priority.map((id) => getAbility(id).range).filter((r) => r > 0);
  const shortest = ranges.length ? Math.min(...ranges) : 1.4;
  const intent = gap > shortest ? norm(sub(target.pos, actor.pos)) : zero();
  applyMove(world, actor, intent);
  if (gap <= shortest + 0.05) {
    const id = readyAbility(actor, priority);
    if (id) tryBeginCast(world, actor, id, target);
  }
};

export const holdAndShoot: StateHandler = (world, actor) => {
  actor.vel = zero();
  const target = pickTarget(world, actor);
  if (!target) return;
  actor.stateParams.targetId = target.id;
  const gap = gapTo(actor, target);
  const id = readyAbility(actor, actor.stateParams.abilityPriority);
  if (!id) return;
  const ab = getAbility(id);
  if (gap <= ab.range) tryBeginCast(world, actor, id, target);
};

export const skirmish: StateHandler = (world, actor) => {
  const target = pickTarget(world, actor);
  if (!target) {
    actor.vel = zero();
    return;
  }
  actor.stateParams.targetId = target.id;
  const gap = gapTo(actor, target);
  const band = actor.stateParams.rangeBand ?? 'well_clear';
  const [min, max] = bandToUnits(band);
  const toward = norm(sub(target.pos, actor.pos));
  const away = scale(toward, -1);

  if (actor.stateParams.skirmishSign === undefined) {
    let sign: 1 | -1 = world.rng() < 0.5 ? 1 : -1;
    const rotated = rotate(away, ((35 * Math.PI) / 180) * sign);
    if (headingHitsWall(actor.pos, rotated, 3)) sign = sign === 1 ? -1 : 1;
    actor.stateParams.skirmishSign = sign;
  }

  if (gap < min) {
    const attackPriority = (actor.stateParams.abilityPriority ?? actor.abilities).filter(
      (id) => getAbility(id).kind === 'attack',
    );
    const id = readyAbility(actor, attackPriority, gap);
    // Opportunity shot while creating space: stop briefly when a bolt is ready
    // and we are still outside enemy reach, otherwise keep fleeing.
    if (id && gap > 1.5 && !actor.casting) {
      actor.vel = zero();
      tryBeginCast(world, actor, id, target);
    } else {
      applyMove(world, actor, skirmishFleeIntent(world, actor, away));
    }
  } else if (gap > max) {
    applyMove(world, actor, toward);
  } else {
    // In band: stand still and cast (movement cancels wind-up). Full ability
    // priority — utilities like Glyph of Slowing must fire when Jev puts them
    // first. While nothing is ready and the enemy closes through the lower half,
    // drift back.
    const priority = actor.stateParams.abilityPriority ?? actor.abilities;
    const id = readyAbility(actor, priority, gap);
    const mid = (min + max) / 2;
    if (id) {
      actor.vel = zero();
      tryBeginCast(world, actor, id, target);
    } else if (gap < mid && isClosing(actor, target) && !actor.casting) {
      applyMove(world, actor, skirmishFleeIntent(world, actor, away));
    } else {
      actor.vel = zero();
    }
  }
};

function isClosing(self: Actor, enemy: Actor): boolean {
  const towardSelf = sub(self.pos, enemy.pos);
  return towardSelf.x * enemy.vel.x + towardSelf.y * enemy.vel.y > 0.5;
}

export const retreat: StateHandler = (world, actor) => {
  const hs = hostiles(world, actor);
  if (hs.length === 0) {
    actor.vel = zero();
    return;
  }
  let away = zero();
  for (const h of hs) {
    away = { x: away.x + (actor.pos.x - h.pos.x), y: away.y + (actor.pos.y - h.pos.y) };
  }
  applyMove(world, actor, norm(away));
  const nearest = nearestHostile(world, actor);
  if (nearest && gapTo(actor, nearest) > 10) {
    actor.state = 'hold_and_shoot';
    actor.lastStateChangeTick = world.tick;
  }
};

export const handlers: Record<StateId, StateHandler> = {
  close_and_attack: closeAndAttack,
  hold_and_shoot: holdAndShoot,
  skirmish,
  retreat,
};
