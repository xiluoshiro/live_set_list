import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

describe("console lookup api", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("getConsoleSongs 会按 q/limit 请求 console songs 并返回 items", async () => {
    // 测试点：歌曲候选查询封装应生成后端期望的 q/limit 参数并透传响应结构。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        items: [{ song_id: 1, song_name: "Yes! BanG_Dream!", band_id: 1, cover: false }],
      }),
    );
    const { getConsoleSongs } = await import("../api");

    const payload = await getConsoleSongs("  BanG  ", 10);

    expect(payload.items[0]).toEqual({ song_id: 1, song_name: "Yes! BanG_Dream!", band_id: 1, cover: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/songs?limit=10&q=BanG");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ credentials: "include" }));
  });

  test("getConsoleBands 会请求 console bands 并保留 band_members", async () => {
    // 测试点：乐队候选查询封装应保留成员数组，供前端成员选择器直接使用。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        items: [{ band_id: 2, band_name: "Roselia", band_abbr: "rsl", band_members: ["Yukina", "Sayo"] }],
      }),
    );
    const { getConsoleBands } = await import("../api");

    const payload = await getConsoleBands("rsl", 5);

    expect(payload.items).toEqual([
      { band_id: 2, band_name: "Roselia", band_abbr: "rsl", band_members: ["Yukina", "Sayo"] },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/bands?limit=5&q=rsl");
  });

  test("getConsoleVenues 空 q 时只发送 limit 参数", async () => {
    // 测试点：场地候选查询在空关键词时应走默认候选列表，不发送空 q。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        items: [{ venue_id: 3, venue_name: "Zepp Shinjuku" }],
      }),
    );
    const { getConsoleVenues } = await import("../api");

    const payload = await getConsoleVenues("   ");

    expect(payload.items).toEqual([{ venue_id: 3, venue_name: "Zepp Shinjuku" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/venues?limit=20");
  });

  test("createConsoleVenue 会携带 CSRF 写入 venue", async () => {
    // 测试点：新增场地封装应调用 console venue 写接口，并传递后端要求的 CSRF header。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        item: { venue_id: 9, venue_name: "New Venue" },
      }, true, 201),
    );
    const { createConsoleVenue } = await import("../api");

    const payload = await createConsoleVenue("New Venue", "csrf-token");

    expect(payload.item).toEqual({ venue_id: 9, venue_name: "New Venue" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/venues");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
      body: JSON.stringify({ venue_name: "New Venue" }),
    }));
  });

  test("createConsoleSong 会携带 CSRF 写入 song", async () => {
    // 测试点：新增歌曲封装应调用 console song 写接口，并传递后端要求的 CSRF header。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        item: { song_id: 903, song_name: "新曲", band_id: 2, cover: false },
      }, true, 201),
    );
    const { createConsoleSong } = await import("../api");
    const requestPayload = { song_name: "新曲", band_id: 2, cover: false };

    const payload = await createConsoleSong(requestPayload, "csrf-token");

    expect(payload.item).toEqual({ song_id: 903, song_name: "新曲", band_id: 2, cover: false });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/songs");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
      body: JSON.stringify(requestPayload),
    }));
  });

  test("createConsoleLive 会携带 CSRF 写入 live 并透传后端自增 id", async () => {
    // 测试点：新增 Live 封装不生成 live_id，应使用后端返回的自增 id。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        item: {
          live_id: 39,
          live_date: "2026-03-30",
          live_title: "Inserted Live",
          live_type: "oneman",
          url: "https://example.com/inserted",
          opening_time: "18:00:00+09:00",
          start_time: "19:00:00+09:00",
          venue_id: 88,
        },
      }, true, 201),
    );
    const { createConsoleLive } = await import("../api");
    const requestPayload = {
      live_date: "2026-03-30",
      live_title: "Inserted Live",
      live_type: "oneman",
      url: "https://example.com/inserted",
      opening_time: "18:00",
      start_time: "19:00",
      timezone: "+09:00",
      venue_id: 88,
    };

    const payload = await createConsoleLive(requestPayload, "csrf-token");

    expect(payload.item.live_id).toBe(39);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/lives");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
      body: JSON.stringify(requestPayload),
    }));
  });

  test("appendConsoleLiveSetlist 会携带 CSRF 追加 setlist 行", async () => {
    // 测试点：新增 Setlist 封装应调用指定 live 的 append 接口，且不覆盖已有行。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        item: { live_id: 101, inserted_row_count: 1, total_setlist_row_count: 12 },
      }, true, 201),
    );
    const { appendConsoleLiveSetlist } = await import("../api");
    const requestPayload = {
      setlist_rows: [
        {
          song_id: 901,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_member: { Roselia: ["湊友希那"] },
          other_member: {},
        },
      ],
    };

    const payload = await appendConsoleLiveSetlist(101, requestPayload, "csrf-token");

    expect(payload.item).toEqual({ live_id: 101, inserted_row_count: 1, total_setlist_row_count: 12 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/lives/101/setlist");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
      body: JSON.stringify(requestPayload),
    }));
  });

  test("console lookup 错误响应会转换为 ApiError", async () => {
    // 测试点：只读查询遇到后端结构化认证错误时，应沿用统一 ApiError 解析。
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({ detail: { code: "AUTH_FORBIDDEN", message: "当前账号无权访问该资源" } }, false, 403),
    );
    const { getConsoleSongs } = await import("../api");

    await expect(getConsoleSongs()).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "AUTH_FORBIDDEN",
      message: "当前账号无权访问该资源",
    });
  });
});
