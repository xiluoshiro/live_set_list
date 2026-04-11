export type CacheEntry<T> = {
  data?: T;
  updatedAt?: number;
  inFlight?: Promise<T>;
};

export class LruRequestCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxSize: number) {}

  getFresh(key: string, ttlMs: number): T | undefined {
    const entry = this.store.get(key);
    if (!entry || entry.data === undefined || entry.updatedAt === undefined) {
      return undefined;
    }
    if (Date.now() - entry.updatedAt >= ttlMs) {
      return undefined;
    }
    this.touch(key, entry);
    return entry.data;
  }

  getInFlight(key: string): Promise<T> | undefined {
    return this.store.get(key)?.inFlight;
  }

  setInFlight(key: string, promise: Promise<T>): void {
    const prev = this.store.get(key);
    const next: CacheEntry<T> = {
      data: prev?.data,
      updatedAt: prev?.updatedAt,
      inFlight: promise,
    };
    this.touch(key, next);
    this.evictLru();
  }

  setData(key: string, data: T, updatedAt: number = Date.now()): void {
    this.touch(key, { data, updatedAt });
    this.evictLru();
  }

  clearInFlightIfMatch(key: string, promise: Promise<T>): void {
    const current = this.store.get(key);
    if (!current || current.inFlight !== promise) return;
    this.touch(key, {
      data: current.data,
      updatedAt: current.updatedAt,
    });
  }

  clear(): void {
    this.store.clear();
  }

  private touch(key: string, entry: CacheEntry<T>): void {
    this.store.delete(key);
    this.store.set(key, entry);
  }

  private evictLru(): void {
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next();
      if (oldest.done) return;
      this.store.delete(oldest.value);
    }
  }
}

export class RecentPromiseDebouncer<K, T> {
  private readonly recent = new Map<K, { requestedAt: number; promise: Promise<T> }>();

  getRecent(key: K, debounceMs: number): Promise<T> | undefined {
    const item = this.recent.get(key);
    if (!item) return undefined;
    if (Date.now() - item.requestedAt >= debounceMs) return undefined;
    return item.promise;
  }

  setRecent(key: K, promise: Promise<T>): void {
    this.recent.set(key, {
      requestedAt: Date.now(),
      promise,
    });
  }
}
