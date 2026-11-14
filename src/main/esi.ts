/**
 * ESI login and data in the main process (EVE-38): the loopback callback server for the SSO, refresh tokens
 * encrypted with Electron safeStorage, and the characters' skills and implants (read every few minutes, within
 * ESI's cache times). The app works the same without any login.
 */
import { net, safeStorage, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import {
  EsiClient,
  type EsiFetch,
  type EsiFitting,
  type EsiImplants,
  type EsiShip,
  type EsiSkills,
  type StoredCharacter,
  type TokenStore,
} from '../core/esi/client';
import {
  ESI_SCOPES,
  exchangeCode,
  revokeToken,
  SSO_CALLBACK,
  SSO_CALLBACK_PORT,
  startLogin,
  tokenCharacter,
  WAYPOINT_SCOPE,
  type Fetch,
} from '../core/esi/sso';
import { configDir } from '../core/paths';
import type { Pilot } from '../core/fit/types';
import type { EsiView } from '../core/viewmodel';

const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** Skills and implants change when the player trains or plugs in; a few minutes is plenty. */
const POLL_MS = 5 * 60_000;
/** The ship: often enough to follow a ship change within a minute (ESI caches it 5 s; 60 calls an hour). */
const SHIP_POLL_MS = 60_000;
/** Between two manual syncs at least. */
const MIN_SYNC_GAP_MS = 60_000;

/** What the controller hears from ESI: a character's fittings, and the hull they sit in when it changes. */
export interface EsiEvents {
  changed(): void;
  fittings(characterId: number, fittings: EsiFitting[]): void;
  boarded(characterId: number, shipTypeId: number): void;
}

/** Refresh tokens on disk, encrypted by the OS keyring when there is one (KWallet / GNOME keyring / DPAPI). */
class SafeTokenStore implements TokenStore {
  constructor(private readonly path = join(configDir(), 'esi-tokens.bin')) {}

  load(): StoredCharacter[] {
    if (!existsSync(this.path) || !safeStorage.isEncryptionAvailable()) return [];
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(this.path))) as StoredCharacter[];
    } catch (err) {
      console.error('esi tokens:', err);
      return [];
    }
  }

  save(characters: StoredCharacter[]): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, safeStorage.encryptString(JSON.stringify(characters)));
    renameSync(`${this.path}.tmp`, this.path);
  }
}

export const fetchViaNet: EsiFetch = (url, init) => net.fetch(url, init);

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Gridwise</title>` +
  `<body style="font:16px system-ui;background:#11161d;color:#dde;display:grid;place-items:center;height:90vh">` +
  `<div><h2>${title}</h2><p>${text}</p></div>`;

interface CharacterData {
  skills: { totalSp: number; count: number; levels: Map<number, number> } | null;
  implants: number[] | null;
  /** For the fit engine; a new object only when skills or implants changed, so its results stay cached. */
  pilot: Pilot | null;
  fittings: number | null;
  updatedMs: number | null;
  error: string | null;
}

export class EsiService {
  private readonly client: EsiClient;
  private readonly data = new Map<number, CharacterData>();
  private login: { servers: Server[]; timer: NodeJS.Timeout } | null = null;
  private loginError: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private shipTimer: NodeJS.Timeout | null = null;
  private readonly ships = new Map<number, number>();
  private readonly changed: () => void;

  constructor(
    private readonly clientId: () => string,
    private readonly events: EsiEvents,
    /** The character whose ship to follow (the pilot of the fit numbers), or null. */
    private readonly shipCharacter: () => number | null,
    /** EVE-103: the destination option is on, so the login asks for the waypoint scope too. */
    private readonly wantsWaypoint: () => boolean = () => false,
  ) {
    this.client = new EsiClient(clientId, new SafeTokenStore(), fetchViaNet);
    this.changed = () => events.changed();
  }

  start(): void {
    void this.refreshAll().then(() => this.pollShip());
    this.pollTimer = setInterval(() => void this.refreshAll(), POLL_MS);
    this.shipTimer = setInterval(() => void this.pollShip(), SHIP_POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.shipTimer) clearInterval(this.shipTimer);
    this.endLogin();
  }

  private syncing = false;
  private lastSyncMs = 0;

  /** Not before ESI's fittings cache runs out (it would answer the same), and at most once a minute. */
  private nextSyncMs(): number {
    const exp = this.client
      .list()
      .map((c) => this.client.expiresAt(c.characterId, '/fittings') ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return Math.max(exp, this.lastSyncMs + MIN_SYNC_GAP_MS);
  }

  /** The Sync button: everything now, for every logged-in character. */
  async syncNow(): Promise<void> {
    if (this.syncing || Date.now() < this.nextSyncMs()) return;
    this.syncing = true;
    this.lastSyncMs = Date.now();
    this.changed();
    try {
      await this.refreshAll();
      await this.pollShip();
    } finally {
      this.syncing = false;
      this.changed();
    }
  }

  /** The id of the character the pilot logic picks (see pilot()). */
  pilotId(logCharacterId: number | null): number | null {
    const ids = this.client.list().map((c) => c.characterId);
    return logCharacterId !== null && ids.includes(logCharacterId) ? logCharacterId : ids.length === 1 ? ids[0]! : null;
  }

  /** The hull a character sat in at the last poll. */
  ship(characterId: number): number | null {
    return this.ships.get(characterId) ?? null;
  }

  /** Reports a hull only when it changed, so a fit picked by hand stays until the next ship change. */
  private async pollShip(): Promise<void> {
    const id = this.shipCharacter();
    if (id === null) return;
    try {
      const s = await this.client.get<EsiShip>(id, '/ship');
      if (this.ships.get(id) === s.ship_type_id) return;
      this.ships.set(id, s.ship_type_id);
      this.events.boarded(id, s.ship_type_id);
    } catch (err) {
      const d = this.data.get(id);
      if (d) d.error = (err as Error).message;
      this.changed();
    }
  }

  /**
   * Whose skills the fit numbers use: the character whose game log is active, when logged in; else the only
   * logged-in character; else none (All V).
   */
  pilot(logCharacterId: number | null): Pilot | null {
    const id = this.pilotId(logCharacterId);
    return id === null ? null : (this.data.get(id)?.pilot ?? null);
  }

  /** The scopes a login asks for now. */
  private scopes(): string[] {
    return this.wantsWaypoint() ? [...ESI_SCOPES, WAYPOINT_SCOPE] : [...ESI_SCOPES];
  }

  /**
   * EVE-103: sets the in-game autopilot destination for a character; the error says what to do when it cannot
   * (not logged in, scope not granted, ESI refused).
   */
  async setDestination(
    characterId: number | null,
    systemId: number,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const c = this.client.list().find((x) => x.characterId === characterId);
    if (characterId === null || !c)
      return { ok: false, error: 'This character is not logged in to ESI (Settings → EVE login).' };
    if (!c.scopes.includes(WAYPOINT_SCOPE))
      return { ok: false, error: 'Setting the destination is not granted yet: log in again (Settings → EVE login).' };
    try {
      await this.client.setDestination(characterId, systemId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  view(): EsiView {
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os';
    return {
      clientId: this.clientId(),
      callback: SSO_CALLBACK,
      loggingIn: this.login !== null,
      error: this.loginError,
      syncing: this.syncing,
      nextSyncAt: (() => {
        const next = this.nextSyncMs();
        return this.client.list().length && next > Date.now() ? new Date(next).toISOString() : null;
      })(),
      encryption: !safeStorage.isEncryptionAvailable() ? 'none' : backend === 'basic_text' ? 'basic' : 'os',
      characters: this.client.list().map((c) => {
        const d = this.data.get(c.characterId);
        return {
          characterId: c.characterId,
          name: c.name,
          missingScopes: this.scopes().filter((s) => !c.scopes.includes(s)),
          totalSp: d?.skills?.totalSp ?? null,
          skillCount: d?.skills?.count ?? null,
          implants: d?.implants?.length ?? null,
          fittings: d?.fittings ?? null,
          shipTypeId: this.ships.get(c.characterId) ?? null,
          updatedAt: d?.updatedMs ? new Date(d.updatedMs).toISOString() : null,
          error: d?.error ?? null,
        };
      }),
    };
  }

  /** Opens the EVE login in the browser and waits for the callback on localhost. */
  startLogin(): void {
    if (this.login) return;
    const clientId = this.clientId().trim();
    if (!clientId) {
      this.loginError = 'Enter the client ID of your app registration first.';
      this.changed();
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      this.loginError = 'No secure storage for the login on this system, so it cannot be kept.';
      this.changed();
      return;
    }
    const attempt = startLogin(clientId, this.scopes());
    const servers: Server[] = [];
    const onRequest: Parameters<typeof createServer>[1] = (req, res) => {
      const u = new URL(req.url ?? '/', SSO_CALLBACK);
      if (u.pathname !== new URL(SSO_CALLBACK).pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== attempt.state || !code) {
        res
          .writeHead(400, { 'Content-Type': 'text/html' })
          .end(
            PAGE('Login failed', 'This answer does not belong to the login the app started. Try again from the app.'),
          );
        return;
      }
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(PAGE('Logged in', 'You can close this tab and go back to Gridwise.'));
      this.endLogin();
      void this.finishLogin(clientId, code, attempt.verifier);
    };
    // Loopback only, both address families ("localhost" may resolve to either).
    for (const host of ['127.0.0.1', '::1']) {
      const s = createServer(onRequest);
      s.on('error', (err: NodeJS.ErrnoException) => {
        if (host === '127.0.0.1') {
          this.loginError =
            err.code === 'EADDRINUSE'
              ? `Port ${SSO_CALLBACK_PORT} is in use by another program, so the login cannot come back.`
              : `The login callback could not start: ${err.message}`;
          this.endLogin();
          this.changed();
        }
      });
      s.listen(SSO_CALLBACK_PORT, host);
      servers.push(s);
    }
    this.login = {
      servers,
      timer: setTimeout(() => this.endLogin('The login was not finished in 5 minutes.'), LOGIN_TIMEOUT_MS),
    };
    this.loginError = null;
    void shell.openExternal(attempt.url);
    this.changed();
  }

  cancelLogin(): void {
    this.endLogin();
  }

  private endLogin(error?: string): void {
    if (!this.login) return;
    clearTimeout(this.login.timer);
    for (const s of this.login.servers) s.close();
    this.login = null;
    if (error) this.loginError = error;
    this.changed();
  }

  private async finishLogin(clientId: string, code: string, verifier: string): Promise<void> {
    try {
      const tokens = await exchangeCode(fetchViaNet as unknown as Fetch, clientId, code, verifier);
      const who = tokenCharacter(tokens.accessToken);
      this.client.add(who, tokens);
      this.loginError = null;
      await this.refresh(who.characterId);
      void this.pollShip();
    } catch (err) {
      this.loginError = (err as Error).message;
    }
    this.changed();
  }

  async logout(characterId: number): Promise<void> {
    const token = this.client.remove(characterId);
    this.data.delete(characterId);
    this.ships.delete(characterId);
    this.events.fittings(characterId, []);
    this.changed();
    if (token) await revokeToken(fetchViaNet as unknown as Fetch, this.clientId(), token);
  }

  private async refreshAll(): Promise<void> {
    for (const c of this.client.list()) await this.refresh(c.characterId);
  }

  private async refresh(characterId: number): Promise<void> {
    const d: CharacterData = this.data.get(characterId) ?? {
      skills: null,
      implants: null,
      pilot: null,
      fittings: null,
      updatedMs: null,
      error: null,
    };
    this.data.set(characterId, d);
    try {
      const s = await this.client.get<EsiSkills>(characterId, '/skills');
      d.skills = {
        totalSp: s.total_sp,
        count: s.skills.length,
        levels: new Map(s.skills.map((x) => [x.skill_id, x.active_skill_level])),
      };
      const implants = await this.client.get<EsiImplants>(characterId, '/implants');
      const same =
        d.pilot !== null &&
        d.pilot.implants.join() === implants.join() &&
        d.pilot.skills.size === d.skills.levels.size &&
        [...d.skills.levels].every(([k, v]) => d.pilot!.skills.get(k) === v);
      d.implants = implants;
      if (!same) {
        const name = this.client.list().find((c) => c.characterId === characterId)?.name ?? String(characterId);
        d.pilot = { name, skills: d.skills.levels, implants };
      }
      const fittings = await this.client.get<EsiFitting[]>(characterId, '/fittings');
      d.fittings = fittings.length;
      this.events.fittings(characterId, fittings);
      d.updatedMs = Date.now();
      d.error = null;
    } catch (err) {
      d.error = (err as Error).message;
    }
    this.changed();
  }
}
