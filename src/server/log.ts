import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

let logFile: string | null = null;
let toConsole = true;

/**
 * Packaged builds have no console window, so everything goes to
 * `KaraokeData/logs/app.log` (rotated at 1 MB, 3 files kept).
 */
export function initLog(dataDir: string, opts: { console: boolean }): void {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'app.log');
  toConsole = opts.console;
  rotateIfNeeded();
}

function rotateIfNeeded(): void {
  if (!logFile) return;
  try {
    if (fs.statSync(logFile).size < MAX_BYTES) return;
  } catch {
    return;
  }
  for (let i = KEEP - 1; i >= 1; i--) {
    const from = i === 1 ? logFile : `${logFile}.${i - 1}`;
    try {
      fs.renameSync(from, `${logFile}.${i}`);
    } catch {
      /* missing file is fine */
    }
  }
}

function write(level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${format(...args)}`;
  if (toConsole) {
    (level === 'ERROR' ? console.error : console.log)(line);
  }
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n');
    } catch {
      /* never crash because of logging */
    }
  }
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
};
