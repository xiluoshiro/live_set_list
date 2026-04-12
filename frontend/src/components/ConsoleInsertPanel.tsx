import { useEffect, useMemo, useRef, useState } from "react";

import { LiveAdminSection } from "./console/LiveAdminSection";
import { LiveInsertTab } from "./console/LiveInsertTab";
import { SongAdminSection } from "./console/SongAdminSection";
import {
  INITIAL_SETLIST_ROWS,
  LIVE_TYPE_OPTIONS,
  MOCK_BANDS,
  MOCK_LIVES,
  MOCK_SONGS,
  MOCK_VENUES,
} from "./console/constants";
import { buildOtherMemberPayload, getBandMembersTemplate, getDerivedSegments } from "./console/helpers";
import type {
  ConsoleMode,
  LiveInsertBundle,
  LiveInsertRow,
  Position,
  SetlistDraftRow,
  SongInsertRow,
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

export function ConsoleInsertPanel() {
  const [mode, setMode] = useState<ConsoleMode>("setlist");
  const [lives, setLives] = useState<LiveInsertRow[]>(MOCK_LIVES);
  const [songs, setSongs] = useState<SongInsertRow[]>(MOCK_SONGS);
  const [submittedBundles, setSubmittedBundles] = useState<LiveInsertBundle[]>([]);
  const [displayedBundle, setDisplayedBundle] = useState<LiveInsertBundle | null>(null);
  const [message, setMessage] = useState<string>("当前为前端 Mock 插入，后续可接后端写入接口。");

  const [selectedLiveId, setSelectedLiveId] = useState<number>(MOCK_LIVES[0]?.live_id ?? 0);

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
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  );
  const [selectedVenueId, setSelectedVenueId] = useState<number>(MOCK_VENUES[0]?.venue_id ?? 0);
  const [venueQueryText, setVenueQueryText] = useState("");
  const [venueOpen, setVenueOpen] = useState(false);
  const [venueMenuPos, setVenueMenuPos] = useState<Position | null>(null);
  const [insertedLives, setInsertedLives] = useState<LiveInsertDraft[]>([]);
  const [setlistDetailOpen, setSetlistDetailOpen] = useState(false);

  const [setlistRows, setSetlistRows] = useState<SetlistDraftRow[]>(INITIAL_SETLIST_ROWS);
  const [setlistRowKey, setSetlistRowKey] = useState(1000);
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
  const nextLiveId = useMemo(
    () => lives.reduce((maxId, row) => Math.max(maxId, row.live_id), 100) + 1,
    [lives],
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
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
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
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
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
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
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
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [editingOtherRowKey]);

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
      if (prev.length <= 1) return prev;
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

  const querySongsForSetlist = () => {
    const songMap = new Map<string, number>();
    songs.forEach((song) => {
      const normalized = song.song_name.trim().toLowerCase();
      if (normalized !== "" && !songMap.has(normalized)) {
        songMap.set(normalized, song.song_id);
      }
    });

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
          next[bandName] = getBandMembersTemplate(bandName);
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

  const showCurrentSetlistDetail = () => {
    const target = submittedBundles.find((bundle) => bundle.live.live_id === selectedLiveId) ?? null;
    setDisplayedBundle(target);
    if (!target) {
      setMessage(`Live #${selectedLiveId} 暂无可展示的 setlist 详细信息(mock)。`);
      return;
    }
    setSetlistDetailOpen(true);
    setMessage(`Live #${selectedLiveId} 可查看详细信息(mock)。`);
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

  const queryVid = () => {
    setMessage(`查询完成：关键词“${venueQueryText.trim() || "-"}” (mock)。`);
  };

  const insertLive = () => {
    if (liveDate.trim() === "" || liveTitle.trim() === "") {
      setMessage("新增Live失败：live_date 与 live_title 为必填项。");
      return;
    }
    if (selectedVenueId <= 0) {
      setMessage("新增Live失败：请先选择 venue。");
      return;
    }

    const liveId = nextLiveId;
    const inserted: LiveInsertDraft = {
      live_id: liveId,
      live_date: liveDate,
      live_title: liveTitle.trim(),
      type: liveType,
      url: liveUrl.trim() || null,
      opening_time: openingTime,
      start_time: startTime,
      timezone,
      venue_id: selectedVenueId,
    };

    setInsertedLives((prev) => [inserted, ...prev]);
    setLives((prev) => [{ live_id: inserted.live_id, live_date: inserted.live_date, live_title: inserted.live_title, bands: [], url: inserted.url }, ...prev]);
    setSelectedLiveId(inserted.live_id);
    setMessage(`已新增Live #${inserted.live_id}（${inserted.live_title}）`);
  };

  const submitInsertLive = () => {
    insertLive();
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
    setSongs((prev) => [row, ...prev]);
    setInsertedSongs((prev) => [row, ...prev]);
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

  const renderSongAdminSection = () => (
    <SongAdminSection
      mockBands={MOCK_BANDS}
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
          venues={MOCK_VENUES}
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
          onInsertLive={insertLive}
          onSubmitInsertLive={submitInsertLive}
          queryInsertDisabled={isVenueQuickInsertDisabled}
          submitInsertDisabled={isLiveSubmitDisabled}
        />
      )}

      {mode === "setlist" && (
        <LiveInsertTab
          lives={lives}
          selectedLiveId={selectedLiveId}
          didSongLookup={didSongLookup}
          setlistRows={setlistRows}
          derivedSegments={derivedSegments}
          submittedBundles={submittedBundles}
          displayedBundle={displayedBundle}
          mockBands={MOCK_BANDS}
          editingBandRow={editingBandRow}
          editingOtherRow={editingOtherRow}
          bandMemberMenuPos={bandMemberMenuPos}
          otherMemberMenuPos={otherMemberMenuPos}
          songModalRowKey={songModalRowKey}
          bandMemberTriggerRefs={bandMemberTriggerRefs}
          bandMemberMenuRef={bandMemberMenuRef}
          otherMemberTriggerRefs={otherMemberTriggerRefs}
          otherMemberMenuRef={otherMemberMenuRef}
          onSelectedLiveIdChange={setSelectedLiveId}
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
              <strong>live_id：</strong>
              <span>{selectedLiveId}</span>
            </p>
            <div className="detail-table-wrap">
              <p className="empty-cell">TODO: 复用主界面详细信息内容结构（当前内部留空）。</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
