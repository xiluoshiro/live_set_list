import { useEffect, useRef, useState } from "react";
import { getGeographyCapabilities, resolveGeography, resolveGooglePlace, searchGeography,
  type GeographyCapabilities, type GeocodingCandidate, type GeocodingResult, type GeoLocality,
  type GooglePlaceDraft, type LocationPoint, type LocationResolution } from "../../api";
import { VenueLocationMap } from "./VenueLocationMap";
import { DEFAULT_GOOGLE_MAP_POINT } from "./googleMapsSession";

type Props = {
  venueId?: number; venueName: string; csrf: string; disabled: boolean;
  point: LocationPoint | null; savedPoint: LocationPoint | null; timezone: string; address: string; locality: GeoLocality | null;
  onPoint: (point: LocationPoint | null) => void; onTimezone: (zone: string) => void;
  onAddress: (address: string) => void; onLocality: (locality: GeoLocality) => void;
  onName?: (name: string) => void; onGooglePlace: (place: GooglePlaceDraft | null) => void;
  onReview: (required: boolean) => void; onDone?: () => void;
};

const pointKey = (point: LocationPoint | null) => point ? `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}` : "";

function PinIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></svg>;
}

export function VenueLocationPicker(props: Props) {
  const current = useRef(props); current.current = props;
  const [config, setConfig] = useState<GeographyCapabilities | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [query, setQuery] = useState(props.venueName);
  const [search, setSearch] = useState<GeocodingResult | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<GooglePlaceDraft | null>(null);
  const [zone, setZone] = useState<LocationResolution["timezone"] | null>(null);
  const [addressResolved, setAddressResolved] = useState(false);
  const [message, setMessage] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const autoZone = useRef<string | null>(null);
  const generation = useRef(0);
  const addressRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const key = pointKey(props.point);

  useEffect(() => {
    if (props.venueId === undefined && !current.current.point) current.current.onPoint(DEFAULT_GOOGLE_MAP_POINT);
  }, []);
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
    setZone(null); setMessage("");
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
        if (result.timezone.status === "ready" && suggested) {
          autoZone.current = suggested; current.current.onTimezone(suggested);
        }
        current.current.onReview(false);
      }).catch(error => {
        if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : String(error)); current.current.onReview(false); }
      });
    }, 400);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, props.venueId, props.csrf, config?.timezone]);

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

  const useCandidate = (candidate: GeocodingCandidate) => {
    props.onPoint(candidate);
    props.onAddress(candidate.address);
    setAddressResolved(true);
    if (candidate.provider_place_id && candidate.provider_url) {
      const place = { provider_place_id: candidate.provider_place_id, provider_url: candidate.provider_url, name: candidate.name };
      setSelectedPlace(place); props.onGooglePlace(place);
      if (!props.venueName.trim()) props.onName?.(candidate.name);
    } else {
      setSelectedPlace(null); props.onGooglePlace(null);
    }
  };

  const choosePlace = async (placeId: string) => {
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    const requestId = `place-${props.venueId ?? "new"}-${++generation.current}`;
    setQueryBusy(true); setMessage("");
    try {
      const result = await resolveGooglePlace(placeId, requestId, props.csrf, controller.signal);
      const candidate = result.items[0];
      if (!controller.signal.aborted && candidate) useCandidate(candidate);
      else if (!controller.signal.aborted) setMessage(result.message ?? "没有取得该 Google 地点的资料。");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) setQueryBusy(false);
    }
  };

  const resolveAddress = async (point: LocationPoint) => {
    if (!config?.geocoding) return;
    addressRequest.current?.abort();
    const controller = new AbortController(); addressRequest.current = controller;
    const requestId = `address-${props.venueId ?? "new"}-${++generation.current}`;
    const requestedPoint = pointKey(point);
    const originalAddress = current.current.address;
    const originalLocality = current.current.locality?.id ?? null;
    setAddressResolved(false); setMessage("");
    try {
      const result = await resolveGeography(point, "address", requestId, props.csrf, controller.signal);
      if (controller.signal.aborted || pointKey(current.current.point) !== requestedPoint || pointKey(result) !== requestedPoint || result.request_id !== requestId) return;
      const candidate = result.address?.items[0];
      if (candidate && current.current.address === originalAddress) current.current.onAddress(candidate.address);
      if (result.localities[0] && (current.current.locality?.id ?? null) === originalLocality) current.current.onLocality(result.localities[0]);
      setAddressResolved(Boolean(candidate));
      if (!candidate && !current.current.address) setMessage(result.address?.message ?? "没有解析到附近地址，请手工填写。");
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const chooseMapPoint = (point: LocationPoint) => {
    setSelectedPlace(null); props.onGooglePlace(null); props.onPoint(point);
    void resolveAddress(point);
  };

  const resetPoint = () => {
    addressRequest.current?.abort();
    setSelectedPlace(null); setAddressResolved(false); setMessage("");
    props.onGooglePlace(null); props.onPoint(props.savedPoint);
  };

  const disabled = props.disabled || queryBusy;
  const selectedTitle = selectedPlace?.name || props.venueName.trim() || (props.point ? "地图选点" : "尚未选择位置");
  const selectionState = selectedPlace ? "已匹配 Google 地点" : addressResolved ? "地址与地区已自动解析"
    : props.point ? (props.address.trim() ? "已选择地图位置" : "尚未取得地址") : "等待选择位置";
  const coordinates = props.point ? `${props.point.latitude.toFixed(6)}, ${props.point.longitude.toFixed(6)}` : "—";
  const timezoneLabel = zone?.timezone_id || props.timezone || "解析中";
  const resultCount = search?.items.length ?? 0;

  return <div className="venue-location-picker-block">
    <div className="venue-location-picker-layout">
      <aside className="venue-location-picker-controls" aria-label="位置搜索与当前选择">
        <div className="venue-location-picker-head">
          <form className="live-id-selector live-create-query-row venue-location-search" onSubmit={event => { event.preventDefault(); if (!disabled && config?.geocoding && query.trim().length >= 2) void find(); }}>
            <label className="live-management-label" htmlFor="venue-location-query">选择场馆</label>
            <input id="venue-location-query" className="venue-query-input live-management-primary-control" aria-label="名称或地址定位" value={query} maxLength={200} disabled={disabled}
              placeholder="搜索场馆名称或地址" onChange={event => { searchRequest.current?.abort(); setQueryBusy(false); setQuery(event.target.value); setSearch(null); }} />
            <button type="submit" className="console-ghost-btn" disabled={disabled || !config?.geocoding || query.trim().length < 2}>查询</button>
          </form>
        </div>

        <div className="venue-location-results-head">
          <span>{search ? `搜索结果 · ${resultCount}` : "搜索结果"}</span>
        </div>
        <div className="venue-location-results">
          {search?.items.map((candidate, index) => {
            const active = pointKey(candidate) === key;
            return <button type="button" key={`${candidate.latitude}-${candidate.longitude}-${index}`}
              className={`venue-location-result${active ? " active" : ""}`} disabled={props.disabled} onClick={() => useCandidate(candidate)}>
              <span className="venue-location-place-icon"><PinIcon /></span>
              <span className="venue-location-result-copy"><strong>{candidate.name}</strong><small>{candidate.address}</small></span>
              <span className="venue-location-chevron" aria-hidden="true">›</span>
            </button>;
          })}
          {!search && <div className="venue-location-results-empty"><PinIcon /><strong>搜索地点</strong></div>}
          {search && !search.items.length && <div className="venue-location-results-empty"><strong>没有找到匹配地点</strong><span>{search.message ?? "请调整名称，或直接在地图上选择。"}</span></div>}
          {queryBusy && <p className="console-admin-hint venue-location-status" role="status">正在查询位置…</p>}
          {message && <p className="console-admin-hint console-admin-warning venue-location-status" role="alert">{message}</p>}
        </div>

        <div className="venue-location-selection">
          <div className="venue-location-selection-label"><span aria-hidden="true" />{selectionState}</div>
          <h4>{selectedTitle}</h4>
          <p>{props.address || (props.point ? "尚未取得地址，可在上方搜索或继续调整图钉。" : "选择后将在这里显示地址。")}</p>
          <div className="venue-location-meta">
            <div className="console-readonly-field"><span>坐标</span><strong>{coordinates}</strong></div>
            <div className="console-readonly-field"><span>时区</span><strong>{timezoneLabel}</strong></div>
          </div>
          <div className="console-submit-row">
            <button type="button" className="console-ghost-btn" disabled={props.disabled} onClick={resetPoint}>{props.venueId === undefined ? "清除" : "复位"}</button>
            <button type="button" className="console-submit-btn" disabled={props.disabled || !props.point || !props.timezone} onClick={props.onDone}>使用此位置</button>
          </div>
        </div>
      </aside>

      <div className="venue-location-picker-map">
        {config ? <VenueLocationMap point={props.point} disabled={props.disabled} config={config}
          onPoint={chooseMapPoint} onPlaceId={placeId => void choosePlace(placeId)} />
          : <div className="venue-location-map-loading" role="status">{configFailed ? "地图暂不可用，可继续输入经纬度。" : "地图配置加载中…"}</div>}
      </div>
    </div>
  </div>;
}
