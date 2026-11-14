/** User settings (task 007). Dependency-free: shared by main and renderers. */
import { WEATHER_IDS, type AbyssPrivacy, type WeatherId } from './abyss/types';

export const SETTINGS_VERSION = 2;

export type OverlaySection = 'header' | 'encounter' | 'threats' | 'loot' | 'combat';

/** How waves are shown: name lists, ship image tiles, or one row of size icons with counts per wave. */
export type WaveView = 'names' | 'tiles' | 'ultra';
export const WAVE_VIEWS: readonly WaveView[] = ['names', 'tiles', 'ultra'];

/** Brief header: full until scrolled, then condensed (scroll), or always condensed (compact). */
export type HeaderMode = 'scroll' | 'compact';
export const HEADER_MODES: readonly HeaderMode[] = ['scroll', 'compact'];

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What stays visible while the overlay is minimized (Settings → Overlay). */
export interface MinimizedShow {
  threats: boolean;
  messages: boolean;
  intel: boolean;
  /** Rare loot alerts: faction, officer, overseer NPCs in the fight, one line each. */
  loot: boolean;
  /** DPS and damage application. */
  combat: boolean;
}

export interface Settings {
  version: number;
  logDir: string;
  overlay: {
    visible: boolean;
    bounds: Bounds | null;
    /** 0.2–1, applied to the whole overlay window. */
    opacity: number;
    clickThrough: boolean;
    sections: Record<OverlaySection, boolean>;
    waveView: WaveView;
    /** KDE: put the overlay in the on-screen-display layer so it stays above a focused fullscreen game. */
    aboveFullscreen: boolean;
    /** Tone of the timed messages: 0 plain … 3 pure sarcasm (messages/messages.yaml). */
    sarcasm: number;
    /** Only the header, stuck to the top of the screen; `bounds` keeps the full panel for restoring it. */
    minimized: boolean;
    /** Left edge of the minimized header (it only moves sideways); null = the full panel's x. */
    minimizedX: number | null;
    headerMode: HeaderMode;
    /** What still shows below the minimized header: EWAR warnings, timed messages, quick intel (EVE-98). */
    /** The strips kept below the header row while minimized; each also needs its section on. */
    minimizedShow: MinimizedShow;
  };
  shortcuts: {
    toggleClickThrough: string;
    toggleOverlay: string;
    search: string;
    minimize: string;
    prevPocket: string;
    nextPocket: string;
  };
  /** Unattended data updates (SDE daily, wiki weekly); `app`: look for new app versions and download them. */
  updates: { auto: boolean; app: boolean };
  /** Last selected encounter, restored on start. */
  encounter: { ref: EncounterRef | null; pocket: number };
  /** Fits the player pasted (EVE-39); the active one is the ship the fit checks assume. */
  fits: {
    saved: SavedFit[];
    activeId: string | null;
    recent: string[];
    /** Ammo and drones the player picked per fit (EVE-83), kept apart so an ESI sync does not undo them. */
    loadout: Record<string, Loadout>;
  };
  /** The filament the player runs (EVE-75); the logs do not tell weather or tier. */
  abyss: {
    weather: WeatherId | null;
    tier: number | null;
    /** Abyss log retention (EVE-89): the newest runs kept per tier and weather. */
    logKeep: number;
  };
  /** EVE SSO (EVE-38): the client ID of the app registration on developers.eveonline.com (decision EVE-D7). */
  esi: { clientId: string };
  /**
   * EVE Workbench (EVE-86): who may see uploaded Abyss runs, and the API server (EVE-90: the live one, or e.g. a
   * staging server for trying the upload). The key itself is kept encrypted, not here.
   */
  ewb: { privacy: AbyssPrivacy; apiBase: string };
  /** Player intel channels (EVE-95, decision EVE-D8). */
  intel: IntelSettings;
}

export type IntelSound = 'beep' | 'double' | 'chime' | 'alarm';
export const INTEL_SOUNDS: readonly IntelSound[] = ['beep', 'double', 'chime', 'alarm'];

export interface IntelAlertSetting {
  on: boolean;
  /** Sounds for a report this many jumps away or closer. */
  jumps: number;
  sound: IntelSound;
}

export interface IntelSettings {
  /** Chat channel names as the game shows them, e.g. "Region.Intel". */
  channels: string[];
  /** Reports farther than this many jumps are not shown (1–10; capital pilots look farther). */
  range: number;
  /** A report goes after this many minutes without a new message about the system. */
  expireMin: number;
  /** Two sound levels by distance (EVE-99): a notice farther out, a warning close by. */
  notice: IntelAlertSetting;
  warning: IntelAlertSetting;
  /** 0–1. */
  volume: number;
  /** The strip as a list of reports or as a jump graph around the pilot (EVE-102). */
  view: 'list' | 'graph';
  /** System names on the graph: only where there is something (you, a report, a kill, the destination) or all. */
  graphNames: 'marked' | 'all';
  /** zKillboard kills nearby (EVE-100): never, when the intel channels are quiet, or always. */
  zkill: { mode: ZkillMode; quietMin: number; keepMin: number };
  /** EVE-103: Ctrl+click on the graph sets the in-game destination (needs the ESI waypoint scope). */
  destination: boolean;
}

export type ZkillMode = 'off' | 'quiet' | 'always';
export const ZKILL_MODES: readonly ZkillMode[] = ['off', 'quiet', 'always'];

export const DEFAULT_INTEL_RANGE = 5;
export const MAX_INTEL_RANGE = 10;
export const DEFAULT_INTEL_EXPIRE_MIN = 10;
export const MAX_INTEL_EXPIRE_MIN = 60;

/** A fit as the player gave it. Stats are recomputed from `eft`, so engine updates apply to old fits too. */
export interface SavedFit {
  id: string;
  /** EFT text: in-game Fitting window → Copy to clipboard. */
  eft: string;
  shipName: string;
  name: string;
  /**
   * paste = EFT pasted by the player; esi = a fitting saved in game, synced from ESI (EVE-65); ewb = a fit on the
   * player's EVE Workbench account (EVE-86).
   */
  source: 'paste' | 'esi' | 'ewb';
  /** When it was pasted or first seen in ESI (wall clock, ISO). */
  savedAt: string;
  /** For ESI fittings: whose they are and their in-game id. */
  esi?: { characterId: number; fittingId: number };
  /** For EVE Workbench fits: the fit's id there, and its hashes (a change fetches the EFT again). */
  ewb?: { fitId: string; hash: string };
}

/**
 * What the player changed on a fit without editing it (EVE-83): the charge per weapon type (all weapons of a type
 * load the same, as grouped in game), and how many drones of each type are in space.
 */
export interface Loadout {
  charges: Record<string, string>;
  drones: Record<string, number>;
  /** Tactical destroyers (EVE-85): the mode's type name, e.g. "Jackdaw Sharpshooter Mode". */
  mode?: string;
}

/** EVE Workbench's live API server (EVE-86). */
export const DEFAULT_EWB_API = 'https://api.eveworkbench.com';

/** An API server as typed: https only, no trailing slash; null when it is not one. */
export function normalizeApiBase(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.search || u.hash) return null;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Abyss runs kept per tier and weather (EVE-89); the setting goes up to the max. */
export const DEFAULT_ABYSS_LOG_KEEP = 10;
export const MAX_ABYSS_LOG_KEEP = 100;

/** Pasted fits kept; ESI and EVE Workbench fits are not counted, they follow what those hold. */
export const MAX_SAVED_FITS = 50;

/**
 * A character's ESI fittings replace their earlier copies (EVE-65): new ones are added, changed ones updated, and
 * ones deleted in game go. A fit keeps its id and first-seen time, so `recent` and the active fit survive a sync.
 */
export function syncEsiFits(
  saved: readonly SavedFit[],
  characterId: number,
  fittings: readonly { fittingId: number; name: string; shipName: string; eft: string }[],
  nowIso: string,
): SavedFit[] {
  const mine = (f: SavedFit) => f.source === 'esi' && f.esi?.characterId === characterId;
  const old = new Map(saved.filter(mine).map((f) => [f.esi!.fittingId, f]));
  const synced: SavedFit[] = fittings.map((x) => ({
    id: `esi-${characterId}-${x.fittingId}`,
    eft: x.eft,
    shipName: x.shipName,
    name: x.name,
    source: 'esi',
    savedAt: old.get(x.fittingId)?.savedAt ?? nowIso,
    esi: { characterId, fittingId: x.fittingId },
  }));
  return [...saved.filter((f) => !mine(f)), ...synced];
}

/**
 * The account's EVE Workbench fits replace their earlier copies (EVE-86), like ESI fittings: a fit keeps its id and
 * first-seen time.
 */
export function syncEwbFits(
  saved: readonly SavedFit[],
  fits: readonly { fitId: string; hash: string; name: string; shipName: string; eft: string }[],
  nowIso: string,
): SavedFit[] {
  const old = new Map(saved.filter((f) => f.source === 'ewb').map((f) => [f.ewb!.fitId, f]));
  const synced: SavedFit[] = fits.map((x) => ({
    id: `ewb-${x.fitId}`,
    eft: x.eft,
    shipName: x.shipName,
    name: x.name,
    source: 'ewb',
    savedAt: old.get(x.fitId)?.savedAt ?? nowIso,
    ewb: { fitId: x.fitId, hash: x.hash },
  }));
  return [...saved.filter((f) => f.source !== 'ewb'), ...synced];
}

/**
 * The fit to make active when ESI says the pilot boarded `shipName`: the active one if it is for that hull, else
 * the hull's fit used last, else its newest; null when there is no fit for it (a wrong fit gives wrong advice).
 */
export function fitForHull(
  saved: readonly SavedFit[],
  recent: readonly string[],
  activeId: string | null,
  shipName: string,
): string | null {
  const hull = saved.filter((f) => f.shipName === shipName);
  if (hull.some((f) => f.id === activeId)) return activeId;
  const used = recent.find((id) => hull.some((f) => f.id === id));
  if (used) return used;
  return [...hull].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]?.id ?? null;
}

/**
 * Adds a fit, replacing the one with the same ship and name (a re-paste after a refit), newest first.
 * Beyond the limit the oldest ones go.
 */
export function upsertFit(saved: readonly SavedFit[], fit: SavedFit): SavedFit[] {
  const same = (f: SavedFit) => f.source === 'paste' && f.shipName === fit.shipName && f.name === fit.name;
  return capPasted([fit, ...saved.filter((f) => !same(f))]);
}

/** Fits made active lately, for the overlay's quick ship select (EVE-81). */
export const RECENT_FITS = 4;

/** `recent` after making `id` active: it moves to the front. */
export function touchRecentFit(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_FITS);
}

/** The quick ship select: the fits used last, plus the one pasted last when it is not among them. */
export function quickFits(saved: readonly SavedFit[], recent: readonly string[]): SavedFit[] {
  const byId = new Map(saved.map((f) => [f.id, f]));
  const out = recent.map((id) => byId.get(id)).filter((f): f is SavedFit => !!f);
  const newest = [...saved].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  if (newest && !out.includes(newest)) out.push(newest);
  return out;
}

/** At most MAX_SAVED_FITS pasted fits (the first ones, i.e. the newest); ESI fittings all stay. */
function capPasted(fits: SavedFit[]): SavedFit[] {
  let n = 0;
  return fits.filter((f) => f.source !== 'paste' || ++n <= MAX_SAVED_FITS);
}

function isSavedFit(v: unknown): v is SavedFit {
  if (!isPlainObject(v)) return false;
  return (
    ['id', 'eft', 'shipName', 'name', 'savedAt'].every((k) => typeof v[k] === 'string') &&
    (v.source === 'paste' ||
      (v.source === 'esi' && isPlainObject(v.esi)) ||
      (v.source === 'ewb' && isPlainObject(v.ewb)))
  );
}

/** Points at an encounter: a KB entry, or SDE data when the KB has nothing. */
export type EncounterRef =
  { source: 'kb'; id: string } | { source: 'sdeMission'; name: string } | { source: 'sdeDungeon'; id: number };

/** Where EVE writes its game logs: the Steam/Proton prefix on Linux, Documents on Windows and macOS. */
export function defaultLogDir(home: string, platform = 'linux'): string {
  if (platform === 'win32') return `${home}\\Documents\\EVE\\logs\\Gamelogs`;
  if (platform === 'darwin') return `${home}/Documents/EVE/logs/Gamelogs`;
  return `${home}/.local/share/Steam/steamapps/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs/Gamelogs`;
}

/**
 * The project's own app registration (callback http://localhost:47913/eveassistant, the EVE-D7 scopes). A client ID
 * is public with PKCE, there is no secret; players can put their own registration in Settings → EVE login.
 */
export const DEFAULT_ESI_CLIENT_ID = 'b0a59c56165f4c4fbc7bcb39dfef97be';

export const DEFAULT_SHORTCUTS: Settings['shortcuts'] = {
  toggleClickThrough: 'CommandOrControl+Alt+O',
  toggleOverlay: 'CommandOrControl+Alt+H',
  search: 'CommandOrControl+Alt+F',
  minimize: 'CommandOrControl+Alt+M',
  prevPocket: 'CommandOrControl+Alt+X',
  nextPocket: 'CommandOrControl+Alt+C',
};

export function defaultSettings(home: string, platform = 'linux'): Settings {
  return {
    version: SETTINGS_VERSION,
    logDir: defaultLogDir(home, platform),
    overlay: {
      visible: true,
      bounds: null,
      opacity: 0.92,
      clickThrough: false,
      sections: { header: true, encounter: true, threats: true, loot: true, combat: true },
      waveView: 'names',
      aboveFullscreen: true,
      sarcasm: 0,
      minimized: false,
      minimizedX: null,
      headerMode: 'scroll',
      minimizedShow: { threats: false, messages: false, intel: true, loot: true, combat: false },
    },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    updates: { auto: true, app: true },
    encounter: { ref: null, pocket: 0 },
    fits: { saved: [], activeId: null, recent: [], loadout: {} },
    abyss: { weather: null, tier: null, logKeep: DEFAULT_ABYSS_LOG_KEEP },
    esi: { clientId: DEFAULT_ESI_CLIENT_ID },
    ewb: { privacy: 'private', apiBase: DEFAULT_EWB_API },
    intel: {
      channels: [],
      range: DEFAULT_INTEL_RANGE,
      expireMin: DEFAULT_INTEL_EXPIRE_MIN,
      notice: { on: true, jumps: 5, sound: 'beep' },
      warning: { on: true, jumps: 2, sound: 'alarm' },
      volume: 0.6,
      view: 'list',
      graphNames: 'marked',
      zkill: { mode: 'quiet', quietMin: 5, keepMin: 15 },
      destination: false,
    },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> | null : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merges `patch` into `base`. Arrays and null replace; unknown keys of `base` are kept. */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : v;
  }
  return out as T;
}

/**
 * Turns whatever was stored into valid current settings: unknown versions are migrated step by step,
 * missing fields get defaults, out-of-range values are clamped.
 */
export function migrateSettings(stored: unknown, home: string, platform = 'linux'): Settings {
  const defaults = defaultSettings(home, platform);
  if (!isPlainObject(stored)) return defaults;
  const old = stored.overlay;
  // v1 → v2: the compactWaves toggle became waveView.
  if (isPlainObject(old) && 'compactWaves' in old) {
    const { compactWaves, ...rest } = old;
    stored = { ...stored, overlay: { waveView: compactWaves ? 'tiles' : 'names', ...rest } };
  }
  const s = mergeSettings(defaults, stored);
  s.version = SETTINGS_VERSION;
  s.overlay.opacity = Math.min(1, Math.max(0.2, Number(s.overlay.opacity) || defaults.overlay.opacity));
  if (!WAVE_VIEWS.includes(s.overlay.waveView)) s.overlay.waveView = defaults.overlay.waveView;
  s.overlay.sarcasm = Math.min(3, Math.max(0, Math.round(Number(s.overlay.sarcasm) || 0)));
  s.overlay.minimized = s.overlay.minimized === true;
  if (!Number.isFinite(s.overlay.minimizedX)) s.overlay.minimizedX = null;
  if (!HEADER_MODES.includes(s.overlay.headerMode)) s.overlay.headerMode = defaults.overlay.headerMode;
  s.overlay.minimizedShow = {
    threats: s.overlay.minimizedShow?.threats === true,
    messages: s.overlay.minimizedShow?.messages === true,
    intel: s.overlay.minimizedShow?.intel !== false,
    loot: s.overlay.minimizedShow?.loot !== false,
    combat: s.overlay.minimizedShow?.combat === true,
  };
  if (typeof s.logDir !== 'string' || !s.logDir) s.logDir = defaults.logDir;
  s.fits.saved = Array.isArray(s.fits.saved) ? capPasted(s.fits.saved.filter(isSavedFit)) : [];
  if (!s.fits.saved.some((f) => f.id === s.fits.activeId)) s.fits.activeId = null;
  s.fits.loadout = isPlainObject(s.fits.loadout)
    ? Object.fromEntries(
        Object.entries(s.fits.loadout).filter(
          ([id, l]) =>
            s.fits.saved.some((f) => f.id === id) &&
            isPlainObject(l) &&
            isPlainObject(l.charges) &&
            isPlainObject(l.drones),
        ),
      )
    : {};
  s.fits.recent = Array.isArray(s.fits.recent)
    ? s.fits.recent.filter((id) => s.fits.saved.some((f) => f.id === id)).slice(0, RECENT_FITS)
    : [];
  if (!WEATHER_IDS.includes(s.abyss.weather as WeatherId)) s.abyss.weather = null;
  if (!(Number.isInteger(s.abyss.tier) && s.abyss.tier! >= 0 && s.abyss.tier! <= 6)) s.abyss.tier = null;
  s.abyss.logKeep = Number.isInteger(s.abyss.logKeep)
    ? Math.min(MAX_ABYSS_LOG_KEEP, Math.max(1, s.abyss.logKeep))
    : DEFAULT_ABYSS_LOG_KEEP;
  if (typeof s.esi?.clientId !== 'string') s.esi = { clientId: defaults.esi.clientId };
  s.ewb = {
    privacy: s.ewb?.privacy === 'public' ? 'public' : 'private',
    apiBase: normalizeApiBase(s.ewb?.apiBase) ?? DEFAULT_EWB_API,
  };
  s.intel = normalizeIntel(s.intel, defaults.intel);
  return s;
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) =>
  Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt;

function normalizeIntel(v: IntelSettings | undefined, d: IntelSettings): IntelSettings {
  const alert = (a: IntelAlertSetting | undefined, da: IntelAlertSetting): IntelAlertSetting => ({
    on: typeof a?.on === 'boolean' ? a.on : da.on,
    jumps: clampInt(a?.jumps, 0, MAX_INTEL_RANGE, da.jumps),
    sound: INTEL_SOUNDS.includes(a?.sound as IntelSound) ? a!.sound : da.sound,
  });
  const channels = Array.isArray(v?.channels)
    ? [
        ...new Set(
          v.channels
            .filter((c) => typeof c === 'string')
            .map((c) => c.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  return {
    channels,
    range: clampInt(v?.range, 1, MAX_INTEL_RANGE, d.range),
    expireMin: clampInt(v?.expireMin, 1, MAX_INTEL_EXPIRE_MIN, d.expireMin),
    notice: alert(v?.notice, d.notice),
    warning: alert(v?.warning, d.warning),
    volume: Number.isFinite(Number(v?.volume)) ? Math.min(1, Math.max(0, Number(v!.volume))) : d.volume,
    view: v?.view === 'graph' ? 'graph' : 'list',
    graphNames: v?.graphNames === 'all' ? 'all' : 'marked',
    zkill: {
      mode: ZKILL_MODES.includes(v?.zkill?.mode as ZkillMode) ? v!.zkill.mode : d.zkill.mode,
      quietMin: clampInt(v?.zkill?.quietMin, 1, 60, d.zkill.quietMin),
      keepMin: clampInt(v?.zkill?.keepMin, 5, 120, d.zkill.keepMin),
    },
    destination: typeof v?.destination === 'boolean' ? v.destination : d.destination,
  };
}
