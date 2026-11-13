import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageCache, imageMime, parseImageUrl, upstreamUrl, type ImageFetcher } from './imageCache';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function fetcher(answers: Record<string, { status: number; bytes: Uint8Array | null }>) {
  const calls: string[] = [];
  const f: ImageFetcher = async (url) => {
    calls.push(url);
    return answers[url] ?? { status: 404, bytes: null };
  };
  return { f, calls };
}

describe('image cache', () => {
  it('parses only its own type image URLs', () => {
    expect(parseImageUrl('eveimg://types/603/render?size=64')).toEqual({ typeId: 603, kind: 'render', size: 64 });
    expect(parseImageUrl('eveimg://types/603/icon')).toEqual({ typeId: 603, kind: 'icon', size: 64 });
    expect(parseImageUrl('eveimg://types/603/render?size=63')).toBeNull();
    expect(parseImageUrl('eveimg://types/../etc/passwd')).toBeNull();
    expect(parseImageUrl('eveimg://types/603/bp')).toBeNull();
    expect(parseImageUrl('https://types/603/render')).toBeNull();
    expect(upstreamUrl({ typeId: 603, kind: 'render', size: 64 })).toBe(
      'https://images.evetech.net/types/603/render?size=64',
    );
    expect(imageMime(JPEG)).toBe('image/jpeg');
    expect(imageMime(PNG)).toBe('image/png');
  });

  it('fetches an image once, also when asked twice at the same time, then serves it from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eveimg-'));
    const { f, calls } = fetcher({
      'https://images.evetech.net/types/603/render?size=64': { status: 200, bytes: JPEG },
    });
    const r = { typeId: 603, kind: 'render', size: 64 };
    const cache = new ImageCache(dir, f);
    const [a, b] = await Promise.all([cache.get(r), cache.get(r)]);
    expect(a).toMatchObject({ ok: true, mime: 'image/jpeg' });
    expect(b).toMatchObject({ ok: true });
    // A new session (app restart) reads the file.
    expect(await new ImageCache(dir, f).get(r)).toMatchObject({ ok: true, mime: 'image/jpeg' });
    expect(calls).toHaveLength(1);
    expect(readdirSync(join(dir, 'types'))).toEqual(['603-render-64']);
  });

  it('asks once per session for a type without an image, and keeps nothing when offline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eveimg-'));
    const { f, calls } = fetcher({});
    const cache = new ImageCache(dir, f);
    const r = { typeId: 1, kind: 'render', size: 64 };
    expect(await cache.get(r)).toEqual({ ok: false, status: 404 });
    expect(await cache.get(r)).toEqual({ ok: false, status: 404 });
    expect(calls).toHaveLength(1);
    const offline = new ImageCache(dir, async () => {
      throw new Error('ENOTFOUND');
    });
    expect(await offline.get({ typeId: 603, kind: 'render', size: 64 })).toEqual({ ok: false, status: 0 });
    expect(existsSync(join(dir, 'types'))).toBe(false);
  });
});
