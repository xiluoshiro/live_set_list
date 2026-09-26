import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Position } from "./types";

export function ConsoleMultiSelect({ label, options, value, disabled = false, hideLabel = false, onChange }: {
  label: string;
  options: { id: number; label: string }[];
  value: number[];
  disabled?: boolean;
  hideLabel?: boolean;
  onChange: (value: number[]) => void;
}) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0, width: 0 });
  const summary = value.map(id => options.find(option => option.id === id)?.label ?? `#${id}`).join("、") || "请选择";

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      const height = menu.current?.getBoundingClientRect().height ?? 0;
      const below = rect.bottom + 6;
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 6),
      });
    };
    const onDown = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    place();
    menu.current?.querySelector<HTMLInputElement>("input")?.focus();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onFocus);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, position.width, options.length]);

  return <fieldset className="tour-band-field" disabled={disabled}>
    {!hideLabel && <legend>{label}</legend>}
    <button ref={trigger} type="button" className="bands-picker-trigger tour-band-trigger default-band-picker-trigger"
      aria-label={`选择${label}`} aria-expanded={open} aria-controls={open ? menuId : undefined}
      title={summary} onClick={() => setOpen(current => !current)}>{summary}</button>
    {open && !disabled && createPortal(<div ref={menu} id={menuId} className="bands-floating-menu"
      role="group" aria-label={`${label}选项`} style={position}>
      {options.map(option => <label key={option.id}>
        <input type="checkbox" checked={value.includes(option.id)} onChange={event => onChange(event.target.checked
          ? [...value, option.id] : value.filter(id => id !== option.id))} />
        <span>{option.label}</span>
      </label>)}
      {options.length === 0 && <p className="console-admin-hint">没有匹配的结果</p>}
    </div>, document.body)}
  </fieldset>;
}
