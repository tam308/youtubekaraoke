import express from 'express';
import QRCode from 'qrcode';
import { APP_ID, LIMITS, RATE_LIMITS } from '../shared/constants';
import { staticHandler } from './assets';
import { APP_VERSION } from './env';
import type { Hub } from './hub';
import { log } from './log';
import type { HostAllowlist } from './net/hostCheck';
import { RateLimiter } from './net/rateLimit';
import { SearchUnavailableError } from './youtube/SearchService';

export function createApp(hub: Hub, hosts: HostAllowlist) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  const limiter = new RateLimiter();

  // Only our exact Host values are served (blocks DNS-rebinding attacks from other websites).
  app.use((req, res, next) => {
    if (!hosts.isAllowedHost(req.headers.host)) {
      res.status(421).type('text/plain').end('Misdirected request');
      return;
    }
    next();
  });

  app.get('/api/ping', (_req, res) => {
    res.json({ app: APP_ID, version: APP_VERSION });
  });

  // A second launch of the exe asks the running instance to reopen its window.
  // Browsers always send Origin on POST, so web pages cannot trigger this.
  app.post('/api/focus', (req, res) => {
    if (req.headers.origin) {
      res.status(403).end();
      return;
    }
    hub.emit('openDisplay');
    res.json({ ok: true });
  });

  app.get('/api/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || q.length > LIMITS.maxSearchQueryLength) {
      res.status(400).json({ error: 'Type something to search for.' });
      return;
    }
    const [max, windowMs] = RATE_LIMITS.search;
    if (!limiter.allow(`search:${req.socket.remoteAddress}`, max, windowMs)) {
      res.status(429).json({ error: 'Too many searches. Wait a moment.' });
      return;
    }
    try {
      const result = await hub.search.search(q, { karaoke: req.query.karaoke === '1' });
      res.json(result);
    } catch (err) {
      if (!(err instanceof SearchUnavailableError)) log.error('Search failed:', err);
      res.status(503).json({ error: 'Search is temporarily unavailable. Check your internet connection, or check for an app update.' });
    }
  });

  app.get('/api/playlists', (_req, res) => {
    res.json({ playlists: hub.playlists.list() });
  });

  app.get('/api/playlists/:id', (req, res) => {
    const detail = hub.playlists.get(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Playlist not found.' });
      return;
    }
    res.json(detail);
  });

  app.get('/api/qr.svg', async (_req, res) => {
    if (!hub.joinUrl) {
      res.status(404).end();
      return;
    }
    const svg = await QRCode.toString(hub.joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').setHeader('Cache-Control', 'no-cache');
    res.end(svg);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(staticHandler());

  app.use((_req, res) => {
    res.status(404).type('text/plain').end('Not found');
  });

  return app;
}
