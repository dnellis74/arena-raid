import { describe, expect, it } from 'vitest';
import { applyDamage, tryBeginCast } from '../src/sim/abilities.ts';
import { getAbility } from '../src/sim/actor.ts';
import { len } from '../src/sim/vec.ts';
import { DT } from '../src/sim/types.ts';
import { stepWorld, runTicks } from '../src/sim/step.ts';
import { createReferenceFight } from '../src/sim/world.ts';
import { gapTo } from '../src/sim/world.ts';
import { applySyntheticAnswers } from '../src/net/decide.ts';
import { offlineDecide } from '../src/net/offlinePolicy.ts';
import { buildDigest } from '../src/net/digest.ts';

function settleCast(world: ReturnType<typeof createReferenceFight>, ticks = 30): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, DT);
}

describe('Glyph of Slowing', () => {
  it('matches spec: ground, range 7, radius 3, factor 0.6, duration 4, cd 10, windup 0.4', () => {
    const ab = getAbility('glyph_of_slowing');
    expect(ab.kind).toBe('utility');
    expect(ab.delivery).toBe('ground');
    expect(ab.range).toBe(7);
    expect(ab.radius).toBe(3);
    expect(ab.cooldown).toBe(10);
    expect(ab.windup).toBe(0.4);
    expect(ab.effects).toEqual([{ type: 'slow_zone', factor: 0.6, duration: 4 }]);
  });

  it('places a slow zone at the target and applies 60% move speed to enemies inside', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    p.vel = { x: 0, y: 0 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';

    expect(tryBeginCast(w, p, 'glyph_of_slowing', g)).toBe(true);
    settleCast(w);

    expect(w.groundEffects).toHaveLength(1);
    const zone = w.groundEffects[0]!;
    expect(zone.kind).toBe('slow_zone');
    expect(zone.radius).toBe(3);
    expect(zone.factor).toBe(0.6);
    expect(zone.remaining).toBeGreaterThan(3.5);
    expect(zone.remaining).toBeLessThanOrEqual(4);
    expect(zone.pos).toEqual({ x: 8, y: 15 });

    g.pos = { ...zone.pos };
    g.state = 'close_and_attack';
    p.state = 'retreat';
    const speeds: number[] = [];
    for (let i = 0; i < 45; i++) {
      stepWorld(w, DT);
      speeds.push(len(g.vel));
    }
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(avg).toBeGreaterThan(1.8);
    expect(avg).toBeLessThan(2.5); // 3.6 * 0.6 = 2.16
    expect(g.statuses.some((s) => s.type === 'slow' && s.factor === 0.6)).toBe(true);
  });

  it('does not slow the caster standing in their own glyph', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 14 };
    p.vel = { x: 0, y: 0 };
    expect(tryBeginCast(w, p, 'glyph_of_slowing', g)).toBe(true);
    settleCast(w);
    p.pos = { ...w.groundEffects[0]!.pos };
    stepWorld(w, DT);
    expect(p.statuses.some((s) => s.type === 'slow')).toBe(false);
  });

  it('resolves at gap ≈ 7 (does not burn CD without placing)', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    p.pos = { x: 8, y: 10 };
    // gap 6.9 → center dist 7.9; old center-distance check falsely failed resolve
    g.pos = { x: 8, y: 10 + 6.9 + 1.0 };
    expect(gapTo(p, g)).toBeCloseTo(6.9, 5);
    p.vel = { x: 0, y: 0 };
    expect(tryBeginCast(w, p, 'glyph_of_slowing', g)).toBe(true);
    settleCast(w);
    expect(w.groundEffects).toHaveLength(1);
  });

  it('fires during skirmish when ability Choice puts it first', () => {
    const w = createReferenceFight(42);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 17 }; // gap 6, inside well_clear
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';

    applySyntheticAnswers(w, p, {
      behavior: 'skirmish',
      rangeBand: 'well_clear',
      ability: 'glyph_of_slowing',
      confidence: 0.95,
    });
    expect(p.stateParams.abilityPriority![0]).toBe('glyph_of_slowing');

    runTicks(w, 60);
    expect(w.groundEffects.length).toBeGreaterThan(0);
    expect(p.cooldowns.glyph_of_slowing).toBeGreaterThan(0);
  });

  it('fires during hold_and_shoot when prioritized', () => {
    const w = createReferenceFight(42);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    g.vel = { x: 0, y: 0 };
    g.state = 'hold_and_shoot';

    applySyntheticAnswers(w, p, {
      behavior: 'hold_and_shoot',
      ability: 'glyph_of_slowing',
      confidence: 0.95,
    });
    runTicks(w, 45);
    expect(w.groundEffects.length).toBeGreaterThan(0);
  });
});

describe('Arcane Mark (weak utility companion)', () => {
  it('applies +10% damage taken for 5s', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    p.pos = { x: 8, y: 10 };
    g.pos = { x: 8, y: 15 };
    p.vel = { x: 0, y: 0 };
    expect(tryBeginCast(w, p, 'arcane_mark', g)).toBe(true);
    settleCast(w, 20);
    const mark = g.statuses.find((s) => s.type === 'damage_taken_up');
    expect(mark?.factor).toBe(0.1);
    expect(mark!.remaining).toBeGreaterThan(4.5);

    const before = g.hp;
    applyDamage(w, p, g, 2);
    expect(before - g.hp).toBeCloseTo(2.2, 5);
  });
});

describe('offline ability preference for Glyph', () => {
  it('prioritizes glyph when the standing order asks to slow', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    p.standingOrder = 'drop a slowing glyph and keep shooting';
    const d = offlineDecide(p, buildDigest(w, p));
    expect(d.ability).toBe('glyph_of_slowing');
  });
});
