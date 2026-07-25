import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LiveDetailResponse } from "../../api";
import { LiveDetailContent } from "../LiveDetailContent";


function makeDetail(liveType: string): LiveDetailResponse {
  return {
    live_id: 88,
    live_date: "2026-08-08",
    live_title: "Event Detail",
    live_type: liveType,
    venue: "Test Venue",
    opening_time: "12:00:00+09:00",
    start_time: "13:00:00+09:00",
    bands: [3, 8],
    band_names: ["MyGO!!!!!", "Ave Mujica"],
    url: null,
    is_favorite: false,
    event_attendees: [
      {
        band_id: 3,
        band_name: "MyGO!!!!!",
        mode: "partial",
        members: ["高松燈", "千早愛音"],
      },
      {
        band_id: 8,
        band_name: "Ave Mujica",
        mode: "full",
        members: ["三角初華", "若葉睦", "八幡海鈴", "祐天寺にゃむ", "豊川祥子"],
      },
    ],
    detail_rows: [],
  };
}


describe("LiveDetailContent event attendees", () => {
  // 测试点：活动详情应逐项展示部分成员，并把保存完整名单的全员 Band 压缩成一个“全员”项。
  test("renders compact SVG attendee tokens for event details", () => {
    render(
      <LiveDetailContent
        detailData={makeDetail("event")}
        detailLoading={false}
        detailError={null}
        fallback={{ liveTitle: "Event Detail", liveDate: "2026-08-08", url: null }}
      />,
    );

    const row = screen.getByText("出演成员：").closest("p");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("高松燈")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("千早愛音")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("全员")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("三角初華")).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getAllByRole("img", { name: "MyGO!!!!!" })).toHaveLength(2);
    expect(within(row as HTMLElement).getByRole("img", { name: "Ave Mujica" })).toHaveAttribute(
      "src",
      "/icons/Band_8.svg",
    );
  });

  // 测试点：同一出席数据不得在非活动类型的演出详情中显示。
  test("suppresses attendee tokens for non-event details", () => {
    render(
      <LiveDetailContent
        detailData={makeDetail("oneman")}
        detailLoading={false}
        detailError={null}
        fallback={{ liveTitle: "Event Detail", liveDate: "2026-08-08", url: null }}
      />,
    );

    expect(screen.queryByText("出演成员：")).not.toBeInTheDocument();
  });

  // 测试点：演出详情的活动组入口只显示活动组名称，不重复添加“查看活动组”前缀。
  test("renders the performance group link with its title only", () => {
    const detail = makeDetail("oneman");
    detail.performance_group = { group_id: 7, group_title: "示例活动组" };

    render(
      <LiveDetailContent
        detailData={detail}
        detailLoading={false}
        detailError={null}
        fallback={{ liveTitle: "Event Detail", liveDate: "2026-08-08", url: null }}
        onOpenPerformanceGroup={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "示例活动组" })).toBeInTheDocument();
    expect(screen.queryByText(/查看活动组/)).not.toBeInTheDocument();
  });

  // 测试点：公开详情只展示正式改期历史及其原开场、开演、Venue，不出现内部“资料修正”语义。
  test("renders formal reschedule history without correction wording", () => {
    const detail = makeDetail("oneman");
    detail.event_status = "postponed";
    detail.date_phase = "upcoming";
    detail.was_rescheduled = true;
    detail.status_note = "主办方公告延期";
    detail.schedule_history = [{
      previous_live_title: "Event Detail 原标题",
      previous_live_date: "2026-08-01",
      previous_opening_time: "17:00:00+09:00",
      previous_start_time: "18:00:00+09:00",
      previous_venue_id: 2,
      previous_venue: "Old Venue",
      changed_at: "2026-07-01T10:00:00+00:00",
      note: "主办方正式改期",
    }];

    render(
      <LiveDetailContent
        detailData={detail}
        detailLoading={false}
        detailError={null}
        fallback={{ liveTitle: "Event Detail", liveDate: "2026-08-08", url: null }}
      />,
    );

    const statusPanel = screen.getByRole("region", { name: "演出状态" });
    expect(statusPanel).toHaveAttribute("data-status-tone", "postponed");
    expect(within(statusPanel).getByText("延期 · 待举行")).toBeInTheDocument();
    expect(within(statusPanel).getByText("延期说明：主办方公告延期")).toBeInTheDocument();
    expect(statusPanel.compareDocumentPosition(screen.getByText("日期：").closest(".detail-meta-line") as Node)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/主办方公告延期/)).toHaveLength(1);
    expect(screen.getByText(/名称 Event Detail 原标题 · 日期 2026-08-01 · 开场 17:00\(JP\) · 开演 18:00\(JP\) · 场地 Old Venue/)).toBeInTheDocument();
    expect(screen.queryByText(/资料修正/)).not.toBeInTheDocument();
  });

  // 测试点：取消演出仍展示基础资料，但不渲染已有的详情歌单。
  test("hides setlist details for a cancelled live", () => {
    const detail = makeDetail("oneman");
    detail.event_status = "cancelled";
    detail.date_phase = "past";
    detail.detail_rows = [{
      row_id: "main1",
      song_name: "不应展示的歌曲",
      band_members: [],
      other_members: [],
      comments: [],
      cover_band: null,
    }];

    render(
      <LiveDetailContent
        detailData={detail}
        detailLoading={false}
        detailError={null}
        fallback={{ liveTitle: "Event Detail", liveDate: "2026-08-08", url: null }}
      />,
    );

    expect(screen.getByText("日期：")).toBeInTheDocument();
    expect(screen.queryByText("不应展示的歌曲")).not.toBeInTheDocument();
  });
});
