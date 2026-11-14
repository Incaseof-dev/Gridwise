/**
 * The pilot's corporation and alliance, from ESI's public affiliation route (no login, no scope), to tell our side
 * in the zKillboard kills. Kept in memory only, asked again after an hour (a pilot can change corporation).
 */
import type { Affiliation } from '../intel/view';
import { ESI_BASE, ESI_COMPATIBILITY_DATE } from './client';
import type { Fetch } from './sso';

const KEEP_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;

export async function fetchAffiliation(f: Fetch, characterId: number): Promise<Affiliation | null> {
  const res = await f(`${ESI_BASE}/characters/affiliation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
    },
    body: JSON.stringify([characterId]),
  });
  if (res.status !== 200) throw new Error(`ESI affiliation: ${res.status}`);
  const rows = (await res.json()) as { character_id: number; corporation_id: number; alliance_id?: number }[];
  const r = Array.isArray(rows) ? rows.find((x) => x.character_id === characterId) : undefined;
  return r && typeof r.corporation_id === 'number'
    ? { corporationId: r.corporation_id, allianceId: typeof r.alliance_id === 'number' ? r.alliance_id : null }
    : null;
}

/** One pilot's affiliation, fetched when asked for a new pilot or when an hour has passed; never blocks. */
export class AffiliationCache {
  private characterId: number | null = null;
  private value: Affiliation | null = null;
  private atMs = 0;
  private pending = false;

  constructor(
    private readonly f: Fetch,
    private readonly changed: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The affiliation known for this pilot now (null until it has been fetched); starts a fetch when due. */
  get(characterId: number | null): Affiliation | null {
    if (characterId === null) return null;
    if (characterId !== this.characterId) {
      this.characterId = characterId;
      this.value = null;
      this.atMs = 0;
    }
    const due = this.now() - this.atMs >= (this.value ? KEEP_MS : this.atMs ? RETRY_MS : 0);
    if (due && !this.pending) void this.load(characterId);
    return this.value;
  }

  private async load(characterId: number): Promise<void> {
    this.pending = true;
    try {
      const v = await fetchAffiliation(this.f, characterId);
      if (characterId !== this.characterId) return;
      const same = v?.corporationId === this.value?.corporationId && v?.allianceId === this.value?.allianceId;
      this.value = v;
      this.atMs = this.now();
      if (!same) this.changed();
    } catch {
      if (characterId === this.characterId) this.atMs = this.now();
    } finally {
      this.pending = false;
    }
  }
}
