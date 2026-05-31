import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import {
  appendConsoleLiveSetlist,
  createConsoleLive,
  createConsoleSong,
  createConsoleSongsBatch,
  createConsoleVenue,
  getConsoleBands,
  getConsoleSongs,
  getConsoleVenues,
  getLiveDetail,
  getLives,
  type ConsoleBandItem,
  type ConsoleLiveCreatePayload,
  type ConsoleLiveSetlistAppendPayload,
  type ConsoleLiveSetlistRowPayload,
  type ConsoleSongItem,
  type ConsoleSongCreatePayload,
  type ConsoleVenueItem,
  type LiveDetailResponse,
  type LiveItem,
} from "../api";
import { MemberStatusTable } from "./DetailMemberTable";
import { LiveAdminSection } from "./console/LiveAdminSection";
import { LiveInsertTab } from "./console/LiveInsertTab";
import { SongAdminSection } from "./console/SongAdminSection";
import {
  INITIAL_SETLIST_ROWS,
  LIVE_TYPE_OPTIONS,
  TIMEZONE_OPTIONS,
} from "./console/constants";
import {
  buildOtherMemberPayloadObject,
  getBandMembersTemplate,
  getDerivedSegments,
} from "./console/helpers";
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
  live_id: number;
  live_date: string;
  live_title: string;
  type: string;
  url: string | null;
  opening_time: string;
  start_time: string;
  timezone: string;
  venue_id: number;
};

type ConsoleInsertPanelProps = {
  onLiveDataChanged?: () => void;
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
  other_member: OtherMemberDraft[];
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
      payload: ConsoleLiveCreatePayload;
      venueName: string;
    }
  | {
      kind: "song";
      title: string;
      payload: ConsoleSongCreatePayload;
      bandName: string;
    }
  | {
      kind: "setlist";
      title: string;
      live: LiveInsertRow;
      payload: ConsoleLiveSetlistAppendPayload;
      previewRows: SetlistConfirmRow[];
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
    venue_name: item.venue_name,
  };
}

function toLiveInsertRow(item: LiveItem): LiveInsertRow {
  return {
    live_id: item.live_id,
    live_date: item.live_date,
    live_title: item.live_title,
    bands: item.bands.flatMap((band) => (typeof band === "number" ? [band] : [])),
    url: item.url,
  };
}

function sortById<T>(items: T[], getId: (item: T) => number): T[] {
  return [...items].sort((left, right) => getId(left) - getId(right));
}

function sortLivesForConsole(items: LiveInsertRow[]): LiveInsertRow[] {
  return [...items].sort((left, right) => {
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

function formatTimedLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "-";

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

function getTodayDateInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ConsoleInsertPanel({ onLiveDataChanged }: ConsoleInsertPanelProps = {}) {
  const auth = useAuth();
  const [mode, setMode] = useState<ConsoleMode>("setlist");
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

  const [songName, setSongName] = useState("");
  const [songBandId, setSongBandId] = useState<number | null>(null);
  const [songBandOpen, setSongBandOpen] = useState(false);
  const [songBandMenuPos, setSongBandMenuPos] = useState<Position | null>(null);
  const [songCover, setSongCover] = useState(false);
  const [insertedSongs, setInsertedSongs] = useState<SongInsertRow[]>([]);

  const [liveDate, setLiveDate] = useState(() => getTodayDateInputValue());
  const [liveTitle, setLiveTitle] = useState("");
  const [liveType, setLiveType] = useState(LIVE_TYPE_OPTIONS[0] ?? "其他");
  const [liveUrl, setLiveUrl] = useState("");
  const [openingTime, setOpeningTime] = useState(DEFAULT_LIVE_OPENING_TIME);
  const [startTime, setStartTime] = useState(DEFAULT_LIVE_START_TIME);
  const [timezone, setTimezone] = useState(DEFAULT_LIVE_TIMEZONE);
  const [selectedVenueId, setSelectedVenueId] = useState<number>(0);
  const [venueQueryText, setVenueQueryText] = useState("");
  const [venueOpen, setVenueOpen] = useState(false);
  const [venueMenuPos, setVenueMenuPos] = useState<Position | null>(null);
  const [insertedLives, setInsertedLives] = useState<LiveInsertDraft[]>([]);
  const [setlistDetailOpen, setSetlistDetailOpen] = useState(false);
  const [setlistDetailData, setSetlistDetailData] = useState<LiveDetailResponse | null>(null);
  const [setlistDetailLoading, setSetlistDetailLoading] = useState(false);
  const [setlistDetailError, setSetlistDetailError] = useState<string | null>(null);

  const [setlistRows, setSetlistRows] = useState<SetlistDraftRow[]>(INITIAL_SETLIST_ROWS);
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
  const [editingBandRowKey, setEditingBandRowKey] = useState<number | null>(null);
  const [bandMemberMenuPos, setBandMemberMenuPos] = useState<Position | null>(null);
  const [editingOtherRowKey, setEditingOtherRowKey] = useState<number | null>(null);
  const [otherMemberMenuPos, setOtherMemberMenuPos] = useState<Position | null>(null);
  const [songModalRowKey, setSongModalRowKey] = useState<number | null>(null);

  const songBandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const songBandMenuRef = useRef<HTMLDivElement | null>(null);
  const venueTriggerRef = useRef<HTMLButtonElement | null>(null);
  const venueMenuRef = useRef<HTMLDivElement | null>(null);
  const bandMemberTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const bandMemberMenuRef = useRef<HTMLDivElement | null>(null);
  const otherMemberTriggerRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const otherMemberMenuRef = useRef<HTMLDivElement | null>(null);

  const nextSongId = useMemo(
    () => songs.reduce((maxId, row) => Math.max(maxId, row.song_id), 200) + 1,
    [songs],
  );
  const derivedSegments = useMemo(() => getDerivedSegments(setlistRows), [setlistRows]);
  const hasBatchSongInsertCandidate = setlistRows.some(
    (row) => row.song_name.trim() !== "" && row.song_id.trim() === "",
  );
  // 校验规则 1：查询 venue 行若当前查询输入为空，禁用该行“插入”。
  const isVenueQuickInsertDisabled = venueQueryText.trim() === "";
  // 校验规则 2：新增 Live 的“提交插入”要求 venue 已选，且表格字段（含 url）全部非空。
  const isLiveSubmitDisabled =
    selectedVenueId <= 0 ||
    liveDate.trim() === "" ||
    liveTitle.trim() === "" ||
    liveType.trim() === "" ||
    liveUrl.trim() === "" ||
    openingTime.trim() === "" ||
    startTime.trim() === "" ||
    timezone.trim() === "";
  // 校验规则 3：新增 Setlist 的“提交插入”要求每一行 song_name/sid/band_member 均非空。
  const isSetlistSubmitDisabled =
    setlistRows.length === 0 ||
    setlistRows.some((row) => {
      const hasBandMember = Object.values(row.band_member).some((members) => members.length > 0);
      return row.song_name.trim() === "" || row.song_id.trim() === "" || !hasBandMember;
    });
  // 校验规则 4：新增歌曲的“提交插入”要求 song_name 与 band_id 均非空。
  const isSongSubmitDisabled = songName.trim() === "" || songBandId === null;
  // 校验规则 5：批量插入歌曲必须先查询过，且至少存在一行有歌名但 sid 为空。
  const isBatchSongInsertDisabled = !didSongLookup || !hasBatchSongInsertCandidate;

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
        setSongs((prev) => mergeSongs(prev, songResult.value.items.map(toSongInsertRow)));
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
    let canceled = false;
    setIsLiveLoading(true);

    const loadLivePage = async () => {
      try {
        const response = await getLives(livePage, 20);
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
  }, [livePage]);

  useEffect(() => {
    if (!songBandOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (songBandTriggerRef.current?.contains(target)) return;
      if (songBandMenuRef.current?.contains(target)) return;
      setSongBandOpen(false);
    };
    const close = () => setSongBandOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
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
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [venueOpen]);

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
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
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
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
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
    setLiveType(LIVE_TYPE_OPTIONS[0] ?? "其他");
    setLiveUrl("");
    setOpeningTime(DEFAULT_LIVE_OPENING_TIME);
    setStartTime(DEFAULT_LIVE_START_TIME);
    setTimezone(DEFAULT_LIVE_TIMEZONE);
  };

  const clearLiveForm = () => {
    resetLiveForm();
    setMessage("已清空新增Live表格。");
  };

  const resetSongForm = () => {
    setSongName("");
    setSongBandId(null);
    setSongCover(false);
    setSongBandOpen(false);
    setSongBandMenuPos(null);
  };

  const clearSongForm = () => {
    resetSongForm();
    setMessage("已清空新增歌曲表格。");
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
      prev.map((row) => (row.row_key === rowKey ? { ...row, song_name: value, song_id: "" } : row)),
    );
  };

  const querySongsForSetlist = async () => {
    const queryNames = [...new Set(setlistRows.map((row) => row.song_name.trim()).filter((name) => name !== ""))];
    const songMap = new Map<string, number>();

    try {
      const responses = await Promise.all(queryNames.map((name) => getConsoleSongs(name, 10)));
      const remoteSongs = responses.flatMap((response) => response.items.map(toSongInsertRow));
      setSongs((prev) => mergeSongs(prev, remoteSongs));
      remoteSongs.forEach((song) => {
        const normalized = song.song_name.trim().toLowerCase();
        if (normalized !== "" && !songMap.has(normalized)) {
          songMap.set(normalized, song.song_id);
        }
      });
    } catch (error) {
      setMessage(`查询歌曲失败：${errorMessage(error)}`);
      return;
    }

    let matched = 0;
    let missing = 0;
    const nextRows = setlistRows.map((row) => {
      const normalizedName = row.song_name.trim().toLowerCase();
      if (normalizedName === "") {
        return { ...row, song_id: "" };
      }
      const songId = songMap.get(normalizedName);
      if (songId) {
        matched += 1;
        return { ...row, song_id: String(songId) };
      }
      missing += 1;
      return { ...row, song_id: "" };
    });

    setSetlistRows(nextRows);
    setDidSongLookup(true);
    setMessage(`查询歌曲完成：匹配 ${matched} 行，未匹配 ${missing} 行。`);
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
      const result = parseSetlistText(rawText, bands, setlistRowKey, otherMemberEntryKey);
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

  const openSongBandMenu = () => {
    const rect = songBandTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.max(rect.width, 280);
    setSongBandMenuPos({
      top: rect.bottom + 6,
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
      top: rect.bottom + 6,
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setVenueOpen(true);
  };

  const openBandMemberMenu = (rowKey: number) => {
    const trigger = bandMemberTriggerRefs.current[rowKey];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 440;
    setBandMemberMenuPos({
      top: rect.bottom + 6,
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
      top: rect.bottom + 6,
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
    setEditingOtherRowKey(rowKey);
    setEditingBandRowKey(null);
    setBandMemberMenuPos(null);
  };

  const toggleBandForSetlistRow = (rowKey: number, bandName: string) => {
    setSetlistRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        const next = { ...row.band_member };
        if (next[bandName]) {
          delete next[bandName];
        } else {
          const matchedBand = bands.find((band) => band.band_name === bandName);
          next[bandName] =
            matchedBand?.band_members && matchedBand.band_members.length > 0
              ? [...matchedBand.band_members]
              : getBandMembersTemplate(bandName);
        }
        return { ...row, band_member: next };
      }),
    );
  };

  const toggleBandMemberForSetlistRow = (rowKey: number, bandName: string, memberName: string) => {
    setSetlistRows((prev) =>
      prev.map((row) => {
        if (row.row_key !== rowKey) return row;
        const selected = row.band_member[bandName] ?? [];
        const nextMembers = selected.includes(memberName)
          ? selected.filter((member) => member !== memberName)
          : [...selected, memberName];
        return {
          ...row,
          band_member: {
            ...row.band_member,
            [bandName]: nextMembers,
          },
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
    const targetLive = lives.find((live) => live.live_id === selectedLiveId);
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
      return {
        song_id: Number(row.song_id),
        absolute_order: payloadIndex + 1,
        segment_type: derived.segmentType,
        sub_order: derived.subOrder,
        is_short: row.is_short,
        band_member: row.band_member,
        other_member: buildOtherMemberPayloadObject(row.other_member),
      };
    });
    const previewRows = setlistPayload.map((row) => ({
      ...row,
      song_name: validRows[row.absolute_order - 1]?.song_name.trim() ?? "",
    }));

    setPendingConfirmation({
      kind: "setlist",
      title: `确认提交 Setlist：#${targetLive.live_id} ${targetLive.live_title}`,
      live: targetLive,
      payload: { setlist_rows: setlistPayload },
      previewRows,
    });
  };

  const insertSetlist = async (
    targetLive: LiveInsertRow,
    payload: ConsoleLiveSetlistAppendPayload,
    previewRows: SetlistConfirmRow[],
    csrfToken: string,
  ) => {
    try {
      const response = await appendConsoleLiveSetlist(
        targetLive.live_id,
        payload,
        csrfToken,
      );
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
      onLiveDataChanged?.();
      clearSetlistPastePreview();
      clearSetlistData();
      setMessage(
        `已为Live #${targetLive.live_id} 插入 ${response.item.inserted_row_count} 条 setlist，总计 ${response.item.total_setlist_row_count} 条。`,
      );
    } catch (error) {
      setMessage(`提交setlist失败：${errorMessage(error)}`);
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
    if (liveDate.trim() === "" || liveTitle.trim() === "") {
      setMessage("新增Live失败：live_date 与 live_title 为必填项。");
      return;
    }
    if (selectedVenueId <= 0) {
      setMessage("新增Live失败：请先选择 venue。");
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("新增Live失败：登录态已失效，请重新登录。");
      return;
    }

    const selectedVenue = venues.find((venue) => venue.venue_id === selectedVenueId);
    setPendingConfirmation({
      kind: "live",
      title: "确认新增 Live",
      payload: {
        live_date: liveDate,
        live_title: liveTitle.trim(),
        type: liveType,
        url: liveUrl.trim(),
        opening_time: openingTime,
        start_time: startTime,
        timezone,
        venue_id: selectedVenueId,
      },
      venueName: selectedVenue?.venue_name ?? "-",
    });
  };

  const insertLive = async (payload: ConsoleLiveCreatePayload, csrfToken: string) => {
    try {
      const response = await createConsoleLive(
        payload,
        csrfToken,
      );
      const inserted: LiveInsertDraft = {
        live_id: response.item.live_id,
        live_date: response.item.live_date,
        live_title: response.item.live_title,
        type: payload.type,
        url: response.item.url,
        opening_time: response.item.opening_time,
        start_time: response.item.start_time,
        timezone: payload.timezone,
        venue_id: response.item.venue_id,
      };

      setInsertedLives((prev) => [inserted, ...prev]);
      setLives((prev) =>
        sortLivesForConsole(
          [
            {
              live_id: inserted.live_id,
              live_date: inserted.live_date,
              live_title: inserted.live_title,
              bands: [],
              url: inserted.url,
            },
            ...prev,
          ],
        ),
      );
      setLivePagination((prev) => {
        const total = prev.total + 1;
        return {
          ...prev,
          total,
          total_pages: Math.max(1, Math.ceil(total / prev.page_size)),
        };
      });
      setSelectedLiveId(inserted.live_id);
      onLiveDataChanged?.();
      resetLiveForm();
      setMessage(`已新增Live #${inserted.live_id}（${inserted.live_title}）`);
    } catch (error) {
      setMessage(`新增Live失败：${errorMessage(error)}`);
    }
  };

  const submitInsertLive = () => {
    requestLiveConfirmation();
  };

  const requestSongConfirmation = () => {
    const name = songName.trim();
    if (name === "") {
      setMessage("新增歌曲失败：song_name 不能为空。");
      return;
    }
    if (songBandId === null) {
      setMessage("新增歌曲失败：请先选择 band_id。");
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("新增歌曲失败：登录态已失效，请重新登录。");
      return;
    }

    const selectedBand = bands.find((band) => band.band_id === songBandId);
    setPendingConfirmation({
      kind: "song",
      title: "确认新增歌曲",
      payload: {
        song_name: name,
        band_id: songBandId,
        cover: songCover,
      },
      bandName: selectedBand?.band_name ?? "-",
    });
  };

  const submitSong = async (payload: ConsoleSongCreatePayload, csrfToken: string) => {
    try {
      const response = await createConsoleSong(
        payload,
        csrfToken,
      );
      const row = toSongInsertRow(response.item);
      setSongs((prev) => sortById([row, ...prev.filter((song) => song.song_id !== row.song_id)], (song) => song.song_id));
      setInsertedSongs((prev) => sortById([row, ...prev.filter((song) => song.song_id !== row.song_id)], (song) => song.song_id));
      resetSongForm();
      setMessage(`已新增歌曲 #${row.song_id}`);
    } catch (error) {
      setMessage(`新增歌曲失败：${errorMessage(error)}`);
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
        other_member: row.other_member,
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
      setMessage(`批量新增完成：成功 ${response.created.length} 首${skipped > 0 ? `，跳过 ${skipped} 首` : ""}。`);
    } catch (error) {
      setMessage(`批量新增失败：${errorMessage(error)}`);
    }
    await querySongsForSetlist();
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
        await insertLive(pendingConfirmation.payload, auth.csrfToken);
      } else if (pendingConfirmation.kind === "song") {
        await submitSong(pendingConfirmation.payload, auth.csrfToken);
      } else if (pendingConfirmation.kind === "batch_song") {
        await executeBatchSongInsert(pendingConfirmation.rows, auth.csrfToken);
      } else {
        await insertSetlist(
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

  const renderCompactConfirmation = (rows: Array<[string, string | number | boolean]>) => (
    <div className="console-confirm-table-wrap">
      <table className="console-admin-table console-confirm-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderPendingConfirmationBody = () => {
    if (!pendingConfirmation) return null;

    if (pendingConfirmation.kind === "venue") {
      return renderCompactConfirmation([["venue_name", pendingConfirmation.payload.venue_name]]);
    }

    if (pendingConfirmation.kind === "live") {
      const payload = pendingConfirmation.payload;
      return renderCompactConfirmation([
        ["live_date", payload.live_date],
        ["live_title", payload.live_title],
        ["type", payload.type],
        ["url", payload.url],
        ["opening_time", payload.opening_time],
        ["start_time", payload.start_time],
        ["timezone", payload.timezone],
        ["venue_id", payload.venue_id],
        ["venue_name", pendingConfirmation.venueName],
      ]);
    }

    if (pendingConfirmation.kind === "song") {
      const payload = pendingConfirmation.payload;
      return renderCompactConfirmation([
        ["song_name", payload.song_name],
        ["band_id", payload.band_id],
        ["band_name", pendingConfirmation.bandName],
        ["cover", payload.cover],
      ]);
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
            <table className="console-admin-table console-confirm-setlist-table">
              <thead>
                <tr>
                  <th>song_name</th>
                  <th>band_id</th>
                  <th>band_name</th>
                  <th>cover</th>
                  <th>band_member</th>
                  <th>other_member</th>
                </tr>
              </thead>
              <tbody>
                {pendingConfirmation.rows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.song_name}</td>
                    <td>{row.band_id}</td>
                    <td>{row.band_name}</td>
                    <td>{String(row.cover)}</td>
                    <td><code>{JSON.stringify(row.band_member)}</code></td>
                    <td><code>{JSON.stringify(buildOtherMemberPayloadObject(row.other_member))}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    return (
      <>
        <p className="detail-row">
          <strong>{pendingConfirmation.live.live_title}</strong>
          <span>#{pendingConfirmation.live.live_id}</span>
        </p>
        <div className="detail-meta-line">
          <p className="detail-inline-item detail-inline-item-date">
            <strong>日期：</strong>
            <span>{pendingConfirmation.live.live_date}</span>
          </p>
          <p className="detail-inline-item">
            <strong>待提交：</strong>
            <span>{pendingConfirmation.previewRows.length} 行</span>
          </p>
        </div>
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
      nextSongId={nextSongId}
      insertedSongs={insertedSongs}
      songName={songName}
      songBandId={songBandId}
      songCover={songCover}
      songBandOpen={songBandOpen}
      songBandMenuPos={songBandMenuPos}
      songBandTriggerRef={songBandTriggerRef}
      songBandMenuRef={songBandMenuRef}
      onSongNameChange={setSongName}
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
      <h3>控制台录入</h3>
      {message && <p className="console-admin-hint">{message}</p>}

      <div className="console-admin-modes" role="tablist" aria-label="控制台录入类型">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "live_create"}
          className={`console-mode-btn ${mode === "live_create" ? "active" : ""}`}
          onClick={() => setMode("live_create")}
        >
          新增Live
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "setlist"}
          className={`console-mode-btn ${mode === "setlist" ? "active" : ""}`}
          onClick={() => setMode("setlist")}
        >
          新增Setlist
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "song"}
          className={`console-mode-btn ${mode === "song" ? "active" : ""}`}
          onClick={() => setMode("song")}
        >
          新增歌曲
        </button>
      </div>

      {mode === "live_create" && (
        <LiveAdminSection
          liveDate={liveDate}
          liveTitle={liveTitle}
          liveType={liveType}
          liveUrl={liveUrl}
          openingTime={openingTime}
          startTime={startTime}
          timezone={timezone}
          selectedVenueId={selectedVenueId}
          venueQueryText={venueQueryText}
          venues={venues}
          timezoneOptions={TIMEZONE_OPTIONS}
          liveTypeOptions={LIVE_TYPE_OPTIONS}
          venueOpen={venueOpen}
          venueMenuPos={venueMenuPos}
          venueTriggerRef={venueTriggerRef}
          venueMenuRef={venueMenuRef}
          insertedLives={insertedLives}
          onLiveDateChange={setLiveDate}
          onLiveTitleChange={setLiveTitle}
          onLiveTypeChange={setLiveType}
          onLiveUrlChange={setLiveUrl}
          onOpeningTimeChange={setOpeningTime}
          onStartTimeChange={setStartTime}
          onTimezoneChange={setTimezone}
          onVenueQueryTextChange={setVenueQueryText}
          onOpenVenueMenu={openVenueMenu}
          onSelectVenue={(venueId) => {
            setSelectedVenueId(venueId);
            setVenueOpen(false);
          }}
          onQueryVid={queryVid}
          onInsertVenue={requestVenueConfirmation}
          onClearInsertLive={clearLiveForm}
          onSubmitInsertLive={submitInsertLive}
          queryInsertDisabled={isVenueQuickInsertDisabled}
          submitInsertDisabled={isLiveSubmitDisabled}
        />
      )}

      {mode === "setlist" && (
        <LiveInsertTab
          lives={lives}
          selectedLiveId={selectedLiveId}
          livePage={livePagination.page}
          liveTotal={livePagination.total}
          liveTotalPages={livePagination.total_pages}
          isLiveLoading={isLiveLoading}
          didSongLookup={didSongLookup}
          setlistRows={setlistRows}
          derivedSegments={derivedSegments}
          submittedBundles={submittedBundles}
          displayedBundle={displayedBundle}
          bandOptions={bands}
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
          onSelectedLiveIdChange={setSelectedLiveId}
          onLivePageChange={setLivePage}
          onSetlistPasteTextChange={updateSetlistPasteText}
          onPreviewSetlistPaste={buildSetlistPastePreview}
          onApplySetlistPaste={applySetlistPastePreview}
          onClearSetlistPaste={clearSetlistPastePreview}
          onOpenFullSetlistPreview={() => setSetlistParsePreviewOpen(true)}
          onCloseFullSetlistPreview={() => setSetlistParsePreviewOpen(false)}
          onUpdateSetlistSongName={updateSetlistSongName}
          onSetSongModalRowKey={setSongModalRowKey}
          onUpdateSetlistSegment={(rowKey, value) => updateSetlistRow(rowKey, "segment_start_type", value)}
          onToggleSetlistShort={(rowKey, checked) => updateSetlistRow(rowKey, "is_short", checked)}
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
          onToggleBandForSetlistRow={toggleBandForSetlistRow}
          onToggleBandMemberForSetlistRow={toggleBandMemberForSetlistRow}
          onUpdateOtherMemberEntry={updateOtherMemberEntry}
          onRemoveOtherMemberEntry={removeOtherMemberEntry}
          onAddOtherMemberEntry={addOtherMemberEntry}
          renderSongAdminSection={renderSongAdminSection}
        />
      )}

      {mode === "song" && (
        renderSongAdminSection()
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
                {confirmationSubmitting ? "提交中..." : "确认提交"}
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
