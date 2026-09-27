import { useEffect, useId, useState } from "react";
import { getCatalogConsole, songCatalogWrite, type CatalogPage, type AlbumDetail, type AlbumDraft, type AlbumSummary, type AlbumTrackWrite, type ConsoleSongItem } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { ConsoleDateInput } from "./ConsoleDateInput";
import { UpdateDiffTable } from "./UpdateDiffTable";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { albumTitle } from "../../albumTitle";
import { ConsoleCandidatePager } from "./ConsoleChoiceSelect";
import { AlbumCover } from "../AlbumCover";
import { albumLinksError } from "../../albumLinks";

const emptyAlbum = (): AlbumDraft => ({ album_name: "", release_label: "", release_date: null, album_url: null, cover_urls: [], tracks: [] });
const coverSummary = (urls: string[]) => urls.map((url, i) => `${i + 1}${i === 0 ? "（默认）" : ""}. ${url}`).join("\n");
const numberTracks = (tracks: AlbumTrackWrite[]) => {
  const counts = new Map<string, number>();
  return tracks.map(track => {
    const section = track.section_name ?? "";
    const order = (counts.get(section) ?? 0) + 1;
    counts.set(section, order);
    return { ...track, section_name: section, track_order: order };
  });
};
export function AlbumAdminSection({ variant, active, registerLeaveGuard }: {
  variant: "create" | "edit";
  active: boolean;
  registerLeaveGuard: (guard: ((proceed: () => void) => void) | null) => void;
}) {
  const creating = variant === "create";
  const { csrfToken } = useAuth();
  const formId = useId();
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [original, setOriginal] = useState<AlbumDetail | null>(null);
  const [draft, setDraft] = useState(emptyAlbum);
  const [songPage, setSongPage] = useState(1);
  const [songResults, setSongResults] = useState<CatalogPage<ConsoleSongItem> | null>(null);
  const [songsLoading, setSongsLoading] = useState(false);
  const songs = songResults?.items ?? [];
  const [songQuery, setSongQuery] = useState("");
  const [selectedSong, setSelectedSong] = useState("");
  const [names, setNames] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [clearAfterCreate, setClearAfterCreate] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = busy || confirm;
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const fields = (album: AlbumDetail): AlbumDraft => ({ album_name: album.album_name, release_label: album.release_label,
    release_date: album.release_date, album_url: album.album_url, cover_urls: [...album.cover_urls],
    tracks: album.tracks.map(t => ({ album_track_id: t.album_track_id, song_id: t.song_id, track_order: t.track_order, edition_label: t.edition_label, section_name: t.section_name ?? "" })) });
  const dirty = JSON.stringify(draft) !== JSON.stringify(original ? fields(original) : emptyAlbum());
  const guard = (next: () => void) => { if (dirty) setDiscard(() => next); else next(); };
  const refresh = () => getCatalogConsole<{ items: AlbumSummary[] }>("/albums").then(result => setAlbums(result.items));
  useEffect(() => { setConfirm(false); setDiscard(null); }, [active]);
  useEffect(() => {
    if (!active || creating) return;
    registerLeaveGuard(guard);
    return () => registerLeaveGuard(null);
  }, [active, creating, dirty]); // The guard only reads whether the current draft is dirty.
  useEffect(() => {
    if (!active || creating) return;
    let current = true;
    void getCatalogConsole<{ items: AlbumSummary[] }>("/albums")
      .then(result => { if (current) setAlbums(result.items); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [active, creating]);
  useEffect(() => {
    if (!active || (!creating && !original)) return;
    let current = true;
    setSongsLoading(true); setSongResults(null);
    void getCatalogConsole<CatalogPage<ConsoleSongItem>>(`/songs?q=${encodeURIComponent(songQuery)}&page=${songPage}&limit=20`).then(result => {
      if (current) { setSongResults(result); setNames(value => ({ ...value, ...Object.fromEntries(result.items.map(s => [s.song_id, s.song_name])) })); }
    }).catch(e => { if (current) setError(String(e)); })
      .finally(() => { if (current) setSongsLoading(false); });
    return () => { current = false; };
  }, [active, creating, original?.album_id, songQuery, songPage]);
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
      const album = await songCatalogWrite<AlbumDetail>(creating ? "/albums" : `/albums/${original!.album_id}`, creating ? "POST" : "PUT",
        { ...draft, ...(!creating ? { expected_revision: original!.revision } : {}) }, csrfToken);
      if (creating) {
        setMessage(`已新增专辑 #${album.album_id} ${albumTitle(album)}`);
        if (clearAfterCreate) { setDraft(emptyAlbum()); setSelectedSong(""); }
      } else {
        setOriginal(album); setDraft(fields(album)); await refresh();
      }
      setConfirm(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const move = (index: number, direction: number) => {
    const tracks = [...draft.tracks];
    [tracks[index], tracks[index + direction]] = [tracks[index + direction], tracks[index]];
    setDraft({ ...draft, tracks: numberTracks(tracks) });
  };
  const moveCover = (index: number, target: number) => {
    const cover_urls = [...draft.cover_urls];
    cover_urls.splice(target, 0, ...cover_urls.splice(index, 1));
    setDraft({ ...draft, cover_urls });
  };
  const review = () => {
    const problem = albumLinksError(draft.album_url, draft.cover_urls);
    setError(problem);
    if (!problem) setConfirm(true);
  };
  const albumNameInput = <input aria-label="专辑名称" disabled={locked} value={draft.album_name} onChange={e => setDraft({ ...draft, album_name: e.target.value })} />;
  const releaseLabelInput = <input aria-label="发行标识" disabled={locked} value={draft.release_label} placeholder="10th single / best album" onChange={e => setDraft({ ...draft, release_label: e.target.value })} />;
  const albumUrlInput = <input aria-label="专辑页面" type="url" maxLength={2048} disabled={locked} value={draft.album_url ?? ""} placeholder="https://" onChange={e => setDraft({ ...draft, album_url: e.target.value || null })} />;
  const releaseDateField = <div className="album-release-date">
    <ConsoleDateInput aria-label="发售日期" disabled={locked} value={draft.release_date ?? ""} onChange={e => setDraft({ ...draft, release_date: e.target.value || null })} />
    <label className="live-clear-after-create-option"><input type="checkbox" disabled={locked} checked={draft.release_date === null}
      onChange={e => setDraft({ ...draft, release_date: e.target.checked ? null : "" })} />日期未知</label>
  </div>;
  const changes = [
    { field: "专辑", before: original?.album_name ?? "", after: draft.album_name },
    { field: "发行标识", before: original?.release_label ?? "", after: draft.release_label },
    { field: "日期", before: original?.release_date ?? "未知", after: draft.release_date ?? "未知" },
    { field: "专辑页面", before: original?.album_url ?? "", after: draft.album_url ?? "" },
    { field: "封面", before: coverSummary(original?.cover_urls ?? []), after: coverSummary(draft.cover_urls) },
    { field: "曲目", before: original?.tracks.map(t => `${t.section_name || ""} ${t.track_order}. ${t.song_name} ${t.edition_label}`).join(" / ") ?? "", after: draft.tracks.map(t => `${t.section_name || ""} ${t.track_order}. ${names[t.song_id] ?? t.song_id} ${t.edition_label}`).join(" / ") },
  ];
  if (!active) return null;
  return <section className="tour-admin-section" aria-label={creating ? "新增专辑" : "专辑管理"}>
    {error && <p role="alert">{error}</p>}
    {message && <p className="console-admin-hint" role="status">{message}</p>}
    {!creating && <div className="tour-admin-toolbar">
      <label className="live-management-label" htmlFor={`${formId}-album`}>已有专辑</label>
      <select id={`${formId}-album`} className="console-entity-select" value={original?.album_id ?? ""} disabled={locked}
        onChange={e => { const id = Number(e.target.value); if (id) guard(() => void load(id)); }}>
        <option value="">请选择</option>{albums.map(a => <option key={a.album_id} value={a.album_id}>{albumTitle(a)}</option>)}</select>
    </div>}
    {(creating || original) && <>
    {!creating ? <fieldset disabled={locked} className="tour-admin-fields tour-band-field">
      <label>专辑名称{albumNameInput}</label>
      <label>发行标识{releaseLabelInput}</label>
      <fieldset className="tour-band-field"><legend>发售日期</legend>{releaseDateField}</fieldset>
      <label>专辑页面{albumUrlInput}</label>
    </fieldset> : <div className="console-table-wrap">
      <table className="console-admin-table album-create-form-table" aria-label="新增专辑资料">
        <colgroup><col /><col /><col className="album-create-date-column" /><col /></colgroup>
        <thead><tr><th scope="col">专辑名称</th><th scope="col">发行标识</th><th scope="col">发售日期</th><th scope="col">专辑页面</th></tr></thead>
        <tbody><tr><td>{albumNameInput}</td><td>{releaseLabelInput}</td><td>{releaseDateField}</td><td>{albumUrlInput}</td></tr></tbody>
      </table>
    </div>}
    <div>
      <div className="tour-admin-toolbar"><button type="button" className="console-ghost-btn" disabled={locked || draft.cover_urls.length >= 20}
        onClick={() => setDraft({ ...draft, cover_urls: [...draft.cover_urls, ""] })}>添加封面</button></div>
      {draft.cover_urls.length > 0 && <div className="console-table-wrap setlist-input-wrap"><table className="console-admin-table album-cover-editor" aria-label="专辑封面">
        <colgroup><col className="album-cover-preview-column" /><col /><col className="album-cover-actions-column" /></colgroup>
        <thead><tr><th scope="col">预览</th><th scope="col">封面 URL</th><th scope="col">操作</th></tr></thead><tbody>
      {draft.cover_urls.map((url, index) => <tr key={index}>
        <td>{url.trim() && <AlbumCover url={url} alt={`封面 ${index + 1} 预览`} />}</td>
        <td><input type="url" maxLength={2048} disabled={locked} aria-label={`第 ${index + 1} 张封面 URL`} value={url} placeholder="https://" onChange={e => setDraft({ ...draft, cover_urls: draft.cover_urls.map((value, i) => i === index ? e.target.value : value) })} /></td>
        <td><div className="tour-admin-toolbar venue-create-actions">
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => moveCover(index, index - 1)}>上移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === draft.cover_urls.length - 1} onClick={() => moveCover(index, index + 1)}>下移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => moveCover(index, 0)}>{index === 0 ? "默认" : "设为默认"}</button>
          <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => setDraft({ ...draft, cover_urls: draft.cover_urls.filter((_, i) => i !== index) })}>移除</button>
        </div></td>
      </tr>)}
    </tbody></table></div>}
    </div>
    <div>
      <div className="tour-admin-toolbar live-admin-toolbar">
        <label className="live-management-label" htmlFor={`${formId}-song-select`}>收录歌曲</label>
        <input id={`${formId}-song-query`} className="venue-query-input live-management-primary-control" disabled={locked}
          aria-label="搜索收录歌曲" placeholder="歌曲名称" value={songQuery} onChange={e => { setSongQuery(e.target.value); setSongPage(1); setSelectedSong(""); }} />
        <select id={`${formId}-song-select`} className="console-entity-select" disabled={locked || songsLoading} aria-label="收录歌曲" value={selectedSong} onChange={e => setSelectedSong(e.target.value)}><option value="">请选择歌曲版本</option>{selectedSong && !songs.some(s => s.song_id === Number(selectedSong)) && <option value={selectedSong}>#{selectedSong} {names[Number(selectedSong)]}</option>}{songs.map(s => <option value={s.song_id} key={s.song_id}>#{s.song_id} {s.song_name} / {s.version_label || "默认版本"} / {s.band_name ?? "待回填"}</option>)}</select>
        <button type="button" className="console-ghost-btn" disabled={!selectedSong || locked} onClick={() => setDraft({ ...draft, tracks: numberTracks([...draft.tracks, { song_id: Number(selectedSong), track_order: 1, edition_label: "", section_name: draft.tracks[draft.tracks.length - 1]?.section_name ?? "" }]) })}>添加收录</button>
        <ConsoleCandidatePager page={songPage} totalPages={songResults?.total_pages ?? songPage} total={songResults?.total ?? 0}
          loading={songsLoading} onPage={setSongPage} />
      </div>
      <div className="console-table-wrap"><table className="console-admin-table album-track-editor" aria-label="专辑收录曲目">
        <colgroup><col className="album-track-section-column" /><col className="album-track-order-column" /><col /><col className="album-track-edition-column" /><col className="album-track-actions-column" /></colgroup>
        <thead><tr><th scope="col">碟号／发行版</th><th scope="col">曲序</th><th scope="col">歌曲</th><th scope="col">收录标识</th><th scope="col">操作</th></tr></thead><tbody>
      {draft.tracks.map((track, index) => <tr key={index}><td><input disabled={locked} aria-label={`第 ${index + 1} 曲碟号／发行版`} value={track.section_name ?? ""} onChange={e => setDraft({ ...draft, tracks: numberTracks(draft.tracks.map((t, i) => i === index ? { ...t, section_name: e.target.value } : t)) })} /></td><td>{track.track_order}</td><td>#{track.song_id} {names[track.song_id]}</td><td><input disabled={locked} aria-label={`第 ${index + 1} 曲收录标识`} placeholder="Instrumental" value={track.edition_label} onChange={e => setDraft({ ...draft, tracks: draft.tracks.map((t, i) => i === index ? { ...t, edition_label: e.target.value } : t) })} /></td>
        <td><div className="tour-admin-toolbar venue-create-actions">
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => move(index, -1)}>上移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === draft.tracks.length - 1} onClick={() => move(index, 1)}>下移</button>
          <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => setDraft({ ...draft, tracks: numberTracks(draft.tracks.filter((_, i) => i !== index)) })}>移除</button>
        </div></td></tr>)}
    </tbody></table></div>
      <div className="console-submit-row venue-create-actions">
        {creating && <label className="live-clear-after-create-option"><input type="checkbox" disabled={locked}
          checked={clearAfterCreate} onChange={e => setClearAfterCreate(e.target.checked)} />新增后清空数据</label>}
        <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => { setDraft(creating ? emptyAlbum() : fields(original!)); setError(""); setMessage(""); }}>{creating ? "清空数据" : "恢复原值"}</button>
        <button type="button" className="console-submit-btn" disabled={locked || !dirty || !draft.album_name.trim() || draft.release_date === ""} onClick={review}>{creating ? "提交插入" : "保存修改"}</button>
      </div>
    </div>
    </>}
    {(confirm || discard) && <div className="modal-mask"><div className="modal compact console-confirm-modal" role="dialog" aria-modal="true" aria-label={discard ? "放弃专辑修改" : creating ? "确认新增专辑" : "确认修改专辑"}>
      <div className="modal-head"><h2>{discard ? "放弃专辑修改" : creating ? "确认新增专辑" : "确认修改专辑"}</h2></div>
      {!discard && <div className="console-confirm-body">
        {error && <p role="alert">{error}</p>}
        {creating ? <CompactConfirmationTable rows={changes.map(({ field, after }) => [field, after] as const)} /> : <UpdateDiffTable changes={changes} />}
      </div>}
      <div className="console-confirm-actions">
        <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => { setConfirm(false); setDiscard(null); }}>取消</button>
        <button type="button" className="console-submit-btn" disabled={busy} onClick={() => {
          if (discard) { setDraft(original ? fields(original) : emptyAlbum()); discard(); setDiscard(null); } else void save();
        }}>确认</button>
      </div>
    </div></div>}
  </section>;
}
