import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

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
});
