import { actorUsesDecide } from '../sim/actor.ts';
import type { Actor } from '../sim/types.ts';
import { DT } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { stepWorld } from '../sim/step.ts';
import { BASE_INTERVAL_S, HARD_FLOOR_S } from './decide.ts';
import { applyOfflineDecision } from './offlinePolicy.ts';
import { collectDecideTriggers } from './triggers.ts';

/** Synchronous offline decide for headless sim / tests. */
export function decideOfflineSync(world: World, actor: Actor): void {
  if (!actorUsesDecide(actor)) return;
  applyOfflineDecision(world, actor);
}

export function tickOfflineDecisions(world: World): void {
  if (world.matchOver) return;
  const deciding = world.actors.filter((a) => a.alive && actorUsesDecide(a));
  const intervalTicks = Math.round(BASE_INTERVAL_S / DT);

  for (let i = 0; i < deciding.length; i++) {
    const actor = deciding[i]!;
    let floorOk = (world.tick - actor.lastDecisionTick) * DT >= HARD_FLOOR_S;
    if (floorOk && collectDecideTriggers(world, actor).length > 0) {
      decideOfflineSync(world, actor);
      floorOk = false; // already decided this tick
    }

    const offset = Math.round((i * (BASE_INTERVAL_S / Math.max(1, deciding.length))) / DT);
    const onCadence =
      actor.lastDecisionTick < 0 ||
      (world.tick >= offset && (world.tick - offset) % intervalTicks === 0);

    if (onCadence && floorOk) decideOfflineSync(world, actor);
  }
}

/** Run a full headless fight with offline decisions only. */
export function runHeadlessOffline(
  world: World,
  maxSeconds = 60,
  onTick?: (world: World) => void,
): World {
  for (const a of world.actors) {
    if (a.alive && actorUsesDecide(a)) decideOfflineSync(world, a);
  }
  const maxTicks = Math.ceil(maxSeconds / DT);
  for (let i = 0; i < maxTicks && !world.matchOver; i++) {
    tickOfflineDecisions(world);
    stepWorld(world, DT);
    onTick?.(world);
  }
  return world;
}
