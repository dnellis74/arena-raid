import triggers from '../data/triggers.json';
import { actorUsesDecide } from '../sim/actor.ts';
import {
  conditionOf,
  howCloseBucket,
  survivableHitsCount,
  CONTACT_GAP,
  type ConditionLabel,
} from '../sim/buckets.ts';
import type { Actor } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { gapTo, nearestHostile } from '../sim/world.ts';
import { worstIncomingHit } from './digest.ts';

export type DecideTriggerReason =
  | 'retreat_lethal'
  | 'condition_or_hits_changed'
  | 'how_close_changed'
  | 'contact_while_holding'
  | 'target_died';

/**
 * Evaluate decide-trigger conditions for one actor.
 * Callers decide whether to respect the hard floor / in-flight and how to issue.
 */
export function collectDecideTriggers(
  world: World,
  actor: Actor,
): DecideTriggerReason[] {
  if (!actorUsesDecide(actor)) return [];
  const trig = (
    triggers as Record<string, { requestOnContactWhileHolding: boolean }>
  )[actor.kind];
  if (!trig) return [];

  const reasons: DecideTriggerReason[] = [];
  const enemy = nearestHostile(world, actor);
  const condition = conditionOf(
    actor.hp,
    actor.hpMax,
    actor.lastCondition as ConditionLabel | null,
  );
  const hits = survivableHitsCount(actor.hp, worstIncomingHit(world, actor));

  if (hits === 1 && world.encounter.allowedStates.includes('retreat')) {
    // Live path also skips when already retreating; headless did not — keep live semantics.
    if (actor.state !== 'retreat') reasons.push('retreat_lethal');
  }

  if (condition !== actor.lastCondition || hits !== actor.lastSurvivableHits) {
    actor.lastCondition = condition;
    actor.lastSurvivableHits = hits;
    reasons.push('condition_or_hits_changed');
  }

  if (enemy) {
    const gap = gapTo(actor, enemy);
    const close = howCloseBucket(gap);
    if (close !== actor.lastHowCloseBucket) {
      actor.lastHowCloseBucket = close;
      reasons.push('how_close_changed');
    }
    if (
      trig.requestOnContactWhileHolding &&
      actor.state === 'hold_and_shoot' &&
      gap <= CONTACT_GAP
    ) {
      reasons.push('contact_while_holding');
    }
    if (!enemy.alive) {
      actor.stateParams.targetId = undefined;
      reasons.push('target_died');
    }
  }

  return reasons;
}
