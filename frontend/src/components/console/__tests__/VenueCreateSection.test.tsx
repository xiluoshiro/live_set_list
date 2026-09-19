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
  api.getConsoleLocalities.mockResolvedValue({ items: [city], total: 1, page: 1, page_size: 20 });
  api.getConsoleTimezones.mockResolvedValue(["Asia/Tokyo", "Asia/Shanghai"]);
  api.createConsoleVenue.mockResolvedValue({ ok: true, item: { venue_id: 88, venue_name: "New Hall", venue_kind: "physical" } });
  api.getConsoleVenuePage.mockResolvedValue({ items: [{ venue_id: 1, venue_name: "Hall", matched_name: "Old Hall", venue_kind: "physical" }], total: 1, page: 1, total_pages: 1 });
});
async function setup(onVenuesChanged = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<VenueCreateSection onMessage={vi.fn()} onVenuesChanged={onVenuesChanged} />);
  await waitFor(() => expect(screen.getByLabelText("已公布地区")).toHaveTextContent("JP / 東京都"));
  await user.type(screen.getByLabelText("名称"), "New Hall");
  await user.type(screen.getByLabelText("公开门牌地址"), "Tokyo address");
  return user;
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  return within(screen.getByRole("dialog", { name: "确认新增场馆" }));
}

// 测试点：完整位置在确认后一次提交，地区搜索保留完整标签，成功后恢复默认值且不嵌入管理界面。
test("creates complete location after preview and retains selection across searches", async () => {
  const user = await setup();
  api.getConsoleLocalities.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 20 });
  await user.type(screen.getByLabelText("搜索地区"), "missing");
  await user.click(screen.getByRole("button", { name: "查询" }));
  await waitFor(() => expect(api.getConsoleLocalities).toHaveBeenLastCalledWith("missing", 1));
  expect(screen.getByLabelText("已公布地区")).toHaveTextContent("JP / 東京都");
  await user.click(screen.getByLabelText("已公布地区"));
  expect(screen.getByRole("radio", { name: "JP / 東京都" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "JP / 東京都" }));
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
    locality_id: 1, address: "Tokyo address", latitude: 35.6, longitude: 139.7, timezone_id: "Asia/Tokyo",
    coordinate_system: "WGS84", google_place: null,
  }));
  expect(screen.getByLabelText("名称")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "继续完善所在地与地图链接" })).not.toBeInTheDocument();
});

// 测试点：切换未公开会丢弃不允许的位置字段且新增类型不提供线上，不能把隐藏草稿提交到服务器。
test("clears fields forbidden by venue kind", async () => {
  const user = await setup();
  await user.type(screen.getByLabelText("公开门牌地址"), "Secret address");
  await user.selectOptions(screen.getByLabelText("类型"), "undisclosed");
  expect(screen.getByLabelText("公开门牌地址")).toBeDisabled();
  expect(screen.getByLabelText("公开门牌地址")).toHaveValue("");
  expect(screen.getByLabelText("已公布地区")).toHaveTextContent("JP / 東京都");
  expect(within(screen.getByLabelText("类型")).getAllByRole("option").map(option => option.textContent)).toEqual(["实体场馆", "未公开"]);
  const dialog = await confirm(user);
  await user.click(dialog.getByRole("button", { name: "提交插入" }));
  expect(api.createConsoleVenue).toHaveBeenCalledWith("New Hall", "csrf", "undisclosed", expect.objectContaining({ locality_id: 1, address: null, latitude: null, timezone_id: "Asia/Tokyo" }));
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

// 测试点：新增场馆以六列表头和单行值录入，不查询历史场馆，地图辅助默认收起。
test("uses a single input row without venue management controls", async () => {
  const user = await setup();
  const table = within(screen.getByRole("table", { name: "新增场馆资料" }));
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
  expect(screen.queryByRole("button", { name: "查询已有场馆" })).not.toBeInTheDocument();
  expect(api.getConsoleVenuePage).not.toHaveBeenCalled();
  expect(screen.queryByText("地图选点组件")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "地图选点" }));
  expect(screen.getByText("地图选点组件")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "收起地图" })).toBeInTheDocument();
  expect(table.queryByText("地图选点组件")).not.toBeInTheDocument();
});

// 测试点：场馆时区独立于地区，允许填写不同 IANA。
test("allows venue timezone independently of locality", async () => {
  const user = await setup();
  await user.type(screen.getByLabelText("纬度（WGS84）"), "0");
  await user.type(screen.getByLabelText("经度（WGS84）"), "0");
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Shanghai");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Tokyo");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled();
});

// 测试点：默认东京地区和时区；实体地址空白不能提交，切换类型保留时区，清空恢复默认时区。
test("defaults to Tokyo and requires a nonblank physical address", async () => {
  const user = await setup();
  expect(screen.getByLabelText("场馆精确时区")).toHaveValue("Asia/Tokyo");
  expect(screen.getByLabelText("公开门牌地址")).toBeRequired();
  await user.type(screen.getByLabelText("纬度（WGS84）"), "35.6");
  await user.type(screen.getByLabelText("经度（WGS84）"), "139.7");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeEnabled();
  await user.clear(screen.getByLabelText("公开门牌地址"));
  await user.type(screen.getByLabelText("公开门牌地址"), "   ");
  expect(screen.getByRole("button", { name: "提交插入" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("场馆精确时区"), "Asia/Shanghai");
  await user.selectOptions(screen.getByLabelText("类型"), "undisclosed");
  expect(screen.getByLabelText("公开门牌地址")).not.toBeRequired();
  expect(screen.getByLabelText("场馆精确时区")).toBeEnabled();
  await user.selectOptions(screen.getByLabelText("类型"), "physical");
  expect(screen.getByLabelText("场馆精确时区")).toHaveValue("Asia/Shanghai");
  await user.click(screen.getByRole("button", { name: "清空" }));
  expect(screen.getByLabelText("已公布地区")).toHaveTextContent("JP / 東京都");
  expect(screen.getByLabelText("场馆精确时区")).toHaveValue("Asia/Tokyo");
});

// 测试点：默认东京不依赖地区第一页，全部分页候选在同款单选菜单内可选。
test("finds default Tokyo on a later page without external pagination", async () => {
  const other = { ...city, id: 2, admin_area: "大阪府" };
  api.getConsoleLocalities.mockImplementation(async (_q: string, page: number) => ({
    items: page === 1 ? [other] : [city], total: 2, page, page_size: 1,
  }));
  const user = await setup();
  expect(api.getConsoleLocalities).toHaveBeenCalledWith("", 2);
  expect(screen.queryByRole("button", { name: /上一页|下一页/ })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("已公布地区"));
  await user.click(screen.getByRole("radio", { name: "JP / 大阪府" }));
  expect(screen.getByLabelText("已公布地区")).toHaveTextContent("JP / 大阪府");
  expect(screen.getByLabelText("已公布地区")).toHaveAttribute("aria-expanded", "false");
});

// 测试点：加载失败保留错误文案，不增加专用重新加载按钮。
test("shows loading failure without a retry button", async () => {
  api.getConsoleLocalities.mockRejectedValue(new Error("登录状态已失效，请重新登录"));
  render(<VenueCreateSection onMessage={vi.fn()} onVenuesChanged={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("登录状态已失效，请重新登录");
  expect(screen.queryByRole("button", { name: "重新加载地区与时区" })).not.toBeInTheDocument();
});
