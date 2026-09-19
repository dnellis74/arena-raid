import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { howCloseBucket } from '../src/sim/buckets.ts';
import { gapTo } from '../src/sim/world.ts';
import {
  buildGoblinClosingDigest,
  createGoblinClosingWorld,
} from './calibration/situation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  HERE,
  'calibration/fixtures/situation.goblin-closing.json',
);

describe('goblin-closing digest fixture lock', () => {
  it('positions Case A so the goblin is a short run away', () => {
    const { world, player } = createGoblinClosingWorld();
    const goblin = world.actors.find((a) => a.side === 'enemy')!;
    expect(howCloseBucket(gapTo(player, goblin))).toBe('a short run away');
  });

  it('buildDigest still matches situation.goblin-closing.json exactly', () => {
    const expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const actual = buildGoblinClosingDigest();
    expect(actual).toEqual(expected);
  });
});
