import { describe, expect, it, vi } from 'vitest';
import classes from '../src/data/classes.json' with { type: 'json' };
import digestBuckets from '../src/data/digestBuckets.json' with { type: 'json' };
import { createReferenceFight, setPartyOrder } from '../src/sim/world.ts';
import { stepWorld, runTicks } from '../src/sim/step.ts';
import { DT } from '../src/sim/types.ts';
import { mulberry32 } from '../src/sim/rng.ts';
import { howCloseBucket, bandToUnits, roomToBackAway } from '../src/sim/buckets.ts';
import { applySyntheticAnswers, setForceOffline, requestImmediateDecision } from '../src/net/decide.ts';
import { runHeadlessOffline, decideOfflineSync, tickOfflineDecisions } from '../src/net/headless.ts';
import { buildDigest, assertDigestClean } from '../src/net/digest.ts';
import { exportDecisionLog } from '../src/replay.ts';
import { setReplayLog, clearReplay, tickDecisions } from '../src/net/decide.ts';
import {
  resolveSubmitOrderText,
  shouldResyncOrderInput,
} from '../src/ui/orderSheet.ts';

describe('buckets', () => {
  it('maps gap to how_close buckets', () => {
    expect(howCloseBucket(0)).toBe('within reach');
    expect(howCloseBucket(1.4)).toBe('within reach');
    expect(howCloseBucket(1.41)).toBe('almost within reach');
    expect(howCloseBucket(2.5)).toBe('almost within reach');
    expect(howCloseBucket(2.51)).toBe('a short run away');
    expect(howCloseBucket(9)).toBe('a long way off');
    expect(howCloseBucket(9.01)).toBe('across the arena');
  });

  it('maps band names to units', () => {
    expect(bandToUnits('contact')).toEqual([0, 1.4]);
    expect(bandToUnits('well_clear')).toEqual([5, 8]);
  });

  it('classifies room to back away', () => {
    expect(roomToBackAway({ x: 8, y: 14 }, { x: 8, y: 20 })).toBe('open');
    expect(roomToBackAway({ x: 1, y: 1 }, { x: 8, y: 8 })).toBe('cornered');
  });
});

describe('sim determinism', () => {
  it('produces identical results for same seed and decision log', () => {
    const run = (seed: number) => {
      const w = createReferenceFight(seed);
      for (const a of w.actors) decideOfflineSync(w, a);
      runTicks(w, 600);
      return w.actors.map((a) => ({
        id: a.id,
        hp: a.hp,
        x: a.pos.x,
        y: a.pos.y,
        alive: a.alive,
      }));
    };
    expect(run(42)).toEqual(run(42));
    // Same seed must match; different seeds may still coincide on short hold-only
    // runs, so only assert self-consistency here.
    expect(run(42)[0]!.hp).toBeTypeOf('number');
  });

  it('replays from a decision log identically', () => {
    const w1 = createReferenceFight(99);
    runHeadlessOffline(w1, 20);
    const log = exportDecisionLog(w1);

    const w2 = createReferenceFight(99);
    setReplayLog(log);
    const maxTicks = Math.ceil(20 / DT);
    for (let i = 0; i < maxTicks && !w2.matchOver; i++) {
      tickDecisions(w2);
      stepWorld(w2);
    }
    clearReplay();

    expect(w2.winner).toBe(w1.winner);
    expect(w2.actors.map((a) => a.hp)).toEqual(w1.actors.map((a) => a.hp));
  });
});

describe('mulberry32', () => {
  it('is deterministic', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('actors move collide attack die', () => {
  it('spawns arcanist, vanguard, warden, and two goblins and can kill', () => {
    const w = createReferenceFight(1);
    expect(w.actors).toHaveLength(5);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    const v = w.actors.find((a) => a.kind === 'vanguard')!;
    const ward = w.actors.find((a) => a.kind === 'warden')!;
    const goblins = w.actors.filter((a) => a.kind === 'goblin');
    expect(p.hp).toBe(24);
    expect(v.hp).toBe(40);
    expect(ward.hp).toBe(28);
    expect(goblins).toHaveLength(2);
    expect(goblins.every((g) => g.hp === 20)).toBe(true);

    // Force close combat
    p.state = 'close_and_attack';
    v.state = 'close_and_attack';
    ward.state = 'close_and_attack';
    p.pos = { x: 8, y: 14 };
    v.pos = { x: 9, y: 14 };
    ward.pos = { x: 7, y: 14 };
    goblins[0]!.state = 'close_and_attack';
    goblins[1]!.state = 'close_and_attack';
    goblins[0]!.pos = { x: 8, y: 15.2 };
    goblins[1]!.pos = { x: 9, y: 15.2 };
    runTicks(w, 60 * 15);
    expect(w.matchOver).toBe(true);
  });
});

describe('behaviors via synthetic answers', () => {
  it('reaches all four behaviors', () => {
    const states = ['hold_and_shoot', 'close_and_attack', 'skirmish', 'retreat'] as const;
    for (const s of states) {
      const w = createReferenceFight(7);
      const p = w.actors.find((a) => a.side === 'player')!;
      applySyntheticAnswers(w, p, {
        behavior: s,
        rangeBand: s === 'skirmish' ? 'well_clear' : 'contact',
        confidence: 0.95,
      });
      expect(p.state).toBe(s);
      runTicks(w, 30);
      expect(w.encounter.allowedStates).toContain(p.state);
    }
  });

  it('hysteresis keeps state on low confidence', () => {
    const w = createReferenceFight(7);
    const p = w.actors.find((a) => a.side === 'player')!;
    p.state = 'hold_and_shoot';
    p.lastStateChangeTick = w.tick;
    applySyntheticAnswers(w, p, {
      behavior: 'skirmish',
      confidence: 0.3,
      probabilities: {
        hold_and_shoot: 0.4,
        skirmish: 0.35,
        close_and_attack: 0.15,
        retreat: 0.1,
      },
    });
    expect(p.state).toBe('hold_and_shoot');
  });
});

describe('digest fog of war and no numbers', () => {
  it('contains no numeric coordinates or HP', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    const digest = buildDigest(w, p);
    expect(() => assertDigestClean(digest)).not.toThrow();
  });

  it('order input does not resync on focus loss (Send blur race)', () => {
    // Regression: showActor every frame used to rewrite the textarea whenever
    // document.activeElement !== input. Clicking Send blurs the field first,
    // so rAF would clobber typed text with null standingOrder before submit.
    expect(shouldResyncOrderInput('actor:p1', null)).toBe(true);
    expect(shouldResyncOrderInput('actor:p1', 'actor:p1')).toBe(false);
    expect(shouldResyncOrderInput('actor:p2', 'actor:p1')).toBe(true);
    expect(shouldResyncOrderInput('party', 'actor:p1')).toBe(true);
  });

  it('Send/blur race: typed order survives rAF sync and pointerdown latch', () => {
    // Mirrors createOrderSheet without DOM (vitest is node): select → type →
    // every-frame showActor sync → Send pointerdown → optional wipe → submit.
    const key = 'actor:p1';
    const standingOrder: string | null = null;
    let lastSyncedKey: string | null = null;
    let inputValue = '';

    // 1. Open sheet for actor with empty standingOrder
    if (shouldResyncOrderInput(key, lastSyncedKey)) {
      inputValue = standingOrder ?? '';
      lastSyncedKey = key;
    }
    expect(inputValue).toBe('');

    // 2. Type order (actor.standingOrder still null — not submitted yet)
    inputValue = 'kite and shoot';

    // 3. Frame-loop showActor/sync again — must NOT rewrite on same selection
    if (shouldResyncOrderInput(key, lastSyncedKey)) {
      inputValue = standingOrder ?? '';
      lastSyncedKey = key;
    }
    expect(inputValue).toBe('kite and shoot');

    // 4. Send pointerdown latches text; then simulate the old blur wipe
    const latch = inputValue;
    inputValue = standingOrder ?? '';
    expect(inputValue).toBe('');

    // 5. Click submit — latch must still deliver the typed order
    expect(resolveSubmitOrderText(latch, inputValue)).toBe('kite and shoot');
    expect(resolveSubmitOrderText(null, '')).toBe('');
  });

  it('player digest never contains enemy standing order', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.standingOrder = 'keep your distance and shoot';
    const digest = buildDigest(w, p);
    const json = JSON.stringify(digest);
    expect(json).not.toContain(g.standingOrder);
    expect(digest.orders?.given_directly_to_this_character).toBe('keep your distance and shoot');
  });

  it('enemy digest never contains player order', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.standingOrder = 'SECRET_PLAYER_ORDER_XYZ';
    const digest = buildDigest(w, g);
    expect(JSON.stringify(digest)).not.toContain('SECRET_PLAYER_ORDER_XYZ');
  });

  it('player digest includes condition + lethality but omits danger framing', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    p.standingOrder = 'keep your distance and shoot';
    const digest = buildDigest(w, p);
    expect(digest.character.condition).toBe('untouched');
    expect(digest.character.survivable_hits).toBe(
      digestBuckets.survivableHitsPhrases.default,
    );
    expect(digest.character.room_to_back_away).toBeUndefined();
    expect(digest.enemy.condition).toBeDefined();
    expect(digest.enemy.hits_to_finish).toBeDefined();
    expect(digest.enemy.how_close).toBeUndefined();
    expect(digest.enemy.moving_toward_the_character).toBeUndefined();
    expect(digest.enemy.about_to_attack).toBeUndefined();
    expect(digest.enemy.reach).toBeUndefined();
    expect(digest.enemy.kind).toBe('goblin');
    expect(digest.orders?.given_directly_to_this_character).toBe('keep your distance and shoot');
  });

  it('starts with a class standing order and a blank party order', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.kind === 'arcanist')!;
    expect(p.standingOrder).toBe(classes.arcanist.standingOrder);
    expect(w.partyOrder).toBeNull();
    expect(p.partyOrder).toBeNull();
    const digest = buildDigest(w, p);
    expect(digest.orders?.given_directly_to_this_character).toBe(p.standingOrder);
    expect(digest.orders?.given_to_the_whole_party).toBeUndefined();
  });

  it('includes character order only when standingOrder is set', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    p.standingOrder = 'kite and shoot';
    const digest = buildDigest(w, p);
    expect(digest.orders?.given_directly_to_this_character).toBe('kite and shoot');
    expect(digest.orders?.given_to_the_whole_party).toBeUndefined();
  });

  it('issueDecide fetch body includes state.orders after order is set (live client path)', async () => {
    const bodies: Array<{ state?: { orders?: { given_directly_to_this_character?: string } } }> =
      [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as (typeof bodies)[number]);
      return new Response(
        JSON.stringify({
          answers: {
            behavior: {
              type: 'choice',
              choice: 'skirmish',
              probabilities: { skirmish: 1 },
              confidence: 0.9,
            },
            range_band: {
              type: 'choice',
              choice: 'well_clear',
              probabilities: { well_clear: 1 },
              confidence: 0.9,
            },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      setForceOffline(false);
      const w = createReferenceFight(1);
      const p = w.actors.find((a) => a.side === 'player')!;
      // Same sequence as main.ts onSubmit for an actor order
      p.standingOrder = 'kite and shoot';
      requestImmediateDecision(w, p, { bypassFloor: true });

      await vi.waitFor(() => {
        expect(bodies.length).toBeGreaterThan(0);
      });

      const body = bodies[0]!;
      expect(body.state?.orders?.given_directly_to_this_character).toBe('kite and shoot');
      // Example state shape the Network tab should show after Send:
      // { character: {...}, orders: { given_directly_to_this_character: "kite and shoot" }, enemy: { kind: "goblin" } }
      expect(JSON.stringify(body.state)).toContain('"given_directly_to_this_character":"kite and shoot"');
    } finally {
      globalThis.fetch = origFetch;
      setForceOffline(false);
    }
  });

  it('enemy digest keeps full situational awareness with condition fields', () => {
    const w = createReferenceFight(1);
    const g = w.actors.find((a) => a.side === 'enemy')!;
    const digest = buildDigest(w, g);
    expect(digest.character.condition).toBeDefined();
    expect(digest.character.room_to_back_away).toBeDefined();
    expect(digest.enemy.condition).toBeDefined();
    expect(digest.enemy.how_close).toBeDefined();
    expect(digest.enemy.moving_toward_the_character).toBeDefined();
    expect(digest.enemy.about_to_attack).toBeDefined();
    expect(digest.enemy.reach).toBeDefined();
  });
});

describe('reference fight', () => {
  it('Case A: hold_and_shoot with no orders loses', () => {
    const w = createReferenceFight(42, { players: ['arcanist'], enemies: 1 });
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.standingOrder = null;
    setPartyOrder(w, null); // isolate role-default hold (default party would kite when hurt)
    p.state = 'hold_and_shoot';
    g.state = 'close_and_attack';
    runHeadlessOffline(w, 30);
    expect(w.winner).toBe('enemy');
    expect(g.hp / g.hpMax).toBeGreaterThanOrEqual(0.25);
    expect(g.hp / g.hpMax).toBeLessThanOrEqual(0.6);
    expect(w.time).toBeGreaterThanOrEqual(5);
    expect(w.time).toBeLessThanOrEqual(12);
  });

  it('Case B: prompted skirmish wins', () => {
    const w = createReferenceFight(42, { players: ['arcanist'], enemies: 1 });
    const p = w.actors.find((a) => a.side === 'player')!;
    p.standingOrder = 'keep your distance and shoot';
    runHeadlessOffline(w, 30);
    expect(w.winner).toBe('player');
    expect(p.hp / p.hpMax).toBeGreaterThan(0.5);
    expect(w.time).toBeGreaterThanOrEqual(8);
    expect(w.time).toBeLessThanOrEqual(20);

    const switches = p.decisionLog.filter((d, i, arr) => i === 0 || d.state !== arr[i - 1]!.state);
    // count actual state changes
    let changes = 0;
    let prev = p.decisionLog[0]?.state;
    for (const d of p.decisionLog) {
      if (d.state !== prev) {
        changes++;
        prev = d.state;
      }
    }
    expect(changes).toBeLessThanOrEqual(4);
    void switches;
  });

  it('wrong close_and_attack loses faster than default', () => {
    const wA = createReferenceFight(42, { players: ['arcanist'], enemies: 1 });
    runHeadlessOffline(wA, 30);
    const tA = wA.time;

    const wC = createReferenceFight(42, { players: ['arcanist'], enemies: 1 });
    const p = wC.actors.find((a) => a.side === 'player')!;
    p.standingOrder = 'charge in and fight up close';
    runHeadlessOffline(wC, 30);
    expect(wC.winner).toBe('enemy');
    expect(wC.time).toBeLessThan(tA);
    expect(wC.time).toBeLessThan(6.5);
  });
});

describe('decide cadence', () => {
  it('caps offline trigger decides at ~1 Hz per actor under sustained contact', () => {
    const w = createReferenceFight(1);
    const p = w.actors.find((a) => a.side === 'player')!;
    const g = w.actors.find((a) => a.side === 'enemy')!;
    p.state = 'hold_and_shoot';
    g.state = 'close_and_attack';
    p.pos = { x: 8, y: 14 };
    g.pos = { x: 8, y: 14.8 }; // within contact
    p.decisionLog.length = 0;
    p.lastDecisionTick = w.tick;

    const seconds = 5;
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) {
      tickOfflineDecisions(w);
      stepWorld(w, DT);
      if (w.matchOver) break;
    }

    const decides = p.decisionLog.length;
    // At most 1/s plus a small slack for the first edge after floor.
    expect(decides).toBeLessThanOrEqual(seconds + 1);
  });

  it('order-change bypass still decides within the hard floor', () => {
    const w = createReferenceFight(1);
    setForceOffline(true);
    const p = w.actors.find((a) => a.side === 'player')!;
    p.lastDecisionTick = w.tick;
    p.decisionLog.length = 0;
    p.standingOrder = 'keep your distance and shoot';
    requestImmediateDecision(w, p, { bypassFloor: true });
    expect(p.decisionLog.length).toBe(1);
    setForceOffline(false);
  });

  it('skips decide for fixed-role goblin; players still decide', () => {
    const w = createReferenceFight(1);
    const players = w.actors.filter((a) => a.side === 'player');
    const g = w.actors.find((a) => a.kind === 'goblin')!;
    const goblinStartY = g.pos.y;
    expect(g.state).toBe('close_and_attack');

    runHeadlessOffline(w, 8);

    expect(g.decisionLog.length).toBe(0);
    const playerIds = new Set(players.map((a) => a.id));
    expect(w.decisionLog.every((e) => playerIds.has(e.actorId))).toBe(true);
    expect(players.reduce((n, a) => n + a.decisionLog.length, 0)).toBeGreaterThan(0);
    expect(g.state).toBe('close_and_attack');
    expect(g.pos.y).toBeLessThan(goblinStartY);
  });
});

describe('fallback validation', () => {
  it('completes on role defaults when offline', () => {
    const w = createReferenceFight(5);
    runHeadlessOffline(w, 30);
    expect(w.matchOver).toBe(true);
    expect(w.degraded).toBe(true);
  });

  it('malformed synthetic keep current and stay in allowedStates', () => {
    const w = createReferenceFight(5);
    const p = w.actors.find((a) => a.side === 'player')!;
    p.state = 'hold_and_shoot';
    applySyntheticAnswers(w, p, {
      behavior: 'take_cover' as never,
      confidence: 0.99,
    });
    // take_cover not in allowed → hysteresis/guard keeps or rejects
    expect(w.encounter.allowedStates).toContain(p.state);
  });
});
