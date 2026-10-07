import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../../shared/constants';
import type { Playback, QueueItem, Video } from '../../shared/types';

export interface PersistedQueue {
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  history: QueueItem[];
  positionSec: number;
}

export const EMPTY_QUEUE: PersistedQueue = {
  nowPlaying: null,
  queue: [],
  history: [],
  positionSec: 0,
};

export class QueueError extends Error {}

interface Events {
  /** Queue contents changed (broadcast full state + persist). */
  change: [];
  /** Only the playback position/status changed (lightweight broadcast). */
  playback: [Playback];
}

/**
 * The single source of truth for what is playing and what is next.
 * Pure in-memory logic: persistence and networking subscribe to its events.
 * Nothing is ever marked as "can't play": a song the in-app player refuses is opened in a
 * YouTube window instead (see PopupPlayer), every time it comes up.
 */
export class QueueManager extends EventEmitter<Events> {
  private nowPlaying: QueueItem | null;
  private queue: QueueItem[];
  private history: QueueItem[];
  private playback: Playback;

  constructor(initial: PersistedQueue = EMPTY_QUEUE, private readonly newId: () => string = randomUUID) {
    super();
    this.nowPlaying = initial.nowPlaying;
    this.queue = [...initial.queue];
    this.history = [...initial.history];
    this.playback = {
      status: this.nowPlaying ? 'paused' : 'idle',
      positionSec: this.nowPlaying ? initial.positionSec : 0,
      itemId: this.nowPlaying?.id ?? null,
    };
  }

  // ---- reads ----------------------------------------------------------------

  snapshot() {
    return {
      nowPlaying: this.nowPlaying,
      queue: this.queue,
      history: this.history,
      playback: this.playback,
    };
  }

  toPersisted(): PersistedQueue {
    return {
      nowPlaying: this.nowPlaying,
      queue: this.queue,
      history: this.history,
      positionSec: this.playback.positionSec,
    };
  }

  current(): QueueItem | null {
    return this.nowPlaying;
  }

  get length(): number {
    return this.queue.length;
  }

  // ---- commands -------------------------------------------------------------

  add(video: Video, addedBy: string, position: 'end' | 'next' = 'end'): QueueItem {
    return this.addMany([video], addedBy, position)[0]!;
  }

  /** Adds videos in order. With `next`, the whole block goes to the front, keeping its order. */
  addMany(videos: Video[], addedBy: string, position: 'end' | 'next' = 'end'): QueueItem[] {
    if (this.queue.length + videos.length > LIMITS.maxQueueLength) {
      throw new QueueError(`The queue is full (max ${LIMITS.maxQueueLength} songs).`);
    }
    const now = Date.now();
    const items = videos.map((v) => ({ ...v, id: this.newId(), addedBy, addedAt: now }));
    if (position === 'next') this.queue.unshift(...items);
    else this.queue.push(...items);

    if (!this.nowPlaying) this.advance();
    this.emit('change');
    return items;
  }

  /** Move by item id (not index) so concurrent drags from different phones can't move the wrong song. */
  move(itemId: string, toIndex: number): void {
    const from = this.queue.findIndex((i) => i.id === itemId);
    if (from === -1) throw new QueueError('That song is no longer in the queue.');
    const [item] = this.queue.splice(from, 1);
    const target = Math.max(0, Math.min(toIndex, this.queue.length));
    this.queue.splice(target, 0, item!);
    if (from !== target) this.emit('change');
  }

  remove(itemId: string): QueueItem {
    const idx = this.queue.findIndex((i) => i.id === itemId);
    if (idx === -1) throw new QueueError('That song is no longer in the queue.');
    const [item] = this.queue.splice(idx, 1);
    this.emit('change');
    return item!;
  }

  clear(): void {
    if (this.queue.length === 0) return;
    this.queue = [];
    this.emit('change');
  }

  /** Returns the skipped item, or null if nothing was playing. */
  skip(): QueueItem | null {
    const skipped = this.nowPlaying;
    if (!skipped) return null;
    this.advance();
    this.emit('change');
    return skipped;
  }

  /** The player finished `itemId`. Ignored if it's not the current item (stale/duplicate event). */
  ended(itemId: string): boolean {
    if (this.nowPlaying?.id !== itemId) return false;
    this.advance();
    this.emit('change');
    return true;
  }

  /** `itemId` couldn't be played at all (e.g. the video was deleted); move on without marking it. */
  failed(itemId: string): QueueItem | null {
    const item = this.nowPlaying;
    if (!item || item.id !== itemId) return null;
    this.advance({ toHistory: false });
    this.emit('change');
    return item;
  }

  progress(itemId: string, positionSec: number, status: Playback['status']): void {
    if (this.nowPlaying?.id !== itemId) return;
    this.playback = { status, positionSec, itemId };
    this.emit('playback', this.playback);
  }

  // ---- internals ------------------------------------------------------------

  private advance({ toHistory = true } = {}): void {
    if (this.nowPlaying && toHistory) {
      this.history.unshift(this.nowPlaying);
      if (this.history.length > LIMITS.maxHistory) this.history.length = LIMITS.maxHistory;
    }
    this.nowPlaying = this.queue.shift() ?? null;
    this.playback = {
      status: this.nowPlaying ? 'buffering' : 'idle',
      positionSec: 0,
      itemId: this.nowPlaying?.id ?? null,
    };
  }
}
