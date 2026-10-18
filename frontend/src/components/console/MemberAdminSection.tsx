import { ConsoleEditorLock } from "./ConsoleEditorLock";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";
import { useConsoleDraftGuard } from "./ConsoleDraftGuard";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { useEffect, useState } from "react";
import { getCatalogConsole, songCatalogWrite, type CatalogMember } from "../../api";
import { useAuth } from "../../auth/AuthProvider";

export function MemberAdminSection() {
  const { csrfToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<CatalogMember[]>([]);
  const [selected, setSelected] = useState<CatalogMember | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void getCatalogConsole<{ items: CatalogMember[] }>("/members").then(result => { if (current) setMembers(result.items); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [open]);
  const dirty = !!selected && name.trim() !== selected.display_name;
  const { guard, dialog: discardDialog } = useConsoleDraftGuard({ dirty, busy: busy || confirm,
    label: `成员 #${selected?.member_id}`, onDiscard: () => setName(selected?.display_name ?? "") });
  const save = async () => {
    if (!csrfToken) return;
    setBusy(true); setError("");
    try {
      const member = await songCatalogWrite<CatalogMember>(selected ? `/members/${selected.member_id}` : "/members", selected ? "PUT" : "POST",
        { display_name: name.trim(), ...(selected ? { expected_revision: selected.revision } : {}) }, csrfToken);
      setMembers(value => [...value.filter(m => m.member_id !== member.member_id), member].sort((a, b) => a.member_id - b.member_id));
      setSelected(member); setName(member.display_name); setConfirm(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>成员管理</summary>
    {error && !confirm && <p role="alert">{error}</p>}
    <ConsoleEditorLock locked={busy || confirm}><div className="tour-admin-fields">
      <label>成员<select value={selected?.member_id ?? ""} disabled={busy} onChange={e => { const m = members.find(m => m.member_id === Number(e.target.value)) ?? null; guard(() => { setSelected(m); setName(m?.display_name ?? ""); }); }}><option value="">新增成员</option>{members.map(m => <option key={m.member_id} value={m.member_id}>#{m.member_id} {m.display_name}</option>)}</select></label>
      <label>姓名<input value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
      <button type="button" className="console-submit-btn" disabled={busy || !name.trim() || name.trim() === selected?.display_name} onClick={() => { setError(""); setConfirm(true); }}>{selected ? "保存修改" : "提交插入"}</button>
    </div></ConsoleEditorLock>
    {discardDialog}
    {confirm && <ConsoleConfirmDialog title={selected ? `确认更新成员 #${selected.member_id}` : "确认新增成员"}
      changes={selected ? [{ field: "姓名", before: selected.display_name, after: name.trim() }] : undefined} changesLabel="成员修改内容"
      busy={busy} error={error} confirmLabel={selected ? "确认更新" : "确认提交"}
      onClose={() => setConfirm(false)} onConfirm={save}>
      {selected ? null :
        <CompactConfirmationTable rows={[["姓名", name.trim()]]} />}
    </ConsoleConfirmDialog>}
  </details>;
}
