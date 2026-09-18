import { useEffect, useRef, useState } from "react";
import {
  createConsoleVenue, getConsoleLocalities, getConsoleTimezones,
  type GeoLocality, type GeoLocalityPage, type VenueLocationWrite,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { VenueLocationPicker } from "./VenueLocationPicker";

const KINDS = { physical: "实体场馆", undisclosed: "未公开" };
const localityLabel = (item: GeoLocality) => [item.country_code, item.admin_area, item.locality_name].filter(Boolean).join(" / ");
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function VenueCreateSection({ onMessage, onVenuesChanged, initialName = "" }: {
  onMessage: (message: string) => void; onVenuesChanged: () => Promise<void>; initialName?: string;
}) {
  const auth = useAuth();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<keyof typeof KINDS>("physical");
  const [locality, setLocality] = useState<GeoLocality | null>(null);
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [timezone, setTimezone] = useState("");
  const [zones, setZones] = useState<string[]>([]);
  const [cities, setCities] = useState<GeoLocalityPage>({ items: [], total: 0, page: 1, page_size: 20 });
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [clearAfter, setClearAfter] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapReview, setMapReview] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const generation = useRef(0);

  const loadOptions = async (q = "", page = 1) => {
    const request = ++generation.current;
    setLoading(true); setLoadError("");
    try {
      const [result, timezones] = await Promise.all([getConsoleLocalities(q, page), getConsoleTimezones()]);
      if (request !== generation.current) return;
      setCities(result); setZones(timezones); setSearchedQuery(q);
    } catch (error) { if (request === generation.current) setLoadError(errorText(error)); }
    finally { if (request === generation.current) setLoading(false); }
  };
  useEffect(() => { void loadOptions(); return () => { generation.current++; }; }, []);

  const clear = () => {
    setName(""); setKind("physical"); setLocality(null); setAddress("");
    setLatitude(""); setLongitude(""); setTimezone(""); setMapOpen(false); setMapReview(false);
    setQuery(""); setDraftKey(value => value + 1);
  };
  const physical = kind === "physical";
  const invalidCoordinates = (latitude.trim() === "") !== (longitude.trim() === "")
    || (!!latitude.trim() && (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90))
    || (!!longitude.trim() && (!Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180));
  const zoneConflict = physical && !!timezone && !!locality?.timezone_id && timezone !== locality.timezone_id;
  const validation = !name.trim() ? "请填写场地名称。"
    : physical && !timezone ? "实体场馆必须选择已核验的 IANA 时区。"
    : physical && invalidCoordinates ? "请同时填写有效经纬度，或同时清空（纬度 −90～90，经度 −180～180）。"
    : physical && timezone && !latitude.trim() ? "填写场馆精确时区前，请先核对坐标。"
    : zoneConflict ? "场馆时区与所选地区时区不一致，请核对。"
    : mapReview ? "请先核对地图解析的时区。" : "";
  const location: Omit<VenueLocationWrite, "expected_state_token"> = {
    locality_id: locality?.id ?? null,
    address: physical ? address.trim() || null : null,
    latitude: physical && latitude.trim() ? Number(latitude) : null,
    longitude: physical && longitude.trim() ? Number(longitude) : null,
    timezone_id: physical ? timezone || null : null, coordinate_system: "WGS84",
  };
  const options = [...new Map([...cities.items, ...(locality ? [locality] : [])].map(item => [item.id, item])).values()];
  const rows: [string, string][] = [["名称", name.trim()], ["类型", KINDS[kind]]];
  rows.push(["已公布地区", locality ? localityLabel(locality) : "未填写"]);
  if (physical) rows.push(["公开门牌地址", location.address ?? "未填写"], ["WGS84 坐标", location.latitude === null ? "未填写" : `${location.latitude}, ${location.longitude}`], ["场馆精确时区", timezone]);

  const submit = async () => {
    if (validation || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setMessage("");
    try {
      const result = await createConsoleVenue(name.trim(), auth.csrfToken ?? "", kind, location);
      setConfirm(false);
      if (clearAfter) clear();
      const success = `已新增场地 #${result.item.venue_id} ${result.item.venue_name}，名称和所在地资料已保存。`;
      setMessage(success); onMessage(success);
      try { await onVenuesChanged(); }
      catch (error) { const warning = `${success} 候选刷新失败，请刷新页面；无需重复提交：${errorText(error)}`; setMessage(warning); onMessage(warning); }
    } catch (error) { setMessage(`新增场地失败，已保留填写内容：${errorText(error)}`); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  return <>
    <div>
      <div className="live-id-selector live-create-query-row">
        <label className="live-management-label" htmlFor="venue-create-locality-query">查询地区</label>
        <input id="venue-create-locality-query" className="venue-query-input live-management-primary-control" aria-label="搜索地区"
          placeholder="输入国家、行政区或城市" maxLength={120} value={query} disabled={submitting || loading}
          onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadOptions(query.trim()); }} />
        <button type="button" className="console-ghost-btn" disabled={loading || submitting} onClick={() => void loadOptions(query.trim())}>查询地区</button>
      </div>
      <div className="live-id-selector live-create-tools">
        <label className="live-management-label" htmlFor="venue-create-locality-select">选择地区</label>
        <select id="venue-create-locality-select" className="live-management-primary-control" aria-label="已公布地区"
          title={locality ? localityLabel(locality) : undefined} value={locality?.id ?? ""} disabled={submitting || loading}
          onChange={e => setLocality(options.find(item => item.id === Number(e.target.value)) ?? null)}>
          <option value="">请选择地区</option>{options.map(item => <option key={item.id} value={item.id}>{localityLabel(item)}</option>)}
        </select>
        <button type="button" className="console-ghost-btn" disabled={loading || submitting || cities.page <= 1} onClick={() => void loadOptions(searchedQuery, cities.page - 1)}>上一页地区</button>
        <span>第 {cities.page} / {Math.max(1, Math.ceil(cities.total / cities.page_size))} 页，共 {cities.total} 个地区</span>
        <button type="button" className="console-ghost-btn" disabled={loading || submitting || cities.page * cities.page_size >= cities.total} onClick={() => void loadOptions(searchedQuery, cities.page + 1)}>下一页地区</button>
      </div>
      {loadError && <p role="alert">地区或时区加载失败：{loadError}</p>}
      {loading && <p role="status">正在加载地区与时区…</p>}
      <div className="console-table-wrap">
        <table className="console-admin-table venue-create-form-table" aria-label="新增场地资料">
          <colgroup><col className="venue-create-name-column" /><col className="venue-create-kind-column" /><col /><col className="venue-create-coordinate-column" /><col className="venue-create-coordinate-column" /><col className="venue-create-timezone-column" /></colgroup>
          <thead><tr><th scope="col">名称</th><th scope="col">类型</th><th scope="col">公开门牌地址</th><th scope="col">纬度（WGS84）</th><th scope="col">经度（WGS84）</th><th scope="col">场馆精确时区</th></tr></thead>
          <tbody><tr>
            <td><input aria-label="名称" placeholder="请输入场地名称" maxLength={255} value={name} disabled={submitting} onChange={e => setName(e.target.value)} /></td>
            <td><select aria-label="类型" value={kind} disabled={submitting} onChange={e => {
              const next = e.target.value as keyof typeof KINDS; setKind(next);
              if (next !== "physical") { setAddress(""); setLatitude(""); setLongitude(""); setTimezone(""); setMapOpen(false); setMapReview(false); }
            }}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
            <td><input aria-label="公开门牌地址" placeholder={physical ? "请输入地址（可选）" : "不适用"} maxLength={500} value={address} disabled={submitting || !physical} onChange={e => setAddress(e.target.value)} /></td>
            <td><input aria-label="纬度（WGS84）" inputMode="decimal" value={latitude} disabled={submitting || !physical} onChange={e => setLatitude(e.target.value)} /></td>
            <td><input aria-label="经度（WGS84）" inputMode="decimal" value={longitude} disabled={submitting || !physical} onChange={e => setLongitude(e.target.value)} /></td>
            <td><select aria-label="场馆精确时区" value={timezone} disabled={submitting || loading || !physical} onChange={e => setTimezone(e.target.value)}><option value="" disabled={physical}>{physical ? "请选择时区（必填）" : "不适用"}</option>{[...new Set([...zones, ...(timezone ? [timezone] : [])])].map(zone => <option key={zone}>{zone}</option>)}</select></td>
          </tr></tbody>
        </table>
      </div>
      {kind === "undisclosed" && <p className="console-admin-hint">未公开具体场馆时，仅填写已公布地区。</p>}
      {validation && name.trim() && <p className="console-admin-hint" role="status">{validation}</p>}
      {message && <p role="status" className="console-admin-hint">{message}</p>}
      <div className="console-submit-row live-admin-insert-row venue-create-actions">
        <label className="live-clear-after-create-option"><input type="checkbox" checked={clearAfter} disabled={submitting} onChange={e => setClearAfter(e.target.checked)} />新增成功后清空表单</label>
        {physical && <button type="button" className="console-ghost-btn" aria-expanded={mapOpen} disabled={submitting} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? "收起选点地图" : "地图选点与自动解析"}</button>}
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={clear}>清空</button>
        <button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => { setMessage(""); setConfirm(true); }}>提交插入</button>
      </div>
        {mapOpen && <VenueLocationPicker key={draftKey} venueName={name} csrf={auth.csrfToken ?? ""} disabled={submitting || confirm}
          point={!invalidCoordinates && latitude.trim() && longitude.trim() ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
          savedPoint={null} timezone={timezone} address={address} locality={locality}
          onPoint={point => { setLatitude(point ? String(point.latitude) : ""); setLongitude(point ? String(point.longitude) : ""); }}
          onTimezone={setTimezone} onAddress={setAddress} onLocality={setLocality} onReview={setMapReview} />}
    </div>
    {confirm && <div className="modal-mask" onClick={() => !submitting && setConfirm(false)}><div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="venue-create-confirm-title" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h2 id="venue-create-confirm-title">确认新增场地</h2></div>
      <div className="console-confirm-body"><CompactConfirmationTable ariaLabel="新增场地确认" rows={rows} />{message && <p role="alert">{message}</p>}</div>
      <div className="console-confirm-actions"><button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirm(false)}>取消</button><button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => void submit()}>{submitting ? "正在提交…" : "提交插入"}</button></div>
    </div></div>}
  </>;
}
