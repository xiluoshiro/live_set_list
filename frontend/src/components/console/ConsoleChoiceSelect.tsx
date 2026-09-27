import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChoiceMenu } from "./ChoiceMenu";
import type { Position } from "./types";

export function ConsoleChoiceSelect({ id, label, options, value, selectedLabel, disabled, onChange }: {
  id?: string; label: string; options: { id: number; label: string }[]; value: number | null;
  selectedLabel: string; disabled?: boolean; onChange: (id: number) => void;
}) {
  const name = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const open = position !== null;
  useEffect(() => { if (disabled) setPosition(null); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = menu.current.getBoundingClientRect().height;
    const top = rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    setPosition(current => current ? { ...current, top } : null);
  }, [open, options.length]);
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const outside = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); trigger.current?.focus(); }
    };
    menu.current?.querySelector<HTMLInputElement>("input:checked, input")?.focus();
    window.addEventListener("mousedown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
      window.removeEventListener("keydown", key);
    };
  }, [position]);
  return <>
    <button id={id} ref={trigger} type="button" aria-label={label} aria-expanded={!!position}
      className="bands-picker-trigger venue-picker-trigger live-management-primary-control"
      disabled={disabled} title={selectedLabel || undefined} onClick={() => {
        if (position) { setPosition(null); return; }
        const rect = trigger.current!.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
        const height = Math.min(320, window.innerHeight * 0.6);
        setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4) });
      }}>{selectedLabel || "请选择"}</button>
    {position && !disabled && createPortal(<ChoiceMenu position={position} menuRef={menu} name={name}
      options={options} selectedId={value} onSelect={id => {
        onChange(id); setPosition(null); trigger.current?.focus();
      }} />, trigger.current?.closest('[role="dialog"]') ?? document.body)}
  </>;
}

export function ConsoleCandidatePager({ page, totalPages, total, loading, disabled = false, onPage }: {
  page: number; totalPages: number; total: number; loading: boolean; disabled?: boolean; onPage: (page: number) => void;
}) {
  return <div className="tour-candidate-pager">
    <button type="button" className="console-ghost-btn" disabled={disabled || loading || page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
    <span className="live-page-status" aria-live="polite">{loading ? "加载中…" : `第 ${page} / ${totalPages} 页，共 ${total} 条`}</span>
    <button type="button" className="console-ghost-btn" disabled={disabled || loading || page >= totalPages} onClick={() => onPage(page + 1)}>下一页</button>
  </div>;
}
