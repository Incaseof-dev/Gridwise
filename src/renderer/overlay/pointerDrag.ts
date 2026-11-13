import type { PointerEvent } from 'react';

/**
 * Moves or resizes the overlay while the pointer is held down on `e.currentTarget` (see OverlayDrag in main).
 *
 * Move: main follows the system cursor; this only says when, at most once per frame.
 * Resize: the panel previews the new size inside the larger transparent window (`data-resize` on <html>, sizes in
 * --resize-w / --resize-h); main gets the size once, on release.
 */
let previewTimer: ReturnType<typeof setTimeout> | undefined;

export function pointerDrag(e: PointerEvent<HTMLElement>, kind: 'move' | 'resize'): void {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const root = document.documentElement;
  // The top-left corner stays put during a resize, so window coordinates are enough.
  const panel = el.closest('.panel')!.getBoundingClientRect();
  const start = { x: e.clientX, y: e.clientY, w: panel.width, h: panel.height };
  let size = { width: start.w, height: start.h };
  const preview = (ev: { clientX: number; clientY: number }) => {
    size = {
      width: Math.min(window.innerWidth, Math.max(MIN_WIDTH, start.w + ev.clientX - start.x)),
      height: Math.min(window.innerHeight, Math.max(MIN_HEIGHT, start.h + ev.clientY - start.y)),
    };
    root.style.setProperty('--resize-w', `${size.width}px`);
    root.style.setProperty('--resize-h', `${size.height}px`);
  };
  if (kind === 'resize') {
    clearTimeout(previewTimer);
    preview(e);
    root.dataset.resize = '';
  }
  window.eve.beginOverlayDrag(kind);

  let frame = 0;
  const move = (ev: globalThis.PointerEvent) => {
    if (kind === 'resize') return preview(ev);
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      window.eve.dragOverlay();
    });
  };
  const up = () => {
    cancelAnimationFrame(frame);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    if (kind === 'move') return window.eve.endOverlayDrag();
    // The preview ends when main sends the final size (panelSize.ts); the timer only covers a lost answer.
    window.eve.endOverlayDrag(size);
    previewTimer = setTimeout(() => delete root.dataset.resize, 1000);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** Same minimum as the panel in main/windows.ts. */
const MIN_WIDTH = 260;
const MIN_HEIGHT = 140;
