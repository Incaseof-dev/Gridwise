# Gridwise

**Know the grid. Survive the fight.** · by In Case Of

A passive PvE companion for EVE Online. It reads the game logs and shows what matters for the fight you are in, in a
small transparent overlay on top of the game:

- **Encounter brief** for agent missions (levels 1–5), combat anomalies, DED and unrated complexes and event sites:
  incoming damage and the damage type to shoot, EWAR (warp scramble/disruption first), gate restrictions, objectives,
  triggers, tips and loot. Search with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>.
- **Threat warnings**: what the NPCs you fight are _able_ to do (can scram, can web, can neut … from CCP's static
  data and the wiki), and the trigger of the next wave while you shoot it. Warnings never claim a situation is safe.
  The EWAR landing on you is not called out line by line (see the build switch below).
- **Timed explanations** instead of constant alarms: when a neut, jam or web goes on for minutes, a short message
  explains what it does and what to do about it, and another one says when it is over. The voice of these messages is the Backseat Capsuleer, from plain to sarcastic in levels 0–3 (see
  [docs/messages.md](docs/messages.md)).
- **Abyssal Deadspace**: pick the filament (weather and tier) before going in to see what it does to your fit and
  which NPCs of that tier are dangerous. Inside, a 20-minute timer (read from the Local chat log), the room recognised
  from the NPCs in the log, and everything it can hold, with what each NPC does (no order of fire). Every run is logged with its clear time and the NPCs of each room.
- **Enemy sites**: per pirate faction, its combat anomalies, unrated and DED complexes and expeditions, where they
  spawn (high/low/null) and what escalates into what (_Settings → Enemy sites_).
- **Rare loot alerts** when a faction, officer or overseer NPC is in the fight, kept as a reminder afterwards.
- **Combat statistics**: damage in/out, DPS, bounties.
- **Your fit**: paste it from EVE's Fitting window (_Settings → Ship fit_) to see its EHP, resists, capacitor and DPS.
  The encounter brief then says how your tank does against the site's damage, and names the resist hole when there is
  one. After a few volleys, a hint says how well your missiles apply to the target.
- **EVE login and EVE Workbench** (both optional): with the EVE login the fit numbers use your real skills and
  implants, your fittings saved in game show up, and the fit of the ship you sit in becomes active by itself. With an
  EVE Workbench key, your fits there show up too, and an Abyss run can be uploaded to the Abyss Tracker when you press
  Upload.

It is **passive**: it never touches the game client, sends no input, and does not read game memory or network traffic.
It reads the log files EVE writes, CCP's public data and the EVE University wiki. From the Local chat log it only reads
the system change lines; what players write is skipped.

Gridwise is a third-party tool. CCP does not endorse or support third-party tools, and using one is at your own risk.

> Status: 1.3.0. Tested by its author in daily play on Linux, with a Windows build. Expect rough edges, and please report them
> ([Bug reports and ideas](#bug-reports-and-ideas)).

## Install (Linux)

1. Download `Gridwise-x86_64.AppImage` from the [Releases](https://github.com/Incaseof-dev/Gridwise/releases) page,
   put it where it can stay (e.g. `~/Applications`) and make it executable: `chmod +x Gridwise-x86_64.AppImage`.
2. Run it. AppImages need FUSE; if your system shows _"Cannot mount AppImage, please check your FUSE setup"_, install
   FUSE 2 support (`fuse` / `libfuse2`) or start it with `--appimage-extract-and-run`.

The game data (SDE index), the encounter knowledge base, the enemy site map and the Abyss data are included, so it
works offline from the first start.

**Updates:** the app looks for a new version at start and every 4 hours, downloads it in the background and installs it
when you click _Restart to update_ (_Settings → About_) or at the next quit; it never restarts on its own. The AppImage
replaces itself in place, so keep it in a folder you can write to. The check reads the release files from GitHub and
sends nothing about you; it can be turned off in _Settings → About_.

## Install (Windows)

Lightly tested. Use the installer `Gridwise-Setup-<version>.exe`: that one updates itself like the AppImage. The zip
(`Gridwise-<version>-win-x64.zip`, unzip anywhere and run `gridwise.exe`) only tells you when a new version is out. The default log folder is `%USERPROFILE%\Documents\EVE\logs\Gamelogs`; if your
Documents folder is redirected (e.g. OneDrive), pick the folder in _Settings → Game logs_. If another program holds a
shortcut (on some Windows setups <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd>), rebind it in _Settings → Overlay →
Shortcuts_.

## First start

- **The log folder is the only thing to set, once**: EVE's `Gamelogs` folder, in _Settings → Game logs → Choose…_. The
  chat logs (Local for the Abyss timer and your system, the intel channels) are read from the `Chatlogs` folder next to
  it, so there is nothing else to point at. The usual place is filled in already:
  - Linux, Steam/Proton:
    `~/.local/share/Steam/steamapps/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs/Gamelogs`;
  - Windows: `%USERPROFILE%\Documents\EVE\logs\Gamelogs`.

  _Settings → Game logs_ says _Watching_ when it is right, _Folder not found_ when it needs picking (another Steam
  library, a redirected Documents folder). The choice is saved and kept across restarts and updates, and a change
  takes effect at once.
- Run EVE in **borderless window / fullscreen windowed** mode. The overlay cannot sit on top of exclusive fullscreen.
- For the Abyss timer and intel EVE must log chat to file (on by default).

### Overlay on Linux (KDE Plasma, Wayland)

- The overlay runs as an XWayland client (`--ozone-platform=x11`), because Wayland gives normal windows no way to stay
  on top. The app adds this flag itself. EVE under Proton is an XWayland client as well.
- KWin puts a **focused fullscreen** window above "keep above" windows, and EVE's _Fixed window_ (borderless
  fullscreen) mode counts as fullscreen. On KDE the app therefore gives the overlay KWin's _on-screen display_ window
  type, which stays above fullscreen games and can still take keyboard input. This uses `xprop`, usually installed
  with Plasma. _Settings → Overlay → Stay above fullscreen games_ turns it off; _Overlay layer_ there shows whether it
  worked.
- Without it (other desktops, or no `xprop`), use EVE's _Window_ mode, or a window rule that keeps EVE from being
  fullscreen (KDE: _Window Rules_ for EVE → _Fullscreen: Force No_).

## Using it

| Shortcut                                                 | Action                                   |
| -------------------------------------------------------- | ---------------------------------------- |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>              | search a mission or site                 |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd>              | click-through on/off (mouse goes to EVE) |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>              | show/hide the overlay                    |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd>              | minimize to the header row / restore     |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd>/<kbd>C</kbd> | previous / next pocket                   |

The shortcuts can be changed in _Settings → Overlay → Shortcuts_: click one and press the new keys.

- Drag the overlay by its header, resize it with the corner grip. Position and size are remembered. Minimizing keeps
  the header where the panel stands; _Settings → Overlay_ can keep EWAR warnings and messages visible while minimized.
- Right of the panel, an icon strip holds your fit's tank result (layer icon and %), restrictions ⛔, tips 💡, loot 💰
  and the **ABYSS** button. Hover for details; tips and loot open in the brief on click.
- The brief header is full at the top and condenses once you scroll; _Settings → Overlay → Brief header → Compact_
  keeps it condensed.
- In the brief, pockets are tabs. ▦ / ▪ / ☰ cycles the waves between ship images, ultra compact (one row per wave:
  hull-size icons with counts, EWAR and trigger markers) and name lists.
- Hover chips and icons for details and sources. Entries marked _unreviewed_ were imported automatically and not yet
  checked by a human.
- The tray icon has the same actions plus _Settings_ and _Quit_. Closing the overlay only hides it.

## Where the data comes from, and how fresh it is

| Data                                               | Source                 | Notes                                                                                |
| -------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| NPC stats, EWAR, resists, ships, sites, gate rules | CCP Static Data Export | checked for a new build at most once a day                                           |
| Pockets, waves, triggers, tips, loot tables        | EVE University wiki    | checked at most once a week; only changed pages are downloaded                       |
| What is happening now                              | your EVE game logs     | the log does not show webs, damps, kills or loot; absence of a warning is not safety |
| Ship images                                        | CCP image server       | loaded on demand                                                                     |

Automatic updates can be turned off in _Settings → Game data_. Details: [docs/data-updates.md](docs/data-updates.md).

## Bug reports and ideas

Please use [GitHub Issues](https://github.com/Incaseof-dev/Gridwise/issues). A good report has:

- the version and platform line from _Settings → Diagnostics_ (e.g. `v1.3.0 · Electron … · x11 session …`);
- your OS and desktop (e.g. Windows 11, or Bazzite / KDE Plasma on Wayland) and how EVE runs (Steam/Proton, native
  launcher, window mode);
- what you did, what you expected and what happened instead, with a screenshot of the overlay if it helps;
- for a wrong warning or brief: the site or mission name and the time of the fight.

Game logs help a lot, but they contain your character's name and sometimes other players' names. Cut out only the
lines around the problem and replace the names before you attach them. Never post your settings files or anything
from the app's config folder: they hold your EVE login and API keys.

Wrong data in a brief (waves, triggers, loot) usually comes from the EVE University wiki: a fix on the wiki reaches
everyone at the next weekly update.

## Development

Requirements: Node.js 24+, npm 12+. Developed on Linux. npm 12 blocks dependency install scripts; the needed ones are approved in
`package.json` (`allowScripts`).

```sh
npm install
npm run dev            # overlay + settings window, XWayland mode
npm test               # unit tests (plus a corpus test over your own logs if present)
npm run typecheck && npm run lint
```

Useful tools:

| Command                                                                       | What it does                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run sde -- update \| npc "<name>" \| search "<text>"`                    | local SDE index and lookups                                                                                           |
| `npm run kb -- import-wiki \| import-sitemap \| import-abyss \| check`        | knowledge base import (sources in `kb/sources.json`), site map, Abyss data, checks                                    |
| `npm run inspect -- <log> [--threats]`                                        | what the parser and the threat engine make of a log                                                                   |
| `npm run fit -- <file.eft \| -> [--damage EM,TH,KI,EX]`                       | fit stats of an EFT paste (All V skills), optionally EHP against a damage mix                                         |
| `npm run replay -- <log> --out <dir> --speed 10 [--now] [--chat <Local log>]` | replays a log (and the Local chat log) into a folder (--now: as a live fight today)                                   |
| `npm run e2e` / `npm run screenshots`                                         | end-to-end tests of the built app / documentation screenshots into `docs/screenshots` (Playwright; not while playing) |
| `npm run docs:images [-- --dry-run]`                                          | uploads changed screenshots to the DeliveryHub docs and updates the pages                                             |
| `npm run fixture -- <log> --from … --to … --out <file>`                       | cuts an anonymised fixture log (NPC combat lines only) for tests and screenshots                                      |
| `npm run icons [-- <iec dir>]`                                                | copies the needed icons from CCP's Image Export Collection                                                            |
| `npm run icons:app`                                                           | renders the app and tray icons from `resources/icon.svg` (needs ImageMagick)                                          |
| `npm run data:build`                                                          | rebuilds the bundled data: SDE index in `data/` and the knowledge base                                                |
| `npm run dist`                                                                | builds the AppImage into `dist/` (run `data:build` first)                                                             |
| `npm run dist:win-zip`                                                        | builds the portable Windows zip on Linux (the NSIS installer needs Windows or Wine)                                   |

**Build switch.** The rows of EWAR seen on you (SCRAMMED, POINTED, NEUTED, JAMMED, DPS SPIKE) and the Abyss focus
order are off in the releases. `GRIDWISE_LIVE_COMBAT=1 npm run dist` builds them in (`src/core/buildFlags.ts`).

The GitHub Actions workflow _Build_ builds the AppImage and the Windows installer + zip, with the SDE index cached per
SDE build. Run by hand it only builds; a pushed version tag (`v1.2.0`, matching `package.json`) also publishes a GitHub
release with the update files (`latest.yml`, `latest-linux.yml`) the app updates from.

Architecture and design notes are in [docs/](docs/). The user-facing documentation (what it is, every feature and
setting): [docs.incaseof.dev](https://docs.incaseof.dev/en/gridwise/latest/overview).

## Licenses

- Encounter knowledge base (`kb/`): derived from the EVE University wiki, **CC BY-SA 4.0** ([kb/LICENSE](kb/LICENSE)).
- CCP game data, ship images and icons: used under the EVE Online Developer License Agreement for non-commercial
  use. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The app must not be sold or put behind a fee.
- Application code: **GPL-3.0-or-later** ([LICENSE](LICENSE)). The fit stats come from
  [eve-fit-engine](https://github.com/WilliamFalci/capsuleers.fitting-engine), a GPL-3.0-or-later port of Pyfa, so
  the app is under the same license.

## Credits and support

Gridwise is made by **Pudingg Otsito** (in game), published under _In Case Of_. The knowledge behind the encounter
briefs, NPC notes and site guides is the work of [EVE University](https://wiki.eveuniversity.org) and the people who
write their wiki; the app is a comfortable frame around it.

If the tool helps you:

- **New to EVE?** If nobody recruited you yet, sign up with
  [this referral link](https://www.eveonline.com/signup?invc=ed49e250-20cf-4e22-86e1-a1759f3c58b5): you get 1,000,000
  skill points as a gift, and the author gets a bonus if you buy game time.
- **In game:** ISK or in-game items to **Pudingg Otsito** are welcome.

EVE Online and all related names and images are trademarks of CCP hf. This project is not affiliated with or
endorsed by CCP.

Gridwise is a third-party tool. CCP does not endorse or support third-party tools, and using one is at your own risk.
