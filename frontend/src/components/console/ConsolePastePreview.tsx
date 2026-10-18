import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function ConsolePastePreview({ rows, warnings, onOpenDetails, disabled = false }: {
  rows: { key: string | number; summary: ReactNode }[];
  warnings: string[];
  onOpenDetails: () => void;
  disabled?: boolean;
}) {
  if (!rows.length && !warnings.length) return null;
  return <div className="setlist-paste-preview">
    <p className="setlist-paste-summary">预览：{rows.length} 行，提示 {warnings.length} 条</p>
    {warnings.length > 0 && <ul className="setlist-paste-warnings">
      {warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
    </ul>}
    {rows.length > 0 && <div className="setlist-paste-preview-list">
      {rows.slice(0, 3).map(row => <span key={row.key}>{row.summary}</span>)}
      <button type="button" className="setlist-preview-more-btn" disabled={disabled} onClick={onOpenDetails}>
        {rows.length > 3 ? `... 还有 ${rows.length - 3} 行，查看全部` : "显示详情"}
      </button>
    </div>}
  </div>;
}

export function ConsolePastePreviewDetails({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  return createPortal(<div className="song-modal-backdrop" role="presentation" onClick={onClose}>
    <div className="song-modal setlist-full-preview-modal" role="dialog" aria-label={title}
      onClick={event => event.stopPropagation()}>
      <div className="song-modal-header">
        <strong>{title}</strong>
        <button type="button" className="modal-action-btn close" aria-label="关闭完整预览" onClick={onClose}>
          <span className="modal-action-glyph close">✕</span>
        </button>
      </div>
      {children}
    </div>
  </div>, document.body);
}
