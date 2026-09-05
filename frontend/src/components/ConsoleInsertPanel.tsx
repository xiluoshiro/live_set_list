import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import {
  CONSOLE_LIVE_CHANGE_STORAGE_KEY,
  parseConsoleLiveChange,
  publishConsoleLiveChange,
} from "../consoleLiveSync";
import {
  appendConsoleLiveSetlist,
  createConsoleLive,
  createConsoleSong,
  createConsoleSongsBatch,
  createConsoleVenue,
  getConsoleBands,
  getConsoleBandHistory,
  getConsoleLive,
  getConsoleLiveCandidates,
  getConsoleLiveSetlist,
  getConsoleSongs,
  getConsoleVenues,
  getLiveDetail,
  getLives,
  updateConsoleLive,
  updateConsoleLiveSetlist,
  updateConsoleSong,
  type ConsoleBandItem,
  type ConsoleBandHistory,
  type ConsoleLiveBandLineupContext,
  type ConsoleEventAttendee,
  type ConsoleLiveCandidate,
  type ConsoleLiveSetlistAppendPayload,
  type ConsoleLiveSetlistEditResponse,
  type ConsoleLiveSetlistRowPayload,
  type ConsoleLiveUpsertPayload,
  type ConsoleLiveUpdatePayload,
  type DatePhase,
  type EventStatus,
  type ConsoleSongItem,
  type ConsoleSongCreatePayload,
  type ConsoleVenueItem,
  type LiveDetailResponse,
  type LiveItem,
} from "../api";
import { MemberStatusTable } from "./DetailMemberTable";
import { LiveAdminSection } from "./console/LiveAdminSection";
import { PageTitle } from "./PageTitle";
import { SectionTabs } from "./SectionTabs";
import { LiveInsertTab } from "./console/LiveInsertTab";
import { SongAdminSection } from "./console/SongAdminSection";
import { BandAdminSection } from "./console/BandAdminSection";
import { CompactConfirmationTable } from "./console/CompactConfirmationTable";
import { PerformanceGroupAdminSection } from "./console/PerformanceGroupAdminSection";
import { TourAdminSection } from "./console/TourAdminSection";
import { VenueAdminSection } from "./console/VenueAdminSection";
import {
  UpdateDiffTable,
  type UpdateChange,
} from "./console/UpdateDiffTable";
import {
  INITIAL_SETLIST_ROWS,
  LIVE_TYPE_OPTIONS,
  TIMEZONE_HOUR_OPTIONS,
  TIMEZONE_MINUTE_SUFFIXES,
  formatLiveType,
} from "./console/constants";
import {
  buildOtherMemberPayloadObject,
  getDerivedSegments,
  normalizeSongLookupText,
} from "./console/helpers";
import { EVENT_STATUS_LABELS } from "../liveStatus";
import { parseSetlistText } from "./console/setlistParser/parseSetlistText";
import type { ParsedSetlistWarning } from "./console/setlistParser/types";
import type {
  BandOption,
  ConsoleMode,
  LiveInsertBundle,
  LiveInsertRow,
  OtherMemberDraft,
  Position,
  SetlistDraftRow,
  SongInsertRow,
  VenueOption,
} from "./console/types";

type LiveInsertDraft = {
  history_entry_id: number;
  action: "create" | "update";
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  url: string | null;
  opening_time: string | null;
  start_time: string | null;
  timezone: string;
  venue_id: number | null;
  venue_name_version_id: number | null;
  default_band_ids: number[];
  event_attendees: ConsoleEventAttendee[];
  event_status: EventStatus;
  status_note: string | null;
};

type ConsoleInsertPanelProps = {
  onLiveDataChanged?: () => void;
  initialMode?: ConsoleMode;
};

type SetlistConfirmRow = ConsoleLiveSetlistRowPayload & {
  song_name: string;
};

type BatchSongConfirmRow = {
  song_name: string;
  band_id: number;
  band_name: string;
  cover: boolean;
  band_member: Record<string, string[]>;
};

type PendingConfirmation =
  | {
      kind: "venue";
      title: string;
      payload: { venue_name: string };
    }
  | {
      kind: "live";
      title: string;
      action: "create" | "update";
      liveId: number | null;
      payload: ConsoleLiveUpsertPayload;
      venueName: string;
      changes: Array<{ field: string; before: string; after: string }>;
      scheduleChangeKind: "correction" | "reschedule" | null;
      scheduleChangeNote: string | null;
    }
  | {
      kind: "live_discard";
      title: string;
      target: { type: "edit"; liveId: number } | { type: "mode"; mode: ConsoleMode };
    }
  | {
      kind: "song";
      title: string;
      action: "create" | "update";
      songId: number | null;
      payload: ConsoleSongCreatePayload;
      bandName: string;
      changes: UpdateChange[];
    }
  | {
      kind: "setlist";
      title: string;
      action: "create" | "update";
      live: LiveInsertRow;
      payload: ConsoleLiveSetlistAppendPayload;
      previewRows: SetlistConfirmRow[];
      changes: UpdateChange[];
    }
  | {
      kind: "batch_song";
      title: string;
      rows: BatchSongConfirmRow[];
      errors: string[];
    };

function toSongInsertRow(item: ConsoleSongItem): SongInsertRow {
  return {
    song_id: item.song_id,
    song_name: item.song_name,
    band_id: item.band_id,
    cover: item.cover,
    band_name: item.band_name,
  };
}

function toBandOption(item: ConsoleBandItem): BandOption {
  return {
    band_id: item.band_id,
    band_name: item.band_name,
    band_abbr: item.band_abbr,
    band_members: item.band_members,
  };
}

function toVenueOption(item: ConsoleVenueItem): VenueOption {
  return {
    venue_id: item.venue_id,
    venue_name: item.match_kind === "historical" && item.matched_name
      ? `${item.matched_name}（现名：${item.venue_name}）`
      : item.venue_name,
    venue_name_version_id: item.matched_name_version_id ?? item.venue_name_version_id,
  };
}

function toLiveInsertRow(item: LiveItem): LiveInsertRow {
  return {
    live_id: item.live_id,
    live_date: item.live_date,
    live_title: item.live_title,
    live_type: item.live_type,
    bands: item.bands.flatMap((band) => (typeof band === "number" ? [band] : [])),
    url: item.url,
  };
}

function sortById<T>(items: T[], getId: (item: T) => number): T[] {
  return [...items].sort((left, right) => getId(left) - getId(right));
}

function sortLivesForConsole(items: LiveInsertRow[]): LiveInsertRow[] {
  return [...items].sort((left, right) => {
    const eventPriorityOrder = Number(left.live_type === "event") - Number(right.live_type === "event");
    if (eventPriorityOrder !== 0) return eventPriorityOrder;
    const dateOrder = right.live_date.localeCompare(left.live_date);
    return dateOrder !== 0 ? dateOrder : right.live_id - left.live_id;
  });
}

function mergeSongs(existingSongs: SongInsertRow[], remoteSongs: SongInsertRow[]): SongInsertRow[] {
  const merged = new Map<number, SongInsertRow>();
  existingSongs.forEach((song) => merged.set(song.song_id, song));
  remoteSongs.forEach((song) => merged.set(song.song_id, song));
  return sortById([...merged.values()], (song) => song.song_id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function backendFailureDetail(error: unknown): string {
  const message = errorMessage(error);
  if (!(error instanceof Error)) {
    return message;
  }

  const apiError = error as Error & { status?: number; code?: string | null };
  const statusText = typeof apiError.status === "number" ? `HTTP ${apiError.status}` : "";
  const codeText = apiError.code ? apiError.code : "";
  return [statusText, codeText, message].filter(Boolean).join(" / ");
}

function formatTimedLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "未公布";

  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?(?:([+-]\d{2})(?::?(\d{2}))?)?$/);
  if (!match) return raw;

  const [, timePart, offsetHour, offsetMinute] = match;
  if (!offsetHour) return timePart;

  const normalizedOffset = `${offsetHour}:${offsetMinute ?? "00"}`;
  const timezoneLabelMap: Record<string, string> = {
    "+08:00": "CN",
    "+09:00": "JP",
  };
  const timezoneLabel = timezoneLabelMap[normalizedOffset] ?? `UTC${normalizedOffset}`;
  return `${timePart}(${timezoneLabel})`;
}

const DEFAULT_LIVE_OPENING_TIME = "18:00";
const DEFAULT_LIVE_START_TIME = "19:00";
const DEFAULT_LIVE_TIMEZONE = "+09:00";

function getTimezoneHourValue(timezone: string): string {
  return `${timezone[0]}${Number(timezone.slice(1, 3))}`;
}

function buildTimezoneOffset(hourValue: string, minuteSuffix: string): string {
  const hour = Number(hourValue);
  const sign = hour < 0 ? "-" : "+";
  return `${sign}${String(Math.abs(hour)).padStart(2, "0")}${minuteSuffix}`;
}

function getTodayDateInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAllowedLineupContext(
  history: ConsoleBandHistory,
  liveId: number,
): ConsoleLiveBandLineupContext | null {
  const nameVersion = history.name_versions.find(
    (version) => version.name_version_id === history.current_name_version_id,
  ) ?? [...history.name_versions].reverse().find((version) => version.valid_to === null);
  const transitionVersion = history.lineup_versions.find(
    (version) => version.transition_live_id === liveId,
  );
  if (nameVersion && transitionVersion?.predecessor_id) {
    return {
      band_id: history.band_id,
      band_name_version_id: nameVersion.name_version_id,
      base_lineup_version_id: transitionVersion.predecessor_id,
      next_lineup_version_id: transitionVersion.lineup_version_id,
    };
  }
  const lineupVersion = history.lineup_versions.find(
    (version) => version.lineup_version_id === history.current_lineup_version_id,
  ) ?? [...history.lineup_versions].reverse().find((version) => version.valid_to === null);
  if (!nameVersion || !lineupVersion) return null;
  return {
    band_id: history.band_id,
    band_name_version_id: nameVersion.name_version_id,
    base_lineup_version_id: lineupVersion.lineup_version_id,
    next_lineup_version_id: null,
  };
}

function getCurrentLineupContext(history: ConsoleBandHistory): ConsoleLiveBandLineupContext | null {
  const nameVersion = [...history.name_versions]
    .reverse()
    .find((version) => version.valid_to === null)
    ?? history.name_versions[history.name_versions.length - 1];
  const lineupVersion = [...history.lineup_versions]
    .reverse()
    .find((version) => version.valid_to === null)
    ?? history.lineup_versions[history.lineup_versions.length - 1];
  if (!nameVersion || !lineupVersion) return null;
  return {
    band_id: history.band_id,
    band_name_version_id: nameVersion.name_version_id,
    base_lineup_version_id: lineupVersion.lineup_version_id,
    next_lineup_version_id: null,
  };
}

function getLineupMembers(history: ConsoleBandHistory | undefined, lineupVersionId: number | null): string[] {
  if (!history || lineupVersionId === null) return [];
  return history.lineup_versions.find((version) => version.lineup_version_id === lineupVersionId)?.members ?? [];
}

function applyKnownLineupDefaults(
  rows: SetlistDraftRow[],
  bands: BandOption[],
  histories: Record<number, ConsoleBandHistory>,
  contexts: Record<number, ConsoleLiveBandLineupContext>,
): SetlistDraftRow[] {
  let changed = false;
  const nextRows = rows.map((row) => {
    let nextRow = row;
    bands.forEach((band) => {
      const history = histories[band.band_id];
      const context = contexts[band.band_id];
      const selectedMembers = nextRow.band_member[band.band_name];
      const catalogMembers = band.band_members ?? [];
      const hasCatalogDefault =
        history !== undefined
        && context !== undefined
        && nextRow.band_performances?.[band.band_name] === undefined
        && selectedMembers !== undefined
        && selectedMembers.length === catalogMembers.length
        && selectedMembers.every((member) => catalogMembers.includes(member));
      if (!hasCatalogDefault) return;

      const baseMembers = getLineupMembers(history, context.base_lineup_version_id);
      nextRow = {
        ...nextRow,
        band_member: { ...nextRow.band_member, [band.band_name]: baseMembers },
        band_performances: {
          ...(nextRow.band_performances ?? {}),
          [band.band_name]: {
            band_id: band.band_id,
            lineup_usage: "base",
            handover_baseline: null,
            members: [...baseMembers],
          },
        },
      };
      changed = true;
    });
    return nextRow;
  });
  return changed ? nextRows : rows;
}

function deriveDatePhaseForOffset(liveDate: string, timezone: string): DatePhase {
  const match = timezone.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return "today";
  const direction = match[1] === "-" ? -1 : 1;
  const offsetMinutes = direction * (Number(match[2]) * 60 + Number(match[3]));
  const localToday = new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 10);
  if (liveDate < localToday) return "past";
  if (liveDate > localToday) return "upcoming";
  return "today";
}

function getClockValue(value: string | null): string {
  return value?.slice(0, 5) ?? "";
}

function normalizeLivePayload(payload: ConsoleLiveUpsertPayload): ConsoleLiveUpsertPayload {
  return {
    ...payload,
    live_title: payload.live_title.trim(),
    url: payload.url.trim(),
    opening_time: payload.opening_time === "" ? null : payload.opening_time,
    start_time: payload.start_time === "" ? null : payload.start_time,
    status_note: payload.status_note?.trim() || null,
    event_status: payload.event_status ?? "scheduled",
    default_band_ids: [...payload.default_band_ids].sort((left, right) => left - right),
    event_attendees: [...payload.event_attendees]
      .sort((left, right) => left.band_id - right.band_id)
      .map((attendee) => ({ ...attendee, members: [...attendee.members] })),
    band_lineup_contexts: [...(payload.band_lineup_contexts ?? [])]
      .sort((left, right) => left.band_id - right.band_id),
  };
}

function livePayloadEquals(left: ConsoleLiveUpsertPayload | null, right: ConsoleLiveUpsertPayload): boolean {
  return left !== null && JSON.stringify(normalizeLivePayload(left)) === JSON.stringify(normalizeLivePayload(right));
}

function formatLivePayloadValue(field: keyof ConsoleLiveUpsertPayload, value: ConsoleLiveUpsertPayload[keyof ConsoleLiveUpsertPayload]): string {
  if ((field === "venue_id" || field === "opening_time" || field === "start_time") && value === null) return "未公布";
  if (field === "default_band_ids") return (value as number[]).join(", ") || "-";
  if (field === "event_status") return EVENT_STATUS_LABELS[(value as EventStatus | undefined) ?? "scheduled"];
  if (field === "status_note") return formatConfirmationValue(value);
  if (field === "event_attendees") {
    return (value as ConsoleLiveUpsertPayload["event_attendees"])
      .map((attendee) => `${attendee.band_id}: ${attendee.members.join(" / ")}`)
      .join("; ") || "-";
  }
  if (field === "band_lineup_contexts") {
    return (value as ConsoleLiveBandLineupContext[] | undefined)
      ?.map((context) => `${context.band_id}:${context.band_name_version_id}/${context.base_lineup_version_id}`)
      .join("; ") || "-";
  }
  return String(value);
}

function formatConfirmationValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.length > 0 ? JSON.stringify(value) : "-";
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0 ? JSON.stringify(value) : "-";
  }
  return String(value);
}

function buildSongUpdateChanges(
  original: ConsoleSongCreatePayload | null,
  current: ConsoleSongCreatePayload,
  bands: BandOption[],
): UpdateChange[] {
  if (original === null) return [];
  const bandValue = (bandId: number) => {
    const bandName = bands.find((band) => band.band_id === bandId)?.band_name;
    return bandName ? `${bandId} · ${bandName}` : String(bandId);
  };
  const values: Array<[string, string, string]> = [
    ["song_name", original.song_name, current.song_name],
    ["band_id", bandValue(original.band_id), bandValue(current.band_id)],
    ["cover", formatConfirmationValue(original.cover), formatConfirmationValue(current.cover)],
  ];
  return values.flatMap(([field, before, after]) => before === after ? [] : [{ field, before, after }]);
}

function formatSetlistRowSummary(
  row: ConsoleLiveSetlistRowPayload,
  songName: string | undefined,
): string {
  const title = songName ? `${row.song_id} · ${songName}` : String(row.song_id);
  return `${title}; ${row.segment_type}${row.sub_order}; short=${row.is_short ? "true" : "false"}`;
}

function buildSetlistUpdateChanges(
  original: ConsoleLiveSetlistAppendPayload | null,
  current: ConsoleLiveSetlistAppendPayload,
  originalSongNames: Record<number, string>,
  currentRows: SetlistConfirmRow[],
): UpdateChange[] {
  if (original === null) return [];
  const changes: UpdateChange[] = [];
  const originalContexts = new Map((original.band_lineup_contexts ?? []).map((context) => [context.band_id, context]));
  const currentContexts = new Map((current.band_lineup_contexts ?? []).map((context) => [context.band_id, context]));
  for (const bandId of [...new Set([...originalContexts.keys(), ...currentContexts.keys()])].sort((a, b) => a - b)) {
    const before = formatConfirmationValue(originalContexts.get(bandId));
    const after = formatConfirmationValue(currentContexts.get(bandId));
    if (before !== after) {
      changes.push({ field: `band_lineup_contexts[band_id=${bandId}]`, before, after });
    }
  }

  const originalRows = new Map(original.setlist_rows.map((row) => [row.absolute_order, row]));
  const nextRows = new Map(current.setlist_rows.map((row) => [row.absolute_order, row]));
  const nextSongNames = new Map(currentRows.map((row) => [row.absolute_order, row.song_name]));
  const rowFields: Array<keyof ConsoleLiveSetlistRowPayload> = [
    "song_id",
    "segment_type",
    "sub_order",
    "is_short",
    "band_member",
    "band_performances",
    "other_member",
    "comment",
  ];
  for (const absoluteOrder of [...new Set([...originalRows.keys(), ...nextRows.keys()])].sort((a, b) => a - b)) {
    const beforeRow = originalRows.get(absoluteOrder);
    const afterRow = nextRows.get(absoluteOrder);
    if (!beforeRow || !afterRow) {
      changes.push({
        field: `setlist_rows[abs=${absoluteOrder}]`,
        before: beforeRow
          ? formatSetlistRowSummary(beforeRow, originalSongNames[absoluteOrder])
          : "-",
        after: afterRow
          ? formatSetlistRowSummary(afterRow, nextSongNames.get(absoluteOrder))
          : "-",
      });
      continue;
    }
    for (const field of rowFields) {
      const before = field === "song_id"
        ? `${beforeRow.song_id}${originalSongNames[absoluteOrder] ? ` · ${originalSongNames[absoluteOrder]}` : ""}`
        : formatConfirmationValue(beforeRow[field]);
      const after = field === "song_id"
        ? `${afterRow.song_id}${nextSongNames.get(absoluteOrder) ? ` · ${nextSongNames.get(absoluteOrder)}` : ""}`
        : formatConfirmationValue(afterRow[field]);
      if (before !== after) {
        changes.push({ field: `setlist_rows[abs=${absoluteOrder}].${field}`, before, after });
      }
    }
  }
  return changes;
}

function normalizeSetlistPayloadForComparison(
  payload: ConsoleLiveSetlistAppendPayload,
): ConsoleLiveSetlistAppendPayload {
  const normalizeStringList = (value: unknown): string[] => {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))];
  };
  const normalizeBandMember = (
    value: ConsoleLiveSetlistRowPayload["band_member"],
  ): ConsoleLiveSetlistRowPayload["band_member"] => Object.fromEntries(
    Object.entries(value)
      .map(([bandName, members]) => [bandName.trim(), normalizeStringList(members)] as const)
      .filter(([bandName, members]) => bandName !== "" && members.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const normalizeOtherMember = (
    value: ConsoleLiveSetlistRowPayload["other_member"],
  ): ConsoleLiveSetlistRowPayload["other_member"] => {
    if (value === null || value === undefined) return null;
    const entries = Object.entries(value)
      .map(([memberName, members]) => {
        const normalizedMembers = normalizeStringList(members);
        const normalizedValue = normalizedMembers.length === 0
          ? null
          : normalizedMembers.length === 1
            ? normalizedMembers[0]
            : normalizedMembers;
        return [memberName.trim(), normalizedValue] as const;
      })
      .filter(([memberName]) => memberName !== "")
      .sort(([left], [right]) => left.localeCompare(right));
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  };
  return {
    band_lineup_contexts: [...(payload.band_lineup_contexts ?? [])]
      .sort((left, right) => left.band_id - right.band_id)
      .map((context) => ({ ...context })),
    setlist_rows: [...payload.setlist_rows]
      .sort((left, right) => left.absolute_order - right.absolute_order)
      .map((row) => {
        const bandPerformances = [...(row.band_performances ?? [])]
          .sort((left, right) => left.band_id - right.band_id)
          .map((performance) => ({ ...performance, members: [...performance.members] }));
        return {
          song_id: row.song_id,
          absolute_order: row.absolute_order,
          segment_type: row.segment_type,
          sub_order: row.sub_order,
          is_short: row.is_short,
          // 版本化阵容写入时，后端会按历史名称重建兼容字段；实际语义由 band_performances 决定。
          band_member: bandPerformances.length > 0 ? {} : normalizeBandMember(row.band_member),
          band_performances: bandPerformances,
          other_member: normalizeOtherMember(row.other_member),
          comment: row.comment ?? null,
        };
      }),
  };
}

function persistedSetlistMatchesPayload(
  persisted: ConsoleLiveSetlistEditResponse,
  expected: ConsoleLiveSetlistAppendPayload,
): boolean {
  const persistedPayload: ConsoleLiveSetlistAppendPayload = {
    band_lineup_contexts: persisted.band_lineup_contexts ?? [],
    setlist_rows: persisted.rows.map((row) => ({
      song_id: row.song_id,
      absolute_order: row.absolute_order,
      segment_type: row.segment_type,
      sub_order: row.sub_order,
      is_short: row.is_short,
      band_member: row.band_member,
      band_performances: row.band_performances ?? [],
      other_member: row.other_member ?? null,
      comment: row.comment ?? null,
    })),
  };
  return JSON.stringify(normalizeSetlistPayloadForComparison(persistedPayload))
    === JSON.stringify(normalizeSetlistPayloadForComparison(expected));
}

export function ConsoleInsertPanel({ onLiveDataChanged, initialMode = "setlist" }: ConsoleInsertPanelProps = {}) {
  const auth = useAuth();
  const [mode, setMode] = useState<ConsoleMode>(initialMode);
  const [lives, setLives] = useState<LiveInsertRow[]>([]);
  const [songs, setSongs] = useState<SongInsertRow[]>([]);
  const [bands, setBands] = useState<BandOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [submittedBundles, setSubmittedBundles] = useState<LiveInsertBundle[]>([]);
  const [displayedBundle, setDisplayedBundle] = useState<LiveInsertBundle | null>(null);
  const [message, setMessage] = useState<string>("");
  const [transientNotice, setTransientNotice] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmationSubmitting, setConfirmationSubmitting] = useState(false);

  const [selectedLiveId, setSelectedLiveId] = useState<number>(0);
  const [livePage, setLivePage] = useState(1);
  const [livePagination, setLivePagination] = useState({ page: 1, page_size: 20, total: 0, total_pages: 1 });
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [setlistCandidateRefreshKey, setSetlistCandidateRefreshKey] = useState(0);
  const [setlistEditQuery, setSetlistEditQuery] = useState("");
  const [setlistEditLives, setSetlistEditLives] = useState<LiveInsertRow[]>([]);

  const [songName, setSongName] = useState("");
  const [songBandId, setSongBandId] = useState<number | null>(null);
  const [songBandOpen, setSongBandOpen] = useState(false);
  const [songBandMenuPos, setSongBandMenuPos] = useState<Position | null>(null);
  const [songCover, setSongCover] = useState(false);
  const [insertedSongs, setInsertedSongs] = useState<SongInsertRow[]>([]);
  const [songQuery, setSongQuery] = useState("");
  const [songBandFilterId, setSongBandFilterId] = useState<number | null>(null);
  const [songCandidates, setSongCandidates] = useState<SongInsertRow[]>([]);
  const [songPage, setSongPage] = useState(1);
  const [songPagination, setSongPagination] = useState({ page: 1, page_size: 20, total: 0, total_pages: 1 });
  const [songLoading, setSongLoading] = useState(false);
  const [editingSongId, setEditingSongId] = useState<number | null>(null);
  const [originalSongPayload, setOriginalSongPayload] = useState<ConsoleSongCreatePayload | null>(null);

  const [liveDate, setLiveDate] = useState(() => getTodayDateInputValue());
  const [liveTitle, setLiveTitle] = useState("");
  const [liveType, setLiveType] = useState(LIVE_TYPE_OPTIONS[0].value);
  const [liveUrl, setLiveUrl] = useState("");
  const [openingTime, setOpeningTime] = useState(DEFAULT_LIVE_OPENING_TIME);
  const [startTime, setStartTime] = useState(DEFAULT_LIVE_START_TIME);
  const [venueAnnounced, setVenueAnnounced] = useState(true);
  const [openingTimeAnnounced, setOpeningTimeAnnounced] = useState(true);
  const [startTimeAnnounced, setStartTimeAnnounced] = useState(true);
  const [timezone, setTimezone] = useState(DEFAULT_LIVE_TIMEZONE);
  const [selectedVenueId, setSelectedVenueId] = useState<number>(0);
  const [defaultBandIds, setDefaultBandIds] = useState<number[]>([]);
  const [defaultBandLineupContexts, setDefaultBandLineupContexts] = useState<
    Record<number, ConsoleLiveBandLineupContext>
  >({});
  const [eventAttendees, setEventAttendees] = useState<Record<number, string[]>>({});
  const [eventStatus, setEventStatus] = useState<EventStatus>("scheduled");
  const [statusNote, setStatusNote] = useState("");
  const [scheduleChangeKind, setScheduleChangeKind] = useState<"correction" | "reschedule" | null>(null);
  const [scheduleChangeNote, setScheduleChangeNote] = useState("");
  const [defaultBandOpen, setDefaultBandOpen] = useState(false);
  const [defaultBandMenuPos, setDefaultBandMenuPos] = useState<Position | null>(null);
  const [venueQueryText, setVenueQueryText] = useState("");
  const [venueOpen, setVenueOpen] = useState(false);
  const [venueMenuPos, setVenueMenuPos] = useState<Position | null>(null);
  const [insertedLives, setInsertedLives] = useState<LiveInsertDraft[]>([]);
  const liveHistoryEntryIdRef = useRef(0);
  const [liveCandidates, setLiveCandidates] = useState<ConsoleLiveCandidate[]>([]);
  const [liveCandidateQuery, setLiveCandidateQuery] = useState("");
  const [liveCandidateType, setLiveCandidateType] = useState("");
  const [liveCandidateEventStatus, setLiveCandidateEventStatus] = useState("");
  const [liveCandidatePage, setLiveCandidatePage] = useState(1);
  const [liveCandidatePagination, setLiveCandidatePagination] = useState({ page: 1, page_size: 20, total: 0, total_pages: 1 });
  const [liveCandidateLoading, setLiveCandidateLoading] = useState(false);
  const [scheduleAttentionItems, setScheduleAttentionItems] = useState<ConsoleLiveCandidate[]>([]);
  const [scheduleAttentionCounts, setScheduleAttentionCounts] = useState({ upcoming: 0, today: 0, overdue: 0 });
  const [scheduleAttentionFilter, setScheduleAttentionFilter] = useState<"" | "upcoming" | "today" | "overdue">("");
  const [scheduleAttentionLoading, setScheduleAttentionLoading] = useState(false);
  const selectFirstLiveCandidateAfterQueryRef = useRef(false);
  const [editingLiveId, setEditingLiveId] = useState<number | null>(null);
  const [originalLivePayload, setOriginalLivePayload] = useState<ConsoleLiveUpsertPayload | null>(null);
  const [editingLiveHasSetlist, setEditingLiveHasSetlist] = useState(false);
  const [clearLiveAfterCreate, setClearLiveAfterCreate] = useState(true);
  const [setlistDetailOpen, setSetlistDetailOpen] = useState(false);
  const [setlistDetailData, setSetlistDetailData] = useState<LiveDetailResponse | null>(null);
  const [setlistDetailLoading, setSetlistDetailLoading] = useState(false);
  const [setlistDetailError, setSetlistDetailError] = useState<string | null>(null);

  const [setlistRows, setSetlistRows] = useState<SetlistDraftRow[]>(INITIAL_SETLIST_ROWS);
  const [originalSetlistPayload, setOriginalSetlistPayload] = useState<ConsoleLiveSetlistAppendPayload | null>(null);
  const [originalSetlistSongNames, setOriginalSetlistSongNames] = useState<Record<number, string>>({});
  const [bandHistories, setBandHistories] = useState<Record<number, ConsoleBandHistory>>({});
  const [lineupContexts, setLineupContexts] = useState<Record<number, ConsoleLiveBandLineupContext>>({});
  const [setlistRowKey, setSetlistRowKey] = useState(1000);
  const [setlistPasteText, setSetlistPasteText] = useState("");
  const [setlistParseWarnings, setSetlistParseWarnings] = useState<ParsedSetlistWarning[]>([]);
  const [setlistParsePreviewRows, setSetlistParsePreviewRows] = useState<SetlistDraftRow[]>([]);
  const [setlistParsePreviewOpen, setSetlistParsePreviewOpen] = useState(false);
  const [setlistParsePreviewMeta, setSetlistParsePreviewMeta] = useState<{
    nextRowKey: number;
    nextOtherMemberEntryKey: number;
  } | null>(null);
  const [didSongLookup, setDidSongLookup] = useState(false);
  const [otherMemberEntryKey, setOtherMemberEntryKey] = useState(100);
  const [otherMemberValueSeparator, setOtherMemberValueSeparator] = useState(",");
  const [editingBandRowKey, setEditingBandRowKey] = useState<number | null>(null);
  const [bandMemberMenuPos, setBandMemberMenuPos] = useState<Position | null>(null);
  const [editingOtherRowKey, setEditingOtherRowKey] = useState<number | null>(null);
  const [otherMemberMenuPos, setOtherMemberMenuPos] = useState<Position | null>(null);
  const [songModalRowKey, setSongModalRowKey] = useState<number | null>(null);

  const songBandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const songBandMenuRef = useRef<HTMLDivElement | null>(null);
  const venueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const venueMenuRef = useRef<HTMLDivElement | null>(null);
  const defaultBandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const defaultBandMenuRef = useRef<HTMLDivElement | null>(null);
  const venueQueryInputRef = useRef<HTMLInputElement | null>(null);
  const bandMemberTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const bandMemberMenuRef = useRef<HTMLDivElement | null>(null);
  const otherMemberTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const otherMemberMenuRef = useRef<HTMLDivElement | null>(null);
  const didInitialVenueFocusRef = useRef(false);

  const timezoneHour = getTimezoneHourValue(timezone);
  const timezoneMinute = timezone.slice(3);
  const timezoneMinuteDisabled = timezoneHour === "-12" || timezoneHour === "+14";
  const currentLivePayload = useMemo<ConsoleLiveUpsertPayload>(() => ({
    live_date: liveDate,
    live_title: liveTitle.trim(),
    live_type: liveType,
    url: liveUrl.trim(),
    opening_time: openingTimeAnnounced ? openingTime : null,
    start_time: startTimeAnnounced ? startTime : null,
    timezone,
    venue_id: venueAnnounced ? selectedVenueId : null,
    venue_name_version_id: venueAnnounced
      ? (venues.find((venue) => venue.venue_id === selectedVenueId)?.venue_name_version_id ?? null)
      : null,
    default_band_ids: defaultBandIds,
    event_attendees: liveType === "event"
      ? defaultBandIds.flatMap((bandId) => {
          const members = eventAttendees[bandId] ?? [];
          return members.length > 0 ? [{ band_id: bandId, members }] : [];
        })
      : [],
    band_lineup_contexts: editingLiveHasSetlist
      ? (originalLivePayload?.band_lineup_contexts ?? []).map((context) => ({ ...context }))
      : defaultBandIds.flatMap((bandId) => {
          const context = defaultBandLineupContexts[bandId];
          return context ? [context] : [];
        }),
    event_status: eventStatus,
    status_note: statusNote.trim() || null,
  }), [
    defaultBandIds,
    defaultBandLineupContexts,
    editingLiveHasSetlist,
    eventAttendees,
    eventStatus,
    liveDate,
    liveTitle,
    liveType,
    liveUrl,
    openingTime,
    openingTimeAnnounced,
    originalLivePayload,
    selectedVenueId,
    venues,
    startTime,
    startTimeAnnounced,
    statusNote,
    timezone,
    venueAnnounced,
  ]);
  const isLiveDirty = editingLiveId !== null && !livePayloadEquals(originalLivePayload, currentLivePayload);
  const scheduleFields = new Set<keyof ConsoleLiveUpsertPayload>([
    "live_date",
    "opening_time",
    "start_time",
    "timezone",
    "venue_id",
    "venue_name_version_id",
  ]);
  const hasScheduleChanges = editingLiveId !== null && originalLivePayload !== null
    && [...scheduleFields].some((field) => (
      formatLivePayloadValue(field, originalLivePayload[field])
      !== formatLivePayloadValue(field, currentLivePayload[field])
    ));
  const changedScheduleFields = originalLivePayload === null ? [] : [...scheduleFields].filter((field) => (
    formatLivePayloadValue(field, originalLivePayload[field])
    !== formatLivePayloadValue(field, currentLivePayload[field])
  ));
  const isAnnouncementOnlyChange = changedScheduleFields.length > 0
    && changedScheduleFields.every((field) => (
      (field === "venue_id" || field === "venue_name_version_id" || field === "opening_time" || field === "start_time")
      && originalLivePayload?.[field] === null
      && currentLivePayload[field] !== null
    ));
  const requiresScheduleChangeKind = hasScheduleChanges && !isAnnouncementOnlyChange;
  const currentDatePhase = deriveDatePhaseForOffset(liveDate, timezone);

  useEffect(() => {
    if (requiresScheduleChangeKind) return;
    if (scheduleChangeKind !== null) setScheduleChangeKind(null);
    if (scheduleChangeNote !== "") setScheduleChangeNote("");
  }, [requiresScheduleChangeKind, scheduleChangeKind, scheduleChangeNote]);

  const changeTimezoneHour = (hourValue: string) => {
    const minuteSuffix = hourValue === "-12" || hourValue === "+14" ? ":00" : timezoneMinute;
    setTimezone(buildTimezoneOffset(hourValue, minuteSuffix));
  };

  const cycleTimezoneMinute = () => {
    if (timezoneMinuteDisabled) return;
    const currentIndex = TIMEZONE_MINUTE_SUFFIXES.indexOf(
      timezoneMinute as (typeof TIMEZONE_MINUTE_SUFFIXES)[number],
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % TIMEZONE_MINUTE_SUFFIXES.length : 0;
    setTimezone(buildTimezoneOffset(timezoneHour, TIMEZONE_MINUTE_SUFFIXES[nextIndex]));
  };

  useEffect(() => {
    if (mode !== "live_create" || didInitialVenueFocusRef.current) return;
    didInitialVenueFocusRef.current = true;
    venueQueryInputRef.current?.focus();
  }, [mode]);

  const derivedSegments = useMemo(() => getDerivedSegments(setlistRows), [setlistRows]);
  const effectiveAbs = useMemo(() => setlistRows.map((row, i) => row.absolute_order ?? (i + 1)), [setlistRows]);
  const effectiveSub = useMemo(
    () => setlistRows.map((row, i) => row.sub_order ?? derivedSegments[i]?.subOrder ?? 1),
    [setlistRows, derivedSegments],
  );
  const hasBatchSongInsertCandidate = setlistRows.some(
    (row) =>
      row.song_name.trim() !== ""
      && row.song_id.trim() === ""
      && (row.song_candidates?.length ?? 0) === 0,
  );
  const selectedSetlistLive = (mode === "setlist_edit" ? setlistEditLives : lives)
    .find((live) => live.live_id === selectedLiveId);
  const activeSetlistBands = useMemo(() => {
    const names = new Set(setlistRows.flatMap((row) => Object.keys(row.band_member)));
    return bands.filter((band) => band.band_id > 0 && names.has(band.band_name));
  }, [bands, setlistRows]);
  const usesVersionedLineups =
    activeSetlistBands.length > 0
    && activeSetlistBands.every((band) => lineupContexts[band.band_id] !== undefined);
  // 校验规则 1：查询 venue 行若当前查询输入为空，禁用该行“插入”。
  const isVenueQuickInsertDisabled = venueQueryText.trim() === "";
  // 校验规则 2：已确定的排期字段必须有值；暂未公布的排期字段允许为空。
  const isLiveSubmitDisabled =
    (venueAnnounced && selectedVenueId <= 0) ||
    (venueAnnounced && currentLivePayload.venue_name_version_id === null) ||
    liveDate.trim() === "" ||
    liveTitle.trim() === "" ||
    liveType.trim() === "" ||
    liveUrl.trim() === "" ||
    (openingTimeAnnounced && openingTime.trim() === "") ||
    (startTimeAnnounced && startTime.trim() === "") ||
    timezone.trim() === "" ||
    (mode === "live_edit" && (editingLiveId === null || !isLiveDirty));
  const isLiveSubmitBlocked = isLiveSubmitDisabled
    || (mode === "live_edit" && requiresScheduleChangeKind && scheduleChangeKind === null);
  const hasExistingSetlist = (setlistDetailData?.detail_rows ?? []).length > 0;
  // 校验规则 3：候选刷新期间或当前 live_id 已不在本页候选中时不可提交。
  const isSetlistSubmitDisabled =
    isLiveLoading ||
    selectedSetlistLive === undefined ||
    !usesVersionedLineups ||
    setlistRows.length === 0 ||
    (mode === "setlist" && hasExistingSetlist) ||
    setlistRows.some((row) => {
      const hasBandMember = Object.values(row.band_member).some((members) => members.length > 0);
      return row.song_name.trim() === "" || row.song_id.trim() === "" || !hasBandMember;
    });
  // 校验规则 4：新增歌曲的“提交插入”要求 song_name 与 band_id 均非空。
  const isSongSubmitDisabled = songName.trim() === "" || songBandId === null;
  // 校验规则 5：批量插入歌曲必须先查询过，且至少存在一行无 sid、无待选候选的歌名。
  const isBatchSongInsertDisabled = !didSongLookup || !hasBatchSongInsertCandidate;

  useEffect(() => {
    if (mode === "setlist_edit") return;
    setSetlistRows(INITIAL_SETLIST_ROWS.map((row) => ({ ...row, row_key: 1 })));
    setOriginalSetlistPayload(null);
    setOriginalSetlistSongNames({});
    setSetlistRowKey(1000);
    setOtherMemberEntryKey(100);
    setDidSongLookup(false);
    setSetlistPasteText("");
    setSetlistParseWarnings([]);
    setSetlistParsePreviewRows([]);
    setSetlistParsePreviewOpen(false);
    setSetlistParsePreviewMeta(null);
    setEditingBandRowKey(null);
    setEditingOtherRowKey(null);
    setBandMemberMenuPos(null);
    setOtherMemberMenuPos(null);
    setSetlistDetailOpen(false);
    setSetlistDetailData(null);
    setSetlistDetailError(null);
    setSetlistDetailLoading(false);
    setLineupContexts({});
  }, [mode, selectedLiveId]);

  useEffect(() => {
    let canceled = false;

    const loadConsoleLookups = async () => {
      const [songResult, bandResult, venueResult] = await Promise.allSettled([
        getConsoleSongs(undefined, 100),
        getConsoleBands(undefined, 100),
        getConsoleVenues(undefined, 100),
      ]);
      if (canceled) return;

      if (songResult.status === "fulfilled") {
        const loadedSongs = songResult.value.items.map(toSongInsertRow);
        const totalSongs = songResult.value.total ?? loadedSongs.length;
        setSongs((prev) => mergeSongs(prev, loadedSongs));
        setSongCandidates(loadedSongs.slice(0, 20));
        setSongPagination({
          page: 1,
          page_size: 20,
          total: totalSongs,
          total_pages: Math.max(1, Math.ceil(totalSongs / 20)),
        });
      }
      if (bandResult.status === "fulfilled" && bandResult.value.items.length > 0) {
        setBands(sortById(bandResult.value.items.map(toBandOption), (band) => band.band_id));
      }
      if (venueResult.status === "fulfilled" && venueResult.value.items.length > 0) {
        const nextVenues = sortById(venueResult.value.items.map(toVenueOption), (venue) => venue.venue_id);
        setVenues(nextVenues);
        setSelectedVenueId((prev) =>
          nextVenues.some((venue) => venue.venue_id === prev) ? prev : nextVenues[0]?.venue_id ?? 0,
        );
      }
      const failures = [
        songResult.status === "rejected" ? `songs: ${errorMessage(songResult.reason)}` : "",
        bandResult.status === "rejected" ? `bands: ${errorMessage(bandResult.reason)}` : "",
        venueResult.status === "rejected" ? `venues: ${errorMessage(venueResult.reason)}` : "",
      ].filter(Boolean);
      if (failures.length > 0) {
        setMessage(`加载控制台候选失败：${failures.join("；")}`);
      }
    };

    void loadConsoleLookups();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== "setlist") {
      setIsLiveLoading(false);
      return;
    }
    let canceled = false;
    setIsLiveLoading(true);

    const loadLivePage = async () => {
      try {
        const response = await getLives(livePage, 20, true);
        if (canceled) return;
        const nextLives = sortLivesForConsole(response.items.map(toLiveInsertRow));
        setLives(nextLives);
        setLivePagination(response.pagination);
        setSelectedLiveId((prev) =>
          nextLives.some((live) => live.live_id === prev) ? prev : nextLives[0]?.live_id ?? 0,
        );
      } catch (error) {
        if (canceled) return;
        setLives([]);
        setSelectedLiveId(0);
        setMessage(`加载live候选失败：${errorMessage(error)}`);
      } finally {
        if (!canceled) {
          setIsLiveLoading(false);
        }
      }
    };

    void loadLivePage();
    return () => {
      canceled = true;
    };
  }, [livePage, mode, setlistCandidateRefreshKey]);

  useEffect(() => {
    const refreshSetlistCandidates = () => {
      if (mode === "setlist") {
        setSetlistCandidateRefreshKey((key) => key + 1);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CONSOLE_LIVE_CHANGE_STORAGE_KEY) return;
      const change = parseConsoleLiveChange(event.newValue);
      if (!change || mode !== "setlist") return;
      if (change.action === "setlist_appended") {
        setMessage(
          change.liveId === selectedLiveId
            ? `Live #${change.liveId} 已在另一标签页写入 Setlist，正在切换候选并清空当前草稿。`
            : `另一标签页已为 Live #${change.liveId} 写入 Setlist，正在刷新候选。`,
        );
      }
      refreshSetlistCandidates();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [mode, selectedLiveId]);

  useEffect(() => {
    if (!songBandOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (songBandTriggerRef.current?.contains(target)) return;
      if (songBandMenuRef.current?.contains(target)) return;
      setSongBandOpen(false);
    };
    const close = () => setSongBandOpen(false);
    const onScroll = () => openSongBandMenu();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll);
    };
  }, [songBandOpen]);

  useEffect(() => {
    if (!venueOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (venueTriggerRef.current?.contains(target)) return;
      if (venueMenuRef.current?.contains(target)) return;
      setVenueOpen(false);
    };
    const close = () => setVenueOpen(false);
    const onScroll = () => openVenueMenu();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll);
    };
  }, [venueOpen]);

  useEffect(() => {
    if (!defaultBandOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (defaultBandTriggerRef.current?.contains(target)) return;
      if (defaultBandMenuRef.current?.contains(target)) return;
      setDefaultBandOpen(false);
    };
    const close = () => setDefaultBandOpen(false);
    const onScroll = () => openDefaultBandMenu();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll);
    };
  }, [defaultBandOpen]);

  useEffect(() => {
    if (editingBandRowKey === null) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const trigger = bandMemberTriggerRefs.current[editingBandRowKey];
      if (trigger?.contains(target)) return;
      if (bandMemberMenuRef.current?.contains(target)) return;
      setEditingBandRowKey(null);
      setBandMemberMenuPos(null);
    };
    const close = () => {
      setEditingBandRowKey(null);
      setBandMemberMenuPos(null);
    };
    const onScroll = () => {
      if (editingBandRowKey !== null) openBandMemberMenu(editingBandRowKey);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll);
    };
  }, [editingBandRowKey]);

  useEffect(() => {
    if (editingOtherRowKey === null) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const trigger = otherMemberTriggerRefs.current[editingOtherRowKey];
      if (trigger?.contains(target)) return;
      if (otherMemberMenuRef.current?.contains(target)) return;
      setEditingOtherRowKey(null);
      setOtherMemberMenuPos(null);
    };
    const close = () => {
      setEditingOtherRowKey(null);
      setOtherMemberMenuPos(null);
    };
    const onScroll = () => {
      if (editingOtherRowKey !== null) openOtherMemberMenu(editingOtherRowKey);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll);
    };
  }, [editingOtherRowKey]);

  useEffect(() => {
    if (transientNotice === null) return;
    const timer = window.setTimeout(() => setTransientNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [transientNotice]);

  const showTransientNotice = (notice: string) => {
    setTransientNotice(notice);
  };

  const resetLiveForm = () => {
    setLiveDate(getTodayDateInputValue());
    setLiveTitle("");
    setLiveType(LIVE_TYPE_OPTIONS[0].value);
    setLiveUrl("");
    setOpeningTime(DEFAULT_LIVE_OPENING_TIME);
    setStartTime(DEFAULT_LIVE_START_TIME);
    setVenueAnnounced(true);
    setOpeningTimeAnnounced(true);
    setStartTimeAnnounced(true);
    setTimezone(DEFAULT_LIVE_TIMEZONE);
    setSelectedVenueId(0);
    setDefaultBandIds([]);
    setDefaultBandLineupContexts({});
    setEventAttendees({});
    setEventStatus("scheduled");
    setStatusNote("");
    setScheduleChangeKind(null);
    setScheduleChangeNote("");
    setEditingLiveHasSetlist(false);
    setVenueQueryText("");
    setVenueOpen(false);
    setVenueMenuPos(null);
    setDefaultBandOpen(false);
    setDefaultBandMenuPos(null);
  };

  const applyLivePayloadToForm = (payload: ConsoleLiveUpsertPayload) => {
    setLiveDate(payload.live_date);
    setLiveTitle(payload.live_title);
    setLiveType(payload.live_type);
    setLiveUrl(payload.url);
    setOpeningTimeAnnounced(payload.opening_time !== null);
    setStartTimeAnnounced(payload.start_time !== null);
    setVenueAnnounced(payload.venue_id !== null);
    setOpeningTime(payload.opening_time ?? DEFAULT_LIVE_OPENING_TIME);
    setStartTime(payload.start_time ?? DEFAULT_LIVE_START_TIME);
    setTimezone(payload.timezone);
    setSelectedVenueId(payload.venue_id ?? 0);
    setDefaultBandIds([...payload.default_band_ids]);
    setDefaultBandLineupContexts(Object.fromEntries(
      (payload.band_lineup_contexts ?? []).map((context) => [context.band_id, { ...context }]),
    ));
    setEventAttendees(Object.fromEntries(payload.event_attendees.map((attendee) => [attendee.band_id, [...attendee.members]])));
    setEventStatus(payload.event_status ?? "scheduled");
    setStatusNote(payload.status_note ?? "");
    setScheduleChangeKind(null);
    setScheduleChangeNote("");
    setDefaultBandOpen(false);
    setDefaultBandMenuPos(null);
  };

  const restoreLiveForm = () => {
    if (editingLiveId !== null && originalLivePayload !== null) {
      applyLivePayloadToForm(originalLivePayload);
      setMessage(`已恢复 Live #${editingLiveId} 的原始值。`);
      return;
    }
    resetLiveForm();
    setMessage("已清空新增Live表格。");
  };

  const toggleDefaultBand = (bandId: number) => {
    if (defaultBandIds.includes(bandId)) {
      setDefaultBandIds((current) => current.filter((currentBandId) => currentBandId !== bandId));
      setDefaultBandLineupContexts((contexts) => {
        const next = { ...contexts };
        delete next[bandId];
        return next;
      });
      setEventAttendees((attendees) => {
        const next = { ...attendees };
        delete next[bandId];
        return next;
      });
      return;
    }
    setDefaultBandIds((current) => [...new Set([...current, bandId])].sort((left, right) => left - right));
    void ensureBandHistory(bandId).then((history) => {
      const context = history ? getCurrentLineupContext(history) : null;
      if (context) {
        setDefaultBandLineupContexts((current) => ({ ...current, [bandId]: context }));
      }
    });
  };

  const toggleEventAttendee = (bandId: number, memberName: string) => {
    setEventAttendees((current) => {
      const selected = current[bandId] ?? [];
      const context = defaultBandLineupContexts[bandId];
      const bandMembers = context
        ? getLineupMembers(bandHistories[bandId], context.base_lineup_version_id)
        : bands.find((band) => band.band_id === bandId)?.band_members ?? [];
      const nextSelected = selected.includes(memberName)
        ? selected.filter((member) => member !== memberName)
        : bandMembers.filter((member) => member === memberName || selected.includes(member));
      const next = { ...current };
      if (nextSelected.length === 0) {
        delete next[bandId];
      } else {
        next[bandId] = nextSelected;
      }
      return next;
    });
  };

  const clearLiveForm = () => {
    restoreLiveForm();
  };

  const loadLiveCandidatePage = async (
    query: string,
    page: number,
    candidateType = liveCandidateType,
    candidateEventStatus = liveCandidateEventStatus,
  ) => {
    setLiveCandidateLoading(true);
    try {
      const response = candidateEventStatus
        ? await getConsoleLiveCandidates(query, page, 20, candidateType, undefined, candidateEventStatus)
        : await getConsoleLiveCandidates(query, page, 20, candidateType);
      setLiveCandidates(response.items);
      setLiveCandidatePage(response.page);
      setLiveCandidatePagination(response);
      if (selectFirstLiveCandidateAfterQueryRef.current) {
        selectFirstLiveCandidateAfterQueryRef.current = false;
        const firstCandidate = response.items[0];
        if (firstCandidate && firstCandidate.live_id !== editingLiveId) {
          requestLiveForEdit(firstCandidate.live_id);
        }
      }
    } catch (error) {
      selectFirstLiveCandidateAfterQueryRef.current = false;
      setLiveCandidates([]);
      setMessage(`加载可编辑 Live 失败：${errorMessage(error)}`);
    } finally {
      setLiveCandidateLoading(false);
    }
  };

  const queryLiveCandidates = () => {
    selectFirstLiveCandidateAfterQueryRef.current = true;
    if (liveCandidatePage === 1) {
      void loadLiveCandidatePage(liveCandidateQuery, 1, liveCandidateType, liveCandidateEventStatus);
    } else {
      setLiveCandidatePage(1);
    }
  };

  const loadSetlistForEdit = async (liveId: number) => {
    setIsLiveLoading(true);
    try {
      const response = await getConsoleLiveSetlist(liveId);
      const responseLineupContexts = response.band_lineup_contexts ?? [];
      const loadedHistories = await Promise.all(
        responseLineupContexts.map((context) => getConsoleBandHistory(context.band_id)),
      );
      setBandHistories((current) => ({
        ...current,
        ...Object.fromEntries(loadedHistories.map((history) => [history.band_id, history])),
      }));
      setLineupContexts(Object.fromEntries(
        responseLineupContexts.map((context) => [context.band_id, context]),
      ));
      let nextOtherEntryId = 100;
      const nextRows: SetlistDraftRow[] = response.rows.map((row, index) => {
        const versionedBandMember = Object.fromEntries(
          (row.band_performances ?? []).flatMap((performance) => {
            const band = bands.find((item) => item.band_id === performance.band_id);
            return band ? [[band.band_name, performance.members]] : [];
          }),
        );
        return {
          row_key: index + 1,
          song_name: row.song_name,
          song_id: String(row.song_id),
          song_resolved_name: row.song_name,
          segment_start_type: row.segment_type,
          absolute_order: row.absolute_order,
          sub_order: row.sub_order,
          is_short: row.is_short,
          band_member: Object.keys(versionedBandMember).length > 0
            ? versionedBandMember
            : Object.fromEntries(
                Object.entries(row.band_member).map(([name, members]) => [
                  name,
                  Array.isArray(members) ? members.map(String) : [String(members)],
                ]),
              ),
          band_performances: Object.fromEntries(
            (row.band_performances ?? []).flatMap((performance) => {
              const band = bands.find((item) => item.band_id === performance.band_id);
              return band ? [[band.band_name, {
                band_id: performance.band_id,
                lineup_usage: performance.lineup_usage,
                handover_baseline: performance.handover_baseline,
                members: [...performance.members],
              }]] : [];
            }),
          ),
          other_member: Object.entries(row.other_member ?? {}).map(([memberKey, memberValue]) => ({
            entry_id: ++nextOtherEntryId,
            member_key: memberKey,
            member_value: Array.isArray(memberValue) ? memberValue.join(otherMemberValueSeparator) : String(memberValue ?? ""),
          })),
          comment: row.comment ?? "",
        };
      });
      setOriginalSetlistPayload({
        ...(responseLineupContexts.length > 0
          ? { band_lineup_contexts: responseLineupContexts.map((context) => ({ ...context })) }
          : {}),
        setlist_rows: response.rows.map((row) => ({
          song_id: row.song_id,
          absolute_order: row.absolute_order,
          segment_type: row.segment_type,
          sub_order: row.sub_order,
          is_short: row.is_short,
          band_member: row.band_member,
          band_performances: row.band_performances,
          other_member: row.other_member,
          comment: row.comment,
        })),
      });
      setOriginalSetlistSongNames(Object.fromEntries(
        response.rows.map((row) => [row.absolute_order, row.song_name]),
      ));
      setSelectedLiveId(liveId);
      setSetlistRows(nextRows.length > 0 ? nextRows : INITIAL_SETLIST_ROWS.map((row) => ({ ...row })));
      setSetlistRowKey(Math.max(1000, nextRows.length + 1));
      setOtherMemberEntryKey(nextOtherEntryId);
      setDidSongLookup(true);
      setMessage(`已加载 Live #${liveId} 的 ${response.rows.length} 条 Setlist。`);
    } catch (error) {
      setOriginalSetlistPayload(null);
      setOriginalSetlistSongNames({});
      setMessage(`加载 Live #${liveId} Setlist 失败：${errorMessage(error)}`);
    } finally {
      setIsLiveLoading(false);
    }
  };

  const querySetlistEditLives = async () => {
    setIsLiveLoading(true);
    try {
      const response = await getConsoleLiveCandidates(setlistEditQuery, 1, 100, "", true);
      const candidates = response.items.map((item) => ({
        live_id: item.live_id,
        live_date: item.live_date,
        live_title: item.live_title,
        live_type: item.live_type,
        bands: [],
        url: null,
      }));
      setSetlistEditLives(candidates);
      const first = candidates[0];
      if (first) await loadSetlistForEdit(first.live_id);
      else {
        setSelectedLiveId(0);
        setMessage("没有符合条件的 Setlist。");
      }
    } catch (error) {
      setSetlistEditLives([]);
      setSelectedLiveId(0);
      setMessage(`查询 Setlist 失败：${errorMessage(error)}`);
    } finally {
      setIsLiveLoading(false);
    }
  };

  const changeLiveCandidateType = (candidateType: string) => {
    setLiveCandidateType(candidateType);
    setLiveCandidatePage(1);
  };

  const loadLiveForEdit = async (liveId: number) => {
    setLiveCandidateLoading(true);
    setMessage("");
    try {
      const response = await getConsoleLive(liveId);
      const item = response.item;
      const payload = normalizeLivePayload({
        live_date: item.live_date,
        live_title: item.live_title,
        live_type: item.live_type,
        url: item.url,
        opening_time: getClockValue(item.opening_time),
        start_time: getClockValue(item.start_time),
        timezone: item.timezone,
        venue_id: item.venue_id,
        venue_name_version_id: item.venue_name_version_id,
        default_band_ids: item.default_band_ids,
        event_attendees: item.event_attendees.map((attendee) => ({
          band_id: attendee.band_id,
          members: attendee.members,
        })),
        band_lineup_contexts: item.band_lineup_contexts ?? [],
        event_status: item.event_status,
        status_note: item.status_note,
      });
      if (
        item.venue_id !== null
        && item.venue_name !== null
        && item.venue_name_version_id !== null
      ) {
        setVenues((current) => sortById([
          ...current.filter((venue) => venue.venue_id !== item.venue_id),
          {
            venue_id: item.venue_id as number,
            venue_name: item.venue_name as string,
            venue_name_version_id: item.venue_name_version_id as number,
          },
        ], (venue) => venue.venue_id));
      }
      setEditingLiveId(item.live_id);
      setOriginalLivePayload(payload);
      setEditingLiveHasSetlist(item.has_setlist ?? false);
      await Promise.all(item.default_band_ids.map((bandId) => ensureBandHistory(bandId)));
      applyLivePayloadToForm(payload);
      setMessage(`已加载 Live #${item.live_id}。`);
    } catch (error) {
      setMessage(`加载 Live #${liveId} 失败：${errorMessage(error)}`);
    } finally {
      setLiveCandidateLoading(false);
    }
  };

  const requestLiveForEdit = (liveId: number) => {
    if (isLiveDirty) {
      setPendingConfirmation({
        kind: "live_discard",
        title: "确认放弃 Live 修改",
        target: { type: "edit", liveId },
      });
      return;
    }
    void loadLiveForEdit(liveId);
  };

  const changeConsoleMode = (nextMode: ConsoleMode) => {
    if (mode === "live_edit" && nextMode !== "live_edit" && isLiveDirty) {
      setPendingConfirmation({
        kind: "live_discard",
        title: "确认放弃 Live 修改",
        target: { type: "mode", mode: nextMode },
      });
      return;
    }
    if (nextMode === "live_create" && mode !== "live_create") {
      setEditingLiveId(null);
      setOriginalLivePayload(null);
      resetLiveForm();
    } else if (nextMode === "live_edit" && mode !== "live_edit") {
      setEditingLiveId(null);
      setOriginalLivePayload(null);
      resetLiveForm();
    } else if (nextMode === "setlist" && mode !== "setlist") {
      setLivePage(1);
      setSelectedLiveId(0);
    } else if (nextMode === "setlist_edit" && mode !== "setlist_edit") {
      setSelectedLiveId(0);
    }
    setMode(nextMode);
  };

  const changeSetlistLivePage = (nextPage: number) => {
    setSelectedLiveId(0);
    setLivePage(nextPage);
  };

  useEffect(() => {
    if (mode !== "live_edit") return;
    void loadLiveCandidatePage(
      liveCandidateQuery,
      liveCandidatePage,
      liveCandidateType,
      liveCandidateEventStatus,
    );
  }, [liveCandidatePage, liveCandidateType, liveCandidateEventStatus, mode]);

  useEffect(() => {
    if (mode !== "setlist_edit") return;
    void querySetlistEditLives();
  }, [mode]);

  const resetSongForm = () => {
    setEditingSongId(null);
    setOriginalSongPayload(null);
    setSongName("");
    setSongBandId(null);
    setSongCover(false);
    setSongBandOpen(false);
    setSongBandMenuPos(null);
  };

  const clearSongForm = () => {
    resetSongForm();
    setMessage("已清空歌曲表格。");
  };

  const selectSongForEdit = (songId: number) => {
    const song = songCandidates.find((candidate) => candidate.song_id === songId);
    if (!song) return;
    setEditingSongId(song.song_id);
    setOriginalSongPayload({
      song_name: song.song_name,
      band_id: song.band_id,
      cover: song.cover,
    });
    setSongName(song.song_name);
    setSongBandId(song.band_id);
    setSongCover(song.cover);
    setMessage(`已加载歌曲 #${song.song_id}。`);
  };

  const loadSongCandidatePage = async (query: string, page: number, bandId: number | null) => {
    setSongLoading(true);
    try {
      const response = bandId === null
        ? await getConsoleSongs(query, 20, page)
        : await getConsoleSongs(query, 20, page, bandId);
      const candidates = response.items.map(toSongInsertRow);
      const responsePage = response.page ?? page;
      const responsePageSize = response.page_size ?? 20;
      const responseTotal = response.total ?? candidates.length;
      const responseTotalPages = response.total_pages ?? Math.max(1, Math.ceil(responseTotal / responsePageSize));
      setSongCandidates(candidates);
      setSongPage(responsePage);
      setSongPagination({
        page: responsePage,
        page_size: responsePageSize,
        total: responseTotal,
        total_pages: responseTotalPages,
      });
      if (candidates.length === 0) setMessage("没有符合条件的歌曲。");
    } catch (error) {
      setSongCandidates([]);
      setMessage(`查询歌曲失败：${errorMessage(error)}`);
    } finally {
      setSongLoading(false);
    }
  };

  const querySongCandidates = async () => {
    setSongPage(1);
    await loadSongCandidatePage(songQuery, 1, songBandFilterId);
  };

  const loadScheduleAttention = async (attention: "" | "upcoming" | "today" | "overdue" = scheduleAttentionFilter) => {
    setScheduleAttentionLoading(true);
    try {
      const response = await getConsoleLiveCandidates("", 1, 10, "", undefined, "scheduled", false, attention);
      const counts = response.attention_counts ?? { upcoming: 0, today: 0, overdue: 0 };
      const defaultUrgentItems = response.items.filter((item) => (
        item.schedule_attention === "today" || item.schedule_attention === "overdue"
      ));
      setScheduleAttentionItems(attention === ""
        ? (defaultUrgentItems.length > 0 ? defaultUrgentItems : response.items.filter((item) => item.schedule_attention === "upcoming").slice(0, 1))
        : response.items);
      setScheduleAttentionCounts(counts);
      setScheduleAttentionFilter(attention);
    } catch (error) {
      setScheduleAttentionItems([]);
      setMessage(`加载待补排期资料失败：${errorMessage(error)}`);
    } finally {
      setScheduleAttentionLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== "live_edit") return;
    void loadScheduleAttention("");
  }, [mode]);

  useEffect(() => {
    if (mode !== "song") return;
    void loadSongCandidatePage(songQuery, songPage, songBandFilterId);
  }, [mode, songPage]);

  const selectSongForEditFromItem = (song: SongInsertRow) => {
    setEditingSongId(song.song_id);
    setOriginalSongPayload({
      song_name: song.song_name,
      band_id: song.band_id,
      cover: song.cover,
    });
    setSongName(song.song_name);
    setSongBandId(song.band_id);
    setSongCover(song.cover);
    setMessage(`已加载歌曲 #${song.song_id}。`);
  };

  const addSetlistRow = () => {
    setDidSongLookup(false);
    const newRowKey = setlistRowKey + 1;
    setSetlistRowKey(newRowKey);
    setSetlistRows((prev) => [
      ...prev,
      {
        row_key: newRowKey,
        song_name: "",
        song_id: "",
        segment_start_type: "",
        is_short: false,
        band_member: {},
        band_performances: {},
        other_member: [{ entry_id: newRowKey, member_key: "", member_value: "" }],
      },
    ]);
  };

  const removeLastSetlistRow = () => {
    setDidSongLookup(false);
    setSetlistRows((prev) => {
      if (prev.length <= 1) {
        showTransientNotice("至少保留一行 setlist 草稿。");
        return prev;
      }
      return prev.slice(0, -1);
    });
  };

  const clearSetlistData = () => {
    setSetlistRows(INITIAL_SETLIST_ROWS.map((row) => ({ ...row, row_key: 1 })));
    setSetlistRowKey(1000);
    setOtherMemberEntryKey(100);
    setDidSongLookup(false);
  };

  const updateSetlistRow = <K extends keyof SetlistDraftRow>(
    rowKey: number,
    key: K,
    value: SetlistDraftRow[K],
  ) => {
    setSetlistRows((prev) => prev.map((row) => (row.row_key === rowKey ? { ...row, [key]: value } : row)));
  };

  const updateSetlistSongName = (rowKey: number, value: string) => {
    setDidSongLookup(false);
    setSetlistRows((prev) =>
      prev.map((row) =>
        row.row_key === rowKey
          ? { ...row, song_name: value, song_id: "", song_resolved_name: undefined, song_candidates: [] }
          : row,
      ),
    );
  };

  const updateSetlistSongId = (rowKey: number, value: string, resolvedName?: string) => {
    setSetlistRows((prev) =>
      prev.map((row) =>
        row.row_key === rowKey
          ? { ...row, song_id: value, song_resolved_name: resolvedName, song_candidates: [] }
          : row,
      ),
    );
  };

  const updateSetlistAbs = (rowKey: number, value: number) => {
    setSetlistRows((prev) => {
      const targetIndex = prev.findIndex((row) => row.row_key === rowKey);
      if (targetIndex === -1) return prev;
      for (let i = 0; i < targetIndex; i += 1) {
        const eff = prev[i].absolute_order ?? (i + 1);
        if (eff >= value) {
          setMessage(`abs 必须单调递增：第 ${i + 1} 行为 ${eff}，不能填 ${value}`);
          return prev;
        }
      }
      let cascaded = value;
      return prev.map((row, i) => {
        if (i < targetIndex) return row;
        if (i === targetIndex) return { ...row, absolute_order: value };
        const manual = row.absolute_order;
        if (manual != null && manual > cascaded) {
          cascaded = manual;
          return row;
        }
        cascaded = cascaded + 1;
        return { ...row, absolute_order: cascaded };
      });
    });
  };

  const updateSetlistSub = (rowKey: number, value: number) => {
    setSetlistRows((prev) => {
      const targetIndex = prev.findIndex((row) => row.row_key === rowKey);
      if (targetIndex === -1) return prev;
      const currentDerived = getDerivedSegments(prev);
      const groupSegment = currentDerived[targetIndex]?.segmentType;
      if (!groupSegment) return prev;
      const groupIndices = currentDerived.reduce<number[]>((acc, seg, i) => {
        if (seg.segmentType === groupSegment) acc.push(i);
        return acc;
      }, []);
      const targetGroupIndex = groupIndices.indexOf(targetIndex);
      for (let gi = 0; gi < targetGroupIndex; gi += 1) {
        const i = groupIndices[gi];
        const eff = prev[i].sub_order ?? currentDerived[i]?.subOrder ?? 1;
        if (eff >= value) {
          setMessage(`sub（组 ${groupSegment}）必须单调递增：第 ${i + 1} 行为 ${eff}，不能填 ${value}`);
          return prev;
        }
      }
      let cascaded = value;
      return prev.map((row, i) => {
        const groupIdx = groupIndices.indexOf(i);
        if (groupIdx === -1 || groupIdx < targetGroupIndex) return row;
        if (i === targetIndex) return { ...row, sub_order: value };
        const manual = row.sub_order;
        if (manual != null && manual > cascaded) {
          cascaded = manual;
          return row;
        }
        cascaded = cascaded + 1;
        return { ...row, sub_order: cascaded };
      });
    });
  };

  const resolveSetlistPreviewSongName = (row: SetlistDraftRow | undefined): string => {
    if (!row) return "";
    const resolvedName = row.song_resolved_name?.trim();
    if (resolvedName) return resolvedName;
    const songId = Number(row.song_id);
    if (Number.isFinite(songId)) {
      const cachedSong = songs.find((song) => song.song_id === songId);
      if (cachedSong) return cachedSong.song_name;
    }
    return row.song_name.trim();
  };

  const querySongsForSetlist = async () => {
    const queryNames = [...new Set(setlistRows.map((row) => row.song_name.trim()).filter((name) => name !== ""))];
    const songCandidatesByQuery = new Map<string, SongInsertRow[]>();

    try {
      const responses = await Promise.all(queryNames.map((name) => getConsoleSongs(name, 10)));
      const remoteSongs = responses.flatMap((response) => response.items.map(toSongInsertRow));
      setSongs((prev) => mergeSongs(prev, remoteSongs));
      responses.forEach((response, index) => {
        const normalizedQuery = normalizeSongLookupText(queryNames[index]);
        if (normalizedQuery === "") return;
        const candidates = response.items.map(toSongInsertRow);
        const existingCandidates = songCandidatesByQuery.get(normalizedQuery) ?? [];
        const mergedCandidates = mergeSongs(existingCandidates, candidates);
        songCandidatesByQuery.set(normalizedQuery, mergedCandidates);
      });
    } catch (error) {
      setMessage(`查询歌曲失败：${errorMessage(error)}`);
      return;
    }

    const resolveCandidates = (normalizedName: string): SongInsertRow[] => {
      const candidates = songCandidatesByQuery.get(normalizedName) ?? [];
      const prefixCandidates = candidates.filter((song) =>
        normalizeSongLookupText(song.song_name).startsWith(normalizedName)
      );
      const exactCandidates = prefixCandidates.filter(
        (song) => normalizeSongLookupText(song.song_name) === normalizedName
      );
      return exactCandidates.length > 0 ? exactCandidates : prefixCandidates;
    };

    let matched = 0;
    let pending = 0;
    let missing = 0;
    const autoCompleted: Array<{ input: string; resolved: string }> = [];
    const nextRows = setlistRows.map((row) => {
      const normalizedName = normalizeSongLookupText(row.song_name);
      if (normalizedName === "") {
        return { ...row, song_id: "", song_resolved_name: undefined, song_candidates: [] };
      }
      const candidates = resolveCandidates(normalizedName);
      if (candidates.length === 1) {
        matched += 1;
        if (normalizeSongLookupText(candidates[0].song_name) !== normalizedName) {
          autoCompleted.push({ input: row.song_name.trim(), resolved: candidates[0].song_name });
        }
        return {
          ...row,
          song_id: String(candidates[0].song_id),
          song_resolved_name: candidates[0].song_name,
          song_candidates: [],
        };
      }
      if (candidates.length > 1) {
        pending += 1;
        return { ...row, song_id: "", song_resolved_name: undefined, song_candidates: candidates };
      }
      missing += 1;
      return { ...row, song_id: "", song_resolved_name: undefined, song_candidates: [] };
    });

    setSetlistRows(nextRows);
    setDidSongLookup(true);
    const autoCompleteHint = autoCompleted.length > 0
      ? `自动补全 ${autoCompleted.length} 行：${autoCompleted
          .map(({ input, resolved }) => `${input} → ${resolved}`)
          .join("；")}。`
      : "";
    if (pending > 0) {
      setMessage(`查询歌曲完成：匹配 ${matched} 行，待选择 ${pending} 行，未匹配 ${missing} 行。${autoCompleteHint}`);
    } else {
      setMessage(`查询歌曲完成：匹配 ${matched} 行，未匹配 ${missing} 行。${autoCompleteHint}`);
    }
  };

  const updateSetlistPasteText = (value: string) => {
    setSetlistPasteText(value);
    setSetlistParseWarnings([]);
    setSetlistParsePreviewRows([]);
    setSetlistParsePreviewOpen(false);
    setSetlistParsePreviewMeta(null);
  };

  const buildSetlistPastePreview = () => {
    const rawText = setlistPasteText.trim();
    if (rawText === "") {
      setMessage("解析失败：请先粘贴 setlist 文本。");
      return null;
    }

    try {
      const parsedResult = parseSetlistText(rawText, bands, setlistRowKey, otherMemberEntryKey);
      const result = {
        ...parsedResult,
        rows: applyKnownLineupDefaults(
          parsedResult.rows,
          bands,
          bandHistories,
          lineupContexts,
        ),
      };
      setSetlistParseWarnings(result.warnings);
      setSetlistParsePreviewRows(result.rows);
      setSetlistParsePreviewOpen(false);
      setSetlistParsePreviewMeta({
        nextRowKey: result.nextRowKey,
        nextOtherMemberEntryKey: result.nextOtherMemberEntryKey,
      });
      setMessage(`解析完成：生成 ${result.rows.length} 行草稿，${result.warnings.length} 条提示。`);
      return result;
    } catch (error) {
      setSetlistParseWarnings([{ line: 1, message: errorMessage(error) }]);
      setSetlistParsePreviewRows([]);
      setSetlistParsePreviewOpen(false);
      setSetlistParsePreviewMeta(null);
      setMessage(`解析失败：${errorMessage(error)}`);
      return null;
    }
  };

  const applySetlistPastePreview = () => {
    const result =
      setlistParsePreviewRows.length > 0 && setlistParsePreviewMeta
        ? {
            rows: setlistParsePreviewRows,
            warnings: setlistParseWarnings,
            nextRowKey: setlistParsePreviewMeta.nextRowKey,
            nextOtherMemberEntryKey: setlistParsePreviewMeta.nextOtherMemberEntryKey,
          }
        : buildSetlistPastePreview();
    if (!result || result.rows.length === 0) return;

    setSetlistRows(result.rows);
    setSetlistRowKey(result.nextRowKey);
    setOtherMemberEntryKey(result.nextOtherMemberEntryKey);
    setSetlistPasteText("");
    setSetlistParseWarnings([]);
    setSetlistParsePreviewRows([]);
    setSetlistParsePreviewOpen(false);
    setSetlistParsePreviewMeta(null);
    setDidSongLookup(false);
    setEditingBandRowKey(null);
    setEditingOtherRowKey(null);
    setBandMemberMenuPos(null);
    setOtherMemberMenuPos(null);
    setDisplayedBundle(null);
    setMessage(`已应用批量解析结果：${result.rows.length} 行，请继续点击“查询歌曲”匹配 sid。`);
  };

  const clearSetlistPastePreview = () => {
    setSetlistPasteText("");
    setSetlistParseWarnings([]);
    setSetlistParsePreviewRows([]);
    setSetlistParsePreviewOpen(false);
    setSetlistParsePreviewMeta(null);
    setMessage("已清空批量粘贴内容。");
  };

  const computeMenuTop = (rect: DOMRect, estimatedHeight: number): number => {
    const below = rect.bottom + 6;
    if (below + estimatedHeight <= window.innerHeight) return below;
    const above = rect.top - estimatedHeight - 6;
    return Math.max(above, 4);
  };

  const openSongBandMenu = () => {
    const rect = songBandTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.max(rect.width, 280);
    setSongBandMenuPos({
      top: computeMenuTop(rect, Math.min(320, window.innerHeight * 0.6)),
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setSongBandOpen(true);
  };

  const openVenueMenu = () => {
    const rect = venueTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.max(rect.width, 320);
    setVenueMenuPos({
      top: computeMenuTop(rect, Math.min(320, window.innerHeight * 0.6)),
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setDefaultBandOpen(false);
    setVenueOpen(true);
  };

  const openDefaultBandMenu = () => {
    const rect = defaultBandTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.max(rect.width, 320);
    setDefaultBandMenuPos({
      top: computeMenuTop(rect, Math.min(320, window.innerHeight * 0.6)),
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setVenueOpen(false);
    setDefaultBandOpen(true);
  };

  const openBandMemberMenu = (rowKey: number) => {
    const trigger = bandMemberTriggerRefs.current[rowKey];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 440;
    setBandMemberMenuPos({
      top: computeMenuTop(rect, Math.min(420, window.innerHeight * 0.7)),
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setEditingBandRowKey(rowKey);
    setEditingOtherRowKey(null);
    setOtherMemberMenuPos(null);
  };

  const openOtherMemberMenu = (rowKey: number) => {
    const trigger = otherMemberTriggerRefs.current[rowKey];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 520;
    setOtherMemberMenuPos({
      top: computeMenuTop(rect, Math.min(360, window.innerHeight * 0.65)),
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setEditingOtherRowKey(rowKey);
    setEditingBandRowKey(null);
    setBandMemberMenuPos(null);
  };

  const ensureBandHistory = async (bandId: number): Promise<ConsoleBandHistory | null> => {
    const cached = bandHistories[bandId];
    if (cached) return cached;
    try {
      const history = await getConsoleBandHistory(bandId);
      if (!history) return null;
      setBandHistories((current) => ({ ...current, [bandId]: history }));
      return history;
    } catch (error) {
      setMessage(`加载 Band #${bandId} 历史失败：${errorMessage(error)}`);
      return null;
    }
  };

  useEffect(() => {
    activeSetlistBands.forEach((band) => {
      const existingContext = lineupContexts[band.band_id];
      const existingHistory = bandHistories[band.band_id];
      if (existingContext && existingHistory) {
        setSetlistRows((current) => applyKnownLineupDefaults(
          current,
          [band],
          { [band.band_id]: existingHistory },
          { [band.band_id]: existingContext },
        ));
        return;
      }
      void ensureBandHistory(band.band_id).then((history) => {
        if (!history) return;
        const resolvedContext = existingContext ?? getAllowedLineupContext(history, selectedLiveId);
        if (!resolvedContext) return;
        setLineupContexts((current) => current[band.band_id]
          ? current
          : { ...current, [band.band_id]: resolvedContext });
        setSetlistRows((current) => applyKnownLineupDefaults(
          current,
          [band],
          { [band.band_id]: history },
          { [band.band_id]: resolvedContext },
        ));
      });
    });
  }, [activeSetlistBands, bandHistories, lineupContexts, selectedLiveId]);

  const toggleBandForSetlistRow = (rowKey: number, bandName: string) => {
    const matchedBand = bands.find((band) => band.band_name === bandName);
    if (!matchedBand) return;
    const row = setlistRows.find((item) => item.row_key === rowKey);
    if (row?.band_member[bandName]) {
      setSetlistRows((current) => current.map((item) => {
        if (item.row_key !== rowKey) return item;
        const nextBandMember = { ...item.band_member };
        const nextPerformances = { ...(item.band_performances ?? {}) };
        delete nextBandMember[bandName];
        delete nextPerformances[bandName];
        return { ...item, band_member: nextBandMember, band_performances: nextPerformances };
      }));
      return;
    }
    void ensureBandHistory(matchedBand.band_id).then((history) => {
      if (!history) return;
      const context = lineupContexts[matchedBand.band_id] ?? getAllowedLineupContext(history, selectedLiveId);
      if (!context) {
        setMessage(`Band #${matchedBand.band_id} 尚未建立可用阵容版本。`);
        return;
      }
      setLineupContexts((current) => ({ ...current, [matchedBand.band_id]: context }));
      const members = getLineupMembers(history, context.base_lineup_version_id);
      setSetlistRows((current) =>
        current.map((item) => item.row_key === rowKey
          ? {
              ...item,
              band_member: { ...item.band_member, [bandName]: members },
              band_performances: {
                ...(item.band_performances ?? {}),
                [bandName]: {
                  band_id: matchedBand.band_id,
                  lineup_usage: "base",
                  handover_baseline: null,
                  members: [...members],
                },
              },
            }
          : item),
      );
    });
  };

  const updateSetlistBandMode = (
    rowKey: number,
    bandName: string,
    lineupUsage: "base" | "next" | "handover",
  ) => {
    const band = bands.find((item) => item.band_name === bandName);
    if (!band) return;
    const context = lineupContexts[band.band_id];
    const history = bandHistories[band.band_id];
    if (!context || !history) return;
    const lineupVersionId = lineupUsage === "next"
      ? context.next_lineup_version_id
      : context.base_lineup_version_id;
    const members = getLineupMembers(history, lineupVersionId);
    setSetlistRows((current) => current.map((row) => row.row_key === rowKey
      ? {
          ...row,
          band_member: { ...row.band_member, [bandName]: members },
          band_performances: {
            ...(row.band_performances ?? {}),
            [bandName]: {
              band_id: band.band_id,
              lineup_usage: lineupUsage,
              handover_baseline: lineupUsage === "handover" ? "base" : null,
              members: [...members],
            },
          },
        }
      : row));
  };

  const updateSetlistHandoverBaseline = (
    rowKey: number,
    bandName: string,
    handoverBaseline: "base" | "next",
  ) => {
    setSetlistRows((current) => current.map((row) => {
      if (row.row_key !== rowKey) return row;
      const performance = row.band_performances?.[bandName];
      if (!performance || performance.lineup_usage !== "handover") return row;
      return {
        ...row,
        band_performances: {
          ...(row.band_performances ?? {}),
          [bandName]: { ...performance, handover_baseline: handoverBaseline },
        },
      };
    }));
  };

  const toggleBandMemberForSetlistRow = (rowKey: number, bandName: string, memberName: string) => {
    setSetlistRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        const selected = row.band_member[bandName] ?? [];
        const nextMembers = selected.includes(memberName)
          ? selected.filter((member) => member !== memberName)
          : [...selected, memberName];
        const performance = row.band_performances?.[bandName];
        return {
          ...row,
          band_member: {
            ...row.band_member,
            [bandName]: nextMembers,
          },
          band_performances: performance
            ? {
                ...(row.band_performances ?? {}),
                [bandName]: { ...performance, members: [...nextMembers] },
              }
            : row.band_performances,
        };
      }),
    );
  };

  const addOtherMemberEntry = (rowKey: number) => {
    const nextId = otherMemberEntryKey + 1;
    setOtherMemberEntryKey(nextId);
    setSetlistRows((prev) =>
      prev.map((row) =>
        row.row_key === rowKey
          ? {
              ...row,
              other_member: [...row.other_member, { entry_id: nextId, member_key: "", member_value: "" }],
            }
          : row,
      ),
    );
  };

  const removeOtherMemberEntry = (rowKey: number, entryId: number) => {
    setSetlistRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        if (row.other_member.length <= 1) {
          return {
            ...row,
            other_member: [{ entry_id: row.other_member[0]?.entry_id ?? entryId, member_key: "", member_value: "" }],
          };
        }
        return { ...row, other_member: row.other_member.filter((entry) => entry.entry_id !== entryId) };
      }),
    );
  };

  const updateOtherMemberEntry = (
    rowKey: number,
    entryId: number,
    key: "member_key" | "member_value",
    value: string,
  ) => {
    setSetlistRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        return {
          ...row,
          other_member: row.other_member.map((entry) =>
            entry.entry_id === entryId ? { ...entry, [key]: value } : entry,
          ),
        };
      }),
    );
  };

  const showCurrentSetlistDetail = async () => {
    if (selectedLiveId <= 0) {
      setMessage("显示详细信息失败：未选择有效的 live_id。");
      return;
    }

    setSetlistDetailOpen(true);
    setSetlistDetailLoading(true);
    setSetlistDetailError(null);
    setSetlistDetailData(null);
    try {
      const detail = await getLiveDetail(selectedLiveId);
      setSetlistDetailData(detail);
      setMessage(`Live #${selectedLiveId} 详细信息已加载。`);
    } catch (error) {
      const message = errorMessage(error);
      setSetlistDetailError(message === "Request timeout" ? "请求超时，请稍后重试" : message);
      setMessage(`加载Live #${selectedLiveId} 详细信息失败：${message}`);
    } finally {
      setSetlistDetailLoading(false);
    }
  };

  const requestSetlistConfirmation = () => {
    const targetLive = (mode === "setlist_edit" ? setlistEditLives : lives)
      .find((live) => live.live_id === selectedLiveId);
    if (!targetLive) {
      setMessage("提交setlist失败：未选择有效的 live_id。");
      return;
    }

    const validRows = setlistRows.filter((row) => row.song_name.trim() !== "");

    if (validRows.length === 0) {
      setMessage("提交setlist失败：至少填写一行 song_name。");
      return;
    }

    const unresolvedCount = validRows.filter((row) => row.song_id.trim() === "").length;
    if (unresolvedCount > 0) {
      setMessage(`提交setlist失败：还有 ${unresolvedCount} 行 sid 未匹配，请先点击“查询歌曲”。`);
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("提交setlist失败：登录态已失效，请重新登录。");
      return;
    }
    const validDerivedSegments = getDerivedSegments(validRows);
    const setlistPayload = validRows.map((row, payloadIndex) => {
      const derived = validDerivedSegments[payloadIndex];
      const originalIndex = setlistRows.findIndex((r) => r.row_key === row.row_key);
      const versionedBandNames = new Set([
        ...Object.keys(row.band_member),
        ...Object.keys(row.band_performances ?? {}),
      ]);
      const bandPerformances = [...versionedBandNames].flatMap((bandName) => {
        const band = bands.find((item) => item.band_name === bandName);
        if (!band) return [];
        const fallbackMembers = row.band_member[bandName] ?? [];
        const performance = row.band_performances?.[bandName] ?? {
          band_id: band.band_id,
          lineup_usage: "base" as const,
          handover_baseline: null,
          members: [...fallbackMembers],
        };
        return [{ ...performance, members: [...performance.members] }];
      });
      const bandMember = Object.fromEntries(
        bandPerformances.flatMap((performance) => {
          const bandName = bands.find((band) => band.band_id === performance.band_id)?.band_name;
          return bandName ? [[bandName, [...performance.members]]] : [];
        }),
      );
      return {
        song_id: Number(row.song_id),
        absolute_order: effectiveAbs[originalIndex],
        segment_type: derived.segmentType,
        sub_order: effectiveSub[originalIndex],
        is_short: row.is_short,
        band_member: bandMember,
        band_performances: bandPerformances,
        other_member: buildOtherMemberPayloadObject(row.other_member, otherMemberValueSeparator),
        comment: row.comment?.trim() || null,
      };
    });
    const previewRows = setlistPayload.map((row, idx) => ({
      ...row,
      song_name: resolveSetlistPreviewSongName(validRows[idx]),
    }));

    const payload: ConsoleLiveSetlistAppendPayload = {
      band_lineup_contexts: activeSetlistBands
        .map((band) => lineupContexts[band.band_id])
        .filter((context): context is ConsoleLiveBandLineupContext => context !== undefined),
      setlist_rows: setlistPayload,
    };
    setPendingConfirmation({
      kind: "setlist",
      title: mode === "setlist_edit" ? "确认更新 Setlist" : "确认提交 Setlist",
      action: mode === "setlist_edit" ? "update" : "create",
      live: targetLive,
      payload,
      previewRows,
      changes: mode === "setlist_edit"
        ? buildSetlistUpdateChanges(
            originalSetlistPayload,
            payload,
            originalSetlistSongNames,
            previewRows,
          )
        : [],
    });
  };

  const insertSetlist = async (
    targetLive: LiveInsertRow,
    payload: ConsoleLiveSetlistAppendPayload,
    previewRows: SetlistConfirmRow[],
    csrfToken: string,
  ) => {
    const completeInsert = (message: string) => {
      const newBundle = {
        live: targetLive,
        setlist_rows: previewRows.map((row) => ({
          ...row,
          band_member: JSON.stringify(row.band_member),
          other_member: JSON.stringify(row.other_member),
        })),
      };
      setSubmittedBundles((prev) => [newBundle, ...prev]);
      setDisplayedBundle(newBundle);
      const remainingLives = lives.filter((live) => live.live_id !== targetLive.live_id);
      setLives(remainingLives);
      setSelectedLiveId(remainingLives[0]?.live_id ?? 0);
      setLivePagination((prev) => {
        const total = Math.max(0, prev.total - 1);
        return {
          ...prev,
          total,
          total_pages: Math.max(1, Math.ceil(total / prev.page_size)),
        };
      });
      onLiveDataChanged?.();
      clearSetlistPastePreview();
      clearSetlistData();
      setMessage(message);
    };

    try {
      const response = await appendConsoleLiveSetlist(
        targetLive.live_id,
        payload,
        csrfToken,
      );
      completeInsert(
        `已为Live #${targetLive.live_id} 插入 ${response.item.inserted_row_count} 条 setlist，总计 ${response.item.total_setlist_row_count} 条。`,
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = errorMessage(error);
      if (status === 409 || message === "Request timeout") {
        try {
          const persisted = await getConsoleLiveSetlist(targetLive.live_id);
          if (persistedSetlistMatchesPayload(persisted, payload)) {
            publishConsoleLiveChange("setlist_appended", targetLive.live_id);
            completeInsert(
              `已确认 Live #${targetLive.live_id} 的 ${persisted.rows.length} 条 Setlist 已写入（原提交响应未成功返回）。`,
            );
            return;
          }
        } catch {
          // 下方会按原始写请求错误提示；读取确认失败不能证明事务未提交。
        }
      }
      if (status === 409) {
        const remainingLives = lives.filter((live) => live.live_id !== targetLive.live_id);
        setLives(remainingLives);
        setSelectedLiveId((currentLiveId) =>
          currentLiveId === targetLive.live_id ? remainingLives[0]?.live_id ?? 0 : currentLiveId,
        );
        clearSetlistPastePreview();
        clearSetlistData();
        setMessage(`提交setlist失败：Live #${targetLive.live_id} 已有 setlist 数据，正在刷新候选并清空当前草稿。`);
        setSetlistCandidateRefreshKey((key) => key + 1);
        return;
      }
      if (message === "Request timeout") {
        setMessage("提交setlist结果暂时未知：请求超时，且未能确认本次数据是否已经写入。请先刷新页面确认，避免重复提交。");
        return;
      }
      setMessage(`提交setlist失败：${message}`);
    }
  };

  const queryVid = async () => {
    try {
      const response = await getConsoleVenues(venueQueryText, 20);
      const nextVenues = sortById(response.items.map(toVenueOption), (venue) => venue.venue_id);
      setVenues(nextVenues);
      setSelectedVenueId((prev) =>
        nextVenues.some((venue) => venue.venue_id === prev) ? prev : nextVenues[0]?.venue_id ?? 0,
      );
      setVenueOpen(nextVenues.length > 0);
      setMessage(`查询venue完成：返回 ${nextVenues.length} 个候选。`);
    } catch (error) {
      setVenues([]);
      setSelectedVenueId(0);
      setVenueOpen(false);
      setMessage(`查询venue失败：${errorMessage(error)}`);
    }
  };

  const requestVenueConfirmation = () => {
    const venueName = venueQueryText.trim();
    if (venueName === "") {
      setMessage("新增venue失败：venue 名称不能为空。");
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("新增venue失败：登录态已失效，请重新登录。");
      return;
    }

    setPendingConfirmation({
      kind: "venue",
      title: "确认新增 Venue",
      payload: { venue_name: venueName },
    });
  };

  const insertVenue = async (payload: { venue_name: string }, csrfToken: string) => {
    try {
      const response = await createConsoleVenue(payload.venue_name, csrfToken);
      const inserted = toVenueOption(response.item);
      setVenues((prev) => sortById([inserted, ...prev.filter((venue) => venue.venue_id !== inserted.venue_id)], (venue) => venue.venue_id));
      setSelectedVenueId(inserted.venue_id);
      setVenueOpen(false);
      setMessage(`已新增venue #${inserted.venue_id}（${inserted.venue_name}）`);
    } catch (error) {
      setMessage(`新增venue失败：${errorMessage(error)}`);
    }
  };

  const requestLiveConfirmation = () => {
    const action = mode === "live_edit" ? "update" : "create";
    if (liveDate.trim() === "" || liveTitle.trim() === "") {
      setMessage(`${action === "create" ? "新增" : "更新"}Live失败：live_date 与 live_title 为必填项。`);
      return;
    }
    if (venueAnnounced && selectedVenueId <= 0) {
      setMessage(`${action === "create" ? "新增" : "更新"}Live失败：请先选择 venue。`);
      return;
    }
    if (venueAnnounced && currentLivePayload.venue_name_version_id === null) {
      setMessage(`${action === "create" ? "新增" : "更新"}Live失败：所选 venue 缺少当前名称版本。`);
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage(`${action === "create" ? "新增" : "更新"}Live失败：登录态已失效，请重新登录。`);
      return;
    }
    if (action === "update" && editingLiveId === null) {
      setMessage("更新Live失败：请先选择要编辑的 Live。");
      return;
    }
    if (action === "update" && requiresScheduleChangeKind && scheduleChangeKind === null) {
      setMessage("更新Live失败：排期变化必须选择资料修正或主办方正式改期。");
      return;
    }

    const selectedVenue = venues.find((venue) => venue.venue_id === selectedVenueId);
    const normalizedPayload = normalizeLivePayload(currentLivePayload);
    const fields = Object.keys(normalizedPayload) as Array<keyof ConsoleLiveUpsertPayload>;
    const changes = action === "update" && editingLiveId !== null && originalLivePayload !== null
      ? fields.flatMap((field) => {
          const before = formatLivePayloadValue(field, originalLivePayload[field]);
          const after = formatLivePayloadValue(field, normalizedPayload[field]);
          return before === after ? [] : [{ field, before, after }];
        })
      : [];
    setPendingConfirmation({
      kind: "live",
      title: action === "create" ? "确认新增 Live" : `确认更新 Live #${editingLiveId}`,
      action,
      liveId: editingLiveId,
      payload: normalizedPayload,
      venueName: venueAnnounced ? (selectedVenue?.venue_name ?? "-") : "未公布",
      changes,
      scheduleChangeKind: requiresScheduleChangeKind ? scheduleChangeKind : null,
      scheduleChangeNote: requiresScheduleChangeKind ? (scheduleChangeNote.trim() || null) : null,
    });
  };

  const updateSetlist = async (
    targetLive: LiveInsertRow,
    payload: ConsoleLiveSetlistAppendPayload,
    previewRows: SetlistConfirmRow[],
    csrfToken: string,
  ) => {
    try {
      const response = await updateConsoleLiveSetlist(targetLive.live_id, payload, csrfToken);
      const updatedBundle = {
        live: targetLive,
        setlist_rows: previewRows.map((row) => ({
          ...row,
          band_member: JSON.stringify(row.band_member),
          other_member: JSON.stringify(row.other_member),
        })),
      };
      setSubmittedBundles((current) => [updatedBundle, ...current]);
      setDisplayedBundle(updatedBundle);
      onLiveDataChanged?.();
      setMessage(`已更新 Live #${targetLive.live_id} 的 ${response.item.total_setlist_row_count} 条 Setlist。`);
    } catch (error) {
      setMessage(`更新 Setlist 失败：${errorMessage(error)}`);
    }
  };

  const saveLive = async (
    action: "create" | "update",
    liveId: number | null,
    payload: ConsoleLiveUpsertPayload,
    scheduleKind: "correction" | "reschedule" | null,
    scheduleNote: string | null,
    csrfToken: string,
  ) => {
    try {
      const updatePayload: ConsoleLiveUpdatePayload = {
        ...payload,
        schedule_change_kind: scheduleKind,
        schedule_change_note: scheduleNote,
      };
      const response = action === "create"
        ? await createConsoleLive(payload, csrfToken)
        : await updateConsoleLive(liveId as number, updatePayload, csrfToken);
      const historyEntryId = liveHistoryEntryIdRef.current + 1;
      liveHistoryEntryIdRef.current = historyEntryId;
      const inserted: LiveInsertDraft = {
        history_entry_id: historyEntryId,
        action,
        live_id: response.item.live_id,
        live_date: response.item.live_date,
        live_title: response.item.live_title,
        live_type: response.item.live_type,
        url: response.item.url,
        opening_time: response.item.opening_time,
        start_time: response.item.start_time,
        timezone: payload.timezone,
        venue_id: response.item.venue_id,
        venue_name_version_id: response.item.venue_name_version_id,
        default_band_ids: response.item.default_band_ids ?? [],
        event_attendees: response.item.event_attendees ?? [],
        event_status: response.item.event_status ?? "scheduled",
        status_note: response.item.status_note ?? null,
      };
      const savedPayload = normalizeLivePayload({
        live_date: response.item.live_date,
        live_title: response.item.live_title,
        live_type: response.item.live_type,
        url: response.item.url,
        opening_time: getClockValue(response.item.opening_time),
        start_time: getClockValue(response.item.start_time),
        timezone: response.item.opening_time?.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? payload.timezone,
        venue_id: response.item.venue_id,
        venue_name_version_id: response.item.venue_name_version_id,
        default_band_ids: response.item.default_band_ids ?? [],
        event_attendees: (response.item.event_attendees ?? []).map((attendee) => ({
          band_id: attendee.band_id,
          members: attendee.members,
        })),
        band_lineup_contexts: response.item.band_lineup_contexts ?? [],
        event_status: response.item.event_status ?? "scheduled",
        status_note: response.item.status_note ?? null,
      });

      setInsertedLives((prev) => [inserted, ...prev]);
      setLives((prev) => {
        const wasSetlistCandidate = prev.some((live) => live.live_id === inserted.live_id);
        if (action === "update" && !wasSetlistCandidate) return prev;
        return sortLivesForConsole(
          [
            {
              live_id: inserted.live_id,
              live_date: inserted.live_date,
              live_title: inserted.live_title,
              live_type: inserted.live_type,
              bands: inserted.default_band_ids,
              url: inserted.url,
            },
            ...prev.filter((live) => live.live_id !== inserted.live_id),
          ],
        );
      });
      setLivePagination((prev) => {
        const total = prev.total + (action === "create" ? 1 : 0);
        return {
          ...prev,
          total,
          total_pages: Math.max(1, Math.ceil(total / prev.page_size)),
        };
      });
      if (action === "create" || lives.some((live) => live.live_id === inserted.live_id)) {
        setSelectedLiveId(inserted.live_id);
      }
      onLiveDataChanged?.();
      if (action === "create") {
        setEditingLiveId(null);
        setOriginalLivePayload(null);
        if (clearLiveAfterCreate) {
          resetLiveForm();
        } else {
          setVenueOpen(false);
          setVenueMenuPos(null);
          setDefaultBandOpen(false);
          setDefaultBandMenuPos(null);
        }
      } else {
        setEditingLiveId(inserted.live_id);
        setOriginalLivePayload(savedPayload);
        applyLivePayloadToForm(savedPayload);
      }
      if (action === "update") {
        await loadLiveCandidatePage(
          liveCandidateQuery,
          liveCandidatePage,
          liveCandidateType,
          liveCandidateEventStatus,
        );
      }
      if (mode === "live_edit") await loadScheduleAttention(scheduleAttentionFilter);
      setMessage(`已${action === "create" ? "新增" : "更新"}Live #${inserted.live_id}（${inserted.live_title}）`);
    } catch (error) {
      setMessage(`${action === "create" ? "新增" : "更新"}Live失败：${errorMessage(error)}`);
    }
  };

  const submitInsertLive = () => {
    requestLiveConfirmation();
  };

  const requestSongConfirmation = () => {
    const name = songName.trim();
    if (name === "") {
      setMessage("保存歌曲失败：song_name 不能为空。");
      return;
    }
    if (songBandId === null) {
      setMessage("保存歌曲失败：请先选择 band_id。");
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("保存歌曲失败：登录态已失效，请重新登录。");
      return;
    }

    const selectedBand = bands.find((band) => band.band_id === songBandId);
    const payload: ConsoleSongCreatePayload = {
      song_name: name,
      band_id: songBandId,
      cover: songCover,
    };
    setPendingConfirmation({
      kind: "song",
      title: editingSongId === null ? "确认新增歌曲" : "确认更新歌曲",
      action: editingSongId === null ? "create" : "update",
      songId: editingSongId,
      payload,
      bandName: selectedBand?.band_name ?? "-",
      changes: editingSongId === null
        ? []
        : buildSongUpdateChanges(originalSongPayload, payload, bands),
    });
  };

  const submitSong = async (
    action: "create" | "update",
    songId: number | null,
    payload: ConsoleSongCreatePayload,
    csrfToken: string,
  ) => {
    try {
      const response = action === "create"
        ? await createConsoleSong(payload, csrfToken)
        : await updateConsoleSong(songId as number, payload, csrfToken);
      const row = toSongInsertRow(response.item);
      setSongs((prev) => sortById([row, ...prev.filter((song) => song.song_id !== row.song_id)], (song) => song.song_id));
      setInsertedSongs((prev) => sortById([row, ...prev.filter((song) => song.song_id !== row.song_id)], (song) => song.song_id));
      setSongCandidates((current) => [row, ...current.filter((song) => song.song_id !== row.song_id)]);
      if (action === "create") resetSongForm();
      else selectSongForEditFromItem(row);
      setMessage(`已${action === "create" ? "新增" : "更新"}歌曲 #${row.song_id}`);
    } catch (error) {
      setMessage(`${action === "create" ? "新增" : "更新"}歌曲失败：${errorMessage(error)}`);
    }
  };

  const requestBatchSongInsert = () => {
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("批量插入失败：登录态已失效，请重新登录。");
      return;
    }

    const rows = setlistRows.filter((row) => row.song_name.trim() !== "");
    if (rows.length === 0) return;

    const errors: string[] = [];
    const confirmRows: BatchSongConfirmRow[] = [];
    let skipped = 0;

    rows.forEach((row) => {
      const sid = row.song_id.trim();
      if (sid !== "") {
        skipped += 1;
        return;
      }
      if ((row.song_candidates?.length ?? 0) > 1) {
        skipped += 1;
        return;
      }

      const bandNames = Object.keys(row.band_member).filter(
        (name) => row.band_member[name] && row.band_member[name].length > 0,
      );
      if (bandNames.length !== 1) {
        errors.push(
          `"${row.song_name}" 的乐队数量不为 1（当前 ${bandNames.length} 支：${bandNames.join("、") || "无"}）。`,
        );
        return;
      }

      const bandName = bandNames[0];
      const band = bands.find((b) => b.band_name === bandName);
      if (!band) {
        errors.push(`"${row.song_name}" 的乐队 "${bandName}" 未匹配到有效 band_id。`);
        return;
      }

      confirmRows.push({
        song_name: row.song_name.trim(),
        band_id: band.band_id,
        band_name: bandName,
        cover: false,
        band_member: row.band_member,
      });
    });

    if (confirmRows.length === 0 && errors.length === 0) {
      setMessage(skipped > 0 ? "所有行已有 sid，无需批量插入。" : "没有可插入的行。");
      return;
    }

    setPendingConfirmation({
      kind: "batch_song",
      title: "确认批量新增歌曲",
      rows: confirmRows,
      errors,
    });
  };

  const executeBatchSongInsert = async (rows: BatchSongConfirmRow[], csrfToken: string) => {
    try {
      const payload = rows.map((row) => ({
        song_name: row.song_name,
        band_id: row.band_id,
        cover: row.cover,
      }));
      const response = await createConsoleSongsBatch(payload, csrfToken);
      response.created.forEach((item) => {
        const newSong = toSongInsertRow(item);
        setSongs((prev) => sortById([newSong, ...prev.filter((s) => s.song_id !== newSong.song_id)], (s) => s.song_id));
        setInsertedSongs((prev) => sortById([newSong, ...prev.filter((s) => s.song_id !== newSong.song_id)], (s) => s.song_id));
      });
      const skipped = rows.length - response.created.length;
      const summary = `批量新增完成：请求 ${rows.length} 首，成功 ${response.created.length} 首${skipped > 0 ? `，后端跳过 ${skipped} 首` : ""}。`;
      await querySongsForSetlist();
      setMessage(`${summary} ${response.created.map((item) => `#${item.song_id} ${item.song_name}`).join("；") || "后端未返回新增歌曲。"}`);
    } catch (error) {
      const detail = backendFailureDetail(error);
      setMessage(`批量新增失败：${detail}`);
    }
  };

  const updateBatchSongCover = (rowIndex: number, checked: boolean) => {
    setPendingConfirmation((current) => {
      if (!current || current.kind !== "batch_song") {
        return current;
      }
      return {
        ...current,
        rows: current.rows.map((row, index) => (index === rowIndex ? { ...row, cover: checked } : row)),
      };
    });
  };

  const closePendingConfirmation = () => {
    if (confirmationSubmitting) return;
    setPendingConfirmation(null);
  };

  const confirmPendingInsert = async () => {
    if (!pendingConfirmation) return;
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setPendingConfirmation(null);
      setMessage("提交失败：登录态已失效，请重新登录。");
      return;
    }

    setConfirmationSubmitting(true);
    try {
      if (pendingConfirmation.kind === "venue") {
        await insertVenue(pendingConfirmation.payload, auth.csrfToken);
      } else if (pendingConfirmation.kind === "live") {
        await saveLive(
          pendingConfirmation.action,
          pendingConfirmation.liveId,
          pendingConfirmation.payload,
          pendingConfirmation.scheduleChangeKind,
          pendingConfirmation.scheduleChangeNote,
          auth.csrfToken,
        );
      } else if (pendingConfirmation.kind === "live_discard") {
        if (pendingConfirmation.target.type === "edit") await loadLiveForEdit(pendingConfirmation.target.liveId);
        else {
          setEditingLiveId(null);
          setOriginalLivePayload(null);
          resetLiveForm();
          if (pendingConfirmation.target.mode === "setlist") {
            setLivePage(1);
            setSelectedLiveId(0);
          }
          setMode(pendingConfirmation.target.mode);
        }
      } else if (pendingConfirmation.kind === "song") {
        await submitSong(
          pendingConfirmation.action,
          pendingConfirmation.songId,
          pendingConfirmation.payload,
          auth.csrfToken,
        );
      } else if (pendingConfirmation.kind === "batch_song") {
        await executeBatchSongInsert(pendingConfirmation.rows, auth.csrfToken);
      } else {
        await (pendingConfirmation.action === "update" ? updateSetlist : insertSetlist)(
          pendingConfirmation.live,
          pendingConfirmation.payload,
          pendingConfirmation.previewRows,
          auth.csrfToken,
        );
      }
      setPendingConfirmation(null);
    } finally {
      setConfirmationSubmitting(false);
    }
  };

  const renderPendingConfirmationBody = () => {
    if (!pendingConfirmation) return null;

    if (pendingConfirmation.kind === "venue") {
      return (
        <CompactConfirmationTable
          rows={[["venue_name", pendingConfirmation.payload.venue_name]]}
        />
      );
    }

    if (pendingConfirmation.kind === "live_discard") {
      return <p className="console-admin-hint">当前 Live 有未保存修改。确认放弃这些修改吗？</p>;
    }

    if (pendingConfirmation.kind === "live") {
      const payload = pendingConfirmation.payload;
      const shouldWarnMissingEventBands = payload.live_type === "event" && payload.default_band_ids.length === 0;
      return (
        <>
          {pendingConfirmation.action === "update" ? (
            <UpdateDiffTable changes={pendingConfirmation.changes} ariaLabel="Live 修改内容" />
          ) : (
            <CompactConfirmationTable
              rows={[
              ["live_date", payload.live_date],
              ["live_title", payload.live_title],
              ["live_type", formatLiveType(payload.live_type)],
              ["url", payload.url],
              ["opening_time", payload.opening_time ?? "未公布"],
              ["start_time", payload.start_time ?? "未公布"],
              ["timezone", payload.timezone],
              ["venue_id", payload.venue_id ?? "未公布"],
              ["venue_name", pendingConfirmation.venueName],
              ["default_band_ids", payload.default_band_ids.join(", ") || "-"],
              [
                "event_attendees",
                payload.event_attendees
                  .map((attendee) => `${attendee.band_id}: ${attendee.members.join(" / ")}`)
                  .join("; ") || "-",
              ],
              ["event_status", EVENT_STATUS_LABELS[payload.event_status ?? "scheduled"]],
              ["status_note", payload.status_note],
              ]}
            />
          )}
          {shouldWarnMissingEventBands && (
            <p className="console-admin-hint" role="status">
              提示：当前 Live 类型为活动，且未选择默认 Band，请确认是否需要补充。
            </p>
          )}
          {pendingConfirmation.scheduleChangeKind && (
            <p className="console-admin-hint" role="status">
              本次排期变化：
              {pendingConfirmation.scheduleChangeKind === "correction" ? "资料修正" : "主办方正式改期"}
              {pendingConfirmation.scheduleChangeNote ? `（${pendingConfirmation.scheduleChangeNote}）` : ""}
            </p>
          )}
          {(payload.event_status === "cancelled" || payload.event_status === "postponed")
            && (editingLiveHasSetlist || hasExistingSetlist) && (
            <p className="console-admin-hint console-admin-warning" role="alert">
              警告：当前 Live 已有 Setlist。保存
              {payload.event_status === "cancelled" ? "取消" : "延期"}
              状态不会删除已有歌曲资料。
            </p>
          )}
        </>
      );
    }

    if (pendingConfirmation.kind === "song") {
      const payload = pendingConfirmation.payload;
      return pendingConfirmation.action === "update"
        ? <UpdateDiffTable changes={pendingConfirmation.changes} ariaLabel="歌曲修改内容" />
        : (
          <CompactConfirmationTable
            rows={[
              ["song_name", payload.song_name],
              ["band_id", payload.band_id],
              ["band_name", pendingConfirmation.bandName],
              ["cover", String(payload.cover)],
            ]}
          />
        );
    }

    if (pendingConfirmation.kind === "batch_song") {
      return (
        <>
          {pendingConfirmation.errors.length > 0 && (
            <ul className="setlist-paste-warnings" style={{ marginBottom: 12 }}>
              {pendingConfirmation.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          )}
          <div className="console-table-wrap console-confirm-setlist-wrap">
            <table className="console-admin-table console-confirm-setlist-table console-confirm-batch-song-table">
              <thead>
                <tr>
                  <th>song_name</th>
                  <th>bid</th>
                  <th>band_name</th>
                  <th>cover</th>
                </tr>
              </thead>
              <tbody>
                {pendingConfirmation.rows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.song_name}</td>
                    <td>{row.band_id}</td>
                    <td>{row.band_name}</td>
                    <td>
                      <input
                        className="is-short-check"
                        aria-label={`batch_song_cover-${index + 1}`}
                        type="checkbox"
                        checked={row.cover}
                        disabled={confirmationSubmitting}
                        onChange={(event) => updateBatchSongCover(index, event.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    if (pendingConfirmation.action === "update") {
      return <UpdateDiffTable changes={pendingConfirmation.changes} ariaLabel="Setlist 修改内容" />;
    }

    return (
      <>
        <CompactConfirmationTable
          rows={[
            ["live_id", pendingConfirmation.live.live_id],
            ["live_title", pendingConfirmation.live.live_title],
            ["live_date", pendingConfirmation.live.live_date],
            ["setlist_rows", pendingConfirmation.previewRows.length],
          ]}
        />
        <div className="console-table-wrap console-confirm-setlist-wrap">
          <table className="console-admin-table console-confirm-setlist-table">
            <thead>
              <tr>
                <th>abs</th>
                <th>song_id</th>
                <th>song_name</th>
                <th>seg</th>
                <th>sub</th>
                <th>short</th>
                <th>band_member</th>
                <th>other_member</th>
              </tr>
            </thead>
            <tbody>
              {pendingConfirmation.previewRows.map((row) => (
                <tr key={row.absolute_order}>
                  <td>{row.absolute_order}</td>
                  <td>{row.song_id}</td>
                  <td>{row.song_name}</td>
                  <td>{row.segment_type}</td>
                  <td>{row.sub_order}</td>
                  <td>{row.is_short ? "true" : "false"}</td>
                  <td><code>{JSON.stringify(row.band_member)}</code></td>
                  <td><code>{JSON.stringify(row.other_member ?? {})}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const editingBandRow = editingBandRowKey === null
    ? null
    : setlistRows.find((row) => row.row_key === editingBandRowKey) ?? null;
  const editingOtherRow = editingOtherRowKey === null
    ? null
    : setlistRows.find((row) => row.row_key === editingOtherRowKey) ?? null;
  const selectedLive = lives.find((live) => live.live_id === selectedLiveId) ?? null;
  const setlistDetailTitle = setlistDetailData?.live_title ?? selectedLive?.live_title ?? `Live #${selectedLiveId}`;
  const setlistDetailDate = setlistDetailData?.live_date ?? selectedLive?.live_date ?? "-";
  const setlistOpeningTimeText = formatTimedLabel(setlistDetailData?.opening_time);
  const setlistStartTimeText = formatTimedLabel(setlistDetailData?.start_time);
  const setlistVenueText = setlistDetailData?.venue ?? "-";
  const setlistBandNamesText =
    setlistDetailData?.band_names && setlistDetailData.band_names.length > 0
      ? setlistDetailData.band_names.join(" / ")
      : "-";

  const renderSongAdminSection = () => (
    <SongAdminSection
      bandOptions={bands}
      insertedSongs={insertedSongs}
      songCandidates={songCandidates}
      songQuery={songQuery}
      songBandFilterId={songBandFilterId}
      songPage={songPagination.page}
      songTotal={songPagination.total}
      songTotalPages={songPagination.total_pages}
      songLoading={songLoading}
      editingSongId={editingSongId}
      songName={songName}
      songBandId={songBandId}
      songCover={songCover}
      songBandOpen={songBandOpen}
      songBandMenuPos={songBandMenuPos}
      songBandTriggerRef={songBandTriggerRef}
      songBandMenuRef={songBandMenuRef}
      onSongNameChange={setSongName}
      onSongQueryChange={setSongQuery}
      onSongBandFilterChange={setSongBandFilterId}
      onQuerySongs={querySongCandidates}
      onSongPageChange={setSongPage}
      onSelectSong={selectSongForEdit}
      onCreateNewSong={resetSongForm}
      onSongCoverChange={setSongCover}
      onOpenSongBandMenu={openSongBandMenu}
      onSelectSongBand={(bandId) => {
        setSongBandId(bandId);
        setSongBandOpen(false);
      }}
      onClearSong={clearSongForm}
      onSubmitSong={requestSongConfirmation}
      submitDisabled={isSongSubmitDisabled}
    />
  );

  return (
    <>
      {transientNotice && (
        <div className="console-toast" role="alert" aria-live="assertive">
          {transientNotice}
        </div>
      )}
      <section className="console-admin">
      <PageTitle kicker="Console" title="控制台" description="录入和维护 Live、Setlist、歌曲、乐队、场地与巡演资料。" />
      {message && <p className="console-admin-hint" role="status" aria-live="polite">{message}</p>}

      <SectionTabs
        label="控制台录入类型"
        value={mode}
        options={[
          { value: "live_create", label: "新增Live" },
          { value: "live_edit", label: "Live管理" },
          { value: "setlist", label: "新增Setlist" },
          { value: "setlist_edit", label: "Setlist管理" },
          { value: "song", label: "歌曲管理" },
          { value: "band", label: "乐队管理" },
          { value: "venue", label: "场地管理" },
          { value: "tour", label: "巡演管理" },
          { value: "performance_group", label: "活动组管理" },
        ]}
        onChange={changeConsoleMode}
      />

      {(mode === "live_create" || mode === "live_edit") && (
        <LiveAdminSection
          variant={mode === "live_create" ? "create" : "edit"}
          liveDate={liveDate}
          liveTitle={liveTitle}
          liveType={liveType}
          eventStatus={eventStatus}
          statusNote={statusNote}
          datePhase={currentDatePhase}
          hasScheduleChanges={requiresScheduleChangeKind}
          scheduleChangeKind={scheduleChangeKind}
          scheduleChangeNote={scheduleChangeNote}
          liveUrl={liveUrl}
          openingTime={openingTime}
          startTime={startTime}
          venueAnnounced={venueAnnounced}
          openingTimeAnnounced={openingTimeAnnounced}
          startTimeAnnounced={startTimeAnnounced}
          timezoneHour={timezoneHour}
          timezoneMinute={timezoneMinute}
          timezoneMinuteDisabled={timezoneMinuteDisabled}
          selectedVenueId={selectedVenueId}
          defaultBandIds={defaultBandIds}
          defaultBandLineupContexts={defaultBandLineupContexts}
          bandHistories={bandHistories}
          eventAttendees={eventAttendees}
          bandOptions={bands}
          venueQueryText={venueQueryText}
          liveCandidateQuery={liveCandidateQuery}
          liveCandidateType={liveCandidateType}
          liveCandidateEventStatus={liveCandidateEventStatus}
          liveCandidates={liveCandidates}
          liveCandidatePage={liveCandidatePagination.page}
          liveCandidateTotal={liveCandidatePagination.total}
          liveCandidateTotalPages={liveCandidatePagination.total_pages}
          liveCandidateLoading={liveCandidateLoading}
          editingLiveId={editingLiveId}
          isLiveDirty={isLiveDirty}
          clearAfterCreate={clearLiveAfterCreate}
          venues={venues}
          timezoneHourOptions={TIMEZONE_HOUR_OPTIONS}
          liveTypeOptions={LIVE_TYPE_OPTIONS}
          venueOpen={venueOpen}
          venueMenuPos={venueMenuPos}
          defaultBandOpen={defaultBandOpen}
          defaultBandMenuPos={defaultBandMenuPos}
          venueTriggerRef={venueTriggerRef}
          venueMenuRef={venueMenuRef}
          defaultBandTriggerRef={defaultBandTriggerRef}
          defaultBandMenuRef={defaultBandMenuRef}
          venueQueryInputRef={venueQueryInputRef}
          insertedLives={insertedLives}
          scheduleAttentionItems={scheduleAttentionItems}
          scheduleAttentionCounts={scheduleAttentionCounts}
          scheduleAttentionFilter={scheduleAttentionFilter}
          scheduleAttentionLoading={scheduleAttentionLoading}
          onLiveDateChange={setLiveDate}
          onLiveTitleChange={setLiveTitle}
          onLiveTypeChange={(value) => {
            setLiveType(value);
            if (value !== "event") setEventAttendees({});
          }}
          onEventStatusChange={(value) => {
            setEventStatus(value as EventStatus);
            if (value === "scheduled") setStatusNote("");
          }}
          onStatusNoteChange={setStatusNote}
          onScheduleChangeKindChange={setScheduleChangeKind}
          onScheduleChangeNoteChange={setScheduleChangeNote}
          onLiveUrlChange={setLiveUrl}
          onOpeningTimeChange={setOpeningTime}
          onStartTimeChange={setStartTime}
          onVenueAnnouncedChange={setVenueAnnounced}
          onOpeningTimeAnnouncedChange={setOpeningTimeAnnounced}
          onStartTimeAnnouncedChange={setStartTimeAnnounced}
          onTimezoneHourChange={changeTimezoneHour}
          onCycleTimezoneMinute={cycleTimezoneMinute}
          onVenueQueryTextChange={setVenueQueryText}
          onLiveCandidateQueryChange={setLiveCandidateQuery}
          onLiveCandidateTypeChange={changeLiveCandidateType}
          onLiveCandidateEventStatusChange={(value) => {
            setLiveCandidateEventStatus(value);
            setLiveCandidatePage(1);
          }}
          onQueryLiveCandidates={queryLiveCandidates}
          onLiveCandidatePageChange={setLiveCandidatePage}
          onSelectLiveForEdit={requestLiveForEdit}
          onScheduleAttentionFilterChange={(value) => { void loadScheduleAttention(value); }}
          onClearAfterCreateChange={setClearLiveAfterCreate}
          onOpenVenueMenu={openVenueMenu}
          onOpenDefaultBandMenu={openDefaultBandMenu}
          onSelectVenue={(venueId) => {
            setSelectedVenueId(venueId);
            setVenueOpen(false);
          }}
          onToggleDefaultBand={toggleDefaultBand}
          onToggleEventAttendee={toggleEventAttendee}
          onQueryVid={queryVid}
          onInsertVenue={requestVenueConfirmation}
          onClearInsertLive={clearLiveForm}
          onSubmitInsertLive={submitInsertLive}
          queryInsertDisabled={isVenueQuickInsertDisabled}
          submitInsertDisabled={isLiveSubmitBlocked}
        />
      )}

      {(mode === "setlist" || mode === "setlist_edit") && (
        <LiveInsertTab
          variant={mode === "setlist_edit" ? "edit" : "create"}
          lives={mode === "setlist_edit" ? setlistEditLives : lives}
          liveQuery={setlistEditQuery}
          selectedLiveId={selectedLiveId}
          livePage={livePagination.page}
          liveTotal={livePagination.total}
          liveTotalPages={livePagination.total_pages}
          isLiveLoading={isLiveLoading}
          didSongLookup={didSongLookup}
          setlistRows={setlistRows}
          derivedSegments={derivedSegments}
          effectiveAbs={effectiveAbs}
          effectiveSub={effectiveSub}
          submittedBundles={submittedBundles}
          displayedBundle={displayedBundle}
          bandOptions={bands}
          bandHistories={bandHistories}
          lineupContexts={lineupContexts}
          editingBandRow={editingBandRow}
          editingOtherRow={editingOtherRow}
          bandMemberMenuPos={bandMemberMenuPos}
          otherMemberMenuPos={otherMemberMenuPos}
          songModalRowKey={songModalRowKey}
          bandMemberTriggerRefs={bandMemberTriggerRefs}
          bandMemberMenuRef={bandMemberMenuRef}
          otherMemberTriggerRefs={otherMemberTriggerRefs}
          otherMemberMenuRef={otherMemberMenuRef}
          setlistPasteText={setlistPasteText}
          setlistParseWarnings={setlistParseWarnings}
          setlistParsePreviewRows={setlistParsePreviewRows}
          setlistParsePreviewOpen={setlistParsePreviewOpen}
          onSelectedLiveIdChange={(liveId) => {
            if (mode === "setlist_edit") void loadSetlistForEdit(liveId);
            else setSelectedLiveId(liveId);
          }}
          onLiveQueryChange={setSetlistEditQuery}
          onQueryLives={querySetlistEditLives}
          onLivePageChange={changeSetlistLivePage}
          onSetlistPasteTextChange={updateSetlistPasteText}
          onPreviewSetlistPaste={buildSetlistPastePreview}
          onApplySetlistPaste={applySetlistPastePreview}
          onClearSetlistPaste={clearSetlistPastePreview}
          onOpenFullSetlistPreview={() => setSetlistParsePreviewOpen(true)}
          onCloseFullSetlistPreview={() => setSetlistParsePreviewOpen(false)}
          onUpdateSetlistSongName={updateSetlistSongName}
          onUpdateSetlistSongId={updateSetlistSongId}
          onSetSongModalRowKey={setSongModalRowKey}
          onUpdateSetlistSegment={(rowKey, value) => updateSetlistRow(rowKey, "segment_start_type", value)}
          onUpdateSetlistAbs={updateSetlistAbs}
          onUpdateSetlistSub={updateSetlistSub}
          onToggleSetlistShort={(rowKey, checked) => updateSetlistRow(rowKey, "is_short", checked)}
          onUpdateSetlistComment={(rowKey, value) => updateSetlistRow(rowKey, "comment", value)}
          onOpenBandMemberMenu={openBandMemberMenu}
          onOpenOtherMemberMenu={openOtherMemberMenu}
          onShowCurrentSetlist={showCurrentSetlistDetail}
          onAddSetlistRow={addSetlistRow}
          onRemoveLastSetlistRow={removeLastSetlistRow}
          onClearSetlistData={clearSetlistData}
          onBatchInsertSongs={requestBatchSongInsert}
          batchInsertDisabled={isBatchSongInsertDisabled}
          onQuerySongsForSetlist={querySongsForSetlist}
          onSubmitLiveWithSetlist={requestSetlistConfirmation}
          submitDisabled={isSetlistSubmitDisabled}
          hasExistingSetlist={hasExistingSetlist}
          onToggleBandForSetlistRow={toggleBandForSetlistRow}
          onToggleBandMemberForSetlistRow={toggleBandMemberForSetlistRow}
          onUpdateSetlistBandMode={updateSetlistBandMode}
          onUpdateSetlistHandoverBaseline={updateSetlistHandoverBaseline}
          onUpdateOtherMemberEntry={updateOtherMemberEntry}
          onRemoveOtherMemberEntry={removeOtherMemberEntry}
          onAddOtherMemberEntry={addOtherMemberEntry}
          otherMemberValueSeparator={otherMemberValueSeparator}
          onOtherMemberValueSeparatorChange={setOtherMemberValueSeparator}
          renderSongAdminSection={renderSongAdminSection}
        />
      )}

      {mode === "song" && (
        renderSongAdminSection()
      )}

      {mode === "band" && (
        <BandAdminSection
          bands={bands}
          onMessage={setMessage}
          onBandsChanged={async () => {
            const response = await getConsoleBands(undefined, 100);
            setBands(sortById(response.items.map(toBandOption), (band) => band.band_id));
          }}
        />
      )}

      {mode === "venue" && (
        <VenueAdminSection
          onMessage={setMessage}
          onVenuesChanged={async () => {
            const response = await getConsoleVenues(undefined, 100);
            setVenues(sortById(response.items.map(toVenueOption), (venue) => venue.venue_id));
          }}
        />
      )}

      {mode === "tour" && (
        <TourAdminSection bands={bands} onMessage={setMessage} onTourDataChanged={onLiveDataChanged} />
      )}

      {mode === "performance_group" && (
        <PerformanceGroupAdminSection
          csrfToken={auth.csrfToken ?? ""}
          onMessage={setMessage}
          onGroupDataChanged={onLiveDataChanged}
        />
      )}

      {pendingConfirmation && (
        <div className="modal-mask" onClick={closePendingConfirmation}>
          <div
            className={`modal console-confirm-modal ${pendingConfirmation.kind === "setlist" ? "wide" : "compact"} ${pendingConfirmation.kind}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="console-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="console-confirm-title">{pendingConfirmation.title}</h2>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-action-btn close"
                  aria-label="关闭"
                  onClick={closePendingConfirmation}
                  disabled={confirmationSubmitting}
                >
                  <span className="modal-action-glyph close">✕</span>
                </button>
              </div>
            </div>
            <div className="console-confirm-body">
              {renderPendingConfirmationBody()}
            </div>
            <div className="console-confirm-actions">
              <button
                type="button"
                className="console-ghost-btn"
                onClick={closePendingConfirmation}
                disabled={confirmationSubmitting}
              >
                取消
              </button>
              <button
                type="button"
                className="console-submit-btn"
                onClick={() => void confirmPendingInsert()}
                disabled={confirmationSubmitting || (pendingConfirmation.kind === "batch_song" && pendingConfirmation.errors.length > 0)}
              >
                {confirmationSubmitting
                  ? "提交中..."
                  : pendingConfirmation.kind === "live_discard"
                    ? "确认放弃"
                    : pendingConfirmation.kind === "live" && pendingConfirmation.action === "update"
                      ? "确认更新"
                      : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}

      {setlistDetailOpen && (
        <div className="modal-mask" onClick={() => setSetlistDetailOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Setlist 详细信息</h2>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-action-btn close"
                  aria-label="关闭"
                  onClick={() => setSetlistDetailOpen(false)}
                >
                  <span className="modal-action-glyph close">✕</span>
                </button>
              </div>
            </div>
            <p className="detail-row">
              <strong>{setlistDetailTitle}</strong>
              <span>#{setlistDetailData?.live_id ?? selectedLiveId}</span>
            </p>
            <div className="detail-meta-line">
              <p className="detail-inline-item detail-inline-item-date">
                <strong>日期：</strong>
                <span>{setlistDetailDate}</span>
              </p>
              <p className="detail-inline-item">
                <strong>开场：</strong>
                <span>{setlistOpeningTimeText}</span>
              </p>
              <p className="detail-inline-item">
                <strong>开演：</strong>
                <span>{setlistStartTimeText}</span>
              </p>
              <p className="detail-inline-item detail-inline-item-venue">
                <strong>场地：</strong>
                <span>{setlistVenueText}</span>
              </p>
              <p className="detail-inline-item detail-inline-item-type">
                <strong>类型：</strong>
                <span>{formatLiveType(setlistDetailData?.live_type ?? selectedLive?.live_type ?? "")}</span>
              </p>
            </div>
            <p className="detail-row">
              <strong>乐队：</strong>
              <span>{setlistBandNamesText}</span>
            </p>
            <div className="detail-table-wrap">
              <MemberStatusTable
                rows={setlistDetailData?.detail_rows ?? []}
                loading={setlistDetailLoading}
                error={setlistDetailError}
              />
            </div>
          </div>
        </div>
      )}
      </section>
    </>
  );
}
