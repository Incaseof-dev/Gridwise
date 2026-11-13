import { useEffect, useState } from 'react';
import { buildRunTree, TIER_NAMES, type RunLeaf } from '@core/abyss/logTree';
import type { AbyssLogEntry, EwbAbyssRun } from '@core/abyss/types';
import { MAX_ABYSS_LOG_KEEP } from '@core/settings';
import type { AppViewModel } from '../../preload/api';
import { compact } from '../shared/format';
import { WeatherIcon } from '../shared/WeatherIcon';

const EWAR_LABEL: Record<string, string> = {
  neut: 'NEUT',
  warpScramble: 'SCRAM',
  warpDisruption: 'POINT',
  web: 'WEB',
  trackingDisruption: 'TD',
  guidanceDisruption: 'GD',
  sensorDamp: 'DAMP',
  targetPaint: 'PAINT',
  ecm: 'JAM',
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const isk = (n: number) => `${compact(n)} ISK`;
const day = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

/** A run that ended with the ship lost: when, which room, who hit hardest, where the clone woke up. */
function LostRun({ e }: { e: AbyssLogEntry }) {
  const after = e.exitedAt ? Math.round((Date.parse(e.exitedAt) - Date.parse(e.enteredAt)) / 1000) : null;
  return (
    <div title="Local came back in another system than the filament's: the ship and pod died, the clone woke up at home.">
      <span className="bad">Ship lost{after !== null && ` at ${clock(after)}`}</span>
      <div className="muted">
        {[
          e.rooms.length > 0 && `Room ${e.rooms.length}${e.killedBy ? `, hit hardest by ${e.killedBy}` : ''}`,
          e.exitSystem && `woke up in ${e.exitSystem}`,
        ]
          .filter(Boolean)
          .join('; ')}
      </div>
    </div>
  );
}

/** The short result of a run, for the tree row. */
function outcome(leaf: RunLeaf): { text: string; bad: boolean } {
  const e = leaf.entry;
  if (e) {
    if (e.outcome === 'lost') return { text: 'lost', bad: true };
    if (e.clearSeconds !== null) return { text: clock(e.clearSeconds), bad: false };
    return { text: e.outcome === 'noExit' ? 'no exit' : '?', bad: e.outcome === 'noExit' };
  }
  const r = leaf.ewb!;
  if (!r.survived) return { text: 'lost', bad: true };
  return { text: r.seconds ? clock(r.seconds) : 'done', bad: false };
}

function leafValue(leaf: RunLeaf): number | null {
  return leaf.ewb?.lootValue ?? leaf.entry?.loot?.value ?? null;
}

/** The log like the Ship fit tree: tier → weather → runs; branches start closed except the newest run's. */
function RunTree({
  tree,
  selected,
  select,
}: {
  tree: ReturnType<typeof buildRunTree>;
  selected: string | null;
  select: (key: string) => void;
}) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const branch = (key: string, auto: boolean) => ({
    open: toggled[key] ?? auto,
    onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const open = e.currentTarget.open;
      if (open !== (toggled[key] ?? auto)) setToggled((t) => ({ ...t, [key]: open }));
    },
  });
  const holds = (runs: RunLeaf[]) => runs.some((r) => r.key === selected);
  return (
    <nav className="fit-tree run-tree">
      {tree.map((t) => (
        <details
          key={String(t.tier)}
          {...branch(`t${t.tier}`, holds(t.weathers.flatMap((w) => w.runs)) || tree.length === 1)}
        >
          <summary>
            {t.name} <span className="muted small tree-count">{t.weathers.reduce((a, w) => a + w.runs.length, 0)}</span>
          </summary>
          {t.weathers.map((w) => (
            <details
              key={String(w.weather)}
              {...branch(`t${t.tier}|${w.weather}`, holds(w.runs) || t.weathers.length === 1)}
              className="tree-faction"
            >
              <summary>
                {w.weather && <WeatherIcon weather={w.weather} size={14} />}{' '}
                {w.weather ? cap(w.weather) : 'Unknown weather'} <span className="muted small">{w.runs.length}</span>
              </summary>
              {w.runs.map((r) => {
                const o = outcome(r);
                const v = leafValue(r);
                return (
                  <div key={r.key} className={`fit-row${r.key === selected ? ' on' : ''}`}>
                    <button className="fit-pick" onClick={() => select(r.key)}>
                      {day(r.at)} <span className={o.bad ? 'bad small' : 'muted small'}>{o.text}</span>
                      {v !== null && <span className="muted small"> · {compact(v)}</span>}
                    </button>
                    {r.ewb ? (
                      <span className="muted small" title="On your EVE Workbench Abyss Tracker">
                        EWB
                      </span>
                    ) : r.entry?.upload ? (
                      <span className="muted small" title="Uploaded; EVE Workbench has not listed it yet">
                        sent
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </details>
          ))}
        </details>
      ))}
    </nav>
  );
}

/** The cargo paste after a run (EVE-86): Esc or a click outside closes it. */
export function LootDialog({ entry, close }: { entry: AbyssLogEntry; close: () => void }) {
  const [text, setText] = useState('');
  const [before, setBefore] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Saved, but some lines were left out: the dialog stays to say which.
  const [leftOut, setLeftOut] = useState<string | null>(null);
  // Esc also when the focus left the dialog (the save button is disabled while saving).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await window.eve.saveAbyssLoot(entry.id, text, before);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else if (r.skipped.length) setLeftOut(`Saved ${r.items} items. Not known, so left out: ${r.skipped.join('; ')}`);
    else close();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Loot of the run">
        <h3>
          Loot of the run{entry.weather ? `: ${cap(entry.weather)}` : ''}
          {entry.tier !== null ? ` T${entry.tier}` : ''}, {day(entry.enteredAt)}
        </h3>
        <p className="muted">
          In EVE open the ship&apos;s cargo, click in the list, select all (Ctrl+A), copy (Ctrl+C) and paste it here.
          {entry.cargoBefore
            ? ` The cargo before the run is known (${entry.cargoBefore.items.length} item types), so paste the whole cargo: the loot is what grew.`
            : ' Paste the cargo before the run below too, then the loot is what grew; or take out what was there before (ammo, filaments).'}{' '}
          An empty paste means nothing dropped.
        </p>
        <textarea
          className="eft"
          rows={10}
          spellCheck={false}
          autoFocus
          placeholder={'Triglavian Survey Database\t12\t…\nCalm Exotic Filament\t1\t…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setLeftOut(null);
          }}
        />
        <details open={!entry.cargoBefore}>
          <summary className="small">
            Cargo before the run{entry.cargoBefore ? ` (known: ${entry.cargoBefore.items.length} item types)` : ''}
          </summary>
          <textarea
            className="eft"
            rows={5}
            spellCheck={false}
            placeholder={entry.cargoBefore ? 'Paste here to replace it' : 'Optional: the cargo before going in'}
            value={before}
            onChange={(e) => {
              setBefore(e.target.value);
              setLeftOut(null);
            }}
          />
        </details>
        <div className="path">
          {leftOut ? (
            <button className="primary" onClick={close}>
              Close
            </button>
          ) : (
            <>
              <button className="primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : text.trim() ? 'Save the loot' : 'Nothing dropped'}
              </button>
              <button onClick={close}>Cancel</button>
            </>
          )}
        </div>
        {leftOut && <p className="small">{leftOut}</p>}
        {error && <p className="error small">{error}</p>}
      </div>
    </div>
  );
}

function Upload({ vm, entry }: { vm: AppViewModel; entry: AbyssLogEntry }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!vm.ewb.hasKey)
    return (
      <p className="muted small">Add your EVE Workbench key (EVE login tab) to upload this run to the Abyss Tracker.</p>
    );
  const up = entry.upload;
  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await window.eve.uploadAbyssRun(entry.id);
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <div>
      <div className="path">
        <button className={up ? undefined : 'primary'} disabled={busy} onClick={() => void send()}>
          {busy ? 'Uploading…' : up ? 'Upload again (replaces it)' : 'Upload to the Abyss Tracker'}
        </button>
        <span className="muted small">
          {up
            ? `Uploaded ${day(up.at)} as ${up.privacy}`
            : `As ${vm.settings.ewb.privacy} (change it in the EVE login tab)`}
        </span>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function RunDetail({ vm, leaf, addLoot }: { vm: AppViewModel; leaf: RunLeaf; addLoot: () => void }) {
  const e = leaf.entry;
  const w = leaf.ewb;
  const weather = e?.weather ?? w?.weather ?? null;
  const tier = e?.tier ?? w?.tier ?? null;
  return (
    <div className="run-detail">
      <h3>
        {weather && <WeatherIcon weather={weather} size={16} />} {weather ? cap(weather) : 'Unknown weather'}{' '}
        {tier !== null ? `T${tier} ${TIER_NAMES[tier]}` : 'unknown tier'}
        {e?.tierSource === 'npc' && (
          <span className="muted small" title="Tier from the Overmind">
            {' '}
            ✓
          </span>
        )}
        <span className="muted small"> · {day(leaf.at)}</span>
      </h3>
      <p>
        {e ? (
          <>
            {e.ship ?? 'Unknown ship'}
            {e.character && <span className="muted"> · {e.character}</span>}
          </>
        ) : (
          <>
            {w!.hullType ?? 'Unknown hull'} <span className="muted">· from EVE Workbench, no log details here</span>
          </>
        )}
      </p>
      {e?.outcome === 'lost' ? (
        <LostRun e={e} />
      ) : (
        <p>
          {e
            ? e.clearSeconds !== null
              ? `Cleared in ${clock(e.clearSeconds)}`
              : e.outcome === 'noExit'
                ? 'No exit seen within the 20 minutes'
                : 'Clear time unknown'
            : w!.survived
              ? `Survived${w!.seconds ? `, ${clock(w!.seconds)}` : ''}`
              : 'Ship lost'}
          {e && (
            <span className="muted">
              {' '}
              · dealt {short(e.dealt)}, took {short(e.taken)}
            </span>
          )}
        </p>
      )}

      {e && e.rooms.length > 0 && (
        <>
          <h4>Rooms</h4>
          {e.rooms.map((r, i) => (
            <details key={i} className="small">
              <summary>
                {i + 1}. {[...new Set(r.npcs.map((n) => n.name))].slice(0, 3).join(', ')}
                {r.npcs.length > 3 ? ' …' : ''} <span className="muted">({clock(r.endS - r.startS)})</span>
              </summary>
              {r.npcs.map((n) => (
                <div key={`${n.name}-${n.firstS}`} className="muted">
                  {n.name}: dealt {short(n.damageByUs)}, took {short(n.damageToUs)}
                  {n.ewar.length > 0 && ` · ${n.ewar.map((k) => EWAR_LABEL[k] ?? k).join(' ')}`}
                </div>
              ))}
            </details>
          ))}
        </>
      )}

      <h4>Loot</h4>
      {w && w.loot.length > 0 ? (
        <LootTable items={w.loot} total={w.lootValue} note="EVE Workbench's prices" />
      ) : e?.loot ? (
        e.loot.items.length ? (
          <LootTable
            items={e.loot.items.map((i) => ({ ...i, value: null }))}
            total={e.loot.value}
            note="Jita, when saved"
          />
        ) : (
          <p className="muted small">Nothing dropped.</p>
        )
      ) : e?.outcome === 'lost' ? (
        <p className="muted small">The ship was lost, so no loot.</p>
      ) : (
        <p className="muted small">No loot saved for this run.</p>
      )}
      {!(w && w.loot.length > 0) && e?.loot?.lost && e.loot.lost.length > 0 && (
        <>
          <h4>Used up</h4>
          <LootTable
            items={e.loot.lost.map((i) => ({ ...i, value: null }))}
            total={e.loot.lostValue ?? null}
            note="Jita, when saved"
          />
        </>
      )}
      {e && e.outcome !== 'lost' && (
        <div className="path">
          <button onClick={addLoot}>{e.loot ? 'Paste the loot again' : 'Add the loot…'}</button>
        </div>
      )}
      {e && <Upload vm={vm} entry={e} />}
    </div>
  );
}

function LootTable({
  items,
  total,
  note,
}: {
  items: { name: string; count: number; value: number | null }[];
  total: number | null;
  note: string;
}) {
  return (
    <table className="sitemap loot-table">
      <tbody>
        {[...items]
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
          .map((i) => (
            <tr key={i.name}>
              <td className="muted small">{i.count}×</td>
              <td className="small">{i.name}</td>
              <td className="small num">{i.value !== null ? isk(i.value) : ''}</td>
            </tr>
          ))}
        {total !== null && (
          <tr>
            <td />
            <td className="small">
              <b>Total</b> <span className="muted">({note})</span>
            </td>
            <td className="small num">
              <b>{isk(total)}</b>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * The player's Abyss runs (EVE-75, EVE-86): the app's log and the EVE Workbench Abyss Tracker in one tree, the
 * picked run on the right. `lootFor` (from the overlay's question) opens that run's loot dialog.
 */
export function AbyssLog({
  vm,
  lootFor,
  lootDone,
}: {
  vm: AppViewModel;
  lootFor: string | null;
  lootDone: () => void;
}) {
  const [entries, setEntries] = useState<AbyssLogEntry[]>([]);
  const [ewbRuns, setEwbRuns] = useState<EwbAbyssRun[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [lootOpen, setLootOpen] = useState(false);
  useEffect(() => {
    void window.eve.getAbyssLog().then((l) => {
      setEntries(l.entries);
      setEwbRuns(l.ewbRuns);
    });
  }, [vm.abyssLogVersion]);
  const tree = buildRunTree(entries, ewbRuns, vm.settings.abyss.logKeep);
  const leaves = tree.flatMap((t) => t.weathers.flatMap((w) => w.runs));
  const newest = [...leaves].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const selected = leaves.find((l) => l.key === (lootFor ?? picked)) ?? newest;
  const dialogEntry = selected?.entry && (lootOpen || lootFor === selected.key) ? selected.entry : null;

  if (!leaves.length)
    return (
      <p className="muted small">
        No runs logged yet. A run is logged when Local leaves the Abyss (or the 20 minutes are over), with the weather
        and tier picked in the Abyss tab and the NPCs of the combat log.
      </p>
    );
  return (
    <div className="fit-layout">
      <div className="fit-side">
        <RunTree tree={tree} selected={selected?.key ?? null} select={setPicked} />
      </div>
      <div className="fit-detail">
        {selected && <RunDetail vm={vm} leaf={selected} addLoot={() => setLootOpen(true)} />}
      </div>
      {dialogEntry && (
        <LootDialog
          entry={dialogEntry}
          close={() => {
            setLootOpen(false);
            if (lootFor) {
              setPicked(lootFor);
              lootDone();
            }
          }}
        />
      )}
    </div>
  );
}

const KEEP_CHOICES = [5, 10, 20, 50, MAX_ABYSS_LOG_KEEP];

/** Settings → Abyss log (EVE-89): the run log on its own tab, with how many runs of each filament it keeps. */
export function AbyssLogTab({
  vm,
  lootFor = null,
  lootDone = () => {},
}: {
  vm: AppViewModel;
  /** A run whose loot the overlay asked for (EVE-86). */
  lootFor?: string | null;
  lootDone?: () => void;
}) {
  const keep = vm.settings.abyss.logKeep;
  return (
    <section className="abyss-log-tab">
      <h2>Abyss log</h2>
      <p className="muted">
        Your Abyss runs by tier and weather: clear time, the rooms with their NPCs, and the loot you pasted after the
        run. With an EVE Workbench key, your Abyss Tracker runs are in the same tree.
      </p>
      <div className="field path">
        <label htmlFor="log-keep">Keep the last</label>
        <select
          id="log-keep"
          value={KEEP_CHOICES.includes(keep) ? keep : 10}
          onChange={(e) => void window.eve.updateSettings({ abyss: { logKeep: Number(e.target.value) } })}
        >
          {KEEP_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="muted small">
          runs of each tier and weather. Older ones are removed from this log; runs on EVE Workbench stay there.
        </span>
      </div>
      <AbyssLog vm={vm} lootFor={lootFor} lootDone={lootDone} />
    </section>
  );
}
