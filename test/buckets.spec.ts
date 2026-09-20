import { describe, expect, it } from 'vitest';
import digestBuckets from '../src/data/digestBuckets.json' with { type: 'json' };
import {
  CONDITION_BANDS,
  conditionFromFraction,
  conditionOf,
  hitsToFinishCount,
  hitsToFinishPhrase,
  survivableHitsCount,
  survivableHitsPhrase,
  type ConditionLabel,
} from '../src/sim/buckets.ts';
import { createReferenceFight } from '../src/sim/world.ts';
import { buildDigest, worstIncomingHit } from '../src/net/digest.ts';
import { createActor } from '../src/sim/actor.ts';

const SH = digestBuckets.survivableHitsPhrases;
const HF = digestBuckets.hitsToFinishPhrases;

describe('condition bands (open-loop boundaries)', () => {
  it('classifies both sides of every enterAbove threshold', () => {
    // untouched: > 0.85
    expect(conditionFromFraction(0.85001)).toBe('untouched');
    expect(conditionFromFraction(0.85)).toBe('scratched');
    // scratched: > 0.60
    expect(conditionFromFraction(0.60001)).toBe('scratched');
    expect(conditionFromFraction(0.6)).toBe('bloodied');
    // bloodied: > 0.35
    expect(conditionFromFraction(0.35001)).toBe('bloodied');
    expect(conditionFromFraction(0.35)).toBe('badly hurt');
    // badly hurt: > 0.15
    expect(conditionFromFraction(0.15001)).toBe('badly hurt');
    expect(conditionFromFraction(0.15)).toBe("at death's door");
    expect(conditionFromFraction(0)).toBe("at death's door");
  });

  it('maps hp/hpMax via conditionOf(null previous) at exact integer thresholds', () => {
    expect(conditionOf(100, 100, null)).toBe('untouched');
    expect(conditionOf(86, 100, null)).toBe('untouched');
    expect(conditionOf(85, 100, null)).toBe('scratched');
    expect(conditionOf(61, 100, null)).toBe('scratched');
    expect(conditionOf(60, 100, null)).toBe('bloodied');
    expect(conditionOf(36, 100, null)).toBe('bloodied');
    expect(conditionOf(35, 100, null)).toBe('badly hurt');
    expect(conditionOf(16, 100, null)).toBe('badly hurt');
    expect(conditionOf(15, 100, null)).toBe("at death's door");
    expect(conditionOf(1, 100, null)).toBe("at death's door");
  });
});

describe('condition hysteresis (Schmitt trigger)', () => {
  it('rising vs falling disagree inside the 4-point gap, agree outside', () => {
    // Gap between untouched exitBelow 0.81 and enterAbove 0.85
    const inside = 0.83;
    expect(conditionOf(inside * 100, 100, 'untouched')).toBe('untouched');
    expect(conditionOf(inside * 100, 100, 'scratched')).toBe('scratched');

    const above = 0.9;
    expect(conditionOf(above * 100, 100, 'untouched')).toBe('untouched');
    expect(conditionOf(above * 100, 100, 'scratched')).toBe('untouched');

    const below = 0.7;
    expect(conditionOf(below * 100, 100, 'untouched')).toBe('scratched');
    expect(conditionOf(below * 100, 100, 'scratched')).toBe('scratched');
  });

  it('applies the same rising/falling split at each band gap', () => {
    const gaps: Array<{
      high: ConditionLabel;
      low: ConditionLabel;
      inside: number;
      enterAbove: number;
      exitBelow: number;
    }> = [
      { high: 'untouched', low: 'scratched', inside: 0.83, enterAbove: 0.85, exitBelow: 0.81 },
      { high: 'scratched', low: 'bloodied', inside: 0.58, enterAbove: 0.6, exitBelow: 0.56 },
      { high: 'bloodied', low: 'badly hurt', inside: 0.33, enterAbove: 0.35, exitBelow: 0.31 },
      { high: 'badly hurt', low: "at death's door", inside: 0.13, enterAbove: 0.15, exitBelow: 0.11 },
    ];
    for (const g of gaps) {
      expect(conditionOf(g.inside * 100, 100, g.high), `${g.high}@${g.inside}`).toBe(g.high);
      expect(conditionOf(g.inside * 100, 100, g.low), `${g.low}@${g.inside}`).toBe(g.low);
      expect(conditionOf((g.enterAbove + 0.01) * 100, 100, g.low)).toBe(g.high);
      expect(conditionOf((g.exitBelow - 0.01) * 100, 100, g.high)).toBe(g.low);
    }
  });

  it('exports CONDITION_BANDS matching the amendment table', () => {
    expect(CONDITION_BANDS.map((b) => b.label)).toEqual([
      'untouched',
      'scratched',
      'bloodied',
      'badly hurt',
      "at death's door",
    ]);
  });
});

describe('survivable_hits', () => {
  it('phrases 1, 2, 3, and 4+', () => {
    expect(survivableHitsPhrase(1)).toBe(SH['1']);
    expect(survivableHitsPhrase(2)).toBe(SH['2']);
    expect(survivableHitsPhrase(3)).toBe(SH['3']);
    expect(survivableHitsPhrase(4)).toBe(SH.default);
    expect(survivableHitsPhrase(10)).toBe(SH.default);
  });

  it('uses ceil at exact multiples of incoming damage', () => {
    expect(survivableHitsCount(12, 6)).toBe(2);
    expect(survivableHitsCount(13, 6)).toBe(3);
    expect(survivableHitsCount(6, 6)).toBe(1);
    expect(survivableHitsCount(1, 6)).toBe(1);
  });

  it('omits when no living hostile damage (no div by zero)', () => {
    expect(survivableHitsCount(24, null)).toBeNull();
    expect(survivableHitsCount(24, 0)).toBeNull();
  });

  it('worstIncomingHit is highest hostile on the field, not current target only', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    // Spawn a second, stronger hostile farther away (not nearest)
    const brute = createActor({
      id: 'e2',
      side: 'enemy',
      kind: 'goblin',
      pos: { x: 8, y: 22 },
    });
    // Give brute a higher-damage ability slot by overwriting ability list damage path:
    // goblin only has rusty_cleaver (6). Add a synthetic high-damage ability id if present,
    // otherwise bump via a second goblin that we patch damage through abilities array —
    // use duelist flurry (9) by changing kind... simpler: patch abilities on brute.
    brute.abilities = ['flurry'];
    brute.cooldowns = { flurry: 0 };
    w.actors.push(brute);

    // Nearest is still the first goblin (cleaver 6); worst on field is flurry 9
    expect(worstIncomingHit(w, p)).toBe(9);
    expect(survivableHitsCount(p.hp, worstIncomingHit(w, p))).toBe(Math.ceil(p.hp / 9));
    expect(g.abilities).toContain('rusty_cleaver');
  });

  it('dead-hostiles-only omits survivable_hits', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    g.alive = false;
    g.hp = 0;
    expect(worstIncomingHit(w, p)).toBeNull();
    const digest = buildDigest(w, p);
    expect(digest.character.survivable_hits).toBeUndefined();
  });
});

describe('hits_to_finish', () => {
  it('phrases 1, 2, 3, and 4+', () => {
    expect(hitsToFinishPhrase(1)).toBe(HF['1']);
    expect(hitsToFinishPhrase(2)).toBe(HF['2']);
    expect(hitsToFinishPhrase(3)).toBe(HF['3']);
    expect(hitsToFinishPhrase(4)).toBe(HF.default);
  });

  it('ceils enemy hp over best ready attack', () => {
    expect(hitsToFinishCount(20, 2)).toBe(10);
    expect(hitsToFinishCount(4, 2)).toBe(2);
    expect(hitsToFinishCount(2, 2)).toBe(1);
    expect(hitsToFinishCount(20, null)).toBeNull();
  });
});

describe('Arcanist @ 8 HP vs Goblin', () => {
  it('is bloodied with two-hit survivable phrase (cleaver 6)', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    p.hp = 8;
    p.lastCondition = 'bloodied'; // avoid hysteresis surprise from untouched
    const digest = buildDigest(w, p);
    expect(p.hpMax).toBe(24);
    expect(worstIncomingHit(w, p)).toBe(6);
    expect(survivableHitsCount(8, 6)).toBe(2);
    expect(digest.character.condition).toBe('bloodied');
    expect(digest.character.survivable_hits).toBe(SH['2']);
  });
});
