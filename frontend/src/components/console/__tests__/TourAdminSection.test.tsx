import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TourAdminSection } from "../TourAdminSection";

const apiMocks = vi.hoisted(() => ({
  createConsoleTour: vi.fn(),
  getConsoleTour: vi.fn(),
  getConsoleTourLiveCandidates: vi.fn(),
  getTours: vi.fn(),
  updateConsoleTour: vi.fn(),
}));

vi.mock("../../../api", () => apiMocks);
vi.mock("../../../auth/AuthProvider", () => ({
  useAuth: () => ({ csrfToken: "csrf-token" }),
}));

describe("TourAdminSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTours.mockResolvedValue({
      items: [{ tour_id: 7, tour_title: "Original Tour", band_ids: [1], stop_count: 1 }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    apiMocks.getConsoleTour.mockResolvedValue({
      tour_id: 7,
      tour_title: "Original Tour",
      band_ids: [1],
      stops: [{
        live_id: 70,
        live_date: "2026-07-01",
        start_time: "18:00:00+09:00",
        live_title: "Original Tour Tokyo",
        venue: "Test Venue",
        stop_label: null,
        band_ids: [1],
      }],
    });
    apiMocks.getConsoleTourLiveCandidates.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 1,
    });
    apiMocks.updateConsoleTour.mockResolvedValue({
      ok: true,
      item: { tour_id: 7, tour_title: "Updated Tour", band_count: 1, stop_count: 1 },
    });
  });

  // 测试点：巡演更新确认只列出变化字段，提交仍发送完整乐队和场次目标集合。
  test("confirms only changed tour fields before full replacement", async () => {
    const user = userEvent.setup();
    render(
      <TourAdminSection
        bands={[{ band_id: 1, band_name: "Test Band" }]}
        onMessage={vi.fn()}
      />,
    );

    await user.selectOptions(await screen.findByLabelText("已有巡演"), "7");
    await waitFor(() => expect(screen.getByLabelText("巡演名称")).toHaveValue("Original Tour"));
    await user.clear(screen.getByLabelText("巡演名称"));
    await user.type(screen.getByLabelText("巡演名称"), "Updated Tour");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    const dialog = screen.getByRole("dialog", { name: "确认更新巡演" });
    const diffTable = within(dialog).getByRole("table", { name: "巡演修改内容" });
    expect(within(diffTable).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "tour_titleOriginal TourUpdated Tour",
    ]);
    expect(within(dialog).queryByText("Original Tour Tokyo")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(apiMocks.updateConsoleTour).toHaveBeenCalledWith(
      7,
      {
        tour_title: "Updated Tour",
        band_ids: [1],
        stops: [{ live_id: 70, stop_label: null }],
      },
      "csrf-token",
    ));
  });
});
