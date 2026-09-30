import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { formatCompactPerformanceDate, LiveCardGrid, type LiveRow } from "../LiveCardGrid";


function makeGroupRow(overrides: Partial<LiveRow> = {}): LiveRow {
  return {
    kind: "performance_group",
    liveId: -1,
    liveDate: "2026-02-01",
    liveTitle: "两日活动",
    liveType: "多日活动",
    icons: [],
    url: null,
    groupId: 3,
    groupTitle: "两日活动",
    groupStartDate: "2026-02-01",
    groupEndDate: "2026-02-02",
    groupDayCount: 2,
    groupLiveCount: 2,
    groupCancelledLiveCount: 2,
    groupIcons: [],
    eventStatus: null,
    datePhase: null,
    wasRescheduled: false,
    ...overrides,
  };
}

function makeLiveRow(
  eventStatus: LiveRow["eventStatus"],
  datePhase: LiveRow["datePhase"],
  wasRescheduled = false,
): LiveRow {
  return {
    ...makeGroupRow(),
    kind: "live",
    liveId: 8,
    liveTitle: "状态测试 Live",
    liveType: "oneman",
    groupId: null,
    groupTitle: null,
    groupStartDate: null,
    groupEndDate: null,
    groupDayCount: null,
    groupLiveCount: null,
    groupCancelledLiveCount: null,
    groupIcons: [],
    eventStatus,
    datePhase,
    wasRescheduled,
  };
}

// 测试点：结束、待举行、进行中、延期和取消场次均显示对应文字及可访问状态。
test.each([
  ["scheduled", "past", "已结束"],
  ["scheduled", "upcoming", "待举行"],
  ["scheduled", "today", "进行中"],
  ["postponed", "upcoming", "延期 · 待举行"],
  ["cancelled", "past", "已取消"],
] as const)("renders %s/%s as %s", (eventStatus, datePhase, label) => {
  render(
    <LiveCardGrid
      rows={[makeLiveRow(eventStatus, datePhase)]}
      showStar={false}
      isFavorite={() => false}
      isSyncing={() => false}
      onToggleStar={vi.fn()}
      onOpenLive={vi.fn()}
      loading={false}
      loadError={null}
      sentinelRef={createRef<HTMLDivElement>()}
      loadingMore={false}
      hasMore={false}
      total={1}
    />,
  );

  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: `查看《状态测试 Live》详情，状态：${label}` })).toBeInTheDocument();
});

// 测试点：活动组日期分别格式化同月、跨月范围，并在范围缺失时使用单场日期。
test("formats compact performance group date ranges", () => {
  expect(formatCompactPerformanceDate(null, null, "2026-07-04")).toBe("2026.07.04");
  expect(formatCompactPerformanceDate("2026-07-18", "2026-07-19", "fallback")).toBe("2026.07.18–19");
  expect(formatCompactPerformanceDate("2026-07-30", "2026-08-01", "fallback")).toBe("2026.07.30–08.01");
});

// 测试点：普通演出卡片与活动组卡片使用相同的点号日期格式。
test("formats a regular live card date with dots", () => {
  render(
    <LiveCardGrid
      rows={[makeLiveRow("scheduled", "today")]}
      showStar={false}
      isFavorite={() => false}
      isSyncing={() => false}
      onToggleStar={vi.fn()}
      onOpenLive={vi.fn()}
      loading={false}
      loadError={null}
      sentinelRef={createRef<HTMLDivElement>()}
      loadingMore={false}
      hasMore={false}
      total={1}
    />,
  );

  expect(screen.getByText("2026.02.01")).toBeInTheDocument();
});

// 测试点：取消场次即使登录也不显示收藏入口，避免前端发起无效收藏。
test("hides favorite action for a cancelled live", () => {
  render(
    <LiveCardGrid
      rows={[makeLiveRow("cancelled", "past")]}
      showStar
      isFavorite={() => false}
      isSyncing={() => false}
      onToggleStar={vi.fn()}
      onOpenLive={vi.fn()}
      loading={false}
      loadError={null}
      sentinelRef={createRef<HTMLDivElement>()}
      loadingMore={false}
      hasMore={false}
      total={1}
    />,
  );

  expect(screen.queryByRole("button", { name: "加入收藏" })).not.toBeInTheDocument();
});


// 测试点：已结束活动组显示已结束状态与收录场数，没有取消场次时不显示取消计数。
test("past performance group card uses compact collected badge", () => {
  render(
    <LiveCardGrid
      rows={[makeGroupRow({ groupCancelledLiveCount: 0 })]}
      showStar={false}
      isFavorite={() => false}
      isSyncing={() => false}
      onToggleStar={vi.fn()}
      onOpenLive={vi.fn()}
      onOpenGroup={vi.fn()}
      loading={false}
      loadError={null}
      sentinelRef={createRef<HTMLDivElement>()}
      loadingMore={false}
      hasMore={false}
      total={1}
    />,
  );

  expect(screen.getByText("已结束")).toBeInTheDocument();
  expect(screen.getByText("收录2")).toBeInTheDocument();
  expect(screen.queryByText("取消0")).not.toBeInTheDocument();
});

// 测试点：全部取消的活动组显示紧凑收录与取消标签，但仍可进入详情查看各场资料。
test("cancelled performance group card stays aggregated and remains clickable", () => {
  const onOpenGroup = vi.fn();
  render(
    <LiveCardGrid
      rows={[makeGroupRow()]}
      showStar={false}
      isFavorite={() => false}
      isSyncing={() => false}
      onToggleStar={vi.fn()}
      onOpenLive={vi.fn()}
      onOpenGroup={onOpenGroup}
      loading={false}
      loadError={null}
      sentinelRef={createRef<HTMLDivElement>()}
      loadingMore={false}
      hasMore={false}
      total={1}
    />,
  );

  expect(screen.getByText("已取消")).toBeInTheDocument();
  expect(screen.getByText("收录2")).toBeInTheDocument();
  expect(screen.getByText("取消2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看活动组《两日活动》详情，状态：已取消" }));
  expect(onOpenGroup).toHaveBeenCalledWith(3, "两日活动");
});
