import type { Actor } from '../sim/types.ts';
import type { CombatLogEntry } from '../sim/combatLog.ts';
import { formatDecision, renderProbabilityBars } from '../render/probabilityBars.ts';
import { sheetVisibleFields } from './fog.ts';

/**
 * Whether the order textarea should be rewritten from actor/party state.
 * Only on selection change — never when focus leaves the field (Send click blur),
 * which would clobber typed-but-not-yet-submitted text with a null standingOrder.
 */
export function shouldResyncOrderInput(
  key: string,
  lastSyncedKey: string | null,
): boolean {
  return key !== lastSyncedKey;
}

/**
 * Text to submit after Send. Prefer the pointerdown latch so a mid-click
 * showActor sync (or any wipe after blur) cannot empty the order before click.
 */
export function resolveSubmitOrderText(
  latch: string | null,
  inputValue: string,
): string {
  return (latch ?? inputValue).trim();
}

export function createOrderSheet(root: HTMLElement): {
  el: HTMLElement;
  controlBar: HTMLElement;
  showActor: (actor: Actor, debug: boolean) => void;
  showParty: (partyOrder: string | null) => void;
  hide: () => void;
  showCombatLog: (entries: CombatLogEntry[]) => void;
  onSubmit: (cb: (text: string, scope: 'actor' | 'party') => void) => void;
  onClear: (cb: (scope: 'actor' | 'party') => void) => void;
  onClose: (cb: () => void) => void;
  onPartyButton: (cb: () => void) => void;
} {
  const wrap = document.createElement('div');
  wrap.id = 'sheet-wrap';
  wrap.style.cssText = `
    display: flex; flex-direction: column;
    background: #0f172a; border-top: 1px solid #1e293b; min-height: 0;
  `;

  const controlBar = document.createElement('div');
  controlBar.style.cssText = `
    display: flex; gap: 8px; padding: 8px 12px; align-items: center;
    border-bottom: 1px solid #1e293b; flex-shrink: 0;
  `;
  const partyBtn = document.createElement('button');
  partyBtn.textContent = 'Party order';
  partyBtn.style.cssText = buttonStyle();
  controlBar.appendChild(partyBtn);

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:11px;color:#64748b;';
  hint.textContent = 'Tap a puck to give orders';
  controlBar.appendChild(hint);

  const combatLog = document.createElement('div');
  combatLog.id = 'combat-log';
  combatLog.setAttribute('aria-label', 'Combat log');
  combatLog.style.cssText = `
    display: flex; flex: 1; flex-direction: column; gap: 4px;
    padding: 10px 12px; overflow: auto; min-height: 0;
    font-size: 12px; line-height: 1.45; color: #cbd5e1;
  `;

  const sheet = document.createElement('div');
  sheet.style.cssText = `
    display: none; flex: 1; flex-direction: column; padding: 12px;
    gap: 8px; overflow: auto; min-height: 0;
  `;

  const input = document.createElement('textarea');
  input.rows = 3;
  input.placeholder = 'Standing order in plain English…';
  input.setAttribute('aria-label', 'Standing order');
  input.style.cssText = `
    width: 100%; resize: vertical; min-height: 66px;
    background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
    border-radius: 6px; padding: 10px; font: inherit; font-size: 14px;
  `;

  const send = document.createElement('button');
  send.textContent = 'Send';
  send.type = 'button';
  send.style.cssText = buttonStyle() + 'min-height:44px;background:#7c3aed;';

  const clearLink = document.createElement('button');
  clearLink.textContent = 'clear';
  clearLink.type = 'button';
  clearLink.setAttribute('aria-label', 'Clear order');
  clearLink.style.cssText = `
    background: none; border: none; color: #64748b; font: inherit;
    font-size: 12px; cursor: pointer; padding: 8px 4px; text-decoration: underline;
  `;

  const promptRow = document.createElement('div');
  promptRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
  promptRow.append(send, clearLink);

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;font-size:14px;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.type = 'button';
  closeBtn.style.cssText = buttonStyle();
  header.append(title, closeBtn);

  const debugPanel = document.createElement('div');
  debugPanel.style.cssText = 'display:none;flex-direction:column;gap:8px;';

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size:12px;color:#94a3b8;';

  const ordersView = document.createElement('div');
  ordersView.style.cssText = 'font-size:12px;color:#cbd5e1;white-space:pre-wrap;';

  const bars = document.createElement('div');

  const log = document.createElement('div');
  log.style.cssText = 'font-size:11px;color:#64748b;';

  debugPanel.append(meta, ordersView, bars, log);

  // Prompt + send/clear first; name/close and debug chrome below
  sheet.append(input, promptRow, header, debugPanel);
  wrap.append(controlBar, combatLog, sheet);
  root.appendChild(wrap);

  let scope: 'actor' | 'party' = 'actor';
  let submitCb: ((text: string, scope: 'actor' | 'party') => void) | null = null;
  let clearCb: ((scope: 'actor' | 'party') => void) | null = null;
  let closeCb: (() => void) | null = null;
  let partyCb: (() => void) | null = null;
  let lastSyncedKey: string | null = null;
  /** Latched on Send pointerdown so a mid-click showActor sync cannot wipe the text. */
  let submitTextLatch: string | null = null;
  let lastCombatLogLen = -1;
  let stickCombatLogToBottom = true;

  combatLog.addEventListener('scroll', () => {
    const dist = combatLog.scrollHeight - combatLog.scrollTop - combatLog.clientHeight;
    stickCombatLogToBottom = dist < 24;
  });

  /**
   * Prefill only when the selected target changes.
   * Do NOT rewrite when focus leaves the textarea — main's rAF calls showActor
   * every frame, and clicking Send blurs the input first, which would otherwise
   * clobber the typed order with the still-null standingOrder before click fires.
   */
  function syncInput(key: string, value: string | null): void {
    if (!shouldResyncOrderInput(key, lastSyncedKey)) return;
    input.value = value ?? '';
    lastSyncedKey = key;
  }

  function submitCurrent(): void {
    const text = resolveSubmitOrderText(submitTextLatch, input.value);
    submitTextLatch = null;
    if (!text || !submitCb) return;
    submitCb(text, scope);
  }

  function clearCurrent(): void {
    submitTextLatch = null;
    input.value = '';
    clearCb?.(scope);
  }

  function showOrderSheet(): void {
    combatLog.style.display = 'none';
    sheet.style.display = 'flex';
    controlBar.style.display = 'none';
  }

  function showEmptyCombatLog(): void {
    sheet.style.display = 'none';
    controlBar.style.display = 'flex';
    combatLog.style.display = 'flex';
  }

  send.addEventListener('pointerdown', () => {
    submitTextLatch = input.value;
  });
  send.addEventListener('click', () => submitCurrent());
  clearLink.addEventListener('click', () => clearCurrent());
  closeBtn.addEventListener('click', () => closeCb?.());
  partyBtn.addEventListener('click', () => partyCb?.());

  showEmptyCombatLog();

  return {
    el: wrap,
    controlBar,
    showActor(actor, debug) {
      scope = 'actor';
      showOrderSheet();
      const vis = sheetVisibleFields(actor, debug);
      title.textContent = actor.name;

      const canOrder = actor.side === 'player' || debug;
      input.style.display = canOrder ? 'block' : 'none';
      promptRow.style.display = canOrder ? 'flex' : 'none';
      if (canOrder) {
        const key = `actor:${actor.id}`;
        const isNew = key !== lastSyncedKey;
        syncInput(key, actor.standingOrder);
        if (isNew) input.focus();
        input.setAttribute('aria-label', `Standing order for ${actor.name}`);
      }

      if (debug) {
        debugPanel.style.display = 'flex';
        meta.textContent = `${vis.healthLabel} · ${vis.behaviorLabel}${actor.deciding ? ' · deciding…' : ''}`;

        if (vis.showOrder) {
          ordersView.style.display = 'block';
          ordersView.textContent =
            `Order: ${actor.standingOrder ?? '(none)'}` +
            (vis.showPartyOrder ? `\nParty: ${actor.partyOrder ?? '(none)'}` : '');
        } else {
          ordersView.style.display = 'none';
        }

        if (vis.showProbabilities) {
          bars.style.display = 'block';
          renderProbabilityBars(
            bars,
            actor.lastDecision?.probabilities,
            actor.lastDecision?.confidence,
            actor.state,
          );
        } else {
          bars.style.display = 'none';
          bars.innerHTML = '';
        }

        if (vis.showDecisionLog) {
          log.style.display = 'block';
          const last = actor.decisionLog.slice(-5).reverse();
          log.innerHTML = last.map((d) => `<div>${formatDecision(d)}</div>`).join('');
        } else {
          log.style.display = 'none';
        }
      } else {
        debugPanel.style.display = 'none';
      }
    },
    showParty(partyOrder) {
      scope = 'party';
      showOrderSheet();
      title.textContent = 'Party order';
      debugPanel.style.display = 'none';
      input.style.display = 'block';
      promptRow.style.display = 'flex';
      const isNew = lastSyncedKey !== 'party';
      syncInput('party', partyOrder);
      input.setAttribute('aria-label', 'Party order');
      if (isNew) input.focus();
    },
    hide() {
      showEmptyCombatLog();
      lastSyncedKey = null;
      lastCombatLogLen = -1;
      input.setAttribute('aria-label', 'Standing order');
    },
    showCombatLog(entries) {
      if (combatLog.style.display === 'none') return;
      if (entries.length === lastCombatLogLen) return;
      lastCombatLogLen = entries.length;
      if (entries.length === 0) {
        combatLog.innerHTML =
          '<div style="color:#64748b">Combat log — decisions and ability results appear here.</div>';
        return;
      }
      combatLog.innerHTML = entries
        .map((e) => {
          const t = e.time.toFixed(1);
          const body =
            e.kind === 'decide'
              ? `<strong>${escapeHtml(e.text)}</strong>`
              : escapeHtml(e.text);
          return `<div><span style="color:#64748b">${t}</span> ${body}</div>`;
        })
        .join('');
      if (stickCombatLogToBottom) {
        combatLog.scrollTop = combatLog.scrollHeight;
      }
    },
    onSubmit(cb) {
      submitCb = cb;
    },
    onClear(cb) {
      clearCb = cb;
    },
    onClose(cb) {
      closeCb = cb;
    },
    onPartyButton(cb) {
      partyCb = cb;
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buttonStyle(): string {
  return `
    min-height: 44px; min-width: 44px; padding: 8px 14px;
    background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
    border-radius: 6px; font: inherit; font-size: 13px; cursor: pointer;
  `;
}
