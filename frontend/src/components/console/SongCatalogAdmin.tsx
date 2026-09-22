import { SongGroupEditor } from "./SongGroupEditor";
import { useEffect, useRef, useState } from "react";
import {
  getCatalogConsole, getSongGroup, getSongGroups, songCatalogWrite,
  type CatalogMember, type CatalogPage, type ConsoleSongItem, type SongGroupSummary,
  type SongOwnership, type SongVersion, type SongVersionDraft,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { ownershipLabel } from "../SongCatalog";
import type { BandOption } from "./types";
import { UpdateDiffTable } from "./UpdateDiffTable";

const emptyFields = (): SongVersionDraft => ({ song_name: "", version_label: "" });
const emptyOwner = (): SongOwnership => ({ mode: "pending", band_ids: [], member_groups: [] });
type HistoryEntry = { song: SongVersion; action: "create" | "update" };

export function SongCatalogAdmin({ variant, active, bands, registerLeaveGuard, onManage }: {
  variant: "create" | "edit"; active: boolean; bands: BandOption[];
  registerLeaveGuard: (guard: ((proceed: () => void) => void) | null) => void;
  onManage: () => void;
}) {
  const { csrfToken } = useAuth();
  const [createDraft, setCreateDraft] = useState(emptyFields);
  const [editDraft, setEditDraft] = useState(emptyFields);
  const [owner, setOwner] = useState<SongOwnership>(emptyOwner);
  const [createOwner, setCreateOwner] = useState<SongOwnership>(emptyOwner);
  const [original, setOriginal] = useState<SongVersion | null>(null);
  const [newGroup, setNewGroup] = useState(true);
  const [groupRevision, setGroupRevision] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groups, setGroups] = useState<SongGroupSummary[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [bandFilter, setBandFilter] = useState("");
  const [candidates, setCandidates] = useState<CatalogPage<ConsoleSongItem> | null>(null);
  const [candidateLabels, setCandidateLabels] = useState<Record<number, string>>({});
  const candidateLabel = (s: ConsoleSongItem) => `#${s.song_id} ${s.song_name} / ${s.version_label || "默认版本"} / ${s.band_name ?? "待回填"}`;
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clearAfterCreate, setClearAfterCreate] = useState(true);
  const [groupEditor, setGroupEditor] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const loadGeneration = useRef(0);
  const creating = variant === "create";
  const draft = creating ? createDraft : editDraft;
  const setDraft = creating ? setCreateDraft : setEditDraft;
  const ownership = creating ? createOwner : owner;
  const setOwnership = creating ? setCreateOwner : setOwner;
  const dirty = !!original && (JSON.stringify(editDraft) !== JSON.stringify({ song_name: original.song_name, version_label: original.version_label }) || correcting);
  const guard = (proceed: () => void) => { if (!creating && dirty) setDiscard(() => proceed); else proceed(); };
  useEffect(() => { setConfirm(false); setDiscard(null); }, [active, variant]);
  useEffect(() => {
    registerLeaveGuard(active ? guard : null);
    return () => registerLeaveGuard(null);
  }, [active, variant, dirty]); // Guard is intentionally refreshed with the current draft state.
  useEffect(() => {
    if (!active) return;
    let current = true;
    void getCatalogConsole<{ items: CatalogMember[] }>("/members").then(result => { if (current) setMembers(result.items); })
      .catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [active]);
  useEffect(() => {
    if (!active || creating) return;
    let current = true;
    const params = new URLSearchParams({ q: query, page: String(page), limit: "20" });
    if (bandFilter) params.set("band_id", bandFilter);
    void getCatalogConsole<CatalogPage<ConsoleSongItem>>(`/songs?${params}`).then(result => { if (current) { setCandidates(result); setCandidateLabels(labels => ({ ...labels, ...Object.fromEntries(result.items.map(s => [s.song_id, candidateLabel(s)])) })); } })
      .catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [active, creating, query, page, bandFilter, history.length]);
  useEffect(() => {
    if (!active || !creating || newGroup) return;
    let current = true;
    void getSongGroups(groupQuery).then(result => { if (current) setGroups(result.items); })
      .catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [active, creating, newGroup, groupQuery]);
  useEffect(() => {
    let current = true;
    setGroupRevision(null);
    if (groupId) void getSongGroup(groupId).then(group => { if (current) setGroupRevision(group.revision); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [groupId]);
  const restore = (song: SongVersion) => {
    setOriginal(song); setEditDraft({ song_name: song.song_name, version_label: song.version_label });
    setOwner({ mode: song.ownership.mode, band_ids: song.ownership.band_ids, member_groups: song.ownership.member_groups });
    setCorrecting(false); setReason("");
  };
  const loadSong = async (id: number) => {
    const generation = ++loadGeneration.current;
    setBusy(true); setError("");
    try {
      const song = await getCatalogConsole<SongVersion>(`/songs/${id}`);
      if (generation === loadGeneration.current) restore(song);
    } catch (e) { if (generation === loadGeneration.current) setError(String(e)); }
    finally { if (generation === loadGeneration.current) setBusy(false); }
  };
  const clear = () => { setCreateDraft(emptyFields()); setCreateOwner(emptyOwner()); setGroupName(""); setGroupId(null); setNewGroup(true); };
  const submit = async () => {
    if (!csrfToken) return;
    setBusy(true); setError("");
    try {
      const path = creating ? newGroup ? "/song-groups" : "/songs" : `/songs/${original!.song_id}${correcting ? "/ownership" : ""}`;
      const payload = creating ? { ...draft, ownership, ...(newGroup ? { group_name: groupName.trim() || draft.song_name } : { group_id: groupId, expected_group_revision: groupRevision }) }
        : correcting ? { ownership, expected_revision: original!.revision, reason }
        : { ...draft, expected_revision: original!.revision };
      const result = await songCatalogWrite<{ item: SongVersion }>(path, creating ? "POST" : "PUT", payload, csrfToken);
      setHistory(value => [...value, { song: result.item, action: creating ? "create" : "update" }]);
      if (creating) { if (!newGroup) setGroupRevision(value => value === null ? null : value + 1); if (clearAfterCreate) clear(); } else restore(result.item);
      setConfirm(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const toggleBand = (id: number, checked: boolean) => setOwnership(ownership.mode === "bands"
    ? { ...ownership, band_ids: checked ? [...ownership.band_ids, id] : ownership.band_ids.filter(value => value !== id) }
    : { ...ownership, member_groups: checked ? [...ownership.member_groups, { band_id: id, member_ids: [] }] : ownership.member_groups.filter(group => group.band_id !== id) });
  const ownerValid = ownership.mode === "pending" || (ownership.mode === "bands" ? ownership.band_ids.length > 0 : ownership.member_groups.length > 0 && ownership.member_groups.every(g => g.member_ids.length > 0));
  const ownerSummary = ownership.mode === "pending" ? "待回填" : ownership.mode === "bands"
    ? ownership.band_ids.map(id => bands.find(b => b.band_id === id)?.band_name ?? `#${id}`).join(" / ")
    : ownership.member_groups.map(g => `${bands.find(b => b.band_id === g.band_id)?.band_name ?? `#${g.band_id}`}：${g.member_ids.map(id => members.find(m => m.member_id === id)?.display_name ?? `#${id}`).join("、")}`).join(" / ");
  const changes = correcting ? [{ field: "归属", before: original ? ownershipLabel(original) : "", after: ownerSummary }, { field: "更正原因", before: "", after: reason }]
    : (Object.keys(draft) as (keyof SongVersionDraft)[]).map(key => ({ field: ({ song_name: "歌曲名称", version_label: "版本标识", version_order: "版本顺序" })[key], before: original ? String(original[key]) : "", after: String(draft[key]) })).filter(change => creating || change.before !== change.after);
  if (!active) return null;
  return <section className="tour-admin-section" aria-label={creating ? "新增歌曲" : "歌曲管理"} hidden={!active}>
    {error && <p role="alert">{error}</p>}
    {!creating && <>
      <div className="tour-admin-toolbar">
        <label>已有歌曲<select aria-label="选择要编辑的歌曲" value={original?.song_id ?? ""} disabled={busy} onChange={e => { if (e.target.value) guard(() => void loadSong(Number(e.target.value))); }}>
          <option value="">选择要编辑的歌曲</option>
          {original && !candidates?.items.some(s => s.song_id === original.song_id) && <option value={original.song_id}>{candidateLabels[original.song_id] ?? `#${original.song_id} ${original.song_name} / ${original.version_label || "默认版本"} / ${ownershipLabel(original)}`}</option>}
          {candidates?.items.map(s => <option key={s.song_id} value={s.song_id}>{candidateLabel(s)}</option>)}
        </select></label>
      </div>
      <div className="tour-admin-toolbar">
        <input aria-label="搜索歌曲" placeholder="歌曲名称" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
        <select aria-label="筛选归属乐队" value={bandFilter} onChange={e => { setBandFilter(e.target.value); setPage(1); }}><option value="">全部乐队</option>{bands.filter(b => b.band_id > 0).map(b => <option key={b.band_id} value={b.band_id}>{b.band_name}</option>)}</select>
        <button disabled={!candidates || candidates.page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>{candidates?.page ?? 1} / {candidates?.total_pages ?? 1}</span>
        <button disabled={!candidates || candidates.page >= candidates.total_pages} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </>}
    {!creating && original && <div className="tour-admin-toolbar"><span>{original.group_name}</span><button disabled={dirty || busy} onClick={() => setGroupEditor(true)}>歌曲组管理</button></div>}
    {groupEditor && original && <SongGroupEditor song={original} onClose={() => setGroupEditor(false)} onSaved={() => { setGroupEditor(false); void loadSong(original.song_id); }} />}
    {(creating || original) && <>
      <fieldset disabled={busy || confirm} className="tour-admin-fields song-admin-fields">
        {creating && <>
          <label>歌曲组<select value={newGroup ? "new" : "existing"} onChange={e => setNewGroup(e.target.value === "new")}><option value="new">新建歌曲组</option><option value="existing">已有歌曲组的新版本</option></select></label>
          {newGroup ? <label>歌曲组名称<input value={groupName} placeholder="默认使用歌曲名称" onChange={e => setGroupName(e.target.value)} /></label> : <>
            <label>搜索歌曲组<input value={groupQuery} onChange={e => setGroupQuery(e.target.value)} /></label>
            <label>选择歌曲组<select value={groupId ?? ""} onChange={e => { const id = Number(e.target.value) || null; setGroupId(id); setSelectedGroupName(groups.find(g => g.group_id === id)?.group_name ?? ""); }}><option value="">请选择</option>{groupId && !groups.some(g => g.group_id === groupId) && <option value={groupId}>{selectedGroupName}</option>}{groups.map(g => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}</select></label>
          </>}
        </>}
        {!correcting && <>
          <label>歌曲名称<input value={draft.song_name} onChange={e => setDraft({ ...draft, song_name: e.target.value })} /></label>
          <label>版本标识<input value={draft.version_label} onChange={e => setDraft({ ...draft, version_label: e.target.value })} /></label>
        </>}
        {(creating || correcting) ? <>
          <label>归属模式<select value={ownership.mode} onChange={e => setOwnership({ ...emptyOwner(), mode: e.target.value as SongOwnership["mode"] })}><option value="pending">待回填</option><option value="bands">乐队</option><option value="members">成员</option></select></label>
          {ownership.mode !== "pending" && <fieldset className="tour-band-field"><legend>归属乐队</legend>{bands.filter(b => b.band_id > 0).map(b => {
            const memberGroup = ownership.member_groups.find(g => g.band_id === b.band_id);
            return <div key={b.band_id}><label><input type="checkbox" checked={ownership.mode === "bands" ? ownership.band_ids.includes(b.band_id) : !!memberGroup} onChange={e => toggleBand(b.band_id, e.target.checked)} />{b.band_name}</label>
              {memberGroup && <select multiple aria-label={`${b.band_name} 固定成员`} value={memberGroup.member_ids.map(String)} onChange={e => setOwnership({ ...ownership, member_groups: ownership.member_groups.map(g => g.band_id === b.band_id ? { ...g, member_ids: Array.from(e.target.selectedOptions, option => Number(option.value)) } : g) })}>
                {members.map(m => <option key={m.member_id} value={m.member_id}>{m.display_name}</option>)}
              </select>}
            </div>;
          })}</fieldset>}
          {correcting && <label>更正原因<input value={reason} onChange={e => setReason(e.target.value)} /></label>}
        </> : <div>归属：{ownershipLabel(original!)} <button type="button" disabled={dirty} onClick={() => setCorrecting(true)}>更正归属</button></div>}
      </fieldset>
      <div className="console-submit-row">
        <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => creating ? clear() : restore(original!)}>{creating ? "清空数据" : "恢复原值"}</button>
        {creating && <label><input type="checkbox" checked={clearAfterCreate} onChange={e => setClearAfterCreate(e.target.checked)} />新增后清空数据</label>}
        <button type="button" className="console-submit-btn" disabled={busy || !draft.song_name.trim() || !ownerValid || (!creating && !dirty) || (creating && !newGroup && (!groupId || !groupRevision)) || (correcting && !reason.trim())} onClick={() => setConfirm(true)}>{creating ? "提交插入" : "保存修改"}</button>
      </div>
    </>}
    <div className="console-table-wrap"><table className="console-admin-table" aria-label="歌曲操作记录"><thead><tr><th>ID</th><th>歌曲</th><th>版本</th><th>操作</th></tr></thead><tbody>
      {history.filter(h => h.action === (creating ? "create" : "update")).map((h, i) => <tr key={i}><td>{h.song.song_id}</td><td>{h.song.song_name}</td><td>{h.song.version_label || "默认版本"}</td><td><button onClick={() => guard(() => { onManage(); void loadSong(h.song.song_id); })}>编辑</button></td></tr>)}
    </tbody></table></div>
    {(confirm || discard) && <div className="modal-mask"><div className="modal compact console-confirm-modal" role="dialog" aria-modal="true" aria-label={discard ? "确认放弃歌曲修改" : creating ? "确认新增歌曲" : "确认修改歌曲"}>
      <div className="modal-head"><h2>{discard ? "确认放弃歌曲修改" : creating ? "确认新增歌曲" : "确认修改歌曲"}</h2></div>
      {!discard && <div className="console-confirm-body">{error && <p role="alert">{error}</p>}<UpdateDiffTable changes={changes} ariaLabel="歌曲修改内容" />{creating && <><p>歌曲组：{newGroup ? groupName.trim() || draft.song_name : selectedGroupName}</p><p>归属模式：{ownership.mode === "pending" ? "待回填" : ownership.mode === "bands" ? "乐队" : "成员"}</p><p>归属：{ownerSummary}</p></>}</div>}
      <div className="console-confirm-actions"><button disabled={busy} onClick={() => { setConfirm(false); setDiscard(null); }}>取消</button><button disabled={busy} onClick={() => {
        if (discard) { const proceed = discard; setDiscard(null); setCorrecting(false); if (original) restore(original); proceed(); } else void submit();
      }}>{busy ? "提交中…" : discard ? "确认放弃" : "确认提交"}</button></div>
    </div></div>}
  </section>;
}
