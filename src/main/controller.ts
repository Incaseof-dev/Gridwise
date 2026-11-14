/**
 * Wires the core to Electron (tasks 007, 008, 012, 017): settings, log pipeline, SDE, KB,
 * encounter selection, overlay window state and the view model pushed to both windows.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseAbyssData } from '../core/abyss/parse';
import type { FocusInput } from '../core/abyss/priority';
import { identifyNpc } from '../core/abyss/priority';
import { addLogEntry, logEntry, pruneLog } from '../core/abyss/log';
import { cargoDiff, lootValue, parseLootPaste, type LootPaste } from '../core/abyss/loot';
import { tierFromNpcs } from '../core/abyss/priority';
import { AbyssRuns } from '../core/abyss/run';
import type { AbyssCargo, AbyssData, AbyssDataView, AbyssLogEntry, AbyssLogView } from '../core/abyss/types';
import { entryCharacterId, telemetryFor, uploadBlocker } from '../core/ewb/telemetry';
import { shipClass } from '../core/fit/shipTree';
import { buildAbyssView, type AbyssView } from '../core/abyss/view';
import { EncounterCatalog } from '../core/encounter/catalog';
import { applicationHints, type ApplicationHint } from '../core/fit/application';
import { checkFitAgainstSite } from '../core/fit/siteCheck';
import { FitEngine, type FitResult } from '../core/fit/stats';
import type { FitLoadoutView, FitStats, Pilot, WeaponProfile } from '../core/fit/types';
import { loadKnowledgeBase } from '../core/kb/loader';
import { parseSiteMap } from '../core/sitemap/parse';
import type { SiteMap, SiteMapView } from '../core/sitemap/types';
import { ABYSS_SYSTEM, LocalChannelWatcher } from '../core/logs/localChannel';
import { LogReader } from '../core/logs/reader';
import type { WatcherStatus } from '../core/logs/watcher';
import { cacheDir, dataDir, sdeDbPath } from '../core/paths';
import { downloadSdeZip, fetchLatestSdeInfo } from '../core/sde/download';
import { GameDataService } from '../core/sde/gameData';
import { importSdeZip } from '../core/sde/importer';
import { JumpMap } from '../core/intel/jumpMap';
import { IntelLexicon } from '../core/intel/parser';
import { buildIntelGraph, type IntelGraph } from '../core/intel/graph';
import { IntelAlerts, type IntelView } from '../core/intel/view';
import type { IntelReport } from '../core/intel/board';
import { IntelWatcher } from '../core/intel/watcher';
import { KillBoard, ZkillFeed } from '../core/intel/zkill';
import { parseChatFileName } from '../core/logs/chatFollower';
import type { Engagement } from '../core/session/combat';
import { SessionTracker } from '../core/session/tracker';
import { readState, updateKbFromWiki, updateSde, type UpdaterPaths } from '../core/updates/updater';
import { buildLootLookup, lootAlerts, type LootLookup } from '../core/loot/alerts';
import { LIVE_COMBAT } from '../core/buildFlags';
import { AppUpdater } from './appUpdate';
import { buildThreatContext } from '../core/threats/context';
import { assessThreats, type ThreatContext } from '../core/threats/engine';
import { timedMessages, type RenderText } from '../core/threats/messages';
import { loadTextPool, TextPicker } from '../core/threats/texts';
import {
  fitForHull,
  quickFits,
  syncEsiFits,
  syncEwbFits,
  touchRecentFit,
  upsertFit,
  type Bounds,
  type Loadout,
  type SavedFit,
  type EncounterRef,
  type SettingsPatch,
} from '../core/settings';
import type { NpcCapabilityKind } from '../core/sde/npcCapabilities';
import type { AppViewModel, FitPanelView, LootPromptView, SettingsNav } from '../core/viewmodel';
import { placeAboveFullscreen } from './overlayLayer';
import { platformInfo } from './platform';
import { SettingsStore } from './settingsStore';
import type { EsiFitting } from '../core/esi/client';
import { EsiService, fetchViaNet } from './esi';
import { AffiliationCache } from '../core/esi/affiliation';
import { EwbService, type EwbFitText } from './ewb';
import { createSettingsWindow, MINIMIZED_HEIGHT, OverlayDrag, OverlayWindow } from './windows';

const PUSH_INTERVAL_MS = 150;
/** Application hints cover the shots of the last minute: the targets on grid now. */
const APPLICATION_WINDOW_MS = 60_000;
const MAX_APPLICATION_HINTS = 2;
/** SDE category of ships, for the quick ship select's renders. */
const CATEGORY_SHIP = 6;

export class AppController {
  private readonly store = new SettingsStore();
  private overlayWin!: OverlayWindow;
  private overlay!: BrowserWindow;
  private settingsWin: BrowserWindow | null = null;
  private tray: Tray | null = null;

  private reader: LogReader | null = null;
  private logStatus: WatcherStatus | null = null;
  private tracker = new SessionTracker();

  private gd: GameDataService | null = null;
  /** Stargate graph for intel distances (EVE-96); rebuilt with the SDE index. */
  private jumps: JumpMap | null = null;
  private intelLex: IntelLexicon | null = null;
  /** Player intel channels (EVE-97/98). */
  private intel: IntelWatcher | null = null;
  private readonly intelAlerts = new IntelAlerts();
  private intelOrigin: number | null = null;
  /** The pilot's corporation and alliance, to split the zKillboard kills into ours and theirs (memory only). */
  private readonly affiliation = new AffiliationCache(fetchViaNet, () => this.schedulePush());
  /** Each character's system from its Local log (characterId → system name). */
  private readonly localSystems = new Map<number | null, { system: string; timeMs: number }>();
  private knownChannelsCache: { atMs: number; list: string[] } | null = null;
  private intelGraphCache: IntelGraph | null = null;
  /** zKillboard's live feed (EVE-100), while its mode is not off. */
  private zkill: ZkillFeed | null = null;
  /** Settings → Intel → Test: a made-up report one jump away, for a while. */
  private readonly appUpdater = new AppUpdater(
    () => this.schedulePush(),
    () => this.store.get().updates.app,
  );
  private intelTestReport: { report: IntelReport; untilMs: number } | null = null;
  /** EVE-103: the destination set from the graph; the route is redrawn from wherever the pilot is. */
  private intelDestination: number | null = null;
  private intelRouteCache: { from: number; to: number; route: number[] | null } | null = null;
  private readonly kills = new KillBoard();
  private catalog = new EncounterCatalog([], null);
  private kbIssues = 0;
  /** KB entry id by the wiki page it was made from (lower case), for the site map's links. */
  private kbByPage = new Map<string, string>();
  private siteMap: { map: SiteMap | null; error: string | null } | null = null;
  private abyssData: AbyssDataView | null = null;
  private abyssRuns = new AbyssRuns();
  private local: LocalChannelWatcher | null = null;
  /** The Abyss panel shown before going in, with the picked filament (EVE-75). */
  private abyssPreview = false;
  private abyssLogEntries: AbyssLogEntry[] | null = null;
  /** Counts log writes, so the settings window knows to reload the log. */
  private abyssLogVersion = 0;
  /** Runs that ended before the app started are in the chat log but not watched: they are not logged. */
  private readonly startedMs = Date.now();
  /** EHP of abyssal NPC names (SDE), for the focus order. */
  private ehpCache = new Map<string, number | null>();
  private sde: AppViewModel['sde'] = { state: 'missing', build: null, message: null };

  private fitEngine: FitEngine | null = null;
  /** The hull ESI last reported for the pilot (EVE-65). */
  private boarded: { characterId: number; shipName: string; shipTypeId: number } | null = null;
  private esi!: EsiService;
  private ewb!: EwbService;
  /** Runs whose loot question the player closed on the overlay (EVE-86). */
  private readonly lootDismissed = new Set<string>();
  /** The cargo copied before going in (EVE-93), kept for the next run that ends. */
  private cargoBefore: AbyssCargo | null = null;
  /** ESI fittings that came before the fit engine was ready (it turns them into EFT). */
  private readonly pendingFittings = new Map<number, EsiFitting[]>();
  private profileCache: { eft: string; pilot: Pilot | null; loadout: string; profiles: Map<string, WeaponProfile> } = {
    eft: '',
    pilot: null,
    loadout: '',
    profiles: new Map(),
  };
  private fitEngineState: { state: FitPanelView['engine']; error: string | null } = { state: 'loading', error: null };
  /** Stats of the active fit, recomputed only when its text changes. */
  /** The active fit's numbers and parts, for one fit text, pilot and loadout. */
  private fitCache: {
    eft: string;
    pilot: Pilot | null;
    loadout: string;
    result: FitResult;
    parts: FitLoadoutView | null;
  } | null = null;

  private quitting = false;
  private searchOpen = false;
  /** Click-through state to restore when the search closes. */
  private clickThroughBeforeSearch = false;
  private pushTimer: NodeJS.Timeout | null = null;
  private texts = new TextPicker(new Map());
  private readonly renderText: RenderText = (key, id, vars) =>
    this.texts.text(key, this.store.get().overlay.sarcasm, id, vars);
  /** Why the overlay could not be placed above fullscreen windows (null = placed, or not requested). */
  private overlayLayerNote: string | null = null;
  private threatCtx: { key: string; ctx: ThreatContext; loot: LootLookup } | null = null;
  private shortcutErrors: string[] = [];
  private saveOverlayBounds = (): void => {};

  start(): void {
    this.esi = new EsiService(
      () => this.store.get().esi.clientId,
      {
        changed: () => this.schedulePush(),
        fittings: (id, fittings) => this.onEsiFittings(id, fittings),
        boarded: (id, typeId) => this.onBoarded(id, typeId),
      },
      () => this.esi.pilotId(this.tracker.active()?.characterId ?? null),
      () => this.store.get().intel.destination,
    );
    this.esi.start();
    this.ewb = new EwbService(
      {
        changed: () => this.schedulePush(),
        fits: (fits) => this.onEwbFits(fits),
        runs: () => {
          this.abyssLogVersion++;
          this.schedulePush();
        },
      },
      (fitId, hash) =>
        this.store.get().fits.saved.find((f) => f.ewb?.fitId === fitId && f.ewb.hash === hash)?.eft ?? null,
      () => this.store.get().ewb.apiBase,
    );
    this.ewb.start();
    app.on('will-quit', () => {
      this.esi.stop();
      this.ewb.stop();
    });
    this.openSde();
    this.loadKb();
    this.loadFitEngine();
    this.registerIpc();

    const s = this.store.get();
    this.overlayWin = new OverlayWindow(s.overlay.bounds, s.overlay.opacity);
    this.overlay = this.overlayWin.win;
    if (s.overlay.minimized) this.overlayWin.setMinimized(true);
    if (s.overlay.aboveFullscreen) this.overlayLayerNote = placeAboveFullscreen(this.overlay);
    this.overlay.once('ready-to-show', () => {
      // Always visible on start: a hidden overlay plus an easily missed tray icon looks like the app did not start.
      this.setOverlayVisible(true);
      this.applyClickThrough(this.store.get().overlay.clickThrough);
    });
    // 'moved' only exists on macOS/Windows; on Linux only 'move' fires, many times per drag.
    let boundsTimer: NodeJS.Timeout | null = null;
    this.saveOverlayBounds = () => {
      if (boundsTimer) clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        // Minimized, only the header's left edge moves; the full panel keeps its place for restoring.
        const b = this.overlayWin.bounds();
        this.store.update({ overlay: this.overlayWin.minimized ? { minimizedX: b.x } : { bounds: b } });
        // Also moves not made with the header (window manager, display changes) change the room below the panel.
        this.overlayWin.refresh();
      }, 400);
    };
    this.overlay.on('move', this.saveOverlayBounds);
    this.overlay.on('close', (e) => {
      // The overlay is only hidden; quitting goes through the tray menu.
      if (!this.quitting) {
        e.preventDefault();
        this.setOverlayVisible(false);
      }
    });

    this.createTray();
    this.registerShortcuts();
    this.startLogs();
    // Unattended data updates: first look a minute after start, then hourly; the updater itself decides
    // whether a check is due (SDE daily, wiki weekly).
    setTimeout(() => void this.runUpdates(false), 60_000);
    setInterval(() => void this.runUpdates(false), 3600_000);
    this.appUpdater.start();
    // Threat expiry and rolling DPS change with time even when no new log line arrives.
    setInterval(() => {
      const a = this.tracker.active();
      // Also tick for a while after a fight so loot reminders count up and expire.
      const g = a?.combat.latestEngagement(a.nowMs);
      const inAbyss = this.abyssRuns.any(Date.now());
      this.logFinishedRuns();
      if ((a && g && a.nowMs - g.lastCombatMs < 11 * 60_000) || inAbyss) this.schedulePush();
    }, 1000);
    // Intel reports age and expire without new lines.
    setInterval(() => {
      if (this.intel || this.zkill) this.schedulePush();
    }, 15_000);
    // First start without an SDE index: show the settings window so the player sees how to get it.
    if (this.sde.state === 'missing') this.showSettings();
    app.on('before-quit', () => {
      this.quitting = true;
      this.store.flush();
      this.reader?.stop();
      this.local?.stop();
      this.intel?.stop();
      this.zkill?.stop();
    });
    app.on('will-quit', () => globalShortcut.unregisterAll());
    if (process.env.EVE_ASSISTANT_CAPTURE_DIR) this.captureForDev(process.env.EVE_ASSISTANT_CAPTURE_DIR);
  }

  /** Dev aid: saves PNGs of the app's own windows (not the screen) a few seconds after start. */
  private captureForDev(dir: string): void {
    this.showSettings();
    setTimeout(() => {
      mkdirSync(dir, { recursive: true });
      for (const [name, w] of [
        ['overlay', this.overlay],
        ['settings', this.settingsWin],
      ] as const) {
        if (w && !w.isDestroyed())
          void w.webContents.capturePage().then((img) => writeFileSync(join(dir, `${name}.png`), img.toPNG()));
      }
    }, 4000);
  }

  /** Starting the app again while it runs brings it to the front instead of silently quitting. */
  showAll(): void {
    this.setOverlayVisible(true);
    this.showSettings();
  }

  // ---- data sources -------------------------------------------------------------------------

  /** Data shipped with the app (`npm run data:build`); in a packaged build it sits next to the app resources. */
  private bundledDataDir(): string {
    return join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'data');
  }

  /** Opens the newer of the app's own (auto-updated) SDE index and the bundled one. */
  private openSde(): void {
    this.gd?.close();
    this.gd = null;
    const candidates = [sdeDbPath(), join(this.bundledDataDir(), 'sde.sqlite')].filter((p) => existsSync(p));
    let lastError: string | null = null;
    for (const path of candidates) {
      try {
        const gd = new GameDataService(path);
        // On the same build the bundled index wins: it comes with the app, so it has the app's latest tables.
        if (!this.gd || (gd.buildNumber ?? 0) >= (this.gd.buildNumber ?? 0)) {
          this.gd?.close();
          this.gd = gd;
        } else gd.close();
      } catch (err) {
        lastError = String(err instanceof Error ? err.message : err);
      }
    }
    if (this.gd) this.sde = { state: 'ready', build: this.gd.buildNumber, message: null };
    else if (lastError) this.sde = { state: 'error', build: null, message: lastError };
    else this.sde = { state: 'missing', build: null, message: 'No SDE index yet. Download it in Settings → Data.' };
    const gd = this.gd;
    const systems = gd?.systemNames() ?? [];
    this.jumps = gd ? new JumpMap(systems, gd.jumpGraph()) : null;
    this.intelLex = gd ? new IntelLexicon(systems, gd.shipNames()) : null;
    this.startIntel();
    this.tracker.setSecurityLookup((name) => gd?.systemByName(name)?.security ?? null);
  }

  private loadKb(): void {
    const { encounters, issues } = loadKnowledgeBase(
      join(app.getAppPath(), 'kb', 'encounters'),
      join(dataDir(), 'kb'),
      join(dataDir(), 'kb-updates'),
    );
    for (const i of issues) console.warn(`KB ${i.severity}: ${i.file}:${i.line ?? '?'} ${i.path} ${i.message}`);
    const texts = loadTextPool([join(app.getAppPath(), 'messages', 'messages.yaml'), join(dataDir(), 'messages.yaml')]);
    for (const i of texts.issues) console.warn(`Messages ${i.severity}: ${i.file} ${i.path} ${i.message}`);
    this.texts = new TextPicker(texts.pool);
    this.kbIssues = [...issues, ...texts.issues].filter((i) => i.severity === 'error').length;
    this.catalog = new EncounterCatalog(encounters, this.gd);
    this.kbByPage = new Map(
      encounters.flatMap((e) => {
        const title = Object.values(e.sources)[0]?.title.replace(/^.* – /, '');
        return title ? [[title.toLowerCase(), e.id] as [string, string]] : [];
      }),
    );
  }

  /** The enemy site map (EVE-74), read on first use; KB links are resolved against the KB loaded now. */
  private siteMapView(): SiteMapView {
    if (!this.siteMap) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'kb', 'sitemap.json'), 'utf8'));
        this.siteMap = { map: parseSiteMap(raw), error: null };
      } catch (err) {
        this.siteMap = { map: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
    const kbIds: Record<string, string> = {};
    for (const s of this.siteMap.map?.sites ?? []) {
      const id = this.catalog.encounter(s.id) ? s.id : s.page ? this.kbByPage.get(s.page.toLowerCase()) : undefined;
      if (id) kbIds[s.id] = id;
    }
    return { ...this.siteMap, kbIds };
  }

  /** Abyssal Deadspace data (EVE-75), read on first use. */
  private abyss(): AbyssDataView {
    if (!this.abyssData) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'kb', 'abyss.json'), 'utf8'));
        this.abyssData = { data: parseAbyssData(raw), error: null };
      } catch (err) {
        this.abyssData = { data: null, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return this.abyssData;
  }

  private abyssLogPath(): string {
    return join(dataDir(), 'abyss-log.json');
  }

  /** The player's Abyss runs, newest first (EVE-75). A broken file starts a new log; the old one is kept aside. */
  private abyssLog(): AbyssLogEntry[] {
    if (!this.abyssLogEntries) {
      const file = this.abyssLogPath();
      try {
        const raw: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
        this.abyssLogEntries = Array.isArray(raw) ? (raw as AbyssLogEntry[]) : [];
      } catch {
        try {
          writeFileSync(`${file}.broken`, readFileSync(file));
        } catch {
          // nothing to keep
        }
        this.abyssLogEntries = [];
      }
    }
    return this.abyssLogEntries;
  }

  /** Writes the runs that ended into the Abyss log, with the filament the player picked and the ship of the fit. */
  private logFinishedRuns(): void {
    const finished = this.abyssRuns.takeFinished();
    if (!finished.length) return;
    const data = this.abyss().data;
    const s = this.store.get();
    const view = this.fitView().active;
    const fit = view?.stats ?? null;
    let entries = this.abyssLog();
    for (const f of finished) {
      if ((f.exitedMs ?? f.run.enteredMs) < this.startedMs) continue;
      // The cargo copied before this run: in the two hours before it ended, by the time it ended (the log has whole
      // seconds).
      const before =
        this.cargoBefore &&
        Date.parse(this.cargoBefore.savedAt) < (f.exitedMs ?? Date.now()) + 1000 &&
        Date.parse(this.cargoBefore.savedAt) > f.run.enteredMs - 2 * 3_600_000
          ? this.cargoBefore
          : null;
      if (before) this.cargoBefore = null;
      const npcTier = data ? tierFromNpcs([...f.run.seen, ...[...f.run.npcs.values()].map((n) => n.name)], data) : null;
      const character = this.tracker.characters().find((c) => c.characterId === f.characterId)?.name ?? null;
      entries = addLogEntry(
        entries,
        logEntry(f, {
          character,
          weather: s.abyss.weather,
          tier: npcTier ?? s.abyss.tier,
          tierSource: npcTier !== null ? 'npc' : s.abyss.tier !== null ? 'setting' : null,
          ship: fit?.shipName ?? null,
          fitId: fit ? (view?.id ?? null) : null,
        }),
      );
      if (before) entries[0] = { ...entries[0]!, cargoBefore: before };
    }
    this.saveAbyssLog(pruneLog(entries, s.abyss.logKeep));
  }

  private saveAbyssLog(entries: AbyssLogEntry[]): void {
    this.abyssLogEntries = entries;
    this.abyssLogVersion++;
    try {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(this.abyssLogPath(), JSON.stringify(entries, null, 1));
    } catch (err) {
      console.error('abyss log:', err);
    }
    this.schedulePush();
  }

  private patchAbyssEntry(id: string, patch: Partial<AbyssLogEntry>): void {
    this.saveAbyssLog(this.abyssLog().map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  /** A copied cargo list as known items; an error when the game data is missing or knows none of the lines. */
  private parseCargo(text: string): LootPaste | string {
    const { gd, fitEngine } = this;
    if (!gd && !fitEngine) return 'The game data is not loaded, so the item names cannot be read.';
    // The SDE knows every item; the fit engine's data has the Abyss loot too, for a start without the SDE.
    const paste = parseLootPaste(text, (name) => gd?.typesByName(name)[0]?.id ?? fitEngine?.typeIdByName(name) ?? null);
    if (!paste.items.length && paste.skipped.length)
      return 'Nothing in the paste is an item the game data knows. Copy the cargo list again.';
    return paste;
  }

  /**
   * The cargo pasted after a run (EVE-86): known items with their count, valued at Jita when EVE Workbench answers.
   * With the cargo before the run (EVE-93; `beforeText` replaces it) the loot is what grew, and what shrank was used up.
   */
  private async saveLoot(
    id: string,
    text: string,
    beforeText?: string,
  ): Promise<{ ok: true; items: number; skipped: string[] } | { ok: false; error: string }> {
    const entry = this.abyssLog().find((e) => e.id === id);
    if (!entry) return { ok: false, error: 'This run is no longer in the log.' };
    const paste = this.parseCargo(text);
    if (typeof paste === 'string') return { ok: false, error: paste };
    let before = entry.cargoBefore ?? null;
    if (beforeText?.trim()) {
      const b = this.parseCargo(beforeText);
      if (typeof b === 'string') return { ok: false, error: `Cargo before the run: ${b}` };
      before = { items: b.items, savedAt: new Date().toISOString() };
    }
    const { gained, lost } = before ? cargoDiff(before.items, paste.items) : { gained: paste.items, lost: [] };
    const prices = gained.length || lost.length ? await this.ewb.price() : null;
    this.patchAbyssEntry(id, {
      cargoBefore: before,
      loot: {
        items: gained,
        ...(before ? { lost } : {}),
        skipped: paste.skipped,
        savedAt: new Date().toISOString(),
        value: prices && gained.length ? lootValue(gained, prices) : null,
        ...(before ? { lostValue: prices && lost.length ? lootValue(lost, prices) : null } : {}),
      },
    });
    this.lootDismissed.add(id);
    return { ok: true, items: gained.length, skipped: paste.skipped };
  }

  /** The run whose cargo the overlay's "after" button saves: the newest one that ended alive in the last 30 minutes. */
  private cargoTarget(): AbyssLogEntry | null {
    const e = this.abyssLog()[0];
    if (!e || e.outcome === 'lost') return null;
    return Date.now() - Date.parse(e.exitedAt ?? e.enteredAt) > 30 * 60_000 ? null : e;
  }

  /**
   * The overlay's cargo buttons (EVE-93): the cargo the player copied in game, read from the clipboard, so they need
   * not open the settings window. "before" is kept for the next run, "after" is the loot of the run that just ended.
   */
  private async cargoFromClipboard(
    which: 'before' | 'after',
  ): Promise<{ ok: true; items: number; skipped: string[] } | { ok: false; error: string }> {
    const text = await clipboard.readText();
    if (!text.trim()) return { ok: false, error: 'The clipboard is empty: in the cargo press Ctrl+A, Ctrl+C first.' };
    if (which === 'after') {
      const target = this.cargoTarget();
      if (!target) return { ok: false, error: 'No run ended alive in the last 30 minutes.' };
      const r = await this.saveLoot(target.id, text);
      this.schedulePush();
      return r;
    }
    const paste = this.parseCargo(text);
    if (typeof paste === 'string') return { ok: false, error: paste };
    this.cargoBefore = { items: paste.items, savedAt: new Date().toISOString() };
    this.schedulePush();
    return { ok: true, items: paste.items.length, skipped: paste.skipped };
  }

  /** What the overlay's cargo buttons show. */
  private cargoView(): AppViewModel['abyssCargo'] {
    const t = this.cargoTarget();
    return {
      before: this.cargoBefore ? { items: this.cargoBefore.items.length, savedAt: this.cargoBefore.savedAt } : null,
      after: t
        ? { entryId: t.id, saved: !!t.loot, items: t.loot?.items.length ?? 0, withBefore: !!t.cargoBefore }
        : null,
    };
  }

  /** Sends a run to EVE Workbench's Abyss Tracker (EVE-86); only when the player presses Upload. */
  private async uploadRun(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const e = this.abyssLog().find((x) => x.id === id);
    if (!e) return { ok: false, error: 'This run is no longer in the log.' };
    if (!this.ewb.hasKey()) return { ok: false, error: 'Add your EVE Workbench key first (EVE login tab).' };
    const blocker = uploadBlocker(e);
    if (blocker) return { ok: false, error: blocker };
    const characterId = entryCharacterId(e)!;
    const account = this.ewb.characters();
    if (account.length && !account.some((c) => c.id === characterId))
      return { ok: false, error: `${e.character ?? 'This character'} is not on the EVE Workbench account of the key.` };
    const fit = this.store.get().fits.saved.find((f) => f.id === e.fitId && f.shipName === e.ship) ?? null;
    const hull = this.hull(e.ship!);
    const cls = shipClass(hull.shipGroup);
    const hullType =
      { Frigates: 'Frigate', Destroyers: 'Destroyer', Cruisers: 'Cruiser' }[cls] ?? hull.shipGroup ?? cls;
    const privacy = this.store.get().ewb.privacy;
    try {
      const runId = await this.ewb.upload(
        telemetryFor({
          entry: e,
          characterId,
          privacy,
          ship: {
            name: e.ship!,
            typeId: hull.shipTypeId,
            hullType,
            eft: fit?.eft ?? null,
            fitName: fit?.name ?? null,
            ewbFitId: fit?.ewb?.fitId ?? null,
          },
          // Prices only when there is loot to value: the price list is big and a lost run has none.
          price:
            e.outcome !== 'lost' && (e.loot?.items.length || e.loot?.lost?.length)
              ? await this.ewb.price()
              : () => null,
        }),
      );
      this.patchAbyssEntry(id, { upload: { runId, at: new Date().toISOString(), privacy } });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** The newest run that ended alive in the last 30 minutes and has no loot yet: the overlay asks for it. */
  private lootPrompt(): LootPromptView | null {
    const e = this.cargoTarget();
    if (!e || e.loot || this.lootDismissed.has(e.id)) return null;
    return { entryId: e.id, weather: e.weather, tier: e.tier, clearSeconds: e.clearSeconds };
  }

  /** NPCs that only live in the Abyss: the SDE's abyssal groups, else the wiki's name parts. */
  private isAbyssalNpc(name: string, data: AbyssData): boolean {
    const types = this.gd?.typesByName(name, 11) ?? [];
    if (types.length) return types.some((t) => /^Abyssal (Spaceship|Drone) Entities$/.test(t.groupName));
    const a = identifyNpc(name, data);
    return a.faction !== null && !a.structure;
  }

  /** What a logged weapon name means for the active fit; the engine work is cached per fit text. */
  private weaponProfile(eft: string, weapon: string): WeaponProfile {
    const pilot = this.pilot();
    const { activeId, loadout: all } = this.store.get().fits;
    const loadout = (activeId && all[activeId]) || null;
    const key = JSON.stringify(loadout);
    if (this.profileCache.eft !== eft || this.profileCache.pilot !== pilot || this.profileCache.loadout !== key)
      this.profileCache = { eft, pilot, loadout: key, profiles: new Map() };
    let p = this.profileCache.profiles.get(weapon);
    if (!p) {
      p = this.fitEngine!.weaponProfile(eft, weapon, pilot, loadout);
      this.profileCache.profiles.set(weapon, p);
    }
    return p;
  }

  /** EVE-80: hints for the weapons and targets of the last minute of the ongoing fight, with the active fit. */
  private applicationHints(g: Engagement | null, nowMs: number): ApplicationHint[] {
    const { saved, activeId } = this.store.get().fits;
    const eft = saved.find((f) => f.id === activeId)?.eft;
    if (!g || !eft || !this.fitEngine || !this.gd) return [];
    const recent = [...g.shots.values()].filter((x) => x.lastMs >= nowMs - APPLICATION_WINDOW_MS);
    return applicationHints(
      recent,
      (w) => this.weaponProfile(eft, w),
      (name) => {
        const t = this.gd!.typesByName(name, 11)[0];
        const p = t ? this.gd!.npcProfile(t.id) : null;
        return p?.signatureRadius && p.maxVelocity !== null
          ? { signatureRadius: p.signatureRadius, maxVelocity: p.maxVelocity, cruiseVelocity: p.cruiseVelocity }
          : null;
      },
    ).slice(0, MAX_APPLICATION_HINTS);
  }

  private npcEhp(name: string): number | null {
    if (!this.ehpCache.has(name)) {
      const t = this.gd?.typesByName(name, 11)[0];
      const p = t ? this.gd!.npcProfile(t.id) : null;
      this.ehpCache.set(name, p?.recommendedDamage[0]?.ehp ?? null);
    }
    return this.ehpCache.get(name)!;
  }

  /**
   * The Abyss panel when the active character is in the Abyss. Local and the combat log share EVE time (UTC), so
   * the run and its NPCs are kept in log time. The timer runs on the wall clock (EVE time is UTC); only "seen how
   * long ago" uses the log's own idea of now (`active.nowMs`), which also holds for a replay.
   */
  private abyssView(active: ReturnType<SessionTracker['active']>, fit: FitStats | null): AbyssView | null {
    const data = this.abyss().data;
    if (!data) return null;
    const now = Date.now();
    const g = active ? active.combat.latestEngagement(active.nowMs) : null;
    const shift = active ? now - active.nowMs : 0;
    const npcs = g ? [...g.npcs.values()] : [];
    const abyssal = npcs
      .filter((n) => this.isAbyssalNpc(n.name, data))
      .map((n) => ({ name: n.name, firstSeenMs: n.firstSeenMs }));
    const characterId = active?.characterId ?? this.abyssRuns.latestCharacter(now);
    const run = this.abyssRuns.current(characterId, now, abyssal);
    if (!run) {
      return this.abyssPreview
        ? buildAbyssView({ data, run: null, nowMs: now, choice: this.store.get().abyss, npcs: [], fit })
        : null;
    }
    if (g)
      this.abyssRuns.record(
        characterId,
        g.startMs,
        npcs.map((n) => ({
          name: n.name,
          firstSeenMs: n.firstSeenMs,
          lastSeenMs: n.lastSeenMs,
          damageToUs: n.damageToUs,
          damageByUs: n.damageByUs,
          ewar: Object.keys(n.ewarOnUs),
        })),
      );
    const caps = this.lookups().ctx;
    const focus: FocusInput[] = npcs
      .filter((n) => n.lastSeenMs >= run.enteredMs)
      .map((n) => ({
        name: n.name,
        observed: Object.keys(n.ewarOnUs) as NpcCapabilityKind[],
        sde: caps.capabilitiesOf(n.name).map((c) => c.kind),
        ehp: this.npcEhp(n.name),
        firstSeenMs: n.firstSeenMs + shift,
        lastSeenMs: n.lastSeenMs + shift,
      }));
    return buildAbyssView({
      data,
      run,
      nowMs: now,
      choice: this.store.get().abyss,
      npcs: focus,
      fit,
      live: LIVE_COMBAT,
    });
  }

  /** The fit engine reads its own data (~70 ms); until then saved fits show without stats. */
  private loadFitEngine(): void {
    FitEngine.load().then(
      (engine) => {
        this.fitEngine = engine;
        this.fitEngineState = { state: 'ready', error: null };
        for (const [id, fittings] of this.pendingFittings) this.onEsiFittings(id, fittings);
        this.pendingFittings.clear();
        this.schedulePush();
      },
      (err: unknown) => {
        this.fitEngineState = { state: 'error', error: String(err instanceof Error ? err.message : err) };
        this.schedulePush();
      },
    );
  }

  private startLogs(): void {
    this.reader?.stop();
    const gd = this.gd;
    this.tracker = new SessionTracker();
    this.tracker.setSecurityLookup((name) => gd?.systemByName(name)?.security ?? null);
    const reader = new LogReader({ dir: this.store.get().logDir });
    reader.on('status', (s) => {
      this.logStatus = s;
      this.schedulePush();
    });
    reader.on('session', (h) => {
      this.tracker.addSession(h);
      this.schedulePush();
    });
    reader.on('sessionReset', (h) => this.tracker.resetSession(h));
    reader.on('sessionEnded', (h) => {
      this.tracker.removeSession(h);
      this.schedulePush();
    });
    reader.on('events', (h, events) => {
      this.tracker.apply(h, events);
      this.schedulePush();
    });
    this.reader = reader;
    void reader.start();

    // Local's system changes tell when the Abyss starts and ends (EVE-75); chat logs sit next to the game logs.
    this.local?.stop();
    this.abyssRuns = new AbyssRuns();
    const local = new LocalChannelWatcher(join(dirname(this.store.get().logDir), 'Chatlogs'));
    local.on('change', (c) => {
      this.abyssRuns.onLocal(c.characterId, c.timeMs, c.system, c.system === ABYSS_SYSTEM);
      this.localSystems.set(c.characterId, { system: c.system, timeMs: c.timeMs });
      this.logFinishedRuns();
      this.schedulePush();
    });
    this.local = local;
    void local.start();
    this.startIntel();
  }

  private chatDir(): string {
    return join(dirname(this.store.get().logDir), 'Chatlogs');
  }

  /** (Re)starts following the intel channels; nothing to follow without channels or the SDE map. */
  /** Starts or stops the zKillboard feed to match its mode; kills nearby push the view. */
  private syncZkill(): void {
    const s = this.store.get().intel.zkill;
    this.kills.keepMs = s.keepMin * 60_000;
    if (s.mode === 'off') {
      this.zkill?.stop();
      this.zkill = null;
      return;
    }
    if (this.zkill) return;
    const feed = new ZkillFeed();
    feed.on('kill', (k) => {
      if (!this.kills.add(k, Date.now())) return;
      const o = this.intelOriginId();
      if (o !== null && this.jumps?.distance(o, k.systemId) !== null) this.schedulePush();
    });
    feed.on('status', () => this.schedulePush());
    this.zkill = feed;
    feed.start();
  }

  private startIntel(): void {
    this.intel?.stop();
    this.intel = null;
    this.syncZkill();
    const s = this.store.get().intel;
    if (!s.channels.length || !this.jumps || !this.intelLex) return;
    const w = new IntelWatcher(this.chatDir(), s.channels, this.intelLex, this.jumps, () => this.intelOriginId(), {
      expireMs: s.expireMin * 60_000,
    });
    w.on('change', () => this.schedulePush());
    this.intel = w;
    void w.start();
  }

  /** The active character's system (its Local log), else the system seen last; null in the Abyss or unknown. */
  /** The pilot whose side the kills are counted from: the active game log's character, else the latest in Local. */
  private intelCharacterId(): number | null {
    const id = this.tracker.active()?.characterId;
    if (id !== undefined && id !== null) return id;
    const latest = [...this.localSystems].filter(([c]) => c !== null).sort((a, b) => b[1].timeMs - a[1].timeMs)[0];
    return latest?.[0] ?? this.esi.pilotId(null);
  }

  private intelOriginId(): number | null {
    const id = this.tracker.active()?.characterId;
    const mine = id !== undefined ? this.localSystems.get(id) : undefined;
    const latest = mine ?? [...this.localSystems.values()].sort((a, b) => b.timeMs - a.timeMs)[0];
    if (!latest || latest.system === ABYSS_SYSTEM) return null;
    return this.jumps?.system(latest.system)?.id ?? null;
  }

  /** Chat channels with a log in the last two weeks, for the channel picker (the date is in the file name). */
  private knownChannels(): string[] {
    const now = Date.now();
    if (this.knownChannelsCache && now - this.knownChannelsCache.atMs < 60_000) return this.knownChannelsCache.list;
    const since = new Date(now - 14 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    const seen = new Set<string>();
    try {
      for (const name of readdirSync(this.chatDir())) {
        const f = parseChatFileName(name);
        const date = /_(\d{8})_\d{6}/.exec(name)?.[1];
        if (f && f.channel !== 'Local' && date && date >= since) seen.add(f.channel);
      }
    } catch {
      // No chat log folder (yet).
    }
    const list = [...seen].sort((a, b) => a.localeCompare(b));
    this.knownChannelsCache = { atMs: now, list };
    return list;
  }

  private intelView(): IntelView {
    const s = this.store.get().intel;
    const base: IntelView = {
      state: 'watching',
      channels: s.channels,
      origin: null,
      range: s.range,
      rows: [],
      approaching: false,
      alert: null,
      lastMessageMs: this.intel?.board.lastMessageMs ?? null,
      feed: { files: this.intel?.files ?? 0, lastReadMs: this.intel?.lastReadMs ?? null },
      testing: false,
      destination: null,
      knownChannels: this.knownChannels(),
      view: s.view,
      graph: null,
      kills: [],
      zkill: {
        mode: s.zkill.mode,
        quiet: false,
        state: this.zkill?.status.state ?? 'stopped',
        received: this.zkill?.status.kills ?? 0,
        lastError: this.zkill?.status.lastError ?? null,
      },
    };
    if (!s.channels.length && s.zkill.mode === 'off') return { ...base, state: 'off' };
    const jumps = this.jumps;
    const gd = this.gd;
    if (!jumps || !gd || (s.channels.length && !this.intel)) return { ...base, state: 'noData' };
    const origin = this.intelOriginId();
    if (origin === null) return { ...base, state: 'noSystem' };
    if (origin !== this.intelOrigin) {
      this.intelOrigin = origin;
      this.intelAlerts.resetTrend();
    }
    const dist = jumps.from(origin, s.range);
    const now = Date.now();
    const test = this.intelTestReport && now < this.intelTestReport.untilMs ? this.intelTestReport.report : null;
    if (!test) this.intelTestReport = null;
    const reports = this.intel?.board.active(now) ?? [];
    const { rows, approaching } = this.intelAlerts.rows(
      test ? [test, ...reports.filter((r) => r.system.id !== test.system.id)] : reports,
      (id) => dist.get(id) ?? null,
      (id) => jumps.system(id)?.security ?? null,
      s,
      now,
      (ship) => this.intelLex?.shipClass(ship) ?? null,
    );
    // Kills show when the channels have been quiet (or there are none), or always (EVE-100).
    const last = this.intel?.board.lastMessageMs ?? null;
    const quiet = !s.channels.length || last === null || now - last >= s.zkill.quietMin * 60_000;
    const showKills = s.zkill.mode === 'always' || (s.zkill.mode === 'quiet' && quiet);
    const ship = (typeId: number) => {
      const t = gd.typeById(typeId);
      return t ? { name: t.name, cls: t.groupName } : null;
    };
    const { kills, alert } = this.intelAlerts.kills(
      showKills ? this.kills.active(now) : [],
      (id) => dist.get(id) ?? null,
      (id) => jumps.system(id),
      ship,
      s,
      showKills ? this.affiliation.get(this.intelCharacterId()) : null,
    );
    let graph: IntelGraph | null = null;
    if (s.view === 'graph') {
      const c = this.intelGraphCache;
      graph = c && c.origin === origin && c.range === s.range ? c : buildIntelGraph(jumps, origin, s.range);
      this.intelGraphCache = graph;
    }
    return {
      ...base,
      origin: jumps.system(origin)?.name ?? null,
      rows,
      alert,
      approaching,
      graph,
      kills,
      zkill: { ...base.zkill, quiet },
      testing: test !== null,
      destination: this.destinationView(jumps, origin),
    };
  }

  private destinationView(jumps: JumpMap, origin: number): IntelView['destination'] {
    const to = this.intelDestination;
    if (to === null || !this.store.get().intel.destination) return null;
    if (to === origin) {
      // Arrived.
      this.intelDestination = null;
      return null;
    }
    const c = this.intelRouteCache;
    const route = c && c.from === origin && c.to === to ? c.route : jumps.path(origin, to);
    this.intelRouteCache = { from: origin, to, route };
    const sys = jumps.system(to);
    if (!route || !sys) return null;
    return { systemId: to, name: sys.name, jumps: route.length - 1, route };
  }

  /** EVE-103: Ctrl+click on the graph: the destination in game (ESI) and the dashed route on the graph. */
  private async intelSetDestination(systemId: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.store.get().intel.destination)
      return { ok: false, error: 'Turn on “Set destination” in Settings → Intel first.' };
    if (!this.jumps?.system(systemId)) return { ok: false, error: 'Unknown system.' };
    const r = await this.esi.setDestination(this.tracker.active()?.characterId ?? null, systemId);
    if (r.ok) {
      this.intelDestination = systemId;
      this.schedulePush();
    }
    return r;
  }

  /** The player cleared a system on the strip or the graph (right-click or ✕). */
  private intelClear(systemId: number): void {
    this.intel?.board.remove(systemId);
    this.kills.removeSystem(systemId);
    if (this.intelTestReport?.report.system.id === systemId) this.intelTestReport = null;
    this.schedulePush();
  }

  /**
   * Settings → Intel → Test: a made-up hostile one jump away for 30 seconds, through the same path as a report, so
   * the strip, the graph and the sound can be checked without waiting for real intel.
   */
  private intelTest(): { ok: true; system: string } | { ok: false; error: string } {
    const origin = this.intelOriginId();
    if (!this.jumps || origin === null)
      return { ok: false, error: 'Your system is not known yet: it is read from the Local chat log.' };
    const next = this.jumps
      .neighbours(origin)
      .map((id) => this.jumps!.system(id)!)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    const here = this.jumps.system(origin)!;
    const sys = next ?? here;
    const now = Date.now();
    this.intelTestReport = {
      untilMs: now + 30_000,
      report: {
        system: { id: sys.id, name: sys.name },
        firstMs: now,
        lastMs: now,
        ships: ['Sabre'],
        count: 1,
        pilots: [{ name: 'Gridwise test', ship: 'Sabre' }],
        noVisual: false,
        tags: [],
        tagMs: {},
        essEndMs: null,
        essExact: false,
        gate: null,
        messages: 1,
        channel: 'test',
      },
    };
    this.schedulePush();
    setTimeout(() => this.schedulePush(), 30_500);
    return { ok: true, system: sys.name };
  }

  private async updateSde(): Promise<void> {
    if (this.sde.state === 'updating') return;
    const set = (message: string) => {
      this.sde = { ...this.sde, state: 'updating', message };
      this.schedulePush();
    };
    try {
      set('Checking for a new SDE build…');
      const latest = await fetchLatestSdeInfo();
      if (this.gd && this.gd.buildNumber === latest.buildNumber) {
        this.sde = { state: 'ready', build: latest.buildNumber, message: `Build ${latest.buildNumber} is up to date.` };
        this.schedulePush();
        return;
      }
      mkdirSync(cacheDir(), { recursive: true });
      const zip = join(cacheDir(), `sde-${latest.buildNumber}.zip`);
      if (!existsSync(zip)) {
        await downloadSdeZip(zip, {
          buildNumber: latest.buildNumber,
          onProgress: (got, total) =>
            set(
              `Downloading build ${latest.buildNumber}: ${(got / 1e6).toFixed(0)} / ${total ? (total / 1e6).toFixed(0) : '?'} MB`,
            ),
        });
      }
      set('Importing…');
      mkdirSync(join(dataDir(), 'sde'), { recursive: true });
      await importSdeZip(zip, sdeDbPath());
      this.openSde();
      this.loadKb();
      this.sde.message = `Imported build ${this.sde.build}.`;
    } catch (err) {
      this.sde = {
        state: this.gd ? 'ready' : 'error',
        build: this.gd?.buildNumber ?? null,
        message: `Update failed: ${String(err instanceof Error ? err.message : err)}`,
      };
    }
    this.schedulePush();
  }

  private updating = false;

  private updaterPaths(): UpdaterPaths {
    return {
      statePath: join(dataDir(), 'updates.json'),
      sdeDbPath: sdeDbPath(),
      cacheDir: cacheDir(),
      sourcesPath: join(app.getAppPath(), 'kb', 'sources.json'),
      bundledManifestPath: join(app.getAppPath(), 'kb', 'manifest.json'),
      updateDir: join(dataDir(), 'kb-updates'),
    };
  }

  /** `force` = the "Check now" button: ignores the intervals but still uses the polite clients. */
  private async runUpdates(force: boolean): Promise<void> {
    if (this.updating || (!force && !this.store.get().updates.auto)) return;
    this.updating = true;
    this.schedulePush();
    const onStatus = (msg: string) => {
      this.sde = { ...this.sde, message: msg };
      this.schedulePush();
    };
    try {
      const paths = this.updaterPaths();
      const newBuild = await updateSde(paths, this.gd?.buildNumber ?? null, { force, onStatus });
      if (newBuild !== null) {
        this.openSde();
        this.loadKb();
      }
      const updated = await updateKbFromWiki(paths, this.gd, { force, onStatus });
      if (updated) this.loadKb();
      this.sde = { ...this.sde, message: null };
    } finally {
      this.updating = false;
      this.schedulePush();
    }
  }

  // ---- overlay ------------------------------------------------------------------------------

  private applyClickThrough(on: boolean): void {
    // On Linux mouse events are simply ignored (no forwarding). Not focusable keeps focus with EVE.
    this.overlay.setIgnoreMouseEvents(on, { forward: true });
    this.overlay.setFocusable(!on);
    this.overlay.setAlwaysOnTop(true, 'screen-saver');
  }

  private setClickThrough(on: boolean): void {
    if (this.searchOpen) {
      this.clickThroughBeforeSearch = on;
    } else {
      this.applyClickThrough(on);
    }
    this.store.update({ overlay: { clickThrough: on } });
    this.schedulePush();
  }

  /**
   * Shows the overlay where the player left it. KWin places on-screen-display windows itself each time they are
   * mapped (first show and every show after a hide), so the saved bounds are applied again once it has done so.
   */
  private showOverlay(): void {
    const saved = this.store.get().overlay.minimized ? this.minimizedBounds() : this.store.get().overlay.bounds;
    this.overlay.showInactive();
    this.overlay.setAlwaysOnTop(true, 'screen-saver');
    if (saved) setTimeout(() => this.overlayWin.place(saved), 150);
  }

  private setOverlayVisible(visible: boolean): void {
    if (visible) this.showOverlay();
    else this.overlay.hide();
    this.store.update({ overlay: { visible } });
    this.refreshTray();
  }

  /** The minimized header: at the top of the work area, at its own x (kept on that display). */
  /** The minimized header goes where the panel stands, at the top of the work area. */
  private minimizedBounds(): Bounds {
    const o = this.store.get().overlay;
    const full = o.bounds ?? this.overlayWin.bounds();
    const b = { ...full, x: this.overlayWin.bounds().x, height: MINIMIZED_HEIGHT };
    const wa = screen.getDisplayMatching(b).workArea;
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width));
    return { ...b, x, y: wa.y, height: full.height };
  }

  /**
   * Minimized: only the header row at the top of the screen, so the shortcuts stay in sight; DPS, threats and
   * messages are not shown. The search opens the full panel again where it was.
   */
  private setMinimized(on: boolean): void {
    if (on === this.store.get().overlay.minimized) return;
    if (on) this.setSearchOpen(false);
    // Sideways the panel stays where it is: minimized under the panel, restored under the header.
    const x = this.overlayWin.bounds().x;
    this.store.update({ overlay: { minimized: on } });
    this.overlayWin.setMinimized(on);
    const full = this.store.get().overlay.bounds;
    let place = on ? this.minimizedBounds() : full;
    if (!on && full) {
      const wa = screen.getDisplayMatching(full).workArea;
      place = { ...full, x: Math.max(wa.x, Math.min(x, wa.x + wa.width - full.width)) };
      this.store.update({ overlay: { bounds: place } });
    }
    if (place) this.overlayWin.place(place);
    this.schedulePush();
  }

  /** Previous / next pocket of the selected encounter, without wrapping around. */
  private stepPocket(delta: number): void {
    const s = this.store.get();
    const brief = s.encounter.ref ? this.catalog.brief(s.encounter.ref) : null;
    if (!brief) return;
    const pocket = Math.max(0, Math.min(brief.pockets.length - 1, s.encounter.pocket + delta));
    this.store.update({ encounter: { pocket } });
    this.schedulePush();
  }

  private setSearchOpen(open: boolean): void {
    if (open === this.searchOpen) return;
    if (open) this.setMinimized(false);
    this.searchOpen = open;
    if (open) {
      this.clickThroughBeforeSearch = this.store.get().overlay.clickThrough;
      if (!this.overlay.isVisible()) this.showOverlay();
      this.applyClickThrough(false);
      this.overlay.focus();
    } else {
      this.applyClickThrough(this.clickThroughBeforeSearch);
      this.overlay.blur();
    }
    this.schedulePush();
  }

  // ---- fits ---------------------------------------------------------------------------------

  private saveFit(eft: string): { ok: true } | { ok: false; error: string } {
    if (!this.fitEngine) {
      return { ok: false, error: this.fitEngineState.error ?? 'The fit engine is still loading, try again.' };
    }
    const result = this.fitEngine.compute(eft);
    if (!result.ok) return result;
    const { shipName, fitName } = result.stats;
    const fit = {
      id: randomUUID(),
      eft,
      shipName,
      name: fitName,
      source: 'paste' as const,
      savedAt: new Date().toISOString(),
    };
    const fits = this.store.get().fits;
    this.store.update({
      fits: { saved: upsertFit(fits.saved, fit), activeId: fit.id, recent: touchRecentFit(fits.recent, fit.id) },
    });
    this.schedulePush();
    return { ok: true };
  }

  /** A hull's SDE type, group and faction, for renders and the Ship fit tree. */
  /**
   * EVE-83: the player switches a weapon type's charge or the drones in space; `reset` drops the fit's loadout.
   * Only names the fit's parts know are kept.
   */
  private changeLoadout(id: string, change: unknown): void {
    const { saved, loadout } = this.store.get().fits;
    if (!saved.some((f) => f.id === id) || typeof change !== 'object' || change === null) return;
    const c = change as {
      module?: unknown;
      charge?: unknown;
      drone?: unknown;
      count?: unknown;
      mode?: unknown;
      reset?: unknown;
    };
    const cur = loadout[id] ?? { charges: {}, drones: {} };
    let next: Loadout | null = { ...cur, charges: { ...cur.charges }, drones: { ...cur.drones } };
    if (c.reset === true) next = null;
    else if (typeof c.mode === 'string') next.mode = c.mode;
    else if (typeof c.module === 'string' && typeof c.charge === 'string') next.charges[c.module] = c.charge;
    else if (typeof c.drone === 'string' && Number.isInteger(c.count)) {
      // The first drone change fixes all drones at what is in space now, then changes this one.
      if (!Object.keys(next.drones).length)
        for (const d of this.fitCache?.parts?.drones ?? []) next.drones[d.name] = d.active;
      next.drones[c.drone] = Math.max(0, c.count as number);
    } else return;
    const rest = { ...loadout };
    if (next) rest[id] = next;
    else delete rest[id];
    // Replaced whole: a deep merge would keep a removed fit's entry.
    this.store.update({ fits: { loadout: null } });
    this.store.update({ fits: { loadout: rest } });
    this.schedulePush();
  }

  /** A character's in-game fittings into the saved fits (EVE-65); only stored when something changed. */
  private onEsiFittings(characterId: number, fittings: EsiFitting[]): void {
    if (!this.fitEngine) {
      this.pendingFittings.set(characterId, fittings);
      return;
    }
    const converted = fittings.flatMap((f) => {
      const e = this.fitEngine!.eftFromEsi(f);
      return e ? [{ fittingId: f.fitting_id, name: f.name, shipName: e.shipName, eft: e.eft }] : [];
    });
    const { saved } = this.store.get().fits;
    const next = syncEsiFits(saved, characterId, converted, new Date().toISOString());
    const key = (xs: SavedFit[]) => JSON.stringify(xs.map((f) => [f.id, f.eft, f.name]));
    if (key(next) === key(saved)) return;
    this.store.update({ fits: { saved: next } });
    this.schedulePush();
  }

  /** The EVE Workbench account's fits into the saved fits (EVE-86); only stored when something changed. */
  private onEwbFits(fits: EwbFitText[]): void {
    const { saved } = this.store.get().fits;
    const next = syncEwbFits(saved, fits, new Date().toISOString());
    const key = (xs: SavedFit[]) => JSON.stringify(xs.map((f) => [f.id, f.eft, f.name]));
    if (key(next) === key(saved)) return;
    const { activeId, recent } = this.store.get().fits;
    const ids = new Set(next.map((f) => f.id));
    this.store.update({
      fits: {
        saved: next,
        activeId: activeId && ids.has(activeId) ? activeId : null,
        recent: recent.filter((id) => ids.has(id)),
      },
    });
    this.schedulePush();
  }

  /** ESI says the pilot boarded another hull (EVE-65): its fit becomes active, or none when there is no fit for it. */
  private onBoarded(characterId: number, shipTypeId: number): void {
    const t = this.gd?.typeById(shipTypeId);
    if (!t || t.groupName === 'Capsule') return;
    const { saved, recent, activeId } = this.store.get().fits;
    const next = fitForHull(saved, recent, activeId, t.name);
    this.boarded = { characterId, shipName: t.name, shipTypeId };
    if (next !== activeId)
      this.store.update({ fits: { activeId: next, recent: next ? touchRecentFit(recent, next) : recent } });
    this.schedulePush();
  }

  /** The pilot's current hull, if ESI told it and it is still the pilot. */
  private flyingView(saved: SavedFit[]): FitPanelView['flying'] {
    const b = this.boarded;
    const pilot = this.esi.pilotId(this.tracker.active()?.characterId ?? null);
    if (!b || b.characterId !== pilot) return null;
    return { shipName: b.shipName, shipTypeId: b.shipTypeId, hasFit: saved.some((f) => f.shipName === b.shipName) };
  }

  /** The logged-in character the fit numbers use (EVE-38), or null for All V. */
  private pilot(): Pilot | null {
    return this.esi.pilot(this.tracker.active()?.characterId ?? null);
  }

  private hull(shipName: string): { shipTypeId: number | null; shipGroup: string | null; shipFaction: string | null } {
    const t = this.gd?.typesByName(shipName, CATEGORY_SHIP)[0];
    return {
      shipTypeId: t?.id ?? null,
      shipGroup: t?.groupName ?? null,
      shipFaction: t ? this.gd!.factionName(t.factionId) : null,
    };
  }

  private fitView(): FitPanelView {
    const { saved, activeId, recent } = this.store.get().fits;
    const fit = saved.find((f) => f.id === activeId) ?? null;
    let active: FitPanelView['active'] = null;
    if (fit) {
      const pilot = this.pilot();
      const loadout = this.store.get().fits.loadout[fit.id] ?? null;
      const key = JSON.stringify(loadout);
      const hit = (c: typeof this.fitCache) => c?.eft === fit.eft && c.pilot === pilot && c.loadout === key;
      if (this.fitEngine && !hit(this.fitCache))
        this.fitCache = {
          eft: fit.eft,
          pilot,
          loadout: key,
          result: this.fitEngine.compute(fit.eft, pilot, loadout),
          parts: this.fitEngine.loadoutView(fit.eft, loadout),
        };
      const c = hit(this.fitCache) ? this.fitCache : null;
      const r = c?.result ?? null;
      active = {
        id: fit.id,
        source: fit.source,
        savedAt: fit.savedAt,
        stats: r?.ok ? r.stats : null,
        error: r && !r.ok ? r.error : null,
        unknownLines: r?.ok ? r.unknownLines : [],
        parts: c?.parts ?? null,
        loadoutChanged: loadout !== null,
      };
    }
    const owners = new Map(this.esi.view().characters.map((c) => [c.characterId, c.name]));
    return {
      engine: this.fitEngineState.state,
      engineError: this.fitEngineState.error,
      saved: saved.map(({ id, name, shipName, savedAt, source, esi }) => ({
        id,
        name,
        shipName,
        savedAt,
        source,
        owner: esi ? (owners.get(esi.characterId) ?? null) : source === 'ewb' ? 'EVE Workbench' : null,
        ...this.hull(shipName),
      })),
      flying: this.flyingView(saved),
      quick: quickFits(saved, recent).map(({ id, name, shipName }) => ({
        id,
        name,
        shipName,
        shipTypeId: this.hull(shipName).shipTypeId,
      })),
      active,
    };
  }

  private selectEncounter(ref: EncounterRef | null): void {
    this.store.update({ encounter: { ref, pocket: 0 } });
    this.schedulePush();
  }

  // ---- tray, shortcuts, settings window -----------------------------------------------------

  private createTray(): void {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png'));
    this.tray = new Tray(icon);
    this.tray.setToolTip('Gridwise');
    this.refreshTray();
  }

  private refreshTray(): void {
    const s = this.store.get();
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Show overlay',
          type: 'checkbox',
          checked: s.overlay.visible,
          click: () => this.setOverlayVisible(!this.store.get().overlay.visible),
        },
        {
          label: 'Click-through',
          type: 'checkbox',
          checked: s.overlay.clickThrough,
          click: () => this.setClickThrough(!this.store.get().overlay.clickThrough),
        },
        { label: 'Search encounter…', click: () => this.setSearchOpen(true) },
        { type: 'separator' },
        { label: 'Settings…', click: () => this.showSettings() },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  }

  private registerShortcuts(): void {
    globalShortcut.unregisterAll();
    this.shortcutErrors = [];
    // Dev aid for the docs screenshots: show the default keys without taking them from a running instance.
    if (process.env.EVE_ASSISTANT_NO_SHORTCUTS) return;
    const s = this.store.get().shortcuts;
    const bind = (acc: string, fn: () => void) => {
      try {
        if (!globalShortcut.register(acc, fn)) this.shortcutErrors.push(`${acc} could not be registered`);
      } catch (err) {
        this.shortcutErrors.push(`${acc}: ${String(err)}`);
      }
    };
    bind(s.toggleClickThrough, () => this.setClickThrough(!this.store.get().overlay.clickThrough));
    bind(s.toggleOverlay, () => this.setOverlayVisible(!this.store.get().overlay.visible));
    bind(s.search, () => this.setSearchOpen(!this.searchOpen));
    bind(s.minimize, () => this.setMinimized(!this.store.get().overlay.minimized));
    bind(s.prevPocket, () => this.stepPocket(-1));
    bind(s.nextPocket, () => this.stepPocket(1));
    for (const e of this.shortcutErrors) console.warn(`shortcut: ${e}`);
  }

  /** Opens (or raises) the settings window; `nav` opens a tab there, e.g. the Abyss log at a run's loot. */
  private showSettings(nav?: SettingsNav): void {
    if (this.settingsWin && !this.settingsWin.isDestroyed()) {
      this.settingsWin.show();
      this.settingsWin.focus();
      if (nav) this.settingsWin.webContents.send('settings:navigate', nav);
      return;
    }
    const win = createSettingsWindow();
    this.settingsWin = win;
    win.on('closed', () => (this.settingsWin = null));
    if (nav) win.webContents.once('did-finish-load', () => win.webContents.send('settings:navigate', nav));
  }

  // ---- IPC and view model -------------------------------------------------------------------

  private registerIpc(): void {
    ipcMain.handle('vm:get', () => this.viewModel());
    ipcMain.handle('encounter:search', (_e, q: string) => this.catalog.search(String(q ?? '')));
    ipcMain.handle('encounter:select', (_e, ref: EncounterRef | null) => this.selectEncounter(ref));
    ipcMain.handle('sitemap:get', () => this.siteMapView());
    ipcMain.handle('abyss:get', () => this.abyss());
    ipcMain.handle('abyss:log', (): AbyssLogView => ({ entries: this.abyssLog(), ewbRuns: this.ewb.runs() }));
    ipcMain.handle('abyss:loot', (_e, id: unknown, text: unknown, before: unknown) =>
      this.saveLoot(String(id), String(text ?? ''), typeof before === 'string' ? before : undefined),
    );
    ipcMain.handle('abyss:cargo', (_e, which: unknown) =>
      this.cargoFromClipboard(which === 'after' ? 'after' : 'before'),
    );
    ipcMain.handle('abyss:upload', (_e, id: unknown) => this.uploadRun(String(id)));
    ipcMain.handle('abyss:lootDismiss', (_e, id: unknown) => {
      this.lootDismissed.add(String(id));
      this.schedulePush();
    });
    ipcMain.on('abyss:lootOpen', (_e, id: unknown) => this.showSettings({ tab: 'abyss-log', run: String(id) }));
    ipcMain.handle('ewb:setKey', (_e, key: unknown) => this.ewb.setKey(String(key ?? '')));
    ipcMain.handle('ewb:clearKey', () => this.ewb.clearKey());
    ipcMain.handle('ewb:sync', () => this.ewb.sync());
    ipcMain.handle('abyss:preview', (_e, on: unknown) => {
      this.abyssPreview = Boolean(on);
      if (this.abyssPreview) this.setSearchOpen(false);
      this.schedulePush();
    });
    ipcMain.handle('encounter:pocket', (_e, i: number) => {
      this.store.update({ encounter: { pocket: Math.max(0, Math.floor(Number(i) || 0)) } });
      this.schedulePush();
    });
    ipcMain.handle('intel:test', () => this.intelTest());
    ipcMain.handle('intel:destination', (_e, id: unknown) => this.intelSetDestination(Number(id)));
    ipcMain.handle('intel:clear', (_e, id: unknown) => this.intelClear(Number(id)));
    ipcMain.handle('settings:update', (_e, patch: SettingsPatch) => this.updateSettings(patch));
    ipcMain.handle('settings:pickLogDir', async () => {
      const res = await dialog.showOpenDialog({
        title: 'EVE Gamelogs directory',
        defaultPath: this.store.get().logDir,
        properties: ['openDirectory'],
      });
      const dir = res.canceled ? null : (res.filePaths[0] ?? null);
      if (dir) this.updateSettings({ logDir: dir });
      return dir;
    });
    ipcMain.handle('fit:loadout', (_e, id: unknown, change: unknown) => this.changeLoadout(String(id), change));
    ipcMain.handle('esi:sync', () => this.esi.syncNow());
    ipcMain.handle('esi:login', () => this.esi.startLogin());
    ipcMain.handle('esi:cancel', () => this.esi.cancelLogin());
    ipcMain.handle('esi:logout', (_e, id: unknown) => this.esi.logout(Number(id)));
    ipcMain.handle('fit:save', (_e, eft: unknown) => this.saveFit(String(eft ?? '')));
    ipcMain.handle('fit:select', (_e, id: unknown) => {
      const active = typeof id === 'string' ? id : null;
      const recent = this.store.get().fits.recent;
      this.store.update({ fits: { activeId: active, recent: active ? touchRecentFit(recent, active) : recent } });
      this.schedulePush();
    });
    ipcMain.handle('fit:remove', (_e, id: unknown) => {
      const { saved, activeId, recent } = this.store.get().fits;
      this.store.update({
        fits: {
          saved: saved.filter((f) => f.id !== id),
          activeId: activeId === id ? null : activeId,
          recent: recent.filter((x) => x !== id),
        },
      });
      this.schedulePush();
    });
    ipcMain.handle('overlay:clickThrough', (_e, on: boolean) => this.setClickThrough(Boolean(on)));
    ipcMain.handle('overlay:search', (_e, open: boolean) => this.setSearchOpen(Boolean(open)));
    let drag: OverlayDrag | null = null;
    ipcMain.on('overlay:dragStart', (_e, kind: string) => {
      drag = new OverlayDrag(this.overlayWin, kind === 'resize' ? 'resize' : 'move');
    });
    ipcMain.on('overlay:drag', () => drag?.update());
    ipcMain.on('overlay:dragEnd', (_e, size?: { width: number; height: number }) => {
      drag?.end(size);
      drag = null;
      this.saveOverlayBounds();
    });
    const rectsOf = (rects: unknown) =>
      Array.isArray(rects)
        ? rects
            .slice(0, 20)
            .filter((r) => ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r?.[k])))
            .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
        : [];
    ipcMain.on('overlay:below', (_e, rects: unknown) => this.overlayWin.setBelow(rectsOf(rects)));
    ipcMain.on('overlay:side', (_e, rects: unknown) => this.overlayWin.setSide(rectsOf(rects)));
    ipcMain.on('overlay:hide', () => this.setOverlayVisible(false));
    ipcMain.on('overlay:minimize', (_e, on: boolean) => this.setMinimized(Boolean(on)));
    ipcMain.handle('sde:update', () => this.updateSde());
    ipcMain.handle('updates:check', () => this.runUpdates(true));
    ipcMain.handle('app-update:check', () => this.appUpdater.check(true));
    ipcMain.handle('app-update:install', () => this.appUpdater.install());
    ipcMain.on('window:settings', () => this.showSettings());
    ipcMain.on('shell:open', (_e, url: string) => {
      if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url);
    });
  }

  private updateSettings(patch: SettingsPatch): void {
    const before = this.store.get();
    const after = this.store.update(patch);
    if (after.logDir !== before.logDir) this.startLogs();
    else if (JSON.stringify(after.intel.channels) !== JSON.stringify(before.intel.channels)) this.startIntel();
    this.syncZkill();
    if (this.intel) this.intel.board.expireMs = after.intel.expireMin * 60_000;
    if (after.overlay.opacity !== before.overlay.opacity) this.overlay.setOpacity(after.overlay.opacity);
    if (after.overlay.clickThrough !== before.overlay.clickThrough) this.setClickThrough(after.overlay.clickThrough);
    if (after.overlay.visible !== before.overlay.visible) this.setOverlayVisible(after.overlay.visible);
    if (JSON.stringify(after.shortcuts) !== JSON.stringify(before.shortcuts)) this.registerShortcuts();
    // Another EVE Workbench server (EVE-90) has its own keys and data: the key and what it read are dropped.
    if (after.ewb.apiBase !== before.ewb.apiBase) this.ewb.clearKey();
    // A lower retention removes the older runs at once (the tab says so next to the setting).
    if (after.abyss.logKeep < before.abyss.logKeep) this.saveAbyssLog(pruneLog(this.abyssLog(), after.abyss.logKeep));
    this.refreshTray();
    this.schedulePush();
  }

  /** Lookups for threats and loot, rebuilt when the selected encounter or the data changes. */
  private lookups(): { ctx: ThreatContext; loot: LootLookup } {
    const ref = this.store.get().encounter.ref;
    const key = `${JSON.stringify(ref)}|${this.gd?.buildNumber ?? '-'}|${this.catalog.size}`;
    if (this.threatCtx?.key !== key) {
      const enc = ref?.source === 'kb' ? this.catalog.encounter(ref.id) : null;
      this.threatCtx = { key, ctx: buildThreatContext(enc, this.gd), loot: buildLootLookup(enc, this.gd) };
    }
    return this.threatCtx;
  }

  private viewModel(): AppViewModel {
    const s = this.store.get();
    const brief = s.encounter.ref ? this.catalog.brief(s.encounter.ref) : null;
    const active = this.tracker.active();
    const st = this.logStatus;
    const fit = this.fitView();
    const fitStats = fit.active?.stats;
    // The active fit's capacitor turns the neut rate into "cap lasts …" (EVE-64).
    const ctx: ThreatContext = {
      ...this.lookups().ctx,
      capacitor: fitStats ? { shipName: fitStats.shipName, ...fitStats.capacitor } : null,
    };
    return {
      log: {
        state: st?.state ?? 'starting',
        dir: s.logDir,
        error: st?.error ?? null,
        files: st?.files.length ?? 0,
      },
      characters: this.tracker.characters(),
      sde: this.sde,
      updates: {
        ...readState(this.updaterPaths().statePath),
        auto: s.updates.auto,
        app: s.updates.app,
        running: this.updating,
      },
      appUpdate: this.appUpdater.current,
      kb: { encounters: this.catalog.size, issues: this.kbIssues },
      brief,
      pocket: brief ? Math.min(s.encounter.pocket, Math.max(0, brief.pockets.length - 1)) : 0,
      activeCharacter: active?.character ?? null,
      liveCombat: LIVE_COMBAT,
      // Without the live combat cues (build switch), no rows of EWAR seen on us; what the NPCs can do (known) and the
      // trigger hits stay (buildFlags.ts).
      threats: active
        ? assessThreats(active.combat.engagement(active.nowMs), active.nowMs, ctx).filter(
            (t) => LIVE_COMBAT || t.basis === 'known' || t.id.startsWith('trigger-'),
          )
        : [],
      messages: active ? timedMessages(active.combat.engagement(active.nowMs), active.nowMs, ctx, this.renderText) : [],
      loot: active ? lootAlerts(active.combat.latestEngagement(active.nowMs), active.nowMs, this.lookups().loot) : [],
      combat: active ? active.combat.stats(active.nowMs) : null,
      application: active ? this.applicationHints(active.combat.engagement(active.nowMs), active.nowMs) : [],
      overlay: { clickThrough: s.overlay.clickThrough, searchOpen: this.searchOpen, minimized: s.overlay.minimized },
      fit,
      fitCheck: fitStats && brief ? checkFitAgainstSite(fitStats, brief.damage) : null,
      abyss: this.abyssView(active, fitStats ?? null),
      abyssLogVersion: this.abyssLogVersion,
      esi: this.esi.view(),
      ewb: this.ewb.view(),
      lootPrompt: this.lootPrompt(),
      abyssCargo: this.cargoView(),
      intel: this.intelView(),
      settings: s,
      diagnostics: {
        ...this.tracker.diagnostics(),
        platform: { ...platformInfo(), version: app.getVersion() },
        shortcutErrors: this.shortcutErrors,
        overlayLayer: s.overlay.aboveFullscreen
          ? (this.overlayLayerNote ?? 'above fullscreen windows (KWin on-screen-display layer)')
          : 'normal always-on-top',
      },
    };
  }

  private schedulePush(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      const vm = this.viewModel();
      for (const w of [this.overlay, this.settingsWin]) if (w && !w.isDestroyed()) w.webContents.send('vm', vm);
    }, PUSH_INTERVAL_MS);
  }
}
