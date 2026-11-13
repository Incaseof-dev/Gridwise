/**
 * Local cache of CCP's type images (renders, icons). The renderers ask for `eveimg://types/<id>/<kind>?size=<n>`;
 * a missing image is fetched once from images.evetech.net and kept on disk, so a ship or NPC costs the image server
 * one request ever, and the overlay works offline for what it has seen. Dependency-free apart from node:fs; main
 * wires it to an Electron protocol.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE_SCHEME = 'eveimg';
const UPSTREAM = 'https://images.evetech.net';
const KINDS = new Set(['render', 'icon']);
const SIZES = new Set([32, 64, 128, 256, 512]);

export interface ImageRequest {
  typeId: number;
  kind: string;
  size: number;
}

/** `eveimg://types/603/render?size=64` → its parts; null for anything else. */
export function parseImageUrl(url: string): ImageRequest | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = /^\/(\d+)\/([a-z]+)$/.exec(u.pathname);
  const size = Number(u.searchParams.get('size') ?? 64);
  if (u.protocol !== `${IMAGE_SCHEME}:` || u.host !== 'types' || !m || !KINDS.has(m[2]!) || !SIZES.has(size))
    return null;
  return { typeId: Number(m[1]), kind: m[2]!, size };
}

export function upstreamUrl(r: ImageRequest): string {
  return `${UPSTREAM}/types/${r.typeId}/${r.kind}?size=${r.size}`;
}

/** The image server sends JPEG renders and PNG icons; the bytes tell which. */
export function imageMime(bytes: Uint8Array): string {
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg';
}

export type ImageResult = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; status: number };

/** Fetches from upstream; returns the bytes, or the HTTP status (0 when offline). */
export type ImageFetcher = (url: string) => Promise<{ status: number; bytes: Uint8Array | null }>;

export class ImageCache {
  private readonly inFlight = new Map<string, Promise<ImageResult>>();
  /** Types the server has no image for (404), so a session asks once. */
  private readonly missing = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly fetcher: ImageFetcher,
  ) {}

  private file(r: ImageRequest): string {
    return join(this.dir, 'types', `${r.typeId}-${r.kind}-${r.size}`);
  }

  async get(r: ImageRequest): Promise<ImageResult> {
    const file = this.file(r);
    if (existsSync(file)) {
      const bytes = readFileSync(file);
      return { ok: true, bytes, mime: imageMime(bytes) };
    }
    if (this.missing.has(file)) return { ok: false, status: 404 };
    let p = this.inFlight.get(file);
    if (!p) {
      p = this.download(r, file).finally(() => this.inFlight.delete(file));
      this.inFlight.set(file, p);
    }
    return p;
  }

  private async download(r: ImageRequest, file: string): Promise<ImageResult> {
    let res: Awaited<ReturnType<ImageFetcher>>;
    try {
      res = await this.fetcher(upstreamUrl(r));
    } catch {
      return { ok: false, status: 0 };
    }
    if (res.status === 404) this.missing.add(file);
    if (res.status !== 200 || !res.bytes?.length) return { ok: false, status: res.status };
    try {
      mkdirSync(join(this.dir, 'types'), { recursive: true });
      // Written whole, then renamed: a crash never leaves half an image to serve.
      writeFileSync(`${file}.tmp`, res.bytes);
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.warn('image cache:', err);
    }
    return { ok: true, bytes: res.bytes, mime: imageMime(res.bytes) };
  }
}
