# Third-party content

## CCP hf. (EVE Online)

This application uses game data and images provided by CCP hf. under the
[EVE Online Developer License Agreement](https://developers.eveonline.com/license-agreement) for non-commercial use:

- the Static Data Export (downloaded by the user at runtime, not included in this repository),
- an extract of the Static Data Export bundled with eve-fit-engine (`node_modules/eve-fit-engine/data`, see below),
- ship renders from the public EVE image server (`images.evetech.net`, loaded at runtime),
- a few icons from the Image Export Collection, included in `src/renderer/public/brackets/` (overview brackets) and
  `src/renderer/public/ewar/` (module icons). They are copied from the collection with `npm run icons`.
- the app icon (`resources/icon.svg`): a silhouette of the Jackdaw, traced by hand from CCP's render of the ship.

The application is non-commercial. It must not be sold or put behind a fee (Developer License Agreement §4).

> © 2014 CCP hf. All rights reserved. "EVE", "EVE Online", "CCP", and all related logos and images are trademarks or
> registered trademarks of CCP hf.

## EVE University wiki

The encounter knowledge base in `kb/` contains content derived from the [EVE University wiki](https://wiki.eveuniversity.org/),
licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). See `kb/LICENSE`. Every entry names its
source page and revision.

## eve-fit-engine

Fit stats (EHP, resists, capacitor, DPS) are computed by [eve-fit-engine](https://github.com/WilliamFalci/capsuleers.fitting-engine),
Copyright (C) 2026 Capsuleers.app, licensed under the GNU General Public License v3.0 or later. It is a derivative work of
[Pyfa](https://github.com/pyfa-org/Pyfa) (GPL-3.0), Copyright (C) its respective authors. Its NOTICE and LICENSE ship
with it in `node_modules/eve-fit-engine/`. Its bundled SDE extract stays under CCP's terms (`data/SDE-LICENSE.md`).
