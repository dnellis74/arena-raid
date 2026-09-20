/**
 * Live Jev skirmish calibration — NOT a unit test.
 * Invoked via: npm run calibrate:skirmish
 * Requires TYPESAFE_API_KEY. Never run from vitest / CI watch.
 */
import { applyBehaviorDecision } from '../../src/net/decide.ts';
import type { DecideDigest } from '../../src/net/digest.ts';
import { createJevClient } from '../../src/net/jev.ts';
import { buildDecideQuestions } from '../../src/net/questions.ts';
import type { StateId } from '../../src/sim/types.ts';
import {
  CALIBRATION_CASES,
  DEFAULT_REPEATS,
  type CalibrationCase,
} from './cases.ts';
import { printSummary, printTable, writeSnapshot, type RunRow } from './report.ts';
import {
  ALLOWED_STATES,
  killDevServer,
  loadGoblinClosingFixture,
  parseRepeats,
  requireApiKey,
} from './runner.ts';
import { createGoblinClosingWorld } from './situation.ts';

function repeatsFor(c: CalibrationCase, override: number | null): number {
  if (override !== null) return override;
  if (c.tier === 2) return DEFAULT_REPEATS.tier2;
  if (c.tier === 'N') return DEFAULT_REPEATS.negative;
  return DEFAULT_REPEATS.tier1;
}

function grade(c: CalibrationCase, resolved: StateId): RunRow['result'] {
  if (c.tier === 2) return 'observed';
  if (c.required && resolved === c.required) return 'PASS';
  return 'FAIL';
}

async function main(): Promise<void> {
  killDevServer();
  const apiKey = requireApiKey('calibrate:skirmish');
  const repeatsOverride = parseRepeats(process.argv.slice(2));
  const fixtureBase = loadGoblinClosingFixture();
  const { player } = createGoblinClosingWorld();
  const jev = createJevClient(apiKey);

  const rows: RunRow[] = [];

  for (const c of CALIBRATION_CASES) {
    const n = repeatsFor(c, repeatsOverride);
    for (let i = 0; i < n; i++) {
      const state: DecideDigest = {
        ...fixtureBase,
        character: { ...fixtureBase.character },
        enemy: { ...fixtureBase.enemy },
        orders: { given_directly_to_this_character: c.order },
      };
      player.standingOrder = c.order;
      player.partyOrder = null;
      player.state = 'hold_and_shoot';

      const questions = buildDecideQuestions(player, state, ALLOWED_STATES);
      const response = await jev.ask(state, questions);
      const behavior = response.answers.behavior;
      if (!behavior || behavior.type !== 'choice') {
        throw new Error(`case ${c.id}: missing behavior choice answer`);
      }

      const resolved = applyBehaviorDecision({
        current: 'hold_and_shoot',
        answers: response.answers,
        allowedStates: ALLOWED_STATES,
      }).state;

      const choice = behavior.choice as StateId;
      rows.push({
        tier: c.tier,
        id: c.id,
        order: c.order,
        picked: resolved,
        choice,
        pSkirmish: behavior.probabilities.skirmish ?? 0,
        confidence: behavior.confidence,
        probabilities: behavior.probabilities,
        resolved,
        result: grade(c, resolved),
        repeatIndex: i,
      });
    }
  }

  printTable(rows);
  const summary = printSummary(rows);
  writeSnapshot(rows, summary);

  const failed = rows.some(
    (r) => (r.tier === 1 || r.tier === 'N') && r.result === 'FAIL',
  );
  if (failed) {
    console.error('Calibration failed: tier 1 or negative control failure.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
