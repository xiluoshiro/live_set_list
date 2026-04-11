import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { FavoriteProvider, useFavorites } from "../FavoriteProvider";
import { ApiError, favoriteLive, unfavoriteLive } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { FAVORITE_SYNC_WARNING_MESSAGE } from "../favoriteSync";
import { logInfo } from "../../logger";

vi.mock("../../api", () => ({
  favoriteLive: vi.fn(),
  unfavoriteLive: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string | null;

    constructor(message: string, status: number, code: string | null = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("../../auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../logger", () => ({
  logInfo: vi.fn(),
}));

const favoriteLiveMock = vi.mocked(favoriteLive);
const unfavoriteLiveMock = vi.mocked(unfavoriteLive);
const useAuthMock = vi.mocked(useAuth);
const logInfoMock = vi.mocked(logInfo);

type MockAuth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: { id: number; username: string; display_name: string; role: string } | null;
  csrfToken: string | null;
  sessionFavoriteLiveIds: number[];
  favoriteSnapshotVersion: number;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setAnonymous: () => void;
};

let currentAuth: MockAuth;
let latestFavorites: ReturnType<typeof useFavorites> | null = null;

function makeAuth(overrides?: Partial<MockAuth>): MockAuth {
  return {
    isLoading: false,
    isAuthenticated: true,
    user: { id: 1, username: "admin", display_name: "Administrator", role: "admin" },
    csrfToken: "csrf-token",
    sessionFavoriteLiveIds: [1, 2],
    favoriteSnapshotVersion: 1,
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    refreshSession: vi.fn(async () => undefined),
    setAnonymous: vi.fn(),
    ...overrides,
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

function Probe() {
  const favorites = useFavorites();
  latestFavorites = favorites;
  return (
    <section>
      <p data-testid="favorite-ids">{favorites.favoriteLiveIds.join(",")}</p>
      <p data-testid="sync-1">{String(favorites.isFavoriteSyncing(1))}</p>
      <p data-testid="favorite-1">{String(favorites.favoriteLiveIdSet.has(1))}</p>
      <p data-testid="favorite-3">{String(favorites.favoriteLiveIdSet.has(3))}</p>
      <p data-testid="warning">{favorites.favoriteSyncWarning ?? ""}</p>
      <button type="button" onClick={() => void favorites.toggleFavorite(1)}>
        toggle-1
      </button>
      <button type="button" onClick={() => void favorites.toggleFavorite(3)}>
        toggle-3
      </button>
      <button type="button" onClick={() => void favorites.reconcileFavorites()}>
        reconcile
      </button>
    </section>
  );
}

function renderProvider() {
  return render(
    <FavoriteProvider>
      <Probe />
    </FavoriteProvider>,
  );
}

function readFavorites() {
  if (!latestFavorites) {
    throw new Error("favorites context 尚未初始化");
  }
  return latestFavorites;
}

describe("FavoriteProvider", () => {
  beforeEach(() => {
    favoriteLiveMock.mockReset();
    unfavoriteLiveMock.mockReset();
    useAuthMock.mockReset();
    logInfoMock.mockReset();
    latestFavorites = null;

    favoriteLiveMock.mockResolvedValue(undefined);
    unfavoriteLiveMock.mockResolvedValue(undefined);
    currentAuth = makeAuth();
    useAuthMock.mockImplementation(() => currentAuth);
  });

  test("同条目快速连点时保持单飞，并在首轮完成后补发第二轮同步", async () => {
    // 测试点：in-flight 期间第二次点击不并发；首轮完成后应按最新意图补发下一轮请求。
    const firstCall = deferred<void>();
    unfavoriteLiveMock.mockImplementationOnce(() => firstCall.promise);
    const user = userEvent.setup();
    renderProvider();

    expect(screen.getByTestId("favorite-1")).toHaveTextContent("true");
    await user.click(screen.getByRole("button", { name: "toggle-1" }));
    expect(unfavoriteLiveMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("favorite-1")).toHaveTextContent("false"));
    await waitFor(() => expect(screen.getByTestId("sync-1")).toHaveTextContent("true"));

    await user.click(screen.getByRole("button", { name: "toggle-1" }));
    expect(unfavoriteLiveMock).toHaveBeenCalledTimes(1);
    expect(favoriteLiveMock).toHaveBeenCalledTimes(0);
    await waitFor(() => expect(screen.getByTestId("favorite-1")).toHaveTextContent("true"));

    firstCall.resolve(undefined);
    await waitFor(() => expect(favoriteLiveMock).toHaveBeenCalledWith(1, "csrf-token"));
    await waitFor(() => expect(screen.getByTestId("sync-1")).toHaveTextContent("false"));
    expect(screen.getByTestId("favorite-1")).toHaveTextContent("true");
    expect(favoriteLiveMock).toHaveBeenCalledTimes(1);
  });

  test("单次失败保留乐观态，连续三次失败后展示统一提示，成功后清零", async () => {
    // 测试点：失败不回滚 UI；第三次失败显示 warning；后续成功会清理 warning。
    favoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    unfavoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    favoriteLiveMock.mockRejectedValueOnce(new Error("Request timeout"));
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "toggle-3" }));
    await waitFor(() => expect(favoriteLiveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("favorite-3")).toHaveTextContent("true"));
    expect(screen.getByTestId("warning")).toHaveTextContent("");

    await user.click(screen.getByRole("button", { name: "toggle-3" }));
    await waitFor(() => expect(unfavoriteLiveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("favorite-3")).toHaveTextContent("false"));
    await user.click(screen.getByRole("button", { name: "toggle-3" }));
    await waitFor(() => expect(favoriteLiveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("favorite-3")).toHaveTextContent("true"));
    await waitFor(() => expect(screen.getByTestId("warning")).toHaveTextContent(FAVORITE_SYNC_WARNING_MESSAGE));
    await user.click(screen.getByRole("button", { name: "toggle-3" }));
    await waitFor(() => expect(unfavoriteLiveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("favorite-3")).toHaveTextContent("false"));
    await waitFor(() => expect(screen.getByTestId("warning")).toHaveTextContent(""));
  });

  test("认证错误会向上抛出，且不会被当作普通弱一致失败吞掉", async () => {
    // 测试点：401/403 必须抛错给上层处理，避免继续弱一致漂移。
    favoriteLiveMock.mockRejectedValueOnce(new ApiError("session expired", 401, "AUTH_SESSION_EXPIRED"));
    renderProvider();

    let error: unknown = null;
    await act(async () => {
      try {
        await readFavorites().toggleFavorite(3);
      } catch (caught) {
        error = caught;
      }
    });
    expect(error).toMatchObject({
      status: 401,
      code: "AUTH_SESSION_EXPIRED",
    });
  });

  test("未登录或缺少 csrfToken 时，toggleFavorite 直接抛 401 认证错误", async () => {
    // 测试点：认证前置条件不满足时，不应进入收藏同步流程。
    currentAuth = makeAuth({
      isAuthenticated: false,
      csrfToken: null,
      user: null,
      sessionFavoriteLiveIds: [],
    });
    renderProvider();

    let error: unknown = null;
    await act(async () => {
      try {
        await readFavorites().toggleFavorite(3);
      } catch (caught) {
        error = caught;
      }
    });

    expect(error).toMatchObject({
      status: 401,
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(favoriteLiveMock).toHaveBeenCalledTimes(0);
    expect(unfavoriteLiveMock).toHaveBeenCalledTimes(0);
  });

  test("reconcileFavorites 会触发 auth.refreshSession 对账", async () => {
    // 测试点：进入收藏页触发的 reconcile 需要委托给 auth 会话刷新。
    renderProvider();

    await act(async () => {
      await readFavorites().reconcileFavorites();
    });
    expect(currentAuth.refreshSession).toHaveBeenCalledTimes(1);
  });

  test("登录快照变更后会重建服务端真值并清理旧同步状态", async () => {
    // 测试点：favoriteSnapshotVersion 变化后，provider 会用新快照覆盖旧状态。
    const firstCall = deferred<void>();
    unfavoriteLiveMock.mockImplementationOnce(() => firstCall.promise);
    const user = userEvent.setup();
    const { rerender } = renderProvider();

    await user.click(screen.getByRole("button", { name: "toggle-1" }));
    expect(screen.getByTestId("sync-1")).toHaveTextContent("true");
    expect(screen.getByTestId("favorite-ids")).toHaveTextContent("2");

    currentAuth = makeAuth({
      user: { id: 2, username: "next", display_name: "Next User", role: "admin" },
      sessionFavoriteLiveIds: [5],
      favoriteSnapshotVersion: 2,
    });
    rerender(
      <FavoriteProvider>
        <Probe />
      </FavoriteProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("favorite-ids")).toHaveTextContent("5"));
    expect(screen.getByTestId("sync-1")).toHaveTextContent("false");
    expect(screen.getByTestId("warning")).toHaveTextContent("");
  });
});
