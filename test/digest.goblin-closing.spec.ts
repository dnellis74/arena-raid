import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { howCloseBucket } from '../src/sim/buckets.ts';
import { gapTo } from '../src/sim/world.ts';
import {
  buildGoblinClosingDigest,
  CLOSING_PLAYER_KINDS,
  createGoblinClosingWorld,
  fixturePathFor,
  type ClosingPlayerKind,
} from './calibration/situation.ts';

function loadFixture(kind: ClosingPlayerKind): unknown {
  return JSON.parse(readFileSync(fixturePathFor(kind), 'utf8'));
}

describe('goblin-closing digest fixture lock', () => {
  it.each(CLOSING_PLAYER_KINDS)(
    '%s positions Case A so the goblin is a short run away',
    (kind) => {
      const { world, player } = createGoblinClosingWorld(1, kind);
      const goblin = world.actors.find((a) => a.side === 'enemy')!;
      expect(player.kind).toBe(kind);
      expect(howCloseBucket(gapTo(player, goblin))).toBe('a short run away');
    },
  );

  it.each(CLOSING_PLAYER_KINDS)(
    'buildDigest still matches the %s goblin-closing fixture exactly',
    (kind) => {
      expect(buildGoblinClosingDigest(1, kind)).toEqual(loadFixture(kind));
    },
  );
});
