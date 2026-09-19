import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VenueLocationMap } from "../VenueLocationMap";
import { resetGoogleMapSession } from "../googleMapsSession";

const fake = vi.hoisted(() => {
  const handlers: Record<string, (event?: unknown) => void> = {};
  const map = {
    addListener: vi.fn((name: string, handler: (event?: unknown) => void) => {
      handlers[`map:${name}`] = handler;
      return { remove: vi.fn() };
    }),
    getBounds: () => ({ contains: () => true }),
    getZoom: () => 16,
    setCenter: vi.fn(),
    setZoom: vi.fn(),
  };
  const marker = {
    addListener: vi.fn((name: string, handler: () => void) => {
      handlers[`marker:${name}`] = handler;
      return { remove: vi.fn() };
    }),
    getPosition: () => ({ lat: () => 35.12345678, lng: () => -179.98765432 }),
    setDraggable: vi.fn(),
    setMap: vi.fn(),
    setPosition: vi.fn(),
  };
  return { handlers, map, marker, makeMap: vi.fn(() => map), makeMarker: vi.fn(() => marker) };
});

const config = { google_maps_browser_api_key: "browser-key", geocoding: true, timezone: true };

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(fake.handlers).forEach(key => delete fake.handlers[key]);
  window.google = {
    maps: {
      Map: fake.makeMap,
      Marker: fake.makeMarker,
      event: { trigger: vi.fn() },
    },
  } as unknown as NonNullable<typeof window.google>;
});
afterEach(() => {
  resetGoogleMapSession();
  delete window.google;
});

// 测试点：普通地图点击和标记拖动输出六位 WGS84，Google POI 点击只交付 Place ID。
test("map point, POI and drag events use the expected selection paths", async () => {
  const onPoint = vi.fn();
  const onPlaceId = vi.fn();
  const view = render(<VenueLocationMap config={config} point={null} disabled={false} onPoint={onPoint} onPlaceId={onPlaceId} />);
  await waitFor(() => expect(fake.handlers["map:click"]).toBeDefined());
  expect(screen.getByText(/尚未选点/)).toBeInTheDocument();
  act(() => fake.handlers["map:click"]({ latLng: { lat: () => 35.12345678, lng: () => -179.98765432 } }));
  expect(onPoint).toHaveBeenLastCalledWith({ latitude: 35.123457, longitude: -179.987654 });
  const stop = vi.fn();
  act(() => fake.handlers["map:click"]({ placeId: "place-1", stop }));
  expect(onPlaceId).toHaveBeenCalledWith("place-1");
  expect(stop).toHaveBeenCalled();

  view.rerender(<VenueLocationMap config={config} point={{ latitude: 35, longitude: 139 }} disabled={false}
    onPoint={onPoint} onPlaceId={onPlaceId} />);
  await waitFor(() => expect(fake.handlers["marker:dragend"]).toBeDefined());
  act(() => fake.handlers["marker:dragend"]());
  expect(onPoint).toHaveBeenLastCalledWith({ latitude: 35.123457, longitude: -179.987654 });
});

// 测试点：组件收起后地图实例停放复用，重新展开不创建第二个 Dynamic Maps 实例。
test("unmount and remount reuse one Google map instance", async () => {
  const props = { config, point: null, disabled: false, onPoint: vi.fn(), onPlaceId: vi.fn() };
  const first = render(<VenueLocationMap {...props} />);
  await waitFor(() => expect(fake.makeMap).toHaveBeenCalledTimes(1));
  first.unmount();
  const second = render(<VenueLocationMap {...props} />);
  await waitFor(() => expect(screen.getByRole("region", { name: "场馆位置地图" })).toBeInTheDocument());
  expect(fake.makeMap).toHaveBeenCalledTimes(1);
  second.unmount();
});
