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

  // 测试点：未变巡演不能提交，失败保留差异表，重试仍提交完整目标集合。
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
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    apiMocks.updateConsoleTour.mockRejectedValueOnce(new Error("写入失败"));
    await user.clear(screen.getByLabelText("巡演名称"));
    await user.type(screen.getByLabelText("巡演名称"), "Updated Tour");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    const dialog = screen.getByRole("dialog", { name: /确认更新巡演 #/ });
    const diffTable = within(dialog).getByRole("table", { name: "巡演修改内容" });
    expect(within(diffTable).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "tour_titleOriginal TourUpdated Tour",
    ]);
    expect(within(dialog).queryByText("Original Tour Tokyo")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^(确认提交|确认更新|确认应用)$/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("写入失败");
    expect(diffTable).toHaveTextContent("Original TourUpdated Tour");
    await user.click(within(dialog).getByRole("button", { name: "确认更新" }));

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
  // 测试点：巡演已写入但候选刷新失败时保留成功结果，不能提示重复保存。
  test("reports committed update separately from refresh failure", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    render(<TourAdminSection bands={[{ band_id: 1, band_name: "Test Band" }]} onMessage={onMessage} />);
    await user.selectOptions(await screen.findByLabelText("已有巡演"), "7");
    await waitFor(() => expect(screen.getByLabelText("巡演名称")).toHaveValue("Original Tour"));
    await user.type(screen.getByLabelText("巡演名称"), " Revised");
    apiMocks.getTours.mockRejectedValueOnce(new Error("刷新失败"));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(screen.getByRole("button", { name: "确认更新" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("更新巡演成功")));
    expect(onMessage).toHaveBeenLastCalledWith(expect.stringContaining("无需重复提交"));
    expect(apiMocks.updateConsoleTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

});
