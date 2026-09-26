import { useEffect, useRef, useState } from "react";
import {
  createConsoleVenue, getConsoleTimezones,
  type GeoLocality, type GooglePlaceDraft, type VenueLocationWrite,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { VenueLocalitySelector, loadVenueLocalities, localityLabel } from "./VenueLocalitySelector";
import { VenueLocationFields } from "./VenueLocationFields";
import { VenueLocationPicker } from "./VenueLocationPicker";

const DEFAULT_TIMEZONE = "Asia/Tokyo";
const isTokyo = (item: GeoLocality) => item.country_code === "JP" && item.admin_area === "東京都" && !item.locality_name;
const KINDS = { physical: "实体场馆", undisclosed: "未公开" };
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
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [zones, setZones] = useState<string[]>([]);
  const [cities, setCities] = useState<GeoLocality[]>([]);
  const defaultLocality = useRef<GeoLocality | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [clearAfter, setClearAfter] = useState(true);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapReview, setMapReview] = useState(false);
  const [googlePlace, setGooglePlace] = useState<GooglePlaceDraft | null>(null);
  const generation = useRef(0);

  const loadOptions = async (q = "", initialize = false) => {
    const request = ++generation.current;
    setLoading(true); setLoadError("");
    try {
      const [items, timezones] = await Promise.all([loadVenueLocalities(q), getConsoleTimezones()]);
      if (request !== generation.current) return;
      setCities(items); setZones(timezones);
      if (initialize) {
        defaultLocality.current = items.find(isTokyo) ?? null;
        setLocality(defaultLocality.current);
      }
    } catch (error) { if (request === generation.current) setLoadError(errorText(error)); }
    finally { if (request === generation.current) setLoading(false); }
  };
  useEffect(() => { void loadOptions("", true); return () => { generation.current++; }; }, []);

  const clear = () => {
    setName(""); setKind("physical"); setLocality(defaultLocality.current); setAddress("");
    setLatitude(""); setLongitude(""); setTimezone(DEFAULT_TIMEZONE); setGooglePlace(null); setMapOpen(false); setMapReview(false);
    setQuery("");
  };
  const physical = kind === "physical";
  const invalidCoordinates = (latitude.trim() === "") !== (longitude.trim() === "")
    || (!!latitude.trim() && (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90))
    || (!!longitude.trim() && (!Number.isFinite(Number(longitude)) || Math.abs(Number(longitude)) > 180));
  const validation = !name.trim() ? "请填写场馆名称。"
    : physical && !address.trim() ? "实体场馆必须填写公开门牌地址。"
    : !timezone ? "场馆必须选择 IANA 时区。"
    : physical && invalidCoordinates ? "请同时填写有效经纬度，或同时清空（纬度 −90～90，经度 −180～180）。"
    : mapReview ? "请先核对地图解析的时区。" : "";
  const location: Omit<VenueLocationWrite, "expected_state_token"> = {
    locality_id: locality?.id ?? null,
    address: physical ? address.trim() || null : null,
    latitude: physical && latitude.trim() ? Number(latitude) : null,
    longitude: physical && longitude.trim() ? Number(longitude) : null,
    timezone_id: timezone || null, coordinate_system: "WGS84",
    google_place: physical ? googlePlace : null,
  };
  const rows: [string, string][] = [["名称", name.trim()], ["类型", KINDS[kind]]];
  rows.push(["已公布地区", locality ? localityLabel(locality) : "未填写"]);
  rows.push(["场馆精确时区", timezone]);
  if (physical) rows.push(["公开门牌地址", location.address ?? "未填写"], ["WGS84 坐标", location.latitude === null ? "未填写" : `${location.latitude}, ${location.longitude}`],
    ["Google Maps 场馆", googlePlace?.name ?? "未关联"]);

  const submit = async () => {
    if (validation || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setMessage("");
    try {
      const result = await createConsoleVenue(name.trim(), auth.csrfToken ?? "", kind, location);
      setConfirm(false);
      if (clearAfter) clear();
      const success = `已新增场馆 #${result.item.venue_id} ${result.item.venue_name}，名称和所在地资料已保存。`;
      onMessage(success);
      try { await onVenuesChanged(); }
      catch (error) { const warning = `${success} 候选刷新失败，请刷新页面；无需重复提交：${errorText(error)}`; onMessage(warning); }
    } catch (error) { setMessage(`新增场馆失败，已保留填写内容：${errorText(error)}`); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  return <>
    <div>
      <VenueLocalitySelector locality={locality} cities={cities} query={query} disabled={submitting || loading}
        onQuery={setQuery} onSearch={q => void loadOptions(q)} onSelect={setLocality} />
      {loadError && <p role="alert">地区或时区加载失败：{loadError}</p>}
      {loading && <p role="status">正在加载地区与时区…</p>}
      <VenueLocationFields ariaLabel="新增场馆资料" name={<input aria-label="名称" placeholder="请输入场馆名称" maxLength={255} value={name} disabled={submitting} onChange={e => setName(e.target.value)} />} kind={<select aria-label="类型" value={kind} disabled={submitting} onChange={e => {
              const next = e.target.value as keyof typeof KINDS; setKind(next);
              if (next !== "physical") { setAddress(""); setLatitude(""); setLongitude(""); setGooglePlace(null); setMapOpen(false); setMapReview(false); }
            }}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        physical={physical} online={false} disabled={submitting} zonesLoading={loading}
        address={address} latitude={latitude} longitude={longitude} timezone={timezone} zones={zones}
        onAddress={setAddress} onLatitude={value => { setLatitude(value); setGooglePlace(null); }}
        onLongitude={value => { setLongitude(value); setGooglePlace(null); }} onTimezone={setTimezone} />
      {kind === "undisclosed" && <p className="console-admin-hint">未公开具体场馆时，填写已公布地区及场馆精确时区。</p>}
      {validation && name.trim() && <p className="console-admin-hint" role="status">{validation}</p>}
      <div className="console-submit-row live-admin-insert-row venue-create-actions">
        <label className="live-clear-after-create-option"><input type="checkbox" checked={clearAfter} disabled={submitting} onChange={e => setClearAfter(e.target.checked)} />新增成功后清空表单</label>
        {physical && <button type="button" className="console-ghost-btn" aria-expanded={mapOpen} disabled={submitting} onClick={() => {
          setMapOpen(!mapOpen);
        }}>{mapOpen ? "收起地图" : "地图选点"}</button>}
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={clear}>清空</button>
        <button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => { setMessage(""); setConfirm(true); }}>提交插入</button>
      </div>
        {mapOpen && <VenueLocationPicker venueName={name} csrf={auth.csrfToken ?? ""} disabled={submitting || confirm}
          point={!invalidCoordinates && latitude.trim() && longitude.trim() ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
          savedPoint={null} timezone={timezone} address={address} locality={locality}
          onPoint={point => { setLatitude(point ? String(point.latitude) : ""); setLongitude(point ? String(point.longitude) : ""); }}
          onTimezone={setTimezone} onAddress={setAddress} onLocality={setLocality} onName={setName}
          onGooglePlace={setGooglePlace} onReview={setMapReview} onDone={() => setMapOpen(false)} />}
    </div>
    {confirm && <div className="modal-mask" onClick={() => !submitting && setConfirm(false)}><div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="venue-create-confirm-title" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h2 id="venue-create-confirm-title">确认新增场馆</h2></div>
      <div className="console-confirm-body"><CompactConfirmationTable ariaLabel="新增场馆确认" rows={rows} />{message && <p role="alert">{message}</p>}</div>
      <div className="console-confirm-actions"><button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirm(false)}>取消</button><button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => void submit()}>{submitting ? "正在提交…" : "提交插入"}</button></div>
    </div></div>}
  </>;
}
