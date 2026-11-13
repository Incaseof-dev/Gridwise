/**
 * EVE University wiki page → KB file object (docs/knowledge-base.md).
 * Deterministic: the same wikitext always gives the same output. Everything is marked `review: unreviewed`.
 */
import type { DamageType } from '../../sde/damage';
import type { NpcCapabilityKind } from '../../sde/npcCapabilities';
import { anomalyClassOf } from '../rating';
import type { EncounterKind } from '../types';
import { pageUrl, type WikiPage } from './fetch';
import { cleanText, parseTemplate, parseWikitext, splitTopLevel, type Template } from './wikitext';

type Obj = Record<string, unknown>;

export interface ConvertResult {
  file: Obj | null;
  skipped?: string;
}

const FACTIONS: [RegExp, string][] = [
  [/^gurist/i, 'Guristas Pirates'],
  [/^serpentis/i, 'Serpentis'],
  [/^angel/i, 'Angel Cartel'],
  [/^blood raider/i, 'Blood Raider Covenant'],
  [/^sansha/i, "Sansha's Nation"],
  [/^rogue drone/i, 'Rogue Drones'],
  [/^mordu/i, "Mordu's Legion Command"],
  [/^caldari/i, 'Caldari State'],
  [/^gallente/i, 'Gallente Federation'],
  [/^amarr/i, 'Amarr Empire'],
  [/^minmatar/i, 'Minmatar Republic'],
  [/^khanid/i, 'Khanid Kingdom'],
  [/^ammatar/i, 'Ammatar Mandate'],
  [/^triglavian/i, 'Triglavian Collective'],
  [/^edencom/i, 'EDENCOM'],
];

export function normalizeFaction(raw: string): string | null {
  const t = cleanText(raw);
  if (!t) return null;
  return FACTIONS.find(([re]) => re.test(t))?.[1] ?? t;
}

const DAMAGE_TOKENS: Record<string, DamageType[]> = {
  em: ['em'],
  th: ['thermal'],
  therm: ['thermal'],
  thermal: ['thermal'],
  ki: ['kinetic'],
  kin: ['kinetic'],
  kinetic: ['kinetic'],
  ex: ['explosive'],
  exp: ['explosive'],
  explosive: ['explosive'],
  omni: ['em', 'thermal', 'kinetic', 'explosive'],
};

/** Damage types from a `{{Damagetype|kin|th}}` value; [] when empty or unknown. */
export function parseDamage(value: string | undefined): DamageType[] {
  if (!value) return [];
  const out: DamageType[] = [];
  for (const m of value.matchAll(/\{\{\s*[Dd]amagetype\s*\|([^}]*)\}\}/g)) {
    for (const tok of m[1]!.split('|')) for (const d of DAMAGE_TOKENS[tok.trim().toLowerCase()] ?? []) out.push(d);
  }
  return [...new Set(out)];
}

const EWAR_WORDS: [RegExp, NpcCapabilityKind][] = [
  [/\bweb/i, 'web'],
  [/stasis/i, 'web'],
  [/\bscram/i, 'warpScramble'],
  [/\bpoint\b|disrupt(?!ion\b.*track)|warp dis/i, 'warpDisruption'],
  [/\bneut/i, 'neut'],
  [/\bnos\b|nosferatu/i, 'nos'],
  [/\becm\b|\bjam/i, 'ecm'],
  [/damp/i, 'sensorDamp'],
  [/\btd\b|tracking dis/i, 'trackingDisruption'],
  [/guidance/i, 'guidanceDisruption'],
  [/\btp\b|paint/i, 'targetPaint'],
];

/** EWAR kinds mentioned in a free-text or row value ("Web", "TD", "{{icon|web|24}}", "Sensor dampening, neuting"). */
export function parseEwar(value: string | undefined): NpcCapabilityKind[] {
  if (!value) return [];
  const iconArgs = [...value.matchAll(/\{\{\s*icon\s*\|([^|}]*)/gi)].map((m) => m[1]!);
  const text = `${cleanText(value)} ${iconArgs.join(' ')}`;
  const kinds = EWAR_WORDS.filter(([re]) => re.test(text)).map(([, k]) => k);
  // "Tracking disruption" must not also count as warp disruption.
  if (kinds.includes('trackingDisruption') && !/\bpoint\b|warp dis/i.test(text)) {
    return [...new Set(kinds.filter((k) => k !== 'warpDisruption'))];
  }
  return [...new Set(kinds)];
}

/** Tells the converter whether a name is a real NPC type (SDE), to expand compressed name lists correctly. */
export type NpcNameCheck = (name: string) => boolean;

/**
 * Expands the wiki's compressed name lists: "Pithi Wrecker/Plunderer" → ["Pithi Wrecker", "Pithi Plunderer"],
 * "Core Rear Admiral/Vice Admiral" → ["Core Rear Admiral", "Core Vice Admiral"]. With `isNpc`, the candidate that is
 * a real SDE type wins; without it, single words get the first name's prefix and longer items are kept as written.
 * "..." marks an incomplete list.
 */
export function expandNames(list: string, isNpc?: NpcNameCheck): { names: string[]; incomplete: boolean } {
  const parts = cleanText(list)
    .split('/')
    .map((p) => p.trim());
  const isJunk = (p: string) => !p || /^(\.\.\.|…|\?)/.test(p);
  const incomplete = parts.some(isJunk);
  const items = parts.filter((p) => !isJunk(p));
  const first = items[0];
  if (!first) return { names: [], incomplete };
  const words = first.split(' ');
  const expand = (item: string): string => {
    // Candidates: the item with 1..n-1 leading words of the first name, longest prefix first, then as written.
    const candidates = words
      .slice(0, -1)
      .map((_, k) => `${words.slice(0, words.length - 1 - k).join(' ')} ${item}`)
      .concat(item);
    const known = isNpc ? candidates.find(isNpc) : undefined;
    if (known) return known;
    return !item.includes(' ') && words.length > 1 ? candidates[0]! : item;
  };
  return { names: [first, ...items.slice(1).map(expand)], incomplete };
}

/** "Supervisor's Guardian (Pithum Annihilator/Killer)" → display name + SDE type names. */
export function parseNpcCell(
  cell: string,
  isNpc?: NpcNameCheck,
): { display: string | null; names: string[]; incomplete: boolean } {
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(cleanText(cell));
  if (m && /[A-Z]/.test(m[2]!) && !/\bkm\b|\d/.test(m[2]!)) {
    const inner = expandNames(m[2]!, isNpc);
    return { display: m[1]!.trim(), names: inner.names, incomplete: inner.incomplete };
  }
  const plain = expandNames(cell, isNpc);
  return { display: null, ...plain };
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const LOOT_SECTION = /loot|salvage|bount|reward/i;
const IGNORE_SECTION = /mining|video|see also|reference|gallery|external|navigation|asteroid/i;

/** A wiki table cell may start with attributes ("style=… | text"); keep the text. */
function cellText(cell: string): string {
  const parts = splitTopLevel(cell, '|');
  return cleanText(parts.length > 1 && /=/.test(parts[0]!) ? parts.slice(1).join('|') : cell);
}

/** Collects `{| … |}` wiki tables line by line. */
class TableReader {
  headers: string[] = [];
  rows: string[][] = [];
  private cur: string[] = [];

  /** Returns true when the line belonged to the table. */
  line(raw: string): boolean {
    const t = raw.trim();
    if (t.startsWith('|-') || t.startsWith('|}')) {
      if (this.cur.length) this.rows.push(this.cur);
      this.cur = [];
      return true;
    }
    if (t.startsWith('!')) {
      this.headers.push(
        ...t
          .slice(1)
          .split(/!!|\|\|/)
          .map(cellText),
      );
      return true;
    }
    if (t.startsWith('|')) {
      this.cur.push(...t.slice(1).split('||').map(cellText));
      return true;
    }
    if (this.cur.length) {
      // Cell text continued on the next line.
      this.cur[this.cur.length - 1] += ` ${cleanText(t)}`;
      return true;
    }
    return false;
  }
}

/** Turns a loot table into loot facts. Columns are found by their header text. */
function lootRows(table: TableReader, label: string | null): Obj[] {
  const col = (re: RegExp) => table.headers.findIndex((h) => re.test(h));
  const item = Math.max(0, col(/item|name/i));
  const value = col(/value|price|isk/i);
  const from = col(/drop|from|source/i);
  const note = col(/note|chance|rate|comment/i);
  return table.rows
    .map((r) => {
      const name = r[item]?.trim();
      if (!name) return null;
      const extra = [
        value >= 0 && r[value]?.trim() ? `est. ${r[value]!.trim()} (wiki)` : null,
        note >= 0 && r[note]?.trim() ? r[note]!.trim() : null,
        label,
      ].filter(Boolean);
      return {
        item: name,
        ...(from >= 0 && r[from]?.trim() ? { from: r[from]!.trim() } : {}),
        ...(extra.length ? { note: extra.join(' · ') } : {}),
      };
    })
    .filter((x): x is { item: string; note?: string; from?: string } => x !== null);
}
const GENERIC_HEADING =
  /^(walkthr?oughs?|overview|description|general|notes?|info(rmation)?|spawns?|waves?|npcs?|enemies|rats|combat|site( layout)?|layout|details|strategy|tips?|warp[- ]?in)$/i;
const POCKET_SECTION = /pocket|room|stage|area|deadspace|\bpart\b|location|gate|site\b|warp-?in/i;
/** NPC table titles that name a room rather than a wave ("2nd Room", "Room 3", "Only Room", "Final Pocket"). */
const ROOM_TABLE =
  /^((\d+(st|nd|rd|th))|first|second|third|fourth|fifth|final|last|only|bonus)\s+(room|pocket)$|^(room|pocket)\s+\d+$/i;
const SKIP_TEXT = /^(videos?:|\{\||\|\}|\|-|!|\||\[\[category:|__)/i;

function kindOfType(type: string): EncounterKind {
  const t = type.toLowerCase();
  if (t.startsWith('anom') || t.startsWith('anaom')) return 'anomaly';
  if (t === 'ded' || t === 'unrated') return 'complex';
  // The wiki calls escalations "expeditions" (Category:Expeditions).
  if (t === 'escalation' || t === 'expedition') return 'escalation';
  return 'other';
}

/** Navigation boxes at the foot of site pages name the faction: {{Combat Anomalies|Guristas}}. */
const NAV_TEMPLATE = /^(combat anomalies|unrated complexes|ded complexes|expeditions?)$/i;

/**
 * `siteKind`: the kind of the wiki category the page was listed in. Older site pages have no CMBSiteInfo box, only
 * `{{CMBSite|Name}}` or nothing, but standard NPC tables; with a kind they are read from the title and the tables.
 */
export function convertWikiPage(
  page: WikiPage,
  retrieved: string,
  isNpc?: NpcNameCheck,
  siteKind?: EncounterKind,
): ConvertResult {
  if (/^#redirect/i.test(page.content.trim())) return { file: null, skipped: 'redirect' };
  const nodes = parseWikitext(page.content);
  const info = nodes.find(
    (n): n is Template => n.kind === 'template' && /^(missiondetails|cmbsiteinfo)$/i.test(n.name),
  );
  const template = (re: RegExp) => nodes.find((n): n is Template => n.kind === 'template' && re.test(n.name));
  const boxless = !info && siteKind !== undefined && template(/^(npctablehead|npcth)$/i) !== undefined;
  if (!info && /\{\{:[^}]+\}\}/.test(page.content))
    return { file: null, skipped: 'multi-part page (parts imported on their own)' };
  // Sites the wiki only describes in prose (Triglavian / EDENCOM anomalies, EVE-72) become text-only entries;
  // overviews of content that is gone ({{Past content}}) do not.
  const prose =
    !info &&
    !boxless &&
    siteKind !== undefined &&
    cleanText(page.content).length > 150 &&
    !/\{\{\s*past content/i.test(page.content);
  if (!info && !boxless && !prose) return { file: null, skipped: 'no Missiondetails/CMBSiteInfo box' };

  const isMission = info ? /^missiondetails$/i.test(info.name) : false;
  const p: Record<string, string> = info
    ? info.named
    : {
        name: template(/^cmbsite$/i)?.positional[0] ?? '',
        // Without NPC tables the faction cannot come from the NPCs; these pages are about Triglavian fleets.
        faction:
          template(NAV_TEMPLATE)?.positional[0] ?? (prose && /triglavian/i.test(page.content) ? 'Triglavian' : ''),
      };
  if (isMission && /courier/i.test(p.Type ?? '')) return { file: null, skipped: 'courier mission' };
  // Epic arcs have steps without any fight: talking to an agent, choosing a branch, travelling.
  if (isMission && /talk|tallk|branch|travel|agent interaction|trade/i.test(p.Type ?? ''))
    return { file: null, skipped: 'non-combat mission step' };

  const baseName = page.title.replace(/\s*\(.*$/, '').trim();
  const file: Obj = {
    id: slug(page.title),
    kind: isMission ? 'mission' : info ? kindOfType(p.type ?? '') : siteKind!,
    name: (isMission ? cleanText(p.Name ?? p.name ?? '') : cleanText(p.name ?? '')) || baseName,
  };
  // Parts of a multi-part mission share the name; "(1 of 3)" from the page title tells them apart.
  const part = /\((?:part\s+)?(\d+)\s+of\s+(\d+)\)/i.exec(page.title);
  if (part && !/\d+\s+of\s+\d+/i.test(String(file.name))) file.name = `${String(file.name)} (${part[1]} of ${part[2]})`;
  const restrictions: Obj[] = [];
  const notes: Obj[] = [];
  const objectives: Obj[] = [];
  const encounterEwar = new Set<NpcCapabilityKind>();
  let deal: DamageType[];
  let resist: DamageType[];

  if (isMission) {
    const level = Number(cleanText(p.Level ?? ''));
    file.level = Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
    const factions = ['Faction1', 'Faction', 'Faction2', 'Faction3', 'Faction4']
      .map((k) => (p[k] ? normalizeFaction(p[k]) : null))
      .filter((f): f is string => Boolean(f));
    file.enemyFaction = factions.length ? [...new Set(factions)].join(' & ') : null;
    deal = parseDamage(p.DamageToDeal1 ?? p.DamageToDeal);
    resist = parseDamage(p.DamageToResist1 ?? p.DamageToResist);
    const objective = cleanText(p.Objective ?? '');
    if (objective) objectives.push({ text: objective });
    for (const k of parseEwar(p.EWAR)) encounterEwar.add(k);
    const webPoint = cleanText(p.WebPoint ?? '');
    if (webPoint) {
      const kinds = parseEwar(p.WebPoint);
      for (const k of kinds.length ? kinds : (['web', 'warpDisruption'] as const)) encounterEwar.add(k);
      notes.push({ text: `Web/warp disruption: ${webPoint}` });
    }
    const limit = cleanText(p.ShipSizeLimit ?? '');
    if (limit && !/^(none|\?|unknown)$/i.test(limit)) restrictions.push({ text: `Ship size limit: ${limit}` });
    const suggestion = cleanText(p.ShipSuggestion ?? '');
    if (suggestion) notes.push({ text: `Suggested ships: ${suggestion}` });
    const extra = cleanText(p.Extra ?? '');
    if (extra) notes.push({ text: extra });
  } else {
    const rating = cleanText(p.rating ?? '');
    const ded = /^(\d+)\s*\/\s*10$/.exec(rating);
    file.dedRating = ded ? Number(ded[1]) : null;
    const anomalyClass = anomalyClassOf([`Rating: ${rating}`]);
    if (anomalyClass !== null) file.anomalyClass = anomalyClass;
    file.enemyFaction = normalizeFaction(p.faction ?? '');
    deal = parseDamage(p.damage);
    resist = parseDamage(p.resist);
    const limit = cleanText(p['ship limit'] ?? '');
    if (limit && !/^(unrestricted|unknown|unverified|na|none|\?)$/i.test(limit)) {
      restrictions.push({ text: `Ship size limit: ${limit}` });
    }
    // A bare "Class N" is in anomalyClass now; anything more ("Class 8 Level 3") stays readable as a note.
    if (rating && !ded && !/^(unrated|na|none)$/i.test(rating) && !/^(class|tier)\s*\d+$/i.test(rating)) {
      notes.push({ text: `Rating: ${rating}` });
    }
  }

  file.review = 'unreviewed';
  file.sources = {
    uni: {
      title: `EVE University Wiki – ${page.title}`,
      url: pageUrl(page.title),
      license: 'CC BY-SA 4.0',
      retrieved,
      revision: String(page.revision),
    },
  };
  file.defaults = { confidence: 'verified', source: 'uni' };
  if (deal.length || resist.length) file.damage = { deal, resist };
  if (objectives.length) file.objectives = objectives;
  if (restrictions.length) file.restrictions = restrictions;
  if (encounterEwar.size) file.ewar = [...encounterEwar].map((kind) => ({ kind }));

  // Walk the body.
  const npcs: Record<string, Obj> = {};
  const pockets: Obj[] = [];
  let pocket: Obj | null = null;
  let wave: Obj | null = null;
  let group: string | undefined;
  let section: 'intro' | 'general' | 'pocket' | 'ignore' | 'escalation' | 'loot' = 'intro';
  const loot: Obj[] = [];
  const lootNotes: Obj[] = [];
  let table: TableReader | null = null;
  let lootLabel: string | null = null;
  let pendingWarpIn: string | undefined;
  let listLabel: string | null = null;
  /** Title of the last heading that is neither a pocket nor a skipped section. */
  let generalHeading: string | null = null;

  const newPocket = (name: string) => {
    pocket = { name, notes: [] as Obj[], waves: [] as Obj[] };
    if (pendingWarpIn) {
      pocket.onWarpIn = pendingWarpIn;
      pendingWarpIn = undefined;
    }
    pockets.push(pocket);
    wave = null;
    group = undefined;
  };
  const addNote = (text: string) => {
    if (section === 'escalation') notes.push({ text: `Escalation: ${text}` });
    else if (pocket && section === 'pocket') (pocket.notes as Obj[]).push({ text });
    else notes.push({ text });
  };

  for (const n of nodes) {
    if (n === info) continue;
    if (n.kind === 'heading') {
      if (table) loot.push(...lootRows(table, lootLabel));
      table = null;
      lootLabel = null;
      listLabel = null;
      wave = null;
      group = undefined;
      generalHeading = null;
      if (/escalat/i.test(n.title)) section = 'escalation';
      else if (LOOT_SECTION.test(n.title)) section = 'loot';
      else if (IGNORE_SECTION.test(n.title)) section = 'ignore';
      else if (POCKET_SECTION.test(n.title)) {
        section = 'pocket';
        newPocket(n.title);
      } else {
        section = 'general';
        pocket = null;
        generalHeading = cleanText(n.title);
      }
      continue;
    }
    if (n.kind === 'text') {
      if (section === 'loot') {
        if (table) {
          if (!table.line(n.text) || n.text.trim().startsWith('|}')) {
            loot.push(...lootRows(table, lootLabel));
            table = null;
          }
          continue;
        }
        if (n.text.trim().startsWith('{|')) {
          table = new TableReader();
          continue;
        }
        if (SKIP_TEXT.test(n.text)) continue;
        const t = cleanText(n.text.replace(/^[*#:;]+\s*/, ''));
        if (t.length <= 2) continue;
        if (t.endsWith(':') && t.length <= 40) {
          lootLabel = t.slice(0, -1).toLowerCase();
          continue;
        }
        lootNotes.push({ text: lootLabel && !/^(loot|salvage|bount)/i.test(t) ? `${lootLabel}: ${t}` : t });
        lootLabel = null;
        continue;
      }
      if (section === 'ignore' || SKIP_TEXT.test(n.text)) continue;
      // The "X is a combat anomaly …" sentence repeats the subtitle, except on prose pages where it is the content.
      if (!prose && section === 'intro' && /\bis an? (\[\[|level|\w+ (combat|unrated|ded))/i.test(n.text)) continue;
      // Wiki list markers (*, #, :) are layout, not content.
      const isItem = /^[*#]/.test(n.text);
      const t = cleanText(n.text.replace(/^[*#:;]+\s*/, ''));
      if (t.length <= 2 || /^incoming transmission:/i.test(t)) continue;
      // A short line ending in ":" ("Tips:") labels the list below it; carry the label into each item.
      if (!isItem && t.endsWith(':') && t.length <= 40) {
        listLabel = t;
        continue;
      }
      if (!isItem) listLabel = null;
      addNote(isItem && listLabel ? `${listLabel} ${t}` : t);
      continue;
    }

    const name = n.name.toLowerCase();
    if (name === 'messagebox' || name === 'note box') {
      const title = cleanText(n.positional[0] ?? '');
      const body = cleanText(n.positional[1] ?? '');
      if (!body || /local/i.test(title) || section === 'ignore') continue;
      if (/warp/i.test(title)) {
        if (pocket && !(pocket as Obj).onWarpIn && !((pocket as Obj).waves as Obj[]).length)
          (pocket as Obj).onWarpIn = body;
        else pendingWarpIn = body;
      } else addNote(`${title}: ${body}`);
      continue;
    }
    if (name === 'npctablehead' || name === 'npcth') {
      if (section === 'ignore' || section === 'escalation' || section === 'loot') {
        wave = null;
        continue;
      }
      const title = cleanText(n.positional[0] ?? '') || 'Wave';
      // Some pages mark rooms with table titles instead of headings.
      if (ROOM_TABLE.test(title) && (!pocket || ((pocket as Obj).waves as Obj[]).length > 0)) {
        section = 'pocket';
        newPocket(title);
      }
      if (!pocket) {
        section = 'pocket';
        // A heading like "Silo type" names a variant of the site; generic ones ("Walkthrough") do not.
        const named = generalHeading && !GENERIC_HEADING.test(generalHeading) ? generalHeading : null;
        newPocket(named ?? (pockets.length ? `Pocket ${pockets.length + 1}` : 'Pocket 1'));
      }
      const waves = (pocket as unknown as Obj).waves as Obj[];
      const isFirst = waves.length === 0;
      // Initial defenders and structures are on grid at warp-in wherever their table appears.
      const on = /timer/i.test(title)
        ? 'timer'
        : /initial|defenders|on warp|structures?$/i.test(title) ||
            (isFirst && /^(wave|wave 1|group 1|ships?|spawn|npcs?)$/i.test(title))
          ? 'warpIn'
          : 'other';
      wave = {
        id: slug(title) || `wave-${waves.length + 1}`,
        trigger: on === 'other' ? { on, text: title, confidence: 'inferred' } : { on, text: title },
        spawns: [] as Obj[],
      };
      // Keep wave ids unique within a pocket.
      if (waves.some((w) => w.id === (wave as Obj).id)) (wave as Obj).id = `${(wave as Obj).id}-${waves.length + 1}`;
      waves.push(wave);
      group = undefined;
      continue;
    }
    if (name === 'npctableseparator' || name === 'npcts') {
      group = cleanText(n.positional[0] ?? '') || undefined;
      continue;
    }
    if (name === 'npctablerow' || name === 'npctr') {
      if (!wave) continue;
      const cls = cleanText(n.positional[0] ?? '');
      if (/asteroid|ice|gas/i.test(cls)) continue;
      const cell = parseNpcCell(n.positional[2] ?? '', isNpc);
      if (!cell.names.length) continue;
      const r = n.named;
      const ewar = new Set<NpcCapabilityKind>([
        ...parseEwar(r.ewar),
        ...parseEwar(r.ewar2),
        ...parseEwar(r.ewar3),
        ...(r.damp ? (['sensorDamp'] as const) : []),
      ]);
      const point = cleanText(r.point ?? r.opint ?? '').toLowerCase();
      if (point.startsWith('scram')) ewar.add('warpScramble');
      else if (point.startsWith('yes')) ewar.add('warpDisruption');
      const spawn: Obj = {
        count: cleanText(n.positional[1] ?? '') || '?',
        ...(cls ? { class: cls } : {}),
        names: cell.display ? [cell.display] : cell.names,
        ...(group ? { group } : {}),
        ...(ewar.size ? { ewar: [...ewar].map((kind) => ({ kind })) } : {}),
      };
      const trig = cleanText(r.trigger ?? '');
      if (trig) spawn.triggers = /^yes$/i.test(trig) ? 'Trigger' : trig;
      const drop = [cleanText(r.drop ?? ''), cleanText(r.cargo ?? ''), cleanText(r.loot ?? '')]
        .filter(Boolean)
        .join('; ');
      if (drop) spawn.drop = drop;
      const noteParts = [cleanText(r.note ?? '')];
      if (cell.incomplete) noteParts.push('type list incomplete on the source page');
      const note = noteParts.filter(Boolean).join('; ');
      if (note) spawn.note = note;
      ((wave as Obj).spawns as Obj[]).push(spawn);
      if (cell.display) {
        const known = (npcs[cell.display] ??= { sdeTypes: [] as string[] });
        if (cls) known.class = cls;
        known.sdeTypes = [...new Set([...(known.sdeTypes as string[]), ...cell.names])];
      }
      continue;
    }
    if (name === 'missionbriefing' && section !== 'ignore') continue;
  }

  if (table) loot.push(...lootRows(table, lootLabel));
  if (notes.length) file.notes = notes;
  if (loot.length) file.loot = loot;
  if (lootNotes.length) file.lootNotes = lootNotes;
  if (Object.keys(npcs).length) file.npcs = npcs;
  const cleaned = pockets
    .map((pk) => {
      const out = { ...pk };
      if (!(out.notes as Obj[]).length) delete out.notes;
      if (!(out.waves as Obj[]).length) delete out.waves;
      return out;
    })
    .filter((pk) => pk.waves || pk.notes || pk.onWarpIn);
  if (cleaned.length) file.pockets = cleaned;
  return { file };
}

// Re-exported for tests.
export { parseTemplate };

/**
 * Event pages (e.g. "Crimson Harvest (2026)") describe several sites as sections of one page.
 * Each section under the "Combat" heading that has NPC tables becomes its own encounter; it is converted by
 * wrapping the section in a synthetic site page, so all the normal rules (pockets, waves, tips, loot) apply.
 */
export function convertEventPage(page: WikiPage, retrieved: string, isNpc?: NpcNameCheck): ConvertResult[] {
  const lines = page.content.replace(/\r/g, '').split('\n');
  const heading = (l: string) => /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(l);
  const event = page.title.replace(/\s*\(\d{4}\)\s*$/, '').trim();

  // Find the Combat section and the level that its sites use.
  const combatAt = lines.findIndex((l) => {
    const h = heading(l);
    return h !== null && /^combat$/i.test(cleanText(h[2]!));
  });
  if (combatAt < 0) return [{ file: null, skipped: 'no Combat section on event page' }];
  const combatLevel = heading(lines[combatAt]!)![1]!.length;
  const siteLevel = combatLevel + 1;

  interface Section {
    title: string;
    level: number;
    parent: string | null;
    body: string[];
  }
  const sections: Section[] = [];
  let parent: string | null = null;
  let cur: Section | null = null;
  for (let i = combatAt + 1; i < lines.length; i++) {
    const h = heading(lines[i]!);
    if (h && h[1]!.length <= combatLevel) break; // end of Combat
    if (h && h[1]!.length === siteLevel) {
      parent = cleanText(h[2]!);
      cur = { title: parent, level: siteLevel, parent: null, body: [] };
      sections.push(cur);
      continue;
    }
    // Sites nested one level deeper under a grouping heading such as "Escalation".
    if (h && h[1]!.length === siteLevel + 1 && parent && /escalat|advanced|sites?$/i.test(parent)) {
      cur = { title: cleanText(h[2]!), level: siteLevel + 1, parent, body: [] };
      sections.push(cur);
      continue;
    }
    cur?.body.push(lines[i]!);
  }

  const results: ConvertResult[] = [];
  for (const s of sections) {
    const hasTables = s.body.some((l) => /\{\{\s*NPCTableHead/i.test(l));
    const isGroup = sections.some((x) => x.parent === s.title);
    const hasText = s.body.some((l) => cleanText(l.replace(/^[*#:;]+\s*/, '')).length > 20);
    // A grouping heading ("Escalation") only holds its child sites; a text-only site is still worth a brief.
    if (isGroup || (!hasTables && !hasText)) {
      results.push({ file: null, skipped: `event section without NPC tables (${s.title})` });
      continue;
    }
    const kind = s.parent && /escalat/i.test(s.parent) ? 'escalation' : 'anomaly';
    // Deeper headings inside a site become its pockets.
    const body = s.body.map((l) => {
      const h = heading(l);
      return h ? `=== ${cleanText(h[2]!)} ===` : l;
    });
    const synthetic: WikiPage = {
      ...page,
      title: `${event} – ${s.title}`,
      content: `{{CMBSiteInfo\n|name = ${s.title}\n|type = ${kind}\n}}\n${body.join('\n')}`,
    };
    const r = convertWikiPage(synthetic, retrieved, isNpc);
    if (r.file) {
      const anchor = s.title.replace(/ /g, '_');
      r.file.id = slug(`${event}-${s.title}`);
      r.file.kind = kind;
      r.file.aliases = [`${event}: ${s.title}`];
      r.file.sources = {
        uni: {
          title: `EVE University Wiki – ${page.title}, section "${s.title}"`,
          url: `${pageUrl(page.title)}#${encodeURIComponent(anchor)}`,
          license: 'CC BY-SA 4.0',
          retrieved,
          revision: String(page.revision),
        },
      };
      const notes = (r.file.notes as Obj[] | undefined) ?? [];
      r.file.notes = [{ text: `Part of the ${page.title} event. Event sites change from year to year.` }, ...notes];
    }
    results.push(r);
  }
  return results;
}
