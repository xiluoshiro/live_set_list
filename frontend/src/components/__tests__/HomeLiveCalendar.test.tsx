import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CatalogCalendarLiveItem, CatalogCalendarResponse } from "../../api";
import { getCatalogCalendar } from "../../api";
import { getCurrentMonthKey, shiftMonthKey } from "../../calendarMonth";
import { HomeLiveCalendar } from "../HomeLiveCalendar";
import type { HomeLiveRow } from "../HomeDashboard";

vi.mock("../../api", () => ({
  getCatalogCalendar: vi.fn(),
}));

const getCatalogCalendarMock = vi.mocked(getCatalogCalendar);

beforeEach(() => {
  vi.stubEnv("TZ", "Asia/Tokyo");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeItem(overrides: Partial<CatalogCalendarLiveItem>): CatalogCalendarLiveItem {
  return {
    live_id: 1,
    live_date: "2026-08-12",
    live_title: "示例 Live",
    start_time: "18:00:00+09:00",
    bands: [1, 2],
    event_status: "scheduled",
    date_phase: "upcoming",
    was_rescheduled: false,
    ...overrides,
  };
}

function makeMonthResponse(
  monthKey: string,
  items: CatalogCalendarLiveItem[],
): CatalogCalendarResponse {
  return { month: monthKey, items };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayIso(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
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

function renderCalendar() {
  const onOpenLive = vi.fn<(row: HomeLiveRow) => void>();
  const onShowAll = vi.fn();
  render(<HomeLiveCalendar onOpenLive={onOpenLive} onShowAll={onShowAll} />);
  return { onOpenLive, onShowAll };
}

describe("HomeLiveCalendar", () => {
  test("初次进入展示当前月，并按规则默认选中日期", async () => {
    // 测试点：当前月有今天 Live 时默认选中今天，标题显示当前月。
    const monthKey = getCurrentMonthKey();
    getCatalogCalendarMock.mockResolvedValue(
      makeMonthResponse(monthKey, [makeItem({ live_date: todayIso(), live_title: "今天 Live" })]),
    );
    renderCalendar();

    expect(screen.getByRole("heading", { name: "Live 日历" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /今天 Live/ })).toBeInTheDocument(),
    );
    const [year, month] = monthKey.split("-").map(Number);
    const todayButton = screen.getByRole("button", { name: new RegExp(`${month} 月`), pressed: true });
    expect(todayButton).toHaveAttribute("aria-current", "date");
    expect(todayButton).toHaveAccessibleName(/1 场 Live/);
    expect(screen.getByText(`${month} 月 ${new Date().getDate()} 日`)).toBeInTheDocument();
  });

  test("今天无 Live 时默认选中最近未来日期", async () => {
    // 测试点：月份里没有今天时，默认选中今天之后最近一个有 Live 的日期。
    const nextMonthKey = shiftMonthKey(getCurrentMonthKey(), 1);
    const nextMonthNumber = Number(nextMonthKey.split("-")[1]);
    getCatalogCalendarMock.mockImplementation((month) =>
      Promise.resolve(
        makeMonthResponse(month, [
          makeItem({ live_id: 1, live_date: `${month}-10`, live_title: "更远 Live" }),
          makeItem({ live_id: 2, live_date: `${month}-05`, live_title: "最近 Live" }),
        ]),
      ),
    );
    renderCalendar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "下个月" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /最近 Live/ })).toBeInTheDocument());
    const selected = screen.getByRole("button", { pressed: true });
    expect(selected).toHaveAccessibleName(new RegExp(`${nextMonthNumber} 月 5 日`));
  });

  test("整月无 Live 时显示月级空状态但仍渲染网格", async () => {
    // 测试点：空月份不是错误，网格保留，标题下提示暂无已收录 Live。
    const monthKey = getCurrentMonthKey();
    getCatalogCalendarMock.mockResolvedValue(makeMonthResponse(monthKey, []));
    renderCalendar();

    expect(await screen.findByText("本月暂无已收录 Live")).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: true })).toHaveAccessibleName(/没有 Live/);
  });

  test("切月请求对应月份，旧月份响应不能覆盖新状态", async () => {
    // 测试点：快速连续切月时只接受最后一次请求的结果。
    const current = getCurrentMonthKey();
    const previous = shiftMonthKey(current, -1);
    const earlier = shiftMonthKey(current, -2);
    const stale = deferred<CatalogCalendarResponse>();
    const fresh = deferred<CatalogCalendarResponse>();
    getCatalogCalendarMock.mockImplementation((month) =>
      month === earlier ? stale.promise : fresh.promise,
    );
    renderCalendar();
    await waitFor(() => expect(getCatalogCalendarMock).toHaveBeenCalledWith(current));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "上个月" }));
    await user.click(screen.getByRole("button", { name: "上个月" }));
    await user.click(screen.getByRole("button", { name: "下个月" }));
    const calls = getCatalogCalendarMock.mock.calls.map(([month]) => month);

    fresh.resolve(
      makeMonthResponse(previous, [makeItem({ live_date: "2026-08-12", live_title: "目标月场次" })]),
    );
    expect(await screen.findByText("目标月场次")).toBeInTheDocument();

    stale.resolve(makeMonthResponse(earlier, [makeItem({ live_date: "2026-07-10", live_title: "过期月场次" })]));
    expect(screen.queryByText("过期月场次")).not.toBeInTheDocument();
    expect(screen.getByText("目标月场次")).toBeInTheDocument();
    expect(calls).toContain(earlier);
  });

  test("同日多场显示正确总数，色轨包含全部不同状态", async () => {
    // 测试点：日期格计数与可访问名称覆盖所有状态，色轨按状态去重。
    const monthKey = getCurrentMonthKey();
    const day = todayIso();
    getCatalogCalendarMock.mockResolvedValue(
      makeMonthResponse(monthKey, [
        makeItem({ live_id: 1, live_date: day, live_title: "待举行 Live", event_status: "scheduled", date_phase: "upcoming" }),
        makeItem({ live_id: 2, live_date: day, live_title: "已取消 Live", event_status: "cancelled", date_phase: "upcoming" }),
        makeItem({ live_id: 3, live_date: day, live_title: "延期 Live", event_status: "postponed", date_phase: "upcoming" }),
      ]),
    );
    renderCalendar();

    const dayButton = await screen.findByRole("button", { pressed: true });
    expect(dayButton).toHaveAccessibleName(/3 场 Live/);
    expect(dayButton).toHaveAccessibleName(/已取消 1/);
    expect(dayButton).toHaveAccessibleName(/延期 1/);
    expect(dayButton).toHaveAccessibleName(/待举行 1/);
    const markers = dayButton.querySelectorAll(".event-marker");
    expect(markers).toHaveLength(3);
    expect(markers[0]).toHaveClass("cancelled");
    expect(markers[1]).toHaveClass("postponed");
    expect(markers[2]).toHaveClass("upcoming");
  });

  test("选中日期后展示全部 Live 行并可进入详情", async () => {
    // 测试点：详情列表展示时间、标题、状态，点击整行触发打开详情。
    const monthKey = getCurrentMonthKey();
    const day = todayIso();
    getCatalogCalendarMock.mockResolvedValue(
      makeMonthResponse(monthKey, [
        makeItem({ live_id: 9, live_date: day, live_title: "可点 Live", start_time: "18:30:00+09:00" }),
      ]),
    );
    const { onOpenLive } = renderCalendar();
    const user = userEvent.setup();

    const row = await screen.findByRole("button", { name: /可点 Live/ });
    expect(within(row).getByText("18:30")).toBeInTheDocument();
    expect(within(row).getByText("待举行")).toBeInTheDocument();
    await user.click(row);

    expect(onOpenLive).toHaveBeenCalledTimes(1);
    const opened = onOpenLive.mock.calls[0][0];
    expect(opened.liveId).toBe(9);
    expect(opened.liveDate).toBe(day);
    expect(opened.icons).toEqual([1, 2]);
  });

  test("多 Band 只渲染前两个图标并显示 +N", async () => {
    // 测试点：详情行对多 Band 使用上限 2 个图标加 +N 计数，悬停可见完整列表。
    const monthKey = getCurrentMonthKey();
    const day = todayIso();
    getCatalogCalendarMock.mockResolvedValue(
      makeMonthResponse(monthKey, [
        makeItem({ live_date: day, live_title: "多乐队 Live", bands: [1, 2, 3, 4] }),
      ]),
    );
    renderCalendar();

    const row = await screen.findByRole("button", { name: /多乐队 Live/ });
    const icons = row.querySelectorAll(".band-icon");
    expect(icons).toHaveLength(2);
    expect(within(row).getByText("+2")).toBeInTheDocument();
    expect(row.querySelector(".event-bands")).toHaveAttribute("title", "1 / 2 / 3 / 4");
  });

  test("加载失败显示错误与重试，重试成功后渲染日历", async () => {
    // 测试点：失败只影响日历区，重试按钮可恢复。
    getCatalogCalendarMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(
        makeMonthResponse(getCurrentMonthKey(), [makeItem({ live_title: "重试后 Live" })]),
      );
    renderCalendar();

    expect(await screen.findByRole("alert")).toHaveTextContent("Live 日历加载失败");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("重试后 Live")).toBeInTheDocument();
  });

  test("键盘方向键移动焦点，Enter 选择日期", async () => {
    // 测试点：方向键按天/周移动焦点，Enter 提交选中。
    const monthKey = "2026-08";
    getCatalogCalendarMock.mockResolvedValue(
      makeMonthResponse(monthKey, [
        makeItem({ live_date: "2026-08-12", live_title: "键盘目标 Live" }),
      ]),
    );
    renderCalendar();

    const dayButton = await screen.findByRole("button", { name: /8 月 12 日/ });
    dayButton.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-08-11");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-08-12");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-08-19");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toHaveAttribute("data-date", "2026-08-12");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { pressed: true })).toHaveAccessibleName(/8 月 11 日/);
    expect(screen.getByText(/这一天没有已收录的 Live/)).toBeInTheDocument();
  });

  test("查看全部 Live 触发全量列表跳转", async () => {
    // 测试点：日历详情区底部入口跳转到全部 Live 列表。
    const monthKey = getCurrentMonthKey();
    getCatalogCalendarMock.mockResolvedValue(
      makeMonthResponse(monthKey, [makeItem({ live_date: todayIso(), live_title: "任意 Live" })]),
    );
    const { onShowAll } = renderCalendar();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /查看全部 Live/ }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });
});
