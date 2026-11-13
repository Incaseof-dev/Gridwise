import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Bounds } from '../core/settings';

const preload = join(import.meta.dirname, '../preload/index.cjs');
/** Taskbar / window-switcher icon on Linux and Windows (packaged builds also get it from electron-builder). */
const icon = join(app.getAppPath(), 'resources', 'icon-512.png');

function load(win: BrowserWindow, page: 'overlay' | 'settings'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}/${page}/index.html`);
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}/index.html`));
}

const MIN_WIDTH = 260;
const MIN_HEIGHT = 140;
/** Minimized panel: the header row and the panel border. */
export const MINIMIZED_HEIGHT = 30;

/** Keeps stored bounds on a connected display; falls back to the top right of the primary display. */
function visibleBounds(stored: Bounds | null): Bounds {
  const { workArea } = screen.getPrimaryDisplay();
  const fallback = { x: workArea.x + workArea.width - 400, y: workArea.y + 80, width: 360, height: 520 };
  if (!stored) return fallback;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      stored.x < a.x + a.width - 40 &&
      stored.x + stored.width > a.x + 40 &&
      stored.y >= a.y - 10 &&
      stored.y < a.y + a.height - 40
    );
  });
  return onScreen
    ? { ...stored, width: Math.max(MIN_WIDTH, stored.width), height: Math.max(MIN_HEIGHT, stored.height) }
    : fallback;
}

type Size = { width: number; height: number };
type Rect = Size & { x: number; y: number };

/** The largest work area of all displays: the overlay window's fixed size, so the panel can grow on any of them. */
function canvasSize(): Size {
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  return { width: Math.max(...areas.map((a) => a.width)), height: Math.max(...areas.map((a) => a.height)) };
}

/**
 * Transparent, frameless, always-on-top overlay. On Linux this must run as an XWayland client
 * (docs/linux-overlay.md).
 *
 * The window never changes size: KWin moves an on-screen-display window (overlayLayer.ts) whenever its size changes,
 * and every size change showed a flash. It is a transparent canvas as large as the work area with the panel in its
 * top-left corner; the window shape (setShape) cuts it to the panel and the strips below it (DPS, threats, loot, messages), so the
 * rest neither shows nor takes clicks. The panel size goes to the renderer as 'overlay:panel', the strips come back
 * as rectangles (setBelow), and so does the icon strip on the panel's right (setSide). Transparent windows are not reliably resizable by the
 * window manager anyway, so the overlay has its own resize grip (OverlayDrag).
 */
export class OverlayWindow {
  readonly win: BrowserWindow;
  private panel: Size;
  /** Visible strips below the panel, in window coordinates. */
  private below: Rect[] = [];
  /** The icon strip right of the panel (restrictions, tips, loot, Abyss), in window coordinates. */
  private side: Rect[] = [];
  /** Resize preview: the shape is the whole canvas until the final size is set. */
  private whole = false;
  /** Only the header row shows; `panel` keeps the full size. */
  private mini = false;

  constructor(bounds: Bounds | null, opacity: number) {
    const b = visibleBounds(bounds);
    this.panel = { width: b.width, height: b.height };
    this.win = new BrowserWindow({
      x: b.x,
      y: b.y,
      ...canvasSize(),
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: 'Gridwise Overlay',
      icon,
      backgroundColor: '#00000000',
      webPreferences: { preload, sandbox: true, contextIsolation: true },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setOpacity(opacity);
    this.win.webContents.on('did-finish-load', () => this.setPanel(this.panel));
    this.setPanel(this.panel);
    load(this.win, 'overlay');
  }

  /** Panel position and size on screen (what the settings store). */
  bounds(): Bounds {
    const [x = 0, y = 0] = this.win.getPosition();
    return { x, y, ...this.panel };
  }

  get minimized(): boolean {
    return this.mini;
  }

  /** Shows only the header row, or the full panel again. Placing it is up to the caller. */
  setMinimized(on: boolean): void {
    this.mini = on;
    this.setPanel(this.panel);
  }

  /** What the shape cuts out and the renderer draws: the panel, or only its header row. */
  private shown(): Size {
    return this.mini ? { width: this.panel.width, height: MINIMIZED_HEIGHT } : this.panel;
  }

  /** Puts the panel at `b`, keeping the window size. */
  place(b: Bounds): void {
    this.win.setBounds({ x: b.x, y: b.y, ...canvasSize() });
    this.setPanel(b);
  }

  /** The window shape is the panel and the strips below it; `whole` opens it up to the whole canvas (resize preview). */
  setPanel(size: Size, whole = false): void {
    const { width, height } = this.win.getBounds();
    this.panel = {
      width: Math.max(MIN_WIDTH, Math.min(Math.round(size.width), width)),
      height: Math.max(MIN_HEIGHT, Math.min(Math.round(size.height), height)),
    };
    this.whole = whole;
    if (whole) return this.win.setShape([{ x: 0, y: 0, width, height }]);
    this.shape();
    // Room for the strips below the panel; without it the renderer puts them over the bottom of the panel.
    const b = { ...this.bounds(), ...this.shown() };
    const wa = screen.getDisplayMatching(b).workArea;
    const roomBelow = wa.y + wa.height - (b.y + b.height);
    const roomRight = wa.x + wa.width - (b.x + b.width);
    this.win.webContents.send('overlay:panel', { width: b.width, height: b.height, roomBelow, roomRight });
  }

  /** After a move (controller): the room below the panel may have changed. */
  refresh(): void {
    this.setPanel(this.panel);
  }

  setSide(rects: Rect[]): void {
    this.side = rects;
    this.shape();
  }

  setBelow(rects: Rect[]): void {
    this.below = rects;
    this.shape();
  }

  private shape(): void {
    if (this.whole) return;
    const { width, height } = this.win.getBounds();
    const inside = [...this.below, ...this.side]
      .map((r) => {
        const x = Math.max(0, Math.floor(r.x));
        const y = Math.max(0, Math.floor(r.y));
        return {
          x,
          y,
          width: Math.min(width - x, Math.ceil(r.width)),
          height: Math.min(height - y, Math.ceil(r.height)),
        };
      })
      .filter((r) => r.width > 0 && r.height > 0);
    // Minimized, the renderer only reports the strips the player wants to keep (settings overlay.minimizedShow).
    this.win.setShape([{ x: 0, y: 0, ...this.shown() }, ...inside]);
  }
}

/**
 * Move or resize drag of the overlay.
 *
 * Move follows the system cursor, read here: the renderer's screen coordinates come from its idea of the window
 * position, which lags while the window moves.
 *
 * Resize only changes the window shape: it opens up to the whole canvas while the grip is dragged, the renderer
 * previews the new size inside it, and the shape is cut to the final size when the grip is released.
 */
export class OverlayDrag {
  private readonly start: Bounds;
  private readonly cursor: Electron.Point;

  constructor(
    private readonly overlay: OverlayWindow,
    private readonly kind: 'move' | 'resize',
  ) {
    this.start = overlay.bounds();
    this.cursor = screen.getCursorScreenPoint();
    if (kind === 'resize') overlay.setPanel(this.start, true);
  }

  update(): void {
    if (this.kind !== 'move') return;
    const c = screen.getCursorScreenPoint();
    // Minimized, the header stays at the top of the screen and only moves sideways.
    const dy = this.overlay.minimized ? 0 : c.y - this.cursor.y;
    this.overlay.win.setPosition(this.start.x + c.x - this.cursor.x, this.start.y + dy);
  }

  /** `size`: the previewed size of a resize; without it a resize keeps the old size. */
  end(size?: Size): void {
    if (this.kind === 'move') return this.update();
    const { x, y, width, height } = this.start;
    const w = size && Number.isFinite(size.width) ? size.width : width;
    const h = size && Number.isFinite(size.height) ? size.height : height;
    // Over a panel (taskbar) the X client gets no pointer events at all, and the panel should not reach under it.
    const wa = screen.getDisplayMatching(this.start).workArea;
    this.overlay.setPanel({ width: Math.min(w, wa.x + wa.width - x), height: Math.min(h, wa.y + wa.height - y) });
  }
}

/** Room for the Ship fit tab's tree, parts and stats side by side, and the tabs in one row (EVE-84). */
const SETTINGS_SIZE = { width: 1280, height: 900 };

export function createSettingsWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(SETTINGS_SIZE.width, area.width - 40),
    height: Math.min(SETTINGS_SIZE.height, area.height - 40),
    title: 'Gridwise – Settings',
    icon,
    show: false,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
  load(win, 'settings');
  return win;
}
