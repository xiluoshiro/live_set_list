const previewToday = "2026-08-03";
const availableMonths = ["2026-07", "2026-08", "2026-09"];

const STATUS_LABELS = {
  past: "已结束",
  upcoming: "待举行",
  today: "进行中",
  postponed: "延期",
  cancelled: "已取消",
};

const MARKER_ORDER = ["cancelled", "postponed", "today", "upcoming", "past"];

const eventsByDate = {
  "2026-07-04": [
    {
      time: "18:00",
      title: "Poppin'Party LIVE 2026",
      tone: "past",
      bands: [1],
    },
  ],
  "2026-07-18": [
    {
      time: "17:30",
      title: "Roselia ASIA TOUR 追加公演",
      tone: "past",
      bands: [2],
    },
  ],
  "2026-07-25": [
    {
      time: "18:00",
      title: "RAISE A SUILEN SPECIAL LIVE",
      tone: "past",
      bands: [6],
    },
    {
      time: "19:30",
      title: "Morfonica Acoustic Stage",
      tone: "past",
      bands: [5],
    },
  ],
  "2026-08-02": [
    {
      time: "17:00",
      title: "Ave Mujica 6th LIVE",
      tone: "past",
      bands: [9],
    },
  ],
  "2026-08-03": [
    {
      time: "18:00",
      title: "MyGO!!!!! 8th LIVE 想いのかたち",
      tone: "today",
      bands: [8],
    },
    {
      time: "19:30",
      title: "Poppin'Party Fan Meeting 2026",
      tone: "today",
      bands: [1],
    },
  ],
  "2026-08-08": [
    {
      time: "18:00",
      title: "BanG Dream! Summer Joint Live",
      tone: "cancelled",
      bands: [1, 2],
    },
  ],
  "2026-08-12": [
    {
      time: "17:00",
      title: "Morfonica Concept LIVE",
      tone: "upcoming",
      bands: [5],
    },
    {
      time: "18:30",
      title: "RAISE A SUILEN ZEPP TOUR",
      tone: "upcoming",
      bands: [6],
    },
    {
      time: "20:00",
      title: "Roselia Nachtmusik",
      tone: "upcoming",
      bands: [2],
    },
  ],
  "2026-08-15": [
    {
      time: "18:00",
      title: "MyGO!!!!! Summer Festival Stage",
      tone: "postponed",
      bands: [8],
    },
  ],
  "2026-08-21": [
    {
      time: "18:30",
      title: "Ave Mujica in the Dark",
      tone: "upcoming",
      bands: [9],
    },
  ],
  "2026-08-29": [
    {
      time: "15:00",
      title: "BanG Dream! 10 Bands Festival DAY1",
      tone: "upcoming",
      bands: [1, 2, 5],
    },
    {
      time: "16:30",
      title: "Afterglow Special Stage",
      tone: "upcoming",
      bands: [3],
    },
    {
      time: "18:00",
      title: "Pastel＊Palettes Special Stage",
      tone: "cancelled",
      bands: [4],
    },
    {
      time: "19:30",
      title: "Hello, Happy World! Special Stage",
      tone: "upcoming",
      bands: [7],
    },
  ],
  "2026-09-05": [
    {
      time: "17:00",
      title: "BanG Dream! 10 Bands Festival DAY2",
      tone: "upcoming",
      bands: [5, 6, 8, 9],
    },
  ],
  "2026-09-12": [
    {
      time: "18:00",
      title: "Roselia 20th Single Release LIVE",
      tone: "upcoming",
      bands: [2],
    },
  ],
  "2026-09-20": [
    {
      time: "17:30",
      title: "Poppin'Party Anniversary LIVE",
      tone: "upcoming",
      bands: [1],
    },
  ],
};

const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const calendarGrid = document.querySelector("[data-calendar-grid]");
const monthLabel = document.querySelector(".month-label");
const previousButton = document.querySelector('[data-month-action="previous"]');
const nextButton = document.querySelector('[data-month-action="next"]');
const currentButton = document.querySelector('[data-month-action="current"]');
const selectedDateLabel = document.querySelector("[data-selected-date]");
const selectedWeekdayLabel = document.querySelector("[data-selected-weekday]");
const selectedCountLabel = document.querySelector("[data-selected-count]");
const eventList = document.querySelector("[data-event-list]");
const toast = document.querySelector(".preview-toast");

let visibleMonth = "2026-08";
let selectedDate = previewToday;
let toastTimer = null;

function formatIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getMonthParts(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

function getMonthDates(monthKey) {
  return Object.keys(eventsByDate)
    .filter((date) => date.startsWith(monthKey))
    .sort();
}

function chooseDefaultDate(monthKey) {
  const dates = getMonthDates(monthKey);
  if (dates.includes(previewToday)) return previewToday;
  const upcoming = dates.find((date) => date > previewToday);
  return upcoming || dates.at(-1) || `${monthKey}-01`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function createBandIcon(bandId) {
  const icon = document.createElement("img");
  icon.className = "band-icon";
  icon.src = `../../../../frontend/public/icons/Band_${bandId}.svg`;
  icon.alt = `Band ${bandId}`;
  icon.width = 22;
  icon.height = 22;
  return icon;
}

function renderSelectedDay() {
  const [year, month, day] = selectedDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const events = eventsByDate[selectedDate] || [];

  selectedDateLabel.textContent = `${month} 月 ${day} 日`;
  selectedWeekdayLabel.textContent = weekdays[date.getDay()];
  selectedCountLabel.textContent = `${events.length} 场`;
  eventList.replaceChildren();

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-day";
    empty.textContent = "这一天没有已收录的 Live。请选择带有状态色轨的日期。";
    eventList.append(empty);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "event-row";
    row.setAttribute("aria-label", `打开 ${event.title} 的详情预览`);
    row.addEventListener("click", () => showToast(`预览：打开「${event.title}」详情`));

    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = event.time;

    const copy = document.createElement("span");
    copy.className = "event-copy";
    const title = document.createElement("strong");
    title.className = "event-title";
    title.textContent = event.title;
    const bands = document.createElement("span");
    bands.className = "event-bands";
    bands.title = `出演乐队：${event.bands.map((bandId) => `Band ${bandId}`).join("、")}`;
    event.bands.slice(0, 2).forEach((bandId) => bands.append(createBandIcon(bandId)));
    const hiddenCount = event.bands.length - 2;
    if (hiddenCount > 0) {
      const overflow = document.createElement("span");
      overflow.className = "band-overflow";
      overflow.textContent = `+${hiddenCount}`;
      bands.append(overflow);
    }
    copy.append(title, bands);

    const status = document.createElement("span");
    status.className = "event-status";
    status.dataset.tone = event.tone;
    status.textContent = STATUS_LABELS[event.tone];

    row.append(time, copy, status);
    eventList.append(row);
  });
}

function focusAdjacentDate(source, offset) {
  const date = source.dataset.date;
  if (!date) return;
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(year, month - 1, day + offset);
  const targetIso = formatIsoDate(target.getFullYear(), target.getMonth() + 1, target.getDate());
  const targetButton = calendarGrid.querySelector(`[data-date="${targetIso}"]`);
  if (targetButton) targetButton.focus();
}

function buildAccessibleLabel(year, month, day, events) {
  if (events.length === 0) return `${month} 月 ${day} 日，没有 Live`;
  const counts = {};
  events.forEach((event) => {
    counts[event.tone] = (counts[event.tone] ?? 0) + 1;
  });
  const parts = MARKER_ORDER.filter((tone) => counts[tone]).map(
    (tone) => `${STATUS_LABELS[tone]} ${counts[tone]}`,
  );
  return `${month} 月 ${day} 日，${events.length} 场 Live，${parts.join("，")}`;
}

function renderCalendar() {
  const { year, month } = getMonthParts(visibleMonth);
  const firstDate = new Date(year, month - 1, 1);
  const firstWeekday = (firstDate.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthIndex = availableMonths.indexOf(visibleMonth);

  monthLabel.textContent = `${year} 年 ${month} 月`;
  calendarGrid.setAttribute("aria-label", `${year} 年 ${month} 月 Live 日历`);
  previousButton.disabled = monthIndex <= 0;
  nextButton.disabled = monthIndex >= availableMonths.length - 1;
  calendarGrid.replaceChildren();

  for (let cell = 0; cell < 42; cell += 1) {
    const day = cell - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      const blank = document.createElement("span");
      blank.className = "calendar-blank";
      blank.setAttribute("aria-hidden", "true");
      calendarGrid.append(blank);
      continue;
    }

    const isoDate = formatIsoDate(year, month, day);
    const events = eventsByDate[isoDate] || [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${events.length ? " has-events" : ""}`;
    button.dataset.date = isoDate;
    button.dataset.today = String(isoDate === previewToday);
    button.setAttribute("aria-pressed", String(isoDate === selectedDate));
    if (isoDate === previewToday) button.setAttribute("aria-current", "date");
    button.setAttribute("aria-label", buildAccessibleLabel(year, month, day, events));

    const topLine = document.createElement("span");
    topLine.className = "day-topline";
    const dayNumber = document.createElement("span");
    dayNumber.className = "day-number";
    dayNumber.textContent = String(day).padStart(2, "0");
    const eventCount = document.createElement("span");
    eventCount.className = "event-count";
    eventCount.textContent = events.length ? `${events.length}场` : "";
    topLine.append(dayNumber, eventCount);

    const track = document.createElement("span");
    track.className = "marker-track";
    track.setAttribute("aria-hidden", "true");
    MARKER_ORDER.filter((tone) => events.some((event) => event.tone === tone)).forEach((tone) => {
      const marker = document.createElement("i");
      marker.className = `event-marker ${tone}`;
      track.append(marker);
    });

    button.append(topLine, track);
    button.addEventListener("click", () => {
      selectedDate = isoDate;
      renderCalendar();
      renderSelectedDay();
    });
    button.addEventListener("keydown", (event) => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(event.key in offsets)) return;
      event.preventDefault();
      focusAdjacentDate(button, offsets[event.key]);
    });
    calendarGrid.append(button);
  }
}

function changeMonth(direction) {
  const currentIndex = availableMonths.indexOf(visibleMonth);
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= availableMonths.length) return;
  visibleMonth = availableMonths[nextIndex];
  selectedDate = chooseDefaultDate(visibleMonth);
  renderCalendar();
  renderSelectedDay();
}

previousButton.addEventListener("click", () => changeMonth(-1));
nextButton.addEventListener("click", () => changeMonth(1));
currentButton.addEventListener("click", () => {
  visibleMonth = previewToday.slice(0, 7);
  selectedDate = chooseDefaultDate(visibleMonth);
  renderCalendar();
  renderSelectedDay();
});

document.querySelector(".theme-button").addEventListener("click", (event) => {
  const root = document.documentElement;
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = nextTheme;
  event.currentTarget.setAttribute(
    "aria-label",
    nextTheme === "dark" ? "当前深色模式，点击切换浅色模式" : "当前浅色模式，点击切换深色模式",
  );
});

const menuButton = document.querySelector(".mobile-menu-button");
const mobileNavigation = document.querySelector(".mobile-navigation");
menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  mobileNavigation.hidden = isOpen;
});

document.querySelector(".home-search").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = document.querySelector("#home-search-input").value.trim();
  showToast(query ? `预览：搜索「${query}」` : "请输入搜索内容");
});

document.querySelector(".all-lives-button").addEventListener("click", () => {
  showToast("预览：进入全部 Live 列表");
});

document.querySelector("[data-home-button]").addEventListener("click", () => {
  showToast("当前已经是首页预览");
});

document.querySelector(".preview-footer button").addEventListener("click", () => {
  showToast("预览：打开关于与反馈");
});

renderCalendar();
renderSelectedDay();
