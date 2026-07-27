import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BandAdminSection } from "../BandAdminSection";


const apiMocks = vi.hoisted(() => ({
  getConsoleBandHistory: vi.fn(),
  createConsoleBand: vi.fn(),
  initializeConsoleBandHistory: vi.fn(),
  createConsoleBandNameVersion: vi.fn(),
  createConsoleBandLineupVersion: vi.fn(),
  getConsoleBandLineupImpact: vi.fn(),
  correctConsoleBandLineupVersion: vi.fn(),
  getBandHistoryBackfillPreflight: vi.fn(),
}));

vi.mock("../../../api", () => apiMocks);
vi.mock("../../../auth/AuthProvider", () => ({
  useAuth: () => ({ csrfToken: "csrf-token" }),
}));

const uninitializedHistory = {
  band_id: 1,
  current_name: "Poppin'Party",
  current_abbr: "ppp",
  current_members: ["Kasumi", "Tae"],
  initialized: false,
  name_versions: [],
  lineup_versions: [],
};

const initializedHistory = {
  ...uninitializedHistory,
  initialized: true,
  name_versions: [
    {
      name_version_id: 11,
      band_name: "Poppin'Party",
      band_abbr: "ppp",
      valid_from: "2018-01-01",
      valid_to: null,
      note: null,
      live_ids: [],
    },
  ],
  lineup_versions: [
    {
      lineup_version_id: 21,
      version_no: 3,
      version_label: "Poppin'Party V3",
      valid_from: "2018-01-01",
      valid_to: null,
      predecessor_id: null,
      change_type: "initial" as const,
      note: null,
      members: ["Kasumi", "Tae"],
      added_members: ["Kasumi", "Tae"],
      removed_members: [],
      live_ids: [],
    },
  ],
};

const createdSpecialHistory = {
  band_id: 103,
  current_name: "New Special Band",
  current_abbr: "nsb",
  current_members: ["Member A", "Member B"],
  initialized: true,
  name_versions: [{
    name_version_id: 31,
    band_name: "New Special Band",
    band_abbr: "nsb",
    valid_from: "2026-07-27",
    valid_to: null,
    note: "控制台新增 Band 并初始化 V1",
    live_ids: [],
  }],
  lineup_versions: [{
    lineup_version_id: 41,
    version_no: 1,
    version_label: "New Special Band V1",
    valid_from: "2026-07-27",
    valid_to: null,
    predecessor_id: null,
    change_type: "initial" as const,
    note: "控制台新增 Band 并初始化 V1",
    members: ["Member A", "Member B"],
    added_members: ["Member A", "Member B"],
    removed_members: [],
    live_ids: [],
  }],
};

describe("BandAdminSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getConsoleBandHistory.mockResolvedValue(uninitializedHistory);
    apiMocks.createConsoleBand.mockResolvedValue({
      ok: true,
      item: {
        band_id: 103,
        band_name: "New Special Band",
        band_abbr: "nsb",
        band_members: ["Member A", "Member B"],
      },
      history: createdSpecialHistory,
    });
    apiMocks.initializeConsoleBandHistory.mockResolvedValue(initializedHistory);
    apiMocks.getBandHistoryBackfillPreflight.mockResolvedValue({
      ready: false,
      setlist_row_count: 2,
      performance_count: 1,
      member_count: 2,
      live_band_context_count: 1,
      mapped_band_ids: [1],
      issues: [{
        code: "band_name_not_unique",
        message: "Band name maps to 0 history versions",
        live_id: 2,
        setlist_id: "row-2",
        band_name: "Unknown",
      }],
    });
  });

  // 测试点：新增 Band 可选择特殊编号段，经确认后提交并自动展示服务端返回的 V1 历史。
  test("creates and selects a special-range band with initialized history", async () => {
    const user = userEvent.setup();
    const onBandsChanged = vi.fn().mockResolvedValue(undefined);
    const onMessage = vi.fn();
    render(
      <BandAdminSection
        bands={[{ band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: ["Kasumi", "Tae"] }]}
        onMessage={onMessage}
        onBandsChanged={onBandsChanged}
      />,
    );

    await screen.findByDisplayValue("Poppin'Party");
    await user.click(screen.getByRole("button", { name: "新增 Band" }));
    const createBlock = screen.getByRole("heading", { name: "新增 Band" }).closest(".tour-admin-block");
    expect(createBlock).not.toBeNull();
    await user.selectOptions(within(createBlock as HTMLElement).getByLabelText("编号段"), "special");
    await user.type(within(createBlock as HTMLElement).getByLabelText("当前名称"), "New Special Band");
    await user.type(within(createBlock as HTMLElement).getByLabelText("缩写"), "nsb");
    await user.type(within(createBlock as HTMLElement).getByLabelText("生效日期（可空）"), "2026-07-27");
    await user.type(within(createBlock as HTMLElement).getByLabelText("当前成员（每行一人）"), "Member A\nMember B");
    await user.click(within(createBlock as HTMLElement).getByRole("button", { name: "检查新增资料" }));

    const dialog = screen.getByRole("dialog", { name: "确认新增 Band" });
    expect(dialog).toHaveTextContent("特殊编号（101+，100 保留）");
    expect(dialog).toHaveTextContent("New Special Band V1");
    await user.click(within(dialog).getByRole("button", { name: "确认新增" }));

    await waitFor(() => expect(apiMocks.createConsoleBand).toHaveBeenCalledWith(
      {
        id_range: "special",
        band_name: "New Special Band",
        band_abbr: "nsb",
        members: ["Member A", "Member B"],
        valid_from: "2026-07-27",
      },
      "csrf-token",
    ));
    expect(await screen.findByRole("table", { name: "乐队阵容时间线" })).toHaveTextContent("New Special Band V1");
    expect(onBandsChanged).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith("已新增 Band #103（New Special Band）并初始化 V1");
  });

  // 测试点：初始化时应由当前名称和阵容版本号自动生成版本标签，再经二次确认提交。
  test("confirms and initializes current band history", async () => {
    const user = userEvent.setup();
    const onBandsChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <BandAdminSection
        bands={[{ band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: ["Kasumi", "Tae"] }]}
        onMessage={vi.fn()}
        onBandsChanged={onBandsChanged}
      />,
    );

    expect(await screen.findByDisplayValue("Poppin'Party")).toBeInTheDocument();
    expect(screen.queryByLabelText("初始版本标签")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("当前阵容版本号（标签自动生成）"));
    await user.type(screen.getByLabelText("当前阵容版本号（标签自动生成）"), "3");
    await user.click(screen.getByRole("button", { name: "确认并初始化当前版本" }));
    expect(screen.getByRole("dialog", { name: "确认当前 Band 资料" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "确认当前 Band 资料" })).toHaveTextContent("Poppin'Party V3");
    await user.click(screen.getByRole("button", { name: "确认初始化" }));

    await waitFor(() => expect(apiMocks.initializeConsoleBandHistory).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        band_name: "Poppin'Party",
        members: ["Kasumi", "Tae"],
        version_no: 3,
        version_label: "Poppin'Party V3",
      }),
      "csrf-token",
    ));
    expect(await screen.findByRole("table", { name: "乐队阵容时间线" })).toHaveTextContent("Poppin'Party V3");
    expect(screen.getByLabelText("当前阵容版本号（标签自动生成）")).toHaveValue(3);
    expect(onBandsChanged).toHaveBeenCalledTimes(1);
  });

  // 测试点：回填预检失败时应在同一结果区列出精确 Live、Band 与阻断原因。
  test("renders blocking backfill preflight issues", async () => {
    const user = userEvent.setup();
    render(
      <BandAdminSection
        bands={[{ band_id: 1, band_name: "Poppin'Party" }]}
        onMessage={vi.fn()}
        onBandsChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByDisplayValue("Poppin'Party");
    await user.click(screen.getByRole("button", { name: "回填预检" }));

    expect(await screen.findByText("回填预检：未通过")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "回填预检问题" })).toHaveTextContent("Unknown");
    expect(screen.getByRole("table", { name: "回填预检问题" })).toHaveTextContent("band_name_not_unique");
  });

  // 测试点：乐队阵容资料修正应在最终提交前仅列出实际变化字段。
  test("confirms only changed lineup fields before correction", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBandHistory.mockResolvedValue(initializedHistory);
    apiMocks.getConsoleBandLineupImpact.mockResolvedValue({
      band_id: 1,
      lineup_version_id: 21,
      live_ids: [55],
      setlist_row_count: 3,
    });
    apiMocks.correctConsoleBandLineupVersion.mockResolvedValue({
      ...initializedHistory,
      lineup_versions: [{
        ...initializedHistory.lineup_versions[0],
        version_label: "Poppin'Party V3 corrected",
        change_type: "correction" as const,
      }],
    });

    render(
      <BandAdminSection
        bands={[{ band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: ["Kasumi", "Tae"] }]}
        onMessage={vi.fn()}
        onBandsChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByRole("table", { name: "乐队阵容时间线" });
    await user.click(screen.getByRole("button", { name: "资料修正" }));
    const editDialog = screen.getByRole("dialog", { name: /资料修正：/ });
    await user.clear(within(editDialog).getByLabelText("版本标签"));
    await user.type(within(editDialog).getByLabelText("版本标签"), "Poppin'Party V3 corrected");
    await user.click(within(editDialog).getByRole("button", { name: "检查修改" }));

    const dialog = screen.getByRole("dialog", { name: /确认资料修正/ });
    const diffTable = within(dialog).getByRole("table", { name: "乐队资料修改内容" });
    expect(within(diffTable).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "version_labelPoppin'Party V3Poppin'Party V3 corrected",
    ]);
    expect(within(diffTable).queryByText("members")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认资料修正" }));

    await waitFor(() => expect(apiMocks.correctConsoleBandLineupVersion).toHaveBeenCalledWith(
      1,
      21,
      expect.objectContaining({ version_label: "Poppin'Party V3 corrected" }),
      "csrf-token",
    ));
  });
});
