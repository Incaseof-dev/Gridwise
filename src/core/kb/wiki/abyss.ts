/**
 * The wiki's Abyssal Deadspace pages → kb/abyss.json (EVE-75).
 * - "Abyssal Deadspace": weathers, filament tiers, the enemy factions and what each name part means (Anchoring =
 *   scram, Fieldweaver = logi …), and the Overmind of each tier with the damage to shoot it with.
 * - "Possible rooms in Abyssal Deadspace": the rooms each tier can roll, per faction tab.
 */
import { ABYSS_SCHEMA, WEATHER_IDS, type AbyssData, type AbyssFaction, type AbyssOvermind } from '../../abyss/types';
import type { AbyssRole, AbyssRoleTag, AbyssRoom, AbyssRoomNpc, AbyssTier, AbyssWeather } from '../../abyss/types';
import type { DamageType } from '../../sde/damage';
import type { NpcCapabilityKind } from '../../sde/npcCapabilities';
import { expandNames, parseEwar, type NpcNameCheck } from './convert';
import { pageUrl, type WikiPage } from './fetch';
import { parseTables, type TableRow } from './tables';
import { cleanText, parseWikitext } from './wikitext';

export const ABYSS_PAGE = 'Abyssal Deadspace';
export const ABYSS_ROOMS_PAGE = 'Possible rooms in Abyssal Deadspace';

interface FactionDef {
  id: string;
  name: string;
  /** The faction's heading on the main page. */
  section: RegExp;
  /** The faction's tab on the rooms page; null when its ships only appear in other tabs. */
  tab: RegExp | null;
  markers: string[];
  /** Its bullet under "Damage to deal". */
  damage: RegExp;
}

const FACTIONS: FactionDef[] = [
  {
    id: 'drones',
    name: 'Rogue Drones',
    section: /^rogue drones$/i,
    tab: /rogue drone/i,
    markers: ['Tessella', 'Tessera', 'Abyssal Overmind'],
    damage: /rogue drone/i,
  },
  {
    id: 'drifters',
    name: 'Drifters and Seekers',
    section: /drifter/i,
    tab: null,
    // The SDE names Drifter types "Drifter Nullwarp Cruiser"; the wiki and the overview call them "Scylla Tyrannos".
    markers: ['Ephialtes', 'Tyrannos', 'Drifter'],
    damage: /drifter|seeker/i,
  },
  { id: 'sleepers', name: 'Sleepers', section: /sleeper/i, tab: /sleeper/i, markers: ['Lucid'], damage: /sleeper/i },
  {
    id: 'triglavian',
    name: 'Triglavian Collective',
    section: /triglavian/i,
    tab: /triglavian/i,
    markers: ['Damavik', 'Kikimora', 'Vedmak', 'Rodiva', 'Drekavac', 'Leshak'],
    damage: /triglavian/i,
  },
  {
    id: 'sansha',
    name: "Sansha's Nation",
    section: /sansha/i,
    tab: /sansha/i,
    markers: ['Devoted'],
    damage: /sansha/i,
  },
  {
    id: 'concord',
    name: 'CONCORD and EDENCOM',
    section: /concord/i,
    tab: /edencom|concord/i,
    markers: ['Disparu Troop'],
    damage: /concord/i,
  },
  {
    id: 'angel',
    name: 'Angel Cartel',
    section: /angel/i,
    tab: /angel/i,
    markers: ['Lucifer'],
    damage: /angel cartel/i,
  },
];

const DAMAGE_WORDS: [RegExp, DamageType][] = [
  [/\bem\b/i, 'em'],
  [/therm/i, 'thermal'],
  [/\bkin/i, 'kinetic'],
  [/\bexp/i, 'explosive'],
];

interface Section {
  level: number;
  title: string;
  /** Wikitext below the heading up to the next heading of any level. */
  body: string;
}

function sections(wikitext: string): Section[] {
  const out: Section[] = [{ level: 1, title: '', body: '' }];
  for (const line of wikitext.replace(/\r/g, '').split('\n')) {
    const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (h) out.push({ level: h[1]!.length, title: cleanText(h[2]!), body: '' });
    else out.at(-1)!.body += `${line}\n`;
  }
  return out;
}

function section(all: Section[], re: RegExp, page: string): Section {
  const s = all.find((x) => re.test(x.title));
  if (!s) throw new Error(`"${page}": no section matching ${re} (the page layout changed)`);
  return s;
}

/** Prose paragraphs of a section: no tables, files, templates or tab markup. */
function paragraphs(body: string): string[] {
  let depth = 0;
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t.startsWith('{|')) depth++;
    if (depth === 0 && t && !/^(\[\[(File|Image):|\{\{|<\/?tabs?\b|\|\}|<references)/i.test(t)) {
      const text = cleanText(t.replace(/^[*#:]+\s*/, ''));
      if (text) out.push(text);
    }
    if (t.startsWith('|}')) depth = Math.max(0, depth - 1);
  }
  return out;
}

const damageIn = (raw: string): DamageType[] => {
  const icons = [...raw.matchAll(/icon[ _]damage[ _](em|therm|kin|exp)/gi)].map((m) => m[1]!);
  return [...new Set(icons.flatMap((w) => DAMAGE_WORDS.filter(([re]) => re.test(w)).map(([, d]) => d)))];
};

function weathers(main: Section[]): { weathers: AbyssWeather[]; tiers: AbyssTier[] } {
  const sec = section(main, /^weather effects$/i, ABYSS_PAGE);
  const tables = parseTables(sec.body);
  const weatherTable = tables.find((t) => t[0]?.some((c) => /^weather$/i.test(c.text)));
  const tierTable = tables.find((t) => t[0]?.some((c) => /penalty strength/i.test(c.text)));
  if (!weatherTable || !tierTable)
    throw new Error(`"${ABYSS_PAGE}": weather tables not found (the page layout changed)`);

  const advice = new Map<string, string[]>();
  for (const line of sec.body.split('\n')) {
    const m = /^'''(.+?)\((.+?)\):'''\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const scope = m[2]!.toLowerCase();
    const ids = /all weathers but (\w+)/.exec(scope)
      ? WEATHER_IDS.filter((w) => w !== /all weathers but (\w+)/.exec(scope)![1])
      : WEATHER_IDS.filter((w) => scope.includes(w));
    for (const id of ids) advice.set(id, [...(advice.get(id) ?? []), cleanText(`${m[1]!.trim()}: ${m[3]}`)]);
  }

  const out: AbyssWeather[] = weatherTable.slice(1).map((r) => {
    const name = r[0]!.text;
    const id = name.toLowerCase() as AbyssWeather['id'];
    if (!WEATHER_IDS.includes(id)) throw new Error(`"${ABYSS_PAGE}": unknown weather "${name}"`);
    const penaltyText = cleanText(r[1]!.raw.replace(/\[\[(File|Image):[^\]]*\]\]/gi, ''));
    const resist = /(EM|Thermal|Kinetic|Explosive) Resist/i.exec(penaltyText);
    const damage = resist ? DAMAGE_WORDS.find(([re]) => re.test(resist[1]!))![1] : null;
    return {
      id,
      name,
      penalty: damage ? { kind: 'resist', damage, text: penaltyText } : { kind: 'turretRange', text: penaltyText },
      bonus: cleanText(r[2]!.raw.replace(/\[\[(File|Image):[^\]]*\]\]/gi, '')),
      advice: advice.get(id) ?? [],
    };
  });
  if (out.length !== WEATHER_IDS.length) throw new Error(`"${ABYSS_PAGE}": expected 5 weathers, got ${out.length}`);

  const tiers: AbyssTier[] = tierTable.slice(1).map((r) => ({
    tier: Number(r[0]!.text),
    name: r[1]!.text,
    penalty: [...r.at(-1)!.text.matchAll(/(\d+)%/g)].map((m) => Number(m[1])),
  }));
  if (tiers.length !== 7 || tiers.some((t, i) => t.tier !== i || !t.penalty.length))
    throw new Error(`"${ABYSS_PAGE}": the tier table changed`);
  return { weathers: out, tiers };
}

const HULLS = ['battlecruiser', 'battleship', 'destroyer', 'cruiser', 'frigate'];
const hullIn = (s: string) => HULLS.find((h) => new RegExp(`\\b${h}`, 'i').test(s));

/** EWAR and role of one table row of a faction's ships, read from its text and the module icons. */
function roleOf(token: string, cells: TableRow, tableHull: string | undefined): AbyssRole {
  // Footnotes describe variants ("the elite variant uses stasis web"), not this row.
  const raw = cells.map((c) => c.raw.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')).join(' ');
  const s = raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/no remote repairs?/g, '')
    .replace(/no damage/g, '');
  // Role words come from the text; damage type icons in a weapon column say nothing about the role.
  const words = cleanText(raw.replace(/\[\[(File|Image):[^\]]*\]\]/gi, ''))
    .toLowerCase()
    .replace(/no remote repairs?/g, '')
    .replace(/no damage/g, '');
  const ewar: NpcCapabilityKind[] = [];
  const add = (k: NpcCapabilityKind, re: RegExp) => re.test(s) && ewar.push(k);
  add('web', /stasis webifier|webbing|\bweb\b/);
  add('warpScramble', /warp scrambler|scrambl/);
  add('neut', /energy neutralizer|neutraliz/);
  add('sensorDamp', /sensor damp/);
  add('trackingDisruption', /track(ing)? disrupt|turret and (launcher|missile) disruption/);
  add('guidanceDisruption', /missile guidance|missile disruption|launcher disruption/);
  add('targetPaint', /target paint/);
  const tags: AbyssRoleTag[] = [];
  if (/remote (shield |armor )?(repair|logi)|shield transporter|remote-repair|remote repairs/.test(s))
    tags.push('logi');
  const bigDps = [...words.matchAll(/(\d{3,}) dps/g)].some((m) => Number(m[1]) >= 200);
  if (
    /higher damage|heavy damage|hard-?(er)?-?hitting|extreme damage|above generic|high-damage|high damage/.test(
      words,
    ) ||
    bigDps
  )
    tags.push('highDamage');
  else if (/damage dealer|\bdamage\b|\bdps\b/.test(words) && !tags.includes('logi')) tags.push('damage');
  if (/swarmer/.test(words)) tags.push('swarm');
  const hull = hullIn(raw.replace(/_/g, ' ')) ?? tableHull;
  const text = cells
    .slice(1)
    .map((c) => cleanText(c.raw.replace(/\[\[(File|Image):[^\]]*\]\]/gi, '')))
    .filter(Boolean)
    .join(' · ');
  return { token, ...(hull ? { hull } : {}), ewar, tags, text };
}

function factions(main: Section[]): AbyssFaction[] {
  const damageSec = section(main, /^damage to deal$/i, ABYSS_PAGE);
  const bullets = damageSec.body
    .split('\n')
    .filter((l) => l.trim().startsWith('*'))
    .map((l) => cleanText(l.replace(/^\s*\*+/, '')));
  return FACTIONS.map((f) => {
    const sec = section(main, f.section, ABYSS_PAGE);
    const text = cleanText(sec.body);
    for (const m of f.markers)
      if (!text.includes(m)) throw new Error(`"${ABYSS_PAGE}": "${m}" no longer named under ${f.name}`);
    const roles: AbyssRole[] = [];
    for (const table of parseTables(sec.body)) {
      const tableHull = hullIn(table[0]?.map((c) => c.raw).join(' ') ?? '');
      for (const row of table) {
        if (row.every((c) => c.header) || row.every((c) => c.text === row[0]!.text)) continue;
        const name = cleanText(row[0]!.raw).replace(/\([^)]*\)/g, '');
        for (const part of name.split('/')) {
          // "needle Tessella" → "needle"; a row that names a hull marker itself ("Damavik") keeps it.
          const stripped = f.markers
            .reduce((t, m) => t.replace(m, ''), part)
            .replace(/\bSwarmer\b/, '')
            .trim();
          const token = stripped || part.trim();
          if (token) roles.push(roleOf(token, row, tableHull));
        }
      }
    }
    if (!roles.length) throw new Error(`"${ABYSS_PAGE}": no ship table under ${f.name} (the page layout changed)`);
    const notes = paragraphs(sec.body);
    return {
      id: f.id,
      name: f.name,
      markers: f.markers,
      roles,
      notes,
      damageToDeal: bullets.filter((b) => f.damage.test(b)).join(' ') || null,
    };
  });
}

function overminds(main: Section[]): AbyssOvermind[] {
  const sec = section(main, /^damage to deal$/i, ABYSS_PAGE);
  const table = parseTables(sec.body).find((t) => t.some((r) => r.some((c) => /overmind/i.test(c.text))));
  if (!table) throw new Error(`"${ABYSS_PAGE}": the Overmind table is missing (the page layout changed)`);
  return table
    .filter((r) => /^\d$/.test(r[0]?.text ?? ''))
    .map((r) => {
      const note = /<ref[^>]*>([\s\S]*?)<\/ref>/.exec(r[2]?.raw ?? '')?.[1];
      return {
        tier: Number(r[0]!.text),
        name: r[1]!.text,
        damage: damageIn(r[2]?.raw ?? ''),
        ...(note ? { note: cleanText(note) } : {}),
      };
    });
}

/**
 * "Striking/Anchoring/Ghosting Damavik" → the shared last words go to every name; otherwise like expandNames.
 * "(Elite) Lucifer Dramiel" stands for both variants; "Karybdis Tyrannos (Rearguard)" for the Karybdis Tyrannos.
 */
function roomNames(list: string, isNpc?: NpcNameCheck): string[] {
  const elite = /^\(elite\)\s*/i.test(cleanText(list));
  const text = cleanText(list)
    .replace(/^\(elite\)\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '');
  const parts = text
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts.at(-1)?.split(' ') ?? [];
  const names =
    parts.length > 1 && last.length > 1 && parts.slice(0, -1).every((p) => !p.includes(' '))
      ? [...parts.slice(0, -1).map((p) => `${p} ${last.slice(1).join(' ')}`), parts.at(-1)!]
      : expandNames(text, isNpc).names;
  const real = names.filter((n) => !/^(\.\.\.|…)/.test(n));
  // Only some hulls have an elite variant; with the SDE at hand, the others are left out.
  return elite
    ? real.flatMap((n) => [n, `Elite ${n}`]).filter((n) => !isNpc || !n.startsWith('Elite ') || isNpc(n))
    : real;
}

function rooms(page: WikiPage, isNpc?: NpcNameCheck): AbyssRoom[] {
  const out: AbyssRoom[] = [];
  let tier: number | null = null;
  let faction: string | null = null;
  let note: string[] = [];
  let room: AbyssRoom | null = null;
  for (const n of parseWikitext(page.content)) {
    if (n.kind === 'heading') {
      const m = /^tier (\d) abyssal/i.exec(n.title);
      tier = m ? Number(m[1]) : null;
      faction = null;
      note = [];
      continue;
    }
    if (tier === null) continue;
    if (n.kind === 'text') {
      const tab = /^<tab name="([^"]+)"/.exec(n.text);
      if (tab) {
        const f = FACTIONS.find((x) => x.tab?.test(tab[1]!));
        if (!f) throw new Error(`"${ABYSS_ROOMS_PAGE}": unknown faction tab "${tab[1]}"`);
        faction = f.id;
        note = [];
      } else if (n.text.startsWith('|}')) {
        if (room?.npcs.length) out.push(room);
        room = null;
      } else if (!/^<\/?tabs?\b/.test(n.text)) {
        const t = cleanText(n.text);
        if (t) note.push(t);
      }
      continue;
    }
    if (!faction) continue;
    if (/^npctablehead$/i.test(n.name)) {
      const text = note.join(' ') || null;
      room = { tier, faction, note: text, dpsCheck: /dps check room/i.test(text ?? ''), npcs: [] };
      note = [];
    } else if (/^npctablerow$/i.test(n.name) && room) {
      const [cls = '', count = '', names = ''] = n.positional;
      const values = [n.named.ewar, n.named.ewar2, n.named.point];
      const ewar = [
        ...new Set([
          ...values.flatMap((v) => parseEwar(v)),
          // The rooms page writes guidance disruption as "GD", which the generic reader does not know.
          ...(values.some((v) => /^\s*GD\s*$/i.test(v ?? '')) ? (['guidanceDisruption'] as const) : []),
        ]),
      ];
      const npc: AbyssRoomNpc = {
        class: cleanText(cls),
        count: cleanText(count),
        names: roomNames(names, isNpc),
        ewar,
      };
      if (n.named.note) npc.note = cleanText(n.named.note);
      room.npcs.push(npc);
    }
  }
  // Every tab has rooms in the tiers the wiki documents best.
  for (const f of FACTIONS.filter((x) => x.tab))
    for (const t of [0, 1])
      if (!out.some((r) => r.tier === t && r.faction === f.id))
        throw new Error(`"${ABYSS_ROOMS_PAGE}": no ${f.name} rooms in tier ${t} (the page layout changed)`);
  return out;
}

export function abyssFromWiki(main: WikiPage, roomsPage: WikiPage, retrieved: string, isNpc?: NpcNameCheck): AbyssData {
  const mainSecs = sections(main.content);
  const roomSecs = sections(roomsPage.content);
  const { weathers: w, tiers } = weathers(mainSecs);
  const enemies = section(mainSecs, /^enemies$/i, ABYSS_PAGE);
  const general = [
    ...paragraphs(enemies.body).filter((p) => /naming pattern|priorit|EWAR|remote repair/i.test(p)),
    ...paragraphs(section(roomSecs, /^general notes$/i, ABYSS_ROOMS_PAGE).body),
    ...paragraphs(section(roomSecs, /^loot$/i, ABYSS_ROOMS_PAGE).body),
  ];
  const source = (p: WikiPage) => ({
    title: p.title,
    url: pageUrl(p.title),
    revision: p.revision,
    retrieved,
    license: 'CC BY-SA 4.0',
  });
  return {
    schema: ABYSS_SCHEMA,
    sources: [source(main), source(roomsPage)],
    tiers,
    weathers: w,
    factions: factions(mainSecs),
    overminds: overminds(mainSecs),
    rooms: rooms(roomsPage, isNpc),
    general,
  };
}
