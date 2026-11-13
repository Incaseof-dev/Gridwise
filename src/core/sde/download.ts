/** Official SDE endpoints (docs/sde.md). */
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE = 'https://developers.eveonline.com/static-data';
export const SDE_LATEST_INFO_URL = `${BASE}/tranquility/latest.jsonl`;
export const SDE_LATEST_ZIP_URL = `${BASE}/eve-online-static-data-latest-jsonl.zip`;

export interface SdeBuildInfo {
  buildNumber: number;
  releaseDate: string;
}

export async function fetchLatestSdeInfo(signal?: AbortSignal): Promise<SdeBuildInfo> {
  const res = await fetch(SDE_LATEST_INFO_URL, { signal: signal ?? null });
  if (!res.ok) throw new Error(`SDE info request failed: HTTP ${res.status}`);
  const row = JSON.parse((await res.text()).trim().split('\n')[0]!) as Partial<SdeBuildInfo>;
  if (typeof row.buildNumber !== 'number') throw new Error('SDE info has no buildNumber');
  return { buildNumber: row.buildNumber, releaseDate: String(row.releaseDate ?? '') };
}

/** Downloads the zip of the given build (or the latest) to `dest`, via a temp file. */
export async function downloadSdeZip(
  dest: string,
  opts: {
    buildNumber?: number;
    signal?: AbortSignal;
    onProgress?: (received: number, total: number | null) => void;
  } = {},
): Promise<void> {
  const url = opts.buildNumber
    ? `${BASE}/tranquility/eve-online-static-data-${opts.buildNumber}-jsonl.zip`
    : SDE_LATEST_ZIP_URL;
  const res = await fetch(url, { signal: opts.signal ?? null });
  if (!res.ok || !res.body) throw new Error(`SDE download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  let received = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    opts.onProgress?.(received, total);
  });
  const tmp = `${dest}.part`;
  try {
    await pipeline(body, createWriteStream(tmp));
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
