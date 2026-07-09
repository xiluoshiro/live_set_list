import { useEffect, useState } from "react";

import type {
  CatalogBandItem,
  CatalogBandLivesResponse,
  CatalogSearchResponse,
  LiveItem,
} from "../api";
import { BandIconsCell, type BandIconInput } from "./BandIconsCell";

export type CatalogLiveRow = {
  liveId: number;
  liveDate: string;
  liveTitle: string;
  icons: BandIconInput[];
  url: string | null;
};

type SearchResultsPanelProps = {
  query: string;
  result: CatalogSearchResponse | null;
  loading: boolean;
  error: string | null;
  onSearch: (query: string) => void;
  onOpenLive: (row: CatalogLiveRow) => void;
  onSelectBand: (bandId: number) => void;
  onShowAbout: () => void;
};

type BandBrowsePanelProps = {
  bands: CatalogBandItem[];
  selectedBandId: number | null;
  bandLives: CatalogBandLivesResponse | null;
  loadingBands: boolean;
  loadingLives: boolean;
  error: string | null;
  page: number;
  onSelectBand: (bandId: number) => void;
  onOpenLive: (row: CatalogLiveRow) => void;
  onPageChange: (page: number) => void;
};

export function catalogLiveToRow(item: LiveItem): CatalogLiveRow {
  return {
    liveId: item.live_id,
    liveDate: item.live_date,
    liveTitle: item.live_title,
    icons: item.bands ?? [],
    url: item.url,
  };
}

function SearchForm({ query, onSearch }: { query: string; onSearch: (query: string) => void }) {
  const [value, setValue] = useState(query);
  useEffect(() => setValue(query), [query]);
  const normalizedValue = value.trim();

  return (
    <form
      className="catalog-search-form"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (normalizedValue) onSearch(normalizedValue);
      }}
    >
      <label htmlFor="catalog-search-input">搜索资料库</label>
      <div className="catalog-search-row">
        <input
          id="catalog-search-input"
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Live、乐队、歌曲、场地"
        />
        <button type="submit" className="primary-btn" disabled={!normalizedValue}>
          搜索
        </button>
      </div>
    </form>
  );
}

function LiveResultList({
  rows,
  onOpenLive,
}: {
  rows: CatalogLiveRow[];
  onOpenLive: (row: CatalogLiveRow) => void;
}) {
  if (rows.length === 0) return <p className="catalog-empty">没有匹配的 Live。</p>;
  return (
    <ol className="catalog-live-list">
      {rows.map((row) => (
        <li key={row.liveId} className="catalog-live-item">
          <span className="catalog-live-date">{row.liveDate}</span>
          <button type="button" className="catalog-live-title" onClick={() => onOpenLive(row)}>
            {row.liveTitle}
          </button>
          <span className="catalog-live-bands">
            <BandIconsCell icons={row.icons} rowId={row.liveId} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SearchResultsPanel({
  query,
  result,
  loading,
  error,
  onSearch,
  onOpenLive,
  onSelectBand,
  onShowAbout,
}: SearchResultsPanelProps) {
  const liveRows = result?.lives.map(catalogLiveToRow) ?? [];
  const hasAnyResult =
    liveRows.length > 0 ||
    (result?.bands.length ?? 0) > 0 ||
    (result?.songs.length ?? 0) > 0 ||
    (result?.venues.length ?? 0) > 0;

  return (
    <div className="catalog-panel">
      <div className="catalog-panel-head">
        <div>
          <p className="catalog-kicker">Search</p>
          <h2>搜索结果</h2>
          <p>按 Live、乐队、歌曲和场地分组展示。</p>
        </div>
        <button type="button" className="secondary-btn" onClick={onShowAbout}>
          联系我们
        </button>
      </div>
      <SearchForm query={query} onSearch={onSearch} />
      {error ? (
        <p className="catalog-state catalog-error">搜索失败: {error}</p>
      ) : loading ? (
        <p className="catalog-state">搜索中...</p>
      ) : result && !hasAnyResult ? (
        <p className="catalog-state">没有找到与“{result.query}”匹配的资料。</p>
      ) : (
        <div className="catalog-grid">
          <section className="catalog-section" aria-labelledby="catalog-live-results">
            <h3 id="catalog-live-results">Live</h3>
            <LiveResultList rows={liveRows} onOpenLive={onOpenLive} />
          </section>

          <section className="catalog-section" aria-labelledby="catalog-band-results">
            <h3 id="catalog-band-results">乐队 / 艺人</h3>
            {result?.bands.length ? (
              <div className="catalog-chip-list">
                {result.bands.map((band) => (
                  <button key={band.band_id} type="button" className="catalog-chip" onClick={() => onSelectBand(band.band_id)}>
                    <strong>{band.band_name}</strong>
                    <span>{band.live_count} 场 Live</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="catalog-empty">没有匹配的乐队。</p>
            )}
          </section>

          <section className="catalog-section" aria-labelledby="catalog-song-results">
            <h3 id="catalog-song-results">歌曲</h3>
            {result?.songs.length ? (
              <ul className="catalog-entity-list">
                {result.songs.map((song) => (
                  <li key={song.song_id}>
                    <strong>{song.song_name}</strong>
                    <span>{song.band_name ?? "未关联乐队"} · {song.live_count} 场 Live</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="catalog-empty">没有匹配的歌曲。</p>
            )}
          </section>

          <section className="catalog-section" aria-labelledby="catalog-venue-results">
            <h3 id="catalog-venue-results">场地</h3>
            {result?.venues.length ? (
              <ul className="catalog-entity-list">
                {result.venues.map((venue) => (
                  <li key={venue.venue_id}>
                    <strong>{venue.venue_name}</strong>
                    <span>{venue.live_count} 场 Live</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="catalog-empty">没有匹配的场地。</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export function BandBrowsePanel({
  bands,
  selectedBandId,
  bandLives,
  loadingBands,
  loadingLives,
  error,
  page,
  onSelectBand,
  onOpenLive,
  onPageChange,
}: BandBrowsePanelProps) {
  const liveRows = bandLives?.items.map(catalogLiveToRow) ?? [];
  const currentPage = bandLives?.pagination.page ?? page;
  const totalPages = bandLives?.pagination.total_pages ?? 1;

  return (
    <div className="catalog-panel">
      <div className="catalog-panel-head">
        <div>
          <p className="catalog-kicker">Browse</p>
          <h2>乐队</h2>
          <p>选择乐队后查看已收录的相关 Live。</p>
        </div>
      </div>

      {error && <p className="catalog-state catalog-error">浏览加载失败: {error}</p>}
      <div className="catalog-browse-layout">
        <aside className="catalog-band-list" aria-label="乐队列表">
          {loadingBands ? (
            <p className="catalog-state">乐队加载中...</p>
          ) : bands.length === 0 ? (
            <p className="catalog-empty">当前没有可浏览的乐队。</p>
          ) : (
            bands.map((band) => (
              <button
                key={band.band_id}
                type="button"
                className={`catalog-band-btn ${selectedBandId === band.band_id ? "active" : ""}`}
                onClick={() => onSelectBand(band.band_id)}
              >
                <strong>{band.band_name}</strong>
                <span>{band.live_count} 场</span>
              </button>
            ))
          )}
        </aside>

        <section className="catalog-section catalog-band-lives" aria-labelledby="catalog-band-lives-title">
          <h3 id="catalog-band-lives-title">{bandLives?.band.band_name ?? "选择一个乐队"}</h3>
          {loadingLives ? (
            <p className="catalog-state">Live 加载中...</p>
          ) : !selectedBandId ? (
            <p className="catalog-empty">从左侧选择乐队后查看相关 Live。</p>
          ) : (
            <>
              <LiveResultList rows={liveRows} onOpenLive={onOpenLive} />
              <div className="catalog-pager">
                <button type="button" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>
                  上一页
                </button>
                <span>第 {currentPage} / {totalPages} 页</span>
                <button type="button" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}>
                  下一页
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function AboutPanel() {
  return (
    <div className="catalog-panel about-panel">
      <div className="catalog-panel-head">
        <div>
          <p className="catalog-kicker">About</p>
          <h2>联系我们</h2>
          <p>本站是站方整理维护的演唱会歌单数据库。</p>
        </div>
      </div>

      <div className="about-grid">
        <section className="catalog-section">
          <h3>资料与数据</h3>
          <p>本站优先保证 Live、setlist、出演成员等资料清楚、可查、可维护，当前不开放用户直接编辑。资料仍在持续整理中，搜索和浏览结果基于现有数据库字段，不代表完整巡演、城市或来源体系已经完成。</p>
        </section>
        <section className="catalog-section">
          <h3>反馈方式</h3>
          <p>发现错误或希望补充信息时，请联系站方，并尽量附上 Live 名称、日期、问题描述和可核对的说明。</p>
          <p className="contact-line">
            联系：
            <a href="mailto:xiluoshiro@gmail.com">xiluoshiro@gmail.com</a>
          </p>
        </section>
        <section className="catalog-section">
          <h3>隐私说明</h3>
          <p>我们仅在必要范围内收集和使用数据，不使用任何第三方分析工具或追踪脚本。</p>
          <p>
            <strong>收集的数据：</strong>
            登录名（username）和显示名（display_name）用于账户标识；
            密码经 Argon2 不可逆哈希后存储，明文密码不留存；
            客户端 IP 地址和浏览器 User-Agent 用于会话管理与安全审计；
            登录时间用于账户安全；
            收藏的 Live ID 列表用于实现收藏同步；
            登录、收藏、内容变更等操作写入审计日志，用于安全追溯。
          </p>
          <p>
            <strong>不收集的数据：</strong>
            邮箱、手机号、真实姓名等个人身份信息均不收集；
            前端错误日志仅存储在浏览器 localStorage 中，不上传至服务器；
            不使用 Google Analytics 或任何第三方 SDK；
            不嵌入外部追踪脚本。
          </p>
          <p>
            <strong>Cookie 说明：</strong>
            登录后设置 HttpOnly Session Cookie，仅用于维持登录状态；
            不设置第三方 Cookie，不用于广告或追踪。
          </p>
          <p>
            <strong>数据删除：</strong>
            如需删除账户及相关数据，请通过上方反馈邮箱联系站方。
          </p>
        </section>
      </div>
    </div>
  );
}
