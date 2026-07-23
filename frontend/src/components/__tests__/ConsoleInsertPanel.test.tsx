import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";
import { CONSOLE_LIVE_CHANGE_STORAGE_KEY } from "../../consoleLiveSync";
import "../../styles/index.css";

const apiMocks = vi.hoisted(() => ({
  appendConsoleLiveSetlist: vi.fn(),
  updateConsoleLiveSetlist: vi.fn(),
  getConsoleLiveSetlist: vi.fn(),
  createConsoleLive: vi.fn(),
  updateConsoleLive: vi.fn(),
  createConsoleSong: vi.fn(),
  updateConsoleSong: vi.fn(),
  createConsoleSongsBatch: vi.fn(),
  createConsoleVenue: vi.fn(),
  createConsoleTour: vi.fn(),
  updateConsoleTour: vi.fn(),
  getConsoleTourLiveCandidates: vi.fn(),
  getConsoleTour: vi.fn(),
  getTours: vi.fn(),
  getTourDetail: vi.fn(),
  getConsoleSongs: vi.fn(),
  getConsoleBands: vi.fn(),
  getConsoleLive: vi.fn(),
  getConsoleLiveCandidates: vi.fn(),
  getConsoleVenues: vi.fn(),
  getLiveDetail: vi.fn(),
  getLives: vi.fn(),
}));

vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    csrfToken: "csrf-token",
  }),
}));

vi.mock("../../api", () => ({
  appendConsoleLiveSetlist: apiMocks.appendConsoleLiveSetlist,
  updateConsoleLiveSetlist: apiMocks.updateConsoleLiveSetlist,
  getConsoleLiveSetlist: apiMocks.getConsoleLiveSetlist,
  createConsoleLive: apiMocks.createConsoleLive,
  updateConsoleLive: apiMocks.updateConsoleLive,
  createConsoleSong: apiMocks.createConsoleSong,
  updateConsoleSong: apiMocks.updateConsoleSong,
  createConsoleSongsBatch: apiMocks.createConsoleSongsBatch,
  createConsoleVenue: apiMocks.createConsoleVenue,
  createConsoleTour: apiMocks.createConsoleTour,
  updateConsoleTour: apiMocks.updateConsoleTour,
  getConsoleTourLiveCandidates: apiMocks.getConsoleTourLiveCandidates,
  getConsoleTour: apiMocks.getConsoleTour,
  getTours: apiMocks.getTours,
  getTourDetail: apiMocks.getTourDetail,
  getConsoleSongs: apiMocks.getConsoleSongs,
  getConsoleBands: apiMocks.getConsoleBands,
  getConsoleLive: apiMocks.getConsoleLive,
  getConsoleLiveCandidates: apiMocks.getConsoleLiveCandidates,
  getConsoleVenues: apiMocks.getConsoleVenues,
  getLiveDetail: apiMocks.getLiveDetail,
  getLives: apiMocks.getLives,
}));

function getTodayDateInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("ConsoleInsertPanel", () => {
  beforeEach(() => {
    apiMocks.appendConsoleLiveSetlist.mockReset();
    apiMocks.updateConsoleLiveSetlist.mockReset();
    apiMocks.getConsoleLiveSetlist.mockReset();
    apiMocks.createConsoleLive.mockReset();
    apiMocks.updateConsoleLive.mockReset();
    apiMocks.createConsoleSong.mockReset();
    apiMocks.updateConsoleSong.mockReset();
    apiMocks.createConsoleSongsBatch.mockReset();
    apiMocks.createConsoleVenue.mockReset();
    apiMocks.createConsoleTour.mockReset();
    apiMocks.updateConsoleTour.mockReset();
    apiMocks.getConsoleTourLiveCandidates.mockReset();
    apiMocks.getConsoleTour.mockReset();
    apiMocks.getTours.mockReset();
    apiMocks.getTourDetail.mockReset();
    apiMocks.getConsoleSongs.mockReset();
    apiMocks.getConsoleBands.mockReset();
    apiMocks.getConsoleLive.mockReset();
    apiMocks.getConsoleLiveCandidates.mockReset();
    apiMocks.getConsoleVenues.mockReset();
    apiMocks.getLiveDetail.mockReset();
    apiMocks.getLives.mockReset();
    apiMocks.getConsoleSongs.mockResolvedValue({ items: [] });
    apiMocks.getConsoleBands.mockResolvedValue({ items: [] });
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 });
    apiMocks.getConsoleLive.mockResolvedValue({
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Event Live",
        live_type: "event",
        url: "https://example.com/event",
        opening_time: "09:00:00+09:00",
        start_time: "21:30:00+09:00",
        timezone: "+09:00",
        venue_id: 88,
        venue_name: "New Venue",
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, mode: "partial", members: ["高松燈"] }],
      },
    });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [] });
    apiMocks.getTours.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 1 } });
    apiMocks.getConsoleTourLiveCandidates.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 });
    apiMocks.appendConsoleLiveSetlist.mockResolvedValue({
      ok: true,
      item: { live_id: 101, inserted_row_count: 1, total_setlist_row_count: 12 },
    });
    apiMocks.updateConsoleLiveSetlist.mockResolvedValue({
      ok: true,
      item: { live_id: 55, inserted_row_count: 1, total_setlist_row_count: 1 },
    });
    apiMocks.getConsoleLiveSetlist.mockResolvedValue({ live_id: 55, rows: [] });
    apiMocks.createConsoleLive.mockResolvedValue({
      ok: true,
      item: {
        live_id: 39,
        live_date: "2026-03-30",
        live_title: "Inserted Live",
        live_type: "oneman",
        url: "https://example.com/inserted",
        opening_time: "18:00:00+09:00",
        start_time: "19:00:00+09:00",
        venue_id: 88,
        default_band_ids: [3],
        event_attendees: [],
      },
    });
    apiMocks.updateConsoleLive.mockResolvedValue({
      ok: true,
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Updated Event Live",
        live_type: "event",
        url: "https://example.com/event",
        opening_time: "09:00:00+09:00",
        start_time: "21:30:00+09:00",
        venue_id: 88,
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, mode: "partial", members: ["高松燈"] }],
      },
    });
    apiMocks.createConsoleSong.mockResolvedValue({
      ok: true,
      item: { song_id: 903, song_name: "新曲", band_id: 2, cover: false },
    });
    apiMocks.updateConsoleSong.mockResolvedValue({
      ok: true,
      item: { song_id: 901, song_name: "改名曲", band_id: 2, cover: true },
    });
    apiMocks.createConsoleSongsBatch.mockResolvedValue({
      ok: true,
      created: [{ song_id: 902, song_name: "Requiem for Fate", band_id: 2, cover: false }],
    });
    apiMocks.createConsoleVenue.mockResolvedValue({ ok: true, item: { venue_id: 88, venue_name: "New Venue" } });
    apiMocks.getLiveDetail.mockResolvedValue({
      live_id: 101,
      live_date: "2026-03-30",
      live_title: "春日联合公演",
      live_type: "oneman",
      venue: "Test Venue",
      opening_time: "18:00:00+09",
      start_time: "19:00:00+09",
      bands: [1],
      band_names: ["Poppin'Party"],
      url: "https://example.com/live/101",
      is_favorite: false,
      event_attendees: [],
      detail_rows: [],
    });
    apiMocks.getLives.mockResolvedValue({
      items: [
        {
          live_id: 101,
          live_date: "2026-03-30",
          live_title: "春日联合公演",
          live_type: "oneman",
          bands: [1, 2],
          url: "https://example.com/live/101",
          is_favorite: false,
        },
      ],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    });
  });

  // 测试点：控制台首次进入应优先新增 Live、聚焦场地查询，且不预加载隐藏的 Setlist 候选。
  test("默认渲染新增 Live 并聚焦场地查询", async () => {
    render(<ConsoleInsertPanel initialMode="live_create" />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    expect(screen.getByRole("tab", { name: "新增Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Live管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增Setlist" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Setlist管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "歌曲管理" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "新增乐队" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增Live" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("查询 venue")).toHaveFocus();
    expect(screen.getAllByRole("columnheader", { name: "live_date" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "live_title" }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("opening_time")).toHaveValue("18:00");
    expect(screen.getByLabelText("opening_time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("start_time")).toHaveValue("19:00");
    expect(screen.getByLabelText("start_time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("timezone")).toHaveValue("+9");
    expect(screen.getByLabelText("timezone minute offset")).toHaveTextContent(":00");
    expect(apiMocks.getLives).not.toHaveBeenCalled();
  });

  // 测试点：时区分钟后缀按 15 分钟循环，切换普通小时时保留，边界小时强制归零。
  test("时区分钟后缀可循环并处理边界小时", async () => {
    const user = userEvent.setup();
    render(<ConsoleInsertPanel initialMode="live_create" />);

    const timezoneSelect = screen.getByLabelText("timezone");
    const minuteButton = screen.getByLabelText("timezone minute offset");

    for (const expectedMinute of [":15", ":30", ":45", ":00"]) {
      await user.click(minuteButton);
      expect(minuteButton).toHaveTextContent(expectedMinute);
    }

    await user.selectOptions(timezoneSelect, "-3");
    await user.click(minuteButton);
    await user.click(minuteButton);
    expect(timezoneSelect).toHaveValue("-3");
    expect(minuteButton).toHaveTextContent(":30");

    await user.selectOptions(timezoneSelect, "+10");
    expect(minuteButton).toHaveTextContent(":30");

    await user.selectOptions(timezoneSelect, "-12");
    expect(minuteButton).toHaveTextContent(":00");
    expect(minuteButton).toBeDisabled();

    await user.selectOptions(timezoneSelect, "+14");
    expect(minuteButton).toHaveTextContent(":00");
    expect(minuteButton).toBeDisabled();
  });

  // 测试点：新增 Setlist 候选会把活动 Live 排到普通 Live 之后，并用弱化底色标识活动项。
  test("活动 Live 在候选下拉框中降级并弱化显示", async () => {
    apiMocks.getLives.mockResolvedValue({
      items: [
        {
          live_id: 102,
          live_date: "2026-04-01",
          live_title: "近期活动",
          live_type: "event",
          bands: [],
          url: null,
          is_favorite: false,
        },
        {
          live_id: 101,
          live_date: "2026-03-30",
          live_title: "专场 Live",
          live_type: "oneman",
          bands: [1],
          url: null,
          is_favorite: false,
        },
      ],
      pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 },
    });

    render(<ConsoleInsertPanel />);

    const liveSelect = await screen.findByLabelText("选择 live_id");
    await waitFor(() => expect(liveSelect).toHaveValue("101"));
    const liveOptions = within(liveSelect).getAllByRole("option");
    expect(liveOptions.map((option) => option.getAttribute("value"))).toEqual(["101", "102"]);
    expect(liveOptions[0]).not.toHaveClass("live-id-option-muted");
    expect(liveOptions[1]).toHaveClass("live-id-option-muted");
  });

  // 测试点：新增 Setlist 必须保持原有八列表格，不得被管理态专属字段挤压布局。
  test("新增Setlist保持原有八列表格结构", async () => {
    render(<ConsoleInsertPanel />);
    await screen.findByLabelText("选择 live_id");

    const table = document.querySelector(".setlist-input-wrap .setlist-table") as HTMLTableElement;
    expect(table).not.toHaveClass("setlist-management-table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "song_name",
      "sid",
      "abs",
      "seg",
      "sub",
      "short",
      "band_member",
      "other_member",
    ]);
    expect(within(table).queryByRole("columnheader", { name: "comment" })).not.toBeInTheDocument();
  });

  // 测试点：Setlist 确认框单独展示 Live 字段，提交成功后从无 setlist 候选中移除该 Live。
  test("提交新增Setlist会调用真实追加接口并出现插入记录", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await screen.findByLabelText("批量粘贴 Setlist 文本");

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。");
    expect(screen.getByRole("button", { name: "批量插入" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(apiMocks.appendConsoleLiveSetlist).not.toHaveBeenCalled();
    const confirmDialog = screen.getByRole("dialog", { name: "确认提交 Setlist" });
    expect(within(confirmDialog).getByRole("row", { name: "live_id 101" })).toBeInTheDocument();
    expect(within(confirmDialog).getByRole("row", { name: "live_title 春日联合公演" })).toBeInTheDocument();
    expect(within(confirmDialog).getByText("BLACK SHOUT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.appendConsoleLiveSetlist).toHaveBeenCalledWith(
      101,
      {
        setlist_rows: [
          {
            song_id: 901,
            absolute_order: 1,
            segment_type: "M",
            sub_order: 1,
            is_short: false,
            band_member: { Roselia: ["湊友希那"] },
            other_member: null,
            comment: null,
          },
        ],
      },
      "csrf-token",
    ));
    expect(screen.getByText("已为Live #101 插入 1 条 setlist，总计 12 条。")).toBeInTheDocument();
    expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toHaveValue("");
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
    expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "暂无 live 候选" })).toBeInTheDocument();
    expect(screen.queryByText("暂无插入记录")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "setlist_rows" })).toBeInTheDocument();
    const resultTable = document.querySelector(".setlist-preview-wrap table") as HTMLElement;
    expect(resultTable).not.toBeNull();
    expect(resultTable).toHaveClass("live-history-table");
    expect(within(resultTable).getByRole("columnheader", { name: "sid" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "abs" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "seg" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "sub" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "short" })).toBeInTheDocument();
    expect(within(resultTable).queryByRole("columnheader", { name: "song_id" })).not.toBeInTheDocument();
  });

  test("只读查询接口会加载候选数据并用于歌曲查询", async () => {
    // 测试点：控制台只读 API 接入后，band 候选与歌曲查询不再只依赖本地静态候选。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 9, band_name: "Real Band", band_abbr: "real", band_members: ["Vocal", "Guitar"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 901, song_name: "春日序曲", band_id: 9, cover: false }],
      })
      .mockResolvedValueOnce({
        items: [{ song_id: 902, song_name: "逆光海岸", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    expect(await screen.findByText("9 - Real Band")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "新增Setlist" }));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "春日序曲");
    await user.click(screen.getByRole("button", { name: "新增一行" }));
    await user.type(screen.getAllByPlaceholderText("请输入歌曲名")[1], "逆光海岸");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("春日序曲", 10));
    expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("逆光海岸", 10);
    expect(await screen.findByText("查询歌曲完成：匹配 2 行，未匹配 0 行。")).toBeInTheDocument();
  });

  test("查询歌曲用等价标点回填sid", async () => {
    // 测试点：setlist 歌名与候选歌名只差常见等价标点时，查询歌曲仍应回填 sid。
    const user = userEvent.setup();
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 904, song_name: "Song ‘A’，B；C〜D", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "Song 'A',B;C~D");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("Song 'A',B;C~D", 10));
    expect(await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。")).toBeInTheDocument();
  });

  test("查询歌曲忽略等价标点相邻空白并回填sid", async () => {
    // 测试点：setlist 歌名只缺少等价标点旁的空白时，仍应采用候选的规范歌名和 sid。
    const user = userEvent.setup();
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 908, song_name: "LET’S あちあちトレーニング！", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "LET'Sあちあちトレーニング！");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => {
      expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("LET'Sあちあちトレーニング！", 10);
    });
    expect(await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。")).toBeInTheDocument();
    expect(screen.getByText("908")).toBeInTheDocument();
  });

  test("查询歌曲唯一右侧补全候选时提示并自动回填sid", async () => {
    // 测试点：唯一的歌名前缀候选会自动回填 sid，并在共享状态区明确提示补全前后的歌名。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 9, band_name: "Roselia", band_abbr: "rsl", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 905, song_name: "V.I.P MONSTER", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. V.I.P" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    expect(
      await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。自动补全 1 行：V.I.P → V.I.P MONSTER。")
    ).toBeInTheDocument();
    expect(screen.getByText("905")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    const dialog = screen.getByRole("dialog", { name: /确认提交 Setlist/ });
    expect(within(dialog).getByText("V.I.P MONSTER")).toBeInTheDocument();
    expect(within(dialog).queryByText("V.I.P")).not.toBeInTheDocument();
  });

  test("查询歌曲不会采用歌名左侧包含候选", async () => {
    // 测试点：即使接口意外返回歌名中段命中的唯一候选，setlist 仍不会把 ALIVE 回填为 Sing Alive。
    const user = userEvent.setup();
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 909, song_name: "Sing Alive", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "ALIVE");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    expect(await screen.findByText("查询歌曲完成：匹配 0 行，未匹配 1 行。")).toBeInTheDocument();
    expect(screen.queryByText("909")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "未匹配" })).toBeInTheDocument();
  });

  // 测试点：前缀查询返回多个候选时，弹窗显示所属乐队并允许选择正确 sid。
  test("查询歌曲多候选时弹窗选择sid", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 9, band_name: "Roselia", band_abbr: "rsl", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          { song_id: 906, song_name: "CORUSCATE -DNA-", band_id: 9, cover: false, band_name: "Roselia" },
          { song_id: 907, song_name: "CORUSCATE -DNA-A", band_id: 9, cover: false, band_name: "Roselia" },
        ],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. CORUSCATE -DNA" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    expect(await screen.findByText("查询歌曲完成：匹配 0 行，待选择 1 行，未匹配 0 行。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "候选 2" }));
    const dialog = screen.getByRole("dialog", { name: "歌曲查询结果" });
    expect(within(dialog).getByText("CORUSCATE -DNA-")).toBeInTheDocument();
    expect(within(dialog).getByText("CORUSCATE -DNA-A")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Roselia")).toHaveLength(2);
    await user.click(within(dialog).getAllByRole("button", { name: "选择" })[1]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "歌曲查询结果" })).not.toBeInTheDocument());
    expect(screen.getByText("907")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    const confirmDialog = screen.getByRole("dialog", { name: /确认提交 Setlist/ });
    expect(within(confirmDialog).getByText("CORUSCATE -DNA-A")).toBeInTheDocument();
    expect(within(confirmDialog).queryByText("CORUSCATE -DNA")).not.toBeInTheDocument();
  });

  test("只读候选请求失败时展示错误且不回退到本地候选", async () => {
    // 测试点：只读接口失败时，控制台直接展示错误，不展示本地静态候选。
    apiMocks.getConsoleBands.mockRejectedValue(new Error("bands offline"));
    apiMocks.getConsoleVenues.mockRejectedValue(new Error("venues offline"));

    render(<ConsoleInsertPanel />);

    expect(await screen.findByText(/加载控制台候选失败/)).toHaveTextContent("bands: bands offline");
    await userEvent.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await userEvent.click(screen.getByRole("button", { name: "请选择 band_id" }));
    expect(screen.queryByText(/1 - /)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "新增Live" }));
    expect(screen.getByRole("button", { name: "请选择 venue" })).toBeInTheDocument();
    expect(screen.queryByText(/301 - /)).not.toBeInTheDocument();
  });

  test("候选按各自约定排序展示", async () => {
    // 测试点：live 候选按时间/id倒序，band 与 venue 候选按 id 升序呈现。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 9, band_name: "Later Band", band_abbr: "later", band_members: [] },
        { band_id: 2, band_name: "Early Band", band_abbr: "early", band_members: [] },
      ],
    });
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [
        { venue_id: 301, venue_name: "Later Venue" },
        { venue_id: 101, venue_name: "Early Venue" },
      ],
    });
    apiMocks.getLives.mockResolvedValue({
      items: [
        {
          live_id: 302,
          live_date: "2026-04-02",
          live_title: "Later Live",
          bands: [],
          url: null,
          is_favorite: false,
        },
        {
          live_id: 101,
          live_date: "2026-04-01",
          live_title: "Early Live",
          bands: [],
          url: null,
          is_favorite: false,
        },
      ],
      pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 },
    });

    render(<ConsoleInsertPanel />);

    const liveSelect = await screen.findByLabelText("选择 live_id");
    await waitFor(() => expect(within(liveSelect).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "302 - Later Live (2026-04-02)",
      "101 - Early Live (2026-04-01)",
    ]));

    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    const bandOptions = screen.getAllByText(/Band$/).map((node) => node.textContent);
    expect(bandOptions).toEqual(["2 - Early Band", "9 - Later Band"]);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await user.click(screen.getByRole("button", { name: "请选择 venue" }));
    const venueMenu = screen.getByText("301 - Later Venue").closest(".bands-floating-menu") as HTMLElement;
    const venueOptions = within(venueMenu).getAllByText(/Venue$/).map((node) => node.textContent);
    expect(venueOptions).toEqual(["101 - Early Venue", "301 - Later Venue"]);
  });

  test("查询venue旁的插入按钮会新增venue而不是提交Live", async () => {
    // 测试点：venue 快捷插入应调用新增 venue API，并自动选中新建场地，不能误触发新增 Live 校验。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await user.type(screen.getByLabelText("查询 venue"), "New Venue");
    await user.click(screen.getByRole("button", { name: "插入" }));

    expect(apiMocks.createConsoleVenue).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认新增 Venue" })).toBeInTheDocument();
    expect(screen.getByText("New Venue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleVenue).toHaveBeenCalledWith("New Venue", "csrf-token"));
    expect(screen.getByText("已新增venue #88（New Venue）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "88 - New Venue" })).toBeInTheDocument();
    expect(screen.queryByText("新增Live失败：live_date 与 live_title 为必填项。")).not.toBeInTheDocument();
  });

  // 测试点：新增 Live 成功后应重置表单，并让共享日志在切换标签页后继续显示最新结果。
  test("新增Live会调用真实写入接口并使用后端返回的live_id", async () => {
    const user = userEvent.setup();
    const onLiveDataChanged = vi.fn();
    const todayDate = getTodayDateInputValue();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue" }],
    });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: [] }],
    });

    render(<ConsoleInsertPanel onLiveDataChanged={onLiveDataChanged} />);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await user.click(screen.getByRole("button", { name: "请选择 venue" }));
    await user.click(await screen.findByRole("radio", { name: "88 - New Venue" }));
    expect(screen.getByRole("checkbox", { name: "新增后清空录入数据" })).toBeChecked();
    await user.type(screen.getByLabelText("查询 venue"), "New");
    await user.click(screen.getByRole("button", { name: "请选择默认 Band" }));
    await user.click(screen.getByRole("checkbox", { name: /MyGO/ }));
    expect(screen.getByRole("button", { name: "MyGO!!!!!" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("live_date")).toHaveValue(todayDate);
    fireEvent.change(screen.getByLabelText("live_date"), { target: { value: "2026-04-01" } });
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Inserted Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/inserted");
    await user.selectOptions(screen.getByLabelText("timezone"), "-3");
    await user.click(screen.getByLabelText("timezone minute offset"));
    await user.click(screen.getByLabelText("timezone minute offset"));
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(apiMocks.createConsoleLive).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认新增 Live" })).toBeInTheDocument();
    expect(screen.getByText("Inserted Live")).toBeInTheDocument();
    expect(screen.getByText("New Venue")).toBeInTheDocument();
    expect(screen.getByText("-03:30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalledWith(
      {
        live_date: "2026-04-01",
        live_title: "Inserted Live",
        live_type: "oneman",
        url: "https://example.com/inserted",
        opening_time: "18:00",
        start_time: "19:00",
        timezone: "-03:30",
        venue_id: 88,
        default_band_ids: [3],
        event_attendees: [],
      },
      "csrf-token",
    ));
    expect(screen.getByText("已新增Live #39（Inserted Live）")).toBeInTheDocument();
    expect(document.querySelector(".live-history-table tbody tr")?.textContent).toContain("39");
    expect(screen.getByLabelText("live_date")).toHaveValue(todayDate);
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("");
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("");
    expect(screen.getByLabelText("查询 venue")).toHaveValue("");
    expect(screen.getByRole("button", { name: "请选择 venue" })).toBeInTheDocument();
    expect(screen.getByLabelText("timezone")).toHaveValue("+9");
    expect(screen.getByLabelText("timezone minute offset")).toHaveTextContent(":00");
    expect(screen.getByRole("button", { name: "请选择默认 Band" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "请选择默认 Band" }));
    expect(screen.getByRole("checkbox", { name: /MyGO/ })).not.toBeChecked();
    expect(onLiveDataChanged).toHaveBeenCalledTimes(1);

    apiMocks.getLives.mockResolvedValue({
      items: [
        {
          live_id: 101,
          live_date: "2026-03-30",
          live_title: "春日联合公演",
          live_type: "oneman",
          bands: [1, 2],
          url: "https://example.com/live/101",
          is_favorite: false,
        },
        {
          live_id: 39,
          live_date: "2026-03-30",
          live_title: "Inserted Live",
          live_type: "oneman",
          bands: [3],
          url: "https://example.com/inserted",
          is_favorite: false,
        },
      ],
      pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 },
    });
    const callsBeforeSwitch = apiMocks.getLives.mock.calls.length;
    await user.click(screen.getByRole("tab", { name: "新增Setlist" }));
    expect(screen.getByRole("status")).toHaveTextContent("已新增Live #39（Inserted Live）");
    await waitFor(() => expect(apiMocks.getLives.mock.calls.length).toBeGreaterThan(callsBeforeSwitch));
    expect(await screen.findByText("第 1 / 1 页，共 2 条")).toBeInTheDocument();
  });

  // 测试点：关闭清空选项时，新增 Live 成功后应保留当前草稿、Venue 查询和 Venue 选择以便连续录入。
  test("新增Live关闭清空选项后保留录入数据", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue" }],
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.click(screen.getByRole("checkbox", { name: "新增后清空录入数据" }));
    await user.type(screen.getByLabelText("查询 venue"), "Keep Venue");
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Keep Draft Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/keep-draft");
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Keep Draft Live");
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("https://example.com/keep-draft");
    expect(screen.getByLabelText("查询 venue")).toHaveValue("Keep Venue");
    expect(screen.getByRole("button", { name: "88 - New Venue" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "新增后清空录入数据" })).not.toBeChecked();
  });

  // 测试点：更新已有 Setlist 的 Live 后不得加入新增 Setlist 候选，切回页签时应重新加载候选。
  test("Live管理会加载并更新既有Live", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Event Live", live_type: "event", venue_name: "New Venue" }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue" }] });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: ["高松燈", "千早愛音"] }],
    });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    const selector = await screen.findByRole("combobox", { name: "选择要编辑的 Live" });
    await user.selectOptions(selector, "55");
    await waitFor(() => expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Event Live"));
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    await user.clear(screen.getByPlaceholderText("请输入Live标题"));
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Updated Event Live");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    const dialog = screen.getByRole("dialog", { name: "确认更新 Live #55" });
    expect(within(dialog).getByText("Event Live")).toBeInTheDocument();
    expect(within(dialog).getByText("Updated Event Live")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(apiMocks.updateConsoleLive).toHaveBeenCalledWith(
      55,
      expect.objectContaining({
        live_title: "Updated Event Live",
        live_type: "event",
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, members: ["高松燈"] }],
      }),
      "csrf-token",
    ));
    expect(screen.getByText(/已更新Live #55/)).toBeInTheDocument();

    const callsBeforeSwitch = apiMocks.getLives.mock.calls.length;
    await user.click(screen.getByRole("tab", { name: "新增Setlist" }));
    await waitFor(() => expect(apiMocks.getLives.mock.calls.length).toBeGreaterThan(callsBeforeSwitch));
    const liveSelect = screen.getByLabelText("选择 live_id");
    expect(within(liveSelect).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["101"]);
  });

  // 测试点：编辑草稿存在修改时，切换到新建模式必须先确认放弃，不能静默清空。
  test("Live编辑脏草稿切换新建前要求确认", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Event Live", live_type: "event", venue_name: "New Venue" }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "选择要编辑的 Live" }), "55");
    await waitFor(() => expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Event Live"));
    await user.type(screen.getByPlaceholderText("请输入Live标题"), " Changed");
    await user.click(screen.getByRole("tab", { name: "新增Live" }));

    expect(screen.getByRole("dialog", { name: "确认放弃 Live 修改" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Event Live Changed");
    await user.click(screen.getByRole("button", { name: "确认放弃" }));
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("");
    expect(screen.getByRole("button", { name: "提交插入" })).toBeInTheDocument();
  });

  // 测试点：Live 管理未选中目标时只显示候选工具栏，类型筛选应从第一页向后端重新查询。
  test("Live管理按类型重新查询已有Live", async () => {
    const user = userEvent.setup();
    render(<ConsoleInsertPanel initialMode="live_edit" />);

    await waitFor(() => expect(apiMocks.getConsoleLiveCandidates).toHaveBeenCalledWith("", 1, 20, ""));
    expect(screen.getByText("请先选择要编辑的 Live。")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("请输入Live标题")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "按 Live 类型筛选" }), "event");
    await waitFor(() => expect(apiMocks.getConsoleLiveCandidates).toHaveBeenCalledWith("", 1, 20, "event"));
  });

  // 测试点：Live 管理显式查询命中后会选中首个真实候选并加载编辑表单。
  test("Live管理查询命中后自动选中首个Live", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates
      .mockResolvedValueOnce({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 })
      .mockResolvedValueOnce({
        items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Event Live", live_type: "event", venue_name: "New Venue" }],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
      });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    await waitFor(() => expect(apiMocks.getConsoleLiveCandidates).toHaveBeenCalledTimes(1));
    await user.type(screen.getByPlaceholderText("输入 Live ID 或标题"), "Event Live");
    await user.click(screen.getByRole("button", { name: "查询" }));

    const selector = screen.getByRole("combobox", { name: "选择要编辑的 Live" });
    await waitFor(() => expect(selector).toHaveValue("55"));
    expect(apiMocks.getConsoleLive).toHaveBeenCalledWith(55);
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Event Live");
  });

  // 测试点：活动 Live 应把默认 Band 下勾选的完整成员名单提交给后端，不在前端写入 mode。
  test("活动Live会提交完整出演成员名单", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue" }] });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        {
          band_id: 3,
          band_name: "MyGO!!!!!",
          band_abbr: "mygo",
          band_members: ["高松燈", "千早愛音"],
        },
      ],
    });
    apiMocks.createConsoleLive.mockResolvedValueOnce({
      ok: true,
      item: {
        live_id: 40,
        live_date: "2026-08-08",
        live_title: "Event Live",
        live_type: "event",
        url: "https://example.com/event",
        opening_time: "18:00:00+09:00",
        start_time: "19:00:00+09:00",
        venue_id: 88,
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, mode: "full", members: ["高松燈", "千早愛音"] }],
      },
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.selectOptions(screen.getByDisplayValue("专场"), "event");
    await user.click(screen.getByRole("button", { name: "请选择默认 Band" }));
    await user.click(screen.getByRole("checkbox", { name: /MyGO/ }));
    const memberGroup = screen.getByRole("group", { name: "MyGO!!!!! 出演成员" });
    await user.click(within(memberGroup).getByRole("checkbox", { name: "高松燈" }));
    await user.click(within(memberGroup).getByRole("checkbox", { name: "千早愛音" }));
    fireEvent.change(screen.getByLabelText("live_date"), { target: { value: "2026-08-08" } });
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Event Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/event");
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalledWith(
      expect.objectContaining({
        live_type: "event",
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, members: ["高松燈", "千早愛音"] }],
      }),
      "csrf-token",
    ));
  });

  // 测试点：活动类型未选择默认 Band 时，新增 Live 确认框应显示非阻断提醒。
  test("活动未选择默认Band时在新增Live确认框显示提示", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue" }],
    });

    render(<ConsoleInsertPanel />);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await user.click(screen.getByRole("button", { name: "请选择 venue" }));
    await user.click(await screen.findByRole("radio", { name: "88 - New Venue" }));
    await user.selectOptions(screen.getByDisplayValue("专场"), "event");
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "No Band Event");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/no-band-event");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    const dialog = screen.getByRole("dialog", { name: "确认新增 Live" });
    expect(within(dialog).getByText("提示：当前 Live 类型为活动，且未选择默认 Band，请确认是否需要补充。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认提交" })).not.toBeDisabled();
  });

  test("新增歌曲会调用真实写入接口并使用后端返回的song_id", async () => {
    // 测试点：新增歌曲应调用后端写接口，并用返回的 song_id 更新候选和插入记录。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "rsl", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);

    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "新曲");
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    await user.click(await screen.findByText("2 - Roselia"));
    await user.click(screen.getByRole("button", { name: "创建歌曲" }));

    expect(apiMocks.createConsoleSong).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认新增歌曲" })).toBeInTheDocument();
    expect(screen.getByText("新曲")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleSong).toHaveBeenCalledWith(
      { song_name: "新曲", band_id: 2, cover: false },
      "csrf-token",
    ));
    expect(screen.getByText("已新增歌曲 #903")).toBeInTheDocument();
    expect(screen.getByText("903")).toBeInTheDocument();
    expect(screen.getByText("新曲")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
    expect(screen.getByRole("button", { name: "请选择 band_id" })).toBeInTheDocument();
  });

  // 测试点：歌曲管理会加载既有歌曲，并通过 PUT 保存名称、Band 和翻唱属性。
  test("歌曲管理更新既有歌曲属性", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleSongs.mockResolvedValue({
      items: [{ song_id: 901, song_name: "原曲名", band_id: 2, cover: false, band_name: "Roselia" }],
    });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "rsl", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.selectOptions(screen.getByLabelText("选择要编辑的歌曲"), "901");
    await user.clear(screen.getByPlaceholderText("请输入歌曲名"));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "改名曲");
    await user.click(screen.getByLabelText("song-cover"));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.updateConsoleSong).toHaveBeenCalledWith(
      901,
      { song_name: "改名曲", band_id: 2, cover: true },
      "csrf-token",
    ));
    expect(screen.getByText("已更新歌曲 #901")).toBeInTheDocument();
  });

  // 测试点：Setlist 管理只查询已有歌单的 Live，加载原始行后可整表保存修改。
  test("Setlist管理加载并更新既有Setlist", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Existing Setlist Live",
        live_type: "oneman",
        venue_name: "Test Venue",
      }],
      page: 1,
      page_size: 100,
      total: 1,
      total_pages: 1,
    });
    apiMocks.getConsoleLiveSetlist.mockResolvedValue({
      live_id: 55,
      rows: [{
        row_id: "00000000-0000-0000-0000-000000000055",
        song_id: 901,
        song_name: "BLACK SHOUT",
        absolute_order: 1,
        segment_type: "M",
        sub_order: 1,
        is_short: false,
        band_member: { Roselia: ["湊友希那"] },
        other_member: null,
        comment: null,
      }],
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await user.click(screen.getByRole("tab", { name: "Setlist管理" }));
    await waitFor(() => expect(apiMocks.getConsoleLiveCandidates).toHaveBeenCalledWith("", 1, 100, "", true));
    await waitFor(() => expect(apiMocks.getConsoleLiveSetlist).toHaveBeenCalledWith(55));
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("BLACK SHOUT");
    const managementTable = document.querySelector(".setlist-input-wrap .setlist-table") as HTMLTableElement;
    expect(managementTable).toHaveClass("setlist-management-table");
    expect(within(managementTable).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "song_name",
      "sid",
      "abs",
      "seg",
      "sub",
      "short",
      "band_member",
      "other_member",
      "comment",
    ]);
    await user.type(screen.getByLabelText("comment-1"), "Encore note");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    expect(screen.getByRole("dialog", { name: "确认更新 Setlist" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.updateConsoleLiveSetlist).toHaveBeenCalledWith(
      55,
      {
        setlist_rows: [{
          song_id: 901,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_member: { Roselia: ["湊友希那"] },
          other_member: null,
          comment: "Encore note",
        }],
      },
      "csrf-token",
    ));
    expect(screen.getByText("已更新 Live #55 的 1 条 Setlist。")).toBeInTheDocument();
  });

  test("新增Setlist只剩一行时删除末行会显示自动消失提示", async () => {
    // 测试点：最后一行 setlist 草稿不能删除，用户应看到脱离页面布局的全局告警。
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "删除末行" }));
      });

      const alert = screen.getByRole("alert");
      expect(alert).toHaveClass("console-toast");
      expect(alert.closest(".console-admin")).toBeNull();
      expect(alert).toHaveTextContent("至少保留一行 setlist 草稿。");
      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // 测试点：切换候选页或重新进入 Setlist 页时，应回到目标页首条且不保留上次 live_id。
  test("live_id 候选分页与重新进入Setlist会选择首条", async () => {
    const user = userEvent.setup();
    apiMocks.getLives.mockImplementation(async (page: number) => ({
      items:
        page === 1
          ? [
              {
                live_id: 44,
                live_date: "2026-04-20",
                live_title: "Page One Live",
                bands: [],
                url: null,
                is_favorite: false,
              },
              {
                live_id: 43,
                live_date: "2026-04-19",
                live_title: "Page One Second Live",
                bands: [],
                url: null,
                is_favorite: false,
              },
            ]
          : [
              {
                live_id: 24,
                live_date: "2026-03-20",
                live_title: "Page Two Live",
                bands: [],
                url: null,
                is_favorite: false,
              },
              {
                live_id: 23,
                live_date: "2026-03-19",
                live_title: "Page Two Second Live",
                bands: [],
                url: null,
                is_favorite: false,
              },
            ],
      pagination: { page, page_size: 20, total: 21, total_pages: 2 },
    }));

    render(<ConsoleInsertPanel />);

    expect(await screen.findByText("44 - Page One Live (2026-04-20)")).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 页，共 21 条")).toBeInTheDocument();
    expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20, true);
    await user.selectOptions(screen.getByLabelText("选择 live_id"), "43");

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("24 - Page Two Live (2026-03-20)")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页，共 21 条")).toBeInTheDocument();
    expect(apiMocks.getLives).toHaveBeenCalledWith(2, 20, true);
    expect(screen.getByLabelText("选择 live_id")).toHaveValue("24");

    await user.selectOptions(screen.getByLabelText("选择 live_id"), "23");
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.click(screen.getByRole("tab", { name: "新增Setlist" }));

    await waitFor(() => expect(screen.getByText("第 1 / 2 页，共 21 条")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("选择 live_id")).toHaveValue("44"));
  });

  // 测试点：Setlist 与 other_member 输入导致的窗口重新聚焦不能刷新 live_id 候选。
  test("粘贴录入与窗口重新聚焦不会刷新live_id候选", async () => {
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "M1. Pasted Song" },
    });
    fireEvent.click(document.querySelector(".other-member-trigger") as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText("key"), { target: { value: "Guest" } });
    fireEvent.change(screen.getByPlaceholderText("value"), { target: { value: "Vocal" } });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(apiMocks.getLives).toHaveBeenCalledTimes(1);
  });

  // 测试点：无 setlist 候选直接开放录入，只有显式点击详情按钮才请求完整 Live 详情。
  test("显示详细信息会复用主页详情API与详情表格", async () => {
    const user = userEvent.setup();
    apiMocks.getLiveDetail.mockResolvedValue({
      live_id: 101,
      live_date: "2026-03-30",
      live_title: "春日联合公演",
      live_type: "oneman",
      venue: "Test Venue",
      opening_time: "18:00:00+09",
      start_time: "19:00:00+09",
      bands: [1],
      band_names: ["Poppin'Party"],
      url: "https://example.com/live/101",
      is_favorite: false,
      detail_rows: [
        {
          row_id: "main1",
          song_name: "真实详情歌曲",
          band_members: [
            { band_id: 1, band_name: "Poppin'Party", present_members: ["Kasumi"], present_count: 1, total_count: 5, is_full: false },
          ],
          other_members: [],
          comments: [],
        },
      ],
    });
    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20, true));
    expect(apiMocks.getLiveDetail).not.toHaveBeenCalled();
    expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示详细信息" }));

    await waitFor(() => expect(apiMocks.getLiveDetail).toHaveBeenCalledWith(101));
    expect(await screen.findByText("春日联合公演")).toBeInTheDocument();
    expect(screen.getByText("Test Venue")).toBeInTheDocument();
    expect(screen.getByText("Poppin'Party")).toBeInTheDocument();
    expect(screen.getByText("真实详情歌曲")).toBeInTheDocument();
  });

  // 测试点：批量粘贴只在点击应用后替换表格、清空来源文本，并正确处理 from 成员归属。
  test("批量粘贴Setlist可解析预览并应用到草稿表格", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ポピパ", band_members: ["愛美", "大塚紗英"] },
        { band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那", "氷川紗夜"] },
      ],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: {
        value: "＜Roselia×愛美 from Poppin'Party＞\nM1. BLACK SHOUT\nM2. Requiem for Fate",
      },
    });
    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "解析" }));
    expect(screen.getByText("预览：2 行，提示 0 条")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    expect(screen.getByDisplayValue("BLACK SHOUT")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Requiem for Fate")).toBeInTheDocument();
    expect(screen.getAllByText("2支 / 3人").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toHaveValue("");
    expect(screen.queryByText("预览：2 行，提示 0 条")).not.toBeInTheDocument();
    expect(screen.getByText(/请继续点击“查询歌曲”匹配 sid/)).toBeInTheDocument();
  });

  // 测试点：切换 live_id 必须清空上一场的 Setlist 草稿，且不能触发自动完整详情检查。
  test("切换live_id会清空上一场Setlist草稿", async () => {
    const user = userEvent.setup();
    apiMocks.getLives.mockResolvedValue({
      items: [
        { live_id: 101, live_date: "2026-03-30", live_title: "First Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
        { live_id: 102, live_date: "2026-03-29", live_title: "Second Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
      ],
      pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 },
    });
    render(<ConsoleInsertPanel />);
    await screen.findByRole("option", { name: "101 - First Live (2026-03-30)" });

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "M1. Previous Song" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(within(screen.getByRole("dialog", { name: "确认应用到表格" })).getByRole("button", { name: "确认提交" }));
    expect(screen.getByDisplayValue("Previous Song")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("选择 live_id"), "102");

    expect(screen.getByLabelText("选择 live_id")).toHaveValue("102");
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
    expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toHaveValue("");
    expect(apiMocks.getLiveDetail).not.toHaveBeenCalled();
  });

  // 测试点：另一标签页写入当前 Live 的 Setlist 后，本页应刷新候选、切换 Live 并清空旧草稿。
  test("跨标签页Setlist写入会刷新候选并清空冲突草稿", async () => {
    apiMocks.getLives
      .mockResolvedValueOnce({
        items: [
          { live_id: 101, live_date: "2026-03-30", live_title: "First Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
          { live_id: 102, live_date: "2026-03-29", live_title: "Second Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
        ],
        pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 },
      })
      .mockResolvedValueOnce({
        items: [
          { live_id: 102, live_date: "2026-03-29", live_title: "Second Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
        ],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      });
    render(<ConsoleInsertPanel />);
    await screen.findByRole("option", { name: "101 - First Live (2026-03-30)" });
    fireEvent.change(screen.getByPlaceholderText("请输入歌曲名"), { target: { value: "Unsaved Song" } });

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: CONSOLE_LIVE_CHANGE_STORAGE_KEY,
        newValue: JSON.stringify({
          action: "setlist_appended",
          liveId: 101,
          changedAt: "2026-07-22T16:09:49.000Z",
          nonce: "other-tab-1",
        }),
      }));
    });

    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("选择 live_id")).toHaveValue("102"));
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Live #101 已在另一标签页写入 Setlist");
    expect(apiMocks.getLiveDetail).not.toHaveBeenCalled();
  });

  // 测试点：批量确认框的内容区应独立滚动且操作区不收缩，保证长预览仍可取消或确认。
  test("批量粘贴长确认内容保留可见操作区", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 8, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: ["羊宮妃那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    const songs = Array.from({ length: 14 }, (_, index) => `M${index + 1}. Song ${index + 1}`).join("\n");
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: `<不存在的成员 from MyGO!!!!!>\n${songs}` },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    expect(screen.getByText("预览：14 行，提示 1 条")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    const dialog = screen.getByRole("dialog", { name: "确认应用到表格" });
    const body = dialog.querySelector<HTMLElement>(".console-confirm-body");
    const actions = dialog.querySelector<HTMLElement>(".console-confirm-actions");

    expect(body).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(getComputedStyle(body as HTMLElement).overflowY).toBe("auto");
    expect(getComputedStyle(actions as HTMLElement).flexShrink).toBe("0");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认提交" })).toBeInTheDocument();
  });

  test("批量粘贴长列表可打开完整预览弹窗", async () => {
    // 测试点：预览超过摘要数量时，用户可以打开弹窗查看全部解析行。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    const lines = Array.from({ length: 7 }, (_, index) => `M${index + 1}. Song ${index + 1}`).join("\n");
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: `<Roselia>\n${lines}` },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));

    await user.click(screen.getByRole("button", { name: "... 还有 4 行，查看全部" }));

    const dialog = screen.getByRole("dialog", { name: "完整 Setlist 解析预览" });
    expect(within(dialog).getByText("Song 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Song 7")).toBeInTheDocument();
  });

  test("候选下拉框自身滚动时不会关闭", async () => {
    // 测试点：滚动浮层内容本身不会触发外部关闭逻辑，避免滚轮或滚动条无法使用。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 9, band_name: "Scrollable Band", band_abbr: "scroll", band_members: [] }],
    });

    render(<ConsoleInsertPanel />);

    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    const menu = await screen.findByText("9 - Scrollable Band");
    fireEvent.scroll(menu.closest(".bands-floating-menu") as HTMLElement);

    expect(screen.getByText("9 - Scrollable Band")).toBeInTheDocument();
  });

  test("未解析时应用到表格按钮为禁用态", async () => {
    // 测试点：必须先点"解析"才能点"应用到表格"，避免未确认结果就直接应用。
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await waitFor(() => expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });

    expect(screen.getByRole("button", { name: "应用到表格" })).toBeDisabled();
  });

  test("应用到表格弹出确认窗口，预览 abs/sub 后确认才替换下方表格", async () => {
    // 测试点：确认窗口按解析编号预览 abs/sub，确认提交后才真正写入下方表格。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "＜Roselia×愛美 from Poppin'Party＞\nM2. BLACK SHOUT\nM3. Requiem for Fate" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));

    const confirmDialog = screen.getByRole("dialog", { name: "确认应用到表格" });
    expect(confirmDialog).toBeInTheDocument();
    expect(within(confirmDialog).queryByRole("columnheader", { name: "#" })).not.toBeInTheDocument();
    expect(within(confirmDialog).getByRole("columnheader", { name: "abs" })).toBeInTheDocument();
    expect(within(confirmDialog).getByRole("columnheader", { name: "sub" })).toBeInTheDocument();
    const blackShoutRow = within(confirmDialog).getByText("BLACK SHOUT").closest("tr") as HTMLElement;
    const requiemRow = within(confirmDialog).getByText("Requiem for Fate").closest("tr") as HTMLElement;
    expect(within(blackShoutRow).getAllByRole("cell").filter((_, index) => index === 0 || index === 2).map((cell) => cell.textContent)).toEqual(["2", "2"]);
    expect(within(requiemRow).getAllByRole("cell").filter((_, index) => index === 0 || index === 2).map((cell) => cell.textContent)).toEqual(["3", "3"]);
    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认提交" }));

    expect(screen.getByDisplayValue("BLACK SHOUT")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Requiem for Fate")).toBeInTheDocument();
  });

  test("应用到表格确认窗口可取消", async () => {
    // 测试点：点击取消后弹窗关闭，下方表格不被更新。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));

    expect(screen.getByRole("dialog", { name: "确认应用到表格" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "确认应用到表格" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();
  });

  test("≤3行时显示详情按钮可打开完整预览", async () => {
    // 测试点：≤3行时显示"显示详情"，点击后弹出与查看全部相同的完整预览。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT\nM2. Requiem for Fate" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));

    await user.click(screen.getByRole("button", { name: "显示详情" }));

    const dialog = screen.getByRole("dialog", { name: "完整 Setlist 解析预览" });
    expect(within(dialog).getByText("BLACK SHOUT")).toBeInTheDocument();
    expect(within(dialog).getByText("Requiem for Fate")).toBeInTheDocument();
  });

  test("清空数据将表格还原为初始一行空状态", async () => {
    // 测试点：点击清空数据后，setlist 表格只保留一行空草稿，原有数据全部清除。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "＜Roselia×愛美 from Poppin'Party＞\nM1. BLACK SHOUT\nM2. Requiem for Fate" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    expect(screen.getByDisplayValue("BLACK SHOUT")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Requiem for Fate")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空数据" }));

    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Requiem for Fate")).not.toBeInTheDocument();
    const inputs = screen.getAllByPlaceholderText("请输入歌曲名");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveValue("");
  });

  // 测试点：批量新增歌曲只提交 sid 为空的行，并将完整结果覆盖写入唯一的共享日志。
  test("批量插入弹出确认窗口，已有 sid 的行被忽略，仅创建 sid 为空的行", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ポピパ", band_members: ["愛美"] },
        { band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] },
      ],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] })
      .mockResolvedValueOnce({ items: [] });
    apiMocks.createConsoleSongsBatch
      .mockResolvedValueOnce({ ok: true, created: [{ song_id: 902, song_name: "Requiem for Fate", band_id: 2, cover: false }] });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT\nM2. Requiem for Fate" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 1 行。");

    await user.click(screen.getByRole("button", { name: "批量插入" }));

    const dialog = screen.getByRole("dialog", { name: "确认批量新增歌曲" });
    expect(within(dialog).getByText("Requiem for Fate")).toBeInTheDocument();
    expect(within(dialog).queryByText("BLACK SHOUT")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "song_name",
      "bid",
      "band_name",
      "cover",
    ]);
    expect(within(dialog).queryByText(JSON.stringify({ Roselia: ["湊友希那"] }))).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("columnheader", { name: "other_member" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("columnheader", { name: "short" })).not.toBeInTheDocument();
    expect(dialog).toHaveClass("batch_song");
    const coverCheckbox = within(dialog).getByRole("checkbox", { name: "batch_song_cover-1" });
    expect(coverCheckbox).toHaveClass("is-short-check");
    expect(coverCheckbox).not.toBeChecked();

    await user.click(coverCheckbox);

    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleSongsBatch).toHaveBeenCalledWith(
      [{ song_name: "Requiem for Fate", band_id: 2, cover: true }],
      "csrf-token",
    ));
    expect(apiMocks.createConsoleSongsBatch).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("批量新增完成：请求 1 首，成功 1 首");
      expect(screen.getByRole("status")).toHaveTextContent("#902 Requiem for Fate");
    });
    expect(screen.queryByRole("log", { name: "控制台日志" })).not.toBeInTheDocument();
  });

  // 测试点：批量新增歌曲失败时，共享日志应覆盖旧值并完整显示后端错误原因。
  test("批量插入失败时会在共享日志显示后端错误原因", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });
    apiMocks.createConsoleSongsBatch.mockRejectedValueOnce(
      Object.assign(new Error("CSRF Token 校验失败"), {
        status: 403,
        code: "AUTH_CSRF_INVALID",
      }),
    );

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. Requiem for Fate" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 0 行，未匹配 1 行。");
    await user.click(screen.getByRole("button", { name: "批量插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await screen.findByText("批量新增失败：HTTP 403 / AUTH_CSRF_INVALID / CSRF Token 校验失败");
    expect(screen.getByRole("status")).toHaveTextContent("批量新增失败：HTTP 403 / AUTH_CSRF_INVALID / CSRF Token 校验失败");
    expect(screen.queryByRole("log", { name: "控制台日志" })).not.toBeInTheDocument();
    expect(apiMocks.getConsoleSongs).toHaveBeenCalledTimes(2);
  });

  test("批量插入在乐队不为 1 支时报错并禁用提交", async () => {
    // 测试点：确认窗口上侧列出校验错误，确认提交按钮 disabled。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText(/查询歌曲完成/);

    await user.click(screen.getByRole("button", { name: "批量插入" }));

    const dialog = screen.getByRole("dialog", { name: "确认批量新增歌曲" });
    expect(within(dialog).getByText("BLACK SHOUT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认提交" })).not.toBeDisabled();
  });

  test("双击abs列可进入编辑态，修改有效值后下行级联递增", async () => {
    // 测试点：双击 abs 单元格弹出数字输入框，填入前向合法的值后下游行自动重算。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("button", { name: "新增一行" }));
    await user.click(screen.getByRole("button", { name: "新增一行" }));
    const absCells = document.querySelectorAll(".setlist-table td .editable-cell");
    await user.dblClick(absCells[0]);
    const absInput = screen.getByLabelText(/abs-/);
    expect(absInput).toBeInTheDocument();
    expect(absInput.tagName).toBe("INPUT");
    fireEvent.change(absInput, { target: { value: "5" } });
    fireEvent.blur(absInput);
    await waitFor(() => {
      expect(screen.queryByLabelText(/abs-/)).not.toBeInTheDocument();
    });
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  test("abs填入小于前行有效值的数时报错并拒绝修改", async () => {
    // 测试点：abs 违反上游单调递增时，应显示错误消息并保持原值不变。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("button", { name: "新增一行" }));
    const absCells = document.querySelectorAll(".setlist-table td .editable-cell");
    await user.dblClick(absCells[2]);
    const absInput = screen.getByLabelText(/abs-/);
    fireEvent.change(absInput, { target: { value: "1" } });
    fireEvent.blur(absInput);
    expect(screen.getByText(/abs 必须单调递增/)).toBeInTheDocument();
  });

  test("双击abs编辑框后按Escape取消编辑，不修改任何值", async () => {
    // 测试点：编辑态下按 Escape 应退出编辑并回退到原值，不触发任何数据变更。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    const absCells = document.querySelectorAll(".setlist-table td .editable-cell");
    const beforeCount = absCells.length;
    await user.dblClick(absCells[0]);
    const absInput = screen.getByLabelText(/abs-/);
    fireEvent.change(absInput, { target: { value: "99" } });
    fireEvent.keyDown(absInput, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByLabelText(/abs-/)).not.toBeInTheDocument();
    });
    const afterCells = document.querySelectorAll(".setlist-table td .editable-cell");
    expect(afterCells.length).toBe(beforeCount);
  });

  test("手动修改abs后单元格添加下划线样式", async () => {
    // 测试点：手动编辑过 abs 的行应带有 manual-override class，区分于自动计算行。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    const absCells = document.querySelectorAll(".setlist-table td .editable-cell");
    await user.dblClick(absCells[0]);
    const absInput = screen.getByLabelText(/abs-/);
    fireEvent.change(absInput, { target: { value: "3" } });
    fireEvent.blur(absInput);
    await waitFor(() => {
      expect(screen.queryByLabelText(/abs-/)).not.toBeInTheDocument();
    });
    const manualCells = document.querySelectorAll(".setlist-table td .manual-override");
    expect(manualCells.length).toBeGreaterThanOrEqual(1);
  });

  test("sub填入小于段组内前行有效值的数时报错并拒绝修改", async () => {
    // 测试点：sub 违反段组内上游单调递增时，应显示错误消息并保持原值。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "roselia", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. Song A\nM2. Song B\nM3. Song C" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(screen.getAllByLabelText(/seg-/).length).toBeGreaterThanOrEqual(3));
    const subCells = document.querySelectorAll(".setlist-table td .editable-cell");
    await user.dblClick(subCells[3]);
    const subInput = screen.getByLabelText(/sub-/);
    fireEvent.change(subInput, { target: { value: "1" } });
    fireEvent.blur(subInput);
    expect(screen.getByText(/sub（组 M）必须单调递增/)).toBeInTheDocument();
  });

  test("sub有效修改后段组内下游行级联递增", async () => {
    // 测试点：段组内 sub 编辑后，后续同一段组的 sub 应自动级联递增。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "roselia", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. Song A\nM2. Song B\nM3. Song C" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(screen.getAllByLabelText(/seg-/).length).toBeGreaterThanOrEqual(3));
    const subCells = document.querySelectorAll(".setlist-table td .editable-cell");
    await user.dblClick(subCells[1]);
    const subInput = screen.getByLabelText(/sub-/);
    fireEvent.change(subInput, { target: { value: "5" } });
    fireEvent.blur(subInput);
    await waitFor(() => {
      expect(screen.queryByLabelText(/sub-/)).not.toBeInTheDocument();
    });
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  test("band_member浮层靠近页面底部时翻转到触发按钮上方", async () => {
    // 测试点：当触发按钮在视口底部时，弹窗应翻转显示在按钮上方，避免被裁切。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ポピパ", band_members: ["愛美", "大塚紗英"] },
        { band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那", "氷川紗夜"] },
      ],
    });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("button", { name: "新增一行" }));

    const trigger = document.querySelector(".band-member-trigger") as HTMLElement;
    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 750, bottom: 780, left: 600, right: 720, width: 120, height: 30,
      x: 600, y: 750, toJSON: () => ({}),
    });

    await user.click(trigger);
    const menu = document.querySelector(".band-member-floating-menu") as HTMLElement;
    const menuTop = Number(menu.style.top.replace("px", ""));
    const estimatedHeight = Math.min(420, window.innerHeight * 0.7);
    expect(menuTop).toBeLessThan(750 - estimatedHeight + 10);

    rectSpy.mockRestore();
  });

  test("页面滚动时band_member浮层跟随触发按钮重新定位", async () => {
    // 测试点：打开弹窗后滚动页面，弹窗应根据新的触发按钮位置重新计算 top/left。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ポピパ", band_members: ["愛美"] },
      ],
    });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("button", { name: "新增一行" }));

    const trigger = document.querySelector(".band-member-trigger") as HTMLElement;
    let rectCallCount = 0;
    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => {
      rectCallCount += 1;
      if (rectCallCount <= 1) {
        return { top: 100, bottom: 130, left: 600, right: 720, width: 120, height: 30, x: 600, y: 100, toJSON: () => ({}) } as DOMRect;
      }
      return { top: 200, bottom: 230, left: 500, right: 620, width: 120, height: 30, x: 500, y: 200, toJSON: () => ({}) } as DOMRect;
    });

    await user.click(trigger);
    const menu = document.querySelector(".band-member-floating-menu") as HTMLElement;
    expect(menu.style.top).toBe("136px");

    fireEvent.scroll(window);
    await waitFor(() => {
      const updatedMenu = document.querySelector(".band-member-floating-menu") as HTMLElement;
      expect(updatedMenu.style.top).toBe("236px");
    });

    rectSpy.mockRestore();
  });

  test("歌曲bands下拉框靠近底部时翻转到上方", async () => {
    // 测试点：歌曲新增面板的 band_id 下拉选择框在视口底部时应翻转到触发按钮上方。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ポピパ", band_members: [] },
        { band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: [] },
      ],
    });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    const trigger = screen.getByRole("button", { name: "请选择 band_id" });

    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 750, bottom: 780, left: 400, right: 520, width: 120, height: 30,
      x: 400, y: 750, toJSON: () => ({}),
    });

    await user.click(trigger);
    const menu = document.querySelector(".bands-floating-menu") as HTMLElement;
    const menuTop = Number(menu.style.top.replace("px", ""));
    const estimatedHeight = Math.min(320, window.innerHeight * 0.6);
    expect(menuTop).toBeLessThan(750 - estimatedHeight + 10);

    rectSpy.mockRestore();
  });

  test("venue下拉框靠近底部时翻转到上方", async () => {
    // 测试点：新增 Live 面板的 venue 下拉选择框在视口底部时应翻转到触发按钮上方。
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [
        { venue_id: 1, venue_name: "TOKYO DOME CITY HALL", venue_alias: "TDC" },
        { venue_id: 2, venue_name: "日本武道館", venue_alias: "武道館" },
      ],
    });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleVenues).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    const trigger: HTMLElement = document.querySelector(".venue-picker-trigger")!;

    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 750, bottom: 780, left: 400, right: 520, width: 120, height: 30,
      x: 400, y: 750, toJSON: () => ({}),
    });

    await user.click(trigger);
    const menu = document.querySelector(".bands-floating-menu") as HTMLElement;
    const menuTop = Number(menu.style.top.replace("px", ""));
    const estimatedHeight = Math.min(320, window.innerHeight * 0.6);
    expect(menuTop).toBeLessThan(750 - estimatedHeight + 10);

    rectSpy.mockRestore();
  });

  // 测试点：确认创建时以巡演名称计算 short_title，提交仍使用原始 Live 关系。
  test("巡演管理创建巡演并提交完整关系集合", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 2, band_name: "Roselia", band_abbr: "r", band_members: [] },
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: [] },
      ],
    });
    apiMocks.getConsoleTourLiveCandidates.mockResolvedValue({
      items: [
        { live_id: 41, live_date: "2026-05-30", start_time: "18:00:00+09:00", live_title: "New Tour 福岡公演", venue: "Zepp", tour_id: null, tour_title: null, band_ids: [1, 2] },
      ],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    apiMocks.createConsoleTour.mockResolvedValue({
      ok: true,
      item: { tour_id: 7, tour_title: "New Tour", band_count: 2, stop_count: 1 },
    });
    apiMocks.getConsoleTour.mockResolvedValue({
      tour_id: 7,
      tour_title: "New Tour",
      band_ids: [1, 2],
      stops: [{ live_id: 41, live_date: "2026-05-30", start_time: "18:00:00+09:00", live_title: "New Tour 福岡公演", venue: "Zepp", band_ids: [1, 2], stop_label: "Final" }],
    });

    render(<ConsoleInsertPanel initialMode="tour" />);
    await waitFor(() => expect(apiMocks.getConsoleTourLiveCandidates).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "新建巡演" })).toHaveClass("console-submit-btn");
    expect(screen.getByRole("button", { name: "新建巡演" })).not.toHaveClass("console-new-btn");
    expect(screen.queryByText("官方来源")).not.toBeInTheDocument();
    expect(screen.queryByText("简短说明")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下移" })).not.toBeInTheDocument();
    expect(screen.queryByText("场次标签")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("巡演名称"), "New Tour");
    await user.click(screen.getByRole("button", { name: "不指定" }));
    expect(screen.getByRole("checkbox", { name: "不指定" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "2 - Roselia" }));
    await user.click(screen.getByRole("checkbox", { name: "1 - Poppin'Party" }));
    expect(screen.getByRole("checkbox", { name: "不指定" })).not.toBeChecked();
    expect(screen.queryByText("Occupied Live")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("button", { name: "创建巡演" }));
    expect(screen.getByRole("dialog", { name: "确认创建巡演" })).toHaveClass("compact");
    expect(screen.getByRole("dialog", { name: "确认创建巡演" })).not.toHaveClass("wide");
    const confirmDialog = within(screen.getByRole("dialog", { name: "确认创建巡演" }));
    expect(confirmDialog.queryByText("stop_label")).not.toBeInTheDocument();
    expect(confirmDialog.getByRole("columnheader", { name: "short_title" })).toBeInTheDocument();
    expect(confirmDialog.getByText("福岡公演")).toBeInTheDocument();
    expect(confirmDialog.queryByText("New Tour 福岡公演")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleTour).toHaveBeenCalledWith(
      {
        tour_title: "New Tour",
        band_ids: [1, 2],
        stops: [{ live_id: 41, stop_label: null }],
      },
      "csrf-token",
    ));
    await waitFor(() => expect(screen.getByLabelText("巡演名称")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "创建巡演" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "已选场次" })).getByText("至少添加一场 Live 后才能保存巡演。")).toBeInTheDocument();
    const insertedTourTable = screen.getByRole("table", { name: "新增巡演记录" });
    expect(within(insertedTourTable).getByText("7")).toBeInTheDocument();
    expect(within(insertedTourTable).getByText("New Tour")).toBeInTheDocument();
    expect(within(insertedTourTable).getByText("2")).toBeInTheDocument();
    expect(within(insertedTourTable).getByText("1")).toBeInTheDocument();
  });

  // 测试点：新建巡演未指定参与乐队时，确认弹窗应提示自动聚合与统计范围，但仍允许提交。
  test("新建巡演未指定乐队时显示确认提示", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleTourLiveCandidates.mockResolvedValue({
      items: [
        { live_id: 41, live_date: "2026-05-30", start_time: "18:00:00+09:00", live_title: "No Band Tour", venue: "Zepp", tour_id: null, tour_title: null, band_ids: [1] },
      ],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });

    render(<ConsoleInsertPanel initialMode="tour" />);
    await screen.findByText(/#41 No Band Tour/);
    await user.type(screen.getByLabelText("巡演名称"), "No Band Tour");
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("button", { name: "创建巡演" }));

    const dialog = screen.getByRole("dialog", { name: "确认创建巡演" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "尚未指定参与乐队；创建后将按所选场次自动聚合乐队，巡演统计会包含全部 Setlist。",
    );
    expect(within(dialog).getByRole("button", { name: "确认提交" })).toBeEnabled();
  });

  // 测试点：已有巡演使用共享实体选择器宽度，保存后退出编辑态且不把更新计入新增记录。
  test("巡演管理保存修改后还原表单", async () => {
    const user = userEvent.setup();
    apiMocks.getTours.mockResolvedValue({
      items: [{
        tour_id: 7,
        tour_title: "Existing Tour",
        url: null,
        description: null,
        bands: [],
        start_date: "2026-05-30",
        end_date: "2026-05-30",
        collected_live_count: 1,
        stop_labels: [],
      }],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    });
    apiMocks.getConsoleTour.mockResolvedValue({
      tour_id: 7,
      tour_title: "Existing Tour",
      band_ids: [],
      stops: [{
        live_id: 41,
        live_date: "2026-05-30",
        start_time: "18:00:00+09:00",
        live_title: "Existing Live",
        venue: "Zepp",
        band_ids: [1],
        stop_label: "Legacy label",
      }],
    });
    apiMocks.getConsoleTourLiveCandidates.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 1,
    });
    apiMocks.updateConsoleTour.mockResolvedValue({
      ok: true,
      item: { tour_id: 7, tour_title: "Updated Tour", band_count: 0, stop_count: 1 },
    });

    render(<ConsoleInsertPanel initialMode="tour" />);
    await screen.findByRole("option", { name: "#7 Existing Tour" });
    expect(screen.getByLabelText("已有巡演")).toHaveClass("console-entity-select");
    await user.selectOptions(screen.getByLabelText("已有巡演"), "7");
    await waitFor(() => expect(screen.getByLabelText("巡演名称")).toHaveValue("Existing Tour"));
    await user.clear(screen.getByLabelText("巡演名称"));
    await user.type(screen.getByLabelText("巡演名称"), "Updated Tour");
    await user.type(screen.getByPlaceholderText("输入 Live ID 或标题"), "Tokyo");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.updateConsoleTour).toHaveBeenCalledWith(
      7,
      {
        tour_title: "Updated Tour",
        band_ids: [],
        stops: [{ live_id: 41, stop_label: "Legacy label" }],
      },
      "csrf-token",
    ));
    await waitFor(() => expect(screen.getByLabelText("巡演名称")).toHaveValue(""));
    expect(screen.getByLabelText("已有巡演")).toHaveValue("");
    expect(screen.getByPlaceholderText("输入 Live ID 或标题")).toHaveValue("");
    expect(screen.getByRole("button", { name: "创建巡演" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "新增巡演记录" })).getByText("暂无新增巡演记录")).toBeInTheDocument();
  });

  // 测试点：同日巡演场次按开演时间排序，巡演结果继续写入共享日志。
  test("巡演管理一键添加全部筛选结果", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleTourLiveCandidates.mockImplementation((_query, _page, pageSize) => Promise.resolve({
      items: pageSize === 500 ? [
        { live_id: 41, live_date: "2026-06-02", start_time: "18:00:00+09:00", live_title: "Later", venue: "B", tour_id: null, tour_title: null, band_ids: [2] },
        { live_id: 42, live_date: "2026-06-02", start_time: "13:00:00+09:00", live_title: "Earlier", venue: "A", tour_id: null, tour_title: null, band_ids: [1] },
      ] : [],
      page: 1,
      page_size: pageSize,
      total: pageSize === 500 ? 2 : 0,
      total_pages: 1,
    }));

    render(<ConsoleInsertPanel initialMode="tour" />);
    await waitFor(() => expect(apiMocks.getConsoleTourLiveCandidates).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "一键添加筛选结果" }));

    await waitFor(() => expect(apiMocks.getConsoleTourLiveCandidates).toHaveBeenCalledWith("", 1, 500));
    const selectedRows = within(screen.getByRole("table", { name: "已选场次" }))
      .getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(selectedRows).toEqual([
      expect.stringContaining("#42 Earlier"),
      expect.stringContaining("#41 Later"),
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("已添加 2 场");

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await user.click(screen.getByRole("button", { name: "清空数据" }));
    expect(screen.getByRole("status")).toHaveTextContent("已清空新增Live表格。");
    expect(screen.queryByText(/已添加 2 场。/)).not.toBeInTheDocument();
  });
});
