/** Contract between preload and renderers. Type-only, shared by both sides. */
import type { EncounterRef, SettingsPatch } from '../core/settings';
import type { AbyssDataView, AbyssLogView } from '../core/abyss/types';
import type { SiteMapView } from '../core/sitemap/types';
import type { AppViewModel, SearchResult, SettingsNav } from '../core/viewmodel';

export type { AbyssDataView, AbyssLogView, AppViewModel, SearchResult, SettingsNav, SiteMapView };

/** `roomBelow` / `roomRight`: pixels from the panel's bottom / right edge to the edge of the work area. */
export type PanelSize = { width: number; height: number; roomBelow: number; roomRight: number };

export interface EveAssistantApi {
  /** Subscribes to view-model pushes; returns an unsubscribe function. */
  onState(cb: (vm: AppViewModel) => void): () => void;
  getState(): Promise<AppViewModel>;
  search(query: string): Promise<SearchResult[]>;
  selectEncounter(ref: EncounterRef | null): Promise<void>;
  setPocket(index: number): Promise<void>;
  /** The enemy site map (kb/sitemap.json) with the KB entry of each site. */
  getSiteMap(): Promise<SiteMapView>;
  /** Abyssal Deadspace data (kb/abyss.json). */
  getAbyss(): Promise<AbyssDataView>;
  /** The player's logged Abyss runs, newest first. */
  getAbyssLog(): Promise<AbyssLogView>;
  /** EVE-86: the cargo pasted after a run, kept with it; `skipped` lines named no known item. */
  saveAbyssLoot(
    runId: string,
    text: string,
    /** EVE-93: the cargo before the run, replacing the one kept with it. */
    before?: string,
  ): Promise<{ ok: true; items: number; skipped: string[] } | { ok: false; error: string }>;
  /** EVE-93: the cargo copied in game, read from the clipboard: before a run, or the loot of the one that ended. */
  abyssCargo(
    which: 'before' | 'after',
  ): Promise<{ ok: true; items: number; skipped: string[] } | { ok: false; error: string }>;
  /** Sends a run to EVE Workbench's Abyss Tracker. */
  uploadAbyssRun(runId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The overlay's loot question: closed without an answer, or opened in the settings window. */
  dismissAbyssLoot(runId: string): Promise<void>;
  openAbyssLoot(runId: string): void;
  /** The settings window is asked to show a tab (from the overlay). */
  onNavigate(cb: (nav: SettingsNav) => void): () => void;
  /** EVE Workbench key: checked, then kept encrypted; the result comes with the next state push. */
  ewbSetKey(key: string): Promise<void>;
  ewbClearKey(): Promise<void>;
  ewbSync(): Promise<void>;
  /** Shows (or closes) the Abyss panel with the picked filament before going in. */
  setAbyssPreview(on: boolean): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  /** Settings → Intel → Test: a made-up hostile one jump away for 30 s (strip, graph, sound). */
  /** Clears a system's report and kills by hand (right-click or ✕ on the overlay). */
  intelClear(systemId: number): Promise<void>;
  /** EVE-103: sets the in-game destination (ESI) and draws the route on the graph. */
  intelSetDestination(systemId: number): Promise<{ ok: true } | { ok: false; error: string }>;
  intelTest(): Promise<{ ok: true; system: string } | { ok: false; error: string }>;
  setClickThrough(on: boolean): Promise<void>;
  setSearchOpen(open: boolean): Promise<void>;
  /** Overlay panel size inside the larger transparent window (main/windows.ts), sent on load and on every change. */
  onPanelSize(cb: (size: PanelSize) => void): () => void;
  /** Rectangles (window coordinates) of the strips shown below the panel, so the window shape includes them. */
  setOverlayBelow(rects: { x: number; y: number; width: number; height: number }[]): void;
  /** The same for the icon strip right of the panel. */
  setOverlaySide(rects: { x: number; y: number; width: number; height: number }[]): void;
  /**
   * Own move / resize handling (the window manager does neither for this overlay). Move: start, one `dragOverlay`
   * per pointer move (main follows the system cursor), end. Resize: start (the panel may use the whole window),
   * the renderer previews the size, end with the new size; the final size comes back through `onPanelSize`.
   */
  beginOverlayDrag(kind: 'move' | 'resize'): void;
  dragOverlay(): void;
  endOverlayDrag(size?: { width: number; height: number }): void;
  pickLogDir(): Promise<string | null>;
  /** Parses an EFT paste, stores it and makes it the active fit; resolves with the parse error, if any. */
  saveFit(eft: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Makes a saved fit the active one (null: no fit). */
  selectFit(id: string | null): Promise<void>;
  removeFit(id: string): Promise<void>;
  /** EVE login in the system browser; the result comes with the next state push. */
  esiLogin(): Promise<void>;
  esiCancelLogin(): Promise<void>;
  esiLogout(characterId: number): Promise<void>;
  /** Reads skills, implants, fittings and the ship now; ignored while ESI's cache has not run out. */
  esiSync(): Promise<void>;
  /** EVE-83/85: a weapon type's charge, the drones of a type in space, a T3D mode, or back to the fit as saved. */
  changeLoadout(
    fitId: string,
    change: { module: string; charge: string } | { drone: string; count: number } | { mode: string } | { reset: true },
  ): Promise<void>;
  updateSde(): Promise<void>;
  /** Runs the SDE and wiki update checks now, ignoring their intervals. */
  checkUpdates(): Promise<void>;
  /** Looks for a new app version now. */
  checkAppUpdate(): Promise<void>;
  /** Quits, installs the downloaded version and starts it; false when none is ready. */
  installAppUpdate(): Promise<boolean>;
  openSettings(): void;
  hideOverlay(): void;
  /** Only the header row at the top of the screen, or the full panel again. */
  setMinimized(on: boolean): void;
  /** Opens an https URL (source links) in the system browser. */
  openExternal(url: string): void;
}

declare global {
  interface Window {
    eve: EveAssistantApi;
  }
}
