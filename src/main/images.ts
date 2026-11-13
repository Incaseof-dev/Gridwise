/** The `eveimg://` protocol over the local image cache (core/imageCache). */
import { net, protocol } from 'electron';
import { join } from 'node:path';
import { IMAGE_SCHEME, ImageCache, parseImageUrl } from '../core/imageCache';
import { cacheDir } from '../core/paths';

/** Before app ready: the scheme must be known to Chromium as a secure, standard one for <img> and the CSP. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }]);
}

export function serveImages(): void {
  const cache = new ImageCache(join(cacheDir(), 'images'), async (url) => {
    const res = await net.fetch(url);
    return { status: res.status, bytes: res.ok ? new Uint8Array(await res.arrayBuffer()) : null };
  });
  protocol.handle(IMAGE_SCHEME, async (req) => {
    const r = parseImageUrl(req.url);
    if (!r) return new Response(null, { status: 400 });
    const img = await cache.get(r);
    if (!img.ok) return new Response(null, { status: img.status || 504 });
    return new Response(img.bytes, { headers: { 'content-type': img.mime, 'cache-control': 'max-age=86400' } });
  });
}
