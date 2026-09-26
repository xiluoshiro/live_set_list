import { useEffect, useState } from "react";
import { getSongGroup, getSongGroups, songCatalogWrite, type SongGroup, type SongGroupSummary, type SongVersion } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { UpdateDiffTable } from "./UpdateDiffTable";

export function SongGroupEditor({ song, onSaved, onClose }: { song: SongVersion; onSaved: () => void; onClose: () => void }) {
  const { csrfToken } = useAuth();
  const [original, setOriginal] = useState<SongGroup | null>(null);
  const [draft, setDraft] = useState<SongGroup | null>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SongGroupSummary[]>([]);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"group" | "move" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    void getSongGroup(song.group_id).then(group => { if (current) { setOriginal(group); setDraft(group); } }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [song.group_id]);
  useEffect(() => {
    let current = true;
    void getSongGroups(query).then(result => { if (current) setGroups(result.items); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [query]);
  const save = async () => {
    if (!csrfToken || !draft || !original || !confirm) return;
    setBusy(true); setError("");
    try {
      if (confirm === "group") await songCatalogWrite(`/song-groups/${song.group_id}`, "PUT", {
        expected_revision: original.revision, group_name: draft.group_name, song_ids: draft.versions.map(v => v.song_id),
      }, csrfToken);
      else await songCatalogWrite(`/songs/${song.song_id}/group`, "PUT", { group_id: Number(target), expected_revision: song.revision, reason }, csrfToken);
      onSaved();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const move = (index: number, delta: number) => {
    if (!draft) return;
    const versions = [...draft.versions];
    [versions[index], versions[index + delta]] = [versions[index + delta], versions[index]];
    setDraft({ ...draft, versions });
  };
  return <div className="modal-mask"><div className="modal compact console-confirm-modal" role="dialog" aria-modal="true" aria-label="歌曲组管理">
    <div className="modal-head"><h2>歌曲组管理</h2></div>
    {error && <p role="alert">{error}</p>}
    {draft && original && <div className="console-confirm-body">
      {confirm ? <UpdateDiffTable changes={confirm === "move" ? [
        { field: "歌曲组", before: original.group_name, after: groups.find(g => String(g.group_id) === target)?.group_name ?? target },
        { field: "原因", before: "", after: reason },
      ] : [
        { field: "组名", before: original.group_name, after: draft.group_name },
        { field: "版本顺序", before: original.versions.map(v => v.version_label || v.song_name).join(" / "), after: draft.versions.map(v => v.version_label || v.song_name).join(" / ") },
      ]} /> : <>
        <div className="tour-admin-fields">
          <label className="band-admin-members-field">歌曲组名称<input value={draft.group_name} onChange={e => setDraft({ ...draft, group_name: e.target.value })} /></label>
        </div>
        <div className="console-table-wrap">
          <table className="console-admin-table console-compact-table" aria-label="歌曲版本顺序">
            <thead><tr><th>版本</th><th>操作</th></tr></thead>
            <tbody>{draft.versions.map((version, i) => <tr key={version.song_id}>
              <td>{version.version_label || version.song_name}</td>
              <td><div className="tour-admin-toolbar">
                <button type="button" className="console-ghost-btn" disabled={i === 0} onClick={() => move(i, -1)}>上移</button>
                <button type="button" className="console-ghost-btn" disabled={i === draft.versions.length - 1} onClick={() => move(i, 1)}>下移</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="console-submit-row song-submit-row">
          <button type="button" className="console-submit-btn" disabled={!draft.group_name.trim() || JSON.stringify(draft) === JSON.stringify(original)} onClick={() => setConfirm("group")}>保存组名与顺序</button>
        </div>
        <div className="tour-admin-block">
          <h3>更正当前版本归组</h3>
          <div className="tour-admin-fields">
            <label>搜索歌曲组<input value={query} onChange={e => { setQuery(e.target.value); setTarget(""); }} /></label>
            <label>目标歌曲组<select value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择</option>{groups.filter(g => g.group_id !== song.group_id).map(g => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}</select></label>
            <label className="band-admin-members-field">更正原因<input value={reason} onChange={e => setReason(e.target.value)} /></label>
          </div>
          <div className="console-submit-row">
            <button type="button" className="console-submit-btn" disabled={!target || !reason.trim()} onClick={() => setConfirm("move")}>更正归组</button>
          </div>
        </div>
      </>}
    </div>}
    <div className="console-confirm-actions">
      <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => confirm ? setConfirm(null) : onClose()}>{confirm ? "返回编辑" : "关闭"}</button>
      {confirm && <button type="button" className="console-submit-btn" disabled={busy} onClick={() => void save()}>确认保存</button>}
    </div>
  </div></div>;
}
