import orderIntent from '../data/orderIntent.json' with { type: 'json' };
import type { AbilityId, StateId } from '../sim/types.ts';

/**
 * Map standing / party order text to a preferred behavior.
 * Shared by offlinePolicy (Actor path) and offlineProxyAnswers (digest stub).
 */
export function matchOrderBehavior(order: string): StateId | null {
  const o = order.toLowerCase();
  if (!o.trim()) return null;
  for (const row of orderIntent.behaviorPatterns) {
    if (new RegExp(row.pattern).test(o)) return row.state as StateId;
  }
  return null;
}

/** Prefer a key if present in the Choice criteria set. */
export function preferKey(keys: string[], id: string): string | null {
  return keys.includes(id) ? id : null;
}

/** Default range band for a resolved behavior (stub / offline alignment). */
export const BAND_FOR_BEHAVIOR: Record<StateId, string> = {
  hold_and_shoot: orderIntent.bandForBehavior.hold_and_shoot,
  close_and_attack: orderIntent.bandForBehavior.close_and_attack,
  skirmish: orderIntent.bandForBehavior.skirmish,
  retreat: orderIntent.bandForBehavior.retreat,
};

export interface PartyConditionalMatch {
  state: StateId;
  band: string;
}

/** True when the party order uses the healthy/hurt when-clause form. */
export function partyHasConditional(party: string): boolean {
  return new RegExp(orderIntent.partyConditional.whenClause).test(party);
}

/**
 * Party "when healthy … / when hurt …" rules from orderIntent.json.
 * Returns null when no rule fires (caller should keep role defaults).
 */
export function matchPartyConditional(
  party: string,
  condition: string | undefined,
): PartyConditionalMatch | null {
  const pc = orderIntent.partyConditional;
  const hurt = pc.hurtConditions.includes(condition ?? '');
  const rules = hurt ? pc.hurtRules : pc.healthyRules;
  for (const rule of rules) {
    if (new RegExp(rule.pattern).test(party)) {
      return { state: rule.state as StateId, band: rule.band };
    }
  }
  return null;
}

/** First ability keyword match whose abilityId is ready in `candidates`. */
export function matchAbilityKeyword(
  order: string,
  candidates: AbilityId[],
): AbilityId | null {
  const o = order.toLowerCase();
  for (const row of orderIntent.abilityKeywords) {
    if (!new RegExp(row.pattern).test(o)) continue;
    if (candidates.includes(row.abilityId as AbilityId)) {
      return row.abilityId as AbilityId;
    }
  }
  return null;
}
