import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  deleteConsoleVenueMapLink, getConsoleTimezones, getConsoleVenueLocation,
  previewConsoleVenueLocation, saveConsoleVenueLocation, saveConsoleVenueMapLink, searchConsoleVenueMapCandidates,
  type GeoLocality, type GooglePlaceDraft, type MapCandidate,
  type MapCandidateSearch, type MapProvider, type MapSearchProvider,
  type VenueLocation, type VenueLocationWrite,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { VenueLocationPicker } from "./VenueLocationPicker";
import { VenueLocalitySelector, loadVenueLocalities } from "./VenueLocalitySelector";
import { VenueLocationFields } from "./VenueLocationFields";

const PROVIDERS: Record<MapProvider, string> = { google: "Google Maps", apple: "Apple Maps", amap: "高德地图" };
const EDITABLE_PROVIDERS: MapSearchProvider[] = ["apple", "amap"];
const FIELD_LABELS: Record<string, string> = {
  locality_id: "已公布地区", address: "公开门牌地址", coordinates: "WGS84 坐标",
  timezone_id: "场馆精确时区",
  google_place: "Google Maps 场馆",
};
const cityLabel = (city: GeoLocality) => [city.country_code, city.admin_area, city.locality_name].filter(Boolean).join(" / ");
const pointLabel = (point: { latitude: number | null; longitude: number | null }) =>
  point.latitude === null ? "未填写" : `${point.latitude}, ${point.longitude}`;
type Confirmation = {
  title: string;
  rows: ReadonlyArray<readonly [string, ReactNode]>;
  confirmLabel?: "提交插入" | "保存修改" | "取消关联";
  run: () => Promise<void>;
};

export function VenueLocationPanel({ venueId, venueName, venueKind }: {
  venueId: number;
  venueName: string;
  venueKind: string;
  onOpenLive?: (liveId: number) => void;
}) {
  const auth = useAuth();
  const [data, setData] = useState<VenueLocation | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [cities, setCities] = useState<GeoLocality[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<GeoLocality | null>(null);
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapReview, setMapReview] = useState(false);
  const [googlePlace, setGooglePlace] = useState<GooglePlaceDraft | null>(null);
  const [provider, setProvider] = useState<MapSearchProvider>("apple");
  const [mapQuery, setMapQuery] = useState(venueName);
  const [mapSearch, setMapSearch] = useState<MapCandidateSearch | null>(null);
  const [selectedMapCandidate, setSelectedMapCandidate] = useState<MapCandidate | null>(null);
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
    const google = next.map_links.find(link => link.provider === "google");
    setGooglePlace(google?.provider_place_id && google.provider_url
      ? { provider_place_id: google.provider_place_id, provider_url: google.provider_url, name: venueName }
      : null);
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
      getConsoleVenueLocation(venueId), getConsoleTimezones(), loadVenueLocalities(),
    ]);
    if (!alive.current) return;
    apply(location); setZones(timezones); setCities(localities);
  });
  useEffect(() => { void load(); }, [venueId]);
  useEffect(() => {
    setMapQuery(venueName); setMapSearch(null); setSelectedMapCandidate(null); setMapUrl("");
  }, [venueId, venueName]);
  const searchCities = (query: string) => perform(async () => {
    const result = await loadVenueLocalities(query);
    if (alive.current) setCities(result);
  });
  const restore = () => {
    if (!data) return;
    apply(data); setMapOpen(false); setMapReview(false); setMessage("");
  };
  const nullableNumber = (value: string) => value.trim() === "" ? null : Number(value);
  const invalidCoordinates = (latitude.trim() === "") !== (longitude.trim() === "")
    || (latitude.trim() !== "" && (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90))
    || (longitude.trim() !== "" && (!Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180));
  const physical = venueKind === "physical";
  const validation = physical && !address.trim() ? "实体场馆必须填写公开门牌地址。"
    : data?.locality && !selectedCity ? "已确定地区的场馆不能清空地区。"
    : "";
  const draft: VenueLocationWrite = {
    expected_state_token: data?.state_token ?? "",
    locality_id: venueKind === "online" ? null : selectedCity?.id ?? null,
    address: physical ? address.trim() || null : null,
    latitude: physical ? nullableNumber(latitude) : null,
    longitude: physical ? nullableNumber(longitude) : null,
    coordinate_system: "WGS84",
    timezone_id: venueKind !== "online" ? timezone || null : null,
    google_place: physical ? googlePlace : null,
  };
  const savedGoogle = data?.map_links.find(link => link.provider === "google");
  const dirty = !!data && ((data.locality?.id ?? null) !== draft.locality_id || data.address !== draft.address
    || data.latitude !== draft.latitude || data.longitude !== draft.longitude
    || data.timezone_id !== draft.timezone_id
    || (savedGoogle?.provider_place_id ?? null) !== (googlePlace?.provider_place_id ?? null)
    || (savedGoogle?.provider_url ?? null) !== (googlePlace?.provider_url ?? null));

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
        ["原时区", result.before.timezone_id ?? "待核验"], ["新时区", result.after.timezone_id ?? "待核验"],
        ["Google Maps 场馆", result.after.google_place?.name ?? "未关联"],
        ["本次变更字段", result.changed_fields.map(field => FIELD_LABELS[field] ?? field).join("、") || "无"],
        ["关联 Live", `${result.live_count} 场（本次不修改排期）`],
      ],
      run: async () => {
        const saved = await saveConsoleVenueLocation(venueId, result.after, auth.csrfToken ?? "");
        if (alive.current) {
          apply(saved);
          const fields = result.changed_fields.map(field => FIELD_LABELS[field] ?? field).join("、");
          setMessage(`所在地已保存；已更新：${fields}。`);
        }
      },
    });
  });

  return <div className="tour-admin-block">
      <h3>所在地与地图</h3>
      {message && <p role="status" className="console-admin-hint">{message}</p>}
      {busy && <p className="console-admin-hint">正在处理…</p>}
      {!data && !busy && <button type="button" className="console-ghost-btn" onClick={() => void load()}>重新加载</button>}
      {data && <>
        {venueKind === "online" && <p className="console-admin-hint">线上场馆不登记实体位置；活动时间基准由每场 Live 单独维护。</p>}
        {venueKind === "undisclosed" && <p className="console-admin-hint">未公开具体场馆登记已公布地区和自身时区，不填写门牌、坐标或地图关联。</p>}
        <VenueLocalitySelector locality={selectedCity} cities={cities} query={cityQuery}
          disabled={busy || !!confirmation || venueKind === "online"} onQuery={setCityQuery}
          onSearch={query => void searchCities(query)} onSelect={setSelectedCity} />
        <VenueLocationFields ariaLabel="场馆所在地资料" name={venueName}
          kind={physical ? "实体场馆" : venueKind === "online" ? "线上" : "未公开"}
          physical={physical} online={venueKind === "online"} disabled={busy || !!confirmation}
          address={address} latitude={latitude} longitude={longitude} timezone={timezone} zones={zones}
          onAddress={setAddress} onLatitude={value => { setLatitude(value); setGooglePlace(null); }}
          onLongitude={value => { setLongitude(value); setGooglePlace(null); }} onTimezone={setTimezone} />
        {invalidCoordinates && <p role="alert">请同时填写有效经纬度，或同时清空。</p>}
        {validation && <p role="status" className="console-admin-hint">{validation}</p>}
        <div className="console-submit-row live-admin-insert-row venue-create-actions">
          {physical && <button className="console-ghost-btn" type="button" aria-expanded={mapOpen}
            disabled={busy || !!confirmation} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? "收起地图" : "地图选点"}</button>}
          <button className="console-ghost-btn" type="button" disabled={busy || !!confirmation || !dirty} onClick={restore}>恢复原值</button>
        <button className="console-ghost-btn" type="button" disabled={busy || !!confirmation} onClick={() => void load()}>重新加载</button>
          <button className="console-submit-btn" type="button" disabled={busy || !!confirmation || mapReview || !dirty || invalidCoordinates || !!validation || (venueKind !== "online" && !timezone)} onClick={() => void preview()}>保存修改</button>
        </div>
        {physical && <>
          {mapOpen && <VenueLocationPicker venueId={venueId} venueName={venueName}
            csrf={auth.csrfToken ?? ""} disabled={busy || !!confirmation} timezone={timezone} address={address} locality={selectedCity}
            point={!invalidCoordinates && latitude.trim() && longitude.trim() ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
            savedPoint={data.latitude !== null && data.longitude !== null ? { latitude: data.latitude, longitude: data.longitude } : null}
            onPoint={point => { setLatitude(point ? String(point.latitude) : ""); setLongitude(point ? String(point.longitude) : ""); }}
            onTimezone={setTimezone} onAddress={setAddress} onLocality={setSelectedCity}
            onGooglePlace={setGooglePlace} onReview={setMapReview} onDone={() => setMapOpen(false)} />}
        </>}
        <p className="console-admin-hint">位置资料修正不产生版本；场馆搬迁请新增场馆，正式更名请使用名称历史。</p>
        {physical && <><h3>已保存位置的地图链接</h3>
        <div className="console-table-wrap"><table className="console-admin-table venue-map-table" aria-label="场馆地图链接">
          <thead><tr><th>地图</th><th>场馆匹配</th><th>坐标位置</th></tr></thead>
          <tbody>{data.map_links.map(link => <tr key={link.provider}>
            <td>{PROVIDERS[link.provider]}</td>
            <td>{link.is_current && link.url ? <a href={link.url} target="_blank" rel="noopener noreferrer">打开场馆详情</a> : "未关联"}</td>
            <td>{link.coordinate_url ? <a href={link.coordinate_url} target="_blank" rel="noopener noreferrer">按坐标打开</a> : "暂无坐标"}</td>
          </tr>)}</tbody>
        </table></div>
        <h3>搜索地图候选</h3>
        <div className="tour-admin-fields venue-map-link-editor">
          <label>地图平台<select value={provider} disabled={busy} onChange={e => {
            setProvider(e.target.value as MapSearchProvider); setMapUrl(""); setMapSearch(null); setSelectedMapCandidate(null);
          }}>{EDITABLE_PROVIDERS.map(key => <option value={key} key={key}>{PROVIDERS[key]}</option>)}</select></label>
          <label>名称或地址<input value={mapQuery} disabled={busy} onChange={e => setMapQuery(e.target.value)} /></label>
        </div>
        <div className="console-submit-row">
          <button className="console-ghost-btn" type="button" disabled={busy || dirty || data.latitude === null || !mapQuery.trim()} onClick={() => void perform(async () => {
            const result = await searchConsoleVenueMapCandidates(venueId, provider, mapQuery.trim());
            if (alive.current) { setMapSearch(result); setSelectedMapCandidate(null); }
          })}>查询候选</button>
        </div>
        {mapSearch?.message && <p className="console-admin-hint" role="status">{mapSearch.message}</p>}
        {mapSearch?.status === "ready" && mapSearch.candidates.length === 0 && <p className="console-admin-hint">没有找到候选；请调整名称或地址，或继续手工关联。</p>}
        {mapSearch && mapSearch.candidates.length > 0 && <div className="console-table-wrap"><table className="console-admin-table live-history-table" aria-label={`${PROVIDERS[provider]} 地图候选`}>
          <thead><tr><th>选择</th><th>地点</th><th>地址</th><th>WGS84 坐标</th><th>距离</th><th>来源坐标</th></tr></thead>
          <tbody>{mapSearch.candidates.map(candidate => <tr key={`${candidate.provider_place_id}:${candidate.latitude}:${candidate.longitude}`}>
            <td><input type="radio" name={`map-candidate-${venueId}`} aria-label={`选择 ${candidate.name}`} checked={selectedMapCandidate?.provider_place_id === candidate.provider_place_id} disabled={busy} onChange={() => setSelectedMapCandidate(candidate)} /></td>
            <td>{candidate.name}<br /><small>{candidate.provider_place_id}</small></td>
            <td>{candidate.address || "未提供"}</td>
            <td>{candidate.latitude}, {candidate.longitude}</td>
            <td>{candidate.distance_m < 1000 ? `${candidate.distance_m} m` : `${(candidate.distance_m / 1000).toFixed(1)} km`}</td>
            <td>{candidate.source_coordinate_system === "GCJ02" ? "GCJ-02 → WGS84" : "WGS84"}</td>
          </tr>)}</tbody>
        </table></div>}
        <div className="console-submit-row">
          <button className="console-submit-btn" type="button" disabled={busy || dirty || !selectedMapCandidate} onClick={() => {
            if (!selectedMapCandidate) return;
            const candidate = selectedMapCandidate; const selectedProvider = provider; const stateToken = data.state_token;
            setConfirmation({ title: "确认地图场馆候选", rows: [
              ["地图", PROVIDERS[selectedProvider]], ["候选地点", candidate.name], ["候选地址", candidate.address || "未提供"],
              ["候选 WGS84 坐标", `${candidate.latitude}, ${candidate.longitude}`], ["与已保存坐标距离", `${candidate.distance_m} m`],
              ["平台地点 ID", candidate.provider_place_id],
            ], run: async () => {
              const saved = await saveConsoleVenueMapLink(venueId, selectedProvider, {
                provider_place_id: candidate.provider_place_id, provider_url: candidate.provider_url,
              }, stateToken, auth.csrfToken ?? "");
              if (alive.current) { setData(saved); setMapSearch(null); setSelectedMapCandidate(null); setMessage("地图候选已关联。"); }
            } });
          }}>关联所选候选</button>
        </div>
        <h3>手工关联</h3>
        <p className="console-admin-hint">没有 API Key、搜索失败或平台未返回目标时，可粘贴已人工核对的同平台场馆详情链接。</p>
        <div className="tour-admin-fields venue-map-link-editor">
          <label>已核对的场馆详情链接<input type="url" value={mapUrl} disabled={busy} onChange={e => setMapUrl(e.target.value)} /></label>
        </div>
        <div className="console-submit-row">
          <button className="console-submit-btn" type="button" disabled={busy || dirty || data.latitude === null || !mapUrl.trim()} onClick={() => {
            setMessage("");
            const url = mapUrl.trim(); const selectedProvider = provider; const stateToken = data.state_token;
            setConfirmation({ title: "确认地图场馆关联", rows: [["地图", PROVIDERS[selectedProvider]], ["已保存坐标", pointLabel(data)], ["详情链接", url]], run: async () => {
              const saved = await saveConsoleVenueMapLink(venueId, selectedProvider, { provider_url: url }, stateToken, auth.csrfToken ?? "");
              if (alive.current) { setData(saved); setMapUrl(""); setMessage("地图关联已保存。"); }
            } });
          }}>保存修改</button>
          <button className="console-ghost-btn" type="button" disabled={busy || dirty || !data.map_links.find(link => link.provider === provider)?.verified_at} onClick={() => {
            setMessage("");
            const selectedProvider = provider; const stateToken = data.state_token;
            setConfirmation({ title: "确认取消地图关联", rows: [["地图", PROVIDERS[selectedProvider]], ["结果", "保留场馆坐标，可继续按坐标打开"]], confirmLabel: "取消关联", run: async () => {
              const saved = await deleteConsoleVenueMapLink(venueId, selectedProvider, stateToken, auth.csrfToken ?? "");
              if (alive.current) { setData(saved); setMessage("地图关联已取消。"); }
            } });
          }}>取消关联</button>
        </div></>}
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
