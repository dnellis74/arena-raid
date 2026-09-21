/**
 * Shared helpers for live calibration scripts (not unit tests).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DecideDigest } from '../../src/net/digest.ts';
import type { StateId } from '../../src/sim/types.ts';
import {
  CLOSING_PLAYER_KINDS,
  fixturePathFor,
  type ClosingPlayerKind,
} from './situation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CALIBRATION_DIR = HERE;
export const FIXTURE_PATH = join(HERE, 'fixtures/situation.goblin-closing.json');
export const CALIBRATION_CLASSES: ClosingPlayerKind[] = [...CLOSING_PLAYER_KINDS];

export const ALLOWED_STATES: StateId[] = [
  'skirmish',
  'close_and_attack',
  'hold_and_shoot',
  'retreat',
];

export function killDevServer(): void {
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

export function requireApiKey(scriptName: string): string {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) {
    console.error(
      `TYPESAFE_API_KEY is missing. Export it (or load via --env-file=.env) before running ${scriptName}.`,
    );
    process.exit(1);
  }
  return key;
}

export function parseRepeats(argv: string[]): number | null {
  for (const arg of argv) {
    const m = arg.match(/^--repeats=(\d+)$/);
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseClasses(argv: string[]): ClosingPlayerKind[] {
  for (const arg of argv) {
    const m = arg.match(/^--class=(.+)$/);
    if (m) {
      const kind = m[1] as ClosingPlayerKind;
      if (!CALIBRATION_CLASSES.includes(kind)) {
        console.error(
          `Unknown --class=${m[1]}. Use ${CALIBRATION_CLASSES.join('|')}.`,
        );
        process.exit(1);
      }
      return [kind];
    }
  }
  return [...CALIBRATION_CLASSES];
}

export function loadGoblinClosingFixture(
  kind: ClosingPlayerKind = 'arcanist',
): DecideDigest {
  return JSON.parse(readFileSync(fixturePathFor(kind), 'utf8')) as DecideDigest;
}
