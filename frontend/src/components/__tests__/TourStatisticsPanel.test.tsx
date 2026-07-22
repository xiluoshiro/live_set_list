import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { TourStatisticsResponse } from "../../api";
import { TourStatisticsPanel } from "../TourStatisticsPanel";

function makeStatistics(): TourStatisticsResponse {
  return {
    tour_id: 7,
    coverage: { stop_count: 3, setlist_stop_count: 3, comparable_transition_count: 2 },
    overview: { distinct_song_count: 3, common_song_count: 1 },
    songs: [
      { song_id: 1, song_name: "KiLLKiSS", appearance_count: 3, first_live_id: 40, last_live_id: 42, status: "common" },
    ],
    transitions: [
      {
        from_live_id: 40,
        from_live_date: "2026-05-20",
        from_live_title: "Tour 2026 大阪公演",
        to_live_id: 41,
        to_live_date: "2026-05-30",
        to_live_title: "Tour 2026 東京公演",
        replacements: [],
        added_songs: [],
        removed_songs: [],
        moved_songs: [],
      },
      {
        from_live_id: 41,
        from_live_date: "2026-05-30",
        from_live_title: "Tour 2026 東京公演",
        to_live_id: 42,
        to_live_date: "2026-06-02",
        to_live_title: "Tour 2026 FINAL",
        replacements: [{ segment_type: "main", sub_order: 1, from_song: { song_id: 2, song_name: "旧曲" }, to_song: { song_id: 3, song_name: "新曲" } }],
        added_songs: [],
        removed_songs: [],
        moved_songs: [],
      },
    ],
  };
}

describe("TourStatisticsPanel", () => {
  // 测试点：时间线默认选中最近一次有变化的场次，并允许切换查看无变化的相邻场次。
  test("切换相邻场次歌单变化", async () => {
    const user = userEvent.setup();
    render(<TourStatisticsPanel tourTitle="Tour 2026" data={makeStatistics()} loading={false} error={null} onOpenStop={vi.fn()} />);

    const progress = screen.getByRole("navigation", { name: "场次进程" });
    const selectors = within(progress).getAllByRole("button", { name: /对比上一场/ });
    expect(selectors).toHaveLength(2);
    expect(selectors[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "歌单变化" })).toHaveTextContent("新增歌曲");

    await user.click(selectors[0]);

    expect(selectors[0]).toHaveAttribute("aria-pressed", "true");
    const region = screen.getByRole("region", { name: "歌单变化" });
    expect(region).toHaveTextContent("歌单未发生变化");
    expect(region).not.toHaveTextContent("保留场次节点，不制造额外空白。");
  });

  // 测试点：位置相同的曲目替换归入普通新增和移除，不再暴露无意义的“同位置更换”分类。
  test("把位置相同的替换归入增删变化流", () => {
    render(<TourStatisticsPanel tourTitle="Tour 2026" data={makeStatistics()} loading={false} error={null} onOpenStop={vi.fn()} />);

    const region = screen.getByRole("region", { name: "歌单变化" });
    expect(within(region).getByLabelText("移除 旧曲")).toHaveClass("removed");
    expect(within(region).getByLabelText("新增 新曲")).toHaveClass("added");
    expect(within(region).getByLabelText("变化摘要")).toHaveTextContent("新增 1");
    expect(within(region).getByLabelText("变化摘要")).toHaveTextContent("移除 1");
    expect(region).not.toHaveTextContent("同位置更换");
    expect(region).not.toHaveTextContent("更换 1");
    expect(within(region).queryByText("顺序 0")).not.toBeInTheDocument();
  });

  // 测试点：同一新增歌曲出现两次时，来回切换场次不会因重复 React key 残留额外的新增行。
  test("重复歌曲在场次切换后保持正确的新增行数", async () => {
    const user = userEvent.setup();
    const statistics = makeStatistics();
    statistics.transitions = [
      {
        from_live_id: 40,
        from_live_date: "2025-06-28",
        from_live_title: "Tour 2026 Vol.3",
        to_live_id: 41,
        to_live_date: "2025-07-13",
        to_live_title: "Tour 2026 Vol.4",
        replacements: [],
        added_songs: [
          { song_id: 256, song_name: "TRASH LIFE" },
          { song_id: 257, song_name: "テレパシー" },
          { song_id: 292, song_name: "FUTURE IDOL" },
        ],
        removed_songs: [],
        moved_songs: [],
      },
      {
        from_live_id: 41,
        from_live_date: "2025-07-13",
        from_live_title: "Tour 2026 Vol.4",
        to_live_id: 42,
        to_live_date: "2025-08-10",
        to_live_title: "Tour 2026 Vol.5",
        replacements: [{
          segment_type: "M",
          sub_order: 11,
          from_song: { song_id: 160, song_name: "旧曲" },
          to_song: { song_id: 291, song_name: "エンプティパペット" },
        }],
        added_songs: [
          { song_id: 254, song_name: "Dream Voyage" },
          { song_id: 258, song_name: "グラディエント" },
          { song_id: 254, song_name: "Dream Voyage" },
          { song_id: 293, song_name: "青空のラプソディ" },
        ],
        removed_songs: [],
        moved_songs: [],
      },
    ];
    statistics.coverage.comparable_transition_count = 2;

    render(<TourStatisticsPanel tourTitle="Tour 2026" data={statistics} loading={false} error={null} onOpenStop={vi.fn()} />);

    const progress = screen.getByRole("navigation", { name: "场次进程" });
    const selectors = within(progress).getAllByRole("button", { name: /对比上一场/ });
    const addedRows = () => within(screen.getByRole("region", { name: "歌单变化" })).queryAllByLabelText(/^新增 /);

    expect(addedRows()).toHaveLength(5);
    await user.click(selectors[0]);
    expect(addedRows()).toHaveLength(3);
    await user.click(selectors[1]);
    expect(addedRows()).toHaveLength(5);
    await user.click(selectors[0]);
    expect(addedRows()).toHaveLength(3);
  });
});
