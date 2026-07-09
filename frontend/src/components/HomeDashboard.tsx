import { useState } from "react";

import { BandIconsCell, type BandIconInput } from "./BandIconsCell";

export type HomeLiveRow = {
  liveId: number;
  liveDate: string;
  liveTitle: string;
  icons: BandIconInput[];
};

type HomeDashboardProps = {
  isAuthenticated: boolean;
  canUseConsoleFeatures: boolean;
  favoriteCount: number;
  liveTotal: number;
  recentRows: HomeLiveRow[];
  loading: boolean;
  error: string | null;
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
          <p className="home-kicker">Community live database</p>
          <h2 id="home-title">BanG Dream! Live 资料库</h2>
          <p className="home-summary">浏览和整理 Live、setlist、出演成员与来源链接。</p>
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
        <div className="home-metric home-metric-muted">
          <span className="home-metric-value">待补充</span>
          <span className="home-metric-label">乐队 / 歌曲 / 场地统计</span>
        </div>
        <div className="home-metric home-metric-muted">
          <span className="home-metric-value">阶段 2</span>
          <span className="home-metric-label">公共搜索与浏览</span>
        </div>
      </section>

      <div className="home-grid">
        <section className="home-section home-recent" aria-labelledby="home-recent-title">
          <div className="home-section-head">
            <h3 id="home-recent-title">最近收录</h3>
            <button type="button" className="action-link" onClick={onShowAll}>
              查看全部 Live <span className="action-link-arrow">→</span>
            </button>
            <button type="button" className="action-link" onClick={onShowBrowse}>
              乐队 <span className="action-link-arrow">→</span>
            </button>
            <p>来自当前 Live 列表第一页。</p>
          </div>

          {error ? (
            <p className="home-state home-state-error">最近 Live 加载失败: {error}</p>
          ) : loading ? (
            <p className="home-state">最近 Live 加载中...</p>
          ) : recentRows.length === 0 ? (
            <p className="home-state">当前没有可展示的 Live。</p>
          ) : (
            <ol className="home-recent-list">
              {recentRows.slice(0, 6).map((row) => (
                <li key={row.liveId} className="home-recent-item">
                  <span className="home-recent-date">{row.liveDate}</span>
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
