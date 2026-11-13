import { useState } from 'react';
import { shortcutLabel } from '../shared/format';
import { useViewModel } from '../shared/useViewModel';
import { AbyssPanel } from './AbyssPanel';
import { BriefView } from './BriefView';
import { Below } from './Below';
import { Header } from './Header';
import { useIntelSound } from './IntelStrip';
import { ResizeGrip } from './ResizeGrip';
import { SearchPanel } from './SearchPanel';
import { readExtra, SideStrip, writeExtra, type Extra } from './SideStrip';

export function OverlayApp() {
  const vm = useViewModel();
  const [extra, setExtra] = useState<Extra>(readExtra);
  useIntelSound(vm);
  if (!vm) return <div className="panel" />;
  const toggleExtra = (v: Extra) => {
    const next = extra === v ? null : v;
    setExtra(next);
    writeExtra(next);
  };
  const { sections } = vm.settings.overlay;
  const interactive = !vm.overlay.clickThrough || vm.overlay.searchOpen;

  // Minimized: the header row, so the shortcuts stay in sight, plus the strips the player keeps (Settings → Overlay →
  // While minimized).
  if (vm.overlay.minimized) {
    const keep = vm.settings.overlay.minimizedShow;
    return (
      <>
        <div className={`panel minimized${vm.overlay.clickThrough ? ' click-through' : ''}`}>
          <Header vm={vm} interactive={interactive} />
        </div>
        {Object.values(keep).some(Boolean) && <Below vm={vm} interactive={interactive} only={keep} />}
      </>
    );
  }

  return (
    <>
      <div className={`panel${vm.overlay.clickThrough ? ' click-through' : ''}`}>
        {sections.header && <Header vm={vm} interactive={interactive} />}
        <div className="body">
          {vm.overlay.searchOpen ? (
            <SearchPanel />
          ) : vm.abyss ? (
            <AbyssPanel abyss={vm.abyss} choice={vm.settings.abyss} interactive={interactive} />
          ) : (
            sections.encounter &&
            (vm.brief ? (
              <BriefView
                brief={vm.brief}
                fitCheck={vm.fitCheck}
                pocket={vm.pocket}
                interactive={interactive}
                view={vm.settings.overlay.waveView}
                extra={extra}
                headerMode={vm.settings.overlay.headerMode}
              />
            ) : (
              <div className="empty">
                <div>No encounter selected.</div>
                <div className="muted">
                  Press <kbd>{shortcutLabel(vm.settings.shortcuts.search)}</kbd> to search a mission or site.
                </div>
              </div>
            ))
          )}
        </div>
        {interactive && <ResizeGrip />}
      </div>
      {!vm.overlay.searchOpen && (
        <SideStrip
          brief={sections.encounter ? vm.brief : null}
          fitCheck={sections.encounter ? vm.fitCheck : null}
          fits={vm.fit}
          abyss={vm.abyss !== null}
          cargo={vm.abyssCargo}
          interactive={interactive}
          open={extra}
          toggle={toggleExtra}
        />
      )}
      {!vm.overlay.searchOpen && <Below vm={vm} interactive={interactive} />}
    </>
  );
}
