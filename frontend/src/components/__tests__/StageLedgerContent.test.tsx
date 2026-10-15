import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, vi } from "vitest";

import type { LiveDetailResponse } from "../../api";
import { StageLedgerContent } from "../StageLedgerContent";

const apiMocks = vi.hoisted(() => ({ getVenueMaps: vi.fn() }));

vi.mock("../../api", () => ({ getVenueMaps: apiMocks.getVenueMaps }));

function makeDetail(overrides: Partial<LiveDetailResponse> = {}): LiveDetailResponse {
  return {
    live_id: 77,
    live_date: "2026-08-01",
    live_title: "Stage Ledger Live",
    live_type: "oneman",
    venue_id: 9,
    venue: "日本武道館",
    venue_kind: "physical",
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
  beforeEach(() => {
    apiMocks.getVenueMaps.mockReset();
    apiMocks.getVenueMaps.mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  // 测试点：后端 IANA 标签优先于同偏移的旧映射，开场与开演分别显示。
  test("使用后端生成的时区缩写", () => {
    renderStage(makeDetail({ opening_timezone_label: "KST", start_timezone_label: "KST" }));
    expect(screen.getByText("17:00 (KST)")).toBeInTheDocument();
    expect(screen.getByText("18:00 (KST)")).toBeInTheDocument();
    expect(screen.queryByText("18:00 (JST)")).not.toBeInTheDocument();
  });

  // 测试点：无 IANA 标签时恢复旧偏移映射，未收录偏移仍保留 UTC 格式。
  test("只有固定偏移时沿用原映射", () => {
    renderStage(makeDetail({ opening_timezone_label: null, start_timezone_label: null,
      start_time: "18:00:00+05:45" }));
    expect(screen.getByText("17:00 (JST)")).toBeInTheDocument();
    expect(screen.getByText("18:00 (UTC+05:45)")).toBeInTheDocument();
  });

  // 测试点：改期历史采用该次历史的缩写，不能套用当前演出标签。
  test("改期记录显示历史时区缩写", () => {
    renderStage(makeDetail({ opening_timezone_label: "JST", start_timezone_label: "JST",
      schedule_history: [{ previous_live_title: null, previous_live_date: "2026-07-01",
        previous_opening_time: "17:00:00-04:00", previous_start_time: "18:00:00-04:00",
        previous_opening_timezone_label: "EDT", previous_start_timezone_label: "EDT",
        previous_venue_id: 2, previous_venue_name_version_id: 2, previous_venue: "New York",
        changed_at: "2026-07-02T00:00:00Z", note: null }] }));
    expect(screen.getByText(/开场 17:00 \(EDT\).*开演 18:00 \(EDT\)/)).toBeInTheDocument();
  });

  // 测试点：公开详情的场馆、开场和开演空值必须逐项显示“未公布”。
  test("排期字段为空时显示未公布", () => {
    renderStage(makeDetail({ venue_id: null, venue: null, opening_time: null, start_time: null }));

    expect(screen.getAllByText("未公布")).toHaveLength(3);
  });

  // 测试点：实体场馆名进入站内详情，场馆标题本身承载地图菜单，避免独立按钮换行。
  test("实体场馆名和场馆标题提供两个入口", async () => {
    const user = userEvent.setup();
    const onOpenVenue = vi.fn();
    apiMocks.getVenueMaps.mockResolvedValue({
      venue_id: 9,
      venue_name: "日本武道館",
      map_links: [{ provider: "google", url: "https://maps.example/venue", source: "place" }],
    });

    renderStage(makeDetail(), { onOpenVenue });

    await user.click(screen.getByRole("button", { name: "日本武道館" }));
    expect(onOpenVenue).toHaveBeenCalledWith(9, "日本武道館");
    expect(await screen.findByRole("button", { name: "选择日本武道館的地图" })).toBeInTheDocument();
  });

  // 测试点：线上和未公开场馆只显示文本，不提供无意义的详情或地图入口。
  test("非实体场馆不提供详情和地图入口", () => {
    renderStage(makeDetail({ venue_kind: "online", venue: "Online Streaming" }), { onOpenVenue: vi.fn() });

    expect(screen.getByText("Online Streaming")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Online Streaming" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /选择.*的地图/ })).not.toBeInTheDocument();
  });

  test("按结构化位置渲染连续流程，并展示曲目细节", async () => {
    // 测试点：演出流程展示分段和曲序，曲目详情提供实际出演成员与乐队导航。
    const user = userEvent.setup();
    const onOpenBand = vi.fn();
    const { container } = renderStage(makeDetail(), { onOpenBand });

    expect(screen.getByRole("heading", { name: "Main Set" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Opening Act" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ZZ" })).toBeInTheDocument();
    expect(screen.getByText("Song One")).toBeInTheDocument();
    expect(screen.getAllByText("01").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "打开官方网页" })).toHaveAttribute("href", "https://example.com/live/77");
    expect(document.title).toBe("Stage Ledger Live · LiveSetList");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("日本武道館");

    const previousHistoryState = window.history.state;
    await user.click(screen.getByRole("button", { name: /Song One/ }));
    const trigger = screen.getByRole("button", { name: /Song One/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(window.history.state).toBe(previousHistoryState);
    expect(trigger).not.toHaveTextContent("Poppin'Party");
    expect(screen.getAllByRole("heading", { name: "Song One" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("实到成员：Kasumi / Tae").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("缺席成员：Rimi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("额外出演：Guest（嘉宾）").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "Poppin'Party" }));
    expect(onOpenBand).toHaveBeenCalledWith(1);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Song One" })).not.toBeInTheDocument());

    const structuredData = JSON.parse(container.querySelector("script[data-stage-ledger-jsonld]")?.textContent ?? "{}");
    expect(structuredData.url).toMatch(/\/lives\/77$/);
  });

  // 测试点：宽屏默认展示首曲；选择其他歌曲与切换场次时详情随数据更新。
  test("宽屏始终展示当前场次的歌曲详情", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const user = userEvent.setup();
    const detail = makeDetail();
    const { rerender } = renderStage(detail);
    expect(within(screen.getByRole("complementary", { name: "歌曲详情" })).getByRole("heading", { name: "Song One" })).toBeInTheDocument();
    const second = screen.getByRole("button", { name: /Opening Song/ });
    await user.click(second);
    await user.click(second);
    expect(within(screen.getByRole("complementary", { name: "歌曲详情" })).getByRole("heading", { name: "Opening Song" })).toBeInTheDocument();
    const next = makeDetail({ live_id: 78, detail_rows: [{ ...detail.detail_rows[0], song_name: "Next Live Song" }] });
    rerender(<StageLedgerContent detailData={next} detailLoading={false} detailError={null}
      fallback={{ liveTitle: next.live_title, liveDate: next.live_date, url: next.url }} />);
    expect(within(screen.getByRole("complementary", { name: "歌曲详情" })).getByRole("heading", { name: "Next Live Song" })).toBeInTheDocument();
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

  test("展开和收起曲目详情保留页面导航状态", async () => {
    // 测试点：查看曲目详情保留当前页面地址和浏览器历史，收起后回到歌单。
    const user = userEvent.setup();
    const previousUrl = window.location.href;
    const previousState = window.history.state;
    renderStage(makeDetail());

    const trigger = screen.getByRole("button", { name: /Song One/ });
    await user.click(trigger);
    expect(window.location.href).toBe(previousUrl);
    expect(window.history.state).toBe(previousState);

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Song One" })).not.toBeInTheDocument());
    expect(window.location.href).toBe(previousUrl);
    expect(window.history.state).toBe(previousState);
  });

  test("取消状态隐藏收藏和歌单，并展示取消原因", () => {
    // 测试点：取消场次展示取消原因，不能作为已发生的演出展示歌单或提供收藏。
    const onToggleFavorite = vi.fn();
    renderStage(
      makeDetail({ event_status: "cancelled", status_note: "因场馆原因取消" }),
      { canFavorite: true, onToggleFavorite },
    );

    expect(screen.getByRole("heading", { name: "本场演出已取消。" })).toBeInTheDocument();
    expect(screen.getByText("取消原因：因场馆原因取消")).toBeInTheDocument();
    expect(screen.queryByText("Song One")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument();
  });

  test("取消且无原因时只显示固定标题", () => {
    // 测试点：没有取消原因时不显示原因行，取消正文只保留“本场演出已取消。”一句。
    renderStage(makeDetail({ event_status: "cancelled", status_note: null }));

    expect(screen.getByRole("heading", { name: "本场演出已取消。" })).toBeInTheDocument();
    expect(screen.queryByText(/取消原因/)).not.toBeInTheDocument();
  });

  // 测试点：空曲目列表按场次类型和日期阶段展示对应状态说明。
  test.each([
    {
      caseName: "待举行 Live 空状态提示本场演出尚未举行",
      detail: { date_phase: "upcoming" },
      heading: "本场演出尚未举行。",
      body: null,
    },
    {
      caseName: "已结束活动空状态提示本场活动暂无演出曲目",
      detail: { live_type: "event", date_phase: "past" },
      heading: "本场活动暂无演出曲目。",
      body: null,
    },
    {
      caseName: "已结束普通场次空状态保留原提示",
      detail: { date_phase: "past" },
      heading: "演出流程尚未记录",
      body: "本页目前只收录演出基本资料，暂无演出曲目记录。",
    },
    {
      caseName: "进行中活动空状态保留原提示",
      detail: { live_type: "event", date_phase: "today" },
      heading: "本页目前只收录演出基本资料",
      body: "暂无出席阵容或演出曲目记录。",
    },
  ] satisfies Array<{
    caseName: string;
    detail: Partial<LiveDetailResponse>;
    heading: string;
    body: string | null;
  }>)("$caseName", ({ detail, heading, body }) => {
    renderStage(makeDetail({ ...detail, detail_rows: [] }));

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    if (body) expect(screen.getByText(body)).toBeInTheDocument();
  });

  test("未登录时只提供登录后收藏入口", async () => {
    // 测试点：匿名用户不能看到可误解为已授权的收藏按钮，点击登录入口应交给上层登录流程。
    const user = userEvent.setup();
    const onRequestLogin = vi.fn();
    renderStage(makeDetail(), { onToggleFavorite: vi.fn(), onRequestLogin });

    expect(screen.queryByRole("button", { name: "收藏" })).not.toBeInTheDocument();
    const loginButtons = screen.getAllByRole("button", { name: "登录后收藏" });
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
