import { createReferenceFight, getActor, setPartyOrder } from './sim/world.ts';
import { stepWorld } from './sim/step.ts';
import { DT } from './sim/types.ts';
import {
  computeTransform,
  drawTargetLine,
  hitTest,
  renderArena,
  type ViewTransform,
} from './render/canvas.ts';
import { createHud, resetHudLogClock } from './render/hud.ts';
import { createOrderSheet } from './ui/orderSheet.ts';
import {
  requestImmediateDecision,
  setForceOffline,
  tickDecisions,
} from './net/decide.ts';
import {
  printMatchEnd,
  resetTelemetry,
  session,
  tickTelemetry,
} from './net/telemetry.ts';
import { hashSeed } from './sim/rng.ts';

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const seedParam = params.get('seed');
let seed = seedParam ? hashSeed(seedParam) : (Date.now() >>> 0);
const offlineParam = params.get('offline') === '1';

type TimeScale = 0 | 0.15 | 1 | 2;
let timeScale: TimeScale = 1;
let resumeScale: TimeScale = 1;
let selectedId: string | null = null;
let sheetScope: 'actor' | 'party' = 'actor';
let transform: ViewTransform = computeTransform(300, 400);
let matchEndPrinted = false;

resetTelemetry();
if (offlineParam) setForceOffline(true);

let world = createReferenceFight(seed);

const app = document.getElementById('app')!;
const hud = createHud();

const arenaWrap = document.createElement('div');
arenaWrap.id = 'arena-wrap';
arenaWrap.style.cssText = 'position:relative; min-height:0;';
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
arenaWrap.appendChild(canvas);
app.appendChild(arenaWrap);

const sheet = createOrderSheet(app);

// Speed + seed controls in control bar
const speedBtn = document.createElement('button');
speedBtn.textContent = 'Speed';
speedBtn.style.cssText =
  'min-height:44px;padding:8px 12px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;font:inherit;';
speedBtn.addEventListener('click', () => {
  const cycle: TimeScale[] = [0, 0.15, 1, 2];
  const i = cycle.indexOf(timeScale < 0.01 ? 0 : timeScale <= 0.2 ? 0.15 : timeScale <= 1 ? 1 : 2);
  timeScale = cycle[(i + 1) % cycle.length]!;
  resumeScale = timeScale === 0 ? 1 : timeScale;
});
sheet.controlBar.appendChild(speedBtn);

const seedBtn = document.createElement('button');
seedBtn.textContent = 'Seed';
seedBtn.style.cssText = speedBtn.style.cssText;
seedBtn.addEventListener('click', () => {
  const v = prompt('Enter seed', String(seed));
  if (v == null) return;
  seed = hashSeed(v);
  resetMatch();
});
sheet.controlBar.appendChild(seedBtn);

const restartBtn = document.createElement('button');
restartBtn.textContent = 'Restart';
restartBtn.style.cssText = speedBtn.style.cssText;
restartBtn.addEventListener('click', () => resetMatch());
sheet.controlBar.appendChild(restartBtn);

function resetMatch(): void {
  const savedStanding = new Map<string, string>();
  for (const a of world.actors) {
    if (a.standingOrder) savedStanding.set(a.id, a.standingOrder);
  }
  const savedParty = world.partyOrder;

  resetTelemetry();
  resetHudLogClock();
  matchEndPrinted = false;
  world = createReferenceFight(seed);

  setPartyOrder(world, savedParty);
  for (const a of world.actors) {
    const order = savedStanding.get(a.id);
    if (order !== undefined) a.standingOrder = order;
  }

  selectedId = null;
  sheet.hide();
  sheet.showCombatLog(world.combatLog);
  timeScale = 1;
  resumeScale = 1;
}

function pauseForSheet(): void {
  if (timeScale > 0) resumeScale = timeScale;
  timeScale = 0;
}

function resumeFromSheet(): void {
  timeScale = resumeScale || 1;
  selectedId = null;
  sheetScope = 'actor';
  sheet.hide();
}

window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'Space') return;
  const el = ev.target as HTMLElement | null;
  if (
    el &&
    (el.tagName === 'TEXTAREA' ||
      el.tagName === 'INPUT' ||
      el.isContentEditable)
  ) {
    return;
  }
  ev.preventDefault();
  // Sheet selection already pauses; don't fight it with Space.
  if (selectedId || sheetScope === 'party') return;
  if (timeScale === 0) {
    timeScale = resumeScale || 1;
  } else {
    resumeScale = timeScale;
    timeScale = 0;
  }
});

canvas.addEventListener('pointerdown', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const sx = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const sy = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  const id = hitTest(world, transform, sx, sy);
  if (!id) return;
  if (selectedId === id && sheetScope === 'actor') {
    resumeFromSheet();
    return;
  }
  selectedId = id;
  sheetScope = 'actor';
  pauseForSheet();
  const actor = getActor(world, id);
  if (actor) sheet.showActor(actor, debug);
});

sheet.onClose(() => resumeFromSheet());
sheet.onPartyButton(() => {
  selectedId = null;
  sheetScope = 'party';
  pauseForSheet();
  sheet.showParty(world.partyOrder);
});
sheet.onSubmit((text, scope) => {
  if (scope === 'party') {
    setPartyOrder(world, text);
    for (const a of world.actors.filter((x) => x.side === 'player')) {
      requestImmediateDecision(world, a, { bypassFloor: true });
    }
  } else if (selectedId) {
    const actor = getActor(world, selectedId);
    if (actor && (actor.side === 'player' || debug)) {
      actor.standingOrder = text;
      requestImmediateDecision(world, actor, { bypassFloor: true });
    }
  }
  // Close sheet + clear selection so the sim unpauses (same as Close / re-tap)
  resumeFromSheet();
});
sheet.onClear((scope) => {
  // Empty the prompt + standing/party order in sim; do not decide.
  if (scope === 'party') {
    setPartyOrder(world, null);
  } else if (selectedId) {
    const actor = getActor(world, selectedId);
    if (actor) actor.standingOrder = null;
  }
});

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = arenaWrap.clientWidth;
  const h = arenaWrap.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  transform = computeTransform(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

let acc = 0;
let last = performance.now();

function frame(now: number): void {
  const wallDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  tickTelemetry(now);

  acc += wallDt * timeScale;
  const maxSteps = 5;
  let steps = 0;
  while (acc >= DT && steps < maxSteps) {
    tickDecisions(world);
    stepWorld(world, DT);
    acc -= DT;
    steps++;
  }

  if (world.matchOver && !matchEndPrinted) {
    printMatchEnd(seed);
    matchEndPrinted = true;
  }

  const ctx = canvas.getContext('2d')!;
  renderArena(ctx, world, selectedId, transform);
  if (selectedId) {
    const a = getActor(world, selectedId);
    const tid = a?.stateParams.targetId;
    if (a && tid) {
      const t = getActor(world, tid);
      if (t) drawTargetLine(ctx, a, t, transform);
    }
  }

  hud.update(world, {
    seed,
    timeScale,
    degraded: world.degraded || offlineParam,
    matchOver: world.matchOver,
    winner: world.winner,
    debug,
    p95Warning: session.p95Warning,
    rateLimitWarning: session.rateLimitWarning,
  });

  if (selectedId && sheetScope === 'actor') {
    const actor = getActor(world, selectedId);
    if (actor) sheet.showActor(actor, debug);
  } else if (!selectedId && sheetScope === 'actor') {
    sheet.showCombatLog(world.combatLog);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
