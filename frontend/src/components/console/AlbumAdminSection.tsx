import { useEffect, useState } from "react";
import { getCatalogConsole, songCatalogWrite, type AlbumDetail, type AlbumDraft, type AlbumSummary, type ConsoleSongItem } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { ConsoleDateInput } from "./ConsoleDateInput";
import { UpdateDiffTable } from "./UpdateDiffTable";

const emptyAlbum = (): AlbumDraft => ({ album_name: "", release_label: "", release_date: null, cover_path: null, tracks: [] });
export function AlbumAdminSection() {
  const { csrfToken } = useAuth();
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [original, setOriginal] = useState<AlbumDetail | null>(null);
  const [draft, setDraft] = useState(emptyAlbum);
  const [songs, setSongs] = useState<ConsoleSongItem[]>([]);
  const [songQuery, setSongQuery] = useState("");
  const [selectedSong, setSelectedSong] = useState("");
  const [names, setNames] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = busy || confirm;
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const fields = (album: AlbumDetail): AlbumDraft => ({ album_name: album.album_name, release_label: album.release_label,
    release_date: album.release_date, cover_path: album.cover_path,
    tracks: album.tracks.map(t => ({ album_track_id: t.album_track_id, song_id: t.song_id, track_order: t.track_order, edition_label: t.edition_label })) });
  const dirty = JSON.stringify(draft) !== JSON.stringify(original ? fields(original) : emptyAlbum());
  const guard = (next: () => void) => { if (dirty) setDiscard(() => next); else next(); };
  const refresh = () => getCatalogConsole<{ items: AlbumSummary[] }>("/albums").then(result => setAlbums(result.items));
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  useEffect(() => {
    let current = true;
    void getCatalogConsole<{ items: ConsoleSongItem[] }>(`/songs?q=${encodeURIComponent(songQuery)}&limit=100`).then(result => {
      if (current) { setSongs(result.items); setNames(value => ({ ...value, ...Object.fromEntries(result.items.map(s => [s.song_id, s.song_name])) })); }
    }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [songQuery]);
  const load = async (id: number) => {
    setBusy(true); setError("");
    try {
      const album = await getCatalogConsole<AlbumDetail>(`/albums/${id}`);
      setOriginal(album); setDraft(fields(album));
      setNames(value => ({ ...value, ...Object.fromEntries(album.tracks.map(t => [t.song_id, t.song_name])) }));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!csrfToken) return;
    setBusy(true); setError("");
    try {
      const album = await songCatalogWrite<AlbumDetail>(original ? `/albums/${original.album_id}` : "/albums", original ? "PUT" : "POST",
        { ...draft, ...(original ? { expected_revision: original.revision } : {}) }, csrfToken);
      setOriginal(album); setDraft(fields(album)); setConfirm(false); await refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const move = (index: number, direction: number) => {
    const tracks = [...draft.tracks];
    [tracks[index], tracks[index + direction]] = [tracks[index + direction], tracks[index]];
    setDraft({ ...draft, tracks: tracks.map((track, i) => ({ ...track, track_order: i + 1 })) });
  };
  return <section className="tour-admin-section" aria-label="专辑管理">
    {error && <p role="alert">{error}</p>}
    <div className="tour-admin-toolbar">
      <label>已有专辑<select value={original?.album_id ?? ""} disabled={locked} onChange={e => { if (e.target.value) guard(() => void load(Number(e.target.value))); }}>
        <option value="">请选择</option>{albums.map(a => <option key={a.album_id} value={a.album_id}>{a.album_name} / {a.release_label}</option>)}</select></label>
      <button disabled={locked} onClick={() => guard(() => { setOriginal(null); setDraft(emptyAlbum()); })}>新建专辑</button>
    </div>
    <fieldset disabled={locked} className="tour-admin-fields">
      <label>专辑名称<input value={draft.album_name} onChange={e => setDraft({ ...draft, album_name: e.target.value })} /></label>
      <label>发行标识<input value={draft.release_label} placeholder="10th single / best album" onChange={e => setDraft({ ...draft, release_label: e.target.value })} /></label>
      <label>发售日期<ConsoleDateInput value={draft.release_date ?? ""} onChange={e => setDraft({ ...draft, release_date: e.target.value || null })} /></label>
      <label><input type="checkbox" checked={draft.release_date === null} onChange={e => setDraft({ ...draft, release_date: e.target.checked ? null : "" })} />日期未知</label>
      <label>封面文件<input value={draft.cover_path ?? ""} placeholder="/album-covers/album.webp" onChange={e => setDraft({ ...draft, cover_path: e.target.value || null })} /></label>
    </fieldset>
    <div className="tour-admin-toolbar"><input disabled={locked} aria-label="搜索收录歌曲" placeholder="歌曲名称" value={songQuery} onChange={e => { setSongQuery(e.target.value); setSelectedSong(""); }} />
      <select disabled={locked} aria-label="收录歌曲" value={selectedSong} onChange={e => setSelectedSong(e.target.value)}><option value="">请选择歌曲版本</option>{songs.map(s => <option value={s.song_id} key={s.song_id}>#{s.song_id} {s.song_name} / {s.version_label || "默认版本"} / {s.band_name ?? "待回填"}</option>)}</select>
      <button disabled={!selectedSong || locked} onClick={() => setDraft({ ...draft, tracks: [...draft.tracks, { song_id: Number(selectedSong), track_order: draft.tracks.length + 1, edition_label: "" }] })}>添加收录</button>
    </div>
    <div className="console-table-wrap"><table className="console-admin-table"><thead><tr><th>曲序</th><th>歌曲</th><th>收录标识</th><th>操作</th></tr></thead><tbody>
      {draft.tracks.map((track, index) => <tr key={index}><td>{track.track_order}</td><td>#{track.song_id} {names[track.song_id]}</td><td><input disabled={locked} aria-label={`第 ${index + 1} 曲收录标识`} placeholder="Instrumental" value={track.edition_label} onChange={e => setDraft({ ...draft, tracks: draft.tracks.map((t, i) => i === index ? { ...t, edition_label: e.target.value } : t) })} /></td>
        <td><button disabled={locked || index === 0} onClick={() => move(index, -1)}>上移</button><button disabled={locked || index === draft.tracks.length - 1} onClick={() => move(index, 1)}>下移</button><button disabled={locked} onClick={() => setDraft({ ...draft, tracks: draft.tracks.filter((_, i) => i !== index).map((t, i) => ({ ...t, track_order: i + 1 })) })}>移除</button></td></tr>)}
    </tbody></table></div>
    <div className="console-submit-row"><button disabled={locked} onClick={() => setDraft(original ? fields(original) : emptyAlbum())}>{original ? "恢复原值" : "清空数据"}</button><button disabled={locked || !dirty || !draft.album_name.trim() || draft.release_date === ""} onClick={() => setConfirm(true)}>{original ? "保存修改" : "提交插入"}</button></div>
    {(confirm || discard) && <div className="modal-mask"><div className="modal compact console-confirm-modal" role="dialog" aria-modal="true" aria-label={discard ? "放弃专辑修改" : "确认保存专辑"}>
      <h2>{discard ? "放弃专辑修改" : "确认保存专辑"}</h2>
      {error && <p role="alert">{error}</p>}
      {!discard && <UpdateDiffTable changes={[
        { field: "专辑", before: original?.album_name ?? "", after: draft.album_name },
        { field: "发行标识", before: original?.release_label ?? "", after: draft.release_label },
        { field: "日期", before: original?.release_date ?? "未知", after: draft.release_date ?? "未知" },
        { field: "封面", before: original?.cover_path ?? "", after: draft.cover_path ?? "" },
        { field: "曲目", before: original?.tracks.map(t => `${t.track_order}. ${t.song_name} ${t.edition_label}`).join(" / ") ?? "", after: draft.tracks.map(t => `${t.track_order}. ${names[t.song_id] ?? t.song_id} ${t.edition_label}`).join(" / ") },
      ]} />}
      <div className="console-confirm-actions"><button disabled={busy} onClick={() => { setConfirm(false); setDiscard(null); }}>取消</button><button disabled={busy} onClick={() => { if (discard) { discard(); setDiscard(null); } else void save(); }}>确认</button></div>
    </div></div>}
  </section>;
}
