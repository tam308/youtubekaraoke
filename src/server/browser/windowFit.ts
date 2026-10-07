import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_NAME } from '../../shared/constants';
import { log } from '../log';

const execFileAsync = promisify(execFile);

// Win32 via PowerShell: find the browser's app window by its exact title (normal browser tabs
// get a " - Google Chrome" suffix, so they never match) and maximise it. Chrome ignores launch
// flags when it's already running, ignores window.resizeTo for app windows, and reuses its
// remembered placement (often half the screen), so this has to happen from outside.
const CSHARP = `
using System; using System.Runtime.InteropServices; using System.Text;
public static class KaraokeWindow {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  public static int Maximize(string title) {
    int n = 0;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      if (sb.ToString() != title) return true;
      ShowWindow(h, 3); // SW_MAXIMIZE
      SetForegroundWindow(h);
      n++;
      return true;
    }, IntPtr.Zero);
    return n;
  }
}`;

async function maximizeOnce(): Promise<number> {
  const script = `Add-Type -TypeDefinition @'\n${CSHARP}\n'@\n[KaraokeWindow]::Maximize('${APP_NAME.replace(/'/g, "''")}')`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 20_000,
  });
  return Number(stdout.trim()) || 0;
}

/**
 * Maximise the display window (fills the screen, taskbar still visible; F still toggles real
 * fullscreen). Retries briefly in case the browser hasn't finished creating the window.
 */
export async function maximizeDisplayWindow(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if ((await maximizeOnce()) > 0) {
        log.info('Display window maximised');
        return true;
      }
    } catch (err) {
      log.warn('Could not maximise the display window:', (err as Error).message.split('\n')[0]);
      return false;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log.warn('Display window not found to maximise');
  return false;
}
