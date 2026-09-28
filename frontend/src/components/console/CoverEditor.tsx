import { useId } from "react";
import { AlbumCover } from "../AlbumCover";

export const coverSummary = (urls: string[]) => urls.map((url, i) => `${i + 1}${i === 0 ? "（默认）" : ""}. ${url}`).join("\n");

export function CoverEditor({ title, urls, locked, onChange }: {
  title: string; urls: string[]; locked: boolean; onChange: (urls: string[]) => void;
}) {
  const id = useId();
  const moveCover = (index: number, target: number) => {
    const next = [...urls];
    next.splice(target, 0, ...next.splice(index, 1));
    onChange(next);
  };
  return (
    <section aria-labelledby={id}>
      <div className="live-admin-status-head setlist-paste-head"><h3 id={id}>{title}</h3>
        <button type="button" className="console-submit-btn" disabled={locked || urls.length >= 20}
        onClick={() => onChange([...urls, ""])}>添加封面</button></div>
      <div className="console-table-wrap setlist-input-wrap"><table className="console-admin-table album-cover-editor" aria-label={title}>
        <colgroup><col className="album-cover-preview-column" /><col /><col className="album-cover-actions-column" /></colgroup>
        <thead><tr><th scope="col">预览</th><th scope="col">封面 URL</th><th scope="col">操作</th></tr></thead><tbody>
      {!urls.length && <tr><td colSpan={3} className="empty-cell">暂无{title}</td></tr>}
      {urls.map((url, index) => <tr key={index}>
        <td>{url.trim() && <AlbumCover url={url} alt={`封面 ${index + 1} 预览`} />}</td>
        <td><input type="url" maxLength={2048} disabled={locked} aria-label={`第 ${index + 1} 张封面 URL`} value={url} placeholder="https://" onChange={e => onChange(urls.map((value, i) => i === index ? e.target.value : value))} /></td>
        <td><div className="tour-admin-toolbar venue-create-actions">
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => moveCover(index, index - 1)}>上移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === urls.length - 1} onClick={() => moveCover(index, index + 1)}>下移</button>
          <button type="button" className="console-ghost-btn" disabled={locked || index === 0} onClick={() => moveCover(index, 0)}>{index === 0 ? "默认" : "设为默认"}</button>
          <button type="button" className="console-ghost-btn" disabled={locked} onClick={() => onChange(urls.filter((_, i) => i !== index))}>移除</button>
        </div></td>
      </tr>)}
    </tbody></table></div>
    </section>
  );
}
