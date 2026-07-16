import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";

const apiMocks = vi.hoisted(() => ({
  appendConsoleLiveSetlist: vi.fn(),
  createConsoleLive: vi.fn(),
  createConsoleSong: vi.fn(),
  createConsoleSongsBatch: vi.fn(),
  createConsoleVenue: vi.fn(),
  getConsoleSongs: vi.fn(),
  getConsoleBands: vi.fn(),
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
  createConsoleLive: apiMocks.createConsoleLive,
  createConsoleSong: apiMocks.createConsoleSong,
  createConsoleSongsBatch: apiMocks.createConsoleSongsBatch,
  createConsoleVenue: apiMocks.createConsoleVenue,
  getConsoleSongs: apiMocks.getConsoleSongs,
  getConsoleBands: apiMocks.getConsoleBands,
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
    apiMocks.createConsoleLive.mockReset();
    apiMocks.createConsoleSong.mockReset();
    apiMocks.createConsoleSongsBatch.mockReset();
    apiMocks.createConsoleVenue.mockReset();
    apiMocks.getConsoleSongs.mockReset();
    apiMocks.getConsoleBands.mockReset();
    apiMocks.getConsoleVenues.mockReset();
    apiMocks.getLiveDetail.mockReset();
    apiMocks.getLives.mockReset();
    apiMocks.getConsoleSongs.mockResolvedValue({ items: [] });
    apiMocks.getConsoleBands.mockResolvedValue({ items: [] });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [] });
    apiMocks.appendConsoleLiveSetlist.mockResolvedValue({
      ok: true,
      item: { live_id: 101, inserted_row_count: 1, total_setlist_row_count: 12 },
    });
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
      },
    });
    apiMocks.createConsoleSong.mockResolvedValue({
      ok: true,
      item: { song_id: 903, song_name: "新曲", band_id: 2, cover: false },
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

  // 测试点：控制台首次进入应优先新增 Live，聚焦场地查询并显示默认 +9:00 时区。
  test("默认渲染新增 Live 并聚焦场地查询", async () => {
    render(<ConsoleInsertPanel initialMode="live_create" />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20, true));

    expect(screen.getByRole("tab", { name: "新增Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增Setlist" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增歌曲" })).toBeInTheDocument();
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

  test("提交新增Setlist会调用真实追加接口并出现插入记录", async () => {
    // 测试点：新增 Setlist 成功后传递正确数据、更新预览，并从无 setlist 候选中移除该 Live。
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
    expect(screen.getByRole("dialog", { name: /确认提交 Setlist/ })).toBeInTheDocument();
    expect(screen.getByText("BLACK SHOUT")).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
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

  test("查询歌曲唯一模糊候选时自动回填sid", async () => {
    // 测试点：后端只返回一个包含匹配候选时，setlist 查询应自动采用该候选 sid。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 9, band_name: "Roselia", band_abbr: "rsl", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 905, song_name: "CORUSCATE -DNA-", band_id: 9, cover: false }],
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

    expect(await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。")).toBeInTheDocument();
    expect(screen.getByText("905")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    const dialog = screen.getByRole("dialog", { name: /确认提交 Setlist/ });
    expect(within(dialog).getByText("CORUSCATE -DNA-")).toBeInTheDocument();
    expect(within(dialog).queryByText("CORUSCATE -DNA")).not.toBeInTheDocument();
  });

  // 测试点：模糊查询返回多个候选时，弹窗显示所属乐队并允许选择正确 sid。
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
    await userEvent.click(screen.getByRole("tab", { name: "新增歌曲" }));
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

    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    const bandOptions = screen.getAllByText(/Band$/).map((node) => node.textContent);
    expect(bandOptions).toEqual(["2 - Early Band", "9 - Later Band"]);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await user.click(screen.getByRole("button", { name: "101 - Early Venue" }));
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

  // 测试点：新增 Live 将分开的 -3:30 控件值标准化提交，成功后恢复 +9:00 默认值。
  test("新增Live会调用真实写入接口并使用后端返回的live_id", async () => {
    const user = userEvent.setup();
    const onLiveDataChanged = vi.fn();
    const todayDate = getTodayDateInputValue();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue" }],
    });

    render(<ConsoleInsertPanel onLiveDataChanged={onLiveDataChanged} />);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await screen.findByRole("button", { name: "88 - New Venue" });
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
      },
      "csrf-token",
    ));
    expect(screen.getByText("已新增Live #39（Inserted Live）")).toBeInTheDocument();
    expect(document.querySelector(".live-history-table tbody tr")?.textContent).toContain("39");
    expect(screen.getByLabelText("live_date")).toHaveValue(todayDate);
    expect(screen.getByPlaceholderText("请输入Live标题")).toHaveValue("");
    expect(screen.getByPlaceholderText("https://...")).toHaveValue("");
    expect(screen.getByLabelText("timezone")).toHaveValue("+9");
    expect(screen.getByLabelText("timezone minute offset")).toHaveTextContent(":00");
    expect(onLiveDataChanged).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "新增Setlist" }));
    expect(screen.getByText("第 1 / 1 页，共 2 条")).toBeInTheDocument();
  });

  test("新增歌曲会调用真实写入接口并使用后端返回的song_id", async () => {
    // 测试点：新增歌曲应调用后端写接口，并用返回的 song_id 更新候选和插入记录。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "rsl", band_members: ["湊友希那"] }],
    });

    render(<ConsoleInsertPanel />);

    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.type(screen.getByPlaceholderText("请输入歌曲名"), "新曲");
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    await user.click(await screen.findByText("2 - Roselia"));
    await user.click(screen.getByRole("button", { name: "提交插入" }));

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

  test("live_id 候选支持20条分页切换", async () => {
    // 测试点：live_id 选择器按 20 条一页请求无 setlist 候选，并可切换到下一页。
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
            ],
      pagination: { page, page_size: 20, total: 21, total_pages: 2 },
    }));

    render(<ConsoleInsertPanel />);

    expect(await screen.findByText("44 - Page One Live (2026-04-20)")).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 页，共 21 条")).toBeInTheDocument();
    expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20, true);

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("24 - Page Two Live (2026-03-20)")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页，共 21 条")).toBeInTheDocument();
    expect(apiMocks.getLives).toHaveBeenCalledWith(2, 20, true);
  });

  test("显示详细信息会复用主页详情API与详情表格", async () => {
    // 测试点：新增Setlist的详情按钮应请求真实 live detail API，并渲染与主页一致的成员表格。
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
    await user.click(screen.getByRole("button", { name: "显示详细信息" }));

    await waitFor(() => expect(apiMocks.getLiveDetail).toHaveBeenCalledWith(101));
    expect(await screen.findByText("春日联合公演")).toBeInTheDocument();
    expect(screen.getByText("Test Venue")).toBeInTheDocument();
    expect(screen.getByText("Poppin'Party")).toBeInTheDocument();
    expect(screen.getByText("真实详情歌曲")).toBeInTheDocument();
  });

  test("批量粘贴Setlist可解析预览并应用到草稿表格", async () => {
    // 测试点：批量粘贴只在点击应用后替换表格，并正确处理 from 成员归属。
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
    expect(screen.queryByText("预览：2 行，提示 0 条")).not.toBeInTheDocument();
    expect(screen.getByText(/请继续点击“查询歌曲”匹配 sid/)).toBeInTheDocument();
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

    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
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

  test("应用到表格弹出确认窗口，确认提交后才替换下方表格", async () => {
    // 测试点：确认窗口展示预览内容，取消不应用，确认提交才真正写入下方表格。
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

    const confirmDialog = screen.getByRole("dialog", { name: "确认应用到表格" });
    expect(confirmDialog).toBeInTheDocument();
    expect(within(confirmDialog).getByText("BLACK SHOUT")).toBeInTheDocument();
    expect(within(confirmDialog).getByText("Requiem for Fate")).toBeInTheDocument();
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

  test("批量插入弹出确认窗口，已有 sid 的行被忽略，仅创建 sid 为空的行", async () => {
    // 测试点：批量新增歌曲确认窗口只保留后端会接收的歌曲字段，并允许在确认前勾选 cover。
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
    const logPanel = await screen.findByRole("log", { name: "控制台日志" });
    expect(within(logPanel).getByText(/批量新增完成：请求 1 首，成功 1 首/)).toBeInTheDocument();
    expect(within(logPanel).getByText(/#902 Requiem for Fate/)).toBeInTheDocument();
  });

  test("批量插入失败时会在控制台日志保留后端错误原因", async () => {
    // 测试点：批量新增歌曲写接口失败时，应把后端状态码、错误码和 message 记录到日志区。
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
    const logPanel = screen.getByRole("log", { name: "控制台日志" });
    expect(within(logPanel).getByText(/批量插入失败：HTTP 403 \/ AUTH_CSRF_INVALID \/ CSRF Token 校验失败/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
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
});
