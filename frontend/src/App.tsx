import { useEffect, useMemo, useState } from "react";
import { BAND_ICON_COUNT, BandIconsCell, type BandIconInput } from "./components/BandIconsCell";
import "./styles.css";

type LiveRow = {
  id: number;
  date: string;
  liveName: string;
  icons: BandIconInput[];
  url: string;
  description: string;
};
type TabKey = "favorites" | "all" | "console";
type FavoriteMap = Record<number, boolean>;

const MOCK_ROWS: LiveRow[] = Array.from({ length: 47 }, (_, idx) => {
  const i = idx + 1;
  const iconCount = (i % 10) + 1;
  return {
    id: i,
    date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
    liveName: `示例 Live 名称 ${i} - 预留长度展示（可支持到 61 字符）`,
    icons: Array.from({ length: iconCount }, (_, n) => ((n % BAND_ICON_COUNT) + 1).toString()),
    url: `https://example.com/live/${i}`,
    description: `这是第 ${i} 条 live 的占位详情。后续可替换为接口返回内容。`,
  };
});

function App() {
  const [pageSize, setPageSize] = useState<15 | 20>(20);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabKey>("favorites");
  const [activeRow, setActiveRow] = useState<LiveRow | null>(null);
  const [favorites, setFavorites] = useState<FavoriteMap>({});

  useEffect(() => {
    const raw = localStorage.getItem("live-favorites-map");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as FavoriteMap;
      setFavorites(parsed);
    } catch {
      setFavorites({});
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("live-favorites-map", JSON.stringify(favorites));
  }, [favorites]);

  // TODO: 后端接口适配后，用接口数据替换 MOCK_ROWS
  // 收藏状态默认 true，保证当前阶段“收藏页=全量页”。
  const isFavorite = (id: number) => favorites[id] ?? true;
  const rows = useMemo(() => {
    if (tab === "favorites") {
      return MOCK_ROWS.filter((row) => isFavorite(row.id));
    }
    if (tab === "all") {
      return MOCK_ROWS;
    }
    return [];
  }, [favorites, tab]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [pageSize, rows, safePage]);

  const handlePageSizeChange = (value: 15 | 20) => {
    setPageSize(value);
    setPage(1);
  };

  const handleTabChange = (nextTab: TabKey) => {
    setTab(nextTab);
    setPage(1);
  };

  // 仅在“全量”页提供收藏开关，收藏页不展示该列。
  const showFavoriteColumn = tab === "all";

  const toggleFavorite = (id: number) => {
    setFavorites((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }));
  };

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-head">
          <h1>Live 信息统计</h1>
          <div className="toolbar">
            <label>
              每页行数
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value) as 15 | 20)}
              >
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
            </label>
            <span>总计 {total} 条</span>
          </div>
        </header>

        <nav className="tabs">
          <button
            className={`tab-btn ${tab === "favorites" ? "active" : ""}`}
            onClick={() => handleTabChange("favorites")}
          >
            收藏
          </button>
          <button
            className={`tab-btn ${tab === "all" ? "active" : ""}`}
            onClick={() => handleTabChange("all")}
          >
            全量
          </button>
          <button
            className={`tab-btn ${tab === "console" ? "active" : ""}`}
            onClick={() => handleTabChange("console")}
          >
            控制台
          </button>
        </nav>

        {tab !== "console" ? (
          <>
            <div className="table-wrap">
              <table className={showFavoriteColumn ? "table-with-fav" : "table-no-fav"}>
                <thead>
                  <tr>
                    {showFavoriteColumn && <th>收藏</th>}
                    <th>日期</th>
                    <th>Live 名称</th>
                    <th>乐队</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.id}>
                      {showFavoriteColumn && (
                        <td className="fav-col-cell">
                          <button
                            className={`star-btn ${isFavorite(row.id) ? "is-fav" : ""}`}
                            onClick={() => toggleFavorite(row.id)}
                            title={isFavorite(row.id) ? "取消收藏" : "加入收藏"}
                            aria-label={isFavorite(row.id) ? "取消收藏" : "加入收藏"}
                          >
                            ★
                          </button>
                        </td>
                      )}
                      <td>{row.date}</td>
                      <td>
                        <button
                          className="name-btn"
                          onClick={() => setActiveRow(row)}
                          title={row.liveName}
                        >
                          {row.liveName}
                        </button>
                      </td>
                      <td className="band-cell" title={`${row.icons.length} 个图标`}>
                        <BandIconsCell icons={row.icons} rowId={row.id} />
                      </td>
                      <td>
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="url-icon-link"
                        >
                          🔗
                        </a>
                      </td>
                    </tr>
                  ))}
                  {pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={showFavoriteColumn ? 5 : 4} className="empty-cell">
                        当前没有可展示的数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                上一页
              </button>
              <span>
                第 {safePage} / {totalPages} 页
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                下一页
              </button>
            </footer>
          </>
        ) : (
          <section className="console-empty">控制台内容预留中</section>
        )}
      </section>

      {activeRow && (
        <div className="modal-mask" onClick={() => setActiveRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{activeRow.liveName}</h2>
            <p>
              <strong>日期：</strong>
              {activeRow.date}
            </p>
            <p>
              <strong>图标数量：</strong>
              {activeRow.icons.length}
            </p>
            <p>
              <strong>链接：</strong>
              <a href={activeRow.url} target="_blank" rel="noreferrer">
                {activeRow.url}
              </a>
            </p>
            <p>{activeRow.description}</p>
            <button onClick={() => setActiveRow(null)}>关闭</button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
