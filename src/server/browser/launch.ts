import { spawn } from 'node:child_process';
import { log } from '../log';
import type { FoundBrowser } from './findBrowser';

/**
 * Open the display. Uses the user's normal browser profile on purpose (no --user-data-dir),
 * so their extensions, including any ad blocker, apply to the YouTube player.
 */
export function openDisplay(browser: FoundBrowser, url: string): void {
  try {
    if (browser.path && browser.appMode) {
      // The page itself resizes the window to a large centred window on first open.
      spawn(browser.path, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
    } else if (browser.path && browser.id === 'firefox') {
      spawn(browser.path, ['-new-window', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (browser.path) {
      spawn(browser.path, [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    log.info(`Opened display with ${browser.name}${browser.appMode ? ' (app mode)' : ''}`);
  } catch (err) {
    log.error('Failed to open the display window:', err);
  }
}
