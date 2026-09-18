import { useEffect, useRef, useState } from "react";
import { getGeographyCapabilities, resolveGeography, searchGeography,
  type GeographyCapabilities, type GeocodingResult, type GeoLocality, type LocationPoint, type LocationResolution } from "../../api";
import { VenueLocationMap } from "./VenueLocationMap";

type Props = {
  venueId?: number; venueName: string; csrf: string; disabled: boolean;
  point: LocationPoint | null; savedPoint: LocationPoint | null; timezone: string; address: string; locality: GeoLocality | null;
  onPoint: (point: LocationPoint | null) => void; onTimezone: (zone: string) => void;
  onAddress: (address: string) => void; onLocality: (locality: GeoLocality) => void;
  onReview: (required: boolean) => void;
};
const pointKey = (point: LocationPoint | null) => point ? `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}` : "";

export function VenueLocationPicker(props: Props) {
  const current = useRef(props); current.current = props;
  const [config, setConfig] = useState<GeographyCapabilities | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [query, setQuery] = useState(props.venueName);
  const [search, setSearch] = useState<GeocodingResult | null>(null);
  const [resolution, setResolution] = useState<LocationResolution | null>(null);
  const [zone, setZone] = useState<LocationResolution["timezone"] | null>(null);
  const [zoneReviewed, setZoneReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const autoZone = useRef<string | null>(null);
  const generation = useRef(0);
  const addressRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const addressAtRequest = useRef("");
  const localityAtRequest = useRef<number | null>(null);
  const key = pointKey(props.point);

  useEffect(() => {
    const controller = new AbortController();
    void getGeographyCapabilities(controller.signal).then(value => { if (!controller.signal.aborted) setConfig(value); }).catch(error => {
      if (!controller.signal.aborted) { setConfigFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
    });
    return () => { controller.abort(); addressRequest.current?.abort(); searchRequest.current?.abort(); current.current.onReview(false); };
  }, []);
  useEffect(() => { if (autoZone.current !== props.timezone) autoZone.current = null; }, [props.timezone]);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = `${props.venueId ?? "new"}-${++generation.current}`;
    addressRequest.current?.abort(); setResolution(null); setZone(null); setZoneReviewed(false); setMessage("");
    setQueryBusy(false);
    if (autoZone.current && current.current.timezone === autoZone.current) current.current.onTimezone("");
    autoZone.current = null;
    if (!props.point || !config?.timezone) { current.current.onReview(false); return () => controller.abort(); }
    current.current.onReview(true);
    const point = props.point;
    const timer = setTimeout(() => {
      void resolveGeography(point, "timezone", requestId, props.csrf, controller.signal).then(result => {
        if (controller.signal.aborted || pointKey(current.current.point) !== key || pointKey(result) !== key || result.request_id !== requestId) return;
        setZone(result.timezone);
        const suggested = result.timezone.timezone_id;
        if (result.timezone.status === "ready" && suggested && !current.current.timezone) {
          autoZone.current = suggested; current.current.onTimezone(suggested); setZoneReviewed(true); current.current.onReview(false);
        } else current.current.onReview(!!suggested && suggested !== current.current.timezone);
      }).catch(error => {
        if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : String(error)); current.current.onReview(false); }
      });
    }, 400);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, props.venueId, props.csrf, config?.timezone]);
  const zoneConflict = !!zone?.timezone_id && zone.timezone_id !== props.timezone && !zoneReviewed;
  useEffect(() => { if (zone) props.onReview(zoneConflict); }, [zoneConflict, zone]);

  const find = async () => {
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    setQueryBusy(true); setMessage(""); setSearch(null);
    try {
      const result = await searchGeography(query.trim(), props.locality?.country_code ?? null, props.csrf, controller.signal);
      if (!controller.signal.aborted) setSearch(result);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.signal.aborted) setQueryBusy(false); }
  };
  const parseAddress = async () => {
    if (!props.point) return;
    addressRequest.current?.abort();
    const controller = new AbortController(); addressRequest.current = controller;
    const requestId = `address-${props.venueId ?? "new"}-${++generation.current}`;
    const requestedPoint = key;
    addressAtRequest.current = props.address; localityAtRequest.current = props.locality?.id ?? null;
    setQueryBusy(true); setMessage(""); setResolution(null);
    try {
      const result = await resolveGeography(props.point, "address", requestId, props.csrf, controller.signal);
      if (!controller.signal.aborted && pointKey(current.current.point) === requestedPoint && pointKey(result) === requestedPoint && result.request_id === requestId) setResolution(result);
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (!controller.signal.aborted) setQueryBusy(false); }
  };
  const suggestion = resolution?.address?.items[0];
  const disabled = props.disabled || queryBusy;
  return <div className="tour-admin-block">
    <p className="console-admin-hint">点击地图或拖动标记调整草稿；确认保存前不会修改场馆。实际搬迁请新建 Venue。</p>
    <div className="tour-admin-fields"><label>名称或地址定位<input value={query} maxLength={200} disabled={disabled} onChange={e => { searchRequest.current?.abort(); setQueryBusy(false); setQuery(e.target.value); setSearch(null); }} /></label></div>
    <div className="console-submit-row">
      <button type="button" className="console-ghost-btn" disabled={disabled || !config?.geocoding || query.trim().length < 2} onClick={() => void find()}>搜索位置</button>
      <button type="button" className="console-ghost-btn" disabled={disabled || !props.point || !config?.geocoding} onClick={() => void parseAddress()}>解析此位置</button>
      <button type="button" className="console-ghost-btn" disabled={props.disabled} onClick={() => props.onPoint(props.savedPoint)}>{props.venueId === undefined ? "清空草稿位置" : "回到已保存位置"}</button>
    </div>
    {search?.items.map((candidate, index) => <div key={`${candidate.latitude}-${candidate.longitude}-${index}`} className="console-admin-hint">
      <span>{candidate.name} · {candidate.address} </span>
      <button type="button" className="console-ghost-btn" disabled={props.disabled} onClick={() => props.onPoint(candidate)}>选择此位置</button>
    </div>)}
    {search && <p role="status">{search.message ?? (search.status === "not_found" ? "没有找到位置，请调整名称或手工选点。" : "请选择并核对位置，不会自动关联地图 POI。")}</p>}
    {config ? <VenueLocationMap point={props.point} disabled={props.disabled} config={config} onPoint={props.onPoint} /> : <p role="status">{configFailed ? "地图暂不可用，可继续输入经纬度。" : "地图配置加载中；可继续输入经纬度。"}</p>}
    {zone && <p role="status">{zone.timezone_id ? `位置时区建议：${zone.timezone_id}` : zone.message ?? "时区待手工确认"}</p>}
    {zoneConflict && <div className="console-submit-row"><span>当前时区 {props.timezone} 与建议不同，请核对。</span>
      <button type="button" className="console-ghost-btn" disabled={props.disabled} onClick={() => { props.onTimezone(zone!.timezone_id!); setZoneReviewed(true); }}>采用建议时区</button>
      <button type="button" className="console-ghost-btn" disabled={props.disabled} onClick={() => setZoneReviewed(true)}>保留当前时区</button>
    </div>}
    {resolution?.address && <p role="status">{resolution.address.message ?? (suggestion ? "以下为附近地址建议，请核对门牌和地区。" : "未找到地址，可手工填写。")}</p>}
    {suggestion && <div className="console-admin-hint"><span>{suggestion.address} </span>
      <button type="button" className="console-ghost-btn" disabled={props.disabled || props.address !== addressAtRequest.current} onClick={() => props.onAddress(suggestion.address)}>采用地址建议</button>
      {props.address !== addressAtRequest.current && <span> 地址已编辑，如需重新解析请点击“解析此位置”。</span>}
    </div>}
    {resolution?.localities.map(locality => <div key={locality.id} className="console-admin-hint">
      <span>{[locality.country_code, locality.admin_area, locality.locality_name].filter(Boolean).join(" / ")} </span>
      <button type="button" className="console-ghost-btn" disabled={props.disabled || (props.locality?.id ?? null) !== localityAtRequest.current} onClick={() => props.onLocality(locality)}>采用已有地区</button>
    </div>)}
    {suggestion && !resolution?.localities.length && <p className="console-admin-hint">没有匹配的已登记地区，请在上方手工选择；不会自动新增地区。</p>}
    {(search || resolution?.address) && <p className="console-admin-hint"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>}
    {queryBusy && <p role="status">正在查询位置…</p>}
    {message && <p role="alert">{message}</p>}
  </div>;
}
