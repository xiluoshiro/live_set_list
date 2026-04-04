import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import App from "../App";
import { getLives, type LivesResponse } from "../api";

vi.mock("../api", () => ({
  getLives: vi.fn(),
}));

const getLivesMock = vi.mocked(getLives);

function makeItems(count: number, startId = 1, withUrl = true) {
  return Array.from({ length: count }, (_, idx) => {
    const id = startId + idx;
    return {
      live_id: id,
      live_date: `2026-03-${String((id % 28) + 1).padStart(2, "0")}`,
      live_title: `示例 Live 名称 ${id}`,
      bands: [1, 2],
      url: withUrl ? `https://example.com/live/${id}` : null,
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

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    getLivesMock.mockReset();
  });

  test("默认进入收藏页，且不显示收藏列", () => {
    // 测试点：默认页签和列显隐是否符合“收藏页不显示收藏列”的规则。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    render(<App />);
    expect(screen.getByRole("button", { name: "收藏" })).toHaveClass("active");
    expect(screen.queryByRole("columnheader", { name: "收藏" })).not.toBeInTheDocument();
    return waitFor(() => expect(getTotalCount()).toBe(47));
  });

  test("切换到全量页后显示收藏列和星标按钮", async () => {
    // 测试点：仅全量页展示“收藏”列与星标操作入口。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "全量" }));

    expect(screen.getByRole("button", { name: "全量" })).toHaveClass("active");
    expect(screen.getByRole("columnheader", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
  });

  test("取消收藏后回到收藏页会过滤对应条目", async () => {
    // 测试点：收藏状态切换后，收藏页列表与总数会实时更新。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "全量" }));
    const firstLiveButton = screen.getAllByRole("button", { name: /示例 Live 名称/ })[0];
    const firstLiveName = firstLiveButton.textContent ?? "";
    const before = getTotalCount();
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);
    await user.click(screen.getByRole("button", { name: "收藏" }));

    expect(getTotalCount()).toBe(47);
    expect(screen.queryByRole("button", { name: firstLiveName })).not.toBeInTheDocument();
  });

  test("收藏状态会持久化到 localStorage", async () => {
    // 测试点：刷新后仍保留用户的收藏状态。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());

    const before = getTotalCount();
    await user.click(screen.getByRole("button", { name: "全量" }));
    const firstLiveButton = screen.getAllByRole("button", { name: /示例 Live 名称/ })[0];
    const firstLiveName = firstLiveButton.textContent ?? "";
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);
    unmount();

    render(<App />);
    await waitFor(() => {
      expect(getTotalCount()).toBe(47);
      expect(screen.queryByRole("button", { name: firstLiveName })).not.toBeInTheDocument();
    });
  });

  test("控制台页只显示占位内容，不显示表格", async () => {
    // 测试点：控制台页签切换后，仅展示预留文案。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "示例 Live 名称 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "控制台" }));

    expect(screen.getByText("控制台内容预留中")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "日期" })).not.toBeInTheDocument();
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
    render(<App />);
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

  test("URL 列使用链接图标并携带正确链接", () => {
    // 测试点：URL 列展示为 🔗，并指向对应详情地址。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20, withUrl: true }),
    );
    render(<App />);
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
    render(<App />);
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
    render(<App />);

    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 20));
    await user.selectOptions(screen.getByRole("combobox"), "15");
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 15));
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
    render(<App />);
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 20));

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(2, 20));

    await user.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledWith(1, 20));
  });

  test("分页总计与总页数以后端返回为准", async () => {
    // 测试点：显示使用 pagination.total/total_pages，而非本地 items 长度。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 120, totalPages: 6, itemCount: 3 }),
    );
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("总计 120 条")).toBeInTheDocument();
      expect(screen.getByText("第 1 / 6 页")).toBeInTheDocument();
    });
  });

  test("后端校正页码后，前端页码显示与请求参数会同步", async () => {
    // 测试点：后端返回 pagination.page 被校正时，前端自动 setPage 并二次请求。
    getLivesMock
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 40, totalPages: 2, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 20, totalPages: 1, itemCount: 20 }),
      )
      .mockResolvedValueOnce(
        makeResponse({ page: 1, pageSize: 20, total: 20, totalPages: 1, itemCount: 20 }),
      );
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
      expect(getLivesMock).toHaveBeenCalledWith(1, 20);
    });
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

  test("跨页后收藏状态仍按 live_id 生效", async () => {
    // 测试点：分页切换后，localStorage 收藏状态按同一 live_id 继续生效。
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
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "全量" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await user.click(screen.getByRole("button", { name: "上一页" }));
    await user.click(screen.getByRole("button", { name: "收藏" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "示例 Live 名称 1" })).not.toBeInTheDocument();
    });
  });

  test("控制台页不会触发列表请求，切回列表页后才请求", async () => {
    // 测试点：切到控制台不请求 /api/lives，切回列表后重新请求。
    getLivesMock.mockResolvedValue(
      makeResponse({ page: 1, pageSize: 20, total: 47, totalPages: 3, itemCount: 20 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "控制台" }));
    expect(getLivesMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "全量" }));
    await waitFor(() => expect(getLivesMock).toHaveBeenCalledTimes(2));
  });
});
