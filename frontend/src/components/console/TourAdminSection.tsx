import { useEffect, useMemo, useRef, useState } from "react";

import {
  createConsoleTour,
  getConsoleTour,
  getConsoleTourLiveCandidates,
  getTours,
  updateConsoleTour,
  type ConsoleTourLiveCandidate,
  type ConsoleTourMutationResponse,
  type ConsoleTourUpsertPayload,
  type TourSummary,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { getTourStopShortTitle } from "../tourHelpers";
import type { BandOption, Position } from "./types";

type DraftStop = {
  live_id: number;
  live_date: string;
  live_title: string;
  venue: string | null;
  stop_label: string;
  band_ids: number[];
};

type TourAdminSectionProps = {
  bands: BandOption[];
  onTourDataChanged?: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortStops(stops: DraftStop[]): DraftStop[] {
  return [...stops].sort(
    (left, right) => left.live_date.localeCompare(right.live_date) || left.live_id - right.live_id,
  );
}

function candidateToDraft(candidate: ConsoleTourLiveCandidate): DraftStop {
  return {
    live_id: candidate.live_id,
    live_date: candidate.live_date,
    live_title: candidate.live_title,
    venue: candidate.venue,
    stop_label: "",
    band_ids: candidate.band_ids,
  };
}

export function TourAdminSection({ bands, onTourDataChanged }: TourAdminSectionProps) {
  const auth = useAuth();
  const sortedBands = useMemo(
    () => bands.filter((band) => band.band_id > 0).sort((left, right) => left.band_id - right.band_id),
    [bands],
  );
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [selectedTourId, setSelectedTourId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [tourTitle, setTourTitle] = useState("");
  const [selectedBandIds, setSelectedBandIds] = useState<number[]>([]);
  const [bandMenuOpen, setBandMenuOpen] = useState(false);
  const [bandMenuPos, setBandMenuPos] = useState<Position | null>(null);
  const bandTriggerRef = useRef<HTMLButtonElement>(null);
  const bandMenuRef = useRef<HTMLDivElement>(null);
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateTotalPages, setCandidateTotalPages] = useState(1);
  const [candidates, setCandidates] = useState<ConsoleTourLiveCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [insertedTours, setInsertedTours] = useState<ConsoleTourMutationResponse["item"][]>([]);

  const resetForm = () => {
    setSelectedTourId(null);
    setIsNew(true);
    setTourTitle("");
    setSelectedBandIds([]);
    setBandMenuOpen(false);
    setBandMenuPos(null);
    setStops([]);
    setCandidateQuery("");
    setCandidatePage(1);
    setCandidateTotalPages(1);
    setCandidates([]);
    setMessage("");
  };

  const loadTourList = async () => {
    const response = await getTours(1, 20);
    setTours(response.items);
  };

  useEffect(() => {
    void loadTourList().catch((error) => setMessage(`加载巡演列表失败：${errorMessage(error)}`));
  }, []);

  useEffect(() => {
    let canceled = false;
    setCandidateLoading(true);
    getConsoleTourLiveCandidates(candidateQuery, candidatePage, 20)
      .then((response) => {
        if (canceled) return;
        setCandidates(response.items);
        setCandidatePage(response.page);
        setCandidateTotalPages(response.total_pages);
      })
      .catch((error) => {
        if (!canceled) setMessage(`加载 Live 候选失败：${errorMessage(error)}`);
      })
      .finally(() => {
        if (!canceled) setCandidateLoading(false);
      });
    return () => { canceled = true; };
  }, [candidatePage]);

  const positionBandMenu = () => {
    const rect = bandTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.max(rect.width, 320);
    const estimatedHeight = Math.min(320, window.innerHeight * 0.6);
    const below = rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight
      ? below
      : Math.max(rect.top - estimatedHeight - 6, 4);
    setBandMenuPos({
      top,
      left: Math.min(rect.left, window.innerWidth - menuWidth - 12),
      width: menuWidth,
    });
  };

  useEffect(() => {
    if (!bandMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bandTriggerRef.current?.contains(target)) return;
      if (bandMenuRef.current?.contains(target)) return;
      setBandMenuOpen(false);
    };
    const close = () => setBandMenuOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", positionBandMenu, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", positionBandMenu);
    };
  }, [bandMenuOpen]);

  const loadSelectedTour = async (tourId: number) => {
    setLoading(true);
    setMessage("");
    try {
      const detail = await getConsoleTour(tourId);
      setSelectedTourId(tourId);
      setIsNew(false);
      setTourTitle(detail.tour_title);
      setSelectedBandIds([...detail.band_ids].sort((left, right) => left - right));
      setStops(sortStops(detail.stops.map((stop) => ({
        live_id: stop.live_id,
        live_date: stop.live_date,
        live_title: stop.live_title,
        venue: stop.venue,
        stop_label: stop.stop_label ?? "",
        band_ids: stop.band_ids,
      }))));
    } catch (error) {
      setMessage(`加载巡演详情失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const queryCandidates = async (query = candidateQuery) => {
    setCandidateLoading(true);
    setCandidatePage(1);
    try {
      const response = await getConsoleTourLiveCandidates(query, 1, 20);
      setCandidates(response.items);
      setCandidateTotalPages(response.total_pages);
    } catch (error) {
      setMessage(`查询 Live 候选失败：${errorMessage(error)}`);
    } finally {
      setCandidateLoading(false);
    }
  };

  const addCandidate = (candidate: ConsoleTourLiveCandidate) => {
    if (stops.some((stop) => stop.live_id === candidate.live_id)) return;
    setStops((current) => sortStops([...current, candidateToDraft(candidate)]));
  };

  const addAllFilteredCandidates = async () => {
    setCandidateLoading(true);
    setMessage("");
    try {
      const response = await getConsoleTourLiveCandidates(candidateQuery, 1, 500);
      if (response.total > 500) {
        setMessage("筛选结果超过 500 场，请缩小查询范围后再一键添加。");
        return;
      }
      const existingIds = new Set(stops.map((stop) => stop.live_id));
      const eligible = response.items.filter((candidate) => !existingIds.has(candidate.live_id));
      const skippedCount = response.items.length - eligible.length;
      setStops((current) => sortStops([...current, ...eligible.map(candidateToDraft)]));
      setMessage(`已添加 ${eligible.length} 场${skippedCount > 0 ? `，跳过 ${skippedCount} 场已选 Live` : ""}。`);
    } catch (error) {
      setMessage(`一键添加失败：${errorMessage(error)}`);
    } finally {
      setCandidateLoading(false);
    }
  };

  const selectedBandsAppear = selectedBandIds.every((bandId) =>
    stops.some((stop) => stop.band_ids.includes(bandId))
  );
  const selectedBandNames = selectedBandIds.length === 0
    ? "不指定"
    : selectedBandIds.map((bandId) =>
      sortedBands.find((band) => band.band_id === bandId)?.band_name ?? `Band #${bandId}`
    ).join("、");

  const toggleBandMenu = () => {
    if (bandMenuOpen) {
      setBandMenuOpen(false);
      return;
    }
    positionBandMenu();
    setBandMenuOpen(true);
  };

  const payload = useMemo<ConsoleTourUpsertPayload>(() => ({
    tour_title: tourTitle.trim(),
    band_ids: selectedBandIds,
    stops: sortStops(stops).map((stop) => ({
      live_id: stop.live_id,
      stop_label: stop.stop_label.trim() || null,
    })),
  }), [selectedBandIds, stops, tourTitle]);

  const canSubmit = payload.tour_title !== "" && payload.stops.length > 0 && selectedBandsAppear;

  const submit = async () => {
    if (!auth.csrfToken || !canSubmit) return;
    setSubmitting(true);
    setMessage("");
    try {
      const wasNew = isNew;
      const response = wasNew
        ? await createConsoleTour(payload, auth.csrfToken)
        : await updateConsoleTour(selectedTourId as number, payload, auth.csrfToken);
      setConfirming(false);
      if (wasNew) {
        setInsertedTours((current) => [response.item, ...current]);
      }
      resetForm();
      await Promise.all([loadTourList(), queryCandidates("")]);
      setMessage(`${wasNew ? "创建" : "更新"}巡演成功：#${response.item.tour_id} ${response.item.tour_title}`);
      onTourDataChanged?.();
    } catch (error) {
      setConfirming(false);
      setMessage(`保存巡演失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="tour-admin-section" aria-label="巡演管理">
      {message && <p className="console-admin-hint" role="status">{message}</p>}
      <div className="tour-admin-toolbar">
        <label htmlFor="tour-admin-select">已有巡演</label>
        <select
          id="tour-admin-select"
          value={selectedTourId ?? ""}
          onChange={(event) => {
            const tourId = Number(event.target.value);
            if (tourId > 0) void loadSelectedTour(tourId);
          }}
          disabled={loading || tours.length === 0}
        >
          <option value="">选择要编辑的巡演</option>
          {tours.map((tour) => <option key={tour.tour_id} value={tour.tour_id}>#{tour.tour_id} {tour.tour_title}</option>)}
        </select>
        <button type="button" className="console-ghost-btn" onClick={() => { resetForm(); void queryCandidates(""); }}>新建巡演</button>
      </div>

      <div className="tour-admin-fields">
        <label>巡演名称<input value={tourTitle} maxLength={255} onChange={(event) => setTourTitle(event.target.value)} /></label>
        <fieldset className="tour-band-field">
          <legend>参与乐队</legend>
          <button
            ref={bandTriggerRef}
            type="button"
            className="bands-picker-trigger tour-band-trigger"
            onClick={toggleBandMenu}
            title={selectedBandNames}
            aria-expanded={bandMenuOpen}
          >
            {selectedBandNames}
          </button>
        </fieldset>
      </div>
      {bandMenuOpen && bandMenuPos && (
        <div
          ref={bandMenuRef}
          className="bands-floating-menu"
          role="group"
          aria-label="参与乐队"
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          style={{ top: bandMenuPos.top, left: bandMenuPos.left, width: bandMenuPos.width }}
        >
          <label>
            <input
              type="checkbox"
              checked={selectedBandIds.length === 0}
              onChange={() => setSelectedBandIds([])}
            />
            <span>不指定</span>
          </label>
          {sortedBands.map((band) => (
            <label key={band.band_id}>
              <input
                type="checkbox"
                checked={selectedBandIds.includes(band.band_id)}
                onChange={() => setSelectedBandIds((current) => current.includes(band.band_id)
                  ? current.filter((bandId) => bandId !== band.band_id)
                  : [...current, band.band_id].sort((left, right) => left - right))}
              />
              <span>{band.band_id} - {band.band_name}</span>
            </label>
          ))}
        </div>
      )}
      {!selectedBandsAppear && (
        <p className="console-admin-hint tour-band-validation" role="alert">
          每个参与乐队都必须至少出现在一场已选 Live 中。
        </p>
      )}

      <div className="tour-admin-block">
        <h3>搜索并添加场次</h3>
        <div className="tour-candidate-search">
          <input value={candidateQuery} placeholder="输入 Live ID 或标题" onChange={(event) => setCandidateQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void queryCandidates(); }} />
          <button type="button" className="console-ghost-btn" onClick={() => void queryCandidates()}>查询</button>
          <button type="button" className="console-ghost-btn" disabled={candidateLoading} onClick={() => void addAllFilteredCandidates()}>一键添加筛选结果</button>
        </div>
        <div className="console-table-wrap">
          <table className="console-admin-table tour-candidate-table">
            <colgroup>
              <col className="tour-candidate-col-date" />
              <col className="tour-candidate-col-live" />
              <col className="tour-candidate-col-venue" />
              <col className="tour-candidate-col-action" />
            </colgroup>
            <thead><tr><th>日期</th><th>Live</th><th>场地</th><th>操作</th></tr></thead>
            <tbody>
              {candidates.map((candidate) => {
                const alreadyAdded = stops.some((stop) => stop.live_id === candidate.live_id);
                return (
                  <tr key={candidate.live_id}>
                    <td>{candidate.live_date}</td><td>#{candidate.live_id} {candidate.live_title}</td><td>{candidate.venue ?? "-"}</td>
                    <td><button type="button" className="console-submit-btn" disabled={alreadyAdded} onClick={() => addCandidate(candidate)}>{alreadyAdded ? "已添加" : "添加"}</button></td>
                  </tr>
                );
              })}
              {!candidateLoading && candidates.length === 0 && <tr><td colSpan={4}>没有符合条件的 Live</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="tour-candidate-pager">
          <button type="button" className="console-ghost-btn" onClick={() => setCandidatePage((page) => Math.max(1, page - 1))} disabled={candidateLoading || candidatePage <= 1}>上一页</button>
          <span>第 {candidatePage} / {candidateTotalPages} 页</span>
          <button type="button" className="console-ghost-btn" onClick={() => setCandidatePage((page) => Math.min(candidateTotalPages, page + 1))} disabled={candidateLoading || candidatePage >= candidateTotalPages}>下一页</button>
        </div>
      </div>

      <div className="tour-admin-block">
        <h3>已选场次（{stops.length}）</h3>
        <div className="console-table-wrap">
          <table className="console-admin-table tour-stop-table" aria-label="已选场次">
            <thead><tr><th>日期</th><th>Live</th><th>场地</th><th>操作</th></tr></thead>
            <tbody>
              {stops.map((stop) => (
                <tr key={stop.live_id}>
                  <td>{stop.live_date}</td><td>#{stop.live_id} {stop.live_title}</td><td>{stop.venue ?? "-"}</td>
                  <td><button type="button" className="console-ghost-btn" onClick={() => setStops((current) => current.filter((item) => item.live_id !== stop.live_id))}>移除</button></td>
                </tr>
              ))}
              {stops.length === 0 && <tr><td colSpan={4}>至少添加一场 Live 后才能保存巡演。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="console-submit-row">
        <button type="button" className="console-ghost-btn" onClick={() => { resetForm(); void queryCandidates(""); }}>清空</button>
        <button type="button" className="console-submit-btn" disabled={!canSubmit || loading} onClick={() => setConfirming(true)}>{isNew ? "创建巡演" : "保存修改"}</button>
      </div>

      {confirming && (
        <div className="modal-mask" onClick={() => !submitting && setConfirming(false)}>
          <div className="modal console-confirm-modal compact tour" role="dialog" aria-modal="true" aria-labelledby="tour-confirm-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2 id="tour-confirm-title">确认{isNew ? "创建" : "更新"}巡演</h2>
              <div className="modal-actions">
                <button type="button" className="modal-action-btn close" aria-label="关闭" disabled={submitting} onClick={() => setConfirming(false)}><span className="modal-action-glyph close">✕</span></button>
              </div>
            </div>
            <div className="console-confirm-body">
              <div className="console-confirm-table-wrap">
                <table className="console-admin-table console-confirm-table">
                  <tbody>
                    <tr><th>tour_title</th><td>{payload.tour_title}</td></tr>
                    <tr><th>band</th><td>{selectedBandNames}</td></tr>
                    <tr><th>live_count</th><td>{stops.length}</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="console-table-wrap console-confirm-setlist-wrap">
                <table className="console-admin-table console-confirm-setlist-table" aria-label="确认场次">
                  <thead><tr><th>live_date</th><th>live_id</th><th>short_title</th></tr></thead>
                  <tbody>{stops.map((stop) => <tr key={stop.live_id}><td>{stop.live_date}</td><td>{stop.live_id}</td><td>{getTourStopShortTitle(stop.live_title, payload.tour_title)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirming(false)}>取消</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void submit()}>{submitting ? "提交中..." : "确认提交"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="console-table-wrap live-history-wrap">
        <table className="console-admin-table live-history-table tour-history-table" aria-label="新增巡演记录">
          <thead><tr><th>tour_id</th><th>tour_title</th><th>band_count</th><th>stop_count</th></tr></thead>
          <tbody>
            {insertedTours.length === 0 ? (
              <tr><td colSpan={4} className="empty-cell">暂无新增巡演记录</td></tr>
            ) : insertedTours.map((tour) => (
              <tr key={tour.tour_id}>
                <td>{tour.tour_id}</td>
                <td>{tour.tour_title}</td>
                <td>{tour.band_count}</td>
                <td>{tour.stop_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
