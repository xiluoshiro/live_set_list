import { DEFAULT_BAND_MEMBERS } from "./constants";
import type { DerivedSegment, OtherMemberDraft, SetlistDraftRow } from "./types";

export function getBandMembersTemplate(_bandName: string): string[] {
  return [...DEFAULT_BAND_MEMBERS];
}

export function buildOtherMemberPayload(entries: OtherMemberDraft[]): string {
  const pairs = entries
    .map((entry) => ({
      key: entry.member_key.trim(),
      value: entry.member_value.trim(),
    }))
    .filter((entry) => entry.key !== "");
  return JSON.stringify(Object.fromEntries(pairs.map((entry) => [entry.key, entry.value])));
}

export function summarizeBandMember(row: SetlistDraftRow): string {
  const bands = Object.keys(row.band_member).length;
  const members = Object.values(row.band_member).reduce((sum, membersByBand) => sum + membersByBand.length, 0);
  if (bands === 0) return "未选择";
  return `${bands}支 / ${members}人`;
}

export function summarizeOtherMember(row: SetlistDraftRow): string {
  const count = row.other_member.filter(
    (entry) => entry.member_key.trim() !== "" || entry.member_value.trim() !== "",
  ).length;
  if (count === 0) return "未填";
  return `${count}项`;
}

export function toggleBand(selectedBandIds: number[], bandId: number): number[] {
  if (selectedBandIds.includes(bandId)) {
    return selectedBandIds.filter((id) => id !== bandId);
  }
  return [...selectedBandIds, bandId].sort((a, b) => a - b);
}

export function getDerivedSegments(rows: SetlistDraftRow[]): DerivedSegment[] {
  const derived: DerivedSegment[] = [];
  let currentSegment = "M";
  let currentSubOrder = 0;

  rows.forEach((row, index) => {
    const startType = row.segment_start_type.trim();
    if (index === 0) {
      currentSegment = startType || "M";
      currentSubOrder = 1;
    } else if (startType !== "") {
      currentSegment = startType;
      currentSubOrder = 1;
    } else {
      currentSubOrder += 1;
    }

    derived.push({
      segmentType: currentSegment,
      subOrder: currentSubOrder,
    });
  });

  return derived;
}
