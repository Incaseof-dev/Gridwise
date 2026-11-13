# Data pack and automatic updates

Goal: a published build works offline from the first start and keeps itself current without loading the servers it
reads from (CCP's SDE endpoint, the EVE University wiki).

## What ships with the app

| Data                      | Where                                                            | Built by                                              |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| SDE index (~25 MB SQLite) | `data/sde.sqlite` (not in git; packaged next to the app)         | `npm run data:build`                                  |
| Knowledge base (YAML)     | `kb/encounters/` (in git)                                        | `npm run data:build` / `npm run kb -- import-wiki`    |
| Wiki revisions of the KB  | `kb/manifest.json` (page title → revision)                       | written by a full `import-wiki`                       |
| Enemy site map            | `kb/sitemap.json` (factions, sites, escalation links)            | `npm run data:build` / `npm run kb -- import-sitemap` |
| Abyss data                | `kb/abyss.json` (tiers, weathers, name parts, rooms)             | `npm run data:build` / `npm run kb -- import-abyss`   |
| Wiki sources              | `kb/sources.json` (mission levels, site categories, event pages) | edited by the maintainer                              |

The maintainer runs `npm run data:build` now and then (new SDE build, new event page in `kb/sources.json`), commits the
KB changes and ships the new `data/sde.sqlite` with the next build.

## What the app does by itself

Setting: _Settings → Game data → Automatic updates_ (on by default), plus a _Check now_ button.

|      | When                | Requests                                                          | Downloads                                                                                               |
| ---- | ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| SDE  | at most once a day  | 1 tiny request (build number)                                     | the ~100 MB zip only when CCP published a newer build than the app has; the zip is deleted after import |
| Wiki | at most once a week | ~5 list requests + 1 revision request per 50 pages (~20 in total) | only pages whose revision differs from `kb/manifest.json` or an earlier update                          |

- Wiki requests go one at a time with a 1.5 s pause, send `maxlag=5`, honour `Retry-After` on 429/503 (3 retries,
  then give up until the next check), and identify the app in the User-Agent.
- Updated SDE: `$XDG_DATA_HOME/gridwise/sde/sde.sqlite`. The app opens whichever of this and the bundled index has
  the newer build.
- Updated KB entries: `$XDG_DATA_HOME/gridwise/kb-updates/` (+ `manifest.json`). Layer order: bundled < update <
  user. An update never replaces a bundled entry marked `review: reviewed`.
- State (last check times, last message): `$XDG_DATA_HOME/gridwise/updates.json`.
