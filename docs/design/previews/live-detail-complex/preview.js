const iconRoot = "../../../../frontend/public/icons";

const bands = {
  1: { name: "Poppin'Party", color: "#ff3377" },
  2: { name: "Afterglow", color: "#e83848" },
  3: { name: "Pastel＊Palettes", color: "#33ddaa" },
  4: { name: "Roselia", color: "#3344aa" },
  5: { name: "ハロー、ハッピーワールド！", color: "#f4b600" },
  6: { name: "RAISE A SUILEN", color: "#22cccc" },
  7: { name: "Morfonica", color: "#2dc1f7" },
  8: { name: "MyGO!!!!!", color: "#3388bb" },
  9: { name: "Ave Mujica", color: "#881144" },
  10: { name: "夢限大みゅーたいぷ", color: "#ec7384" },
};

const rasMembers = ["Raychell", "小原莉子", "夏芽", "倉知玲鳳", "紡木吏佐"];

const fullBlocks = [
  {
    kind: "act",
    bandIds: [6],
    songs: [
      ["M1", "R·I·O·T"],
      ["M2", "V.I.P MONSTER"],
      ["M3", "OUTSIDER RODEO"],
      ["M4", "HELL! or HELL?"],
    ],
  },
  {
    kind: "act",
    bandIds: [2],
    songs: [
      ["M5", "燦々"],
      ["M6", "Hey-day狂騒曲(カプリチオ)"],
      ["M7", "Scarlet Sky"],
    ],
  },
  {
    kind: "act",
    bandIds: [10],
    songs: [
      ["M8", "夢現妄想世界"],
      ["M9", "チューニング"],
      ["M10", "コミュ着火Fire!"],
    ],
  },
  {
    kind: "collaboration",
    bandIds: [5, 10],
    songs: [["M11", "えがおのオーケストラっ！"]],
  },
  {
    kind: "act",
    bandIds: [5],
    songs: [
      ["M12", "ゴーカ！ごーかい！？ファントムシーフ！"],
      ["M13", "サンバロハッピ〜！"],
      ["M14", "うぃーきゃん☆フレフレっ！"],
    ],
  },
  {
    kind: "act",
    bandIds: [7],
    songs: [
      ["M15", "Daylight -デイライト-"],
      ["M16", "メランコリックララバイ"],
      ["M17", "誓いのWingbeat"],
      ["M18", "Tempest"],
    ],
  },
  {
    kind: "act",
    bandIds: [3],
    songs: [
      ["M19", "天下トーイツA to Z☆"],
      ["M20", "しゅわりん☆どり〜みん"],
    ],
  },
  {
    kind: "collaboration",
    bandIds: [2, 3],
    songs: [["M21", "Y.O.L.O！！！！！"]],
  },
  {
    kind: "act",
    bandIds: [3],
    songs: [["M22", "もういちど ルミナス"]],
  },
  {
    kind: "act",
    bandIds: [9],
    songs: [
      ["M23", "KiLLKiSS"],
      ["M24", "顔"],
      ["M25", "Sophie"],
      ["M26", "Symbol I : △"],
    ],
  },
  {
    kind: "act",
    bandIds: [4],
    songs: [
      ["M27", "ZEAL of proud"],
      ["M28", "BLACK SHOUT"],
      ["M29", "FIRE BIRD"],
      ["M30", "VIOLET LINE"],
    ],
  },
  {
    kind: "collaboration",
    bandIds: [2, 4],
    songs: [["M31", "PASSIONATE ANTHEM"]],
  },
  {
    kind: "act",
    bandIds: [8],
    songs: [
      ["M32", "迷星叫"],
      ["M33", "壱雫空"],
      ["M34", "影色舞"],
      ["M35", "往欄印"],
    ],
  },
  {
    kind: "act",
    bandIds: [1],
    songs: [
      ["M36", "ティアドロップス"],
      ["M37", "ぽっぴん'どりーむ！"],
      ["M38", "STAR BEAT!～ホシノコドウ～"],
      ["M39", "キズナミュージック♪"],
    ],
  },
  {
    kind: "all_cast",
    bandIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    songs: [
      ["M40", "CiRCLE THANKS MUSiC♪"],
      ["M41", "Yes! BanG_Dream!"],
    ],
  },
];

const extractItems = [
  {
    type: "song",
    code: "M12",
    title: "ブリキノダンス",
    bandIds: [6],
    status: "partial",
    statusText: "部分 1/5",
    tags: ["翻唱"],
    otherCount: 1,
    details: {
      main: [
        {
          bandId: 6,
          name: bands[6].name,
          status: "部分 1/5",
          members: ["Raychell"],
          missing: ["小原莉子", "夏芽", "倉知玲鳳", "紡木吏佐"],
        },
      ],
      groups: [],
      solos: ["岡咲美保"],
    },
  },
  { type: "gap", from: "M13", to: "M19" },
  {
    type: "run",
    bandIds: [6],
    songs: [
      { code: "M20", title: "‘FIGHT’ ADDICT", status: "full", statusText: "全员 5/5", tags: [] },
      { code: "M21", title: "灼熱 Bonfire!", status: "full", statusText: "全员 5/5", tags: ["短版"] },
      { code: "M22", title: "V.I.P MONSTER", status: "full", statusText: "全员 5/5", tags: ["短版"] },
      { code: "M23", title: "DRIVE US CRAZY", status: "full", statusText: "全员 5/5", tags: [] },
    ],
  },
  { type: "gap", from: "M24", to: "M42" },
  {
    type: "song",
    code: "M43",
    title: "ONENESS",
    bandIds: [6],
    status: "full",
    statusText: "全员 5/5",
    tags: ["翻唱"],
    otherCount: 12,
    details: {
      main: [
        {
          bandId: 6,
          name: bands[6].name,
          status: "全员 5/5",
          members: rasMembers,
          missing: [],
        },
      ],
      groups: [
        ["MADKID", ["YOU-TA", "YUKI", "KAZUKI", "LIN", "SHIN"]],
        ["angela", ["atsuko", "KATSU"]],
        ["fripSide", ["八木沼悟志", "上杉真央", "阿部寿世"]],
        ["harmoe", ["岩田陽葵", "小泉萌香"]],
        ["いきづらい部！", ["綾咲穂音", "遠藤璃菜", "宮野芹", "藤野こころ", "坂野愛羽", "瀬古梨愛", "奥村優季", "天沢朱音", "小戸森穂花", "涼ノ瀬葵音"]],
        ["岸田教団&THE明星ロケッツ", ["ichigo", "岸田", "はやぴ〜", "みっちゃん", "T-tsu"]],
      ],
      solos: ["May'n", "内田真礼", "岡咲美保", "東山奈央", "蒼井翔太", "青木陽菜"],
    },
  },
];

const scenarios = {
  full: {
    title: "BanG Dream! 10th Anniversary LIVE「In the name of BanG Dream!」",
    date: "2026-02-28",
    opening: "13:30(JP)",
    start: "15:00(JP)",
    venue: "Kアリーナ横浜",
    type: "多乐队纪念活动",
    coverageTitle: "完整歌单",
    coverageNote: "按全场演出顺序收录，可切换 Band 聚焦视图。",
    stats: [
      ["41", "曲目"],
      ["10", "已记录 Band"],
      ["5", "多 Band 曲目"],
    ],
  },
  extract: {
    title: "Animelo Summer Live 2026 -Messenger- DAY1",
    date: "2026-07-10",
    opening: "14:00(JP)",
    start: "16:00(JP)",
    venue: "幕張メッセ 国際展示場ホール",
    type: "拼盘",
    coverageTitle: "RAISE A SUILEN 参与摘录",
    coverageNote: "本库未收录全场歌单，保留来源中的全场 M 编号。",
    stats: [
      ["6", "已收录曲目"],
      ["M43", "全场编号至"],
      ["12", "M43 其他出演项"],
    ],
  },
};

let activeScenario = "full";
let activeView = "timeline";
let activeScope = "all";
let lastFocus = null;

const titleElement = document.querySelector("#live-title");
const metaElement = document.querySelector("#hero-meta");
const coverageElement = document.querySelector("#coverage-strip");
const contentElement = document.querySelector("#setlist-content");
const asideElement = document.querySelector("#detail-aside");
const scopeToggle = document.querySelector(".scope-toggle");
const drawerMask = document.querySelector("#drawer-mask");
const drawer = document.querySelector("#performance-drawer");
const drawerCode = document.querySelector("#drawer-code");
const drawerTitle = document.querySelector("#drawer-title");
const drawerBody = document.querySelector("#drawer-body");

function iconPath(bandId) {
  return `${iconRoot}/Band_${bandId}.svg`;
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bandNames(bandIds) {
  return bandIds.map((id) => bands[id]?.name ?? `Band ${id}`).join(" × ");
}

function codeNumber(code) {
  return Number(String(code).replace(/^\D+/, "")) || 0;
}

function blockRange(block) {
  const first = block.songs[0][0];
  const last = block.songs[block.songs.length - 1][0];
  return first === last ? first : `${first}-${last}`;
}

function allFullRows() {
  return fullBlocks.flatMap((block) =>
    block.songs.map(([code, title]) => ({
      code,
      title,
      bandIds: block.bandIds,
      status: block.kind === "collaboration" || block.kind === "all_cast" ? "collab" : "full",
      statusText:
        block.kind === "all_cast"
          ? "全员终场"
          : block.kind === "collaboration"
            ? `${block.bandIds.length} Band`
            : "全员出演",
      tags: [],
      kind: block.kind,
    })),
  );
}

function extractRows() {
  return extractItems.flatMap((item) => {
    if (item.type === "song") return [item];
    if (item.type === "run") {
      return item.songs.map((song) => ({ ...song, bandIds: item.bandIds, type: "song" }));
    }
    return [];
  });
}

function renderMeta(scenario) {
  const values = [
    ["日期", scenario.date],
    ["开场", scenario.opening],
    ["开演", scenario.start],
    ["场地", scenario.venue],
    ["类型", `<span class="meta-badge">${htmlEscape(scenario.type)}</span>`],
  ];
  metaElement.innerHTML = values
    .map(
      ([label, value]) => `
        <dl class="meta-item">
          <dt>${label}</dt>
          <dd>${value}</dd>
        </dl>
      `,
    )
    .join("");
}

function renderCoverage(scenario) {
  coverageElement.innerHTML = `
    <div class="coverage-main">
      <span class="coverage-icon" aria-hidden="true">${activeScenario === "full" ? "全" : "摘"}</span>
      <span class="coverage-copy">
        <strong>收录范围：${htmlEscape(scenario.coverageTitle)}</strong>
        <span>${htmlEscape(scenario.coverageNote)}</span>
      </span>
    </div>
    <div class="coverage-stats">
      ${scenario.stats
        .map(
          ([value, label]) => `
            <span class="coverage-stat">
              <strong>${htmlEscape(value)}</strong>
              <span>${htmlEscape(label)}</span>
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderScopeToggle() {
  if (activeScenario === "extract") {
    scopeToggle.innerHTML = `
      <button type="button" class="active" aria-pressed="true">参与摘录</button>
      <button type="button" disabled title="本库未收录全场歌单">全场未收录</button>
    `;
    return;
  }
  scopeToggle.innerHTML = `
    <button type="button" data-scope="all" class="${activeScope === "all" ? "active" : ""}" aria-pressed="${activeScope === "all"}">全场</button>
    <button type="button" data-scope="ras" class="${activeScope === "ras" ? "active" : ""}" aria-pressed="${activeScope === "ras"}">只看 RAS</button>
  `;
  scopeToggle.querySelectorAll("[data-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      transitionRender(() => {
        activeScope = button.dataset.scope;
        render();
      });
    });
  });
}

function renderSongRow(song, context = {}) {
  const status = song.status ?? (context.kind === "collaboration" || context.kind === "all_cast" ? "collab" : "full");
  const statusText =
    song.statusText ??
    (context.kind === "all_cast"
      ? "10 Band"
      : context.kind === "collaboration"
        ? `${context.bandIds.length} Band`
        : "全员出演");
  const tags = song.tags ?? [];
  const otherText = song.otherCount ? `其他出演 ${song.otherCount}项` : "";
  const detailPayload = encodeURIComponent(JSON.stringify({ ...song, context }));
  return `
    <button class="song-row" type="button" data-song="${detailPayload}">
      <span class="song-code">${htmlEscape(song.code)}</span>
      <span class="song-title">${htmlEscape(song.title)}</span>
      <span class="song-summary">
        <span class="status-chip ${status}">${htmlEscape(statusText)}</span>
        ${otherText ? `<span class="status-chip collab">${htmlEscape(otherText)}</span>` : ""}
        ${tags.map((tag) => `<span class="tag-chip">${htmlEscape(tag)}</span>`).join("")}
      </span>
      <span class="song-chevron" aria-hidden="true">›</span>
    </button>
  `;
}

function renderActBlock(block, index) {
  const firstBand = bands[block.bandIds[0]];
  const isCollab = block.kind === "collaboration";
  const isAllCast = block.kind === "all_cast";
  const label = isAllCast ? "ALL CAST FINALE" : isCollab ? "COLLABORATION" : firstBand.name;
  const sublabel = isAllCast ? "全体 10 Band" : isCollab ? bandNames(block.bandIds) : "连续出演区段";
  const color = isAllCast ? "#f31864" : isCollab ? "#7a5bc7" : firstBand.color;
  const icon = isCollab || isAllCast
    ? `<span aria-hidden="true">${isAllCast ? "★" : "×"}</span>`
    : `<img src="${iconPath(block.bandIds[0])}" alt="" />`;
  const songs = block.songs.map(([code, title]) =>
    renderSongRow(
      { code, title, bandIds: block.bandIds, kind: block.kind },
      { bandIds: block.bandIds, kind: block.kind },
    ),
  );
  return `
    <section
      class="act-block ${isCollab ? "collaboration-block" : ""} ${isAllCast ? "all-cast-block" : ""}"
      id="block-${index}"
      data-block-label="${htmlEscape(label)}"
      data-block-range="${htmlEscape(blockRange(block))}"
      style="--band-color:${color}"
    >
      <header class="act-block-head">
        <div class="act-identity">
          <span class="band-logo">${icon}</span>
          <span class="act-title">
            <strong>${htmlEscape(label)}</strong>
            <span>${htmlEscape(sublabel)}</span>
          </span>
        </div>
        <span class="act-range">${htmlEscape(blockRange(block))} · ${block.songs.length}曲</span>
      </header>
      <div class="song-list">${songs.join("")}</div>
    </section>
  `;
}

function renderFullTimeline() {
  if (activeScope === "all") {
    contentElement.innerHTML = `<div class="timeline">${fullBlocks.map(renderActBlock).join("")}</div>`;
    return;
  }

  const rasBlocks = fullBlocks.filter((block) => block.bandIds.includes(6));
  const firstBlock = rasBlocks[0];
  const finale = rasBlocks[rasBlocks.length - 1];
  contentElement.innerHTML = `
    <div class="timeline">
      ${renderActBlock(firstBlock, 0)}
      <div class="gap-marker">
        <strong>M5-M39 由其他 Band 演出，聚焦视图已折叠</strong>
      </div>
      ${renderActBlock(finale, fullBlocks.length - 1)}
    </div>
  `;
}

function renderExtractTimeline() {
  const parts = extractItems.map((item, index) => {
    if (item.type === "gap") {
      return `
        <div class="gap-marker">
          <strong>${item.from}-${item.to} 未收录，本页保留全场编号</strong>
        </div>
      `;
    }
    if (item.type === "run") {
      const block = {
        kind: "act",
        bandIds: item.bandIds,
        songs: item.songs.map((song) => [song.code, song.title]),
      };
      const base = renderActBlock(block, index);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = base;
      const section = wrapper.firstElementChild;
      item.songs.forEach((song, songIndex) => {
        const button = section.querySelectorAll(".song-row")[songIndex];
        button.outerHTML = renderSongRow({ ...song, bandIds: item.bandIds }, { bandIds: item.bandIds, kind: "act" });
      });
      return section.outerHTML;
    }
    const block = {
      kind: item.code === "M43" ? "collaboration" : "act",
      bandIds: item.bandIds,
      songs: [[item.code, item.title]],
    };
    const base = renderActBlock(block, index);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = base;
    const section = wrapper.firstElementChild;
    section.querySelector(".song-row").outerHTML = renderSongRow(item, { bandIds: item.bandIds, kind: block.kind });
    if (item.code === "M43") {
      section.style.setProperty("--band-color", "#d7832f");
      section.dataset.blockLabel = "FINALE COLLABORATION";
      section.dataset.blockRange = "M43";
      section.querySelector(".act-title strong").textContent = "FINALE COLLABORATION";
      section.querySelector(".act-title span").textContent = "RAISE A SUILEN 与其他出演 12项";
    }
    return section.outerHTML;
  });
  contentElement.innerHTML = `<div class="timeline">${parts.join("")}</div>`;
}

function rowTags(row) {
  return (row.tags ?? []).map((tag) => `<span class="tag-chip">${htmlEscape(tag)}</span>`).join("");
}

function renderTable() {
  let rows = activeScenario === "full" ? allFullRows() : extractRows();
  if (activeScenario === "full" && activeScope === "ras") {
    rows = rows.filter((row) => row.bandIds.includes(6));
  }
  contentElement.innerHTML = `
    <div class="compact-table-wrap">
      <table class="compact-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>曲目</th>
            <th>出演摘要</th>
            <th>阵容状态</th>
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const payload = encodeURIComponent(JSON.stringify(row));
              return `
                <tr data-song="${payload}" tabindex="0">
                  <td>${htmlEscape(row.code)}</td>
                  <td class="table-song">${htmlEscape(row.title)}</td>
                  <td>
                    <span class="table-performers">
                      ${row.bandIds
                        .map(
                          (bandId) => `
                            <span class="table-band">
                              <img src="${iconPath(bandId)}" alt="" />
                              <span>${htmlEscape(bands[bandId].name)}</span>
                            </span>
                          `,
                        )
                        .join("")}
                      ${row.otherCount ? `<span class="status-chip collab">其他出演 ${row.otherCount}项</span>` : ""}
                    </span>
                  </td>
                  <td><span class="status-chip ${row.status ?? "full"}">${htmlEscape(row.statusText ?? "全员出演")}</span></td>
                  <td>${rowTags(row)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAside() {
  if (activeScenario === "extract") {
    asideElement.innerHTML = `
      <section class="aside-panel performance-position" style="--active-band:${bands[6].color}">
        <span>CURRENT SECTION</span>
        <strong id="active-block-name">${activeView === "table" ? "数据表格" : "RAISE A SUILEN"}</strong>
        <small id="active-block-range">${activeView === "table" ? "全部已收录曲目" : "M12"}</small>
      </section>
      <section class="aside-panel">
        <h2>参与概览</h2>
        <div class="overview-grid">
          <span class="overview-stat"><strong>6</strong><span>已收录曲目</span></span>
          <span class="overview-stat"><strong>5</strong><span>全员出演</span></span>
          <span class="overview-stat"><strong>1</strong><span>部分出演</span></span>
          <span class="overview-stat"><strong>2</strong><span>合作曲</span></span>
        </div>
      </section>
      <section class="aside-panel">
        <h2>收录说明</h2>
        <div class="aside-note">
          <strong>这不是完整全场歌单</strong>
          <span>M13-M19 与 M24-M42 在当前数据库中没有曲目记录，所以页面使用“未收录”，不会误写成“已折叠”。</span>
        </div>
      </section>
    `;
    return;
  }

  const visibleBlocks = activeScope === "ras"
    ? fullBlocks.map((block, index) => ({ block, index })).filter(({ block }) => block.bandIds.includes(6))
    : fullBlocks.map((block, index) => ({ block, index }));
  const firstVisible = visibleBlocks[0];
  const firstLabel = firstVisible.block.kind === "all_cast"
    ? "All Cast Finale"
    : firstVisible.block.kind === "collaboration"
      ? "Collaboration"
      : bands[firstVisible.block.bandIds[0]].name;
  const firstColor = firstVisible.block.kind === "all_cast"
    ? "#f31864"
    : firstVisible.block.kind === "collaboration"
      ? "#7a5bc7"
      : bands[firstVisible.block.bandIds[0]].color;
  asideElement.innerHTML = `
    <section class="aside-panel performance-position" style="--active-band:${firstColor}">
      <span>CURRENT SECTION</span>
      <strong id="active-block-name">${htmlEscape(activeView === "table" ? "数据表格" : firstLabel)}</strong>
      <small id="active-block-range">${htmlEscape(activeView === "table" ? "全部可见曲目" : blockRange(firstVisible.block))}</small>
    </section>
    <section class="aside-panel">
      <h2>演出概览</h2>
      <div class="overview-grid">
        <span class="overview-stat"><strong>${activeScope === "ras" ? "6" : "41"}</strong><span>${activeScope === "ras" ? "RAS 参与曲目" : "全场曲目"}</span></span>
        <span class="overview-stat"><strong>10</strong><span>已记录 Band</span></span>
        <span class="overview-stat"><strong>5</strong><span>多 Band 曲目</span></span>
        <span class="overview-stat"><strong>41</strong><span>最高 M 编号</span></span>
      </div>
    </section>
    <section class="aside-panel">
      <h2>区段索引</h2>
      <nav class="aside-index" aria-label="区段索引">
        ${visibleBlocks
          .map(({ block, index }) => {
            const isSpecial = block.kind !== "act";
            const label = block.kind === "all_cast" ? "All Cast Finale" : block.kind === "collaboration" ? "Collaboration" : bands[block.bandIds[0]].name;
            const color = isSpecial ? (block.kind === "all_cast" ? "#f31864" : "#7a5bc7") : bands[block.bandIds[0]].color;
            return `
              <a href="#block-${index}">
                <span class="index-rail" style="--index-color:${color}"></span>
                <span class="index-name">${htmlEscape(label)}</span>
                <span class="index-range">${htmlEscape(blockRange(block))}</span>
              </a>
            `;
          })
          .join("")}
      </nav>
    </section>
  `;
}

function detailsForSong(song) {
  if (song.details) return song.details;
  const extractMatch = extractRows().find((row) => row.code === song.code);
  if (extractMatch?.details) return extractMatch.details;
  return {
    main: song.bandIds.map((bandId) => ({
      bandId,
      name: bands[bandId].name,
      status: song.status === "partial" ? "部分出演" : "全员出演",
      members: bandId === 6 ? rasMembers : [],
      missing: [],
    })),
    groups: [],
    solos: [],
  };
}

function performerEntry({ name, members = [], status = "", bandId = null, missing = [] }) {
  const logo = bandId
    ? `<img src="${iconPath(bandId)}" alt="" />`
    : htmlEscape([...name][0] ?? "?");
  return `
    <article class="performer-entry">
      <span class="performer-logo">${logo}</span>
      <span class="performer-copy">
        <strong>${htmlEscape(name)}</strong>
        ${members.length ? `<span>${members.map(htmlEscape).join(" / ")}</span>` : ""}
        ${
          missing.length
            ? `<button class="missing-disclosure" type="button" data-missing="${encodeURIComponent(missing.join(" / "))}">未参加 ${missing.length}人，展开查看</button>`
            : ""
        }
      </span>
      ${status ? `<span class="status-chip performer-status ${status.startsWith("部分") ? "partial" : "full"}">${htmlEscape(status)}</span>` : ""}
    </article>
  `;
}

function drawerSection(title, countLabel, entries) {
  if (!entries.length) return "";
  return `
    <section class="drawer-section">
      <div class="drawer-section-head">
        <h3>${htmlEscape(title)}</h3>
        <span>${htmlEscape(countLabel)}</span>
      </div>
      <div>${entries.join("")}</div>
    </section>
  `;
}

function openDrawer(song, trigger) {
  lastFocus = trigger;
  const details = detailsForSong(song);
  drawerCode.textContent = song.code;
  drawerTitle.textContent = song.title;
  const totalGroupPeople = details.groups.reduce((sum, [, members]) => sum + members.length, 0);
  const totalOtherPeople = totalGroupPeople + details.solos.length;
  drawerBody.innerHTML = `
    <div class="drawer-summary">
      ${(song.tags ?? []).map((tag) => `<span class="tag-chip">${htmlEscape(tag)}</span>`).join("")}
      ${
        details.groups.length || details.solos.length
          ? `<span class="status-chip collab">其他出演 ${details.groups.length + details.solos.length}项 / ${totalOtherPeople}人次</span>`
          : ""
      }
    </div>
    ${drawerSection(
      "Band 出演",
      `${details.main.length} Band`,
      details.main.map((item) => performerEntry(item)),
    )}
    ${drawerSection(
      "合作团体",
      `${details.groups.length}组 / ${totalGroupPeople}人`,
      details.groups.map(([name, members]) => performerEntry({ name, members })),
    )}
    ${drawerSection(
      "个人艺人",
      `${details.solos.length}人`,
      details.solos.map((name) => performerEntry({ name })),
    )}
  `;
  drawerMask.hidden = false;
  document.body.style.overflow = "hidden";
  drawer.querySelector(".drawer-close").focus();
  drawerBody.querySelectorAll("[data-missing]").forEach((button) => {
    button.addEventListener("click", () => {
      const names = decodeURIComponent(button.dataset.missing);
      button.outerHTML = `<span>${htmlEscape(names)}</span>`;
    });
  });
}

function closeDrawer() {
  drawerMask.hidden = true;
  document.body.style.overflow = "";
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

function bindSongInteractions() {
  contentElement.querySelectorAll("[data-song]").forEach((element) => {
    const open = () => {
      const song = JSON.parse(decodeURIComponent(element.dataset.song));
      openDrawer(song, element);
    };
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function render() {
  const scenario = scenarios[activeScenario];
  titleElement.textContent = scenario.title;
  renderMeta(scenario);
  renderCoverage(scenario);
  renderScopeToggle();
  if (activeView === "table") {
    renderTable();
  } else if (activeScenario === "full") {
    renderFullTimeline();
  } else {
    renderExtractTimeline();
  }
  renderAside();
  bindSongInteractions();
  afterRender();
}

const motionQuery = window.matchMedia("(prefers-reduced-motion: no-preference)");
let activeBlockObserver = null;

function transitionRender(update) {
  if (!motionQuery.matches || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.startViewTransition(update);
}

function prepareReveal() {
  if (!motionQuery.matches) return;

  const contentItems = [
    ...contentElement.querySelectorAll(".act-block, .gap-marker, .compact-table-wrap"),
    ...asideElement.querySelectorAll(".aside-panel"),
  ];
  contentItems.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.setProperty("--reveal-delay", `${Math.min(index, 5) * 45}ms`);
    element.addEventListener(
      "animationend",
      () => {
        element.classList.remove("reveal");
        element.style.removeProperty("--reveal-delay");
      },
      { once: true },
    );
  });
}

function prepareActiveBlockTracking() {
  if (activeBlockObserver) activeBlockObserver.disconnect();
  const blocks = [...contentElement.querySelectorAll(".act-block")];
  if (!blocks.length) return;

  const nameElement = asideElement.querySelector("#active-block-name");
  const rangeElement = asideElement.querySelector("#active-block-range");
  const positionElement = asideElement.querySelector(".performance-position");

  activeBlockObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      if (!visible.length) return;

      const current = visible[0].target;
      blocks.forEach((block) => block.classList.toggle("is-current", block === current));
      asideElement.querySelectorAll(".aside-index a").forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${current.id}`);
      });
      if (nameElement) nameElement.textContent = current.dataset.blockLabel ?? "歌单区段";
      if (rangeElement) rangeElement.textContent = current.dataset.blockRange ?? "";
      if (positionElement) {
        positionElement.style.setProperty(
          "--active-band",
          current.style.getPropertyValue("--band-color") || "var(--accent)",
        );
      }
    },
    { rootMargin: "-24% 0px -58% 0px", threshold: 0 },
  );

  blocks.forEach((block) => activeBlockObserver.observe(block));
}

function afterRender() {
  prepareReveal();
  prepareActiveBlockTracking();
}

function syncThemeButton() {
  const root = document.documentElement;
  const button = document.querySelector(".theme-toggle");
  const label = button.querySelector(".theme-label");
  const nextIsLight = root.dataset.theme === "dark";
  label.textContent = nextIsLight ? "亮色" : "深色";
  button.setAttribute("aria-label", `切换为${nextIsLight ? "亮色" : "深色"}主题`);
}

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    transitionRender(() => {
      activeScenario = button.dataset.scenario;
      activeScope = "all";
      document.querySelectorAll("[data-scenario]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
    });
    document.querySelector(".detail-hero").scrollIntoView({
      behavior: motionQuery.matches ? "smooth" : "auto",
      block: "start",
    });
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    transitionRender(() => {
      activeView = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
    });
  });
});

document.querySelector(".theme-toggle").addEventListener("click", () => {
  transitionRender(() => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    syncThemeButton();
  });
});

document.querySelector(".favorite-action").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const active = button.getAttribute("aria-pressed") === "true";
  button.setAttribute("aria-pressed", String(!active));
  button.textContent = active ? "收藏演出" : "取消收藏";
});

const moreButton = document.querySelector(".more-action");
const popover = document.querySelector("#band-popover");

moreButton.addEventListener("click", () => {
  const expanded = moreButton.getAttribute("aria-expanded") === "true";
  moreButton.setAttribute("aria-expanded", String(!expanded));
  if (expanded) {
    popover.hidden = true;
    return;
  }
  const rect = moreButton.getBoundingClientRect();
  popover.innerHTML = `
    <strong>关于这份预览</strong>
    <span>完整歌单与参与摘录使用不同的数据语义，未收录区段不会被误写成折叠内容。</span>
  `;
  popover.style.top = `${Math.min(rect.bottom + 10, window.innerHeight - 150)}px`;
  popover.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
  popover.hidden = false;
});

drawer.querySelector(".drawer-close").addEventListener("click", closeDrawer);
drawerMask.addEventListener("click", (event) => {
  if (event.target === drawerMask) closeDrawer();
});

document.addEventListener("click", (event) => {
  if (popover.hidden || event.target === moreButton || popover.contains(event.target)) return;
  popover.hidden = true;
  moreButton.setAttribute("aria-expanded", "false");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!drawerMask.hidden) closeDrawer();
    if (!popover.hidden) {
      popover.hidden = true;
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.focus();
    }
    return;
  }

  if (event.key !== "Tab" || drawerMask.hidden) return;
  const focusable = [...drawer.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter(
    (element) => !element.disabled && element.offsetParent !== null,
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

syncThemeButton();
render();
