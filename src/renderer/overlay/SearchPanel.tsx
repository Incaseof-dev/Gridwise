import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SearchResult } from '../../preload/api';

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    // The window may get focus a moment after it is shown.
    const t = setTimeout(() => input.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void window.eve.search(query).then((r) => {
        if (!alive) return;
        setResults(r);
        setActive(0);
      });
    }, 80);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    void window.eve.selectEncounter(r.ref).then(() => window.eve.setSearchOpen(false));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') void window.eve.setSearchOpen(false);
    else if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter') choose(results[active]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="search">
      <input
        ref={input}
        value={query}
        placeholder="Mission, anomaly or DED site… (filters: ded 4, class 6, l4)"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
      />
      <ul className="results">
        {results.map((r, i) => (
          <li
            key={JSON.stringify(r.ref)}
            className={`${i === active ? 'active' : ''}${r.hasKb ? '' : ' sde-only'}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(r)}
          >
            <span className="r-title">{r.title}</span>
            <span className="r-sub">{r.subtitle}</span>
          </li>
        ))}
        {query.trim() && !results.length && <li className="muted">No matches</li>}
      </ul>
      <div className="hint muted">↑↓ Enter Esc · filters: ded 4 · class 6 (anomaly) · l4 (mission)</div>
    </div>
  );
}
