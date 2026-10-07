import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DEFAULT_LAN_PORT, DEFAULT_LOCAL_PORT } from '../shared/constants';
import type { Settings } from '../shared/types';
import { DebouncedWriter, readJson } from './jsonStore';

export const DEFAULT_SETTINGS: Settings = {
  localPort: DEFAULT_LOCAL_PORT,
  lanPort: DEFAULT_LAN_PORT,
  lanAddress: null,
  browser: 'auto',
  splitRatio: 1 / 3,
  controlPaneCollapsed: false,
  volume: 80,
  showCornerQr: true,
  showUpNext: true,
  endCurtainSec: 10,
  blockedSongs: 'popup',
  mode: 'local',
};

export class SettingsStore extends EventEmitter<{ change: [Settings] }> {
  private current: Settings;
  private readonly writer: DebouncedWriter;

  constructor(dataDir: string) {
    super();
    const file = path.join(dataDir, 'settings.json');
    this.current = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(file, {}) };
    this.writer = new DebouncedWriter(file, () => this.current);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch };
    this.writer.schedule();
    this.emit('change', this.current);
    return this.current;
  }

  flush(): void {
    this.writer.flush();
  }
}
