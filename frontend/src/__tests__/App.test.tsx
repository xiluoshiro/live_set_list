import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App";

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
  });

  test("默认进入收藏页，且不显示收藏列", () => {
    // 测试点：默认页签和列显隐是否符合“收藏页不显示收藏列”的规则。
    render(<App />);
    expect(screen.getByRole("button", { name: "收藏" })).toHaveClass("active");
    expect(screen.queryByRole("columnheader", { name: "收藏" })).not.toBeInTheDocument();
    expect(getTotalCount()).toBeGreaterThan(0);
  });

  test("切换到全量页后显示收藏列和星标按钮", async () => {
    // 测试点：仅全量页展示“收藏”列与星标操作入口。
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "全量" }));

    expect(screen.getByRole("button", { name: "全量" })).toHaveClass("active");
    expect(screen.getByRole("columnheader", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "取消收藏" }).length).toBeGreaterThan(0);
  });

  test("取消收藏后回到收藏页会过滤对应条目", async () => {
    // 测试点：收藏状态切换后，收藏页列表与总数会实时更新。
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "全量" }));
    const firstLiveButton = screen.getAllByRole("button", { name: /示例 Live 名称/ })[0];
    const firstLiveName = firstLiveButton.textContent ?? "";
    const before = getTotalCount();
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);
    await user.click(screen.getByRole("button", { name: "收藏" }));

    expect(getTotalCount()).toBe(before - 1);
    expect(screen.queryByRole("button", { name: firstLiveName })).not.toBeInTheDocument();
  });

  test("收藏状态会持久化到 localStorage", async () => {
    // 测试点：刷新后仍保留用户的收藏状态。
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    const before = getTotalCount();
    await user.click(screen.getByRole("button", { name: "全量" }));
    const firstLiveButton = screen.getAllByRole("button", { name: /示例 Live 名称/ })[0];
    const firstLiveName = firstLiveButton.textContent ?? "";
    await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);
    unmount();

    render(<App />);
    expect(getTotalCount()).toBe(before - 1);
    expect(screen.queryByRole("button", { name: firstLiveName })).not.toBeInTheDocument();
  });

  test("控制台页只显示占位内容，不显示表格", async () => {
    // 测试点：控制台页签切换后，仅展示预留文案。
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "控制台" }));

    expect(screen.getByText("控制台内容预留中")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "日期" })).not.toBeInTheDocument();
  });

  test("分页和每页条数切换正常工作", async () => {
    // 测试点：分页跳转与 15/20 行切换后页码计算正确。
    const user = userEvent.setup();
    render(<App />);

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
    const user = userEvent.setup();
    render(<App />);

    const firstLiveButton = screen.getAllByRole("button", { name: /示例 Live 名称/ })[0];
    const firstLiveName = firstLiveButton.textContent ?? "";
    await user.click(firstLiveButton);
    expect(screen.getByRole("heading", { name: firstLiveName })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("heading", { name: firstLiveName })).not.toBeInTheDocument();
  });

  test("URL 列使用链接图标并携带正确链接", () => {
    // 测试点：URL 列展示为 🔗，并指向对应详情地址。
    render(<App />);
    const firstLink = screen.getAllByRole("link", { name: "🔗" })[0];
    expect(firstLink.getAttribute("href")).toMatch(/^https:\/\/example\.com\/live\/\d+$/);
  });

  test("乐队列渲染图标单元格", () => {
    // 测试点：乐队列应渲染图标容器与 SVG 图标。
    render(<App />);
    const firstBandCell = screen.getAllByTitle(/个图标/)[0];
    const bandIcons = within(firstBandCell).getAllByRole("img", { name: /Band \d+/ });
    expect(bandIcons.length).toBeGreaterThan(0);
    bandIcons.forEach((icon) => {
      expect(icon.getAttribute("src")).toMatch(/^\/icons\/Band_\d+\.svg$/);
    });
  });
});
