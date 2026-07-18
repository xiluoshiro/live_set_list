import { useEffect, useMemo, useState } from "react";

import {
  createConsoleTour,
  getConsoleTourLiveCandidates,
  getTourDetail,
  getTours,
  updateConsoleTour,
  type ConsoleTourLiveCandidate,
  type ConsoleTourUpsertPayload,
  type TourSummary,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import type { BandOption } from "./types";

type DraftStop = {
  live_id: number;
  live_date: string;
  live_title: string;
  venue: string | null;
  stop_label: string;
};

type TourAdminSectionProps = {
  bands: BandOption[];
  onTourDataChanged?: () => void;
};

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TourAdminSection({ bands, onTourDataChanged }: TourAdminSectionProps) {
  const auth = useAuth();
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [selectedTourId, setSelectedTourId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [tourTitle, setTourTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [bandIds, setBandIds] = useState<number[]>([]);
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

  const resetForm = () => {
    setSelectedTourId(null);
    setIsNew(true);
    setTourTitle("");
    setUrl("");
    setDescription("");
    setBandIds([]);
    setStops([]);
    setMessage("");
  };

  const loadTourList = async (preferredTourId?: number) => {
    const response = await getTours(1, 20);
    setTours(response.items);
    if (preferredTourId !== undefined && response.items.some((tour) => tour.tour_id === preferredTourId)) {
      setSelectedTourId(preferredTourId);
    }
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

  const loadSelectedTour = async (tourId: number) => {
    setLoading(true);
    setMessage("");
    try {
      const detail = await getTourDetail(tourId);
      setSelectedTourId(tourId);
      setIsNew(false);
      setTourTitle(detail.tour_title);
      setUrl(detail.url ?? "");
      setDescription(detail.description ?? "");
      setBandIds(detail.bands.map((band) => band.band_id));
      setStops(detail.stops.map((stop) => ({
        live_id: stop.live_id,
        live_date: stop.live_date,
        live_title: stop.live_title,
        venue: stop.venue,
        stop_label: stop.stop_label ?? "",
      })));
    } catch (error) {
      setMessage(`加载巡演详情失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const queryCandidates = async () => {
    setCandidateLoading(true);
    setCandidatePage(1);
    try {
      const response = await getConsoleTourLiveCandidates(candidateQuery, 1, 20);
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
    const next = [...stops, {
      live_id: candidate.live_id,
      live_date: candidate.live_date,
      live_title: candidate.live_title,
      venue: candidate.venue,
      stop_label: "",
    }].sort((left, right) => left.live_date.localeCompare(right.live_date) || left.live_id - right.live_id);
    setStops(next);
  };

  const toggleBand = (bandId: number) => {
    setBandIds((current) => current.includes(bandId)
      ? current.filter((item) => item !== bandId)
      : [...current, bandId]);
  };

  const payload = useMemo<ConsoleTourUpsertPayload>(() => ({
    tour_title: tourTitle.trim(),
    url: url.trim() || null,
    description: description.trim() || null,
    band_ids: bandIds,
    stops: stops.map((stop, index) => ({
      live_id: stop.live_id,
      stop_order: index + 1,
      stop_label: stop.stop_label.trim() || null,
    })),
  }), [bandIds, description, stops, tourTitle, url]);

  const canSubmit = payload.tour_title !== "" && payload.band_ids.length > 0 && payload.stops.length > 0;

  const submit = async () => {
    if (!auth.csrfToken || !canSubmit) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = isNew
        ? await createConsoleTour(payload, auth.csrfToken)
        : await updateConsoleTour(selectedTourId as number, payload, auth.csrfToken);
      setConfirming(false);
      setMessage(`${isNew ? "创建" : "更新"}巡演成功：#${response.item.tour_id} ${response.item.tour_title}`);
      await loadTourList(response.item.tour_id);
      await loadSelectedTour(response.item.tour_id);
      await queryCandidates();
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
        <button type="button" className="console-ghost-btn" onClick={resetForm}>新建巡演</button>
      </div>

      <div className="tour-admin-fields">
        <label>巡演名称<input value={tourTitle} maxLength={255} onChange={(event) => setTourTitle(event.target.value)} /></label>
        <label>官方来源<input value={url} maxLength={2048} placeholder="https://...（可选）" onChange={(event) => setUrl(event.target.value)} /></label>
        <label className="tour-description-field">简短说明<textarea value={description} maxLength={4000} rows={3} onChange={(event) => setDescription(event.target.value)} /></label>
      </div>

      <div className="tour-admin-block">
        <h3>参与乐队</h3>
        <div className="tour-band-picker">
          {bands.filter((band) => band.band_id > 0).map((band) => (
            <label key={band.band_id}>
              <input type="checkbox" checked={bandIds.includes(band.band_id)} onChange={() => toggleBand(band.band_id)} />
              {band.band_name}
            </label>
          ))}
        </div>
        {bandIds.length > 0 && (
          <ol className="tour-order-list">
            {bandIds.map((bandId, index) => (
              <li key={bandId}>
                <span>{bands.find((band) => band.band_id === bandId)?.band_name ?? `Band #${bandId}`}</span>
                <button type="button" onClick={() => setBandIds(moveItem(bandIds, index, -1))} disabled={index === 0}>上移</button>
                <button type="button" onClick={() => setBandIds(moveItem(bandIds, index, 1))} disabled={index === bandIds.length - 1}>下移</button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="tour-admin-block">
        <h3>搜索并添加场次</h3>
        <div className="tour-candidate-search">
          <input value={candidateQuery} placeholder="输入 Live ID 或标题" onChange={(event) => setCandidateQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void queryCandidates(); }} />
          <button type="button" className="console-ghost-btn" onClick={() => void queryCandidates()}>查询</button>
        </div>
        <div className="console-table-wrap">
          <table className="console-admin-table tour-candidate-table">
            <thead><tr><th>日期</th><th>Live</th><th>场地</th><th>当前巡演</th><th>操作</th></tr></thead>
            <tbody>
              {candidates.map((candidate) => {
                const belongsElsewhere = candidate.tour_id !== null && candidate.tour_id !== selectedTourId;
                const alreadyAdded = stops.some((stop) => stop.live_id === candidate.live_id);
                return (
                  <tr key={candidate.live_id} className={belongsElsewhere ? "tour-candidate-conflict" : ""}>
                    <td>{candidate.live_date}</td><td>#{candidate.live_id} {candidate.live_title}</td><td>{candidate.venue ?? "-"}</td>
                    <td>{candidate.tour_title ?? "未关联"}</td>
                    <td><button type="button" className="console-submit-btn" disabled={belongsElsewhere || alreadyAdded} onClick={() => addCandidate(candidate)}>{belongsElsewhere ? "已占用" : alreadyAdded ? "已添加" : "添加"}</button></td>
                  </tr>
                );
              })}
              {!candidateLoading && candidates.length === 0 && <tr><td colSpan={5}>没有符合条件的 Live</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="tour-candidate-pager">
          <button type="button" onClick={() => setCandidatePage((page) => Math.max(1, page - 1))} disabled={candidateLoading || candidatePage <= 1}>上一页</button>
          <span>第 {candidatePage} / {candidateTotalPages} 页</span>
          <button type="button" onClick={() => setCandidatePage((page) => Math.min(candidateTotalPages, page + 1))} disabled={candidateLoading || candidatePage >= candidateTotalPages}>下一页</button>
        </div>
      </div>

      <div className="tour-admin-block">
        <h3>已选场次（{stops.length}）</h3>
        <div className="console-table-wrap">
          <table className="console-admin-table tour-stop-table">
            <thead><tr><th>顺序</th><th>日期</th><th>Live</th><th>场次标签</th><th>操作</th></tr></thead>
            <tbody>
              {stops.map((stop, index) => (
                <tr key={stop.live_id}>
                  <td>{index + 1}</td><td>{stop.live_date}</td><td>#{stop.live_id} {stop.live_title}</td>
                  <td><input aria-label={`场次标签 ${stop.live_id}`} value={stop.stop_label} maxLength={255} onChange={(event) => setStops((current) => current.map((item) => item.live_id === stop.live_id ? { ...item, stop_label: event.target.value } : item))} /></td>
                  <td className="tour-stop-actions">
                    <button type="button" onClick={() => setStops(moveItem(stops, index, -1))} disabled={index === 0}>上移</button>
                    <button type="button" onClick={() => setStops(moveItem(stops, index, 1))} disabled={index === stops.length - 1}>下移</button>
                    <button type="button" onClick={() => setStops((current) => current.filter((item) => item.live_id !== stop.live_id))}>移除</button>
                  </td>
                </tr>
              ))}
              {stops.length === 0 && <tr><td colSpan={5}>至少添加一场 Live 后才能保存巡演。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="console-submit-row">
        <button type="button" className="console-ghost-btn" onClick={resetForm}>清空</button>
        <button type="button" className="console-submit-btn" disabled={!canSubmit || loading} onClick={() => setConfirming(true)}>{isNew ? "创建巡演" : "保存修改"}</button>
      </div>

      {confirming && (
        <div className="modal-mask" onClick={() => !submitting && setConfirming(false)}>
          <div className="modal console-confirm-modal wide tour-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="tour-confirm-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h2 id="tour-confirm-title">确认{isNew ? "创建" : "更新"}巡演</h2></div>
            <div className="console-confirm-body">
              <p><strong>{payload.tour_title}</strong></p>
              <p>参与乐队：{bandIds.map((bandId) => bands.find((band) => band.band_id === bandId)?.band_name ?? bandId).join("、")}</p>
              <p>场次数：{stops.length}</p>
              <ol>{stops.map((stop) => <li key={stop.live_id}>{stop.live_date} · {stop.stop_label || stop.live_title}（Live #{stop.live_id}）</li>)}</ol>
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirming(false)}>返回编辑</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void submit()}>{submitting ? "提交中..." : "确认提交"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
