import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import App from "../App";
import { getLiveDetail, getLiveDetailsBatch, getLives, type LiveDetailResponse, type LivesResponse } from "../api";
import { ThemeProvider } from "../theme/ThemeProvider";

vi.mock("../api", () => ({
  getLives: vi.fn(),
  getLiveDetail: vi.fn(),
  getLiveDetailsBatch: vi.fn(),
}));

const getLivesMock = vi.mocked(getLives);
const getLiveDetailMock = vi.mocked(getLiveDetail);
const getLiveDetailsBatchMock = vi.mocked(getLiveDetailsBatch);

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
        bands: [1, 2],
        url: "https://example.com/live/1",
      },
      {
        live_id: 2,
        live_date: "2026-03-02",
        live_title: "示例 Live 名称 2",
        bands: [1, 2],
        url: "https://example.com/live/2",
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

function makeDetailResponse(liveId: number): LiveDetailResponse {
  return {
    live_id: liveId,
    live_date: "2026-03-01",
    live_title: `示例 Live 名称 ${liveId}`,
    venue: "测试场地",
    opening_time: "17:00",
    start_time: "18:00",
    bands: [1, 2],
    band_names: ["Band 1", "Band 2"],
    url: `https://example.com/live/${liveId}`,
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
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";

    getLivesMock.mockReset();
    getLiveDetailMock.mockReset();
    getLiveDetailsBatchMock.mockReset();

    getLivesMock.mockResolvedValue(makeResponse());
    getLiveDetailMock.mockImplementation(async (liveId: number) => makeDetailResponse(liveId));
    getLiveDetailsBatchMock.mockResolvedValue({ items: [], missing_live_ids: [] });
  });

  test("点击主题按钮可在浅色和夜间之间切换", async () => {
    // 测试点：主题切换按钮应可双向切换，并正确更新按钮文案/图标与持久化值。
    installMatchMedia(false);
    const user = userEvent.setup();
    renderWithTheme();

    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("button", { name: "切换到夜间模式" })).toHaveTextContent("🌙");

    await user.click(screen.getByRole("button", { name: "切换到夜间模式" }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "切换到浅色模式" })).toHaveTextContent("☀");
    });
    expect(localStorage.getItem("live-theme-mode")).toBe("dark");
  });

  test("手动切到夜间后刷新仍保持夜间", async () => {
    // 测试点：手动夜间模式在刷新（重挂载）后应保持，不回退为默认主题。
    installMatchMedia(false);
    const user = userEvent.setup();
    const mounted = renderWithTheme();

    await waitFor(() => expect(screen.getByRole("button", { name: "切换到夜间模式" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "切换到夜间模式" }));
    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    mounted.unmount();

    renderWithTheme();
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
    });
  });

  test("system 模式下会跟随系统主题变化", async () => {
    // 测试点：App 集成场景下，system 模式应跟随系统主题变化同步更新 UI。
    const media = installMatchMedia(false);
    localStorage.setItem("live-theme-mode", "system");
    renderWithTheme();

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(screen.getByRole("button", { name: "切换到夜间模式" })).toBeInTheDocument();
    });

    act(() => {
      media.setDark(true);
    });

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
    });
  });

  test("夜间主题在切换页签和打开详情后保持一致", async () => {
    // 测试点：夜间主题在多交互路径（切页签/开关弹窗）中应保持一致不丢失。
    installMatchMedia(false);
    localStorage.setItem("live-theme-mode", "dark");
    const user = userEvent.setup();
    renderWithTheme();

    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
    await user.click(screen.getByRole("button", { name: "全量" }));
    await user.click(screen.getByRole("button", { name: "示例 Live 名称 1" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "示例 Live 名称 1" })).toBeInTheDocument();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: "控制台" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
  });
});

