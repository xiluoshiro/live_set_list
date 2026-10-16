import { ConsoleEditorLock } from "./ConsoleEditorLock";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";
import { useConsoleDraftGuard } from "./ConsoleDraftGuard";
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
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { ConsoleChoiceSelect, ConsoleCandidatePager } from "./ConsoleChoiceSelect";
import { ConsoleEditSelect, resolveConsoleEditSelection } from "./ConsoleEditSelect";
import { ownershipFields } from "./OwnershipFields";
import { CoverEditor } from "./CoverEditor";
import { coverChanges, ownershipChanges } from "./confirmationFields";
import { coverPayload, coverUrlsError, filledCovers } from "../../albumLinks";

const emptyFields = (): SongVersionDraft => ({ version_label: "", cover_urls: [] });
const songFields = (song: SongVersion): SongVersionDraft => ({ version_label: song.version_label, cover_urls: [...song.cover_urls] });
const songPayload = (draft: SongVersionDraft): SongVersionDraft => ({ ...draft, cover_urls: coverPayload(draft.cover_urls) });
const emptyOwner = (): SongOwnership => ({ mode: "pending", band_ids: [], member_groups: [] });
const ownerFields = (song: SongVersion): SongOwnership => ({ mode: song.ownership.mode, band_ids: song.ownership.band_ids, member_groups: song.ownership.member_groups });
const groupFields = (group: SongGroup) => ({ group_name: group.group_name.trim(), song_ids: group.versions.map(v => v.song_id) });
type HistoryEntry = { song: SongVersion; action: "create" | "update"; summary: string };

export function SongCatalogAdmin({ variant, active, bands, registerLeaveGuard, onManage, onSaved, initialSongName }: {
  variant: "create" | "edit"; active: boolean; bands: BandOption[];
  registerLeaveGuard: (guard: ((proceed: () => void) => void) | null) => void;
  onManage: () => void; onSaved?: (song: SongVersion) => void; initialSongName?: string;
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
  const [groupName, setGroupName] = useState(initialSongName ?? "");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupSearch, setGroupSearch] = useState({ query: "", page: 1 });
  const [groups, setGroups] = useState<CatalogPage<SongGroupSummary> | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [bandFilter, setBandFilter] = useState("");
  const [search, setSearch] = useState({ query: "", bandFilter: "", page: 1, selectFirst: true });
  const selectedSearch = useRef<typeof search | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const querySongs = () => guard(() => setSearch({ query: query.trim(), bandFilter, page: 1, selectFirst: true }));
  const [candidates, setCandidates] = useState<CatalogPage<ConsoleSongItem> | null>(null);
  const candidateLabel = (s: ConsoleSongItem) => `#${s.song_id} ${s.song_name} / ${s.version_label || "默认版本"} / ${s.band_name ?? "待回填"}`;
  const selectedSongLabel = original ? `#${original.song_id} ${original.song_name} / ${original.version_label || "默认版本"} / ${ownershipLabel(original)}` : "";
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clearAfterCreate, setClearAfterCreate] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const loadGeneration = useRef(0);
  const creating = variant === "create";
  const draft = creating ? createDraft : editDraft;
  const setDraft = creating ? setCreateDraft : setEditDraft;
  const ownership = creating ? createOwner : owner;
  const setOwnership = creating ? setCreateOwner : setOwner;
  const ownershipChanged = !!original && JSON.stringify(owner) !== JSON.stringify(ownerFields(original));
  const groupChanged = !!originalGroup && !!editGroup && JSON.stringify(groupFields(editGroup)) !== JSON.stringify(groupFields(originalGroup));
  const changed = !!original && (JSON.stringify(songPayload(editDraft)) !== JSON.stringify(songFields(original)) || ownershipChanged || groupChanged || !!moveTarget.group_id);
  const dirty = changed || !!moveTarget.reason.trim();
  const { guard, dialog: discardDialog } = useConsoleDraftGuard({ active, dirty: !creating && dirty, busy: busy || confirm,
    label: `歌曲 #${original?.song_id}`, onDiscard: () => { if (original) restore(original); } });
  useEffect(() => { setConfirm(false); }, [active, variant]);
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
    const selectionGeneration = loadGeneration.current;
    setCandidatesLoading(true);
    setCandidates(null);
    const params = new URLSearchParams({ q: search.query, page: String(search.page), limit: "20" });
    if (search.bandFilter) params.set("band_id", search.bandFilter);
    void getCatalogConsole<CatalogPage<ConsoleSongItem>>(`/songs?${params}`).then(result => {
      if (!current) return;
      setCandidates(result);
      if (selectedSearch.current !== search) {
        const manuallyOpened = selectedSearch.current === null && selectionGeneration > 0;
        selectedSearch.current = search;
        const nextId = resolveConsoleEditSelection(result.items, song => song.song_id, original?.song_id ?? null,
          search.selectFirst ? "query" : "preserve");
        if (search.selectFirst && !manuallyOpened && result.items.length && nextId !== null && selectionGeneration === loadGeneration.current) void loadSong(nextId);
      }
    })
      .catch(e => { if (current) setError(String(e)); })
      .finally(() => { if (current) setCandidatesLoading(false); });
    return () => { current = false; };
  }, [active, creating, search, history.length]);
  useEffect(() => {
    if (!active || !creating || newGroup) return;
    let current = true;
    setGroupsLoading(true); setGroups(null);
    void getSongGroups(groupSearch.query, groupSearch.page).then(result => { if (current) setGroups(result); })
      .catch(e => { if (current) setError(String(e)); })
      .finally(() => { if (current) setGroupsLoading(false); });
    return () => { current = false; };
  }, [active, creating, newGroup, groupSearch]);
  useEffect(() => {
    let current = true;
    setGroupRevision(null);
    if (groupId) void getSongGroup(groupId).then(group => { if (current) setGroupRevision(group.revision); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [groupId]);
  const restore = (song: SongVersion, group: SongGroup | null = originalGroup) => {
    setOriginal(song); setEditDraft(songFields(song));
    setOwner(ownerFields(song)); setOriginalGroup(group); setEditGroup(group);
    setMoveTarget(emptySongMove()); setEditorGeneration(value => value + 1);
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
        ownership,
        move_to_group: moveTarget.group_id && moveTarget.expected_revision ? {
          group_id: moveTarget.group_id, expected_revision: moveTarget.expected_revision, reason: moveTarget.reason.trim(),
        } : null,
      } : null;
      if (!creating && !editPayload) return;
      const payload = creating ? { ...songPayload(draft), version_label: newGroup ? "" : draft.version_label, ownership, ...(newGroup ? { group_name: groupName.trim() } : { group_id: groupId, expected_group_revision: groupRevision }) }
        : editPayload;
      const result = await songCatalogWrite<SongEditMutation>(path, creating ? "POST" : "PUT", payload, csrfToken);
      setHistory(value => [...value, { song: result.item, action: creating ? "create" : "update", summary: creating ? "新增歌曲" : changes.map(change => change.field).join("、") }]);
      if (creating) { if (!newGroup) setGroupRevision(value => value === null ? null : value + 1); if (clearAfterCreate) clear(); } else restore(result.item, result.group);
      setMessage(`已${creating ? "新增" : "更新"}歌曲 #${result.item.song_id} ${result.item.song_name}`);
      setConfirm(false);
      onSaved?.(result.item);
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
      { field: "版本标识", before: original?.version_label ?? "", after: draft.version_label },
      ...coverChanges(original?.cover_urls ?? [], songPayload(draft).cover_urls),
    ].filter(change => creating || change.before !== change.after);
  if (!creating && original) changes.push(...ownershipChanges(ownerFields(original), ownership, bands, members)
    .filter(change => change.before !== change.after));
  if (!creating && groupChanged) changes.push(...[
    { field: "歌曲组名称（整组）", before: originalGroup?.group_name ?? "", after: editGroup?.group_name.trim() ?? "" },
    ...(editGroup?.versions ?? []).map((version, index) => ({
      field: `版本 #${version.song_id} ${version.version_label || "默认版本"} 顺序`,
      before: String((originalGroup?.versions.findIndex(item => item.song_id === version.song_id) ?? -1) + 1), after: String(index + 1),
    })),
  ].filter(change => change.before !== change.after));
  if (!creating && moveTarget.group_id) changes.push(
    { field: "当前版本归组", before: original?.group_name ?? "", after: `${moveTarget.group_name}（移至末尾）` },
    { field: "归组更正原因", before: "", after: moveTarget.reason },
  );
  const visibleHistory = history.filter(entry => entry.action === (creating ? "create" : "update"));
  const fieldsDisabled = busy || confirm || candidatesLoading;
  const { bandOptions, hasBands, hasMembers, ownershipModeField, bandPicker, memberBandPicker, memberPickers } =
    ownershipFields(ownership, bands, members, fieldsDisabled, setOwnership);
  const versionField = <input aria-label="版本标识" disabled={fieldsDisabled || (creating && newGroup) || (!creating && original?.version_label === "")}
    placeholder={(creating && newGroup) || (!creating && original?.version_label === "") ? "默认版本" : "请输入版本标识"}
    value={creating && newGroup ? "" : draft.version_label} onChange={event => setDraft({ ...draft, version_label: event.target.value })} />;
  const formActions = <div className={`console-submit-row ${creating ? "live-admin-insert-row" : "song-submit-row"} venue-create-actions`}>
    {creating && <label className="live-clear-after-create-option"><input type="checkbox" disabled={busy}
      checked={clearAfterCreate} onChange={event => setClearAfterCreate(event.target.checked)} />新增后清空数据</label>}
    <button type="button" className="console-ghost-btn" disabled={fieldsDisabled} onClick={() => { creating ? clear() : restore(original!); setError(""); setMessage(""); }}>{creating ? "清空数据" : "恢复原值"}</button>
    <button type="button" className="console-submit-btn" disabled={fieldsDisabled || (creating && newGroup && !groupName.trim()) || !ownerValid ||
      (!creating && (!changed || !editGroup?.group_name.trim() ||
        (!!moveTarget.group_id && (!moveTarget.expected_revision || !moveTarget.reason.trim())))) || (creating && !newGroup && (!groupId || !groupRevision))}
      onClick={() => {
        const problem = coverUrlsError(filledCovers(draft.cover_urls));
        setError(problem); if (!problem) setConfirm(true);
      }}>{creating ? "提交插入" : "保存修改"}</button>
  </div>;
  if (!active) return null;
  return <section className="tour-admin-section" aria-label={creating ? "新增歌曲" : "歌曲管理"}>
    <ConsoleEditorLock locked={fieldsDisabled}>
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
      <ConsoleEditSelect label="选择要编辑的歌曲" placeholder="选择要编辑的歌曲"
        value={original?.song_id ?? null} disabled={fieldsDisabled}
        selectedOption={original ? { id: original.song_id, label: selectedSongLabel } : undefined}
        options={(candidates?.items ?? []).map(song => ({ id: song.song_id, label: candidateLabel(song) }))}
        onSelect={id => guard(() => void loadSong(id))} />
      <div className="tour-candidate-pager">
        <button type="button" className="console-ghost-btn" disabled={fieldsDisabled || candidatesLoading || !candidates || candidates.page <= 1} onClick={() => setSearch(value => ({ ...value, page: value.page - 1, selectFirst: false }))}>上一页</button>
        <span>{candidatesLoading ? "加载中…" : `第 ${candidates?.page ?? search.page} / ${candidates?.total_pages ?? 1} 页，共 ${candidates?.total ?? 0} 首歌曲`}</span>
        <button type="button" className="console-ghost-btn" disabled={fieldsDisabled || candidatesLoading || !candidates || candidates.page >= candidates.total_pages} onClick={() => setSearch(value => ({ ...value, page: value.page + 1, selectFirst: false }))}>下一页</button>
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
            placeholder="歌曲组名称" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} />
          <button type="button" className="console-ghost-btn" disabled={fieldsDisabled || groupsLoading}
            onClick={() => setGroupSearch({ query: groupQuery.trim(), page: 1 })}>查询</button>
        </div>
        <div className="live-id-selector live-create-tools">
          <label className="live-management-label" htmlFor={`${formId}-group-select`}>选择歌曲组</label>
          <ConsoleChoiceSelect id={`${formId}-group-select`} label="选择歌曲组" disabled={fieldsDisabled || groupsLoading}
            value={groupId} selectedLabel={selectedGroupName} options={(groups?.items ?? []).map(group => ({ id: group.group_id, label: group.group_name }))}
            onChange={id => { setGroupId(id); setSelectedGroupName(groups?.items.find(group => group.group_id === id)?.group_name ?? ""); }} />
          <ConsoleCandidatePager page={groupSearch.page} totalPages={groups?.total_pages ?? groupSearch.page} total={groups?.total ?? 0}
            loading={groupsLoading} onPage={page => setGroupSearch(value => ({ ...value, page }))} />
        </div>
      </>}
      <div className="console-table-wrap">
        <table className="console-admin-table song-create-form-table" data-ownership={ownership.mode} aria-label="新增歌曲资料">
          <colgroup>
            {newGroup && <col />}<col className="song-create-version-column" />
            <col className="song-create-mode-column" />
            {hasBands && <col className="song-create-band-column" />}
            {hasMembers && <col className="song-create-members-column" />}
          </colgroup>
          <thead><tr>
            {newGroup && <th scope="col">歌曲名称</th>}<th scope="col">版本标识</th>
            <th scope="col">归属模式</th>{hasBands && <th scope="col">归属乐队</th>}{hasMembers && <th scope="col">成员所属乐队</th>}
          </tr></thead>
          <tbody><tr>
            {newGroup && <td><input aria-label="歌曲名称" disabled={fieldsDisabled} value={groupName}
              placeholder="请输入歌曲名称" onChange={event => setGroupName(event.target.value)} /></td>}
            <td>{versionField}</td>
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
        <colgroup><col className="song-edit-id-column" /><col className="song-create-version-column" /><col /></colgroup>
        <thead><tr><th scope="col">song_id</th><th scope="col">版本标识</th><th scope="col">所属歌曲组</th></tr></thead>
        <tbody><tr><td><span className="readonly-cell">{original.song_id}</span></td><td>{versionField}</td><td>{editGroup?.group_name ?? original.group_name}</td></tr></tbody>
      </table></div>
      <CoverEditor title="歌曲封面" covers={draft.cover_urls} locked={fieldsDisabled}
        onChange={cover_urls => setDraft({ ...draft, cover_urls })} />
      <section className="song-ownership-editor" aria-label="版本归属">
        <div className="live-admin-status-head"><h3>版本归属</h3><span>影响当前版本及其所有引用处</span></div>
        <div className="console-table-wrap"><table className="console-admin-table song-ownership-table" aria-label="版本归属资料">
          <thead><tr><th scope="col">归属模式</th>{hasBands && <th scope="col">归属乐队</th>}{hasMembers && <th scope="col">成员所属乐队</th>}</tr></thead>
          <tbody><tr><td>{ownershipModeField}</td>{hasBands && <td>{bandPicker}</td>}{hasMembers && <td>{memberBandPicker}</td>}</tr></tbody>
        </table></div>
        {hasMembers && <div className="tour-admin-toolbar song-create-member-fields">{memberPickers}</div>}
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
    {discardDialog}
    {confirm && <ConsoleConfirmDialog title={creating ? "确认新增歌曲" : `确认更新歌曲 #${original!.song_id}`}
      changes={creating ? undefined : changes} changesLabel="歌曲修改内容" busy={busy} error={error} confirmLabel={creating ? "确认提交" : "确认更新"}
      onClose={() => setConfirm(false)} onConfirm={submit}>
      {creating ? <CompactConfirmationTable ariaLabel="新增歌曲确认" rows={[
        ["歌曲名称", newGroup ? groupName.trim() : selectedGroupName],
        ["版本标识", newGroup ? "默认版本" : draft.version_label || "默认版本"],
        ...coverChanges([], songPayload(draft).cover_urls).map(({ field, after }) => [field, after] as const),
        ...ownershipChanges(emptyOwner(), ownership, bands, members)
          .filter(change => change.field === "归属模式" || change.after !== "无")
          .map(({ field, after }) => [field, after] as const),
      ]} /> : null}
    </ConsoleConfirmDialog>}
  </ConsoleEditorLock>
  </section>;
}
