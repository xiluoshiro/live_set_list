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

  test("getLiveDetailsBatch 会跳过已缓存详情，仅请求缺失项", async () => {
    // 测试点：batch 预读应复用 detail 缓存，避免重复请求已缓存 live_id。
    fetchMock
      .mockResolvedValueOnce(
        makeJsonResponse({
          live_id: 1,
          live_date: "2026-03-01",
          live_title: "Detail 1",
          bands: [1],
          band_names: ["Band A"],
          url: null,
          detail_rows: [],
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [
            {
              live_id: 2,
              live_date: "2026-03-02",
              live_title: "Detail 2",
              bands: [2],
              band_names: ["Band B"],
              url: null,
              detail_rows: [],
            },
          ],
          missing_live_ids: [],
        }),
      );
    const { getLiveDetail, getLiveDetailsBatch } = await import("../api");

    await getLiveDetail(1);
    await getLiveDetailsBatch([1, 2]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toContain("/api/lives/details:batch");
    const body = JSON.parse((secondCall[1] as RequestInit).body as string) as { live_ids: number[] };
    expect(body.live_ids).toEqual([2]);
  });

  test("getLiveDetailsBatch 超过100条时会自动分片请求", async () => {
    // 测试点：批量预读遵循后端 live_ids<=100 的契约约束。
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ items: [], missing_live_ids: [] }))
      .mockResolvedValueOnce(makeJsonResponse({ items: [], missing_live_ids: [] }));
    const { getLiveDetailsBatch } = await import("../api");
    const ids = Array.from({ length: 101 }, (_, idx) => idx + 1);

    await getLiveDetailsBatch(ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      live_ids: number[];
    };
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      live_ids: number[];
    };
    expect(firstBody.live_ids).toHaveLength(100);
    expect(secondBody.live_ids).toEqual([101]);
  });

  test("getLiveDetailsBatch 会去重并过滤非法 live_id", async () => {
    // 测试点：batch 请求前要做输入清洗，避免把非法/重复 ID 发给后端。
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ items: [], missing_live_ids: [] }));
    const { getLiveDetailsBatch } = await import("../api");

    await getLiveDetailsBatch([0, 2, 2, -1, 3.14, 3, 3, 1]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { live_ids: number[] };
    expect(body.live_ids).toEqual([2, 3, 1]);
  });

  test("getLiveDetailsBatch 全部命中详情缓存时不发起请求", async () => {
    // 测试点：若目标详情都在缓存中，batch 应直接短路返回。
    fetchMock
      .mockResolvedValueOnce(
        makeJsonResponse({
          live_id: 1,
          live_date: "2026-03-01",
          live_title: "Detail 1",
          bands: [1],
          band_names: ["Band A"],
          url: null,
          detail_rows: [],
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          live_id: 2,
          live_date: "2026-03-02",
          live_title: "Detail 2",
          bands: [2],
          band_names: ["Band B"],
          url: null,
          detail_rows: [],
        }),
      );
    const { getLiveDetail, getLiveDetailsBatch } = await import("../api");

    await getLiveDetail(1);
    await getLiveDetail(2);
    const payload = await getLiveDetailsBatch([1, 2, 1]);

    expect(payload).toEqual({ items: [], missing_live_ids: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("getLiveDetailsBatch 会跳过 inFlight 的详情请求", async () => {
    // 测试点：已在 in-flight 的 live_id 不应再进入 batch 请求，避免重复打后端。
    const d = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [
            {
              live_id: 2,
              live_date: "2026-03-02",
              live_title: "Detail 2",
              bands: [2],
              band_names: ["Band B"],
              url: null,
              detail_rows: [],
            },
          ],
          missing_live_ids: [],
        }),
      );
    const { getLiveDetail, getLiveDetailsBatch } = await import("../api");

    const detailPromise = getLiveDetail(1);
    const payload = await getLiveDetailsBatch([1, 2]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const batchBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      live_ids: number[];
    };
    expect(batchBody.live_ids).toEqual([2]);
    expect(payload.items.map((item) => item.live_id)).toEqual([2]);

    d.resolve(
      makeJsonResponse({
        live_id: 1,
        live_date: "2026-03-01",
        live_title: "Detail 1",
        bands: [1],
        band_names: ["Band A"],
        url: null,
        detail_rows: [],
      }),
    );
    await detailPromise;
  });

  test("getLiveDetailsBatch 返回的详情会写入 detail 缓存", async () => {
    // 测试点：batch 预读后，单条详情读取应直接命中缓存。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        items: [
          {
            live_id: 9,
            live_date: "2026-03-09",
            live_title: "Detail 9",
            bands: [1],
            band_names: ["Band A"],
            url: null,
            detail_rows: [],
          },
        ],
        missing_live_ids: [],
      }),
    );
    const { getLiveDetail, getLiveDetailsBatch } = await import("../api");

    await getLiveDetailsBatch([9]);
    const detail = await getLiveDetail(9);

    expect(detail.live_id).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("getLiveDetailsBatch 请求超时会抛出 Request timeout", async () => {
    // 测试点：batch API 的超时应统一映射为 Request timeout。
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    const { getLiveDetailsBatch } = await import("../api");

    await expect(getLiveDetailsBatch([1, 2])).rejects.toThrow("Request timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/lives/details:batch");
  });
});
