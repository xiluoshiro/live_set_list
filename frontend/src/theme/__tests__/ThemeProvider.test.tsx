import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ThemeProvider, useTheme } from "../ThemeProvider";

type MatchMediaController = {
  setDark: (dark: boolean) => void;
};

function installMatchMedia(initialDark: boolean): MatchMediaController {
  let isDark = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const matchMedia = vi.fn((query: string): MediaQueryList => {
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
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return {
    setDark: (dark: boolean) => {
      isDark = dark;
      const event = { matches: dark, media: "(prefers-color-scheme: dark)" } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeProbe() {
  const { mode, resolvedTheme, setMode } = useTheme();
  return (
    <div>
      <div data-testid="mode">{mode}</div>
      <div data-testid="resolved">{resolvedTheme}</div>
      <button type="button" onClick={() => setMode("light")}>
        set-light
      </button>
      <button type="button" onClick={() => setMode("dark")}>
        set-dark
      </button>
      <button type="button" onClick={() => setMode("system")}>
        set-system
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  test("默认使用 system 模式，并根据系统浅色解析主题", async () => {
    // 测试点：首次无配置时应走 system，且按系统浅色解析为 light。
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("system");
      expect(screen.getByTestId("resolved")).toHaveTextContent("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });
    expect(window.localStorage.getItem("live-theme-mode")).toBe("system");
  });

  test("localStorage 为 dark 时初始化为夜间主题", async () => {
    // 测试点：存在 dark 持久化配置时，初始化应直接进入夜间主题。
    installMatchMedia(false);
    window.localStorage.setItem("live-theme-mode", "dark");
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
  });

  test("非法存储值会回退到 system", async () => {
    // 测试点：异常配置值应被兜底为 system，避免主题状态污染。
    installMatchMedia(true);
    window.localStorage.setItem("live-theme-mode", "invalid");
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("system");
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    });
    expect(window.localStorage.getItem("live-theme-mode")).toBe("system");
  });

  test("切换到 dark 会更新根节点主题与持久化", async () => {
    // 测试点：手动切换主题后，应同步更新 data-theme、colorScheme 和 localStorage。
    installMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await screen.findByTestId("mode");
    await user.click(screen.getByRole("button", { name: "set-dark" }));

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });
    expect(window.localStorage.getItem("live-theme-mode")).toBe("dark");
  });

  test("system 模式会跟随 prefers-color-scheme 变化", async () => {
    // 测试点：system 模式下，系统主题变化应驱动 resolvedTheme 与根节点属性更新。
    const media = installMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    });
    act(() => {
      media.setDark(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
  });

  test("手动 light 模式优先于系统变化", async () => {
    // 测试点：手动指定 light 后，系统变为 dark 不应覆盖用户手动选择。
    const media = installMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await screen.findByTestId("mode");
    await user.click(screen.getByRole("button", { name: "set-light" }));

    act(() => {
      media.setDark(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("light");
      expect(screen.getByTestId("resolved")).toHaveTextContent("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });
});

