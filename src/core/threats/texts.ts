/**
 * Texts of the timed messages (task EVE-56): `messages/messages.yaml`, keyed by trigger, phase and sarcasm level,
 * with a user file that replaces single lists. See docs/messages.md.
 *
 * Level 0 is the plain, explanatory tone; 1–3 get more sarcastic. A level without texts falls back to the next lower
 * one. Each message gets its text once (random, no repeats until the list is used up) and keeps it while shown.
 */
import { existsSync, readFileSync } from 'node:fs';
import { LineCounter, parseDocument } from 'yaml';
import type { KbIssue } from '../kb/types';

export const MAX_SARCASM = 3;
export const PLACEHOLDERS = ['npcs', 'has', 'min', 'Min', 'gj'] as const;

/** "trigger/phase" → texts per level (index = level). */
export type TextPool = Map<string, string[][]>;

export interface MessageVars {
  npcs: string[];
  durationMs: number;
  /** Neut amount of the streak; null when not a neut. */
  gj: number | null;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export function fillText(text: string, v: MessageVars): string {
  const min = Math.max(1, Math.round(v.durationMs / 60_000));
  const word = WORDS[min] ?? String(min);
  return text
    .replaceAll('{npcs}', v.npcs.join(', ') || 'Something')
    .replaceAll('{has}', v.npcs.length > 1 ? 'have' : 'has')
    .replaceAll('{min}', String(min))
    .replaceAll('{Min}', word[0]!.toUpperCase() + word.slice(1))
    .replaceAll('{gj}', v.gj === null ? '?' : Math.round(v.gj).toLocaleString('en-US'));
}

/**
 * Reads one messages file into `pool` (a list in a later file replaces the same list of an earlier one).
 * Shape: `<trigger>: { <phase>: { <level 0–3>: [text, …] } }`.
 */
export function readTextFile(file: string, pool: TextPool, issues: KbIssue[]): void {
  if (!existsSync(file)) return;
  const lc = new LineCounter();
  const doc = parseDocument(readFileSync(file, 'utf8'), { lineCounter: lc });
  const issue = (path: string, message: string, severity: KbIssue['severity'] = 'error') => {
    issues.push({ file, line: null, path, message, severity });
  };
  for (const e of doc.errors)
    issues.push({ file, line: lc.linePos(e.pos[0]).line, path: '', message: e.message, severity: 'error' });
  if (doc.errors.length) return;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const root: unknown = doc.toJS();
  if (root === null || root === undefined) return;
  if (!isObj(root)) {
    issue('', 'expected a map of triggers');
    return;
  }
  for (const [trigger, phases] of Object.entries(root)) {
    if (!isObj(phases)) {
      issue(trigger, 'expected a map of phases');
      continue;
    }
    for (const [phase, levels] of Object.entries(phases)) {
      const key = `${trigger}/${phase}`;
      if (!isObj(levels)) {
        issue(key, 'expected a map of levels 0–3');
        continue;
      }
      const list = pool.get(key) ?? [];
      for (const [level, texts] of Object.entries(levels)) {
        const n = Number(level);
        if (!Number.isInteger(n) || n < 0 || n > MAX_SARCASM) {
          issue(`${key}/${level}`, 'level must be 0–3');
          continue;
        }
        if (!Array.isArray(texts) || !texts.every((t) => typeof t === 'string' && t.trim())) {
          issue(`${key}/${level}`, 'expected a list of non-empty texts');
          continue;
        }
        for (const t of texts as string[])
          for (const m of t.matchAll(/\{(\w+)\}/g))
            if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!))
              issue(`${key}/${level}`, `unknown placeholder {${m[1]}} in "${t}"`, 'warning');
        list[n] = texts as string[];
      }
      pool.set(key, list);
    }
  }
}

export function loadTextPool(files: string[]): { pool: TextPool; issues: KbIssue[] } {
  const pool: TextPool = new Map();
  const issues: KbIssue[] = [];
  for (const f of files) readTextFile(f, pool, issues);
  return { pool, issues };
}

/** Picks texts for messages: once per message id and level, random without repeats per list. */
export class TextPicker {
  private readonly chosen = new Map<string, string>();
  private readonly bags = new Map<string, number[]>();

  constructor(
    private readonly pool: TextPool,
    private readonly random: () => number = Math.random,
  ) {}

  /** Texts used at `level` for `key` (falling back to lower levels), or null when there are none. */
  texts(key: string, level: number): string[] | null {
    const levels = this.pool.get(key);
    for (let l = Math.min(level, MAX_SARCASM); l >= 0; l--) if (levels?.[l]?.length) return levels[l]!;
    return null;
  }

  text(key: string, level: number, id: string, vars: MessageVars): string {
    const list = this.texts(key, level);
    if (!list) return key;
    const cacheKey = `${id}|${level}`;
    let raw = this.chosen.get(cacheKey);
    if (raw === undefined) {
      const bagKey = `${key}|${level}`;
      let bag = this.bags.get(bagKey);
      if (!bag?.length) bag = list.map((_, i) => i);
      const [i] = bag.splice(Math.floor(this.random() * bag.length), 1);
      this.bags.set(bagKey, bag);
      raw = list[i!]!;
      this.chosen.set(cacheKey, raw);
      // Messages last a minute; keep the cache small.
      if (this.chosen.size > 200) this.chosen.delete(this.chosen.keys().next().value!);
    }
    return fillText(raw, vars);
  }
}
