import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AlbumAdminSection } from "../console/AlbumAdminSection";

const api = vi.hoisted(() => ({ getCatalogConsole: vi.fn(), songCatalogWrite: vi.fn() }));
vi.mock("../../api", () => api);
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getCatalogConsole.mockImplementation(async (path: string) => ({ items: path.startsWith("/songs")
    ? [{ song_id: 1, song_name: "验证曲", version_label: "通常版", band_name: "乐队 A" }] : [] }));
});

// 测试点：管理候选使用完整发行标题，选择后仍分别编辑原始名称和发行说明。
test("album selection displays the release title without changing stored fields", async () => {
  const user = userEvent.setup();
  const album = { album_id: 1, album_name: "Yes! BanG_Dream!", release_label: "Poppin'Party 1st Single", release_date: null, album_url: null, cover_urls: [], revision: 1, tracks: [] };
  api.getCatalogConsole.mockImplementation(async (path: string) => path === "/albums/1" ? album : { items: path.startsWith("/albums") ? [album] : [] });
  render(<AlbumAdminSection />);
  const option = await screen.findByRole("option", { name: "Poppin'Party 1st Single「Yes! BanG_Dream!」" });
  await user.selectOptions(screen.getByRole("combobox", { name: "已有专辑" }), option);
  expect(await screen.findByDisplayValue("Yes! BanG_Dream!")).toBeInTheDocument();
  expect(screen.getByLabelText("发行标识")).toHaveValue("Poppin'Party 1st Single");
});

// 测试点：同一专辑的碟号与发行版共用子项字段，分别从曲序 1 开始提交。
test("album child labels keep independent track numbers", async () => {
  const user = userEvent.setup();
  api.songCatalogWrite.mockRejectedValue(new Error("review"));
  render(<AlbumAdminSection />);
  await user.type(screen.getByLabelText("专辑名称"), "多子项专辑");
  await screen.findByRole("option", { name: "#1 验证曲 / 通常版 / 乐队 A" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "1");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 1 曲碟号／发行版"), { target: { value: "Disc1" } });
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 2 曲碟号／发行版"), { target: { value: "限定版" } });
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ tracks: [
    { song_id: 1, section_name: "Disc1", track_order: 1, edition_label: "" },
    { song_id: 1, section_name: "限定版", track_order: 1, edition_label: "" },
  ] }), "csrf");
});

test("Instrumental 复用已有歌曲，专辑日期可未知，失败保留待提交曲目", async () => {
  // 测试点：同歌曲两条收录可排序；不创建新 song_id；保存失败仍显示确认内容与错误。
  const user = userEvent.setup();
  api.songCatalogWrite.mockRejectedValue(new Error("资料已被修改，请重新加载后编辑"));
  render(<AlbumAdminSection />);
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "测试专辑" } });
  await screen.findByRole("option", { name: "#1 验证曲 / 通常版 / 乐队 A" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "1");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 2 曲收录标识"), { target: { value: "Instrumental" } });
  await user.click(screen.getAllByRole("button", { name: "上移" })[1]);
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = screen.getByRole("dialog", { name: "确认保存专辑" });
  expect(screen.getByLabelText("第 1 曲收录标识")).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "确认" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已被修改"));
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(1);
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", {
    album_name: "测试专辑", release_label: "", release_date: null, album_url: null, cover_urls: [],
    tracks: [{ song_id: 1, track_order: 1, edition_label: "Instrumental", section_name: "" }, { song_id: 1, track_order: 2, edition_label: "", section_name: "" }],
  }, "csrf");
  expect(screen.getByLabelText("第 1 曲收录标识")).toHaveValue("Instrumental");
});

// 测试点：封面默认项、排序和移除仅改草稿，确认提交有序数组；失败、放弃取消及恢复均保留正确资料。
test("cover edits are reviewed, retained on failure and restored", async () => {
  const user = userEvent.setup();
  const covers = ["https://img.example.test/a", "https://img.example.test/b", "https://img.example.test/c"];
  const album = { album_id: 1, album_name: "封面盘", release_label: "", release_date: null, album_url: "https://example.test/album", cover_urls: covers, revision: 3, tracks: [] };
  api.getCatalogConsole.mockImplementation(async (path: string) => path === "/albums/1" ? album : { items: path.startsWith("/albums") ? [album] : [] });
  api.songCatalogWrite.mockRejectedValue(new Error("资料已被修改"));
  render(<AlbumAdminSection />);
  await user.selectOptions(screen.getByLabelText("已有专辑"), await screen.findByRole("option", { name: "封面盘" }));
  await screen.findByDisplayValue(covers[0]);
  const table = screen.getByRole("table", { name: "专辑封面" });
  await user.click(within(table).getAllByRole("button", { name: "设为默认" })[1]);
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(covers[2]);
  await user.click(within(table).getAllByRole("button", { name: "下移" })[0]);
  await user.click(within(table).getAllByRole("button", { name: "上移" })[2]);
  await user.click(within(table).getAllByRole("button", { name: "移除" })[2]);
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(covers[0]);
  expect(screen.getByLabelText("第 2 张封面 URL")).toHaveValue(covers[1]);
  await user.clear(screen.getByLabelText("专辑页面"));
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "新建专辑" }));
  await user.click(within(screen.getByRole("dialog", { name: "放弃专辑修改" })).getByRole("button", { name: "取消" }));
  expect(screen.getByLabelText("第 2 张封面 URL")).toHaveValue(covers[1]);
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  const dialog = screen.getByRole("dialog", { name: "确认保存专辑" });
  expect(within(dialog).getByRole("table")).toHaveTextContent(`1（默认）. ${covers[0]}`);
  expect(screen.getByLabelText("第 1 张封面 URL")).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "确认" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已被修改"));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums/1", "PUT", expect.objectContaining({ album_url: null, cover_urls: covers.slice(0, 2), expected_revision: 3 }), "csrf");
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(screen.getByLabelText("专辑页面")).toHaveValue(album.album_url);
  expect(screen.getByLabelText("第 3 张封面 URL")).toHaveValue(covers[2]);
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
});

// 测试点：空白或重复封面阻止确认；修正坏图链接后可以预览并保存，不依赖图片可达性。
test("cover validation and preview recovery", async () => {
  const user = userEvent.setup();
  const url = "https://img.example.test/cover?id=1";
  api.songCatalogWrite.mockResolvedValue({ album_id: 1, album_name: "盘", release_label: "", release_date: null, album_url: null, cover_urls: [url], revision: 1, tracks: [] });
  render(<AlbumAdminSection />);
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "盘" } });
  await user.click(screen.getByRole("button", { name: "添加封面" }));
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
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", expect.objectContaining({ cover_urls: [url], album_url: null }), "csrf");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
});
