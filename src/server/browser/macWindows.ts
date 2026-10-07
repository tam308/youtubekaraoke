import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../log';
import type { FoundBrowser } from './findBrowser';

const execFileAsync = promisify(execFile);

/** AppleScript application names of Chromium browsers (they all share Chrome's scripting dictionary). */
const MAC_SCRIPT_NAMES: Partial<Record<FoundBrowser['id'], string>> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  brave: 'Brave Browser',
  vivaldi: 'Vivaldi',
};

export interface MacWindow {
  id: string;
  url: string;
}

/** Parse "id<TAB>url" lines from the AppleScript below. */
export function parseMacWindowList(out: string): MacWindow[] {
  return out
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 2 && /^\d+$/.test(parts[0]!.trim()))
    .map(([id, ...url]) => ({ id: id!.trim(), url: url.join('\t').trim() }));
}

/** The YouTube video ID a watch URL points at, or null. */
export function videoIdFromUrl(url: string): string | null {
  const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url) ?? /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1]! : null;
}

/**
 * macOS window control for the YouTube pop-up, through AppleScript (`osascript`). The first
 * use makes macOS ask "YouTube Karaoke wants access to control Google Chrome"; if that's
 * declined, every call returns null and the pop-up falls back to the timer only.
 */
export class MacWindows {
  private readonly app: string | null;
  private denied = false;

  constructor(browser: FoundBrowser | null) {
    this.app = process.platform === 'darwin' && browser ? (MAC_SCRIPT_NAMES[browser.id] ?? null) : null;
  }

  get supported(): boolean {
    return !!this.app && !this.denied;
  }

  private async run(script: string): Promise<string | null> {
    if (!this.supported) return null;
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 8000 });
      return stdout;
    } catch (err) {
      const msg = (err as Error).message;
      // -1743: the user declined "control <browser>" in macOS privacy settings.
      if (/-1743|not allowed|Not authorized/i.test(msg)) {
        this.denied = true;
        log.warn(`macOS didn't allow controlling ${this.app}; the YouTube window will only close on its timer.`);
      } else {
        log.warn('AppleScript failed:', msg.split('\n')[0]);
      }
      return null;
    }
  }

  /** Every browser window with the URL of its active tab, or null if unavailable. */
  async list(): Promise<MacWindow[] | null> {
    const out = await this.run(
      `tell application "${this.app}"
        set out to ""
        repeat with w in windows
          set out to out & (id of w as text) & tab & (URL of active tab of w) & linefeed
        end repeat
        return out
      end tell`,
    );
    return out === null ? null : parseMacWindowList(out);
  }

  async close(id: string): Promise<void> {
    if (!/^\d+$/.test(id)) return;
    await this.run(`tell application "${this.app}" to close (every window whose id is ${id})`);
  }
}
