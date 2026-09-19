import type { StateId } from '../../src/sim/types.ts';

export type CalibrationTier = 1 | 2 | 'N';

export interface CalibrationCase {
  tier: CalibrationTier;
  id: string;
  order: string;
  /** Tier 1 positives expect skirmish; negatives set required; tier 2 observed only. */
  required?: StateId;
  probe?: string;
}

/** Default repeat counts. `--repeats=N` overrides both. */
export const DEFAULT_REPEATS = {
  tier1: 3,
  negative: 3,
  tier2: 1,
} as const;

export const CALIBRATION_CASES: CalibrationCase[] = [
  // Tier 1 — must produce skirmish
  { tier: 1, id: '1', order: 'skirmish', required: 'skirmish' },
  { tier: 1, id: '2', order: 'stay away', required: 'skirmish' },
  {
    tier: 1,
    id: '3',
    order: 'keep your distance and keep shooting',
    required: 'skirmish',
  },
  {
    tier: 1,
    id: '4',
    order: 'back away from it while you attack',
    required: 'skirmish',
  },
  {
    tier: 1,
    id: '5',
    order: "never let it get within arm's reach, shoot it from a distance",
    required: 'skirmish',
  },

  // Tier 2 — observed, never fails the run
  {
    tier: 2,
    id: '6',
    order: "don't let the goblin get close",
    probe: 'Negation / "close" collision with close_and_attack',
  },
  { tier: 2, id: '7', order: 'kite it', probe: 'Game jargon' },
  { tier: 2, id: '8', order: 'hit and run', probe: 'Idiom' },
  {
    tier: 2,
    id: '9',
    order: "you're squishy, act like it",
    probe: 'Indirect inference from character statement',
  },
  {
    tier: 2,
    id: '10',
    order: 'stay out of trouble but keep the pressure on',
    probe: 'Two clauses pulling apart',
  },

  // Tier 1 negatives — must NOT produce skirmish
  {
    tier: 'N',
    id: 'N1',
    order: 'get in its face and hit it',
    required: 'close_and_attack',
  },
  {
    tier: 'N',
    id: 'N2',
    order: "run, don't fight",
    required: 'retreat',
  },
];
