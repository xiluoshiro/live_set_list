import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueLocationPicker } from "../VenueLocationPicker";
import type { GeoLocality, LocationPoint, LocationResolution } from "../../../api";

const api = vi.hoisted(() => ({ getGeographyCapabilities: vi.fn(), resolveGeography: vi.fn(), resolveGooglePlace: vi.fn(), searchGeography: vi.fn() }));
vi.mock("../../../api", () => api);
vi.mock("../VenueLocationMap", () => ({ VenueLocationMap: ({ onPoint, onPlaceId }: { onPoint: (point: LocationPoint) => void; onPlaceId: (id: string) => void }) => <>
  <button onClick={() => onPoint({ latitude: 35, longitude: 139 })}>测试点选</button>
  <button onClick={() => onPoint({ latitude: 40, longitude: -74 })}>测试拖动</button>
  <button onClick={() => onPlaceId("place-1")}>测试POI</button>
</> }));

function Harness({ initialTimezone = "", initialAddress = "原地址", newVenue = false }: {
  initialTimezone?: string; initialAddress?: string; newVenue?: boolean;
}) {
  const [point, setPoint] = useState<LocationPoint | null>(null);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [address, setAddress] = useState(initialAddress);
  const [locality, setLocality] = useState<GeoLocality | null>(null);
  const [googlePlace, setGooglePlace] = useState("");
  const [review, setReview] = useState(false);
  return <><input aria-label="当前时区" value={timezone} onChange={e => setTimezone(e.target.value)} />
    <input aria-label="当前地址" value={address} onChange={e => setAddress(e.target.value)} />
    <button disabled={review}>模拟保存</button>
    <output aria-label="Google Place">{googlePlace}</output>
    <output aria-label="当前地区">{locality?.id ?? ""}</output>
    <VenueLocationPicker venueId={newVenue ? undefined : 1} venueName="Hall" csrf="csrf" disabled={false} point={point} savedPoint={null}
      timezone={timezone} address={address} locality={locality} onPoint={setPoint} onTimezone={setTimezone}
      onAddress={setAddress} onLocality={setLocality} onGooglePlace={place => setGooglePlace(place?.provider_place_id ?? "")} onReview={setReview} />
  </>;
}
function resolved(point: LocationPoint, id: string, zone = "Asia/Tokyo"): LocationResolution {
  return { ...point, request_id: id, timezone: { status: "ready", timezone_id: zone, message: null }, address: null, localities: [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getGeographyCapabilities.mockResolvedValue({ google_maps_browser_api_key: "browser-key", geocoding: true, timezone: true });
  api.resolveGeography.mockImplementation((point: LocationPoint, _parts: string, id: string) => Promise.resolve(resolved(point, id)));
  api.resolveGooglePlace.mockResolvedValue({ status: "ready", message: null, attribution: "Google Maps", attribution_url: "https://maps.google.com/",
    items: [{ name: "Google Hall", address: "Google address", latitude: 35.1, longitude: 139.1, country_code: "JP",
      admin_area: "東京都", locality_name: null, provider_place_id: "place-1",
      provider_url: "https://www.google.com/maps/search/?api=1&query_place_id=place-1" }] });
});

// 测试点：新建场馆无地址且未选点时显示等待选择提示，查询可用且不出现清除位置操作。
test("shows empty address and available search for a new venue", async () => {
  render(<Harness newVenue initialAddress="" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "清除位置" })).not.toBeInTheDocument();
  expect(screen.getByText("选择后将在这里显示地址。", { exact: true })).toBeInTheDocument();
});

// 测试点：新建场馆的默认地图镜头不会被当作真实选点或触发坐标解析。
test("new venue keeps its location empty until the user selects a point", async () => {
  const onPoint = vi.fn();
  render(<VenueLocationPicker venueName="" csrf="csrf" disabled={false} point={null} savedPoint={null}
    timezone="Asia/Tokyo" address="" locality={null} onPoint={onPoint} onTimezone={vi.fn()}
    onAddress={vi.fn()} onLocality={vi.fn()} onName={vi.fn()} onGooglePlace={vi.fn()} onReview={vi.fn()} />);
  await waitFor(() => expect(api.getGeographyCapabilities).toHaveBeenCalled());
  expect(onPoint).not.toHaveBeenCalled();
  expect(api.resolveGeography).not.toHaveBeenCalled();
  expect(screen.getByText("等待选择位置")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

// 测试点：地图配置失败结束加载提示，不阻止手工维护。
test("configuration failure does not leave a permanent loading state", async () => {
  api.getGeographyCapabilities.mockRejectedValue(new Error("服务不可用"));
  render(<Harness />);
  await screen.findByText("地图暂不可用，可继续输入经纬度。");
  expect(screen.queryByText(/地图配置加载中/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "模拟保存" })).toBeEnabled();
});

// 测试点：无旧坐标可搜索，搜索不默选；点选后自动设置坐标对应的时区。
test("search without saved coordinates and fill an empty timezone", async () => {
  api.searchGeography.mockResolvedValue({ status: "ready", message: null, attribution: "Google Maps", attribution_url: "https://maps.google.com/",
    items: [{ name: "Hall", address: "address", latitude: 35, longitude: 139, country_code: "JP", admin_area: null,
      locality_name: null, provider_place_id: "place-1", provider_url: "https://www.google.com/maps/search/?api=1&query_place_id=place-1" }] });
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole("button", { name: "查询" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
  const candidate = await screen.findByRole("button", { name: /Hall.*address/ });
  expect(api.resolveGeography).not.toHaveBeenCalled();
  fireEvent.click(candidate);
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  expect(screen.getByText("已匹配 Google 地点")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "模拟保存" })).toBeEnabled();
});

// 测试点：点击 Google POI 后直接采用 Place Details 的地址、坐标和场馆链接，不弹出冲突选择。
test("POI click directly fills Google place data", async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试POI" }));
  await waitFor(() => expect(screen.getByLabelText("Google Place")).toHaveTextContent("place-1"));
  expect(screen.getByLabelText("当前地址")).toHaveValue("Google address");
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  expect(api.resolveGooglePlace).toHaveBeenCalledWith("place-1", expect.stringMatching(/^place-1-/), null, "csrf", expect.any(AbortSignal));
});

// 测试点：坐标解析成功后直接覆盖已有时区，不要求用户处理冲突提示。
test("resolved timezone replaces an existing timezone", async () => {
  render(<Harness initialTimezone="America/New_York" />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  expect(screen.getByText("Asia/Tokyo")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "采用建议时区" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保留当前时区" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "模拟保存" })).toBeEnabled());
});

// 测试点：拖动后的新结果优先，已取消请求即使晚到也不能覆盖坐标对应的时区。
test("late response cannot overwrite a newer point", async () => {
  let finishOld: ((value: LocationResolution) => void) | undefined;
  let oldId = "";
  api.resolveGeography.mockImplementation((point: LocationPoint, _parts: string, id: string) => {
    if (point.latitude === 35) { oldId = id; return new Promise<LocationResolution>(resolve => { finishOld = resolve; }); }
    return Promise.resolve(resolved(point, id, "America/New_York"));
  });
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(api.resolveGeography).toHaveBeenCalledTimes(1));
  const signal = api.resolveGeography.mock.calls[0][5] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "测试拖动" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("America/New_York"));
  expect(signal.aborted).toBe(true);
  await act(async () => finishOld?.(resolved({ latitude: 35, longitude: 139 }, oldId)));
  expect(screen.getByLabelText("当前时区")).toHaveValue("America/New_York");
});

// 测试点：地图选点会自动解析地址，但查询期间的手工编辑不会被晚到结果覆盖。
test("map point resolves address without overwriting an intervening edit", async () => {
  let finish: ((value: LocationResolution) => void) | undefined;
  let requestId = "";
  api.resolveGeography.mockImplementation((point: LocationPoint, parts: string, id: string) => {
    if (parts === "timezone") return Promise.resolve(resolved(point, id));
    requestId = id; return new Promise<LocationResolution>(resolve => { finish = resolve; });
  });
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  fireEvent.change(screen.getByLabelText("当前地址"), { target: { value: "手工纠正" } });
  await act(async () => finish?.({ ...resolved({ latitude: 35, longitude: 139 }, requestId), address: {
    status: "ready", message: null, attribution: "Google Maps", attribution_url: "https://maps.google.com/",
    items: [{ name: "Hall", address: "附近地址", latitude: 35, longitude: 139, country_code: "JP", admin_area: null,
      locality_name: null, provider_place_id: null, provider_url: null }],
  } }));
  expect(screen.getByLabelText("当前地址")).toHaveValue("手工纠正");
  expect(screen.queryByRole("button", { name: "解析此位置" })).not.toBeInTheDocument();
});

// 测试点：地图选点解析成功后直接采用地址和最匹配的已登记地区，不增加确认步骤。
test("map point automatically fills address and locality", async () => {
  api.resolveGeography.mockImplementation((point: LocationPoint, parts: string, id: string) => Promise.resolve(parts === "timezone" ? resolved(point, id) : {
    ...resolved(point, id),
    address: { status: "ready", message: null, attribution: "Google Maps", attribution_url: "https://maps.google.com/", items: [{
      name: "Hall", address: "東京都千代田区千代田1-1", latitude: 35, longitude: 139, country_code: "JP",
      admin_area: "東京都", locality_name: "千代田区", provider_place_id: null, provider_url: null,
    }] },
    localities: [{ id: 18, country_code: "JP", admin_area: "東京都", locality_name: "千代田区", area_level: "locality", state_token: "token" }],
  }));
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前地址")).toHaveValue("東京都千代田区千代田1-1"));
  expect(screen.getByLabelText("当前地区")).toHaveTextContent("18");
  expect(screen.getByText("地址与地区已自动解析")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /采用/ })).not.toBeInTheDocument();
});

// 测试点：清空或复位后放弃自动填充的旧时区，组件卸载取消在途请求。
test("reset invalidates an automatically filled timezone and unmount aborts", async () => {
  const view = render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  fireEvent.click(screen.getByRole("button", { name: "复位" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue(""));
  const signal = api.getGeographyCapabilities.mock.calls[0][0] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
