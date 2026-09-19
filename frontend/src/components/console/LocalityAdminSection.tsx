import { useRef, useState, type ReactNode } from "react";

import { createConsoleLocality, type GeoLocality, type GeoLocalityCreate } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";

const AREA_LEVELS: Record<GeoLocality["area_level"], string> = {
  country: "国家／地区", admin_area: "一级行政区", locality: "城市",
};
const localityLabel = (locality: Pick<GeoLocality, "country_code" | "admin_area" | "locality_name">) =>
  [locality.country_code, locality.admin_area, locality.locality_name].filter(Boolean).join(" / ");
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function LocalityAdminSection({ onMessage }: { onMessage: (message: string) => void }) {
  const auth = useAuth();
  const [areaLevel, setAreaLevel] = useState<GeoLocality["area_level"]>("locality");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [cityName, setCityName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [clearAfter, setClearAfter] = useState(true);

  const payload: GeoLocalityCreate = {
    country_code: country.trim(),
    admin_area: areaLevel === "country" ? null : region.trim() || null,
    locality_name: areaLevel === "locality" ? cityName.trim() || null : null,
    area_level: areaLevel,
  };
  const validation = !/^[A-Z]{2}$/.test(payload.country_code) ? "国家／地区代码必须是两个大写英文字母。"
    : areaLevel === "admin_area" && !payload.admin_area ? "一级行政区必须填写行政区名称。"
    : areaLevel === "locality" && !payload.locality_name ? "城市层级必须填写城市名称。" : "";
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    ["层级", AREA_LEVELS[areaLevel]], ["国家／地区", payload.country_code],
    ["行政区", payload.admin_area ?? "未填写"], ["城市", payload.locality_name ?? "未填写"],
  ];

  const clear = () => {
    setAreaLevel("locality"); setCountry(""); setRegion(""); setCityName(""); setMessage("");
  };
  const submit = async () => {
    if (validation || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setMessage("");
    try {
      const created = await createConsoleLocality(payload, auth.csrfToken ?? "");
      setConfirm(false);
      if (clearAfter) clear();
      const success = `已新增地区 #${created.id} ${localityLabel(created)}。`;
      setMessage(success); onMessage(success);
    } catch (error) {
      setMessage(`新增地区失败，已保留填写内容：${errorText(error)}`);
    } finally {
      submittingRef.current = false; setSubmitting(false);
    }
  };

  return <section className="tour-admin-section" aria-label="新增地区">
    <div>
      <div className="console-table-wrap">
        <table className="console-admin-table" aria-label="新增地区资料">
          <thead><tr><th scope="col">地区层级</th><th scope="col">国家／地区代码</th><th scope="col">都道府县／省／州</th><th scope="col">城市名称</th></tr></thead>
          <tbody><tr>
            <td><select aria-label="地区层级" value={areaLevel} disabled={submitting} onChange={event => setAreaLevel(event.target.value as GeoLocality["area_level"])}>
              {Object.entries(AREA_LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></td>
            <td><input aria-label="国家／地区代码" maxLength={2} placeholder="JP" value={country} disabled={submitting} onChange={event => setCountry(event.target.value.toUpperCase())} /></td>
            <td><input aria-label="都道府县／省／州" value={region} disabled={submitting || areaLevel === "country"} onChange={event => setRegion(event.target.value)} /></td>
            <td><input aria-label="城市名称" value={cityName} disabled={submitting || areaLevel !== "locality"} onChange={event => setCityName(event.target.value)} /></td>
          </tr></tbody>
        </table>
      </div>
      {validation && (country || region || cityName) && <p className="console-admin-hint" role="status">{validation}</p>}
      {message && <p className="console-admin-hint" role="status">{message}</p>}
      <div className="console-submit-row live-admin-insert-row venue-create-actions">
        <label className="live-clear-after-create-option"><input type="checkbox" checked={clearAfter} disabled={submitting} onChange={event => setClearAfter(event.target.checked)} />新增成功后清空表单</label>
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={clear}>清空</button>
        <button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => { setMessage(""); setConfirm(true); }}>提交插入</button>
      </div>
    </div>
    {confirm && <div className="modal-mask" onClick={() => !submitting && setConfirm(false)}>
      <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="locality-confirm-title" onClick={event => event.stopPropagation()}>
        <div className="modal-head"><h2 id="locality-confirm-title">确认新增地区</h2></div>
        <div className="console-confirm-body"><CompactConfirmationTable ariaLabel="新增地区确认" rows={rows} />{message && <p role="alert">{message}</p>}</div>
        <div className="console-confirm-actions">
          <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirm(false)}>取消</button>
          <button type="button" className="console-submit-btn" disabled={submitting || !!validation} onClick={() => void submit()}>{submitting ? "正在提交…" : "提交插入"}</button>
        </div>
      </div>
    </div>}
  </section>;
}
