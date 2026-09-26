import { SongGroupEditor } from "./SongGroupEditor";
import { useEffect, useId, useRef, useState } from "react";
import {
  getCatalogConsole, getSongGroup, getSongGroups, songCatalogWrite,
  type CatalogMember, type CatalogPage, type ConsoleSongItem, type SongGroupSummary,
  type SongOwnership, type SongVersion, type SongVersionDraft,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { ownershipLabel } from "../SongCatalog";
import type { BandOption } from "./types";
import { UpdateDiffTable } from "./UpdateDiffTable";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { ConsoleMultiSelect } from "./ConsoleMultiSelect";

const emptyFields = (): SongVersionDraft => ({ song_name: "", version_label: "" });
const emptyOwner = (): SongOwnership => ({ mode: "pending", band_ids: [], member_groups: [] });
type HistoryEntry = { song: SongVersion; action: "create" | "update" };

export function SongCatalogAdmin({ variant, active, bands, registerLeaveGuard, onManage }: {
  variant: "create" | "edit"; active: boolean; bands: BandOption[];
  registerLeaveGuard: (guard: ((proceed: () => void) => void) | null) => void;
  onManage: () => void;
}) {
  const { csrfToken } = useAuth();
  const formId = useId();
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
      const payload = creating ? { ...draft, version_label: newGroup ? "" : draft.version_label, ownership, ...(newGroup ? { group_name: groupName.trim() || draft.song_name } : { group_id: groupId, expected_group_revision: groupRevision }) }
        : correcting ? { ownership, expected_revision: original!.revision, reason }
        : { ...draft, expected_revision: original!.revision };
      const result = await songCatalogWrite<{ item: SongVersion }>(path, creating ? "POST" : "PUT", payload, csrfToken);
      setHistory(value => [...value, { song: result.item, action: creating ? "create" : "update" }]);
      if (creating) { if (!newGroup) setGroupRevision(value => value === null ? null : value + 1); if (clearAfterCreate) clear(); } else restore(result.item);
      setConfirm(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const ownerValid = ownership.mode === "pending" ||
    ((ownership.mode === "members" || ownership.band_ids.length > 0) &&
     (ownership.mode === "bands" || (ownership.member_groups.length > 0 && ownership.member_groups.every(g => g.member_ids.length > 0))));
  const ownerSummary = ownership.mode === "pending" ? "待回填" : [
    ...ownership.band_ids.map(id => bands.find(b => b.band_id === id)?.band_name ?? `#${id}`),
    ...ownership.member_groups.map(g => `${bands.find(b => b.band_id === g.band_id)?.band_name ?? `#${g.band_id}`}：${g.member_ids.map(id => members.find(m => m.member_id === id)?.display_name ?? `#${id}`).join("、")}`),
  ].join(" / ");
  const changes = correcting ? [{ field: "归属", before: original ? ownershipLabel(original) : "", after: ownerSummary }, { field: "更正原因", before: "", after: reason }]
    : (Object.keys(draft) as (keyof SongVersionDraft)[]).map(key => ({ field: ({ song_name: "歌曲名称", version_label: "版本标识", version_order: "版本顺序" })[key], before: original ? String(original[key]) : "", after: String(draft[key]) })).filter(change => creating || change.before !== change.after);
  const bandOptions = bands.filter(band => band.band_id > 0).map(band => ({ id: band.band_id, label: band.band_name }));
  const memberOptions = members.map(member => ({ id: member.member_id, label: member.display_name }));
  const visibleHistory = history.filter(entry => entry.action === (creating ? "create" : "update"));
  const fieldsDisabled = busy || confirm;
  const hasBands = ownership.mode === "bands" || ownership.mode === "mixed";
  const hasMembers = ownership.mode === "members" || ownership.mode === "mixed";
  const songNameField = <input aria-label="歌曲名称" disabled={fieldsDisabled} value={draft.song_name}
    onChange={event => setDraft({ ...draft, song_name: event.target.value })} />;
  const versionField = <input aria-label="版本标识" disabled={fieldsDisabled || (creating && newGroup) || (!creating && original?.version_label === "")}
    value={creating && newGroup ? "" : draft.version_label} onChange={event => setDraft({ ...draft, version_label: event.target.value })} />;
  const ownershipModeField = <select aria-label="归属模式" disabled={fieldsDisabled} value={ownership.mode} onChange={event => {
    const mode = event.target.value as SongOwnership["mode"];
    setOwnership({ mode, band_ids: mode === "bands" || mode === "mixed" ? ownership.band_ids : [], member_groups: mode === "members" || mode === "mixed" ? ownership.member_groups : [] });
  }}>
    <option value="pending">待回填</option><option value="bands">乐队</option><option value="members">成员</option><option value="mixed">乐队与成员</option>
  </select>;
  const bandPicker = <ConsoleMultiSelect label="归属乐队" options={bandOptions} hideLabel={creating}
    value={ownership.band_ids} disabled={fieldsDisabled} onChange={band_ids => setOwnership({ ...ownership, band_ids })} />;
  const memberBandPicker = <ConsoleMultiSelect label="成员所属乐队" options={bandOptions} hideLabel={creating}
    value={ownership.member_groups.map(group => group.band_id)} disabled={fieldsDisabled}
    onChange={ids => setOwnership({ ...ownership,
      member_groups: ids.map(id => ownership.member_groups.find(group => group.band_id === id) ?? { band_id: id, member_ids: [] }),
    })} />;
  const memberPickers = ownership.member_groups.map(group => <ConsoleMultiSelect key={group.band_id}
    label={`${bands.find(band => band.band_id === group.band_id)?.band_name ?? `#${group.band_id}`} 固定成员`}
    options={memberOptions} value={group.member_ids} disabled={fieldsDisabled}
    onChange={member_ids => setOwnership({ ...ownership, member_groups: ownership.member_groups.map(item => item.band_id === group.band_id ? { ...item, member_ids } : item) })} />);
  const formActions = <div className={`console-submit-row ${creating ? "live-admin-insert-row" : "song-submit-row"} venue-create-actions`}>
    {creating && <label className="live-clear-after-create-option"><input type="checkbox" disabled={busy}
      checked={clearAfterCreate} onChange={event => setClearAfterCreate(event.target.checked)} />新增后清空数据</label>}
    <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => creating ? clear() : restore(original!)}>{creating ? "清空数据" : "恢复原值"}</button>
    <button type="button" className="console-submit-btn" disabled={busy || !draft.song_name.trim() || !ownerValid || (!creating && !dirty) || (creating && !newGroup && (!groupId || !groupRevision)) || (correcting && !reason.trim())}
      onClick={() => setConfirm(true)}>{creating ? "提交插入" : "保存修改"}</button>
  </div>;
  if (!active) return null;
  return <section className="tour-admin-section" aria-label={creating ? "新增歌曲" : "歌曲管理"}>
    {error && <p role="alert">{error}</p>}
    {!creating && <div className="tour-admin-toolbar live-admin-toolbar venue-admin-toolbar">
      <span className="live-management-label">已有歌曲</span>
      <input className="venue-query-input live-management-primary-control" aria-label="搜索歌曲" placeholder="歌曲名称"
        value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />
      <select className="song-band-filter" aria-label="筛选归属乐队" value={bandFilter}
        onChange={event => { setBandFilter(event.target.value); setPage(1); }}>
        <option value="">全部乐队</option>
        {bandOptions.map(band => <option key={band.id} value={band.id}>{band.label}</option>)}
      </select>
      <select aria-label="选择要编辑的歌曲" value={original?.song_id ?? ""} disabled={busy}
        onChange={event => { if (event.target.value) guard(() => void loadSong(Number(event.target.value))); }}>
        <option value="">选择要编辑的歌曲</option>
        {original && !candidates?.items.some(song => song.song_id === original.song_id) &&
          <option value={original.song_id}>{candidateLabels[original.song_id] ?? `#${original.song_id} ${original.song_name} / ${original.version_label || "默认版本"} / ${ownershipLabel(original)}`}</option>}
        {candidates?.items.map(song => <option key={song.song_id} value={song.song_id}>{candidateLabel(song)}</option>)}
      </select>
      <div className="tour-candidate-pager">
        <button type="button" className="console-ghost-btn" disabled={!candidates || candidates.page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {candidates?.page ?? 1} / {candidates?.total_pages ?? 1} 页，共 {candidates?.total ?? 0} 首歌曲</span>
        <button type="button" className="console-ghost-btn" disabled={!candidates || candidates.page >= candidates.total_pages} onClick={() => setPage(page + 1)}>下一页</button>
      </div>
    </div>}
    {!creating && original && <div className="tour-admin-toolbar">
      <span>歌曲组：{original.group_name}</span>
      <button type="button" className="console-ghost-btn" disabled={dirty || busy} onClick={() => setGroupEditor(true)}>歌曲组管理</button>
    </div>}
    {groupEditor && original && <SongGroupEditor song={original} onClose={() => setGroupEditor(false)} onSaved={() => { setGroupEditor(false); void loadSong(original.song_id); }} />}
    {creating ? <div>
      <div className="live-id-selector live-create-tools">
        <label className="live-management-label" htmlFor={`${formId}-group-mode`}>歌曲组</label>
        <select id={`${formId}-group-mode`} className="live-management-primary-control" disabled={fieldsDisabled}
          value={newGroup ? "new" : "existing"} onChange={event => setNewGroup(event.target.value === "new")}>
          <option value="new">新建歌曲组</option><option value="existing">已有歌曲组的新版本</option>
        </select>
      </div>
      {!newGroup && <>
        <div className="live-id-selector live-create-query-row">
          <label className="live-management-label" htmlFor={`${formId}-group-query`}>搜索歌曲组</label>
          <input id={`${formId}-group-query`} className="venue-query-input live-management-primary-control" disabled={fieldsDisabled}
            placeholder="歌曲组名称" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} />
        </div>
        <div className="live-id-selector live-create-tools">
          <label className="live-management-label" htmlFor={`${formId}-group-select`}>选择歌曲组</label>
          <select id={`${formId}-group-select`} className="live-management-primary-control" disabled={fieldsDisabled} value={groupId ?? ""}
            onChange={event => {
              const id = Number(event.target.value) || null;
              setGroupId(id); setSelectedGroupName(groups.find(group => group.group_id === id)?.group_name ?? "");
            }}>
            <option value="">请选择</option>
            {groupId && !groups.some(group => group.group_id === groupId) && <option value={groupId}>{selectedGroupName}</option>}
            {groups.map(group => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}
          </select>
        </div>
      </>}
      <div className="console-table-wrap">
        <table className="console-admin-table song-create-form-table" data-ownership={ownership.mode} aria-label="新增歌曲资料">
          <colgroup>
            <col /><col className="song-create-version-column" />{newGroup && <col />}
            <col className="song-create-mode-column" />
            {hasBands && <col className="song-create-band-column" />}
            {hasMembers && <col className="song-create-members-column" />}
          </colgroup>
          <thead><tr>
            <th scope="col">歌曲名称</th><th scope="col">版本标识</th>{newGroup && <th scope="col">歌曲组名称</th>}
            <th scope="col">归属模式</th>{hasBands && <th scope="col">归属乐队</th>}{hasMembers && <th scope="col">成员所属乐队</th>}
          </tr></thead>
          <tbody><tr>
            <td>{songNameField}</td><td>{versionField}</td>
            {newGroup && <td><input aria-label="歌曲组名称" disabled={fieldsDisabled} value={groupName}
              placeholder="默认使用歌曲名称" onChange={event => setGroupName(event.target.value)} /></td>}
            <td>{ownershipModeField}</td>{hasBands && <td>{bandPicker}</td>}
            {hasMembers && <td>{memberBandPicker}</td>}
          </tr></tbody>
        </table>
      </div>
      {hasMembers && memberPickers.length > 0 && <div className="tour-admin-toolbar song-create-member-fields">{memberPickers}</div>}
      {formActions}
    </div> : original && <>
      <fieldset disabled={fieldsDisabled} className="tour-admin-fields tour-band-field">
        {!correcting && <>
          <label>歌曲名称{songNameField}</label>
          <label>版本标识{versionField}</label>
        </>}
        {correcting && <>
          <label>归属模式{ownershipModeField}</label>
          {hasBands && bandPicker}
          {hasMembers && <>{memberBandPicker}{memberPickers}</>}
          <label>更正原因<input value={reason} onChange={event => setReason(event.target.value)} /></label>
        </>}
      </fieldset>
      {!correcting && <div className="tour-admin-toolbar">
        <span>归属：{ownershipLabel(original)}</span>
        <button type="button" className="console-ghost-btn" disabled={dirty || busy} onClick={() => setCorrecting(true)}>更正归属</button>
      </div>}
      {formActions}
    </>}
    <div className="console-table-wrap live-history-wrap">
      <table className="console-admin-table console-compact-table entity-history-table live-history-table" aria-label="歌曲操作记录">
        <thead><tr><th>ID</th><th>歌曲</th><th>版本</th><th>操作</th></tr></thead>
        <tbody>{visibleHistory.length === 0 ? <tr><td colSpan={4} className="empty-cell">暂无歌曲操作记录</td></tr> :
          visibleHistory.map((entry, index) => <tr key={index}>
            <td>{entry.song.song_id}</td><td>{entry.song.song_name}</td><td>{entry.song.version_label || "默认版本"}</td>
            <td><button type="button" className="console-ghost-btn" onClick={() => guard(() => { onManage(); void loadSong(entry.song.song_id); })}>编辑</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {(confirm || discard) && <div className="modal-mask"><div className="modal compact console-confirm-modal" role="dialog" aria-modal="true"
      aria-label={discard ? "确认放弃歌曲修改" : creating ? "确认新增歌曲" : "确认修改歌曲"}>
      <div className="modal-head"><h2>{discard ? "确认放弃歌曲修改" : creating ? "确认新增歌曲" : "确认修改歌曲"}</h2></div>
      {!discard && <div className="console-confirm-body">
        {error && <p role="alert">{error}</p>}
        {creating ? <CompactConfirmationTable ariaLabel="新增歌曲确认" rows={[
          ["歌曲名称", draft.song_name], ["版本标识", newGroup ? "默认版本" : draft.version_label || "默认版本"],
          ["歌曲组", newGroup ? groupName.trim() || draft.song_name : selectedGroupName],
          ["归属模式", { pending: "待回填", mixed: "乐队与成员", bands: "乐队", members: "成员" }[ownership.mode]], ["归属", ownerSummary],
        ]} /> : <UpdateDiffTable changes={changes} ariaLabel="歌曲修改内容" />}
      </div>}
      <div className="console-confirm-actions">
        <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => { setConfirm(false); setDiscard(null); }}>取消</button>
        <button type="button" className="console-submit-btn" disabled={busy} onClick={() => {
          if (discard) { const proceed = discard; setDiscard(null); setCorrecting(false); if (original) restore(original); proceed(); } else void submit();
        }}>{busy ? "提交中…" : discard ? "确认放弃" : "确认提交"}</button>
      </div>
    </div></div>}
  </section>;
}
