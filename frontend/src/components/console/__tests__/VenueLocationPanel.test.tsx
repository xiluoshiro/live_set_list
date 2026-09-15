import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueLocationPanel } from "../VenueLocationPanel";
import type { VenueLocation } from "../../../api";

const api = vi.hoisted(() => ({
  getConsoleVenueLocation: vi.fn(), getConsoleTimezones: vi.fn(), getConsoleLocalities: vi.fn(),
  previewConsoleVenueLocation: vi.fn(), saveConsoleVenueLocation: vi.fn(),
  createConsoleLocality: vi.fn(), saveConsoleVenueMapLink: vi.fn(), deleteConsoleVenueMapLink: vi.fn(),
}));
vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

const city = { id: 5, country_code: "JP", admin_area: "東京都", locality_name: "検証市", timezone_id: "Asia/Tokyo", area_level: "locality" as const, revision: 1 };
const location: VenueLocation = {
  venue_id: 1, locality: city, address: null, latitude: null, longitude: null,
  coordinate_system: "WGS84", timezone_id: null, effective_timezone_id: "Asia/Tokyo", timezone_source: "locality",
  location_revision: 2, location_verified_at: null,
  map_links: (["google", "apple", "amap"] as const).map(provider => ({
    provider, provider_place_id: null, provider_url: null, verified_at: null,
    is_current: false, url: null, coordinate_url: null,
  })),
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getConsoleVenueLocation.mockResolvedValue(location);
  api.getConsoleTimezones.mockResolvedValue(["Asia/Tokyo", "America/New_York"]);
  api.getConsoleLocalities.mockResolvedValue({ items: [city], total: 1, page: 1, page_size: 20 });
});

async function openPanel() {
  const user = userEvent.setup();
  render(<VenueLocationPanel venueId={1} venueKind="physical" />);
  await screen.findByLabelText("纬度（WGS84）");
  return user;
}

// 测试点：所在地与地图直接加载且不再折叠，城市时区与缺失坐标如实展示，单个坐标不能提交。
test("loads directly and validates paired coordinates", async () => {
  const user = await openPanel();
  expect(screen.getByText(/来自城市/)).toHaveTextContent("Asia/Tokyo");
  expect(screen.getAllByText("暂无坐标")).toHaveLength(3);
  await user.type(screen.getByLabelText("纬度（WGS84）"), "0");
  expect(screen.getAllByRole("button", { name: "保存修改" })[0]).toBeDisabled();
  await user.type(screen.getByLabelText("经度（WGS84）"), "0");
  expect(screen.getAllByRole("button", { name: "保存修改" })[0]).toBeEnabled();
});

// 测试点：国家和行政区级所在地没有城市名时，场馆位置与选择列表不显示空值或加载错误。
test("loads region-only localities without a city name", async () => {
  const tokyo = { ...city, locality_name: null, area_level: "admin_area" as const };
  const hongKong = { ...city, id: 6, country_code: "HK", admin_area: null, locality_name: null, area_level: "country" as const };
  api.getConsoleVenueLocation.mockResolvedValue({ ...location, locality: tokyo });
  api.getConsoleLocalities.mockResolvedValue({ items: [tokyo, hongKong], total: 2, page: 1, page_size: 20 });

  await openPanel();

  expect(screen.getByRole("option", { name: "JP / 東京都" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "HK" })).toBeInTheDocument();
  expect(screen.queryByText(/Request failed: 500/)).not.toBeInTheDocument();
});

// 测试点：保存前必须预览，使用预览快照和修订号提交；失败保留确认框及编辑内容。
test("previews and confirms a revision-bound change, retaining failed input", async () => {
  const user = await openPanel();
  api.previewConsoleVenueLocation.mockImplementation((_id, after) => Promise.resolve({
    before: location, after, effective_timezone_id: "Asia/Tokyo", live_count: 4, invalidated_map_links: 1,
    timezone_unchanged_live_count: 3, timezone_review_live_count: 0, timezone_unaffected_live_count: 1,
    timezone_review_lives: [], timezone_review_lives_truncated: false,
  }));
  api.saveConsoleVenueLocation.mockRejectedValueOnce(new Error("资料已更新"))
    .mockResolvedValueOnce({ ...location, address: "New address", location_revision: 3 });
  await user.type(screen.getByLabelText("详细地址"), "New address");
  await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);
  let dialog = await screen.findByRole("dialog", { name: "确认所在地修改" });
  expect(dialog).toHaveTextContent("本次不修改排期");
  expect(api.saveConsoleVenueLocation).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已更新"));
  expect(screen.getByLabelText("详细地址")).toHaveValue("New address");
  dialog = screen.getByRole("dialog", { name: "确认所在地修改" });
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.saveConsoleVenueLocation).toHaveBeenCalledWith(1, expect.objectContaining({ expected_revision: 2, address: "New address" }), "csrf");
});

// 测试点：有效时区变化时，确认框与保存结果都明确需人工复核的 Live，不静默改写历史快照。
test("warns about live snapshots whose timezone would differ", async () => {
  const noLocalityLocation = {
    ...location, locality: null, effective_timezone_id: null, timezone_source: null,
  } satisfies VenueLocation;
  api.getConsoleVenueLocation.mockResolvedValue(noLocalityLocation);
  const user = await openPanel();
  api.previewConsoleVenueLocation.mockImplementation((_id, after) => Promise.resolve({
    before: noLocalityLocation, after, effective_timezone_id: "America/New_York", live_count: 4, invalidated_map_links: 0,
    timezone_unchanged_live_count: 2, timezone_review_live_count: 1, timezone_unaffected_live_count: 1,
    timezone_review_lives: [{
      live_id: 38, live_date: "2026-01-03", live_title: "New Year Live",
      timezone_id: "Asia/Tokyo", timezone_source_revision: 2,
    }],
    timezone_review_lives_truncated: false,
  }));
  api.saveConsoleVenueLocation.mockResolvedValue({
    ...noLocalityLocation, latitude: 40.7, longitude: -74,
    timezone_id: "America/New_York", effective_timezone_id: "America/New_York",
    timezone_source: "venue", location_revision: 3,
  });
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "America/New_York");
  await user.type(screen.getByLabelText("纬度（WGS84）"), "40.7");
  await user.type(screen.getByLabelText("经度（WGS84）"), "-74");
  await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);

  const dialog = await screen.findByRole("dialog", { name: "确认所在地修改" });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("#38 2026-01-03 New Year Live");
  expect(dialog).toHaveTextContent("Asia/Tokyo → America/New_York");
  expect(dialog).toHaveTextContent("保存场馆不会改写这些历史快照");
  expect(api.saveConsoleVenueLocation).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 场 Live 的历史时区快照未改写，仍需逐场复核"));
});

// 测试点：城市分页提供总数和后续结果入口，不把首批城市当作完整列表。
test("shows city total and fetches the next page", async () => {
  api.getConsoleLocalities.mockResolvedValueOnce({ items: [city], total: 21, page: 1, page_size: 20 })
    .mockResolvedValueOnce({ items: [{ ...city, id: 6, locality_name: "別の市" }], total: 21, page: 2, page_size: 20 });
  const user = await openPanel();
  expect(screen.getByText(/共 21 个城市/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一页城市" }));
  await screen.findByRole("option", { name: /別の市/ });
  expect(api.getConsoleLocalities).toHaveBeenLastCalledWith("", 2);
});

// 测试点：旧关联保留坐标回退，地图表复用紧凑表格规则以便窄屏完整呈现三列。
test("keeps coordinate fallback when a place match is stale", async () => {
  api.getConsoleVenueLocation.mockResolvedValue({ ...location, latitude: 35, longitude: 139, map_links: [{
    ...location.map_links[0], verified_at: "2024-01-01T00:00:00Z", is_current: false,
    coordinate_url: "https://www.google.com/maps/search/?api=1&query=35,139",
  }] });
  await openPanel();
  expect(screen.getByText("需重新核对")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "场馆地图链接" })).toHaveClass("venue-map-table");
  expect(screen.queryByRole("link", { name: "打开场馆详情" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "按坐标打开" })).toHaveAttribute("href", expect.stringContaining("query=35,139"));
});

// 测试点：切换场馆卸载旧表单后，延迟返回的旧请求不能污染新场馆的位置。
test("ignores an old venue response after unmount", async () => {
  let resolveOld!: (value: typeof location) => void;
  api.getConsoleVenueLocation.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const rendered = render(<VenueLocationPanel key={1} venueId={1} venueKind="physical" />);
  api.getConsoleVenueLocation.mockResolvedValue({ ...location, venue_id: 2, address: "Second" });
  rendered.rerender(<VenueLocationPanel key={2} venueId={2} venueKind="physical" />);
  await waitFor(() => expect(screen.getByLabelText("详细地址")).toHaveValue("Second"));
  resolveOld({ ...location, address: "Old response" });
  await waitFor(() => expect(screen.getByLabelText("详细地址")).toHaveValue("Second"));
});
