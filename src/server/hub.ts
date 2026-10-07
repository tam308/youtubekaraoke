import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { KaraokeState, Mode, Playback, PopupState, Role, Toast } from '../shared/types';
import type { QueueManager } from './queue/QueueManager';
import type { SettingsStore } from './settings';
import type { PlaylistService } from './playlists/PlaylistService';
import type { SearchService } from './youtube/SearchService';
import type { FoundBrowser } from './browser/findBrowser';

interface HubEvents {
  state: [KaraokeState];
  playback: [Playback];
  toast: [Toast, Role | 'all'];
  playlistsChanged: [];
  settingsChanged: [];
  exit: [];
  openDisplay: [];
}

/** Shared application context: composes queue + mode into the broadcast state. */
export class Hub extends EventEmitter<HubEvents> {
  mode: Mode = 'local';
  joinUrl: string | null = null;
  browser: FoundBrowser | null = null;
  popup: PopupState | null = null;
  private version = 0;

  constructor(
    readonly queue: QueueManager,
    readonly settings: SettingsStore,
    readonly playlists: PlaylistService,
    readonly search: SearchService,
    readonly dataDir: string,
    readonly hostToken: string,
  ) {
    super();
    queue.on('change', () => this.changed());
    queue.on('playback', (p) => this.emit('playback', p));
    playlists.on('change', () => this.emit('playlistsChanged'));
    settings.on('change', () => this.emit('settingsChanged'));
  }

  state(): KaraokeState {
    return {
      version: this.version,
      mode: this.mode,
      joinUrl: this.joinUrl,
      blockedSongs: this.settings.get().blockedSongs,
      volume: this.settings.get().volume,
      popup: this.popup,
      ...this.queue.snapshot(),
    };
  }

  changed(): void {
    this.version++;
    this.emit('state', this.state());
  }

  setMode(mode: Mode, joinUrl: string | null): void {
    this.mode = mode;
    this.joinUrl = joinUrl;
    this.changed();
  }

  setPopup(popup: PopupState | null): void {
    this.popup = popup;
    this.changed();
  }

  toast(message: string, kind: Toast['kind'] = 'info', audience: Role | 'all' = 'all'): void {
    this.emit('toast', { id: randomUUID(), kind, message }, audience);
  }
}
