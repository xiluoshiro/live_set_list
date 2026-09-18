import { useEffect, useRef, useState } from "react";
import {
  createConsoleVenue, getConsoleLocalities, getConsoleTimezones, getConsoleVenuePage,
  type ConsoleVenueItem, type GeoLocality, type GeoLocalityPage, type VenueLocationWrite,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { VenueLocationPicker } from "./VenueLocationPicker";
import { VenueLocationPanel } from "./VenueLocationPanel";

const KINDS = { physical: "实体场馆", online: "线上", undisclosed: "未公开" };
const localityLabel = (item: GeoLocality) => [item.country_code, item.admin_area, item.locality_name].filter(Boolean).join(" / ");
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function VenueCreateSection({ onMessage, onVenuesChanged }: {
  onMessage: (message: string) => void; onVenuesChanged: () => Promise<void>;
}) {
  const auth = useAuth();
  const [name, setName] = useState("");
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
  const [created, setCreated] = useState<ConsoleVenueItem | null>(null);
  const [manageCreated, setManageCreated] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapReview, setMapReview] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const [duplicates, setDuplicates] = useState<{ items: ConsoleVenueItem[]; total: number; page: number; totalPages: number; query: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");
  const generation = useRef(0);
  const duplicateGeneration = useRef(0);

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
  useEffect(() => { void loadOptions(); return () => { generation.current++; duplicateGeneration.current++; }; }, []);

  const checkDuplicates = async (page = 1) => {
    const q = name.trim();
    const request = ++duplicateGeneration.current;
    setChecking(true); setDuplicateError("");
    try {
      const result = await getConsoleVenuePage(q, page, 20);
      if (request === duplicateGeneration.current) setDuplicates({ items: result.items, total: result.total ?? result.items.length, page: result.page ?? page, totalPages: result.total_pages ?? 1, query: q });
    } catch (error) { if (request === duplicateGeneration.current) setDuplicateError(errorText(error)); }
    finally { if (request === duplicateGeneration.current) setChecking(false); }
  };
  const clear = () => {
    setName(""); setKind("physical"); setLocality(null); setAddress("");
    setLatitude(""); setLongitude(""); setTimezone(""); setMapOpen(false); setMapReview(false);
    setDuplicates(null); setDuplicateError(""); setQuery(""); setDraftKey(value => value + 1);
    duplicateGeneration.current++; setChecking(false);
  };
  const physical = kind === "physical";
  const invalidCoordinates = (latitude.trim() === "") !== (longitude.trim() === "")
    || (!!latitude.trim() && (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90))
    || (!!longitude.trim() && (!Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180));
  const zoneConflict = physical && !!timezone && !!locality?.timezone_id && timezone !== locality.timezone_id;
  const validation = !name.trim() ? "请填写场地名称。"
    : physical && invalidCoordinates ? "请同时填写有效经纬度，或同时清空（纬度 −90～90，经度 −180～180）。"
    : physical && timezone && !latitude.trim() ? "填写场馆精确时区前，请先核对坐标。"
    : zoneConflict ? "场馆时区与所选地区时区不一致，请核对。"
    : mapReview ? "请先核对地图解析的时区。" : "";
  const location: Omit<VenueLocationWrite, "expected_state_token"> = {
    locality_id: kind === "online" ? null : locality?.id ?? null,
    address: physical ? address.trim() || null : null,
    latitude: physical && latitude.trim() ? Number(latitude) : null,
    longitude: physical && longitude.trim() ? Number(longitude) : null,
    timezone_id: physical ? timezone || null : null, coordinate_system: "WGS84",
  };
  const options = [...new Map([...cities.items, ...(locality ? [locality] : [])].map(item => [item.id, item])).values()];
  const rows: [string, string][] = [["名称", name.trim()], ["类型", KINDS[kind]]];
  if (kind !== "online") rows.push(["已公布地区", locality ? localityLabel(locality) : "未填写"]);
  if (physical) rows.push(["公开门牌地址", location.address ?? "未填写"], ["WGS84 坐标", location.latitude === null ? "未填写" : `${location.latitude}, ${location.longitude}`], ["场馆精确时区", timezone || "未设置（新录入 Live 使用默认 UTC+09:00）"]);

  const submit = async () => {
    if (validation || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setMessage("");
    try {
      const result = await createConsoleVenue(name.trim(), auth.csrfToken ?? "", kind, location);
      setCreated({ ...result.item, venue_kind: kind }); setManageCreated(false); setConfirm(false);
      if (clearAfter) clear();
      const success = `已新增场地 #${result.item.venue_id} ${result.item.venue_name}，名称和所在地资料已保存。`;
      setMessage(success); onMessage(success);
      try { await onVenuesChanged(); }
      catch (error) { const warning = `${success} 候选刷新失败，请刷新页面；无需重复提交：${errorText(error)}`; setMessage(warning); onMessage(warning); }
    } catch (error) { setMessage(`新增场地失败，已保留填写内容：${errorText(error)}`); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  return <>
    <div className="tour-admin-block">
      <h3>新增场地</h3>
      <p className="console-admin-hint">先查询当前及历史名称，确认场馆与具体 Hall。场馆搬迁请新增场地；正式更名请在场地管理中维护。</p>
      {message && <p role="status" className="console-admin-hint">{message}</p>}
      <div className="tour-admin-fields">
        <label>名称<input maxLength={255} value={name} disabled={submitting} onChange={e => {
          setName(e.target.value); setDuplicates(null); setDuplicateError(""); duplicateGeneration.current++; setChecking(false);
        }} /></label>
        <label>类型<select value={kind} disabled={submitting} onChange={e => {
          const next = e.target.value as keyof typeof KINDS; setKind(next);
          if (next === "online") setLocality(null);
          if (next !== "physical") { setAddress(""); setLatitude(""); setLongitude(""); setTimezone(""); setMapOpen(false); setMapReview(false); }
        }}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="console-submit-row"><button type="button" className="console-ghost-btn" disabled={submitting || checking || !name.trim()} onClick={() => void checkDuplicates()}>查询已有场地</button></div>
      {checking && <p role="status">正在查询已有场地…</p>}
      {duplicateError && <p role="alert">查询失败：{duplicateError}</p>}
      {duplicates && <>
        <p className="console-admin-hint">“{duplicates.query}”匹配 {duplicates.total} 个场地；相似名称不代表同一场馆，当前或历史名称完全相同会被拒绝。</p>
        {duplicates.items.length > 0 && <div className="console-table-wrap"><table className="console-admin-table" aria-label="已有场地查询结果">
          <thead><tr><th>场地</th><th>匹配名称</th><th>类型</th></tr></thead>
          <tbody>{duplicates.items.map(item => <tr key={item.venue_id}><td>#{item.venue_id} {item.venue_name}</td><td>{item.matched_name ?? item.venue_name}</td><td>{KINDS[item.venue_kind ?? "physical"]}</td></tr>)}</tbody>
        </table></div>}
        <div className="tour-candidate-pager">
          <button type="button" className="console-ghost-btn" disabled={checking || submitting || duplicates.page <= 1} onClick={() => void checkDuplicates(duplicates.page - 1)}>上一页场地</button>
          <span>第 {duplicates.page} / {Math.max(1, duplicates.totalPages)} 页</span>
          <button type="button" className="console-ghost-btn" disabled={checking || submitting || duplicates.page >= duplicates.totalPages} onClick={() => void checkDuplicates(duplicates.page + 1)}>下一页场地</button>
        </div>
      </>}
      <h3>所在地与时区</h3>
      {kind === "online" ? <p className="console-admin-hint">线上场地不登记实体位置；活动时间基准在新增演出时填写。</p> : <>
        {kind === "undisclosed" && <p className="console-admin-hint">仅选择主办方已公布的地区，不登记门牌、坐标或精确时区。</p>}
        {loadError && <p role="alert">地区或时区加载失败：{loadError} <button type="button" className="console-ghost-btn" disabled={loading || submitting} onClick={() => void loadOptions(query.trim())}>重新加载地区与时区</button></p>}
        {loading && <p role="status">正在加载地区与时区…</p>}
        <div className="tour-admin-fields">
          <label>搜索地区<input maxLength={120} value={query} disabled={submitting || loading} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void loadOptions(query.trim()); }} /></label>
          <label>已公布地区<select value={locality?.id ?? ""} disabled={submitting || loading} onChange={e => setLocality(options.find(item => item.id === Number(e.target.value)) ?? null)}>
            <option value="">未填写</option>{options.map(item => <option key={item.id} value={item.id}>{localityLabel(item)}</option>)}
          </select></label>
        </div>
        <div className="console-submit-row">
          <button type="button" className="console-ghost-btn" disabled={loading || submitting} onClick={() => void loadOptions(query.trim())}>查询地区</button>
          <span>共 {cities.total} 个地区 · 第 {cities.page} / {Math.max(1, Math.ceil(cities.total / cities.page_size))} 页</span>
          <button type="button" className="console-ghost-btn" disabled={loading || submitting || cities.page <= 1} onClick={() => void loadOptions(searchedQuery, cities.page - 1)}>上一页地区</button>
          <button type="button" className="console-ghost-btn" disabled={loading || submitting || cities.page * cities.page_size >= cities.total} onClick={() => void loadOptions(searchedQuery, cities.page + 1)}>下一页地区</button>
        </div>
      </>}
      {physical && <>
        <div className="tour-admin-fields">
          <label>公开门牌地址<input maxLength={500} value={address} disabled={submitting} onChange={e => setAddress(e.target.value)} /></label>
          <label>场馆精确时区<select value={timezone} disabled={submitting || loading} onChange={e => setTimezone(e.target.value)}><option value="">暂未核验</option>{[...new Set([...zones, ...(timezone ? [timezone] : [])])].map(zone => <option key={zone}>{zone}</option>)}</select></label>
          <label>纬度（WGS84）<input inputMode="decimal" value={latitude} disabled={submitting} onChange={e => setLatitude(e.target.value)} /></label>
          <label>经度（WGS84）<input inputMode="decimal" value={longitude} disabled={submitting} onChange={e => setLongitude(e.target.value)} /></label>
        </div>
        <p className="console-admin-hint">坐标和时区请核验后填写；未设置场馆时区时，新录入演出使用默认 UTC+09:00。</p>
        <button type="button" className="console-ghost-btn" aria-expanded={mapOpen} disabled={submitting} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? "收起选点地图" : "地图选点与自动解析"}</button>
        {mapOpen && <VenueLocationPicker key={draftKey} venueName={name} csrf={auth.csrfToken ?? ""} disabled={submitting || confirm}
          point={!invalidCoordinates && latitude.trim() && longitude.trim() ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
          savedPoint={null} timezone={timezone} address={address} locality={locality}
          onPoint={point => { setLatitude(point ? String(point.latitude) : ""); setLongitude(point ? String(point.longitude) : ""); }}
          onTimezone={setTimezone} onAddress={setAddress} onLocality={setLocality} onReview={setMapReview} />}
      </>}
      {validation && <p className="console-admin-hint" role="status">{validation}</p>}
      <div className="console-submit-row live-admin-insert-row">
        <label className="live-clear-after-create-option"><input type="checkbox" checked={clearAfter} disabled={submitting} onChange={e => setClearAfter(e.target.checked)} />新增成功后清空表单</label>
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={clear}>清空</button>
        <button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => { setMessage(""); setConfirm(true); }}>提交插入</button>
      </div>
    </div>
    {created && <div className="tour-admin-block"><h3>最近新增：#{created.venue_id} {created.venue_name}</h3>
      <button type="button" className="console-ghost-btn" aria-expanded={manageCreated} onClick={() => setManageCreated(!manageCreated)}>{manageCreated ? "收起场地资料" : "继续完善所在地与地图链接"}</button>
      {manageCreated && <VenueLocationPanel key={created.venue_id} venueId={created.venue_id} venueName={created.venue_name} venueKind={created.venue_kind ?? "physical"} />}
    </div>}
    {confirm && <div className="modal-mask" onClick={() => !submitting && setConfirm(false)}><div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="venue-create-confirm-title" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h2 id="venue-create-confirm-title">确认新增场地</h2></div>
      <div className="console-confirm-body"><CompactConfirmationTable ariaLabel="新增场地确认" rows={rows} />{message && <p role="alert">{message}</p>}</div>
      <div className="console-confirm-actions"><button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirm(false)}>取消</button><button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => void submit()}>{submitting ? "正在提交…" : "提交插入"}</button></div>
    </div></div>}
  </>;
}
