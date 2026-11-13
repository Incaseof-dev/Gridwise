/**
 * Runs the intel parser over the developer's real intel channel logs (not committed) and reports how many messages
 * name a system. Skipped without the chat logs or the local SDE index. Channels: EVE_INTEL_CHANNELS (comma
 * separated), else those set in the local Gridwise settings (~/.config/gridwise/settings.json); directory:
 * EVE_CHATLOG_DIR.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChatFileName } from '@core/logs/chatFollower';
import { IntelLexicon, parseIntelLine, parseIntelText } from '@core/intel/parser';
import { GameDataService } from '@core/sde/gameData';

const dir =
  process.env.EVE_CHATLOG_DIR ??
  join(
    process.env.HOME ?? '',
    '.local/share/Steam/steamapps/compatdata/8500/pfx/drive_c/users/steamuser/Documents/EVE/logs/Chatlogs',
  );
const sde = join(__dirname, '..', 'data', 'sde.sqlite');
const settingsFile = join(process.env.HOME ?? '', '.config/gridwise/settings.json');
const fromSettings = (): string[] => {
  try {
    const s = JSON.parse(readFileSync(settingsFile, 'utf8')) as { intel?: { channels?: string[] } };
    return s.intel?.channels ?? [];
  } catch {
    return [];
  }
};
const channels = new Set(
  (process.env.EVE_INTEL_CHANNELS?.split(',') ?? fromSettings()).map((c) => c.trim().toLowerCase()).filter(Boolean),
);
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => channels.has(parseChatFileName(f)?.channel.toLowerCase() ?? ''))
  : [];

describe.skipIf(!files.length || !existsSync(sde))('corpus: real intel channel logs', () => {
  it('finds a system in most messages', () => {
    const gd = new GameDataService(sde);
    const lex = new IntelLexicon(gd.systemNames(), gd.shipNames());
    gd.close();
    let messages = 0;
    let withSystem = 0;
    for (const f of files) {
      const text = readFileSync(join(dir, f)).toString('utf16le');
      for (const raw of text.split('\n')) {
        const line = parseIntelLine(raw);
        if (!line) continue;
        messages++;
        if (parseIntelText(line.text, lex).systems.length) withSystem++;
      }
    }
    console.log(`intel corpus: ${files.length} files, ${messages} messages, ${withSystem} with a system`);
    expect(withSystem / messages).toBeGreaterThan(0.7);
  });
});
