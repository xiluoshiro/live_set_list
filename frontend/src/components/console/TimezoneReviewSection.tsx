import { useEffect, useState } from "react";

import {
  applyConsoleCurrentTimezone,
  getConsoleTimezoneReviews,
  retainConsoleTimezoneSnapshot,
  type TimezoneReviewExpected,
  type TimezoneReviewItem,
  type TimezoneReviewStatus,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";

type Props = {
  onMessage: (message: string) => void;
  onOpenLive: (liveId: number) => void;
};

const STATUS_OPTIONS: Array<{ value: TimezoneReviewStatus | "all"; label: string }> = [
  { value: "needs_review", label: "需要复核" },
  { value: "retained", label: "已保留快照" },
  { value: "revision_only", label: "仅修订号变化" },
  { value: "current", label: "当前一致" },
  { value: "unaffected", label: "Explicit 不受影响" },
  { value: "legacy_exception", label: "Legacy / ONLINE 例外" },
  { value: "all", label: "全部" },
];

const STATUS_LABELS: Record<TimezoneReviewStatus, string> = {
  needs_review: "需要复核",
  retained: "已保留快照",
  revision_only: "时区相同，仅修订号变化",
  current: "当前一致",
  unaffected: "Explicit，不受 Venue 影响",
  legacy_exception: "Legacy / ONLINE 保留例外",
};

function expected(item: TimezoneReviewItem): TimezoneReviewExpected | null {
  if (!item.snapshot_timezone_id || !item.current_timezone_id || item.current_source_revision === null) return null;
  return {
    expected_snapshot_timezone_id: item.snapshot_timezone_id,
    expected_snapshot_source_revision: item.snapshot_source_revision,
    expected_current_timezone_id: item.current_timezone_id,
    expected_current_source_revision: item.current_source_revision,
  };
}

function offset(value: number | null): string {
  if (value === null) return "无法计算";
  const sign = value >= 0 ? "+" : "-";
  const absolute = Math.abs(value);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function TimezoneReviewSection({ onMessage, onOpenLive }: Props) {
  const auth = useAuth();
  const [items, setItems] = useState<TimezoneReviewItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<TimezoneReviewStatus | "all">("needs_review");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TimezoneReviewItem | null>(null);
  const [decision, setDecision] = useState<"retain" | "apply" | null>(null);
  const [reason, setReason] = useState("");

  const load = async (nextStatus = status, nextQuery = searchedQuery, nextPage = page) => {
    setLoading(true);
    try {
      const result = await getConsoleTimezoneReviews(nextStatus, nextQuery, nextPage);
      setItems(result.items);
      setCounts(result.counts);
      setPage(result.page);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (error) {
      onMessage(`加载时区复核列表失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load("needs_review", "", 1); }, []);

  const chooseStatus = (next: TimezoneReviewStatus | "all") => {
    setStatus(next);
    setPage(1);
    void load(next, searchedQuery, 1);
  };

  const submit = async () => {
    if (!selected || !decision) return;
    const concurrency = expected(selected);
    if (!concurrency) return;
    setLoading(true);
    try {
      if (decision === "retain") {
        await retainConsoleTimezoneSnapshot(selected.live_id, { ...concurrency, reason: reason.trim() }, auth.csrfToken ?? "");
        onMessage(`已保留 Live #${selected.live_id} 的历史时区快照，并记录复核理由。`);
      } else {
        await applyConsoleCurrentTimezone(selected.live_id, concurrency, auth.csrfToken ?? "");
        onMessage(`已按资料修正 Live #${selected.live_id} 的时区；当地钟点保持不变。`);
      }
      setSelected(null);
      setDecision(null);
      setReason("");
      await load(status, searchedQuery, page);
    } catch (error) {
      onMessage(`提交时区复核失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="tour-admin-section" aria-label="Live 时区复核中心">
      <div className="tour-admin-block">
        <h3>Live 时区复核中心</h3>
        <p className="console-admin-hint">只把有效时区真正变化的 Live 放入待复核队列；修订号变化但时区相同不会误报。历史快照只能逐场保留或修正。</p>
        <div className="tour-admin-toolbar live-admin-toolbar">
          <label>状态<select aria-label="复核状态" value={status} disabled={loading} onChange={(event) => chooseStatus(event.target.value as TimezoneReviewStatus | "all")}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}（{counts[option.value] ?? 0}）</option>)}
          </select></label>
          <label>Live / Venue<input aria-label="搜索时区复核" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") { const next = query.trim(); setSearchedQuery(next); setPage(1); void load(status, next, 1); }
          }} /></label>
          <button type="button" className="console-ghost-btn" disabled={loading} onClick={() => {
            const next = query.trim(); setSearchedQuery(next); setPage(1); void load(status, next, 1);
          }}>查询</button>
        </div>

        {items.length === 0 && !loading ? <p className="console-admin-hint">当前筛选下没有 Live。</p> : (
          <div className="console-table-wrap">
            <table className="console-admin-table live-history-table" aria-label="Live 时区复核列表">
              <thead><tr><th>Live</th><th>来源</th><th>历史快照</th><th>当前资料</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>{items.map((item) => {
                const canResolve = item.status === "needs_review" && expected(item) !== null && !item.preview_error;
                return <tr key={item.live_id}>
                  <td>#{item.live_id} {item.live_date}<br />{item.live_title}{item.venue_name ? <><br />{item.venue_name}</> : null}</td>
                  <td>{item.timezone_source}<br />revision {item.snapshot_source_revision ?? "-"} → {item.current_source_revision ?? "-"}</td>
                  <td>{item.snapshot_timezone_id ?? "固定偏移"}<br />{offset(item.snapshot_offset_minutes)}</td>
                  <td>{item.current_timezone_id ?? "不适用"}<br />{offset(item.current_offset_minutes)}</td>
                  <td>{STATUS_LABELS[item.status]}{item.retained_reason ? <><br />理由：{item.retained_reason}</> : null}{item.preview_error ? <><br />{item.preview_error}</> : null}</td>
                  <td>
                    <button type="button" className="console-ghost-btn" onClick={() => onOpenLive(item.live_id)}>打开 Live</button>
                    {canResolve && <>
                      <button type="button" className="console-ghost-btn" onClick={() => { setSelected(item); setDecision("retain"); }}>保留快照</button>
                      <button type="button" className="console-submit-btn" onClick={() => { setSelected(item); setDecision("apply"); }}>采用当前时区</button>
                    </>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <div className="tour-candidate-pager">
          <button type="button" className="console-ghost-btn" disabled={loading || page <= 1} onClick={() => void load(status, searchedQuery, page - 1)}>上一页</button>
          <span>第 {page} / {Math.max(1, totalPages)} 页，共 {total} 场</span>
          <button type="button" className="console-ghost-btn" disabled={loading || page >= totalPages} onClick={() => void load(status, searchedQuery, page + 1)}>下一页</button>
        </div>
      </div>

      {selected && decision && <div className="modal-mask" onClick={() => !loading && setSelected(null)}>
        <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="timezone-review-title" onClick={(event) => event.stopPropagation()}>
          <div className="modal-head"><h2 id="timezone-review-title">{decision === "retain" ? "确认保留历史时区快照" : "确认采用当前时区"}</h2></div>
          <div className="console-confirm-body">
            <CompactConfirmationTable ariaLabel="Live 时区复核确认" rows={[
              ["Live", `#${selected.live_id} ${selected.live_date} ${selected.live_title}`],
              ["时区", `${selected.snapshot_timezone_id} → ${selected.current_timezone_id}`],
              ["偏移", `${offset(selected.snapshot_offset_minutes)} → ${offset(selected.current_offset_minutes)}`],
              ["开场", `${selected.opening_time ?? "未公布"} → ${selected.current_opening_time ?? "未公布"}`],
              ["开演", `${selected.start_time ?? "未公布"} → ${selected.current_start_time ?? "未公布"}`],
            ]} />
            {decision === "retain" && <label>保留理由<textarea aria-label="保留理由" value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
            {decision === "apply" && <p className="console-admin-hint">这是资料修正，不会补造主办方改期历史；当地墙上钟点保持不变。</p>}
          </div>
          <div className="console-confirm-actions">
            <button type="button" className="console-ghost-btn" disabled={loading} onClick={() => setSelected(null)}>取消</button>
            <button type="button" className="console-submit-btn" disabled={loading || (decision === "retain" && !reason.trim())} onClick={() => void submit()}>确认提交</button>
          </div>
        </div>
      </div>}
    </section>
  );
}
