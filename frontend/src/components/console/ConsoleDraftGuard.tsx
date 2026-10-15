import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ConsoleConfirmDialog } from "./ConsoleConfirmDialog";

export type ConsoleLeaveGuard = (proceed: () => void) => void;
type Draft = { dirty: boolean; busy: boolean; label: string; discard: () => void };
const DraftContext = createContext<{
  register: (id: string, draft: Draft | null) => void; leave: ConsoleLeaveGuard;
} | null>(null);

/** Coordinates all active editors, including nested ones and navigation out of Console. */
export function ConsoleDraftProvider({ children, onLeaveGuard }: {
  children: ReactNode; onLeaveGuard?: (guard: ConsoleLeaveGuard | null) => void;
}) {
  const drafts = useRef(new Map<string, Draft>());
  const id = useId();
  const [pending, setPending] = useState<{ drafts: Draft[]; proceed: () => void } | null>(null);
  const pendingRef = useRef<typeof pending>(null);
  const register = useCallback((id: string, draft: Draft | null) => {
    if (draft) drafts.current.set(id, draft); else drafts.current.delete(id);
  }, []);
  const leave = useCallback<ConsoleLeaveGuard>(proceed => {
    const active = [...drafts.current.values()];
    if (pendingRef.current || active.some(draft => draft.busy)) return;
    const changed = active.filter(draft => draft.dirty);
    if (!changed.length) { proceed(); return; }
    pendingRef.current = { drafts: changed, proceed };
    setPending(pendingRef.current);
  }, []);
  const context = useRef({ register, leave }).current;
  useEffect(() => { onLeaveGuard?.(leave); return () => onLeaveGuard?.(null); }, [leave, onLeaveGuard]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if ([...drafts.current.values()].some(draft => draft.dirty || draft.busy)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  const close = () => { pendingRef.current = null; setPending(null); };
  return <DraftContext.Provider value={context}>{children}
    {pending && <ConsoleConfirmDialog title="未保存的修改" describedBy={`${id}-description`}
      cancelLabel="继续编辑" confirmLabel="放弃修改" onClose={close}
      onConfirm={() => { pending.drafts.forEach(draft => draft.discard()); close(); pending.proceed(); }}>
      <p id={`${id}-description`} className="console-admin-hint">{pending.drafts.map(draft => draft.label).join("、")} 有未保存修改。离开后将丢弃这些修改。</p>
    </ConsoleConfirmDialog>}
  </DraftContext.Provider>;
}

export function useConsoleLeaveGuard() { return useContext(DraftContext)?.leave ?? ((proceed: () => void) => proceed()); }

export function useConsoleDraftGuard({ dirty, busy = false, active = true, label, onDiscard }: {
  dirty: boolean; busy?: boolean; active?: boolean; label: string; onDiscard?: () => void;
}) {
  const context = useContext(DraftContext);
  const id = useId();
  const latest = useRef({ dirty, busy, active, onDiscard });
  latest.current = { dirty, busy, active, onDiscard };
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = useCallback<ConsoleLeaveGuard>(proceed => {
    const current = latest.current;
    if (current.busy) return;
    if (current.active && current.dirty) setPending(() => proceed); else proceed();
  }, []);
  useLayoutEffect(() => {
    context?.register(id, active ? { dirty, busy: busy || pending !== null, label, discard: () => latest.current.onDiscard?.() } : null);
    return () => context?.register(id, null);
  }, [context, id, active, dirty, busy, label, pending]);
  useEffect(() => { if (!active) setPending(null); }, [active]);
  const dialog = pending && <ConsoleConfirmDialog title="未保存的修改" describedBy={`${id}-description`}
    busy={busy} cancelLabel="继续编辑" confirmLabel="放弃修改" onClose={() => setPending(null)}
    onConfirm={() => { latest.current.onDiscard?.(); setPending(null); pending(); }}>
    <p id={`${id}-description`} className="console-admin-hint">{label} 有未保存修改。离开后将丢弃这些修改。</p>
  </ConsoleConfirmDialog>;
  return { guard, dialog };
}
