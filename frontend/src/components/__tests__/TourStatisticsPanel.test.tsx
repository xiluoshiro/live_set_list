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
    expect(screen.getByRole("region", { name: "歌单变化" })).toHaveTextContent("旧曲→新曲");

    await user.click(selectors[0]);

    expect(selectors[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "歌单变化" })).toHaveTextContent("歌单未发生变化");
  });
});
