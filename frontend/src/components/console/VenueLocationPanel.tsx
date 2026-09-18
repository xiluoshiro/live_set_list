import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createConsoleLocality, deleteConsoleVenueMapLink, getConsoleLocalities,
  getConsoleTimezones, getConsoleVenueLocation, previewConsoleLocality, previewConsoleVenueLocation,
  saveConsoleLocality, saveConsoleVenueLocation, saveConsoleVenueMapLink, searchConsoleVenueMapCandidates,
  type GeoLocality, type GeoLocalityCreate, type GeoLocalityPage, type MapCandidate,
  type MapCandidateSearch, type MapProvider,
  type VenueLocation, type VenueLocationWrite,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";

const PROVIDERS: Record<MapProvider, string> = { google: "Google Maps", apple: "Apple Maps", amap: "高德地图" };
const AREA_LEVELS: Record<GeoLocality["area_level"], string> = {
  country: "国家／地区", admin_area: "一级行政区", locality: "城市",
};
const FIELD_LABELS: Record<string, string> = {
  locality_id: "已公布地区", address: "公开门牌地址", coordinates: "WGS84 坐标",
  timezone_id: "场馆精确时区", effective_timezone_id: "实际采用时区",
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
  const [localityEditorMode, setLocalityEditorMode] = useState<"create" | "edit" | null>(null);
  const [areaLevel, setAreaLevel] = useState<GeoLocality["area_level"]>("locality");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [cityName, setCityName] = useState("");
  const [cityTimezone, setCityTimezone] = useState("");
  const [provider, setProvider] = useState<MapProvider>("google");
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
  useEffect(() => {
    setMapQuery(venueName); setMapSearch(null); setSelectedMapCandidate(null); setMapUrl("");
  }, [venueId, venueName]);
  const searchCities = (query: string, page: number) => perform(async () => {
    const result = await getConsoleLocalities(query, page);
    if (alive.current) { setCities(result); setSearchedQuery(query); }
  });
  const options = [...new Map([...cities.items, ...(selectedCity ? [selectedCity] : [])].map(city => [city.id, city])).values()];
  const openLocalityEditor = (mode: "create" | "edit") => {
    if (mode === "edit" && selectedCity) {
      setAreaLevel(selectedCity.area_level); setCountry(selectedCity.country_code);
      setRegion(selectedCity.admin_area ?? ""); setCityName(selectedCity.locality_name ?? "");
      setCityTimezone(selectedCity.timezone_id ?? "");
    } else {
      setAreaLevel("locality"); setCountry(""); setRegion(""); setCityName(""); setCityTimezone("");
    }
    setLocalityEditorMode(mode);
  };
  const localityPayload: GeoLocalityCreate = {
    country_code: country,
    admin_area: areaLevel === "country" ? null : region.trim() || null,
    locality_name: areaLevel === "locality" ? cityName.trim() || null : null,
    timezone_id: cityTimezone || null,
    area_level: areaLevel,
  };
  const localityDraftValid = /^[A-Z]{2}$/.test(country)
    && (areaLevel !== "admin_area" || !!region.trim())
    && (areaLevel !== "locality" || !!cityName.trim());
  const nullableNumber = (value: string) => value.trim() === "" ? null : Number(value);
  const invalidCoordinates = (latitude.trim() === "") !== (longitude.trim() === "")
    || (latitude.trim() !== "" && (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90))
    || (longitude.trim() !== "" && (!Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180));
  const physical = venueKind === "physical";
  const draft: VenueLocationWrite = {
    expected_state_token: data?.state_token ?? "",
    locality_id: venueKind === "online" ? null : selectedCity?.id ?? null,
    address: physical ? address.trim() || null : null,
    latitude: physical ? nullableNumber(latitude) : null,
    longitude: physical ? nullableNumber(longitude) : null,
    coordinate_system: "WGS84",
    timezone_id: physical ? timezone || null : null,
  };
  const dirty = !!data && ((data.locality?.id ?? null) !== draft.locality_id || data.address !== draft.address
    || data.latitude !== draft.latitude || data.longitude !== draft.longitude
    || data.timezone_id !== draft.timezone_id);

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

  const zoneOptions = <><option value="">暂未核验</option>{zones.map(zone => <option key={zone}>{zone}</option>)}</>;
  return <div className="tour-admin-block">
      <h3>所在地与地图</h3>
      {message && <p role="status" className="console-admin-hint">{message}</p>}
      {busy && <p className="console-admin-hint">正在处理…</p>}
      {!data && !busy && <button type="button" className="console-ghost-btn" onClick={() => void load()}>重新加载</button>}
      {data && <>
        <p className="console-admin-hint">场地 IANA 时区：{data.timezone_id ?? "未设置（关联 Live 使用默认 UTC+09:00）"}。</p>
        <p className="console-admin-hint">此处用于补录或纠正资料，不产生版本；场馆搬迁请新建 Venue。正式更名请使用名称历史。</p>
        <p className="console-admin-hint">先按场馆名称核对所在地。地图候选由可选供应商适配器返回，候选坐标统一转换为 WGS84；服务未配置或不可用时仍可手工关联。</p>
        {venueKind === "online" && <p className="console-admin-hint">线上场馆不登记实体位置；活动时间基准由每场 Live 单独维护。</p>}
        {venueKind === "undisclosed" && <p className="console-admin-hint">未公开具体场馆只登记主办方已公布的地区；不填写门牌、坐标、场馆精确时区或地图关联。</p>}
        <div className="tour-admin-fields">
          <label>搜索地区<input value={cityQuery} disabled={busy} onChange={e => setCityQuery(e.target.value)} /></label>
          <label>已公布地区<select aria-label="已公布地区" value={selectedCity?.id ?? ""} disabled={busy || venueKind === "online"} onChange={e => setSelectedCity(options.find(city => city.id === Number(e.target.value)) ?? null)}>
            <option value="">未填写</option>{options.map(city => <option key={city.id} value={city.id}>{cityLabel(city)}</option>)}
          </select></label>
        </div>
        <div className="console-submit-row">
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => void searchCities(cityQuery, 1)}>查询地区</button>
          <span>共 {cities.total} 个地区 · 第 {cities.page} / {Math.max(1, Math.ceil(cities.total / cities.page_size))} 页</span>
          <button className="console-ghost-btn" type="button" disabled={busy || cities.page <= 1} onClick={() => void searchCities(searchedQuery, cities.page - 1)}>上一页地区</button>
          <button className="console-ghost-btn" type="button" disabled={busy || cities.page * cities.page_size >= cities.total} onClick={() => void searchCities(searchedQuery, cities.page + 1)}>下一页地区</button>
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => localityEditorMode === "create" ? setLocalityEditorMode(null) : openLocalityEditor("create")}>{localityEditorMode === "create" ? "收起地区登记" : "登记已核验地区"}</button>
          <button className="console-ghost-btn" type="button" disabled={busy || !selectedCity} onClick={() => localityEditorMode === "edit" ? setLocalityEditorMode(null) : openLocalityEditor("edit")}>{localityEditorMode === "edit" ? "收起地区修改" : "修改已选地区"}</button>
        </div>
        {localityEditorMode && <div className="tour-admin-block">
          <h3>{localityEditorMode === "create" ? "登记已核验地区" : "修改已选地区"}</h3>
          <div className="tour-admin-fields">
            <label>地区层级<select aria-label="地区层级" value={areaLevel} disabled={busy} onChange={e => setAreaLevel(e.target.value as GeoLocality["area_level"])}>
              {Object.entries(AREA_LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>国家／地区代码<input maxLength={2} value={country} disabled={busy} placeholder="JP" onChange={e => setCountry(e.target.value.toUpperCase())} /></label>
            <label>都道府县／省／州<input value={region} disabled={busy || areaLevel === "country"} onChange={e => setRegion(e.target.value)} /></label>
            <label>城市名称<input value={cityName} disabled={busy || areaLevel !== "locality"} onChange={e => setCityName(e.target.value)} /></label>
            <label>地区时区<select aria-label="地区时区" value={cityTimezone} disabled={busy} onChange={e => setCityTimezone(e.target.value)}>{zoneOptions}</select></label>
          </div>
          <p className="console-admin-hint">先查询已有地区；仅在整个记录范围可明确对应单一时区时填写时区。</p>
          <button className="console-submit-btn" type="button" disabled={busy || !localityDraftValid} onClick={() => {
            setMessage("");
            const rows: ReadonlyArray<readonly [string, ReactNode]> = [
              ["层级", AREA_LEVELS[areaLevel]], ["国家／地区", country],
              ["行政区", localityPayload.admin_area ?? "未填写"],
              ["城市", localityPayload.locality_name ?? "未填写"], ["时区", cityTimezone || "待核验"],
            ];
            if (localityEditorMode === "create") {
              setConfirmation({ title: "确认登记地区", rows, confirmLabel: "提交插入", run: async () => {
                const created = await createConsoleLocality(localityPayload, auth.csrfToken ?? "");
                if (alive.current) { setSelectedCity(created); setLocalityEditorMode(null); setMessage("地区已登记并选中；请检查并保存场馆所在地。"); }
              } });
              return;
            }
            if (!selectedCity) return;
            void perform(async () => {
              const update = { ...localityPayload, expected_state_token: selectedCity.state_token };
              const result = await previewConsoleLocality(selectedCity.id, update);
              if (!alive.current) return;
              setConfirmation({ title: "确认地区资料修改", rows: [
                ["原地区", cityLabel(result.before)], ["新地区", cityLabel({ ...result.before, ...result.after })],
                ["原时区", result.before.timezone_id ?? "待核验"], ["新时区", result.after.timezone_id ?? "待核验"],
                ["引用 Venue", result.venue_count],
                ["关联 Live", result.live_count],
              ], run: async () => {
                await saveConsoleLocality(selectedCity.id, result.after, auth.csrfToken ?? "");
                const refreshed = await getConsoleVenueLocation(venueId);
                if (alive.current) {
                  apply(refreshed); setLocalityEditorMode(null);
                  setMessage("地区已保存；关联 Live 的已存时间偏移不随本次资料修改而变动。");
                }
              } });
            });
          }}>{localityEditorMode === "create" ? "提交插入" : "预览修改"}</button>
        </div>}
        <div className="tour-admin-fields">
          <label>公开门牌地址<input value={address} disabled={busy || !physical} onChange={e => setAddress(e.target.value)} /></label>
          <label>场馆精确时区<select aria-label="场馆精确时区" value={timezone} disabled={busy || !physical} onChange={e => setTimezone(e.target.value)}>{zoneOptions}</select></label>
          <label>纬度（WGS84）<input inputMode="decimal" value={latitude} disabled={busy || !physical} onChange={e => setLatitude(e.target.value)} /></label>
          <label>经度（WGS84）<input inputMode="decimal" value={longitude} disabled={busy || !physical} onChange={e => setLongitude(e.target.value)} /></label>
        </div>
        {invalidCoordinates && <p role="alert">请同时填写有效经纬度，或同时清空。</p>}
        <div className="console-submit-row">
          <button className="console-submit-btn" type="button" disabled={busy || !dirty || invalidCoordinates || (!!timezone && !latitude.trim())} onClick={() => void preview()}>保存修改</button>
          <button className="console-ghost-btn" type="button" disabled={busy} onClick={() => void load()}>重新加载</button>
        </div>
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
            setProvider(e.target.value as MapProvider); setMapUrl(""); setMapSearch(null); setSelectedMapCandidate(null);
          }}>{Object.entries(PROVIDERS).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
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
