import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { LiveAdminSection } from "../components/console/LiveAdminSection";


function renderSection(
  onToggleDefaultBand = vi.fn(),
  options: {
    liveType?: string;
    eventAttendees?: Record<number, string[]>;
    onToggleEventAttendee?: ReturnType<typeof vi.fn>;
    editingLiveId?: number | null;
    isLiveDirty?: boolean;
  } = {},
) {
  const onToggleEventAttendee = options.onToggleEventAttendee ?? vi.fn();
  render(
    <LiveAdminSection
      liveDate="2026-07-17"
      liveTitle="Draft Live"
      liveType={options.liveType ?? "other"}
      liveUrl="https://example.com/live"
      openingTime="18:00"
      startTime="19:00"
      timezoneHour="+9"
      timezoneMinute=":00"
      timezoneMinuteDisabled={false}
      selectedVenueId={1}
      defaultBandIds={[3]}
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
      insertedLives={[]}
      onLiveDateChange={vi.fn()}
      onLiveTitleChange={vi.fn()}
      onLiveTypeChange={vi.fn()}
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
      onStartNewLive={vi.fn()}
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
    renderSection(vi.fn(), { editingLiveId: 55 });

    expect(screen.getByRole("combobox", { name: "选择要编辑的 Live" })).toHaveValue("55");
    expect(screen.getByRole("button", { name: "恢复原值" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeInTheDocument();
    expect(screen.getByText("Live #55 有未保存修改")).toBeInTheDocument();
  });

  // 测试点：Live 类型筛选应与高亮的新建入口同时呈现，已保存的干净编辑态不重复显示状态提示。
  test("shows the type filter and highlighted create action without a clean edit hint", () => {
    renderSection(vi.fn(), { editingLiveId: 55, isLiveDirty: false });

    expect(screen.getByRole("combobox", { name: "按 Live 类型筛选" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "新建 Live" })).toHaveClass("console-submit-btn", "console-new-btn");
    expect(screen.queryByText(/Live #55 有未保存修改/)).not.toBeInTheDocument();
  });
});
