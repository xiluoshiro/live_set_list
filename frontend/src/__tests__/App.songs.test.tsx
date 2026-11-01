import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import App from "../App";
import { getAlbums, getAlbumDetail, getSongGroup, getSongGroups, getSongPerformances, getSongVersion, type SongVersion } from "../api";

vi.mock("../api", async importOriginal => ({ ...await importOriginal<typeof import("../api")>(),
  getSongGroups: vi.fn(), getSongGroup: vi.fn(), getSongVersion: vi.fn(),
  getSongPerformances: vi.fn(), getAlbumDetail: vi.fn(), getAlbums: vi.fn(),
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
    facets: { total: 12, bands: [{ band_id: 3, band_name: "乐队", song_count: 12 }, { band_id: 0, band_name: "其他乐队", song_count: 12 }] } });
  vi.mocked(getSongPerformances).mockResolvedValue({ items: [], page: 1, page_size: 8, total: 0, total_pages: 1, available_years: [] });
  vi.mocked(getAlbumDetail).mockResolvedValue({ ...album, tracks: [{ album_track_id: 1, song_id: 72, group_id: 7,
    song_name: "合唱曲", version_label: "合唱版", edition_label: "Instrumental", section_name: "Disc 2", track_order: 1, band_name: "待回填", is_cover: false }] });
  vi.mocked(getAlbums).mockImplementation(async (_q, page = 1) => ({ items: [{ ...album, track_count: 1 }],
    page, page_size: 10, total: 12, total_pages: 2, facets: { total: 12, bands: [{ band_id: 3, band_name: "乐队", album_count: 12 }, { band_id: 0, band_name: "其他乐队", album_count: 12 }] } }));
});

// 测试点：具体乐队与其他乐队筛选在专辑翻页、刷新、详情往返和歌曲切换时保留，并可清除。
test.each([3, 0])("album directory keeps band %s through refresh and detail navigation", async bandId => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/songs?sort=release&size=10");
  let view = render(<App />);
  await user.click(await screen.findByRole("tab", { name: "专辑" }));
  await screen.findByRole("link", { name: "多盘唱片" });
  await user.type(screen.getByRole("textbox", { name: "搜索专辑、乐队" }), "唱片");
  await user.click(screen.getByRole("button", { name: "搜索" }));
  await user.click(await screen.findByRole("button", { name: `${bandId === 0 ? "其他乐队" : "乐队"} 12` }));
  await user.selectOptions(screen.getByRole("combobox", { name: "专辑排序" }), "name");
  await user.click(await screen.findByRole("button", { name: "第 2 页" }));
  await waitFor(() => expect(getAlbums).toHaveBeenLastCalledWith("唱片", 2, bandId, { sort: "name", pageSize: 10 }));
  expect(new URLSearchParams(window.location.search).get("view")).toBe("albums");
  view.unmount(); view = render(<App />);
  expect(await screen.findByRole("tab", { name: "专辑" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: `${bandId === 0 ? "其他乐队" : "乐队"} 12` })).toHaveAttribute("aria-pressed", "true");
  await user.click(await screen.findByRole("link", { name: "多盘唱片" }));
  await screen.findByRole("heading", { name: "多盘唱片", level: 1 });
  await user.click(screen.getByRole("link", { name: "← 歌曲资料" }));
  expect(await screen.findByRole("textbox", { name: "搜索专辑、乐队" })).toHaveValue("唱片");
  expect(screen.getByRole("combobox", { name: "专辑排序" })).toHaveValue("name");
  await screen.findByRole("link", { name: "多盘唱片" });
  await user.click(screen.getByRole("tab", { name: "歌曲" }));
  expect(screen.getByRole("combobox", { name: "歌曲排序" })).toHaveValue("release");
  await waitFor(() => expect(getSongGroups).toHaveBeenLastCalledWith("唱片", 1, bandId, undefined, { sort: "release", pageSize: 10 }));
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  await waitFor(() => expect(getSongGroups).toHaveBeenLastCalledWith("", 1, undefined, undefined, { sort: "release", pageSize: 10 }));
});

// 测试点：具体乐队与其他乐队的歌曲目录上下文经过详情、唱片往返及重新挂载后仍保留。
test.each([3, 0])("song album history and refresh preserve band %s context", async bandId => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", `/songs?q=合唱&band=${bandId}&sort=release&page=2&size=10`);
  let view = render(<App />);
  await user.click(await screen.findByRole("link", { name: "合唱曲" }));
  await screen.findByRole("heading", { name: "合唱曲", level: 1 });
  expect(window.location.pathname).toBe("/songs/72");
  await user.click(screen.getByRole("link", { name: "查看唱片 多盘唱片" }));
  await screen.findByRole("heading", { name: "多盘唱片", level: 1 });
  expect(window.location.pathname).toBe("/albums/9");
  view.unmount(); view = render(<App />);
  await user.click(await screen.findByRole("link", { name: "合唱曲 · 合唱版 · Instrumental · 原创" }));
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
  expect(getSongGroups).toHaveBeenLastCalledWith("合唱", 2, bandId, undefined, { sort: "release", pageSize: 10 });
  await act(async () => window.history.forward());
  expect(await screen.findByRole("heading", { name: "合唱曲", level: 1 })).toBeInTheDocument();
});
