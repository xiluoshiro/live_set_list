import { useMemo, useState } from "react";

type ConsoleMode = "live" | "song" | "band";

type LiveInsertRow = {
  live_id: number;
  live_date: string;
  live_title: string;
  bands: number[];
  url: string | null;
};

type SongInsertRow = {
  song_id: number;
  song_name: string;
};

type BandInsertRow = {
  band_id: number;
  band_name: string;
};

const MOCK_LIVES: LiveInsertRow[] = [
  { live_id: 101, live_date: "2026-03-28", live_title: "Spring Live", bands: [1, 2], url: null },
  { live_id: 102, live_date: "2026-03-29", live_title: "After School", bands: [3], url: "https://example.com/live/102" },
];

const MOCK_SONGS: SongInsertRow[] = [
  { song_id: 201, song_name: "春日序曲" },
  { song_id: 202, song_name: "逆光海岸" },
];

const MOCK_BANDS: BandInsertRow[] = [
  { band_id: 1, band_name: "Poppin'Party" },
  { band_id: 2, band_name: "Afterglow" },
];

function parseBandIds(input: string): number[] {
  const ids = input
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  return [...new Set(ids)];
}

export function ConsoleInsertPanel() {
  const [mode, setMode] = useState<ConsoleMode>("live");
  const [lives, setLives] = useState<LiveInsertRow[]>(MOCK_LIVES);
  const [songs, setSongs] = useState<SongInsertRow[]>(MOCK_SONGS);
  const [bands, setBands] = useState<BandInsertRow[]>(MOCK_BANDS);
  const [message, setMessage] = useState<string>("当前为前端 Mock 插入，后续可接后端写入接口。");

  const [liveDate, setLiveDate] = useState("2026-04-01");
  const [liveTitle, setLiveTitle] = useState("");
  const [liveBands, setLiveBands] = useState("1");
  const [liveUrl, setLiveUrl] = useState("");

  const [songName, setSongName] = useState("");
  const [bandName, setBandName] = useState("");

  const nextLiveId = useMemo(
    () => lives.reduce((maxId, row) => Math.max(maxId, row.live_id), 100) + 1,
    [lives],
  );
  const nextSongId = useMemo(
    () => songs.reduce((maxId, row) => Math.max(maxId, row.song_id), 200) + 1,
    [songs],
  );
  const nextBandId = useMemo(
    () => bands.reduce((maxId, row) => Math.max(maxId, row.band_id), 0) + 1,
    [bands],
  );

  const submitLive = () => {
    const title = liveTitle.trim();
    const ids = parseBandIds(liveBands);
    if (!liveDate || title === "" || ids.length === 0) {
      setMessage("新增Live失败：日期、标题、乐队ID(1-12)为必填。");
      return;
    }
    const row: LiveInsertRow = {
      live_id: nextLiveId,
      live_date: liveDate,
      live_title: title,
      bands: ids,
      url: liveUrl.trim() === "" ? null : liveUrl.trim(),
    };
    setLives((prev) => [row, ...prev]);
    setLiveTitle("");
    setLiveBands("1");
    setLiveUrl("");
    setMessage(`已新增Live #${row.live_id}`);
  };

  const submitSong = () => {
    const name = songName.trim();
    if (name === "") {
      setMessage("新增歌曲失败：song_name 不能为空。");
      return;
    }
    const row: SongInsertRow = { song_id: nextSongId, song_name: name };
    setSongs((prev) => [row, ...prev]);
    setSongName("");
    setMessage(`已新增歌曲 #${row.song_id}`);
  };

  const submitBand = () => {
    const name = bandName.trim();
    if (name === "") {
      setMessage("新增乐队失败：band_name 不能为空。");
      return;
    }
    const row: BandInsertRow = { band_id: nextBandId, band_name: name };
    setBands((prev) => [row, ...prev]);
    setBandName("");
    setMessage(`已新增乐队 #${row.band_id}`);
  };

  return (
    <section className="console-admin">
      <h3>控制台录入</h3>
      <p className="console-admin-hint">{message}</p>

      <div className="console-admin-modes" role="tablist" aria-label="控制台录入类型">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "live"}
          className={`console-mode-btn ${mode === "live" ? "active" : ""}`}
          onClick={() => setMode("live")}
        >
          新增Live
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "song"}
          className={`console-mode-btn ${mode === "song" ? "active" : ""}`}
          onClick={() => setMode("song")}
        >
          新增歌曲
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "band"}
          className={`console-mode-btn ${mode === "band" ? "active" : ""}`}
          onClick={() => setMode("band")}
        >
          新增乐队
        </button>
      </div>

      {mode === "live" && (
        <div className="console-table-wrap">
          <table className="console-admin-table">
            <thead>
              <tr>
                <th>live_id</th>
                <th>live_date</th>
                <th>live_title</th>
                <th>bands</th>
                <th>url</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{nextLiveId}</td>
                <td>
                  <input value={liveDate} onChange={(e) => setLiveDate(e.target.value)} type="date" />
                </td>
                <td>
                  <input
                    value={liveTitle}
                    onChange={(e) => setLiveTitle(e.target.value)}
                    placeholder="请输入Live标题"
                  />
                </td>
                <td>
                  <input
                    value={liveBands}
                    onChange={(e) => setLiveBands(e.target.value)}
                    placeholder="1,2,3"
                  />
                </td>
                <td>
                  <input value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="https://..." />
                </td>
                <td>
                  <button type="button" onClick={submitLive} className="console-submit-btn">
                    提交插入
                  </button>
                </td>
              </tr>
              {lives.map((row) => (
                <tr key={row.live_id}>
                  <td>{row.live_id}</td>
                  <td>{row.live_date}</td>
                  <td title={row.live_title}>{row.live_title}</td>
                  <td>{row.bands.join(",")}</td>
                  <td>{row.url ?? "-"}</td>
                  <td>已插入(mock)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "song" && (
        <div className="console-table-wrap">
          <table className="console-admin-table">
            <thead>
              <tr>
                <th>song_id</th>
                <th>song_name</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{nextSongId}</td>
                <td>
                  <input
                    value={songName}
                    onChange={(e) => setSongName(e.target.value)}
                    placeholder="请输入歌曲名"
                  />
                </td>
                <td>
                  <button type="button" onClick={submitSong} className="console-submit-btn">
                    提交插入
                  </button>
                </td>
              </tr>
              {songs.map((row) => (
                <tr key={row.song_id}>
                  <td>{row.song_id}</td>
                  <td>{row.song_name}</td>
                  <td>已插入(mock)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "band" && (
        <div className="console-table-wrap">
          <table className="console-admin-table">
            <thead>
              <tr>
                <th>band_id</th>
                <th>band_name</th>
                <th>icon</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{nextBandId}</td>
                <td>
                  <input
                    value={bandName}
                    onChange={(e) => setBandName(e.target.value)}
                    placeholder="请输入乐队名"
                  />
                </td>
                <td>
                  <img src={`/icons/Band_${Math.min(nextBandId, 12)}.svg`} className="console-band-icon" alt="next band icon" />
                </td>
                <td>
                  <button type="button" onClick={submitBand} className="console-submit-btn">
                    提交插入
                  </button>
                </td>
              </tr>
              {bands.map((row) => (
                <tr key={row.band_id}>
                  <td>{row.band_id}</td>
                  <td>{row.band_name}</td>
                  <td>
                    <img src={`/icons/Band_${Math.min(row.band_id, 12)}.svg`} className="console-band-icon" alt={row.band_name} />
                  </td>
                  <td>已插入(mock)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
