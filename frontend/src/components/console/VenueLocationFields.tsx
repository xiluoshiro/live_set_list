import type { ReactNode } from "react";

export function VenueLocationFields({ ariaLabel, name, kind, physical, online, disabled, zonesLoading = false,
  address, latitude, longitude, timezone, zones, onAddress, onLatitude, onLongitude, onTimezone }: {
  ariaLabel: string; name: ReactNode; kind: ReactNode; physical: boolean; online: boolean;
  disabled: boolean; zonesLoading?: boolean;
  address: string; latitude: string; longitude: string; timezone: string; zones: string[];
  onAddress: (value: string) => void; onLatitude: (value: string) => void;
  onLongitude: (value: string) => void; onTimezone: (value: string) => void;
}) {
  return (
      <div className="console-table-wrap">
        <table className="console-admin-table venue-create-form-table" aria-label={ariaLabel}>
          <colgroup><col className="venue-create-name-column" /><col className="venue-create-kind-column" /><col /><col className="venue-create-coordinate-column" /><col className="venue-create-coordinate-column" /><col className="venue-create-timezone-column" /></colgroup>
          <thead><tr><th scope="col">名称</th><th scope="col">类型</th><th scope="col">公开门牌地址</th><th scope="col">纬度（WGS84）</th><th scope="col">经度（WGS84）</th><th scope="col">场馆精确时区</th></tr></thead>
          <tbody><tr>
            <td>{name}</td>
            <td>{kind}</td>
            <td><input aria-label="公开门牌地址" required={physical} placeholder={physical ? "请输入地址（必填）" : "不适用"} maxLength={500} value={address} disabled={disabled || !physical} onChange={e => onAddress(e.target.value)} /></td>
            <td><input aria-label="纬度（WGS84）" inputMode="decimal" value={latitude} disabled={disabled || !physical} onChange={e => onLatitude(e.target.value)} /></td>
            <td><input aria-label="经度（WGS84）" inputMode="decimal" value={longitude} disabled={disabled || !physical} onChange={e => onLongitude(e.target.value)} /></td>
            <td><select aria-label="场馆精确时区" value={timezone} disabled={disabled || zonesLoading || online} onChange={e => onTimezone(e.target.value)}><option value="" disabled>{online ? "不适用" : "请选择时区（必填）"}</option>{[...new Set([...zones, ...(timezone ? [timezone] : [])])].map(zone => <option key={zone}>{zone}</option>)}</select></td>
          </tr></tbody>
        </table>
      </div>
  );
}
