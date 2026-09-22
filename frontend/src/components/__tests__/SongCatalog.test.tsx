import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  version_label: id === 1 ? "普通版" : "合唱版", version_order: id, revision: 1, legacy_cover: false,
  ownership: { mode: "bands", band_ids: [1], member_groups: [], bands: [{ band_id: 1, band_name: "乐队甲" }], groups: [] },
  performance_count: count, albums: [{ album_id: 1, album_name: "收录盘", release_label: "special disc", release_date: null, cover_path: null, revision: 1 }] });
const page = <T,>(items: T[], index = 1, pages = 1) => ({ items, page: index, page_size: 30, total: items.length, total_pages: pages });
beforeEach(() => {
  vi.resetAllMocks();
  api.getSongGroups.mockResolvedValue(page([{ group_id: 1, group_name: "合唱曲", version_count: 2 }]));
  api.getSongGroup.mockResolvedValue({ group_id: 1, group_name: "合唱曲", revision: 1, versions: [version(), version(2, 5)] });
  api.getSongVersion.mockImplementation((id: number) => Promise.resolve(version(id, id === 1 ? 2 : 5)));
  api.getSongPerformances.mockResolvedValue(page([{ setlist_id: "row-1", live_id: 1, live_title: "Live 1", live_date: "2026-01-01", segment_type: "M", sub_order: 1, absolute_order: 1, is_short: true, live_cover: "original" }]));
  api.getCatalogConsole.mockImplementation((path: string) => Promise.resolve(path === "/members" ? { items: [] } : path === "/songs/1" ? version() : page([{ song_id: 1, song_name: "合唱曲", band_id: null, band_name: "乐队甲", version_label: "普通版" }])));
  api.songCatalogWrite.mockResolvedValue({ item: version() });
});

// 测试点：左列只有歌曲组，切换版本只改变右侧次数；Instrumental 点击仍定位对应歌曲。
test("song group list, version counts and instrumental target", async () => {
  const user = userEvent.setup();
  function Page() { const [id, setId] = useState<number | null>(1); return <SongCatalog songId={id} onSongSelect={setId} onLiveSelect={vi.fn()} />; }
  api.getAlbumDetail.mockResolvedValue({ ...version().albums[0], tracks: [{ album_track_id: 1, song_id: 1, song_name: "合唱曲", track_order: 1, edition_label: "Instrumental", version_label: "普通版", group_id: 1 }] });
  render(<Page />);
  const detail = screen.getByRole("article", { name: "歌曲详情" });
  await within(detail).findByText("2");
  expect(within(screen.getByRole("complementary", { name: "歌曲组列表" })).queryByText("演奏次数")).not.toBeInTheDocument();
  await user.click(within(detail).getByRole("button", { name: "合唱版" }));
  await within(detail).findByText("5");
  expect(await within(detail).findByText("短版")).toBeInTheDocument();
  await user.click(within(detail).getByRole("button", { name: /收录盘/ }));
  await user.click(await screen.findByRole("button", { name: "合唱曲 · Instrumental" }));
  await within(detail).findByText("2");
  expect(api.getSongPerformances).toHaveBeenLastCalledWith(1, 1);
});

// 测试点：新增页直接填写，确认后 POST 创建；保留草稿连续提交也不会切换为 PUT。
test("create keeps its mode and uses creation requests", async () => {
  const user = userEvent.setup();
  render(<SongCatalogAdmin variant="create" active bands={[{ band_id: 1, band_name: "乐队甲" }]} registerLeaveGuard={() => {}} onManage={() => {}} />);
  expect(screen.queryByLabelText("选择要编辑的歌曲")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("歌曲名称"), "合唱曲");
  await user.selectOptions(screen.getByLabelText("归属模式"), "bands");
  await user.click(screen.getByRole("checkbox", { name: "乐队甲" }));
  await user.click(screen.getByRole("checkbox", { name: "新增后清空数据" }));
  for (let index = 0; index < 2; index += 1) {
    await user.click(screen.getByRole("button", { name: "提交插入" }));
    const dialog = screen.getByRole("dialog", { name: "确认新增歌曲" });
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(2);
  expect(api.songCatalogWrite).toHaveBeenLastCalledWith("/song-groups", "POST", {
    group_name: "合唱曲", song_name: "合唱曲", version_label: "", ownership: { mode: "bands", band_ids: [1], member_groups: [] },
  }, "csrf");
  expect(screen.getByLabelText("歌曲名称")).toHaveValue("合唱曲");
});

// 测试点：管理先选版本，恢复保留对象，放弃确认取消后保留草稿；409 保留输入。
test("manage loads details and protects unsaved changes", async () => {
  const user = userEvent.setup();
  let guard: ((proceed: () => void) => void) | null = null;
  const leave = vi.fn();
  render(<SongCatalogAdmin variant="edit" active bands={[]} registerLeaveGuard={value => { guard = value; }} onManage={() => {}} />);
  expect(screen.queryByLabelText("歌曲名称")).not.toBeInTheDocument();
  await user.selectOptions(await screen.findByLabelText("选择要编辑的歌曲"), "1");
  await screen.findByDisplayValue("合唱曲");
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
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/songs/1", "PUT", { song_name: "再次修改", version_label: "普通版", expected_revision: 1 }, "csrf");
});
