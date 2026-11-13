/**
 * Copies the few icons the overlay uses from CCP's Image Export Collection (IEC) into the renderer's public dir:
 * overview brackets for hull sizes, module icons for EWAR, the shield / armor / hull layer icons and the Abyss
 * weather icons. The copied icons are committed (allowed for
 * non-commercial applications under CCP's Developer License Agreement §2.1, with the notice in
 * THIRD_PARTY_NOTICES.md); the full collection in ./static is not.
 *
 *   npm run icons                     # from ./static (the unpacked IEC)
 *   npm run icons -- /path/to/iec     # folder that contains Icons/ and Types/
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const iec = resolve(process.argv[2] ?? 'static');
const src = join(iec, 'Icons/items/Brackets');
const dest = resolve('src/renderer/public/brackets');
const typesSrc = join(iec, 'Types');
const ewarDest = resolve('src/renderer/public/ewar');
const layerDest = resolve('src/renderer/public/layers');

/** Tank layer → icon in Icons/items (the fitting window's shield, armor plate and structure icons). */
const LAYER_ICONS = { shield: '2_64_3.png', armor: '1_64_13.png', hull: '2_64_12.png' };
const weatherDest = resolve('src/renderer/public/weather');

/** Abyss weather → the status effect icon the game shows for it. */
const WEATHER_ICONS = {
  dark: 'weatherDarkness.png',
  electrical: 'weatherLightning.png',
  exotic: 'weatherXenonGas.png',
  firestorm: 'weatherInfernal.png',
  gamma: 'weatherCaustic.png',
};

/** EWAR kind → representative module type id (icons are in Types/<id>_32.png). */
const EWAR_MODULES = {
  warpScramble: 447, // Warp Scrambler I
  warpDisruption: 3242, // Warp Disruptor I
  web: 526, // Stasis Webifier I
  neut: 533, // Small Energy Neutralizer I
  nos: 530, // Small Energy Nosferatu I
  ecm: 1957, // Multispectral ECM I
  sensorDamp: 1968, // Remote Sensor Dampener I
  trackingDisruption: 2108, // Tracking Disruptor I
  guidanceDisruption: 37543, // Guidance Disruptor I
  targetPaint: 12709, // Target Painter I
  remoteRepair: 11355, // Small Remote Armor Repairer I
  rampingDamage: 47272, // Light Entropic Disintegrator I
  smartbomb: 3993, // Large EMP Smartbomb I
};

/** Overlay size class → candidate file names in the collection (first existing wins). */
const ICONS = {
  frigate: ['npfrigate_32.png', 'npcfrigate_32.png', 'npcfrigate_16.png'],
  destroyer: ['npcdestroyer_32.png', 'npcdestroyer_16.png'],
  cruiser: ['npccruiser_32.png', 'npccruiser_16.png'],
  battlecruiser: ['npcbattleCruiser_32.png', 'npcbattleCruiser_16.png'],
  battleship: ['npcbattleship_32.png', 'npcbattleship_16.png'],
  capital: ['npcdreadnought_32.png', 'npcdreadnought_16.png'],
  structure: ['structure.png', 'largeCollidableStructure.png'],
  sentry: ['sentry.png', 'destructibleSentry.png'],
  drone: ['npcdroneAttack_16.png', 'droneAttack_16.png'],
};

if (!existsSync(src)) {
  console.error(
    `Bracket icons not found at ${src}. Pass the path to the "Brackets" folder of the Image Export Collection.`,
  );
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
let copied = 0;
for (const [size, candidates] of Object.entries(ICONS)) {
  const file = candidates.find((f) => existsSync(join(src, f)));
  if (!file) {
    console.warn(`  ${size}: none of ${candidates.join(', ')} found; the overlay will draw a fallback`);
    continue;
  }
  copyFileSync(join(src, file), join(dest, `${size}.png`));
  console.log(`  ${size}.png ← ${file}`);
  copied++;
}
console.log(`${copied}/${Object.keys(ICONS).length} icons copied to ${dest}`);

mkdirSync(ewarDest, { recursive: true });
let ewarCopied = 0;
for (const [kind, typeId] of Object.entries(EWAR_MODULES)) {
  const file = join(typesSrc, `${typeId}_32.png`);
  if (!existsSync(file)) {
    console.warn(`  ewar ${kind}: ${file} not found; the overlay shows text only`);
    continue;
  }
  copyFileSync(file, join(ewarDest, `${kind}.png`));
  ewarCopied++;
}
console.log(`${ewarCopied}/${Object.keys(EWAR_MODULES).length} EWAR icons copied to ${ewarDest}`);

mkdirSync(layerDest, { recursive: true });
let layersCopied = 0;
for (const [layer, name] of Object.entries(LAYER_ICONS)) {
  const file = join(iec, 'Icons/items', name);
  if (!existsSync(file)) {
    console.warn(`  layer ${layer}: ${file} not found; the overlay shows text only`);
    continue;
  }
  copyFileSync(file, join(layerDest, `${layer}.png`));
  layersCopied++;
}
console.log(`${layersCopied}/${Object.keys(LAYER_ICONS).length} layer icons copied to ${layerDest}`);

mkdirSync(weatherDest, { recursive: true });
let weatherCopied = 0;
for (const [weather, name] of Object.entries(WEATHER_ICONS)) {
  const file = join(iec, 'Icons/items/StatusEffects', name);
  if (!existsSync(file)) {
    console.warn(`  weather ${weather}: ${file} not found; the overlay shows text only`);
    continue;
  }
  copyFileSync(file, join(weatherDest, `${weather}.png`));
  weatherCopied++;
}
console.log(`${weatherCopied}/${Object.keys(WEATHER_ICONS).length} weather icons copied to ${weatherDest}`);
