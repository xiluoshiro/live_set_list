import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueLocationMap } from "../VenueLocationMap";

const fake = vi.hoisted(() => {
  const handlers: Record<string, (event?: unknown) => void> = {};
  const map = { setView: vi.fn(), remove: vi.fn(), invalidateSize: vi.fn(), getBounds: () => ({ contains: () => true }), getZoom: () => 16,
    on: vi.fn((event: string, handler: (event?: unknown) => void) => { handlers[event] = handler; }) };
  const marker = { addTo: vi.fn(), setLatLng: vi.fn(), remove: vi.fn(), dragging: { enable: vi.fn(), disable: vi.fn() },
    on: vi.fn((event: string, handler: (event?: unknown) => void) => { handlers[event] = handler; }),
    getLatLng: () => ({ wrap: () => ({ lat: 35.12345678, lng: -179.98765432 }) }) };
  marker.addTo.mockReturnValue(marker);
  const tile = { on: vi.fn(), addTo: vi.fn() }; tile.on.mockReturnValue(tile);
  return { handlers, map, marker, tile, makeMarker: vi.fn(() => marker), makeMap: vi.fn(() => map) };
});
vi.mock("leaflet", () => ({ map: fake.makeMap, marker: fake.makeMarker, tileLayer: () => fake.tile, divIcon: vi.fn() }));
const config = { tile_url: "https://tile.test/{z}/{x}/{y}", attribution: "OSM", geocoding: true, timezone: true };
beforeEach(() => { vi.clearAllMocks(); Object.keys(fake.handlers).forEach(key => delete fake.handlers[key]); });

// 测试点：地图中心不等于已选坐标，点选和拖动传递六位 WGS84；禁用和卸载正确清理。
test("click and drag emit a draft point and respect disabled state", async () => {
  const onPoint = vi.fn();
  const view = render(<VenueLocationMap config={config} point={null} disabled={false} onPoint={onPoint} />);
  await waitFor(() => expect(fake.handlers.click).toBeDefined());
  expect(onPoint).not.toHaveBeenCalled();
  expect(screen.getByText(/尚未选点/)).toBeInTheDocument();
  act(() => fake.handlers.click({ latlng: { lat: 35.12345678, wrap: () => ({ lng: -179.98765432 }) } }));
  expect(onPoint).toHaveBeenLastCalledWith({ latitude: 35.123457, longitude: -179.987654 });
  view.rerender(<VenueLocationMap config={config} point={{ latitude: 35, longitude: 139 }} disabled={false} onPoint={onPoint} />);
  await waitFor(() => expect(fake.handlers.dragend).toBeDefined());
  act(() => fake.handlers.dragend());
  expect(onPoint).toHaveBeenCalledTimes(2);
  view.rerender(<VenueLocationMap config={config} point={{ latitude: 35, longitude: 139 }} disabled={true} onPoint={onPoint} />);
  act(() => fake.handlers.dragend());
  expect(onPoint).toHaveBeenCalledTimes(2);
  expect(fake.marker.dragging.disable).toHaveBeenCalled();
  view.unmount();
  expect(fake.map.remove).toHaveBeenCalledTimes(1);
});

// 测试点：手工坐标同步标记，极区坐标保持原值并隐藏无法显示的标记。
test("manual input moves the marker and polar coordinates remain unchanged", async () => {
  const onPoint = vi.fn();
  const view = render(<VenueLocationMap config={config} point={{ latitude: 35, longitude: 139 }} disabled={false} onPoint={onPoint} />);
  await waitFor(() => expect(fake.makeMarker).toHaveBeenCalled());
  view.rerender(<VenueLocationMap config={config} point={{ latitude: 40, longitude: -74 }} disabled={false} onPoint={onPoint} />);
  expect(fake.marker.setLatLng).toHaveBeenCalledWith([40, -74]);
  view.rerender(<VenueLocationMap config={config} point={{ latitude: 89, longitude: 20 }} disabled={false} onPoint={onPoint} />);
  expect(screen.getByText(/已保留输入坐标/)).toBeInTheDocument();
  expect(fake.marker.remove).toHaveBeenCalled();
  expect(onPoint).not.toHaveBeenCalled();
});
