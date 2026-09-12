import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { VenueDetailPage } from "../VenueDetailPage";
import { VenueMapMenu } from "../VenueMapMenu";

const apiMocks = vi.hoisted(() => ({
  getVenueDetail: vi.fn(),
  getVenueMaps: vi.fn(),
}));

vi.mock("../../api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getVenueDetail: apiMocks.getVenueDetail,
  getVenueMaps: apiMocks.getVenueMaps,
}));
vi.mock("../../logger", () => ({ logError: vi.fn() }));

function makeVenueDetail() {
  return {
    venue_id: 7,
    venue_name: "日本武道館",
    venue_kind: "physical" as const,
    locality: { country_code: "JP", admin_area: "東京都", locality_name: "千代田区" },
    address: "北の丸公園2-3",
    latitude: 35.693317,
    longitude: 139.749885,
    timezone_id: "Asia/Tokyo",
    timezone_source: "locality" as const,
    name_versions: [
      { venue_name: "日本武道館", valid_from: "1964-10-03", valid_to: null, is_current: true },
    ],
    map_links: [
      { provider: "google" as const, url: "https://maps.example/google", source: "place" as const },
      { provider: "apple" as const, url: "https://maps.example/apple", source: "coordinates" as const },
    ],
    lives: [
      {
        live_id: 51,
        live_date: "2026-08-01",
        live_title: "Test Live",
        live_type: "oneman",
        bands: [1],
        url: null,
        event_status: "scheduled" as const,
        date_phase: "past" as const,
        was_rescheduled: false,
      },
    ],
    pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
  };
}

describe("Venue public pages", () => {
  beforeEach(() => {
    apiMocks.getVenueDetail.mockReset();
    apiMocks.getVenueMaps.mockReset();
  });

  // 测试点：场馆详情应展示公开地点资料和名称记录，并允许从相关 Live 卡片继续浏览。
  test("renders venue information and opens a related Live", async () => {
    const user = userEvent.setup();
    const onOpenLive = vi.fn();
    apiMocks.getVenueDetail.mockResolvedValue(makeVenueDetail());

    render(
      <VenueDetailPage
        venueId={7}
        fallbackName="日本武道館"
        onBack={vi.fn()}
        onOpenLive={onOpenLive}
        onCanonicalVenue={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "日本武道館" })).toBeInTheDocument();
    expect(screen.getByText("北の丸公園2-3")).toBeInTheDocument();
    expect(screen.getByText("JP · 東京都 · 千代田区")).toBeInTheDocument();
    expect(screen.getByText("日本武道館（当前）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看《Test Live》详情/ }));
    expect(onOpenLive).toHaveBeenCalledWith(expect.objectContaining({ live_id: 51 }));
  });

  // 测试点：请求合并来源 ID 时，页面应把站内地址替换成主 Venue ID。
  test("reports the canonical Venue returned by the API", async () => {
    const onCanonicalVenue = vi.fn();
    apiMocks.getVenueDetail.mockResolvedValue(makeVenueDetail());

    render(
      <VenueDetailPage
        venueId={99}
        fallbackName="旧场馆名"
        onBack={vi.fn()}
        onOpenLive={vi.fn()}
        onCanonicalVenue={onCanonicalVenue}
      />,
    );

    await waitFor(() => expect(onCanonicalVenue).toHaveBeenCalledWith(7, "日本武道館"));
  });

  // 测试点：Live 详情里的地图按钮应在轻量接口确认有位置后出现，并列出可选地图。
  test("loads map choices before exposing the map menu", async () => {
    const user = userEvent.setup();
    apiMocks.getVenueMaps.mockResolvedValue({
      venue_id: 7,
      venue_name: "日本武道館",
      map_links: [{ provider: "google", url: "https://maps.example/google", source: "place" }],
    });

    render(<VenueMapMenu venueId={7} venueName="日本武道館" />);

    const trigger = await screen.findByRole("button", { name: "选择日本武道館的地图" });
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /Google Maps/ })).toHaveAttribute(
      "href",
      "https://maps.example/google",
    );
  });
});
