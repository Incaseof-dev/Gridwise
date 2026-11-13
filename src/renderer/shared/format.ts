/** Electron accelerator → what the player presses: "CommandOrControl+Alt+F" → "Ctrl+Alt+F". */
export function shortcutLabel(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl');
}

const CODE_KEY: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

/**
 * A keydown → an Electron accelerator, or null while only modifiers are down (or for keys that cannot be bound).
 * The physical key (`code`) decides, not the character: Ctrl+Alt is AltGr on Windows and types something else.
 * Without Ctrl or Alt only F-keys pass, so plain typing in the game cannot fire a shortcut.
 */
export function acceleratorFromKey(e: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit\d$/.test(e.code)
      ? e.code.slice(5)
      : /^Numpad\d$/.test(e.code)
        ? `num${e.code.slice(6)}`
        : /^F([1-9]|1\d|2[0-4])$/.test(e.code)
          ? e.code
          : (CODE_KEY[e.code] ?? null);
  if (!key) return null;
  const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(
    Boolean,
  );
  if (!e.ctrlKey && !e.altKey && !/^F\d/.test(key)) return null;
  return [...mods, key].join('+');
}

/** 1234 → "1.2k", 12_400_000 → "12.4M". */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** 83_000 ms → "1:23". */
export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Whose skills fit numbers use (EVE-38): "all skills at V", or "Pilot's skills, 3 implants". */
export function skillsNote(skills: 'all-v' | { character: string; implants: number }): string {
  if (skills === 'all-v') return 'all skills at V';
  const imp = skills.implants === 1 ? '1 implant' : `${skills.implants} implants`;
  return `${skills.character}'s skills, ${imp}`;
}
