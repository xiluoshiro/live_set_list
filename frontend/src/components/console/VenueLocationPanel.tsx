import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createConsoleLocality, deleteConsoleVenueMapLink, getConsoleLocalities,
  getConsoleTimezones, getConsoleVenueLocation, previewConsoleVenueLocation,
  saveConsoleVenueLocation, saveConsoleVenueMapLink,
  type GeoLocality, type GeoLocalityPage, type MapProvider, type VenueLocation, type VenueLocationWrite,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";

const PROVIDERS: Record<MapProvider, string> = { google: "Google Maps", apple: "Apple Maps", amap: "高德地图" };
const cityLabel = (city: GeoLocality) => [city.country_code, city.admin_area, city.locality_name].filter(Boolean).join(" / ");
const pointLabel = (point: { latitude: number | null; longitude: number | null }) =>
  point.latitude === null ? "未填写" : `${point.latitude}, ${point.longitude}`;
type Confirmation = {
  title: string;
  rows: ReadonlyArray<readonly [string, ReactNode]>;
  confirmLabel?: "提交插入" | "保存修改" | "取消关联";
  run: () => Promise<void>;
};

export function VenueLocationPanel({ venueId, venueKind }: { venueId: number; venueKind: string }) {
  const auth = useAuth();
  const [data, setData] = useState<VenueLocation | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [cities, setCities] = useState<GeoLocalityPage>({ items: [], total: 0, page: 1, page_size: 20 });
  const [cityQuery, setCityQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<GeoLocality | null>(null);
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [createCity, setCreateCity] = useState(false);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [cityName, setCityName] = useState("");
  const [cityTimezone, setCityTimezone] = useState("");
  const [provider, setProvider] = useState<MapProvider>("google");
  const [mapUrl, setMapUrl] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = (next: VenueLocation) => {
    setData(next);
    setSelectedCity(next.locality);
    setAddress(next.address ?? "");
    setLatitude(next.latitude === null ? "" : String(next.latitude));
    setLongitude(next.longitude === null ? "" : String(next.longitude));
    setTimezone(next.timezone_id ?? "");
  };
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try { await action(); } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally { if (alive.current) setBusy(false); }
  };
  const load = () => perform(async () => {
    const [location, timezones, localities] = await Promise.all([
      getConsoleVenueLocation(venueId), getConsoleTimezones(), getConsoleLocalities(),
    ]);
    if (!alive.current) return;
    apply(location); setZones(timezones); setCities(localities);
  });
  useEffect(() => { void load(); }, [venueId]);
  const searchCities = (query: string, page: number) => perform(async () => {
    const result = await getConsoleLocalities(query, page);
    if (alive.current) { setCities(result); setSearchedQuery(query); }
  });
  const options = [...new Map([...cities.items, ...(selectedCity ? [selectedCity] : [])].map(city => [city.id, city])).values()];
  const nullableNumber = (value: string) => value.trim() === "" ? null : Number(value);
  const invalidCoordinates = (latitude.trim() === "") !== (longitude.trim() === "")
    || (latitude.trim() !== "" && (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90))
    || (longitude.trim() !== "" && (!Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180));
  const draft: VenueLocationWrite = {
    expected_revision: data?.location_revision ?? 1, locality_id: selectedCity?.id ?? null,
    address: address.trim() || null, latitude: nullableNumber(latitude), longitude: nullableNumber(longitude),
    coordinate_system: "WGS84", timezone_id: timezone || null,
  };
  const dirty = !!data && (data.locality?.id !== selectedCity?.id || (data.address ?? "") !== address
    || (data.latitude === null ? "" : String(data.latitude)) !== latitude
    || (data.longitude === null ? "" : String(data.longitude)) !== longitude || (data.timezone_id ?? "") !== timezone);

  const preview = () => perform(async () => {
    const result = await previewConsoleVenueLocation(venueId, draft);
    if (!alive.current) return;
    setConfirmation({
      title: "确认所在地修改",
      rows: [
        ["原城市", result.before.locality ? cityLabel(result.before.locality) : "未填写"],
        ["新城市", selectedCity ? cityLabel(selectedCity) : "未填写"],
        ["原地址", result.before.address ?? "未填写"], ["新地址", result.after.address ?? "未填写"],
        ["原坐标", pointLabel(result.before)], ["新坐标", pointLabel(result.after)],
        ["原时区", result.before.effective_timezone_id ?? "待核验"], ["新时区", result.effective_timezone_id ?? "待核验"],
        ["关联 Live", `${result.live_count} 场（本次不修改排期）`],
        ["需重新核对的地图关联", result.invalidated_map_links],
      ],
      run: async () => {
        const saved = await saveConsoleVenueLocation(venueId, result.after, auth.csrfToken ?? "");
        if (alive.current) { apply(saved); setMessage("所在地已保存；已有 Live 排期保持原值。"); }
      },
    });
  });

  const zoneOptions = <><option value="">暂未核验</option>{zones.map(zone => <option key={zone}>{zone}</option>)}</>;
  return <div className="tour-admin-block">
      <h3>所在地与地图</h3>
      {message && <p role="status" className="console-admin-hint">{message}</p>}
      {busy && <p className="console-admin-hint">正在处理…</p>}
      {!data && !busy && <button type="button" className="console-ghost-btn" onClick={() => void load()}>重新加载</button>}
      {data && <>
        <p className="console-admin-hint">当前时区：{data.effective_timezone_id ?? "待核验"}{data.timezone_source === "locality" ? "（来自城市）" : data.timezone_source === "venue" ? "（来自场馆）" : ""}。</p>
        <p className="console-admin-hint">先按场馆名称核对所在地。本阶段支持登记已核验的城市、WGS84 坐标和地图链接，地图搜索与点选尚未接入。</p>
        {venueKind === "online" && <p className="console-admin-hint">线上场馆不登记实体位置；活动时间基准由每场 Live 单独维护。</p>}
        <div className="tour-admin-fields">
          <label>搜索城市<input value={cityQuery} disabled={busy} onChange={e => setCityQuery(e.target.value)} /></label>
          <label>已公布城市<select aria-label="已公布城市" value={selectedCity?.id ?? ""} disabled={busy || venueKind === "online"} onChange={e => setSelectedCity(options.find(city => city.id === Number(e.target.value)) ?? null)}>
            <option value="">未填写</option>{options.map(city => <option key={city.id} value={city.id}>{cityLabel(city)}</option>)}
          </select></label>
        </div>
        <div className="console-submit-row">
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => void searchCities(cityQuery, 1)}>查询城市</button>
          <span>共 {cities.total} 个城市 · 第 {cities.page} / {Math.max(1, Math.ceil(cities.total / cities.page_size))} 页</span>
          <button className="console-ghost-btn" type="button" disabled={busy || cities.page <= 1} onClick={() => void searchCities(searchedQuery, cities.page - 1)}>上一页城市</button>
          <button className="console-ghost-btn" type="button" disabled={busy || cities.page * cities.page_size >= cities.total} onClick={() => void searchCities(searchedQuery, cities.page + 1)}>下一页城市</button>
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => setCreateCity(!createCity)}>{createCity ? "收起城市登记" : "登记已核验城市"}</button>
        </div>
        {createCity && <div className="tour-admin-block">
          <h3>登记已核验城市</h3>
          <div className="tour-admin-fields">
            <label>国家／地区代码<input maxLength={2} value={country} disabled={busy} placeholder="JP" onChange={e => setCountry(e.target.value.toUpperCase())} /></label>
            <label>都道府县／省／州<input value={region} disabled={busy} onChange={e => setRegion(e.target.value)} /></label>
            <label>城市名称<input value={cityName} disabled={busy} onChange={e => setCityName(e.target.value)} /></label>
            <label>城市时区<select aria-label="城市时区" value={cityTimezone} disabled={busy} onChange={e => setCityTimezone(e.target.value)}>{zoneOptions}</select></label>
          </div>
          <p className="console-admin-hint">先查询已有城市；仅在地区可明确对应单一时区时填写时区。</p>
          <button className="console-submit-btn" type="button" disabled={busy || !/^[A-Z]{2}$/.test(country) || !cityName.trim()} onClick={() => {
            setMessage("");
            const payload = { country_code: country, admin_area: region.trim() || null, locality_name: cityName.trim(), timezone_id: cityTimezone || null };
            setConfirmation({ title: "确认登记城市", rows: [["国家／地区", country], ["行政区", region || "未填写"], ["城市", cityName], ["时区", cityTimezone || "待核验"]], confirmLabel: "提交插入", run: async () => {
              const city = await createConsoleLocality(payload, auth.csrfToken ?? "");
              if (alive.current) { setSelectedCity(city); setCreateCity(false); setMessage("城市已登记并选中；请检查并保存场馆所在地。"); }
            } });
          }}>提交插入</button>
        </div>}
        <div className="tour-admin-fields">
          <label>详细地址<input value={address} disabled={busy || venueKind === "online"} onChange={e => setAddress(e.target.value)} /></label>
          <label>场馆精确时区<select aria-label="场馆精确时区" value={timezone} disabled={busy || venueKind === "online"} onChange={e => setTimezone(e.target.value)}>{zoneOptions}</select></label>
          <label>纬度（WGS84）<input inputMode="decimal" value={latitude} disabled={busy || venueKind === "online"} onChange={e => setLatitude(e.target.value)} /></label>
          <label>经度（WGS84）<input inputMode="decimal" value={longitude} disabled={busy || venueKind === "online"} onChange={e => setLongitude(e.target.value)} /></label>
        </div>
        {invalidCoordinates && <p role="alert">请同时填写有效经纬度，或同时清空。</p>}
        <div className="console-submit-row">
          <button className="console-submit-btn" type="button" disabled={busy || !dirty || invalidCoordinates || (!!timezone && !latitude.trim())} onClick={() => void preview()}>保存修改</button>
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => void load()}>重新加载</button>
        </div>
        <h3>已保存位置的地图链接</h3>
        <div className="console-table-wrap"><table className="console-admin-table venue-map-table" aria-label="场馆地图链接">
          <thead><tr><th>地图</th><th>场馆匹配</th><th>坐标位置</th></tr></thead>
          <tbody>{data.map_links.map(link => <tr key={link.provider}>
            <td>{PROVIDERS[link.provider]}</td>
            <td>{link.is_current && link.url ? <a href={link.url} target="_blank" rel="noopener noreferrer">打开场馆详情</a> : link.verified_at ? "需重新核对" : "未关联"}</td>
            <td>{link.coordinate_url ? <a href={link.coordinate_url} target="_blank" rel="noopener noreferrer">按坐标打开</a> : "暂无坐标"}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="tour-admin-fields venue-map-link-editor">
          <label>地图平台<select value={provider} disabled={busy} onChange={e => { setProvider(e.target.value as MapProvider); setMapUrl(""); }}>{Object.entries(PROVIDERS).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
          <label>已核对的场馆详情链接<input type="url" value={mapUrl} disabled={busy} onChange={e => setMapUrl(e.target.value)} /></label>
        </div>
        <div className="console-submit-row">
          <button className="console-submit-btn" type="button" disabled={busy || dirty || data.latitude === null || !mapUrl.trim()} onClick={() => {
            setMessage("");
            const url = mapUrl.trim(); const selectedProvider = provider; const revision = data.location_revision;
            setConfirmation({ title: "确认地图场馆关联", rows: [["地图", PROVIDERS[selectedProvider]], ["已保存坐标", pointLabel(data)], ["详情链接", url]], run: async () => {
              const saved = await saveConsoleVenueMapLink(venueId, selectedProvider, url, revision, auth.csrfToken ?? "");
              if (alive.current) { setData(saved); setMapUrl(""); setMessage("地图关联已保存。"); }
            } });
          }}>保存修改</button>
          <button className="console-ghost-btn" type="button" disabled={busy || dirty || !data.map_links.find(link => link.provider === provider)?.verified_at} onClick={() => {
            setMessage("");
            const selectedProvider = provider; const revision = data.location_revision;
            setConfirmation({ title: "确认取消地图关联", rows: [["地图", PROVIDERS[selectedProvider]], ["结果", "保留场馆坐标，可继续按坐标打开"]], confirmLabel: "取消关联", run: async () => {
              const saved = await deleteConsoleVenueMapLink(venueId, selectedProvider, revision, auth.csrfToken ?? "");
              if (alive.current) { setData(saved); setMessage("地图关联已取消。"); }
            } });
          }}>取消关联</button>
        </div>
      </>}
    {confirmation && <div className="modal-mask" onClick={() => !busy && setConfirmation(null)}>
      <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="venue-location-confirm-title" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h2 id="venue-location-confirm-title">{confirmation.title}</h2></div>
        <div className="console-confirm-body"><CompactConfirmationTable ariaLabel={confirmation.title} rows={confirmation.rows} />{message && <p role="alert">{message}</p>}</div>
        <div className="console-confirm-actions">
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button>
          <button className="console-submit-btn" type="button" disabled={busy} onClick={() => void perform(async () => { await confirmation.run(); if (alive.current) setConfirmation(null); })}>{confirmation.confirmLabel ?? "保存修改"}</button>
        </div>
      </div>
    </div>}
  </div>;
}
