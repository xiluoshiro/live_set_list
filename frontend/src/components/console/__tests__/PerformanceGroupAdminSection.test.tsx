import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { PerformanceGroupAdminSection } from "../PerformanceGroupAdminSection";

const apiMocks = vi.hoisted(() => ({
  createConsolePerformanceGroup: vi.fn(),
  getConsolePerformanceGroup: vi.fn(),
  getConsolePerformanceGroups: vi.fn(),
  getConsolePerformanceGroupLiveCandidates: vi.fn(),
  updateConsolePerformanceGroup: vi.fn(),
}));

vi.mock("../../../api", () => ({
  createConsolePerformanceGroup: apiMocks.createConsolePerformanceGroup,
  getConsolePerformanceGroup: apiMocks.getConsolePerformanceGroup,
  getConsolePerformanceGroups: apiMocks.getConsolePerformanceGroups,
  getConsolePerformanceGroupLiveCandidates: apiMocks.getConsolePerformanceGroupLiveCandidates,
  updateConsolePerformanceGroup: apiMocks.updateConsolePerformanceGroup,
}));

const getConsolePerformanceGroupsMock = vi.mocked(apiMocks.getConsolePerformanceGroups);
const getConsolePerformanceGroupMock = vi.mocked(apiMocks.getConsolePerformanceGroup);
const getConsolePerformanceGroupLiveCandidatesMock = vi.mocked(apiMocks.getConsolePerformanceGroupLiveCandidates);
const createConsolePerformanceGroupMock = vi.mocked(apiMocks.createConsolePerformanceGroup);
const updateConsolePerformanceGroupMock = vi.mocked(apiMocks.updateConsolePerformanceGroup);

function makeCandidateResponse(overrides: Record<string, unknown> = {}) {
  const rawItems = (overrides.items as Array<{ live_id: number; live_date: string; live_title: string; start_time?: string; venue?: string | null }>) ?? [
    { live_id: 1, live_date: "2026-03-01", live_title: "Candidate Live 1", start_time: "13:00:00+09:00", venue: "Venue A" },
    { live_id: 2, live_date: "2026-03-02", live_title: "Candidate Live 2", start_time: "18:00:00+09:00", venue: "Venue B" },
  ];
  return {
    items: rawItems.map((item) => ({ ...item, start_time: item.start_time ?? "18:00:00+09:00", venue: item.venue ?? null, band_ids: [] })),
    page: (overrides.page as number) ?? 1,
    page_size: 20,
    total: (overrides.total as number) ?? 2,
    total_pages: (overrides.total_pages as number) ?? 1,
  };
}

function makeConsoleGroupEditResponse() {
  return {
    group_id: 1,
    group_title: "Existing Group",
    lives: [
      {
        live_id: 10,
        live_date: "2026-04-01",
        live_title: "Existing Group Day 1",
        start_time: "18:00:00+09:00",
        venue: "Test Venue",
        band_ids: [1],
      },
      {
        live_id: 11,
        live_date: "2026-04-02",
        live_title: "Existing Group Day 2",
        start_time: "19:00:00+09:00",
        venue: "Test Venue",
        band_ids: [1],
      },
    ],
  };
}

function makeMutationResponse() {
  return {
    ok: true,
    item: { group_id: 5, group_title: "New Group", live_count: 2 },
  };
}

function renderSection() {
  function SharedMessageHarness() {
    const [message, setMessage] = useState("");
    return (
      <>
        {message && <p role="status">{message}</p>}
        <PerformanceGroupAdminSection csrfToken="csrf-token" onMessage={setMessage} />
      </>
    );
  }

  return render(<SharedMessageHarness />);
}

describe("PerformanceGroupAdminSection", () => {
  beforeEach(() => {
    getConsolePerformanceGroupsMock.mockReset();
    getConsolePerformanceGroupMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    createConsolePerformanceGroupMock.mockReset();
    updateConsolePerformanceGroupMock.mockReset();

    getConsolePerformanceGroupsMock.mockResolvedValue({ items: [] });
    getConsolePerformanceGroupLiveCandidatesMock.mockResolvedValue(makeCandidateResponse());
  });

  // 测试点：加载已有活动组时应使用共享实体选择器宽度，并保持统一高亮的新建入口。
  test("loads existing groups into dropdown", async () => {
    getConsolePerformanceGroupsMock.mockResolvedValue({
      items: [
        { group_id: 1, group_title: "Group Alpha" },
        { group_id: 2, group_title: "Group Beta" },
      ],
    });

    renderSection();

    expect(screen.getByRole("button", { name: "新建活动组" })).toHaveClass("console-submit-btn", "console-new-btn");

    await waitFor(() => {
      const select = screen.getByLabelText("已有活动组");
      expect(select).toHaveClass("console-entity-select");
      expect(within(select).getByRole("option", { name: "#1 Group Alpha" })).toBeInTheDocument();
      expect(within(select).getByRole("option", { name: "#2 Group Beta" })).toBeInTheDocument();
    });
  });

  // 测试点：选择已有活动组后加载编辑数据到表单
  test("selecting an existing group loads edit data into the form", async () => {
    getConsolePerformanceGroupsMock.mockResolvedValue({ items: [{ group_id: 1, group_title: "Edit Target" }] });
    getConsolePerformanceGroupMock.mockResolvedValue(makeConsoleGroupEditResponse());

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "#1 Edit Target" })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("已有活动组"), "1");

    await waitFor(() => {
      expect(getConsolePerformanceGroupMock).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      const titleInput = screen.getByLabelText("活动组名称");
      expect(titleInput).toHaveValue("Existing Group");
    });
  });

  // 测试点：搜索 Live 候选并显示分页结果
  test("searches live candidates and shows results", async () => {
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock.mockResolvedValue(
      makeCandidateResponse({
        items: [
          { live_id: 100, live_date: "2026-06-01", live_title: "Searched Live", venue: "Venue X" },
        ],
        page: 1,
        total: 1,
        total_pages: 1,
      }),
    );

    const user = userEvent.setup();
    renderSection();

    const searchInput = screen.getByPlaceholderText("输入 Live ID 或标题");
    await user.type(searchInput, "Searched");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => {
      expect(getConsolePerformanceGroupLiveCandidatesMock).toHaveBeenCalledWith("Searched", 1, 20);
    });

    await waitFor(() => {
      expect(screen.getByText(/Searched Live/)).toBeInTheDocument();
      expect(screen.getByText("18:00")).toBeInTheDocument();
    });
  });

  // 测试点："一键添加筛选结果"批量添加候选到已选列表
  test("one-click add filtered results batch adds candidates to selected list", async () => {
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "Tour Stop A" },
          { live_id: 2, live_date: "2026-03-01", live_title: "Tour Stop B" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }))
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "Tour Stop A" },
          { live_id: 2, live_date: "2026-03-01", live_title: "Tour Stop B" },
          { live_id: 3, live_date: "2026-03-02", live_title: "Tour Stop C" },
        ],
        page: 1,
        total: 3,
        total_pages: 1,
      }));

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/Tour Stop A/)).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "添加" })[0]);

    await user.click(screen.getByRole("button", { name: "一键添加筛选结果" }));

    await waitFor(() => {
      expect(screen.getByText(/已添加 2 场，跳过 1 场已选 Live。/)).toBeInTheDocument();
    });
  });

  // 测试点：已选场次少于 2 个时禁用提交按钮
  test("disables submit button when fewer than 2 stops are selected", async () => {
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock.mockResolvedValue(
      makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "Single Live", venue: "Venue A" },
        ],
        page: 1,
        total: 1,
        total_pages: 1,
      }),
    );

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/Single Live/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "添加" }));

    const titleInput = screen.getByLabelText("活动组名称");
    await user.type(titleInput, "Test");

    const submitButton = screen.getByRole("button", { name: "新建" });
    expect(submitButton).toBeDisabled();
  });

  // 测试点：提交前显示确认弹窗（含计算后的短标题）
  test("shows confirmation dialog with computed short titles before submit", async () => {
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "My Tour 2026 Tokyo", venue: "V1" },
          { live_id: 2, live_date: "2026-03-02", live_title: "My Tour 2026 Osaka", venue: "V2" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }))
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "My Tour 2026 Tokyo", venue: "V1" },
          { live_id: 2, live_date: "2026-03-02", live_title: "My Tour 2026 Osaka", venue: "V2" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }));

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/My Tour 2026 Tokyo/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "一键添加筛选结果" }));

    await waitFor(() => {
      expect(screen.getByText(/已添加 2 场。/)).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText("活动组名称");
    await user.clear(titleInput);
    await user.type(titleInput, "My Tour 2026");

    await user.click(screen.getByRole("button", { name: "新建" }));

    const dialog = await screen.findByRole("dialog", { name: "确认创建活动组" });
    expect(within(dialog).getByText("Tokyo")).toBeInTheDocument();
    expect(within(dialog).getByText("Osaka")).toBeInTheDocument();
  });

  // 测试点：同日候选按开演时间排序提交，成功创建后显示历史记录。
  test("shows success history table after creating a group", async () => {
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "New Tour 2026 晚场", start_time: "18:00:00+09:00" },
          { live_id: 2, live_date: "2026-03-01", live_title: "New Tour 2026 午场", start_time: "13:00:00+09:00" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }))
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "New Tour 2026 晚场", start_time: "18:00:00+09:00" },
          { live_id: 2, live_date: "2026-03-01", live_title: "New Tour 2026 午场", start_time: "13:00:00+09:00" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }))
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [],
        page: 1,
        total: 0,
        total_pages: 1,
      }));

    createConsolePerformanceGroupMock.mockResolvedValue({
      ok: true,
      item: { group_id: 5, group_title: "New Tour 2026", live_count: 2 },
    });
    getConsolePerformanceGroupsMock
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ group_id: 5, group_title: "New Tour 2026" }] });

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/New Tour 2026 晚场/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "一键添加筛选结果" }));

    await waitFor(() => {
      expect(screen.getByText(/已添加 2 场。/)).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText("活动组名称");
    await user.clear(titleInput);
    await user.type(titleInput, "New Tour 2026");

    await user.click(screen.getByRole("button", { name: "新建" }));

    const dialog = await screen.findByRole("dialog", { name: "确认创建活动组" });
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

    await waitFor(() => {
      expect(createConsolePerformanceGroupMock).toHaveBeenCalledWith(
        { group_title: "New Tour 2026", live_ids: [2, 1] },
        "csrf-token",
      );
    });

    await waitFor(() => {
      const historyTable = screen.getByRole("table", { name: "新增活动组记录" });
      expect(within(historyTable).getByText("New Tour 2026")).toBeInTheDocument();
    });
  });

  // 测试点：创建时 Live 已属于其他活动组返回 409 并报错
  test("shows error when creating group returns 409 for live already in another group", async () => {
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "Bad Tour Day1" },
          { live_id: 2, live_date: "2026-03-02", live_title: "Bad Tour Day2" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }))
      .mockResolvedValueOnce(makeCandidateResponse({
        items: [
          { live_id: 1, live_date: "2026-03-01", live_title: "Bad Tour Day1" },
          { live_id: 2, live_date: "2026-03-02", live_title: "Bad Tour Day2" },
        ],
        page: 1,
        total: 2,
        total_pages: 1,
      }));

    createConsolePerformanceGroupMock.mockRejectedValue(
      Object.assign(new Error("Live already belongs to another group"), { status: 409 }),
    );

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/Bad Tour Day1/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "一键添加筛选结果" }));

    await waitFor(() => {
      expect(screen.getByText(/已添加 2 场。/)).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText("活动组名称");
    await user.clear(titleInput);
    await user.type(titleInput, "Bad Group");

    await user.click(screen.getByRole("button", { name: "新建" }));

    const dialog = await screen.findByRole("dialog", { name: "确认创建活动组" });
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

    await waitFor(() => {
      expect(screen.getByText(/Live already belongs to another group/)).toBeInTheDocument();
    });
  });

  // 测试点：更新时使用完整目标集合替换
  test("updates group with full target set replacement", async () => {
    getConsolePerformanceGroupsMock.mockResolvedValue({ items: [{ group_id: 1, group_title: "Update Target" }] });
    getConsolePerformanceGroupMock.mockResolvedValue(makeConsoleGroupEditResponse());
    getConsolePerformanceGroupLiveCandidatesMock.mockReset();
    getConsolePerformanceGroupLiveCandidatesMock.mockResolvedValue(
      makeCandidateResponse({
        items: [
          { live_id: 10, live_date: "2026-04-01", live_title: "Existing Group Day 1" },
          { live_id: 11, live_date: "2026-04-02", live_title: "Existing Group Day 2" },
          { live_id: 12, live_date: "2026-04-03", live_title: "New Stop Day 3" },
        ],
        page: 1,
        total: 3,
        total_pages: 1,
      }),
    );

    updateConsolePerformanceGroupMock.mockResolvedValue({
      ok: true,
      item: { group_id: 1, group_title: "Updated Group", live_count: 4 },
    });

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "#1 Update Target" })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("已有活动组"), "1");

    await waitFor(() => {
      const titleInput = screen.getByLabelText("活动组名称");
      expect(titleInput).toHaveValue("Existing Group");
    });

    await user.clear(screen.getByLabelText("活动组名称"));
    await user.type(screen.getByLabelText("活动组名称"), "Updated Group");

    await user.click(screen.getByRole("button", { name: "添加" }));

    await user.click(screen.getByRole("button", { name: "更新" }));

    const dialog = await screen.findByRole("dialog", { name: "确认更新活动组" });
    await user.click(within(dialog).getByRole("button", { name: "确认提交" }));

    await waitFor(() => {
      expect(updateConsolePerformanceGroupMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ group_title: "Updated Group" }),
        "csrf-token",
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/更新活动组成功/)).toBeInTheDocument();
    });
  });
});
