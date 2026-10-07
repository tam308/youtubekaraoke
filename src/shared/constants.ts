export const APP_ID = 'youtube-karaoke';
export const APP_NAME = 'YouTube Karaoke';

/** Default ports. The local port is loopback-only; the LAN port only exists in party mode. */
export const DEFAULT_LOCAL_PORT = 41234;
export const DEFAULT_LAN_PORT = 41235;
/** How many ports above the default to try if one is taken. */
export const PORT_SCAN_RANGE = 10;

export interface DefaultPlaylist {
  id: string;
  /** Fixed name shown instead of the playlist's YouTube title (the YouTube owner is hidden too). */
  name?: string;
}

/** Playlists that ship with the app. Songs are fetched from YouTube; titles too unless `name` is set. */
export const DEFAULT_PLAYLISTS: ReadonlyArray<DefaultPlaylist> = [
  { id: 'PLTIHQNGLYuVMsUdGwkwBd_xZDzjss--5p', name: '簡単なカラオケ曲（噓ｗｗｗｗ）' },
];

/** Applies a built-in playlist's fixed name: replaces the YouTube title and drops the owner. */
export function withFixedName<T extends { id: string; title: string; author: string | null }>(
  p: T,
  defaults: ReadonlyArray<DefaultPlaylist> = DEFAULT_PLAYLISTS,
): T {
  const name = defaults.find((d) => d.id === p.id)?.name;
  return name ? { ...p, title: name, author: null } : p;
}

export const LIMITS = {
  maxQueueLength: 500,
  maxHistory: 50,
  maxAddMany: 25,
  maxPlaylistItems: 2000,
  maxNicknameLength: 24,
  maxSearchQueryLength: 200,
} as const;

/** Per-socket rate limits: [max events, per window in ms]. */
export const RATE_LIMITS = {
  add: [10, 60_000],
  move: [60, 60_000],
  remove: [20, 60_000],
  skip: [6, 60_000],
  search: [30, 60_000],
  other: [60, 60_000],
} as const satisfies Record<string, readonly [number, number]>;

export const PLAYLIST_STALE_MS = 24 * 60 * 60 * 1000;
export const SEARCH_CACHE_MS = 10 * 60 * 1000;
/** Shut down when no host display has been connected for this long. */
export const HOST_GRACE_MS = 15_000;
/** Shut down if no host display ever connects within this window after launch. */
export const STARTUP_GRACE_MS = 120_000;
