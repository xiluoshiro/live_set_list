import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import App from "../App";
import { AuthProvider } from "../auth/AuthProvider";
import { FavoriteProvider } from "../favorites/FavoriteProvider";
import {
  clearMyFavoriteLivesCache,
  favoriteLive,
  favoriteLivesBatch,
  getLiveDetail,
  getLiveDetailsBatch,
  getAuthMe,
  getLives,
  getMyFavoriteLives,
  login,
  logout,
  peekMyFavoriteLives,
  unfavoriteLive,
  type LiveDetailResponse,
  type LivesResponse,
} from "../api";
import { logError } from "../logger";
import { ThemeProvider } from "../theme/ThemeProvider";

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
const logErrorMock = vi.mocked(logError);

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

describe("App", () => {
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
    logErrorMock.mockReset();
    getAuthMeMock.mockResolvedValue({ authenticated: false });
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

  test("匿名模式默认进入全量页，且不显示收藏入口", () => {
    // 测试点：未登录时默认只展示全量页，不暴露收藏页签。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    expect(screen.getByRole("button", { name: "全量" })).toHaveClass("active");
    expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "收藏" })).not.toBeInTheDocument();
    return waitFor(() => expect(getTotalCount()).toBe(47));
  });

  test("未登录时不显示控制台入口", async () => {
    // 测试点：匿名模式下控制台页签必须隐藏，避免未登录用户触发控制台逻辑。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "全量" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "控制台" })).not.toBeInTheDocument();
  });

  test("viewer 角色登录后不显示控制台入口", async () => {
    // 测试点：控制台仅对 editor+ 开放；viewer 登录后也不应看到控制台页签。
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "viewer", display_name: "Viewer", role: "viewer" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp({ withAuthProvider: true });

    await waitFor(() => expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "控制台" })).not.toBeInTheDocument();
  });

  test("admin 角色登录后显示控制台入口", async () => {
    // 测试点：admin 属于 editor+，应显示控制台页签。
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

    await waitFor(() => expect(screen.getByRole("button", { name: "控制台" })).toBeInTheDocument());
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

  test("已登录时显示收藏页签，切换到全量页后显示收藏列和星标按钮", async () => {
    // 测试点：登录后才显示收藏入口，且全量页展示星标列。
    getAuthMeMock.mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
      csrf_token: "csrf-token",
      favorite_live_ids: [1, 2],
    });
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "全量" }));

    expect(screen.getByRole("button", { name: "全量" })).toHaveClass("active");
    expect(screen.getByRole("columnheader", { name: /收藏/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏本页" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
  });

  test("已登录时收藏页走服务端接口，并展示服务端收藏列表", async () => {
    // 测试点：收藏页不再使用本地过滤，而是直接拉取服务端收藏列表。
    getAuthMeMock.mockResolvedValue({
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

    renderApp({ withAuthProvider: true });

    await userEvent.setup().click(await screen.findByRole("button", { name: "收藏" }));
    await waitFor(() => expect(getMyFavoriteLivesMock).toHaveBeenCalledWith(1, 20));
    expect(screen.getByRole("button", { name: "收藏" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument();
  });

  test("匿名模式不显示星标入口", async () => {
    // 测试点：未登录模式下不应该渲染收藏星标按钮。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "取消收藏" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加入收藏" })).not.toBeInTheDocument();
  });

  test("登录成功后切换到已登录模式并显示收藏入口", async () => {
    // 测试点：用户登录成功后显示收藏入口，并可打开用户下拉看到用户名/角色/退出。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await user.click(await screen.findByRole("button", { name: "登录" }));
    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "test-admin-pass");
    await user.click(screen.getAllByRole("button", { name: /^登录$/ })[1]);

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("admin", "test-admin-pass"));
    expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: "登录" }));
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
    const deferredFavorites = deferred<LivesResponse>();
    getMyFavoriteLivesMock.mockImplementationOnce(() => deferredFavorites.promise);
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "收藏" }));

    expect(screen.queryByRole("button", { name: "示例 Live 名称 1" })).not.toBeInTheDocument();
    expect(screen.getByText("加载中...")).toBeInTheDocument();

    deferredFavorites.resolve(
      makeResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 }),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument());
  });

  test("已加载过的页签再次切回时会直接复用快照，不重复显示刷新态", async () => {
    // 测试点：同一登录态下已访问过的全量/收藏页再次切回时，应直接命中本地快照。
    getAuthMeMock.mockResolvedValue({
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
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "收藏" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "全量" }));

    expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(getLivesMock).toHaveBeenCalledTimes(1);
  });

  test("收藏页预读命中后，切换到收藏不会再额外刷新 auth/me 且无加载闪烁", async () => {
    // 测试点：全量页空闲预读命中收藏第一页后，切页签应直接复用缓存结果。
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
    const favoritePage = makeResponse({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      itemCount: 2,
      startId: 101,
    });
    getMyFavoriteLivesMock.mockResolvedValue(favoritePage);
    peekMyFavoriteLivesMock.mockImplementation((page: number, pageSize: number) =>
      page === 1 && pageSize === 20 ? favoritePage : undefined,
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await waitFor(() => expect(getMyFavoriteLivesMock).toHaveBeenCalledWith(1, 20));
    expect(getAuthMeMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "收藏" }));

    expect(screen.getByRole("button", { name: "示例 Live 名称 101" })).toBeInTheDocument();
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(getAuthMeMock).toHaveBeenCalledTimes(1);
  });

  test("分页和每页条数切换正常工作", async () => {
    // 测试点：分页跳转与 15/20 行切换后页码计算正确。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 21 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const total = getTotalCount();
    const firstPageInfo = getPageInfo();
    expect(firstPageInfo.page).toBe(1);
    expect(firstPageInfo.totalPages).toBe(Math.ceil(total / 20));

    await user.click(screen.getByRole("button", { name: "下一页" }));
    const secondPageInfo = getPageInfo();
    expect(secondPageInfo.page).toBe(Math.min(2, secondPageInfo.totalPages));

    await user.selectOptions(screen.getByRole("combobox"), "15");
    const pageInfoAfterResize = getPageInfo();
    expect(pageInfoAfterResize.page).toBe(1);
    expect(pageInfoAfterResize.totalPages).toBe(Math.ceil(total / 15));
  });

  test("跳转页输入框支持回车跳转到目标页", async () => {
    // 测试点：在“跳转至第（）页”输入页码后按回车，应请求对应页并更新分页显示。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 3, pageSize: 20, total: 47, totalPages: 3, itemCount: 7, startId: 41 }),
      );
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const jumpInput = screen.getByRole("textbox");
    await user.clear(jumpInput);
    await user.type(jumpInput, "3{Enter}");

    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(3, 20));
    await waitFor(() => expect(screen.getByText("第 3 / 3 页")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "示例 Live 名称 41" })).toBeInTheDocument();
  });

  test("翻页后主表仍保持固定布局，避免列间距抖动", async () => {
    // 测试点：第一页到下一页（超长标题）后，表格仍为 fixed 布局，列宽分配不受内容长度影响。
    const page1 = makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 });
    const page2Items = makeItems(20, 21, true).map((item) => ({
      ...item,
      live_title: `超长标题${"非常长".repeat(30)}-${item.live_id}`,
    }));
    const page2: LivesResponse = {
      items: page2Items,
      pagination: {
        page: 2,
        page_size: 20,
        total: 47,
        total_pages: 3,
      },
    };

    getLivesMock.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const user = userEvent.setup();
    renderApp();
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

  test("点击 live 名称打开详情弹窗并可关闭", async () => {
    // 测试点：详情查看路径（打开/关闭）可用。
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

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("heading", { name: firstLiveName })).not.toBeInTheDocument();
  });

  test("详情弹窗格式正确：头部动作、基础信息、详情表格", async () => {
    // 测试点：验证弹窗的新布局结构是否完整。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    const { container } = renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    // 头部动作按钮
    expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();

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
    expect(metaItems).toHaveLength(4);
    metaItems.forEach((item) => expect(item).toHaveClass("detail-inline-item"));

    const dateRow = screen.getByText("日期：").closest("p");
    const openingRow = screen.getByText("开场：").closest("p");
    const venueRow = screen.getByText("场地：").closest("p");

    expect(dateRow).toHaveClass("detail-inline-item", "detail-inline-item-date");
    expect(openingRow).toHaveClass("detail-inline-item");
    expect(venueRow).toHaveClass("detail-inline-item", "detail-inline-item-venue");
    expect(screen.getByText("乐队：").closest("p")).toHaveClass("detail-row");
  });

  test("详情弹窗支持全屏切换并可点遮罩关闭", async () => {
    // 测试点：验证全屏状态切换样式和遮罩关闭交互。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));
    await user.click(screen.getByRole("button", { name: "全屏" }));
    expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();
    expect(container.querySelector(".modal.fullscreen")).not.toBeNull();

    const mask = container.querySelector(".modal-mask") as HTMLElement;
    await user.click(mask);
    expect(screen.queryByRole("button", { name: "退出全屏" })).not.toBeInTheDocument();
  });

  test("详情弹窗右上角按钮样式类名正确", async () => {
    // 测试点：看护右上角“全屏/关闭”按钮的样式类，避免回归改坏。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    const fullscreenBtn = screen.getByRole("button", { name: "全屏" });
    const closeBtn = screen.getByRole("button", { name: "关闭" });

    expect(fullscreenBtn).toHaveClass("modal-action-btn", "fullscreen");
    expect(closeBtn).toHaveClass("modal-action-btn", "close");

    const fullscreenGlyph = within(fullscreenBtn).getByText("⛶");
    const closeGlyph = within(closeBtn).getByText("✕");
    expect(fullscreenGlyph).toHaveClass("modal-action-glyph", "fullscreen");
    expect(closeGlyph).toHaveClass("modal-action-glyph", "close");
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

  test("URL 列使用链接图标并携带正确链接", () => {
    // 测试点：URL 列展示为 🔗，并指向对应详情地址。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, withUrl: true }),
    );
    renderApp();
    return waitFor(() => {
      const firstLink = screen.getAllByRole("link", { name: "🔗" })[0];
      expect(firstLink.getAttribute("href")).toMatch(/^https:\/\/example\.com\/live\/\d+$/);
    });
  });

  test("乐队列渲染图标单元格", () => {
    // 测试点：乐队列应渲染图标容器与 SVG 图标。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    renderApp();
    return waitFor(() => {
      const firstBandCell = screen.getAllByTitle(/支乐队/)[0];
      const bandIcons = within(firstBandCell).getAllByRole("img", { name: /Band \d+/ });
      expect(bandIcons.length).toBeGreaterThan(0);
      bandIcons.forEach((icon) => {
        expect(icon.getAttribute("src")).toMatch(/^\/icons\/Band_\d+\.svg$/);
      });
    });
  });

  test("首次加载请求参数正确，切换每页数量后重新请求", async () => {
    // 测试点：首次请求应为 page=1&page_size=20，切到 15 后重新请求 page_size=15。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 15, total: 47, totalPages: 4, itemCount: 15 }),
      );
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 20));
    await user.selectOptions(screen.getByRole("combobox"), "15");
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 15));
  });

  test("首次加载后会对当前页触发批量详情预读", async () => {
    // 测试点：首页加载完成后，使用当前页 live_id 列表调用 batch 详情接口。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    renderApp();

    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledTimes(1));
    expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([1, 2, 3]);
  });

  test("批量详情预读超时不影响主列表渲染", async () => {
    // 测试点：POST /api/lives/details:batch 超时后，页面主流程仍应正常展示列表。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3 }),
    );
    getLiveDetailsBatchMock.mockRejectedValueOnce(new Error("Request timeout"));
    renderApp();

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
    getMyFavoriteLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 2, totalPages: 1, itemCount: 2, startId: 101 }),
    );
    const user = userEvent.setup();
    renderApp({ withAuthProvider: true });

    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([1, 2, 3]));
    await user.click(screen.getByRole("button", { name: "收藏" }));
    await waitFor(() => expect(getLiveDetailsBatchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(getLiveDetailsBatchMock).toHaveBeenLastCalledWith([101, 102]);
  });

  test("翻页会触发对应页码请求", async () => {
    // 测试点：点击下一页/上一页会触发 page 参数变化。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, startId: 21 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
      );
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 20));

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(2, 20));

    await user.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 20));
  });

  test("翻页后会对新页数据触发批量详情预读", async () => {
    // 测试点：翻页成功后，batch 预读应切换到新页的 live_id 列表。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 2, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 2, pageSize: 20, total: 47, totalPages: 3, itemCount: 2, startId: 21 }),
      );
    const user = userEvent.setup();
    renderApp();

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
        makeResponse({ page: 1, pageSize: 20, total: 40, totalPages: 2, itemCount: 2, startId: 1 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 2, pageSize: 20, total: 40, totalPages: 2, itemCount: 2, startId: 21 }),
      );
    renderApp();

    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(2, 20));
    await waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([21, 22]));
  });

  test("分页总计与总页数以后端返回为准", async () => {
    // 测试点：显示使用 pagination.total/total_pages，而非本地 items 长度。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 120, totalPages: 6, itemCount: 3 }),
    );
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("总计 120 条")).toBeInTheDocument();
      expect(screen.getByText("第 1 / 6 页")).toBeInTheDocument();
    });
  });

  test("后端校正页码后，前端页码显示会同步到纠正结果且不重复请求", async () => {
    // 测试点：后端返回 canonical page 时，前端应同步显示该页并复用这次响应，不再冗余补请求。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 40, totalPages: 2, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 20, totalPages: 1, itemCount: 20 }),
      );
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
      expect(screen.getByText("总计 20 条")).toBeInTheDocument();
    });
    expect(getLivesMock).toHaveBeenCalledTimes(2);
    expect(getLivesMock).toHaveBeenNthCalledWith(2, 2, 20);
  });

  test("url 为空时显示 '-' 且不渲染链接", async () => {
    // 测试点：url 为 null 的行应该显示 '-'，不应出现 🔗 链接。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 3, totalPages: 1, itemCount: 3, withUrl: false }),
    );
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("-").length).toBeGreaterThan(0);
      expect(screen.queryByRole("link", { name: "🔗" })).not.toBeInTheDocument();
    });
  });

  test("请求中显示加载态，成功后消失并展示数据", async () => {
    // 测试点：接口未返回前显示“加载中...”，返回后渲染列表数据。
    const d = deferred<LivesResponse>();
    getLivesMock.mockImplementationOnce(() => d.promise);
    render(<App />);

    expect(screen.getByText("加载中...")).toBeInTheDocument();
    d.resolve(makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }));
    await waitFor(() => {
      expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument();
    });
  });

  test("请求失败时显示错误提示且分页区域可见", async () => {
    // 测试点：接口异常时页面不崩溃，显示错误文案并保留分页区域。
    getLivesMock.mockRejectedValueOnce(new Error("Request failed: 500"));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("数据加载失败: Request failed: 500")).toBeInTheDocument();
      expect(screen.getByText(/第 \d+ \/ \d+ 页/)).toBeInTheDocument();
    });
  });

  test("列表加载失败时会记录页面级错误日志", async () => {
    // 测试点：列表请求失败后，页面 catch 会记录带分页上下文的业务日志。
    getLivesMock.mockRejectedValueOnce(new Error("Request failed: 500"));
    render(<App />);

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

  test("跨页后收藏状态仍按 live_id 生效", async () => {
    // 测试点：登录后切换分页，收藏操作仍会按同一 live_id 发到服务端。
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

    await user.click(screen.getByRole("button", { name: "全量" }));
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

});
