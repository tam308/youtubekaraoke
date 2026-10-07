/** Sliding-window counter: allows `max` hits per `windowMs` per key. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  allow(key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (list.length >= max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.prune(windowMs);
    return true;
  }

  forget(prefix: string): void {
    for (const key of this.hits.keys()) if (key.startsWith(prefix)) this.hits.delete(key);
  }

  private prune(windowMs: number): void {
    const t = this.now();
    for (const [key, list] of this.hits) {
      if (list.every((at) => t - at >= windowMs)) this.hits.delete(key);
    }
  }
}
