import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { VenueAdminSection } from "../VenueAdminSection";


const apiMocks = vi.hoisted(() => ({
  getConsoleVenuePage: vi.fn(),
  getConsoleVenue: vi.fn(),
  createConsoleVenue: vi.fn(),
  updateConsoleVenueKind: vi.fn(),
  createConsoleVenueNameVersion: vi.fn(),
  updateConsoleVenueNameVersion: vi.fn(),
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

function installPagedVenues() {
  apiMocks.getConsoleVenuePage.mockImplementation((_q: string, page: number) => Promise.resolve({
    items: page === 1 ? [venueItems[0]] : [venueItems[1]],
    page,
    page_size: 100,
    total: 2,
    total_pages: 2,
  }));
  apiMocks.getConsoleVenue.mockImplementation((venueId: 1 | 2) => Promise.resolve(details[venueId]));
}

function renderSection(onMessage = vi.fn(), onVenuesChanged = vi.fn().mockResolvedValue(undefined)) {
  render(<VenueAdminSection onMessage={onMessage} onVenuesChanged={onVenuesChanged} />);
  return { onMessage, onVenuesChanged };
}

describe("VenueAdminSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installPagedVenues();
  });

  // 测试点：Venue 选择器自动读取全部分页、按 ID 排序并默认展示首项，首屏不再出现查询表和合并入口。
  test("loads every Venue page into the Band-style selector and shows a read-only history first", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      venue_id: 101 - index,
      venue_name: `Venue ${101 - index}`,
    }));
    apiMocks.getConsoleVenuePage.mockImplementation((_q: string, page: number) => Promise.resolve({
      items: page === 1 ? firstPage : [venueItems[1]],
      page,
      page_size: 100,
      total: 101,
      total_pages: 2,
    }));
    renderSection();

    const selector = await screen.findByLabelText("已有 Venue");
    await waitFor(() => expect(within(selector).getAllByRole("option")).toHaveLength(101));
    const options = within(selector).getAllByRole("option");
    expect(options[0]).toHaveTextContent("#1 First Hall");
    expect(options[100]).toHaveTextContent("#101 Venue 101");
    expect(selector).toHaveValue("1");
    const history = await screen.findByRole("table", { name: "Venue 历史名称" });
    expect(history).toHaveTextContent("Old First Hall");
    expect(history).toHaveTextContent("2");
    expect(history).toHaveTextContent("1");
    expect(within(history).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Venue 查询")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "管理" })).not.toBeInTheDocument();
    expect(screen.queryByText(/重复 Venue 合并/)).not.toBeInTheDocument();
    expect(screen.queryByText(/关联 Live 明细/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "新增 Venue" })).not.toBeInTheDocument();
    expect(apiMocks.getConsoleVenuePage).toHaveBeenNthCalledWith(1, "", 1, 100);
    expect(apiMocks.getConsoleVenuePage).toHaveBeenNthCalledWith(2, "", 2, 100);
  });

  // 测试点：切换 Venue 后仅加载目标详情，并让历史名称区跟随当前选择更新。
  test("loads the selected Venue detail", async () => {
    const user = userEvent.setup();
    renderSection();
    const selector = await screen.findByLabelText("已有 Venue");
    await waitFor(() => expect(selector).toHaveValue("1"));

    await user.selectOptions(selector, "2");

    expect(await screen.findByRole("table", { name: "Venue 历史名称" })).toHaveTextContent("Second Hall");
    expect(apiMocks.getConsoleVenue).toHaveBeenLastCalledWith(2);
  });

  // 测试点：新增区默认折叠，确认前不写入；成功后刷新完整列表并保持新 Venue 为当前选择。
  test("creates only after confirmation and selects the new Venue", async () => {
    const user = userEvent.setup();
    const createdDetail = {
      ...details[2],
      venue_id: 3,
      venue_name: "Third Hall",
      venue_name_version_id: 33,
      name_versions: [{ ...details[2].name_versions[0], venue_name_version_id: 33, venue_name: "Third Hall" }],
    };
    let created = false;
    apiMocks.getConsoleVenuePage.mockImplementation((_q: string, page: number) => Promise.resolve({
      items: page === 1 ? [venueItems[0]] : created ? [venueItems[1], { venue_id: 3, venue_name: "Third Hall" }] : [venueItems[1]],
      page,
      page_size: 100,
      total: created ? 3 : 2,
      total_pages: 2,
    }));
    apiMocks.getConsoleVenue.mockImplementation((venueId: number) => Promise.resolve(venueId === 3 ? createdDetail : details[venueId as 1 | 2]));
    apiMocks.createConsoleVenue.mockImplementation(() => {
      created = true;
      return Promise.resolve({ ok: true, item: { venue_id: 3, venue_name: "Third Hall" } });
    });
    const { onVenuesChanged } = renderSection();
    await screen.findByRole("table", { name: "Venue 历史名称" });

    await user.click(screen.getByRole("button", { name: "新增 Venue" }));
    const createBlock = screen.getByRole("heading", { name: "新增 Venue" }).closest(".tour-admin-block") as HTMLElement | null;
    if (!createBlock) throw new Error("missing create block");
    await user.type(within(createBlock).getByLabelText("名称"), "Third Hall");
    await user.selectOptions(within(createBlock).getByLabelText("类型"), "undisclosed");
    await user.click(within(createBlock).getByRole("button", { name: "检查新增资料" }));
    expect(apiMocks.createConsoleVenue).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "确认新增 Venue" });
    expect(within(dialog).getByRole("table", { name: "新增 Venue 确认" })).toHaveTextContent("未公开");
    await user.click(within(dialog).getByRole("button", { name: "确认新增" }));

    await waitFor(() => expect(screen.getByLabelText("已有 Venue")).toHaveValue("3"));
    expect(apiMocks.createConsoleVenue).toHaveBeenCalledWith("Third Hall", "csrf-token", "undisclosed");
    expect(onVenuesChanged).toHaveBeenCalledTimes(1);
  });

  // 测试点：类型和正式更名都必须先展示变更边界，用户二次确认后才调用写接口。
  test("confirms kind and formal rename changes before submitting", async () => {
    const user = userEvent.setup();
    apiMocks.updateConsoleVenueKind.mockResolvedValue(details[1]);
    apiMocks.createConsoleVenueNameVersion.mockResolvedValue(details[1]);
    renderSection();
    await screen.findByRole("table", { name: "Venue 历史名称" });

    const kindBlock = screen.getByRole("heading", { name: "当前场地资料" }).closest(".tour-admin-block") as HTMLElement | null;
    if (!kindBlock) throw new Error("missing kind block");
    await user.selectOptions(within(kindBlock).getByLabelText("类型"), "online");
    await user.click(within(kindBlock).getByRole("button", { name: "检查场地类型变化" }));
    expect(apiMocks.updateConsoleVenueKind).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog", { name: "确认修改场地类型" });
    expect(within(dialog).getByRole("table", { name: "场地类型变化确认" })).toHaveTextContent("实体场馆");
    await user.click(within(dialog).getByRole("button", { name: "确认修改" }));
    await waitFor(() => expect(apiMocks.updateConsoleVenueKind).toHaveBeenCalledWith(1, "online", "csrf-token"));

    const renameBlock = screen.getByRole("heading", { name: "追加正式名称版本" }).closest(".tour-admin-block") as HTMLElement | null;
    if (!renameBlock) throw new Error("missing rename block");
    await user.type(within(renameBlock).getByLabelText("新名称"), "Renamed Hall");
    await user.type(within(renameBlock).getByLabelText("生效日期"), "2026-09-04");
    await user.click(within(renameBlock).getByRole("button", { name: "检查名称版本变化" }));
    expect(apiMocks.createConsoleVenueNameVersion).not.toHaveBeenCalled();
    dialog = screen.getByRole("dialog", { name: "确认追加正式名称版本" });
    const renameTable = within(dialog).getByRole("table", { name: "正式名称版本变化确认" });
    expect(renameTable).toHaveTextContent("First Hall");
    expect(renameTable).toHaveTextContent("Renamed Hall");
    expect(renameTable).toHaveTextContent("2026-09-04 → 开放");
    await user.click(within(dialog).getByRole("button", { name: "确认追加" }));
    await waitFor(() => expect(apiMocks.createConsoleVenueNameVersion).toHaveBeenCalledWith(1, "Renamed Hall", "2026-09-04", "csrf-token"));
  });

  // 测试点：资料修正确认回显原值、新值及 Live/改期影响数，失败后保留表单并允许再次提交。
  test("confirms correction impact and remains recoverable after a failed submit", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    apiMocks.updateConsoleVenueNameVersion
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(details[1]);
    renderSection(onMessage);
    await screen.findByRole("table", { name: "Venue 历史名称" });

    const correctionBlock = screen.getByRole("heading", { name: "名称资料修正" }).closest(".tour-admin-block") as HTMLElement | null;
    if (!correctionBlock) throw new Error("missing correction block");
    await user.selectOptions(within(correctionBlock).getByLabelText("名称版本"), "10");
    const input = within(correctionBlock).getByLabelText("正确名称");
    await user.clear(input);
    await user.type(input, "Correct Old Hall");
    await user.click(within(correctionBlock).getByRole("button", { name: "检查资料修正" }));
    expect(apiMocks.updateConsoleVenueNameVersion).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog", { name: "确认修正名称资料" });
    const table = within(dialog).getByRole("table", { name: "名称资料修正确认" });
    expect(table).toHaveTextContent("Old First Hall");
    expect(table).toHaveTextContent("Correct Old Hall");
    expect(within(table).getByRole("row", { name: "影响 Live 2" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: "影响改期历史 1" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认修正" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("修正名称失败：write failed"));
    expect(input).toHaveValue("Correct Old Hall");
    dialog = screen.getByRole("dialog", { name: "确认修正名称资料" });
    await user.click(within(dialog).getByRole("button", { name: "确认修正" }));
    await waitFor(() => expect(apiMocks.updateConsoleVenueNameVersion).toHaveBeenCalledTimes(2));
  });

  // 测试点：空列表和首次加载失败都提供可恢复的重新加载入口。
  test("recovers from a failed initial load through the empty-state reload", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    apiMocks.getConsoleVenuePage
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce({ items: [venueItems[1]], page: 1, page_size: 100, total: 1, total_pages: 1 });
    renderSection(onMessage);

    expect(await screen.findByText("暂无可管理的 Venue。", { exact: false })).toBeInTheDocument();
    expect(onMessage).toHaveBeenCalledWith("加载 Venue 列表失败：network failed");
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("table", { name: "Venue 历史名称" })).toHaveTextContent("First Hall");
  });
});
