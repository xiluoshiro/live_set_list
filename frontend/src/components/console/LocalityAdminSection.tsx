import { useEffect, useState, type ReactNode } from "react";

import {
  createConsoleLocality, getConsoleLocalities, previewConsoleLocality, saveConsoleLocality,
  type GeoLocality, type GeoLocalityCreate, type GeoLocalityPage,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";

const AREA_LEVELS: Record<GeoLocality["area_level"], string> = {
  country: "国家／地区", admin_area: "一级行政区", locality: "城市",
};
const localityLabel = (locality: GeoLocality) =>
  [locality.country_code, locality.admin_area, locality.locality_name].filter(Boolean).join(" / ");

type Confirmation = {
  title: string;
  rows: ReadonlyArray<readonly [string, ReactNode]>;
  confirmLabel: "提交插入" | "保存修改";
  submit: () => Promise<void>;
};

export function LocalityAdminSection({ onMessage }: { onMessage: (message: string) => void }) {
  const auth = useAuth();
  const [page, setPage] = useState<GeoLocalityPage>({ items: [], total: 0, page: 1, page_size: 20 });
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selected, setSelected] = useState<GeoLocality | null>(null);
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [areaLevel, setAreaLevel] = useState<GeoLocality["area_level"]>("locality");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [cityName, setCityName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const load = async (nextQuery: string, nextPage: number) => {
    setBusy(true);
    try {
      const result = await getConsoleLocalities(nextQuery, nextPage);
      setPage(result);
      setSearchedQuery(nextQuery);
      setSelected((current) => result.items.find((item) => item.id === current?.id) ?? null);
    } catch (error) {
      onMessage(`加载地区失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load("", 1); }, []);

  const open = (nextMode: "create" | "edit") => {
    if (nextMode === "edit" && selected) {
      setAreaLevel(selected.area_level); setCountry(selected.country_code);
      setRegion(selected.admin_area ?? ""); setCityName(selected.locality_name ?? "");
    } else {
      setAreaLevel("locality"); setCountry(""); setRegion(""); setCityName("");
    }
    setMode(nextMode);
  };
  const payload: GeoLocalityCreate = {
    country_code: country,
    admin_area: areaLevel === "country" ? null : region.trim() || null,
    locality_name: areaLevel === "locality" ? cityName.trim() || null : null,
    area_level: areaLevel,
  };
  const valid = /^[A-Z]{2}$/.test(country)
    && (areaLevel !== "admin_area" || !!region.trim())
    && (areaLevel !== "locality" || !!cityName.trim());
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    ["层级", AREA_LEVELS[areaLevel]], ["国家／地区", country],
    ["行政区", payload.admin_area ?? "未填写"], ["城市", payload.locality_name ?? "未填写"],
  ];

  return <section className="tour-admin-section" aria-label="地区管理">
    <div className="tour-admin-toolbar live-admin-toolbar venue-admin-toolbar">
      <span className="live-management-label">已登记地区</span>
      <input className="venue-query-input live-management-primary-control" aria-label="搜索地区" value={query}
        disabled={busy} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void load(query.trim(), 1); }} />
      <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => void load(query.trim(), 1)}>查询</button>
      <select aria-label="已登记地区" value={selected?.id ?? ""} disabled={busy || page.items.length === 0}
        onChange={(event) => setSelected(page.items.find((item) => item.id === Number(event.target.value)) ?? null)}>
        <option value="">选择地区</option>{page.items.map((item) => <option key={item.id} value={item.id}>{localityLabel(item)}</option>)}
      </select>
      <div className="tour-candidate-pager">
        <button type="button" className="console-ghost-btn" disabled={busy || page.page <= 1} onClick={() => void load(searchedQuery, page.page - 1)}>上一页</button>
        <span>第 {page.page} / {Math.max(1, Math.ceil(page.total / page.page_size))} 页，共 {page.total} 个地区</span>
        <button type="button" className="console-ghost-btn" disabled={busy || page.page * page.page_size >= page.total} onClick={() => void load(searchedQuery, page.page + 1)}>下一页</button>
      </div>
    </div>
    <div className="console-submit-row">
      <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => open("create")}>登记已核验地区</button>
      <button type="button" className="console-ghost-btn" disabled={busy || !selected} onClick={() => open("edit")}>修改已选地区</button>
    </div>
    {mode && <div className="tour-admin-block">
      <h3>{mode === "create" ? "登记已核验地区" : "修改已选地区"}</h3>
      <div className="tour-admin-fields">
        <label>地区层级<select aria-label="地区层级" value={areaLevel} disabled={busy} onChange={(event) => setAreaLevel(event.target.value as GeoLocality["area_level"])}>
          {Object.entries(AREA_LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>国家／地区代码<input maxLength={2} value={country} disabled={busy} placeholder="JP" onChange={(event) => setCountry(event.target.value.toUpperCase())} /></label>
        <label>都道府县／省／州<input value={region} disabled={busy || areaLevel === "country"} onChange={(event) => setRegion(event.target.value)} /></label>
        <label>城市名称<input value={cityName} disabled={busy || areaLevel !== "locality"} onChange={(event) => setCityName(event.target.value)} /></label>
      </div>
      <p className="console-admin-hint">先查询已有地区，避免重复登记。</p>
      <div className="console-submit-row">
        <button type="button" className="console-submit-btn" disabled={busy || !valid} onClick={() => {
          if (mode === "create") {
            setConfirmation({ title: "确认登记地区", rows, confirmLabel: "提交插入", submit: async () => {
              const created = await createConsoleLocality(payload, auth.csrfToken ?? "");
              setMode(null); onMessage("地区已登记。"); await load(searchedQuery, 1); setSelected(created);
            }});
          } else if (selected) {
            const update = { ...payload, expected_state_token: selected.state_token };
            void (async () => {
              try {
                const preview = await previewConsoleLocality(selected.id, update);
                setConfirmation({ title: "确认地区资料修改", confirmLabel: "保存修改", rows: [
                  ["原地区", localityLabel(preview.before)], ["新地区", localityLabel({ ...preview.before, ...preview.after })],
                  ["引用 Venue", preview.venue_count], ["关联 Live", preview.live_count],
                ], submit: async () => {
                  const saved = await saveConsoleLocality(selected.id, preview.after, auth.csrfToken ?? "");
                  setMode(null); onMessage("地区已保存；关联 Live 的已存时间偏移不随本次资料修改而变动。"); await load(searchedQuery, page.page); setSelected(saved);
                }});
              } catch (error) { onMessage(`预览地区修改失败：${error instanceof Error ? error.message : String(error)}`); }
            })();
          }
        }}>{mode === "create" ? "提交插入" : "预览修改"}</button>
        <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => setMode(null)}>取消</button>
      </div>
    </div>}
    {confirmation && <div className="modal-mask" onClick={() => !busy && setConfirmation(null)}>
      <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="locality-confirm-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2 id="locality-confirm-title">{confirmation.title}</h2></div>
        <div className="console-confirm-body"><CompactConfirmationTable ariaLabel={confirmation.title} rows={confirmation.rows} /></div>
        <div className="console-confirm-actions">
          <button type="button" className="console-ghost-btn" disabled={busy} onClick={() => setConfirmation(null)}>取消</button>
          <button type="button" className="console-submit-btn" disabled={busy} onClick={() => { setBusy(true); void confirmation.submit().then(() => setConfirmation(null)).catch((error) => onMessage(`保存地区失败：${error instanceof Error ? error.message : String(error)}`)).finally(() => setBusy(false)); }}>{confirmation.confirmLabel}</button>
        </div>
      </div>
    </div>}
  </section>;
}
