import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { vi } from "vitest";

import type { LiveDetailResponse } from "../../api";
import { StageLedgerContent } from "../StageLedgerContent";

function makeDetail(overrides: Partial<LiveDetailResponse> = {}): LiveDetailResponse {
  return {
    live_id: 77,
    live_date: "2026-08-01",
    live_title: "Stage Ledger Live",
    live_type: "oneman",
    venue_id: 9,
    venue: "日本武道館",
    opening_time: "17:00:00+09:00",
    start_time: "18:00:00+09:00",
    bands: [1],
    band_names: ["Poppin'Party"],
    url: "https://example.com/live/77",
    is_favorite: false,
    event_attendees: [],
    detail_rows: [
      {
        row_id: "M1",
        absolute_order: 1,
        segment_type: "M",
        sub_order: 1,
        song_id: 11,
        song_name: "Song One",
        band_members: [
          {
            band_id: 1,
            band_name: "Poppin'Party",
            lineup_version: { lineup_version_id: 101, version_label: "Poppin'Party / V1" },
            present_members: ["Kasumi", "Tae"],
            present_count: 2,
            total_count: 5,
            expected_count: 5,
            missing_members: ["Rimi"],
            extra_members: [{ member_name: "Guest", category: "guest" }],
            attendance_status: "partial",
            is_full: false,
          },
        ],
        other_members: [{ key: "嘉宾", value: ["Guest"] }],
        comments: ["短版"],
      },
      {
        row_id: "OP1",
        absolute_order: 2,
        segment_type: "OP",
        sub_order: 1,
        song_id: 12,
        song_name: "Opening Song",
        band_members: [],
        other_members: [],
        comments: [],
      },
      {
        row_id: "ZZ1",
        absolute_order: 3,
        segment_type: "ZZ",
        sub_order: 1,
        song_id: 13,
        song_name: "Unknown Segment Song",
        band_members: [],
        other_members: [],
        comments: [],
      },
    ],
    ...overrides,
  };
}

function renderStage(detailData: LiveDetailResponse, extra: Partial<ComponentProps<typeof StageLedgerContent>> = {}) {
  return render(
    <StageLedgerContent
      detailData={detailData}
      detailLoading={false}
      detailError={null}
      fallback={{ liveTitle: detailData.live_title, liveDate: detailData.live_date, url: detailData.url }}
      onBack={vi.fn()}
      {...extra}
    />,
  );
}

describe("StageLedgerContent", () => {
  test("按结构化位置渲染连续流程，并用检查器展示曲目细节", async () => {
    // 测试点：Stage Ledger 保留 segment/absolute_order/song_id，点击曲目后检查器可展开并由 Escape 还原焦点。
    const user = userEvent.setup();
    const onOpenBand = vi.fn();
    const { container } = renderStage(makeDetail(), { onOpenBand });

    expect(container.querySelector("ol.stage-track-list")).not.toBeNull();
    expect(screen.getAllByText("Main Set").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Opening Act").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("ZZ").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Song One")).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(document.title).toBe("Stage Ledger Live · LiveSetList");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("日本武道館");

    await user.click(screen.getByRole("link", { name: "演出流程" }));
    expect(container.querySelector("#stage-flow")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /Song One/ }));
    const trigger = screen.getByRole("button", { name: /Song One/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("heading", { name: "Song One" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("阵容版本：Poppin'Party / V1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("缺席成员：Rimi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("额外出演：Guest（嘉宾）").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "Poppin'Party" }));
    expect(onOpenBand).toHaveBeenCalledWith(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.getByText("选择一首歌曲查看实际出演、阵容版本和资料标记。")).toBeInTheDocument();

    const structuredData = JSON.parse(container.querySelector("script[data-stage-ledger-jsonld]")?.textContent ?? "{}");
    expect(structuredData.url).toMatch(/\/lives\/77$/);
  });

  test("Event 先呈现出席阵容，不伪造空歌单", async () => {
    // 测试点：Event 路径优先呈现 attendees，只有存在曲目时才展示流程区。
    const user = userEvent.setup();
    const detail = makeDetail({
      live_type: "event",
      detail_rows: [],
      event_attendees: [
        { band_id: 1, band_name: "Poppin'Party", mode: "full", members: ["Kasumi", "Tae"] },
        { band_id: 2, band_name: "Roselia", mode: "partial", members: ["Yukina"] },
      ],
    });
    renderStage(detail);

    expect(screen.getByRole("heading", { name: "出演阵容" })).toBeInTheDocument();
    expect(screen.getAllByText("Poppin'Party").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Roselia").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("heading", { name: "演出流程尚未记录" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Roselia/ }));
    expect(screen.getByText("已记录成员：Yukina")).toBeInTheDocument();
  });

  test("直接打开曲目 hash 会在详情加载后展开对应曲目", async () => {
    // 测试点：可分享的 #track-* 深链在首轮加载态不会被清掉，数据确认后应恢复目标曲目。
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", "/lives/77#track-M1");

    try {
      renderStage(makeDetail());

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Song One/ })).toHaveAttribute("aria-expanded", "true");
      });
      expect(window.location.hash).toBe("#track-M1");
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  test("取消状态隐藏收藏和歌单，并保留状态说明", () => {
    // 测试点：cancelled 路径只展示可核对的状态资料，不渲染可误解为已发生的演出流程。
    const onToggleFavorite = vi.fn();
    renderStage(
      makeDetail({ event_status: "cancelled", status_note: "因场地原因取消" }),
      { canFavorite: true, onToggleFavorite },
    );

    expect(screen.getByRole("heading", { name: "本场 Live 已取消" })).toBeInTheDocument();
    expect(screen.getByText("因场地原因取消")).toBeInTheDocument();
    expect(screen.queryByText("Song One")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument();
  });

  test("未登录时只提供登录后收藏入口", async () => {
    // 测试点：匿名用户不能看到可误解为已授权的收藏按钮，点击登录入口应交给上层登录流程。
    const user = userEvent.setup();
    const onRequestLogin = vi.fn();
    renderStage(makeDetail(), { onToggleFavorite: vi.fn(), onRequestLogin });

    expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument();
    const loginButtons = screen.getAllByRole("button", { name: "登录后收藏" });
    expect(loginButtons).toHaveLength(2);
    await user.click(loginButtons[0]);
    expect(onRequestLogin).toHaveBeenCalledTimes(1);
  });

  test("加载、404 和失败状态都给出明确反馈", () => {
    // 测试点：数据尚未确认时使用布局骨架，404 与 500 状态都不能伪造歌单。
    const { rerender } = render(
      <StageLedgerContent
        detailData={null}
        detailLoading
        detailError={null}
        fallback={{ liveTitle: "Loading Live", liveDate: "2026-08-01", url: null }}
      />,
    );
    expect(screen.getByText("Loading Live")).toBeInTheDocument();
    expect(screen.queryByText("Song One")).not.toBeInTheDocument();

    rerender(
      <StageLedgerContent
        detailData={null}
        detailLoading={false}
        detailError="服务不可用"
        fallback={{ liveTitle: "Failed Live", liveDate: "2026-08-01", url: null }}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "详情读取失败" })).toBeInTheDocument();
    expect(screen.getByText("服务不可用")).toBeInTheDocument();

    rerender(
      <StageLedgerContent
        detailData={null}
        detailLoading={false}
        detailError={null}
        detailNotFound
        fallback={{ liveTitle: "Missing Live", liveDate: "2026-08-01", url: null }}
      />,
    );
    expect(screen.getByRole("heading", { name: "未找到这场 Live" })).toBeInTheDocument();
  });
});
