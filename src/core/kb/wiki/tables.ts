/**
 * MediaWiki tables (`{| … |}`) as plain grids: rowspan and colspan are expanded, so every row has its cells at the
 * column index the reader sees. Enough for the EVE University overview tables (EVE-74).
 */
import { cleanText, splitTopLevel } from './wikitext';

export interface WikiLink {
  /** Page title, normalised: underscores as spaces, single spaces, first letter upper case. */
  page: string;
  label: string;
}

export interface TableCell {
  header: boolean;
  /** Wikitext of the cell, attributes removed. */
  raw: string;
  text: string;
  links: WikiLink[];
  /** True on the copies a rowspan or colspan makes; the cell itself is the first one. */
  spanned: boolean;
}

export type TableRow = TableCell[];

export function normalisePage(title: string): string {
  const t = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function linksIn(raw: string): WikiLink[] {
  return [...raw.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)]
    .filter((m) => !/^(category|file|image):/i.test(m[1]!.trim()))
    .map((m) => ({ page: normalisePage(m[1]!.split('#')[0]!), label: cleanText(m[2] ?? m[1]!) }));
}

interface RawCell {
  header: boolean;
  attrs: string;
  raw: string;
}

function rawCell(header: boolean, s: string): RawCell {
  const parts = splitTopLevel(s, '|');
  return parts.length > 1
    ? { header, attrs: parts[0]!, raw: parts.slice(1).join('|') }
    : { header, attrs: '', raw: parts[0]! };
}

const span = (attrs: string, name: string) => {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs);
  return m ? Math.max(1, Number(m[1])) : 1;
};

/** Rows of raw cells, before spans are expanded. */
function rawRows(body: string[]): RawCell[][] {
  const rows: RawCell[][] = [[]];
  const row = () => rows[rows.length - 1]!;
  for (const line of body) {
    const t = line.trim();
    if (t.startsWith('|-')) {
      if (row().length) rows.push([]);
      continue;
    }
    if (t.startsWith('|+')) continue;
    if (t.startsWith('!')) {
      for (const c of t.slice(1).split(/!!|\|\|/)) row().push(rawCell(true, c));
    } else if (t.startsWith('|')) {
      for (const c of t.slice(1).split('||')) row().push(rawCell(false, c));
    } else if (row().length) {
      // A cell's text continues on the next line.
      row()[row().length - 1]!.raw += `\n${line}`;
    }
  }
  return rows.filter((r) => r.length > 0);
}

function expand(rows: RawCell[][]): TableRow[] {
  const out: TableRow[] = [];
  // Cells a rowspan carries down: column → [cell, rows left].
  const carry = new Map<number, [TableCell, number]>();
  for (const r of rows) {
    const row: TableRow = [];
    let col = 0;
    const fillCarried = () => {
      for (let c = carry.get(col); c; c = carry.get(col)) {
        row[col] = { ...c[0], spanned: true };
        if (--c[1] === 0) carry.delete(col);
        col++;
      }
    };
    for (const rc of r) {
      fillCarried();
      const cell: TableCell = {
        header: rc.header,
        raw: rc.raw.trim(),
        text: cleanText(rc.raw),
        links: linksIn(rc.raw),
        spanned: false,
      };
      const cs = span(rc.attrs, 'colspan');
      const rs = span(rc.attrs, 'rowspan');
      for (let i = 0; i < cs; i++) {
        row[col] = i === 0 ? cell : { ...cell, spanned: true };
        if (rs > 1) carry.set(col, [cell, rs - 1]);
        col++;
      }
    }
    fillCarried();
    out.push(row);
  }
  return out;
}

/** Every table of the page, nested tables included as tables of their own. */
export function parseTables(wikitext: string): TableRow[][] {
  const lines = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r/g, '')
    .split('\n');
  const tables: TableRow[][] = [];
  const stack: string[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('{|')) {
      stack.push([]);
    } else if (t.startsWith('|}')) {
      const body = stack.pop();
      if (body) tables.push(expand(rawRows(body)));
    } else if (stack.length) {
      stack[stack.length - 1]!.push(line);
    }
  }
  return tables;
}
