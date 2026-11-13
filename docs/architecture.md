# Architecture

Status: accepted for MVP (task 002, 2026-10-20). Changes go through a task note.

## 1. Principles

- **Passive.** Inputs: Game Log files, SDE, knowledge base, ESI (optional), the player. Output: pixels on the overlay. Nothing else.
- **Core without Electron.** All logic (parsing, state, rules) lives in `src/core`, a plain TypeScript library with no
  Electron imports. It runs in Electron's main process, in Vitest, and in a headless CLI (replay, debugging).
- **One process for logic.** The main process hosts the core. Renderers only display view models and send commands.
  No workers or services unless measurements show a need.
- **Every fact knows where it came from** (observed / player / ESI / KB verified / KB inferred / unknown). See §5.
- **Deterministic.** The same event stream and inputs give the same state and the same warnings. Time comes from
  event timestamps, not from the wall clock, so replay equals live.

## 2. Process model

```
┌──────────────────────────── Electron main process ─────────────────────────────┐
│                                                                                │
│  LogWatcher ─raw lines─▶ LogParser ─GameEvent─▶ SessionStateManager            │
│      ▲                                              │   ▲      ▲               │
│  Gamelogs dir                                       │   │      │               │
│                                    EncounterContext │   │      │ ShipContext   │
│  GameDataService (SDE, SQLite) ◀──── lookups ───────┤   │      │ (ESI / fit)   │
│  KnowledgeBase (YAML) ◀───────────── lookups ───────┤   │  EsiClient (opt.)    │
│                                                     ▼   │                      │
│                                        ThreatEngine / Recommendations          │
│                                                     │                          │
│                              ViewModelBuilder (throttled, ≤ 4 Hz)              │
│  Settings (JSON) · SecretStore (safeStorage)        │                          │
└─────────────────────────────────────────────────────┼──────────────────────────┘
                                    IPC (typed)        │        ▲ commands
                          ┌─────────────────────────┐  ▼        │
                          │ Overlay window (React)  │◀─────────┤
                          └─────────────────────────┘           │
                          ┌─────────────────────────┐           │
                          │ Settings window (React) │───────────┘
                          └─────────────────────────┘
```

The overlay and settings windows are independent: either can be shown or hidden without the other.
A tray icon and global shortcuts control both.

## 3. Components

| #   | Component             | Module                                | Responsibility                                                                                                                                                                                                                                        |
| --- | --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Log Watcher           | `core/logs/watcher`                   | Watch dir (fs.watch + polling fallback), tail files by byte offset, buffer partial lines, detect new/rotated/truncated files, read header (`Listener`, character ID from file name)                                                                   |
| 2   | Log Parser            | `core/logs/parser`                    | Raw line → `GameEvent` (see `docs/log-format.md`, task 003). Markup-tolerant. Unknown lines become `Unknown` events and are never dropped                                                                                                             |
| 3   | Game Data Service     | `core/sde`                            | Import of the official SDE JSONL zip into SQLite (`node:sqlite`), update by build number, lookups (types, groups, NPC dogma, missions, dungeons, type lists)                                                                                          |
| 4   | Knowledge Base        | `core/kb` + `kb/`                     | YAML encounter definitions, schema validation, merge of bundled and user KB, name/variant resolution                                                                                                                                                  |
| 5   | Encounter Recognition | `core/encounter`                      | MVP: player selection via search (task 017). Later: candidates from NPC composition with confidence                                                                                                                                                   |
| 6   | Threat Engine         | `core/threats`                        | Declarative rules over state + KB + SDE → `Assessment` (INFO/CAUTION/DANGER, explanation, evidence, expiry)                                                                                                                                           |
| 7   | Session State Manager | `core/session`                        | Per character: location, NPCs seen, combat phases, statistics, encounter and ship context                                                                                                                                                             |
| 8   | Overlay UI            | `renderer/overlay`                    | Compact sections: Header, Encounter, Threats, Recommendations, Combat; search panel                                                                                                                                                                   |
| 9   | Settings              | `main/settings` + `renderer/settings` | Typed settings with versioned migrations, settings window, diagnostics                                                                                                                                                                                |
| 10  | ESI (optional)        | `core/esi` + `main/auth`              | SSO PKCE, ship/location polling, fittings, assets (tasks 021, 022)                                                                                                                                                                                    |
| 11  | Fit stats             | `core/fit`                            | EFT paste → fitting-window numbers (EHP, resists, cap, DPS) via eve-fit-engine (GPL-3.0-or-later, own SDE extract), All V until ESI skills (EVE-62). Pasted fits live in the settings (`fits`), the active one is recomputed when it changes (EVE-39) |

Electron-specific glue (windows, tray, shortcuts, IPC, safeStorage, file dialogs) lives in `src/main` only.

## 4. Data flow and timing

1. The watcher emits `RawLine {file, offset, text}` as soon as a complete CRLF-terminated line is available.
2. The parser emits `GameEvent`s; continuation lines are merged into the previous entry. Because of that, an entry is
   emitted when the next entry starts or after a short idle flush (≈250 ms).
3. The session manager applies events in order per file. Different characters are independent sessions.
4. Every applied event triggers rule evaluation on the affected session. Rules are cheap and synchronous.
5. The view model builder diffs and pushes at most 4 times per second. The overlay never receives raw events.

Replay (task 011) feeds the same pipeline. It either copies a file into a temp dir at N× speed (tests the real watcher)
or calls the parser and session manager directly, without the watcher (headless CLI, tests).

## 5. Provenance model

Every value shown to the player is wrapped:

```ts
type Basis = 'observed' | 'player' | 'esi' | 'kb-verified' | 'kb-inferred' | 'sde' | 'estimate' | 'unknown';

interface Fact<T> {
  value: T | null; // null when basis = 'unknown'
  basis: Basis;
  source?: string; // log file + line, KB entry + URL, ESI endpoint, …
  at?: string; // ISO time it was established (event time, not wall clock)
}
```

Rules that follow from this:

- An NPC with a known EWAR capability (SDE/KB) creates a _capability_ threat. It becomes _active_ only when the log
  shows evidence (`Warp scramble attempt from X`).
- Missing evidence never becomes a negative fact. The UI says "not observed" and never "none" or "safe".
- Estimates (time to kill, observed DPS) carry `basis: 'estimate'` or `'observed'` and are labelled in the UI.
- Timed messages (`core/threats/messages.ts`) speak only when a situation lasts (neut 3 min, jam 1 min, web/damp/TD/
  GD/paint 2 min), when it ends (30 s quiet), or on an event (two triggers shot within a minute, a 5-minute fight with
  several kinds of threat). Each shows for 60 s or until closed. Webs and other unlogged EWAR come from known capabilities of NPCs that
  keep attacking, and say so. Like the threat engine they are a pure function of the engagement and the time.

## 6. Storage

| Data            | Where                                             | Format                                                                                                      |
| --------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Settings        | `$XDG_CONFIG_HOME/gridwise/settings.json`         | JSON with a `version` field, atomic write (tmp + rename)                                                    |
| SDE index       | `$XDG_DATA_HOME/gridwise/sde/sde-<build>.sqlite`  | SQLite (`node:sqlite`), English texts only, needed tables only                                              |
| Bundled KB      | `kb/` in the app (CC BY-SA 4.0, own `kb/LICENSE`) | YAML, one file per encounter                                                                                |
| User KB         | `$XDG_DATA_HOME/gridwise/kb/`                     | YAML, overrides/extends bundled entries                                                                     |
| ESI tokens      | `$XDG_CONFIG_HOME/gridwise/tokens.bin`            | encrypted with Electron `safeStorage` (KWallet/libsecret). If unavailable: no persistence, re-login per run |
| Session history | memory only in MVP                                | later: per-session summary JSON                                                                             |

`node:sqlite` is built into Electron 44 (Node 24.22). No native module, so no rebuild per Electron version.

## 7. Tech stack

| Concern    | Choice                                         | Why                                                             |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Shell      | Electron 44                                    | brief requirement; XWayland mode for the overlay (task 001)     |
| Language   | TypeScript (strict)                            | shared types for events, view models, IPC                       |
| Build      | electron-vite                                  | main/preload/renderer in one config, fast dev reload            |
| UI         | React + plain CSS (CSS variables)              | mainstream and maintainable; the overlay is small, so no UI kit |
| DB         | `node:sqlite`                                  | no native deps                                                  |
| KB format  | YAML + JSON Schema (ajv)                       | human-editable, validated with exact error paths                |
| SDE import | `yauzl` (streaming unzip) + line-by-line JSONL | 581 MB unpacked; never fully in memory                          |
| Tests      | Vitest                                         | unit + replay fixtures                                          |
| Lint       | ESLint + Prettier                              |                                                                 |

## 8. IPC and window security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; one preload per window with a typed, minimal API.
- Main → renderer: `viewModel` (full snapshot), `settings`.
- Renderer → main: commands (`selectEncounter`, `setClickThrough`, `search`, `updateSettings`, …), validated in main.
- No remote content is loaded in windows. The SSO login opens the system browser and uses a loopback redirect.

## 9. Data source reliability

| Source            | Reliable for                                                                                                                                            | Not available / unreliable                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Game Logs         | Damage in/out with weapon/ammo and hit quality, misses, incoming scram/point/ECM/neut, own nos, bounties, reloads, out of charges, system jumps, undock | Kills (only proxies), webs/damps/TD/painters (not seen in 111k lines), ship, fit, cap/shield/armor, mission/site, warps, damage to drones |
| SDE               | Types, groups, NPC attributes (damage, resists, EWAR modules via dogma), mission names/objective items/rewards, site names/DED rating/gate restrictions | Rooms, spawns, waves, triggers; mission level/faction per variant; most mission dungeons                                                  |
| KB (EVE Uni, own) | Encounter mechanics, per-room NPCs, triggers, loot                                                                                                      | Coverage incomplete; game changes can make it stale (hence `source` + date)                                                               |
| ESI               | Ship type and location (5 s cache), skills, saved fittings                                                                                              | Live combat, current mission, current fit (assets lag up to 1 h)                                                                          |
| Player            | Encounter selection, level/faction, fit (EFT paste)                                                                                                     | Can be forgotten or out of date. The UI shows what is assumed                                                                             |

## 10. MVP scope

In (brief §8 plus agreed additions):
overlay with documented Linux approach · configurable log dir · real-time watching · structured parsing · log replay ·
SDE-backed NPC lookup · initial threat rules + warnings · minimal KB · **encounter search and brief** (017) ·
basic combat stats · settings persistence · **optional ESI: ship type + location** (021) · **fit input: EFT paste,
saved fittings, assets** (022).

Out (backlog 900): automatic encounter recognition, fit/suitability evaluation beyond simple checks, ammo advice,
drone analysis, rearrangeable sections, bulk KB import.

## 11. Compliance constraints (brief §7)

The design has no code path that sends input to the game, reads process memory, injects, intercepts network traffic,
or automates anything. Inputs are files the client writes, public/authorized APIs, and the player. Any feature that would
need more than that is out of scope by definition. ESI use follows CCP's developer licence and the endpoint limits.

## 12. Repository layout

```
src/
  core/            # pure TS, no electron imports
    logs/          # watcher, parser, event types
    sde/           # importer, GameDataService
    kb/            # loader, schema, resolver
    session/       # SessionStateManager, statistics
    threats/       # rules, engine
    encounter/     # search, (later) recognition
    esi/           # client, rate limiting (no Electron)
    viewmodel/     # state → overlay view model
  main/            # Electron: windows, tray, shortcuts, IPC, settings store, auth, safeStorage
  preload/
  renderer/
    overlay/
    settings/
  cli/             # replay, headless run, sde import
kb/                # bundled knowledge base (CC BY-SA 4.0)
test/fixtures/     # anonymised log excerpts
docs/
```
