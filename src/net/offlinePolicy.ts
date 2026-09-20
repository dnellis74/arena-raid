import { roleDefaults } from '../sim/actor.ts';
import type { AbilityId, Actor, RangeBandId, StateId } from '../sim/types.ts';
import { prependAbility } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { nearestHostile, recordDecision } from '../sim/world.ts';
import type { DecideDigest } from './digest.ts';
import { buildDigest } from './digest.ts';
import {
  BAND_FOR_BEHAVIOR,
  matchAbilityKeyword,
  matchOrderBehavior,
  matchPartyConditional,
  partyHasConditional,
} from './orderIntent.ts';

export interface OfflineDecision {
  state: StateId;
  rangeBand: RangeBandId;
  ability: AbilityId | null;
  probabilities: Record<string, number>;
  confidence: number;
}

/**
 * Deterministic role-default policy used when the backend is down,
 * and as the baseline for headless Case A.
 */
export function offlineDecide(actor: Actor, digest: DecideDigest): OfflineDecision {
  const defaults = roleDefaults(actor.kind);

  const direct = (digest.orders?.given_directly_to_this_character ?? '').toLowerCase();
  const party = (digest.orders?.given_to_the_whole_party ?? '').toLowerCase();
  const order = direct || party;

  let state = defaults.state;
  let rangeBand = defaults.band ?? 'well_clear';

  // Party "when healthy … / when hurt …" — use digest condition when no direct order.
  if (!direct && partyHasConditional(party)) {
    const conditional = matchPartyConditional(party, digest.character.condition);
    if (conditional) {
      state = conditional.state;
      rangeBand = (conditional.band as RangeBandId) ?? rangeBand;
    }
  } else {
    const matched = matchOrderBehavior(order);
    if (matched) {
      state = matched;
      rangeBand = (BAND_FOR_BEHAVIOR[matched] as RangeBandId) ?? rangeBand;
    }
  }

  // Contact soft nudge (AI digests only — player digests omit how_close)
  if (
    digest.enemy.how_close === 'within reach' &&
    state === 'hold_and_shoot' &&
    /distance|skirmish|kite|away/.test(order)
  ) {
    state = 'skirmish';
  }

  const ready = defaults.abilityPriority.filter(
    (id) => (actor.cooldowns[id] ?? 0) <= 0,
  );
  let ability: AbilityId | null = matchAbilityKeyword(order, ready);
  if (!ability) {
    ability = ready[0] ?? null;
  }

  const probabilities: Record<string, number> = {
    hold_and_shoot: 0.1,
    close_and_attack: 0.1,
    skirmish: 0.1,
    retreat: 0.1,
  };
  probabilities[state] = 0.7;

  return {
    state,
    rangeBand: rangeBand as RangeBandId,
    ability,
    probabilities,
    confidence: 0.85,
  };
}

/** Apply offlineDecide and record — shared by live degraded path and headless. */
export function applyOfflineDecision(world: World, actor: Actor): void {
  const digest = buildDigest(world, actor);
  const d = offlineDecide(actor, digest);
  const entry = {
    tick: world.tick,
    actorId: actor.id,
    state: d.state,
    params: {
      rangeBand: d.rangeBand,
      abilityPriority: prependAbility(actor.stateParams.abilityPriority, d.ability),
      targetId: nearestHostile(world, actor)?.id,
    },
    probabilities: d.probabilities,
    confidence: d.confidence,
    ability: d.ability ?? undefined,
    rangeBand: d.rangeBand,
    source: 'offline' as const,
  };
  if (actor.state !== entry.state) actor.stateParams.skirmishSign = undefined;
  recordDecision(world, entry);
  actor.lastDecisionTick = world.tick;
  world.degraded = true;
}
