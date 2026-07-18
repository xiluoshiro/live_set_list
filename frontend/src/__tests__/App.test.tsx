import { render, screen, waitFor, within } from "@testing-library/react";
import { act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

import App from "../App";
import { AuthProvider } from "../auth/AuthProvider";
import { FavoriteProvider } from "../favorites/FavoriteProvider";
import {
  clearLivesCache,
  clearMyFavoriteLivesCache,
  favoriteLive,
  favoriteLivesBatch,
  getCatalogBandLives,
  getCatalogBands,
  getCatalogStats,
  getCatalogStatistics,
  getLiveDetail,
  getLiveDetailsBatch,
  getAuthMe,
  getLives,
  getMyFavoriteLives,
  getPerformances,
  getPerformanceGroupDetail,
  getTourDetail,
  getTourStatistics,
  getTours,
  login,
  logout,
  peekMyFavoriteLives,
  searchCatalog,
  unfavoriteLive,
  type CatalogBandLivesResponse,
  type CatalogSearchResponse,
  type LiveDetailResponse,
  type LivesResponse,
  type PerformancesResponse,
  type PerformanceGroupDetailResponse,
  type TourDetailResponse,
  type TourStatisticsResponse,
  type ToursResponse,
} from "../api";
import { logError } from "../logger";
import { ThemeProvider } from "../theme/ThemeProvider";

vi.mock("../api", () => ({
  getLives: vi.fn(),
  searchCatalog: vi.fn(),
  getCatalogStats: vi.fn(),
  getCatalogStatistics: vi.fn(),
  getCatalogBands: vi.fn(),
  getCatalogBandLives: vi.fn(),
  getLiveDetail: vi.fn(),
  getLiveDetailsBatch: vi.fn(),
  getAuthMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  getMyFavoriteLives: vi.fn(),
  getPerformances: vi.fn(),
  getPerformanceGroupDetail: vi.fn(),
  getTours: vi.fn(),
  getTourDetail: vi.fn(),
  getTourStatistics: vi.fn(),
  peekMyFavoriteLives: vi.fn(),
  clearLivesCache: vi.fn(),
  clearMyFavoriteLivesCache: vi.fn(),
  favoriteLive: vi.fn(),
  favoriteLivesBatch: vi.fn(),
  unfavoriteLive: vi.fn(),
  createConsoleVenue: vi.fn().mockResolvedValue({ ok: true, item: { venue_id: 1, venue_name: "Mock Venue" } }),
  getConsoleSongs: vi.fn().mockResolvedValue({ items: [] }),
  getConsoleBands: vi.fn().mockResolvedValue({ items: [] }),
  getConsoleVenues: vi.fn().mockResolvedValue({ items: [] }),
  ApiError: class ApiError extends Error {
    status: number;
    code: string | null;

    constructor(message: string, status = 500, code: string | null = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock("../logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const getLivesMock = vi.mocked(getLives);
const getPerformancesMock = vi.mocked(getPerformances);
const getPerformanceGroupDetailMock = vi.mocked(getPerformanceGroupDetail);
const searchCatalogMock = vi.mocked(searchCatalog);
const getCatalogBandsMock = vi.mocked(getCatalogBands);
const getCatalogBandLivesMock = vi.mocked(getCatalogBandLives);
const getCatalogStatsMock = vi.mocked(getCatalogStats);
const getCatalogStatisticsMock = vi.mocked(getCatalogStatistics);
const getLiveDetailMock = vi.mocked(getLiveDetail);
const getLiveDetailsBatchMock = vi.mocked(getLiveDetailsBatch);
const getAuthMeMock = vi.mocked(getAuthMe);
const loginMock = vi.mocked(login);
const logoutMock = vi.mocked(logout);
const getMyFavoriteLivesMock = vi.mocked(getMyFavoriteLives);
const getToursMock = vi.mocked(getTours);
const getTourDetailMock = vi.mocked(getTourDetail);
const getTourStatisticsMock = vi.mocked(getTourStatistics);
const peekMyFavoriteLivesMock = vi.mocked(peekMyFavoriteLives);
const clearLivesCacheMock = vi.mocked(clearLivesCache);
const clearMyFavoriteLivesCacheMock = vi.mocked(clearMyFavoriteLivesCache);
const favoriteLiveMock = vi.mocked(favoriteLive);
const favoriteLivesBatchMock = vi.mocked(favoriteLivesBatch);
const unfavoriteLiveMock = vi.mocked(unfavoriteLive);
const logErrorMock = vi.mocked(logError);

function makeItems(count: number, startId = 1, withUrl = true) {
  return Array.from({ length: count }, (_, idx) => {
    const id = startId + idx;
    return {
      live_id: id,
      live_date: `2026-03-${String((id % 28) + 1).padStart(2, "0")}`,
      live_title: `示例 Live 名称 ${id}`,
      live_type: "oneman",
      bands: [1, 2],
      url: withUrl ? `https://example.com/live/${id}` : null,
      is_favorite: true,
    };
  });
}

function makeResponse(params: {
  page: number;
  pageSize: 15 | 20;
  total: number;
  totalPages: number;
  itemCount: number;
  startId?: number;
  withUrl?: boolean;
}): LivesResponse {
  return {
    items: makeItems(params.itemCount, params.startId ?? 1, params.withUrl ?? true),
    pagination: {
      page: params.page,
      page_size: params.pageSize,
      total: params.total,
      total_pages: params.totalPages,
    },
  };
}

function makePerformancesResponse(params: {
  page: number;
  pageSize: 15 | 20;
  total: number;
  totalPages: number;
  itemCount: number;
  startId?: number;
  withUrl?: boolean;
}): PerformancesResponse {
  const livesResp = makeResponse(params);
  return {
    items: livesResp.items.map((live) => ({ kind: "live" as const, live })),
    pagination: livesResp.pagination,
  };
}

function makePerformanceGroupDetailResponse(): PerformanceGroupDetailResponse {
  return {
    group_id: 88,
    group_title: "示例多日 Live",
    start_date: "2026-08-01",
    end_date: "2026-08-02",
    day_count: 2,
    live_count: 2,
    display_type: "multi_day",
    bands: [{ band_id: 1, band_name: "Band 1", band_abbr: "B1" }],
    venues: ["测试场地"],
    lives: [
      {
        live_id: 801,
        live_date: "2026-08-01",
        live_title: "示例多日 Live DAY 1",
        live_type: "oneman",
        start_time: "18:00:00+09:00",
        venue: "测试场地",
        bands: [1],
        url: null,
        is_favorite: false,
        has_setlist: true,
      },
      {
        live_id: 802,
        live_date: "2026-08-02",
        live_title: "示例多日 Live DAY 2",
        live_type: "oneman",
        start_time: "18:00:00+09:00",
        venue: "测试场地",
        bands: [1],
        url: null,
        is_favorite: false,
        has_setlist: true,
      },
    ],
  };
}

function makeDetailResponse(params: {
  liveId: number;
  rowCount?: number;
  url?: string | null;
}): LiveDetailResponse {
  const rowCount = params.rowCount ?? 20;
  return {
    live_id: params.liveId,
    live_date: "2026-03-28",
    live_title: `示例 Live 名称 ${params.liveId}`,
    live_type: "oneman",
    venue: "测试场地",
    opening_time: "17:00:00+08:00",
    start_time: "18:00:00+09:00",
    bands: [1, 2],
    band_names: ["Band 1", "Band 2"],
    url: params.url === undefined ? `https://example.com/live/${params.liveId}` : params.url,
    is_favorite: false,
    detail_rows: Array.from({ length: rowCount }, (_, idx) => ({
      row_id: `M${idx + 1}`,
      song_name: `曲目 ${idx + 1}`,
      band_members: [
        {
          band_id: 1,
          band_name: "Band 1",
          present_members: ["A", "B", "C", "D", "E"],
          present_count: 5,
          total_count: 5,
          is_full: true,
        },
      ],
      other_members: [],
      comments: idx % 2 === 0 ? ["短版"] : [],
    })),
  };
}

function makeToursResponse(): ToursResponse {
  return {
    items: [{
      tour_id: 7,
      tour_title: "Ave Mujica LIVE TOUR 2026 Exitus",
      url: "https://example.com/live/41",
      description: null,
      bands: [{ band_id: 2, band_name: "Ave Mujica", band_abbr: "AM" }],
      start_date: "2026-05-30",
      end_date: "2026-06-02",
      collected_live_count: 2,
      stop_labels: [],
    }],
    pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
  };
}

function makeTourDetailResponse(): TourDetailResponse {
  return {
    ...makeToursResponse().items[0],
    stops: [
      {
        stop_order: 1,
        stop_label: null,
        live_id: 41,
        live_date: "2026-05-30",
        live_title: "Ave Mujica LIVE TOUR 2026 Exitus 東京公演",
        live_type: "oneman",
        venue: "Zepp Tokyo",
        bands: [2],
        url: "https://example.com/live/41",
        is_favorite: false,
        has_setlist: true,
      },
      {
        stop_order: 2,
        stop_label: null,
        live_id: 42,
        live_date: "2026-06-02",
        live_title: "Ave Mujica LIVE TOUR 2026 Exitus FINAL",
        live_type: "oneman",
        venue: "日本武道館",
        bands: [2],
        url: null,
        is_favorite: false,
        has_setlist: false,
      },
    ],
  };
}

function makeTourStatisticsResponse(): TourStatisticsResponse {
  return {
    tour_id: 7,
    coverage: { stop_count: 2, setlist_stop_count: 2, comparable_transition_count: 1 },
    overview: { distinct_song_count: 3, common_song_count: 1 },
    songs: [
      { song_id: 1, song_name: "KiLLKiSS", appearance_count: 2, first_live_id: 41, last_live_id: 42, status: "common" },
    ],
    transitions: [{
      from_live_id: 41,
      from_live_date: "2026-05-30",
      from_live_title: "Ave Mujica LIVE TOUR 2026 Exitus 東京公演",
      to_live_id: 42,
      to_live_date: "2026-06-02",
      to_live_title: "Ave Mujica LIVE TOUR 2026 Exitus FINAL",
      replacements: [{ segment_type: "main", sub_order: 1, from_song: { song_id: 2, song_name: "旧曲" }, to_song: { song_id: 3, song_name: "新曲" } }],
      added_songs: [],
      removed_songs: [],
      moved_songs: [],
    }],
  };
}

function makeSearchResponse(query: string): CatalogSearchResponse {
  return {
    query,
    lives: [
      {
        live_id: 101,
        live_date: "2026-06-01",
        live_title: "検索対象 Live",
        live_type: "oneman",
        bands: [1],
        url: "https://example.com/live/101",
        is_favorite: false,
      },
    ],
    bands: [{ band_id: 1, band_name: "Poppin'Party", band_abbr: "PoPiPa", live_count: 12 }],
    songs: [{ song_id: 7, song_name: "STAR BEAT!", band_id: 1, band_name: "Poppin'Party", live_count: 5 }],
    venues: [{ venue_id: 3, venue_name: "有明アリーナ", live_count: 4 }],
  };
}

function makeBandLivesResponse(): CatalogBandLivesResponse {
  return {
    band: { band_id: 1, band_name: "Poppin'Party", band_abbr: "PoPiPa", live_count: 2 },
    items: [
      {
        live_id: 201,
        live_date: "2026-07-01",
        live_title: "Poppin'Party Browse Live",
        live_type: "multi_act",
        bands: [1, 2],
        url: "https://example.com/live/201",
        is_favorite: false,
      },
    ],
    pagination: {
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    },
  };
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

function getTotalCount(): number {
  const text = screen.getByText(/总计 \d+ 条/).textContent ?? "";
  const match = text.match(/总计 (\d+) 条/);
  if (!match) {
    throw new Error("未找到总计条数文本");
  }
  return Number(match[1]);
}

function getPageInfo(): { page: number; totalPages: number } {
  const text = screen.getByText(/第 \d+ \/ \d+ 页/).textContent ?? "";
  const match = text.match(/第 (\d+) \/ (\d+) 页/);
  if (!match) {
    throw new Error("未找到分页文本");
  }
  return { page: Number(match[1]), totalPages: Number(match[2]) };
}

function getTableRowByLiveTitle(title: string): HTMLElement {
  const nameButton = screen.getByRole("button", { name: title });
  const row = nameButton.closest("tr");
  if (!row) {
    throw new Error(`未找到标题 ${title} 对应的表格行`);
  }
  return row as HTMLElement;
}

function renderApp(options?: { withAuthProvider?: boolean }) {
  if (options?.withAuthProvider) {
    return render(
      <AuthProvider>
        <FavoriteProvider>
          <App />
        </FavoriteProvider>
      </AuthProvider>,
    );
  }
  return render(<App />);
}

async function openAllContent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "演出资料" }));
}

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", window.location.href);
    localStorage.setItem("live-view-mode", "table");
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
    getLivesMock.mockReset();
    getPerformancesMock.mockReset();
    getPerformanceGroupDetailMock.mockReset();
    searchCatalogMock.mockReset();
    getCatalogBandsMock.mockReset();
    getCatalogBandLivesMock.mockReset();
    getCatalogStatsMock.mockReset();
    getCatalogStatisticsMock.mockReset();
    getLiveDetailMock.mockReset();
    getLiveDetailsBatchMock.mockReset();
    getAuthMeMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
    getMyFavoriteLivesMock.mockReset();
    getPerformancesMock.mockReset();
    getToursMock.mockReset();
    getTourDetailMock.mockReset();
    getTourStatisticsMock.mockReset();
    peekMyFavoriteLivesMock.mockReset();
    clearLivesCacheMock.mockReset();
    clearMyFavoriteLivesCacheMock.mockReset();
    favoriteLiveMock.mockReset();
    favoriteLivesBatchMock.mockReset();
    unfavoriteLiveMock.mockReset();
    logErrorMock.mockReset();
    getAuthMeMock.mockResolvedValue({ authenticated: false });
    loginMock.mockResolvedValue({
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    logoutMock.mockResolvedValue();
    getMyFavoriteLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 }),
    );
    getPerformancesMock.mockImplementation((_p, _s, scope, _f) =>
      Promise.resolve(
        scope === "favorites"
          ? makePerformancesResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 })
          : makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      ),
    );
    getToursMock.mockResolvedValue(makeToursResponse());
    getPerformanceGroupDetailMock.mockResolvedValue(makePerformanceGroupDetailResponse());
    getTourDetailMock.mockResolvedValue(makeTourDetailResponse());
    getTourStatisticsMock.mockResolvedValue(makeTourStatisticsResponse());
    peekMyFavoriteLivesMock.mockReturnValue(undefined);
    favoriteLiveMock.mockResolvedValue();
    favoriteLivesBatchMock.mockResolvedValue({
      action: "favorite",
      requested_count: 0,
      applied_live_ids: [],
      noop_live_ids: [],
      not_found_live_ids: [],
    });
    unfavoriteLiveMock.mockResolvedValue();
    getLiveDetailMock.mockImplementation(async (liveId: number) =>
      makeDetailResponse({ liveId, rowCount: 20 }),
    );
    getLiveDetailsBatchMock.mockResolvedValue({ items: [], missing_live_ids: [] });
    searchCatalogMock.mockResolvedValue(makeSearchResponse("Party"));
    getCatalogBandsMock.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "PoPiPa", live_count: 2 },
        { band_id: 2, band_name: "Roselia", band_abbr: "Roselia", live_count: 1 },
      ],
    });
    getCatalogBandLivesMock.mockResolvedValue(makeBandLivesResponse());
    getCatalogStatsMock.mockResolvedValue({
      band_count: 3,
      song_count: 17,
      venue_count: 3,
      latest_live_date: "2026-05-30",
      years: [2026, 2025],
    });
    getCatalogStatisticsMock.mockResolvedValue({
      scope: "all",
      filters: { year: null, live_type: null, band_id: null },
      overview: { live_count: 4, setlist_live_count: 3, band_count: 3, song_count: 15, venue_count: 3, earliest_live_date: "2026-01-03", latest_live_date: "2026-05-30" },
      years: [{ key: "2026", label: "2026 年", live_count: 4 }],
      live_types: [{ key: "oneman", label: "oneman", live_count: 1 }],
      top_songs: [{ song_id: 1, song_name: "Yes! BanG_Dream!", band_id: 1, band_name: "Poppin'Party", is_cover: false, live_count: 2, performance_count: 2, first_live_id: 38, first_live_date: "2026-01-03", first_live_title: "New Year", latest_live_id: 1, latest_live_date: "2026-03-28", latest_live_title: "Unit Live" }],
      stale_songs: [],
    });
  });

  // 测试点：公共导航可进入统计页，并展示统一接口返回的资料库指标和歌曲排行。
  test("数据统计页展示概览与高频歌曲", async () => {
    getLivesMock.mockResolvedValue(makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }));
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "数据统计" }));
    expect(await screen.findByRole("heading", { name: "数据统计" })).toBeInTheDocument();
    await waitFor(() => expect(getCatalogStatisticsMock).toHaveBeenCalledWith("all", {}));
    expect(screen.getByText("Yes! BanG_Dream!")).toBeInTheDocument();
    expect(screen.getByText("高频歌曲")).toBeInTheDocument();
  });

  test("匿名模式默认进入首页，且不显示收藏入口", async () => {
    // 测试点：未登录时默认展示社区数据库首页，不暴露收藏页签。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    expect(screen.getByRole("button", { name: "BanG Dream! Live 资料库" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BanG Dream! Live 资料库" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "我的收藏" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "我的收藏" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("47")).toBeInTheDocument());
    expect(getLivesMock).toHaveBeenCalledWith(1, 15);
  });

  // 测试点：顶层公共页签统一展示英文眉题、中文主标题和共享标题层级。
  test("公共页签使用统一的双语标题格式", async () => {
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();
    const mainNavigation = screen.getByRole("navigation", { name: "主导航" });

    expect(screen.getByText("Community live database")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BanG Dream! Live 资料库" })).toBeInTheDocument();

    await user.click(within(mainNavigation).getByRole("button", { name: "演出资料" }));
    expect(screen.getByText("Live archive")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "演出资料" })).toBeInTheDocument();

    await user.click(within(mainNavigation).getByRole("button", { name: "乐队浏览" }));
    expect(screen.getByText("Browse")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "乐队浏览" })).toBeInTheDocument();

    await user.click(within(mainNavigation).getByRole("button", { name: "联系我们" }));
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "联系我们" })).toBeInTheDocument();
  });

  test("首页数据概览展示真实指标数据", async () => {
    // 测试点：首页指标卡片应在加载完成后展示歌曲/场地统计和最近更新日期。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByText("47")).toBeInTheDocument());
    expect(screen.getByText("已收录 Live")).toBeInTheDocument();
    expect(screen.getByText("17 / 3")).toBeInTheDocument();
    expect(screen.getByText("歌曲 / 场地统计")).toBeInTheDocument();
    expect(screen.getByText("2026-05-30")).toBeInTheDocument();
    expect(screen.getByText("最近更新")).toBeInTheDocument();
    expect(getCatalogStatsMock).toHaveBeenCalled();
  });

  // 测试点：首页最近收录复用详情页，并提供进入全量列表的入口。
  test("首页最近 Live 可打开详情，并能进入演出资料", async () => {
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "示例 Live 名称 1" }));
    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(1));
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.click(screen.getByRole("button", { name: "查看全部 Live →" }));

    await waitFor(() => expect(screen.getByText("总计 47 条")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "演出资料" })).toHaveClass("active");
  });

  // 测试点：History popstate 必须把 SPA 从详情还原到实际来源页面，支持鼠标侧键。
  test("浏览器返回会还原前一个主页面和详情来源", async () => {
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "查看全部 Live →" }));
    await user.click(await screen.findByRole("button", { name: "示例 Live 名称 1" }));
    expect(window.history.state).toMatchObject({ app: "live-set-list", tab: "detail", detailLiveId: 1 });

    fireEvent.popState(window, { state: { app: "live-set-list", tab: "all" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "演出资料" })).toHaveClass("active");
  });

  test("卡片详情返回会保留已加载页并继续触发无限加载", async () => {
    // 测试点：详情期间完成的卡片分页请求不能让返回后的列表卡在第一页。
    localStorage.setItem("live-view-mode", "cards");
    const secondPage = deferred<PerformancesResponse>();
    getLivesMock.mockImplementation((requestedPage) => {
      if (requestedPage === 3) {
        return Promise.resolve(makeResponse({ page: 3, pageSize: 20, total: 60, totalPages: 3, itemCount: 20, startId: 41 }));
      }
      return Promise.resolve(makeResponse({ page: 1, pageSize: 20, total: 60, totalPages: 3, itemCount: 20 }));
    });
    getPerformancesMock.mockImplementation((requestedPage, _ps, _scope) => {
      if (requestedPage === 2) return secondPage.promise;
      if (requestedPage === 3) {
        return Promise.resolve(makePerformancesResponse({ page: 3, pageSize: 20, total: 60, totalPages: 3, itemCount: 20, startId: 41 }));
      }
      return Promise.resolve(makePerformancesResponse({ page: 1, pageSize: 20, total: 60, totalPages: 3, itemCount: 20 }));
    });

    let observerCallback: IntersectionObserverCallback | undefined;
    const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    Object.defineProperty(globalThis, "IntersectionObserver", {
      value: class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }

        observe() {}
        disconnect() {}
        unobserve() {}
      },
      writable: true,
      configurable: true,
    });

    try {
      const user = userEvent.setup();
      renderApp();
      await openAllContent(user);
      await screen.findByText("示例 Live 名称 1");

      await act(async () => {
        observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(2, 20, "all"));

      const sourceState = window.history.state;
      await user.click(screen.getByText("示例 Live 名称 1"));
      await screen.findByRole("button", { name: "返回" });
      await act(async () => {
        secondPage.resolve(makePerformancesResponse({ page: 2, pageSize: 20, total: 60, totalPages: 3, itemCount: 20, startId: 21 }));
      });
      await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(2, 20, "all"));

      await act(async () => {
        window.history.replaceState(sourceState, "", window.location.href);
        fireEvent.popState(window, { state: sourceState });
      });
      await screen.findByText("示例 Live 名称 21");

      await act(async () => {
        observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(3, 20, "all"));
      await screen.findByText("示例 Live 名称 41");
    } finally {
      if (originalObserver) {
        Object.defineProperty(globalThis, "IntersectionObserver", originalObserver);
      }
    }
  });

  // 测试点：长列表滚动超过阈值时必须提供可点击的回到顶部入口。
  test("演出资料下滑后显示回到顶部按钮并平滑滚动", async () => {
    const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true });
    window.scrollTo = vi.fn();
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    try {
      const user = userEvent.setup();
      renderApp();
      await openAllContent(user);
      fireEvent.scroll(window);

      await user.click(await screen.findByRole("button", { name: "回到顶部" }));
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    } finally {
      if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
      window.scrollTo = originalScrollTo;
    }
  });

  test("首页搜索会进入搜索结果，并可从结果打开详情", async () => {
    // 测试点：首页搜索框接入公共搜索，Live 结果继续复用现有详情弹窗。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole("searchbox", { name: "搜索入口" }), "Party");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(searchCatalogMock).toHaveBeenCalledWith("Party", 8));
    expect(await screen.findByRole("heading", { name: "搜索结果" })).toBeInTheDocument();
    expect(screen.getByText("STAR BEAT!")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "検索対象 Live" }));
    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(101));
  });

  test("搜索空结果展示明确空状态", async () => {
    // 测试点：公共搜索无任何分组结果时，应展示可理解的空结果提示。
    searchCatalogMock.mockResolvedValueOnce({ query: "不存在", lives: [], bands: [], songs: [], venues: [] });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole("searchbox", { name: "搜索入口" }), "不存在");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(await screen.findByText("没有找到与“不存在”匹配的资料。")).toBeInTheDocument();
  });

  // 测试点：乐队浏览按钮仅为存在 SVG 的 Band 渲染图案与 SVG 代表色，并保持关联 Live 可打开。
  test("乐队浏览页可加载乐队 Live 并打开详情", async () => {
    getCatalogBandsMock.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "PoPiPa", live_count: 2 },
        { band_id: 13, band_name: "No Icon Band", band_abbr: "none", live_count: 0 },
      ],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getAllByRole("button", { name: "乐队浏览" })[0]);

    await waitFor(() => expect(getCatalogBandsMock).toHaveBeenCalledWith(30));
    await waitFor(() => expect(getCatalogBandLivesMock).toHaveBeenCalledWith(1, 1, 20));
    const bandWithIcon = screen.getByRole("button", { name: "Poppin'Party 2 场" });
    const bandWithoutIcon = screen.getByRole("button", { name: "No Icon Band 0 场" });
    expect(bandWithIcon).toHaveClass("has-band-art");
    expect(bandWithIcon.querySelector(".catalog-band-btn-art")).toHaveAttribute("src", "/icons/Band_1.svg");
    expect(bandWithIcon.style.getPropertyValue("--band-color")).toBe("#ff3377");
    expect(bandWithoutIcon).not.toHaveClass("has-band-art");
    expect(bandWithoutIcon.querySelector(".catalog-band-btn-art")).toBeNull();
    expect(bandWithoutIcon.style.getPropertyValue("--band-color")).toBe("");
    await user.click(await screen.findByRole("button", { name: "Poppin'Party Browse Live" }));
    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(201));
  });

  test("详情页不显示反馈入口", async () => {
    // 测试点：Live 详情页不再展示反馈入口，反馈路径集中到联系我们页。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("button", { name: "示例 Live 名称 1" }));

    expect(screen.queryByRole("button", { name: "发现问题 / 补充信息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "反馈与补充信息" })).not.toBeInTheDocument();
  });

  // 测试点：匿名模式下控制台页签必须隐藏，避免未登录用户触发控制台逻辑。
  test("未登录时不显示控制台入口", async () => {
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "演出资料" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "控制台" })).not.toBeInTheDocument();
  });

  // 测试点：viewer 可在演出资料中使用仅收藏切换，但仍不应看到控制台页签。
  test("viewer 角色登录后不显示控制台入口", async () => {
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "viewer", display_name: "Viewer", role: "viewer" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp({ withAuthProvider: true });

    await userEvent.setup().click(await screen.findByRole("button", { name: "演出资料" }));
    expect(screen.getByRole("button", { name: "仅收藏" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "控制台" })).not.toBeInTheDocument();
  });

  // 测试点：admin 可进入控制台，且控制台沿用统一的英文眉题和中文主标题。
  test("admin 角色登录后显示控制台入口", async () => {
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp({ withAuthProvider: true });

    const consoleButton = await screen.findByRole("button", { name: "控制台" });
    await userEvent.setup().click(consoleButton);
    expect(screen.getByText("Console")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "控制台" })).toBeInTheDocument();
  });

  test("全量页存在未收藏条目时，显示收藏本页按钮并触发 batch 收藏", async () => {
    // 测试点：混合收藏状态下，批量按钮应进入“收藏本页”动作，并只发一次 batch 请求。
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    favoriteLivesBatchMock.mockResolvedValueOnce({
      action: "favorite",
      requested_count: 20,
      applied_live_ids: Array.from({ length: 18 }, (_, idx) => idx + 3),
      noop_live_ids: [1, 2],
      not_found_live_ids: [],
    });
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "收藏本页" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "收藏本页" }));

    expect(favoriteLivesBatchMock).toHaveBeenCalledWith(
      "favorite",
      Array.from({ length: 20 }, (_, idx) => idx + 1),
      "csrf-token",
    );
    expect(favoriteLivesBatchMock).toHaveBeenCalledTimes(1);
    expect(favoriteLiveMock).toHaveBeenCalledTimes(0);
    expect(unfavoriteLiveMock).toHaveBeenCalledTimes(0);
  });

  test("全量页已全收藏时，显示取消收藏本页按钮并触发 batch 取消收藏", async () => {
    // 测试点：当当前页全部已收藏时，批量按钮切到“取消收藏本页”动作。
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: Array.from({ length: 20 }, (_, idx) => idx + 1),
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    favoriteLivesBatchMock.mockResolvedValueOnce({
      action: "unfavorite",
      requested_count: 20,
      applied_live_ids: Array.from({ length: 20 }, (_, idx) => idx + 1),
      noop_live_ids: [],
      not_found_live_ids: [],
    });
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "取消收藏本页" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "取消收藏本页" }));

    expect(favoriteLivesBatchMock).toHaveBeenCalledWith(
      "unfavorite",
      Array.from({ length: 20 }, (_, idx) => idx + 1),
      "csrf-token",
    );
    expect(favoriteLivesBatchMock).toHaveBeenCalledTimes(1);
    expect(favoriteLiveMock).toHaveBeenCalledTimes(0);
    expect(unfavoriteLiveMock).toHaveBeenCalledTimes(0);
  });

  // 测试点：收藏不再占用独立导航页签，而是在演出资料内作为范围切换。
  test("已登录时演出资料页显示范围切换、收藏列和星标按钮", async () => {
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await user.click(await screen.findByRole("button", { name: "演出资料" }));

    expect(screen.getByRole("button", { name: "演出资料" })).toHaveClass("active");
    expect(screen.queryByRole("button", { name: "我的收藏" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "仅收藏" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("columnheader", { name: /收藏/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏本页" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
  });

  // 测试点：仅收藏切换保留服务端收藏列表接口，并在同一页面替换数据范围。
  test("已登录时仅收藏范围走服务端接口，并展示服务端收藏列表", async () => {
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValueOnce(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValueOnce(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 }),
    );

    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);
    await user.click(screen.getByRole("button", { name: "仅收藏" }));
    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(1, 20, "favorites"));
    expect(screen.getByRole("button", { name: "仅收藏" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "演出资料" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument();
  });

  // 测试点：未登录模式下不应该渲染收藏星标按钮。
  test("匿名模式不显示星标入口", async () => {
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    await userEvent.setup().click(await screen.findByRole("button", { name: "演出资料" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "取消收藏" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入收藏" })).not.toBeInTheDocument();
  });

  // 测试点：从演出资料打开多日活动组详情后，主导航仍应把它归入演出资料。
  test("多日 Live 详情保持演出资料导航高亮", async () => {
    getPerformancesMock.mockResolvedValue({
      items: [{
        kind: "performance_group",
        performance_group: {
          kind: "performance_group",
          group_id: 88,
          group_title: "示例多日 Live",
          start_date: "2026-08-01",
          end_date: "2026-08-02",
          day_count: 2,
          live_count: 2,
          display_type: "multi_day",
          bands: [{ band_id: 1, band_name: "Band 1", band_abbr: "B1" }],
          venues: ["测试场地"],
        },
      }],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    });
    const user = userEvent.setup();
    renderApp();

    await openAllContent(user);
    await user.click(await screen.findByRole("button", { name: "示例多日 Live" }));

    await waitFor(() => expect(getPerformanceGroupDetailMock).toHaveBeenCalledWith(88));
    expect(screen.getByRole("navigation", { name: "活动组场次" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "演出资料" })).toHaveClass("active");
  });

  // 测试点：巡演资料复用演出列表的筛选、总计、内容顺序和 pager 间距容器。
  test("巡演资料页签展示聚合资料并支持独立筛选", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "巡演资料" }));

    await waitFor(() => expect(getToursMock).toHaveBeenCalledWith(1, 20, {
      q: undefined,
      year: undefined,
      bandId: undefined,
      sort: "date_desc",
    }));
    expect(screen.getByRole("button", { name: "巡演资料" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "演出资料" })).not.toHaveClass("active");
    expect(screen.queryByRole("button", { name: "仅收藏" })).not.toBeInTheDocument();
    const tourTitle = screen.getByText("Ave Mujica LIVE TOUR 2026 Exitus");
    const tourCard = tourTitle.closest("article") as HTMLElement;
    const filterPanel = screen.getByRole("region", { name: "巡演列表筛选" });
    const totalText = screen.getByText("总计 1 个巡演");
    expect(totalText.closest("footer")).toHaveClass("pager");
    expect(filterPanel.compareDocumentPosition(totalText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(totalText.compareDocumentPosition(tourCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tourCard).toHaveClass("live-card");
    expect(screen.queryByRole("button", { name: "Ave Mujica LIVE TOUR 2026 Exitus" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看巡演" })).not.toBeInTheDocument();
    expect(screen.getByText("已收录 2 场")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Band 2" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("关键词"), "Exitus");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => expect(getToursMock).toHaveBeenLastCalledWith(1, 20, {
      q: "Exitus",
      year: undefined,
      bandId: undefined,
      sort: "date_desc",
    }));
  });

  // 测试点：巡演场次导航只保留用竖向分隔条分开的缩写，点击后在当前页内切换 Live 详情。
  test("巡演详情在页内切换缩写后的 Live 场次", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "巡演资料" }));
    await user.click(await screen.findByText("Ave Mujica LIVE TOUR 2026 Exitus"));

    await waitFor(() => expect(getTourDetailMock).toHaveBeenCalledWith(7));
    const stopNavigation = screen.getByRole("navigation", { name: "巡演场次" });
    expect(within(stopNavigation).getAllByRole("button").map((button) => button.textContent)).toEqual(["東京公演", "FINAL"]);
    expect(stopNavigation).toHaveTextContent("東京公演FINAL");
    expect(stopNavigation.querySelectorAll(".tour-stop-separator")).toHaveLength(1);
    expect(within(stopNavigation).queryByText("/")).not.toBeInTheDocument();
    expect(within(stopNavigation).queryByText("2026-05-30")).not.toBeInTheDocument();
    expect(within(stopNavigation).queryByText("Zepp Tokyo")).not.toBeInTheDocument();
    expect(screen.getByText("已收录日期：").closest("p")).toHaveClass("detail-inline-item", "detail-inline-item-date");
    expect(screen.queryByRole("button", { name: "查看 Live" })).not.toBeInTheDocument();
    expect(screen.queryByText("已有 Setlist")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无 Setlist")).not.toBeInTheDocument();
    expect(screen.queryByText("stop_label")).not.toBeInTheDocument();

    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(41));
    expect(screen.getByText("曲目名称")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "FINAL" }));
    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(42));
    expect(getTourDetailMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "场次详情" })).toHaveAttribute("aria-selected", "true");
  });

  // 测试点：巡演统计按需加载时间线差异，并可从歌单变化面板切回对应 Live 详情。
  test("巡演统计按需加载场次变化", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "巡演资料" }));
    await user.click(await screen.findByText("Ave Mujica LIVE TOUR 2026 Exitus"));
    await waitFor(() => expect(getTourDetailMock).toHaveBeenCalledWith(7));

    expect(getTourStatisticsMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "巡演统计" }));
    await waitFor(() => expect(getTourStatisticsMock).toHaveBeenCalledWith(7));
    const progress = await screen.findByRole("navigation", { name: "场次进程" });
    expect(within(progress).getByRole("button", { name: /对比上一场.*1 项变化/ })).toHaveAttribute("aria-pressed", "true");
    const changePanel = screen.getByRole("region", { name: "歌单变化" });
    expect(within(changePanel).getByRole("heading", { name: "同位置更换" })).toBeInTheDocument();
    expect(changePanel).toHaveTextContent("旧曲→新曲");
    expect(screen.queryByRole("table", { name: "场次变化" })).not.toBeInTheDocument();
    await user.click(within(changePanel).getByRole("button", { name: "FINAL" }));
    expect(screen.getByRole("tab", { name: "场次详情" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(42));
  });

  // 测试点：巡演及页内 Live 详情继续复用既有 SVG 外链图标，精简场次导航不再重复来源链接。
  test("巡演详情复用既有外链样式", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "巡演资料" }));
    await user.click(await screen.findByText("Ave Mujica LIVE TOUR 2026 Exitus"));

    await waitFor(() => expect(getTourDetailMock).toHaveBeenCalledWith(7));
    const titleLink = screen.getByRole("link", { name: "Ave Mujica LIVE TOUR 2026 Exitus" });
    expect(titleLink.querySelector(".detail-title-link-icon svg")).not.toBeNull();
    expect(screen.queryByText("↗")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "🔗" })).not.toBeInTheDocument();
  });

  test("匿名用户点击仅收藏会打开登录弹窗", async () => {
    // 测试点：仅收藏切换始终可发现，但匿名用户使用时必须先通过登录闸门。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await screen.findAllByRole("button", { name: "登录" });
    await openAllContent(user);

    await user.click(screen.getByRole("button", { name: "仅收藏" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
  });

  test("登录成功后切换到已登录模式并显示收藏入口", async () => {
    // 测试点：用户登录成功后显示首页收藏快捷入口，并可打开用户下拉看到用户名/角色/退出。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await user.click(await screen.findByRole("button", { name: "登录" }));
    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "test-admin-pass");
    const loginButtons = screen.getAllByRole("button", { name: /^登录$/ });
    await user.click(loginButtons[loginButtons.length - 1]);

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("admin", "test-admin-pass"));
    expect(screen.getByRole("button", { name: /查看我的收藏/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BanG Dream! Live 资料库" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "用户菜单：Administrator" }));
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("账户：admin")).toBeInTheDocument();
    expect(screen.getByText("角色：admin")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();
  });

  test("登录弹窗使用紧凑样式，避免被通用 modal 尺寸覆盖", async () => {
    // 测试点：登录弹窗应命中 .modal.login-modal 的覆盖样式，不再使用通用 .modal 的大弹窗布局。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    const { container } = renderApp();

    await user.click((await screen.findAllByRole("button", { name: "登录" }))[0]);
    const loginModal = container.querySelector(".modal.login-modal");
    expect(loginModal).not.toBeNull();
    const style = getComputedStyle(loginModal as HTMLElement);
    expect(style.display).toBe("block");
    expect(style.height).toBe("auto");
  });

  test("从全量切到收藏时不会残留上一轮全量结果", async () => {
    // 测试点：切到收藏页后，在收藏接口返回前应先清空旧列表，只显示加载态。
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValueOnce(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const deferredFavorites = deferred<PerformancesResponse>();
    getPerformancesMock.mockImplementationOnce(() => deferredFavorites.promise);
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "仅收藏" }));

    expect(screen.queryByRole("button", { name: "示例 Live 名称 1" })).not.toBeInTheDocument();
    expect(screen.getByText("加载中...")).toBeInTheDocument();

    deferredFavorites.resolve(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 }),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument());
  });

  // 测试点：同一登录态下已访问过的全量/收藏页再次切回时，应直接命中本地快照。
  test("已加载过的页签再次切回时会直接复用快照，不重复显示刷新态", async () => {
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockImplementation((_p, _s, scope, _f) =>
      Promise.resolve(
        scope === "favorites"
          ? makePerformancesResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 })
          : makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      ),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "仅收藏" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "演出资料" }));

    expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(getPerformancesMock).toHaveBeenCalledTimes(2);
  });

  test("收藏页预读使用统一投影，切换时不会额外刷新 auth/me", async () => {
    // 测试点：全量页空闲预读收藏聚合投影，切换范围不应重复请求登录态。
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    idleWindow.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    idleWindow.cancelIdleCallback = vi.fn();

    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockImplementation((_p, _s, scope, _f) =>
      Promise.resolve(
        scope === "favorites"
          ? makePerformancesResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 })
          : makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      ),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);

    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(1, 20, "favorites"));
    expect(getAuthMeMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "仅收藏" }));

    expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument();
    expect(getAuthMeMock).toHaveBeenCalledTimes(1);
  });

  test("分页和每页条数切换正常工作", async () => {
    // 测试点：分页跳转与 15/20 行切换后页码计算正确。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 21 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const total = getTotalCount();
    const firstPageInfo = getPageInfo();
    expect(firstPageInfo.page).toBe(1);
    expect(firstPageInfo.totalPages).toBe(Math.ceil(total / 20));

    await user.click(screen.getByRole("button", { name: "下一页" }));
    const secondPageInfo = getPageInfo();
    expect(secondPageInfo.page).toBe(Math.min(2, secondPageInfo.totalPages));

    await user.selectOptions(screen.getByLabelText("每页行数"), "15");
    const pageInfoAfterResize = getPageInfo();
    expect(pageInfoAfterResize.page).toBe(1);
    expect(pageInfoAfterResize.totalPages).toBe(Math.ceil(total / 15));
  });

  test("跳转页输入框支持回车跳转到目标页", async () => {
    // 测试点：在“跳转至第（）页”输入页码后按回车，应请求对应页并更新分页显示。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 3, pageSize: 20, total: 47, totalPages: 3, itemCount: 7, startId: 41 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const jumpInput = screen.getByRole("textbox");
    await user.clear(jumpInput);
    await user.type(jumpInput, "3{Enter}");

    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(3, 20, "all"));
    await waitFor(() => expect(screen.getByText("第 3 / 3 页")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "示例 Live 名称 41" })).toBeInTheDocument();
  });

  test("翻页后主表仍保持固定布局，避免列间距抖动", async () => {
    // 测试点：第一页到下一页（超长标题）后，表格仍为 fixed 布局，列宽分配不受内容长度影响。
    const page1 = makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 });
    const page2Items = makeItems(20, 21, true).map((item) => ({
      ...item,
      live_title: `超长标题${"非常长".repeat(30)}-${item.live_id}`,
    }));
    const page2: PerformancesResponse = {
      items: page2Items.map((live) => ({ kind: "live" as const, live })),
      pagination: {
        page: 2,
        page_size: 20,
        total: 47,
        total_pages: 3,
      },
    };

    getLivesMock
      .mockResolvedValueOnce(makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }));
    getPerformancesMock
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const firstTable = screen.getByRole("table");
    expect(getComputedStyle(firstTable).tableLayout).toBe("fixed");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(async () => {
      const longTitleButtons = await screen.findAllByRole("button", { name: /超长标题/ });
      expect(longTitleButtons.length).toBeGreaterThan(0);
    });

    const secondTable = screen.getByRole("table");
    expect(getComputedStyle(secondTable).tableLayout).toBe("fixed");
  });

  test("点击 live 名称打开详情页并可返回", async () => {
    // 测试点：详情查看路径（打开/返回）可用。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const firstLiveButton = screen.getAllByRole("button", { name: /示例 Live 名称/ })[0];
    const firstLiveName = firstLiveButton.textContent ?? "";
    await user.click(firstLiveButton);
    expect(screen.getByRole("heading", { name: firstLiveName })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("heading", { name: firstLiveName })).not.toBeInTheDocument();
  });

  test("详情页格式正确：返回按钮、基础信息、详情表格", async () => {
    // 测试点：验证详情页的布局结构是否完整（返回按钮、meta 信息、标题链接、表格结构）。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    const { container } = renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    // 返回按钮
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();

    // 基础信息行
    expect(screen.getByText("日期：")).toBeInTheDocument();
    expect(screen.getByText("乐队：")).toBeInTheDocument();
    expect(screen.getByText("开场：")).toBeInTheDocument();
    expect(screen.getByText("开演：")).toBeInTheDocument();
    expect(screen.getByText("场地：")).toBeInTheDocument();
    expect(screen.getByText("17:00(CN)")).toBeInTheDocument();
    expect(screen.getByText("18:00(JP)")).toBeInTheDocument();
    expect(screen.getByText("测试场地")).toBeInTheDocument();
    const titleLink = screen.getByRole("link", { name: /示例 Live 名称 1/i });
    expect(titleLink).toHaveAttribute("href", "https://example.com/live/1");

    // 详情表格结构（已替换为独立的 5 列成员状态表）
    expect(screen.getByRole("columnheader", { name: "编号" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "曲目名称" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "乐队成员" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "其他成员" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "备注" })).toBeInTheDocument();

    const detailTable = container.querySelector(".detail-member-table-wrap .console-table");
    expect(detailTable).not.toBeNull();
    await waitFor(() => {
      expect(within(detailTable as HTMLElement).getAllByRole("row")).toHaveLength(21);
    });
    expect(getLiveDetailMock).toHaveBeenCalledWith(1);
  });

  test("详情弹窗信息区使用统一的对齐结构", async () => {
    // 测试点：日期/开场/开演/场地应共用同一套 inline 信息项结构，避免标签列再次错位。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    const { container } = renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    const metaLine = container.querySelector(".detail-meta-line");
    expect(metaLine).not.toBeNull();
    const metaItems = Array.from(metaLine?.querySelectorAll("p") ?? []);
    expect(metaItems).toHaveLength(5);
    metaItems.forEach((item) => expect(item).toHaveClass("detail-inline-item"));

    const dateRow = screen.getByText("日期：").closest("p");
    const openingRow = screen.getByText("开场：").closest("p");
    const venueRow = screen.getByText("场地：").closest("p");
    const typeRow = screen.getByText("类型：").closest("p");

    expect(dateRow).toHaveClass("detail-inline-item", "detail-inline-item-date");
    expect(openingRow).toHaveClass("detail-inline-item");
    expect(venueRow).toHaveClass("detail-inline-item", "detail-inline-item-venue");
    expect(typeRow).toHaveClass("detail-inline-item", "detail-inline-item-type");
    expect(screen.getByText("类型：").parentElement).toHaveTextContent("类型：专场");
    expect(screen.getByText("乐队：").closest("p")).toHaveClass("detail-row");
  });

  test("详情页返回按钮可回到列表页", async () => {
    // 测试点：点击返回按钮后详情页应消失，列表页应重新展示。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
  });

  test("详情页返回按钮样式类名正确", async () => {
    // 测试点：看护返回按钮的样式类，避免回归改坏。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    const backBtn = screen.getByRole("button", { name: "返回" });
    expect(backBtn).toHaveClass("detail-back-btn");

    const backGlyph = within(backBtn).getByText("✕");
    expect(backGlyph).toHaveClass("modal-action-glyph", "close");
  });

  test("详情弹窗在 url 为空时标题不渲染超链接", async () => {
    // 测试点：详情弹窗没有 url 时，标题保持普通文本，不显示标题链接。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, withUrl: false }),
    );
    getLiveDetailMock.mockResolvedValueOnce(makeDetailResponse({ liveId: 1, url: null }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));
    expect(screen.getByRole("heading", { name: "示例 Live 名称 1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /示例 Live 名称 1/i })).not.toBeInTheDocument();
  });

  test("URL 列使用链接图标并携带正确链接", async () => {
    // 测试点：URL 列展示为 🔗，并指向对应详情地址。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, withUrl: true }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, withUrl: true }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => {
      const firstLink = screen.getAllByRole("link", { name: "🔗" })[0];
      expect(firstLink.getAttribute("href")).toMatch(/^https:\/\/example\.com\/live\/\d+$/);
    });
  });

  test("乐队列渲染图标单元格", async () => {
    // 测试点：乐队列应渲染图标容器与 SVG 图标。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => {
      const firstBandCell = screen.getAllByTitle(/支乐队/)[0];
      const bandIcons = within(firstBandCell).getAllByRole("img", { name: /Band \d+/ });
      expect(bandIcons.length).toBeGreaterThan(0);
      bandIcons.forEach((icon) => {
        expect(icon.getAttribute("src")).toMatch(/^\/icons\/Band_\d+\.svg$/);
      });
    });
  });

  test("空 bands 的 live 不渲染默认乐队图标", async () => {
    // 测试点：没有 setlist 乐队信息的 live 应展示空乐队格，不回退成 Band_1 图标。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 1, totalPages: 1, itemCount: 1, startId: 999 }),
    );
    getPerformancesMock.mockResolvedValue({
      items: [
        {
          kind: "live" as const,
          live: {
            live_id: 999,
            live_date: "2026-05-31",
            live_title: "No Setlist Live",
            live_type: "other",
            bands: [],
            url: null,
            is_favorite: false,
          },
        },
      ],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    });
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => {
      const bandCell = screen.getByTitle("0 支乐队");
      expect(within(bandCell).queryByRole("img")).not.toBeInTheDocument();
    });
  });

  test("首次加载请求参数正确，切换每页数量后重新请求", async () => {
    // 测试点：进入全量页后请求 page=1&page_size=20，切到 15 后重新请求 page_size=15。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(1, 20, "all"));
    await user.selectOptions(screen.getByLabelText("每页行数"), "15");
    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(1, 15, "all"));
  });

  test("首次加载后会对当前页触发批量详情预读", async () => {
    // 测试点：首页加载完成后，使用当前页 live_id 列表调用 batch 详情接口。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledTimes(1));
    expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([1, 2, 3]);
  });

  test("批量详情预读超时不影响主列表渲染", async () => {
    // 测试点：POST /api/lives/details:batch 超时后，页面主流程仍应正常展示列表。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    getLiveDetailsBatchMock.mockRejectedValueOnce(new Error("Request timeout"));
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([1, 2, 3]));
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    expect(screen.queryByText(/数据加载失败/)).not.toBeInTheDocument();
  });

  test("切换标签会触发当前页详情预读", async () => {
    // 测试点：已登录后在“全量/收藏”之间切换，应对当前页重新触发 batch 预读。
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    getPerformancesMock.mockImplementation((_p, _s, scope, _f) =>
      Promise.resolve(
        scope === "favorites"
          ? makePerformancesResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 })
          : makePerformancesResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
      ),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await openAllContent(user);

    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([1, 2, 3]));
    await user.click(screen.getByRole("button", { name: "仅收藏" }));
    await waitFor(() => expect(getLiveDetailsBatchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(getLiveDetailsBatchMock).toHaveBeenLastCalledWith([101, 102]);
  });

  test("翻页会触发对应页码请求", async () => {
    // 测试点：点击下一页/上一页会触发 page 参数变化。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 21 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);
    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(1, 20, "all"));

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(2, 20, "all"));

    await user.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(1, 20, "all"));
  });

  test("翻页后会对新页数据触发批量详情预读", async () => {
    // 测试点：翻页成功后，batch 预读应切换到新页的 live_id 列表。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 2, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 2, startId: 21 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([1, 2]));
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([21, 22]));
  });

  test("浏览器空闲时会预读下一页列表与详情", async () => {
    // 测试点：支持 requestIdleCallback 时，当前页后会在空闲阶段预读下一页。
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    idleWindow.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    idleWindow.cancelIdleCallback = vi.fn();

    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 40, totalPages: 3, itemCount: 15 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 2, pageSize: 20, total: 40, totalPages: 2, itemCount: 2, startId: 21 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 40, totalPages: 2, itemCount: 2, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 2, pageSize: 20, total: 40, totalPages: 2, itemCount: 2, startId: 21 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => expect(getPerformancesMock).toHaveBeenCalledWith(2, 20, "all"));
    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([21, 22]));
  });

  test("分页总计与总页数以后端返回为准", async () => {
    // 测试点：显示使用 pagination.total/total_pages，而非本地 items 长度。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 120, totalPages: 6, itemCount: 3 }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 120, totalPages: 6, itemCount: 3 }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => {
      expect(screen.getByText("总计 120 条")).toBeInTheDocument();
      expect(screen.getByText("第 1 / 6 页")).toBeInTheDocument();
    });
  });

  test("后端校正页码后，前端页码显示会同步到纠正结果且不重复请求", async () => {
    // 测试点：后端返回 canonical page 时，前端应同步显示该页并复用这次响应，不再冗余补请求。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 40, totalPages: 3, itemCount: 15 }),
      );
    getPerformancesMock
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 40, totalPages: 2, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makePerformancesResponse({ page: 1, pageSize: 20, total: 20, totalPages: 1, itemCount: 20 }),
      );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
      expect(screen.getByText("总计 20 条")).toBeInTheDocument();
    });
    expect(getPerformancesMock).toHaveBeenCalledTimes(2);
    expect(getPerformancesMock).toHaveBeenNthCalledWith(2, 2, 20, "all");
  });

  test("url 为空时显示 '-' 且不渲染链接", async () => {
    // 测试点：url 为 null 的行应该显示 '-'，不应出现 🔗 链接。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3, withUrl: false }),
    );
    getPerformancesMock.mockResolvedValue(
      makePerformancesResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3, withUrl: false }),
    );
    const user = userEvent.setup();
    render(<App />);
    await openAllContent(user);

    await waitFor(() => {
      expect(screen.getAllByText("-").length).toBeGreaterThan(0);
      expect(screen.queryByRole("link", { name: "🔗" })).not.toBeInTheDocument();
    });
  });

  test("请求中显示加载态，成功后消失并展示数据", async () => {
    // 测试点：接口未返回前显示"加载中..."，返回后渲染列表数据。
    const d = deferred<PerformancesResponse>();
    getLivesMock
      .mockResolvedValueOnce(makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }));
    getPerformancesMock
      .mockImplementationOnce(() => d.promise);
    const user = userEvent.setup();
    render(<App />);

    await openAllContent(user);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
    d.resolve(makePerformancesResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }));
    await waitFor(() => {
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument();
    });
  });

  test("请求失败时显示错误提示且分页区域可见", async () => {
    // 测试点：接口异常时页面不崩溃，显示错误文案并保留分页区域。
    getLivesMock
      .mockResolvedValueOnce(makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }));
    getPerformancesMock
      .mockRejectedValueOnce(new Error("Request failed: 500"));
    const user = userEvent.setup();
    render(<App />);
    await openAllContent(user);

    await waitFor(() => {
      expect(screen.getByText("数据加载失败: Request failed: 500")).toBeInTheDocument();
      expect(screen.getByText(/第 \d+ \/ \d+ 页/)).toBeInTheDocument();
    });
  });

  test("列表加载失败时会记录页面级错误日志", async () => {
    // 测试点：列表请求失败后，页面 catch 会记录带分页上下文的业务日志。
    getLivesMock
      .mockResolvedValueOnce(makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }));
    getPerformancesMock
      .mockRejectedValueOnce(new Error("Request failed: 500"));
    const user = userEvent.setup();
    render(<App />);
    await openAllContent(user);

    await waitFor(() => {
      expect(logErrorMock).toHaveBeenCalledWith(
        "load_lives_failed",
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          message: "Request failed: 500",
        }),
      );
    });
  });

  test("详情加载失败时会记录页面级错误日志", async () => {
    // 测试点：详情请求失败后，页面 catch 会记录 liveId 和错误信息，便于定位具体弹窗失败。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getLiveDetailMock.mockRejectedValueOnce(new Error("Request failed: 500"));
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    await waitFor(() => {
      expect(logErrorMock).toHaveBeenCalledWith(
        "load_live_detail_failed",
        expect.objectContaining({
          liveId: 1,
          message: "Request failed: 500",
        }),
      );
    });
  });

  // 测试点：登录后切换分页，收藏操作仍会按同一 live_id 发到服务端。
  test("跨页后收藏状态仍按 live_id 生效", async () => {
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 21 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 1 }),
      );
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await user.click(screen.getByRole("button", { name: "演出资料" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);
    await waitFor(() => expect(unfavoriteLiveMock).toHaveBeenCalledWith(1, "csrf-token"));
  });

  test("主题按钮支持跟随系统、夜间、浅色三态循环", async () => {
    // 测试点：顶部主题按钮应支持 system -> dark -> light -> system 的循环切换。
    window.localStorage.setItem("live-theme-mode", "system");
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    const systemButton = await screen.findByRole("button", {
      name: "当前跟随系统（浅色），单击锁定夜间模式",
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await user.click(systemButton);
    expect(
      screen.getByRole("button", { name: "当前夜间模式，单击切换到浅色模式" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("live-theme-mode")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "当前夜间模式，单击切换到浅色模式" }));
    expect(
      screen.getByRole("button", { name: "当前浅色模式，单击切换到跟随系统" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("live-theme-mode")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await user.click(screen.getByRole("button", { name: "当前浅色模式，单击切换到跟随系统" }));
    expect(
      screen.getByRole("button", { name: "当前跟随系统（浅色），单击锁定夜间模式" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("live-theme-mode")).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  test("卡片模式下渲染 live-card-grid 而非表格", async () => {
    // 测试点：切换到卡片模式后应展示卡片 grid，不渲染表格元素。
    localStorage.setItem("live-view-mode", "cards");
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    expect(document.querySelector(".live-card-grid")).not.toBeNull();
    expect(document.querySelector(".live-card")).not.toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("示例 Live 名称 1")).toBeInTheDocument();
    expect(screen.getByText("2026-03-02")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "🔗" }).length).toBeGreaterThan(0);
  });

  test("视图切换按钮可在卡片与表格模式间切换", async () => {
    // 测试点：点击单按钮可在卡片/表格间切换，localStorage 跟随更新。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    expect(document.querySelector(".table-wrap")).not.toBeNull();
    expect(screen.getByRole("button", { name: "切换为卡片模式" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换为卡片模式" }));
    expect(document.querySelector(".live-card-grid")).not.toBeNull();
    expect(screen.getByRole("button", { name: "切换为表格模式" })).toBeInTheDocument();
    expect(localStorage.getItem("live-view-mode")).toBe("cards");

    await user.click(screen.getByRole("button", { name: "切换为表格模式" }));
    await waitFor(() => expect(document.querySelector(".table-wrap")).not.toBeNull());
    expect(screen.getByRole("button", { name: "切换为卡片模式" })).toBeInTheDocument();
    expect(localStorage.getItem("live-view-mode")).toBe("table");
  });

  // 测试点：关键词、年份、类型、乐队和排序会共同刷新服务端列表，年份与乐队只显示名称。
  test("演出资料筛选栏提交共享筛选参数且选项不显示数量", async () => {
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 6, totalPages: 1, itemCount: 6 }),
    );
    const user = userEvent.setup();
    renderApp();
    await openAllContent(user);

    await user.clear(screen.getByLabelText("关键词"));
    await user.type(screen.getByLabelText("关键词"), "Roselia");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.selectOptions(screen.getByLabelText("年份"), "2026");
    await user.selectOptions(screen.getByLabelText("Live 类型"), "oneman");
    await user.selectOptions(screen.getByLabelText("乐队 / 艺人"), "2");
    await user.selectOptions(screen.getByLabelText("排序"), "date_asc");

    await waitFor(() => {
      expect(getPerformancesMock).toHaveBeenLastCalledWith(1, 20, "all", {
        q: "Roselia",
        year: 2026,
        live_type: "oneman",
        band_id: 2,
        sort: "date_asc",
      });
    });
    expect(screen.getByRole("option", { name: "2026" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Roselia" })).toBeInTheDocument();
    expect(screen.queryByText(/（\d+）/)).not.toBeInTheDocument();
  });

});

