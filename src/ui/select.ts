import { hitTest, type ViewTransform } from '../render/canvas.ts';
import type { World } from '../sim/world.ts';

export type TimeScaleMode = 0 | 0.15 | 1 | 2;

export interface SelectState {
  selectedId: string | null;
  pausedScale: TimeScaleMode;
  sheetOpen: boolean;
  sheetScope: 'actor' | 'party';
}

export function createSelectController(opts: {
  getWorld: () => World;
  getTransform: () => ViewTransform;
  canvas: HTMLCanvasElement;
  onSelect: (id: string | null, scope: 'actor' | 'party') => void;
  tacticalPause: boolean;
}): SelectState & { attach: () => void; clear: () => void } {
  const state: SelectState = {
    selectedId: null,
    pausedScale: opts.tacticalPause ? 0 : 0.15,
    sheetOpen: false,
    sheetScope: 'actor',
  };

  const onPointer = (ev: PointerEvent) => {
    const rect = opts.canvas.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * opts.canvas.width;
    const sy = ((ev.clientY - rect.top) / rect.height) * opts.canvas.height;
    const id = hitTest(opts.getWorld(), opts.getTransform(), sx, sy);
    if (id) {
      if (state.selectedId === id && state.sheetOpen) {
        state.selectedId = null;
        state.sheetOpen = false;
        opts.onSelect(null, 'actor');
      } else {
        state.selectedId = id;
        state.sheetOpen = true;
        state.sheetScope = 'actor';
        opts.onSelect(id, 'actor');
      }
    }
  };

  return {
    ...state,
    attach() {
      opts.canvas.addEventListener('pointerdown', onPointer);
    },
    clear() {
      state.selectedId = null;
      state.sheetOpen = false;
      opts.onSelect(null, 'actor');
    },
  };
}
