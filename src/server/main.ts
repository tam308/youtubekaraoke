import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { APP_ID, DEFAULT_LOCAL_PORT, HOST_GRACE_MS, PORT_SCAN_RANGE, STARTUP_GRACE_MS } from '../shared/constants';
import type { HostInfo } from '../shared/types';
import { createApp } from './app';
import { loadPlaylistSnapshot } from './assets';
import { findBrowser } from './browser/findBrowser';
import { openDisplay } from './browser/launch';
import { maximizeDisplayWindow } from './browser/windowFit';
import { PopupPlayer } from './browser/popupPlayer';
import { APP_VERSION, IS_DEV, IS_SEA } from './env';
import { Hub } from './hub';
import { readJson, DebouncedWriter } from './jsonStore';
import { initLog, log } from './log';
import { ModeController } from './ModeController';
import { HostAllowlist } from './net/hostCheck';
import { hasFirewallRule, listSecurityProducts } from './net/firewall';
import { listLanAdaptersNow } from './net/lanAddress';
import { resolveDataDir } from './paths';
import { PlaylistService } from './playlists/PlaylistService';
import { EMPTY_QUEUE, QueueManager, type PersistedQueue } from './queue/QueueManager';
import { SettingsStore } from './settings';
import { createSocketServer } from './sockets';
import { fetchPlaylist } from './youtube/fetchPlaylist';
import { SearchService } from './youtube/SearchService';

/** If another copy is already running on one of our ports, ask it to reopen its window. */
async function findRunningInstance(basePort: number): Promise<number | null> {
  for (let port = basePort; port <= basePort + PORT_SCAN_RANGE; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(800) });
      const body = (await res.json()) as { app?: string };
      if (body.app === APP_ID) return port;
    } catch {
      /* nothing (of ours) there */
    }
  }
  return null;
}

function listenLocal(server: http.Server, basePort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = basePort;
    const tryNext = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < basePort + PORT_SCAN_RANGE) {
          port++;
          tryNext();
        } else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        resolve(port);
      });
    };
    tryNext();
  });
}

/**
 * `--smoke-test`: start the packaged app with a throwaway data folder and no browser, check that
 * the server, the embedded web UI and the bundled playlist work, then exit 0 (pass) or 1 (fail).
 * Used by CI to prove the macOS builds really start on a Mac.
 */
const SMOKE_TEST = process.argv.includes('--smoke-test');

async function runSmokeTest(port: number): Promise<boolean> {
  const base = `http://127.0.0.1:${port}`;
  const checks: Array<[string, () => Promise<boolean>]> = [
    ['ping', async () => ((await (await fetch(`${base}/api/ping`)).json()) as { app?: string }).app === APP_ID],
    ['display page', async () => (await (await fetch(`${base}/display`)).text()).includes('id="root"')],
    ['phone page', async () => (await (await fetch(`${base}/`)).text()).includes('id="root"')],
    ['playlists', async () => ((await (await fetch(`${base}/api/playlists`)).json()) as { playlists: unknown[] }).playlists.length > 0],
  ];
  let ok = true;
  for (const [name, check] of checks) {
    const passed = await check().catch(() => false);
    process.stdout.write(`smoke ${passed ? 'PASS' : 'FAIL'}: ${name}\n`);
    ok &&= passed;
  }
  return ok;
}

async function main(): Promise<void> {
  const dataDir = SMOKE_TEST ? fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-smoke-')) : resolveDataDir();
  initLog(dataDir, { console: !IS_SEA });
  log.info(`YouTube Karaoke ${APP_VERSION} starting (${IS_SEA ? 'packaged' : IS_DEV ? 'dev' : 'node'}), data: ${dataDir}`);

  const settings = new SettingsStore(dataDir);

  if (!IS_DEV && !SMOKE_TEST) {
    const running = await findRunningInstance(settings.get().localPort);
    if (running) {
      log.info(`Already running on port ${running}; asking it to reopen the window.`);
      await fetch(`http://127.0.0.1:${running}/api/focus`, { method: 'POST' }).catch(() => undefined);
      return;
    }
  }

  const queueFile = path.join(dataDir, 'queue.json');
  const queue = new QueueManager({ ...EMPTY_QUEUE, ...readJson<Partial<PersistedQueue>>(queueFile, {}) });
  const queueWriter = new DebouncedWriter(queueFile, () => queue.toPersisted());
  queue.on('change', () => queueWriter.schedule());
  let lastPositionSave = 0;
  queue.on('playback', () => {
    if (Date.now() - lastPositionSave > 10_000) {
      lastPositionSave = Date.now();
      queueWriter.schedule();
    }
  });

  const playlists = new PlaylistService({ dataDir, fetcher: fetchPlaylist, snapshot: loadPlaylistSnapshot() });
  const hostToken = IS_DEV ? 'dev' : randomBytes(24).toString('base64url');
  const hub = new Hub(queue, settings, playlists, new SearchService(), dataDir, hostToken);

  const hosts = new HostAllowlist();
  const app = createApp(hub, hosts);
  const server = http.createServer(app);
  const port = await listenLocal(server, IS_DEV ? DEFAULT_LOCAL_PORT : settings.get().localPort);
  hosts.setLocal(port);

  let modes: ModeController;
  const hostInfo = async (): Promise<HostInfo> => ({
    settings: settings.get(),
    adapters: await listLanAdaptersNow(),
    browser: hub.browser ? { name: hub.browser.name, path: hub.browser.path, appMode: hub.browser.appMode } : null,
    dataDir,
    version: APP_VERSION,
    firewallRule: await hasFirewallRule(),
    security: await listSecurityProducts(),
    platform: process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'other',
  });

  // Set when we open a display window; the window is maximised once its page connects.
  let pendingMaximize = false;

  // Songs the in-app player refuses are opened in a youtube.com window (started from the
  // player:error handler). When the queue moves on (skip / next song), close that window.
  const popup = new PopupPlayer(hub);
  queue.on('change', () => {
    if (popup.itemId && popup.itemId !== queue.current()?.id) void popup.stop();
  });
  // Settings that are part of the state everyone sees: re-broadcast when they change.
  let shared = { blockedSongs: settings.get().blockedSongs, volume: settings.get().volume };
  settings.on('change', (s) => {
    if (s.blockedSongs !== shared.blockedSongs || s.volume !== shared.volume) {
      shared = { blockedSongs: s.blockedSongs, volume: s.volume };
      hub.changed();
    }
  });

  // ---- lifecycle: exit when the display window has been closed ------------------
  let shutdownTimer: NodeJS.Timeout | null = null;
  const armShutdown = (ms: number, reason: string) => {
    if (IS_DEV) return;
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => {
      log.info(`Shutting down: ${reason}`);
      hub.emit('exit');
    }, ms);
  };
  armShutdown(STARTUP_GRACE_MS, 'no display window connected after startup');

  const io = createSocketServer({
    server,
    hub,
    hosts,
    getModes: () => modes,
    hostInfo,
    getPopup: () => popup,
    onHostCountChange: (count) => {
      if (count > 0 && pendingMaximize) {
        pendingMaximize = false;
        void maximizeDisplayWindow();
      }
      if (count > 0 && shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      } else if (count === 0) {
        armShutdown(HOST_GRACE_MS, 'display window closed');
      }
    },
  });
  modes = new ModeController(server, io, hosts, hub);

  const displayUrl = `http://127.0.0.1:${port}/display#token=${hostToken}`;
  const launchDisplay = async () => {
    pendingMaximize = true;
    hub.browser = await findBrowser(settings.get().browser);
    openDisplay(hub.browser, displayUrl);
  };
  hub.on('openDisplay', () => void launchDisplay());

  let exiting = false;
  hub.on('exit', async () => {
    if (exiting) return;
    exiting = true;
    popup.dispose();
    queueWriter.flush();
    settings.flush();
    playlists.flush();
    await modes.shutdown().catch(() => undefined);
    io.close();
    server.closeAllConnections();
    log.info('Goodbye');
    setTimeout(() => process.exit(0), 100);
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => hub.emit('exit'));

  if (SMOKE_TEST) {
    const ok = await runSmokeTest(port);
    process.stdout.write(ok ? 'SMOKE OK\n' : 'SMOKE FAILED\n');
    process.exit(ok ? 0 : 1);
  }

  if (settings.get().mode === 'party') {
    await modes.setMode('party').catch((err) => {
      log.warn('Could not restore party mode:', (err as Error).message);
      settings.update({ mode: 'local' });
    });
  }

  if (IS_DEV) {
    log.info(`Dev server ready. Display: ${displayUrl}   Phone (same PC): http://127.0.0.1:${port}/`);
  } else {
    await launchDisplay();
  }

  setTimeout(() => void playlists.refreshStale(), 5_000);
}

process.on('uncaughtException', (err) => log.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err));

main().catch((err) => {
  log.error('Fatal startup error:', err);
  process.exit(1);
});
