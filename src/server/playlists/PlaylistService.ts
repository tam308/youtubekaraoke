import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DEFAULT_PLAYLISTS, PLAYLIST_STALE_MS, withFixedName, type DefaultPlaylist } from '../../shared/constants';
import type { PlaylistDetail, PlaylistPreview, PlaylistSummary, Video } from '../../shared/types';
import { DebouncedWriter, readJson } from '../jsonStore';
import { log } from '../log';
import type { FetchedPlaylist } from '../youtube/fetchPlaylist';
import { parsePlaylistUrl } from './parsePlaylistUrl';

export interface StoredPlaylist {
  id: string;
  customName: string | null;
  builtIn: boolean;
  title: string;
  author: string | null;
  fetchedAt: number | null;
  items: Video[];
}

interface PlaylistFile {
  playlists: StoredPlaylist[];
  /** Built-in playlists the user removed (so they don't reappear until "Restore defaults"). */
  removedDefaults: string[];
}

export interface PlaylistSnapshot {
  generatedAt: number;
  playlists: FetchedPlaylist[];
}

export class PlaylistError extends Error {}

type Fetcher = (id: string, onProgress?: (n: number) => void) => Promise<FetchedPlaylist>;

/**
 * Preset playlists. Load order per playlist: KaraokeData/playlists.json cache →
 * snapshot bundled into the exe at build time → fetch from YouTube.
 * Anything older than 24h is refreshed in the background.
 */
export class PlaylistService extends EventEmitter<{ change: [] }> {
  private data: PlaylistFile;
  private readonly writer: DebouncedWriter | null;
  private readonly loading = new Map<string, Promise<void>>();
  private readonly progress = new Map<string, number>();
  private readonly errors = new Map<string, string>();
  private readonly previews = new Map<string, { at: number; value: FetchedPlaylist }>();

  constructor(
    private readonly opts: {
      dataDir: string | null;
      fetcher: Fetcher;
      snapshot: PlaylistSnapshot | null;
      defaults?: ReadonlyArray<DefaultPlaylist>;
      now?: () => number;
    },
  ) {
    super();
    const file = opts.dataDir ? path.join(opts.dataDir, 'playlists.json') : null;
    this.data = file ? readJson<PlaylistFile>(file, { playlists: [], removedDefaults: [] }) : { playlists: [], removedDefaults: [] };
    this.writer = file ? new DebouncedWriter(file, () => this.data) : null;
    this.ensureDefaults();
  }

  private get now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private get defaults(): ReadonlyArray<DefaultPlaylist> {
    return this.opts.defaults ?? DEFAULT_PLAYLISTS;
  }

  /** Built-in playlists with a fixed name never show the YouTube title or owner. */
  private fixName(p: FetchedPlaylist): FetchedPlaylist {
    return withFixedName(p, this.defaults);
  }

  private ensureDefaults(): void {
    let changed = false;
    for (const { id, name } of this.defaults) {
      if (this.data.removedDefaults.includes(id)) continue;
      const existing = this.find(id);
      if (existing) {
        if (!existing.builtIn) {
          existing.builtIn = true;
          changed = true;
        }
        // Older saved data may still hold the YouTube title and owner.
        if (name && (existing.title !== name || existing.author !== null)) {
          existing.title = name;
          existing.author = null;
          changed = true;
        }
        continue;
      }
      const found = this.opts.snapshot?.playlists.find((p) => p.id === id);
      const snap = found ? this.fixName(found) : undefined;
      this.data.playlists.unshift({
        id,
        customName: null,
        builtIn: true,
        title: snap?.title ?? name ?? 'Loading playlist…',
        author: snap?.author ?? null,
        fetchedAt: snap ? this.opts.snapshot!.generatedAt : null,
        items: snap?.items ?? [],
      });
      changed = true;
    }
    if (changed) this.persist();
  }

  private find(id: string): StoredPlaylist | undefined {
    return this.data.playlists.find((p) => p.id === id);
  }

  private persist(): void {
    this.writer?.schedule();
    this.emit('change');
  }

  private summarize(p: StoredPlaylist): PlaylistSummary {
    const loading = this.loading.has(p.id);
    return {
      id: p.id,
      title: p.title,
      customName: p.customName,
      author: p.author,
      builtIn: p.builtIn,
      itemCount: loading && p.items.length === 0 ? (this.progress.get(p.id) ?? 0) : p.items.length,
      fetchedAt: p.fetchedAt,
      loading,
      error: this.errors.get(p.id) ?? null,
    };
  }

  isStale(p: StoredPlaylist): boolean {
    return p.fetchedAt === null || p.items.length === 0 || this.now - p.fetchedAt > PLAYLIST_STALE_MS;
  }

  // ---- reads ----------------------------------------------------------------

  list(): PlaylistSummary[] {
    return this.data.playlists.map((p) => this.summarize(p));
  }

  get(id: string): PlaylistDetail | null {
    const p = this.find(id);
    if (!p) return null;
    if (this.isStale(p)) void this.refresh(id);
    return { ...this.summarize(p), items: p.items };
  }

  /** Refresh every stale playlist, one at a time (called shortly after startup). */
  async refreshStale(): Promise<void> {
    for (const p of [...this.data.playlists]) {
      if (this.isStale(p)) await this.refresh(p.id).catch(() => undefined);
    }
  }

  // ---- host commands --------------------------------------------------------

  async preview(url: string): Promise<PlaylistPreview> {
    const id = this.parseOrThrow(url);
    const fetched = this.fixName(await this.opts.fetcher(id));
    this.previews.set(id, { at: this.now, value: fetched });
    return { id, title: fetched.title, author: fetched.author, itemCount: fetched.items.length };
  }

  async save(url: string, customName: string | null): Promise<PlaylistSummary> {
    const id = this.parseOrThrow(url);
    const existing = this.find(id);
    if (existing) {
      if (customName) existing.customName = customName;
      this.persist();
      return this.summarize(existing);
    }
    const cached = this.previews.get(id);
    const fetched = cached && this.now - cached.at < 5 * 60_000 ? cached.value : this.fixName(await this.opts.fetcher(id));
    this.previews.delete(id);
    const isDefault = this.defaults.some((d) => d.id === id);
    if (isDefault) this.data.removedDefaults = this.data.removedDefaults.filter((d) => d !== id);
    const stored: StoredPlaylist = {
      id,
      customName: customName || null,
      builtIn: isDefault,
      title: fetched.title,
      author: fetched.author,
      fetchedAt: this.now,
      items: fetched.items,
    };
    this.data.playlists.push(stored);
    this.persist();
    return this.summarize(stored);
  }

  remove(id: string): void {
    const p = this.find(id);
    if (!p) throw new PlaylistError('That playlist was already removed.');
    this.data.playlists = this.data.playlists.filter((x) => x.id !== id);
    if (p.builtIn && !this.data.removedDefaults.includes(id)) this.data.removedDefaults.push(id);
    this.persist();
  }

  rename(id: string, customName: string | null): void {
    const p = this.find(id);
    if (!p) throw new PlaylistError('Playlist not found.');
    p.customName = customName || null;
    this.persist();
  }

  restoreDefaults(): void {
    this.data.removedDefaults = [];
    this.ensureDefaults();
    this.emit('change');
    void this.refreshStale();
  }

  refresh(id: string): Promise<void> {
    const running = this.loading.get(id);
    if (running) return running;
    const p = this.find(id);
    if (!p) return Promise.reject(new PlaylistError('Playlist not found.'));

    const task = (async () => {
      this.errors.delete(id);
      this.emit('change');
      try {
        const fetched = this.fixName(await this.opts.fetcher(id, (n) => this.progress.set(id, n)));
        const target = this.find(id);
        if (!target) return; // removed while loading
        target.title = fetched.title;
        target.author = fetched.author;
        target.items = fetched.items;
        target.fetchedAt = this.now;
        this.writer?.schedule();
        log.info(`Playlist ${id} refreshed: ${fetched.items.length} songs`);
      } catch (err) {
        this.errors.set(id, (err as Error).message);
        log.warn(`Playlist ${id} refresh failed:`, (err as Error).message);
        throw err;
      } finally {
        this.loading.delete(id);
        this.progress.delete(id);
        this.emit('change');
      }
    })();
    this.loading.set(id, task);
    task.catch(() => undefined); // errors are surfaced via summary.error
    return task;
  }

  flush(): void {
    this.writer?.flush();
  }

  private parseOrThrow(url: string): string {
    const parsed = parsePlaylistUrl(url);
    if (!parsed.ok) throw new PlaylistError(parsed.error);
    return parsed.id;
  }
}
