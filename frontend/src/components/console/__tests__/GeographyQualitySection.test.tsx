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
        category: "missing_coordinates", subject_type: "venue", subject_id: 7, venue_id: 7,
        venue_name: "Test Hall", venue_kind: "physical", locality_label: "JP / 東京都 / 渋谷区",
        live_date: null, live_title: null, detail: "尚未登记 WGS84 坐标",
      },
    ],
    counts: { missing_coordinates: 1 },
    total: 1, page: 1, page_size: 20, total_pages: 1,
  });
});

// 测试点：质量中心只列场地地理缺陷，不再出现坐标口径或 Live 时区复核项。
test("lists venue geography issues without removed categories", async () => {
  const onOpenVenue = vi.fn();
  const onOpenLive = vi.fn();
  const user = userEvent.setup();
  render(<GeographyQualitySection onMessage={vi.fn()} onOpenVenue={onOpenVenue} onOpenLive={onOpenLive} />);

  const table = await screen.findByRole("table", { name: "Venue 地理质量问题列表" });
  expect(table).toHaveTextContent("缺坐标");
  expect(screen.getByRole("option", { name: "全部问题（1）" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开 Venue" }));
  expect(onOpenVenue).toHaveBeenCalledWith(7);
  expect(onOpenLive).not.toHaveBeenCalled();

  await user.selectOptions(screen.getByLabelText("地理质量问题类型"), "missing_coordinates");
  await waitFor(() => expect(api.getConsoleGeographyQuality).toHaveBeenLastCalledWith("missing_coordinates", "", 1));
});
