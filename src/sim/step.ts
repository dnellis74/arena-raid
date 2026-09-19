import { tickCasting } from './abilities.ts';
import { clampToArena } from './buckets.ts';
import { handlers } from './states/index.ts';
import { DT } from './types.ts';
import type { Actor } from './types.ts';
import type { World } from './world.ts';
import { checkMatchOver, gapTo, nearestHostile } from './world.ts';
import { add, dist, len, norm, scale, sub } from './vec.ts';

export function stepWorld(world: World, dt = DT): void {
  if (world.matchOver) return;

  // Tick cooldowns, statuses, ground effects
  for (const actor of world.actors) {
    if (!actor.alive) continue;
    for (const id of Object.keys(actor.cooldowns)) {
      actor.cooldowns[id] = Math.max(0, (actor.cooldowns[id] ?? 0) - dt);
    }
    for (const s of actor.statuses) s.remaining -= dt;
    actor.statuses = actor.statuses.filter((s) => s.remaining > 0);

    // Apply slow from ground zones
    actor.statuses = actor.statuses.filter((s) => s.type !== 'slow');
    for (const g of world.groundEffects) {
      if (g.kind !== 'slow_zone') continue;
      if (actor.side === 'enemy' && dist(actor.pos, g.pos) <= g.radius) {
        actor.statuses.push({ type: 'slow', remaining: dt * 2, factor: g.factor });
      }
    }
  }

  for (const g of world.groundEffects) g.remaining -= dt;
  world.groundEffects = world.groundEffects.filter((g) => g.remaining > 0);

  // State machines
  for (const actor of world.actors) {
    if (!actor.alive) continue;
    handlers[actor.state](world, actor, dt);
  }

  // Integrate positions
  for (const actor of world.actors) {
    if (!actor.alive) continue;
    actor.pos = add(actor.pos, scale(actor.vel, dt));
    actor.pos = clampToArena(actor.pos, actor.radius, world.encounter.arenaW, world.encounter.arenaH);
  }

  // Collisions actor-actor
  resolveCollisions(world);

  // Casting resolve (after move so movement cancellation works)
  for (const actor of world.actors) {
    if (!actor.alive) continue;
    tickCasting(world, actor, dt);
  }

  // Floating texts
  for (const ft of world.floatingTexts) {
    ft.age += dt;
    ft.pos.y -= dt * (1 / 0.6); // rise 1u over 0.6s
  }
  world.floatingTexts = world.floatingTexts.filter((ft) => ft.age < ft.life);

  // Observed behavior tags
  for (const actor of world.actors) {
    if (!actor.alive) continue;
    actor.observedBehavior = inferObserved(actor, world);
    const n = nearestHostile(world, actor);
    if (n) {
      const g = gapTo(actor, n);
      actor.lastHowCloseBucket = actor.lastHowCloseBucket; // updated by decide layer
      void g;
    }
  }

  world.tick += 1;
  world.time += dt;
  checkMatchOver(world);
}

function resolveCollisions(world: World): void {
  const living = world.actors.filter((a) => a.alive);
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = living[i]!;
      const b = living[j]!;
      const d = dist(a.pos, b.pos);
      const minD = a.radius + b.radius;
      if (d < minD && d > 1e-9) {
        const overlap = minD - d;
        const dir = norm(sub(a.pos, b.pos));
        const push = scale(dir, overlap / 2);
        a.pos = add(a.pos, push);
        b.pos = sub(b.pos, push);
        a.pos = clampToArena(a.pos, a.radius, world.encounter.arenaW, world.encounter.arenaH);
        b.pos = clampToArena(b.pos, b.radius, world.encounter.arenaW, world.encounter.arenaH);
      } else if (d < 1e-9) {
        a.pos.x += 0.01;
      }
    }
  }
}

function inferObserved(actor: Actor, world: World): Actor['observedBehavior'] {
  const speed = len(actor.vel);
  const target = nearestHostile(world, actor);
  if (!target) return actor.state;
  const away =
    (actor.pos.x - target.pos.x) * actor.vel.x + (actor.pos.y - target.pos.y) * actor.vel.y;
  if (speed < 0.2) return actor.casting ? 'hold_and_shoot' : actor.state;
  if (away > 0.5) return actor.state === 'skirmish' ? 'skirmish' : 'retreat';
  if (away < -0.5) return 'close_and_attack';
  return actor.state;
}

/** Run N fixed steps headlessly. */
export function runTicks(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, DT);
}

/** Run until match over or max time (seconds). */
export function runUntilDone(world: World, maxSeconds = 60): void {
  const maxTicks = Math.ceil(maxSeconds / DT);
  for (let i = 0; i < maxTicks && !world.matchOver; i++) stepWorld(world, DT);
}
