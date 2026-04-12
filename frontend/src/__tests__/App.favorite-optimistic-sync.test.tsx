import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import App from "../App";
import { AuthProvider } from "../auth/AuthProvider";
import { FavoriteProvider } from "../favorites/FavoriteProvider";
import {
  ApiError,
  favoriteLive,
  favoriteLivesBatch,
  getAuthMe,
  getLiveDetail,
  getLiveDetailsBatch,
  getLives,
  getMyFavoriteLives,
  login,
  logout,
  peekMyFavoriteLives,
  clearMyFavoriteLivesCache,
  unfavoriteLive,
  type LiveDetailResponse,
  type LivesResponse,
} from "../api";

vi.mock("../api", () => ({
  getLives: vi.fn(),
  getLiveDetail: vi.fn(),
  getLiveDetailsBatch: vi.fn(),
  getAuthMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  getMyFavoriteLives: vi.fn(),
  peekMyFavoriteLives: vi.fn(),
  clearMyFavoriteLivesCache: vi.fn(),
  favoriteLive: vi.fn(),
  favoriteLivesBatch: vi.fn(),
  unfavoriteLive: vi.fn(),
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
const getLiveDetailMock = vi.mocked(getLiveDetail);
const getLiveDetailsBatchMock = vi.mocked(getLiveDetailsBatch);
const getAuthMeMock = vi.mocked(getAuthMe);
const loginMock = vi.mocked(login);
const logoutMock = vi.mocked(logout);
const getMyFavoriteLivesMock = vi.mocked(getMyFavoriteLives);
const peekMyFavoriteLivesMock = vi.mocked(peekMyFavoriteLives);
const clearMyFavoriteLivesCacheMock = vi.mocked(clearMyFavoriteLivesCache);
const favoriteLiveMock = vi.mocked(favoriteLive);
const favoriteLivesBatchMock = vi.mocked(favoriteLivesBatch);
const unfavoriteLiveMock = vi.mocked(unfavoriteLive);

function makeItems(count: number, startId = 1, withUrl = true) {
  return Array.from({ length: count }, (_, idx) => {
    const id = startId + idx;
    return {
      live_id: id,
      live_date: `2026-03-${String((id % 28) + 1).padStart(2, "0")}`,
      live_title: `示例 Live 名称 ${id}`,
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

function makeDetailResponse(params: { liveId: number; rowCount?: number }): LiveDetailResponse {
  const rowCount = params.rowCount ?? 20;
  return {
    live_id: params.liveId,
    live_date: "2026-03-28",
    live_title: `示例 Live 名称 ${params.liveId}`,
    venue: "测试场地",
    opening_time: "17:00:00+08:00",
    start_time: "18:00:00+09:00",
    bands: [1, 2],
    band_names: ["Band 1", "Band 2"],
    url: `https://example.com/live/${params.liveId}`,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function getTableRowByLiveTitle(title: string): HTMLElement {
  const nameButton = screen.getByRole("button", { name: title });
  const row = nameButton.closest("tr");
  if (!row) {
    throw new Error(`未找到标题 ${title} 对应的表格行`);
  }
  return row as HTMLElement;
}

function renderApp() {
  return render(
    <AuthProvider>
      <FavoriteProvider>
        <App />
      </FavoriteProvider>
    </AuthProvider>,
  );
}

describe("App optimistic favorite sync", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");

    getLivesMock.mockReset();
    getLiveDetailMock.mockReset();
    getLiveDetailsBatchMock.mockReset();
    getAuthMeMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
    getMyFavoriteLivesMock.mockReset();
    peekMyFavoriteLivesMock.mockReset();
    clearMyFavoriteLivesCacheMock.mockReset();
    favoriteLiveMock.mockReset();
    favoriteLivesBatchMock.mockReset();
    unfavoriteLiveMock.mockReset();

    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    loginMock.mockResolvedValue({
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    logoutMock.mockResolvedValue();
    getMyFavoriteLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2 }),
    );
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
  });

  test("点击收藏后会立即乐观切换星标，且按钮不会进入禁用态", async () => {
    // 测试点：收藏同步未返回时，星标先按用户意图切换，按钮保持可继续交互。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const deferredUnfavorite = deferred<void>();
    unfavoriteLiveMock.mockImplementationOnce(() => deferredUnfavorite.promise);
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);

    const optimisticButton = screen.getAllByRole("button", { name: "加入收藏" })[0];
    expect(optimisticButton).not.toBeDisabled();
    expect(unfavoriteLiveMock).toHaveBeenCalledWith(1, "csrf-token");

    deferredUnfavorite.resolve();
    await waitFor(() => expect(optimisticButton).toBeInTheDocument());
  });

  test("连续失败三次后会显示统一的收藏同步提示", async () => {
    // 测试点：收藏同步连续失败达到阈值后，页面会显示固定提示文案。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    favoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    unfavoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    unfavoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "加入收藏" }));
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 1")).getByRole("button", { name: "取消收藏" }));
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 2")).getByRole("button", { name: "取消收藏" }));

    await waitFor(() => {
      expect(screen.getByText("收藏同步失败，请稍后重试或刷新页面确认")).toBeInTheDocument();
    });
  });

  test("进入收藏页时会用服务端快照收敛之前失败的乐观收藏", async () => {
    // 测试点：全量页残留的乐观收藏状态，会在进入收藏页后通过服务端快照重新对齐。
    getAuthMeMock
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
        csrf_token: "csrf-token",
        favorite_live_ids: [1, 2],
      })
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
        csrf_token: "csrf-token",
        favorite_live_ids: [1, 2],
      });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    getMyFavoriteLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 }),
    );
    favoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 3" })).toBeInTheDocument());
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "加入收藏" }));
    expect(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "取消收藏" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收藏" }));
    await waitFor(() => expect(getMyFavoriteLivesMock).toHaveBeenCalledWith(1, 20));
    await waitFor(() => expect(getAuthMeMock).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "全量" }));
    expect(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "加入收藏" })).toBeInTheDocument();
  });

  test("同条目快速连点会在首轮完成后补发第二轮同步请求", async () => {
    // 测试点：第一次请求 in-flight 时再次点击不并发；首轮完成后按最终意图补发第二轮。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const firstUnfavorite = deferred<void>();
    unfavoriteLiveMock.mockImplementationOnce(() => firstUnfavorite.promise);
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    const row = getTableRowByLiveTitle("示例 Live 名称 1");
    await user.click(within(row).getByRole("button", { name: "取消收藏" }));
    await waitFor(() => expect(unfavoriteLiveMock).toHaveBeenCalledTimes(1));
    await user.click(within(row).getByRole("button", { name: "加入收藏" }));

    expect(unfavoriteLiveMock).toHaveBeenCalledTimes(1);
    expect(favoriteLiveMock).toHaveBeenCalledTimes(0);

    firstUnfavorite.resolve();
    await waitFor(() => expect(favoriteLiveMock).toHaveBeenCalledWith(1, "csrf-token"));
    await waitFor(() => expect(within(getTableRowByLiveTitle("示例 Live 名称 1")).getByRole("button", { name: "取消收藏" })).toBeInTheDocument());
  });

  test("连续失败达到阈值后，后续一次成功会清除同步告警", async () => {
    // 测试点：warning 出现后只要成功一次，应立即清空会话失败告警。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    favoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    unfavoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    unfavoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "加入收藏" }));
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 1")).getByRole("button", { name: "取消收藏" }));
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 2")).getByRole("button", { name: "取消收藏" }));
    await waitFor(() =>
      expect(screen.getByText("收藏同步失败，请稍后重试或刷新页面确认")).toBeInTheDocument(),
    );

    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "取消收藏" }));
    await waitFor(() =>
      expect(screen.queryByText("收藏同步失败，请稍后重试或刷新页面确认")).not.toBeInTheDocument(),
    );
  });

  test("进入收藏页对账遇到 401 时会回到匿名态并切回全量页", async () => {
    // 测试点：reconcile 触发 AUTH 失效后，页面应按现有会话失效逻辑收敛。
    getAuthMeMock
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
        csrf_token: "csrf-token",
        favorite_live_ids: [1, 2],
      })
      .mockRejectedValueOnce(new ApiError("session expired", 401, "AUTH_SESSION_EXPIRED"));
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    favoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument());
    await user.click(within(getTableRowByLiveTitle("示例 Live 名称 3")).getByRole("button", { name: "加入收藏" }));
    await user.click(screen.getByRole("button", { name: "收藏" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "全量" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});
