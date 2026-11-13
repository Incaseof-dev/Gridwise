import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EsiClient, type EsiFetch, type StoredCharacter } from './client';
import { ESI_SCOPES, SSO_CALLBACK, startLogin, tokenCharacter } from './sso';

const jwt = (payload: object) => ['x', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('EVE SSO', () => {
  it('builds the PKCE login URL with the four read scopes', () => {
    const l = startLogin('abc');
    const u = new URL(l.url);
    expect(u.origin + u.pathname).toBe('https://login.eveonline.com/v2/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('abc');
    expect(u.searchParams.get('redirect_uri')).toBe(SSO_CALLBACK);
    expect(u.searchParams.get('scope')!.split(' ')).toEqual([...ESI_SCOPES]);
    expect(u.searchParams.get('state')).toBe(l.state);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(l.verifier).digest('base64url'));
    expect(SSO_CALLBACK).toBe('http://localhost:47913/eveassistant');
  });

  it('reads the character from the access token', () => {
    const t = jwt({
      sub: 'CHARACTER:EVE:90000042',
      name: 'Test Pilot',
      iss: 'https://login.eveonline.com',
      scp: ['a', 'b'],
    });
    expect(tokenCharacter(t)).toEqual({ characterId: 90000042, name: 'Test Pilot', scopes: ['a', 'b'] });
    expect(tokenCharacter(jwt({ sub: 'CHARACTER:EVE:1', iss: 'login.eveonline.com', scp: 'a' })).scopes).toEqual(['a']);
    expect(() => tokenCharacter(jwt({ sub: 'CORP:1', iss: 'login.eveonline.com' }))).toThrow();
  });
});

describe('ESI client', () => {
  function setup(
    routes: (
      url: string,
      headers: Record<string, string>,
    ) => { status: number; headers?: Record<string, string | undefined>; body?: unknown },
  ) {
    let now = Date.parse('2026-10-26T10:00:00Z');
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    let saved: StoredCharacter[] = [{ characterId: 1, name: 'A', scopes: [], refreshToken: 'r1' }];
    const fetch: EsiFetch = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      const r = url.includes('/oauth/token')
        ? { status: 200, body: { access_token: `tok${calls.length}`, refresh_token: 'r2', expires_in: 1199 } }
        : routes(url, init.headers);
      const h = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? null]));
      return {
        status: r.status,
        headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null },
        json: async () => r.body,
      };
    };
    const client = new EsiClient(
      () => 'cid',
      { load: () => saved, save: (c) => (saved = c) },
      fetch,
      () => now,
    );
    return { client, calls, advance: (ms: number) => (now += ms), saved: () => saved };
  }
  const expiresIn = (s: number) => new Date(Date.parse('2026-10-26T10:00:00Z') + s * 1000).toUTCString();

  it('refreshes the token once, sends the compatibility date, and keeps the rotated refresh token', async () => {
    const { client, calls, saved } = setup(() => ({
      status: 200,
      headers: { Expires: expiresIn(120), ETag: '"e1"' },
      body: { total_sp: 5 },
    }));
    expect(await client.get(1, '/skills')).toEqual({ total_sp: 5 });
    expect(calls.map((c) => c.url)).toEqual([
      'https://login.eveonline.com/v2/oauth/token',
      'https://esi.evetech.net/characters/1/skills',
    ]);
    expect(calls[0]!.body).toContain('grant_type=refresh_token');
    expect(calls[0]!.body).toContain('client_id=cid');
    expect(calls[1]!.headers['X-Compatibility-Date']).toBe('2020-01-01');
    expect(calls[1]!.headers.Authorization).toBe('Bearer tok1');
    expect(saved()[0]!.refreshToken).toBe('r2');
  });

  it('sets the autopilot destination with a POST to the waypoint route (EVE-103)', async () => {
    const { client, calls } = setup((url) => ({ status: url.includes('/ui/autopilot/waypoint') ? 204 : 500 }));
    await client.setDestination(1, 30000142);
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe('/ui/autopilot/waypoint');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      add_to_beginning: 'false',
      clear_other_waypoints: 'true',
      destination_id: '30000142',
    });
    expect(calls[1]!.headers.Authorization).toBe('Bearer tok1');
  });

  it('reports a refused destination', async () => {
    const { client } = setup(() => ({ status: 403, body: { error: 'token is not valid for scope(s)' } }));
    await expect(client.setDestination(1, 30000142)).rejects.toThrow(/403 token is not valid/);
  });

  it('serves from the cache until Expires, then revalidates with the ETag', async () => {
    let n = 0;
    const { client, calls, advance } = setup((_u, h) => {
      n++;
      return h['If-None-Match'] === '"e1"'
        ? { status: 304, headers: { Expires: expiresIn(400) } }
        : { status: 200, headers: { Expires: expiresIn(120), ETag: '"e1"' }, body: [1, 2] };
    });
    await client.get(1, '/implants');
    await client.get(1, '/implants');
    expect(n).toBe(1);
    advance(130_000);
    expect(await client.get(1, '/implants')).toEqual([1, 2]);
    expect(n).toBe(2);
    expect(calls.at(-1)!.headers['If-None-Match']).toBe('"e1"');
  });

  it('waits as long as ESI says after a rate limit, serving what it has', async () => {
    let status = 200;
    const { client, advance } = setup(() =>
      status === 200
        ? { status: 200, headers: { Expires: expiresIn(10) }, body: { ok: 1 } }
        : { status: 420, headers: { 'Retry-After': '30' } },
    );
    await client.get(1, '/ship');
    status = 420;
    advance(20_000);
    expect(await client.get(1, '/ship')).toEqual({ ok: 1 });
    status = 200;
    advance(10_000);
    expect(await client.get(1, '/ship')).toEqual({ ok: 1 });
  });

  it('logout drops the character and hands back its refresh token', () => {
    const { client, saved } = setup(() => ({ status: 200, body: {} }));
    expect(client.remove(1)).toBe('r1');
    expect(saved()).toEqual([]);
    expect(client.list()).toEqual([]);
  });
});
