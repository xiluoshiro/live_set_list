import { SongGroupEditor, emptySongMove } from "./SongGroupEditor";
import { useEffect, useId, useRef, useState } from "react";
import {
  getCatalogConsole, getSongGroup, getSongGroups, songCatalogWrite,
  type CatalogMember, type CatalogPage, type ConsoleSongItem, type SongGroupSummary,
  type SongOwnership, type SongVersion, type SongVersionDraft, type SongGroup, type SongEditUpdate, type SongEditMutation,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { ownershipLabel } from "../SongCatalog";
import type { BandOption } from "./types";
import { UpdateDiffTable } from "./UpdateDiffTable";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { ConsoleChoiceSelect, ConsoleCandidatePager } from "./ConsoleChoiceSelect";
import { ConsoleMultiSelect } from "./ConsoleMultiSelect";
import { CoverEditor, coverSummary } from "./CoverEditor";
import { coverPayload, coverUrlsError, filledCovers } from "../../albumLinks";

const emptyFields = (): SongVersionDraft => ({ song_name: "", version_label: "", cover_urls: [] });
const songFields = (song: SongVersion): SongVersionDraft => ({ song_name: song.song_name, version_label: song.version_label, cover_urls: [...song.cover_urls] });
const songPayload = (draft: SongVersionDraft): SongVersionDraft => ({ ...draft, cover_urls: coverPayload(draft.cover_urls) });
const emptyOwner = (): SongOwnership => ({ mode: "pending", band_ids: [], member_groups: [] });
const ownerFields = (song: SongVersion): SongOwnership => ({ mode: song.ownership.mode, band_ids: song.ownership.band_ids, member_groups: song.ownership.member_groups });
const groupFields = (group: SongGroup) => ({ group_name: group.group_name.trim(), song_ids: group.versions.map(v => v.song_id) });
const versionSummary = (group: SongGroup | null) => group?.versions.map(v => `#${v.song_id} ${v.version_label || "默认版本"}`).join(" / ") ?? "";
type HistoryEntry = { song: SongVersion; action: "create" | "update"; summary: string };

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
  const [originalGroup, setOriginalGroup] = useState<SongGroup | null>(null);
  const [editGroup, setEditGroup] = useState<SongGroup | null>(null);
  const [moveTarget, setMoveTarget] = useState(emptySongMove);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [newGroup, setNewGroup] = useState(true);
  const [groupRevision, setGroupRevision] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groups, setGroups] = useState<CatalogPage<SongGroupSummary> | null>(null);
  const [groupPage, setGroupPage] = useState(1);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [bandFilter, setBandFilter] = useState("");
  const [search, setSearch] = useState({ query: "", bandFilter: "", page: 1 });
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const querySongs = () => setSearch({ query: query.trim(), bandFilter, page: 1 });
  const [candidates, setCandidates] = useState<CatalogPage<ConsoleSongItem> | null>(null);
  const [candidateLabels, setCandidateLabels] = useState<Record<number, string>>({});
  const candidateLabel = (s: ConsoleSongItem) => `#${s.song_id} ${s.song_name} / ${s.version_label || "默认版本"} / ${s.band_name ?? "待回填"}`;
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clearAfterCreate, setClearAfterCreate] = useState(true);
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const loadGeneration = useRef(0);
  const creating = variant === "create";
  const draft = creating ? createDraft : editDraft;
  const setDraft = creating ? setCreateDraft : setEditDraft;
  const ownership = creating ? createOwner : owner;
  const setOwnership = creating ? setCreateOwner : setOwner;
  const ownershipChanged = !!original && JSON.stringify(owner) !== JSON.stringify(ownerFields(original));
  const groupChanged = !!originalGroup && !!editGroup && JSON.stringify(groupFields(editGroup)) !== JSON.stringify(groupFields(originalGroup));
  const changed = !!original && (JSON.stringify(songPayload(editDraft)) !== JSON.stringify(songFields(original)) || ownershipChanged || groupChanged || !!moveTarget.group_id);
  const dirty = changed || !!reason.trim() || !!moveTarget.reason.trim();
  const guard = (proceed: () => void) => { if (busy || confirm) return; if (!creating && dirty) setDiscard(() => proceed); else proceed(); };
  useEffect(() => { setConfirm(false); setDiscard(null); }, [active, variant]);
  useEffect(() => {
    registerLeaveGuard(active ? guard : null);
    return () => registerLeaveGuard(null);
  }, [active, variant, dirty, busy, confirm]); // Guard is intentionally refreshed with the current draft state.
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
    setCandidatesLoading(true);
    setCandidates(null);
    const params = new URLSearchParams({ q: search.query, page: String(search.page), limit: "20" });
    if (search.bandFilter) params.set("band_id", search.bandFilter);
    void getCatalogConsole<CatalogPage<ConsoleSongItem>>(`/songs?${params}`).then(result => { if (current) { setCandidates(result); setCandidateLabels(labels => ({ ...labels, ...Object.fromEntries(result.items.map(s => [s.song_id, candidateLabel(s)])) })); } })
      .catch(e => { if (current) setError(String(e)); })
      .finally(() => { if (current) setCandidatesLoading(false); });
    return () => { current = false; };
  }, [active, creating, search, history.length]);
  useEffect(() => {
    if (!active || !creating || newGroup) return;
    let current = true;
    setGroupsLoading(true); setGroups(null);
    void getSongGroups(groupQuery, groupPage).then(result => { if (current) setGroups(result); })
      .catch(e => { if (current) setError(String(e)); })
      .finally(() => { if (current) setGroupsLoading(false); });
    return () => { current = false; };
  }, [active, creating, newGroup, groupQuery, groupPage]);
  useEffect(() => {
    let current = true;
    setGroupRevision(null);
    if (groupId) void getSongGroup(groupId).then(group => { if (current) setGroupRevision(group.revision); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [groupId]);
  const restore = (song: SongVersion, group: SongGroup | null = originalGroup) => {
    setOriginal(song); setEditDraft(songFields(song));
    setOwner(ownerFields(song)); setOriginalGroup(group); setEditGroup(group);
    setCorrecting(false); setReason(""); setMoveTarget(emptySongMove()); setEditorGeneration(value => value + 1);
  };
  const loadSong = async (id: number) => {
    const generation = ++loadGeneration.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const song = await getCatalogConsole<SongVersion>(`/songs/${id}`);
      const group = await getSongGroup(song.group_id);
      if (generation === loadGeneration.current) restore(song, group);
    } catch (e) { if (generation === loadGeneration.current) setError(String(e)); }
    finally { if (generation === loadGeneration.current) setBusy(false); }
  };
  const clear = () => { setCreateDraft(emptyFields()); setCreateOwner(emptyOwner()); setGroupName(""); setGroupId(null); setSelectedGroupName(""); setNewGroup(true); };
  const submit = async () => {
    if (!csrfToken) return;
    setBusy(true); setError("");
    try {
      const path = creating ? newGroup ? "/song-groups" : "/songs" : `/songs/${original!.song_id}/edit`;
      const editPayload: SongEditUpdate | null = !creating && original && originalGroup && editGroup ? {
        ...songPayload(draft), expected_revision: original.revision,
        group: { ...groupFields(editGroup), group_id: originalGroup.group_id, expected_revision: originalGroup.revision },
        ownership, ownership_reason: ownershipChanged ? reason.trim() : "",
        move_to_group: moveTarget.group_id && moveTarget.expected_revision ? {
          group_id: moveTarget.group_id, expected_revision: moveTarget.expected_revision, reason: moveTarget.reason.trim(),
        } : null,
      } : null;
      if (!creating && !editPayload) return;
      const payload = creating ? { ...songPayload(draft), version_label: newGroup ? "" : draft.version_label, ownership, ...(newGroup ? { group_name: groupName.trim() || draft.song_name } : { group_id: groupId, expected_group_revision: groupRevision }) }
        : editPayload;
      const result = await songCatalogWrite<SongEditMutation>(path, creating ? "POST" : "PUT", payload, csrfToken);
      setHistory(value => [...value, { song: result.item, action: creating ? "create" : "update", summary: creating ? "新增歌曲" : changes.map(change => change.field).join("、") }]);
      if (creating) { if (!newGroup) setGroupRevision(value => value === null ? null : value + 1); if (clearAfterCreate) clear(); } else restore(result.item, result.group);
      setMessage(`已${creating ? "新增" : "更新"}歌曲 #${result.item.song_id} ${result.item.song_name}`);
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
  const changes = [
      { field: "歌曲名称", before: original?.song_name ?? "", after: draft.song_name },
      { field: "版本标识", before: original?.version_label ?? "", after: draft.version_label },
      { field: "封面", before: coverSummary(original?.cover_urls ?? []), after: coverSummary(songPayload(draft).cover_urls) },
    ].filter(change => creating || change.before !== change.after);
  if (!creating && ownershipChanged) changes.push(
    { field: "归属（当前版本）", before: original ? ownershipLabel(original) : "", after: ownerSummary },
    { field: "归属更正原因", before: "", after: reason },
  );
  if (!creating && groupChanged) changes.push(...[
    { field: "歌曲组名称（整组）", before: originalGroup?.group_name ?? "", after: editGroup?.group_name.trim() ?? "" },
    { field: "版本顺序（整组）", before: versionSummary(originalGroup), after: versionSummary(editGroup) },
  ].filter(change => change.before !== change.after));
  if (!creating && moveTarget.group_id) changes.push(
    { field: "当前版本归组", before: original?.group_name ?? "", after: `${moveTarget.group_name}（移至末尾）` },
    { field: "归组更正原因", before: "", after: moveTarget.reason },
  );
  const bandOptions = bands.filter(band => band.band_id > 0).map(band => ({ id: band.band_id, label: band.band_name }));
  const memberOptions = members.map(member => ({ id: member.member_id, label: member.display_name }));
  const visibleHistory = history.filter(entry => entry.action === (creating ? "create" : "update"));
  const fieldsDisabled = busy || confirm;
  const hasBands = ownership.mode === "bands" || ownership.mode === "mixed";
  const hasMembers = ownership.mode === "members" || ownership.mode === "mixed";
  const songNameField = <input aria-label="歌曲名称" disabled={fieldsDisabled} value={draft.song_name}
    placeholder="请输入歌曲名称"
    onChange={event => setDraft({ ...draft, song_name: event.target.value })} />;
  const versionField = <input aria-label="版本标识" disabled={fieldsDisabled || (creating && newGroup) || (!creating && original?.version_label === "")}
    placeholder={(creating && newGroup) || (!creating && original?.version_label === "") ? "默认版本" : "请输入版本标识"}
    value={creating && newGroup ? "" : draft.version_label} onChange={event => setDraft({ ...draft, version_label: event.target.value })} />;
  const ownershipModeField = <select aria-label="归属模式" disabled={fieldsDisabled} value={ownership.mode} onChange={event => {
    const mode = event.target.value as SongOwnership["mode"];
    setOwnership({ mode, band_ids: mode === "bands" || mode === "mixed" ? ownership.band_ids : [], member_groups: mode === "members" || mode === "mixed" ? ownership.member_groups : [] });
  }}>
    <option value="pending">待回填</option><option value="bands">乐队</option><option value="members">成员</option><option value="mixed">乐队与成员</option>
  </select>;
  const bandPicker = <ConsoleMultiSelect label="归属乐队" options={bandOptions} hideLabel
    value={ownership.band_ids} disabled={fieldsDisabled} onChange={band_ids => setOwnership({ ...ownership, band_ids })} />;
  const memberBandPicker = <ConsoleMultiSelect label="成员所属乐队" options={bandOptions} hideLabel
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
    <button type="button" className="console-ghost-btn" disabled={fieldsDisabled} onClick={() => { creating ? clear() : restore(original!); setError(""); setMessage(""); }}>{creating ? "清空数据" : "恢复原值"}</button>
    <button type="button" className="console-submit-btn" disabled={fieldsDisabled || !draft.song_name.trim() || !ownerValid ||
      (!creating && (!changed || !editGroup?.group_name.trim() || (ownershipChanged && !reason.trim()) ||
        (!!moveTarget.group_id && (!moveTarget.expected_revision || !moveTarget.reason.trim())))) || (creating && !newGroup && (!groupId || !groupRevision))}
      onClick={() => {
        const problem = coverUrlsError(filledCovers(draft.cover_urls));
        setError(problem); if (!problem) setConfirm(true);
      }}>{creating ? "提交插入" : "保存修改"}</button>
  </div>;
  if (!active) return null;
  return <section className="tour-admin-section" aria-label={creating ? "新增歌曲" : "歌曲管理"}>
    {error && <p role="alert">{error}</p>}
    {message && <p className="console-admin-hint" role="status">{message}</p>}
    {!creating && <div className="tour-admin-toolbar live-admin-toolbar venue-admin-toolbar" role="search" aria-label="查询已有歌曲">
      <span className="live-management-label">已有歌曲</span>
      <input className="venue-query-input live-management-primary-control" aria-label="搜索歌曲" placeholder="歌曲名称"
        disabled={fieldsDisabled} value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) querySongs(); }} />
      <select className="song-band-filter" aria-label="筛选归属乐队" disabled={fieldsDisabled} value={bandFilter}
        onChange={event => setBandFilter(event.target.value)}>
        <option value="">全部乐队</option>
        {bandOptions.map(band => <option key={band.id} value={band.id}>{band.label}</option>)}
      </select>
      <button type="button" className="console-ghost-btn" disabled={fieldsDisabled || candidatesLoading} onClick={querySongs}>查询</button>
      <select aria-label="选择要编辑的歌曲" value={original?.song_id ?? ""} disabled={fieldsDisabled || candidatesLoading}
        onChange={event => { if (event.target.value) guard(() => void loadSong(Number(event.target.value))); }}>
        <option value="">选择要编辑的歌曲</option>
        {original && !candidates?.items.some(song => song.song_id === original.song_id) &&
          <option value={original.song_id}>{candidateLabels[original.song_id] ?? `#${original.song_id} ${original.song_name} / ${original.version_label || "默认版本"} / ${ownershipLabel(original)}`}</option>}
        {candidates?.items.map(song => <option key={song.song_id} value={song.song_id}>{candidateLabel(song)}</option>)}
      </select>
      <div className="tour-candidate-pager">
        <button type="button" className="console-ghost-btn" disabled={fieldsDisabled || candidatesLoading || !candidates || candidates.page <= 1} onClick={() => setSearch(value => ({ ...value, page: value.page - 1 }))}>上一页</button>
        <span>{candidatesLoading ? "加载中…" : `第 ${candidates?.page ?? search.page} / ${candidates?.total_pages ?? 1} 页，共 ${candidates?.total ?? 0} 首歌曲`}</span>
        <button type="button" className="console-ghost-btn" disabled={fieldsDisabled || candidatesLoading || !candidates || candidates.page >= candidates.total_pages} onClick={() => setSearch(value => ({ ...value, page: value.page + 1 }))}>下一页</button>
      </div>
    </div>}
    {!creating && !original && !busy && <p className="console-admin-hint">请先选择要编辑的歌曲。</p>}
    {!creating && busy && !confirm && <p className="console-admin-hint" role="status">正在加载歌曲资料…</p>}
    {!creating && !candidatesLoading && candidates && !candidates.items.length && <p className="console-admin-hint" role="status">没有匹配的歌曲。</p>}
    {creating ? <div className="song-create-form">
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
            placeholder="歌曲组名称" value={groupQuery} onChange={event => { setGroupQuery(event.target.value); setGroupPage(1); }} />
        </div>
        <div className="live-id-selector live-create-tools">
          <label className="live-management-label" htmlFor={`${formId}-group-select`}>选择歌曲组</label>
          <ConsoleChoiceSelect id={`${formId}-group-select`} label="选择歌曲组" disabled={fieldsDisabled || groupsLoading}
            value={groupId} selectedLabel={selectedGroupName} options={(groups?.items ?? []).map(group => ({ id: group.group_id, label: group.group_name }))}
            onChange={id => { setGroupId(id); setSelectedGroupName(groups?.items.find(group => group.group_id === id)?.group_name ?? ""); }} />
          <ConsoleCandidatePager page={groupPage} totalPages={groups?.total_pages ?? groupPage} total={groups?.total ?? 0}
            loading={groupsLoading} onPage={setGroupPage} />
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
      <CoverEditor title="歌曲封面" covers={draft.cover_urls} locked={fieldsDisabled}
        onChange={cover_urls => setDraft({ ...draft, cover_urls })} />
      {formActions}
    </div> : original && <>
      <div className="console-table-wrap"><table className="console-admin-table song-edit-form-table" aria-label="歌曲资料">
        <colgroup><col className="song-edit-id-column" /><col /><col className="song-create-version-column" /><col /></colgroup>
        <thead><tr><th scope="col">song_id</th><th scope="col">歌曲名称</th><th scope="col">版本标识</th><th scope="col">所属歌曲组</th></tr></thead>
        <tbody><tr><td><span className="readonly-cell">{original.song_id}</span></td><td>{songNameField}</td><td>{versionField}</td><td>{editGroup?.group_name ?? original.group_name}</td></tr></tbody>
      </table></div>
      <CoverEditor title="歌曲封面" covers={draft.cover_urls} locked={fieldsDisabled}
        onChange={cover_urls => setDraft({ ...draft, cover_urls })} />
      <section className="song-ownership-editor" aria-label="版本归属">
        <div className="live-admin-status-head"><h3>版本归属</h3><span>影响当前版本及其所有引用处</span></div>
        <div className="console-table-wrap"><table className="console-admin-table song-ownership-table" aria-label="版本归属资料">
          <thead><tr><th scope="col">归属模式</th><th scope="col">归属</th><th scope="col">操作</th></tr></thead>
          <tbody><tr><td>{{ pending: "待回填", bands: "乐队", members: "成员", mixed: "乐队与成员" }[ownership.mode]}</td><td>{ownerSummary}</td>
            <td><button type="button" className="console-ghost-btn" disabled={fieldsDisabled} aria-expanded={correcting} aria-controls={`${formId}-ownership`}
              onClick={() => setCorrecting(value => !value)}>{correcting ? "收起" : "更正归属"}</button></td></tr></tbody>
        </table></div>
        <div id={`${formId}-ownership`} hidden={!correcting}>
          <div className="console-table-wrap"><table className="console-admin-table song-ownership-table" aria-label="更正版本归属">
            <thead><tr><th scope="col">归属模式</th>{hasBands && <th scope="col">归属乐队</th>}{hasMembers && <th scope="col">成员所属乐队</th>}</tr></thead>
            <tbody><tr><td>{ownershipModeField}</td>{hasBands && <td>{bandPicker}</td>}{hasMembers && <td>{memberBandPicker}</td>}</tr></tbody>
          </table></div>
          {hasMembers && <div className="tour-admin-toolbar song-create-member-fields">{memberPickers}</div>}
          <label className="song-correction-reason">归属更正原因<input disabled={fieldsDisabled} aria-required={ownershipChanged} placeholder="请输入归属更正原因"
            value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>
        </div>
      </section>
      {editGroup && <SongGroupEditor key={editorGeneration} song={original} group={editGroup} currentDraft={draft} currentOwner={ownerSummary}
        target={moveTarget} locked={fieldsDisabled} onChange={setEditGroup} onTargetChange={setMoveTarget} />}
      {formActions}
      {dirty && <p className="console-admin-hint" role="status">歌曲 #{original.song_id} 有未保存修改，将随“保存修改”统一提交。</p>}
    </>}
    <div className="console-table-wrap live-history-wrap">
      <table className="console-admin-table console-compact-table entity-history-table live-history-table" aria-label="歌曲操作记录">
        <thead><tr><th>ID</th><th>歌曲</th><th>版本</th><th>本次变更</th><th>操作</th></tr></thead>
        <tbody>{visibleHistory.length === 0 ? <tr><td colSpan={5} className="empty-cell">暂无歌曲操作记录</td></tr> :
          visibleHistory.map((entry, index) => <tr key={index}>
            <td>{entry.song.song_id}</td><td>{entry.song.song_name}</td><td>{entry.song.version_label || "默认版本"}</td>
            <td>{entry.summary}</td><td><button type="button" className="console-ghost-btn" disabled={fieldsDisabled} onClick={() => guard(() => { onManage(); void loadSong(entry.song.song_id); })}>编辑</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {(confirm || discard) && <div className="modal-mask"><div className="modal compact console-confirm-modal" role="dialog" aria-modal="true"
      aria-label={discard ? "确认放弃歌曲修改" : creating ? "确认新增歌曲" : "确认修改歌曲"}
      onKeyDown={event => { if (event.key === "Escape" && !busy) { setConfirm(false); setDiscard(null); } }}>
      <div className="modal-head"><h2>{discard ? "确认放弃歌曲修改" : creating ? "确认新增歌曲" : "确认修改歌曲"}</h2></div>
      {discard && <p className="console-admin-hint">离开后将丢弃整页未保存的修改，包括归属、歌曲组和版本顺序。</p>}
      {!discard && <div className="console-confirm-body">
        {!creating && <p className="console-admin-hint">本次全部变更将一次保存，并更新所有引用处。</p>}
        {error && <p role="alert">{error}</p>}
        {creating ? <CompactConfirmationTable ariaLabel="新增歌曲确认" rows={[
          ["歌曲名称", draft.song_name], ["版本标识", newGroup ? "默认版本" : draft.version_label || "默认版本"],
          ["歌曲组", newGroup ? groupName.trim() || draft.song_name : selectedGroupName],
          ["封面", coverSummary(songPayload(draft).cover_urls)],
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
