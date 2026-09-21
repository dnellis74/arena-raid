import { describe, expect, it } from 'vitest';
import digestBuckets from '../src/data/digestBuckets.json' with { type: 'json' };
import type { DecideDigest } from '../src/net/digest.ts';
import { offlineDecide } from '../src/net/offlinePolicy.ts';
import { buildQuestions, type GoldenCase } from '../src/net/questions.ts';
import { createActor } from '../src/sim/actor.ts';
import type { StateId } from '../src/sim/types.ts';

const SH = digestBuckets.survivableHitsPhrases;
const HF = digestBuckets.hitsToFinishPhrases;

function baseDigest(over: Partial<DecideDigest> = {}): DecideDigest {
  return {
    character: {
      role: 'a spellcaster who attacks from a distance and is weak in close combat',
      condition: 'untouched',
      survivable_hits: SH.default,
      current_behavior: 'standing still and shooting',
      ready_abilities: ['Arc Bolt: a weak attack that can be fired from a long way off'],
      unavailable_abilities: [],
      room_to_back_away: 'open',
      ...over.character,
    },
    orders: over.orders,
    enemy: {
      kind: 'goblin',
      condition: 'untouched',
      hits_to_finish: HF.default,
      how_close: 'a long way off',
      moving_toward_the_character: true,
      reach: 'can only attack from close enough to touch',
      about_to_attack: false,
      ...over.enemy,
    },
  };
}

function actorWithOrders(standing: string | null, party: string | null) {
  const a = createActor({
    id: 'p1',
    side: 'player',
    kind: 'arcanist',
    pos: { x: 8, y: 4 },
    standingOrder: standing,
    partyOrder: party,
  });
  return a;
}

function expectBehavior(c: GoldenCase): void {
  const digest = baseDigest({
    ...c.situation,
    orders: {
      ...(c.standingOrder
        ? { given_directly_to_this_character: c.standingOrder }
        : {}),
      ...(c.partyOrder ? { given_to_the_whole_party: c.partyOrder } : {}),
    },
  });
  const a = actorWithOrders(c.standingOrder, c.partyOrder);
  const d = offlineDecide(a, digest);
  expect(d.state, c.id).toBe(c.expectedBehavior);
}

/**
 * Golden order + situation → expected behavior.
 * Uses offlinePolicy heuristics as a stand-in for Jev in CI without an API key.
 * Criteria wording still lives in questions.ts / states.json for live calls.
 */
const cases: GoldenCase[] = [
  {
    id: 'distance-shoot',
    standingOrder: 'keep your distance and shoot',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'kite',
    standingOrder: 'kite the goblin, stay away',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'hold-line',
    standingOrder: 'hold your ground and shoot',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  {
    id: 'stand-still',
    standingOrder: 'stand still and blast anything in range',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  {
    id: 'charge',
    standingOrder: 'charge in and fight up close',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'close_and_attack',
  },
  {
    id: 'melee-rush',
    standingOrder: 'walk straight at it and melee',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'close_and_attack',
  },
  {
    id: 'flee',
    standingOrder: 'run away, do not attack',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'retreat',
  },
  {
    id: 'retreat-wounded',
    standingOrder: 'retreat if you must',
    partyOrder: null,
    situation: {
      character: {
        condition: "at death's door",
        survivable_hits: SH['1'],
      } as DecideDigest['character'],
    },
    expectedBehavior: 'retreat',
  },
  {
    id: 'back-away',
    standingOrder: 'back away while attacking',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'dont-get-close',
    standingOrder: "don't get close — shoot from afar",
    partyOrder: null,
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'default-empty',
    standingOrder: null,
    partyOrder: null,
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  {
    id: 'arcanist-standing-healthy',
    standingOrder: 'when healthy stand and fight\nwhen hurt kite',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  {
    id: 'arcanist-standing-hurt',
    standingOrder: 'when healthy stand and fight\nwhen hurt kite',
    partyOrder: null,
    situation: { character: { condition: 'bloodied' } } as GoldenCase['situation'],
    expectedBehavior: 'skirmish',
  },
  {
    id: 'vanguard-standing-close',
    standingOrder: 'close in and keep hitting. hold them on you.',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'close_and_attack',
  },
  {
    id: 'warden-standing-hold',
    standingOrder: 'hold mid range and keep allies healed',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  {
    id: 'duelist-standing-skirmish',
    standingOrder: 'dash in for a flurry then slip away. keep skirmishing',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'party-only-skirmish',
    standingOrder: null,
    partyOrder: 'everyone keep distance and kite',
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'party-only-hold',
    standingOrder: null,
    partyOrder: 'hold position and shoot',
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  // Actor vs party conflicts — actor order wins in offline heuristic via field precedence
  {
    id: 'conflict-actor-skirmish-party-charge',
    standingOrder: 'keep your distance and shoot',
    partyOrder: 'everyone charge and fight up close',
    situation: {},
    expectedBehavior: 'skirmish',
  },
  {
    id: 'conflict-actor-charge-party-kite',
    standingOrder: 'charge the enemy',
    partyOrder: 'keep your distance and kite',
    situation: {},
    expectedBehavior: 'close_and_attack',
  },
  {
    id: 'conflict-actor-hold-party-flee',
    standingOrder: 'stand still and shoot',
    partyOrder: 'run away',
    situation: {},
    expectedBehavior: 'hold_and_shoot',
  },
  {
    id: 'contact-with-kite-order',
    standingOrder: 'keep your distance',
    partyOrder: null,
    situation: {
      enemy: {
        kind: 'goblin',
        condition: 'untouched',
        hits_to_finish: HF.default,
        how_close: 'within reach',
        moving_toward_the_character: true,
        reach: 'can only attack from close enough to touch',
        about_to_attack: true,
      },
    },
    expectedBehavior: 'skirmish',
  },
  {
    id: 'stay-away',
    standingOrder: 'stay back and pepper it with bolts',
    partyOrder: null,
    situation: {},
    expectedBehavior: 'skirmish',
  },
];

describe('questions golden cases (offline policy stand-in)', () => {
  for (const c of cases) {
    it(c.id, () => expectBehavior(c));
  }

  it('has at least three actor-versus-party conflicts', () => {
    const conflicts = cases.filter(
      (c) => c.standingOrder && c.partyOrder && c.standingOrder !== c.partyOrder,
    );
    expect(conflicts.length).toBeGreaterThanOrEqual(3);
  });

  it('covers all four behaviors', () => {
    const seen = new Set(cases.map((c) => c.expectedBehavior));
    for (const s of ['hold_and_shoot', 'close_and_attack', 'skirmish', 'retreat'] as StateId[]) {
      expect(seen.has(s)).toBe(true);
    }
  });
});

describe('player vs AI question payloads', () => {
  const allowed: StateId[] = [
    'hold_and_shoot',
    'close_and_attack',
    'skirmish',
    'retreat',
  ];

  it('player questions omit in_trouble and quote the standing order text', () => {
    const order = 'keep your distance and shoot';
    const a = actorWithOrders(order, null);
    const digest = baseDigest({
      orders: { given_directly_to_this_character: order },
    });
    const q = buildQuestions(a, allowed, digest);
    expect(q.in_trouble).toBeUndefined();
    expect(q.behavior?.type).toBe('choice');
    if (q.behavior?.type === 'choice') {
      expect(q.behavior.instructions).toMatch(/authoritative/i);
      expect(q.behavior.instructions).toContain(order);
    }
    if (q.range_band?.type === 'choice') {
      expect(q.range_band.instructions).toContain(order);
    }
  });

  it('enemy questions keep in_trouble danger noul', () => {
    const a = createActor({
      id: 'e1',
      side: 'enemy',
      kind: 'goblin',
      pos: { x: 8, y: 20 },
      standingOrder: 'close and kill',
    });
    const q = buildQuestions(a, allowed, baseDigest());
    expect(q.in_trouble).toEqual({
      type: 'noul',
      instructions: 'The character is in immediate danger of being hit by the enemy.',
    });
  });
});

describe('offline proxy answers (no API key stub)', () => {
  const behaviorCriteria = Object.fromEntries(
    (['hold_and_shoot', 'close_and_attack', 'skirmish', 'retreat'] as StateId[]).map((s) => [
      s,
      s,
    ]),
  );

  it('does not pin goblin to hold_and_shoot', async () => {
    const { offlineProxyAnswers } = await import('../src/net/offlineProxyAnswers.ts');
    const out = offlineProxyAnswers(
      {
        behavior: { type: 'choice', criteria: behaviorCriteria },
        range_band: {
          type: 'choice',
          criteria: { contact: 'c', well_clear: 'w', just_clear: 'j', disengaged: 'd' },
        },
      },
      {
        character: {
          role: 'a melee attacker that charges the nearest enemy and never backs off',
          current_behavior: 'walking at the enemy to fight up close',
        },
        orders: {
          given_directly_to_this_character:
            'Charge the nearest enemy and keep hitting it. Never back off.',
        },
      },
    );
    const behavior = out.answers.behavior as { choice: string };
    expect(behavior.choice).toBe('close_and_attack');
    expect(out.degraded).toBe(true);
    expect(out.degradedReason).toBe('no_TYPESAFE_API_KEY');
  });

  it('keeps arcanist on hold when no order', async () => {
    const { offlineProxyAnswers } = await import('../src/net/offlineProxyAnswers.ts');
    const out = offlineProxyAnswers(
      { behavior: { type: 'choice', criteria: behaviorCriteria } },
      {
        character: {
          role: 'a spellcaster who attacks from a distance and is weak in close combat',
          current_behavior: 'standing still and shooting',
        },
      },
    );
    const behavior = out.answers.behavior as { choice: string };
    expect(behavior.choice).toBe('hold_and_shoot');
  });
});
