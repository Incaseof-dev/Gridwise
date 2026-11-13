import type { PointerEvent } from 'react';
import type { AppViewModel } from '../../preload/api';
import { shortcutLabel } from '../shared/format';
import { pointerDrag } from './pointerDrag';

const LOG_STATE: Record<AppViewModel['log']['state'], { cls: string; text: string }> = {
  watching: { cls: 'ok', text: 'Watching logs' },
  starting: { cls: 'warn', text: 'Starting…' },
  dirMissing: { cls: 'bad', text: 'Log folder not found' },
  error: { cls: 'bad', text: 'Log error' },
  stopped: { cls: 'warn', text: 'Stopped' },
};

/**
 * Moves the window while the header is dragged. Done in the app instead of via the window manager
 * (-webkit-app-region), which may refuse to move an on-screen-display window.
 */
function startDrag(e: PointerEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
  e.preventDefault();
  pointerDrag(e, 'move');
}

/**
 * Shortcut hints for the header. When all shortcuts share their modifiers, the modifiers are shown once:
 * "Ctrl+Alt: F search · O click-through · H hide · M minimize · X/C pocket".
 */
function ShortcutHints({ shortcuts }: { shortcuts: AppViewModel['settings']['shortcuts'] }) {
  const split = (keys: string) => {
    const at = keys.lastIndexOf('+');
    return { mods: keys.slice(0, at), key: keys.slice(at + 1) };
  };
  const one = (acc: string, what: string) => {
    const keys = shortcutLabel(acc);
    return keys ? [{ ...split(keys), what }] : [];
  };
  // Previous and next pocket share one hint ("X/C") when their modifiers match.
  const prev = split(shortcutLabel(shortcuts.prevPocket));
  const next = split(shortcutLabel(shortcuts.nextPocket));
  const pocket =
    prev.key && next.key && prev.mods === next.mods
      ? [{ mods: prev.mods, key: `${prev.key}/${next.key}`, what: 'pocket' }]
      : [...one(shortcuts.prevPocket, 'prev pocket'), ...one(shortcuts.nextPocket, 'next pocket')];
  const items = [
    ...one(shortcuts.search, 'search'),
    ...one(shortcuts.toggleClickThrough, 'click-through'),
    ...one(shortcuts.toggleOverlay, 'hide'),
    ...one(shortcuts.minimize, 'minimize'),
    ...pocket,
  ];
  const shared = items.length > 0 && items.every((i) => i.mods === items[0]!.mods) ? items[0]!.mods : null;
  return (
    <span className="hints">
      {shared && <span className="muted">{shared}:</span>}
      {items.map((i) => (
        <span key={i.what} className="hint-item">
          <kbd>{shared ? i.key : `${i.mods}+${i.key}`}</kbd> {i.what}
        </span>
      ))}
    </span>
  );
}

export function Header({ vm, interactive }: { vm: AppViewModel; interactive: boolean }) {
  const state = LOG_STATE[vm.log.state];
  const char = vm.characters[0];
  const where = char
    ? `${char.name}${char.system ? ` · ${char.system.name}${char.system.security !== null ? ` ${char.system.security.toFixed(1)}` : ''}` : ''}`
    : 'No active character';
  const title = [
    state.text,
    where,
    vm.log.dir,
    vm.log.error,
    vm.sde.state !== 'ready' ? `SDE: ${vm.sde.message ?? vm.sde.state}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const healthy = vm.log.state === 'watching' && vm.sde.state === 'ready';

  return (
    <header className="bar" onPointerDown={interactive ? startDrag : undefined}>
      <span className={`dot ${vm.sde.state === 'ready' ? state.cls : 'warn'}`} title={title} />
      <span className="who" title={title}>
        {/* The player knows who and where they are; problems and the shortcuts are more useful here. */}
        {healthy ? (
          <ShortcutHints shortcuts={vm.settings.shortcuts} />
        ) : (
          <span className="muted">
            {vm.log.state === 'watching' ? `SDE: ${vm.sde.message ?? vm.sde.state}` : state.text}
          </span>
        )}
      </span>
      {interactive && (
        <span className="actions">
          <button title="Search encounter" onClick={() => void window.eve.setSearchOpen(true)}>
            ⌕
          </button>
          <button
            title={vm.overlay.minimized ? 'Restore the panel' : 'Minimize to the top of the screen'}
            onClick={() => window.eve.setMinimized(!vm.overlay.minimized)}
          >
            {vm.overlay.minimized ? '▢' : '▁'}
          </button>
          <button title="Settings" onClick={() => window.eve.openSettings()}>
            ⚙
          </button>
          <button title="Hide overlay" onClick={() => window.eve.hideOverlay()}>
            ✕
          </button>
        </span>
      )}
    </header>
  );
}
