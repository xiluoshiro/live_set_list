import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getSongGroup, getSongGroups, type CatalogPage, type SongGroup, type SongGroupSummary, type SongVersion, type SongVersionDraft } from "../../api";
import { ownershipLabel } from "../SongCatalog";
import { ConsoleChoiceSelect, ConsoleCandidatePager } from "./ConsoleChoiceSelect";

export type SongMoveDraft = { group_id: number | null; group_name: string; expected_revision: number | null; reason: string };
export const emptySongMove = (): SongMoveDraft => ({ group_id: null, group_name: "", expected_revision: null, reason: "" });

// All edits belong to the parent's draft. This section never writes independently.
export function SongGroupEditor({ song, group, currentDraft, currentOwner, target, locked, onChange, onTargetChange }: {
  song: SongVersion; group: SongGroup; currentDraft: SongVersionDraft; currentOwner: string;
  target: SongMoveDraft; locked: boolean;
  onChange: (group: SongGroup) => void;
  onTargetChange: Dispatch<SetStateAction<SongMoveDraft>>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<CatalogPage<SongGroupSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded || song.version_label === "") return;
    let current = true;
    setLoading(true); setGroups(null); setError("");
    void getSongGroups(query, page).then(result => { if (current) setGroups(result); })
      .catch(e => { if (current) setError(String(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [expanded, song.version_label, query, page]);
  useEffect(() => {
    setTargetError("");
    if (!target.group_id) return;
    let current = true;
    const id = target.group_id;
    void getSongGroup(id).then(result => {
      if (current) onTargetChange(value => value.group_id === id
        ? { ...value, expected_revision: result.revision, group_name: result.group_name } : value);
    }).catch(e => { if (current) setTargetError(String(e)); });
    return () => { current = false; };
  }, [target.group_id, retry, onTargetChange]);
  const move = (index: number, delta: number) => {
    const versions = [...group.versions];
    [versions[index], versions[index + delta]] = [versions[index + delta], versions[index]];
    onChange({ ...group, versions });
  };
  return <section className="song-group-editor" aria-label="歌曲组与版本">
    <div className="live-admin-status-head"><h3>歌曲组与版本</h3><span>组名与排序影响本组全部版本</span></div>
    <div className="console-table-wrap"><table className="console-admin-table song-group-form-table" aria-label="歌曲组资料">
      <colgroup><col className="song-edit-id-column" /><col /><col className="song-edit-id-column" /></colgroup>
      <thead><tr><th scope="col">group_id</th><th scope="col">歌曲组名称</th><th scope="col">版本数</th></tr></thead>
      <tbody><tr><td>{group.group_id}</td><td><input aria-label="歌曲组名称" disabled={locked} value={group.group_name}
        placeholder="请输入歌曲组名称" onChange={e => onChange({ ...group, group_name: e.target.value })} /></td><td>{group.versions.length}</td></tr></tbody>
    </table></div>
    <div className="console-table-wrap"><table className="console-admin-table song-version-table" aria-label="歌曲版本顺序">
      <colgroup><col className="song-edit-order-column" /><col className="song-edit-id-column" /><col /><col /><col /><col className="song-edit-actions-column" /></colgroup>
      <thead><tr><th scope="col">顺序</th><th scope="col">song_id</th><th scope="col">歌曲名称</th><th scope="col">版本标识</th><th scope="col">归属</th><th scope="col">操作</th></tr></thead>
      <tbody>{group.versions.map((version, i) => {
        const current = version.song_id === song.song_id;
        return <tr key={version.song_id} aria-current={current ? "true" : undefined}>
          <td>{i + 1}</td><td>{version.song_id}{current && <span className="song-current-version">当前</span>}</td>
          <td>{current ? currentDraft.song_name : version.song_name}</td><td>{(current ? currentDraft.version_label : version.version_label) || "默认版本"}</td>
          <td>{current ? currentOwner : ownershipLabel(version)}</td><td><div className="tour-admin-toolbar venue-create-actions">
            <button type="button" className="console-ghost-btn" disabled={locked || i === 0} onClick={() => move(i, -1)}>上移</button>
            <button type="button" className="console-ghost-btn" disabled={locked || i === group.versions.length - 1} onClick={() => move(i, 1)}>下移</button>
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>更正当前版本归组{target.group_id ? `：${target.group_name}（未保存）` : ""}</summary>
      {expanded && (song.version_label === "" ? <p className="console-admin-hint">默认版本须保留在所属歌曲组中，不能更正归组。</p> : <>
        <div className="tour-admin-toolbar">
          <label>搜索歌曲组<input disabled={locked} placeholder="歌曲组名称" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
          <ConsoleChoiceSelect label="目标歌曲组" value={target.group_id} selectedLabel={target.group_name} disabled={locked || loading}
            options={(groups?.items ?? []).filter(g => g.group_id !== song.group_id).map(g => ({ id: g.group_id, label: g.group_name }))}
            onChange={id => { onTargetChange(value => ({ ...value, group_id: id, expected_revision: null,
              group_name: groups?.items.find(g => g.group_id === id)?.group_name ?? `#${id}` })); setRetry(value => value + 1); }} />
          <ConsoleCandidatePager page={page} totalPages={groups?.total_pages ?? page} total={groups?.total ?? 0} loading={loading} disabled={locked} onPage={setPage} />
          {target.group_id && <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => onTargetChange(emptySongMove())}>保持当前组</button>}
        </div>
        {error && <p role="alert">歌曲组查询失败：{error}</p>}
        {targetError && <p role="alert">目标组加载失败：{targetError} <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => setRetry(value => value + 1)}>重试</button></p>}
        {target.group_id && target.expected_revision === null && !targetError && <p role="status">正在加载目标歌曲组…</p>}
        <label className="song-correction-reason">归组更正原因<input disabled={locked} maxLength={1000} aria-required={!!target.group_id} placeholder="请输入归组更正原因"
          value={target.reason} onChange={e => onTargetChange(value => ({ ...value, reason: e.target.value }))} /></label>
        {target.group_id && <p className="console-admin-hint">保存后当前版本移至目标组末尾；上表的组名与排序修改仍作用于原歌曲组。</p>}
      </>)}
    </details>
  </section>;
}
