import { useState } from "react";

import type { CatalogStatsResponse, DatePhase, EventStatus } from "../api";
import type { BandIconInput } from "./BandIconsCell";
import { HomeLiveCalendar } from "./HomeLiveCalendar";
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
  stats: CatalogStatsResponse | null;
  refreshKey?: number;
  onOpenLive: (row: HomeLiveRow) => void;
  onShowAll: () => void;
  onSearch: (query: string) => void;
  onShowAbout: () => void;
};

export function HomeDashboard({
  stats,
  refreshKey = 0,
  onOpenLive,
  onShowAll,
  onSearch,
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
            title="BanG Dream! Live 资料库"
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
            />
            <button type="submit" disabled={!normalizedQuery}>
              搜索
            </button>
          </div>
        </form>
      </section>

      <section className="home-metrics" aria-label="数据概览">
        <div className="home-metric">
          <span className="home-metric-label">已收录 Live</span>
          <strong className="home-metric-value">{stats?.live_count ?? "..."}</strong>
        </div>
        <div className="home-metric">
          <span className="home-metric-label">乐队</span>
          <strong className="home-metric-value">{stats?.band_count ?? "..."}</strong>
        </div>
        <div className="home-metric">
          <span className="home-metric-label">歌曲</span>
          <strong className="home-metric-value">{stats?.song_count ?? "..."}</strong>
        </div>
        <div className="home-metric">
          <span className="home-metric-label">场地</span>
          <strong className="home-metric-value">{stats?.venue_count ?? "..."}</strong>
        </div>
      </section>

      <HomeLiveCalendar onOpenLive={onOpenLive} onShowAll={onShowAll} refreshKey={refreshKey} />

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
