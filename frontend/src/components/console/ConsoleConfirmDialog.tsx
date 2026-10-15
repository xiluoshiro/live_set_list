import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UpdateDiffTable, type UpdateChange } from "./UpdateDiffTable";

const dialogs: string[] = [];
const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';

/** Shared confirmation shell: every exit respects busy, and focus stays in the top dialog. */
export function ConsoleConfirmDialog({ title, children, onClose, onConfirm, busy = false, error,
  confirmLabel = "确认更新", cancelLabel = "取消", disabled = false, size = "compact", className = "", describedBy, changes, changesLabel,
}: {
  title: string; children: ReactNode; onClose: () => void; onConfirm: () => void | Promise<void>;
  busy?: boolean; error?: string; confirmLabel?: string; cancelLabel?: string; disabled?: boolean;
  size?: "compact" | "wide"; className?: string; describedBy?: string;
  changes?: UpdateChange[]; changesLabel?: string;
}) {
  const id = useId();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");
  const running = useRef(false);
  busy = busy || submitting;
  disabled = disabled || (changes !== undefined && changes.every(change => change.before === change.after));
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ busy, onClose });
  callbacks.current = { busy, onClose };
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogs.push(id);
    const background = Array.from(document.body.children).filter(element => !element.contains(ref.current));
    const states = background.map(element => ({ element, inert: (element as HTMLElement).inert }));
    states.forEach(({ element }) => { (element as HTMLElement).inert = true; });
    ref.current?.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.focus();
    const key = (event: KeyboardEvent) => {
      if (dialogs[dialogs.length - 1] !== id) return;
      if (event.key === "Escape") {
        // A selector inside the dialog owns the first Escape; the next closes the dialog.
        if ((event.target as Element | null)?.closest('[data-console-popover]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!callbacks.current.busy) callbacks.current.onClose();
      } else if (event.key === "Tab") {
        const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); ref.current?.focus(); }
        else if (!ref.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      dialogs.splice(dialogs.indexOf(id), 1);
      document.removeEventListener("keydown", key, true);
      states.forEach(({ element, inert }) => { (element as HTMLElement).inert = inert; });
      queueMicrotask(() => { if (previous?.isConnected && !previous.closest('[inert]')) previous.focus(); });
    };
  }, [id]);
  const close = () => { if (!busy) onClose(); };
  const confirm = async () => {
    if (busy || disabled || running.current) return;
    running.current = true; setSubmitting(true); setFailure("");
    try { await onConfirm(); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { running.current = false; setSubmitting(false); }
  };
  return createPortal(<div className="modal-mask" onClick={event => { event.stopPropagation(); close(); }}>
    <div ref={ref} tabIndex={-1} className={`modal console-confirm-modal ${size} ${className}`}
      role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={describedBy}
      aria-busy={busy} onClick={event => event.stopPropagation()}>
      <div className="modal-head"><h2 id={`${id}-title`}>{title}</h2><div className="modal-actions">
        <button type="button" className="modal-action-btn close" aria-label="关闭" disabled={busy} onClick={close}>
          <span className="modal-action-glyph close">✕</span>
        </button>
      </div></div>
      <div className="console-confirm-body">
        {changes && <UpdateDiffTable changes={changes} ariaLabel={changesLabel} />}
        {children}{(error || failure) && <p role="alert">{error || failure}</p>}
      </div>
      <div className="console-confirm-actions">
        <button type="button" data-confirm-cancel className="console-ghost-btn" disabled={busy} onClick={close}>{cancelLabel}</button>
        <button type="button" className="console-submit-btn" disabled={busy || disabled} onClick={() => void confirm()}>{busy ? "提交中…" : confirmLabel}</button>
      </div>
    </div>
  </div>, document.body);
}
