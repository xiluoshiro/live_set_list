import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SongCatalog } from "../SongCatalog";
import { SongCatalogAdmin } from "../console/SongCatalogAdmin";
import type { SongVersion } from "../../api";

const api = vi.hoisted(() => ({ getSongGroups: vi.fn(), getSongGroup: vi.fn(), getSongVersion: vi.fn(),
  getSongPerformances: vi.fn(), getAlbumDetail: vi.fn(), getCatalogConsole: vi.fn(), songCatalogWrite: vi.fn() }));
vi.mock("../../api", () => ({ ...api, SONG_CATALOG_CHANGE: "song-catalog-change" }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

const version = (id = 1, count = 2): SongVersion => ({ song_id: id, song_name: "合唱曲", group_id: 1, group_name: "合唱曲",
  version_label: id === 1 ? "普通版" : "合唱版", version_order: id, revision: 1, legacy_cover: false, cover_urls: [], display_cover: null,
  ownership: { mode: "bands", band_ids: [1], member_groups: [], bands: [{ band_id: 1, band_name: "乐队甲" }], groups: [] },
  performance_count: count, albums: [{ album_id: 1, album_name: "收录盘", release_label: "special disc", release_date: null, album_url: null, cover_urls: [], revision: 1 }] });
const page = <T,>(items: T[], index = 1, pages = 1) => ({ items, page: index, page_size: 30, total: items.length, total_pages: pages });
function PublicPage() {
  const [target, setTarget] = useState({ songId: 1, albumId: null as number | null });
  const history = useRef<typeof target[]>([]);
  const navigate = (next: typeof target) => { history.current.push(target); setTarget(next); };
  return <SongCatalog {...target} onSongSelect={songId => navigate({ songId, albumId: null })}
    onAlbumSelect={albumId => navigate({ ...target, albumId })} onLiveSelect={vi.fn()}
    onBack={() => { const previous = history.current.pop(); if (previous) setTarget(previous); }} backLabel="返回" />;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  api.getSongGroups.mockResolvedValue({ ...page([{ group_id: 1, group_name: "合唱曲", version_count: 2,
    matched_song_ids: [1, 2], first_release_date: null, first_release_albums: [], performance_count: 2,
    latest_performance_date: null, display_cover: null }]), facets: { total: 1, bands: [{ band_id: 1, band_name: "乐队甲", song_count: 1 }] } });
  api.getSongGroup.mockResolvedValue({ group_id: 1, group_name: "合唱曲", revision: 1, versions: [version(), version(2)], display_cover: null });
  api.getSongVersion.mockImplementation((id: number) => Promise.resolve(version(id)));
  api.getSongPerformances.mockResolvedValue({ ...page([{ setlist_id: "row-1", live_id: 1, live_title: "Live 1", live_date: "2026-01-01", segment_type: "M", sub_order: 1, absolute_order: 1, is_short: true, live_cover: "original" }]), available_years: [2026] });
  api.getCatalogConsole.mockImplementation((path: string) => Promise.resolve(path === "/members" ? { items: [] } : path === "/songs/1" ? version() : page([{ song_id: 1, song_name: "合唱曲", band_id: null, band_name: "乐队甲", version_label: "普通版" }])));
  api.songCatalogWrite.mockResolvedValue({ item: version() });
});

// 测试点：全部收录展示当前版本所有唱片，Escape 关闭后恢复焦点，选中唱片仍进入完整详情。
test("all releases dialog restores focus and opens the selected album", async () => {
  const user = userEvent.setup();
  const albums = Array.from({ length: 5 }, (_, index) => ({ ...version().albums[0], album_id: index + 1, album_name: `唱片 ${index + 1}` }));
  api.getSongVersion.mockResolvedValue({ ...version(), albums });
  api.getAlbumDetail.mockResolvedValue({ ...albums[4], tracks: [] });
  render(<PublicPage />);
  const trigger = await screen.findByRole("button", { name: "全部收录" });
  await user.click(trigger);
  let dialog = within(screen.getByRole("dialog", { name: "收录唱片 5" }));
  expect(dialog.getAllByRole("link", { name: /^查看唱片 / })).toHaveLength(5);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  dialog = within(screen.getByRole("dialog", { name: "收录唱片 5" }));
  await user.click(dialog.getByRole("link", { name: "查看唱片 唱片 5" }));
  expect(await screen.findByRole("heading", { name: "唱片 5", level: 1 })).toBeInTheDocument();
  expect(api.getAlbumDetail).toHaveBeenLastCalledWith(5);
});

// 测试点：少量演出记录页可直接跳到中间任意页，年份筛选后返回有效的第一页。
test("detail pagination exposes every page for a short result set", async () => {
  const user = userEvent.setup();
  api.getSongPerformances.mockImplementation(async (_id, index, options) => ({
    items: [], page: index, page_size: 8, total: options.year ? 0 : 48,
    total_pages: options.year ? 1 : 6, available_years: [2026],
  }));
  render(<PublicPage />);
  const pager = within(await screen.findByRole("navigation", { name: "演出记录分页" }));
  expect(pager.getAllByRole("button", { name: /^第 \d+ 页$/ })).toHaveLength(6);
  await user.click(pager.getByRole("button", { name: "第 4 页" }));
  await waitFor(() => expect(api.getSongPerformances).toHaveBeenLastCalledWith(1, 4, { year: undefined, pageSize: 8 }));
  await user.selectOptions(screen.getByRole("combobox", { name: "演出年份" }), "2026");
  expect(await screen.findByText("暂无演奏记录")).toBeInTheDocument();
  expect(api.getSongPerformances).toHaveBeenLastCalledWith(1, 1, { year: 2026, pageSize: 8 });
});

// 测试点：版本自有多图优先且可切换，版本切换重置首图，专辑回退有来源链接，无图使用占位。
test("version covers switch independently and reset on version navigation", async () => {
  const user = userEvent.setup();
  const urls = ["https://example.test/front.png", "https://example.test/back.png"].map((url, index) => ({ url, name: `封面${index + 1}` }));
  api.getSongVersion.mockImplementation(async (id: number) => id === 1
    ? { ...version(id), cover_urls: urls, display_cover: { source: "song", ...urls[0] } }
    : { ...version(id), display_cover: { source: "album", url: "https://example.test/album.png", name: "", album_id: 8, album_name: "回退专辑" } });
  render(<PublicPage />);
  let gallery = within(await screen.findByRole("group", { name: "歌曲封面" }));
  expect(gallery.getByRole("img")).toHaveAttribute("src", urls[0].url);
  expect(gallery.queryByRole("link")).not.toBeInTheDocument();
  await user.click(gallery.getByRole("button", { name: "下一张" }));
  expect(gallery.getByRole("img")).toHaveAttribute("src", urls[1].url);
  fireEvent.error(gallery.getByRole("img"));
  expect(gallery.getByRole("status")).toHaveTextContent("封面无法显示");
  await user.click(gallery.getByRole("button", { name: "上一张" }));
  expect(gallery.getByRole("img")).toHaveAttribute("src", urls[0].url);
  await user.click(screen.getByRole("button", { name: "合唱版" }));
  const albumCover = await screen.findByRole("img", { name: "歌曲展示封面，选自《回退专辑》" });
  expect(albumCover.closest("a")).toHaveAttribute("href", expect.stringContaining("/albums/8"));
  await user.click(screen.getByRole("button", { name: "普通版" }));
  gallery = within(await screen.findByRole("group", { name: "歌曲封面" }));
  expect(gallery.getByRole("img")).toHaveAttribute("src", urls[0].url);
  api.getSongVersion.mockResolvedValue(version(2));
  await user.click(screen.getByRole("button", { name: "合唱版" }));
  expect(await screen.findByRole("img", { name: "合唱曲，暂无封面" })).toBeInTheDocument();
});

// 测试点：名称修改和默认顺序修改均需确认，排序保留名称，失败、恢复及清空维持完整封面草稿。
test("song cover editor saves ordering and protects the draft", async () => {
  const user = userEvent.setup();
  const urls = ["https://example.test/a.png", "https://example.test/b.png"].map((url, index) => ({ url, name: `封面${index + 1}` }));
  const song = { ...version(), cover_urls: urls };
  api.getCatalogConsole.mockImplementation(async (path: string) => path === "/songs/1" ? song : path === "/members" ? { items: [] } : page([song]));
  let leave: ((next: () => void) => void) | null = null;
  render(<SongCatalogAdmin variant="edit" active bands={[]} registerLeaveGuard={guard => { leave = guard; }} onManage={() => {}} />);
  await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "1");
  await screen.findByDisplayValue(urls[0].url);
  fireEvent.change(screen.getByLabelText("第 1 张封面名称"), { target: { value: "通常盤" } });
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(within(screen.getByRole("dialog")).getByRole("table")).toHaveTextContent("通常盤");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(screen.getByLabelText("第 1 张封面名称")).toHaveValue(urls[0].name);
  await user.click(screen.getByRole("button", { name: "设为默认" }));
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(urls[1].url);
  expect(screen.getByLabelText("第 1 张封面名称")).toHaveValue(urls[1].name);
  const next = vi.fn();
  act(() => leave?.(next));
  await user.click(within(screen.getByRole("dialog", { name: "确认放弃歌曲修改" })).getByRole("button", { name: "取消" }));
  expect(next).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  const dialog = within(screen.getByRole("dialog", { name: "确认修改歌曲" }));
  expect(dialog.getByRole("table")).toHaveTextContent("封面");
  expect(dialog.getByRole("table")).toHaveTextContent(`1（默认）. ${urls[1].name} · ${urls[1].url}`);
  api.songCatalogWrite.mockRejectedValueOnce(new Error("保存失败"));
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("保存失败");
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(urls[1].url);
  api.songCatalogWrite.mockResolvedValueOnce({ item: { ...song, cover_urls: [...urls].reverse(), revision: 2 } });
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/songs/1/edit", "PUT", expect.objectContaining({ cover_urls: [...urls].reverse(), expected_revision: 1 }), "csrf");
  await user.click(screen.getAllByRole("button", { name: "移除" })[0]);
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(urls[0].url);
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(screen.getByLabelText("第 1 张封面 URL")).toHaveValue(urls[1].url);
  await user.click(screen.getAllByRole("button", { name: "移除" })[0]);
  await user.click(screen.getByRole("button", { name: "移除" }));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/songs/1/edit", "PUT", expect.objectContaining({ cover_urls: [], expected_revision: 2 }), "csrf");
});

// 测试点：新增歌曲拦截非法封面，修正后支持命名与未命名封面混合提交。
test("new song cover validation and creation", async () => {
  const user = userEvent.setup();
  render(<SongCatalogAdmin variant="create" active bands={[]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.type(screen.getByLabelText("歌曲名称"), "新曲");
  await user.click(screen.getByRole("button", { name: "添加封面" }));
  await user.type(screen.getByLabelText("第 1 张封面 URL"), "http://example.test/a.png");
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  expect(screen.getByRole("alert")).toHaveTextContent("第 1 张封面须为有效的 HTTPS URL");
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("第 1 张封面 URL"));
  await user.type(screen.getByLabelText("第 1 张封面 URL"), "https://example.test/a.png");
  await user.type(screen.getByLabelText("第 1 张封面名称"), " 正面 ");
  await user.click(screen.getByRole("button", { name: "添加封面" }));
  await user.type(screen.getByLabelText("第 2 张封面 URL"), "https://example.test/b.png");
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("table")).toHaveTextContent("https://example.test/b.png");
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/song-groups", "POST", expect.objectContaining({ cover_urls: [{ url: "https://example.test/a.png", name: "正面" }, { url: "https://example.test/b.png", name: "" }] }), "csrf");
});

// 测试点：歌曲的唱片链接进入独立页，名称及发行说明完整保留，空说明不制造额外标题。
test.each([
  ["劇場版「BanG Dream! Episode of Roselia」Theme Songs Collection", "", "劇場版「BanG Dream! Episode of Roselia」Theme Songs Collection"],
  ["Yes! BanG_Dream!", "Poppin'Party 1st Single", "Poppin'Party 1st Single「Yes! BanG_Dream!」"],
  ["ピコっと！パピっと！！ガルパ☆ピコ！！！", "香澄×蘭×彩×友希那×こころ", "香澄×蘭×彩×友希那×こころ「ピコっと！パピっと！！ガルパ☆ピコ！！！」"],
])("album title: %s", async (album_name, release_label, _title) => {
  const user = userEvent.setup();
  const album = { ...version().albums[0], album_name, release_label, release_date: "2021-06-30" };
  api.getSongVersion.mockResolvedValue({ ...version(), albums: [album] });
  api.getAlbumDetail.mockResolvedValue({ ...album, tracks: [] });
  render(<PublicPage />);
  const card = await screen.findByRole("link", { name: `查看唱片 ${album_name}` });
  expect(card).toHaveAttribute("href", "/albums/1");
  expect(within(card).getByText(album_name, { exact: true })).toBeInTheDocument();
  if (release_label) expect(within(card).getByText(release_label, { exact: true })).toBeInTheDocument();
  await user.click(card);
  expect(await screen.findByRole("heading", { level: 1, name: album_name })).toBeInTheDocument();
  if (release_label) expect(screen.getByText(release_label, { exact: true })).toBeInTheDocument();
});

// 测试点：整队与固定成员可同时选择，确认和提交保留两类归属。
test("mixed ownership submits bands and selected members", async () => {
  const user = userEvent.setup();
  api.getCatalogConsole.mockResolvedValue({ items: [{ member_id: 68, display_name: "成员乙", revision: 1 }] });
  render(<SongCatalogAdmin variant="create" active bands={[{ band_id: 1, band_name: "乐队甲" }, { band_id: 2, band_name: "乐队乙" }]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.type(screen.getByLabelText("歌曲名称"), "合作曲");
  await user.selectOptions(screen.getByLabelText("归属模式"), "mixed");
  await user.click(screen.getByRole("button", { name: "选择归属乐队" }));
  await user.click(within(screen.getByRole("group", { name: "归属乐队选项" })).getByLabelText("乐队甲"));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "选择成员所属乐队" }));
  await user.click(within(screen.getByRole("group", { name: "成员所属乐队选项" })).getByLabelText("乐队乙"));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "选择乐队乙 固定成员" }));
  await user.click(screen.getByRole("checkbox", { name: "成员乙" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "选择乐队乙 固定成员" })).toHaveTextContent("成员乙");
  await user.click(screen.getByRole("button", { name: "选择乐队乙 固定成员" }));
  expect(screen.getByRole("checkbox", { name: "成员乙" })).toBeChecked();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = screen.getByRole("dialog", { name: "确认新增歌曲" });
  expect(within(dialog).getByRole("row", { name: "归属 乐队甲 / 乐队乙：成员乙" })).toBeInTheDocument();
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/song-groups", "POST", expect.objectContaining({
    ownership: { mode: "mixed", band_ids: [1], member_groups: [{ band_id: 2, member_ids: [68] }] },
  }), "csrf");
});

// 测试点：切换版本仍显示歌曲组次数，Instrumental 点击定位收录的具体版本。
test("song group list, version counts and instrumental target", async () => {
  const user = userEvent.setup();
  api.getAlbumDetail.mockResolvedValue({ ...version().albums[0], tracks: [{ album_track_id: 1, song_id: 1, song_name: "合唱曲", track_order: 1, edition_label: "Instrumental", version_label: "普通版", group_id: 1 }] });
  render(<PublicPage />);
  const detail = await screen.findByRole("article", { name: "歌曲详情" });
  await within(detail).findByText("2");
  await user.click(within(detail).getByRole("button", { name: "合唱版" }));
  expect(await screen.findByText("短版")).toBeInTheDocument();
  await user.click(await screen.findByRole("link", { name: "查看唱片 收录盘" }));
  await user.click(await screen.findByRole("link", { name: "合唱曲 · 普通版 · Instrumental" }));
  await within(await screen.findByRole("article", { name: "歌曲详情" })).findByText("2");
  expect(api.getSongPerformances).toHaveBeenLastCalledWith(1, 1, { year: undefined, pageSize: 8 });
});

// 测试点：目录行与唱片独立跳转，分页筛选定位匹配版本，清除条件保留排序。
test("directory filters paginate and select a matching version", async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const selectAlbum = vi.fn();
  api.getSongGroups.mockImplementation(async (_q, index) => ({
    items: [{ group_id: 1, group_name: "合唱曲", version_count: 2, matched_song_ids: [2],
      first_release_date: "2018-12-12", first_release_albums: [version().albums[0]],
      performance_count: 36, latest_performance_date: "2025-05-03", display_cover: null }],
    page: index, page_size: 12, total: 25, total_pages: 3,
    facets: { total: 25, bands: [{ band_id: 1, band_name: "乐队甲", song_count: 14 }] },
  }));
  render(<SongCatalog songId={null} onSongSelect={select} onAlbumSelect={selectAlbum} onLiveSelect={vi.fn()} />);
  expect(await screen.findByText("2018.12.12", { selector: "time" })).toBeInTheDocument();
  expect(screen.getByText("2025.05.03")).toBeInTheDocument();
  await user.click(screen.getByText("2018.12.12", { selector: "time" }));
  await waitFor(() => expect(select).toHaveBeenCalledWith(2));
  select.mockClear();
  await user.click(screen.getByRole("link", { name: "收录盘" }));
  expect(selectAlbum).toHaveBeenCalledWith(1);
  expect(select).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(api.getSongGroups).toHaveBeenLastCalledWith("", 2, undefined, undefined, { sort: "plays", pageSize: 12 }));
  await user.click(await screen.findByRole("button", { name: "乐队甲 14" }));
  await waitFor(() => expect(api.getSongGroups).toHaveBeenLastCalledWith("", 1, 1, undefined, { sort: "plays", pageSize: 12 }));
  await user.selectOptions(screen.getByLabelText("歌曲排序"), "release");
  await user.type(screen.getByLabelText("搜索歌曲、乐队"), "乐队甲");
  await user.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() => expect(api.getSongGroups).toHaveBeenLastCalledWith("乐队甲", 1, 1, undefined, { sort: "release", pageSize: 12 }));
  await user.click(await screen.findByRole("link", { name: "合唱曲" }));
  await waitFor(() => expect(select).toHaveBeenCalledWith(2));
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  await waitFor(() => expect(api.getSongGroups).toHaveBeenLastCalledWith("", 1, undefined, undefined, { sort: "release", pageSize: 12 }));
  expect(screen.getByLabelText("搜索歌曲、乐队")).toHaveValue("");
  expect(await screen.findByRole("button", { name: "全部歌曲 25" })).toHaveAttribute("aria-pressed", "true");
});

// 测试点：筛选请求未完成时乐队控制仍可见且保留焦点，结果返回后保留选中状态。
test("directory retains band controls while filtering", async () => {
  const user = userEvent.setup();
  const result = { ...page([]), facets: { total: 1, bands: [{ band_id: 1, band_name: "乐队甲", song_count: 1 }] } };
  let finish!: (value: typeof result) => void;
  api.getSongGroups.mockResolvedValueOnce(result).mockImplementationOnce(() => new Promise<typeof result>(resolve => { finish = resolve; }));
  render(<SongCatalog songId={null} onSongSelect={vi.fn()} onLiveSelect={vi.fn()} />);
  const band = await screen.findByRole("button", { name: "乐队甲 1" });
  await user.click(band);
  expect(band).toHaveFocus();
  expect(band).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("region", { name: "歌曲列表" })).toHaveAttribute("aria-busy", "true");
  await act(async () => finish(result));
  expect(band).toHaveFocus();
  expect(screen.getByRole("region", { name: "歌曲列表" })).toHaveAttribute("aria-busy", "false");
});

// 测试点：10/50 行概览只读取批量目录，渲染每行不会触发歌曲、唱片或演出详情请求。
test.each([10, 50])("directory %i rows use one batch request", async pageSize => {
  api.getSongGroups.mockResolvedValue({ items: Array.from({ length: pageSize }, (_, index) => ({
    group_id: index + 1, group_name: `目录歌曲 ${index + 1}`, version_count: 1, matched_song_ids: [index + 1],
    first_release_date: null, first_release_albums: [], performance_count: 0, latest_performance_date: null, display_cover: null,
  })), page: 1, page_size: pageSize, total: 60, total_pages: Math.ceil(60 / pageSize), facets: { total: 60, bands: [] } });
  render(<SongCatalog songId={null} browse={{ pageSize }} onSongSelect={vi.fn()} onLiveSelect={vi.fn()} />);
  await screen.findByRole("link", { name: `目录歌曲 ${pageSize}` });
  expect(screen.getAllByRole("link", { name: /^目录歌曲 / })).toHaveLength(pageSize);
  expect(api.getSongGroups).toHaveBeenCalledTimes(1);
  expect(api.getSongVersion).not.toHaveBeenCalled();
  expect(api.getSongGroup).not.toHaveBeenCalled();
  expect(api.getAlbumDetail).not.toHaveBeenCalled();
  expect(api.getSongPerformances).not.toHaveBeenCalled();
});

// 测试点：年份筛选与翻页不改变组总次数，完整年份选项在空结果及加载期间仍可用。
test("performance years retain choices and group total across pages", async () => {
  const user = userEvent.setup();
  api.getSongVersion.mockResolvedValue(version(1, 20));
  api.getSongPerformances.mockImplementation(async (_id, index, options) => ({
    items: options.year === 2023 ? [] : [{ setlist_id: `record-${index}`, live_id: index,
      live_title: `演出 ${options.year ?? 2025} 第${index}页`, live_date: `${options.year ?? 2025}-01-01`,
      segment_type: "M", sub_order: 1, absolute_order: 1, is_short: false, live_cover: "original" }],
    page: index, page_size: 8, total: options.year === 2023 ? 0 : 17,
    total_pages: options.year === 2023 ? 1 : 3, available_years: [2025, 2024, 2023],
  }));
  render(<PublicPage />);
  await screen.findByText("演出 2025 第1页");
  await user.selectOptions(screen.getByLabelText("演出年份"), "2024");
  await screen.findByText("演出 2024 第1页");
  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(await screen.findByText("演出 2024 第2页")).toBeInTheDocument();
  expect(api.getSongPerformances).toHaveBeenLastCalledWith(1, 2, { year: 2024, pageSize: 8 });
  expect(screen.getByText("20", { exact: false, selector: ".song-performance-total strong" })).toHaveTextContent("20 次");
  await user.selectOptions(screen.getByLabelText("演出年份"), "2023");
  expect(await screen.findByText("暂无演奏记录")).toBeInTheDocument();
  expect(within(screen.getByLabelText("演出年份")).getAllByRole("option").map(option => option.textContent))
    .toEqual(["全部年份", "2025 年", "2024 年", "2023 年"]);
});

// 测试点：合辑按接口分区顺序展示每次收录及其归属，非默认版本与 Instrumental 指向同一具体版本。
test("album exposes every section and repeated track in release order", async () => {
  const select = vi.fn();
  api.getAlbumDetail.mockResolvedValue({ ...version().albums[0], tracks: [
    { album_track_id: 11, song_id: 2, group_id: 1, song_name: "合唱曲", version_label: "合唱版", section_name: "Disc 2", track_order: 1, edition_label: "", band_name: "乐队甲" },
    { album_track_id: 12, song_id: 2, group_id: 1, song_name: "合唱曲", version_label: "合唱版", section_name: "Disc 1", track_order: 1, edition_label: "Instrumental", band_name: "乐队甲" },
    { album_track_id: 13, song_id: 1, group_id: 1, song_name: "附加曲", version_label: "", section_name: "限定版", track_order: 1, edition_label: "", band_name: "乐队乙" },
  ] });
  render(<SongCatalog songId={null} albumId={1} onSongSelect={select} onLiveSelect={vi.fn()} />);
  const album = await screen.findByRole("article", { name: "唱片详情" });
  expect(within(album).getAllByRole("heading", { level: 3 }).map(item => item.textContent)).toEqual(["Disc 2", "Disc 1", "限定版"]);
  expect(within(album).getAllByRole("listitem")).toHaveLength(3);
  expect(within(album).getByText("3 首")).toBeInTheDocument();
  expect(within(album).getByRole("link", { name: "附加曲 乐队乙" })).toHaveAttribute("href", "/songs/1");
  const instrumental = within(album).getByRole("link", { name: "合唱曲 · 合唱版 · Instrumental 乐队甲" });
  expect(instrumental).toHaveAttribute("href", "/songs/2");
  await userEvent.click(instrumental);
  expect(select).toHaveBeenCalledWith(2);
});

// 测试点：从专辑曲目进入歌曲再返回时，恢复该专辑独立曲目列表的浏览位置。
test("album track scroll survives a song round trip", async () => {
  const user = userEvent.setup();
  api.getAlbumDetail.mockResolvedValue({ ...version().albums[0], tracks: Array.from({ length: 30 }, (_, index) => ({
    album_track_id: index + 1, song_id: 2, group_id: 1, song_name: `曲目 ${index + 1}`, version_label: "",
    section_name: "", track_order: index + 1, edition_label: "", band_name: "乐队甲",
  })) });
  render(<PublicPage />);
  await user.click(await screen.findByRole("link", { name: "查看唱片 收录盘" }));
  const tracks = await screen.findByRole("region", { name: "完整曲目列表" });
  fireEvent.scroll(tracks, { target: { scrollTop: 600 } });
  await user.click(within(tracks).getByRole("link", { name: "曲目 30" }));
  await screen.findByRole("article", { name: "歌曲详情" });
  await user.click(screen.getByRole("link", { name: "← 返回" }));
  expect(await screen.findByRole("region", { name: "完整曲目列表" })).toHaveProperty("scrollTop", 600);
});

// 测试点：成员及混合归属详情显示固定成员资料，pending 保留未知状态。
test.each(["members", "mixed", "pending"] as const)("detail ownership %s", async mode => {
  const members = { band_id: 2, band_name: "乐队乙", members: [{ member_id: 8, display_name: "固定成员" }] };
  api.getSongVersion.mockResolvedValue({ ...version(), ownership: { mode,
    band_ids: mode === "mixed" ? [1] : [], member_groups: mode === "pending" ? [] : [{ band_id: 2, member_ids: [8] }],
    bands: mode === "mixed" ? [{ band_id: 1, band_name: "乐队甲" }] : [], groups: mode === "pending" ? [] : [members] } });
  render(<PublicPage />);
  expect(await screen.findByText(mode === "pending" ? "待回填" : mode === "mixed" ? "乐队甲 / 乐队乙：固定成员" : "乐队乙：固定成员")).toBeInTheDocument();
  await screen.findByText("短版");
});

// 测试点：新增页直接填写，确认后 POST 创建；保留草稿连续提交也不会切换为 PUT。
test("create keeps its mode and uses creation requests", async () => {
  const user = userEvent.setup();
  render(<SongCatalogAdmin variant="create" active bands={[{ band_id: 1, band_name: "乐队甲" }]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  expect(screen.queryByLabelText("选择要编辑的歌曲")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("歌曲名称"), "合唱曲");
  await user.selectOptions(screen.getByLabelText("归属模式"), "bands");
  await user.click(screen.getByRole("button", { name: "选择归属乐队" }));
  await user.click(screen.getByRole("checkbox", { name: "乐队甲" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("checkbox", { name: "新增后清空数据" }));
  for (let index = 0; index < 2; index += 1) {
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    const dialog = screen.getByRole("dialog", { name: "确认新增歌曲" });
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(2);
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/song-groups", "POST", {
    group_name: "合唱曲", song_name: "合唱曲", version_label: "", cover_urls: [], ownership: { mode: "bands", band_ids: [1], member_groups: [] },
  }, "csrf");
  expect(screen.getByLabelText("歌曲名称")).toHaveValue("合唱曲");
});

// 测试点：已有歌曲组先搜索选择；确认保留版本资料，提交携带组 ID 和已加载的修订号。
test("create adds a version to the selected song group", async () => {
  const user = userEvent.setup();
  api.getSongGroup.mockResolvedValue({ group_id: 1, group_name: "合唱曲", revision: 7, versions: [version()] });
  render(<SongCatalogAdmin variant="create" active bands={[]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.type(screen.getByLabelText("歌曲名称"), "合唱曲 新版");
  expect(screen.getByLabelText("版本标识")).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("歌曲组", { exact: true }), "existing");
  await user.type(screen.getByLabelText("搜索歌曲组"), "合唱");
  await waitFor(() => expect(api.getSongGroups).toHaveBeenLastCalledWith("合唱", 1));
  await user.type(screen.getByLabelText("版本标识"), "新版");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "选择歌曲组" }));
  await user.click(await screen.findByRole("radio", { name: "合唱曲" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = screen.getByRole("dialog", { name: "确认新增歌曲" });
  expect(within(dialog).getByRole("row", { name: "歌曲组 合唱曲" })).toBeInTheDocument();
  expect(within(dialog).getByRole("row", { name: "版本标识 新版" })).toBeInTheDocument();
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/songs", "POST", {
    group_id: 1, expected_group_revision: 7, song_name: "合唱曲 新版", version_label: "新版", cover_urls: [],
    ownership: { mode: "pending", band_ids: [], member_groups: [] },
  }, "csrf");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByLabelText("歌曲组", { exact: true })).toHaveValue("new");
  expect(screen.getByLabelText("歌曲名称")).toHaveValue("");
});

// 测试点：管理先选版本，恢复保留对象，放弃确认取消后保留草稿；409 保留输入。
test("manage loads details and protects unsaved changes", async () => {
  const user = userEvent.setup();
  let guard: ((proceed: () => void) => void) | null = null;
  const leave = vi.fn();
  render(<SongCatalogAdmin variant="edit" active bands={[]} registerLeaveGuard={value => { guard = value; }} onManage={() => {}} />);
  expect(screen.queryByLabelText("歌曲名称")).not.toBeInTheDocument();
  await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "1");
  await screen.findByLabelText("歌曲名称");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("歌曲名称"), { target: { value: "修改曲名" } });
  // Trigger the registered navigation guard as the parent navigation does.
  fireEvent.click(Object.assign(document.createElement("button"), { onclick: () => guard?.(leave) }));
  await user.click(within(screen.getByRole("dialog", { name: "确认放弃歌曲修改" })).getByRole("button", { name: "取消" }));
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByLabelText("歌曲名称")).toHaveValue("修改曲名");
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(screen.getByLabelText("选择要编辑的歌曲")).toHaveValue("1");
  expect(screen.getByLabelText("歌曲名称")).toHaveValue("合唱曲");
  fireEvent.change(screen.getByLabelText("歌曲名称"), { target: { value: "再次修改" } });
  api.songCatalogWrite.mockRejectedValueOnce(new Error("资料已被修改"));
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(screen.getByLabelText("歌曲名称")).toHaveValue("再次修改"));
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/songs/1/edit", "PUT", expect.objectContaining({ song_name: "再次修改", version_label: "普通版", cover_urls: [], expected_revision: 1 }), "csrf");
});

// 测试点：独立唱片页本地切图遵守边界，坏图仍可切换及访问来源，离开再进入恢复默认图。
test("album gallery switches locally and resets on reopening", async () => {
  const user = userEvent.setup();
  const covers = ["https://img.example.test/first", "https://img.example.test/second"].map((url, index) => ({ url, name: `封面${index + 1}` }));
  const album = { ...version().albums[0], album_url: "https://example.test/album", cover_urls: covers, tracks: [] };
  api.getSongVersion.mockImplementation(async (id: number) => ({ ...version(id), albums: [album] }));
  api.getAlbumDetail.mockResolvedValue(album);
  render(<PublicPage />);
  const card = await screen.findByRole("link", { name: "查看唱片 收录盘" });
  expect(within(card).getByRole("img")).toHaveAttribute("src", covers[0].url);
  await user.click(card);
  const detail = await screen.findByRole("article", { name: "唱片详情" });
  const gallery = within(detail).getByRole("group", { name: "专辑封面" });
  expect(within(gallery).getByRole("img")).toHaveAttribute("src", covers[0].url);
  expect(within(gallery).getByRole("button", { name: "上一张" })).toBeDisabled();
  const requestsBefore = api.getAlbumDetail.mock.calls.length;
  await user.click(within(gallery).getByRole("button", { name: "下一张" }));
  expect(within(gallery).getByRole("img")).toHaveAttribute("src", covers[1].url);
  expect(within(gallery).getByText("2 / 2")).toBeInTheDocument();
  expect(within(gallery).getByRole("button", { name: "下一张" })).toBeDisabled();
  fireEvent.error(within(gallery).getByRole("img"));
  expect(within(gallery).getByRole("status")).toHaveTextContent("封面无法显示");
  expect(within(detail).getByRole("link", { name: /专辑页面/ })).toHaveAttribute("href", album.album_url);
  await user.click(within(gallery).getByRole("button", { name: "上一张" }));
  expect(within(gallery).getByRole("img")).toHaveAttribute("src", covers[0].url);
  expect(api.getAlbumDetail).toHaveBeenCalledTimes(requestsBefore);
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  await user.click(within(gallery).getByRole("button", { name: "下一张" }));
  await user.click(screen.getByRole("link", { name: "← 返回" }));
  await user.click(await screen.findByRole("link", { name: "查看唱片 收录盘" }));
  expect(await screen.findByText("1 / 2")).toBeInTheDocument();
});

// 测试点：歌曲组翻到后续页可选择，翻页保留已选组，搜索从第一页重新请求。
test("group picker exposes every page and retains the selection", async () => {
  const user = userEvent.setup();
  api.getSongGroups.mockImplementation(async (q: string, index: number) => ({
    items: [{ group_id: index, group_name: `${q || "歌曲组"} ${index}`, version_count: 1 }],
    page: index, page_size: 20, total: 41, total_pages: 3,
  }));
  render(<SongCatalogAdmin variant="create" active bands={[]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.selectOptions(screen.getByLabelText("歌曲组", { exact: true }), "existing");
  await screen.findByText("第 1 / 3 页，共 41 条");
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("第 2 / 3 页，共 41 条");
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("第 3 / 3 页，共 41 条");
  expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "选择歌曲组" }));
  await user.click(screen.getByRole("radio", { name: "歌曲组 3" }));
  await user.click(screen.getByRole("button", { name: "上一页" }));
  await screen.findByText("第 2 / 3 页，共 41 条");
  expect(screen.getByRole("button", { name: "选择歌曲组" })).toHaveTextContent("歌曲组 3");
  await user.type(screen.getByLabelText("搜索歌曲组"), "目标");
  await waitFor(() => expect(api.getSongGroups).toHaveBeenLastCalledWith("目标", 1));
  await screen.findByText("第 1 / 3 页，共 41 条");
});



// 测试点：资料、归属、组名和排序共用确认、恢复与单次原子保存。
test("one save reviews the complete song and group draft", async () => {
  const user = userEvent.setup();
  let leave: ((next: () => void) => void) | null = null;
  render(<SongCatalogAdmin variant="edit" active bands={[{ band_id: 1, band_name: "乐队甲" }, { band_id: 2, band_name: "乐队乙" }]}
    registerLeaveGuard={guard => { leave = guard; }} onManage={() => {}} />);
  await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "1");
  const name = await screen.findByLabelText("歌曲名称");
  expect(screen.queryByRole("button", { name: "歌曲组管理" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "保存修改" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "恢复原值" })).toHaveLength(1);
  fireEvent.change(name, { target: { value: "新曲名" } });
  fireEvent.change(screen.getByLabelText("歌曲组名称"), { target: { value: "新组名" } });
  const table = screen.getByRole("table", { name: "歌曲版本顺序" });
  await user.click(within(table).getAllByRole("button", { name: "下移" })[0]);
  await user.click(screen.getByRole("button", { name: "更正归属" }));
  expect(name).toBeVisible();
  expect(screen.getByRole("table", { name: "歌曲封面" })).toBeVisible();
  await user.selectOptions(screen.getByLabelText("归属模式"), "pending");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  await user.type(screen.getByLabelText("归属更正原因"), "待核实来源");
  await user.click(screen.getByRole("button", { name: "收起" }));
  const next = vi.fn(); act(() => leave?.(next));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
  expect(next).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  let dialog = within(screen.getByRole("dialog", { name: "确认修改歌曲" }));
  for (const label of ["歌曲名称", "歌曲组名称（整组）", "版本顺序（整组）", "归属（当前版本）"]) expect(dialog.getByRole("table")).toHaveTextContent(label);
  expect(api.songCatalogWrite).not.toHaveBeenCalled();
  expect(screen.getByLabelText("选择要编辑的歌曲")).toBeDisabled();
  await user.click(dialog.getByRole("button", { name: "取消" }));
  expect(name).toHaveValue("新曲名");
  await user.click(screen.getByRole("button", { name: "恢复原值" }));
  expect(name).toHaveValue("合唱曲");
  expect(screen.getByLabelText("歌曲组名称")).toHaveValue("合唱曲");
  expect(within(screen.getByRole("table", { name: "歌曲版本顺序" })).getAllByRole("row")[1]).toHaveTextContent("普通版");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  fireEvent.change(name, { target: { value: "新曲名" } });
  fireEvent.change(screen.getByLabelText("歌曲组名称"), { target: { value: "新组名" } });
  await user.click(within(screen.getByRole("table", { name: "歌曲版本顺序" })).getAllByRole("button", { name: "下移" })[0]);
  await user.click(screen.getByRole("button", { name: "更正归属" }));
  await user.selectOptions(screen.getByLabelText("归属模式"), "pending");
  await user.type(screen.getByLabelText("归属更正原因"), "待核实来源");
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  // A failed unified save preserves every field and can be retried as one operation.
  api.songCatalogWrite.mockRejectedValueOnce(new Error("资料已被修改"));
  dialog = within(screen.getByRole("dialog"));
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("资料已被修改");
  expect(name).toHaveValue("新曲名");
  expect(screen.getByLabelText("歌曲组名称")).toHaveValue("新组名");
  api.songCatalogWrite.mockResolvedValueOnce({ item: { ...version(), song_name: "新曲名", group_name: "新组名", revision: 2,
    ownership: { mode: "pending", band_ids: [], member_groups: [], bands: [], groups: [] } },
    group: { group_id: 1, group_name: "新组名", revision: 2, versions: [version(2), version()], display_cover: null } });
  await user.click(dialog.getByRole("button", { name: "确认提交" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(2);
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/songs/1/edit", "PUT", expect.objectContaining({
    song_name: "新曲名", expected_revision: 1, group: { group_id: 1, expected_revision: 1, group_name: "新组名", song_ids: [2, 1] },
    ownership: { mode: "pending", band_ids: [], member_groups: [] }, ownership_reason: "待核实来源", move_to_group: null,
  }), "csrf");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  expect(within(screen.getByRole("table", { name: "歌曲操作记录" })).getAllByRole("row")).toHaveLength(2);
  fireEvent.change(name, { target: { value: "下一次修改" } });
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/songs/1/edit", "PUT", expect.objectContaining({ expected_revision: 2,
    group: expect.objectContaining({ expected_revision: 2 }) }), "csrf");
});

// 测试点：目标组分页选择保留，移组和其他修改共同提交并携带目标 revision。
test("group correction joins the unified save across target pages", async () => {
  const user = userEvent.setup();
  api.getSongGroups.mockImplementation(async (_q: string, index: number) => ({
    items: [{ group_id: index === 1 ? 1 : 21, group_name: index === 1 ? "合唱曲" : "目标组", version_count: 1 }],
    page: index, page_size: 20, total: 21, total_pages: 2,
  }));
  api.getSongGroup.mockImplementation(async (id: number) => ({ group_id: id, group_name: id === 21 ? "目标组" : "合唱曲",
    revision: id === 21 ? 7 : 1, versions: [version(), version(2)], display_cover: null }));
  render(<SongCatalogAdmin variant="edit" active bands={[]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "1");
  await user.click(await screen.findByText("更正当前版本归组"));
  const section = within(screen.getByRole("region", { name: "歌曲组与版本" }));
  await section.findByText("第 1 / 2 页，共 21 条");
  await user.click(section.getByRole("button", { name: "下一页" }));
  await section.findByText("第 2 / 2 页，共 21 条");
  await user.click(section.getByRole("button", { name: "目标歌曲组" }));
  await user.click(screen.getByRole("radio", { name: "目标组" }));
  await waitFor(() => expect(api.getSongGroup).toHaveBeenCalledWith(21));
  await user.click(section.getByRole("button", { name: "上一页" }));
  await user.type(screen.getByLabelText("归组更正原因"), "归组修正");
  fireEvent.change(screen.getByLabelText("歌曲名称"), { target: { value: "更正后的曲名" } });
  await user.click(screen.getByRole("button", { name: "保存修改" }));
  expect(within(screen.getByRole("dialog")).getByRole("table")).toHaveTextContent("目标组（移至末尾）");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认提交" }));
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(1);
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/songs/1/edit", "PUT", expect.objectContaining({ song_name: "更正后的曲名",
    move_to_group: { group_id: 21, expected_revision: 7, reason: "归组修正" } }), "csrf");
});
