import { skillsNote } from '../shared/format';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FitSiteCheck } from '../../core/fit/siteCheck';
import type { HeaderMode, WaveView } from '../../core/settings';
import type { Brief, BriefEwar } from '../../core/viewmodel';
import { EwarIcon } from '../shared/EwarIcon';
import { Waves } from './Waves';

/** The wave view toggle cycles names → ship images → ultra compact. */
const NEXT_VIEW: Record<WaveView, { view: WaveView; icon: string; title: string }> = {
  names: { view: 'tiles', icon: '▦', title: 'Show ship images' },
  tiles: { view: 'ultra', icon: '▪', title: 'Ultra compact: size icons and counts only' },
  ultra: { view: 'names', icon: '☰', title: 'Show names' },
};
import { BASIS_LABEL, DAMAGE_LABEL, DAMAGE_NAME, EWAR_LABEL, EWAR_NAME } from '../shared/labels';

import type { Extra } from './SideStrip';

export function lootCount(loot: Brief['loot']): number {
  return loot.items.length + loot.drops.length + loot.rareNpcs.length;
}

function LootBody({ loot }: { loot: Brief['loot'] }) {
  return (
    <div className="loot-body">
      {loot.rareNpcs.map((r) => (
        <div key={`r-${r.name}`} className="loot-row" title="SDE NPC group">
          <span className="chip loot">{r.label}</span> <b>{r.name}</b> <span className="muted">· {r.loot}</span>
        </div>
      ))}
      {loot.items.map((l, i) => (
        <div key={`i-${i}`} className="loot-row">
          <b>{l.item}</b>
          {l.from && <span className="muted"> ← {l.from}</span>}
          {l.note && <span className="muted"> · {l.note}</span>}
        </div>
      ))}
      {loot.drops.map((d, i) => (
        <div key={`d-${i}`} className="loot-row">
          <span className="muted">{d.npc}:</span> {d.text}
        </div>
      ))}
      {loot.summary.map((t, i) => (
        <div key={`s-${i}`} className="muted small">
          {t}
        </div>
      ))}
      <div className="muted small">Wiki estimates; values and chances may be outdated.</div>
    </div>
  );
}

/** The open tips or loot panel, floating over the content below the header. */
function ExtraPanel({ brief, open }: { brief: Brief; open: Extra }) {
  if (open === 'tips' && brief.tips.length)
    return (
      <div className="popover">
        {brief.tips.map((t, i) => (
          <div key={i} className="tip">
            {t}
          </div>
        ))}
      </div>
    );
  if (open === 'loot' && (lootCount(brief.loot) > 0 || brief.loot.summary.length))
    return (
      <div className="popover">
        <LootBody loot={brief.loot} />
      </div>
    );
  return null;
}

const WARP_PREVENTION = new Set(['warpScramble', 'warpDisruption']);

/** "1st Pocket", "First Pocket", "Pocket 1" → "Pocket 1"; other names are shortened. */
function tabLabel(name: string, index: number): string {
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  const n =
    /\b(\d+)(?:st|nd|rd|th)?\b/.exec(name)?.[1] ?? String(ordinals.indexOf(name.split(' ')[0]!.toLowerCase()) + 1);
  if (/pocket|room/i.test(name) && n !== '0') return `${/room/i.test(name) ? 'Room' : 'Pocket'} ${n}`;
  return name.length > 14 ? `${index + 1}. ${name.slice(0, 12)}…` : name;
}

function EwarChip({ e, iconOnly = false }: { e: BriefEwar; iconOnly?: boolean }) {
  const who = e.by.length ? e.by.join(', ') : 'source does not say which NPC';
  const basis = e.basis.map((b) => BASIS_LABEL[b]).join(' + ');
  return (
    <span
      className={`chip ewar-chip sev-${e.severity}${iconOnly ? ' icon-only' : ''}`}
      title={`${EWAR_NAME[e.kind]}\nBy: ${who}\nFrom: ${basis}`}
    >
      <EwarIcon kind={e.kind} />
      {!iconOnly && EWAR_LABEL[e.kind]}
      {!iconOnly && e.basis.length === 1 && e.basis[0] === 'sde' && <sup>SDE</sup>}
    </span>
  );
}

function incomingTitle(unresolved: string[]): string {
  const base = 'Damage the NPCs deal: tank against this';
  if (!unresolved.length) return base;
  return `${base}\n\n* Not counted, name not found in the SDE:\n${unresolved.join('\n')}`;
}

/** One-line damage summary for the condensed header: incoming shares and the type to shoot. */
function DamageInline({ brief }: { brief: Brief }) {
  const d = brief.damage;
  const incoming = d.incomingSde ?? d.incomingDocumented.map((type) => ({ type, share: null }));
  const shoot = d.dealSde?.[0]?.type ?? d.dealDocumented[0];
  return (
    <span className="dmg-inline">
      {incoming.map((x) => (
        <span key={x.type} className={`dmg dmg-${x.type}`} title={`Incoming: ${DAMAGE_NAME[x.type]}`}>
          {DAMAGE_LABEL[x.type]}
          {x.share !== null && ` ${Math.round(x.share * 100)}`}
        </span>
      ))}
      {shoot && (
        <>
          <span className="muted">→</span>
          <span className={`dmg dmg-${shoot} best`} title={`Shoot: ${DAMAGE_NAME[shoot]}`}>
            {DAMAGE_LABEL[shoot]}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Header that stays at the top while the brief is scrolled: title, damage and EWAR icons in one row, the
 * objective in a second.
 */
function CondensedHead({ brief, fitCheck }: { brief: Brief; fitCheck: FitSiteCheck | null }) {
  return (
    <div className="condensed">
      <div className="c-row">
        <span className="name" title={brief.subtitle}>
          {brief.title}
        </span>
        {brief.hasKb && <DamageInline brief={brief} />}
        {fitCheck?.verdict === 'weak' && (
          <span className="fit-weak small" title={fitTitle(fitCheck)}>
            ⚠ fit
          </span>
        )}
        <span className="c-ewar">
          {brief.ewar.map((e) => (
            <EwarChip key={e.kind} e={e} iconOnly />
          ))}
        </span>
      </div>
      {brief.objectives.length > 0 && (
        <div className="c-row muted" title={brief.objectives.join('\n')}>
          <span className="c-objective">◎ {brief.objectives.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Condenses the header once the scroll container has moved past it. Condensing shrinks the content by the
 * difference of the two head heights, and the browser's scroll anchoring used to take that out of scrollTop: with a
 * tall head (fit advice, many EWAR chips) that dropped it below the expand threshold, so the head flipped back and
 * forth and the scroll position jumped. Anchoring is off on .body; this hook moves scrollTop by the measured
 * difference itself and only condenses past it, so the new position never lands in the expand range.
 */
const EXPAND_BELOW = 8;
const CONDENSE_MARGIN = 16;

function useCondensed(headRef: RefObject<HTMLElement | null>): boolean {
  const [condensed, setCondensed] = useState(false);
  const state = useRef(false);
  const heights = useRef({ full: 0, condensed: 40 });
  const toggled = useRef(false);

  useEffect(() => {
    const scroller = headRef.current?.closest('.body');
    if (!scroller) return;
    const onScroll = () => {
      const head = headRef.current;
      if (!head) return;
      const top = scroller.scrollTop;
      if (!state.current) {
        heights.current.full = blockHeight(head);
        const shrink = heights.current.full - heights.current.condensed;
        if (top > Math.max(60, shrink + CONDENSE_MARGIN)) {
          state.current = toggled.current = true;
          setCondensed(true);
        }
      } else if (top < EXPAND_BELOW) {
        state.current = false;
        toggled.current = true;
        setCondensed(false);
      }
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [headRef]);

  // Keep the content where it was on screen across the switch.
  useLayoutEffect(() => {
    const head = headRef.current;
    const scroller = head?.closest('.body');
    if (!head || !scroller || !toggled.current) return;
    toggled.current = false;
    if (condensed) {
      heights.current.condensed = blockHeight(head);
      scroller.scrollTop -= heights.current.full - heights.current.condensed;
    } else {
      heights.current.full = blockHeight(head);
      scroller.scrollTop += heights.current.full - heights.current.condensed;
    }
  }, [condensed, headRef]);

  return condensed;
}

/** Height the head takes in the flow, margins included. */
function blockHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const LAYER_NAME = { shield: 'shield', armor: 'armor', hull: 'hull' } as const;

export function fitTitle(c: FitSiteCheck): string {
  const change = Math.round(Math.abs(c.damageFactor - 1) * 100);
  return [
    `Your fit: ${c.shipName} "${c.fitName}" (${skillsNote(c.skills)}).`,
    `It tanks with ${LAYER_NAME[c.layer]}. Against this site's damage that resist is ${pct(c.siteResist)}, its average is ${pct(c.averageResist)},`,
    change < 1
      ? 'so it takes about as much damage as from even damage.'
      : `so it takes ${change}% ${c.damageFactor > 1 ? 'more' : 'less'} damage than from even damage.`,
    `${LAYER_NAME[c.layer][0]!.toUpperCase()}${LAYER_NAME[c.layer].slice(1)} EHP here: ${Math.round(c.layerEhpSite).toLocaleString('en')} (${Math.round(c.layerEhpOmni).toLocaleString('en')} against even damage).`,
    `Damage mix from ${c.basis === 'sde' ? 'the NPCs in the SDE' : 'the knowledge base source'}. Change the fit in Settings → Ship fit.`,
  ].join('\n');
}

/** Without resist holes the fit check is one number: it goes to the icon strip right of the panel (SideStrip). */
export function fitInStrip(c: FitSiteCheck): boolean {
  return c.holes.length === 0;
}

/** The active fit against this site's damage (EVE-63): how much more or less its tank layer takes, and the holes. */
function FitRow({ check: c }: { check: FitSiteCheck }) {
  const change = Math.round((c.damageFactor - 1) * 100);
  return (
    <div className="row" title={fitTitle(c)}>
      <span className="k">Your fit</span>
      <span className={`v fit-${c.verdict}`}>
        <span>
          {LAYER_NAME[c.layer]} {change > 0 ? '+' : change < 0 ? '−' : '±'}
          {Math.abs(change)}%
        </span>
        {c.holes.map((h) => (
          <span key={h.type} className={`dmg dmg-${h.type}`} title={`${DAMAGE_NAME[h.type]} resist ${pct(h.resist)}`}>
            {DAMAGE_LABEL[h.type]} {pct(h.resist)}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Plain advice for a weak fit, named after the worst hole. */
function fitAdvice(c: FitSiteCheck): string | null {
  if (c.verdict !== 'weak') return null;
  const hole = c.holes[0];
  const what = hole
    ? `a ${DAMAGE_NAME[hole.type]} ${c.layer === 'shield' ? 'shield hardener or amplifier' : `${c.layer} hardener`}`
    : 'resists that match this damage';
  return `Your ${c.shipName} takes ${Math.round((c.damageFactor - 1) * 100)}% more damage here than from even damage${hole ? `, its ${DAMAGE_NAME[hole.type]} resist is the weak spot` : ''}. ${what[0]!.toUpperCase()}${what.slice(1)} would help.`;
}

function DamageRows({ brief, fitCheck }: { brief: Brief; fitCheck: FitSiteCheck | null }) {
  const d = brief.damage;
  const docIn = d.incomingDocumented;
  const docDeal = d.dealDocumented;
  const sdeTop = d.incomingSde?.[0]?.type;
  const disagree = docIn.length > 0 && sdeTop !== undefined && !docIn.includes(sdeTop);
  return (
    <div className="damage">
      <div className="row">
        <span className="k" title={incomingTitle(d.unresolvedNpcs)}>
          Incoming{d.unresolvedNpcs.length > 0 && <sup className="muted">*</sup>}
        </span>
        <span className="v">
          {d.incomingSde ? (
            d.incomingSde.map((x) => (
              <span key={x.type} className={`dmg dmg-${x.type}`} title={`${DAMAGE_NAME[x.type]} (from SDE NPC data)`}>
                {DAMAGE_LABEL[x.type]} {Math.round(x.share * 100)}%
              </span>
            ))
          ) : docIn.length ? null : (
            <span className="muted">unknown</span>
          )}
          {docIn.length > 0 && (
            <span className={`doc${disagree ? ' disagree' : ''}`} title="Documented in the knowledge base source">
              {d.incomingSde ? 'wiki: ' : ''}
              {docIn.map((t) => DAMAGE_LABEL[t]).join('/')}
            </span>
          )}
        </span>
      </div>
      <div className="row">
        <span className="k" title="Damage type the NPCs resist least">
          Shoot
        </span>
        <span className="v">
          {d.dealSde ? (
            d.dealSde.map((x, i) => (
              <span
                key={x.type}
                className={`dmg dmg-${x.type}${i === 0 ? ' best' : ''}`}
                title={`${DAMAGE_NAME[x.type]}: ${Math.round((x.relEhp - 1) * 100)}% more effective HP than the best type (SDE)`}
              >
                {DAMAGE_LABEL[x.type]}
              </span>
            ))
          ) : docDeal.length ? null : (
            <span className="muted">unknown</span>
          )}
          {docDeal.length > 0 && (
            <span className="doc" title="Documented in the knowledge base source">
              {d.dealSde ? 'wiki: ' : ''}
              {docDeal.map((t) => DAMAGE_LABEL[t]).join('/')}
            </span>
          )}
        </span>
      </div>
      {fitCheck && !fitInStrip(fitCheck) && <FitRow check={fitCheck} />}
      {disagree && <div className="warn-line">Sources disagree on incoming damage. Check before you commit.</div>}
    </div>
  );
}

export function BriefView({
  brief,
  fitCheck,
  pocket,
  interactive,
  view,
  extra,
  headerMode,
}: {
  brief: Brief;
  fitCheck: FitSiteCheck | null;
  pocket: number;
  interactive: boolean;
  view: WaveView;
  /** The tips or loot panel opened from the icon strip (SideStrip). */
  extra: Extra;
  headerMode: HeaderMode;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const scrolled = useCondensed(headRef);
  const condensed = headerMode === 'compact' || scrolled;
  const p = brief.pockets[pocket];
  const sourceText = brief.sources.map((s) => s.title.replace(/^EVE University Wiki – .*/, 'EVE Uni wiki')).join(' · ');

  return (
    <div className="brief">
      <div className={`brief-head${condensed ? ' is-condensed' : ''}`} ref={headRef}>
        {condensed ? (
          <CondensedHead brief={brief} fitCheck={fitCheck} />
        ) : (
          <>
            <div className="title">
              <span className="name">{brief.title}</span>
              {brief.review === 'unreviewed' && (
                <span className="badge" title="Imported automatically from the source and not yet checked by a human.">
                  unreviewed
                </span>
              )}
              {!brief.hasKb && <span className="badge">SDE only</span>}
            </div>
            <div className="subtitle muted">{brief.subtitle}</div>

            <div className="top">
              <div className="top-main">{brief.hasKb && <DamageRows brief={brief} fitCheck={fitCheck} />}</div>
              {brief.ewar.length > 0 ? (
                <div className="ewar">
                  {brief.ewar.map((e) => (
                    <EwarChip key={e.kind} e={e} />
                  ))}
                </div>
              ) : (
                brief.hasKb && (
                  <div className="ewar muted small" title="No EWAR known. That does not mean there is none.">
                    no EWAR known
                  </div>
                )
              )}
              {interactive && <ExtraPanel brief={brief} open={extra} />}
            </div>
          </>
        )}
      </div>

      {fitCheck && fitAdvice(fitCheck) && (
        <div className="line sev-text-caution" title={fitTitle(fitCheck)}>
          ⚠ {fitAdvice(fitCheck)}
        </div>
      )}
      {brief.warnings.map((w, i) => (
        <div key={i} className={`line sev-text-${w.level}`}>
          ⚠ {w.text}
        </div>
      ))}
      {brief.objectives.map((o, i) => (
        <div key={i} className="line">
          ◎ {o}
        </div>
      ))}

      {p && (
        <div className="pocket">
          <div className="tabs" role="tablist">
            {brief.pockets.map((pk, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === pocket}
                className={`tab${i === pocket ? ' active' : ''}`}
                title={pk.name}
                disabled={!interactive && i !== pocket}
                onClick={() => void window.eve.setPocket(i)}
              >
                {tabLabel(pk.name, i)}
                {pk.waves.some((w) => w.spawns.some((sp) => sp.ewar.some((k) => WARP_PREVENTION.has(k)))) && (
                  <span className="tab-alert" title="Warp scramble/disruption in this pocket" />
                )}
              </button>
            ))}
            {interactive && (
              <button
                className="tab view-toggle"
                title={NEXT_VIEW[view].title}
                onClick={() => void window.eve.updateSettings({ overlay: { waveView: NEXT_VIEW[view].view } })}
              >
                {NEXT_VIEW[view].icon}
              </button>
            )}
          </div>
          {p.triggers.map((t, i) => (
            <div key={i} className="trigger" title="Shooting this changes the encounter">
              ⚑ <b>{t.npc}</b>: {t.text}
            </div>
          ))}
          {p.tips.map((t, i) => (
            <div key={`tip-${i}`} className="tip">
              💡 {t}
            </div>
          ))}
          {p.onWarpIn && <div className="muted small">{p.onWarpIn}</div>}
          <Waves waves={p.waves} view={view} />
          {p.notes.length > 0 && (
            <div className="notes">
              {p.notes.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {brief.notes.length > 0 && (
        <div className="notes">
          <button className="link" onClick={() => setShowNotes(!showNotes)}>
            {showNotes ? '▾' : '▸'} Notes ({brief.notes.length})
          </button>
          {showNotes && brief.notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}

      <div className="sources muted small">
        {brief.sources[0]?.url ? (
          <button className="link" onClick={() => window.eve.openExternal(brief.sources[0]!.url!)}>
            {sourceText}
          </button>
        ) : (
          sourceText
        )}
      </div>
    </div>
  );
}
