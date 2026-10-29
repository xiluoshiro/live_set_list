import { ConsoleEditorLock } from "./ConsoleEditorLock";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";
import { useConsoleDraftGuard } from "./ConsoleDraftGuard";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { getCatalogConsole, songCatalogWrite, type CatalogPage, type AlbumDetail, type AlbumDraft, type AlbumSummary, type AlbumTrackWrite, type ConsoleSongItem } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { albumTitle } from "../../albumTitle";
import { ConsoleCandidatePager } from "./ConsoleChoiceSelect";
import { ConsoleEditSelect, resolveConsoleEditSelection } from "./ConsoleEditSelect";
import { CoverEditor } from "./CoverEditor";
import { coverChanges } from "./confirmationFields";
import { albumLinksError, coverPayload, filledCovers } from "../../albumLinks";
import { getTodayDateInputValue } from "./helpers";
import { AlbumTrackCreateEditor } from "./AlbumTrackCreateEditor";
import { albumSongLabel as songLabel } from "./albumTracks";

const emptyAlbum = (): AlbumDraft => ({ album_name: "", release_label: "", release_date: getTodayDateInputValue(), album_url: null, cover_urls: [{ url: "", name: "" }], tracks: [] });
const albumPayload = (draft: AlbumDraft): AlbumDraft => ({ ...draft, cover_urls: coverPayload(draft.cover_urls) });
const fields = (album: AlbumDetail): AlbumDraft => ({
  album_name: album.album_name, release_label: album.release_label, release_date: album.release_date,
  album_url: album.album_url, cover_urls: album.cover_urls.length ? [...album.cover_urls] : [{ url: "", name: "" }],
  tracks: album.tracks.map(t => ({ album_track_id: t.album_track_id, song_id: t.song_id, track_order: t.track_order,
    edition_label: t.edition_label, section_name: t.section_name ?? "" })),
});
type HistoryEntry = { album: AlbumDetail; action: "create" | "update" };
const numberTracks = (tracks: AlbumTrackWrite[]) => {
  const counts = new Map<string, number>();
  return tracks.map(track => {
    const section = track.section_name ?? "";
    const order = (counts.get(section) ?? 0) + 1;
    counts.set(section, order);
    return { ...track, section_name: section, track_order: order };
  });
};
export function AlbumAdminSection({ variant, active, registerLeaveGuard, onManage, onMessage }: {
  variant: "create" | "edit";
  active: boolean;
  registerLeaveGuard: (guard: ((proceed: () => void) => void) | null) => void;
  onManage: () => void;
  onMessage: (message: string) => void;
}) {
  const creating = variant === "create";
  const { csrfToken } = useAuth();
  const formId = useId();
  const [albumResults, setAlbumResults] = useState<CatalogPage<AlbumSummary> | null>(null);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState("");
  const [albumQuery, setAlbumQuery] = useState("");
  const [albumSearch, setAlbumSearch] = useState({ query: "", page: 1, refresh: 0, selectFirst: false });
  const selectedSearch = useRef<typeof albumSearch | null>(null);
  const albums = albumResults?.items ?? [];
  const [original, setOriginal] = useState<AlbumDetail | null>(null);
  const [createDraft, setCreateDraft] = useState(emptyAlbum);
  const [editDraft, setEditDraft] = useState(emptyAlbum);
  const draft = creating ? createDraft : editDraft;
  const setDraft = creating ? setCreateDraft : setEditDraft;
  const [songResults, setSongResults] = useState<ConsoleSongItem[] | null>(null);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songsError, setSongsError] = useState("");
  const songs = songResults ?? [];
  const [songQuery, setSongQuery] = useState("");
  const [songSearch, setSongSearch] = useState({ query: "", refresh: 0 });
  const [selectedSong, setSelectedSong] = useState("");
  const [songLabels, setSongLabels] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [tracksReady, setTracksReady] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batchLocked, setBatchLocked] = useState(false);
  const [batchReset, setBatchReset] = useState(0);
  const updateCreateTracks = useCallback((tracks: AlbumTrackWrite[], songs: ConsoleSongItem[], ready: boolean) => {
    setCreateDraft(current => ({ ...current, tracks }));
    setSongLabels(current => ({ ...current, ...Object.fromEntries(songs.map(song => [song.song_id, songLabel(song)])) }));
    setTracksReady(ready);
  }, []);
  const batchDiscardGuard = useRef<((proceed: () => void) => void) | null>(null);
  const [loadingAlbum, setLoadingAlbum] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const loadGeneration = useRef(0);
  const locked = busy || confirm || batchLocked || (!creating && albumsLoading);
  const payload = albumPayload(draft);
  const dirty = JSON.stringify(payload) !== JSON.stringify(albumPayload(!creating && original ? fields(original) : emptyAlbum()));
  const { guard, dialog: discardDialog } = useConsoleDraftGuard({ active, dirty: !creating && !!original && dirty, busy: busy || confirm,
    label: `专辑 #${original?.album_id}`, onDiscard: () => { if (original) setEditDraft(fields(original)); } });
  const closeConfirmation = () => { if (!busy) setConfirm(false); };
  const queryAlbums = () => { if (!locked) setAlbumSearch(value => ({ query: albumQuery.trim(), page: 1, refresh: value.refresh + 1, selectFirst: !!albumQuery.trim() })); };
  const querySongs = () => {
    setSelectedSong("");
    setSongSearch(value => ({ query: songQuery.trim(), refresh: value.refresh + 1 }));
  };
  useEffect(() => { setConfirm(false); setError(""); }, [active, creating]);
  useEffect(() => {
    if (!active || creating) return;
    registerLeaveGuard(guard);
    return () => registerLeaveGuard(null);
  }, [active, creating, dirty]); // The guard only reads whether the current draft is dirty.
  useEffect(() => {
    if (!active || creating) return;
    let current = true;
    const selectionGeneration = loadGeneration.current;
    setAlbumsLoading(true); setAlbumsError(""); setAlbumResults(null);
    void getCatalogConsole<CatalogPage<AlbumSummary>>(`/albums?q=${encodeURIComponent(albumSearch.query)}&page=${albumSearch.page}&limit=20`)
      .then(result => {
        if (!current) return;
        setAlbumResults(result);
        if (selectedSearch.current !== albumSearch) {
          const manuallyOpened = selectedSearch.current === null && selectionGeneration > 0;
          selectedSearch.current = albumSearch;
          const nextId = resolveConsoleEditSelection(result.items, album => album.album_id, original?.album_id ?? null,
            albumSearch.selectFirst ? "query" : "preserve");
          if (albumSearch.selectFirst && !manuallyOpened && selectionGeneration === loadGeneration.current) {
            if (nextId === null) guard(() => { setOriginal(null); setEditDraft(emptyAlbum()); setSelectedSong(""); setError(""); });
            else if (nextId !== original?.album_id) guard(() => void load(nextId));
          }
        }
      })
      .catch(e => { if (current) setAlbumsError(String(e)); })
      .finally(() => { if (current) setAlbumsLoading(false); });
    return () => { current = false; };
  }, [active, creating, albumSearch]);
  useEffect(() => {
    if (!active || creating || !original) return;
    let current = true;
    setSongsLoading(true); setSongsError(""); setSongResults(null);
    const loadSongs = async () => {
      const items: ConsoleSongItem[] = [];
      let totalPages = 1;
      for (let page = 1; current && page <= totalPages; page += 1) {
        const result = await getCatalogConsole<CatalogPage<ConsoleSongItem>>(`/songs?q=${encodeURIComponent(songSearch.query)}&page=${page}&limit=100`);
        items.push(...result.items);
        totalPages = result.total_pages ?? 1;
      }
      if (current) { setSongResults(items); setSongLabels(value => ({ ...value, ...Object.fromEntries(items.map(s => [s.song_id, songLabel(s)])) })); }
    };
    void loadSongs().catch(e => { if (current) setSongsError(String(e)); })
      .finally(() => { if (current) setSongsLoading(false); });
    return () => { current = false; };
  }, [active, creating, original?.album_id, songSearch]);
  const load = async (id: number) => {
    const generation = ++loadGeneration.current;
    setBusy(true); setLoadingAlbum(true); setError("");
    try {
      const album = await getCatalogConsole<AlbumDetail>(`/albums/${id}`);
      if (generation !== loadGeneration.current) return;
      setOriginal(album); setEditDraft(fields(album)); setSelectedSong("");
      setSongLabels(value => ({ ...value, ...Object.fromEntries(album.tracks.map(t => [t.song_id, songLabel(t)])) }));
    } catch (e) { if (generation === loadGeneration.current) setError(String(e)); }
    finally { if (generation === loadGeneration.current) { setBusy(false); setLoadingAlbum(false); } }
  };
  const save = async () => {
    if (!csrfToken) return;
    setBusy(true); setError("");
    try {
      const album = await songCatalogWrite<AlbumDetail>(creating ? "/albums" : `/albums/${original!.album_id}`, creating ? "POST" : "PUT",
        { ...payload, ...(!creating ? { expected_revision: original!.revision } : {}) }, csrfToken);
      setHistory(value => [...value, { album, action: creating ? "create" : "update" }]);
      onMessage(`已${creating ? "新增" : "更新"}专辑 #${album.album_id} ${albumTitle(album)}`);
      if (creating) {
        setCreateDraft(emptyAlbum()); setSelectedSong(""); setBatchReset(value => value + 1);
      } else {
        setOriginal(album); setEditDraft(fields(album));
      }
      setConfirm(false);
      setAlbumSearch(value => ({ ...value, refresh: value.refresh + 1, selectFirst: creating ? value.selectFirst : false }));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const move = (index: number, direction: number) => {
    const tracks = [...draft.tracks];
    [tracks[index], tracks[index + direction]] = [tracks[index + direction], tracks[index]];
    setDraft({ ...draft, tracks: numberTracks(tracks) });
  };
  const review = () => {
    const problem = albumLinksError(draft.album_url, filledCovers(draft.cover_urls));
    setError(problem);
    if (!problem) {
      if (creating && batchDiscardGuard.current) batchDiscardGuard.current(() => setConfirm(true));
      else setConfirm(true);
    }
  };
  const visibleHistory = history.filter(entry => entry.action === (creating ? "create" : "update"));
  const originalTracks = creating ? [] : original?.tracks ?? [];
  const submitButton = <button type="button" className="console-submit-btn"
    disabled={locked || !dirty || !draft.album_name.trim() || draft.release_date === "" || (creating && !tracksReady)}
    onClick={review}>{creating ? "提交插入" : "保存修改"}</button>;
  const albumNameInput = <input aria-label="专辑名称" placeholder="请输入专辑名称" disabled={locked} value={draft.album_name} onChange={e => setDraft({ ...draft, album_name: e.target.value })} />;
  const releaseLabelInput = <input aria-label="发行标识" disabled={locked} value={draft.release_label} placeholder="10th single / best album" onChange={e => setDraft({ ...draft, release_label: e.target.value })} />;
  const albumUrlInput = <input aria-label="专辑页面" type="url" maxLength={2048} disabled={locked} value={draft.album_url ?? ""} placeholder="https://" onChange={e => setDraft({ ...draft, album_url: e.target.value || null })} />;
  const releaseDateField = <div className="album-release-date">
    <input type="date" aria-label="发售日期" disabled={locked} value={draft.release_date ?? ""} onChange={e => setDraft({ ...draft, release_date: e.target.value || null })} />
    <label className="live-clear-after-create-option"><input type="checkbox" disabled={locked} checked={draft.release_date === null}
      onChange={e => setDraft({ ...draft, release_date: e.target.checked ? null : "" })} />日期未知</label>
  </div>;
  const changes = [
    { field: "专辑", before: original?.album_name ?? "", after: draft.album_name },
    { field: "发行标识", before: original?.release_label ?? "", after: draft.release_label },
    { field: "日期", before: original?.release_date ?? "未知", after: draft.release_date ?? "未知" },
    { field: "专辑页面", before: original?.album_url ?? "", after: draft.album_url ?? "" },
    ...coverChanges(original?.cover_urls ?? [], payload.cover_urls),
    ...Array.from({ length: Math.max(originalTracks.length, draft.tracks.length) }, (_, index) => {
      const before = originalTracks[index], after = draft.tracks[index];
      const prefix = `曲目 ${index + 1}`;
      return [
        { field: `${prefix} 歌曲`, before: before ? songLabel(before) : "", after: after ? before?.song_id === after.song_id ? songLabel(before) : songLabels[after.song_id] ?? `#${after.song_id}` : "" },
        { field: `${prefix} 碟号/发行版`, before: before?.section_name ?? "", after: after?.section_name ?? "" },
        { field: `${prefix} 曲序`, before: before ? String(before.track_order) : "", after: after ? String(after.track_order) : "" },
        { field: `${prefix} 器乐`, before: before ? before.edition_label || "否" : "", after: after ? after.edition_label || "否" : "" },
      ].map(change => ({ ...change, table: { source: "曲目", row: String(index + 1), column: change.field.slice(prefix.length + 1) } }));
    }).flat(),
  ];
  if (!active) return null;
  return <section className="tour-admin-section" aria-label={creating ? "新增专辑" : "专辑管理"}>
    <ConsoleEditorLock locked={locked}>
    {error && !confirm && <p role="alert">{error}</p>}
    {!creating && <div>
    <div className="tour-admin-toolbar live-admin-toolbar venue-admin-toolbar" role="search" aria-label="查询专辑">
      <label className="live-management-label" htmlFor={`${formId}-album`}>已有专辑</label>
      <input id={`${formId}-album-query`} className="venue-query-input live-management-primary-control" aria-label="搜索专辑"
        placeholder="输入专辑 ID、名称或发行标识" value={albumQuery} disabled={locked}
        onChange={e => setAlbumQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") queryAlbums(); }} />
      <button type="button" className="console-ghost-btn" disabled={locked || albumsLoading} onClick={queryAlbums}>查询</button>
      <ConsoleEditSelect id={`${formId}-album`} label="已有专辑" placeholder="选择要编辑的专辑"
        value={original?.album_id ?? null} disabled={locked || !albums.length}
        selectedOption={original ? { id: original.album_id, label: `#${original.album_id} ${albumTitle(original)}` } : undefined}
        options={albums.map(album => ({ id: album.album_id, label: `#${album.album_id} ${albumTitle(album)}` }))}
        onSelect={id => guard(() => void load(id))} />
      <ConsoleCandidatePager page={albumResults?.page ?? albumSearch.page} totalPages={albumResults?.total_pages ?? 1}
        total={albumResults?.total ?? 0} loading={albumsLoading} disabled={locked || !albumResults}
        onPage={page => setAlbumSearch(value => ({ ...value, page, selectFirst: false }))} />
    </div>
    {albumsError && <p role="alert">专辑查询失败：{albumsError}</p>}
    {!albumsLoading && albumResults && !albums.length && <p className="console-admin-hint" role="status">没有匹配的专辑。</p>}
    {!original && !loadingAlbum && <p className="console-admin-hint">请先选择要编辑的专辑。</p>}
    {loadingAlbum && <p className="console-admin-hint" role="status">正在加载专辑…</p>}
    </div>}
    {(creating || original) && <>
    <div className="console-table-wrap">
      <table className="console-admin-table album-form-table" aria-label={creating ? "新增专辑资料" : "专辑资料"}>
        <colgroup>
          {!creating && <col className="album-id-column" />}
          <col className="album-name-column" /><col /><col className="album-date-column" /><col className="album-url-column" />
        </colgroup>
        <thead><tr>
          {!creating && <th scope="col">album_id</th>}
          <th scope="col">专辑名称</th><th scope="col">发行标识</th><th scope="col">发售日期</th><th scope="col">专辑页面</th>
        </tr></thead>
        <tbody><tr>
          {!creating && <td><span className="readonly-cell">{original!.album_id}</span></td>}
          <td>{albumNameInput}</td><td>{releaseLabelInput}</td><td>{releaseDateField}</td><td>{albumUrlInput}</td>
        </tr></tbody>
      </table>
    </div>
    <CoverEditor title="专辑封面" covers={draft.cover_urls} locked={locked}
      onChange={cover_urls => setDraft({ ...draft, cover_urls })} />
    <section aria-label="收录曲目">
    {creating ? <AlbumTrackCreateEditor key={batchReset} locked={busy || confirm} csrfToken={csrfToken}
      onChange={updateCreateTracks} onLock={setBatchLocked} discardGuard={batchDiscardGuard} submitButton={submitButton} /> : <>
      <div className="tour-admin-toolbar live-admin-toolbar venue-admin-toolbar" role="search" aria-label="查询收录歌曲">
        <label className="live-management-label" htmlFor={`${formId}-song-select`}>收录歌曲</label>
        <input id={`${formId}-song-query`} className="venue-query-input live-management-primary-control" disabled={locked}
          aria-label="搜索收录歌曲" placeholder="歌曲名称" value={songQuery} onChange={e => setSongQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") querySongs(); }} />
        <button type="button" className="console-ghost-btn" disabled={locked || songsLoading} onClick={querySongs}>查询</button>
        <select id={`${formId}-song-select`} disabled={locked || songsLoading || (!songs.length && !selectedSong)} aria-label="收录歌曲" value={selectedSong} onChange={e => setSelectedSong(e.target.value)}>
          <option value="">{songsLoading ? "加载中…" : "请选择歌曲版本"}</option>
          {selectedSong && !songs.some(s => s.song_id === Number(selectedSong)) && <option value={selectedSong}>{songLabels[Number(selectedSong)]}</option>}
          {songs.map(s => <option value={s.song_id} key={s.song_id}>{songLabel(s)}</option>)}
        </select>
        <button type="button" className="console-submit-btn" disabled={!selectedSong || locked || songsLoading} onClick={() => setDraft({ ...draft, tracks: numberTracks([...draft.tracks, { song_id: Number(selectedSong), track_order: 1, edition_label: "", section_name: draft.tracks[draft.tracks.length - 1]?.section_name ?? "" }]) })}>添加收录</button>
      </div>
      {songsError && <p role="alert">歌曲查询失败：{songsError}</p>}
      {!songsLoading && songResults && !songs.length && <p className="console-admin-hint" role="status">没有匹配的歌曲。</p>}
      <div className="console-table-wrap"><table className="console-admin-table album-track-editor" aria-label="专辑收录曲目">
        <colgroup><col className="album-track-section-column" /><col className="album-track-order-column" /><col /><col className="album-track-edition-column" /><col className="album-track-actions-column" /></colgroup>
        <thead><tr><th scope="col">碟号/发行版</th><th scope="col">曲序</th><th scope="col">歌曲</th><th scope="col">器乐</th><th scope="col">操作</th></tr></thead><tbody>
      {!draft.tracks.length && <tr><td colSpan={5} className="empty-cell">暂无收录曲目</td></tr>}
      {draft.tracks.map((track, index) => <tr key={index}><td><input disabled={locked} aria-label={`第 ${index + 1} 曲碟号/发行版`} placeholder="Disc1/限定版" value={track.section_name ?? ""} onChange={e => setDraft({ ...draft, tracks: numberTracks(draft.tracks.map((t, i) => i === index ? { ...t, section_name: e.target.value } : t)) })} /></td><td>{track.track_order}</td><td>{songLabels[track.song_id] ?? `#${track.song_id}`}</td><td>
        <input className="is-short-check" type="checkbox" disabled={locked} aria-label={`第 ${index + 1} 曲器乐`}
          checked={track.edition_label === "Instrumental"}
          onChange={e => setDraft({ ...draft, tracks: draft.tracks.map((t, i) => i === index ? { ...t, edition_label: e.target.checked ? "Instrumental" : "" } : t) })} />
      </td>
        <td><div className="tour-admin-toolbar venue-create-actions">
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => move(index, -1)}>上移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === draft.tracks.length - 1} onClick={() => move(index, 1)}>下移</button>
          <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => setDraft({ ...draft, tracks: numberTracks(draft.tracks.filter((_, i) => i !== index)) })}>移除</button>
        </div></td></tr>)}
    </tbody></table></div>
    </>}
    </section>
      {!creating && <div className="console-submit-row live-admin-insert-row venue-create-actions">
        <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => {
          setEditDraft(fields(original!)); setSelectedSong(""); setError(""); onMessage("");
        }}>恢复原值</button>
        {submitButton}
      </div>}
    {!creating && dirty && <p className="console-admin-hint" role="status">专辑 #{original!.album_id} 有未保存修改</p>}
    </>}
    <div className="console-table-wrap live-history-wrap">
      <table className="console-admin-table live-history-table" aria-label="专辑操作记录">
        <thead><tr><th>album_id</th><th>专辑</th><th>发售日期</th><th>曲目数</th><th>操作</th></tr></thead>
        <tbody>{!visibleHistory.length ? <tr><td colSpan={5} className="empty-cell">暂无专辑{creating ? "新增" : "更新"}记录</td></tr>
          : visibleHistory.map((entry, index) => <tr key={index}>
            <td>{entry.album.album_id}</td><td>{albumTitle(entry.album)}</td><td>{entry.album.release_date ?? "未知"}</td><td>{entry.album.tracks.length}</td>
            <td><button type="button" className="console-ghost-btn" disabled={locked} onClick={() => guard(() => { onManage(); void load(entry.album.album_id); })}>编辑</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {discardDialog}
    {confirm && <ConsoleConfirmDialog title={creating ? "确认新增专辑" : `确认更新专辑 #${original!.album_id}`}
      changes={creating ? undefined : changes} changesLabel="专辑修改内容" busy={busy} error={error} confirmLabel={creating ? "确认提交" : "确认更新"}
      onClose={closeConfirmation} onConfirm={save}>
      {creating ? <CompactConfirmationTable changes={changes} /> :
        null}
    </ConsoleConfirmDialog>}
  </ConsoleEditorLock>
  </section>;
}
