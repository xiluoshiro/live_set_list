import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueLocationPanel } from "../VenueLocationPanel";
import type { VenueLocation } from "../../../api";

const api = vi.hoisted(() => ({
  getConsoleVenueLocation: vi.fn(), getConsoleTimezones: vi.fn(), getConsoleLocalities: vi.fn(),
  previewConsoleLocality: vi.fn(), saveConsoleLocality: vi.fn(),
  previewConsoleVenueLocation: vi.fn(), saveConsoleVenueLocation: vi.fn(),
  createConsoleLocality: vi.fn(), saveConsoleVenueMapLink: vi.fn(), deleteConsoleVenueMapLink: vi.fn(),
  searchConsoleVenueMapCandidates: vi.fn(),
}));
vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

const city = { id: 5, country_code: "JP", admin_area: "東京都", locality_name: "検証市", timezone_id: "Asia/Tokyo", area_level: "locality" as const, revision: 1 };
const location: VenueLocation = {
  venue_id: 1, locality: city, address: null, latitude: null, longitude: null,
  coordinate_system: "WGS84", coordinate_basis: null, timezone_id: null,
  effective_timezone_id: "Asia/Tokyo", timezone_source: "locality",
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

async function openPanel(onOpenLive?: (liveId: number) => void) {
  const user = userEvent.setup();
  render(<VenueLocationPanel venueId={1} venueName="Test Venue" venueKind="physical" onOpenLive={onOpenLive} />);
  await screen.findByLabelText("纬度（WGS84）");
  return user;
}

// 测试点：所在地与地图直接加载且不再折叠，地区时区与缺失坐标如实展示，单个坐标不能提交。
test("loads directly and validates paired coordinates", async () => {
  const user = await openPanel();
  expect(screen.getByText(/来自地区/)).toHaveTextContent("Asia/Tokyo");
  expect(screen.getAllByText("暂无坐标")).toHaveLength(3);
  await user.type(screen.getByLabelText("纬度（WGS84）"), "0");
  expect(screen.getAllByRole("button", { name: "保存修改" })[0]).toBeDisabled();
  await user.type(screen.getByLabelText("经度（WGS84）"), "0");
  await user.selectOptions(screen.getByLabelText("坐标核验口径"), "building");
  await user.selectOptions(screen.getByLabelText("核验来源（内部审计）"), "map_verified");
  await user.type(screen.getByLabelText("核验说明（内部审计）"), "地图人工核验");
  expect(screen.getAllByRole("button", { name: "保存修改" })[0]).toBeEnabled();
});

// 测试点：清空成对坐标会同时清空禁用的旧点位口径，避免提交不可见的残留值。
test("clears the coordinate basis when removing a saved point", async () => {
  api.getConsoleVenueLocation.mockResolvedValue({
    ...location, latitude: 35, longitude: 139, coordinate_basis: "center",
  });
  api.previewConsoleVenueLocation.mockImplementation((_id, after) => Promise.resolve({
    before: { ...location, latitude: 35, longitude: 139, coordinate_basis: "center" },
    after, effective_timezone_id: "Asia/Tokyo", live_count: 0,
    timezone_unchanged_live_count: 0, timezone_review_live_count: 0, timezone_unaffected_live_count: 0,
    timezone_review_lives: [], timezone_review_lives_truncated: false, invalidated_map_links: 0,
    invalidated_map_providers: [], changed_fields: ["coordinates", "coordinate_basis"],
  }));
  const user = await openPanel();
  await user.clear(screen.getByLabelText("纬度（WGS84）"));
  await user.clear(screen.getByLabelText("经度（WGS84）"));
  await user.selectOptions(screen.getByLabelText("核验来源（内部审计）"), "map_verified");
  await user.type(screen.getByLabelText("核验说明（内部审计）"), "撤销错误坐标");
  await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);

  await screen.findByRole("dialog", { name: "确认所在地修改" });
  expect(api.previewConsoleVenueLocation).toHaveBeenCalledWith(1, expect.objectContaining({
    latitude: null, longitude: null, coordinate_basis: null,
  }));
});

// 测试点：Venue 影响预览中的待复核 Live 可直接进入对应单场管理，不只是静态文本。
test("opens an affected live directly from the venue preview", async () => {
  const onOpenLive = vi.fn();
  const user = await openPanel(onOpenLive);
  api.previewConsoleVenueLocation.mockImplementation((_id, after) => Promise.resolve({
    before: location, after, effective_timezone_id: "America/New_York", live_count: 1,
    timezone_unchanged_live_count: 0, timezone_review_live_count: 1, timezone_unaffected_live_count: 0,
    timezone_review_lives: [{
      live_id: 38, live_date: "2026-01-03", live_title: "New Year Live",
      timezone_id: "Asia/Tokyo", timezone_source_revision: 2,
    }],
    timezone_review_lives_truncated: false, invalidated_map_links: 0,
    invalidated_map_providers: [], changed_fields: ["coordinates", "timezone_id", "effective_timezone_id"],
  }));

  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "America/New_York");
  await user.type(screen.getByLabelText("纬度（WGS84）"), "35");
  await user.type(screen.getByLabelText("经度（WGS84）"), "139");
  await user.selectOptions(screen.getByLabelText("坐标核验口径"), "building");
  await user.selectOptions(screen.getByLabelText("核验来源（内部审计）"), "official");
  await user.type(screen.getByLabelText("核验说明（内部审计）"), "官方页面核验");
  await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);
  const dialog = await screen.findByRole("dialog", { name: "确认所在地修改" });
  await user.click(within(dialog).getByRole("button", { name: /#38 2026-01-03 New Year Live/ }));

  expect(onOpenLive).toHaveBeenCalledWith(38);
  expect(screen.queryByRole("dialog", { name: "确认所在地修改" })).not.toBeInTheDocument();
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

// 测试点：完全没有所在地的 Venue 初次加载不应因 undefined/null 差异误报未保存修改。
test("keeps an empty location pristine until the editor changes a field", async () => {
  api.getConsoleVenueLocation.mockResolvedValue({
    ...location, locality: null, effective_timezone_id: null, timezone_source: null,
  });
  await openPanel();

  expect(screen.getAllByRole("button", { name: "保存修改" })[0]).toBeDisabled();
  expect(screen.getByLabelText("核验来源（内部审计）")).toBeDisabled();
  expect(screen.queryByText(/保存前请填写核验来源和核验说明/)).not.toBeInTheDocument();
});

// 测试点：未公开具体场馆只开放地区选择，不向编辑者暴露门牌、精确点位和地图关联操作。
test("limits undisclosed venues to the published locality", async () => {
  render(<VenueLocationPanel venueId={1} venueName="未公布会场" venueKind="undisclosed" />);
  await screen.findByLabelText("已公布地区");

  expect(screen.getByLabelText("已公布地区")).toBeEnabled();
  expect(screen.getByLabelText("公开门牌地址")).toBeDisabled();
  expect(screen.getByLabelText("纬度（WGS84）")).toBeDisabled();
  expect(screen.getByLabelText("场馆精确时区")).toBeDisabled();
  expect(screen.queryByRole("table", { name: "场馆地图链接" })).not.toBeInTheDocument();
  expect(screen.getByText(/只登记主办方已公布的地区/)).toBeInTheDocument();
});

// 测试点：修改已选地区会先展示 Venue、Live 与地图关联影响，再按地区修订号保存并刷新位置。
test("previews and saves the selected locality", async () => {
  const user = await openPanel();
  api.previewConsoleLocality.mockImplementation((_id, after) => Promise.resolve({
    before: city, after, venue_count: 2, inherited_timezone_venue_count: 1, live_count: 4,
    timezone_unchanged_live_count: 2, timezone_review_live_count: 1, timezone_unaffected_live_count: 1,
    timezone_review_lives: [{
      live_id: 38, live_date: "2026-01-03", live_title: "New Year Live",
      timezone_id: "Asia/Tokyo", timezone_source_revision: 2,
    }],
    timezone_review_lives_truncated: false, invalidated_map_links: 1,
  }));
  api.saveConsoleLocality.mockResolvedValue({ ...city, timezone_id: "America/New_York", revision: 2 });

  await user.click(screen.getByRole("button", { name: "修改已选地区" }));
  await user.selectOptions(screen.getByLabelText("地区时区"), "America/New_York");
  await user.click(screen.getByRole("button", { name: "预览修改" }));

  const dialog = await screen.findByRole("dialog", { name: "确认地区资料修改" });
  expect(dialog).toHaveTextContent("引用 Venue2");
  expect(dialog).toHaveTextContent("需重新核对的地图关联1");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("#38 2026-01-03 New Year Live");
  expect(api.saveConsoleLocality).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(api.saveConsoleLocality).toHaveBeenCalledWith(
    5, expect.objectContaining({ expected_revision: 1, timezone_id: "America/New_York" }), "csrf",
  ));
  expect(screen.getByRole("status")).toHaveTextContent("1 场 Live 的历史时区快照未改写");
});

// 测试点：保存前必须预览，使用预览快照和修订号提交；失败保留确认框及编辑内容。
test("previews and confirms a revision-bound change, retaining failed input", async () => {
  const user = await openPanel();
  api.previewConsoleVenueLocation.mockImplementation((_id, after) => Promise.resolve({
    before: location, after, effective_timezone_id: "Asia/Tokyo", live_count: 4, invalidated_map_links: 1,
    timezone_unchanged_live_count: 3, timezone_review_live_count: 0, timezone_unaffected_live_count: 1,
    timezone_review_lives: [], timezone_review_lives_truncated: false,
    invalidated_map_providers: ["google"], changed_fields: ["address"],
  }));
  api.saveConsoleVenueLocation.mockRejectedValueOnce(new Error("资料已更新"))
    .mockResolvedValueOnce({ ...location, address: "New address", location_revision: 3 });
  await user.type(screen.getByLabelText("公开门牌地址"), "New address");
  await user.selectOptions(screen.getByLabelText("核验来源（内部审计）"), "official");
  await user.type(screen.getByLabelText("核验说明（内部审计）"), "场馆官网门牌");
  await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);
  let dialog = await screen.findByRole("dialog", { name: "确认所在地修改" });
  expect(dialog).toHaveTextContent("本次不修改排期");
  expect(api.saveConsoleVenueLocation).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已更新"));
  expect(screen.getByLabelText("公开门牌地址")).toHaveValue("New address");
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
    timezone_review_lives_truncated: false, invalidated_map_providers: [],
    changed_fields: ["coordinates", "coordinate_basis", "timezone_id", "effective_timezone_id"],
  }));
  api.saveConsoleVenueLocation.mockResolvedValue({
    ...noLocalityLocation, latitude: 40.7, longitude: -74, coordinate_basis: "center",
    timezone_id: "America/New_York", effective_timezone_id: "America/New_York",
    timezone_source: "venue", location_revision: 3,
  });
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "America/New_York");
  await user.type(screen.getByLabelText("纬度（WGS84）"), "40.7");
  await user.type(screen.getByLabelText("经度（WGS84）"), "-74");
  await user.selectOptions(screen.getByLabelText("坐标核验口径"), "center");
  await user.selectOptions(screen.getByLabelText("核验来源（内部审计）"), "map_verified");
  await user.type(screen.getByLabelText("核验说明（内部审计）"), "园区中心点");
  await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);

  const dialog = await screen.findByRole("dialog", { name: "确认所在地修改" });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("#38 2026-01-03 New Year Live");
  expect(dialog).toHaveTextContent("Asia/Tokyo → America/New_York");
  expect(dialog).toHaveTextContent("保存场馆不会改写这些历史快照");
  expect(api.saveConsoleVenueLocation).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 场 Live 时区待逐场复核"));
});

// 测试点：地区分页提供总数和后续结果入口，不把首批地区当作完整列表。
test("shows locality total and fetches the next page", async () => {
  api.getConsoleLocalities.mockResolvedValueOnce({ items: [city], total: 21, page: 1, page_size: 20 })
    .mockResolvedValueOnce({ items: [{ ...city, id: 6, locality_name: "別の市" }], total: 21, page: 2, page_size: 20 });
  const user = await openPanel();
  expect(screen.getByText(/共 21 个地区/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一页地区" }));
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

// 测试点：地图搜索不会默认采用第一项，确认后只提交目标 ID 和链接，不持久化候选资料。
test("requires an explicit candidate selection before linking a map place", async () => {
  const located = { ...location, latitude: 35, longitude: 139, coordinate_basis: "building" as const };
  api.getConsoleVenueLocation.mockResolvedValue(located);
  api.searchConsoleVenueMapCandidates.mockResolvedValue({
    provider: "google", status: "ready", message: null, candidates: [
      { provider_place_id: "first", provider_url: "https://www.google.com/maps/place/first", name: "First Hall", address: "1 Main St", latitude: 35.0001, longitude: 139.0001, source_coordinate_system: "WGS84", distance_m: 14 },
      { provider_place_id: "second", provider_url: "https://www.google.com/maps/place/second", name: "Second Hall", address: "2 Main St", latitude: 35.001, longitude: 139.001, source_coordinate_system: "WGS84", distance_m: 143 },
    ],
  });
  api.saveConsoleVenueMapLink.mockResolvedValue(located);
  const user = await openPanel();

  await user.click(screen.getByRole("button", { name: "查询候选" }));
  expect(await screen.findByRole("table", { name: "Google Maps 地图候选" })).toHaveTextContent("First Hall");
  expect(screen.getByRole("button", { name: "关联所选候选" })).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: "选择 Second Hall" }));
  await user.click(screen.getByRole("button", { name: "关联所选候选" }));
  const dialog = await screen.findByRole("dialog", { name: "确认地图场馆候选" });
  expect(dialog).toHaveTextContent("143 m");
  expect(api.saveConsoleVenueMapLink).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(api.saveConsoleVenueMapLink).toHaveBeenCalledWith(
    1, "google", expect.objectContaining({
      provider_place_id: "second",
      provider_url: "https://www.google.com/maps/place/second",
    }), 2, "csrf",
  ));
});

// 测试点：切换场馆卸载旧表单后，延迟返回的旧请求不能污染新场馆的位置。
test("ignores an old venue response after unmount", async () => {
  let resolveOld!: (value: typeof location) => void;
  api.getConsoleVenueLocation.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const rendered = render(<VenueLocationPanel key={1} venueId={1} venueName="First" venueKind="physical" />);
  api.getConsoleVenueLocation.mockResolvedValue({ ...location, venue_id: 2, address: "Second" });
  rendered.rerender(<VenueLocationPanel key={2} venueId={2} venueName="Second" venueKind="physical" />);
  await waitFor(() => expect(screen.getByLabelText("公开门牌地址")).toHaveValue("Second"));
  resolveOld({ ...location, address: "Old response" });
  await waitFor(() => expect(screen.getByLabelText("公开门牌地址")).toHaveValue("Second"));
});
