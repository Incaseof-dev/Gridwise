/** Minimal MediaWiki wikitext reader: just enough for EVE University mission/site pages. */

export interface Template {
  kind: 'template';
  name: string;
  positional: string[];
  named: Record<string, string>;
}

export interface Heading {
  kind: 'heading';
  level: number;
  title: string;
}

export interface TextLine {
  kind: 'text';
  text: string;
}

export type WikiNode = Template | Heading | TextLine;

/** Splits on `sep` at nesting depth 0 of `{{ }}` and `[[ ]]`. */
export function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      i++;
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--;
      i++;
    } else if (depth === 0 && s[i] === sep) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Index just after the `}}` that closes the `{{` at `from`, or -1. */
function closingBraces(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') {
      depth++;
      i++;
    } else if (s[i] === '}' && s[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function parseTemplate(inner: string): Template {
  const [rawName = '', ...params] = splitTopLevel(inner, '|');
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const p of params) {
    const eq = splitTopLevel(p, '=');
    if (eq.length > 1 && /^[\w\s-]+$/.test(eq[0]!.trim())) named[eq[0]!.trim()] = eq.slice(1).join('=').trim();
    else positional.push(p.trim());
  }
  return { kind: 'template', name: rawName.trim(), positional, named };
}

const TABLE_MARK = /^(\|\}|\|-)$/;
const NPC_TABLE = /^\s*(npctablehead|npcth|npctablerow|npctr|npctableseparator|npcts)\s*(\||\}\})/i;

/** Top-level templates, headings and text lines, in document order. */
export function parseWikitext(text: string): WikiNode[] {
  const nodes: WikiNode[] = [];
  const s = text.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '');
  let i = 0;
  let line = '';
  const flushLine = () => {
    const t = line.trim();
    line = '';
    if (!t) return;
    const h = /^(={2,6})\s*(.*?)\s*\1$/.exec(t);
    if (h) nodes.push({ kind: 'heading', level: h[1]!.length, title: cleanText(h[2]!) });
    else nodes.push({ kind: 'text', text: t });
  };
  while (i < s.length) {
    if (s.startsWith('{{', i)) {
      const end = closingBraces(s, i);
      if (end > 0) {
        // A template at the start of a line is a block (table row, info box); inside a sentence it is inline text.
        // A table's closing or row mark before it ("|}{{NPCTableHead|Wave 2}}", tables written on one line) is
        // not a sentence: the mark goes as its own line and the template stays a block.
        // The NPC table templates are blocks wherever they stand, also after a sentence on the same line ("… from
        // the warp-in point.{{NPCTableHead|}}").
        const npcTable = NPC_TABLE.test(s.slice(i + 2, i + 40));
        if (line.trim() && !npcTable && !TABLE_MARK.test(line.trim())) line += s.slice(i, end);
        else {
          flushLine();
          nodes.push(parseTemplate(s.slice(i + 2, end - 2)));
        }
        i = end;
        continue;
      }
    }
    if (s[i] === '\n') flushLine();
    else line += s[i];
    i++;
  }
  flushLine();
  return nodes;
}

/** Strips wiki markup to plain text. Inline templates are reduced to their visible text where known. */
export function cleanText(s: string): string {
  let t = s;
  // Inline templates, innermost first.
  for (let guard = 0; guard < 10 && t.includes('{{'); guard++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const tpl = parseTemplate(inner);
      const n = tpl.name.toLowerCase();
      if (n === 'co' || n === 'color') return tpl.positional[1] ?? '';
      if (n === 'icon') return tpl.positional[2] ?? tpl.positional[0] ?? '';
      if (n === 'damagetype') return tpl.positional.join('/');
      if (n === 'sh' || n === 'sk' || n === 'm3') return tpl.positional[0] ?? '';
      return '';
    });
  }
  return t
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
