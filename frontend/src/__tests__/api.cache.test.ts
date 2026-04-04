import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type FetchMock = ReturnType<typeof vi.fn>;

function makeJsonResponse<T>(payload: T, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("api cache behavior", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("getLives 相同参数命中缓存，不重复请求", async () => {
    // 测试点：列表页缓存命中（page/page_size 维度）。
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        items: [],
        pagination: { page: 1, page_size: 20, total: 47, total_pages: 3 },
      }),
    );
    const { getLives } = await import("../api");

    await getLives(1, 20);
    await getLives(1, 20);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("getLives 并发相同请求会复用 inFlight promise", async () => {
    // 测试点：并发去重，避免同参数重复打后端。
    const d = deferred<Response>();
    fetchMock.mockReturnValue(d.promise);
    const { getLives } = await import("../api");

    const p1 = getLives(1, 20);
    const p2 = getLives(1, 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    d.resolve(
      makeJsonResponse({
        items: [],
        pagination: { page: 1, page_size: 20, total: 47, total_pages: 3 },
      }),
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.pagination.total).toBe(47);
    expect(r2.pagination.total).toBe(47);
  });

  test("getLives TTL 过期后会重新请求", async () => {
    // 测试点：超出列表缓存 TTL 后不再命中旧缓存。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T00:00:00Z"));

    fetchMock.mockResolvedValue(
      makeJsonResponse({
        items: [],
        pagination: { page: 1, page_size: 20, total: 47, total_pages: 3 },
      }),
    );
    const { getLives } = await import("../api");

    await getLives(1, 20);
    await getLives(1, 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-04-05T00:16:00Z"));
    await getLives(1, 20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("getLives 后端校正页码后会写入 canonical key 缓存", async () => {
    // 测试点：请求 page=99 返回 page=1 时，后续 page=1 可直接命中缓存。
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        items: [{ live_id: 1, live_date: "2026-03-01", live_title: "A", bands: [1], url: null }],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }),
    );
    const { getLives } = await import("../api");

    await getLives(99, 20);
    await getLives(1, 20);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("getLives 失败结果不缓存，下次会重试请求", async () => {
    // 测试点：错误响应不应污染成功缓存。
    fetchMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(
      makeJsonResponse({
        items: [],
        pagination: { page: 1, page_size: 20, total: 0, total_pages: 1 },
      }),
    );
    const { getLives } = await import("../api");

    await expect(getLives(1, 20)).rejects.toThrow("boom");
    await getLives(1, 20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("getLiveDetail 命中缓存，不重复请求同一 live_id", async () => {
    // 测试点：详情缓存按 live_id 生效。
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        live_id: 1,
        live_date: "2026-03-01",
        live_title: "Detail",
        bands: [1],
        band_names: ["Band A"],
        url: null,
        detail_rows: [],
      }),
    );
    const { getLiveDetail } = await import("../api");

    await getLiveDetail(1);
    await getLiveDetail(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("getLiveDetail TTL 过期后重新请求", async () => {
    // 测试点：详情缓存过期后触发重新拉取。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T01:00:00Z"));

    fetchMock.mockResolvedValue(
      makeJsonResponse({
        live_id: 1,
        live_date: "2026-03-01",
        live_title: "Detail",
        bands: [1],
        band_names: ["Band A"],
        url: null,
        detail_rows: [],
      }),
    );
    const { getLiveDetail } = await import("../api");

    await getLiveDetail(1);
    await getLiveDetail(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-04-05T01:31:00Z"));
    await getLiveDetail(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
