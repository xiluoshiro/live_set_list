import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { createConsoleSongsBatch, getCatalogConsole, getConsoleBands, type AlbumTrackWrite, type CatalogMember, type CatalogPage, type ConsoleSongItem, type SongOwnership } from "../../api";
import { albumSongLabel, parseAlbumTrackText, type ParsedAlbumTrack } from "./albumTracks";
import { normalizeSongLookupText } from "./helpers";
import { ownershipValid } from "./OwnershipFields";
import { BatchSongConfirmation } from "./BatchSongConfirmation";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";
import { ConsoleEditorLock } from "./ConsoleEditorLock";
import type { BandOption } from "./types";
import { useConsoleDraftGuard } from "./ConsoleDraftGuard";

type PasteRow = ParsedAlbumTrack & { candidates: ConsoleSongItem[]; song: ConsoleSongItem | null };

export function AlbumTrackPaste({ locked, csrfToken, section, startOrder, onAppend, onLock, discardGuard }: {
  locked: boolean; csrfToken: string | null; section: string; startOrder: number;
  onAppend: (tracks: AlbumTrackWrite[], songs: ConsoleSongItem[]) => void;
  onLock: (locked: boolean) => void;
  discardGuard: MutableRefObject<((proceed: () => void) => void) | null>;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PasteRow[]>([]);
  const [bands, setBands] = useState<BandOption[]>([]);
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { guard, dialog: discardDialog } = useConsoleDraftGuard({ dirty: !!text.trim() || rows.length > 0,
    busy: busy || confirm, label: "批量收录歌曲", onDiscard: () => { setText(""); setRows([]); setWarnings([]); setError(""); } });
  useEffect(() => { discardGuard.current = guard; return () => { discardGuard.current = null; }; }, [discardGuard, guard]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLock(false); }; }, [onLock]);
  const processing = useRef(false);
  const parseAndLookup = async () => {
    if (processing.current) return;
    processing.current = true;
    setBusy(true); onLock(true); setError("");
    try {
      const [bandResult, memberResult] = await Promise.all([
        getConsoleBands(undefined, 100), getCatalogConsole<{ items: CatalogMember[] }>("/members"),
      ]);
      const parsed = parseAlbumTrackText(text, bandResult.items, memberResult.items);
      const candidates = new Map<string, ConsoleSongItem[]>();
      const names = [...new Set(parsed.rows.map(row => row.song_name))];
      // Bound concurrent lookups while retaining every page of version candidates.
      const lookups = await Promise.allSettled(Array.from({ length: Math.min(4, names.length) }, async () => {
        while (names.length) {
          const name = names.shift()!;
          const items: ConsoleSongItem[] = [];
          let pages = 1;
          for (let page = 1; page <= pages; page += 1) {
            const result = await getCatalogConsole<CatalogPage<ConsoleSongItem>>(`/songs?q=${encodeURIComponent(name)}&page=${page}&limit=100`);
            items.push(...result.items); pages = result.total_pages ?? 1;
          }
          const normalized = normalizeSongLookupText(name);
          const prefix = items.filter(song => normalizeSongLookupText(song.song_name).startsWith(normalized));
          const exact = prefix.filter(song => normalizeSongLookupText(song.song_name) === normalized);
          candidates.set(name, exact.length ? exact : prefix);
        }
      }));
      const failed = lookups.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
      if (!mounted.current) return;
      setBands(bandResult.items); setMembers(memberResult.items); setWarnings(parsed.warnings);
      setRows(parsed.rows.map(row => {
        const options = candidates.get(row.song_name) ?? [];
        return { ...row, candidates: options, song: options.length === 1 ? options[0] : null };
      }));
      if (!parsed.rows.length) setError("未解析到任何歌曲行。");
    } catch (e) { if (mounted.current) setError(`解析或查询失败：${String(e)}`); }
    finally { processing.current = false; if (mounted.current) { setBusy(false); onLock(false); } }
  };
  const missing = rows.filter(row => !row.song && !row.candidates.length);
  const newRows = rows.flatMap((row, index) => !row.song && !row.candidates.length
    ? [{ row_key: index, song_name: row.song_name, ownership: row.ownership }] : []);
  const updateOwnership = (index: number, ownership: SongOwnership) => setRows(current => current.map((row, i) => i === index ? { ...row, ownership } : row));
  const apply = async () => {
    if (processing.current || (missing.length > 0 && !csrfToken)) return;
    processing.current = true;
    setBusy(true); setError("");
    try {
      const next = [...rows];
      if (missing.length) {
        const indices = rows.flatMap((row, index) => !row.song && !row.candidates.length ? [index] : []);
        const failures: string[] = [];
        for (let offset = 0; offset < indices.length; offset += 100) {
          const batchIndices = indices.slice(offset, offset + 100);
          const result = await createConsoleSongsBatch(batchIndices.map(index => ({ group_name: rows[index].song_name,
            version_label: "", cover_urls: [], ownership: rows[index].ownership })), csrfToken!);
          for (const [batchIndex, rowIndex] of batchIndices.entries()) {
            const saved = result.results.find(item => item.index === batchIndex);
            if (saved?.item) {
              const item = saved.item;
              next[rowIndex] = { ...next[rowIndex], song: { song_id: item.song_id, group_id: item.group_id, song_name: item.song_name,
                version_label: item.version_label, owner_mode: item.ownership.mode === "pending" ? null : item.ownership.mode,
                band_name: [...item.ownership.bands.map(band => band.band_name), ...item.ownership.groups.map(group => group.band_name)].join(" / ") || "待回填" } };
            } else failures.push(`${next[rowIndex].song_name}：${saved?.error ?? "未返回歌曲"}`);
          }
          if (!mounted.current) return;
          setRows([...next]);
        }
        if (failures.length) { setError(failures.join("；")); return; }
      }
      const songs = next.map(row => row.song!);
      onAppend(songs.map(song => ({ song_id: song.song_id, track_order: 1, edition_label: "", section_name: section })), songs);
      setRows([]); setText(""); setWarnings([]); setConfirm(false); onLock(false);
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { processing.current = false; if (mounted.current) setBusy(false); }
  };
  const unresolved = rows.some(row => !row.song && row.candidates.length > 0);
  return <section className="setlist-paste-panel" aria-label="批量粘贴收录歌曲">
    <ConsoleEditorLock locked={locked || busy || confirm}>
      <div className="setlist-paste-head">
        <h4>批量粘贴收录歌曲</h4>
        <div className="setlist-paste-actions">
          <button type="button" className="console-ghost-btn" disabled={locked || busy || confirm || !text.trim()} onClick={() => void parseAndLookup()}>解析并查询</button>
          <button type="button" className="console-submit-btn" disabled={locked || busy || confirm || !rows.length || unresolved}
            onClick={() => { setError(""); setConfirm(true); onLock(true); }}>批量插入</button>
        </div>
      </div>
      <textarea className="setlist-paste-textarea" aria-label="批量粘贴收录歌曲文本" disabled={locked || busy || confirm} value={text}
        placeholder={"<Roselia>\n1. 歌曲名\n2. 歌曲名"} onChange={event => { setText(event.target.value); setRows([]); setWarnings([]); setError(""); }} />
      {busy && !confirm && <p role="status">正在解析并查询歌曲…</p>}
      {error && !confirm && <p role="alert">{error}</p>}
      {warnings.length > 0 && <ul className="setlist-paste-warnings">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      {rows.length > 0 && <div className="console-table-wrap setlist-input-wrap"><table className="console-admin-table" aria-label="收录歌曲解析结果">
        <thead><tr><th>曲序</th><th>歌曲名称</th><th>标签</th><th>歌曲版本</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}><td>{startOrder + index}</td><td>{row.song_name}</td><td>{row.tag || "—"}</td><td>
          {row.candidates.length > 1 ? <select aria-label={`第 ${index + 1} 行歌曲版本`} disabled={locked || busy || confirm} value={row.song?.song_id ?? ""}
            onChange={event => { const song = row.candidates.find(item => item.song_id === Number(event.target.value)) ?? null; setRows(current => current.map((item, i) => i === index ? { ...item, song } : item)); }}>
            <option value="">请选择歌曲版本</option>{row.candidates.map(song => <option key={song.song_id} value={song.song_id}>{albumSongLabel(song)}</option>)}
          </select> : row.song ? albumSongLabel(row.song) : "未匹配，将新增"}
        </td></tr>)}</tbody>
      </table></div>}
    </ConsoleEditorLock>
    {discardDialog}
    {confirm && <ConsoleConfirmDialog title={missing.length ? "确认批量新增歌曲" : "确认批量收录歌曲"}
      className={missing.length ? "batch_song" : ""} busy={busy} error={error}
      confirmLabel={missing.length ? "确认提交" : "确认应用"} disabled={missing.some(row => !ownershipValid(row.ownership)) || (missing.length > 0 && !csrfToken)}
      onClose={() => { if (!busy) { setConfirm(false); onLock(false); } }} onConfirm={apply}>
      {missing.length ? <BatchSongConfirmation rows={newRows} bands={bands} members={members} busy={busy}
        onOwnershipChange={updateOwnership} /> : <CompactConfirmationTable ariaLabel="批量收录歌曲确认"
          rows={rows.map((row, index) => [`曲目 ${startOrder + index}`, albumSongLabel(row.song!)] as const)} />}
    </ConsoleConfirmDialog>}
  </section>;
}
