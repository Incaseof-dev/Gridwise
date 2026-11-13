import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MinimizedShow } from '@core/settings';
import type { AppViewModel } from '../../preload/api';
import { ApplicationSection } from './ApplicationSection';
import { CombatSection } from './CombatSection';
import { LootPrompt } from './LootPrompt';
import { LootSection } from './LootSection';
import { Messages } from './Messages';
import { useRoomBelow } from './panelSize';
import { IntelStrip } from './IntelStrip';
import { ThreatsSection } from './ThreatsSection';

/** Room around each strip in the window shape: shadows and the slide-in of new messages. */
const PAD = 8;

/**
 * The Below shown last. Minimizing swaps one Below for another in the same commit, and the old one's cleanup runs
 * after the new one has sent its rects: only the current owner may clear the shape, or the strips vanish for good.
 */
let owner = 0;
let nextId = 1;

/**
 * DPS strip, threat warnings, intel (EVE-98), loot warnings and timed messages below the panel, so they cover nothing in it and their
 * lines can come and go without moving the brief. The DPS strip is first, so it stays put. Main cuts the window shape to the
 * panel plus these strips (main/windows.ts). Without room below (panel at the bottom of the screen) they sit over
 * the bottom of the panel instead. Minimized, the player picks which strips stay (`only`).
 */
export function Below({
  vm,
  interactive,
  only,
}: {
  vm: AppViewModel;
  interactive: boolean;
  /** Minimized: only these strips; intel as the one-line quick intel, loot one line per NPC. */
  only?: MinimizedShow;
}) {
  const { sections } = vm.settings.overlay;
  const show = only
    ? {
        combat: sections.combat && only.combat,
        threats: sections.threats && only.threats,
        loot: sections.loot && only.loot,
        messages: sections.threats && only.messages,
        intel: only.intel,
      }
    : {
        combat: sections.combat,
        threats: sections.threats,
        loot: sections.loot,
        messages: sections.threats,
        intel: true,
      };
  const ref = useRef<HTMLDivElement>(null);
  const room = useRoomBelow();
  const [inside, setInside] = useState(false);
  const sent = useRef('');
  const [me] = useState(() => nextId++);

  // Called again by the observer when sizes change without a render (panel resize, message animation end).
  const report = useRef(() => {});
  useLayoutEffect(() => {
    report.current = () => {
      const el = ref.current;
      if (!el) return;
      setInside(el.offsetHeight > room);
      const rects = [...el.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.x - PAD, y: r.y - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
      });
      const json = JSON.stringify(rects);
      if (json === sent.current && owner === me) return;
      owner = me;
      sent.current = json;
      window.eve.setOverlayBelow(rects);
    };
    report.current();
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => report.current());
    ro.observe(ref.current!);
    ro.observe(document.querySelector('.panel')!);
    return () => {
      ro.disconnect();
      // Hidden (search open, minimized): the strips leave the window shape too, unless another Below took over.
      if (owner === me) {
        owner = 0;
        window.eve.setOverlayBelow([]);
      }
    };
  }, [me]);

  return (
    <div ref={ref} className={`below${inside ? ' inside' : ''}`}>
      {show.combat && <CombatSection vm={vm} />}
      {show.threats && <ThreatsSection vm={vm} />}
      {show.intel && <IntelStrip vm={vm} quick={!!only} interactive={interactive} />}
      {show.loot && <LootSection vm={vm} compact={!!only} />}
      {show.loot && <LootPrompt vm={vm} interactive={interactive} />}
      {show.combat && <ApplicationSection vm={vm} />}
      {show.messages && <Messages vm={vm} interactive={interactive} />}
    </div>
  );
}
