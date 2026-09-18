import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VenueCreateSection } from "../VenueCreateSection";

const api = vi.hoisted(() => ({ createConsoleVenue: vi.fn(), getConsoleLocalities: vi.fn(), getConsoleTimezones: vi.fn(), getConsoleVenuePage: vi.fn() }));
vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));
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

// 测试点：完整位置在确认后一次提交，地区翻页保留完整标签，成功后清空且不嵌入管理界面。
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
  expect(screen.queryByRole("button", { name: "继续完善所在地与地图链接" })).not.toBeInTheDocument();
});

// 测试点：切换未公开会丢弃不允许的位置字段且新增类型不提供线上，不能把隐藏草稿提交到服务器。
test("clears fields forbidden by venue kind", async () => {
  const user = await setup();
  await user.selectOptions(screen.getByLabelText("已公布地区"), "1");
  await user.type(screen.getByLabelText("公开门牌地址"), "Secret address");
  await user.selectOptions(screen.getByLabelText("类型"), "undisclosed");
  expect(screen.getByLabelText("公开门牌地址")).toBeDisabled();
  expect(screen.getByLabelText("公开门牌地址")).toHaveValue("");
  expect(screen.getByLabelText("已公布地区")).toHaveValue("1");
  expect(within(screen.getByLabelText("类型")).getAllByRole("option").map(option => option.textContent)).toEqual(["实体场馆", "未公开"]);
  const dialog = await confirm(user);
  await user.click(dialog.getByRole("button", { name: "提交插入" }));
  expect(api.createConsoleVenue).toHaveBeenCalledWith("New Hall", "csrf", "undisclosed", expect.objectContaining({ locality_id: 1, address: null, latitude: null, timezone_id: null }));
});

// 测试点：创建失败保留草稿并在确认框展示错误；候选刷新失败明确已创建，不能提示重试创建。
test("preserves draft on failure and distinguishes refresh failure", async () => {
  const user = await setup(vi.fn().mockRejectedValue(new Error("refresh failed")));
  await user.type(screen.getByLabelText("纬度（WGS84）"), "35.6");
  await user.type(screen.getByLabelText("经度（WGS84）"), "139.7");
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Tokyo");
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

// 测试点：新增场地以六列表头和单行值录入，不查询历史场地，地图辅助默认收起。
test("uses a single input row without venue management controls", async () => {
  const user = await setup();
  const table = within(screen.getByRole("table", { name: "新增场地资料" }));
  expect(table.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
    "名称", "类型", "公开门牌地址", "纬度（WGS84）", "经度（WGS84）", "场馆精确时区",
  ]);
  expect(table.getAllByRole("row")).toHaveLength(2);
  const row = within(table.getAllByRole("row")[1]);
  expect(row.getAllByRole("cell")).toHaveLength(6);
  for (const label of ["名称", "类型", "公开门牌地址", "纬度（WGS84）", "经度（WGS84）", "场馆精确时区"]) {
    expect(row.getByLabelText(label)).toBeInTheDocument();
  }
  expect(table.queryByLabelText("已公布地区")).not.toBeInTheDocument();
  expect(screen.getByLabelText("已公布地区").closest(".live-create-tools")).not.toBeNull();
  expect(screen.getByLabelText("搜索地区").closest(".live-create-query-row")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "查询已有场地" })).not.toBeInTheDocument();
  expect(api.getConsoleVenuePage).not.toHaveBeenCalled();
  expect(screen.queryByText("地图选点组件")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "地图选点与自动解析" }));
  expect(screen.getByText("地图选点组件")).toBeInTheDocument();
  expect(table.queryByText("地图选点组件")).not.toBeInTheDocument();
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

// 测试点：实体场馆不能将空时区或旧的暂未核验选项作为有效值提交。
test("requires a verified timezone for physical venue creation", async () => {
  const user = await setup();
  await user.type(screen.getByLabelText("纬度（WGS84）"), "35.6");
  await user.type(screen.getByLabelText("经度（WGS84）"), "139.7");
  expect(screen.queryByRole("option", { name: "暂未核验" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Tokyo");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled();
});

// 测试点：加载失败保留错误文案，不增加专用重新加载按钮。
test("shows loading failure without a retry button", async () => {
  api.getConsoleLocalities.mockRejectedValue(new Error("登录状态已失效，请重新登录"));
  render(<VenueCreateSection onMessage={vi.fn()} onVenuesChanged={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("登录状态已失效，请重新登录");
  expect(screen.queryByRole("button", { name: "重新加载地区与时区" })).not.toBeInTheDocument();
});
