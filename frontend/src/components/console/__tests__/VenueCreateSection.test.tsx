import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueCreateSection } from "../VenueCreateSection";

const api = vi.hoisted(() => ({ createConsoleVenue: vi.fn(), getConsoleLocalities: vi.fn(), getConsoleTimezones: vi.fn(), getConsoleVenuePage: vi.fn() }));
vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));
vi.mock("../VenueLocationPanel", () => ({ VenueLocationPanel: ({ venueId }: { venueId: number }) => <p>位置管理 #{venueId}</p> }));
vi.mock("../VenueLocationPicker", () => ({ VenueLocationPicker: () => <p>地图选点组件</p> }));
const city = { id: 1, country_code: "JP", admin_area: "東京都", locality_name: null, timezone_id: "Asia/Tokyo", area_level: "admin_area", state_token: "a".repeat(64) };
beforeEach(() => {
  vi.resetAllMocks();
  api.getConsoleLocalities.mockResolvedValue({ items: [city], total: 21, page: 1, page_size: 20 });
  api.getConsoleTimezones.mockResolvedValue(["Asia/Tokyo", "Asia/Shanghai"]);
  api.createConsoleVenue.mockResolvedValue({ ok: true, item: { venue_id: 88, venue_name: "New Hall", venue_kind: "physical" } });
  api.getConsoleVenuePage.mockResolvedValue({ items: [{ venue_id: 1, venue_name: "Hall", matched_name: "Old Hall", venue_kind: "physical" }], total: 1, page: 1, total_pages: 1 });
});
async function setup(onVenuesChanged = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<VenueCreateSection onMessage={vi.fn()} onVenuesChanged={onVenuesChanged} />);
  await screen.findByRole("option", { name: "JP / 東京都" });
  await user.type(screen.getByLabelText("名称"), "New Hall");
  return user;
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  return within(screen.getByRole("dialog", { name: "确认新增场地" }));
}

// 测试点：完整位置在确认后一次提交，地区翻页保留完整标签，成功后可继续地图维护。
test("creates complete location after preview and retains selection across pages", async () => {
  const user = await setup();
  await user.selectOptions(screen.getByLabelText("已公布地区"), "1");
  api.getConsoleLocalities.mockResolvedValueOnce({ items: [], total: 21, page: 2, page_size: 20 });
  await user.click(screen.getByRole("button", { name: "下一页地区" }));
  await waitFor(() => expect(api.getConsoleLocalities).toHaveBeenLastCalledWith("", 2));
  expect(screen.getByLabelText("已公布地区")).toHaveValue("1");
  expect(screen.getByRole("option", { name: "JP / 東京都" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("公开门牌地址"), "Tokyo address");
  await user.type(screen.getByLabelText("纬度（WGS84）"), "35.6");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  await user.type(screen.getByLabelText("经度（WGS84）"), "139.7");
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Tokyo");
  const dialog = await confirm(user);
  expect(dialog.getByRole("table")).toHaveTextContent("Tokyo address");
  expect(dialog.getByRole("table")).toHaveTextContent("35.6, 139.7");
  expect(api.createConsoleVenue).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "提交插入" }));
  await waitFor(() => expect(api.createConsoleVenue).toHaveBeenCalledWith("New Hall", "csrf", "physical", {
    locality_id: 1, address: "Tokyo address", latitude: 35.6, longitude: 139.7, timezone_id: "Asia/Tokyo", coordinate_system: "WGS84",
  }));
  expect(screen.getByLabelText("名称")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "继续完善所在地与地图链接" }));
  expect(screen.getByText("位置管理 #88")).toBeInTheDocument();
});

// 测试点：切换未公开与线上会丢弃不允许的位置字段，不能把隐藏草稿提交到服务器。
test("clears fields forbidden by venue kind", async () => {
  const user = await setup();
  await user.selectOptions(screen.getByLabelText("已公布地区"), "1");
  await user.type(screen.getByLabelText("公开门牌地址"), "Secret address");
  await user.selectOptions(screen.getByLabelText("类型"), "undisclosed");
  expect(screen.queryByLabelText("公开门牌地址")).not.toBeInTheDocument();
  expect(screen.getByLabelText("已公布地区")).toHaveValue("1");
  await user.selectOptions(screen.getByLabelText("类型"), "online");
  expect(screen.queryByLabelText("已公布地区")).not.toBeInTheDocument();
  const dialog = await confirm(user);
  await user.click(dialog.getByRole("button", { name: "提交插入" }));
  expect(api.createConsoleVenue).toHaveBeenCalledWith("New Hall", "csrf", "online", expect.objectContaining({ locality_id: null, address: null, latitude: null, timezone_id: null }));
});

// 测试点：创建失败保留草稿并在确认框展示错误；候选刷新失败明确已创建，不能提示重试创建。
test("preserves draft on failure and distinguishes refresh failure", async () => {
  const user = await setup(vi.fn().mockRejectedValue(new Error("refresh failed")));
  await user.click(screen.getByLabelText("新增成功后清空表单"));
  api.createConsoleVenue.mockRejectedValueOnce(new Error("duplicate name"));
  let dialog = await confirm(user);
  await user.click(dialog.getByRole("button", { name: "提交插入" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("duplicate name");
  expect(screen.getByLabelText("名称")).toHaveValue("New Hall");
  await user.click(dialog.getByRole("button", { name: "提交插入" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText(/无需重复提交/)).toBeInTheDocument();
  expect(screen.getByLabelText("名称")).toHaveValue("New Hall");
});

// 测试点：已有场地查询显示历史匹配名称且不写入；地图选点使用现有组件。
test("looks up historical names and opens the shared map picker", async () => {
  const user = await setup();
  await user.click(screen.getByRole("button", { name: "查询已有场地" }));
  expect(await screen.findByRole("table", { name: "已有场地查询结果" })).toHaveTextContent("Old Hall");
  expect(api.getConsoleVenuePage).toHaveBeenCalledWith("New Hall", 1, 20);
  expect(api.createConsoleVenue).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "地图选点与自动解析" }));
  expect(screen.getByText("地图选点组件")).toBeInTheDocument();
});

// 测试点：地区与场馆时区冲突必须阻止创建，修正后允许确认。
test("blocks mismatched locality timezone", async () => {
  const user = await setup();
  await user.selectOptions(screen.getByLabelText("已公布地区"), "1");
  await user.type(screen.getByLabelText("纬度（WGS84）"), "0");
  await user.type(screen.getByLabelText("经度（WGS84）"), "0");
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Shanghai");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Tokyo");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled();
});
