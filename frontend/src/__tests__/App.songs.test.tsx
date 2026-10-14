import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import App from "../App";
import { getAlbumDetail, getSongGroup, getSongGroups, getSongPerformances, getSongVersion, type SongVersion } from "../api";

vi.mock("../api", async importOriginal => ({ ...await importOriginal<typeof import("../api")>(),
  getSongGroups: vi.fn(), getSongGroup: vi.fn(), getSongVersion: vi.fn(),
  getSongPerformances: vi.fn(), getAlbumDetail: vi.fn(),
}));

const album = { album_id: 9, album_name: "多盘唱片", release_label: "", release_date: null,
  album_url: null, cover_urls: [], revision: 1 };
const version: SongVersion = { song_id: 72, song_name: "合唱曲", group_id: 7, group_name: "合唱曲",
  version_label: "合唱版", version_order: 2, revision: 1, legacy_cover: false, cover_urls: [], display_cover: null, performance_count: 0,
  ownership: { mode: "pending", band_ids: [], member_groups: [], bands: [], groups: [] }, albums: [album] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.mocked(getSongVersion).mockResolvedValue(version);
  vi.mocked(getSongGroup).mockResolvedValue({ group_id: 7, group_name: "合唱曲", revision: 1, display_cover: null, versions: [version] });
  vi.mocked(getSongGroups).mockResolvedValue({ items: [{ group_id: 7, group_name: "合唱曲", version_count: 1,
    matched_song_ids: [72], first_release_date: null, first_release_albums: [], performance_count: 0,
    latest_performance_date: null, display_cover: null }], page: 2, page_size: 10, total: 12, total_pages: 2,
    facets: { total: 12, bands: [{ band_id: 3, band_name: "乐队", song_count: 12 }] } });
  vi.mocked(getSongPerformances).mockResolvedValue({ items: [], page: 1, page_size: 8, total: 0, total_pages: 1, available_years: [] });
  vi.mocked(getAlbumDetail).mockResolvedValue({ ...album, tracks: [{ album_track_id: 1, song_id: 72, group_id: 7,
    song_name: "合唱曲", version_label: "合唱版", edition_label: "Instrumental", section_name: "Disc 2", track_order: 1, band_name: "待回填" }] });
});

// 测试点：真实 App 路由保留目录第 2 页筛选、排序和页大小，详情和唱片往返及重新挂载后仍定位具体版本。
test("song album history and refresh preserve directory context", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/songs?q=合唱&band=3&sort=release&page=2&size=10");
  let view = render(<App />);
  await user.click(await screen.findByRole("link", { name: "合唱曲" }));
  await screen.findByRole("heading", { name: "合唱曲", level: 1 });
  expect(window.location.pathname).toBe("/songs/72");
  await user.click(screen.getByRole("link", { name: "查看唱片 多盘唱片" }));
  await screen.findByRole("heading", { name: "多盘唱片", level: 1 });
  expect(window.location.pathname).toBe("/albums/9");
  view.unmount(); view = render(<App />);
  await user.click(await screen.findByRole("link", { name: "合唱曲 · 合唱版 · Instrumental" }));
  await screen.findByRole("heading", { name: "合唱曲", level: 1 });
  expect(getSongVersion).toHaveBeenLastCalledWith(72);
  expect(getSongGroup).toHaveBeenLastCalledWith(7);
  view.unmount(); view = render(<App />);
  await screen.findByRole("heading", { name: "合唱曲", level: 1 });
  await user.click(screen.getByRole("link", { name: "← 返回唱片" }));
  await screen.findByRole("heading", { name: "多盘唱片", level: 1 });
  await user.click(screen.getByRole("link", { name: "← 返回歌曲" }));
  await screen.findByRole("heading", { name: "合唱曲", level: 1 });
  await user.click(screen.getByRole("link", { name: "← 歌曲资料" }));
  expect(await screen.findByLabelText("搜索歌曲、乐队")).toHaveValue("合唱");
  expect(screen.getByLabelText("歌曲排序")).toHaveValue("release");
  await waitFor(() => expect(screen.getByRole("button", { name: "第 2 页" })).toHaveAttribute("aria-current", "page"));
  expect(getSongGroups).toHaveBeenLastCalledWith("合唱", 2, 3, undefined, { sort: "release", pageSize: 10 });
  await act(async () => window.history.forward());
  expect(await screen.findByRole("heading", { name: "合唱曲", level: 1 })).toBeInTheDocument();
});
