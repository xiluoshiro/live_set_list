import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { VenueAdminSection } from "../VenueAdminSection";


const apiMocks = vi.hoisted(() => ({
  getConsoleVenueLocation: vi.fn(),
  previewConsoleVenueEdit: vi.fn(),
  saveConsoleVenueEdit: vi.fn(),
  getConsoleVenuePage: vi.fn(),
  getConsoleLocalities: vi.fn(),
  getConsoleTimezones: vi.fn(),
  getConsoleVenue: vi.fn(),
  createConsoleVenue: vi.fn(),
  updateConsoleVenueKind: vi.fn(),
  createConsoleVenueNameVersion: vi.fn(),
}));

vi.mock("../../../api", () => apiMocks);
vi.mock("../../../auth/AuthProvider", () => ({
  useAuth: () => ({ csrfToken: "csrf-token", user: { role: "admin" } }),
}));

const venueItems = [
  { venue_id: 2, venue_name: "Second Hall", venue_name_version_id: 22, venue_kind: "online" as const },
  { venue_id: 1, venue_name: "First Hall", venue_name_version_id: 11, venue_kind: "physical" as const },
];

const details = {
  1: {
    venue_id: 1,
    venue_name: "First Hall",
    venue_name_version_id: 11,
    venue_kind: "physical" as const,
    merged_into_venue_id: null,
    live_count: 3,
    first_live_date: "2020-01-01",
    last_live_date: "2024-01-01",
    name_versions: [
      {
        venue_name_version_id: 10,
        venue_name: "Old First Hall",
        valid_from: "2020-01-01",
        valid_to: "2022-06-01",
        live_count: 2,
        schedule_history_count: 1,
        is_current: false,
      },
      {
        venue_name_version_id: 11,
        venue_name: "First Hall",
        valid_from: "2022-06-01",
        valid_to: null,
        live_count: 1,
        schedule_history_count: 0,
        is_current: true,
      },
    ],
  },
  2: {
    venue_id: 2,
    venue_name: "Second Hall",
    venue_name_version_id: 22,
    venue_kind: "online" as const,
    merged_into_venue_id: null,
    live_count: 4,
    first_live_date: "2021-01-01",
    last_live_date: "2025-01-01",
    name_versions: [{
      venue_name_version_id: 22,
      venue_name: "Second Hall",
      valid_from: "2021-01-01",
      valid_to: null,
      live_count: 4,
      schedule_history_count: 2,
      is_current: true,
    }],
  },
};

const location = { venue_id: 1, locality: null, address: "Saved address", latitude: null, longitude: null,
  timezone_id: "Asia/Tokyo", coordinate_system: "WGS84", state_token: "a".repeat(64), map_links: [] };

function installPagedVenues() {
  apiMocks.getConsoleVenuePage.mockImplementation((_q: string, page: number) => Promise.resolve({
    items: page === 1 ? [venueItems[1]] : [venueItems[0]],
    page,
    page_size: 20,
    total: 2,
    total_pages: 2,
  }));
  apiMocks.getConsoleVenue.mockImplementation((venueId: 1 | 2) => Promise.resolve(details[venueId]));
}

function renderSection(onMessage = vi.fn(), onVenuesChanged = vi.fn().mockResolvedValue(undefined), variant: "create" | "edit" = "edit") {
  render(<VenueAdminSection variant={variant} onMessage={onMessage} onVenuesChanged={onVenuesChanged} />);
  return { onMessage, onVenuesChanged };
}

describe("VenueAdminSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installPagedVenues();
    apiMocks.getConsoleLocalities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
    apiMocks.getConsoleTimezones.mockResolvedValue(["Asia/Tokyo"]);
    apiMocks.getConsoleVenueLocation.mockResolvedValue(location);
    apiMocks.previewConsoleVenueEdit.mockImplementation((_id, payload) => Promise.resolve(payload));
    apiMocks.saveConsoleVenueEdit.mockResolvedValue({ detail: details[1], location });
  });

  // 测试点：场馆管理只读取当前分页，并提供搜索和翻页入口，避免一次加载全部 Venue。
  test("loads a searchable paginated Venue selector", async () => {
    const user = userEvent.setup();
    renderSection();

    const selector = await screen.findByLabelText("已有 Venue");
    expect(within(selector).getAllByRole("option")).toHaveLength(1);
    expect(selector).toHaveValue("1");
    const history = await screen.findByRole("table", { name: "Venue 历史名称" });
    expect(history).toHaveTextContent("First Hall");
    expect(within(history).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByLabelText("搜索场馆")).toBeInTheDocument();
    expect(screen.getByText(/共 2 个场馆/)).toBeInTheDocument();
    expect(apiMocks.getConsoleVenuePage).toHaveBeenCalledWith("", 1, 20);
    await user.type(screen.getByLabelText("搜索场馆"), "First");
    await user.click(screen.getAllByRole("button", { name: "查询" })[0]);
    await waitFor(() => expect(apiMocks.getConsoleVenuePage).toHaveBeenLastCalledWith("First", 1, 20));
  });

  // 测试点：切换 Venue 后仅加载目标详情，并让历史名称区跟随当前选择更新。
  test("loads the selected Venue detail", async () => {
    const user = userEvent.setup();
    renderSection();
    const selector = await screen.findByLabelText("已有 Venue");
    await waitFor(() => expect(selector).toHaveValue("1"));

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByRole("table", { name: "Venue 历史名称" })).toHaveTextContent("Second Hall");
    expect(apiMocks.getConsoleVenue).toHaveBeenLastCalledWith(2);
  });

  // 测试点：新增场馆是独立页面，确认前不写入，提交后刷新其它场馆候选数据。
  test("creates only after confirmation in the create variant", async () => {
    const user = userEvent.setup();
    apiMocks.createConsoleVenue.mockResolvedValue({ ok: true, item: { venue_id: 3, venue_name: "Third Hall" } });
    const onMessage = vi.fn();
    const onVenuesChanged = vi.fn().mockResolvedValue(undefined);
    renderSection(onMessage, onVenuesChanged, "create");

    const createBlock = screen.getByRole("region", { name: "新增场馆" });
    if (!createBlock) throw new Error("missing create block");
    await user.type(within(createBlock).getByLabelText("名称"), "Third Hall");
    await user.selectOptions(within(createBlock).getByLabelText("类型"), "undisclosed");
    await user.click(within(createBlock).getByRole("button", { name: "提交插入" }));
    expect(apiMocks.createConsoleVenue).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "确认新增场馆" });
    expect(within(dialog).getByRole("table", { name: "新增场馆确认" })).toHaveTextContent("未公开");
    await user.click(within(dialog).getByRole("button", { name: "提交插入" }));

    await waitFor(() => expect(apiMocks.createConsoleVenue).toHaveBeenCalledWith("Third Hall", "csrf-token", "undisclosed", expect.objectContaining({ locality_id: null, address: null })));
    expect(screen.queryByLabelText("已有 Venue")).not.toBeInTheDocument();
    expect(onVenuesChanged).toHaveBeenCalledTimes(1);
  });

  // 测试点：名称改动需填写生效日期，正式更名与类型和位置在同一次确认后提交。
  test("confirms a combined kind and formal rename edit", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByLabelText("名称");
    expect(screen.queryByRole("heading", { name: "当前场馆资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加载" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("类型"), "undisclosed");
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "Renamed Hall");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    await user.type(screen.getByLabelText("生效日期"), "2026-09-04");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    const dialog = await screen.findByRole("dialog", { name: "确认场馆修改" });
    expect(dialog).toHaveTextContent("First Hall");
    expect(dialog).toHaveTextContent("Renamed Hall");
    expect(dialog).toHaveTextContent("2026-09-04");
    expect(apiMocks.saveConsoleVenueEdit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(apiMocks.saveConsoleVenueEdit).toHaveBeenCalledWith(1, expect.objectContaining({
      venue_kind: "undisclosed", location: expect.objectContaining({ address: null }),
      name_change: { version_id: 11, expected_name: "First Hall", venue_name: "Renamed Hall", valid_from: "2026-09-04" },
    }), "csrf-token"));
  });

  // 测试点：只能提交当前名称的正式更名，失败保留草稿，恢复原值不写入。
  test("preserves a failed formal rename draft without a historical editor", async () => {
    const user = userEvent.setup();
    apiMocks.saveConsoleVenueEdit.mockRejectedValueOnce(new Error("write failed"));
    renderSection();
    await screen.findByLabelText("名称");
    expect(screen.queryByLabelText("名称版本")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次名称变化")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "New Hall");
    await user.type(screen.getByLabelText("生效日期"), "2026-09-04");
    await user.click(screen.getAllByRole("button", { name: "保存修改" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "确认场馆修改" });
    expect(dialog).toHaveTextContent("保留原名称版本");
    await user.click(within(dialog).getByRole("button", { name: "保存修改" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("write failed");
    expect(screen.getByLabelText("名称")).toHaveValue("New Hall");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "恢复原值" }));
    expect(screen.getByLabelText("名称")).toHaveValue("First Hall");
    expect(screen.queryByLabelText("生效日期")).not.toBeInTheDocument();
  });

  // 测试点：首次加载失败可通过现有查询按钮恢复，不新增重新加载入口。
  test("recovers from a failed initial load through the query action", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    apiMocks.getConsoleVenuePage
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce({ items: [venueItems[1]], page: 1, page_size: 20, total: 1, total_pages: 1 });
    renderSection(onMessage);

    expect(await screen.findByText("暂无可管理的 Venue。", { exact: false })).toBeInTheDocument();
    expect(onMessage).toHaveBeenCalledWith("加载 Venue 列表失败：network failed");
    await user.click(screen.getAllByRole("button", { name: "查询" })[0]);

    expect(await screen.findByRole("table", { name: "Venue 历史名称" })).toHaveTextContent("First Hall");
  });
});
