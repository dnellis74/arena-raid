import { roleDefaults } from '../sim/actor.ts';
import type { AbilityId, Actor, RangeBandId, StateId } from '../sim/types.ts';
import type { DecideDigest } from './digest.ts';

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

  // Lightweight order heuristic so Case B works headless without Jev
  const direct = (digest.orders?.given_directly_to_this_character ?? '').toLowerCase();
  const party = (digest.orders?.given_to_the_whole_party ?? '').toLowerCase();
  // Character order wins when present; otherwise party order.
  const order = direct || party;

  let state = defaults.state;
  let rangeBand = defaults.band ?? 'well_clear';

  // Party "when healthy … / when hurt …" — use digest condition when no direct order.
  if (!direct && /when (healthy|hurt)/.test(party)) {
    const hurt =
      digest.character.condition === 'bloodied' ||
      digest.character.condition === 'badly hurt' ||
      digest.character.condition === "at death's door";
    if (hurt && /when hurt.*kite|kite/.test(party)) {
      state = 'skirmish';
      rangeBand = 'well_clear';
    } else if (!hurt && /when healthy.*(stand|fight|hold)|stand and fight/.test(party)) {
      state = 'hold_and_shoot';
      rangeBand = 'well_clear';
    }
  } else if (/skirmish|keep (your |the )?distance|kite|stay (back|away)|back away|don't (get )?close|do not (get )?close/.test(order)) {
    state = 'skirmish';
    rangeBand = 'well_clear';
  } else if (/retreat|run away|flee|get out/.test(order)) {
    state = 'retreat';
    rangeBand = 'disengaged';
  } else if (/close|melee|charge|rush|walk (straight )?at|fight up close/.test(order)) {
    state = 'close_and_attack';
    rangeBand = 'contact';
  } else if (/hold|stand still|stay put|shoot|don't move|do not move|stand and fight/.test(order)) {
    state = 'hold_and_shoot';
    rangeBand = 'well_clear';
  }

  // Contact soft nudge (AI digests only — player digests omit how_close)
  if (
    digest.enemy.how_close === 'within reach' &&
    state === 'hold_and_shoot' &&
    /distance|skirmish|kite|away/.test(order)
  ) {
    state = 'skirmish';
  }

  // Prefer the strong utility when the order asks for it; otherwise first ready.
  let ability: AbilityId | null = null;
  if (/slow|glyph|hamper|impede/.test(order)) {
    const glyph = defaults.abilityPriority.find(
      (id) => id === 'glyph_of_slowing' && (actor.cooldowns[id] ?? 0) <= 0,
    );
    if (glyph) ability = glyph;
  }
  if (!ability) {
    ability =
      defaults.abilityPriority.find((id) => (actor.cooldowns[id] ?? 0) <= 0) ?? null;
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
