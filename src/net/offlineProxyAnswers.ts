/**
 * Degraded /api/decide stub answers when TYPESAFE_API_KEY is missing.
 * Must NOT blindly prefer hold_and_shoot — that pins melee enemies idle.
 */

import { BEHAVIOR_FROM_LABEL } from '../sim/types.ts';
import {
  BAND_FOR_BEHAVIOR,
  matchOrderBehavior,
  preferKey,
} from './orderIntent.ts';

export type ProxyQuestion =
  | { type: 'choice'; criteria?: Record<string, unknown>; instructions?: string }
  | { type: 'noul'; criteria?: Record<string, unknown>; instructions?: string }
  | { type: string; criteria?: Record<string, unknown>; instructions?: string };

export interface ProxyDigest {
  character?: {
    role?: string;
    current_behavior?: string;
    condition?: string;
  };
  orders?: {
    given_directly_to_this_character?: string;
    given_to_the_whole_party?: string;
  };
}

/** Order / role heuristics mirroring offlinePolicy (digest-only, no Actor). */
export function pickBehaviorKey(keys: string[], state?: ProxyDigest): string {
  const direct = state?.orders?.given_directly_to_this_character ?? '';
  const party = state?.orders?.given_to_the_whole_party ?? '';
  const order = (direct || party).toLowerCase();

  const matched = matchOrderBehavior(order);
  if (matched) {
    return preferKey(keys, matched) ?? keys[0]!;
  }

  const role = (state?.character?.role ?? '').toLowerCase();
  if (/melee|charges|front-line|dashes in/.test(role)) {
    return preferKey(keys, 'close_and_attack') ?? preferKey(keys, 'skirmish') ?? keys[0]!;
  }
  if (/spellcaster|distance|mid range|support/.test(role)) {
    return preferKey(keys, 'hold_and_shoot') ?? keys[0]!;
  }
  if (/striker|slips away/.test(role)) {
    return preferKey(keys, 'skirmish') ?? keys[0]!;
  }

  const fromLabel = state?.character?.current_behavior
    ? BEHAVIOR_FROM_LABEL[state.character.current_behavior]
    : undefined;
  if (fromLabel && keys.includes(fromLabel)) return fromLabel;

  return keys[0]!;
}

function pickBandKey(keys: string[], behavior: string | undefined): string {
  const want = behavior
    ? BAND_FOR_BEHAVIOR[behavior as keyof typeof BAND_FOR_BEHAVIOR]
    : undefined;
  if (want && keys.includes(want)) return want;
  if (keys.includes('contact')) return 'contact';
  if (keys.includes('well_clear')) return 'well_clear';
  return keys[0]!;
}

function pickAbilityKey(keys: string[]): string {
  const melee = keys.find((k) => /cleaver|jab|bash|flurry|swing|lash/.test(k));
  return melee ?? keys[0]!;
}

export function offlineProxyAnswers(
  questions: Record<string, ProxyQuestion>,
  state?: ProxyDigest,
  opts?: { reason?: string },
): {
  model: 'offline';
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
  degraded: true;
  degradedReason: string;
} {
  const answers: Record<string, unknown> = {};
  let pickedBehavior: string | undefined;

  const behaviorQ = questions.behavior;
  if (behaviorQ?.type === 'choice' && behaviorQ.criteria) {
    const keys = Object.keys(behaviorQ.criteria);
    pickedBehavior = pickBehaviorKey(keys, state);
  }

  for (const [id, q] of Object.entries(questions)) {
    if (q.type === 'choice' && q.criteria) {
      const keys = Object.keys(q.criteria);
      let pick: string;
      if (id === 'behavior') {
        pick = pickedBehavior ?? pickBehaviorKey(keys, state);
      } else if (id === 'range_band') {
        pick = pickBandKey(keys, pickedBehavior);
      } else if (id === 'ability') {
        pick = pickAbilityKey(keys);
      } else {
        pick = keys[0]!;
      }
      const probabilities: Record<string, number> = {};
      for (const k of keys) {
        probabilities[k] = k === pick ? 0.7 : 0.3 / Math.max(1, keys.length - 1);
      }
      answers[id] = { type: 'choice', choice: pick, probabilities, confidence: 0.55 };
    } else if (q.type === 'noul') {
      answers[id] = { type: 'noul', noul: 0.3 };
    }
  }

  return {
    model: 'offline',
    answers,
    usage: { input_tokens: 0, output_tokens: 0 },
    degraded: true,
    degradedReason: opts?.reason ?? 'no_TYPESAFE_API_KEY',
  };
}
