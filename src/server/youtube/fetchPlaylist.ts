import { LIMITS } from '../../shared/constants';
import type { Video } from '../../shared/types';
import { log } from '../log';
import { getInnertube, resetInnertube } from './client';
import { collectRenderers, extractInitialData, fetchYoutubeHtml, mapYoutubeiNode, str } from './mapVideo';

export interface FetchedPlaylist {
  id: string;
  title: string;
  author: string | null;
  items: Video[];
}

export class PlaylistUnavailableError extends Error {}

function dedupe(items: Video[]): Video[] {
  const seen = new Set<string>();
  return items.filter((v) => (seen.has(v.videoId) ? false : (seen.add(v.videoId), true)));
}

async function viaInnertube(id: string, onProgress?: (n: number) => void): Promise<FetchedPlaylist> {
  try {
    const yt = await getInnertube();
    let page = await yt.getPlaylist(id);
    const info = page.info;
    const items: Video[] = [];
    const take = (nodes: unknown[]) => {
      for (const n of nodes) {
        const v = mapYoutubeiNode(n);
        if (v) items.push(v);
      }
      onProgress?.(items.length);
    };
    take(page.videos as unknown[]);
    while (page.has_continuation && items.length < LIMITS.maxPlaylistItems) {
      page = await page.getContinuation();
      take(page.videos as unknown[]);
    }
    return {
      id,
      title: str(info.title).trim() || 'Untitled playlist',
      author: str(info.author?.name).trim() || null,
      items: dedupe(items).slice(0, LIMITS.maxPlaylistItems),
    };
  } catch (err) {
    resetInnertube();
    throw err;
  }
}

/** Fallback: parse the playlist page HTML (first ~100 songs only). */
async function viaPlaylistPage(id: string): Promise<FetchedPlaylist> {
  const html = await fetchYoutubeHtml(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = extractInitialData(html) as any;
  const header = data?.metadata?.playlistMetadataRenderer;
  const items = collectRenderers(data, ['playlistVideoRenderer']);
  if (!header && items.length === 0) throw new PlaylistUnavailableError('Playlist not found or private.');
  return { id, title: header?.title ?? 'Untitled playlist', author: null, items };
}

export async function fetchPlaylist(id: string, onProgress?: (n: number) => void): Promise<FetchedPlaylist> {
  let result: FetchedPlaylist;
  try {
    result = await viaInnertube(id, onProgress);
  } catch (err) {
    log.warn(`InnerTube playlist fetch failed for ${id}:`, (err as Error).message);
    try {
      result = await viaPlaylistPage(id);
    } catch (err2) {
      log.warn(`Playlist page fallback failed for ${id}:`, (err2 as Error).message);
      throw new PlaylistUnavailableError(
        "Couldn't load that playlist. Check that it's public or unlisted (not private) and that you're online.",
      );
    }
  }
  if (result.items.length === 0) throw new PlaylistUnavailableError('That playlist has no playable videos.');
  return result;
}
