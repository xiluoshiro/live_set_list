import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BandAdminSection } from "../BandAdminSection";


const apiMocks = vi.hoisted(() => ({
  getConsoleBandHistory: vi.fn(),
  createConsoleBand: vi.fn(),
  createConsoleBandLineupVersion: vi.fn(),
  getConsoleBandTransitionLiveCandidates: vi.fn(),
}));

vi.mock("../../../api", () => apiMocks);
vi.mock("../../../auth/AuthProvider", () => ({
  useAuth: () => ({ csrfToken: "csrf-token" }),
}));

const initializedHistory = {
  band_id: 1,
  current_name: "Poppin'Party",
  current_abbr: "ppp",
  current_members: ["Kasumi", "Tae"],
  current_name_version_id: 11,
  current_lineup_version_id: 21,
  initialized: true,
  name_versions: [{
    name_version_id: 11,
    band_name: "Poppin'Party",
    band_abbr: "ppp",
    valid_from: "2018-01-01",
    valid_to: null,
    note: null,
    live_ids: [],
  }],
  lineup_versions: [{
    lineup_version_id: 21,
    version_no: 3,
    version_label: "Poppin'Party V3",
    valid_from: "2018-01-01",
    valid_to: null,
    predecessor_id: null,
    change_type: "initial" as const,
    transition_live_id: null,
    note: null,
    members: ["Kasumi", "Tae"],
    added_members: ["Kasumi", "Tae"],
    removed_members: [],
    live_ids: [],
  }],
};

describe("BandAdminSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getConsoleBandHistory.mockResolvedValue(initializedHistory);
  });

  // 测试点：新增 Band 继续复用紧凑确认表，并只提交原子建立 V1 所需的稳定资料。
  test("creates a Band through the compact confirmation", async () => {
    const user = userEvent.setup();
    const createdHistory = {
      ...initializedHistory,
      band_id: 101,
      current_name: "New Band",
      current_lineup_version_id: 31,
      lineup_versions: [{
        ...initializedHistory.lineup_versions[0],
        lineup_version_id: 31,
        version_no: 1,
        version_label: "New Band V1",
      }],
    };
    apiMocks.createConsoleBand.mockResolvedValue({
      ok: true,
      item: { band_id: 101, band_name: "New Band", band_abbr: "new", band_members: ["Member A"] },
      history: createdHistory,
    });
    const onBandsChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <BandAdminSection
        bands={[{ band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: ["Kasumi", "Tae"] }]}
        onMessage={vi.fn()}
        onBandsChanged={onBandsChanged}
      />,
    );

    await screen.findByRole("table", { name: "乐队阵容时间线" });
    await user.click(screen.getByRole("button", { name: "新增 Band" }));
    await user.selectOptions(screen.getByLabelText("编号段"), "special");
    await user.type(screen.getByLabelText("当前名称"), "New Band");
    await user.type(screen.getByLabelText("缩写"), "new");
    await user.type(screen.getByLabelText("V1 成员（每行一人）"), "Member A");
    await user.click(screen.getByRole("button", { name: "检查新增资料" }));

    const dialog = screen.getByRole("dialog", { name: "确认新增 Band" });
    expect(within(dialog).getByRole("table", { name: "新增 Band 确认" })).toHaveTextContent("101+");
    await user.click(within(dialog).getByRole("button", { name: "确认新增" }));

    await waitFor(() => expect(apiMocks.createConsoleBand).toHaveBeenCalledWith(
      {
        id_range: "special",
        band_name: "New Band",
        band_abbr: "new",
        members: ["Member A"],
        valid_from: null,
      },
      "csrf-token",
    ));
    expect(onBandsChanged).toHaveBeenCalledTimes(1);
  });

  // 测试点：阵容日期采用 ISO 输入，交接查询保持紧凑分组且确认回显完整变化。
  test("appends a locked successor with an optional transition Live", async () => {
    const user = userEvent.setup();
    apiMocks.getConsoleBandTransitionLiveCandidates.mockResolvedValue([
      { live_id: 55, live_name: "Transition Show", live_date: "2026-07-28" },
    ]);
    apiMocks.createConsoleBandLineupVersion.mockResolvedValue({
      ...initializedHistory,
      current_members: ["Kasumi", "Tae", "New Member"],
      current_lineup_version_id: 22,
      lineup_versions: [
        { ...initializedHistory.lineup_versions[0], valid_to: "2026-07-29" },
        {
          ...initializedHistory.lineup_versions[0],
          lineup_version_id: 22,
          version_no: 4,
          version_label: "Poppin'Party V4",
          valid_from: "2026-07-29",
          predecessor_id: 21,
          change_type: "addition" as const,
          transition_live_id: 55,
          members: ["Kasumi", "Tae", "New Member"],
          added_members: ["New Member"],
        },
      ],
    });

    render(
      <BandAdminSection
        bands={[{ band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: ["Kasumi", "Tae"] }]}
        onMessage={vi.fn()}
        onBandsChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(await screen.findByRole("table", { name: "乐队阵容时间线" })).not.toHaveTextContent("资料修正");
    await user.type(screen.getByLabelText("版本标签"), "Poppin'Party V4");
    await user.selectOptions(screen.getByLabelText("变化类型"), "addition");
    await user.type(screen.getByLabelText("生效日期"), "2026-07-29");
    await user.type(screen.getByLabelText("新版本成员（每行一人）"), "\nNew Member");
    await user.type(screen.getByLabelText("备注"), "正式新增成员");
    expect(screen.getByLabelText("生效日期")).toHaveAttribute("placeholder", "YYYY-MM-DD");
    expect(screen.getByLabelText("交接 Live 日期（可空）")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "查询候选" }).closest(".band-transition-query")).not.toBeNull();
    await user.type(screen.getByLabelText("交接 Live 日期（可空）"), "2026-07-28");
    await user.click(screen.getByRole("button", { name: "查询候选" }));
    await screen.findByRole("option", { name: "#55 Transition Show" });
    await user.selectOptions(screen.getByLabelText("交接 Live（可空）"), "55");
    await user.click(screen.getByRole("button", { name: "检查版本变化" }));

    const dialog = screen.getByRole("dialog", { name: "确认追加阵容版本" });
    const table = within(dialog).getByRole("table", { name: "阵容版本变化确认" });
    expect(table).toHaveTextContent("V3 → V4");
    expect(within(table).getByRole("row", { name: "版本标签 Poppin'Party V4" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: "变化类型 增加" })).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: "新版本成员 Kasumi / Tae / New Member" })).toBeInTheDocument();
    expect(table).toHaveTextContent("New Member");
    expect(within(table).getByRole("row", { name: "备注 正式新增成员" })).toBeInTheDocument();
    expect(table).toHaveTextContent("#55 Transition Show");
    await user.click(within(dialog).getByRole("button", { name: "确认追加" }));

    await waitFor(() => expect(apiMocks.createConsoleBandLineupVersion).toHaveBeenCalledWith(
      1,
      {
        version_label: "Poppin'Party V4",
        change_type: "addition",
        members: ["Kasumi", "Tae", "New Member"],
        valid_from: "2026-07-29",
        note: "正式新增成员",
        transition_live_id: 55,
      },
      "csrf-token",
    ));
  });
});
