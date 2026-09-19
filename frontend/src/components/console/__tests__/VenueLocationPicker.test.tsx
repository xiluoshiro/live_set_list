import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueLocationPicker } from "../VenueLocationPicker";
import type { LocationPoint, LocationResolution } from "../../../api";

const api = vi.hoisted(() => ({ getGeographyCapabilities: vi.fn(), resolveGeography: vi.fn(), searchGeography: vi.fn() }));
vi.mock("../../../api", () => api);
vi.mock("../VenueLocationMap", () => ({ VenueLocationMap: ({ onPoint }: { onPoint: (point: LocationPoint) => void }) => <>
  <button onClick={() => onPoint({ latitude: 35, longitude: 139 })}>测试点选</button>
  <button onClick={() => onPoint({ latitude: 40, longitude: -74 })}>测试拖动</button>
</> }));

function Harness({ initialTimezone = "" }: { initialTimezone?: string }) {
  const [point, setPoint] = useState<LocationPoint | null>(null);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [address, setAddress] = useState("原地址");
  const [review, setReview] = useState(false);
  return <><input aria-label="当前时区" value={timezone} onChange={e => setTimezone(e.target.value)} />
    <input aria-label="当前地址" value={address} onChange={e => setAddress(e.target.value)} />
    <button disabled={review}>模拟保存</button>
    <VenueLocationPicker venueId={1} venueName="Hall" csrf="csrf" disabled={false} point={point} savedPoint={null}
      timezone={timezone} address={address} locality={null} onPoint={setPoint} onTimezone={setTimezone}
      onAddress={setAddress} onLocality={vi.fn()} onReview={setReview} />
  </>;
}
function resolved(point: LocationPoint, id: string, zone = "Asia/Tokyo"): LocationResolution {
  return { ...point, request_id: id, timezone: { status: "ready", timezone_id: zone, message: null }, address: null, localities: [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getGeographyCapabilities.mockResolvedValue({ tile_url: "https://tile.test/{z}/{x}/{y}", attribution: "OSM", geocoding: true, timezone: true });
  api.resolveGeography.mockImplementation((point: LocationPoint, _parts: string, id: string) => Promise.resolve(resolved(point, id)));
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
  api.searchGeography.mockResolvedValue({ status: "ready", message: null, items: [{ name: "Hall", address: "address", latitude: 35, longitude: 139 }] });
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole("button", { name: "搜索位置" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "搜索位置" }));
  await screen.findByRole("button", { name: "选择此位置" });
  expect(api.resolveGeography).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "选择此位置" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  expect(screen.getByRole("button", { name: "模拟保存" })).toBeEnabled();
});

// 测试点：坐标解析成功后直接覆盖已有时区，不要求用户处理冲突提示。
test("resolved timezone replaces an existing timezone", async () => {
  render(<Harness initialTimezone="America/New_York" />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  expect(screen.getByText("已按位置设置时区：Asia/Tokyo")).toBeInTheDocument();
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
  const signal = api.resolveGeography.mock.calls[0][4] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "测试拖动" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("America/New_York"));
  expect(signal.aborted).toBe(true);
  await act(async () => finishOld?.(resolved({ latitude: 35, longitude: 139 }, oldId)));
  expect(screen.getByLabelText("当前时区")).toHaveValue("America/New_York");
});

// 测试点：地址查询期间的手工编辑不被覆盖，没有地区匹配时不自动登记地区。
test("address suggestions cannot overwrite an intervening edit", async () => {
  let finish: ((value: LocationResolution) => void) | undefined;
  let requestId = "";
  api.resolveGeography.mockImplementation((point: LocationPoint, parts: string, id: string) => {
    if (parts === "timezone") return Promise.resolve(resolved(point, id));
    requestId = id; return new Promise<LocationResolution>(resolve => { finish = resolve; });
  });
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  fireEvent.click(screen.getByRole("button", { name: "解析此位置" }));
  fireEvent.change(screen.getByLabelText("当前地址"), { target: { value: "手工纠正" } });
  await act(async () => finish?.({ ...resolved({ latitude: 35, longitude: 139 }, requestId), address: {
    status: "ready", message: null, attribution: "OSM", attribution_url: "https://www.openstreetmap.org/copyright",
    items: [{ name: "Hall", address: "附近地址", latitude: 35, longitude: 139, country_code: "JP", admin_area: null, locality_name: null }],
  } }));
  expect(screen.getByRole("button", { name: "采用地址建议" })).toBeDisabled();
  expect(screen.getByText(/不会自动新增地区/)).toBeInTheDocument();
  expect(screen.getByLabelText("当前地址")).toHaveValue("手工纠正");
});

// 测试点：清空或复位后放弃自动填充的旧时区，组件卸载取消在途请求。
test("reset invalidates an automatically filled timezone and unmount aborts", async () => {
  const view = render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "测试点选" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue("Asia/Tokyo"));
  fireEvent.click(screen.getByRole("button", { name: "回到已保存位置" }));
  await waitFor(() => expect(screen.getByLabelText("当前时区")).toHaveValue(""));
  const signal = api.getGeographyCapabilities.mock.calls[0][0] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
