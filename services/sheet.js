// services/sheet.js

function extractSheetId(inputUrl) {
  const m = String(inputUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function looksLikeCsv(url) {
  return String(url).includes("output=csv") || String(url).endsWith(".csv");
}

// Convert Share URL -> GViz JSON endpoint (public sheet only)
function buildGvizUrl(shareUrl, sheetName = null) {
  const id = extractSheetId(shareUrl);
  if (!id) throw new Error("หา Sheet ID ไม่เจอ: ตรวจสอบลิงก์ Google Sheet");

  const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json`;
  if (sheetName) return `${base}&sheet=${encodeURIComponent(sheetName)}`;
  return base;
}

// Parse GViz JSON (it returns JS code, not pure JSON)
function parseGviz(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("รูปแบบ GViz ไม่ถูกต้อง");
  return JSON.parse(text.slice(start, end + 1));
}

// Convert table rows to array of objects by column labels
function gvizToObjects(gvizJson) {
  const cols = gvizJson.table.cols.map((c) => c.label || c.id);
  return gvizJson.table.rows.map((r) => {
    const obj = {};
    cols.forEach((k, i) => {
      const cell = r.c[i];
      obj[k] = cell ? (cell.f ?? cell.v) : "";
    });
    return obj;
  });
}

// ✅ CSV parser (fix CRLF + trim header + handle quotes)
function parseCsv(csvText) {
  // remove BOM
  const text = String(csvText).replace(/^\uFEFF/, "");

  const rows = [];
  let cur = "";
  let inQ = false;
  const out = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    // escaped quote
    if (ch === '"' && inQ && next === '"') {
      cur += '"';
      i++;
      continue;
    }

    // quote toggle
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }

    // delimiter / newline
    if (!inQ && (ch === "," || ch === "\n" || ch === "\r")) {
      out.push(cur);
      cur = "";

      // handle CRLF
      if (ch === "\r" && next === "\n") i++;

      if (ch === "\n" || ch === "\r") {
        rows.push(out.slice());
        out.length = 0;
      }
      continue;
    }

    cur += ch;
  }

  // flush last
  if (cur.length || out.length) {
    out.push(cur);
    rows.push(out.slice());
  }

  // remove empty lines
  const clean = rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  if (!clean.length) return [];

  // ✅ trim header + strip trailing \r
  const headers = clean[0].map((h) => String(h ?? "").replace(/\r/g, "").trim());

  return clean.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => {
      o[h] = (r[idx] ?? "").toString().replace(/\r/g, "").trim();
    });
    return o;
  });
}

/**
 * Load data from Google Sheet (public)
 * @param {Object} params
 * @param {string} params.url - CSV publish URL or share URL
 * @param {string|null} params.sheetName - optional for gviz
 * @returns {Promise<Array<Object>>}
 */
export async function loadSheetData({ url, sheetName = null }) {
  if (!url) throw new Error("ต้องใส่ลิงก์ Google Sheet");

  if (looksLikeCsv(url)) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`โหลด CSV ไม่สำเร็จ: ${res.status}`);
    const text = await res.text();
    return parseCsv(text);
  }

  const gvizUrl = buildGvizUrl(url, sheetName);
  const res = await fetch(gvizUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`โหลด GViz ไม่สำเร็จ: ${res.status}`);
  const text = await res.text();
  const json = parseGviz(text);
  return gvizToObjects(json);
}

function toNumber(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[,฿\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeRow(row) {
  return {
    date: row["Date"] ?? "",
    list: row["List"] ?? "",
    type: row["Type"] ?? "",
    type_end: row["Type_End"] ?? "",
    price: toNumber(row["Price"] ?? 0),
    channel: row["ช่องทางจ่าย"] ?? "",
  };
}

