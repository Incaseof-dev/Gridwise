# EVE Game Log format: observations

Source: 67 real Gamelog files (2026-10-09 … 2026-10-20, ~111k lines, 2 characters) from the dev machine.
These are empirical findings. Anything not listed here has **not** been observed and must not be assumed.

## Files

- Location: `…/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs/Gamelogs/`
- Name: `YYYYMMDD_HHMMSS[_<characterId>].txt`. Files **without** a character ID are login-screen
  sessions (header only, sometimes a `(question)` line); they can be ignored.
- One file per client session per character. Multiple clients = multiple files written concurrently.
- Encoding: ASCII/UTF-8, **CRLF** line endings.
- Header:
  ```
  ------------------------------------------------------------
    Gamelog
    Listener: <Character Name>
    Session Started: 2026.10.19 20:12:42
  ------------------------------------------------------------
  ```
- Entry: `[ YYYY.MM.DD HH:MM:SS ] (<category>) <body>`. Timestamps are EVE time (UTC), 1 s resolution.
- Some bodies contain embedded newlines (e.g. redeem-item lists): lines without a `[ timestamp ]`
  prefix are continuations of the previous entry.
- Bodies contain EVE markup (`<color=0xAARRGGBB>`, `<b>`, `<font size=N>`, `<a href="showinfo:TYPEID">`).
  Font size varies (10/12) with the client's settings. Parse on structure, not on exact markup.

## Categories (frequency)

| category       | count  | content                                                                           |
| -------------- | ------ | --------------------------------------------------------------------------------- |
| combat         | 95,519 | damage, misses, EWAR, neut/nos                                                    |
| notify         | 8,127  | reloads, "no suitable targets", missile deactivations, out of charges, …          |
| bounty         | 4,475  | `3,750 ISK added to next bounty payout` (**no NPC name**)                         |
| mining         | 1,849  | mining yields                                                                     |
| None           | 671    | `Jumping from A to B`, `Undocking from <station> to <system> solar system.`       |
| question       | 239    | client confirmation dialogs                                                       |
| info           | 77     | locked gates ("synchronized gate scramblers", required key items), fitting errors |
| hint / warning | 52     | misc                                                                              |

## Combat lines

Direction is given by the word `to` / `from` and by the amount colour (`0xff00ffff` outgoing, `0xffcc0000` incoming).

| shape (markup stripped)                                           | meaning                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `N to <Target> - <Weapon/Ammo/Drone> - <Quality>`                 | outgoing hit; the weapon field is ammo (missiles), weapon or drone type                |
| `N from <Source> - <Quality>`                                     | incoming hit, NPC weapon unknown                                                       |
| `N from <Source> - <NPC ammo> - <Quality>`                        | incoming hit with NPC ammo (e.g. `Scourge Rocket` → incoming damage type is derivable) |
| `<Source> misses you completely`                                  | incoming miss                                                                          |
| `Your <Drone/Weapon> misses <Target> completely - <Drone/Weapon>` | own miss (drones, turrets)                                                             |
| `Your group of <Weapon> misses <Target> completely - <Weapon>`    | grouped turret miss                                                                    |
| `N GJ energy neutralized <Source> - <Source>`                     | **incoming** neut                                                                      |
| `+N GJ energy drained from <Target> - <Nosferatu module>`         | own nosferatu                                                                          |
| `Warp scramble attempt from <Source> to you!`                     | incoming scram (observed EWAR)                                                         |
| `Warp disruption attempt from <Source> to you!`                   | incoming point                                                                         |
| `You're jammed by <Source> - <Source>`                            | incoming ECM                                                                           |

Quality: `Wrecks`, `Smashes`, `Penetrates`, `Hits`, `Glances Off`, `Grazes`.

## Notably absent

- **No kill / destruction event.** Proxies: `<ammo> deactivates as the item it was targeted at is no longer present`
  (notify), `Targeting attempt failed as the designated object is no longer present`, and bounty lines.
  None of these identifies the destroyed NPC reliably, so time-to-kill is an estimate.
- No webs, sensor damps, tracking disruption or target painting were seen in this data set. Webs are probably
  not logged at all; the threat engine must rely on knowledge-base data for them (flagged as _known capability_,
  not _observed_).
- No ship, fit, capacitor, shield/armor/hull, mission name or site name. No warp/landing events.
- No damage _against drones_ in this data set.
- Undock gives the system and station; `Jumping from A to B` gives system changes. Warps within a system are invisible.
