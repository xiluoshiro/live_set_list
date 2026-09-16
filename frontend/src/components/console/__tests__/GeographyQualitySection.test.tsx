import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { GeographyQualitySection } from "../GeographyQualitySection";

const api = vi.hoisted(() => ({ getConsoleGeographyQuality: vi.fn() }));
vi.mock("../../../api", () => api);

beforeEach(() => {
  vi.resetAllMocks();
  api.getConsoleGeographyQuality.mockResolvedValue({
    items: [
      {
        category: "missing_coordinate_basis", subject_type: "venue", subject_id: 7, venue_id: 7,
        venue_name: "Test Hall", venue_kind: "physical", locality_label: "JP / 東京都 / 渋谷区",
        live_date: null, live_title: null, detail: "已有坐标但尚未核验点位口径",
      },
      {
        category: "timezone_review", subject_type: "live", subject_id: 38, venue_id: 7,
        venue_name: "Test Hall", venue_kind: "physical", locality_label: "JP / 東京都 / 渋谷区",
        live_date: "2026-01-03", live_title: "New Year Live", detail: "历史快照与当前资料不一致",
      },
    ],
    counts: { missing_coordinate_basis: 1, timezone_review: 1 },
    total: 2, page: 1, page_size: 20, total_pages: 1,
  });
});

// 测试点：质量中心显示同口径统计与明细，并可从不同对象直接进入 Venue 或 Live 修复流程。
test("lists geography issues and opens their maintenance targets", async () => {
  const onOpenVenue = vi.fn();
  const onOpenLive = vi.fn();
  const user = userEvent.setup();
  render(<GeographyQualitySection onMessage={vi.fn()} onOpenVenue={onOpenVenue} onOpenLive={onOpenLive} />);

  const table = await screen.findByRole("table", { name: "Venue 地理质量问题列表" });
  expect(table).toHaveTextContent("坐标缺口径");
  expect(screen.getByRole("option", { name: "全部问题（2）" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开 Venue" }));
  await user.click(screen.getByRole("button", { name: "打开 Live" }));
  expect(onOpenVenue).toHaveBeenCalledWith(7);
  expect(onOpenLive).toHaveBeenCalledWith(38);

  await user.selectOptions(screen.getByLabelText("地理质量问题类型"), "timezone_review");
  await waitFor(() => expect(api.getConsoleGeographyQuality).toHaveBeenLastCalledWith("timezone_review", "", 1));
});

