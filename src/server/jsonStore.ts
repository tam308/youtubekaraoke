import fs from 'node:fs';
import path from 'node:path';
import { log } from './log';

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Could not read ${path.basename(file)}, using defaults:`, (err as Error).message);
    }
    return fallback;
  }
}

/** Write to a temp file then rename, so a crash never leaves a half-written file. */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** Debounced writer: call `schedule()` freely, `flush()` on shutdown. */
export class DebouncedWriter {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: string,
    private readonly getData: () => unknown,
    private readonly delayMs = 500,
  ) {}

  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      writeJsonAtomic(this.file, this.getData());
    } catch (err) {
      log.error(`Failed to save ${path.basename(this.file)}:`, err);
    }
  }
}
