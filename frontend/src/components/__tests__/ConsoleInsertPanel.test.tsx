import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";
import { CONSOLE_LIVE_CHANGE_STORAGE_KEY } from "../../consoleLiveSync";

const apiMocks = vi.hoisted(() => ({
  getCatalogConsole: vi.fn(),
  songCatalogWrite: vi.fn(),
  getSongGroups: vi.fn(),
  getSongGroup: vi.fn(),
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
  getConsoleBandHistory: vi.fn(),
  createConsoleBand: vi.fn(),
  createConsoleBandLineupVersion: vi.fn(),
  getConsoleBandTransitionLiveCandidates: vi.fn(),
  previewConsoleLiveClock: vi.fn().mockResolvedValue({ date_phase: "today" }),
  getConsoleLive: vi.fn(),
  getConsoleLiveCandidates: vi.fn(),
  getConsoleLocalities: vi.fn(),
  getConsoleTimezones: vi.fn(),
  getConsoleVenues: vi.fn(),
  getConsoleVenue: vi.fn(),
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
  getCatalogConsole: apiMocks.getCatalogConsole,
  songCatalogWrite: apiMocks.songCatalogWrite,
  getSongGroups: apiMocks.getSongGroups,
  getSongGroup: apiMocks.getSongGroup,
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
  getConsoleBandHistory: apiMocks.getConsoleBandHistory,
  createConsoleBand: apiMocks.createConsoleBand,
  createConsoleBandLineupVersion: apiMocks.createConsoleBandLineupVersion,
  getConsoleBandTransitionLiveCandidates: apiMocks.getConsoleBandTransitionLiveCandidates,
  previewConsoleLiveClock: apiMocks.previewConsoleLiveClock,
  getConsoleLive: apiMocks.getConsoleLive,
  getConsoleLiveCandidates: apiMocks.getConsoleLiveCandidates,
  getConsoleLocalities: apiMocks.getConsoleLocalities,
  getConsoleTimezones: apiMocks.getConsoleTimezones,
  getConsoleVenues: apiMocks.getConsoleVenues,
  getConsoleVenue: apiMocks.getConsoleVenue,
  getLiveDetail: apiMocks.getLiveDetail,
  getLives: apiMocks.getLives,
}));

function catalogSongFixture(id: number, name: string) {
  return { song_id: id, song_name: name, group_id: id, group_name: name, version_label: "普通版", version_order: 1, revision: 1,
    legacy_cover: false, performance_count: 0, albums: [], ownership: { mode: "pending", band_ids: [], member_groups: [], bands: [], groups: [] } };
}

function getTodayDateInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentRoseliaHistory(bandId = 2) {
  return {
    band_id: bandId,
    current_name: "Roselia",
    current_abbr: "ロゼリア",
    current_members: ["湊友希那"],
    current_name_version_id: 20,
    current_lineup_version_id: 21,
    initialized: true,
    name_versions: [{
      name_version_id: 20,
      band_name: "Roselia",
      band_abbr: "ロゼリア",
      valid_from: "2015-01-01",
      valid_to: null,
      note: null,
      live_ids: [],
    }],
    lineup_versions: [{
      lineup_version_id: 21,
      version_no: 1,
      version_label: "Roselia V1",
      valid_from: "2015-01-01",
      valid_to: null,
      predecessor_id: null,
      change_type: "initial",
      transition_live_id: null,
      note: null,
      members: ["湊友希那"],
      added_members: ["湊友希那"],
      removed_members: [],
      live_ids: [],
    }],
  };
}

describe("ConsoleInsertPanel", () => {
  beforeEach(() => {
    apiMocks.getCatalogConsole.mockReset().mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 });
    apiMocks.getSongGroups.mockReset().mockResolvedValue({ items: [] });
    apiMocks.previewConsoleLiveClock.mockReset().mockResolvedValue({ date_phase: "today" });
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
    apiMocks.getConsoleBandHistory.mockReset();
    apiMocks.createConsoleBand.mockReset();
    apiMocks.createConsoleBandLineupVersion.mockReset();
    apiMocks.getConsoleBandTransitionLiveCandidates.mockReset();
    apiMocks.getConsoleLive.mockReset();
    apiMocks.getConsoleLiveCandidates.mockReset();
    apiMocks.getConsoleLocalities.mockReset();
    apiMocks.getConsoleTimezones.mockReset();
    apiMocks.getConsoleVenues.mockReset();
    apiMocks.getConsoleVenue.mockReset();
    apiMocks.getConsoleVenue.mockResolvedValue({ venue_kind: "physical", timezone_id: "Asia/Tokyo" });
    apiMocks.getLiveDetail.mockReset();
    apiMocks.getLives.mockReset();
    apiMocks.getConsoleSongs.mockResolvedValue({ items: [] });
    apiMocks.getConsoleBands.mockResolvedValue({ items: [] });
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 });
    apiMocks.getConsoleLocalities.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 });
    apiMocks.getConsoleTimezones.mockResolvedValue(["Asia/Tokyo"]);
    apiMocks.getConsoleLive.mockResolvedValue({
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Event Live",
        live_type: "event",
        url: "https://example.com/event",
        opening_time: "09:00:00+09:00",
        start_time: "21:30:00+09:00",
        timezone: null,
        venue_id: 88,
        venue_name_version_id: 188,
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
        venue_name_version_id: 188,
        default_band_ids: [3],
        event_attendees: [],
        band_lineup_contexts: [],
        event_status: "scheduled",
        status_note: null,
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
        venue_name_version_id: 188,
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, mode: "partial", members: ["高松燈"] }],
      },
    });
    apiMocks.createConsoleSong.mockResolvedValue({
      ok: true,
      item: { song_id: 903, group_id: 903, song_name: "新曲", band_id: 2, cover: false },
    });
    apiMocks.updateConsoleSong.mockResolvedValue({
      ok: true,
      item: { song_id: 901, group_id: 901, song_name: "改名曲", band_id: 2, cover: true },
    });
    apiMocks.createConsoleSongsBatch.mockResolvedValue({
      ok: true,
      created: [{ song_id: 902, group_id: 902, song_name: "Requiem for Fate", band_id: 2, cover: false }],
    });
    apiMocks.createConsoleVenue.mockResolvedValue({
      ok: true,
      item: { venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 },
    });
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

  test("空白表单不请求无效场馆的时间预览", async () => {
    // 测试点：初始及清空表单中的场馆占位值不会触发不存在场馆的错误提示。
    render(<ConsoleInsertPanel initialMode="live_create" />);
    await waitFor(() => expect(apiMocks.getConsoleVenues).toHaveBeenCalled());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(apiMocks.previewConsoleLiveClock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // 测试点：切换场馆显示自身时区，日期状态由访问者日期预览决定。
  test("venue selection displays timezone without changing visitor date rules", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T02:00:00Z"));
    try {
      apiMocks.getConsoleVenues.mockResolvedValue({ items: [
        { venue_id: 1, venue_name: "Tokyo", venue_name_version_id: 1, timezone_id: "Asia/Tokyo" },
        { venue_id: 2, venue_name: "New York", venue_name_version_id: 2, timezone_id: "America/New_York" },
      ] });
      const user = userEvent.setup();
      render(<ConsoleInsertPanel initialMode="live_create" />);
      await waitFor(() => expect(apiMocks.getConsoleVenues).toHaveBeenCalled());
      fireEvent.change(screen.getByLabelText("live_date"), { target: { value: "2026-07-14" } });
      expect(await screen.findByText("Asia/Tokyo")).toBeInTheDocument();
      expect(document.querySelector(".live-admin-readonly-field")).toHaveAttribute("data-status-tone", "past");
      await user.click(screen.getByRole("button", { name: "1 - Tokyo" }));
      await user.click(await screen.findByRole("radio", { name: "2 - New York" }));
      expect(screen.getByText("America/New_York")).toBeInTheDocument();
      expect(document.querySelector(".live-admin-readonly-field")).toHaveAttribute("data-status-tone", "past");
      expect(screen.queryByText(/场馆未设置/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // 测试点：控制台首次进入应优先新增 Live、聚焦场馆查询，且不预加载隐藏的 Setlist 候选。
  test("默认渲染新增 Live 并聚焦场馆查询", async () => {
    render(<ConsoleInsertPanel initialMode="live_create" />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    expect(screen.getByRole("tab", { name: "新增演出" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "演出管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增歌单" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "歌单管理" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "歌曲管理" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "新增乐队" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增演出" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("查询场馆")).toHaveFocus();
    expect(screen.getAllByRole("columnheader", { name: "live_date" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "live_title" }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("opening_time")).toHaveValue("18:00");
    expect(screen.getByLabelText("opening_time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("start_time")).toHaveValue("19:00");
    expect(screen.getByLabelText("start_time")).toHaveAttribute("type", "time");
    expect(screen.getByRole("button", { name: "请选择场馆" })).toBeInTheDocument();
    expect(screen.queryByLabelText("timezone")).not.toBeInTheDocument();
    expect(apiMocks.getLives).not.toHaveBeenCalled();
  });

  // 测试点：歌曲提供独立新增及管理入口；场馆后的新增地区为独立资料入口。
  test("控制台导航支持按资料类型切换", async () => {
    const user = userEvent.setup();
    render(<ConsoleInsertPanel initialMode="live_create" />);

    const content = screen.getByRole("navigation", { name: "控制台录入类型" });
    expect(within(content).queryByRole("heading", { name: "内容管理" })).not.toBeInTheDocument();
    expect(within(content).getByRole("tablist", { name: "内容管理" })).toBeInTheDocument();
    expect(within(content).getByRole("tab", { name: "歌曲管理" })).toHaveTextContent("管理");
    expect(within(content).getByRole("tab", { name: "新增歌曲" })).toHaveTextContent("新增");
    expect(within(content).getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "新增演出", "演出管理", "新增歌单", "歌单管理", "新增歌曲", "歌曲管理", "专辑管理", "巡演管理", "活动组管理", "乐队管理", "新增场馆", "场馆管理", "新增地区",
    ]);

    await user.click(within(content).getByRole("tab", { name: "场馆管理" }));
    expect(within(content).getByRole("tab", { name: "场馆管理" })).toHaveAttribute("aria-selected", "true");

    await user.click(within(content).getByRole("tab", { name: "新增地区" }));
    expect(within(content).getByRole("tab", { name: "新增地区" })).toHaveAttribute("aria-selected", "true");
    expect(within(content).getByRole("tab", { name: "新增地区" })).toHaveTextContent("新增");
    expect(within(content).getByRole("tab", { name: "新增地区" })).not.toHaveTextContent("管理");
    expect(await screen.findByRole("region", { name: "新增地区" })).toBeInTheDocument();

    expect(screen.queryByRole("navigation", { name: "控制台工具" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "地理质量" })).not.toBeInTheDocument();
  });

  // 测试点：低频夏令时重复钟点只由后端校验兜底，不在常规 Live 表单暴露 fold 控件。
  test("Live 表单不显示夏令时重复时间控件", async () => {
    render(<ConsoleInsertPanel initialMode="live_create" />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    expect(screen.queryByLabelText("opening time fold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("start time fold")).not.toBeInTheDocument();
    expect(screen.queryByText("非重复时间")).not.toBeInTheDocument();
  });

  // 测试点：新增 Setlist 按候选顺序显示 Live，并保留服务端默认选择。
  test("候选下拉框保留服务端顺序和默认选择", async () => {
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
  });

  // 测试点：新增 Setlist 必须保持新增表格的业务字段，不包含管理态专属字段。
  test("新增Setlist只显示新增所需字段", async () => {
    render(<ConsoleInsertPanel />);
    await screen.findByLabelText("选择 live_id");

    const table = document.querySelector(".setlist-input-wrap .setlist-table") as HTMLTableElement;
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
    apiMocks.getConsoleBandHistory.mockResolvedValue(currentRoseliaHistory());
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, group_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] });
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
    await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled());
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
        band_lineup_contexts: [{
          band_id: 2,
          band_name_version_id: 20,
          base_lineup_version_id: 21,
          next_lineup_version_id: null,
        }],
        setlist_rows: [
          {
            song_group_id: 901,
            absolute_order: 1,
            segment_type: "M",
            sub_order: 1,
            is_short: false,
            band_member: { Roselia: ["湊友希那"] },
            band_performances: [{
              band_id: 2,
              lineup_usage: "base",
              handover_baseline: null,
              members: ["湊友希那"],
            }],
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
    expect(within(resultTable).getByRole("columnheader", { name: "sid" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "abs" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "seg" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "sub" })).toBeInTheDocument();
    expect(within(resultTable).getByRole("columnheader", { name: "short" })).toBeInTheDocument();
    expect(within(resultTable).queryByRole("columnheader", { name: "song_id" })).not.toBeInTheDocument();
  });

  // 测试点：未公布场馆与时间可提交 null，非 online 模式不暴露时区输入并使用默认偏移。
  test("新增Live可提交未公布排期并保留暂存值", async () => {
    const user = userEvent.setup();
    render(<ConsoleInsertPanel initialMode="live_create" />);
    await waitFor(() => expect(apiMocks.getConsoleVenues).toHaveBeenCalled());

    const scheduleStatusTable = screen.getByRole("table", { name: "排期资料公布状态" });
    expect(within(scheduleStatusTable).getByLabelText("场馆公布状态")).toBeInTheDocument();
    expect(within(scheduleStatusTable).getByLabelText("开场公布状态")).toBeInTheDocument();
    expect(within(scheduleStatusTable).getByLabelText("开演公布状态")).toBeInTheDocument();
    expect(within(scheduleStatusTable).queryByRole("combobox")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Schedule TBA");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/tba");
    await user.click(screen.getByLabelText("场馆公布状态"));
    await user.click(screen.getByLabelText("开场公布状态"));
    expect(screen.getByLabelText("opening_time")).toBeDisabled();
    await user.click(screen.getByLabelText("开场公布状态"));
    expect(screen.getByLabelText("opening_time")).toHaveValue("18:00");
    await user.click(screen.getByLabelText("开场公布状态"));
    await user.click(screen.getByLabelText("开演公布状态"));
    expect(screen.queryByLabelText("online timezone offset")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_id: null,
        opening_time: null,
        start_time: null,
        timezone: null,
      }),
      "csrf-token",
    ));
  });

  // 测试点：待补面板常驻显示分类入口，具体活动默认收起并由对应分类按钮展开或再次收起。
  test("待补排期面板通过分类按钮展开对应活动", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{
        live_id: 72,
        live_date: getTodayDateInputValue(),
        live_title: "Today TBA Live",
        live_type: "oneman",
        venue_name: null,
        event_status: "scheduled",
        date_phase: "today",
        missing_schedule_fields: ["venue", "opening_time"],
        schedule_attention: "today",
      }],
      page: 1,
      page_size: 10,
      total: 1,
      total_pages: 1,
      attention_counts: { upcoming: 3, today: 1, overdue: 2 },
    });

    const { unmount } = render(<ConsoleInsertPanel initialMode="live_create" />);

    expect(screen.queryByRole("region", { name: "待补排期" })).not.toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getConsoleVenues).toHaveBeenCalled());
    expect(apiMocks.getConsoleLiveCandidates).not.toHaveBeenCalled();

    unmount();
    render(<ConsoleInsertPanel initialMode="live_edit" />);

    const categories = await screen.findByRole("group", { name: "待补排期分类" });
    const upcomingButton = within(categories).getByRole("button", { name: /未来待公布.*3/ });
    const todayButton = within(categories).getByRole("button", { name: /今日仍缺失.*1/ });
    expect(screen.getByRole("region", { name: "待补排期" })).toBeInTheDocument();
    expect(upcomingButton).toHaveAttribute("aria-expanded", "false");
    expect(todayButton).toHaveAttribute("aria-expanded", "false");
    expect(within(categories).getByRole("button", { name: /已结束仍缺失.*2/ })).toBeInTheDocument();
    expect(screen.queryByText("Today TBA Live")).not.toBeInTheDocument();

    await user.click(todayButton);
    expect(todayButton).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Today TBA Live")).toBeInTheDocument();
    expect(screen.getByText("今日活动仍有资料未公布")).toBeInTheDocument();

    await user.click(todayButton);
    await waitFor(() => expect(todayButton).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByText("Today TBA Live")).not.toBeInTheDocument();
  });

  // 测试点：写请求响应超时后若后端已持久化完全一致的数据，应按成功收口而不是诱导重复提交。
  test("Setlist提交超时后会读取后端结果并确认已写入", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue(currentRoseliaHistory());
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, group_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] });
    apiMocks.appendConsoleLiveSetlist.mockRejectedValueOnce(new Error("Request timeout"));
    apiMocks.getConsoleLiveSetlist.mockResolvedValueOnce({
      live_id: 101,
      band_lineup_contexts: [{
        band_id: 2,
        band_name_version_id: 20,
        base_lineup_version_id: 21,
        next_lineup_version_id: null,
      }],
      rows: [{
        row_id: "persisted-row-1",
        song_group_id: 901,
        song_name: "BLACK SHOUT",
        absolute_order: 1,
        segment_type: "M",
        sub_order: 1,
        is_short: false,
        band_member: { Roselia: ["湊友希那"] },
        band_performances: [{
          band_id: 2,
          lineup_usage: "base",
          handover_baseline: null,
          members: ["湊友希那"],
        }],
        other_member: null,
        comment: null,
      }],
    });

    render(<ConsoleInsertPanel />);
    await screen.findByLabelText("批量粘贴 Setlist 文本");
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。");
    await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.getConsoleLiveSetlist).toHaveBeenCalledWith(101));
    expect(await screen.findByText("已确认 Live #101 的 1 条 Setlist 已写入（原提交响应未成功返回）。")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
    expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
    expect(screen.queryByText(/未选择有效的 live_id/)).not.toBeInTheDocument();
  });

  // 测试点：后继阵容与手工勾选成员应进入确认数据，交接共演的正式基准和实际成员也应原样提交。
  test("交接共演可选择新阵容为正式基准", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{
        band_id: 2,
        band_name: "Roselia",
        band_abbr: "ロゼリア",
        band_members: ["Old Member", "New Member"],
      }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue({
      band_id: 2,
      current_name: "Roselia",
      current_abbr: "ロゼリア",
      current_members: ["New Member"],
      current_name_version_id: 20,
      current_lineup_version_id: 22,
      initialized: true,
      name_versions: [{
        name_version_id: 20,
        band_name: "Roselia historical",
        band_abbr: "r",
        valid_from: "2015-01-01",
        valid_to: null,
        note: null,
        live_ids: [],
      }],
      lineup_versions: [
        {
          lineup_version_id: 21,
          version_no: 1,
          version_label: "Roselia V1",
          valid_from: "2015-01-01",
          valid_to: "2018-01-01",
          predecessor_id: null,
          change_type: "initial",
          note: null,
          members: ["Old Member"],
          added_members: ["Old Member"],
          removed_members: [],
          live_ids: [],
        },
        {
          lineup_version_id: 22,
          version_no: 2,
          version_label: "Roselia V2",
          valid_from: "2018-01-01",
          valid_to: null,
          predecessor_id: 21,
          change_type: "replacement",
          transition_live_id: 101,
          note: null,
          members: ["New Member"],
          added_members: ["New Member"],
          removed_members: ["Old Member"],
          live_ids: [],
        },
      ],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, group_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] });

    render(<ConsoleInsertPanel />);
    await screen.findByLabelText("批量粘贴 Setlist 文本");
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    const lineupTable = await screen.findByRole("table", { name: "本场乐队阵容" });
    expect(lineupTable).toHaveTextContent("Roselia V1");
    expect(lineupTable).toHaveTextContent("Roselia V2");
    await user.click(screen.getByRole("button", { name: "1支 / 1人" }));
    await user.selectOptions(screen.getByLabelText("Roselia 本曲模式"), "next");
    await user.click(screen.getByRole("checkbox", { name: "Old Member（旧）" }));

    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。");
    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    const nextLineupDialog = screen.getByRole("dialog", { name: "确认提交 Setlist" });
    expect(within(nextLineupDialog).getByText('{"Roselia":["New Member","Old Member"]}')).toBeInTheDocument();
    await user.click(within(nextLineupDialog).getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "1支 / 2人" }));
    await user.selectOptions(screen.getByLabelText("Roselia 本曲模式"), "handover");
    await user.selectOptions(screen.getByLabelText("Roselia 交接正式基准"), "next");
    await user.click(screen.getByRole("checkbox", { name: "New Member（新）" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.appendConsoleLiveSetlist).toHaveBeenCalledWith(
      101,
      {
        band_lineup_contexts: [{
          band_id: 2,
          band_name_version_id: 20,
          base_lineup_version_id: 21,
          next_lineup_version_id: 22,
        }],
        setlist_rows: [{
          song_group_id: 901,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_member: { Roselia: ["Old Member", "New Member"] },
          band_performances: [{
            band_id: 2,
            lineup_usage: "handover",
            handover_baseline: "next",
            members: ["Old Member", "New Member"],
          }],
          other_member: null,
          comment: null,
        }],
      },
      "csrf-token",
    ));
  });

  // 测试点：普通 Live 必须始终使用当前开放阵容，重复解析也不能按 Live 日期回退旧版本。
  test("普通Live重复解析仍保持当前开放阵容", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{
        band_id: 2,
        band_name: "Roselia",
        band_abbr: "ロゼリア",
        band_members: ["Stable Member", "New Member"],
      }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue({
      band_id: 2,
      current_name: "Roselia",
      current_abbr: "ロゼリア",
      current_members: ["Stable Member", "New Member"],
      current_name_version_id: 20,
      current_lineup_version_id: 22,
      initialized: true,
      name_versions: [{
        name_version_id: 20,
        band_name: "Roselia",
        band_abbr: "ロゼリア",
        valid_from: "2015-01-01",
        valid_to: null,
        note: null,
        live_ids: [],
      }],
      lineup_versions: [
        {
          lineup_version_id: 21,
          version_no: 1,
          version_label: "Roselia V1",
          valid_from: "2015-01-01",
          valid_to: "2030-01-01",
          predecessor_id: null,
          change_type: "initial",
          note: null,
          members: ["Stable Member", "Old Member"],
          added_members: ["Stable Member", "Old Member"],
          removed_members: [],
          live_ids: [],
        },
        {
          lineup_version_id: 22,
          version_no: 2,
          version_label: "Roselia V2",
          valid_from: "2030-01-01",
          valid_to: null,
          predecessor_id: 21,
          change_type: "replacement",
          note: null,
          members: ["Stable Member", "New Member"],
          added_members: ["New Member"],
          removed_members: ["Old Member"],
          live_ids: [],
        },
      ],
    });

    render(<ConsoleInsertPanel />);
    await screen.findByLabelText("批量粘贴 Setlist 文本");
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    expect(await screen.findByRole("table", { name: "本场乐队阵容" })).toHaveTextContent("Roselia V2");
    await waitFor(() => expect(screen.getByRole("button", { name: "1支 / 2人" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "1支 / 2人" }));

    expect(screen.getByRole("checkbox", { name: "Stable Member" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "New Member" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Old Member" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Roselia 本曲模式")).not.toBeInTheDocument();
    expect(screen.queryByText("Old Member（旧）")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    const reapplyDialog = screen.getByRole("dialog", { name: "确认应用到表格" });
    expect(within(reapplyDialog).getByText(
      '{"Roselia":["Stable Member","New Member"]}',
    )).toBeInTheDocument();
    await user.click(within(reapplyDialog).getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "1支 / 2人" }));

    expect(screen.getByRole("checkbox", { name: "Stable Member" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "New Member" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Old Member" })).not.toBeInTheDocument();
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
        items: [{ song_id: 901, group_id: 901, song_name: "春日序曲", band_id: 9, cover: false }],
      })
      .mockResolvedValueOnce({
        items: [{ song_id: 902, group_id: 902, song_name: "逆光海岸", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.selectOptions(screen.getByLabelText("归属模式"), "bands");
    expect(await screen.findByRole("checkbox", { name: "Real Band" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "新增歌单" }));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "春日序曲");
    await user.click(screen.getByRole("button", { name: "新增一行" }));
    await user.type(screen.getAllByPlaceholderText("请输入歌曲名")[1], "逆光海岸");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("春日序曲", 10, undefined, undefined, true));
    expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("逆光海岸", 10, undefined, undefined, true);
    expect(await screen.findByText("查询歌曲完成：匹配 2 行，未匹配 0 行。")).toBeInTheDocument();
  });

  test("查询歌曲用等价标点回填sid", async () => {
    // 测试点：setlist 歌名与候选歌名只差常见等价标点时，查询歌曲仍应回填 sid。
    const user = userEvent.setup();
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 904, group_id: 904, song_name: "Song ‘A’，B；C〜D", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "Song 'A',B;C~D");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("Song 'A',B;C~D", 10, undefined, undefined, true));
    expect(await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。")).toBeInTheDocument();
  });

  test("查询歌曲忽略等价标点相邻空白并回填sid", async () => {
    // 测试点：setlist 歌名只缺少等价标点旁的空白时，仍应采用候选的规范歌名和 sid。
    const user = userEvent.setup();
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 908, group_id: 908, song_name: "LET’S あちあちトレーニング！", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "LET'Sあちあちトレーニング！");
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => {
      expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("LET'Sあちあちトレーニング！", 10, undefined, undefined, true);
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
    apiMocks.getConsoleBandHistory.mockResolvedValue(currentRoseliaHistory(9));
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 905, group_id: 905, song_name: "V.I.P MONSTER", band_id: 9, cover: false }],
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
    await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled());
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
        items: [{ song_id: 909, group_id: 909, song_name: "Sing Alive", band_id: 9, cover: false }],
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
    apiMocks.getConsoleBandHistory.mockResolvedValue(currentRoseliaHistory(9));
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          { song_id: 906, group_id: 906, song_name: "CORUSCATE -DNA-", band_id: 9, cover: false, band_name: "Roselia" },
          { song_id: 907, group_id: 907, song_name: "CORUSCATE -DNA-A", band_id: 9, cover: false, band_name: "Roselia" },
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
    await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled());
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
    await userEvent.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await userEvent.selectOptions(screen.getByLabelText("归属模式"), "bands");
    expect(screen.queryByText(/1 - /)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "新增演出" }));
    expect(screen.getByRole("button", { name: "请选择场馆" })).toBeInTheDocument();
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
        { venue_id: 301, venue_name: "Later Venue", venue_name_version_id: 301 },
        { venue_id: 101, venue_name: "Early Venue", venue_name_version_id: 101 },
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

    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.selectOptions(screen.getByLabelText("归属模式"), "bands");
    const bandOptions = within(screen.getByRole("group", { name: "归属乐队" })).getAllByRole("checkbox").map(node => node.closest("label")?.textContent);
    expect(bandOptions).toEqual(["Early Band", "Later Band"]);

    await user.click(screen.getByRole("tab", { name: "新增演出" }));
    await user.click(screen.getByRole("button", { name: "请选择场馆" }));
    const venueMenu = screen.getByText("301 - Later Venue").closest(".bands-floating-menu") as HTMLElement;
    const venueOptions = within(venueMenu).getAllByText(/Venue$/).map((node) => node.textContent);
    expect(venueOptions).toEqual(["101 - Early Venue", "301 - Later Venue"]);
  });

  // 测试点：新增演出查询栏不再提供场馆插入入口，使用中文场馆和乐队标签。
  test("新增演出只查询选择场馆，不提供快捷插入", async () => {
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await user.click(screen.getByRole("tab", { name: "新增演出" }));
    await user.type(screen.getByLabelText("查询场馆"), "New Venue");
    expect(screen.queryByRole("button", { name: "插入" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请选择场馆" })).toBeInTheDocument();
    expect(screen.getByText("默认乐队")).toBeInTheDocument();
    expect(apiMocks.createConsoleVenue).not.toHaveBeenCalled();
  });

  // 测试点：新增 Live 成功后应重置表单，并让共享日志在切换标签页后继续显示最新结果。
  test("新增Live会调用真实写入接口并使用后端返回的live_id", async () => {
    const user = userEvent.setup();
    const onLiveDataChanged = vi.fn();
    const todayDate = getTodayDateInputValue();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188, timezone_id: "America/New_York" }],
    });
    // 测试点：确认和保存记录读取真实时区，无入场时间也不回退到日本时区。
    apiMocks.createConsoleLive.mockResolvedValueOnce({ ok: true, item: {
      live_id: 39, live_date: "2026-04-01", live_title: "Inserted Live", live_type: "oneman",
      url: "https://example.com/inserted", opening_time: null, start_time: "19:00:00-04:00",
      timezone_id: "America/New_York", timezone_offset_minutes: -240,
      venue_id: 88, venue_name_version_id: 188,
      default_band_ids: [3], event_attendees: [], event_status: "scheduled",
    } });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: [] }],
    });

    render(<ConsoleInsertPanel onLiveDataChanged={onLiveDataChanged} />);

    await user.click(screen.getByRole("tab", { name: "新增演出" }));
    await user.click(screen.getByRole("button", { name: "请选择场馆" }));
    await user.click(await screen.findByRole("radio", { name: "88 - New Venue" }));
    expect(screen.getByRole("checkbox", { name: "新增后清空录入数据" })).toBeChecked();
    await user.type(screen.getByLabelText("查询场馆"), "New");
    await user.click(screen.getByRole("button", { name: "请选择默认乐队" }));
    await user.click(screen.getByRole("checkbox", { name: /MyGO/ }));
    expect(screen.getByRole("button", { name: "MyGO!!!!!" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("live_date")).toHaveValue(todayDate);
    fireEvent.change(screen.getByLabelText("live_date"), { target: { value: "2026-04-01" } });
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Inserted Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/inserted");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(apiMocks.createConsoleLive).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认新增 Live" })).toBeInTheDocument();
    expect(screen.getByText("Inserted Live")).toBeInTheDocument();
    expect(screen.getByText("New Venue")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "确认新增 Live" })).getByText("America/New_York")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalledWith(
      {
        live_date: "2026-04-01",
        live_title: "Inserted Live",
        live_type: "oneman",
        url: "https://example.com/inserted",
        opening_time: "18:00",
        start_time: "19:00",
        venue_id: 88,
        venue_name_version_id: 188,
        announced_locality_id: null,
        timezone: null,
        default_band_ids: [3],
        event_attendees: [],
        band_lineup_contexts: [],
        event_status: "scheduled",
        status_note: null,
      },
      "csrf-token",
    ));
    expect(screen.getByText("已新增Live #39（Inserted Live）")).toBeInTheDocument();
    expect(document.querySelector(".live-history-table tbody tr")?.textContent).toContain("39");
    expect(document.querySelector(".live-history-table tbody tr")?.textContent).toContain("UTC-04:00");
    expect(screen.getByLabelText("live_date")).toHaveValue(todayDate);
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("");
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("");
    expect(screen.getByLabelText("查询场馆")).toHaveValue("");
    expect(screen.getByRole("button", { name: "请选择场馆" })).toBeInTheDocument();
    expect(screen.queryByLabelText("timezone")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请选择默认乐队" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "请选择默认乐队" }));
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
    await user.click(screen.getByRole("tab", { name: "新增歌单" }));
    expect(screen.getByRole("status")).toHaveTextContent("已新增Live #39（Inserted Live）");
    await waitFor(() => expect(apiMocks.getLives.mock.calls.length).toBeGreaterThan(callsBeforeSwitch));
    expect(await screen.findByText("第 1 / 1 页，共 2 条")).toBeInTheDocument();
  });

  // 测试点：新增 Live 确认框必须回显人工演出状态及其对外说明。
  test("新增Live确认框回显演出状态和状态说明", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }],
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);

    await user.click(await screen.findByRole("button", { name: "88 - New Venue" }));
    await user.selectOptions(screen.getByDisplayValue("专场"), "event");
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Cancelled Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/cancelled");
    await user.selectOptions(screen.getByLabelText("人工状态"), "cancelled");
    await user.type(screen.getByLabelText("状态说明"), "主办方公告取消");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    const dialog = screen.getByRole("dialog", { name: "确认新增 Live" });
    expect(within(dialog).getByRole("row", { name: "event_status 已取消" })).toBeInTheDocument();
    expect(within(dialog).getByRole("row", { name: "status_note 主办方公告取消" })).toBeInTheDocument();
  });

  // 测试点：关闭清空选项时，新增 Live 成功后应保留当前草稿、Venue 查询和 Venue 选择以便连续录入。
  test("新增Live关闭清空选项后保留录入数据", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }],
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.click(screen.getByRole("checkbox", { name: "新增后清空录入数据" }));
    await user.type(screen.getByLabelText("查询场馆"), "Keep Venue");
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Keep Draft Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/keep-draft");
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Keep Draft Live");
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("https://example.com/keep-draft");
    expect(screen.getByLabelText("查询场馆")).toHaveValue("Keep Venue");
    expect(screen.getByRole("button", { name: "88 - New Venue" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "新增后清空录入数据" })).not.toBeChecked();
  });

  // 测试点：编辑时补取场馆真实时区，更新已有 Setlist 的 Live 不加入新增歌单候选。
  test("Live管理会加载并更新既有Live", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Event Live", live_type: "event", venue_name: "New Venue" }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }] });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: ["高松燈", "千早愛音"] }],
    });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    const selector = await screen.findByRole("combobox", { name: "选择要编辑的 Live" });
    await user.selectOptions(selector, "55");
    await waitFor(() => expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Event Live"));
    expect(apiMocks.getConsoleVenue).toHaveBeenCalledWith(88);
    expect(screen.getByText("Asia/Tokyo")).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: "新增歌单" }));
    await waitFor(() => expect(apiMocks.getLives.mock.calls.length).toBeGreaterThan(callsBeforeSwitch));
    const liveSelect = screen.getByLabelText("选择 live_id");
    expect(within(liveSelect).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["101"]);
  });

  // 测试点：原本未公布的时间保持未公布时，只改标题不得误报排期变化或提交排期变更类型。
  test("Live管理只改标题时不把未公布时间误判为排期变化", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Unannounced Live", live_type: "oneman", venue_name: "New Venue" }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    apiMocks.getConsoleLive.mockResolvedValue({
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Unannounced Live",
        live_type: "oneman",
        url: "https://example.com/unannounced",
        opening_time: null,
        start_time: null,
        timezone: null,
        venue_id: 88,
        venue_name_version_id: 188,
        venue_name: "New Venue",
        default_band_ids: [],
        event_attendees: [],
        band_lineup_contexts: [],
        event_status: "scheduled",
        status_note: null,
        has_setlist: false,
      },
    });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }] });
    apiMocks.updateConsoleLive.mockResolvedValue({
      ok: true,
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Unannounced Live renamed",
        live_type: "oneman",
        url: "https://example.com/unannounced",
        opening_time: null,
        start_time: null,
        venue_id: 88,
        venue_name_version_id: 188,
        default_band_ids: [],
        event_attendees: [],
        band_lineup_contexts: [],
        event_status: "scheduled",
        status_note: null,
      },
    });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "选择要编辑的 Live" }),
      "55",
    );
    await waitFor(() => expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Unannounced Live"));
    await user.type(screen.getByPlaceholderText("请输入Live标题"), " renamed");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    const dialog = screen.getByRole("dialog", { name: "确认更新 Live #55" });
    expect(within(dialog).getByRole("row", { name: "live_title Unannounced Live Unannounced Live renamed" })).toBeInTheDocument();
    expect(within(dialog).queryByText("opening_time")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("start_time")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/本次排期变化/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(apiMocks.updateConsoleLive).toHaveBeenCalledWith(
      55,
      expect.objectContaining({
        live_title: "Unannounced Live renamed",
        opening_time: null,
        start_time: null,
        schedule_change_kind: null,
      }),
      "csrf-token",
    ));
    expect(screen.getByText(/已更新Live #55/)).toBeInTheDocument();
  });

  // 测试点：撤销全部排期变化后，隐藏的排期说明不得进入普通标题更新请求。
  test("Live管理撤销排期变化后不提交残留说明", async () => {
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

    fireEvent.change(screen.getByLabelText("opening_time"), { target: { value: "10:00" } });
    await user.selectOptions(screen.getByRole("combobox", { name: "本次排期变化" }), "correction");
    await user.type(screen.getByLabelText("排期变化说明"), "不应残留的说明");
    fireEvent.change(screen.getByLabelText("opening_time"), { target: { value: "09:00" } });
    expect(screen.queryByLabelText("排期变化说明")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("请输入Live标题"), " renamed");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(screen.getByRole("button", { name: "确认更新" }));
    await waitFor(() => expect(apiMocks.updateConsoleLive).toHaveBeenCalled());

    expect(apiMocks.updateConsoleLive.mock.calls[0][1]).toEqual(expect.objectContaining({
      schedule_change_kind: null,
      schedule_change_note: null,
    }));
  });

  // 测试点：撤销一次排期变化后，后续新的排期变化必须要求管理员重新选择变化类型。
  test("Live管理新的排期变化不复用已撤销变化的类型", async () => {
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

    fireEvent.change(screen.getByLabelText("opening_time"), { target: { value: "10:00" } });
    await user.selectOptions(screen.getByRole("combobox", { name: "本次排期变化" }), "correction");
    fireEvent.change(screen.getByLabelText("opening_time"), { target: { value: "09:00" } });
    expect(screen.queryByRole("combobox", { name: "本次排期变化" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("start_time"), { target: { value: "22:00" } });
    expect(screen.getByRole("combobox", { name: "本次排期变化" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  });

  // 测试点：有 Setlist 的历史 Live 只改标题时必须原样提交阵容上下文，确认框不得误报删除。
  test("Live管理保留已有Setlist的历史阵容上下文", async () => {
    const user = userEvent.setup();
    const historicalContext = {
      band_id: 3,
      band_name_version_id: 19,
      base_lineup_version_id: 21,
      next_lineup_version_id: 22,
    };
    apiMocks.getConsoleLiveCandidates.mockResolvedValue({
      items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Historical Live", live_type: "oneman", venue_name: "New Venue" }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    apiMocks.getConsoleLive.mockResolvedValue({
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Historical Live",
        live_type: "oneman",
        url: "https://example.com/historical",
        opening_time: "18:00:00+09:00",
        start_time: "19:00:00+09:00",
        timezone: null,
        venue_id: 88,
        venue_name_version_id: 188,
        venue_name: "New Venue",
        default_band_ids: [3],
        event_attendees: [],
        band_lineup_contexts: [historicalContext],
        event_status: "scheduled",
        status_note: null,
        has_setlist: true,
      },
    });
    apiMocks.updateConsoleLive.mockResolvedValue({
      ok: true,
      item: {
        live_id: 55,
        live_date: "2026-07-05",
        live_title: "Historical Live renamed",
        live_type: "oneman",
        url: "https://example.com/historical",
        opening_time: "18:00:00+09:00",
        start_time: "19:00:00+09:00",
        venue_id: 88,
        venue_name_version_id: 188,
        default_band_ids: [3],
        event_attendees: [],
        band_lineup_contexts: [historicalContext],
        event_status: "scheduled",
        status_note: null,
      },
    });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }] });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: [] }],
    });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "选择要编辑的 Live" }),
      "55",
    );
    await waitFor(() => expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Historical Live"));
    await user.type(screen.getByPlaceholderText("请输入Live标题"), " renamed");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    const dialog = screen.getByRole("dialog", { name: "确认更新 Live #55" });
    expect(within(dialog).queryByText("band_lineup_contexts")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(apiMocks.updateConsoleLive).toHaveBeenCalledWith(
      55,
      expect.objectContaining({
        live_title: "Historical Live renamed",
        band_lineup_contexts: [historicalContext],
      }),
      "csrf-token",
    ));
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
    await user.click(screen.getByRole("tab", { name: "新增演出" }));

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
      .mockResolvedValueOnce({ items: [], page: 1, page_size: 10, total: 0, total_pages: 1 })
      .mockResolvedValueOnce({ items: [], page: 1, page_size: 20, total: 0, total_pages: 1 })
      .mockResolvedValueOnce({
        items: [{ live_id: 55, live_date: "2026-07-05", live_title: "Event Live", live_type: "event", venue_name: "New Venue" }],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
      });

    render(<ConsoleInsertPanel initialMode="live_edit" />);
    await waitFor(() => expect(apiMocks.getConsoleLiveCandidates).toHaveBeenCalledTimes(2));
    await user.type(screen.getByPlaceholderText("输入 Live ID 或标题"), "Event Live");
    await user.click(screen.getByRole("button", { name: "查询" }));

    const selector = screen.getByRole("combobox", { name: "选择要编辑的 Live" });
    await waitFor(() => expect(selector).toHaveValue("55"));
    expect(apiMocks.getConsoleLive).toHaveBeenCalledWith(55);
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("Event Live");
  });

  // 测试点：活动 Live 应把默认乐队 下勾选的完整成员名单提交给后端，不在前端写入 mode。
  test("活动Live会提交完整出演成员名单", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }] });
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
        venue_name_version_id: 188,
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, mode: "full", members: ["高松燈", "千早愛音"] }],
      },
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.selectOptions(screen.getByDisplayValue("专场"), "event");
    await user.click(screen.getByRole("button", { name: "请选择默认乐队" }));
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

  // 测试点：历史版本选择入口永久移除，无 Setlist 活动也只能提交当前名称、阵容和成员。
  test("无Setlist活动只提交默认Band当前版本", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }] });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{
        band_id: 3,
        band_name: "MyGO!!!!!",
        band_abbr: "mygo",
        band_members: ["Current Vocal"],
      }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue({
      band_id: 3,
      current_name: "MyGO!!!!!",
      current_abbr: "mygo",
      current_members: ["Current Vocal"],
      current_name_version_id: 20,
      current_lineup_version_id: 22,
      initialized: true,
      name_versions: [
        {
          name_version_id: 19,
          band_name: "MyGO old",
          band_abbr: "old",
          valid_from: "2020-01-01",
          valid_to: "2021-01-01",
          note: null,
          live_ids: [],
        },
        {
          name_version_id: 20,
          band_name: "MyGO!!!!!",
          band_abbr: "mygo",
          valid_from: "2021-01-01",
          valid_to: null,
          note: null,
          live_ids: [],
        },
      ],
      lineup_versions: [
        {
          lineup_version_id: 21,
          version_no: 1,
          version_label: "MyGO V1",
          valid_from: "2020-01-01",
          valid_to: "2021-01-01",
          predecessor_id: null,
          change_type: "initial",
          note: null,
          members: ["Old Vocal", "Old Guitar"],
          added_members: ["Old Vocal", "Old Guitar"],
          removed_members: [],
          live_ids: [],
        },
        {
          lineup_version_id: 22,
          version_no: 2,
          version_label: "MyGO V2",
          valid_from: "2021-01-01",
          valid_to: null,
          predecessor_id: 21,
          change_type: "replacement",
          note: null,
          members: ["Current Vocal"],
          added_members: ["Current Vocal"],
          removed_members: ["Old Vocal", "Old Guitar"],
          live_ids: [],
        },
      ],
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.selectOptions(screen.getByDisplayValue("专场"), "event");
    await user.click(screen.getByRole("button", { name: "请选择默认乐队" }));
    await user.click(screen.getByRole("checkbox", { name: /MyGO/ }));
    expect(screen.queryByLabelText("MyGO!!!!! 默认历史名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("MyGO!!!!! 默认基础阵容")).not.toBeInTheDocument();
    const memberGroup = screen.getByRole("group", { name: "MyGO!!!!! 出演成员" });
    await user.click(within(memberGroup).getByRole("checkbox", { name: "Current Vocal" }));
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Current Event");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/current-event");
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalledWith(
      expect.objectContaining({
        default_band_ids: [3],
        event_attendees: [{ band_id: 3, members: ["Current Vocal"] }],
        band_lineup_contexts: [{
          band_id: 3,
          band_name_version_id: 20,
          base_lineup_version_id: 22,
          next_lineup_version_id: null,
        }],
      }),
      "csrf-token",
    ));
  });

  // 测试点：关闭临时开关后隐藏旧版本选择器，但新默认乐队 仍固化当前名称和当前阵容。
  test("关闭临时入口后默认Band只提交当前版本", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }] });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: ["Current Vocal"] }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue({
      band_id: 3,
      current_name: "MyGO!!!!!",
      current_abbr: "mygo",
      current_members: ["Current Vocal"],
      initialized: true,
      name_versions: [{
        name_version_id: 20,
        band_name: "MyGO!!!!!",
        band_abbr: "mygo",
        valid_from: "2021-01-01",
        valid_to: null,
        note: null,
        live_ids: [],
      }],
      lineup_versions: [{
        lineup_version_id: 22,
        version_no: 2,
        version_label: "MyGO V2",
        valid_from: "2021-01-01",
        valid_to: null,
        predecessor_id: null,
        change_type: "initial",
        note: null,
        members: ["Current Vocal"],
        added_members: ["Current Vocal"],
        removed_members: [],
        live_ids: [],
      }],
    });

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.click(screen.getByRole("button", { name: "请选择默认乐队" }));
    await user.click(screen.getByRole("checkbox", { name: /MyGO/ }));
    await waitFor(() => expect(apiMocks.getConsoleBandHistory).toHaveBeenCalledWith(3));

    expect(screen.queryByLabelText("MyGO!!!!! 默认历史名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("MyGO!!!!! 默认基础阵容")).not.toBeInTheDocument();
  });

  // 测试点：活动类型未选择默认乐队 时，新增 Live 确认框应显示非阻断提醒。
  test("活动未选择默认Band时在新增Live确认框显示提示", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue", venue_name_version_id: 188 }],
    });

    render(<ConsoleInsertPanel />);

    await user.click(screen.getByRole("tab", { name: "新增演出" }));
    await user.click(screen.getByRole("button", { name: "请选择场馆" }));
    await user.click(await screen.findByRole("radio", { name: "88 - New Venue" }));
    await user.selectOptions(screen.getByDisplayValue("专场"), "event");
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "No Band Event");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/no-band-event");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    const dialog = screen.getByRole("dialog", { name: "确认新增 Live" });
    expect(within(dialog).getByText("提示：当前 Live 类型为活动，且未选择默认乐队，请确认是否需要补充。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认提交" })).not.toBeDisabled();
  });

  test("新增歌曲提交后保持新增页且操作记录可打开管理", async () => {
    // 测试点：新增与编辑分离，操作记录按后端 song_id 进入管理。
    const user = userEvent.setup();
    const song = catalogSongFixture(903, "新曲");
    apiMocks.songCatalogWrite.mockResolvedValue({ item: song });
    apiMocks.getCatalogConsole.mockImplementation(async (path: string) => path === "/songs/903" ? song : ({ items: [] }));
    render(<ConsoleInsertPanel />);
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.type(screen.getByLabelText("歌曲名称"), "新曲");
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    const dialog = screen.getByRole("dialog", { name: "确认新增歌曲" });
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(apiMocks.songCatalogWrite).toHaveBeenCalledWith("/song-groups", "POST", {
      group_name: "新曲", song_name: "新曲", version_label: "", ownership: { mode: "pending", band_ids: [], member_groups: [] },
    }, "csrf-token"));
    expect(screen.getByRole("tab", { name: "新增歌曲" })).toHaveAttribute("aria-selected", "true");
    const table = screen.getByRole("table", { name: "歌曲操作记录" });
    expect(within(table).getByText("903")).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: "编辑" }));
    await screen.findByDisplayValue("新曲");
    expect(apiMocks.getCatalogConsole).toHaveBeenCalledWith("/songs/903");
    expect(screen.getByRole("tab", { name: "歌曲管理" })).toHaveAttribute("aria-selected", "true");
  });

  // 测试点：歌曲更新确认只列出实际变化的名称与翻唱属性，再通过 PUT 保存完整目标值。
  test("歌曲管理更新具体版本并保留并发版本号", async () => {
    // 测试点：候选只负责选择，完整详情建立快照；基础修改不重写固定归属。
    const user = userEvent.setup();
    const song = catalogSongFixture(901, "原曲名");
    apiMocks.getCatalogConsole.mockImplementation(async (path: string) => path === "/songs/901" ? song : path === "/members" ? { items: [] } : { items: [song], page: 1, total_pages: 1 });
    apiMocks.songCatalogWrite.mockResolvedValue({ item: { ...song, song_name: "改名曲", revision: 2 } });
    render(<ConsoleInsertPanel />);
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "901");
    await screen.findByDisplayValue("原曲名");
    fireEvent.change(screen.getByLabelText("歌曲名称"), { target: { value: "改名曲" } });
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    const dialog = screen.getByRole("dialog", { name: "确认修改歌曲" });
    expect(within(dialog).getByRole("table", { name: "歌曲修改内容" })).toHaveTextContent("原曲名改名曲");
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(apiMocks.songCatalogWrite).toHaveBeenCalledWith("/songs/901", "PUT", { song_name: "改名曲", version_label: "普通版", expected_revision: 1 }, "csrf-token"));
    expect(screen.getByLabelText("歌曲名称")).toHaveValue("改名曲");
  });

  // 测试点：歌曲搜索翻页保留筛选条件和已选歌曲的完整候选标签。
  test("歌曲管理翻页保留已选版本完整标签", async () => {
    // 测试点：筛选分页不会丢掉编辑快照或页外选中标签。
    const user = userEvent.setup();
    const song = catalogSongFixture(902, "搜索命中曲");
    apiMocks.getCatalogConsole.mockImplementation(async (path: string) => path === "/songs/902" ? song : path === "/members" ? { items: [] } : { items: path.includes("page=2") ? [] : [song], page: path.includes("page=2") ? 2 : 1, total_pages: 2 });
    render(<ConsoleInsertPanel />);
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "902");
    await screen.findByDisplayValue("搜索命中曲");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(apiMocks.getCatalogConsole).toHaveBeenCalledWith("/songs?q=&page=2&limit=20"));
    const selector = screen.getByLabelText("选择要编辑的歌曲");
    expect(selector).toHaveValue("902");
    expect(within(selector).getByRole("option", { name: "#902 搜索命中曲 / 普通版 / 待回填" })).toBeInTheDocument();
    expect(screen.getByLabelText("歌曲名称")).toHaveValue("搜索命中曲");
  });

  // 测试点：Setlist 管理只查已有数据，更新时提交完整目标集合。
  test("Setlist管理加载并更新既有Setlist", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
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
      band_lineup_contexts: [{
        band_id: 2,
        band_name_version_id: 20,
        base_lineup_version_id: 21,
        next_lineup_version_id: null,
      }],
      rows: [{
        row_id: "00000000-0000-0000-0000-000000000055",
        song_group_id: 901,
        song_name: "BLACK SHOUT",
        absolute_order: 1,
        segment_type: "M",
        sub_order: 1,
        is_short: false,
        band_member: { Roselia: ["湊友希那"] },
        band_performances: [{
          band_id: 2,
          lineup_usage: "base",
          handover_baseline: null,
          members: ["湊友希那"],
        }],
        other_member: null,
        comment: null,
      }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue(currentRoseliaHistory());

    render(<ConsoleInsertPanel initialMode="live_create" />);
    await user.click(screen.getByRole("tab", { name: "歌单管理" }));
    await waitFor(() => expect(apiMocks.getConsoleLiveCandidates).toHaveBeenCalledWith("", 1, 100, "", true));
    await waitFor(() => expect(apiMocks.getConsoleLiveSetlist).toHaveBeenCalledWith(55));
    expect(screen.getByRole("combobox", { name: "选择要编辑的 Setlist" })).toHaveValue("55");
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("BLACK SHOUT");
    const managementTable = document.querySelector(".setlist-input-wrap .setlist-table") as HTMLTableElement;
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
    await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    const dialog = screen.getByRole("dialog", { name: "确认更新 Setlist" });
    const diffTable = within(dialog).getByRole("table", { name: "Setlist 修改内容" });
    expect(within(diffTable).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "setlist_rows[abs=1].comment-Encore note",
    ]);
    expect(within(dialog).queryByRole("table", { name: "确认场次" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.updateConsoleLiveSetlist).toHaveBeenCalledWith(
      55,
      {
        band_lineup_contexts: [{
          band_id: 2,
          band_name_version_id: 20,
          base_lineup_version_id: 21,
          next_lineup_version_id: null,
        }],
        setlist_rows: [{
          song_group_id: 901,
          absolute_order: 1,
          segment_type: "M",
          sub_order: 1,
          is_short: false,
          band_member: { Roselia: ["湊友希那"] },
          band_performances: [{
            band_id: 2,
            lineup_usage: "base",
            handover_baseline: null,
            members: ["湊友希那"],
          }],
          other_member: null,
          comment: "Encore note",
        }],
      },
      "csrf-token",
    ));
    expect(screen.getByText("已更新 Live #55 的 1 条 Setlist。")).toBeInTheDocument();
  });

  test("新增Setlist只剩一行时删除末行会显示自动消失提示", async () => {
    // 测试点：最后一行草稿不能删除，错误提示随后自动消失。
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "删除末行" }));
      });

      const alert = screen.getByRole("alert");
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
    await user.click(screen.getByRole("tab", { name: "新增歌单" }));

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

  // 测试点：Setlist 详情只在显式请求后加载，并以内容自适应高度展示。
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

    expect(screen.getByRole("heading", { name: "Setlist 详细信息" })).toBeInTheDocument();
  });

  // 测试点：未解析时禁止应用，确认后写入曲目及 from 成员归属，并清空粘贴文本与预览。
  test("批量粘贴Setlist先解析预览再确认应用到草稿表格", async () => {
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
    expect(screen.getByRole("button", { name: "应用到表格" })).toBeDisabled();

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

  // 测试点：候选刷新尚未完成时必须锁住提交，避免用已过期的 live_id 打开确认或继续写入。
  test("刷新Setlist候选期间禁用提交", async () => {
    const user = userEvent.setup();
    let resolveRefresh: ((value: object) => void) | undefined;
    const refreshPromise = new Promise<object>((resolve) => {
      resolveRefresh = resolve;
    });
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleBandHistory.mockResolvedValue(currentRoseliaHistory());
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, group_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] });
    apiMocks.getLives
      .mockResolvedValueOnce({
        items: [
          { live_id: 101, live_date: "2026-03-30", live_title: "First Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
        ],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      })
      .mockReturnValueOnce(refreshPromise);

    render(<ConsoleInsertPanel />);
    await screen.findByRole("option", { name: "101 - First Live (2026-03-30)" });
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。");
    expect(screen.getByRole("button", { name: "提交插入" })).not.toBeDisabled();

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: CONSOLE_LIVE_CHANGE_STORAGE_KEY,
        newValue: JSON.stringify({
          action: "setlist_appended",
          liveId: 999,
          changedAt: "2026-07-27T00:00:00.000Z",
          nonce: "other-tab-loading",
        }),
      }));
    });

    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("选择 live_id")).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "确认提交 Setlist" })).not.toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.({
        items: [
          { live_id: 101, live_date: "2026-03-30", live_title: "First Live", live_type: "oneman", bands: [], url: null, is_favorite: false },
        ],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      });
      await refreshPromise;
    });
  });

  // 测试点：长列表解析后可以取消应用，取消不会修改已有草稿或丢弃粘贴文本。
  test("批量粘贴长列表取消应用时保留原草稿", async () => {
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
    expect(within(dialog).getByRole("heading", { name: "确认应用到表格" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认提交" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "确认应用到表格" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toHaveValue(`<不存在的成员 from MyGO!!!!!>\n${songs}`);
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
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

  test("歌曲编辑离开页面可以取消并保留草稿", async () => {
    // 测试点：从歌曲管理导航到其他资料时必须经过未保存保护。
    const user = userEvent.setup();
    const song = catalogSongFixture(1, "旧名");
    apiMocks.getCatalogConsole.mockImplementation(async (path: string) => path === "/songs/1" ? song : ({ items: path === "/members" ? [] : [song] }));
    render(<ConsoleInsertPanel />);
    await user.click(screen.getByRole("tab", { name: "歌曲管理" }));
    await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "1");
    await screen.findByDisplayValue("旧名");
    fireEvent.change(screen.getByLabelText("歌曲名称"), { target: { value: "草稿" } });
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    const dialog = screen.getByRole("dialog", { name: "确认放弃歌曲修改" });
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByLabelText("歌曲名称")).toHaveValue("草稿");
    expect(screen.getByRole("tab", { name: "歌曲管理" })).toHaveAttribute("aria-selected", "true");
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
      .mockResolvedValueOnce({ items: [{ song_id: 901, group_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] })
      .mockResolvedValueOnce({ items: [] });
    apiMocks.createConsoleSongsBatch
      .mockResolvedValueOnce({ ok: true, created: [{ song_id: 902, group_id: 902, song_name: "Requiem for Fate", band_id: 2, cover: false }] });

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
    const coverCheckbox = within(dialog).getByRole("checkbox", { name: "batch_song_cover-1" });
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

  // 测试点：多候选歌曲必须先人工选择，批量新增确认框只能收录真正未匹配的歌曲。
  test("批量插入不会把候选2与未匹配歌曲一起新增", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          { song_id: 910, group_id: 910, song_name: "Candidate Song A", band_id: 2, cover: false },
          { song_id: 911, group_id: 911, song_name: "Candidate Song B", band_id: 2, cover: false },
        ],
      })
      .mockResolvedValueOnce({ items: [] });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. Candidate Song\nM2. Missing Song" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await screen.findByText("查询歌曲完成：匹配 0 行，待选择 1 行，未匹配 1 行。");
    await user.click(screen.getByRole("button", { name: "批量插入" }));

    const dialog = screen.getByRole("dialog", { name: "确认批量新增歌曲" });
    expect(within(dialog).getByText("Missing Song")).toBeInTheDocument();
    expect(within(dialog).queryByText("Candidate Song")).not.toBeInTheDocument();
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

  // 测试点：有效 abs 编辑后保留输入值，并使下游编号级联递增。
  test("双击abs修改有效值后下行级联递增", async () => {
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
    expect(menuTop).toBeGreaterThanOrEqual(0);
    expect(menuTop).toBeLessThan(750);

    rectSpy.mockRestore();
  });

  // 测试点：band_id=0 的 Other bands 不是实际 Band，不应出现在新增 Setlist 的 band_member 选择器。
  test("新增Setlist的band_member不展示Other bands", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [
        { band_id: 0, band_name: "Other bands", band_abbr: "", band_members: [] },
        { band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] },
      ],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));
    await user.click(document.querySelector(".band-member-trigger") as HTMLElement);

    const menu = document.querySelector(".band-member-floating-menu") as HTMLElement;
    expect(within(menu).queryByText("Other bands")).not.toBeInTheDocument();
    expect(within(menu).getByText("Roselia")).toBeInTheDocument();
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
    let rect = { top: 100, bottom: 130, left: 100, right: 220, width: 120, height: 30, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => rect);

    await user.click(trigger);
    const menu = document.querySelector(".band-member-floating-menu") as HTMLElement;
    const initialTop = Number.parseFloat(menu.style.top);
    const initialLeft = Number.parseFloat(menu.style.left);
    expect(initialTop).toBeGreaterThanOrEqual(rect.bottom);
    const originalRect = rect;
    rect = { ...rect, top: 200, bottom: 230, left: 200, right: 320, x: 200, y: 200 };

    fireEvent.scroll(window);
    await waitFor(() => {
      const updatedMenu = document.querySelector(".band-member-floating-menu") as HTMLElement;
      expect(Number.parseFloat(updatedMenu.style.top) - initialTop).toBe(rect.top - originalRect.top);
      expect(Number.parseFloat(updatedMenu.style.left) - initialLeft).toBe(rect.left - originalRect.left);
    });

    rectSpy.mockRestore();
  });

  test("歌曲新增可以选择多支乐队且切换模式清理旧归属", async () => {
    // 测试点：多乐队选择不降为单值，成员模式不能保留另一模式的关系。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({ items: [{ band_id: 1, band_name: "甲", band_abbr: "a", band_members: [] }, { band_id: 2, band_name: "乙", band_abbr: "b", band_members: [] }] });
    render(<ConsoleInsertPanel />);
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.selectOptions(screen.getByLabelText("归属模式"), "bands");
    await user.click(await screen.findByRole("checkbox", { name: "甲" }));
    await user.click(screen.getByRole("checkbox", { name: "乙" }));
    expect(screen.getByRole("checkbox", { name: "甲" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "乙" })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("归属模式"), "members");
    expect(screen.getByRole("checkbox", { name: "甲" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "乙" })).not.toBeChecked();
  });

  test("venue下拉框靠近底部时翻转到上方", async () => {
    // 测试点：新增 Live 面板的 venue 下拉选择框在视口底部时应翻转到触发按钮上方。
    const user = userEvent.setup();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [
        { venue_id: 1, venue_name: "TOKYO DOME CITY HALL", venue_name_version_id: 11, venue_alias: "TDC" },
        { venue_id: 2, venue_name: "日本武道館", venue_name_version_id: 22, venue_alias: "武道館" },
      ],
    });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleVenues).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "新增演出" }));
    const trigger: HTMLElement = document.querySelector(".venue-picker-trigger")!;

    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 750, bottom: 780, left: 400, right: 520, width: 120, height: 30,
      x: 400, y: 750, toJSON: () => ({}),
    });

    await user.click(trigger);
    const menu = document.querySelector(".bands-floating-menu") as HTMLElement;
    const menuTop = Number(menu.style.top.replace("px", ""));
    expect(menuTop).toBeGreaterThanOrEqual(0);
    expect(menuTop).toBeLessThan(750);

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

    await user.click(screen.getByRole("tab", { name: "新增演出" }));
    await user.click(screen.getByRole("button", { name: "清空数据" }));
    expect(screen.getByRole("status")).toHaveTextContent("已清空新增Live表格。");
    expect(screen.queryByText(/已添加 2 场。/)).not.toBeInTheDocument();
  });
});
