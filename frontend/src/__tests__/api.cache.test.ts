import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONSOLE_LIVE_CHANGE_STORAGE_KEY } from "../consoleLiveSync";

vi.mock("../logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

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
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ credentials: "include" }));
  });

  test("getCatalogCalendar 相同月份命中缓存，不同月份分别请求", async () => {
    // 测试点：日历缓存以月份为键，重复访问同月不重复请求。
    fetchMock.mockResolvedValue(
      makeJsonResponse({ month: "2026-08", items: [] }),
    );
    const { getCatalogCalendar } = await import("../api");

    await getCatalogCalendar("2026-08");
    await getCatalogCalendar("2026-08");
    await getCatalogCalendar("2026-09");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/catalog/calendar?month=2026-08");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/catalog/calendar?month=2026-09");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ credentials: "include" }));
  });

  test("getCatalogCalendar 并发相同月份复用 inFlight promise", async () => {
    // 测试点：并发请求同月时只发一次网络请求。
    const d = deferred<Response>();
    fetchMock.mockReturnValue(d.promise);
    const { getCatalogCalendar } = await import("../api");

    const first = getCatalogCalendar("2026-08");
    const second = getCatalogCalendar("2026-08");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    d.resolve(makeJsonResponse({ month: "2026-08", items: [] }));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("getCatalogCalendar 失败后不写入缓存，下次重新请求", async () => {
    // 测试点：失败请求不污染日历缓存。
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ detail: "boom" }, false, 500));
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ month: "2026-08", items: [] }));
    const { getCatalogCalendar } = await import("../api");

    await expect(getCatalogCalendar("2026-08")).rejects.toThrow();
    await getCatalogCalendar("2026-08");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("clearLiveDataCaches 后日历缓存失效并重新请求", async () => {
    // 测试点：控制台变更清缓存时日历月数据一并失效。
    fetchMock.mockResolvedValue(makeJsonResponse({ month: "2026-08", items: [] }));
    const { getCatalogCalendar, clearLiveDataCaches } = await import("../api");

    await getCatalogCalendar("2026-08");
    clearLiveDataCaches();
    await getCatalogCalendar("2026-08");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 测试点：控制台无 setlist 候选每次都从服务端刷新，不能被公共列表或旧候选缓存污染。
  test("getLives 无 setlist 筛选绕过持久缓存", async () => {
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        items: [],
        pagination: { page: 1, page_size: 20, total: 0, total_pages: 1 },
      }),
    );
    const { getLives } = await import("../api");

    await getLives(1, 20);
    await getLives(1, 20, true);
    await getLives(1, 20, true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/lives?page=1&page_size=20");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/lives?page=1&page_size=20&without_setlist=true");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/lives?page=1&page_size=20&without_setlist=true");
  });

  test("getLives 列表筛选会进入 URL 与缓存键", async () => {
    // 测试点：不同筛选组合必须请求各自的服务端分页，不能误命中未筛选缓存。
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        items: [],
        pagination: { page: 1, page_size: 20, total: 0, total_pages: 1 },
      }),
    );
    const { getLives } = await import("../api");
    const filters = {
      q: "Roselia",
      year: 2026,
      liveType: "oneman",
      bandId: 2,
      sort: "date_asc" as const,
    };

    await getLives(1, 20);
    await getLives(1, 20, filters);
    await getLives(1, 20, filters);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/lives?page=1&page_size=20&q=Roselia&year=2026&live_type=oneman&band_id=2&sort=date_asc",
    );
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

  test("getAuthMe 并发恢复登录态时复用同一个请求", async () => {
    // 测试点：并发恢复 session 只刷新一次 CSRF token，避免后到请求覆盖后端 hash。
    const d = deferred<Response>();
    fetchMock.mockReturnValue(d.promise);
    const { getAuthMe } = await import("../api");

    const p1 = getAuthMe();
    const p2 = getAuthMe();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    d.resolve(
      makeJsonResponse({
        authenticated: true,
        user: { id: 1, username: "admin", display_name: "Admin", role: "admin" },
        csrf_token: "csrf-token",
        favorite_live_ids: [],
      }),
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
  });

  test("VITE_API_BASE_URL 配置后会请求指定后端域名", async () => {
    // 测试点：生产分域部署时 API base URL 应可由 Vite 环境变量覆盖。
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/");
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        ok: true,
        result: 1,
      }),
    );
    const { checkDbHealth } = await import("../api");

    await checkDbHealth();

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/health/db");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ credentials: "include" }));
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
        items: [{ live_id: 1, live_date: "2026-03-01", live_title: "A", bands: [1], url: null, is_favorite: false }],
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

  test("createConsoleLive 成功后会清理列表缓存", async () => {
    // 测试点：控制台新增 Live 后会清理分页缓存，并发布可供其他标签消费的变更标记。
    fetchMock
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [],
          pagination: { page: 1, page_size: 20, total: 3, total_pages: 1 },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          ok: true,
          item: {
            live_id: 41,
            live_date: "2026-05-30",
            live_title: "Console Draft Live",
            url: "https://example.com/lives/console-draft",
            opening_time: "17:00:00+09:00",
            start_time: "18:00:00+09:00",
            venue_id: 1,
          },
        }, true, 201),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [
            {
              live_id: 41,
              live_date: "2026-05-30",
              live_title: "Console Draft Live",
              bands: [],
              url: "https://example.com/lives/console-draft",
              is_favorite: false,
            },
          ],
          pagination: { page: 1, page_size: 20, total: 4, total_pages: 1 },
        }),
      );
    const { createConsoleLive, getLives } = await import("../api");

    await getLives(1, 20);
    await createConsoleLive(
      {
        live_date: "2026-05-30",
        live_title: "Console Draft Live",
        live_type: "oneman",
        url: "https://example.com/lives/console-draft",
        opening_time: "17:00",
        start_time: "18:00",
        timezone: "+09:00",
        venue_id: 1,
        venue_name_version_id: 11,
        default_band_ids: [3],
        event_attendees: [],
      },
      "csrf-token",
    );
    const refreshed = await getLives(1, 20);

    expect(refreshed.pagination.total).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/lives?page=1&page_size=20");
    expect(JSON.parse(localStorage.getItem(CONSOLE_LIVE_CHANGE_STORAGE_KEY) ?? "{}")).toMatchObject({
      action: "created",
      liveId: 41,
      nonce: expect.any(String),
    });
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
        is_favorite: false,
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
        is_favorite: false,
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
          is_favorite: false,
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
              is_favorite: false,
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
          is_favorite: false,
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
          is_favorite: false,
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
              is_favorite: false,
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
        is_favorite: false,
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
            is_favorite: false,
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
