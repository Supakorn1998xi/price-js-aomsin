// app.js
import { loadSheetData, normalizeRow } from "./services/sheet.js";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJ32f4_1BWPh87JBNdipG7nLTwPsoGhlg3T-PuIvhBpb1y7IG-hMIXOJAf_jFS-Noc1h-CHayUpxVp/pub?gid=0&single=true&output=csv";

// ---------- DOM ----------

const el = {
  statusText: document.getElementById("statusText"),

  btnRefresh: document.getElementById("btnRefresh"),
  btnClear: document.getElementById("btnClear"),

  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),

  typeFilter: document.getElementById("typeFilter"),
  typeEndFilter: document.getElementById("typeEndFilter"),
  listFilter: document.getElementById("listFilter"),
  channelFilter: document.getElementById("channelFilter"),

  dbgInfo: document.getElementById("dbgInfo"),
  dbgThead: document.getElementById("dbgThead"),
  dbgTbody: document.getElementById("dbgTbody"),
  btnDebugReload: document.getElementById("btnDebugReload"),

  dateMinRange: document.getElementById("dateMinRange"),
  dateMaxRange: document.getElementById("dateMaxRange"),
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
  filters: {
    type: "ALL",
    typeEnd: "ALL",
    list: "ALL",
    channel: "ALL",
    dateFrom: "",
    dateTo: "",
    dateAxis: [],
  },
  sort: {
    key: null,
    dir: "asc", // asc | desc
  },
};


// ---------- helpers ----------
function setStatus(msg) {
  if (el.statusText) el.statusText.textContent = msg;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function indexOfDateISO(iso) {
  const i = state.dateAxis.indexOf(iso);
  return i >= 0 ? i : -1;
}


function sortRows(rows) {
  const { key, dir } = state.sort;
  if (!key) return rows;

  const mul = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];

    // number
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * mul;
    }

    // date
    const da = parseDateStrict(va);
    const db = parseDateStrict(vb);
    if (da && db) {
      return (da.getTime() - db.getTime()) * mul;
    }

    // string
    return String(va ?? "")
      .localeCompare(String(vb ?? ""), "th", { numeric: true }) * mul;
  });
}


function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * ✅ Parser วันที่แบบคงที่ (ไม่พึ่ง Date.parse)
 * รองรับ:
 * - YYYY-MM-DD (จาก input type="date")
 * - DD/MM/YYYY (ถ้ามาจากชีต)
 * - M/D/YYYY (บางคนกรอกในชีต)
 */
function parseDateStrict(s) {
  if (!s) return null;
  const str = String(s).trim();

  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    dt.setHours(0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  // DD/MM/YYYY or M/D/YYYY
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = Number(m[1]); // could be dd or mm
    const b = Number(m[2]); // could be mm or dd
    const y = Number(m[3]);

    // เดาแบบปลอดภัย: ถ้า a > 12 → a คือวัน (DD/MM)
    // ถ้า a <= 12 → ให้ถือว่าเป็น DD/MM ตามที่คุณใช้ในไทย (ปลอดภัยกับชีตส่วนใหญ่)
    const dd = a;
    const mm = b;

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

// ---------- Header Clock ----------
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

// ---------- Load & Init ----------
async function init() {
  bindEvents();

  tickHeaderClock();
  setInterval(tickHeaderClock, 1000);

  await reloadData();
}

async function reloadData() {
  try {
    setStatus("กำลังโหลดข้อมูล...");

    const data = await loadSheetData({ url: SHEET_URL });
    state.raw = data.map(normalizeRow);

    // debug: ดูว่า date แปลได้กี่แถว
    const bad = state.raw.filter((r) => !parseDateStrict(r.date));
    console.log("Loaded rows:", state.raw.length, "badDate:", bad.length, bad.slice(0, 5));

    initFilterOptions(state.raw);
    initDateRange(state.raw);

    applyAndRender();

    if (elHdr.lastUpdate) {
      const now = new Date();
      elHdr.lastUpdate.textContent = `${formatHeaderDate(now)} ${formatHeaderTime(now)}`;
    }

    setStatus(`โหลดสำเร็จ: ${state.raw.length} แถว`);
  } catch (err) {
    console.error(err);
    setStatus(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

function fillSelect(select, items, selectedValue) {
  if (!select) return;
  select.innerHTML = "";
  for (const v of items) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v === "ALL" ? "All" : v;
    select.appendChild(opt);
  }
  select.value = selectedValue || "ALL";
}

// ✅ อ่านค่า select ให้ปลอดภัย: ถ้า HTML ส่ง "" มา ให้ถือเป็น ALL
function readSelectValue(select) {
  if (!select) return "ALL";
  const v = String(select.value ?? "").trim();
  return v === "" ? "ALL" : v;
}

function initFilterOptions(rows) {
  const types = uniq(rows.map((r) => r.type));
  const typeEnds = uniq(rows.map((r) => r.type_end));
  const lists = uniq(rows.map((r) => r.list));
  const channels = uniq(rows.map((r) => r.channel));

  fillSelect(el.typeFilter, ["ALL", ...types], state.filters.type);
  fillSelect(el.typeEndFilter, ["ALL", ...typeEnds], state.filters.typeEnd);
  fillSelect(el.listFilter, ["ALL", ...lists], state.filters.list);
  fillSelect(el.channelFilter, ["ALL", ...channels], state.filters.channel);
}

function initDateRange(rows) {
  const axis = rows
    .map((r) => parseDateStrict(r.date))
    .filter(Boolean)
    .map((d) => toISODate(d));

  const uniqAxis = Array.from(new Set(axis)).sort(); // ISO sort ได้ตรง
  if (!uniqAxis.length) return;

  state.dateAxis = uniqAxis;

  const minISO = uniqAxis[0];
  const maxISO = uniqAxis[uniqAxis.length - 1];

  // set date inputs (ถ้ายังว่าง)
  if (el.dateFrom && !el.dateFrom.value) el.dateFrom.value = minISO;
  if (el.dateTo && !el.dateTo.value) el.dateTo.value = maxISO;

  // sync state
  state.filters.dateFrom = el.dateFrom?.value || minISO;
  state.filters.dateTo = el.dateTo?.value || maxISO;

  // set range sliders
  if (el.dateMinRange && el.dateMaxRange) {
    const maxIdx = uniqAxis.length - 1;

    el.dateMinRange.min = "0";
    el.dateMinRange.max = String(maxIdx);
    el.dateMaxRange.min = "0";
    el.dateMaxRange.max = String(maxIdx);

    // ตั้งค่าเริ่มต้นตาม date input
    const fromIdx = indexOfDateISO(state.filters.dateFrom);
    const toIdx = indexOfDateISO(state.filters.dateTo);

    el.dateMinRange.value = String(fromIdx >= 0 ? fromIdx : 0);
    el.dateMaxRange.value = String(toIdx >= 0 ? toIdx : maxIdx);
  }
}


// ---------- Filter & Render ----------
function applyFilters() {
  // ✅ sync state จาก UI ทุกครั้ง (กัน state/DOM ไม่ตรง)
  state.filters.type = readSelectValue(el.typeFilter);
  state.filters.typeEnd = readSelectValue(el.typeEndFilter);
  state.filters.list = readSelectValue(el.listFilter);
  state.filters.channel = readSelectValue(el.channelFilter);

  state.filters.dateFrom = el.dateFrom?.value || "";
  state.filters.dateTo = el.dateTo?.value || "";

  const f = state.filters;

  const dFrom = parseDateStrict(f.dateFrom);
  const dTo = parseDateStrict(f.dateTo);

  const out = state.raw.filter((r) => {
    if (f.type !== "ALL" && r.type !== f.type) return false;
    if (f.typeEnd !== "ALL" && r.type_end !== f.typeEnd) return false;
    if (f.list !== "ALL" && r.list !== f.list) return false;
    if (f.channel !== "ALL" && r.channel !== f.channel) return false;

    const rd = parseDateStrict(r.date);

    // ✅ แถวที่แปลงวันที่ไม่ได้: อย่าตัดทิ้ง
    if (!rd) return true;

    if (dFrom && rd < dFrom) return false;
    if (dTo && rd > dTo) return false;

    return true;
  });

  state.rows = out;
}

function renderDebugTable(rows) {
  if (!el.dbgThead || !el.dbgTbody) return;

  const hasRows = Array.isArray(rows) && rows.length > 0;

  // keys สำหรับสร้าง header
  const keys = hasRows ? Object.keys(rows[0]).slice(0, 12) : ["No data"];

  // ===== THEAD (sortable) =====
  el.dbgThead.innerHTML = `
    <tr>
      ${keys
        .map((k) => {
          const active = state.sort.key === k;
          const arrow = active ? (state.sort.dir === "asc" ? " ▲" : " ▼") : "";
          // ถ้าเป็น No data ไม่ต้องใส่ data-key
          const dataKey = k === "No data" ? "" : `data-key="${escapeHtml(k)}"`;
          const cursor = k === "No data" ? "" : "cursor:pointer";
          return `<th ${dataKey} style="${cursor}">${escapeHtml(k)}${arrow}</th>`;
        })
        .join("")}
    </tr>
  `;

  // bind click (เฉพาะ th ที่มี data-key)
  el.dbgThead.querySelectorAll("th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (!key) return;

      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.dir = "asc";
      }

      applyAndRender();
    });
  });

  // ===== TBODY =====
  if (!hasRows) {
    el.dbgTbody.innerHTML = `<tr><td>ไม่พบข้อมูล (rows=0)</td></tr>`;
    if (el.dbgInfo) el.dbgInfo.textContent = `raw=${state.raw.length} | filtered=0`;
    return;
  }

  const sorted = sortRows(rows);
  const show = sorted.slice(0, 200);

  el.dbgTbody.innerHTML = show
    .map(
      (r) =>
        `<tr>${keys
          .map((k) => `<td>${escapeHtml(r[k] ?? "")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  if (el.dbgInfo) {
    el.dbgInfo.textContent = `raw=${state.raw.length} | filtered=${state.rows.length} | showing=${show.length}`;
  }
}


function applyAndRender() {
  applyFilters();
  renderDebugTable(state.rows);

  console.log("filters =", state.filters, "raw=", state.raw.length, "filtered=", state.rows.length);
}

// ---------- Events ----------
function bindEvents() {

// ✅ ลาก min range
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

// ✅ ลาก max range
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

// ✅ ถ้า user เปลี่ยน date input เอง → sync slider ด้วย
if (el.dateFrom) {
  el.dateFrom.addEventListener("change", () => {
    const idx = indexOfDateISO(el.dateFrom.value);
    if (idx >= 0 && el.dateMinRange) el.dateMinRange.value = String(idx);

    // กัน from > to
    if (el.dateTo && el.dateFrom.value > el.dateTo.value) {
      el.dateTo.value = el.dateFrom.value;
      const idx2 = indexOfDateISO(el.dateTo.value);
      if (idx2 >= 0 && el.dateMaxRange) el.dateMaxRange.value = String(idx2);
    }

    applyAndRender();
  });
}

if (el.dateTo) {
  el.dateTo.addEventListener("change", () => {
    const idx = indexOfDateISO(el.dateTo.value);
    if (idx >= 0 && el.dateMaxRange) el.dateMaxRange.value = String(idx);

    // กัน to < from
    if (el.dateFrom && el.dateTo.value < el.dateFrom.value) {
      el.dateFrom.value = el.dateTo.value;
      const idx2 = indexOfDateISO(el.dateFrom.value);
      if (idx2 >= 0 && el.dateMinRange) el.dateMinRange.value = String(idx2);
    }

    applyAndRender();
  });
}

  if (el.btnDebugReload) el.btnDebugReload.addEventListener("click", reloadData);
  if (el.btnRefresh) el.btnRefresh.addEventListener("click", reloadData);

  if (el.typeFilter) el.typeFilter.addEventListener("change", applyAndRender);
  if (el.typeEndFilter) el.typeEndFilter.addEventListener("change", applyAndRender);
  if (el.listFilter) el.listFilter.addEventListener("change", applyAndRender);
  if (el.channelFilter) el.channelFilter.addEventListener("change", applyAndRender);

  if (el.dateFrom) el.dateFrom.addEventListener("change", applyAndRender);
  if (el.dateTo) el.dateTo.addEventListener("change", applyAndRender);

  if (el.btnClear)
    el.btnClear.addEventListener("click", () => {
      state.filters.type = "ALL";
      state.filters.typeEnd = "ALL";
      state.filters.list = "ALL";
      state.filters.channel = "ALL";

      if (el.typeFilter) el.typeFilter.value = "ALL";
      if (el.typeEndFilter) el.typeEndFilter.value = "ALL";
      if (el.listFilter) el.listFilter.value = "ALL";
      if (el.channelFilter) el.channelFilter.value = "ALL";

      // date keep as-is
      state.filters.dateFrom = el.dateFrom?.value || "";
      state.filters.dateTo = el.dateTo?.value || "";

      applyAndRender();
    });
}

init();
