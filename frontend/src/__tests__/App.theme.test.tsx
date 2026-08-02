import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import App from "../App";
import {
  clearLiveDataCaches,
  clearMyFavoriteLivesCache,
  getLiveDetail,
  getLiveDetailsBatch,
  getLives,
  getPerformances,
  peekMyFavoriteLives,
  type LiveDetailResponse,
  type LivesResponse,
  type PerformancesResponse,
} from "../api";
import { ThemeProvider } from "../theme/ThemeProvider";

vi.mock("../api", () => ({
  getLives: vi.fn(),
  searchCatalog: vi.fn(),
  getCatalogBands: vi.fn().mockResolvedValue({ items: [] }),
  getCatalogBandLives: vi.fn(),
  getCatalogStats: vi.fn().mockResolvedValue({
    band_count: 3,
    song_count: 17,
    venue_count: 3,
    latest_live_date: "2026-05-30",
  }),
  getLiveDetail: vi.fn(),
  getLiveDetailsBatch: vi.fn(),
  getPerformances: vi.fn(),
  peekMyFavoriteLives: vi.fn(),
  clearLiveDataCaches: vi.fn(),
  clearMyFavoriteLivesCache: vi.fn(),
  createConsoleVenue: vi.fn().mockResolvedValue({ ok: true, item: { venue_id: 1, venue_name: "Mock Venue" } }),
  getConsoleSongs: vi.fn().mockResolvedValue({ items: [] }),
  getConsoleBands: vi.fn().mockResolvedValue({ items: [] }),
  getConsoleBandHistory: vi.fn(),
  createConsoleBand: vi.fn(),
  createConsoleBandLineupVersion: vi.fn(),
  getConsoleBandTransitionLiveCandidates: vi.fn(),
  getConsoleVenues: vi.fn().mockResolvedValue({ items: [] }),
}));

const getLivesMock = vi.mocked(getLives);
const getPerformancesThemeMock = vi.mocked(getPerformances);
const getLiveDetailMock = vi.mocked(getLiveDetail);
const getLiveDetailsBatchMock = vi.mocked(getLiveDetailsBatch);
const peekMyFavoriteLivesMock = vi.mocked(peekMyFavoriteLives);
const clearLiveDataCachesMock = vi.mocked(clearLiveDataCaches);
const clearMyFavoriteLivesCacheMock = vi.mocked(clearMyFavoriteLivesCache);

type MatchMediaController = {
  setDark: (dark: boolean) => void;
};

function installMatchMedia(initialDark: boolean): MatchMediaController {
  let isDark = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => {
      const mql: MediaQueryList = {
        get matches() { return isDark; },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === "function") {
            listeners.add(listener as (event: MediaQueryListEvent) => void);
          }
        },
        removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === "function") {
            listeners.delete(listener as (event: MediaQueryListEvent) => void);
          }
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: () => true,
      };
      return mql;
    }),
  });

  return {
    setDark: (dark: boolean) => {
      isDark = dark;
      const event = { matches: dark, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function makeResponse(): LivesResponse {
  return {
    items: [
      {
        live_id: 1,
        live_date: "2026-03-01",
        live_title: "示例 Live 名称 1",
        live_type: "oneman",
        bands: [1, 2],
        url: "https://example.com/live/1",
        is_favorite: false,
      },
      {
        live_id: 2,
        live_date: "2026-03-02",
        live_title: "示例 Live 名称 2",
        live_type: "oneman",
        bands: [1, 2],
        url: "https://example.com/live/2",
        is_favorite: false,
      },
    ],
    pagination: {
      page: 1,
      page_size: 20,
      total: 2,
      total_pages: 1,
    },
  };
}

function makePerformancesResponse(): PerformancesResponse {
  const livesResp = makeResponse();
  return {
    items: livesResp.items.map((live) => ({ kind: "live" as const, live })),
    pagination: livesResp.pagination,
  };
}

function makeDetailResponse(liveId: number): LiveDetailResponse {
  return {
    live_id: liveId,
    live_date: "2026-03-01",
    live_title: `示例 Live 名称 ${liveId}`,
    live_type: "oneman",
    venue: "测试场地",
    opening_time: "17:00:00+08:00",
    start_time: "18:00:00+09:00",
    bands: [1, 2],
    band_names: ["Band 1", "Band 2"],
    url: `https://example.com/live/${liveId}`,
    is_favorite: false,
    event_attendees: [],
    detail_rows: [],
  };
}

function renderWithTheme() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

describe("App dark mode", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    localStorage.clear();
    localStorage.setItem("live-view-mode", "table");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";

    getLivesMock.mockReset();
    getPerformancesThemeMock.mockReset();
    getLiveDetailMock.mockReset();
    getLiveDetailsBatchMock.mockReset();
    peekMyFavoriteLivesMock.mockReset();
    clearLiveDataCachesMock.mockReset();
    clearMyFavoriteLivesCacheMock.mockReset();

    getLivesMock.mockResolvedValue(makeResponse());
    getPerformancesThemeMock.mockResolvedValue(makePerformancesResponse());
    getLiveDetailMock.mockImplementation(async (liveId: number) => makeDetailResponse(liveId));
    getLiveDetailsBatchMock.mockResolvedValue({ items: [], missing_live_ids: [] });
    peekMyFavoriteLivesMock.mockReturnValue(undefined);
  });

  test("点击主题按钮可在跟随系统、夜间、浅色之间循环切换", async () => {
    // 测试点：主题按钮应支持三态循环，并正确更新文案/图标与持久化值。
    installMatchMedia(false);
    const user = userEvent.setup();
    renderWithTheme();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(
      screen.getByRole("button", { name: "当前跟随系统（浅色），单击锁定夜间模式" }),
    ).toHaveTextContent("⦿");

    await user.click(screen.getByRole("button", { name: "当前跟随系统（浅色），单击锁定夜间模式" }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "当前夜间模式，单击切换到浅色模式" })).toHaveTextContent("☽");
    });
    expect(localStorage.getItem("live-theme-mode")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "当前夜间模式，单击切换到浅色模式" }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(screen.getByRole("button", { name: "当前浅色模式，单击切换到跟随系统" })).toHaveTextContent("☀");
    });
    expect(localStorage.getItem("live-theme-mode")).toBe("light");
  });

  test("手动切到夜间后刷新仍保持夜间", async () => {
    // 测试点：手动夜间模式在刷新（重挂载）后应保持，不回退为默认主题。
    installMatchMedia(false);
    const user = userEvent.setup();
    const mounted = renderWithTheme();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "当前跟随系统（浅色），单击锁定夜间模式" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "当前跟随系统（浅色），单击锁定夜间模式" }));
    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    mounted.unmount();

    renderWithTheme();
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "当前夜间模式，单击切换到浅色模式" })).toBeInTheDocument();
    });
  });

  test("system 模式下会跟随系统主题变化", async () => {
    // 测试点：App 集成场景下，system 模式应跟随系统主题变化同步更新 UI。
    const media = installMatchMedia(false);
    localStorage.setItem("live-theme-mode", "system");
    renderWithTheme();

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(screen.getByRole("button", { name: "当前跟随系统（浅色），单击锁定夜间模式" })).toBeInTheDocument();
    });

    act(() => {
      media.setDark(true);
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "当前跟随系统（夜间），单击锁定夜间模式" })).toBeInTheDocument();
    });
  });

  // 测试点：夜间主题在多交互路径（切页签/开关弹窗）中应保持一致不丢失。
  test("夜间主题在切换页签和打开详情后保持一致", async () => {
    installMatchMedia(false);
    localStorage.setItem("live-theme-mode", "dark");
    const user = userEvent.setup();
    renderWithTheme();

    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    await user.click(screen.getByRole("button", { name: "演出资料" }));
    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "示例 Live 名称 1" })).toBeInTheDocument();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.click(screen.getByRole("button", { name: "演出资料" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "当前夜间模式，单击切换到浅色模式" })).toBeInTheDocument();
  });
});


