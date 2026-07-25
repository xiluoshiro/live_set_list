import { useState } from "react";

import type { CatalogStatsResponse, DatePhase, EventStatus } from "../api";
import { formatLiveStatusText } from "../liveStatus";
import { BandIconsCell, type BandIconInput } from "./BandIconsCell";
import { ContentState } from "./ContentState";
import { PageTitle } from "./PageTitle";

export type HomeLiveRow = {
  liveId: number;
  liveDate: string;
  liveTitle: string;
  icons: BandIconInput[];
  eventStatus: EventStatus | null;
  datePhase: DatePhase | null;
  wasRescheduled: boolean;
};

type HomeDashboardProps = {
  isAuthenticated: boolean;
  canUseConsoleFeatures: boolean;
  favoriteCount: number;
  liveTotal: number;
  recentRows: HomeLiveRow[];
  loading: boolean;
  error: string | null;
  stats: CatalogStatsResponse | null;
  onOpenLive: (row: HomeLiveRow) => void;
  onShowAll: () => void;
  onShowFavorites: () => void;
  onShowConsole: () => void;
  onLogin: () => void;
  onSearch: (query: string) => void;
  onShowBrowse: () => void;
  onShowAbout: () => void;
};

export function HomeDashboard({
  isAuthenticated,
  canUseConsoleFeatures,
  favoriteCount,
  liveTotal,
  recentRows,
  loading,
  error,
  stats,
  onOpenLive,
  onShowAll,
  onShowFavorites,
  onShowConsole,
  onLogin,
  onSearch,
  onShowBrowse,
  onShowAbout,
}: HomeDashboardProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();

  return (
    <div className="home-dashboard">
      <section className="home-intro" aria-labelledby="home-title">
        <div className="home-intro-copy">
          <PageTitle
            kicker="Community live database"
            title="查找 Live、曲目与出演记录"
            description="可搜索 Live、乐队、歌曲和场地。"
            id="home-title"
          />
        </div>
        <form
          className="home-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (normalizedQuery) onSearch(normalizedQuery);
          }}
        >
          <label className="home-search-label" htmlFor="home-search-input">
            搜索入口
          </label>
          <div className="home-search-row">
            <input
              id="home-search-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Live、乐队、歌曲、场地"
              aria-describedby="home-search-note"
            />
            <button type="submit" disabled={!normalizedQuery}>
              搜索
            </button>
          </div>
          <p id="home-search-note" className="home-search-note">
            支持按 Live、乐队、歌曲和场地搜索。
          </p>
        </form>
      </section>

      <section className="home-metrics" aria-label="数据概览">
        <div className="home-metric">
          <span className="home-metric-value">{loading ? "..." : liveTotal}</span>
          <span className="home-metric-label">已收录 Live</span>
        </div>
        <div className="home-metric">
          <span className="home-metric-value">{stats?.band_count ?? "..."}</span>
          <span className="home-metric-label">乐队</span>
        </div>
        <div className="home-metric">
          <span className="home-metric-value">{stats?.song_count ?? "..."}</span>
          <span className="home-metric-label">歌曲</span>
        </div>
        <div className="home-metric">
          <span className="home-metric-value">{stats?.venue_count ?? "..."}</span>
          <span className="home-metric-label">场地</span>
        </div>
      </section>
      <p className="home-latest-live">
        <span className="home-latest-live-label">最新 Live 日期</span>
        <span className="home-latest-live-value">{stats?.latest_live_date ?? "..."}</span>
      </p>

      <div className="home-grid">
        <section className="home-section home-recent" aria-labelledby="home-recent-title">
          <div className="home-section-head">
            <h3 id="home-recent-title">最近收录</h3>
            <button type="button" className="action-link home-show-all-link" onClick={onShowAll}>
              查看全部 Live <span className="action-link-arrow">→</span>
            </button>
            <button type="button" className="action-link" onClick={onShowBrowse}>
              乐队 <span className="action-link-arrow">→</span>
            </button>
            <p>来自当前 Live 列表第一页。</p>
          </div>

          {error ? (
            <ContentState
              kind="error"
              title="最近 Live 加载失败"
              description={error}
              layout="rows"
              compact
            />
          ) : loading ? (
            <ContentState
              kind="loading"
              title="最近 Live 加载中..."
              description="正在读取最新收录。"
              layout="rows"
              compact
            />
          ) : recentRows.length === 0 ? (
            <ContentState
              kind="empty"
              title="当前没有可展示的 Live。"
              description="完成资料收录后会显示在这里。"
              layout="rows"
              compact
            />
          ) : (
            <ol className="home-recent-list">
              {recentRows.slice(0, 6).map((row) => (
                <li key={row.liveId} className="home-recent-item">
                  <span className="home-recent-date">
                    {row.liveDate}
                    {` · ${formatLiveStatusText(
                      row.eventStatus ?? "scheduled",
                      row.datePhase ?? "past",
                      row.wasRescheduled,
                    )}`}
                  </span>
                  <button type="button" className="home-recent-title" onClick={() => onOpenLive(row)}>
                    {row.liveTitle}
                  </button>
                  <span className="home-recent-bands" title={`${row.icons.length} 支乐队`}>
                    <BandIconsCell icons={row.icons} rowId={row.liveId} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="home-section home-actions" aria-labelledby="home-actions-title">
          <h3 id="home-actions-title">个人与贡献</h3>
          {isAuthenticated ? (
            <>
              <p className="home-action-copy">已同步 {favoriteCount} 个收藏 Live。</p>
              <button type="button" className="action-link" onClick={onShowFavorites}>
                查看我的收藏 <span className="action-link-arrow">→</span>
              </button>
            </>
          ) : (
            <>
              <p className="home-action-copy">登录后可同步收藏；公共浏览不需要登录。</p>
              <button type="button" className="primary-btn" onClick={onLogin}>
                登录
              </button>
            </>
          )}
          {canUseConsoleFeatures && (
            <button type="button" className="action-link" onClick={onShowConsole}>
              进入控制台 <span className="action-link-arrow">→</span>
            </button>
          )}
        </section>
      </div>

      <section className="home-support" aria-labelledby="home-support-title">
        <div>
          <h3 id="home-support-title">关于与反馈</h3>
          <p>
            本站资料由站方整理维护。发现错误或希望补充信息时，请通过
            <button type="button" className="home-support-link" onClick={onShowAbout}>
              联系入口
            </button>
            反馈。
          </p>
        </div>
      </section>
    </div>
  );
}
