import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { LiveAdminSection } from "../components/console/LiveAdminSection";


function renderSection(onToggleDefaultBand = vi.fn()) {
  render(
    <LiveAdminSection
      liveDate="2026-07-17"
      liveTitle="Draft Live"
      liveType="other"
      liveUrl="https://example.com/live"
      openingTime="18:00"
      startTime="19:00"
      timezoneHour="+9"
      timezoneMinute=":00"
      timezoneMinuteDisabled={false}
      selectedVenueId={1}
      defaultBandIds={[3]}
      bandOptions={[
        { band_id: 0, band_name: "Other bands", band_abbr: "", band_members: [] },
        { band_id: 1, band_name: "Poppin'Party", band_abbr: "ppp", band_members: [] },
        { band_id: 3, band_name: "MyGO!!!!!", band_abbr: "mygo", band_members: [] },
      ]}
      venueQueryText=""
      venues={[{ venue_id: 1, venue_name: "Test Venue" }]}
      timezoneHourOptions={["+9"]}
      liveTypeOptions={[{ value: "other", label: "其他" }]}
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
      onOpenVenueMenu={vi.fn()}
      onOpenDefaultBandMenu={vi.fn()}
      onSelectVenue={vi.fn()}
      onToggleDefaultBand={onToggleDefaultBand}
      onQueryVid={vi.fn()}
      onInsertVenue={vi.fn()}
      onClearInsertLive={vi.fn()}
      onSubmitInsertLive={vi.fn()}
      queryInsertDisabled
      submitInsertDisabled={false}
    />,
  );
  return onToggleDefaultBand;
}


describe("LiveAdminSection", () => {
  // 测试点：默认 Band 下拉应允许多选正数 Band，并排除 band_id=0 占位项。
  test("renders and toggles default Band choices", () => {
    const onToggleDefaultBand = renderSection();
    const group = screen.getByRole("group", { name: "default_band_ids" });

    expect(screen.getByRole("button", { name: "MyGO!!!!!" })).toHaveAttribute("aria-expanded", "true");
    expect(within(group).queryByText(/Other bands/)).not.toBeInTheDocument();
    expect(within(group).getByRole("checkbox", { name: /MyGO/ })).toBeChecked();

    fireEvent.click(within(group).getByRole("checkbox", { name: /Poppin'Party/ }));
    expect(onToggleDefaultBand).toHaveBeenCalledWith(1);
  });
});
