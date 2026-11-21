import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Context, Next } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

/** Paths the API owns; never answered with the web app. */
const API_PATHS = /^\/(api|health)(\/|$)/;

async function fileAt(path: string): Promise<Buffer | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * Serves the built web app (Vite `dist/`) from the API in production, so the web, `/api`,
 * `/api/auth` and Socket.IO share one origin (AD-12). Unknown non-API GETs get `index.html`
 * (SPA fallback, e.g. `/f/<token>` links). Hashed `/assets/*` files are cached for a year.
 */
export function serveWeb(webDir: string) {
  const root = resolve(webDir);
  let index: Buffer | undefined;
  return async (c: Context, next: Next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || API_PATHS.test(c.req.path)) return next();
    let pathname: string;
    try {
      pathname = decodeURIComponent(c.req.path);
    } catch {
      return next();
    }
    const target = normalize(join(root, pathname));
    if (target !== root && !target.startsWith(root + sep)) return next();
    const file = pathname.endsWith('/') ? undefined : await fileAt(target);
    if (file) {
      const immutable = pathname.startsWith('/assets/');
      return c.body(new Uint8Array(file), 200, {
        'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      });
    }
    // A missing file with an extension is a real 404, not a page.
    if (extname(pathname) && !pathname.endsWith('.html')) return next();
    index ??= await fileAt(join(root, 'index.html'));
    if (!index) return next();
    return c.body(new Uint8Array(index), 200, { 'Content-Type': TYPES['.html']!, 'Cache-Control': 'no-cache' });
  };
}
