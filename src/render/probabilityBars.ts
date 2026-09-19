import type { DecisionEntry, StateId } from '../sim/types.ts';
import { BEHAVIOR_CRITERIA } from '../sim/types.ts';

const ORDER = ['skirmish', 'close_and_attack', 'hold_and_shoot', 'retreat'] as const;

export function renderProbabilityBars(
  container: HTMLElement,
  probabilities: Record<string, number> | undefined,
  confidence: number | undefined,
  current?: StateId,
): void {
  container.innerHTML = '';
  if (!probabilities) {
    container.textContent = 'No decision yet';
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  const conf = document.createElement('div');
  conf.style.cssText = 'font-size:11px;color:#94a3b8;margin-bottom:2px;';
  conf.textContent = `confidence ${((confidence ?? 0) * 100).toFixed(0)}%`;
  wrap.appendChild(conf);

  for (const id of ORDER) {
    const p = probabilities[id] ?? 0;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;';

    const label = document.createElement('span');
    label.style.cssText = `width:72px;color:${id === current ? '#e2e8f0' : '#94a3b8'};`;
    label.textContent = short(id);
    label.title = BEHAVIOR_CRITERIA[id];

    const track = document.createElement('div');
    track.style.cssText =
      'flex:1;height:8px;background:#1e293b;border-radius:2px;overflow:hidden;';
    const bar = document.createElement('div');
    bar.style.cssText = `height:100%;width:${(p * 100).toFixed(1)}%;background:${id === current ? '#a855f7' : '#64748b'};`;
    track.appendChild(bar);

    const pct = document.createElement('span');
    pct.style.cssText = 'width:32px;text-align:right;color:#94a3b8;';
    pct.textContent = `${Math.round(p * 100)}%`;

    row.append(label, track, pct);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

function short(id: string): string {
  return id.replace(/_/g, ' ');
}

export function formatDecision(d: DecisionEntry): string {
  return `t${d.tick} ${d.state} conf=${d.confidence.toFixed(2)} [${d.source}]`;
}
