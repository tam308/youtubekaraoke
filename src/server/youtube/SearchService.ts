import { SEARCH_CACHE_MS } from '../../shared/constants';
import type { SearchResponse, Video } from '../../shared/types';
import { log } from '../log';
import { getInnertube, resetInnertube } from './client';
import { collectRenderers, extractInitialData, fetchYoutubeHtml, mapYoutubeiNode } from './mapVideo';

export interface SearchProvider {
  readonly name: string;
  search(query: string): Promise<Video[]>;
}

/** Primary: youtubei.js (the InnerTube API youtube.com itself uses). */
export const innerTubeProvider: SearchProvider = {
  name: 'innertube',
  async search(query) {
    try {
      const yt = await getInnertube();
      const res = await yt.search(query, { type: 'video' });
      return res.results.map(mapYoutubeiNode).filter((v): v is Video => v !== null);
    } catch (err) {
      resetInnertube();
      throw err;
    }
  },
};

/** Fallback: read the JSON embedded in the normal youtube.com results page. */
export const resultsPageProvider: SearchProvider = {
  name: 'results-page',
  async search(query) {
    // sp=EgIQAQ== restricts results to videos.
    const html = await fetchYoutubeHtml(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`,
    );
    return collectRenderers(extractInitialData(html), ['videoRenderer']);
  },
};

export class SearchUnavailableError extends Error {}

export class SearchService {
  private cache = new Map<string, { at: number; value: SearchResponse }>();

  constructor(private readonly providers: SearchProvider[] = [innerTubeProvider, resultsPageProvider]) {}

  async search(rawQuery: string, opts: { karaoke: boolean }): Promise<SearchResponse> {
    const base = rawQuery.trim().replace(/\s+/g, ' ');
    const query = opts.karaoke && !/karaoke|カラオケ/i.test(base) ? `${base} karaoke` : base;
    const key = query.toLowerCase();

    let response = this.fromCache(key);
    if (!response) {
      response = await this.searchUncached(query);
      this.cache.set(key, { at: Date.now(), value: response });
      this.prune();
    }
    return response;
  }

  private async searchUncached(query: string): Promise<SearchResponse> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        const results = (await provider.search(query)).filter((v) => v.durationSec > 0);
        return { results, provider: provider.name };
      } catch (err) {
        log.warn(`Search provider ${provider.name} failed:`, (err as Error).message);
        errors.push(`${provider.name}: ${(err as Error).message}`);
      }
    }
    throw new SearchUnavailableError(`All search providers failed (${errors.join('; ')})`);
  }

  private fromCache(key: string): SearchResponse | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > SEARCH_CACHE_MS) {
      this.cache.delete(key);
      return null;
    }
    // Refresh LRU position.
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit.value;
  }

  private prune(): void {
    while (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
  }
}
