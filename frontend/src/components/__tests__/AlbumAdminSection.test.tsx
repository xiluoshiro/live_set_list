import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AlbumAdminSection } from "../console/AlbumAdminSection";
import { parseAlbumTrackText } from "../console/albumTracks";

const api = vi.hoisted(() => ({ getCatalogConsole: vi.fn(), songCatalogWrite: vi.fn(), getConsoleBands: vi.fn(), createConsoleSongsBatch: vi.fn() }));
const pageOf = (items: unknown[], page = 1, total = items.length) => ({ items, page, total, page_size: 20, total_pages: Math.max(1, Math.ceil(total / 20)) });
vi.mock("../../api", () => api);
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 27, 0, 30));
  vi.clearAllMocks();
  api.getCatalogConsole.mockImplementation(async (path: string) => ({ items: path.startsWith("/songs")
    ? [{ song_id: 1, song_name: "验证曲", version_label: "通常版", band_name: "乐队 A" }] : [] }));
});

afterEach(() => vi.useRealTimers());

// 测试点：组合标签保留乐队与成员归属，未完整识别的标签整行待回填并提示，避免误写部分归属。
test("album paste ownership requires the complete tag to resolve", () => {
  const parsed = parseAlbumTrackText("<A × 成员甲 from B>\n1. 新曲\n<A × 未知乐队>\n2. 另一曲", [
    { band_id: 1, band_name: "乐队 A", band_abbr: "A", band_members: [] },
    { band_id: 2, band_name: "乐队 B", band_abbr: "B", band_members: ["成员甲"] },
  ], [{ member_id: 7, display_name: "成员甲", revision: 1 }]);
  expect(parsed.rows[0].ownership).toEqual({ mode: "mixed", band_ids: [1], member_groups: [{ band_id: 2, member_ids: [7] }] });
  expect(parsed.rows[1].ownership).toEqual({ mode: "pending", band_ids: [], member_groups: [] });
  expect(parsed.warnings).toEqual([expect.stringContaining("A × 未知乐队")]);
});

// 测试点：批量收录复用已有版本，多版本由用户选择，只有未匹配歌曲按标签新增，最终保留输入顺序。
test("batch tracks match versions and create only missing songs using tag ownership", async () => {
  const user = userEvent.setup();
  const song = { song_id: 1, group_id: 1, song_name: "已有曲", version_label: "", band_name: "乐队 A", owner_mode: "bands" };
  api.getConsoleBands.mockResolvedValue({ items: [
    { band_id: 3, band_name: "乐队 A", band_abbr: "A", band_members: ["成员甲"] },
    { band_id: 1, band_name: "乐队 Z", band_abbr: "Z", band_members: [] },
  ] });
  api.getCatalogConsole.mockImplementation(async (path: string) => {
    if (path === "/members") return { items: [{ member_id: 7, display_name: "成员甲" }] };
    if (path.includes(encodeURIComponent("已有曲"))) return pageOf([song, { ...song, song_id: 2, version_label: "Acoustic" }]);
    if (path.includes(encodeURIComponent("新曲"))) return pageOf([]);
    return pageOf([song]);
  });
  api.createConsoleSongsBatch.mockResolvedValue({ ok: true, results: [{ index: 0, created: true, item: {
    song_id: 10, group_id: 10, song_name: "新曲", version_label: "", ownership: { mode: "members", bands: [], groups: [{ band_id: 3, band_name: "乐队 A" }] },
  } }] });
  api.songCatalogWrite.mockRejectedValue(new Error("保留专辑草稿"));
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.type(screen.getByLabelText("专辑名称"), "批量盘");
  await screen.findByRole("option", { name: "#1 已有曲 / 默认版本 / 乐队 A" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "1");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 1 曲碟号/发行版"), { target: { value: "Disc1" } });
  fireEvent.change(screen.getByLabelText("批量粘贴收录歌曲文本"), { target: { value: "<成员甲 from A>\nM1. 新曲\n<A>\nM2. 已有曲" } });
  await user.click(screen.getByRole("button", { name: "解析并查询" }));
  await screen.findByLabelText("第 2 行歌曲版本");
  expect(screen.getByRole("button", { name: "批量插入" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("第 2 行歌曲版本"), "2");
  await user.click(screen.getByRole("button", { name: "批量插入" }));
  let dialog = within(screen.getByRole("dialog", { name: "确认批量新增歌曲" }));
  expect(dialog.getByLabelText("归属模式")).toHaveValue("members");
  expect(screen.getByLabelText("专辑名称")).toBeDisabled();
  await user.click(dialog.getByRole("button", { name: "取消" }));
  expect(api.createConsoleSongsBatch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "批量插入" }));
  dialog = within(screen.getByRole("dialog", { name: "确认批量新增歌曲" }));
  const ownership = within(dialog.getByRole("row", { name: /新曲/ }));
  await user.selectOptions(ownership.getByLabelText("归属模式"), "mixed");
  await user.click(ownership.getByRole("button", { name: "选择归属乐队" }));
  await user.click(dialog.getByRole("checkbox", { name: "1 - 乐队 Z" }));
  await user.keyboard("{Escape}");
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.createConsoleSongsBatch).toHaveBeenCalledWith([{ group_name: "新曲", version_label: "", cover_urls: [],
    ownership: { mode: "mixed", band_ids: [1], member_groups: [{ band_id: 3, member_ids: [7] }] } }], "csrf");
  expect(screen.getByLabelText("批量粘贴收录歌曲文本")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认新增专辑" })).getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ tracks: [
    { song_id: 1, section_name: "Disc1", track_order: 1, edition_label: "" },
    { song_id: 10, section_name: "Disc1", track_order: 2, edition_label: "" },
    { song_id: 2, section_name: "Disc1", track_order: 3, edition_label: "" },
  ] }), "csrf");
});

// 测试点：归属候选按乐队 ID 排序；部分成功保留已建歌曲，重试只提交失败项并按原顺序追加。
test("batch track retries retain successful creations without duplicate collection", async () => {
  const user = userEvent.setup();
  api.getConsoleBands.mockResolvedValue({ items: [
    { band_id: 3, band_name: "乐队 A", band_abbr: "A", band_members: [] },
    { band_id: 1, band_name: "乐队 Z", band_abbr: "Z", band_members: [] },
  ] });
  api.getCatalogConsole.mockResolvedValue(pageOf([]));
  const saved = { song_id: 11, group_id: 11, song_name: "新曲甲", version_label: "", ownership: { mode: "bands", bands: [{ band_id: 3, band_name: "乐队 A" }], groups: [] } };
  api.createConsoleSongsBatch.mockResolvedValueOnce({ ok: false, results: [
    { index: 0, item: saved, created: true }, { index: 1, error: "暂时无法创建" },
  ] }).mockRejectedValueOnce(new Error("连接中断"))
    .mockResolvedValueOnce({ ok: true, results: [{ index: 0, item: { ...saved, song_id: 12, song_name: "新曲乙" }, created: true }] });
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  fireEvent.change(screen.getByLabelText("批量粘贴收录歌曲文本"), { target: { value: "<A>\n1. 新曲甲\n2. 新曲乙" } });
  await user.click(screen.getByRole("button", { name: "解析并查询" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "批量插入" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "批量插入" }));
  const dialog = within(screen.getByRole("dialog", { name: "确认批量新增歌曲" }));
  expect(dialog.getAllByLabelText("归属模式")[0]).toHaveValue("bands");
  await user.click(dialog.getAllByRole("button", { name: "选择归属乐队" })[0]);
  const bandOptions = within(screen.getByRole("group", { name: "归属乐队选项" })).getAllByRole("checkbox");
  expect(bandOptions[0]).toHaveAccessibleName("1 - 乐队 Z");
  expect(bandOptions[1]).toHaveAccessibleName("3 - 乐队 A");
  await user.click(dialog.getAllByRole("button", { name: "选择归属乐队" })[0]);
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("暂时无法创建");
  expect(screen.getByRole("table", { name: "专辑收录曲目" })).toHaveTextContent("暂无收录曲目");
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(dialog.getByRole("alert")).toHaveTextContent("连接中断"));
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.createConsoleSongsBatch.mock.calls[1][0]).toEqual([{ group_name: "新曲乙", version_label: "", cover_urls: [], ownership: { mode: "bands", band_ids: [3], member_groups: [] } }]);
  const trackRows = within(screen.getByRole("table", { name: "专辑收录曲目" })).getAllByRole("row");
  expect(trackRows[1]).toHaveTextContent("#11 新曲甲");
  expect(trackRows[2]).toHaveTextContent("#12 新曲乙");
});

// 测试点：管理候选和资料表显示专辑 ID，选择后保留原始名称、发行说明及未知日期。
test("album selection displays the release title without changing stored fields", async () => {
  const user = userEvent.setup();
  const album = { album_id: 1, album_name: "Yes! BanG_Dream!", release_label: "Poppin'Party 1st Single", release_date: null, album_url: null, cover_urls: [], revision: 1, tracks: [] };
  api.getCatalogConsole.mockImplementation(async (path: string) => path === "/albums/1" ? album : { items: path.startsWith("/albums") ? [album] : [] });
  render(<AlbumAdminSection variant="edit" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  const option = await screen.findByRole("option", { name: "#1 Poppin'Party 1st Single「Yes! BanG_Dream!」" });
  await user.selectOptions(screen.getByRole("combobox", { name: "已有专辑" }), option);
  expect(await screen.findByDisplayValue("Yes! BanG_Dream!")).toBeInTheDocument();
  const details = within(screen.getByRole("table", { name: "专辑资料" }));
  expect(details.getByRole("columnheader", { name: "album_id" })).toBeInTheDocument();
  expect(details.getByRole("cell", { name: "1" })).toBeInTheDocument();
  expect(screen.getByLabelText("发售日期")).toHaveValue("");
  expect(screen.getByRole("checkbox", { name: "日期未知" })).toBeChecked();
  expect(screen.getByLabelText("发行标识")).toHaveValue("Poppin'Party 1st Single");
});

// 测试点：同一专辑的碟号与发行版共用子项字段，分别从曲序 1 开始提交。
test("album child labels keep independent track numbers", async () => {
  const user = userEvent.setup();
  api.songCatalogWrite.mockRejectedValue(new Error("review"));
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.type(screen.getByLabelText("专辑名称"), "多子项专辑");
  await screen.findByRole("option", { name: "#1 验证曲 / 通常版 / 乐队 A" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "1");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 1 曲碟号/发行版"), { target: { value: "Disc1" } });
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 2 曲碟号/发行版"), { target: { value: "限定版" } });
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ tracks: [
    { song_id: 1, section_name: "Disc1", track_order: 1, edition_label: "" },
    { song_id: 1, section_name: "限定版", track_order: 1, edition_label: "" },
  ] }), "csrf");
});

// 测试点：勾选 Instrumental 仍复用原歌曲，勾选状态随曲目排序，保存失败保留草稿和错误。
test("Instrumental 复用已有歌曲，专辑日期可未知，失败保留待提交曲目", async () => {
  const user = userEvent.setup();
  api.songCatalogWrite.mockRejectedValue(new Error("资料已被修改，请重新加载后编辑"));
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "测试专辑" } });
  await user.click(screen.getByRole("checkbox", { name: "日期未知" }));
  await screen.findByRole("option", { name: "#1 验证曲 / 通常版 / 乐队 A" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "1");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  expect(within(screen.getByRole("table", { name: "专辑收录曲目" })).getByRole("columnheader", { name: "器乐" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "第 1 曲器乐" })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "第 2 曲器乐" }));
  await user.click(within(screen.getByRole("table", { name: "专辑收录曲目" })).getAllByRole("button", { name: "上移" })[1]);
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = screen.getByRole("dialog", { name: "确认新增专辑" });
  expect(screen.getByRole("checkbox", { name: "第 1 曲器乐" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已被修改"));
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(1);
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", {
    album_name: "测试专辑", release_label: "", release_date: null, album_url: null, cover_urls: [],
    tracks: [{ song_id: 1, track_order: 1, edition_label: "Instrumental", section_name: "" }, { song_id: 1, track_order: 2, edition_label: "", section_name: "" }],
  }, "csrf");
  expect(screen.getByRole("checkbox", { name: "第 1 曲器乐" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "第 2 曲器乐" })).not.toBeChecked();
});

// 测试点：仅改封面名称可确认和恢复，排序携带名称，保存失败与取消离开保留草稿。
test("cover edits are reviewed, retained on failure and restored", async () => {
  const user = userEvent.setup();
  const covers = ["https://img.example.test/a", "https://img.example.test/b", "https://img.example.test/c"].map((url, index) => ({ url, name: `封面${index + 1}` }));
  const album = { album_id: 1, album_name: "封面盘", release_label: "", release_date: null, album_url: "https://example.test/album", cover_urls: covers, revision: 3, tracks: [] };
  const otherAlbum = { ...album, album_id: 2, album_name: "另一张专辑" };
  api.getCatalogConsole.mockImplementation(async (path: string) => path === "/albums/1" ? album : path === "/albums/2" ? otherAlbum : { items: path.startsWith("/albums") ? [album, otherAlbum] : [] });
  api.songCatalogWrite.mockRejectedValue(new Error("资料已被修改"));
  render(<AlbumAdminSection variant="edit" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.selectOptions(screen.getByLabelText("已有专辑"), await screen.findByRole("option", { name: "#1 封面盘" }));
  await screen.findByDisplayValue(covers[0].url);
  fireEvent.change(screen.getByLabelText("第 1 张封面名称"), { target: { value: "通常盤" } });
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(within(screen.getByRole("dialog")).getByRole("table")).toHaveTextContent("通常盤");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(screen.getByLabelText("第 1 张封面名称")).toHaveValue(covers[0].name);
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  const table = screen.getByRole("table", { name: "专辑封面" });
  await user.click(within(table).getAllByRole("button", { name: "设为默认" })[1]);
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(covers[2].url);
  expect(screen.getByLabelText("第 1 张封面名称")).toHaveValue(covers[2].name);
  await user.click(within(table).getAllByRole("button", { name: "下移" })[0]);
  await user.click(within(table).getAllByRole("button", { name: "上移" })[2]);
  await user.click(within(table).getAllByRole("button", { name: "移除" })[2]);
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(covers[0].url);
  expect(screen.getByLabelText("第 2 张封面 URL")).toHaveValue(covers[1].url);
  await user.clear(screen.getByLabelText("专辑页面"));
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("已有专辑"), "2");
  const leaveDialog = screen.getByRole("dialog", { name: "未保存的修改" });
  expect(leaveDialog).toHaveAccessibleDescription("专辑 #1 有未保存修改。离开后将丢弃这些修改。");
  await user.keyboard("{Escape}");
  expect(screen.getByLabelText("已有专辑")).toHaveValue("1");
  expect(screen.getByLabelText("第 2 张封面 URL")).toHaveValue(covers[1].url);
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  const dialog = screen.getByRole("dialog", { name: /确认更新专辑 #/ });
  expect(within(dialog).getByRole("table", { name: "专辑修改内容 · 封面" })).toHaveTextContent(covers[2].url);
  expect(screen.getByLabelText("第 1 张封面 URL")).toBeDisabled();
  expect(screen.getByLabelText("第 1 张封面名称")).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已被修改"));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums/1", "PUT", expect.objectContaining({ album_url: null, cover_urls: covers.slice(0, 2), expected_revision: 3 }), "csrf");
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(screen.getByLabelText("专辑页面")).toHaveValue(album.album_url);
  expect(screen.getByLabelText("第 3 张封面 URL")).toHaveValue(covers[2].url);
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  // 确认放弃后必须加载刚选中的专辑，不能读取已被受控下拉框恢复的旧值。
  await user.clear(screen.getByLabelText("专辑名称"));
  await user.selectOptions(screen.getByLabelText("已有专辑"), "2");
  await user.click(within(screen.getByRole("dialog", { name: "未保存的修改" })).getByRole("button", { name: "放弃修改" }));
  await waitFor(() => expect(screen.getByLabelText("专辑名称")).toHaveValue("另一张专辑"));
  expect(api.getCatalogConsole).toHaveBeenCalledWith("/albums/2");
});

// 测试点：无效或重复封面阻止确认；修正坏图链接后可以预览并保存，不依赖图片可达性。
test("cover validation and preview recovery", async () => {
  const user = userEvent.setup();
  const url = "https://img.example.test/cover?id=1";
  api.songCatalogWrite.mockResolvedValue({ album_id: 1, album_name: "盘", release_label: "", release_date: null, album_url: null, cover_urls: [{ url, name: "" }], revision: 1, tracks: [] });
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "盘" } });
  fireEvent.change(screen.getByLabelText("第 1 张封面 URL"), { target: { value: "http://img.example.test/cover" } });
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  expect(screen.getByRole("alert")).toHaveTextContent("第 1 张封面");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("第 1 张封面 URL"), { target: { value: "https://img.example.test/broken" } });
  fireEvent.error(screen.getByRole("img", { name: "封面 1 预览" }));
  expect(screen.getByRole("status")).toHaveTextContent("封面无法显示");
  fireEvent.change(screen.getByLabelText("第 1 张封面 URL"), { target: { value: url } });
  expect(screen.getByRole("img", { name: "封面 1 预览" })).toHaveAttribute("src", url);
  await user.click(screen.getByRole("button", { name: "添加封面" }));
  fireEvent.change(screen.getByLabelText("第 2 张封面 URL"), { target: { value: ` ${url} ` } });
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  expect(screen.getByRole("alert")).toHaveTextContent("第 2 张封面 URL 重复");
  await user.click(within(screen.getByRole("table", { name: "专辑封面" })).getAllByRole("button", { name: "移除" })[1]);
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ cover_urls: [{ url, name: "" }], album_url: null }), "csrf");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  expect(screen.getByLabelText("专辑名称")).toHaveValue("");
  expect(screen.getByRole("status")).toHaveTextContent("已新增专辑 #1 盘");
});

// 测试点：已知日期必须填写；新增成功后留在新增流程，保留草稿连续提交始终使用 POST。
test("creation retains its mode and release date when keeping the draft", async () => {
  const user = userEvent.setup();
  api.songCatalogWrite.mockResolvedValue({ album_id: 9, album_name: "发行盘", release_label: "", release_date: "2026-09-27", album_url: null, cover_urls: [], revision: 1, tracks: [] });
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.type(screen.getByLabelText("专辑名称"), "发行盘");
  expect(screen.getByLabelText("发售日期")).toHaveValue("2026-09-27");
  expect(screen.getByRole("checkbox", { name: "日期未知" })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "日期未知" }));
  await user.click(screen.getByRole("checkbox", { name: "日期未知" }));
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("发售日期"), { target: { value: "2026-09-27" } });
  expect(screen.getByRole("checkbox", { name: "日期未知" })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "新增后清空数据" }));
  for (let index = 0; index < 2; index += 1) {
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    const dialog = screen.getByRole("dialog", { name: "确认新增专辑" });
    expect(within(dialog).getByRole("row", { name: "日期 2026-09-27" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(2);
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/albums", "POST", {
    album_name: "发行盘", release_label: "", release_date: "2026-09-27", album_url: null, cover_urls: [], tracks: [],
  }, "csrf");
  expect(screen.getByLabelText("专辑名称")).toHaveValue("发行盘");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled();
});

// 测试点：新增默认使用本地当天，清空及成功后的重置重新取当天，未知日期仍可显式提交。
test("album creation defaults and resets to the current local date", async () => {
  const user = userEvent.setup();
  api.songCatalogWrite.mockResolvedValue({ album_id: 1, album_name: "日期核对", release_label: "", release_date: null, album_url: null, cover_urls: [], revision: 1, tracks: [] });
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  expect(screen.getByLabelText("发售日期")).toHaveValue("2026-09-27");
  expect(screen.getByRole("checkbox", { name: "日期未知" })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("发售日期"), { target: { value: "2025-01-02" } });
  vi.setSystemTime(new Date(2026, 8, 28, 0, 30));
  await user.click(screen.getByRole("button", { name: "清空数据" }));
  expect(screen.getByLabelText("发售日期")).toHaveValue("2026-09-28");
  await user.type(screen.getByLabelText("专辑名称"), "日期核对");
  await user.click(screen.getByRole("checkbox", { name: "日期未知" }));
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  await screen.findByText("已新增专辑 #1 日期核对");
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ release_date: null }), "csrf");
  expect(screen.getByLabelText("发售日期")).toHaveValue("2026-09-28");
  expect(screen.getByRole("checkbox", { name: "日期未知" })).not.toBeChecked();
});

// 测试点：查询按钮及回车加载完整候选，包含接口后续页，输入过程不查询且已收录曲目保留。
test("album song lookup loads all matching candidates on explicit query", async () => {
  const user = userEvent.setup();
  api.getCatalogConsole.mockImplementation(async (path: string) => {
    const params = new URL(path, "http://test").searchParams;
    const page = Number(params.get("page"));
    return { items: [{ song_id: page === 1 ? 1 : 101, song_name: page === 1 ? "首页曲" : "后页曲", version_label: "", band_name: "乐队" }],
      page, page_size: 100, total: 101, total_pages: 2 };
  });
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  await screen.findByRole("option", { name: "#101 后页曲 / 默认版本 / 乐队" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "101");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  expect(screen.getByRole("table", { name: "专辑收录曲目" })).toHaveTextContent("后页曲");
  api.getCatalogConsole.mockClear();
  await user.type(screen.getByLabelText("搜索收录歌曲"), "曲");
  expect(api.getCatalogConsole).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "查询" }));
  await screen.findByRole("option", { name: "#101 后页曲 / 默认版本 / 乐队" });
  expect(api.getCatalogConsole).toHaveBeenCalledWith("/songs?q=%E6%9B%B2&page=1&limit=100");
  expect(api.getCatalogConsole).toHaveBeenCalledWith("/songs?q=%E6%9B%B2&page=2&limit=100");
  await user.type(screen.getByLabelText("搜索收录歌曲"), "名{Enter}");
  await screen.findByRole("option", { name: "#101 后页曲 / 默认版本 / 乐队" });
  expect(api.getCatalogConsole).toHaveBeenCalledWith("/songs?q=%E6%9B%B2%E5%90%8D&page=1&limit=100");
  expect(screen.getByRole("table", { name: "专辑收录曲目" })).toHaveTextContent("后页曲");
});

// 测试点：全空封面行不提交，但只填名称必须补充 URL；删除后仍可添加并提交无封面专辑。
test("cover rows start ready to edit and can be removed and re-added", async () => {
  const user = userEvent.setup();
  api.songCatalogWrite.mockResolvedValue({ album_id: 1, album_name: "无封面盘", release_label: "", release_date: null, album_url: null, cover_urls: [], revision: 1, tracks: [] });
  render(<AlbumAdminSection variant="create" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  const table = screen.getByRole("table", { name: "专辑封面" });
  expect(within(table).getByLabelText("第 1 张封面 URL")).toHaveValue("");
  await user.click(within(table).getByRole("button", { name: "移除" }));
  expect(table).toHaveTextContent("暂无专辑封面");
  await user.click(screen.getByRole("button", { name: "添加封面" }));
  expect(within(table).getByLabelText("第 1 张封面 URL")).toHaveValue("");
  await user.type(screen.getByLabelText("专辑名称"), "无封面盘");
  await user.type(screen.getByLabelText("第 1 张封面名称"), "通常盤");
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  expect(screen.getByRole("alert")).toHaveTextContent("第 1 张封面须为有效的 HTTPS URL");
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("第 1 张封面名称"));
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  await screen.findByText("已新增专辑 #1 无封面盘");
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ cover_urls: [] }), "csrf");
  expect(within(table).getByLabelText("第 1 张封面 URL")).toHaveValue("");
});

// 测试点：空条件不自动选中，有条件查询编辑首项且保护草稿，翻页与空结果保留编辑对象。
test("album queries select the first match while paging and empty results preserve the draft", async () => {
  const user = userEvent.setup();
  const first = { album_id: 1, album_name: "首页专辑", release_label: "", release_date: null, album_url: null, cover_urls: [], revision: 1, tracks: [] };
  const second = { ...first, album_id: 21, album_name: "后页专辑" };
  api.getCatalogConsole.mockImplementation(async (path: string) => {
    if (path === "/albums/1") return first;
    if (path === "/albums/21") return second;
    if (path.startsWith("/songs")) return pageOf([]);
    const params = new URL(path, "http://test").searchParams;
    if (params.get("q") === "没有结果") return pageOf([]);
    const page = Number(params.get("page"));
    return pageOf([page === 1 ? first : second], page, 21);
  });
  render(<AlbumAdminSection variant="edit" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  const search = within(screen.getByRole("search", { name: "查询专辑" }));
  await search.findByRole("option", { name: "#1 首页专辑" });
  expect(search.getByLabelText("已有专辑")).toHaveValue("");
  expect(screen.queryByLabelText("专辑名称")).not.toBeInTheDocument();
  await user.type(search.getByLabelText("搜索专辑"), "   {Enter}");
  await waitFor(() => expect(search.getByLabelText("已有专辑")).toBeEnabled());
  expect(search.getByLabelText("已有专辑")).toHaveValue("");
  await user.clear(search.getByLabelText("搜索专辑"));
  await user.type(search.getByLabelText("搜索专辑"), "首页{Enter}");
  await waitFor(() => expect(screen.getByLabelText("专辑名称")).toHaveValue("首页专辑"));
  expect(search.getByLabelText("已有专辑")).toHaveValue("1");
  await user.click(search.getByRole("button", { name: "下一页" }));
  await search.findByText("第 2 / 2 页，共 21 条");
  await user.selectOptions(search.getByLabelText("已有专辑"), "21");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "专辑名称" })).toHaveValue("后页专辑"));
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "待保存资料" } });
  await user.click(search.getByRole("button", { name: "上一页" }));
  await search.findByText("第 1 / 2 页，共 21 条");
  expect(search.getByLabelText("已有专辑")).toHaveValue("21");
  expect(screen.getByLabelText("专辑名称")).toHaveValue("待保存资料");
  await user.clear(search.getByLabelText("搜索专辑"));
  await user.type(search.getByLabelText("搜索专辑"), "没有结果{Enter}");
  await screen.findByText("没有匹配的专辑。");
  expect(api.getCatalogConsole).toHaveBeenCalledWith("/albums?q=%E6%B2%A1%E6%9C%89%E7%BB%93%E6%9E%9C&page=1&limit=20");
  expect(screen.getByLabelText("专辑名称")).toHaveValue("待保存资料");
  expect(search.getByLabelText("已有专辑")).toHaveValue("21");
  await user.clear(search.getByLabelText("搜索专辑"));
  await user.click(search.getByRole("button", { name: "查询" }));
  await search.findByRole("option", { name: "#1 首页专辑" });
  expect(search.getByRole("option", { name: "#21 后页专辑" })).toBeInTheDocument();
  expect(search.getByLabelText("已有专辑")).toHaveValue("21");
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.type(search.getByLabelText("搜索专辑"), "首页{Enter}");
  let dialog = within(await screen.findByRole("dialog", { name: "未保存的修改" }));
  await user.click(dialog.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("专辑名称")).toHaveValue("待保存资料");
  expect(search.getByLabelText("已有专辑")).toHaveValue("21");
  await user.click(search.getByRole("button", { name: "查询" }));
  dialog = within(await screen.findByRole("dialog", { name: "未保存的修改" }));
  await user.click(dialog.getByRole("button", { name: "放弃修改" }));
  await waitFor(() => expect(screen.getByLabelText("专辑名称")).toHaveValue("首页专辑"));
  expect(search.getByLabelText("已有专辑")).toHaveValue("1");
  await user.click(search.getByRole("button", { name: "下一页" }));
  await search.findByRole("option", { name: "#21 后页专辑" });
  await user.selectOptions(search.getByLabelText("已有专辑"), "21");
  await waitFor(() => expect(screen.getByLabelText("专辑名称")).toHaveValue("后页专辑"));
  await user.type(search.getByLabelText("搜索专辑"), "{Enter}");
  await waitFor(() => expect(screen.getByLabelText("专辑名称")).toHaveValue("首页专辑"));
  expect(search.getByLabelText("已有专辑")).toHaveValue("1");
});

// 测试点：首次加载禁用候选，查询失败可重试，空结果和失败状态互不混淆。
test("album lookup recovers from loading and failure", async () => {
  const user = userEvent.setup();
  let rejectLookup!: (reason: Error) => void;
  api.getCatalogConsole.mockImplementation((path: string) => path.startsWith("/albums?")
    ? new Promise((_, reject) => { rejectLookup = reject; }) : Promise.resolve({ items: [] }));
  render(<AlbumAdminSection variant="edit" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  expect(screen.getByText("加载中…")).toBeInTheDocument();
  expect(screen.getByLabelText("已有专辑")).toBeDisabled();
  rejectLookup(new Error("查询暂时失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("查询暂时失败");
  api.getCatalogConsole.mockResolvedValue(pageOf([]));
  await user.click(screen.getByRole("button", { name: "查询" }));
  await screen.findByText("没有匹配的专辑。");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  expect(screen.getByRole("table", { name: "专辑操作记录" })).toHaveTextContent("暂无专辑更新记录");
});

// 测试点：编辑与恢复保留版本标识，确认仅列变化曲目，列表刷新失败不误报保存失败。
test("version labels survive editing and successful updates are recorded", async () => {
  const user = userEvent.setup();
  const album = { album_id: 1, album_name: "版本盘", release_label: "", release_date: null, album_url: null, cover_urls: [], revision: 1,
    tracks: [
      { album_track_id: 1, song_id: 1, song_name: "同名曲", version_label: "通常版", band_name: "乐队 A", group_id: 1, section_name: "Disc 1", track_order: 1, edition_label: "Instrumental" },
      { album_track_id: 2, song_id: 2, song_name: "同名曲", version_label: "Acoustic", band_name: "乐队 B", group_id: 1, section_name: "Disc 1", track_order: 2, edition_label: "" },
    ] };
  let listLoads = 0;
  api.getCatalogConsole.mockImplementation(async (path: string) => {
    if (path === "/albums/1") return album;
    if (path.startsWith("/albums?")) {
      if (++listLoads > 1) throw new Error("候选刷新失败");
      return pageOf([album]);
    }
    return pageOf([]);
  });
  api.songCatalogWrite.mockResolvedValue({ ...album, album_name: "更新后的盘", revision: 2, tracks: album.tracks.map(track => ({ ...track, edition_label: "" })) });
  render(<AlbumAdminSection variant="edit" active registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.selectOptions(screen.getByLabelText("已有专辑"), await screen.findByRole("option", { name: "#1 版本盘" }));
  const tracks = await screen.findByRole("table", { name: "专辑收录曲目" });
  expect(tracks).toHaveTextContent("同名曲 / 通常版 / 乐队 A");
  expect(tracks).toHaveTextContent("同名曲 / Acoustic / 乐队 B");
  const instrumental = screen.getByRole("checkbox", { name: "第 1 曲器乐" });
  expect(instrumental).toBeChecked();
  await user.click(instrumental);
  expect(instrumental).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(instrumental).toBeChecked();
  await user.click(instrumental);
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "更新后的盘" } });
  expect(screen.getByText("专辑 #1 有未保存修改")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  const dialog = screen.getByRole("dialog", { name: /确认更新专辑 #/ });
  const changedTracks = within(dialog).getByRole("table", { name: "专辑修改内容 · 曲目" });
  expect(changedTracks).toHaveTextContent("Instrumental");
  expect(within(changedTracks).queryByRole("rowheader", { name: "2" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: /^(确认提交|确认更新)$/ }));
  await screen.findByText("已更新专辑 #1 更新后的盘");
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums/1", "PUT", expect.objectContaining({ expected_revision: 1, tracks: [
    { album_track_id: 1, song_id: 1, track_order: 1, edition_label: "", section_name: "Disc 1" },
    { album_track_id: 2, song_id: 2, track_order: 2, edition_label: "", section_name: "Disc 1" },
  ] }), "csrf");
  expect(instrumental).not.toBeChecked();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("专辑 #1 有未保存修改")).not.toBeInTheDocument();
  const history = within(screen.getByRole("table", { name: "专辑操作记录" }));
  expect(history.getByRole("cell", { name: "更新后的盘" })).toBeInTheDocument();
  expect(history.getByRole("cell", { name: "2" })).toBeInTheDocument();
  expect(history.getByRole("button", { name: "编辑" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("专辑查询失败");
});
