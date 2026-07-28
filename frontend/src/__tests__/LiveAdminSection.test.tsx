import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { LiveAdminSection } from "../components/console/LiveAdminSection";

type InsertedLiveHistory = ComponentProps<typeof LiveAdminSection>["insertedLives"];

function renderSection(
  onToggleDefaultBand = vi.fn(),
  options: {
    liveType?: string;
    eventAttendees?: Record<number, string[]>;
    onToggleEventAttendee?: ReturnType<typeof vi.fn>;
    editingLiveId?: number | null;
    isLiveDirty?: boolean;
    variant?: "create" | "edit";
    insertedLives?: InsertedLiveHistory;
    hasScheduleChanges?: boolean;
    datePhase?: "upcoming" | "today" | "past";
    eventStatus?: "scheduled" | "postponed" | "cancelled";
    scheduleChangeKind?: "correction" | "reschedule" | null;
    onScheduleChangeKindChange?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onToggleEventAttendee = options.onToggleEventAttendee ?? vi.fn();
  render(
    <LiveAdminSection
      variant={options.variant ?? "create"}
      liveDate="2026-07-17"
      liveTitle="Draft Live"
      liveType={options.liveType ?? "other"}
      eventStatus={options.eventStatus ?? "scheduled"}
      datePhase={options.datePhase ?? "past"}
      hasScheduleChanges={options.hasScheduleChanges ?? false}
      scheduleChangeKind={options.scheduleChangeKind ?? null}
      liveUrl="https://example.com/live"
      openingTime="18:00"
      startTime="19:00"
      timezoneHour="+9"
      timezoneMinute=":00"
      timezoneMinuteDisabled={false}
      selectedVenueId={1}
      defaultBandIds={[3]}
      defaultBandLineupContexts={{}}
      bandHistories={{}}
      eventAttendees={options.eventAttendees ?? {}}
      bandOptions={[
        { band_id: 0, band_name: "Other bands", band_abbr: "", band_members: [] },
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: [] },
        { band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: ["高松燈", "千早愛音"] },
      ]}
      venueQueryText=""
      liveCandidateQuery=""
      liveCandidateType=""
      liveCandidates={[{ live_id: 55, live_date: "2026-07-05", live_title: "Event Live", live_type: "event", venue_name: "Test Venue" }]}
      liveCandidatePage={1}
      liveCandidateTotal={1}
      liveCandidateTotalPages={1}
      liveCandidateLoading={false}
      editingLiveId={options.editingLiveId ?? null}
      isLiveDirty={options.isLiveDirty ?? (options.editingLiveId != null)}
      clearAfterCreate
      venues={[{ venue_id: 1, venue_name: "Test Venue" }]}
      timezoneHourOptions={["+9"]}
      liveTypeOptions={[{ value: "other", label: "其他" }, { value: "event", label: "活动" }]}
      venueOpen={false}
      venueMenuPos={null}
      defaultBandOpen
      defaultBandMenuPos={{ top: 0, left: 0, width: 320 }}
      venueTriggerRef={createRef<HTMLButtonElement>()}
      venueMenuRef={createRef<HTMLDivElement>()}
      defaultBandTriggerRef={createRef<HTMLButtonElement>()}
      defaultBandMenuRef={createRef<HTMLDivElement>()}
      venueQueryInputRef={createRef<HTMLInputElement>()}
      insertedLives={options.insertedLives ?? []}
      onLiveDateChange={vi.fn()}
      onLiveTitleChange={vi.fn()}
      onLiveTypeChange={vi.fn()}
      onScheduleChangeKindChange={options.onScheduleChangeKindChange ?? vi.fn()}
      onLiveUrlChange={vi.fn()}
      onOpeningTimeChange={vi.fn()}
      onStartTimeChange={vi.fn()}
      onTimezoneHourChange={vi.fn()}
      onCycleTimezoneMinute={vi.fn()}
      onVenueQueryTextChange={vi.fn()}
      onLiveCandidateQueryChange={vi.fn()}
      onLiveCandidateTypeChange={vi.fn()}
      onQueryLiveCandidates={vi.fn()}
      onLiveCandidatePageChange={vi.fn()}
      onSelectLiveForEdit={vi.fn()}
      onClearAfterCreateChange={vi.fn()}
      onOpenVenueMenu={vi.fn()}
      onOpenDefaultBandMenu={vi.fn()}
      onSelectVenue={vi.fn()}
      onToggleDefaultBand={onToggleDefaultBand}
      onToggleEventAttendee={onToggleEventAttendee}
      onQueryVid={vi.fn()}
      onInsertVenue={vi.fn()}
      onClearInsertLive={vi.fn()}
      onSubmitInsertLive={vi.fn()}
      queryInsertDisabled
      submitInsertDisabled={false}
    />,
  );
  return { onToggleDefaultBand, onToggleEventAttendee };
}


describe("LiveAdminSection", () => {
  // 测试点：默认 Band 下拉应允许多选正数 Band，并排除 band_id=0 占位项。
  test("renders and toggles default Band choices", () => {
    const { onToggleDefaultBand } = renderSection();
    const group = screen.getByRole("group", { name: "default_band_ids" });

    expect(screen.getByRole("button", { name: "MyGO!!!!!" })).toHaveAttribute("aria-expanded", "true");
    expect(within(group).queryByText(/Other bands/)).not.toBeInTheDocument();
    expect(within(group).getByRole("checkbox", { name: /MyGO/ })).toBeChecked();

    fireEvent.click(within(group).getByRole("checkbox", { name: /Poppin'Party/ }));
    expect(onToggleDefaultBand).toHaveBeenCalledWith(1);
  });

  // 测试点：活动类型应在已选默认 Band 下复用成员二级复选列表，并回传具体成员切换。
  test("renders event attendee member choices only for selected event Bands", () => {
    const onToggleEventAttendee = vi.fn();
    renderSection(vi.fn(), {
      liveType: "event",
      eventAttendees: { 3: ["高松燈"] },
      onToggleEventAttendee,
    });

    const memberGroup = screen.getByRole("group", { name: "MyGO!!!!! 出演成员" });
    expect(within(memberGroup).getByRole("checkbox", { name: "高松燈" })).toBeChecked();
    expect(within(memberGroup).getByRole("checkbox", { name: "千早愛音" })).not.toBeChecked();

    fireEvent.click(within(memberGroup).getByRole("checkbox", { name: "千早愛音" }));
    expect(onToggleEventAttendee).toHaveBeenCalledWith(3, "千早愛音");
  });

  // 测试点：编辑既有 Live 时应复用同一表单，并把操作按钮切换为恢复和保存语义。
  test("shows edit controls in the shared Live form", () => {
    renderSection(vi.fn(), { variant: "edit", editingLiveId: 55 });

    expect(screen.getByRole("combobox", { name: "选择要编辑的 Live" })).toHaveValue("55");
    expect(screen.getByRole("button", { name: "恢复原值" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(screen.getByText("Live #55 有未保存修改")).toBeInTheDocument();
  });

  // 测试点：日期阶段保持只读；排期变化控件仅在改期后出现，并复用现有输入框样式。
  test("shows read-only date phase and schedule change choices only after schedule edits", () => {
    const onScheduleChangeKindChange = vi.fn();
    renderSection(vi.fn(), {
      variant: "edit",
      editingLiveId: 55,
      datePhase: "today",
      hasScheduleChanges: true,
      onScheduleChangeKindChange,
    });

    expect(screen.getByLabelText("日期阶段：进行中（只读）")).toHaveTextContent("进行中");
    expect(screen.getByLabelText("日期阶段：进行中（只读）")).toHaveAttribute("data-status-tone", "today");
    expect(screen.getByRole("radio", { name: "资料修正" })).toBeInTheDocument();
    expect(screen.getByLabelText("排期变化说明")).toHaveClass("venue-query-input");
    fireEvent.click(screen.getByRole("radio", { name: "主办方正式改期" }));
    expect(onScheduleChangeKindChange).toHaveBeenCalledWith("reschedule");
  });

  // 测试点：按计划的 Live 不显示无效的延期或取消说明输入框。
  test("hides the public status note for scheduled Lives", () => {
    renderSection(vi.fn(), { eventStatus: "scheduled" });
    expect(screen.queryByLabelText("状态说明")).not.toBeInTheDocument();
  });

  // 测试点：延期或取消说明明确告知管理员其内容会展示在公开详情中。
  test("explains where the postponed status note is published", () => {
    renderSection(vi.fn(), { eventStatus: "postponed" });
    expect(screen.getByLabelText("状态说明")).toBeInTheDocument();
    expect(screen.getByText("将显示在公开演出详情的状态栏中")).toBeInTheDocument();
  });

  // 测试点：新增 Live 页只显示录入控件和提交后清空选项，不混入既有 Live 查询。
  test("shows create controls without the existing Live toolbar", () => {
    renderSection();

    expect(screen.getByDisplayValue("其他")).toHaveClass("live-type-input");
    expect(screen.getByLabelText("查询 venue")).toHaveClass("live-management-primary-control");
    expect(screen.getByRole("button", { name: /Test Venue/ })).toHaveClass("live-management-primary-control");
    expect(screen.getByRole("button", { name: "MyGO!!!!!" })).toHaveClass("live-management-primary-control");
    expect(screen.queryByRole("combobox", { name: "按 Live 类型筛选" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("输入 Live ID 或标题")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "新增后清空录入数据" })).toBeChecked();
  });

  // 测试点：Live 管理页显示候选筛选但不显示新增专属选项，干净编辑态不重复提示。
  test("shows edit lookup without create-only controls or a clean hint", () => {
    renderSection(vi.fn(), { variant: "edit", editingLiveId: 55, isLiveDirty: false });

    expect(screen.getByRole("combobox", { name: "按 Live 类型筛选" })).toHaveClass("live-type-filter");
    expect(screen.getByPlaceholderText("输入 Live ID 或标题")).toHaveClass("live-management-primary-control");
    expect(screen.queryByRole("checkbox", { name: "新增后清空录入数据" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Live #55 有未保存修改/)).not.toBeInTheDocument();
  });

  // 测试点：同一 Live 的多次更新快照使用独立历史标识，不产生重复 React key 或覆盖旧记录。
  test("renders repeated updates for one Live as distinct history rows", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const commonHistory = {
      action: "update" as const,
      live_id: 55,
      live_date: "2026-07-05",
      live_type: "event",
      url: "https://example.com/live/55",
      opening_time: "18:00:00+09:00",
      start_time: "19:00:00+09:00",
      timezone: "+09:00",
      venue_id: 1,
      default_band_ids: [3],
      event_attendees: [],
    };

    renderSection(vi.fn(), {
      variant: "edit",
      editingLiveId: 55,
      insertedLives: [
        { ...commonHistory, history_entry_id: 2, live_title: "Second saved title" },
        { ...commonHistory, history_entry_id: 1, live_title: "First saved title" },
      ],
    });

    expect(screen.getByText("Second saved title")).toBeInTheDocument();
    expect(screen.getByText("First saved title")).toBeInTheDocument();
    expect(consoleError.mock.calls.some((call) => call.some((value) => String(value).includes("same key")))).toBe(false);
    consoleError.mockRestore();
  });
});
