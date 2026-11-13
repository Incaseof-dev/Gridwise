/**
 * A small ESI client for the four read routes the app uses (EVE-38, decision EVE-D7). Per character it keeps the
 * refresh token, refreshes the access token a minute before it runs out, and caches each route by its `Expires`
 * and ETag, so a poll inside the cache window costs nothing and an unchanged answer costs a 304. On 420/429 it
 * waits as long as ESI says. Network and token storage are injected.
 */
import { refreshTokens, type Fetch, type SsoCharacter, type TokenSet } from './sso';

export const ESI_BASE = 'https://esi.evetech.net';
/** ESI's versioning: the API as of this date (the only one the spec lists). */
export const ESI_COMPATIBILITY_DATE = '2020-01-01';
const REFRESH_EARLY_MS = 60_000;
const DEFAULT_BACKOFF_MS = 60_000;

export interface EsiSkills {
  skills: { skill_id: number; active_skill_level: number; trained_skill_level: number; skillpoints_in_skill: number }[];
  total_sp: number;
  unallocated_sp?: number;
}
export type EsiImplants = number[];
export interface EsiFitting {
  fitting_id: number;
  name: string;
  description: string;
  ship_type_id: number;
  items: { type_id: number; flag: string; quantity: number }[];
}
export interface EsiShip {
  ship_type_id: number;
  ship_item_id: number;
  ship_name: string;
}

export interface StoredCharacter extends SsoCharacter {
  refreshToken: string;
}

/** Where refresh tokens live (main: encrypted with Electron safeStorage). */
export interface TokenStore {
  load(): StoredCharacter[];
  save(characters: StoredCharacter[]): void;
}

export type EsiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

interface Cached {
  etag: string | null;
  expiresMs: number;
  body: unknown;
}

export class EsiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class EsiClient {
  private characters: StoredCharacter[];
  private readonly access = new Map<number, TokenSet>();
  private readonly cache = new Map<string, Cached>();
  private blockedUntilMs = 0;

  constructor(
    private readonly clientId: () => string,
    private readonly store: TokenStore,
    private readonly fetch: EsiFetch,
    private readonly now: () => number = Date.now,
  ) {
    this.characters = store.load();
  }

  list(): SsoCharacter[] {
    return this.characters.map(({ characterId, name, scopes }) => ({ characterId, name, scopes }));
  }

  /** After a login: keeps the character (replacing an earlier login of the same one). */
  add(c: SsoCharacter, tokens: TokenSet): void {
    this.characters = [
      ...this.characters.filter((x) => x.characterId !== c.characterId),
      { ...c, refreshToken: tokens.refreshToken },
    ];
    this.access.set(c.characterId, tokens);
    this.store.save(this.characters);
  }

  /** Forgets a character; returns its refresh token so the caller can revoke it. */
  remove(characterId: number): string | null {
    const c = this.characters.find((x) => x.characterId === characterId);
    this.characters = this.characters.filter((x) => x.characterId !== characterId);
    this.access.delete(characterId);
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${characterId}|`)) this.cache.delete(k);
    this.store.save(this.characters);
    return c?.refreshToken ?? null;
  }

  private async token(characterId: number): Promise<string> {
    const t = this.access.get(characterId);
    if (t && t.expiresMs - REFRESH_EARLY_MS > this.now()) return t.accessToken;
    const c = this.characters.find((x) => x.characterId === characterId);
    if (!c) throw new EsiError('not logged in', 401);
    let fresh: TokenSet;
    try {
      fresh = await refreshTokens(this.fetch as unknown as Fetch, this.clientId(), c.refreshToken, this.now());
    } catch (err) {
      throw new EsiError(`${String((err as Error).message)}. Log in again.`, 401);
    }
    this.access.set(characterId, fresh);
    if (fresh.refreshToken && fresh.refreshToken !== c.refreshToken) {
      c.refreshToken = fresh.refreshToken;
      this.store.save(this.characters);
    }
    return fresh.accessToken;
  }

  /** When ESI's copy of a route runs out (a new request before that returns the same answer); null: not read yet. */
  expiresAt(characterId: number, route: string): number | null {
    return this.cache.get(`${characterId}|${route}`)?.expiresMs ?? null;
  }

  /**
   * EVE-103: the autopilot destination in game (the route the game picks with its own preferences). Clears the other
   * waypoints, like "Set Destination" in game.
   */
  async setDestination(characterId: number, systemId: number): Promise<void> {
    if (this.now() < this.blockedUntilMs) throw new EsiError('ESI asked to wait (rate limit)', 429);
    const q = new URLSearchParams({
      add_to_beginning: 'false',
      clear_other_waypoints: 'true',
      destination_id: String(systemId),
    });
    const res = await this.fetch(`${ESI_BASE}/ui/autopilot/waypoint?${q}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token(characterId)}`,
        Accept: 'application/json',
        'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
      },
    });
    if (res.status === 204 || res.status === 200) return;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new EsiError(`ESI set destination: ${res.status} ${body?.error ?? ''}`.trim(), res.status);
  }

  /** GET a character route, e.g. `/skills`; from the cache while ESI's `Expires` has not passed. */
  async get<T>(characterId: number, route: string): Promise<T> {
    const key = `${characterId}|${route}`;
    const hit = this.cache.get(key);
    const now = this.now();
    if (hit && hit.expiresMs > now) return hit.body as T;
    if (now < this.blockedUntilMs) {
      if (hit) return hit.body as T;
      throw new EsiError('ESI asked to wait (rate limit)', 429);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token(characterId)}`,
      Accept: 'application/json',
      'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
    };
    if (hit?.etag) headers['If-None-Match'] = hit.etag;
    const res = await this.fetch(`${ESI_BASE}/characters/${characterId}${route}`, { method: 'GET', headers });
    const expires = Date.parse(res.headers.get('expires') ?? '');
    const expiresMs = Number.isFinite(expires) ? expires : now + 60_000;
    if (res.status === 304 && hit) {
      hit.expiresMs = expiresMs;
      return hit.body as T;
    }
    if (res.status === 420 || res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      this.blockedUntilMs = now + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : DEFAULT_BACKOFF_MS);
      if (hit) return hit.body as T;
      throw new EsiError('ESI asked to wait (rate limit)', res.status);
    }
    if (res.status !== 200) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new EsiError(`ESI ${route}: ${res.status} ${body?.error ?? ''}`.trim(), res.status);
    }
    const body = await res.json();
    this.cache.set(key, { etag: res.headers.get('etag'), expiresMs, body });
    return body as T;
  }
}
