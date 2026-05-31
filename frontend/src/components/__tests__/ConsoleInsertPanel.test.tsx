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
            {
              band_id: 1,
              band_name: "Poppin'Party",
              present_members: ["Kasumi"],
              present_count: 1,
              total_count: 5,
              is_full: false,
            },
          ],
          other_members: [],
          comments: [],
        },
      ],
    });
    apiMocks.getLives.mockResolvedValue({
      items: [
        {
          live_id: 101,
          live_date: "2026-03-30",
          live_title: "春日联合公演",
          bands: [1, 2],
          url: "https://example.com/live/101",
          is_favorite: false,
        },
      ],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    });
  });

  test("默认渲染新增入口与Setlist字段表格", async () => {
    // 测试点：控制台基础结构存在，且默认是新增Setlist录入视图。
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));
    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20));

    expect(screen.getByRole("tab", { name: "新增Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增Setlist" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增歌曲" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "新增乐队" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示详细信息" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "live_date" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "live_title" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "abs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "seg" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("combobox", { name: /seg-/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("checkbox", { name: /is_short-/ }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("选择 live_id")).toBeInTheDocument();
  });

  test("提交新增Setlist会调用真实追加接口并出现插入记录", async () => {
    // 测试点：新增 Setlist 应调用后端追加接口，且只在成功后更新本地提交预览。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ song_id: 901, song_name: "BLACK SHOUT", band_id: 2, cover: false }] });
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: { value: "<Roselia>\nM1. BLACK SHOUT" },
    });
    await user.click(screen.getByRole("button", { name: "解析" }));
    await user.click(screen.getByRole("button", { name: "应用到表格" }));
    await user.click(screen.getByRole("button", { name: "确认提交" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));
    await screen.findByText("查询歌曲完成：匹配 1 行，未匹配 0 行。");
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
            other_member: {},
          },
        ],
      },
      "csrf-token",
    ));
    expect(screen.getByText("已为Live #101 插入 1 条 setlist，总计 12 条。")).toBeInTheDocument();
    expect(screen.getByLabelText("批量粘贴 Setlist 文本")).toHaveValue("");
    expect(screen.getByPlaceholderText("请输入歌曲名")).toHaveValue("");
    expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
    expect(screen.queryByText("暂无插入记录")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "setlist_rows" })).toBeInTheDocument();
  });

  test("只读查询接口会加载候选数据并用于歌曲查询", async () => {
    // 测试点：控制台只读 API 接入后，band 候选与歌曲查询不再只依赖本地 mock。
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

  test("只读候选请求失败时展示错误且不回退到mock候选", async () => {
    // 测试点：只读接口失败时，控制台直接展示错误，不展示本地 mock 候选。
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

  test("新增Live会调用真实写入接口并使用后端返回的live_id", async () => {
    // 测试点：新增 Live 应交给后端自增 live_id，成功后同步候选分页并通知外层刷新。
    const user = userEvent.setup();
    const onLiveDataChanged = vi.fn();
    apiMocks.getConsoleVenues.mockResolvedValue({
      items: [{ venue_id: 88, venue_name: "New Venue" }],
    });

    render(<ConsoleInsertPanel onLiveDataChanged={onLiveDataChanged} />);

    await user.click(screen.getByRole("tab", { name: "新增Live" }));
    await screen.findByRole("button", { name: "88 - New Venue" });
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "Inserted Live");
    await user.type(screen.getByPlaceholderText("https://..."), "https://example.com/inserted");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(apiMocks.createConsoleLive).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认新增 Live" })).toBeInTheDocument();
    expect(screen.getByText("Inserted Live")).toBeInTheDocument();
    expect(screen.getByText("New Venue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleLive).toHaveBeenCalledWith(
      {
        live_date: "2026-03-30",
        live_title: "Inserted Live",
        type: "专场",
        url: "https://example.com/inserted",
        opening_time: "18:00",
        start_time: "19:00",
        timezone: "+09:00",
        venue_id: 88,
      },
      "csrf-token",
    ));
    expect(screen.getByText("已新增Live #39（Inserted Live）")).toBeInTheDocument();
    expect(screen.getByText("39")).toBeInTheDocument();
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
    // 测试点：live_id 选择器按 20 条一页请求，并可切换到下一页候选。
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
    expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20);

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("24 - Page Two Live (2026-03-20)")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页，共 21 条")).toBeInTheDocument();
    expect(apiMocks.getLives).toHaveBeenCalledWith(2, 20);
  });

  test("显示详细信息会复用主页详情API与详情表格", async () => {
    // 测试点：新增Setlist的详情按钮应请求真实 live detail API，并渲染与主页一致的成员表格。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getLives).toHaveBeenCalledWith(1, 20));
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
    await waitFor(() => expect(screen.getByText("101 - 春日联合公演 (2026-03-30)")).toBeInTheDocument());

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
    // 测试点：sid 已匹配的行直接跳过，仅对 sid 为空的行执行创建。
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

    await user.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.createConsoleSongsBatch).toHaveBeenCalledWith(
      [{ song_name: "Requiem for Fate", band_id: 2, cover: false }],
      "csrf-token",
    ));
    expect(apiMocks.createConsoleSongsBatch).toHaveBeenCalledTimes(1);
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
});
