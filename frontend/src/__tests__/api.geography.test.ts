import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

// 测试点：Venue、地区和地图关联写入携带 CSRF 与数据状态令牌，影响预览保持只读请求。
test("geography requests preserve write and concurrency contracts", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const {
    saveConsoleVenueLocation, deleteConsoleVenueMapLink, getConsoleLocalities,
    previewConsoleLocality, saveConsoleLocality, getConsoleGeographyQuality,
    searchConsoleVenueMapCandidates, saveConsoleVenueMapLink,
  } = await import("../api");
  const payload = {
    expected_state_token: "3".repeat(64), locality_id: null, address: null, latitude: 0, longitude: 0,
    coordinate_system: "WGS84" as const, timezone_id: null,
  };
  await saveConsoleVenueLocation(7, payload, "csrf-token");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/console/venues/7/location");
  expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
    method: "PUT", credentials: "include", body: JSON.stringify(payload),
    headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
  }));
  await deleteConsoleVenueMapLink(7, "apple", "3".repeat(64), "csrf-token");
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/console/venues/7/map-links/apple?expected_state_token=${"3".repeat(64)}`);
  expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  await getConsoleLocalities("A & B", 2);
  const url = new URL(fetchMock.mock.calls[2][0], "http://localhost");
  expect(url.searchParams.get("q")).toBe("A & B");
  expect(url.searchParams.get("page")).toBe("2");
  const locality = {
    expected_state_token: "2".repeat(64), country_code: "JP", admin_area: "東京都", locality_name: "渋谷区",
    timezone_id: "Asia/Tokyo", area_level: "locality" as const,
  };
  await previewConsoleLocality(9, locality);
  expect(fetchMock.mock.calls[3][0]).toBe("/api/console/localities/9/preview");
  expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: "POST", credentials: "include" }));
  await saveConsoleLocality(9, locality, "csrf-token");
  expect(fetchMock.mock.calls[4][0]).toBe("/api/console/localities/9");
  expect(fetchMock.mock.calls[4][1]).toEqual(expect.objectContaining({
    method: "PUT", headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
  }));
  await getConsoleGeographyQuality("missing_timezone", "A & B", 3);
  const qualityUrl = new URL(fetchMock.mock.calls[5][0], "http://localhost");
  expect(qualityUrl.pathname).toBe("/api/console/geography-quality");
  expect(qualityUrl.searchParams.get("category")).toBe("missing_timezone");
  expect(qualityUrl.searchParams.get("q")).toBe("A & B");
  expect(qualityUrl.searchParams.get("page")).toBe("3");
  await searchConsoleVenueMapCandidates(7, "google", "A & B");
  const mapSearchUrl = new URL(fetchMock.mock.calls[6][0], "http://localhost");
  expect(mapSearchUrl.pathname).toBe("/api/console/venues/7/map-candidates");
  expect(mapSearchUrl.searchParams.get("provider")).toBe("google");
  expect(mapSearchUrl.searchParams.get("q")).toBe("A & B");
  const candidate = {
    provider_place_id: "place-1", provider_url: "https://www.google.com/maps/place/1",
    name: "A Hall", address: "1 Main St", latitude: 35, longitude: 139,
    source_coordinate_system: "WGS84" as const, distance_m: 12,
  };
  await saveConsoleVenueMapLink(7, "google", {
    provider_place_id: candidate.provider_place_id, provider_url: candidate.provider_url,
  }, "3".repeat(64), "csrf-token");
  expect(fetchMock.mock.calls[7][0]).toBe("/api/console/venues/7/map-links");
  expect(fetchMock.mock.calls[7][1]).toEqual(expect.objectContaining({
    method: "PUT", headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
  }));
});
