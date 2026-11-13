import { Fragment, useEffect, useMemo, useState } from 'react';
import { factionSections, type SiteTreeNode } from '@core/sitemap/parse';
import { SEC_CLASSES, type SecClass, type SiteMapKind, type SiteMapSite } from '@core/sitemap/types';
import type { AppViewModel, SiteMapView } from '../../preload/api';

const KIND_LABEL: Record<SiteMapKind, string> = {
  anomaly: 'Combat anomalies · in the scanner without probes',
  unrated: 'Unrated complexes · scan down with probes',
  ded: 'DED complexes · scan down with probes',
  expedition: 'Expeditions',
};
const SEC_LABEL: Record<SecClass, string> = { high: 'High', low: 'Low', null: 'Null' };
const FACTION_KEY = 'settings.enemyFaction';

function rating(s: SiteMapSite): string {
  if (s.kind === 'ded' && s.ded) return `DED ${s.ded}/10`;
  if (s.kind === 'anomaly' && s.tier) return `Class ${s.tier}${s.level ? ` · L${s.level}` : ''}`;
  return s.kind === 'expedition' ? 'Expedition' : s.kind === 'unrated' ? 'Unrated' : '';
}

function readFaction(): string | null {
  try {
    return localStorage.getItem(FACTION_KEY);
  } catch {
    return null;
  }
}

function writeFaction(id: string): void {
  try {
    localStorage.setItem(FACTION_KEY, id);
  } catch {
    // ignore
  }
}

/** The site's own row and, indented below it, what it leads to. */
function Rows({
  node,
  depth,
  kbIds,
  onOpen,
}: {
  node: SiteTreeNode;
  depth: number;
  kbIds: Record<string, string>;
  onOpen: (s: SiteMapSite) => void;
}) {
  const s = node.site;
  const kb = kbIds[s.id];
  const expedition = s.kind === 'expedition';
  // An escalation lands near where it started, not where the target spawns on its own: no bars on a reference.
  const space = node.reference ? [] : s.space;
  return (
    <>
      <tr className={node.reference ? 'ref' : depth === 0 ? 'root' : undefined}>
        <td className="site" style={{ paddingLeft: `${8 + depth * 18}px` }}>
          {node.via && (
            <span className="via" title={node.via === 'escalation' ? 'Can escalate to' : 'Next part'}>
              {node.via === 'escalation' ? '↳' : '→'}
            </span>
          )}
          {kb ? (
            <button className="link" title="Show the brief in the overlay" onClick={() => onOpen(s)}>
              {s.name}
            </button>
          ) : (
            <span title="No knowledge base entry for this site yet">{s.name}</span>
          )}
          {!node.reference &&
            s.notes?.map((n) => (
              <div key={n} className="from muted">
                {n}
              </div>
            ))}
          {node.from.length > 0 && (
            <div className="from muted">escalation from {node.from.map((f) => f.name).join(', ')}</div>
          )}
        </td>
        <td className="rating muted">{rating(s)}</td>
        {SEC_CLASSES.map((c) => (
          <td
            key={c}
            className={`sec${space.includes(c) ? ` on sec-${c}` : ''}`}
            title={
              space.includes(c)
                ? `${SEC_LABEL[c]} security${expedition ? ': where it starts; later parts can be in lower security' : ''}`
                : undefined
            }
          />
        ))}
      </tr>
      {node.children.map((c) => (
        <Rows key={`${c.site.id}-${depth}`} node={c} depth={depth + 1} kbIds={kbIds} onOpen={onOpen} />
      ))}
    </>
  );
}

export function EnemySites(_props: { vm: AppViewModel }) {
  const [view, setView] = useState<SiteMapView | null>(null);
  const [faction, setFaction] = useState<string | null>(readFaction);
  const [space, setSpace] = useState<Set<SecClass>>(new Set(SEC_CLASSES));
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    void window.eve.getSiteMap().then(setView);
  }, []);

  const map = view?.map ?? null;
  const current = map?.factions.find((f) => f.id === faction) ?? map?.factions[0] ?? null;
  const sections = useMemo(() => (map && current ? factionSections(map, current.id) : []), [map, current]);

  if (!view) return <section>Loading…</section>;
  if (!map || !current) return <section className="error">The site map could not be read: {view.error}</section>;

  const pick = (id: string) => {
    setFaction(id);
    writeFaction(id);
  };
  const toggle = (c: SecClass) => {
    const next = new Set(space);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setSpace(next.size ? next : new Set(SEC_CLASSES));
  };
  const open = (s: SiteMapSite) => {
    void window.eve.selectEncounter({ source: 'kb', id: view.kbIds[s.id]! });
    setOpened(s.name);
  };
  const shown = (n: SiteTreeNode) => n.site.space.length === 0 || n.site.space.some((c) => space.has(c));

  return (
    <section className="enemy-sites">
      <h2>Enemy sites</h2>
      <p className="muted">
        Which combat sites each pirate faction runs, in which security class they spawn, and what they can escalate
        into. Click a site to show its brief in the overlay. The wiki only tells high, low or null security; where
        exactly within highsec a site spawns is not documented.
      </p>
      <div className="factions" role="tablist">
        {map.factions.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === current.id}
            className={f.id === current.id ? 'active' : undefined}
            onClick={() => pick(f.id)}
          >
            {f.name}
          </button>
        ))}
      </div>
      <div className="space-filter">
        <span className="muted">Spawns in</span>
        {SEC_CLASSES.map((c) => (
          <label key={c} className={`check sec-chip sec-${c}`}>
            <input type="checkbox" checked={space.has(c)} onChange={() => toggle(c)} />
            {SEC_LABEL[c]}
          </label>
        ))}
        {opened && <span className="muted opened">Shown in the overlay: {opened}</span>}
      </div>

      <table className="sitemap">
        <thead>
          <tr>
            <th>Site</th>
            <th>Rating</th>
            {SEC_CLASSES.map((c) => (
              <th key={c} className="sec-head">
                {SEC_LABEL[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((sec) => {
            const rows = sec.rows.filter(shown);
            if (!rows.length) return null;
            return (
              <Fragment key={sec.kind}>
                <tr className="kind">
                  <td colSpan={5}>{KIND_LABEL[sec.kind]}</td>
                </tr>
                {rows.map((n) => (
                  <Rows key={n.site.id} node={n} depth={0} kbIds={view.kbIds} onOpen={open} />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        Source:{' '}
        <button className="link" onClick={() => window.eve.openExternal(map.source.url)}>
          EVE University wiki, {map.source.title}
        </button>{' '}
        ({map.source.license}, revision {map.source.revision}, retrieved {map.source.retrieved}).
      </p>
    </section>
  );
}
