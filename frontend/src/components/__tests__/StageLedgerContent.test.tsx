import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, vi } from "vitest";

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
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  // 测试点：公开详情的场馆、开场和开演空值必须逐项显示“未公布”。
  test("排期字段为空时显示未公布", () => {
    renderStage(makeDetail({ venue_id: null, venue: null, opening_time: null, start_time: null }));

    expect(screen.getAllByText("未公布")).toHaveLength(3);
  });

  test("按结构化位置渲染连续流程，并展示曲目细节", async () => {
    // 测试点：Stage Ledger 保留 segment/absolute_order/song_id，点击曲目后详情可展开并由 Escape 还原焦点。
    const user = userEvent.setup();
    const onOpenBand = vi.fn();
    const { container } = renderStage(makeDetail(), { onOpenBand });

    expect(container.querySelector("ol.stage-track-list")).not.toBeNull();
    expect(screen.getAllByText("Main Set").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Opening Act").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("ZZ").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Song One")).toBeInTheDocument();
    expect(screen.getAllByText("01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "打开官方网页" })).toHaveAttribute("href", "https://example.com/live/77");
    expect(container.querySelector(".stage-actions .stage-official-link")).not.toBeNull();
    expect(container.querySelector(".stage-sources-section")).toBeNull();
    expect(screen.queryByText("资料来源")).not.toBeInTheDocument();
    expect(screen.queryByText("阵容摘要")).not.toBeInTheDocument();
    expect(screen.queryByText("逐曲检查器")).not.toBeInTheDocument();
    expect(screen.queryByText("按原始段落和绝对顺序排列，实际出演关系在曲目中展开。")).not.toBeInTheDocument();
    expect(screen.queryByText("查看")).not.toBeInTheDocument();
    expect(container.querySelector(".stage-summary-trigger")).toBeNull();
    expect(document.title).toBe("Stage Ledger Live · LiveSetList");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("日本武道館");

    const previousHistoryState = window.history.state;
    await user.click(screen.getByRole("button", { name: /Song One/ }));
    const trigger = screen.getByRole("button", { name: /Song One/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(window.location.hash).not.toBe("#track-M1");
    expect(window.history.state).toBe(previousHistoryState);
    expect(trigger).not.toHaveTextContent("Poppin'Party");
    expect(screen.getAllByRole("heading", { name: "Song One" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("阵容版本：Poppin'Party / V1")).not.toBeInTheDocument();
    expect(screen.getAllByText("实到成员：Kasumi / Tae").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("缺席成员：Rimi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("额外出演：Guest（嘉宾）").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "Poppin'Party" }));
    expect(onOpenBand).toHaveBeenCalledWith(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Song One" })).not.toBeInTheDocument());

    const structuredData = JSON.parse(container.querySelector("script[data-stage-ledger-jsonld]")?.textContent ?? "{}");
    expect(structuredData.url).toMatch(/\/lives\/77$/);
  });

  test("保留共同出演的时间轴连续性", () => {
    // 测试点：共同出演只增加成员时，保留共享乐队的连续色轨，不制造无意义的时间断点。
    const baseRow = makeDetail().detail_rows[0];
    const pastel = { ...baseRow.band_members[0], band_id: 3, band_name: "Pastel＊Palettes" };
    const afterglow = { ...pastel, band_id: 4, band_name: "Afterglow" };
    const detail = makeDetail({
      detail_rows: [
        { ...baseRow, row_id: "M19", absolute_order: 19, song_name: "Song Nineteen", band_members: [pastel] },
        { ...baseRow, row_id: "M20", absolute_order: 20, song_name: "Song Twenty", band_members: [pastel] },
        { ...baseRow, row_id: "M21", absolute_order: 21, song_name: "Song Twenty One", band_members: [afterglow, pastel] },
        { ...baseRow, row_id: "M22", absolute_order: 22, song_name: "Song Twenty Two", band_members: [pastel] },
      ],
    });
    const { container } = renderStage(detail);

    const blocks = container.querySelectorAll(".stage-act-block");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toHaveClass("is-continuation");
    expect(blocks[2]).toHaveClass("is-continuation");
  });

  // 测试点：两支乐队分别从 M1 编号时，曲目分组和详情选择不能因重复 row_id 串行。
  test("重复展示编号仍按 Setlist UUID 打开对应歌曲", async () => {
    const user = userEvent.setup();
    const baseRow = makeDetail().detail_rows[0];
    const mygoMember = {
      ...baseRow.band_members[0],
      band_id: 8,
      band_name: "MyGO!!!!!",
      present_members: ["羊宮妃那"],
      present_count: 1,
    };
    const detail = makeDetail({
      bands: [1, 8],
      band_names: ["Poppin'Party", "MyGO!!!!!"],
      detail_rows: [
        {
          ...baseRow,
          setlist_id: "setlist-first-m1",
          row_id: "M1",
          absolute_order: 1,
          song_name: "First Band Song",
        },
        {
          ...baseRow,
          setlist_id: "setlist-second-m1",
          row_id: "M1",
          absolute_order: 2,
          song_name: "Second Band Song",
          band_members: [mygoMember],
        },
      ],
    });
    const { container } = renderStage(detail);

    const blocks = container.querySelectorAll(".stage-act-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveTextContent("Poppin'Party");
    expect(blocks[0]).not.toHaveTextContent("MyGO!!!!!");
    expect(blocks[1]).toHaveTextContent("MyGO!!!!!");
    expect(blocks[1]).not.toHaveTextContent("Poppin'Party");

    await user.click(screen.getByRole("button", { name: /Second Band Song/ }));
    expect(screen.getAllByRole("heading", { name: "Second Band Song" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("heading", { name: "First Band Song" })).not.toBeInTheDocument();
    expect(screen.getAllByText("实到成员：羊宮妃那").length).toBeGreaterThanOrEqual(1);
  });

  test("流程摘要中的段落与乐队跳转分成两行", () => {
    // 测试点：长流程的页内跳转按段落与出演乐队分层，避免两类定位入口挤在同一行。
    const baseRow = makeDetail().detail_rows[0];
    const detail = makeDetail({
      detail_rows: [
        ...Array.from({ length: 19 }, (_, index) => ({
          ...baseRow,
          row_id: `M${index + 1}`,
          absolute_order: index + 1,
          sub_order: index + 1,
          song_name: `Main Song ${index + 1}`,
        })),
        { ...baseRow, row_id: "OP20", absolute_order: 20, sub_order: 20, segment_type: "OP", song_name: "Opening Song" },
        { ...baseRow, row_id: "EN21", absolute_order: 21, sub_order: 21, segment_type: "EN", song_name: "Encore Song" },
      ],
    });
    const { container } = renderStage(detail);

    const jumpRows = container.querySelectorAll(".stage-jump-row");
    expect(jumpRows).toHaveLength(2);
    expect(jumpRows[0]).toHaveTextContent("Opening Act");
    expect(jumpRows[1]).toHaveTextContent("Poppin'Party");
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

  test("曲目详情不写入 history，关闭后只恢复触发按钮焦点", async () => {
    // 测试点：曲目详情属于当前页面内的瞬时状态，不新增浏览器历史，关闭后把焦点还给原曲目。
    const user = userEvent.setup();
    const previousUrl = window.location.href;
    const previousState = window.history.state;
    renderStage(makeDetail());

    const trigger = screen.getByRole("button", { name: /Song One/ });
    await user.click(trigger);
    expect(window.location.href).toBe(previousUrl);
    expect(window.history.state).toBe(previousState);

    await user.click(screen.getAllByRole("button", { name: "关闭歌曲详情" })[0]);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Song One" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  test("取消状态隐藏收藏和歌单，并展示取消原因", () => {
    // 测试点：cancelled 路径只展示可核对的状态资料，不渲染可误解为已发生的演出流程；正文固定为“本场演出已取消。”，原因以小字展示，且不再出现小字“取消”。
    const onToggleFavorite = vi.fn();
    renderStage(
      makeDetail({ event_status: "cancelled", status_note: "因场地原因取消" }),
      { canFavorite: true, onToggleFavorite },
    );

    expect(screen.getByRole("heading", { name: "本场演出已取消。" })).toBeInTheDocument();
    expect(screen.getByText("取消原因：因场地原因取消")).toBeInTheDocument();
    expect(screen.queryByText("取消")).not.toBeInTheDocument();
    expect(screen.queryByText("Song One")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument();
  });

  test("取消且无原因时只显示固定标题", () => {
    // 测试点：没有取消原因时不显示原因行，取消正文只保留“本场演出已取消。”一句。
    renderStage(makeDetail({ event_status: "cancelled", status_note: null }));

    expect(screen.getByRole("heading", { name: "本场演出已取消。" })).toBeInTheDocument();
    expect(screen.queryByText(/取消原因/)).not.toBeInTheDocument();
  });

  test("待举行 Live 空状态提示本场演出尚未举行", () => {
    // 测试点：未举行场次无曲目时只显示“本场演出尚未举行。”，不再显示“演出流程尚未记录”。
    renderStage(makeDetail({ date_phase: "upcoming", detail_rows: [] }));

    expect(screen.getByRole("heading", { name: "本场演出尚未举行。" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "演出流程尚未记录" })).not.toBeInTheDocument();
  });

  test("已结束活动空状态提示本场活动暂无演出曲目", () => {
    // 测试点：已结束且无出席阵容、无曲目的活动只显示一句“本场活动暂无演出曲目。”。
    renderStage(makeDetail({ live_type: "event", date_phase: "past", detail_rows: [] }));

    expect(screen.getByRole("heading", { name: "本场活动暂无演出曲目。" })).toBeInTheDocument();
    expect(screen.queryByText("本页目前只收录演出基本资料")).not.toBeInTheDocument();
  });

  test("已结束普通场次空状态保留原提示", () => {
    // 测试点：已结束且无曲目的普通场次仍显示“演出流程尚未记录”的原有提示。
    renderStage(makeDetail({ date_phase: "past", detail_rows: [] }));

    expect(screen.getByRole("heading", { name: "演出流程尚未记录" })).toBeInTheDocument();
    expect(screen.getByText("本页目前只收录演出基本资料，暂无演出曲目记录。")).toBeInTheDocument();
  });

  test("进行中活动空状态保留原提示", () => {
    // 测试点：进行中的活动空状态不受文案调整影响，保留原有两行提示。
    renderStage(makeDetail({ live_type: "event", date_phase: "today", detail_rows: [] }));

    expect(screen.getByRole("heading", { name: "本页目前只收录演出基本资料" })).toBeInTheDocument();
    expect(screen.getByText("暂无出席阵容或演出曲目记录。")).toBeInTheDocument();
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
