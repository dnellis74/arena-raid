import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StateId } from '../../src/sim/types.ts';
import type { CalibrationTier } from './cases.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(HERE, 'snapshots');
const QUESTIONS_PATH = join(HERE, '../../src/net/questions.ts');

export interface RunRow {
  tier: CalibrationTier;
  id: string;
  order: string;
  /** Behavior after hysteresis (console "picked" column). */
  picked: StateId;
  /** Raw Choice label from Jev (snapshot only). */
  choice: StateId;
  pSkirmish: number;
  confidence: number;
  probabilities: Record<string, number>;
  resolved: StateId;
  /** PASS / FAIL for asserted cases; observed for tier 2 */
  result: 'PASS' | 'FAIL' | 'observed';
  repeatIndex: number;
}

export interface SnapshotPayload {
  generatedAt: string;
  questionsGitSha: string;
  rows: Array<{
    tier: CalibrationTier;
    id: string;
    order: string;
    repeatIndex: number;
    probabilities: Record<string, number>;
    confidence: number;
    /** Raw Choice label from Jev. */
    choice: StateId;
    /** Behavior after hysteresis (what the game adopts). */
    resolvedBehavior: StateId;
    result: RunRow['result'];
  }>;
  summary: {
    tier1Pass: string;
    negativePass: string;
    tier2SkirmishRate: string;
  };
}

export function questionsGitSha(): string {
  try {
    return execSync(`git log -1 --format=%H -- "${QUESTIONS_PATH}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function printTable(rows: RunRow[]): void {
  const header = [
    pad('tier', 5),
    pad('#', 4),
    pad('order', 52),
    pad('picked', 18),
    pad('P(skirm)', 10),
    pad('conf', 8),
    pad('result', 10),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    console.log(
      [
        pad(String(r.tier), 5),
        pad(r.id, 4),
        pad(r.order, 52),
        pad(r.picked, 18),
        pad(r.pSkirmish.toFixed(2), 10),
        pad(r.confidence.toFixed(2), 8),
        pad(r.result, 10),
      ].join(' '),
    );
  }
}

export function printSummary(rows: RunRow[]): SnapshotPayload['summary'] {
  const tier1 = rows.filter((r) => r.tier === 1);
  const negatives = rows.filter((r) => r.tier === 'N');
  const tier2 = rows.filter((r) => r.tier === 2);

  const tier1Pass = `${tier1.filter((r) => r.result === 'PASS').length}/${tier1.length}`;
  const negativePass = `${negatives.filter((r) => r.result === 'PASS').length}/${negatives.length}`;
  const tier2Skirmish = tier2.filter((r) => r.resolved === 'skirmish').length;
  const tier2SkirmishRate = `${tier2Skirmish}/${tier2.length}`;

  console.log('');
  console.log(
    `summary: tier1 ${tier1Pass}  negatives ${negativePass}  tier2 skirmish ${tier2SkirmishRate}`,
  );

  return { tier1Pass, negativePass, tier2SkirmishRate };
}

export function writeSnapshot(rows: RunRow[], summary: SnapshotPayload['summary']): string {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const payload: SnapshotPayload = {
    generatedAt,
    questionsGitSha: questionsGitSha(),
    rows: rows.map((r) => ({
      tier: r.tier,
      id: r.id,
      order: r.order,
      repeatIndex: r.repeatIndex,
      probabilities: r.probabilities,
      confidence: r.confidence,
      choice: r.choice,
      resolvedBehavior: r.resolved,
      result: r.result,
    })),
    summary,
  };
  const file = join(SNAPSHOT_DIR, `skirmish.${generatedAt}.json`);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file}`);
  return file;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}
