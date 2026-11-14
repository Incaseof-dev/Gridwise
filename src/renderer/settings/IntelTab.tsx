import { useState } from 'react';
import {
  INTEL_SOUNDS,
  MAX_INTEL_EXPIRE_MIN,
  MAX_INTEL_RANGE,
  type IntelAlertSetting,
  type IntelSettings,
} from '@core/settings';
import type { AppViewModel } from '../../preload/api';
import { INTEL_SOUND_LABEL, playIntelSound } from '../shared/intelSound';

const set = (
  patch: Partial<Omit<IntelSettings, 'notice' | 'warning'>> & {
    notice?: Partial<IntelAlertSetting>;
    warning?: Partial<IntelAlertSetting>;
  },
) => void window.eve.updateSettings({ intel: patch });

const ZKILL_STATE: Record<AppViewModel['intel']['zkill']['state'], string> = {
  starting: 'connecting',
  running: 'live',
  blocked: 'blocked by zKillboard for now',
  error: 'trouble',
  stopped: 'stopped',
};

const STATE_TEXT: Record<AppViewModel['intel']['state'], string> = {
  off: 'Off: add an intel channel below, or turn on the zKillboard kills.',
  noData: 'Waiting for the game data (Settings → Game data): the jump map comes from it.',
  noSystem: 'Watching. Your system is not known yet: it is read from the Local chat log, so log in or jump once.',
  watching: 'Watching.',
};

function AlertRow({
  id,
  label,
  a,
  vm,
}: {
  id: 'notice' | 'warning';
  label: string;
  a: IntelAlertSetting;
  vm: AppViewModel;
}) {
  return (
    <tr>
      <td>
        <label className="check">
          <input type="checkbox" checked={a.on} onChange={(e) => set({ [id]: { on: e.target.checked } })} />
          {label}
        </label>
      </td>
      <td>
        within{' '}
        <select value={a.jumps} disabled={!a.on} onChange={(e) => set({ [id]: { jumps: Number(e.target.value) } })}>
          {Array.from({ length: MAX_INTEL_RANGE + 1 }, (_, j) => (
            <option key={j} value={j}>
              {j === 0 ? 'my system' : `${j} jump${j > 1 ? 's' : ''}`}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={a.sound}
          disabled={!a.on}
          onChange={(e) => set({ [id]: { sound: e.target.value as IntelAlertSetting['sound'] } })}
        >
          {INTEL_SOUNDS.map((s) => (
            <option key={s} value={s}>
              {INTEL_SOUND_LABEL[s]}
            </option>
          ))}
        </select>{' '}
        <button onClick={() => playIntelSound(a.sound, vm.settings.intel.volume)}>Test</button>
      </td>
    </tr>
  );
}

/** Settings → Intel (EVE-99): the channels to read, how far to look, and the sounds. */
export function IntelTab({ vm }: { vm: AppViewModel }) {
  const s = vm.settings.intel;
  const z = s.zkill;
  const [typed, setTyped] = useState('');
  const [test, setTest] = useState<string | null>(null);
  const runTest = async () => {
    const r = await window.eve.intelTest();
    setTest(r.ok ? `A test hostile is in ${r.system} (1 jump) for 30 seconds: look at the overlay.` : r.error);
  };
  const feed = vm.intel.feed;
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const add = (name: string) => {
    const n = name.trim();
    if (!n || s.channels.some((c) => c.toLowerCase() === n.toLowerCase())) return;
    set({ channels: [...s.channels, n] });
    setTyped('');
  };
  const offered = vm.intel.knownChannels.filter((c) => !s.channels.some((x) => x.toLowerCase() === c.toLowerCase()));
  const warnBeyondRange = [s.notice, s.warning].some((a) => a.on && a.jumps > s.range);

  return (
    <section className="intel-tab">
      <h2>Intel</h2>
      <p className="muted">
        Reads your alliance or coalition intel channels and shows the hostiles reported near you, closest first: pale
        yellow at the edge of the range, red at one jump, with the names and ships reported. Nothing of it is saved.
        Open the channel in game, so EVE writes its chat log.
      </p>
      <div className={`status ${vm.intel.state === 'watching' ? 'watching' : ''}`}>
        {STATE_TEXT[vm.intel.state]}
        {vm.intel.origin && ` You are in ${vm.intel.origin}.`}
        {vm.intel.state === 'watching' &&
          ` ${vm.intel.rows.length} report(s) within ${s.range} jumps` +
            (vm.intel.lastMessageMs
              ? `, last message ${new Date(vm.intel.lastMessageMs).toISOString().slice(11, 16)} EVE.`
              : '.')}
      </div>
      {s.channels.length > 0 && vm.intel.state === 'watching' && (
        <p className={`small ${feed.files ? 'muted' : 'error'}`}>
          {feed.files
            ? `Reading ${feed.files} chat log file(s)` +
              (feed.lastReadMs ? `, last line read at ${clock(feed.lastReadMs)}.` : ', no new line since the start.')
            : 'No chat log of the last 12 hours for these channels: open the channel in game (EVE writes the log only while it is open).'}
        </p>
      )}
      <p className="path">
        <button onClick={() => void runTest()} disabled={vm.intel.state !== 'watching'}>
          Test
        </button>
        <span className="muted small">
          {vm.intel.testing && test
            ? test
            : 'Puts a made-up hostile one jump away for 30 seconds, with the warning sound.'}
        </span>
      </p>

      <div className="field">
        <label>Intel channels</label>
        {s.channels.length ? (
          <table>
            <tbody>
              {s.channels.map((c) => (
                <tr key={c}>
                  <td>
                    <code>{c}</code>
                  </td>
                  <td>
                    <button className="link small" onClick={() => set({ channels: s.channels.filter((x) => x !== c) })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No channel yet.</p>
        )}
        <div className="path">
          <input
            list="intel-known-channels"
            value={typed}
            placeholder="Channel name as in game, e.g. Region.Intel"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add(typed)}
          />
          <datalist id="intel-known-channels">
            {offered.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button disabled={!typed.trim()} onClick={() => add(typed)}>
            Add
          </button>
        </div>
        {offered.length > 0 && (
          <p className="muted small">
            Channels in your chat logs lately:{' '}
            {offered.slice(0, 12).map((c) => (
              <button key={c} className="link small" onClick={() => add(c)}>
                {c}
              </button>
            ))}
          </p>
        )}
      </div>

      <div className="field">
        <label>Show as</label>
        {(
          [
            ['list', 'List: the reports, closest first, with the names and ships reported'],
            ['graph', 'Graph: the systems around you, one row per jump; a report shows as a number on its system'],
          ] as const
        ).map(([v, text]) => (
          <label key={v} className="check">
            <input type="radio" name="intelView" checked={s.view === v} onChange={() => set({ view: v })} />
            {text}
          </label>
        ))}
        <p className="muted small">
          The small button on the strip switches too. Minimized, the list becomes the one-line quick intel; the graph
          stays as it is. Ctrl + right-click a system (or click its ✕ twice) to clear it.
        </p>
      </div>

      <div className="field">
        <label>Names on the graph</label>
        {(
          [
            ['marked', 'Only where there is something: you, a report, a kill, the destination'],
            ['all', 'Every system'],
          ] as const
        ).map(([v, text]) => (
          <label key={v} className="check">
            <input
              type="radio"
              name="intelGraphNames"
              checked={s.graphNames === v}
              onChange={() => set({ graphNames: v })}
            />
            {text}
          </label>
        ))}
        <p className="muted small">Hovering a system shows its name either way.</p>
      </div>

      <div className="field">
        <label>Set destination</label>
        <label className="check">
          <input type="checkbox" checked={s.destination} onChange={(e) => set({ destination: e.target.checked })} />
          Ctrl + click a system on the graph sets it as the destination in game, and its route shows dashed
        </label>
        {s.destination && (
          <p className="muted small">
            This uses the EVE login (ESI): log in again in Settings → EVE login and tick “set destination” too. The game
            gets the destination and routes with its own preferences. The dashed line is the shortest path by gates,
            which can differ from the in-game route when the game is set to “safer”. With your own app registration in
            Settings → EVE login, add the <code>esi-ui.write_waypoint.v1</code> scope to it first.
          </p>
        )}
      </div>

      <div className="field">
        <label>Range</label>
        <select value={s.range} onChange={(e) => set({ range: Number(e.target.value) })}>
          {Array.from({ length: MAX_INTEL_RANGE }, (_, i) => i + 1).map((j) => (
            <option key={j} value={j}>
              {j} jump{j > 1 ? 's' : ''}
              {j === 5 ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="muted small">Reports farther away are not shown. Capital pilots may want up to 10.</p>
      </div>

      <div className="field">
        <label>Forget a report after</label>
        <select value={s.expireMin} onChange={(e) => set({ expireMin: Number(e.target.value) })}>
          {[3, 5, 10, 15, 20, 30, 45, MAX_INTEL_EXPIRE_MIN].map((m) => (
            <option key={m} value={m}>
              {m} minutes without news
            </option>
          ))}
        </select>
        <p className="muted small">A “clr” for the system removes it at once.</p>
      </div>

      <div className="field">
        <label>Sounds</label>
        <table>
          <tbody>
            <AlertRow id="notice" label="Notice" a={s.notice} vm={vm} />
            <AlertRow id="warning" label="Warning" a={s.warning} vm={vm} />
          </tbody>
        </table>
        <p className="muted small">
          Each system sounds once per level: the notice when it comes within its range, the warning when it comes closer
          still.
        </p>
        {warnBeyondRange && (
          <p className="error small">
            A sound reaches beyond the range: those reports are not shown, so they do not sound either.
          </p>
        )}
        <label className="check">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onChange={(e) => set({ volume: Number(e.target.value) })}
          />
          {Math.round(s.volume * 100)}%
        </label>
      </div>
      <div className="field">
        <label>zKillboard kills nearby</label>
        {(
          [
            ['quiet', 'When the intel channels are quiet (or there is none)'],
            ['always', 'Always, below the reports'],
            ['off', 'Off'],
          ] as const
        ).map(([v, text]) => (
          <label key={v} className="check">
            <input
              type="radio"
              name="zkillMode"
              checked={z.mode === v}
              onChange={() => void window.eve.updateSettings({ intel: { zkill: { mode: v } } })}
            />
            {text}
          </label>
        ))}
        <div className="path">
          <span>Quiet after</span>
          <select
            value={z.quietMin}
            disabled={z.mode !== 'quiet'}
            onChange={(e) => void window.eve.updateSettings({ intel: { zkill: { quietMin: Number(e.target.value) } } })}
          >
            {[2, 3, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m} minutes without a message
              </option>
            ))}
          </select>
          <span>show kills of the last</span>
          <select
            value={z.keepMin}
            disabled={z.mode === 'off'}
            onChange={(e) => void window.eve.updateSettings({ intel: { zkill: { keepMin: Number(e.target.value) } } })}
          >
            {[10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={z.sound}
            disabled={z.mode === 'off'}
            onChange={(e) => void window.eve.updateSettings({ intel: { zkill: { sound: e.target.checked } } })}
          />
          A new kill sounds too, like a report at that distance (off: shown only)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={z.blues}
            disabled={z.mode === 'off'}
            onChange={(e) => void window.eve.updateSettings({ intel: { zkill: { blues: e.target.checked } } })}
          />
          Count the blues as ours too: corporations and alliances with a positive standing in your, your corporation’s
          or your alliance’s contacts
        </label>
        <p className="muted small">
          The kills are split into ours lost (red), ours killed (green) and the rest, by the corporation and alliance of
          the character in game (public, no login needed). The blues need the EVE login (Settings → EVE login): log in
          again after turning this on, so it may read the contacts. They are read hourly and kept in memory only.
        </p>
        <p className="muted small">
          Player kills within the range, from zKillboard&apos;s live feed (NPC kills are left out). They reach
          zKillboard a little after they happen, so they are a second opinion, not a warning. They sound like reports
          do.{' '}
          {z.mode !== 'off' && (
            <span className={vm.intel.zkill.state === 'running' ? '' : 'error'}>
              Feed: {ZKILL_STATE[vm.intel.zkill.state]}, {vm.intel.zkill.received} kills received
              {vm.intel.zkill.lastError && vm.intel.zkill.state !== 'running' && ` (${vm.intel.zkill.lastError})`}.
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
