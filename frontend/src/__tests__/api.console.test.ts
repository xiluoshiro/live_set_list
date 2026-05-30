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
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/console/songs?limit=10&q=BanG");
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
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/console/bands?limit=5&q=rsl");
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
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/console/venues?limit=20");
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
