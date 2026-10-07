import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BrowserChoice } from '../../shared/types';

const execFileAsync = promisify(execFile);

export type BrowserId = 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'firefox';

export interface FoundBrowser {
  id: BrowserId | 'system';
  name: string;
  /** Executable path; null means "let Windows open the URL with the default handler". */
  path: string | null;
  /** Whether `--app=URL` (borderless app window) is supported. */
  appMode: boolean;
}

const NAMES: Record<BrowserId, string> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  brave: 'Brave',
  vivaldi: 'Vivaldi',
  firefox: 'Firefox',
};

const EXE: Record<BrowserId, string> = {
  chrome: 'chrome.exe',
  edge: 'msedge.exe',
  brave: 'brave.exe',
  vivaldi: 'vivaldi.exe',
  firefox: 'firefox.exe',
};

function candidatePaths(id: BrowserId): string[] {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const rel: Record<BrowserId, string[]> = {
    chrome: ['Google\\Chrome\\Application\\chrome.exe'],
    edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
    brave: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    vivaldi: ['Vivaldi\\Application\\vivaldi.exe'],
    firefox: ['Mozilla Firefox\\firefox.exe'],
  };
  return [pf, pf86, local].filter(Boolean).flatMap((base) => rel[id].map((r) => path.join(base, r)));
}

async function regQuery(key: string, value?: string): Promise<string | null> {
  try {
    const args = ['query', key, ...(value ? ['/v', value] : ['/ve'])];
    const { stdout } = await execFileAsync('reg', args, { windowsHide: true, timeout: 5000 });
    const m = stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)\s*$/m);
    return m ? m[1]!.trim().replace(/^"|"$/g, '') : null;
  } catch {
    return null;
  }
}

async function locateWindows(id: BrowserId): Promise<string | null> {
  for (const hive of ['HKCU', 'HKLM']) {
    const p = await regQuery(`${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${EXE[id]}`);
    if (p && fs.existsSync(p)) return p;
  }
  return candidatePaths(id).find((p) => fs.existsSync(p)) ?? null;
}

/** Which browser handles http:// links for the current user (Windows registry). */
async function detectDefaultWindows(): Promise<BrowserId | null> {
  const progId = await regQuery(
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
    'ProgId',
  );
  if (!progId) return null;
  if (/^ChromeHTML/i.test(progId)) return 'chrome';
  if (/^MSEdgeHTM/i.test(progId)) return 'edge';
  if (/^BraveHTML/i.test(progId)) return 'brave';
  if (/^VivaldiHTM/i.test(progId)) return 'vivaldi';
  if (/^FirefoxURL/i.test(progId)) return 'firefox';
  return null;
}

// ---- macOS ----------------------------------------------------------------------

const MAC_APPS: Record<BrowserId, { bundleId: string; app: string; exe: string }> = {
  chrome: { bundleId: 'com.google.chrome', app: 'Google Chrome.app', exe: 'Google Chrome' },
  edge: { bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge.app', exe: 'Microsoft Edge' },
  brave: { bundleId: 'com.brave.browser', app: 'Brave Browser.app', exe: 'Brave Browser' },
  vivaldi: { bundleId: 'com.vivaldi.vivaldi', app: 'Vivaldi.app', exe: 'Vivaldi' },
  firefox: { bundleId: 'org.mozilla.firefox', app: 'Firefox.app', exe: 'firefox' },
};

function locateMac(id: BrowserId): string | null {
  const { app, exe } = MAC_APPS[id];
  for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    const p = path.join(base, app, 'Contents', 'MacOS', exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Default browser from LaunchServices (Safari or unknown returns null: no app mode there). */
async function detectDefaultMac(): Promise<BrowserId | null> {
  const plist = path.join(os.homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist');
  try {
    const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', plist], { timeout: 5000 });
    const handlers = (JSON.parse(stdout) as { LSHandlers?: Array<{ LSHandlerURLScheme?: string; LSHandlerRoleAll?: string }> }).LSHandlers ?? [];
    const bundleId = handlers.find((h) => h.LSHandlerURLScheme === 'http')?.LSHandlerRoleAll?.toLowerCase();
    const match = (Object.keys(MAC_APPS) as BrowserId[]).find((id) => MAC_APPS[id].bundleId === bundleId);
    return match ?? null;
  } catch {
    return null;
  }
}

async function locate(id: BrowserId): Promise<string | null> {
  return process.platform === 'darwin' ? locateMac(id) : locateWindows(id);
}

/** Which browser handles http:// links for the current user. */
export async function detectDefaultBrowser(): Promise<BrowserId | null> {
  if (process.platform === 'darwin') return detectDefaultMac();
  if (process.platform === 'win32') return detectDefaultWindows();
  return null;
}

function found(id: BrowserId, p: string): FoundBrowser {
  return { id, name: NAMES[id], path: p, appMode: id !== 'firefox' };
}

/**
 * Pick the browser for the display window. "auto": the default browser if it supports
 * app mode, else Chrome, else Edge (always present on Windows), else the default browser as a tab
 * (e.g. Safari on a Mac, which has no app mode).
 */
export async function findBrowser(choice: BrowserChoice): Promise<FoundBrowser> {
  const system: FoundBrowser = { id: 'system', name: 'Default browser', path: null, appMode: false };
  if (process.platform !== 'win32' && process.platform !== 'darwin') return system;

  if (choice === 'default') {
    const def = await detectDefaultBrowser();
    const p = def ? await locate(def) : null;
    return def && p ? { ...found(def, p), appMode: false } : system;
  }
  if (choice !== 'auto') {
    const p = await locate(choice);
    if (p) return found(choice, p);
  }

  const def = await detectDefaultBrowser();
  if (def) {
    const p = await locate(def);
    // Firefox users keep their own browser (and its ad blocker), just without app mode.
    if (p) return found(def, p);
  }
  for (const id of ['chrome', 'edge', 'brave'] as const) {
    const p = await locate(id);
    if (p) return found(id, p);
  }
  return system;
}
