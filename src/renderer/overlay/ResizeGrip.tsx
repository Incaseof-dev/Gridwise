import type { PointerEvent } from 'react';
import { pointerDrag } from './pointerDrag';

/** Bottom-right drag handle; the window manager cannot resize the transparent frameless overlay itself. */
export function ResizeGrip() {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    pointerDrag(e, 'resize');
  };
  return <div className="grip" onPointerDown={onPointerDown} title="Resize" />;
}
