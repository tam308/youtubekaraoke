import fs from 'node:fs';
import path from 'node:path';
import sea from 'node:sea';
import type { Request, Response, NextFunction } from 'express';
import { IS_DEV, IS_SEA } from './env';
import { log } from './log';
import type { PlaylistSnapshot } from './playlists/PlaylistService';

const VITE_DEV_URL = 'http://127.0.0.1:5173';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Folder holding the built web UI when running `node out/server.cjs` (not packaged). */
function diskRoot(): string {
  return path.join(__dirname, 'web');
}

function readAsset(rel: string): Buffer | null {
  if (rel.includes('..')) return null;
  try {
    if (IS_SEA) return Buffer.from(sea.getAsset(`web/${rel}`));
    return fs.readFileSync(path.join(diskRoot(), rel));
  } catch {
    return null;
  }
}

/** Page routes → HTML entry files. */
function routeToFile(urlPath: string): string {
  if (urlPath === '/' || urlPath === '/index.html') return 'index.html';
  if (urlPath === '/display' || urlPath === '/display/' || urlPath === '/display.html') return 'display.html';
  return urlPath.replace(/^\/+/, '');
}

// Inline scripts are not used by the production build; YouTube's player script and iframe are allowed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "img-src 'self' data: https://i.ytimg.com https://*.ytimg.com https://*.ggpht.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: wss:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/** Express handler serving the web UI from the exe, from disk, or (dev) from the Vite dev server. */
export function staticHandler() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const file = routeToFile(req.path);
    const isHtml = file.endsWith('.html');

    // YouTube's embed refuses to play without a Referer, so make sure one is always sent.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (IS_DEV) return proxyToVite(req, res, file);

    const body = readAsset(file);
    if (!body) return next();
    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    if (isHtml) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Security-Policy', CSP);
    } else if (file.startsWith('assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.end(body);
  };
}

async function proxyToVite(req: Request, res: Response, file: string): Promise<void> {
  const target = file.endsWith('.html') ? `/${file}` : req.originalUrl;
  try {
    const upstream = await fetch(VITE_DEV_URL + target, { headers: { accept: req.headers.accept ?? '*/*' } });
    res.status(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).type('text/plain').end('Vite dev server is not running. Start it with `npm run dev`.');
  }
}

/** Playlist snapshot embedded at build time (null in dev unless one was built). */
export function loadPlaylistSnapshot(): PlaylistSnapshot | null {
  try {
    const raw = IS_SEA
      ? sea.getAsset('playlists-snapshot.json', 'utf8')
      : fs.readFileSync(IS_DEV ? path.join(process.cwd(), 'out', 'playlists-snapshot.json') : path.join(__dirname, 'playlists-snapshot.json'), 'utf8');
    const snap = JSON.parse(raw) as PlaylistSnapshot;
    log.info(`Loaded playlist snapshot (${snap.playlists.length} playlists)`);
    return snap;
  } catch {
    return null;
  }
}
