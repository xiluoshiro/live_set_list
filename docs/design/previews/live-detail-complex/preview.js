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
      activeScope = button.dataset.scope;
      render();
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
  asideElement.innerHTML = `
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
        ${members.length ? `<span>${members.map(htmlEscape).join(" · ")}</span>` : ""}
        ${
          missing.length
            ? `<button class="missing-disclosure" type="button" data-missing="${encodeURIComponent(missing.join(" · "))}">未参加 ${missing.length}人，展开查看</button>`
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

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    activeScenario = button.dataset.scenario;
    activeScope = "all";
    document.querySelectorAll("[data-scenario]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    render();
  });
});

document.querySelector(".theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
});

document.querySelector(".favorite-action").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const active = button.textContent === "♥";
  button.textContent = active ? "♡" : "♥";
  button.setAttribute("aria-label", active ? "加入收藏" : "取消收藏");
  button.style.color = active ? "" : "var(--accent-primary)";
});

drawer.querySelector(".drawer-close").addEventListener("click", closeDrawer);
drawerMask.addEventListener("click", (event) => {
  if (event.target === drawerMask) closeDrawer();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !drawerMask.hidden) closeDrawer();
});

/* ============================================================
   Motion layer (2026-07-30)
   视口渐入 / 按钮涟漪 / 滚动视差 / 顶栏阴影 / Hero 星光。
   全部 honoring prefers-reduced-motion；动画仅 transform/opacity。
   滚动监听采用 passive + rAF 节流，只写 CSS 变量（视差无法用
   IntersectionObserver 表达，无框架场景下这是最小实现）。
   ============================================================ */

const motionOK = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/* ---------- 视口渐入：IO 触发，stagger 由组内索引决定 ---------- */

const revealObserver = motionOK
  ? new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          el.classList.add("is-visible");
          revealObserver.unobserve(el);
          // 过渡结束后移除类，避免 reveal 的 transition-delay 干扰后续悬停过渡
          el.addEventListener("transitionend", function done(event) {
            if (event.propertyName !== "transform") return;
            el.removeEventListener("transitionend", done);
            el.classList.remove("reveal", "is-visible");
            el.style.removeProperty("--reveal-delay");
          });
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    )
  : null;

function prepareReveal() {
  if (!revealObserver) return;
  const groups = [
    [document.querySelector(".detail-hero"), document.querySelector(".content-controls")],
    [...contentElement.querySelectorAll(".act-block, .gap-marker, .compact-table-wrap")],
    ...[...asideElement.querySelectorAll(".aside-panel")].map((panel) => [panel]),
  ];
  groups.forEach((group) => {
    group.filter(Boolean).forEach((el, index) => {
      el.classList.add("reveal");
      el.style.setProperty("--reveal-delay", `${Math.min(index, 6) * 55}ms`);
      revealObserver.observe(el);
    });
  });
}

/* ---------- 按钮涟漪：事件委托，键盘触发时居中 ---------- */

const RIPPLE_SELECTOR = ".icon-action, .segmented button, .song-row, .aside-index a, .missing-disclosure";

if (motionOK) {
  document.addEventListener("click", (event) => {
    const host = event.target.closest(RIPPLE_SELECTOR);
    if (!(host instanceof HTMLElement) || host.disabled) return;
    const rect = host.getBoundingClientRect();
    const isKeyboard = event.detail === 0;
    const x = isKeyboard ? rect.width / 2 : event.clientX - rect.left;
    const y = isKeyboard ? rect.height / 2 : event.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 2;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`;
    ripple.style.top = `${y - size / 2}px`;
    host.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
}

/* ---------- 滚动视差 + 顶栏投影 ---------- */

const heroSection = document.querySelector(".detail-hero");
const topbar = document.querySelector(".site-topbar");
let scrollTicking = false;

function updateScrollFx() {
  const y = window.scrollY;
  topbar.classList.toggle("is-scrolled", y > 8);
  if (motionOK && heroSection) {
    heroSection.style.setProperty("--hero-shift", `${Math.min(y * 0.18, 60)}px`);
  }
  scrollTicking = false;
}

window.addEventListener(
  "scroll",
  () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(updateScrollFx);
  },
  { passive: true },
);
updateScrollFx();

/* ---------- Hero 星光（BanG Dream! キラキラ 母题，纯装饰） ---------- */

if (motionOK && heroSection) {
  const SPARKS = [
    { top: "14%", right: "11%", size: 14, delay: 0 },
    { top: "60%", right: "5%", size: 9, delay: 1.3 },
    { top: "30%", left: "3.5%", size: 11, delay: 2.2 },
  ];
  SPARKS.forEach(({ top, right, left, size, delay }) => {
    const spark = document.createElement("span");
    spark.className = "hero-sparkle";
    spark.textContent = "✦";
    spark.setAttribute("aria-hidden", "true");
    spark.style.top = top;
    if (right) spark.style.right = right;
    if (left) spark.style.left = left;
    spark.style.setProperty("--spark-size", `${size}px`);
    spark.style.setProperty("--spark-delay", `${delay}s`);
    heroSection.appendChild(spark);
  });
}

/* ---------- render 后的动效钩子 ---------- */

function afterRender() {
  prepareReveal();
}

render();
