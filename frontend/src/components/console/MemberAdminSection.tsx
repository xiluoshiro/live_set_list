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
  const save = async () => {
    if (!csrfToken) return;
    setBusy(true); setError("");
    try {
      const member = await songCatalogWrite<CatalogMember>(selected ? `/members/${selected.member_id}` : "/members", selected ? "PUT" : "POST",
        { display_name: name, ...(selected ? { expected_revision: selected.revision } : {}) }, csrfToken);
      setMembers(value => [...value.filter(m => m.member_id !== member.member_id), member].sort((a, b) => a.member_id - b.member_id));
      setSelected(member); setName(member.display_name); setConfirm(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>成员管理</summary>
    {error && <p role="alert">{error}</p>}
    <div className="tour-admin-fields">
      <label>成员<select value={selected?.member_id ?? ""} disabled={busy} onChange={e => { const m = members.find(m => m.member_id === Number(e.target.value)) ?? null; setSelected(m); setName(m?.display_name ?? ""); }}><option value="">新增成员</option>{members.map(m => <option key={m.member_id} value={m.member_id}>#{m.member_id} {m.display_name}</option>)}</select></label>
      <label>姓名<input value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim() || name === selected?.display_name} onClick={() => setConfirm(true)}>{selected ? "保存修改" : "提交插入"}</button>
    </div>
    {confirm && <div className="modal-mask"><div className="modal compact" role="dialog" aria-modal="true" aria-label="确认成员资料"><h2>确认成员资料</h2><p>{selected ? `#${selected.member_id} ${selected.display_name} → ${name}` : name}</p><div className="console-confirm-actions"><button disabled={busy} onClick={() => setConfirm(false)}>取消</button><button disabled={busy} onClick={() => void save()}>确认提交</button></div></div></div>}
  </details>;
}
