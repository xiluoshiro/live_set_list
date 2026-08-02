import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TourDetailPage } from "../TourDetailPage";

const apiMocks = vi.hoisted(() => ({
  getLiveDetail: vi.fn(),
  getTourDetail: vi.fn(),
  getTourStatistics: vi.fn(),
}));

vi.mock("../../api", () => apiMocks);
vi.mock("../../logger", () => ({ logError: vi.fn() }));


describe("TourDetailPage cancelled stops", () => {
  beforeEach(() => {
    apiMocks.getLiveDetail.mockReset();
    apiMocks.getTourDetail.mockReset();
    apiMocks.getTourStatistics.mockReset();
    apiMocks.getLiveDetail.mockResolvedValue({
      live_id: 4,
      live_date: "2026-02-02",
      live_title: "场4",
      live_type: "oneman",
      venue: "Venue",
      opening_time: "17:00:00+09:00",
      start_time: "18:00:00+09:00",
      bands: [],
      band_names: [],
      url: null,
      is_favorite: false,
      event_attendees: [],
      detail_rows: [],
    });
  });

  // 测试点：巡演场次只给取消场次追加状态短名，并且不为取消场次提供收藏入口。
  test("renders cancelled count and keeps no-setlist cancelled stop static", async () => {
    apiMocks.getTourDetail.mockResolvedValue({
      tour_id: 1,
      tour_title: "示例巡演",
      url: null,
      description: null,
      bands: [],
      start_date: "2026-02-01",
      end_date: "2026-02-04",
      collected_live_count: 4,
      cancelled_live_count: 1,
      stop_labels: [],
      stops: [
        {
          stop_order: 1,
          stop_label: null,
          live_id: 3,
          live_date: "2026-02-01",
          live_title: "示例巡演 场3",
          live_type: "oneman",
          venue: "Venue",
          bands: [],
          url: null,
          is_favorite: false,
          has_setlist: false,
          event_status: "cancelled",
          date_phase: "past",
          was_rescheduled: false,
        },
        {
          stop_order: 2,
          stop_label: null,
          live_id: 4,
          live_date: "2026-02-02",
          live_title: "示例巡演 场4",
          live_type: "oneman",
          venue: "Venue",
          bands: [],
          url: null,
          is_favorite: false,
          has_setlist: true,
          event_status: "scheduled",
          date_phase: "past",
          was_rescheduled: false,
        },
      ],
    });

    render(
      <TourDetailPage
        tourId={1}
        fallback={{ tourTitle: "示例巡演" }}
        canFavorite
        onToggleFavorite={vi.fn()}
      />,
    );

    await waitFor(() => expect(apiMocks.getLiveDetail).toHaveBeenCalledWith(4));
    const nav = screen.getByRole("navigation", { name: "巡演场次" });
    expect(within(nav).getByText("场3（已取消）")).toBeInTheDocument();
    expect(within(nav).getByText("场4")).toBeInTheDocument();
    expect(within(nav).queryByText("场4（已结束）")).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /收藏.*场3/ })).not.toBeInTheDocument();
    expect(screen.getByText("· 取消 1 场")).toBeInTheDocument();
  });
});
