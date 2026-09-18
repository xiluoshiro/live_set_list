import type { RefObject } from "react";
import type { Position } from "./types";

export function ChoiceMenu({ position, menuRef, name, options, selectedId, onSelect }: {
  position: Position; menuRef: RefObject<HTMLDivElement>; name: string;
  options: { id: number; label: string }[]; selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return <div className="bands-floating-menu" ref={menuRef}
    onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    style={{ top: position.top, left: position.left, width: position.width }}>
    {options.map(option => <label key={option.id}>
      <input type="radio" name={name} checked={selectedId === option.id} onChange={() => onSelect(option.id)} />
      <span>{option.label}</span>
    </label>)}
    {options.length === 0 && <p className="console-admin-hint">没有匹配的结果</p>}
  </div>;
}
