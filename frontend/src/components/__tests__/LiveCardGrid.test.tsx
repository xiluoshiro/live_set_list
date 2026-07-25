import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { LiveCardGrid, type LiveRow } from "../LiveCardGrid";


function makeGroupRow(): LiveRow {
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

// 测试点：普通结束、待举行、进行中、延期和取消场次都应在浏览卡片上显示文字、语义色和可访问状态。
test.each([
  ["scheduled", "past", false, "past", "已结束"],
  ["scheduled", "upcoming", false, "upcoming", "待举行"],
  ["scheduled", "today", false, "today", "进行中"],
  ["postponed", "upcoming", false, "postponed", "延期"],
  ["cancelled", "past", false, "cancelled", "已取消"],
] as const)("renders %s/%s as the %s status card", (eventStatus, datePhase, wasRescheduled, tone, label) => {
  const { container } = render(
    <LiveCardGrid
      rows={[makeLiveRow(eventStatus, datePhase, wasRescheduled)]}
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

  expect(container.querySelector("article")).toHaveAttribute("data-status-tone", tone);
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText(label).parentElement).toHaveClass("live-card-badges");
  expect(screen.getByRole("button", { name: `查看《状态测试 Live》详情，状态：${label}` })).toBeInTheDocument();
});


// 测试点：全部取消的活动组显示取消标签与取消场数，但仍可进入详情查看各场资料。
test("cancelled performance group card stays aggregated and remains clickable", () => {
  const onOpenGroup = vi.fn();
  const { container } = render(
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

  const card = container.querySelector("article");
  expect(card).toHaveAttribute("data-status-tone", "cancelled");
  expect(screen.getByText("已取消")).toBeInTheDocument();
  expect(screen.getByText("已收录 2 日 · 2 场 · 取消 2 场")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看活动组《两日活动》详情，状态：已取消" }));
  expect(onOpenGroup).toHaveBeenCalledWith(3, "两日活动");
});
