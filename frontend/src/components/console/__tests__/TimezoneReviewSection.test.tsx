import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { TimezoneReviewSection } from "../TimezoneReviewSection";
import type { TimezoneReviewItem } from "../../../api";

const api = vi.hoisted(() => ({
  getConsoleTimezoneReviews: vi.fn(),
  retainConsoleTimezoneSnapshot: vi.fn(),
  applyConsoleCurrentTimezone: vi.fn(),
}));

vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf-token" }) }));

const reviewItem: TimezoneReviewItem = {
  live_id: 38,
  live_date: "2026-01-03",
  live_title: "New Year Live",
  venue_id: 24,
  venue_name: "東京ガーデンシアター",
  timezone_source: "venue",
  snapshot_timezone_id: "Asia/Tokyo",
  snapshot_source_revision: 2,
  current_timezone_id: "America/New_York",
  current_source_revision: 3,
  status: "needs_review",
  opening_time: "17:00:00+09:00",
  start_time: "18:00:00+09:00",
  current_opening_time: "17:00:00-05:00",
  current_start_time: "18:00:00-05:00",
  snapshot_offset_minutes: 540,
  current_offset_minutes: -300,
  preview_error: null,
  retained_reason: null,
  retained_at: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getConsoleTimezoneReviews.mockResolvedValue({
    items: [reviewItem], page: 1, page_size: 20, total: 1, total_pages: 1,
    counts: { needs_review: 1, legacy_exception: 16 },
  });
  api.retainConsoleTimezoneSnapshot.mockResolvedValue({
    item: { ...reviewItem, status: "retained", retained_reason: "历史公告如此" },
  });
  api.applyConsoleCurrentTimezone.mockResolvedValue({
    item: { ...reviewItem, status: "current", snapshot_timezone_id: "America/New_York" },
  });
});

// 测试点：待复核队列显示时区与日期偏移差异，保留快照必须逐场填写理由并提交并发快照。
test("retains one historical snapshot with a required reason", async () => {
  const user = userEvent.setup();
  const onMessage = vi.fn();
  render(<TimezoneReviewSection onMessage={onMessage} onOpenLive={vi.fn()} />);

  expect(await screen.findByRole("table", { name: "Live 时区复核列表" })).toHaveTextContent("Asia/Tokyo");
  expect(screen.getByRole("table", { name: "Live 时区复核列表" })).toHaveTextContent("UTC-05:00");
  await user.click(screen.getByRole("button", { name: "保留快照" }));
  const dialog = screen.getByRole("dialog", { name: "确认保留历史时区快照" });
  expect(within(dialog).getByRole("button", { name: "确认提交" })).toBeDisabled();
  await user.type(within(dialog).getByLabelText("保留理由"), "历史公告如此");
  await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

  await waitFor(() => expect(api.retainConsoleTimezoneSnapshot).toHaveBeenCalledWith(
    38,
    expect.objectContaining({
      expected_snapshot_timezone_id: "Asia/Tokyo",
      expected_current_timezone_id: "America/New_York",
      expected_current_source_revision: 3,
      reason: "历史公告如此",
    }),
    "csrf-token",
  ));
  expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("已保留 Live #38"));
});

// 测试点：资料修正确认明确展示偏移变化，可采用当前来源时区或直接进入对应 Live。
test("applies the current timezone or opens the live", async () => {
  const user = userEvent.setup();
  const onOpenLive = vi.fn();
  render(<TimezoneReviewSection onMessage={vi.fn()} onOpenLive={onOpenLive} />);
  await screen.findByRole("table", { name: "Live 时区复核列表" });

  await user.click(screen.getByRole("button", { name: "打开 Live" }));
  expect(onOpenLive).toHaveBeenCalledWith(38);
  await user.click(screen.getByRole("button", { name: "采用当前时区" }));
  const dialog = screen.getByRole("dialog", { name: "确认采用当前时区" });
  expect(dialog).toHaveTextContent("UTC+09:00 → UTC-05:00");
  expect(dialog).toHaveTextContent("当地墙上钟点保持不变");
  await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

  await waitFor(() => expect(api.applyConsoleCurrentTimezone).toHaveBeenCalledWith(
    38, expect.objectContaining({ expected_snapshot_source_revision: 2 }), "csrf-token",
  ));
});
