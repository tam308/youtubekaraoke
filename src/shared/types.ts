/** A YouTube video as returned by search or a playlist. */
export interface Video {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
}

export interface QueueItem extends Video {
  /** Unique per queue entry (the same video can be queued twice). */
  id: string;
  addedBy: string;
  addedAt: number;
}

export type Mode = 'party' | 'local';
export type Role = 'host' | 'guest';

export interface Playback {
  status: 'idle' | 'playing' | 'paused' | 'buffering';
  positionSec: number;
  /** Queue item the position refers to. */
  itemId: string | null;
}

/** A song playing in a youtube.com pop-up window because its owner blocks embedding. */
export interface PopupState {
  itemId: string;
  /** When the pop-up will be closed and the queue moves on (epoch ms). */
  endsAt: number;
  /** Whether the app found the window (and can make it fullscreen / close it). */
  windowFound: boolean;
}

export type BlockedSongsPolicy = 'popup' | 'skip';

export interface KaraokeState {
  version: number;
  mode: Mode;
  /** Phone join URL while in party mode. */
  joinUrl: string | null;
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  /** Most recent first. */
  history: QueueItem[];
  /** What happens when the in-app player refuses a song: open it in a YouTube window, or skip it. */
  blockedSongs: BlockedSongsPolicy;
  popup: PopupState | null;
  /** Main screen volume, 0-100 (phones can change it). */
  volume: number;
  playback: Playback;
}

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  customName: string | null;
  author: string | null;
  builtIn: boolean;
  itemCount: number;
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
}

export interface PlaylistDetail extends PlaylistSummary {
  items: Video[];
}

export interface PlaylistPreview {
  id: string;
  title: string;
  author: string | null;
  itemCount: number;
}

export type BrowserChoice = 'auto' | 'chrome' | 'edge' | 'brave' | 'default';

export interface Settings {
  localPort: number;
  lanPort: number;
  /** IPv4 address of the adapter to use for party mode, or null for automatic. */
  lanAddress: string | null;
  browser: BrowserChoice;
  /** Fraction of the window width used by the control pane in local mode. */
  splitRatio: number;
  controlPaneCollapsed: boolean;
  volume: number;
  showCornerQr: boolean;
  showUpNext: boolean;
  /**
   * Cover the video with an "Up next" card for the last N seconds of each song, hiding
   * YouTube's end-screen suggestions (0 = off). Audio keeps playing underneath.
   */
  endCurtainSec: number;
  /** Songs whose owners block playback outside youtube.com: play them in a pop-up, or skip them. */
  blockedSongs: BlockedSongsPolicy;
  /** Mode to start in (the last one used). */
  mode: Mode;
}

export interface LanAdapter {
  name: string;
  address: string;
  recommended: boolean;
}

export interface HostInfo {
  settings: Settings;
  adapters: LanAdapter[];
  browser: { name: string; path: string | null; appMode: boolean } | null;
  dataDir: string;
  version: string;
  /** Whether the Windows Firewall rule for party mode exists (null = not Windows / unknown). */
  firewallRule: boolean | null;
  /** Antivirus / third-party firewall products on this PC (Windows only). */
  security: { antivirus: string[]; firewall: string[] } | null;
  /** Operating system of the PC/Mac running the app. */
  platform: 'win32' | 'darwin' | 'other';
}

export interface SearchResponse {
  results: Video[];
  provider: string;
}

export type Ack<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
