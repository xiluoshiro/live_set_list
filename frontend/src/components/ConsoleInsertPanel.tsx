import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import {
  createConsoleLive,
  createConsoleVenue,
  getConsoleBands,
  getConsoleSongs,
  getConsoleVenues,
  getLiveDetail,
  getLives,
  type ConsoleBandItem,
  type ConsoleSongItem,
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
import { buildOtherMemberPayload, getBandMembersTemplate, getDerivedSegments } from "./console/helpers";
import { parseSetlistText } from "./console/setlistParser/parseSetlistText";
import type { ParsedSetlistWarning } from "./console/setlistParser/types";
import type {
  BandOption,
  ConsoleMode,
  LiveInsertBundle,
  LiveInsertRow,
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

export function ConsoleInsertPanel() {
  const auth = useAuth();
  const [mode, setMode] = useState<ConsoleMode>("setlist");
  const [lives, setLives] = useState<LiveInsertRow[]>([]);
  const [songs, setSongs] = useState<SongInsertRow[]>([]);
  const [bands, setBands] = useState<BandOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [submittedBundles, setSubmittedBundles] = useState<LiveInsertBundle[]>([]);
  const [displayedBundle, setDisplayedBundle] = useState<LiveInsertBundle | null>(null);
  const [message, setMessage] = useState<string>("当前为前端 Mock 插入，后续可接后端写入接口。");
  const [transientNotice, setTransientNotice] = useState<string | null>(null);

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

  const [liveDate, setLiveDate] = useState("2026-03-30");
  const [liveTitle, setLiveTitle] = useState("");
  const [liveType, setLiveType] = useState(LIVE_TYPE_OPTIONS[0] ?? "其他");
  const [liveUrl, setLiveUrl] = useState("");
  const [openingTime, setOpeningTime] = useState("18:00");
  const [startTime, setStartTime] = useState("19:00");
  const [timezone, setTimezone] = useState("+09:00");
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

  const submitSetlist = () => {
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

    const validDerivedSegments = getDerivedSegments(validRows);
    const setlistPayload = validRows.map((row, payloadIndex) => {
      const derived = validDerivedSegments[payloadIndex];
      return {
        song_id: Number(row.song_id),
        absolute_order: payloadIndex + 1,
        segment_type: derived.segmentType,
        sub_order: derived.subOrder,
        is_short: row.is_short,
        band_member: JSON.stringify(row.band_member),
        other_member: buildOtherMemberPayload(row.other_member),
      };
    });

    const newBundle = { live: targetLive, setlist_rows: setlistPayload };
    setSubmittedBundles((prev) => [newBundle, ...prev]);
    setDisplayedBundle(newBundle);
    setMessage(`已为Live #${targetLive.live_id} 插入 ${setlistPayload.length} 条 setlist(mock)`);
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

  const insertVenue = async () => {
    const venueName = venueQueryText.trim();
    if (venueName === "") {
      setMessage("新增venue失败：venue 名称不能为空。");
      return;
    }
    if (!auth.isAuthenticated || !auth.csrfToken) {
      setMessage("新增venue失败：登录态已失效，请重新登录。");
      return;
    }

    try {
      const response = await createConsoleVenue(venueName, auth.csrfToken);
      const inserted = toVenueOption(response.item);
      setVenues((prev) => sortById([inserted, ...prev.filter((venue) => venue.venue_id !== inserted.venue_id)], (venue) => venue.venue_id));
      setSelectedVenueId(inserted.venue_id);
      setVenueOpen(false);
      setMessage(`已新增venue #${inserted.venue_id}（${inserted.venue_name}）`);
    } catch (error) {
      setMessage(`新增venue失败：${errorMessage(error)}`);
    }
  };

  const insertLive = async () => {
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

    try {
      const response = await createConsoleLive(
        {
          live_date: liveDate,
          live_title: liveTitle.trim(),
          type: liveType,
          url: liveUrl.trim(),
          opening_time: openingTime,
          start_time: startTime,
          timezone,
          venue_id: selectedVenueId,
        },
        auth.csrfToken,
      );
      const inserted: LiveInsertDraft = {
        live_id: response.item.live_id,
        live_date: response.item.live_date,
        live_title: response.item.live_title,
        type: liveType,
        url: response.item.url,
        opening_time: response.item.opening_time,
        start_time: response.item.start_time,
        timezone,
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
      setSelectedLiveId(inserted.live_id);
      setMessage(`已新增Live #${inserted.live_id}（${inserted.live_title}）`);
    } catch (error) {
      setMessage(`新增Live失败：${errorMessage(error)}`);
    }
  };

  const submitInsertLive = () => {
    void insertLive();
  };

  const submitSong = () => {
    const name = songName.trim();
    if (name === "") {
      setMessage("新增歌曲失败：song_name 不能为空。");
      return;
    }
    if (songBandId === null) {
      setMessage("新增歌曲失败：请先选择 band_id。");
      return;
    }
    const row: SongInsertRow = { song_id: nextSongId, song_name: name, band_id: songBandId, cover: songCover };
    setSongs((prev) => sortById([row, ...prev], (song) => song.song_id));
    setInsertedSongs((prev) => sortById([row, ...prev], (song) => song.song_id));
    setSongName("");
    setSongCover(false);
    setSongBandOpen(false);
    setMessage(`已新增歌曲 #${row.song_id}`);
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
      mockBands={bands}
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
      onSubmitSong={submitSong}
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
      <p className="console-admin-hint">{message}</p>

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
          onInsertVenue={() => void insertVenue()}
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
          mockBands={bands}
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
          onQuerySongsForSetlist={querySongsForSetlist}
          onSubmitLiveWithSetlist={submitSetlist}
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
                seed={selectedLiveId}
              />
            </div>
          </div>
        </div>
      )}
      </section>
    </>
  );
}
