import { summarizeWave, type SizeBadge } from '../../core/encounter/waveSummary';
import type { WaveView } from '../../core/settings';
import type { BriefSpawn, BriefWave } from '../../core/viewmodel';
import { EWAR_LABEL } from '../shared/labels';
import { SizeIcon } from './SizeIcon';
import { render } from '../shared/images';

const WARP_PREVENTION = new Set(['warpScramble', 'warpDisruption']);

/** "Elite Cruiser" → "ECR", "Battleship" → "BS": shown when there is no image. */
function classAbbrev(cls: string | null): string {
  if (!cls) return '?';
  const map: [RegExp, string][] = [
    [/battleship/i, 'BS'],
    [/battlecruiser/i, 'BC'],
    [/cruiser/i, 'CR'],
    [/destroyer/i, 'DD'],
    [/frigate/i, 'FR'],
    [/sentry|tower|battery/i, 'SEN'],
    [/structure|hangar|bunker|silo/i, 'STR'],
  ];
  const base = map.find(([re]) => re.test(cls))?.[1] ?? cls.slice(0, 3).toUpperCase();
  return /elite|dire|commander/i.test(cls) ? `E${base}` : base;
}

function waveTitle(w: BriefWave): string {
  return w.title !== w.trigger && w.trigger !== 'triggered' ? `${w.title} · ${w.trigger}` : w.title;
}

/** Short row label for the ultra view: the wave number from the title ("Wave 3 (70-90 km)" → "3"), else ▸. */
function waveLabel(w: BriefWave): string {
  return /\bwave\s*(\d+)/i.exec(w.title)?.[1] ?? '▸';
}

function spawnTooltip(s: BriefSpawn): string {
  return [
    `${s.count}× ${s.cls ?? ''} ${s.names.join(' / ')}`.trim(),
    s.group,
    s.ewar.length ? `EWAR: ${s.ewar.map((k) => EWAR_LABEL[k]).join(', ')}` : null,
    s.triggers ? `TRIGGER: ${s.triggers}` : null,
    s.drop ? `Loot: ${s.drop}${s.dropNotable ? '' : ' (common)'}` : null,
    s.note,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Gold for loot worth a look (faction, tags, BPCs …), grey for common drops such as T1 ammo. */
function LootMark({ notable }: { notable: boolean }) {
  return <span className={`tile-loot${notable ? '' : ' common'}`}>💰</span>;
}

function Tile({ s }: { s: BriefSpawn }) {
  const warp = s.ewar.some((k) => WARP_PREVENTION.has(k));
  const border = warp ? ' ewar-warp' : s.ewar.length ? ' ewar' : '';
  return (
    <div className={`tile${border}`} title={spawnTooltip(s)}>
      {s.typeId !== null ? (
        <img src={render(s.typeId)} alt={s.names[0]} loading="lazy" draggable={false} />
      ) : (
        <span className="tile-cls">{classAbbrev(s.cls)}</span>
      )}
      <span className="tile-count">{s.count}</span>
      {s.size && (
        <span className="tile-size" title={`${s.elite ? 'elite ' : ''}${s.size}`}>
          <SizeIcon size={s.size} elite={s.elite} />
        </span>
      )}
      {(s.triggers || s.drop) && (
        <span className="tile-marks">
          {s.drop && <LootMark notable={s.dropNotable} />}
          {s.triggers && <span className="tile-trig">T</span>}
        </span>
      )}
      {s.ewar.length > 0 && (
        <span className={`tile-ewar${warp ? ' warp' : ''}`}>
          {EWAR_LABEL[s.ewar.find((k) => WARP_PREVENTION.has(k)) ?? s.ewar[0]!]}
          {s.ewar.length > 1 ? '+' : ''}
        </span>
      )}
    </div>
  );
}

/** Ultra compact: one size icon with the summed count per hull size, markers only. */
function Badge({ b }: { b: SizeBadge }) {
  const warp = b.ewar.find((k) => WARP_PREVENTION.has(k));
  const border = warp ? ' ewar-warp' : b.ewar.length ? ' ewar' : '';
  const label = warp ?? b.ewar[0];
  return (
    <span className={`badge${border}`} title={b.spawns.map(spawnTooltip).join('\n\n')}>
      {b.size ? (
        <SizeIcon size={b.size} elite={b.elite} />
      ) : (
        <span className="badge-cls">{classAbbrev(b.spawns[0]!.cls)}</span>
      )}
      <span className="badge-count">×{b.count}</span>
      {label && (
        <span className={`badge-ewar${warp ? ' warp' : ''}`}>
          {EWAR_LABEL[label]}
          {b.ewar.length > 1 ? '+' : ''}
        </span>
      )}
      {b.trigger && <span className="tile-trig">T</span>}
      {b.loot && <LootMark notable={b.lootNotable} />}
    </span>
  );
}

export function Waves({ waves, view }: { waves: BriefWave[]; view: WaveView }) {
  if (view === 'ultra')
    return (
      <div className="ultra">
        {waves.map((w, i) => (
          <div key={i} className="ultra-row">
            <span className="wave-title" title={waveTitle(w)}>
              {waveLabel(w)}
            </span>
            {summarizeWave(w.spawns).map((b, j) => (
              <Badge key={j} b={b} />
            ))}
          </div>
        ))}
      </div>
    );
  return (
    <>
      {waves.map((w, i) => (
        <div key={i} className="wave">
          <div className="wave-title">{waveTitle(w)}</div>
          {view === 'tiles' ? (
            <div className="tiles">
              {w.spawns.map((s, j) => (
                <Tile key={j} s={s} />
              ))}
            </div>
          ) : (
            w.spawns.map((s, j) => (
              <div key={j}>
                {s.group && s.group !== w.spawns[j - 1]?.group && <div className="group">{s.group}</div>}
                <div className="spawn" title={s.note ?? undefined}>
                  <span className="count">{s.count}×</span> <span className="cls">{s.cls}</span> {s.names.join(' / ')}
                  {s.ewar.map((k) => (
                    <span key={k} className={`mini${WARP_PREVENTION.has(k) ? ' danger' : ''}`}>
                      {EWAR_LABEL[k]}
                    </span>
                  ))}
                  {s.triggers && <span className="mini trig">TRIGGER</span>}
                  {s.drop && (
                    <span className={`mini loot${s.dropNotable ? '' : ' common'}`} title={s.drop}>
                      💰
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </>
  );
}
