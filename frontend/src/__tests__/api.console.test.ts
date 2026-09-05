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

  // 测试点：歌曲候选查询封装应透传 q、归属 Band、每页数量和页码，并保留服务端分页信息。
  test("getConsoleSongs 会按 q/band_id/limit/page 请求 console songs", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        items: [{ song_id: 1, song_name: "Yes! BanG_Dream!", band_id: 1, cover: false, band_name: "Poppin'Party" }],
        page: 2,
        page_size: 10,
        total: 12,
        total_pages: 2,
      }),
    );
    const { getConsoleSongs } = await import("../api");

    const payload = await getConsoleSongs("  BanG  ", 10, 2, 1);

    expect(payload.items[0]).toEqual({ song_id: 1, song_name: "Yes! BanG_Dream!", band_id: 1, cover: false, band_name: "Poppin'Party" });
    expect(payload.total_pages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/songs?limit=10&q=BanG&page=2&band_id=1");
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

  // 测试点：新增乐队封装应携带编号段、V1 初始资料和 CSRF，并保留服务端最终分配的 Band ID。
  test("createConsoleBand 会提交编号段与初始历史资料", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse({
        ok: true,
        item: {
          band_id: 103,
          band_name: "New Special Band",
          band_abbr: "nsb",
          band_members: ["Member A"],
        },
        history: {
          band_id: 103,
          current_name: "New Special Band",
          current_abbr: "nsb",
          current_members: ["Member A"],
          initialized: true,
          name_versions: [],
          lineup_versions: [],
        },
      }, true, 201),
    );
    const { createConsoleBand } = await import("../api");
    const requestPayload = {
      id_range: "special" as const,
      band_name: "New Special Band",
      band_abbr: "nsb",
      members: ["Member A"],
      valid_from: "2026-07-27",
    };

    const payload = await createConsoleBand(requestPayload, "csrf-token");

    expect(payload.item.band_id).toBe(103);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/bands");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
      body: JSON.stringify(requestPayload),
    }));
  });

  // 测试点：场地候选查询在空关键词时应走默认候选列表，不发送空 q。
  test("getConsoleVenues 空 q 时只发送 limit 参数", async () => {
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

  // 测试点：新增场地封装应调用 Venue 管理写接口，并传递类型与 CSRF header。
  test("createConsoleVenue 会携带 CSRF 写入 venue", async () => {
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
      body: JSON.stringify({ venue_name: "New Venue", venue_kind: "physical" }),
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

  // 测试点：歌曲管理更新封装应使用目标 song_id 发起带 CSRF 的 PUT。
  test("updateConsoleSong 通过 PUT 更新歌曲属性", async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      ok: true,
      item: { song_id: 903, song_name: "改名曲", band_id: 2, cover: true },
    }));
    const { updateConsoleSong } = await import("../api");
    const requestPayload = { song_name: "改名曲", band_id: 2, cover: true };

    await updateConsoleSong(903, requestPayload, "csrf-token");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/songs/903");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-token" },
      body: JSON.stringify(requestPayload),
    }));
  });

  // 测试点：Setlist 管理封装会读取原始行，并使用完整集合 PUT 覆盖目标 Live。
  test("Setlist 编辑 API 会读取并更新完整行集合", async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ live_id: 55, rows: [] }))
      .mockResolvedValueOnce(makeJsonResponse({
        ok: true,
        item: { live_id: 55, inserted_row_count: 1, total_setlist_row_count: 1 },
      }));
    const { getConsoleLiveSetlist, updateConsoleLiveSetlist } = await import("../api");
    const requestPayload = {
      band_lineup_contexts: [{
        band_id: 2,
        band_name_version_id: 20,
        base_lineup_version_id: 21,
        next_lineup_version_id: null,
      }],
      setlist_rows: [{
        song_id: 1,
        absolute_order: 1,
        segment_type: "M",
        sub_order: 1,
        is_short: false,
        band_member: { Roselia: ["湊友希那"] },
        band_performances: [{
          band_id: 2,
          lineup_usage: "base" as const,
          handover_baseline: null,
          members: ["湊友希那"],
        }],
        other_member: null,
        comment: null,
      }],
    };

    await getConsoleLiveSetlist(55);
    await updateConsoleLiveSetlist(55, requestPayload, "csrf-token");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/lives/55/setlist");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/console/lives/55/setlist");
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        setlist_rows: [{
          song_id: 1,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_performances: [{
            band_id: 2,
            lineup_usage: "base",
            handover_baseline: null,
            members: ["湊友希那"],
          }],
          other_member: null,
          comment: null,
        }],
      }),
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
          venue_name_version_id: 188,
          default_band_ids: [1, 3],
          event_attendees: [],
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
      venue_name_version_id: 188,
      default_band_ids: [1, 3],
      event_attendees: [],
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

  // 测试点：Live 管理 API 应传递关键词、类型和待补状态筛选，并由 PUT 更新调用携带完整请求体。
  test("Live 编辑 API 会查询候选和详情并通过 PUT 保存", async () => {
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 }))
      .mockResolvedValueOnce(makeJsonResponse({ item: { live_id: 55 } }))
      .mockResolvedValueOnce(makeJsonResponse({ ok: true, item: { live_id: 55 } }));
    const { getConsoleLiveCandidates, getConsoleLive, updateConsoleLive } = await import("../api");
    const requestPayload = {
      live_date: "2026-07-05",
      live_title: "Updated Live",
      live_type: "event",
      url: "https://example.com/live",
      opening_time: "09:00",
      start_time: "21:30",
      timezone: "+09:00",
      venue_id: 2,
      venue_name_version_id: 22,
      default_band_ids: [3],
      event_attendees: [{ band_id: 3, members: ["高松燈"] }],
    };

    await getConsoleLiveCandidates(" 55 ", 2, 20, "event", undefined, "scheduled", false, "overdue");
    await getConsoleLive(55);
    await updateConsoleLive(55, requestPayload, "csrf-token");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/lives?page=2&page_size=20&q=55&live_type=event&event_status=scheduled&schedule_complete=false&schedule_attention=overdue");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/console/lives/55");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/console/lives/55");
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({
      method: "PUT",
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
      band_lineup_contexts: [{
        band_id: 2,
        band_name_version_id: 20,
        base_lineup_version_id: 21,
        next_lineup_version_id: null,
      }],
      setlist_rows: [
        {
          song_id: 901,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_member: { Roselia: ["湊友希那"] },
          band_performances: [{
            band_id: 2,
            lineup_usage: "base" as const,
            handover_baseline: null,
            members: ["湊友希那"],
          }],
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
      body: JSON.stringify({
        setlist_rows: [{
          song_id: 901,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_performances: [{
            band_id: 2,
            lineup_usage: "base",
            handover_baseline: null,
            members: ["湊友希那"],
          }],
          other_member: {},
        }],
      }),
    }));
  });

  // 测试点：聚合管理使用专用控制台接口读取全部活动组，不依赖公共演出分页。
  test("getConsolePerformanceGroups 请求专用活动组列表", async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      items: [
        { group_id: 1, group_title: "Group A" },
        { group_id: 2, group_title: "Group B" },
      ],
    }));
    const { getConsolePerformanceGroups } = await import("../api");

    const payload = await getConsolePerformanceGroups();

    expect(payload.items).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/console/performance-groups");
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
