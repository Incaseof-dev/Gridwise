import type { AppViewModel } from '../../preload/api';

/**
 * Live warnings for the active character, a strip below the panel (Below.tsx). Hidden with nothing to report:
 * nothing above it moves, so it can come and go freely.
 */
export function ThreatsSection({ vm }: { vm: AppViewModel }) {
  if (!vm.threats.length) return null;
  // Info-level known capabilities are context, not alarms: one compact row of chips.
  const lines = vm.threats.filter((t) => !(t.basis === 'known' && t.severity === 'info'));
  const context = vm.threats.filter((t) => t.basis === 'known' && t.severity === 'info');
  return (
    <div className="threats">
      {lines.map((t) => (
        <div
          key={t.id}
          className={`threat ${t.basis}`}
          title={t.basis === 'known' ? 'Known capability (SDE/KB), not seen in the log yet' : 'Seen in the log'}
        >
          <span className={`chip sev-${t.severity}`}>{t.label}</span>
          <span className="threat-text">{t.text}</span>
        </div>
      ))}
      {context.length > 0 && (
        <div className="threat known context">
          <span className="muted small">also known:</span>
          {context.map((t) => (
            <span key={t.id} className="chip sev-info" title={t.text}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
