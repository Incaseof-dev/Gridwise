import { useSyncExternalStore } from 'react';

/**
 * Panel size from main (main/windows.ts): the window is a larger transparent canvas, the panel gets its size from
 * --panel-w / --panel-h. Also ends a resize preview (pointerDrag.ts) in the same style change, so the panel does not
 * flash.
 */
const root = document.documentElement;
let roomBelow = Infinity;
let roomRight = Infinity;
const listeners = new Set<() => void>();

window.eve.onPanelSize((size) => {
  root.style.setProperty('--panel-w', `${size.width}px`);
  root.style.setProperty('--panel-h', `${size.height}px`);
  delete root.dataset.resize;
  roomBelow = size.roomBelow;
  roomRight = size.roomRight;
  listeners.forEach((l) => l());
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Pixels between the panel's bottom edge and the bottom of the work area. */
export function useRoomBelow(): number {
  return useSyncExternalStore(subscribe, () => roomBelow);
}

/** Pixels between the panel's right edge and the right of the work area. */
export function useRoomRight(): number {
  return useSyncExternalStore(subscribe, () => roomRight);
}
