import { getAbility } from './actor.ts';
import type { AbilityId, Actor, Vec2 } from './types.ts';
import type { World } from './world.ts';
import { allies, gapTo, getActor, pushFloating } from './world.ts';
import { add, dist, norm, scale, sub } from './vec.ts';
import { clampToArena } from './buckets.ts';

/** Edge-to-point reach for ground placement (point has no radius). */
function groundReach(caster: Actor, point: Vec2): number {
  return dist(caster.pos, point) - caster.radius;
}

/** Ground range gate: prefer gap-to-actor when placing on a target's feet. */
function groundOutOfRange(
  caster: Actor,
  point: Vec2,
  target: Actor | null | undefined,
  range: number,
  slack: number,
): boolean {
  if (target && target.alive) {
    return gapTo(caster, target) > range + slack;
  }
  return groundReach(caster, point) > range + slack;
}

export function tryBeginCast(
  world: World,
  actor: Actor,
  abilityId: AbilityId,
  target: Actor | null,
  point?: Vec2,
): boolean {
  if (!actor.alive || actor.casting) return false;
  if ((actor.cooldowns[abilityId] ?? 0) > 0) return false;
  const ab = getAbility(abilityId);
  if (ab.delivery === 'ground') {
    const p = point ?? (target ? target.pos : undefined);
    if (!p) return false;
    if (groundOutOfRange(actor, p, target, ab.range, 0.05)) return false;
  } else if (target && ab.delivery !== 'self') {
    if (gapTo(actor, target) > ab.range + 0.05) return false;
  }

  actor.cooldowns[abilityId] = ab.cooldown;
  if (ab.windup <= 0) {
    resolveAbility(world, actor, abilityId, target?.id, point);
    return true;
  }
  actor.casting = {
    abilityId,
    targetId: target?.id,
    point: point ? { ...point } : target ? { ...target.pos } : undefined,
    remaining: ab.windup,
    total: ab.windup,
  };
  actor.vel = { x: 0, y: 0 };
  return true;
}

export function tickCasting(world: World, actor: Actor, dt: number): void {
  if (!actor.casting) return;
  if (Math.hypot(actor.vel.x, actor.vel.y) > 0.01) {
    actor.casting = null;
    return;
  }
  actor.casting.remaining -= dt;
  if (actor.casting.remaining > 0) return;
  const { abilityId, targetId, point } = actor.casting;
  actor.casting = null;
  resolveAbility(world, actor, abilityId, targetId, point);
}

export function resolveAbility(
  world: World,
  caster: Actor,
  abilityId: AbilityId,
  targetId?: string,
  point?: Vec2,
): void {
  const ab = getAbility(abilityId);
  const target = targetId ? getActor(world, targetId) : null;

  if (ab.delivery === 'melee' || ab.delivery === 'ranged') {
    if (!target || !target.alive) return;
    if (gapTo(caster, target) > ab.range + 0.15) return;
    applyDamage(world, caster, target, ab.damage ?? 0);
    if (ab.healing && ab.id === 'mending_lash') {
      const ally = lowestHpAlly(world, caster);
      if (ally) applyHeal(world, ally, ab.healing);
    }
  }

  if (ab.delivery === 'ally' && target && target.alive) {
    if (gapTo(caster, target) > ab.range + 0.15) return;
    if (ab.healing) applyHeal(world, target, ab.healing);
    if (ab.id === 'cleanse') {
      target.statuses = target.statuses.filter((s) => s.type !== 'debuff');
    }
  }

  if (ab.delivery === 'ground') {
    const p = point ?? target?.pos;
    if (!p) return;
    if (groundOutOfRange(caster, p, target, ab.range, 0.15)) return;
    for (const fx of ab.effects ?? []) {
      if (fx.type === 'slow_zone') {
        world.groundEffects.push({
          id: `g${world.nextGroundId++}`,
          kind: 'slow_zone',
          pos: { ...p },
          radius: ab.radius ?? 3,
          factor: fx.factor,
          remaining: fx.duration,
          ownerId: caster.id,
        });
      }
    }
  }

  if (ab.delivery === 'self') {
    for (const fx of ab.effects ?? []) {
      if (fx.type === 'damage_reduction') {
        applyAura(world, caster, 'damage_reduction', fx.duration, fx.factor, fx.radius ?? 0);
      } else if (fx.type === 'damage_up') {
        applyAura(world, caster, 'damage_up', fx.duration, fx.factor, fx.radius ?? 0);
      } else if (fx.type === 'dodge_window') {
        caster.dodgeUntil = world.time + fx.duration;
      } else if (fx.type === 'dash') {
        const t = caster.stateParams.targetId
          ? getActor(world, caster.stateParams.targetId)
          : null;
        const dir = t ? norm(sub(t.pos, caster.pos)) : { x: 0, y: -1 };
        caster.pos = clampToArena(
          add(caster.pos, scale(dir, Math.min(fx.range, ab.range))),
          caster.radius,
          world.encounter.arenaW,
          world.encounter.arenaH,
        );
      }
    }
  }

  for (const fx of ab.effects ?? []) {
    if (fx.type === 'force_retarget' && target && target.alive) {
      target.forceRetargetTo = caster.id;
      target.forceRetargetUntil = world.time + fx.duration;
      pushFloating(world, target.pos, 'taunt', '#93c5fd');
    }
    if (fx.type === 'damage_taken_up' && target && target.alive) {
      target.statuses = target.statuses.filter((s) => s.type !== 'damage_taken_up');
      target.statuses.push({
        type: 'damage_taken_up',
        remaining: fx.duration,
        factor: fx.factor,
        sourceId: caster.id,
      });
      pushFloating(world, target.pos, 'mark', '#c084fc');
    }
  }
}

function lowestHpAlly(world: World, caster: Actor): Actor | null {
  const list = [caster, ...allies(world, caster)];
  let best = list[0]!;
  for (const a of list) {
    if (a.hp / a.hpMax < best.hp / best.hpMax) best = a;
  }
  return best;
}

function applyAura(
  world: World,
  caster: Actor,
  type: string,
  duration: number,
  factor: number,
  radius: number,
): void {
  const targets = [caster, ...allies(world, caster)].filter(
    (a) => a.id === caster.id || dist(a.pos, caster.pos) <= radius + 0.01,
  );
  const label = type === 'damage_reduction' ? 'ward' : type === 'damage_up' ? 'shout' : type;
  const color = type === 'damage_reduction' ? '#93c5fd' : '#fbbf24';
  for (const t of targets) {
    t.statuses = t.statuses.filter(
      (s) => !(s.type === type && s.sourceId === caster.id),
    );
    t.statuses.push({ type, remaining: duration, factor, sourceId: caster.id });
    pushFloating(world, t.pos, label, color);
  }
}

export function applyDamage(
  world: World,
  source: Actor,
  target: Actor,
  raw: number,
): void {
  if (!target.alive || raw <= 0) return;
  if (world.time < target.dodgeUntil) {
    pushFloating(world, target.pos, 'miss', '#94a3b8');
    target.dodgeUntil = 0;
    return;
  }
  let dmg = raw;
  const up = source.statuses.find((s) => s.type === 'damage_up');
  if (up?.factor) dmg *= 1 + up.factor;
  const taken = target.statuses.find((s) => s.type === 'damage_taken_up');
  if (taken?.factor) dmg *= 1 + taken.factor;
  const red = target.statuses.find((s) => s.type === 'damage_reduction');
  if (red?.factor) dmg *= red.factor;

  dmg = Math.round(dmg * 100) / 100;
  target.hp = Math.max(0, target.hp - dmg);
  pushFloating(world, target.pos, `-${dmg}`, '#f87171');
  if (target.hp <= 0) {
    target.alive = false;
    target.casting = null;
    target.vel = { x: 0, y: 0 };
  }
}

export function applyHeal(world: World, target: Actor, amount: number): void {
  if (!target.alive) return;
  target.hp = Math.min(target.hpMax, target.hp + amount);
  pushFloating(world, target.pos, `+${amount}`, '#4ade80');
}
