import { APP_NAME } from '../../shared/constants';
import type { PopupState, QueueItem } from '../../shared/types';
import type { Hub } from '../hub';
import { log } from '../log';
import { findBrowser } from './findBrowser';
import { openDisplay } from './launch';
import { MacWindows, videoIdFromUrl } from './macWindows';
import { WinHelper, type WindowInfo } from './winHelper';

/** Extra time after the song's length before the window is closed (page load, short ads). */
const GRACE_MS = 8_000;
const EXTEND_MS = 30_000;
const POLL_MS = 1_000;

const BROWSER_PROCESSES = new Set(['chrome', 'msedge', 'brave', 'vivaldi', 'firefox']);

/**
 * Is this the YouTube pop-up we opened? Strict on purpose: it must belong to a browser process,
 * and app-mode windows show the bare page title, while normal browser tabs end in
 * " - Google Chrome" / " - Microsoft Edge" etc. Other programs never match.
 */
export function isYouTubePopup(w: WindowInfo): boolean {
  if (!BROWSER_PROCESSES.has(w.process) || w.title === APP_NAME) return false;
  if (/ - (Google Chrome|Microsoft.?Edge|Brave|Vivaldi|Mozilla Firefox)$/i.test(w.title)) return false;
  const t = w.title.replace(/^\(\d+\)\s*/, '');
  return t === 'YouTube' || / - YouTube$/.test(t) || /^(https?:\/\/)?(www\.)?youtube\.com\//i.test(t);
}

/** "(3) Song title - YouTube" -> "Song title"; null while the page is still loading. */
export function loadedVideoTitle(raw: string): string | null {
  const m = /^(?:\(\d+\)\s*)?(.+) - YouTube$/.exec(raw.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Plays songs whose owners block playback outside youtube.com in a pop-up youtube.com window
 * (allowed, and the user's own browser + ad blocker). On Windows the window is found, made
 * fullscreen (YouTube's F shortcut) and closed when the song ends: whichever comes first of
 * the song's length + grace, YouTube autoplaying another video (window title changes), or the
 * user closing it. On macOS the same is done through AppleScript (find the window by the video
 * in its URL, close it, notice it was closed); if macOS doesn't allow that, the timer still
 * moves the queue on.
 */
export class PopupPlayer {
  private readonly win = new WinHelper();
  private mac: MacWindows | null = null;
  private active: {
    item: QueueItem;
    hwnd: string | null;
    /** macOS: AppleScript window id, and the window ids that existed before opening. */
    macId: string | null;
    macBefore: Set<string>;
    startedAt: number;
    openedAt: number;
    endsAt: number;
    loadedTitle: string | null;
    loadedAt: number;
    fullscreenDone: boolean;
    fullscreenTries: number;
    timer: NodeJS.Timeout;
  } | null = null;
  private busy = false;
  private startingId: string | null = null;

  constructor(private readonly hub: Hub) {}

  get itemId(): string | null {
    return this.active?.item.id ?? null;
  }

  async start(item: QueueItem, startSec = 0): Promise<void> {
    // Guard synchronously: two callers at once must not open two windows.
    if (this.active?.item.id === item.id || this.startingId === item.id) return;
    this.startingId = item.id;
    try {
      await this.open(item, startSec);
    } finally {
      this.startingId = null;
    }
  }

  private async open(item: QueueItem, startSec: number): Promise<void> {
    await this.stop();

    const before = new Set(((await this.win.list()) ?? []).map((w) => w.hwnd));
    const browser = this.hub.browser ?? (await findBrowser(this.hub.settings.get().browser));
    if (process.platform === 'darwin') this.mac ??= new MacWindows(browser);
    const macBefore = new Set(((await this.mac?.list()) ?? []).map((w) => w.id));
    const url = `https://www.youtube.com/watch?v=${item.videoId}${startSec > 0 ? `&t=${Math.floor(startSec)}s` : ''}`;
    openDisplay(browser, url);

    const now = Date.now();
    const lengthMs = Math.max(30, item.durationSec - startSec) * 1000;
    this.active = {
      item,
      hwnd: null,
      macId: null,
      macBefore,
      startedAt: now - startSec * 1000,
      openedAt: now,
      endsAt: now + lengthMs + GRACE_MS,
      loadedTitle: null,
      loadedAt: 0,
      fullscreenDone: false,
      fullscreenTries: 0,
      timer: setInterval(() => void this.tick(before), POLL_MS),
    };
    log.info(`Pop-up playback for ${item.videoId} ("${item.title}"), closes in ${Math.round((lengthMs + GRACE_MS) / 1000)} s`);
    this.publish();
  }

  /** Add time (e.g. the song was paused). */
  extend(): void {
    if (!this.active) return;
    this.active.endsAt += EXTEND_MS;
    this.publish();
  }

  /** Close the pop-up without advancing the queue (skip, mode change, exit). */
  async stop(): Promise<void> {
    const a = this.active;
    if (!a) return;
    this.active = null;
    clearInterval(a.timer);
    if (a.hwnd) await this.win.close(a.hwnd);
    if (a.macId) await this.mac?.close(a.macId);
    this.publish();
  }

  dispose(): void {
    void this.stop().finally(() => this.win.dispose());
  }

  private publish(): void {
    const a = this.active;
    const controllable = this.win.supported || !!this.mac?.supported;
    const state: PopupState | null = a ? { itemId: a.item.id, endsAt: a.endsAt, windowFound: !!a.hwnd || !!a.macId || !controllable } : null;
    this.hub.setPopup(state);
  }

  private async finish(reason: string): Promise<void> {
    const a = this.active;
    if (!a) return;
    log.info(`Pop-up playback finished (${reason})`);
    this.active = null;
    clearInterval(a.timer);
    if (a.hwnd) await this.win.close(a.hwnd);
    if (a.macId) await this.mac?.close(a.macId);
    // Next song first, then "pop-up over": otherwise the display briefly sees the blocked song
    // without a pop-up and tries it in the embedded player again.
    this.hub.queue.ended(a.item.id);
    this.publish();
  }

  private async tick(before: Set<string>): Promise<void> {
    const a = this.active;
    if (!a || this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      // Keep phones' progress bars moving.
      this.hub.queue.progress(a.item.id, Math.min(a.item.durationSec, (now - a.startedAt) / 1000), 'playing');

      if (this.win.supported) {
        if (!a.hwnd) {
          const found = (await this.win.list())?.find((w) => !before.has(w.hwnd) && isYouTubePopup(w));
          if (found) {
            a.hwnd = found.hwnd;
            this.publish();
          }
        } else {
          const t = await this.win.title(a.hwnd);
          if (t && !t.open) return void (await this.finish('window closed'));
          if (t) {
            const title = loadedVideoTitle(t.title);
            if (!a.loadedTitle && title) {
              a.loadedTitle = title;
              a.loadedAt = now;
            } else if (a.loadedTitle && title && title !== a.loadedTitle && now - a.loadedAt > 5000) {
              // A different video's title: YouTube autoplayed the next one, so this song is over.
              return void (await this.finish('YouTube moved on to another video'));
            }
            // Once the video page has loaded, give the player a moment, then go fullscreen.
            // Retried a few times: Windows only lets a window come to the front in some situations.
            if (a.loadedTitle && !a.fullscreenDone && now - a.openedAt > 3500 + a.fullscreenTries * 2000) {
              a.fullscreenTries++;
              const r = await this.win.fullscreen(a.hwnd);
              a.fullscreenDone = r === 'ok' || r === 'gone' || a.fullscreenTries >= 3;
              log.info(`Pop-up fullscreen (try ${a.fullscreenTries}): ${r}`);
            }
          }
        }
      }
      if (this.mac?.supported) await this.tickMac(a, now);
      if (this.active === a && now >= a.endsAt) await this.finish('song length reached');
    } finally {
      this.busy = false;
    }
  }

  /** macOS: find our window by the video in its URL, then watch it like on Windows. */
  private async tickMac(a: NonNullable<PopupPlayer['active']>, now: number): Promise<void> {
    const windows = await this.mac!.list();
    if (!windows) return;
    if (!a.macId) {
      const found = windows.find((w) => !a.macBefore.has(w.id) && videoIdFromUrl(w.url) === a.item.videoId);
      if (found) {
        a.macId = found.id;
        a.loadedAt = now;
        this.publish();
      }
      return;
    }
    const w = windows.find((x) => x.id === a.macId);
    if (!w) return void (await this.finish('window closed'));
    const vid = videoIdFromUrl(w.url);
    // A different video in our window: YouTube autoplayed the next one, so this song is over.
    if (vid && vid !== a.item.videoId && now - a.loadedAt > 5000) await this.finish('YouTube moved on to another video');
  }
}
