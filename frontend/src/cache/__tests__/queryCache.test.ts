import { describe, expect, test, vi } from "vitest";

import { LruRequestCache, RecentPromiseDebouncer } from "../queryCache";

describe("LruRequestCache", () => {
  test("getFresh 在 TTL 内返回数据，过期后返回 undefined", () => {
    // 测试点：缓存有效期判断正确。
    const cache = new LruRequestCache<number>(5);
    const now = new Date("2026-04-05T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    cache.setData("k1", 42);
    expect(cache.getFresh("k1", 1000)).toBe(42);

    vi.setSystemTime(new Date(now.getTime() + 1001));
    expect(cache.getFresh("k1", 1000)).toBeUndefined();

    vi.useRealTimers();
  });

  test("inFlight 可写入/读取/按 promise 精确清理", async () => {
    // 测试点：并发请求占位与清理行为正确。
    const cache = new LruRequestCache<number>(5);
    const p1 = Promise.resolve(1);
    const p2 = Promise.resolve(2);

    cache.setInFlight("k1", p1);
    expect(cache.getInFlight("k1")).toBe(p1);

    cache.clearInFlightIfMatch("k1", p2);
    expect(cache.getInFlight("k1")).toBe(p1);

    cache.clearInFlightIfMatch("k1", p1);
    expect(cache.getInFlight("k1")).toBeUndefined();
  });

  test("超过 maxSize 时淘汰最久未使用项（LRU）", () => {
    // 测试点：LRU 淘汰顺序正确。
    const now = new Date("2026-04-05T02:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const cache = new LruRequestCache<number>(2);
    cache.setData("a", 1);
    cache.setData("b", 2);

    // 访问 a，使 b 成为最旧
    expect(cache.getFresh("a", 999999)).toBe(1);
    cache.setData("c", 3);

    expect(cache.getFresh("a", 999999)).toBe(1);
    expect(cache.getFresh("b", 999999)).toBeUndefined();
    expect(cache.getFresh("c", 999999)).toBe(3);

    vi.useRealTimers();
  });
});

describe("RecentPromiseDebouncer", () => {
  test("在 debounce 窗口内复用 promise，超时后失效", () => {
    // 测试点：短时间内重复请求返回同一 promise。
    const debouncer = new RecentPromiseDebouncer<string, number>();
    const now = new Date("2026-04-05T01:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const p = Promise.resolve(1);
    debouncer.setRecent("key", p);
    expect(debouncer.getRecent("key", 300)).toBe(p);

    vi.setSystemTime(new Date(now.getTime() + 301));
    expect(debouncer.getRecent("key", 300)).toBeUndefined();

    vi.useRealTimers();
  });
});
