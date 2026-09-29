import { useId } from "react";
import { AlbumCover } from "../AlbumCover";
import type { CoverEntry } from "../../api";

export const coverSummary = (covers: CoverEntry[]) => covers.map(({ url, name }, i) => `${i + 1}${i === 0 ? "（默认）" : ""}. ${name ? `${name} · ` : ""}${url}`).join("\n");

export function CoverEditor({ title, covers, locked, onChange }: {
  title: string; covers: CoverEntry[]; locked: boolean; onChange: (covers: CoverEntry[]) => void;
}) {
  const id = useId();
  const moveCover = (index: number, target: number) => {
    const next = [...covers];
    next.splice(target, 0, ...next.splice(index, 1));
    onChange(next);
  };
  return (
    <section aria-labelledby={id}>
      <div className="live-admin-status-head setlist-paste-head"><h3 id={id}>{title}</h3>
        <button type="button" className="console-submit-btn" disabled={locked || covers.length >= 20}
        onClick={() => onChange([...covers, { url: "", name: "" }])}>添加封面</button></div>
      <div className="console-table-wrap setlist-input-wrap"><table className="console-admin-table album-cover-editor" aria-label={title}>
        <colgroup><col className="album-cover-preview-column" /><col className="album-cover-name-column" /><col /><col className="album-cover-actions-column" /></colgroup>
        <thead><tr><th scope="col">预览</th><th scope="col">名称</th><th scope="col">封面 URL</th><th scope="col">操作</th></tr></thead><tbody>
      {!covers.length && <tr><td colSpan={4} className="empty-cell">暂无{title}</td></tr>}
      {covers.map(({ url, name }, index) => <tr key={index}>
        <td>{url.trim() && <AlbumCover url={url} alt={`封面 ${index + 1} 预览`} />}</td>
        <td><input type="text" maxLength={255} disabled={locked} aria-label={`第 ${index + 1} 张封面名称`} value={name} placeholder="选填" onChange={e => onChange(covers.map((value, i) => i === index ? { ...value, name: e.target.value } : value))} /></td>
        <td><input type="url" maxLength={2048} disabled={locked} aria-label={`第 ${index + 1} 张封面 URL`} value={url} placeholder="https://" onChange={e => onChange(covers.map((value, i) => i === index ? { ...value, url: e.target.value } : value))} /></td>
        <td><div className="tour-admin-toolbar venue-create-actions">
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => moveCover(index, index - 1)}>上移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === covers.length - 1} onClick={() => moveCover(index, index + 1)}>下移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => moveCover(index, 0)}>{index === 0 ? "默认" : "设为默认"}</button>
          <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => onChange(covers.filter((_, i) => i !== index))}>移除</button>
        </div></td>
      </tr>)}
    </tbody></table></div>
    </section>
  );
}
