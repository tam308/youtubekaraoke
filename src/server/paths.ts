import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_SEA } from './env';

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where queue, settings, playlists and logs are stored.
 * Packaged (Windows): `KaraokeData/` next to the .exe (portable), falling back to %APPDATA%.
 * Packaged (macOS): ~/Library/Application Support/YouTube Karaoke.
 * Dev: `KaraokeData/` in the project folder.
 */
export function resolveDataDir(): string {
  // macOS: an app bundle must not be written to (it breaks the code signature, and downloaded
  // apps may run from a read-only translocated copy), so data goes to Application Support.
  if (IS_SEA && process.platform === 'darwin') {
    const dir = path.join(os.homedir(), 'Library', 'Application Support', 'YouTube Karaoke');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const primary = IS_SEA
    ? path.join(path.dirname(process.execPath), 'KaraokeData')
    : path.join(process.cwd(), 'KaraokeData');
  if (isWritableDir(primary)) return primary;

  const appData = process.env.APPDATA ?? path.join(os.homedir(), '.config');
  const fallback = path.join(appData, 'YouTubeKaraoke');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}
