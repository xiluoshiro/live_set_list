import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

// 测试点：所在地写入携带 CSRF、会话、修订号与空值，地图取消使用明确的版本条件。
test("geography requests preserve write and concurrency contracts", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const { saveConsoleVenueLocation, deleteConsoleVenueMapLink, getConsoleLocalities } = await import("../api");
  const payload = { expected_revision: 3, locality_id: null, address: null, latitude: 0, longitude: 0, coordinate_system: "WGS84" as const, timezone_id: null };
  await saveConsoleVenueLocation(7, payload, "csrf-token");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/console/venues/7/location");
  expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
    method: "PUT", credentials: "include", body: JSON.stringify(payload),
    headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
  }));
  await deleteConsoleVenueMapLink(7, "apple", 3, "csrf-token");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/console/venues/7/map-links/apple?expected_revision=3");
  expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  await getConsoleLocalities("A & B", 2);
  const url = new URL(fetchMock.mock.calls[2][0], "http://localhost");
  expect(url.searchParams.get("q")).toBe("A & B");
  expect(url.searchParams.get("page")).toBe("2");
});
