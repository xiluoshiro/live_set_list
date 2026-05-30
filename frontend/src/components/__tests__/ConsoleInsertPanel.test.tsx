import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";

const apiMocks = vi.hoisted(() => ({
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
  createConsoleVenue: apiMocks.createConsoleVenue,
  getConsoleSongs: apiMocks.getConsoleSongs,
  getConsoleBands: apiMocks.getConsoleBands,
  getConsoleVenues: apiMocks.getConsoleVenues,
  getLiveDetail: apiMocks.getLiveDetail,
  getLives: apiMocks.getLives,
}));

describe("ConsoleInsertPanel", () => {
  beforeEach(() => {
    apiMocks.createConsoleVenue.mockReset();
    apiMocks.getConsoleSongs.mockReset();
    apiMocks.getConsoleBands.mockReset();
    apiMocks.getConsoleVenues.mockReset();
    apiMocks.getLiveDetail.mockReset();
    apiMocks.getLives.mockReset();
    apiMocks.getConsoleSongs.mockResolvedValue({ items: [] });
    apiMocks.getConsoleBands.mockResolvedValue({ items: [] });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [] });
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

  test("提交新增Setlist后会出现一条mock插入记录", async () => {
    // 测试点：最小插入路径可用（选择live_id后可提交，且出现插入记录）。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(screen.getByText(/已为Live #101/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("春日序曲", 10));
    expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("逆光海岸", 10);
    expect(await screen.findByText("查询歌曲完成：匹配 3 行，未匹配 0 行。")).toBeInTheDocument();
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

    await waitFor(() => expect(apiMocks.createConsoleVenue).toHaveBeenCalledWith("New Venue", "csrf-token"));
    expect(screen.getByText("已新增venue #88（New Venue）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "88 - New Venue" })).toBeInTheDocument();
    expect(screen.queryByText("新增Live失败：live_date 与 live_title 为必填项。")).not.toBeInTheDocument();
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
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ポピパ", band_members: ["戸山香澄", "花園たえ"] },
        { band_id: 2, band_name: "Roselia", band_abbr: "ロゼリア", band_members: ["湊友希那", "氷川紗夜"] },
      ],
    });

    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));

    fireEvent.change(screen.getByLabelText("批量粘贴 Setlist 文本"), {
      target: {
        value: "＜Roselia×戸山香澄 from Poppin'Party＞\nM1. BLACK SHOUT\nM2. Requiem for Fate",
      },
    });
    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "解析预览" }));
    expect(screen.getByText("预览：2 行，提示 0 条")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("BLACK SHOUT")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "应用到表格" }));

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
    await user.click(screen.getByRole("button", { name: "解析预览" }));

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
});
