import { actorUsesDecide } from '../sim/actor.ts';
import { buildDigest, worstIncomingHit } from './digest.ts';
import { offlineDecide } from './offlinePolicy.ts';
import type { Actor, DecisionEntry } from '../sim/types.ts';
import { DT } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { nearestHostile, recordDecision } from '../sim/world.ts';
import { stepWorld } from '../sim/step.ts';
import {
  conditionOf,
  howCloseBucket,
  survivableHitsCount,
  type ConditionLabel,
} from '../sim/buckets.ts';
import { gapTo } from '../sim/world.ts';
import triggers from '../data/triggers.json';
import { BASE_INTERVAL_S, HARD_FLOOR_S } from './decide.ts';

/** Synchronous offline decide for headless sim / tests. */
export function decideOfflineSync(world: World, actor: Actor): void {
  if (!actorUsesDecide(actor)) return;
  const digest = buildDigest(world, actor);
  const d = offlineDecide(actor, digest);
  const entry: DecisionEntry = {
    tick: world.tick,
    actorId: actor.id,
    state: d.state,
    params: {
      rangeBand: d.rangeBand,
      abilityPriority: d.ability
        ? [d.ability, ...(actor.stateParams.abilityPriority ?? []).filter((x) => x !== d.ability)]
        : actor.stateParams.abilityPriority,
      targetId: nearestHostile(world, actor)?.id,
    },
    probabilities: d.probabilities,
    confidence: d.confidence,
    ability: d.ability ?? undefined,
    rangeBand: d.rangeBand,
    source: 'offline',
  };
  if (actor.state !== entry.state) actor.stateParams.skirmishSign = undefined;
  recordDecision(world, entry);
  actor.lastDecisionTick = world.tick;
  world.degraded = true;
}

export function tickOfflineDecisions(world: World): void {
  if (world.matchOver) return;
  const deciding = world.actors.filter((a) => a.alive && actorUsesDecide(a));
  const intervalTicks = Math.round(BASE_INTERVAL_S / DT);

  for (let i = 0; i < deciding.length; i++) {
    const actor = deciding[i]!;
    evaluateTriggersSync(world, actor);

    const offset = Math.round((i * (BASE_INTERVAL_S / Math.max(1, deciding.length))) / DT);
    const floorOk = (world.tick - actor.lastDecisionTick) * DT >= HARD_FLOOR_S;
    const onCadence =
      actor.lastDecisionTick < 0 ||
      (world.tick >= offset && (world.tick - offset) % intervalTicks === 0);

    if (onCadence && floorOk) decideOfflineSync(world, actor);
  }
}

function evaluateTriggersSync(world: World, actor: Actor): void {
  if (!actorUsesDecide(actor)) return;
  const trig = (
    triggers as Record<
      string,
      { retreatOnHealthFraction: number; requestOnContactWhileHolding: boolean }
    >
  )[actor.kind];
  if (!trig) return;
  const enemy = nearestHostile(world, actor);
  const floorOk = (world.tick - actor.lastDecisionTick) * DT >= HARD_FLOOR_S;

  const condition = conditionOf(
    actor.hp,
    actor.hpMax,
    actor.lastCondition as ConditionLabel | null,
  );
  const hits = survivableHitsCount(actor.hp, worstIncomingHit(world, actor));

  if (hits === 1 && world.encounter.allowedStates.includes('retreat') && floorOk) {
    decideOfflineSync(world, actor);
  }

  if (condition !== actor.lastCondition || hits !== actor.lastSurvivableHits) {
    actor.lastCondition = condition;
    actor.lastSurvivableHits = hits;
    if (floorOk) decideOfflineSync(world, actor);
  }

  if (!enemy) return;
  const gap = gapTo(actor, enemy);
  const close = howCloseBucket(gap);

  if (close !== actor.lastHowCloseBucket) {
    actor.lastHowCloseBucket = close;
    if (floorOk) decideOfflineSync(world, actor);
  }
  if (
    trig.requestOnContactWhileHolding &&
    actor.state === 'hold_and_shoot' &&
    gap <= 1.4 &&
    floorOk
  ) {
    decideOfflineSync(world, actor);
  }
}

/** Run a full headless fight with offline decisions only. */
export function runHeadlessOffline(
  world: World,
  maxSeconds = 60,
  onTick?: (world: World) => void,
): World {
  // Initial decisions (player units only — fixed-role enemies use spawn defaults)
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
