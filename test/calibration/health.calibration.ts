/**
 * Live Jev health-ladder calibration — NOT a unit test.
 * Invoked via: npm run calibrate:health
 * Requires TYPESAFE_API_KEY. Never run from vitest / CI watch.
 *
 * Fixes order + situation geometry; steps condition / survivable_hits
 * through five rungs. Reports P(retreat) monotonicity (soft) and compares
 * a second pass with survivable_hits omitted.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBehaviorDecision } from '../../src/net/decide.ts';
import type { DecideDigest } from '../../src/net/digest.ts';
import { createJevClient } from '../../src/net/jev.ts';
import { buildDecideQuestions } from '../../src/net/questions.ts';
import type { StateId } from '../../src/sim/types.ts';
import { createGoblinClosingWorld } from './situation.ts';
import { questionsGitSha } from './report.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'fixtures/situation.goblin-closing.json');
const SNAPSHOT_DIR = join(HERE, 'snapshots');
const ORDER = 'keep your distance and shoot';
const ALLOWED: StateId[] = [
  'skirmish',
  'close_and_attack',
  'hold_and_shoot',
  'retreat',
];

interface HealthRung {
  id: string;
  condition: string;
  survivable_hits: string;
  /** Tier-1 gate; omit for observed-only middle rungs. */
  required?: StateId;
}

const RUNGS: HealthRung[] = [
  {
    id: 'H1',
    condition: 'untouched',
    survivable_hits: 'can take several more hits',
    required: 'skirmish',
  },
  {
    id: 'H2',
    condition: 'scratched',
    survivable_hits: 'three more hits would kill this character',
  },
  {
    id: 'H3',
    condition: 'bloodied',
    survivable_hits: 'two more hits would kill this character',
  },
  {
    id: 'H4',
    condition: 'badly hurt',
    survivable_hits: 'two more hits would kill this character',
  },
  {
    id: 'H5',
    condition: "at death's door",
    survivable_hits: 'the next hit will kill this character',
    required: 'retreat',
  },
];

function killDevServer(): void {
  try {
    execSync('lsof -ti:5173 | xargs kill -9 2>/dev/null; true', {
      stdio: 'ignore',
      shell: '/bin/zsh',
    });
  } catch {
    // ignore
  }
  try {
    execSync('pkill -f "[v]ite" 2>/dev/null; true', {
      stdio: 'ignore',
      shell: '/bin/zsh',
    });
  } catch {
    // ignore
  }
}

function requireApiKey(): string {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) {
    console.error(
      'TYPESAFE_API_KEY is missing. Export it (or load via --env-file=.env) before running calibrate:health.',
    );
    process.exit(1);
  }
  return key;
}

async function askRung(
  jev: ReturnType<typeof createJevClient>,
  player: ReturnType<typeof createGoblinClosingWorld>['player'],
  base: DecideDigest,
  rung: HealthRung,
  omitSurvivable: boolean,
): Promise<{
  resolved: StateId;
  choice: StateId;
  pRetreat: number;
  confidence: number;
  probabilities: Record<string, number>;
}> {
  const { survivable_hits: _drop, ...charRest } = base.character;
  const character = omitSurvivable
    ? { ...charRest, condition: rung.condition }
    : {
        ...base.character,
        condition: rung.condition,
        survivable_hits: rung.survivable_hits,
      };

  const state: DecideDigest = {
    ...base,
    character,
    enemy: { ...base.enemy },
    orders: { given_directly_to_this_character: ORDER },
  };
  player.standingOrder = ORDER;
  player.partyOrder = null;
  player.state = 'hold_and_shoot';

  const questions = buildDecideQuestions(player, state, ALLOWED);
  const response = await jev.ask(state, questions);
  const behavior = response.answers.behavior;
  if (!behavior || behavior.type !== 'choice') {
    throw new Error(`rung ${rung.id}: missing behavior choice answer`);
  }
  const resolved = applyBehaviorDecision({
    current: 'hold_and_shoot',
    answers: response.answers,
    allowedStates: ALLOWED,
  }).state;
  return {
    resolved,
    choice: behavior.choice as StateId,
    pRetreat: behavior.probabilities.retreat ?? 0,
    confidence: behavior.confidence,
    probabilities: behavior.probabilities,
  };
}

async function main(): Promise<void> {
  killDevServer();
  const apiKey = requireApiKey();
  const fixtureBase = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as DecideDigest;
  const { player } = createGoblinClosingWorld();
  const jev = createJevClient(apiKey);

  console.log(`Health ladder — order: "${ORDER}"`);
  console.log('');

  const withHits: Array<{
    id: string;
    condition: string;
    survivable_hits: string;
    pRetreat: number;
    resolved: StateId;
    choice: StateId;
    confidence: number;
    probabilities: Record<string, number>;
    result: 'PASS' | 'FAIL' | 'observed';
  }> = [];

  for (const rung of RUNGS) {
    const ans = await askRung(jev, player, fixtureBase, rung, false);
    let result: 'PASS' | 'FAIL' | 'observed' = 'observed';
    if (rung.required) {
      result = ans.resolved === rung.required ? 'PASS' : 'FAIL';
    }
    withHits.push({
      id: rung.id,
      condition: rung.condition,
      survivable_hits: rung.survivable_hits,
      ...ans,
      result,
    });
    console.log(
      `${rung.id}  ${rung.condition.padEnd(16)}  P(retreat)=${ans.pRetreat.toFixed(2)}  resolved=${ans.resolved.padEnd(16)}  ${result}`,
    );
  }

  const pList = withHits.map((r) => r.pRetreat);
  const monotonic = pList.every((p, i) => i === 0 || p >= pList[i - 1]! - 1e-9);
  console.log('');
  console.log(`P(retreat) across rungs: [${pList.map((p) => p.toFixed(2)).join(', ')}]`);
  console.log(
    monotonic
      ? 'monotonicity: soft PASS (non-decreasing)'
      : 'monotonicity: soft REPORT — curve did not rise monotonically (not a hard fail)',
  );

  console.log('');
  console.log('--- same ladder with survivable_hits omitted ---');
  const withoutHits: number[] = [];
  for (const rung of RUNGS) {
    const ans = await askRung(jev, player, fixtureBase, rung, true);
    withoutHits.push(ans.pRetreat);
    console.log(
      `${rung.id}  ${rung.condition.padEnd(16)}  P(retreat)=${ans.pRetreat.toFixed(2)}  resolved=${ans.resolved}`,
    );
  }

  const maxDelta = Math.max(
    ...pList.map((p, i) => Math.abs(p - (withoutHits[i] ?? p))),
  );
  console.log('');
  if (maxDelta < 0.05) {
    console.log(
      `survivable_hits ablation: curve barely moved (max |ΔP|=${maxDelta.toFixed(3)}) — amendment may buy little on this order`,
    );
  } else {
    console.log(
      `survivable_hits ablation: curve moved (max |ΔP|=${maxDelta.toFixed(3)}) — lethality phrasing is influencing retreat mass`,
    );
  }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    questionsGitSha: questionsGitSha(),
    order: ORDER,
    withSurvivableHits: withHits,
    withoutSurvivableHits: RUNGS.map((r, i) => ({
      id: r.id,
      condition: r.condition,
      pRetreat: withoutHits[i],
    })),
    pRetreatWithHits: pList,
    pRetreatWithoutHits: withoutHits,
    monotonicRisingSoft: monotonic,
    maxAbsDeltaP: maxDelta,
  };
  const file = join(SNAPSHOT_DIR, `health.${generatedAt}.json`);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file}`);

  const failed = withHits.some((r) => r.result === 'FAIL');
  if (failed) {
    console.error('Calibration failed: tier-1 health rung failure.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
