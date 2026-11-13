import { useEffect, useState } from 'react';
import { DEFAULT_SHORTCUTS } from '../../core/settings';
import { acceleratorFromKey, shortcutLabel } from '../shared/format';
import { AbyssLogTab } from './AbyssLog';
import { AbyssTab } from './AbyssTab';
import { EnemySites } from './EnemySites';
import { EsiTab } from './EsiTab';
import { FitSection } from './FitSection';
import { IntelTab } from './IntelTab';
import type { AppViewModel } from '../../preload/api';
import { useViewModel } from '../shared/useViewModel';

const SECTION_LABEL = {
  header: 'Header (status, character, system)',
  threats: 'Threat warnings (from the log + known NPC capabilities)',
  loot: 'Rare loot alerts (faction/officer/overseer NPCs in the fight)',
  encounter: 'Encounter brief',
  combat: 'Combat statistics',
} as const;

const SARCASM_LABEL = ['plain and explanatory', 'friendly', 'sarcastic', 'capsuleer, please'];

const shortcut = shortcutLabel;

type ShortcutId = keyof AppViewModel['settings']['shortcuts'];

const SHORTCUT_ROWS: [ShortcutId, string][] = [
  ['search', 'Search encounter'],
  ['toggleClickThrough', 'Toggle click-through'],
  ['toggleOverlay', 'Show/hide overlay'],
  ['minimize', 'Minimize to the top / restore'],
  ['prevPocket', 'Previous pocket'],
  ['nextPocket', 'Next pocket'],
];

/** One shortcut: click it, press the new keys. Taken combinations are refused; Reset goes back to the default. */
function ShortcutRow({ id, label, vm }: { id: ShortcutId; label: string; vm: AppViewModel }) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const all = vm.settings.shortcuts;
  const current = all[id];
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setRecording(false);
      const acc = acceleratorFromKey(e);
      if (!acc) return;
      const taken = SHORTCUT_ROWS.find(([k]) => k !== id && all[k] === acc);
      setRecording(false);
      if (taken) return setProblem(`${shortcut(acc)} is already "${taken[1]}"`);
      setProblem(null);
      if (acc !== current) void window.eve.updateSettings({ shortcuts: { [id]: acc } });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, id, all, current]);
  const failed = vm.diagnostics.shortcutErrors.some((e) => e.startsWith(`${current} `) || e.startsWith(`${current}:`));
  return (
    <tr>
      <td>{label}</td>
      <td>
        <button
          className={`shortcut-key${recording ? ' recording' : ''}${failed ? ' bad' : ''}`}
          title="Click, then press the new keys"
          onClick={() => {
            setProblem(null);
            setRecording(!recording);
          }}
        >
          <kbd>{recording ? 'press keys…' : shortcut(current)}</kbd>
        </button>
        {current !== DEFAULT_SHORTCUTS[id] && !recording && (
          <button
            className="link small"
            onClick={() => void window.eve.updateSettings({ shortcuts: { [id]: DEFAULT_SHORTCUTS[id] } })}
          >
            Reset ({shortcut(DEFAULT_SHORTCUTS[id])})
          </button>
        )}
        {problem && <span className="error small"> {problem}</span>}
      </td>
    </tr>
  );
}

function General({ vm }: { vm: AppViewModel }) {
  return (
    <section>
      <h2>Game logs</h2>
      <div className="field">
        <label>Gamelogs folder</label>
        <div className="path">
          <code>{vm.log.dir}</code>
          <button onClick={() => void window.eve.pickLogDir()}>Choose…</button>
        </div>
        <div className={`status ${vm.log.state}`}>
          {vm.log.state === 'watching' && `Watching · ${vm.log.files} active log file(s)`}
          {vm.log.state === 'dirMissing' && 'Folder not found. Is EVE installed through Steam/Proton at this path?'}
          {vm.log.state === 'error' && `Error: ${vm.log.error}`}
          {vm.log.state === 'starting' && 'Starting…'}
        </div>
      </div>
      <div className="field">
        <label>Characters seen since start</label>
        {vm.characters.length ? (
          <table>
            <tbody>
              {vm.characters.map((c) => (
                <tr key={c.file}>
                  <td>{c.name}</td>
                  <td>
                    {c.system
                      ? `${c.system.name}${c.system.security !== null ? ` (${c.system.security.toFixed(1)})` : ''}`
                      : 'location unknown until the next jump/undock'}
                  </td>
                  <td className="muted">{c.lastEventAt ? c.lastEventAt.slice(11, 19) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">None yet. Log files active in the last 12 hours are followed.</p>
        )}
      </div>
    </section>
  );
}

function Overlay({ vm }: { vm: AppViewModel }) {
  const o = vm.settings.overlay;
  return (
    <section>
      <h2>Overlay</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={o.visible}
          onChange={(e) => void window.eve.updateSettings({ overlay: { visible: e.target.checked } })}
        />
        Show overlay
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={o.clickThrough}
          onChange={(e) => void window.eve.setClickThrough(e.target.checked)}
        />
        Click-through (mouse goes to EVE). Toggle anywhere with{' '}
        <kbd>{shortcut(vm.settings.shortcuts.toggleClickThrough)}</kbd>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={o.aboveFullscreen}
          onChange={(e) => void window.eve.updateSettings({ overlay: { aboveFullscreen: e.target.checked } })}
        />
        Stay above fullscreen games (KDE; takes effect after a restart)
      </label>
      <p className="muted">Overlay layer: {vm.diagnostics.overlayLayer}</p>
      <div className="field">
        <label>Opacity: {Math.round(o.opacity * 100)}%</label>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.02}
          value={o.opacity}
          onChange={(e) => void window.eve.updateSettings({ overlay: { opacity: Number(e.target.value) } })}
        />
      </div>
      <div className="field">
        <label>Backseat Capsuleer: {SARCASM_LABEL[o.sarcasm] ?? o.sarcasm}</label>
        <input
          type="range"
          min={0}
          max={3}
          step={1}
          value={o.sarcasm}
          onChange={(e) => void window.eve.updateSettings({ overlay: { sarcasm: Number(e.target.value) } })}
        />
        <p className="muted">
          The voice of the timed messages about neuts, jams, webs and long fights. Scram and point warnings stay plain
          at every level.
        </p>
      </div>
      <div className="field">
        <label>Sections</label>
        {(['header', 'threats', 'loot', 'encounter', 'combat'] as const).map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={o.sections[k]}
              onChange={(e) => void window.eve.updateSettings({ overlay: { sections: { [k]: e.target.checked } } })}
            />
            {k === 'threats' && !vm.liveCombat
              ? 'Threat warnings (known NPC capabilities, trigger hits)'
              : SECTION_LABEL[k]}
          </label>
        ))}
      </div>
      <div className="field">
        <label>Brief header</label>
        {(
          [
            ['scroll', 'Scroll aware: full at the top, condensed to one or two rows once you scroll'],
            ['compact', 'Compact: always the condensed rows, more room for the waves'],
          ] as const
        ).map(([mode, text]) => (
          <label key={mode} className="check">
            <input
              type="radio"
              name="headerMode"
              checked={o.headerMode === mode}
              onChange={() => void window.eve.updateSettings({ overlay: { headerMode: mode } })}
            />
            {text}
          </label>
        ))}
      </div>
      <div className="field">
        <label>While minimized, still show</label>
        {(
          [
            [
              'threats',
              vm.liveCombat ? 'EWAR warnings (scram, point, neut …)' : 'Threat warnings (can scram, can web …)',
            ],
            ['loot', 'Rare loot alerts (faction, officer, overseer NPCs in the fight), one line each'],
            ['intel', 'Quick intel (the closest report, Settings → Intel)'],
            ['messages', 'Comments (the timed messages)'],
            ['combat', 'DPS and damage application'],
          ] as const
        ).map(([k, text]) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={o.minimizedShow[k]}
              onChange={(e) =>
                void window.eve.updateSettings({ overlay: { minimizedShow: { [k]: e.target.checked } } })
              }
            />
            {text}
          </label>
        ))}
        <p className="muted">
          Nothing checked: only the header row while minimized. A strip whose section is off above stays off here too.
        </p>
      </div>
      <div className="field">
        <label>Shortcuts</label>
        <table>
          <tbody>
            {SHORTCUT_ROWS.map(([k, label]) => (
              <ShortcutRow key={k} id={k} label={label} vm={vm} />
            ))}
          </tbody>
        </table>
        <p className="muted">
          Click a shortcut and press the new keys (Ctrl or Alt with a key, or an F-key alone); Esc cancels.
        </p>
        {vm.diagnostics.shortcutErrors.map((e) => (
          <p key={e} className="error">
            {shortcutLabel(e)}: another program or the system may hold it. Click it above to pick another.
          </p>
        ))}
      </div>
    </section>
  );
}

function Data({ vm }: { vm: AppViewModel }) {
  return (
    <section>
      <h2>Game data</h2>
      <div className="field">
        <label>Static Data Export (SDE)</label>
        <p>
          {vm.sde.state === 'ready' && `Build ${vm.sde.build}`}
          {vm.sde.state === 'missing' &&
            'Not downloaded yet. NPC stats, EWAR and gate restrictions need it (about 100 MB download, 25 MB on disk).'}
          {vm.sde.state === 'error' && 'The local SDE index cannot be opened.'}
          {vm.sde.state === 'updating' && 'Updating…'}
        </p>
        {vm.sde.message && <p className="muted">{vm.sde.message}</p>}
        <button disabled={vm.sde.state === 'updating'} onClick={() => void window.eve.updateSde()}>
          {vm.sde.state === 'missing' ? 'Download SDE' : 'Check for update'}
        </button>
      </div>
      <div className="field">
        <label>Automatic updates</label>
        <label className="check">
          <input
            type="checkbox"
            checked={vm.updates.auto}
            onChange={(e) => void window.eve.updateSettings({ updates: { auto: e.target.checked } })}
          />
          Keep game data and the knowledge base up to date (SDE: daily check, wiki: weekly; only changed data is
          downloaded)
        </label>
        <p className="muted">
          SDE checked: {vm.updates.sdeCheckedAt ? new Date(vm.updates.sdeCheckedAt).toLocaleString() : 'never'} · Wiki
          checked: {vm.updates.wikiCheckedAt ? new Date(vm.updates.wikiCheckedAt).toLocaleString() : 'never'}
        </p>
        {vm.updates.lastMessage && <p className="muted">{vm.updates.lastMessage}</p>}
        <button disabled={vm.updates.running} onClick={() => void window.eve.checkUpdates()}>
          {vm.updates.running ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <div className="field">
        <label>Encounter knowledge base</label>
        <p>
          {vm.kb.encounters} encounters
          {vm.kb.issues > 0 && <span className="error"> · {vm.kb.issues} file(s) with errors (see console)</span>}
        </p>
        <p className="muted">
          Bundled entries come from the EVE University wiki (CC BY-SA 4.0) and are marked “unreviewed” until checked.
        </p>
      </div>
    </section>
  );
}

function Diagnostics({ vm }: { vm: AppViewModel }) {
  const d = vm.diagnostics;
  return (
    <section>
      <h2>Diagnostics</h2>
      <p className="muted">
        v{d.platform.version} · Electron {d.platform.electron} · {d.platform.sessionType} session, ozone{' '}
        {d.platform.ozone} · {d.platform.desktop}
      </p>
      <p>
        {d.events} log events since start, {d.unknown} not understood.
      </p>
      <table className="events">
        <tbody>
          {d.recent.slice(0, 30).map((e, i) => (
            <tr key={i}>
              <td className="muted">{e.time.slice(11, 19)}</td>
              <td>{e.kind}</td>
              <td>{e.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const DOCS_URL = 'https://docs.incaseof.dev/en/gridwise/latest/overview';
const UNI_WIKI_URL = 'https://wiki.eveuniversity.org';
const REFERRAL_URL = 'https://www.eveonline.com/signup?invc=ed49e250-20cf-4e22-86e1-a1759f3c58b5';
const DONATE_CHARACTER = 'Pudingg Otsito';

const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
};

/** New app versions from the GitHub releases: downloaded in the background, installed on restart or at quit. */
function AppUpdate({ vm }: { vm: AppViewModel }) {
  const u = vm.appUpdate;
  const open = () => window.eve.openExternal(u.releaseUrl);
  let status: React.ReactNode;
  switch (u.state) {
    case 'checking':
      status = 'Looking for a new version…';
      break;
    case 'none':
      status = `Up to date${u.checkedAt ? ` (checked ${ago(u.checkedAt)})` : ''}.`;
      break;
    case 'available':
      status = (
        <>
          Version {u.version} is out. This build cannot replace itself (the Windows zip):{' '}
          <button className="link" onClick={open}>
            download it
          </button>
          .
        </>
      );
      break;
    case 'downloading':
      status = `Downloading version ${u.version ?? ''}… ${u.percent ?? 0}%`;
      break;
    case 'ready':
      status = `Version ${u.version} is downloaded. It installs when you restart, or at the next quit.`;
      break;
    case 'error':
      status = <span className="error">Update check failed: {u.error}</span>;
      break;
    default:
      status = vm.updates.app ? 'The first look is a little after start.' : 'Automatic checks are off.';
  }
  return (
    <>
      <h3>Version {u.current}</h3>
      <p>{status}</p>
      <p className="path">
        {u.state === 'ready' ? (
          <button className="primary" onClick={() => void window.eve.installAppUpdate()}>
            Restart to update
          </button>
        ) : (
          <button
            disabled={u.state === 'checking' || u.state === 'downloading'}
            onClick={() => void window.eve.checkAppUpdate()}
          >
            Check now
          </button>
        )}{' '}
        <button className="link small" onClick={open}>
          Release notes
        </button>
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={vm.updates.app}
          onChange={(e) => void window.eve.updateSettings({ updates: { app: e.target.checked } })}
        />
        Look for new versions (at start and every 4 hours, from GitHub; nothing about you is sent)
      </label>
    </>
  );
}

function About({ vm }: { vm: AppViewModel }) {
  const [copied, setCopied] = useState(false);
  const copyName = (): void => {
    void navigator.clipboard.writeText(DONATE_CHARACTER).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const link = (url: string, text: string) => (
    <button className="link" onClick={() => window.eve.openExternal(url)}>
      {text}
    </button>
  );

  return (
    <section className="about">
      <h2>About</h2>
      <p className="about-name">
        <strong>Gridwise</strong> · Know the grid. Survive the fight.
        <br />
        <span className="muted">by In Case Of</span>
      </p>
      <p>
        A PvE companion for the overlay: threat warnings, encounter briefs, fit checks and the Abyss log. How it works,
        tab by tab: {link(DOCS_URL, 'documentation')}.
      </p>

      <AppUpdate vm={vm} />

      <h3>Who made it</h3>
      <p>
        The app is my work: I fly as <strong>{DONATE_CHARACTER}</strong> and built it to give something useful back to
        the community.
      </p>
      <p>
        The knowledge behind it is not mine. The encounter data, NPC notes and site guides are the work of{' '}
        {link(UNI_WIKI_URL, 'EVE University')} and the people who write their wiki; I only built a comfortable frame
        around it. If a brief helped you, thank them too.
      </p>

      <h3>Support</h3>
      <p>
        <strong>New to EVE?</strong> If nobody recruited you yet, sign up with {link(REFERRAL_URL, 'my referral link')}:
        you get 1,000,000 skill points as a gift, and I get a bonus if you buy game time.
      </p>
      <p>
        <strong>In game:</strong> if you feel the tool earned it, ISK or in-game items to{' '}
        <strong>{DONATE_CHARACTER}</strong> are welcome.{' '}
        <button className="link" onClick={copyName}>
          {copied ? 'Name copied' : 'Copy name'}
        </button>
      </p>

      <h3>Licenses</h3>
      <p className="muted">
        Gridwise is free software under the GNU General Public License v3.0 or later. Fit stats come from eve-fit-engine
        (GPL-3.0-or-later), a port of Pyfa.
      </p>
      <p className="muted">
        Encounter data derived from the EVE University wiki (CC BY-SA 4.0). Game data, ship images and icons by CCP hf.,
        used under the EVE Online Developer License Agreement for non-commercial use.
      </p>
      <p className="muted">
        © 2014 CCP hf. All rights reserved. &quot;EVE&quot;, &quot;EVE Online&quot;, &quot;CCP&quot;, and all related
        logos and images are trademarks or registered trademarks of CCP hf.
      </p>
      <p className="muted">
        Gridwise is a third-party tool. CCP does not endorse or support third-party tools, and using one is at your own
        risk.
      </p>
    </section>
  );
}

const TABS = [
  { id: 'logs', label: 'Game logs', View: General },
  { id: 'fit', label: 'Ship fit', View: FitSection },
  { id: 'esi', label: 'EVE login', View: EsiTab },
  { id: 'overlay', label: 'Overlay', View: Overlay },
  { id: 'intel', label: 'Intel', View: IntelTab },
  { id: 'sites', label: 'Enemy sites', View: EnemySites },
  { id: 'abyss', label: 'Abyss', View: AbyssTab },
  { id: 'abyss-log', label: 'Abyss log', View: AbyssLogTab },
  { id: 'data', label: 'Game data', View: Data },
  { id: 'diagnostics', label: 'Diagnostics', View: Diagnostics },
  { id: 'about', label: 'About', View: About },
] as const;
type TabId = (typeof TABS)[number]['id'];
const TAB_KEY = 'settings.tab';

/** Last open tab, remembered per viewer; storage can be unavailable, then the first tab opens. */
function readTab(): TabId | null {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.find((t) => t.id === v)?.id ?? null;
  } catch {
    return null;
  }
}

function writeTab(v: TabId): void {
  try {
    localStorage.setItem(TAB_KEY, v);
  } catch {
    // ignore
  }
}

/** Tabs with something the player has to fix get a mark, so a problem is not hidden behind another tab. */
function needsAttention(vm: AppViewModel): Set<TabId> {
  const out = new Set<TabId>();
  if (vm.log.state === 'dirMissing' || vm.log.state === 'error') out.add('logs');
  if (vm.sde.state === 'missing' || vm.sde.state === 'error' || vm.kb.issues > 0) out.add('data');
  if (vm.fit.engine === 'error' || vm.fit.active?.error) out.add('fit');
  if (vm.diagnostics.shortcutErrors.length) out.add('overlay');
  return out;
}

export function SettingsApp() {
  const vm = useViewModel();
  const [tab, setTab] = useState<TabId | null>(readTab);
  // The overlay asked for a run's loot (EVE-86): the Abyss tab opens with its dialog.
  const [lootFor, setLootFor] = useState<string | null>(null);
  useEffect(
    () =>
      window.eve.onNavigate((nav) => {
        setTab(nav.tab);
        setLootFor(nav.run ?? null);
      }),
    [],
  );
  if (!vm) return <main>Loading…</main>;
  // First start without game data: open where it is downloaded.
  const current = tab ?? (vm.sde.state === 'missing' ? 'data' : 'logs');
  const attention = needsAttention(vm);
  const { View } = TABS.find((t) => t.id === current) ?? TABS[0];
  const select = (id: TabId) => {
    setTab(id);
    writeTab(id);
  };
  return (
    <main>
      <h1>Gridwise</h1>
      <p className="muted">
        Know the grid. Survive the fight. A passive PvE companion: it only reads log files and public game data, and it
        never touches the game client.
      </p>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current}
            className={t.id === current ? 'active' : undefined}
            onClick={() => select(t.id)}
          >
            {t.label}
            {attention.has(t.id) && <span className="attention" title="Needs attention" />}
          </button>
        ))}
      </nav>
      <div className="tab-panel" role="tabpanel">
        {current === 'abyss-log' ? (
          <AbyssLogTab vm={vm} lootFor={lootFor} lootDone={() => setLootFor(null)} />
        ) : (
          <View vm={vm} />
        )}
      </div>
    </main>
  );
}
