import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BandAdminSection } from "../BandAdminSection";


const apiMocks = vi.hoisted(() => ({
  getConsoleBandHistory: vi.fn(),
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

describe("BandAdminSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getConsoleBandHistory.mockResolvedValue(uninitializedHistory);
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
});
