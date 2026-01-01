// app.js
import { loadSheetData, normalizeRow } from "./services/sheet.js";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJ32f4_1BWPh87JBNdipG7nLTwPsoGhlg3T-PuIvhBpb1y7IG-hMIXOJAf_jFS-Noc1h-CHayUpxVp/pub?gid=0&single=true&output=csv";

// ---------- DOM ----------
const el = {
  // chart
  priceChart: document.getElementById("priceChart"),
  chartInfo: document.getElementById("chartInfo"),

  // date
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  dayDiff: document.getElementById("dayDiff"),
  dateMinRange: document.getElementById("dateMinRange"),
  dateMaxRange: document.getElementById("dateMaxRange"),

  // status & actions
  statusText: document.getElementById("statusText"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnClear: document.getElementById("btnClear"),
  btnDebugReload: document.getElementById("btnDebugReload"),

  // debug table
  dbgInfo: document.getElementById("dbgInfo"),
  dbgThead: document.getElementById("dbgThead"),
  dbgTbody: document.getElementById("dbgTbody"),
};

const elHdr = {
  date: document.getElementById("hdrDate"),
  time: document.getElementById("hdrTime"),
  lastUpdate: document.getElementById("hdrLastUpdate"),
};

// ---------- STATE ----------
const state = {
  raw: [],
  rows: [],
  dateAxis: [],
  filters: {
    type: ["ALL"],
    typeEnd: ["ALL"],
    list: ["ALL"],
    channel: ["ALL"],
    dateFrom: "",
    dateTo: "",
  },
  sort: { key: null, dir: "asc" },
  chart: null,
};

// ---------- helpers ----------
function setStatus(msg) {
  if (el.statusText) el.statusText.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normMulti(arr) {
  const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
  return a.length ? a : ["ALL"];
}
function passMultiFilter(value, selectedArr) {
  const sel = normMulti(selectedArr);
  if (sel.includes("ALL")) return true;
  return sel.includes(value);
}
function summarizeSelection(arr) {
  const sel = normMulti(arr);
  if (sel.includes("ALL")) return "All";
  if (sel.length === 1) return sel[0];
  return `${sel.length} selected`;
}

function parseDateStrict(s) {
  if (!s) return null;
  const str = String(s).trim();

  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    dt.setHours(0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // DD/MM/YYYY or M/D/YYYY
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const y = Number(m[3]);
    const dt = new Date(y, mm - 1, dd);
    dt.setHours(0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function indexOfDateISO(iso) {
  const i = state.dateAxis.indexOf(iso);
  return i >= 0 ? i : -1;
}

function updateDayDiff() {
  if (!el.dayDiff) return;
  const a = parseDateStrict(el.dateFrom?.value);
  const b = parseDateStrict(el.dateTo?.value);
  if (!a || !b) {
    el.dayDiff.textContent = "-";
    return;
  }
  const diff = Math.round((b - a) / (24 * 3600 * 1000)) + 1;
  el.dayDiff.textContent = `${diff} Days`;
}

// ---------- Multi-select dropdown ----------
const ms = {}; // เก็บ refs ของ multi-select

function initMultiSelect(key, items) {
  const btn = document.getElementById(`msBtn-${key}`);
  const panel = document.getElementById(`msPanel-${key}`);
  const listEl = document.getElementById(`msList-${key}`);
  if (!btn || !panel || !listEl) return;

  ms[key] = { btn, panel, listEl, items: [...items] };

  // render list
  listEl.innerHTML = "";
  for (const v of items) {
    const safeId = btoa(unescape(encodeURIComponent(v))).replaceAll("=", "");
    const id = `ms-${key}-${safeId}`;

    const row = document.createElement("label");
    row.className = "ms-item";
    row.innerHTML = `
      <input type="checkbox" data-value="${escapeHtml(v)}" id="${id}">
      <span>${escapeHtml(v)}</span>
    `;
    listEl.appendChild(row);
  }

  // open/close
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // ปิดตัวอื่นก่อน
    Object.entries(ms).forEach(([k, r]) => {
      if (k !== key && r.panel) r.panel.hidden = true;
    });
    panel.hidden = !panel.hidden;
  });

  // actions: select all / clear
  panel.querySelectorAll(".ms-act").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = b.dataset.act;

      if (act === "all") {
        // ✅ เลือกทุกตัว: เก็บเป็น list ทั้งหมด (ไม่ใช้ ALL)
        state.filters[key] = [...ms[key].items];
      } else if (act === "none") {
        // ✅ clear: กลับไป ALL (แปลว่าไม่กรอง)
        state.filters[key] = ["ALL"];
      }

      syncMultiUI(key);
      applyAndRender();
    });
  });

  // change checkbox
  listEl.addEventListener("change", () => {
    const checked = Array.from(
      listEl.querySelectorAll("input[type=checkbox]:checked")
    ).map((x) => x.dataset.value);

    // ถ้าไม่เลือกอะไร → ALL (ไม่กรอง)
    state.filters[key] = checked.length ? checked : ["ALL"];

    syncMultiUI(key);
    applyAndRender();
  });

  // init UI
  syncMultiUI(key);
}

function syncMultiUI(key) {
  const ref = ms[key];
  if (!ref) return;

  const sel = normMulti(state.filters[key]);

  const inputs = ref.listEl.querySelectorAll("input[type=checkbox]");
  const values = Array.from(inputs).map((i) => i.dataset.value);

  const isAll = sel.includes("ALL");

  if (isAll) {
    // ALL = ไม่ติ๊กอะไร (ให้ดู clean)
    inputs.forEach((i) => (i.checked = false));
  } else {
    inputs.forEach((i) => (i.checked = sel.includes(i.dataset.value)));
  }

  // ✅ เปลี่ยนข้อความบนปุ่มแบบไม่พัง caret
  // เอา "All ▾" หรือ "3 selected ▾"
  const label = isAll ? "All" : `${sel.length} selected`;
  ref.btn.innerHTML = `${escapeHtml(label)} <span class="ms-caret">▾</span>`;

  // optional: ถ้าเลือกครบทุกตัว → แสดง All (แทน N selected)
  if (!isAll && sel.length === values.length) {
    ref.btn.innerHTML = `All <span class="ms-caret">▾</span>`;
  }
}

// ปิด dropdown เมื่อคลิกนอก
document.addEventListener("click", () => {
  Object.values(ms).forEach((r) => r.panel && (r.panel.hidden = true));
});


// ---------- chart ----------
function sumPriceByDate(rows) {
  const map = new Map(); // iso -> sum
  for (const r of rows) {
    const d = parseDateStrict(r.date);
    if (!d) continue;
    const iso = toISODate(d);
    const price = Number(r.price) || 0;
    map.set(iso, (map.get(iso) || 0) + price);
  }
  const labels = Array.from(map.keys()).sort();
  const values = labels.map((k) => map.get(k) || 0);
  return { labels, values };
}

function renderPriceChart(rows) {
  if (!el.priceChart) return;

  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded (Chart is undefined)");
    return;
  }

  const { labels, values } = sumPriceByDate(rows);

  if (el.chartInfo) {
    const total = values.reduce((s, n) => s + n, 0);
    el.chartInfo.textContent = `points=${labels.length} | total=${total.toLocaleString("th-TH")}`;
  }

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  // ✅ plugin วาดพื้นหลังใน chartArea
  const chartBgPlugin = {
    id: "chartBg",
    beforeDraw(chart, args, opts) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const { left, top, width, height } = chartArea;

      ctx.save();
      ctx.fillStyle = opts?.color || "#0b1220"; // ✅ ต้องเป็น fillStyle
      ctx.fillRect(left, top, width, height);
      ctx.restore();
    },
  };

  state.chart = new Chart(el.priceChart.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Price",
          data: values,
          tension: 0.25,
          pointRadius: 2,
          borderColor: "#60a5fa",              // สีเส้น
          backgroundColor: "rgba(96,165,250,.2)",
          fill: false,
        },
      ],
    },
    plugins: [chartBgPlugin], // ✅ ต้องใส่ตรงนี้ด้วย
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        chartBg: { color: "#0b1220" }, // ✅ ส่ง options ให้ plugin
        legend: { display: false },
        tooltip: { mode: "index", intersect: false },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: { autoSkip: true, maxTicksLimit: 10 },
          grid: { color: "rgba(255,255,255,.06)" },
        },
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 500, // ✅ ถ้าต้องการ 500 ให้เป็น 500
            callback: (v) => Number(v).toLocaleString("th-TH"),
          },
          grid: { color: "rgba(255,255,255,.08)" },
        },
      },
    },
  });
}

// ---------- debug table ----------
function sortRows(rows) {
  const { key, dir } = state.sort;
  if (!key) return rows;
  const mul = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];

    const na = Number(va);
    const nb = Number(vb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * mul;

    const da = parseDateStrict(va);
    const db = parseDateStrict(vb);
    if (da && db) return (da.getTime() - db.getTime()) * mul;

    return String(va ?? "").localeCompare(String(vb ?? ""), "th", { numeric: true }) * mul;
  });
}

function renderDebugTable(rows) {
  if (!el.dbgThead || !el.dbgTbody) return;

  const hasRows = Array.isArray(rows) && rows.length > 0;
  const keys = hasRows ? Object.keys(rows[0]).slice(0, 12) : ["No data"];

  el.dbgThead.innerHTML = `
    <tr>
      ${keys
        .map((k) => {
          const active = state.sort.key === k;
          const arrow = active ? (state.sort.dir === "asc" ? " ▲" : " ▼") : "";
          const dataKey = k === "No data" ? "" : `data-key="${escapeHtml(k)}"`;
          const cursor = k === "No data" ? "" : "cursor:pointer";
          return `<th ${dataKey} style="${cursor}">${escapeHtml(k)}${arrow}</th>`;
        })
        .join("")}
    </tr>
  `;

  el.dbgThead.querySelectorAll("th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (!key) return;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else {
        state.sort.key = key;
        state.sort.dir = "asc";
      }
      applyAndRender();
    });
  });

  if (!hasRows) {
    el.dbgTbody.innerHTML = `<tr><td>ไม่พบข้อมูล</td></tr>`;
    if (el.dbgInfo) el.dbgInfo.textContent = `raw=${state.raw.length} | filtered=0`;
    return;
  }

  const sorted = sortRows(rows);
  const show = sorted.slice(0, 200);
  el.dbgTbody.innerHTML = show
    .map((r) => `<tr>${keys.map((k) => `<td>${escapeHtml(r[k] ?? "")}</td>`).join("")}</tr>`)
    .join("");

  if (el.dbgInfo) {
    el.dbgInfo.textContent = `raw=${state.raw.length} | filtered=${rows.length} | showing=${show.length}`;
  }
}

// ---------- filter ----------
function applyFilters() {
  // ✅ ไม่อ่าน select แล้ว! ใช้ state.filters ที่ multi-select ปรับให้
  const dFrom = parseDateStrict(el.dateFrom?.value);
  const dTo = parseDateStrict(el.dateTo?.value);

  state.filters.dateFrom = el.dateFrom?.value || "";
  state.filters.dateTo = el.dateTo?.value || "";

  state.rows = state.raw.filter((r) => {
    if (!passMultiFilter(r.type, state.filters.type)) return false;
    if (!passMultiFilter(r.type_end, state.filters.typeEnd)) return false;
    if (!passMultiFilter(r.list, state.filters.list)) return false;
    if (!passMultiFilter(r.channel, state.filters.channel)) return false;

    const rd = parseDateStrict(r.date);
    if (!rd) return false;
    if (dFrom && rd < dFrom) return false;
    if (dTo && rd > dTo) return false;

    return true;
  });
}

function applyAndRender() {
  applyFilters();
  updateDayDiff();
  renderPriceChart(state.rows);
  renderDebugTable(state.rows);
}

// ---------- init filters/date axis ----------
function initFilterOptions(rows) {
  const types = uniq(rows.map((r) => r.type));
  const typeEnds = uniq(rows.map((r) => r.type_end));
  const lists = uniq(rows.map((r) => r.list));
  const channels = uniq(rows.map((r) => r.channel));

  initMultiSelect("type", types);
  initMultiSelect("typeEnd", typeEnds);
  initMultiSelect("list", lists);
  initMultiSelect("channel", channels);
}

function initDateRange(rows) {
  const axis = rows
    .map((r) => parseDateStrict(r.date))
    .filter(Boolean)
    .map((d) => toISODate(d));

  const uniqAxis = Array.from(new Set(axis)).sort();
  if (!uniqAxis.length) return;

  state.dateAxis = uniqAxis;

  const minISO = uniqAxis[0];
  const maxISO = uniqAxis[uniqAxis.length - 1];

  if (el.dateFrom && !el.dateFrom.value) el.dateFrom.value = minISO;
  if (el.dateTo && !el.dateTo.value) el.dateTo.value = maxISO;

  if (el.dateMinRange && el.dateMaxRange) {
    const maxIdx = uniqAxis.length - 1;
    el.dateMinRange.min = "0";
    el.dateMinRange.max = String(maxIdx);
    el.dateMaxRange.min = "0";
    el.dateMaxRange.max = String(maxIdx);

    el.dateMinRange.value = "0";
    el.dateMaxRange.value = String(maxIdx);
  }
}

// ---------- events ----------
function bindEvents() {
  // date inputs
  if (el.dateFrom) el.dateFrom.addEventListener("change", applyAndRender);
  if (el.dateTo) el.dateTo.addEventListener("change", applyAndRender);

  // range sliders
  if (el.dateMinRange) {
    el.dateMinRange.addEventListener("input", () => {
      const maxIdx = Number(el.dateMaxRange?.value ?? 0);
      let minIdx = Number(el.dateMinRange.value);
      minIdx = clamp(minIdx, 0, maxIdx);
      el.dateMinRange.value = String(minIdx);

      const iso = state.dateAxis[minIdx];
      if (el.dateFrom) el.dateFrom.value = iso;
      applyAndRender();
    });
  }

  if (el.dateMaxRange) {
    el.dateMaxRange.addEventListener("input", () => {
      const minIdx = Number(el.dateMinRange?.value ?? 0);
      let maxIdx = Number(el.dateMaxRange.value);
      maxIdx = clamp(maxIdx, minIdx, state.dateAxis.length - 1);
      el.dateMaxRange.value = String(maxIdx);

      const iso = state.dateAxis[maxIdx];
      if (el.dateTo) el.dateTo.value = iso;
      applyAndRender();
    });
  }

  // reload
  if (el.btnDebugReload) el.btnDebugReload.addEventListener("click", reloadData);
  if (el.btnRefresh) el.btnRefresh.addEventListener("click", reloadData);

  // clear
  if (el.btnClear) {
    el.btnClear.addEventListener("click", () => {
      state.filters.type = ["ALL"];
      state.filters.typeEnd = ["ALL"];
      state.filters.list = ["ALL"];
      state.filters.channel = ["ALL"];

      syncMultiUI("type");
      syncMultiUI("typeEnd");
      syncMultiUI("list");
      syncMultiUI("channel");

      applyAndRender();
    });
  }
}

// ---------- header clock ----------
function formatHeaderDate(d) {
  const base = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(d);
  const wd = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Asia/Bangkok",
  }).format(d);
  return `${base} (${wd})`;
}
function formatHeaderTime(d) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  }).format(d);
}
function tickHeaderClock() {
  const now = new Date();
  if (elHdr.date) elHdr.date.textContent = formatHeaderDate(now);
  if (elHdr.time) elHdr.time.textContent = formatHeaderTime(now);
}

// ---------- load ----------
async function reloadData() {
  try {
    setStatus("กำลังโหลดข้อมูล...");

    const data = await loadSheetData({ url: SHEET_URL });
    state.raw = data.map(normalizeRow);

    // drop no-date rows
    const before = state.raw.length;
    state.raw = state.raw.filter((r) => !!parseDateStrict(r.date));
    console.log("drop no-date rows =", before - state.raw.length);

    initFilterOptions(state.raw);
    initDateRange(state.raw);

    if (elHdr.lastUpdate) {
      const now = new Date();
      elHdr.lastUpdate.textContent = `${formatHeaderDate(now)} ${formatHeaderTime(now)}`;
    }

    applyAndRender();
    setStatus(`โหลดสำเร็จ: ${state.raw.length} แถว`);
  } catch (err) {
    console.error(err);
    setStatus(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

// ---------- init ----------
async function init() {
  bindEvents();
  tickHeaderClock();
  setInterval(tickHeaderClock, 1000);
  await reloadData();
}

init();
