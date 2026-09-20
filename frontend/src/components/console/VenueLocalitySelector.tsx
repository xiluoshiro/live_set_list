import { useEffect, useId, useRef, useState } from "react";
import { getConsoleLocalities, type GeoLocality } from "../../api";
import { ChoiceMenu } from "./ChoiceMenu";
import type { Position } from "./types";

export const localityLabel = (item: GeoLocality) => [item.country_code, item.admin_area, item.locality_name].filter(Boolean).join(" / ");

export async function loadVenueLocalities(query = ""): Promise<GeoLocality[]> {
  const first = await getConsoleLocalities(query, 1);
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / first.page_size) - 1) },
    (_, index) => getConsoleLocalities(query, index + 2)));
  return [first, ...rest].flatMap(page => page.items);
}

export function VenueLocalitySelector({ locality, cities, query, disabled, onQuery, onSearch, onSelect }: {
  locality: GeoLocality | null; cities: GeoLocality[]; query: string; disabled: boolean;
  onQuery: (query: string) => void; onSearch: (query: string) => void; onSelect: (locality: GeoLocality) => void;
}) {
  const id = useId();
  const [menuPosition, setMenuPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const options = [...new Map([...cities, ...(locality ? [locality] : [])].map(item => [item.id, item])).values()];
  useEffect(() => { if (disabled) setMenuPosition(null); }, [disabled]);
  useEffect(() => {
    if (!menuPosition) return;
    const close = () => setMenuPosition(null);
    const outside = (event: MouseEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); triggerRef.current?.focus(); } };
    window.addEventListener("mousedown", outside); window.addEventListener("resize", close);
    window.addEventListener("scroll", close); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close); window.removeEventListener("keydown", key); };
  }, [menuPosition]);
  const toggleMenu = () => {
    if (menuPosition) { setMenuPosition(null); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
    const height = Math.min(320, window.innerHeight * 0.6);
    setMenuPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4) });
  };

  return <>
      <div className="live-id-selector live-create-query-row">
        <label className="live-management-label" htmlFor={`${id}-query`}>查询地区</label>
        <input id={`${id}-query`} className="venue-query-input live-management-primary-control" aria-label="搜索地区"
          placeholder="输入国家、行政区或城市" maxLength={120} value={query} disabled={disabled}
          onChange={e => onQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onSearch(query.trim()); }} />
        <button type="button" className="console-ghost-btn" disabled={disabled} onClick={() => onSearch(query.trim())}>查询</button>
      </div>
      <div className="live-id-selector live-create-tools">
        <label className="live-management-label" htmlFor={`${id}-select`}>选择地区</label>
        <button id={`${id}-select`} ref={triggerRef} type="button"
          className="bands-picker-trigger venue-picker-trigger live-management-primary-control" aria-label="已公布地区"
          aria-expanded={!!menuPosition} title={locality ? localityLabel(locality) : undefined}
          disabled={disabled} onClick={toggleMenu}>{locality ? localityLabel(locality) : "请选择地区"}</button>
        {menuPosition && <ChoiceMenu position={menuPosition} menuRef={menuRef} name={id}
          options={options.map(item => ({ id: item.id, label: localityLabel(item) }))} selectedId={locality?.id ?? null}
          onSelect={id => { const item = options.find(item => item.id === id); if (item) onSelect(item); setMenuPosition(null); }} />}

      </div>
  </>;
}
