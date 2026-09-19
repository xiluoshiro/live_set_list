import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VenueLocationMap } from "../VenueLocationMap";
import { DEFAULT_GOOGLE_MAP_POINT, resetGoogleMapSession } from "../googleMapsSession";

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
  delete window.__liveSetListGoogleMapsReady;
  document.querySelectorAll("script[data-live-set-list-google-maps]").forEach(script => script.remove());
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

// 测试点：未选点时地图以东京默认点初始化镜头，但不创建代表真实选择的标记。
test("empty selection uses the Tokyo default viewport without a marker", async () => {
  render(<VenueLocationMap config={config} point={null} disabled={false}
    onPoint={vi.fn()} onPlaceId={vi.fn()} />);
  await waitFor(() => expect(fake.makeMap).toHaveBeenCalledTimes(1));
  expect(fake.makeMap).toHaveBeenCalledWith(expect.any(HTMLDivElement), expect.objectContaining({
    center: { lat: DEFAULT_GOOGLE_MAP_POINT.latitude, lng: DEFAULT_GOOGLE_MAP_POINT.longitude },
    zoom: 12,
    cameraControl: false,
    zoomControl: true,
    fullscreenControl: true,
  }));
  expect(fake.makeMarker).not.toHaveBeenCalled();
  expect(screen.getByText(/尚未选点/)).toBeInTheDocument();
});

// 测试点：loading=async 必须等待 Google callback，不能把 script load 事件当成 SDK 就绪。
test("async SDK loading initializes the map from the Google callback", async () => {
  resetGoogleMapSession();
  delete window.google;
  const props = { config, point: null, disabled: false, onPoint: vi.fn(), onPlaceId: vi.fn() };
  render(<VenueLocationMap {...props} />);

  const script = await waitFor(() => {
    const element = document.querySelector("script[data-live-set-list-google-maps]");
    expect(element).toBeInstanceOf(HTMLScriptElement);
    return element as HTMLScriptElement;
  });
  expect(new URL(script.src).searchParams.get("callback")).toBe("__liveSetListGoogleMapsReady");
  expect(fake.makeMap).not.toHaveBeenCalled();

  window.google = {
    maps: {
      Map: fake.makeMap,
      Marker: fake.makeMarker,
      event: { trigger: vi.fn() },
    },
  } as unknown as NonNullable<typeof window.google>;
  act(() => window.__liveSetListGoogleMapsReady?.());

  await waitFor(() => expect(fake.makeMap).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Google Maps 加载失败/)).not.toBeInTheDocument();
});
