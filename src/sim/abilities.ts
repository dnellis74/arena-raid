import { getAbility } from './actor.ts';
import type { AbilityId, Actor, Vec2 } from './types.ts';
import type { World } from './world.ts';
import { allies, gapTo, getActor, pushFloating } from './world.ts';
import { add, dist, norm, scale, sub } from './vec.ts';
import { clampToArena } from './buckets.ts';
import { pushCombatLog } from './combatLog.ts';

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
  if (ab.delivery === 'ally') {
    if (!target || !target.alive || target.side !== actor.side) return false;
    if (gapTo(actor, target) > ab.range + 0.05) return false;
  } else if (ab.delivery === 'ground') {
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
    if (!target || !target.alive) {
      pushCombatLog(world, `${caster.name} uses ${ab.name} but the target is gone`);
      return;
    }
    if (gapTo(caster, target) > ab.range + 0.15) {
      pushCombatLog(
        world,
        `${caster.name} uses ${ab.name} on ${target.name} but is out of range`,
      );
      return;
    }
    const multi = ab.effects?.find((fx) => fx.type === 'multi_hit');
    if (multi && multi.type === 'multi_hit') {
      scheduleMultiHit(world, caster, target, multi.hits, multi.perHit, multi.span, ab.name);
    } else {
      const actor = caster.name;
      const abn = ab.name;
      const tgt = target.name;
      let line = `${actor} uses ${abn} on ${tgt}`;
      if ((ab.damage ?? 0) > 0) {
        const hit = applyDamage(world, caster, target, ab.damage ?? 0);
        if (hit.kind === 'miss') {
          line += ` but ${tgt} dodges`;
        } else if (hit.kind === 'hit') {
          line += ` for ${hit.amount} damage`;
        }
      }
      for (const fx of ab.effects ?? []) {
        if (fx.type === 'force_retarget') line += ', taunting them';
        if (fx.type === 'damage_taken_up') line += ', marking them';
      }
      pushCombatLog(world, line);
    }
    if (ab.healing && ab.id === 'mending_lash') {
      const ally = lowestHpAlly(world, caster);
      if (ally) {
        const healed = applyHeal(world, ally, ab.healing);
        if (healed > 0) {
          pushCombatLog(world, `${ab.name} heals ${ally.name} for ${healed}`);
        }
      }
    }
  }

  if (ab.delivery === 'ally') {
    if (!target || !target.alive || target.side !== caster.side) {
      pushCombatLog(world, `${caster.name} uses ${ab.name} but has no valid ally`);
      return;
    }
    if (gapTo(caster, target) > ab.range + 0.15) {
      pushCombatLog(
        world,
        `${caster.name} uses ${ab.name} on ${target.name} but is out of range`,
      );
      return;
    }
    const parts: string[] = [`${caster.name} uses ${ab.name} on ${target.name}`];
    if (ab.healing) {
      const healed = applyHeal(world, target, ab.healing);
      if (healed > 0) parts.push(`healing ${healed}`);
    }
    if (ab.id === 'cleanse') {
      const idx = target.statuses.findIndex((s) => s.type === 'debuff');
      if (idx >= 0) {
        target.statuses.splice(idx, 1);
        parts.push('removing a debuff');
      }
    }
    pushCombatLog(world, parts.join(', '));
  }

  if (ab.delivery === 'ground') {
    const p = point ?? target?.pos;
    if (!p) {
      pushCombatLog(world, `${caster.name} uses ${ab.name} but has nowhere to place it`);
      return;
    }
    if (groundOutOfRange(caster, p, target, ab.range, 0.15)) {
      pushCombatLog(world, `${caster.name} uses ${ab.name} but is out of range`);
      return;
    }
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
    const on = target ? ` at ${target.name}'s feet` : '';
    pushCombatLog(world, `${caster.name} uses ${ab.name}${on}`);
  }

  if (ab.delivery === 'self') {
    const results: string[] = [];
    for (const fx of ab.effects ?? []) {
      if (fx.type === 'damage_reduction') {
        applyAura(world, caster, 'damage_reduction', fx.duration, fx.factor, fx.radius ?? 0);
        results.push('gaining a bulwark');
      } else if (fx.type === 'damage_up') {
        applyAura(world, caster, 'damage_up', fx.duration, fx.factor, fx.radius ?? 0);
        results.push('rallying with a shout');
      } else if (fx.type === 'dodge_window') {
        caster.dodgeUntil = world.time + fx.duration;
        pushFloating(world, caster.pos, 'feint', '#fca5a5');
        results.push('preparing to dodge');
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
        pushFloating(world, caster.pos, 'dash', '#fca5a5');
        results.push(t ? `dashing toward ${t.name}` : 'dashing');
      }
    }
    pushCombatLog(
      world,
      results.length
        ? `${caster.name} uses ${ab.name}, ${results.join(' and ')}`
        : `${caster.name} uses ${ab.name}`,
    );
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

export type DamageResult =
  | { kind: 'hit'; amount: number }
  | { kind: 'miss' }
  | { kind: 'none' };

/** Schedule multi-hit strikes evenly over `span` (first hit immediate). */
function scheduleMultiHit(
  world: World,
  source: Actor,
  target: Actor,
  hits: number,
  perHit: number,
  span: number,
  abilityName: string,
): void {
  const n = Math.max(1, hits);
  const step = n <= 1 ? 0 : span / (n - 1);
  pushCombatLog(world, `${source.name} uses ${abilityName} on ${target.name}`);
  for (let i = 0; i < n; i++) {
    const resolveAt = world.time + i * step;
    if (i === 0) {
      const hit = applyDamage(world, source, target, perHit);
      logStrikeResult(world, abilityName, target, hit);
    } else {
      world.pendingStrikes.push({
        resolveAt,
        sourceId: source.id,
        targetId: target.id,
        damage: perHit,
        abilityName,
      });
    }
  }
}

function logStrikeResult(
  world: World,
  abilityName: string,
  target: Actor,
  hit: DamageResult,
): void {
  if (hit.kind === 'miss') {
    pushCombatLog(world, `${abilityName} misses ${target.name}`);
  } else if (hit.kind === 'hit') {
    pushCombatLog(world, `${abilityName} hits ${target.name} for ${hit.amount}`);
  }
}

/** Resolve any pending multi-hit strikes due at or before world.time. */
export function tickPendingStrikes(world: World): void {
  if (world.pendingStrikes.length === 0) return;
  const due: typeof world.pendingStrikes = [];
  const later: typeof world.pendingStrikes = [];
  for (const s of world.pendingStrikes) {
    if (s.resolveAt <= world.time + 1e-9) due.push(s);
    else later.push(s);
  }
  world.pendingStrikes = later;
  for (const s of due) {
    const source = getActor(world, s.sourceId);
    const target = getActor(world, s.targetId);
    if (!source?.alive || !target?.alive) continue;
    const hit = applyDamage(world, source, target, s.damage);
    if (s.abilityName) logStrikeResult(world, s.abilityName, target, hit);
  }
}

/**
 * Automatic Feint: if a Duelist has Feint ready and a nearby enemy attack is
 * about to land, dodge. Spec §7 — timing reaction owned by code, not Jev.
 */
export function tickFeintReaction(world: World): void {
  for (const actor of world.actors) {
    if (!actor.alive || !actor.abilities.includes('feint')) continue;
    if ((actor.cooldowns.feint ?? 0) > 0) continue;
    if (world.time < actor.dodgeUntil) continue;
    if (actor.casting) continue;
    const enemy = world.actors.find(
      (a) =>
        a.alive &&
        a.side !== actor.side &&
        a.casting !== null &&
        getAbility(a.casting.abilityId).kind === 'attack',
    );
    if (!enemy || !enemy.casting) continue;
    const ab = getAbility(enemy.casting.abilityId);
    if (gapTo(actor, enemy) > ab.range + 0.5) continue;
    // React in the last quarter-second of their windup.
    if (enemy.casting.remaining > 0.25) continue;
    tryBeginCast(world, actor, 'feint', null);
  }
}

/** Lowest HP-fraction living ally including self. Used by Mending Lash splash heal. */
export function lowestHpAlly(world: World, caster: Actor): Actor | null {
  const list = [caster, ...allies(world, caster)].filter((a) => a.alive);
  if (list.length === 0) return null;
  let best = list[0]!;
  for (const a of list) {
    if (a.hp / a.hpMax < best.hp / best.hpMax) best = a;
  }
  return best;
}

/** Ally-delivery heal target: lowest HP-fraction living ally (incl. self) in range. */
export function pickHealTarget(
  world: World,
  caster: Actor,
  range: number,
): Actor | null {
  const list = [caster, ...allies(world, caster)].filter(
    (a) => a.alive && gapTo(caster, a) <= range + 0.05,
  );
  if (list.length === 0) return null;
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
): DamageResult {
  if (!target.alive || raw <= 0) return { kind: 'none' };
  if (world.time < target.dodgeUntil) {
    pushFloating(world, target.pos, 'miss', '#94a3b8');
    target.dodgeUntil = 0;
    return { kind: 'miss' };
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
  return { kind: 'hit', amount: dmg };
}

export function applyHeal(world: World, target: Actor, amount: number): number {
  if (!target.alive || amount <= 0) return 0;
  const before = target.hp;
  target.hp = Math.min(target.hpMax, target.hp + amount);
  const healed = Math.round((target.hp - before) * 100) / 100;
  if (healed > 0) pushFloating(world, target.pos, `+${healed}`, '#4ade80');
  return healed;
}
