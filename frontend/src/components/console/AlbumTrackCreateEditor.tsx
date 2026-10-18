import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createConsoleSongsBatch, getCatalogConsole, getConsoleBands,
  type AlbumTrackWrite, type CatalogMember, type CatalogPage, type ConsoleSongItem } from "../../api";
import { AlbumTrackPaste } from "./AlbumTrackPaste";
import { type AlbumTrackDraft, type ParsedAlbumTrack } from "./albumTracks";
import { BatchSongConfirmation } from "./BatchSongConfirmation";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";
import { useConsoleDraftGuard } from "./ConsoleDraftGuard";
import { normalizeSongLookupText } from "./helpers";
import { emptyOwnership, ownershipValid } from "./OwnershipFields";
import type { BandOption } from "./types";

export function AlbumTrackCreateEditor({ locked, csrfToken, onChange, onLock, discardGuard, submitButton }: {
  locked: boolean; csrfToken: string | null;
  onChange: (tracks: AlbumTrackWrite[], songs: ConsoleSongItem[], ready: boolean) => void;
  onLock: (locked: boolean) => void;
  discardGuard: MutableRefObject<((proceed: () => void) => void) | null>;
  submitButton: ReactNode;
}) {
  const [rows, setRows] = useState<AlbumTrackDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [batchKeys, setBatchKeys] = useState<number[]>([]);
  const [candidateRowKey, setCandidateRowKey] = useState<number | null>(null);
  const [candidateSongId, setCandidateSongId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [bands, setBands] = useState<BandOption[]>([]);
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const nextKey = useRef(0);
  const processing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLock(false); }; }, [onLock]);
  const disabled = locked || busy || confirm || candidateRowKey !== null;
  const candidateRow = rows.find(row => row.row_key === candidateRowKey);
  const closeCandidates = () => { setCandidateRowKey(null); setCandidateSongId(null); onLock(false); };
  const { guard, dialog } = useConsoleDraftGuard({ dirty: rows.length > 0, busy: disabled,
    label: "收录曲目", onDiscard: () => setRows([]) });
  const counts = new Map<string, number>();
  const numbered = rows.map(row => {
    const section = row.section_name ?? "";
    const order = (counts.get(section) ?? 0) + 1;
    counts.set(section, order);
    return { ...row, track_order: order };
  });
  useEffect(() => {
    const tracks = numbered.flatMap(row => row.song ? [{ song_id: row.song.song_id, track_order: row.track_order,
      edition_label: row.edition_label, section_name: row.section_name ?? "" }] : []);
    onChange(tracks, rows.flatMap(row => row.song ? [row.song] : []), rows.every(row => !!row.song && !!row.song_name.trim()));
  // Numbering and readiness are derived entirely from the current rows.
  }, [rows, onChange]);
  const section = rows[rows.length - 1]?.section_name ?? "";
  const append = (parsed: ParsedAlbumTrack[]) => {
    setRows(current => [...current, ...parsed.map(row => ({ row_key: nextKey.current++, song_name: row.song_name,
      ownership: row.ownership, song: null, candidates: [], queried: false,
      track_order: 1, edition_label: "", section_name: section }))]);
    setError("");
  };
  const update = (key: number, change: Partial<AlbumTrackDraft>) => setRows(current => current.map(row => row.row_key === key ? { ...row, ...change } : row));
  const lookup = async () => {
    if (processing.current || disabled) return;
    processing.current = true; setBusy(true); onLock(true); setError("");
    try {
      const names = [...new Set(rows.map(row => row.song_name.trim()).filter(Boolean))];
      const matches = new Map<string, ConsoleSongItem[]>();
      const results = await Promise.allSettled(Array.from({ length: Math.min(4, names.length) }, async () => {
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
          matches.set(name, exact.length ? exact : prefix);
        }
      }));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
      if (!mounted.current) return;
      setRows(current => current.map(row => {
        const candidates = matches.get(row.song_name.trim()) ?? [];
        const selected = candidates.find(song => song.song_id === row.song?.song_id);
        return { ...row, candidates, queried: !!row.song_name.trim(), song: selected ?? (candidates.length === 1 ? candidates[0] : null) };
      }));
    } catch (e) { if (mounted.current) setError(`查询歌曲失败：${String(e)}`); }
    finally { processing.current = false; if (mounted.current) { setBusy(false); onLock(false); } }
  };
  const missing = rows.filter(row => row.song_name.trim() && row.queried && !row.song && !row.candidates.length);
  const batchRows = missing.filter(row => batchKeys.includes(row.row_key));
  const reviewBatch = async (rowKey?: number) => {
    if (processing.current || disabled || !missing.length) return;
    processing.current = true; setBusy(true); onLock(true); setError("");
    try {
      const [bandResult, memberResult] = await Promise.all([
        getConsoleBands(undefined, 100), getCatalogConsole<{ items: CatalogMember[] }>("/members"),
      ]);
      if (!mounted.current) return;
      setBands(bandResult.items); setMembers(memberResult.items);
      setBatchKeys(rowKey === undefined ? missing.map(row => row.row_key) : [rowKey]); setConfirm(true);
    } catch (e) { if (mounted.current) { setError(`加载归属选项失败：${String(e)}`); onLock(false); } }
    finally { processing.current = false; if (mounted.current) setBusy(false); }
  };
  const insert = async () => {
    if (processing.current || !csrfToken) return;
    processing.current = true; setBusy(true); setError("");
    try {
      const failures: string[] = [];
      for (let offset = 0; offset < batchRows.length; offset += 100) {
        const batch = batchRows.slice(offset, offset + 100);
        const result = await createConsoleSongsBatch(batch.map(row => ({ group_name: row.song_name.trim(),
          version_label: "", cover_urls: [], ownership: row.ownership })), csrfToken);
        if (!mounted.current) return;
        const saved = new Map<number, ConsoleSongItem>();
        batch.forEach((row, index) => {
          const outcome = result.results.find(item => item.index === index);
          const item = outcome?.item;
          if (item) saved.set(row.row_key, { song_id: item.song_id, group_id: item.group_id, song_name: item.song_name,
            version_label: item.version_label, owner_mode: item.ownership.mode === "pending" ? null : item.ownership.mode,
            band_name: [...item.ownership.bands.map(band => band.band_name), ...item.ownership.groups.map(group => group.band_name)].join(" / ") || "待回填" });
          else failures.push(`${row.song_name}：${outcome?.error ?? "未返回歌曲"}`);
        });
        setRows(current => current.map(row => saved.has(row.row_key) ? { ...row, song: saved.get(row.row_key)! } : row));
      }
      if (failures.length) { setError(failures.join("；")); return; }
      setConfirm(false); onLock(false);
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { processing.current = false; if (mounted.current) setBusy(false); }
  };
  return <>
    <AlbumTrackPaste locked={disabled} startOrder={(counts.get(section) ?? 0) + 1} onAppend={append} onLock={onLock} discardGuard={discardGuard} />
    {error && !confirm && <p role="alert">{error}</p>}
    {busy && !confirm && <p role="status">正在查询歌曲…</p>}
    <div className="console-table-wrap setlist-input-wrap"><table className="console-admin-table album-track-editor album-track-create-table" aria-label="专辑收录曲目">
      <colgroup><col className="album-track-section-column" /><col className="album-track-order-column" /><col /><col className="album-track-song-id-column" /><col className="album-track-edition-column" /></colgroup>
      <thead><tr><th scope="col">碟号/发行版</th><th scope="col">曲序</th><th scope="col">歌曲</th><th scope="col">歌曲 ID</th><th scope="col">器乐</th></tr></thead>
      <tbody>{!rows.length && <tr><td colSpan={5} className="empty-cell">暂无收录曲目</td></tr>}
        {numbered.map((row, index) => <tr key={row.row_key}>
          <td><input aria-label={`第 ${index + 1} 曲碟号/发行版`} placeholder="Disc1/限定版" disabled={disabled}
            value={row.section_name ?? ""} onChange={e => update(row.row_key, { section_name: e.target.value })} /></td>
          <td>{row.track_order}</td>
          <td><input aria-label={`第 ${index + 1} 曲歌曲名称`} placeholder="请输入歌曲名" disabled={disabled} value={row.song_name}
            onChange={e => update(row.row_key, { song_name: e.target.value, song: null, candidates: [], queried: false })} />
          </td>
          <td>
            {row.song ? <span className="readonly-cell">{row.song.song_id}</span>
              : row.candidates.length > 1 ? <button type="button" className="song-missing-btn" disabled={disabled}
                onClick={() => { setCandidateRowKey(row.row_key); setCandidateSongId(null); onLock(true); }}>候选 {row.candidates.length}</button>
              : row.queried ? <button type="button" className="song-missing-btn" disabled={disabled || !csrfToken}
                onClick={() => void reviewBatch(row.row_key)}>未匹配</button>
              : <span className="readonly-cell">-</span>}
          </td>
          <td><input className="is-short-check" type="checkbox" aria-label={`第 ${index + 1} 曲器乐`} disabled={disabled}
            checked={row.edition_label === "Instrumental"} onChange={e => update(row.row_key, { edition_label: e.target.checked ? "Instrumental" : "" })} /></td>
        </tr>)}
      </tbody>
    </table></div>
    <div className="setlist-actions-row">
      <button type="button" className="console-ghost-btn" disabled={disabled} onClick={() => append([{ song_name: "", tag: "", ownership: emptyOwnership() }])}>新增一行</button>
      <button type="button" className="console-ghost-btn" disabled={disabled || !rows.length} onClick={() => setRows(current => current.slice(0, -1))}>删除末行</button>
      <button type="button" className="console-ghost-btn" disabled={disabled} onClick={() => guard(() => { setRows([]); setError(""); })}>清空数据</button>
      <button type="button" className="console-submit-btn" disabled={disabled || !missing.length || !csrfToken} onClick={() => void reviewBatch()}>批量插入</button>
    </div>
    <div className="console-submit-row">
      <button type="button" className="console-ghost-btn" disabled={disabled || !rows.some(row => row.song_name.trim())} onClick={() => void lookup()}>查询歌曲</button>
      {submitButton}
    </div>
    {dialog}
    {confirm && <ConsoleConfirmDialog title="确认批量新增歌曲" className="batch_song" busy={busy} error={error}
      confirmLabel="确认提交" disabled={!batchRows.length || batchRows.some(row => !ownershipValid(row.ownership)) || !csrfToken}
      onClose={() => { if (!busy) { setConfirm(false); setError(""); onLock(false); } }} onConfirm={insert}>
      <BatchSongConfirmation rows={batchRows} bands={bands} members={members} busy={busy}
        onOwnershipChange={(key, ownership) => update(key, { ownership })} />
    </ConsoleConfirmDialog>}
    {candidateRow && <ConsoleConfirmDialog title="选择歌曲版本" size="wide" confirmLabel="确认应用"
      disabled={candidateSongId === null} onClose={closeCandidates}
      onConfirm={() => {
        const song = candidateRow.candidates.find(item => item.song_id === candidateSongId);
        if (song) update(candidateRow.row_key, { song });
        closeCandidates();
      }}>
      <div className="console-table-wrap"><table className="console-admin-table" aria-label="歌曲版本候选">
        <thead><tr><th>歌曲 ID</th><th>歌曲名称</th><th>版本名称</th><th>归属</th><th>选择</th></tr></thead>
        <tbody>{candidateRow.candidates.map(song => <tr key={song.song_id}>
          <td>{song.song_id}</td><td>{song.song_name}</td><td>{song.version_label || "默认版本"}</td><td>{song.band_name ?? "待回填"}</td>
          <td><input type="radio" name="album-song-version" aria-label={`选择歌曲版本 #${song.song_id}`}
            checked={candidateSongId === song.song_id} onChange={() => setCandidateSongId(song.song_id)} /></td>
        </tr>)}</tbody>
      </table></div>
    </ConsoleConfirmDialog>}
  </>;
}
