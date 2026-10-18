import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { getCatalogConsole, getConsoleBands, type CatalogMember } from "../../api";
import { parseAlbumTrackText, type ParsedAlbumTrack } from "./albumTracks";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";
import { ConsolePastePreview, ConsolePastePreviewDetails } from "./ConsolePastePreview";
import { useConsoleDraftGuard } from "./ConsoleDraftGuard";

export function AlbumTrackPaste({ locked, startOrder, onAppend, onLock, discardGuard }: {
  locked: boolean; startOrder: number;
  onAppend: (rows: ParsedAlbumTrack[]) => void;
  onLock: (locked: boolean) => void;
  discardGuard: MutableRefObject<((proceed: () => void) => void) | null>;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedAlbumTrack[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mounted = useRef(true);
  const processing = useRef(false);
  const clear = () => { setText(""); setRows([]); setWarnings([]); setError(""); setDetailsOpen(false); };
  const disabled = locked || busy || confirm || detailsOpen;
  const { guard, dialog } = useConsoleDraftGuard({ dirty: !!text.trim(), busy: busy || confirm || detailsOpen,
    label: "批量收录歌曲", onDiscard: clear });
  useEffect(() => { discardGuard.current = guard; return () => { discardGuard.current = null; }; }, [discardGuard, guard]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLock(false); }; }, [onLock]);
  const parse = async () => {
    if (processing.current || locked) return;
    processing.current = true; setBusy(true); onLock(true); setError("");
    try {
      const [bands, members] = await Promise.all([
        getConsoleBands(undefined, 100), getCatalogConsole<{ items: CatalogMember[] }>("/members"),
      ]);
      const parsed = parseAlbumTrackText(text, bands.items, members.items);
      if (!mounted.current) return;
      setRows(parsed.rows); setWarnings(parsed.warnings);
      if (!parsed.rows.length) setError("未解析到任何歌曲行。");
    } catch (e) { if (mounted.current) setError(`解析失败：${String(e)}`); }
    finally { processing.current = false; if (mounted.current) { setBusy(false); onLock(false); } }
  };
  const renderPreviewTable = () => <div className="console-table-wrap setlist-full-preview-table-wrap">
    <table className="console-admin-table setlist-full-preview-table" aria-label="收录歌曲解析结果">
      <thead><tr><th>曲序</th><th>歌曲名称</th><th>标签</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>
        <td>{startOrder + index}</td><td>{row.song_name}</td><td>{row.tag || "—"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
  const closeDetails = () => { setDetailsOpen(false); onLock(false); };
  return <section className="setlist-paste-panel" aria-label="批量粘贴收录歌曲">
    <div className="setlist-paste-head">
      <div><h4>批量粘贴收录歌曲</h4><p>粘贴文本后先解析预览，确认无误再应用到下方表格。</p></div>
      <div className="setlist-paste-actions">
        <button type="button" className="console-ghost-btn" disabled={disabled} onClick={clear}>清空</button>
        <button type="button" className={text.trim() && !rows.length ? "console-submit-btn" : "console-ghost-btn"}
          disabled={disabled || !text.trim()} onClick={() => void parse()}>解析</button>
        <button type="button" className="console-submit-btn" disabled={disabled || !rows.length}
          onClick={() => { setConfirm(true); onLock(true); }}>应用到表格</button>
      </div>
    </div>
    <textarea className="setlist-paste-textarea" aria-label="批量粘贴收录歌曲文本" disabled={disabled}
      value={text} placeholder={"<Roselia>\n1. 歌曲名\n2. 歌曲名"}
      onChange={event => { setText(event.target.value); setRows([]); setWarnings([]); setError(""); }} />
    {busy && <p role="status">正在解析歌曲…</p>}
    {error && <p role="alert">{error}</p>}
    <ConsolePastePreview rows={rows.map((row, index) => ({ key: index,
      summary: `${index + 1}. ${row.song_name} / ${row.tag || "未选择"}` }))}
      warnings={warnings} disabled={disabled} onOpenDetails={() => { setDetailsOpen(true); onLock(true); }} />
    {dialog}
    {detailsOpen && <ConsolePastePreviewDetails title="完整收录歌曲解析预览" onClose={closeDetails}>
      {renderPreviewTable()}
      {warnings.length > 0 && <ul className="setlist-paste-warnings">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    </ConsolePastePreviewDetails>}
    {confirm && <ConsoleConfirmDialog title="确认应用到表格" size="wide" className="setlist-paste-confirm" confirmLabel="确认应用"
      onClose={() => { setConfirm(false); onLock(false); }}
      onConfirm={() => { onAppend(rows); clear(); setConfirm(false); onLock(false); }}>
      {renderPreviewTable()}
      {warnings.length > 0 && <ul className="setlist-paste-warnings">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    </ConsoleConfirmDialog>}
  </section>;
}
