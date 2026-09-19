/**
 * Degraded /api/decide stub answers when TYPESAFE_API_KEY is missing.
 * Must NOT blindly prefer hold_and_shoot — that pins melee enemies idle.
 */

export type ProxyQuestion =
  | { type: 'choice'; criteria?: Record<string, unknown> }
  | { type: 'noul'; criteria?: Record<string, unknown> }
  | { type: string; criteria?: Record<string, unknown> };

export interface ProxyDigest {
  character?: {
    role?: string;
    current_behavior?: string;
  };
  orders?: {
    given_directly_to_this_character?: string;
    given_to_the_whole_party?: string;
  };
}

const BEHAVIOR_FROM_LABEL: Record<string, string> = {
  'standing still and shooting': 'hold_and_shoot',
  'walking at the enemy to fight up close': 'close_and_attack',
  'keeping distance while attacking': 'skirmish',
  'running away': 'retreat',
};

const BAND_FOR_BEHAVIOR: Record<string, string> = {
  hold_and_shoot: 'well_clear',
  close_and_attack: 'contact',
  skirmish: 'well_clear',
  retreat: 'disengaged',
};

/** Order / role heuristics mirroring offlinePolicy (digest-only, no Actor). */
export function pickBehaviorKey(keys: string[], state?: ProxyDigest): string {
  const order = (
    state?.orders?.given_directly_to_this_character ??
    state?.orders?.given_to_the_whole_party ??
    ''
  ).toLowerCase();

  const prefer = (id: string) => (keys.includes(id) ? id : null);

  if (/skirmish|keep (your |the )?distance|kite|stay (back|away)|back away|don't (get )?close|do not (get )?close/.test(order)) {
    return prefer('skirmish') ?? keys[0]!;
  }
  if (/retreat|run away|flee|get out/.test(order)) {
    return prefer('retreat') ?? keys[0]!;
  }
  if (/close|melee|charge|rush|walk (straight )?at|fight up close|keep hitting|never back/.test(order)) {
    return prefer('close_and_attack') ?? keys[0]!;
  }
  if (/hold|stand still|stay put|shoot|don't move|do not move/.test(order)) {
    return prefer('hold_and_shoot') ?? keys[0]!;
  }

  const role = (state?.character?.role ?? '').toLowerCase();
  if (/melee|charges|front-line|dashes in/.test(role)) {
    return prefer('close_and_attack') ?? prefer('skirmish') ?? keys[0]!;
  }
  if (/spellcaster|distance|mid range|support/.test(role)) {
    return prefer('hold_and_shoot') ?? keys[0]!;
  }
  if (/striker|slips away/.test(role)) {
    return prefer('skirmish') ?? keys[0]!;
  }

  const fromLabel = state?.character?.current_behavior
    ? BEHAVIOR_FROM_LABEL[state.character.current_behavior]
    : undefined;
  if (fromLabel && keys.includes(fromLabel)) return fromLabel;

  return keys[0]!;
}

function pickBandKey(keys: string[], behavior: string | undefined): string {
  const want = behavior ? BAND_FOR_BEHAVIOR[behavior] : undefined;
  if (want && keys.includes(want)) return want;
  if (keys.includes('contact')) return 'contact';
  if (keys.includes('well_clear')) return 'well_clear';
  return keys[0]!;
}

function pickAbilityKey(keys: string[]): string {
  // Prefer melee/cleaver when present so goblin stub still attacks
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

  // Behavior first so range_band can follow
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
