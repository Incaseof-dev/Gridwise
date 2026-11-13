import { useState } from 'react';
import { DEFAULT_EWB_API, normalizeApiBase } from '@core/settings';
import type { AppViewModel } from '../../preload/api';
import { compact } from '../shared/format';

const SCOPE_LABEL: Record<string, string> = {
  'esi-skills.read_skills.v1': 'skills',
  'esi-clones.read_implants.v1': 'implants',
  'esi-fittings.read_fittings.v1': 'saved fittings',
  'esi-location.read_ship_type.v1': 'current ship',
  'esi-ui.write_waypoint.v1': 'set destination',
};

/** EVE login (EVE-38): optional, read only; skills, implants, saved fittings and the current ship. */
export function EsiTab({ vm }: { vm: AppViewModel }) {
  const e = vm.esi;
  // Edited text, or null to show the stored ID.
  const [draft, setDraft] = useState<string | null>(null);
  const clientId = draft ?? e.clientId;
  return (
    <section>
      <h2>EVE login</h2>
      <p className="muted">
        Optional. With it the fit numbers use your real skills and implants instead of All V, your fittings saved in
        game show in Ship fit, and the fit of the ship you sit in becomes active by itself. The login can only read
        these four things; the app works the same without it.
      </p>

      <div className="field">
        <label>Characters</label>
        {e.characters.length === 0 && <p className="muted">No character logged in.</p>}
        <table className="esi-chars">
          <tbody>
            {e.characters.map((c) => (
              <tr key={c.characterId}>
                <td>
                  <b>{c.name}</b>
                  {vm.characters.some((x) => x.characterId === c.characterId) && (
                    <span className="muted small" title="This character's game log is being read">
                      {' '}
                      · in the logs
                    </span>
                  )}
                  {c.missingScopes.length > 0 && (
                    <div className="error small">
                      Not granted: {c.missingScopes.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}. Log in again and leave
                      them ticked.
                    </div>
                  )}
                  {c.error && <div className="error small">{c.error}</div>}
                </td>
                <td className="small">
                  {c.totalSp !== null ? (
                    <>
                      {compact(c.totalSp)} SP · {c.skillCount} skills · {c.implants ?? 0} implants · {c.fittings ?? 0}{' '}
                      fittings
                    </>
                  ) : (
                    <span className="muted">reading…</span>
                  )}
                  {c.updatedAt && <div className="muted">updated {new Date(c.updatedAt).toLocaleTimeString()}</div>}
                </td>
                <td>
                  <button onClick={() => void window.eve.esiLogout(c.characterId)}>Log out</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="path">
          {e.loggingIn ? (
            <>
              <span className="muted">Finish the login in your browser…</span>
              <button onClick={() => void window.eve.esiCancelLogin()}>Cancel</button>
            </>
          ) : (
            <button className="primary" disabled={!e.clientId.trim()} onClick={() => void window.eve.esiLogin()}>
              Log in with EVE Online{e.characters.length ? ' (another character)' : ''}
            </button>
          )}
        </div>
        {e.error && <p className="error">{e.error}</p>}
        {e.encryption === 'basic' && (
          <p className="error small storage-warning">
            No system keyring found (KWallet / GNOME keyring), so the login is stored only obfuscated. Anyone with
            access to your user account could read it.
          </p>
        )}
        {e.encryption === 'none' && (
          <p className="error storage-warning">This system offers no storage for the login.</p>
        )}
      </div>

      <details className="field">
        <summary>App registration</summary>
        <p className="muted small">
          The login goes through an app registered on developers.eveonline.com. With your own registration, use the
          callback <code>{e.callback}</code> and the scopes{' '}
          {Object.keys(SCOPE_LABEL).map((s, i) => (
            <span key={s}>
              {i > 0 && ', '}
              <code>{s}</code>
            </span>
          ))}
          . No secret key is needed.
        </p>
        <div className="path">
          <input
            type="text"
            className="client-id"
            spellCheck={false}
            value={clientId}
            onChange={(ev) => setDraft(ev.target.value)}
          />
          <button
            disabled={clientId.trim() === e.clientId}
            onClick={() => {
              void window.eve.updateSettings({ esi: { clientId: clientId.trim() } });
              setDraft(null);
            }}
          >
            Save client ID
          </button>
        </div>
      </details>

      <EwbSection vm={vm} />
    </section>
  );
}

/**
 * EVE Workbench (EVE-86): the player's personal access token, made on eveworkbench.com. With it the fits there show
 * in Ship fit, the Abyss log shows the Abyss Tracker's runs, and a run can be uploaded from the log.
 */
function EwbSection({ vm }: { vm: AppViewModel }) {
  const w = vm.ewb;
  const [key, setKey] = useState('');
  const privacy = vm.settings.ewb.privacy;
  return (
    <div className="field ewb">
      <h3>
        EVE Workbench
        {w.apiBase !== DEFAULT_EWB_API && (
          <span className="chip-flying" title={`Not the live EVE Workbench: ${w.apiBase}`}>
            {/staging/i.test(w.apiBase) ? 'staging' : 'test server'}
          </span>
        )}
      </h3>
      <p className="muted">
        Optional. With your EVE Workbench key, your fits there show in Ship fit, the Abyss log shows your Abyss Tracker
        runs, and a run can be uploaded to the tracker with its loot. Nothing is sent unless you press Upload. Make the
        key on eveworkbench.com (your profile, API keys).
      </p>
      {w.hasKey ? (
        <>
          <p>
            Key saved
            {w.characters.length > 0 && (
              <span className="muted"> · account: {w.characters.map((c) => c.name).join(', ')}</span>
            )}
            {w.fits !== null && (
              <span className="muted">
                {' '}
                · {w.fits} fits, {w.runs ?? 0} Abyss runs
              </span>
            )}
            {w.updatedAt && <span className="muted small"> · read {new Date(w.updatedAt).toLocaleTimeString()}</span>}
          </p>
          <div className="path">
            <button disabled={w.syncing} onClick={() => void window.eve.ewbSync()}>
              {w.syncing ? 'Reading…' : 'Read now'}
            </button>
            <button
              onClick={() => {
                setKey('');
                void window.eve.ewbClearKey();
              }}
            >
              Remove the key
            </button>
          </div>
        </>
      ) : (
        <div className="path">
          <input
            type="password"
            className="client-id"
            spellCheck={false}
            autoComplete="off"
            placeholder="EVE Workbench API key"
            value={key}
            onChange={(ev) => setKey(ev.target.value)}
          />
          <button
            className="primary"
            disabled={!key.trim() || w.checking || !w.canStore}
            onClick={() => void window.eve.ewbSetKey(key)}
          >
            {w.checking ? 'Checking…' : 'Check and save'}
          </button>
        </div>
      )}
      {!w.canStore && <p className="error small storage-warning">This system offers no secure storage for the key.</p>}
      {w.error && <p className="error">{w.error}</p>}
      <label className="check">
        <input
          type="checkbox"
          checked={privacy === 'public'}
          onChange={(ev) =>
            void window.eve.updateSettings({ ewb: { privacy: ev.target.checked ? 'public' : 'private' } })
          }
        />{' '}
        Uploaded runs are public on the Abyss Tracker (otherwise only you see them)
      </label>
      <ApiServer current={w.apiBase} />
      {w.calls.length > 0 && <RecentCalls calls={w.calls} />}
    </div>
  );
}

/** The last EVE Workbench calls with their times (EVE-91), so a slow or silent server shows. */
function RecentCalls({ calls }: { calls: AppViewModel['ewb']['calls'] }) {
  return (
    <details className="field">
      <summary>Recent calls</summary>
      <table className="sitemap ewb-calls">
        <tbody>
          {calls.map((c) => (
            <tr key={`${c.at}-${c.path}`}>
              <td className="small muted">{new Date(c.at).toLocaleTimeString()}</td>
              <td className="small">
                {c.method} {c.path}
              </td>
              <td className={`small${c.error ? ' bad' : ''}`}>{c.status ?? 'no answer'}</td>
              <td className="small num">{c.ms < 1000 ? `${c.ms} ms` : `${(c.ms / 1000).toFixed(1)} s`}</td>
              <td className="small bad">{c.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * The EVE Workbench API server (EVE-90): the live one, or e.g. its staging server for trying the upload. Another
 * server has its own keys, so changing it drops the saved key.
 */
function ApiServer({ current }: { current: string }) {
  // Edited text, or null to show the stored server.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? current;
  const next = normalizeApiBase(text);
  const save = (base: string) => {
    void window.eve.updateSettings({ ewb: { apiBase: base } });
    setDraft(null);
  };
  return (
    <details className="field" open={current !== DEFAULT_EWB_API || undefined}>
      <summary>API server</summary>
      <p className="muted small">
        The live EVE Workbench is <code>{DEFAULT_EWB_API}</code>. To try the upload without touching the live tracker,
        put EVE Workbench&apos;s staging server here (e.g. <code>https://api.staging.eveworkbench.com</code>) with a key
        made there. Changing the server removes the saved key and what was read with it.
      </p>
      <div className="path">
        <input
          type="text"
          className="client-id"
          spellCheck={false}
          value={text}
          onChange={(ev) => setDraft(ev.target.value)}
        />
        <button disabled={!next || next === current} onClick={() => next && save(next)}>
          Use this server
        </button>
        {current !== DEFAULT_EWB_API && <button onClick={() => save(DEFAULT_EWB_API)}>Back to the live server</button>}
      </div>
      {draft !== null && !next && <p className="error small">An https address, e.g. {DEFAULT_EWB_API}</p>}
    </details>
  );
}
