/**
 * EVE SSO v2 for a desktop app (EVE-38): authorization code with PKCE, no client secret. The player registers the
 * app on developers.eveonline.com and the client ID is a setting (decision EVE-D7). Only read scopes, the four the
 * app uses. Network calls go through an injected fetch, so this is testable without the login server.
 */
import { createHash, randomBytes } from 'node:crypto';

export const SSO_AUTHORIZE = 'https://login.eveonline.com/v2/oauth/authorize';
export const SSO_TOKEN = 'https://login.eveonline.com/v2/oauth/token';
export const SSO_REVOKE = 'https://login.eveonline.com/v2/oauth/revoke';
/** Must match the callback URL of the app registration exactly. */
export const SSO_CALLBACK_PORT = 47913;
export const SSO_CALLBACK = `http://localhost:${SSO_CALLBACK_PORT}/eveassistant`;

/** What the app asks for (EVE-D7); the registration may hold more, they are not requested. */
export const ESI_SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-clones.read_implants.v1',
  'esi-fittings.read_fittings.v1',
  'esi-location.read_ship_type.v1',
] as const;
export type EsiScope = (typeof ESI_SCOPES)[number];
/**
 * EVE-103: sets the autopilot destination from the intel graph. The only write scope, asked for only when the player
 * turns the option on (Settings → Intel), so a registration without it keeps working for the rest.
 */
export const WAYPOINT_SCOPE = 'esi-ui.write_waypoint.v1';
/**
 * The blues: the pilot's own, corporation's and alliance's contacts, so kills of friends count as ours on the intel
 * kill counts. Read only, asked for only when the player turns that on (Settings → Intel).
 */
export const CONTACT_SCOPES = [
  'esi-characters.read_contacts.v1',
  'esi-corporations.read_contacts.v1',
  'esi-alliances.read_contacts.v1',
] as const;

const b64url = (b: Buffer) => b.toString('base64url');

export interface PkceLogin {
  verifier: string;
  state: string;
  url: string;
}

/** A login attempt: the URL to open in the browser, and what the callback must bring back. */
export function startLogin(clientId: string, scopes: readonly string[] = ESI_SCOPES): PkceLogin {
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    response_type: 'code',
    redirect_uri: SSO_CALLBACK,
    client_id: clientId,
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { verifier, state, url: `${SSO_AUTHORIZE}?${q}` };
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Wall clock (ms) when the access token runs out. */
  expiresMs: number;
}

export interface SsoCharacter {
  characterId: number;
  name: string;
  scopes: string[];
}

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

async function tokenCall(fetch: Fetch, form: Record<string, string>, nowMs: number): Promise<TokenSet> {
  const res = await fetch(SSO_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status !== 200 || !body || typeof body.access_token !== 'string')
    throw new Error(
      `EVE login refused (${res.status}): ${String(body?.error_description ?? body?.error ?? 'no token')}`,
    );
  return {
    accessToken: body.access_token,
    refreshToken: String(body.refresh_token ?? form.refresh_token ?? ''),
    expiresMs: nowMs + Number(body.expires_in ?? 1199) * 1000,
  };
}

/** The callback's code for tokens. */
export function exchangeCode(fetch: Fetch, clientId: string, code: string, verifier: string, nowMs = Date.now()) {
  return tokenCall(
    fetch,
    { grant_type: 'authorization_code', code, client_id: clientId, code_verifier: verifier },
    nowMs,
  );
}

/** A fresh access token; CCP may hand out a new refresh token too, which then replaces the old one. */
export function refreshTokens(fetch: Fetch, clientId: string, refreshToken: string, nowMs = Date.now()) {
  return tokenCall(fetch, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }, nowMs);
}

/** Logout: the refresh token stops working at CCP too. Failures are ignored, the local token is dropped anyway. */
export async function revokeToken(fetch: Fetch, clientId: string, refreshToken: string): Promise<void> {
  await fetch(SSO_REVOKE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token_type_hint: 'refresh_token',
      token: refreshToken,
      client_id: clientId,
    }).toString(),
  }).catch(() => undefined);
}

/**
 * Who the access token belongs to, from its JWT payload. The token comes straight from CCP over TLS, so the
 * signature is not checked here; the issuer and the subject format are.
 */
export function tokenCharacter(accessToken: string): SsoCharacter {
  const part = accessToken.split('.')[1];
  if (!part) throw new Error('EVE login: the token is not a JWT');
  const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  const sub = /^CHARACTER:EVE:(\d+)$/.exec(String(p.sub ?? ''));
  if (!sub || !String(p.iss ?? '').includes('login.eveonline.com')) throw new Error('EVE login: unexpected token');
  const scp = p.scp;
  return {
    characterId: Number(sub[1]),
    name: String(p.name ?? `Character ${sub[1]}`),
    scopes: Array.isArray(scp) ? scp.map(String) : typeof scp === 'string' ? [scp] : [],
  };
}
