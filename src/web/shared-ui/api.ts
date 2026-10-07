import type { PlaylistDetail, PlaylistSummary, SearchResponse, Video } from '../../shared/types';

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('Could not reach the karaoke app.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export function searchVideos(q: string, karaoke: boolean): Promise<SearchResponse> {
  return getJson(`/api/search?q=${encodeURIComponent(q)}&karaoke=${karaoke ? 1 : 0}`);
}

export async function getPlaylists(): Promise<PlaylistSummary[]> {
  return (await getJson<{ playlists: PlaylistSummary[] }>('/api/playlists')).playlists;
}

export function getPlaylist(id: string): Promise<PlaylistDetail> {
  return getJson(`/api/playlists/${encodeURIComponent(id)}`);
}

/** The fields the server accepts for a video (it derives the thumbnail itself). */
export function videoPayload(v: Video) {
  return { videoId: v.videoId, title: v.title, channel: v.channel, durationSec: v.durationSec };
}
