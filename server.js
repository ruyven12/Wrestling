console.log(">>> SERVER FILE VERSION: PATCHED-FULL-2 (WRESTLING SHOWS + CORS FIX) <<<");

const express = require("express");
const archiver = require("archiver");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const app = express();

// =========================================================
// UNIVERSAL CORS
// =========================================================
function allowCors(res, req) {
  // If the browser sends credentials (cookies), we cannot use "*" for ACAO.
  // We keep a small allowlist for known frontends, and fall back to "*" otherwise.
  const origin = req && req.headers ? req.headers.origin : "";
  const allowList = String(process.env.CORS_ALLOW_ORIGINS || "https://vmpix.onrender.com,https://vmpix.smugmug.com")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const isAllowed = origin && allowList.includes(origin);

  if (isAllowed) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
  } else {
    // Public, non-credentialed requests
    res.set("Access-Control-Allow-Origin", "*");
  }

  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  // Include common headers used by fetch() and browsers
  res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Requested-With, X-Analytics-Key");
  // Optional: make it easier to debug in DevTools
  res.set("Access-Control-Expose-Headers", "Content-Type, Content-Length");
}

// Always attach CORS headers (including for static files) and handle OPTIONS fast
app.use((req, res, next) => {
  allowCors(res, req);
  if (req.method === "OPTIONS") return res.status(204).send("");
  next();
});


app.use(express.static(__dirname));
app.use(express.json({ limit: "2mb" }));

// =========================================================
// KEEP-WARM PING ENDPOINT
// Lightweight health check to prevent Render cold starts
// =========================================================
app.get("/ping", (req, res) => {
  allowCors(res, req);
  res.status(200).send("OK");
});



// SmugMug API Key
const SMUG_API_KEY = "SQLhhqgXZJd7MzqgVX563bkbjdCfXt9T";

// Google Sheets (your existing CSV sources)
const BANDS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdi19qTDyPeBGzq0PpkdlDS_bNg34XpdRiXy8aBa-Jlu-jg2Wzkj1SnLXtRVFU4TGOh5KHJPK8Lwhc/pub?gid=0&single=true&output=csv";

// Music shows CSV (legacy)
const MUSIC_SHOWS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdi19qTDyPeBGzq0PpkdlDS_bNg34XpdRiXy8aBa-Jlu-jg2Wzkj1SnLXtRVFU4TGOh5KHJPK8Lwhc/pub?gid=1306635885&single=true&output=csv";

// Wrestling shows CSV (published)
const WRESTLING_SHOWS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTGNw3uAMsoML1yS4d12v8FKwrAZQK0OSuZkoml3cQT2s_KEQa7Qs5flD0c_zjJnR2Qy5D465-_6F8/pub?output=csv";

// Default /sheet/shows source. For the wrestling server, this should be Wrestling.
// You can override via env SHOWS_SHEET_URL if you deploy a music-only instance.
const SHOWS_SHEET_URL = String(process.env.SHOWS_SHEET_URL || WRESTLING_SHOWS_SHEET_URL).trim() || WRESTLING_SHOWS_SHEET_URL;


// Stats tab (Fix / Metadata) – gid provided by Chris
// NOTE: Uses the Google Sheet "export?format=csv" URL style.
// This will work as long as the sheet (or at least this tab) is readable without auth.
const STATS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/12P8b85K24dcyy9jubil_h4DN6xXr3wYFsILz-5LkGkk/export?format=csv&gid=1973247444";


// =========================================================
// ✔ FIXED: SmugMug API helper (must be ABOVE all routes)
// =========================================================
async function smug(endpoint) {
  const url = `https://api.smugmug.com/api/v2${endpoint}&APIKey=${SMUG_API_KEY}`;

  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SmugProxy/1.0"
    }
  });

  if (!r.ok) {
    throw new Error(`SmugMug upstream returned ${r.status}`);
  }

  return r.json();
}

// =========================================================
// SHEETS → CSV
// =========================================================
app.get("/sheet/bands", async (req, res) => {
  try {
    const r = await fetch(BANDS_SHEET_URL);
    const csv = await r.text();
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /bands fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("sheet error");
  }
});

app.get("/sheet/shows", async (req, res) => {
  try {
    const r = await fetch(SHOWS_SHEET_URL);
    const csv = await r.text();
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /shows fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("shows sheet error");
  }
});

// Stats tab (Fix / Metadata)
// Aliases included to match different frontend endpoint names used over time.
async function sendStatsCsv(req, res) {
  try {
    const r = await fetch(STATS_SHEET_URL);
    const csv = await r.text();
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /stats fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("stats sheet error");
  }
}

app.get("/sheet/stats", sendStatsCsv);
app.get("/sheet/stats/", sendStatsCsv);
app.get("/sheet/fix_metadata", sendStatsCsv);
app.get("/sheet/fix_metadata/", sendStatsCsv);
app.get("/sheet/fix-metadata", sendStatsCsv);
app.get("/sheet/fix-metadata/", sendStatsCsv);
app.get("/sheet/fixmetadata", sendStatsCsv);
app.get("/sheet/fixmetadata/", sendStatsCsv);
app.get("/sheet/fix", sendStatsCsv);
app.get("/sheet/fix/", sendStatsCsv);

// =========================================================
// IMAGE PROXY (posters)
// =========================================================
app.get("/show-poster", async (req, res) => {
  allowCors(res, req);
  const remoteUrl = req.query.url;
  if (!remoteUrl) return res.status(400).send("missing url");

  try {
    const upstream = await fetch(remoteUrl);
    if (!upstream.ok) {
      console.error("upstream not ok:", upstream.status, remoteUrl);
      return res.status(502).send("bad upstream");
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("proxy image error:", err);
    res.status(500).send("error");
  }
});



function _splitPeopleNames(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const seen = new Set();
  return s.split(/[;,]/g)
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((name) => {
      const key = String(name || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function _slugifyPersonName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function _wrestlingMatchField(row, idx, field) {
  const n = Number(idx);
  const keys = [
    `match-${n}_${field}`,
    `match_${n}_${field}`,
    `match-${n}-${field}`,
    `match_${n}-${field}`,
    `part_${n}_${field}`,
  ];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : "";
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function _wrestlingShowSlugFromDate(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2, "0");
    const dd = String(m[2]).padStart(2, "0");
    let yy = String(m[3]);
    if (yy.length === 4) yy = yy.slice(2);
    return mm + dd + yy;
  }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return String(m[2]) + String(m[3]) + String(m[1]).slice(2);
  return "";
}

function _wrestlingMatchSlug(urlCell, idx) {
  const raw = String(urlCell || "").trim();
  if (raw && !/^https?:\/\//i.test(raw) && !raw.startsWith("/")) {
    const clean = raw
      .toLowerCase()
      .replace(/[^a-z0-9\-_ ]+/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (clean) return clean;
  }
  return `match-${String(Number(idx) || 1)}`;
}

app.get('/index/people', async (req, res) => {
  allowCors(res, req);
  try {
    const r = await fetch(SHOWS_SHEET_URL);
    const csvText = await r.text();
    const rows = _csvParse(csvText).map((row) => {
      const out = {};
      Object.keys(row || {}).forEach((key) => {
        out[String(key || "").trim().toLowerCase()] = String(row[key] || "").trim();
      });
      return out;
    });

    const people = Object.create(null);
    let appearanceCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const showDateRaw = String(row.show_date || row.date || "").trim();
      const showSlug = _wrestlingShowSlugFromDate(showDateRaw);
      const showTitle = String(row.show_name || row.show || row.title || row.event || row.event_name || "").trim() || (showSlug ? `Show ${showSlug}` : "Show");

      for (let idx = 1; idx <= 12; idx++) {
        const peopleCell = _wrestlingMatchField(row, idx, 'people');
        const names = _splitPeopleNames(peopleCell);
        if (!names.length) continue;

        const type = _wrestlingMatchField(row, idx, 'type');
        const stip = _wrestlingMatchField(row, idx, 'stip');
        const partTitle = _wrestlingMatchField(row, idx, 'title');
        const urlCell = _wrestlingMatchField(row, idx, 'url');
        const partSlug = _wrestlingMatchSlug(urlCell, idx);
        const detailTitle = String(stip || partTitle || type || 'Match Album').trim();
        const route = showSlug ? `/wrestling/shows/${showSlug}/${partSlug}` : '/wrestling/shows';

        for (let j = 0; j < names.length; j++) {
          const person = names[j];
          const key = String(person || "").trim().toLowerCase();
          if (!key) continue;
          if (!people[key]) {
            people[key] = {
              person,
              slug: _slugifyPersonName(person),
              appearances: []
            };
          }
          people[key].appearances.push({
            showTitle,
            showDate: showDateRaw,
            partIndex: idx,
            title: detailTitle,
            type: type || "",
            route
          });
          appearanceCount += 1;
        }
      }
    }

    Object.keys(people).forEach((key) => {
      people[key].appearances.sort((a, b) => String(b.showDate || "").localeCompare(String(a.showDate || "")));
    });

    res.json({
      generatedAt: new Date().toISOString(),
      totalPeople: Object.keys(people).length,
      totalAppearances: appearanceCount,
      people
    });
  } catch (err) {
    console.error('/index/people failed:', err);
    res.status(500).json({ error: 'people index error' });
  }
});
// =========================================================
// SMART FOLDER → ALBUMS
// =========================================================

// =========================================================
// ✔ NEW: RESOLVE A SMUGMUG ALBUM URL → AlbumKey (Wrestling)
// IMPORTANT: This MUST be defined BEFORE /smug/:slug because otherwise
// /smug/resolve-album gets treated as a band slug and returns Album:[]
// =========================================================
function extractAlbumKeyFromUri(uri) {
  const s = String(uri || "");
  // Examples:
  //  /api/v2/album/AbCdEf
  //  https://api.smugmug.com/api/v2/album/AbCdEf
  const m = s.match(/\/album\/([^/?#]+)/i);
  return m ? String(m[1]).trim() : "";
}

async function resolveAlbumKeyViaNodeUrlPath(urlString) {
  const u = new URL(urlString);
  const urlPath = u.pathname || "";
  if (!urlPath || urlPath === "/") return { albumKey: "", nodeKey: "", finalUrl: u.toString() };

  // SmugMug supports resolving a Node by UrlPath.
  // If this UrlPath is an Album node, it typically includes an AlbumUri.
  const data = await smug(`/node?UrlPath=${encodeURIComponent(urlPath)}&_verbosity=1`);

  const resp = (data && data.Response) || {};
  const node = (Array.isArray(resp.Node) && resp.Node[0]) ? resp.Node[0] : resp.Node;

  let nodeKey = "";
  let albumKey = "";

  if (node && typeof node === "object") {
    if (typeof node.NodeKey === "string") nodeKey = node.NodeKey.trim();
    if (typeof node.AlbumKey === "string") albumKey = node.AlbumKey.trim();
    if (!albumKey && typeof node.AlbumUri === "string") albumKey = extractAlbumKeyFromUri(node.AlbumUri);

    // Some responses nest Uris
    if (!albumKey && node.Uris && typeof node.Uris === "object") {
      const maybeAlbumUri = node.Uris.Album || node.Uris.album || node.Uris.AlbumUri;
      if (typeof maybeAlbumUri === "string") albumKey = extractAlbumKeyFromUri(maybeAlbumUri);
    }

    // Sometimes the node itself is an album and its Uri contains /album/<key>
    if (!albumKey && typeof node.Uri === "string") albumKey = extractAlbumKeyFromUri(node.Uri);
  }

  return { albumKey, nodeKey, finalUrl: u.toString(), urlPath };
}

async function resolveAlbumKeyViaHtmlScrape(urlString) {
  // Fallback: fetch the SmugMug page HTML and scrape AlbumKey.
  const r = await fetch(urlString, {
    headers: {
      "User-Agent": "SmugProxy/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const html = await r.text();

  // Common patterns seen in SmugMug pages.
  const m1 = html.match(/"AlbumKey"\s*:\s*"([A-Za-z0-9]+)"/);
  if (m1 && m1[1]) return String(m1[1]).trim();
  const m2 = html.match(/AlbumKey"\s*"\s*:\s*"([A-Za-z0-9]+)"/);
  if (m2 && m2[1]) return String(m2[1]).trim();
  const m3 = html.match(/albumKey\s*[:=]\s*"([A-Za-z0-9]+)"/i);
  if (m3 && m3[1]) return String(m3[1]).trim();
  return "";
}

app.get("/smug/resolve-album", async (req, res) => {
  allowCors(res, req);
  const input = String(req.query.url || "").trim();
  if (!input) return res.status(400).json({ error: "missing url" });

  let albumKey = "";
  let nodeKey = "";
  let finalUrl = input;
  let urlPath = "";

  try {
    // Try API resolve first (fast + clean).
    const out = await resolveAlbumKeyViaNodeUrlPath(input);
    albumKey = out.albumKey || "";
    nodeKey = out.nodeKey || "";
    finalUrl = out.finalUrl || input;
    urlPath = out.urlPath || "";
  } catch (e) {
    console.log("resolve-album via node failed:", e && e.message ? e.message : e);
  }

  try {
    // Fallback for edge cases.
    if (!albumKey) albumKey = await resolveAlbumKeyViaHtmlScrape(input);
  } catch (e) {
    console.log("resolve-album via html failed:", e && e.message ? e.message : e);
  }

  return res.json({
    albumKey: albumKey || "",
    AlbumKey: albumKey || "",
    nodeKey: nodeKey || "",
    finalUrl,
    urlPath
  });
});

// Resolve shop node info as well (frontend calls this first)
app.get("/smug/resolve-shop-node", async (req, res) => {
  allowCors(res, req);
  const input = String(req.query.url || "").trim();
  if (!input) return res.status(400).json({ error: "missing url" });

  let albumKey = "";
  let nodeKey = "";
  let finalUrl = input;
  let urlPath = "";

  try {
    const out = await resolveAlbumKeyViaNodeUrlPath(input);
    albumKey = out.albumKey || "";
    nodeKey = out.nodeKey || "";
    finalUrl = out.finalUrl || input;
    urlPath = out.urlPath || "";
  } catch (e) {
    console.log("resolve-shop-node via node failed:", e && e.message ? e.message : e);
  }

  try {
    if (!albumKey) albumKey = await resolveAlbumKeyViaHtmlScrape(input);
  } catch (_) {}

  return res.json({
    nodeKey: nodeKey || "",
    albumKey: albumKey || "",
    AlbumKey: albumKey || "",
    finalUrl,
    urlPath
  });
});


// =========================================================
// ✔ NEW: GLOBAL WRESTLING ALBUM KEYWORD SEARCH (Option A)
// GET /smug/albums-by-keyword?keyword=...
// Crawls /Wrestling folder recursively, caches AlbumKey+Title+Url+Keywords,
// then filters albums whose keyword list matches the query.
// MUST be defined BEFORE /smug/:slug so it isn't treated as a band slug.
// =========================================================
const SMUG_WEB_ORIGIN = "https://vmpix.smugmug.com";

// Cache + build lock (to avoid re-crawling on every click)
const WRESTLING_KEYWORD_CACHE_TTL_MS = Number(process.env.WRESTLING_KEYWORD_CACHE_TTL_MS || (6 * 60 * 60 * 1000)); // 6h default
let _wrestlingAlbumIndex = { builtAt: 0, albums: [] };
let _wrestlingIndexPromise = null;

function _smugEndpointFromUri(uri) {
  const s = String(uri || "").trim();
  if (!s) return "";
  // Accept /api/v2/... or https://api.smugmug.com/api/v2/...
  let out = s.replace(/^https?:\/\/api\.smugmug\.com\/api\/v2/i, "");
  out = out.replace(/^\/api\/v2/i, "");
  if (!out.startsWith("/")) out = "/" + out;
  return out;
}

function _normKw(s) {
  return String(s || "").trim().toLowerCase();
}



// ===============================
// SHOWS SHEET LOOKUP (date -> company/show_name)
// ===============================
function _csvParse(text) {
  const rows = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (!lines.length) return rows;

  function parseLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          // Escaped quote
          if (i + 1 < line.length && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out.map(v => String(v || "").trim());
  }

  // Find header
  let header = null;
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    header = parseLine(line).map(h => String(h || "").trim());
    headerIdx = i;
    break;
  }
  if (!header || headerIdx === -1) return rows;

  const keyIndex = {};
  for (let i = 0; i < header.length; i++) {
    const k = String(header[i] || "").trim();
    if (!k) continue;
    keyIndex[k] = i;
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = parseLine(line);
    const obj = {};
    for (const k in keyIndex) {
      obj[k] = cols[keyIndex[k]] || "";
    }
    rows.push(obj);
  }
  return rows;
}

function _mmddyyFromShowDate(showDate) {
  const s = String(showDate || "").trim();
  if (!s) return "";
  // Accept M/D/YY, MM/DD/YY, M/D/YYYY, MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let y = String(m[3]);
  if (!(mm >= 1 && mm <= 12)) return "";
  if (!(dd >= 1 && dd <= 31)) return "";
  if (y.length === 4) y = y.slice(2);
  if (y.length !== 2) return "";
  const mm2 = String(mm).padStart(2, "0");
  const dd2 = String(dd).padStart(2, "0");
  return `${mm2}${dd2}${y}`;
}

function _normLoose(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function _fetchShowsLookup() {
  // Builds a lookup map: mmddyy -> [{ company, show_name }...]
  const map = Object.create(null);

  const r = await fetch(SHOWS_SHEET_URL);
  const csvText = await r.text();
  const rows = _csvParse(csvText);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const company = String(row.company || row.Company || "").trim();
    const showName = String(row.show_name || row.showName || row.ShowName || row["show_name"] || "").trim();
    const showDate = String(row.show_date || row.showDate || row.ShowDate || row["show_date"] || "").trim();

    const key = _mmddyyFromShowDate(showDate);
    if (!key) continue;

    if (!map[key]) map[key] = [];
    map[key].push({ company, showName });
  }

  return map;
}

function _splitKeywords(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  // SmugMug commonly uses semicolons, but we accept commas too
  return s.split(/[;,]/g).map(x => String(x || "").trim()).filter(Boolean);
}

// ===============================
// DATE HELPERS (UriPath -> Pretty)
// ===============================
// Example UriPath: /Wrestling/Limitless/011626/Match-1
// We extract "011626" (MMDDYY) and format "January 16th, 2026".
function _extractMmddyyFromUriPath(uriPath) {
  const p = String(uriPath || "").trim();
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  // Find the first 6-digit segment (defensive; supports other feds/paths too)
  for (let i = 0; i < parts.length; i++) {
    const seg = String(parts[i] || "").trim();
    if (/^\d{6}$/.test(seg)) return seg;
  }
  return "";
}

function _ordinalSuffix(day) {
  const d = Number(day);
  if (!Number.isFinite(d)) return "th";
  if (d % 100 >= 11 && d % 100 <= 13) return "th";
  if (d % 10 === 1) return "st";
  if (d % 10 === 2) return "nd";
  if (d % 10 === 3) return "rd";
  return "th";
}

function _prettyDateFromMmddyy(mmddyy) {
  const s = String(mmddyy || "").trim();
  if (!/^\d{6}$/.test(s)) return "";
  const mm = Number(s.slice(0, 2));
  const dd = Number(s.slice(2, 4));
  const yy = Number(s.slice(4, 6));
  if (!(mm >= 1 && mm <= 12)) return "";
  if (!(dd >= 1 && dd <= 31)) return "";
  const year = 2000 + yy;
  const date = new Date(year, mm - 1, dd);
  if (isNaN(date.getTime())) return "";
  const monthName = date.toLocaleString("en-US", { month: "long" });
  return `${monthName} ${dd}${_ordinalSuffix(dd)}, ${year}`;
}

function _prettyDateFromUriPath(uriPath) {
  const mmddyy = _extractMmddyyFromUriPath(uriPath);
  if (!mmddyy) return "";
  return _prettyDateFromMmddyy(mmddyy);
}

async function _fetchAllPaged(endpointBase, responseKey) {
  // endpointBase should contain '?', e.g. "/folder/...!albums?count=100"
  const out = [];
  let start = 1;
  let more = true;

  while (more) {
    const joiner = endpointBase.indexOf("?") === -1 ? "?" : "&";
    const endpoint = `${endpointBase}${joiner}start=${start}&count=100&_verbosity=1`;
    const data = await smug(endpoint);

    const resp = (data && data.Response) || {};
    let items = resp[responseKey];

    if (Array.isArray(items)) {
      // ok
    } else if (items) {
      items = [items];
    } else {
      items = [];
    }

    for (let i = 0; i < items.length; i++) out.push(items[i]);

    const pages = resp.Pages || {};
    const total = Number(pages.Total) || 0;
    const count = Number(pages.Count) || items.length || 100;
    const gotSoFar = (start - 1) + items.length;

    if (!total || gotSoFar >= total || items.length === 0) {
      more = false;
    } else {
      start += count;
    }
  }

  return out;
}

async function _crawlFolderRecursive(folderUriOrEndpoint, accumAlbums) {
  const folderEp = _smugEndpointFromUri(folderUriOrEndpoint);
  if (!folderEp) return;

  // 1) albums in this folder
  try {
    const albums = await _fetchAllPaged(`${folderEp}!albums?`, "Album");
    for (let i = 0; i < albums.length; i++) {
      const a = albums[i] || {};
      const albumKey = String(a.AlbumKey || a.Key || "").trim();
      if (!albumKey) continue;

      // Try to keep a usable web URL (some responses include WebUri)
      let url = "";
      if (typeof a.WebUri === "string") url = a.WebUri.trim();
      if (!url && typeof a.Url === "string") url = a.Url.trim();
      if (!url && typeof a.Uri === "string") {
        // As a fallback, provide a stable open-by-key link
        url = `${SMUG_WEB_ORIGIN}/gallery/${encodeURIComponent(albumKey)}`;
      }
      const title = String(a.Title || a.Name || "").trim();

      accumAlbums.push({
        albumKey,
        title,
        url,
        // Keywords filled later
        keywordsRaw: "",
        keywords: []
      });
    }
  } catch (e) {
    console.warn("crawl albums failed for", folderEp, e && e.message ? e.message : e);
  }

  // 2) recurse into subfolders
  try {
    const folders = await _fetchAllPaged(`${folderEp}!folders?`, "Folder");
    for (let i = 0; i < folders.length; i++) {
      const f = folders[i] || {};
      const nextUri = f.Uri || f.FolderUri || "";
      if (!nextUri) continue;
      await _crawlFolderRecursive(nextUri, accumAlbums);
    }
  } catch (e) {
    // Some folders may not expose subfolders; that's fine.
  }
}

async function _buildWrestlingAlbumIndex(force) {
  const now = Date.now();
  if (!force && _wrestlingAlbumIndex.builtAt && (now - _wrestlingAlbumIndex.builtAt) < WRESTLING_KEYWORD_CACHE_TTL_MS) {
    return _wrestlingAlbumIndex;
  }

  // Build lock
  if (_wrestlingIndexPromise) return _wrestlingIndexPromise;

  _wrestlingIndexPromise = (async () => {
    const albums = [];
    // Root wrestling folder
    await _crawlFolderRecursive("/folder/user/vmpix/Wrestling", albums);

    // Deduplicate by AlbumKey (recursive crawl can surface duplicates)
    const seen = new Set();
    const uniq = [];
    for (let i = 0; i < albums.length; i++) {
      const k = String(albums[i].albumKey || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniq.push(albums[i]);
    }

    // Fetch shows sheet once per index build (company/show_name lookup)
    let showsLookup = Object.create(null);
    try {
      showsLookup = await _fetchShowsLookup();
    } catch (e) {
      // Fail-soft: show metadata is optional
      showsLookup = Object.create(null);
    }

    // Fetch keywords per album with small concurrency
    const concurrency = Number(process.env.WRESTLING_KEYWORD_CONCURRENCY || 4);
    let idx = 0;

    async function worker() {
      while (idx < uniq.length) {
        const cur = idx++;
        const item = uniq[cur];
        const key = item.albumKey;

        try {
          const meta = await smug(`/album/${encodeURIComponent(key)}?_verbosity=1`);
          const resp = (meta && meta.Response) || {};
          const album = (resp.Album && Array.isArray(resp.Album)) ? resp.Album[0] : resp.Album;

          const raw =
            (album && typeof album.Keywords === "string") ? album.Keywords :
            (album && typeof album.Keyword === "string") ? album.Keyword :
            "";

                    // Capture UriPath (if available) so the frontend can show a show-date.
          // This is derived from your folder naming convention: /Wrestling/<FED>/MMDDYY/...
          const uriPath = (album && typeof album.UriPath === "string") ? album.UriPath : "";

          // Some SmugMug album responses do not include UriPath. Fall back to parsing the web URL pathname.
          let derivedPath = String(uriPath || "").trim();
          if (!derivedPath) {
            try {
              const u = new URL(String(item.url || "").trim());
              derivedPath = String(u.pathname || "").trim();
            } catch (_) {
              derivedPath = "";
            }
          }

          item.uriPath = derivedPath;
          item.date = _prettyDateFromUriPath(item.uriPath);
// Attach show metadata (company + show name) from Google Sheet by matching date
          const mmddyy = _extractMmddyyFromUriPath(item.uriPath);
          const candidates = (mmddyy && showsLookup && showsLookup[mmddyy]) ? showsLookup[mmddyy] : null;

          let picked = null;
          if (candidates && candidates.length) {
            if (candidates.length === 1) {
              picked = candidates[0];
            } else {
              const pathNorm = _normLoose(item.uriPath);
              for (let j = 0; j < candidates.length; j++) {
                const c = candidates[j] || {};
                const cn = _normLoose(c.company);
                if (cn && pathNorm.indexOf(cn) !== -1) { picked = c; break; }
              }
              if (!picked) picked = candidates[0];
            }
          }

          item.company = picked && picked.company ? String(picked.company) : "";
          item.showName = picked && picked.showName ? String(picked.showName) : "";

          item.keywordsRaw = String(raw || "").trim();
          item.keywords = _splitKeywords(item.keywordsRaw).map(_normKw);
        } catch (e) {
          // Fail-soft: keep album without keywords
          item.keywordsRaw = "";
          item.keywords = [];
          item.uriPath = item.uriPath || "";
          item.date = item.date || "";
          item.company = item.company || "";
          item.showName = item.showName || "";
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) workers.push(worker());
    await Promise.all(workers);

    _wrestlingAlbumIndex = { builtAt: Date.now(), albums: uniq };
    _wrestlingIndexPromise = null;
    return _wrestlingAlbumIndex;
  })();

  try {
    return await _wrestlingIndexPromise;
  } finally {
    // If it throws, clear lock so next request can retry
    // (avoid permanent lock)
    _wrestlingIndexPromise = null;
  }
}

app.get("/smug/albums-by-keyword", async (req, res) => {
  allowCors(res, req);

  const kw =
    String(req.query.keyword || req.query.kw || req.query.q || req.query.term || req.query.name || "").trim();

  if (!kw) return res.status(400).json({ error: "missing keyword" });

  const needle = _normKw(kw);
  const force = String(req.query.force || "").trim() === "1";

  try {
    const idx = await _buildWrestlingAlbumIndex(force);

    // Match rule: exact keyword match OR substring match (handles "Nate Speckman" vs "Speckman")
    const results = (idx.albums || []).filter(a => {
      const list = Array.isArray(a.keywords) ? a.keywords : [];
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        if (!k) continue;
        if (k === needle) return true;
        if (k.indexOf(needle) !== -1) return true;
        if (needle.indexOf(k) !== -1) return true;
      }
      return false;
    }).map(a => ({
      albumKey: a.albumKey,
      AlbumKey: a.albumKey,
      title: a.title,
      Title: a.title,
      url: a.url,
      Url: a.url,
      // Derived from UriPath segment MMDDYY -> "January 16th, 2026" (best-effort)
      date: a.date || "",
      Date: a.date || "",
      // Show metadata (from Google Sheet by date; best-effort)
      company: a.company || "",
      Company: a.company || "",
      showName: a.showName || "",
      ShowName: a.showName || "",
      uriPath: a.uriPath || "",
      UriPath: a.uriPath || "",
      // optional: return raw keywords for debugging if needed
      keywords: a.keywordsRaw
    }));

    return res.json({
      keyword: kw,
      count: results.length,
      albums: results
    });
  } catch (e) {
    console.error("albums-by-keyword failed:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "albums-by-keyword failed" });
  }
});


app.get("/smug/:slug", async (req, res) => {
  const slug = req.params.slug;
  const folderFromSheet = req.query.folder;
  const region = req.query.region || "Local";

  const REGION_FOLDER_BASE = {
    Local: "Local",
    Regional: "Regional",
    National: "National",
    International: "International"
  };

  const regionFolder = REGION_FOLDER_BASE[region] || REGION_FOLDER_BASE.Local;

  const base = `https://api.smugmug.com/api/v2/folder/user/vmpix/Music/Archives/Bands/${regionFolder}`;

  const candidates = [];
  if (folderFromSheet) {
    candidates.push(folderFromSheet);
    candidates.push(folderFromSheet.replace(/\s+/g, "-"));
  }

  const rawLower = slug.replace(/-/g, " ");
  const words = rawLower.split(" ").filter(Boolean);

  const SMALL = new Set(["of", "the", "and", "a", "an", "to", "for", "at", "by", "with", "in"]);

  const titleSmart = words
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i !== 0 && SMALL.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(" ");

  const titleAll = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  const noSpaces = rawLower.replace(/\s+/g, "");
  const dashedSmart = titleSmart.replace(/\s+/g, "-");

  candidates.push(titleSmart, titleAll, rawLower, dashedSmart, noSpaces);

  let successData = null;
  let usedUrl = null;

  for (const name of candidates) {
    const url = `${base}/${encodeURIComponent(name)}!albums?APIKey=${SMUG_API_KEY}`;
    console.log("Trying:", url);

    try {
      const r = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "SmugProxy/1.0"
        }
      });

      if (r.ok) {
        const data = await r.json();
        if (data && data.Response && Array.isArray(data.Response.Album)) {
          successData = data;
          usedUrl = url;
          break;
        }
      }
    } catch (err) {
      console.log("Error fetching", url, err.message);
    }
  }

  allowCors(res, req);

  if (successData) {
    successData._usedUrl = usedUrl;
    return res.json(successData);
  }

  res.json({
    Response: { Album: [] },
    info: `No albums found for slug=${slug} (tried: ${candidates.join(" | ")})`
  });
});

// =========================================================
// ALBUM → IMAGES (paged)
// =========================================================
app.get("/smug/album/:albumKey", async (req, res) => {
  const albumKey = req.params.albumKey;
  const count = req.query.count || 200;
  const start = req.query.start || 1;

  const url = `https://api.smugmug.com/api/v2/album/${encodeURIComponent(
    albumKey
  )}!images?APIKey=${SMUG_API_KEY}&count=${count}&start=${start}&_accept=application/json&_expand=Image`;

  console.log("PROXY ALBUM IMAGES:", url);

  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SmugProxy/1.0"
      }
    });

    if (!upstream.ok) {
      console.error("upstream album error:", upstream.status, await upstream.text());
      res.set("Access-Control-Allow-Origin", "*");
      return res.status(upstream.status).json({ error: "album images upstream error" });
    }

    const data = await upstream.json();
    res.set("Access-Control-Allow-Origin", "*");
    return res.json(data);
  } catch (err) {
    console.error("album images proxy error:", err);
    res.set("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "album images proxy failed" });
  }
});

// =========================================================
// ✔ NEW: ALBUM METADATA (album keywords)
// =========================================================
app.get("/smug/album-meta/:albumKey", async (req, res) => {
  const albumKey = req.params.albumKey;

  try {
    const result = await smug(
      `/album/${encodeURIComponent(albumKey)}?_expand=Keywords&_expand=KeywordArray`
    );

    allowCors(res, req);
    return res.json(result);
  } catch (err) {
    console.error("Error fetching album metadata:", err);
    allowCors(res, req);
    return res.status(500).json({ error: "Failed to fetch album metadata" });
  }
});

// =========================================================
// IMAGE DETAIL (keywords, caption, etc.)
// =========================================================
app.get("/smug/image/:imageKey", async (req, res) => {
  const imageKey = req.params.imageKey;

  const url = `https://api.smugmug.com/api/v2/image/${encodeURIComponent(
    imageKey
  )}-0?APIKey=${SMUG_API_KEY}&_accept=application/json&_verbosity=1&_expand=Image&_expand=Image.Keywords&_expand=KeywordArray`;

  console.log("FETCHING IMAGE DETAIL:", url);

  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SmugProxy/1.0"
      }
    });

    const data = await r.json();

    allowCors(res, req);
    return res.json(data);
  } catch (err) {
    console.error("error fetching image detail:", err);
    allowCors(res, req);
    return res.status(500).json({ error: "image detail fetch failed" });
  }
});



function fetchStreamWithRedirects(inputUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    try {
      if (!inputUrl || redirectsLeft < 0) return reject(new Error("Too many redirects"));
      const u = new URL(inputUrl);
      const lib = u.protocol === "https:" ? https : http;

      const req = lib.get(
        inputUrl,
        {
          headers: {
            "User-Agent": "MusicArchiveZip/1.0",
            "Accept": "*/*",
          },
        },
        (res) => {
          const code = res.statusCode || 0;

          // Redirects
          if (code >= 300 && code < 400 && res.headers.location) {
            const next = new URL(res.headers.location, inputUrl).toString();
            res.resume();
            return resolve(fetchStreamWithRedirects(next, redirectsLeft - 1));
          }

          if (code < 200 || code >= 300) {
            res.resume();
            return reject(new Error(`HTTP ${code} for ${inputUrl}`));
          }

          return resolve(res);
        }
      );

      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}


// =========================================================
// ✔ NEW: ZIP BUILDER (multi-download)
// Expects: { items: [{ url, filename }, ...] }
// Returns: application/zip stream
// =========================================================
app.options("/zip", (req, res) => {
  allowCors(res, req);
  return res.status(204).send("");
});

app.post("/zip", async (req, res) => {
  try {
    allowCors(res, req);

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).send("No items provided");
    if (items.length > 120) return res.status(400).send("Too many items (max 120)");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="photos.zip"');

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("warning", (err) => {
      console.warn("zip warning:", err);
    });

    archive.on("error", (err) => {
      console.error("zip error:", err);
      try { if (!res.headersSent) res.status(500).send("ZIP error"); } catch (_) {}
      try { res.end(); } catch (_) {}
    });

    archive.pipe(res);

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const url = String(it.url || "").trim();
      let filename = String(it.filename || `photo-${i + 1}.jpg`).trim();

      // basic sanitization
      filename = filename.replace(/[\/\\:*?"<>|]+/g, "-").slice(0, 160) || `photo-${i + 1}.jpg`;

      if (!/^https?:\/\//i.test(url)) continue;

      // Server-to-server fetch as stream (no global fetch needed)
      let stream;
      try {
        stream = await fetchStreamWithRedirects(url);
      } catch (e) {
        console.warn("zip fetch failed:", String(e && e.message ? e.message : e), url);
        continue;
      }

      archive.append(stream, { name: filename });
    }

    await archive.finalize();
  } catch (err) {
    console.error("POST /zip failed:", err);
    try {
      allowCors(res, req);
      return res.status(500).send("ZIP failed");
    } catch (_) {
      try { res.end(); } catch (_) {}
    }
  }
});

// =========================================================
// ✔ NEW: ANALYTICS EVENT LOGGER (no Google Analytics)
//
// Frontend calls: POST /track (or navigator.sendBeacon to /track)
// Server forwards the payload to a Google Apps Script Web App
// that appends the row into your Google Sheet tab (e.g. "Analytics").
//
// Env vars:
//   ANALYTICS_WEBAPP_URL  (required to enable logging)
//   ANALYTICS_KEY         (optional shared secret; if you add checks in Apps Script)
// =========================================================

const ANALYTICS_WEBAPP_URL = process.env.ANALYTICS_WEBAPP_URL || "";
const ANALYTICS_KEY = process.env.ANALYTICS_KEY || "";

app.post("/track", async (req, res) => {
  allowCors(res, req);

  // Always respond quickly so the UI never feels slow.
  // (We still try to forward the event to Sheets in the background.)
  res.status(204).send("");

  try {
    if (!ANALYTICS_WEBAPP_URL) return; // logging disabled if not configured

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const eventName = String(body.event || "").trim();
    if (!eventName) return;    // Keep payload small + predictable (matches your Sheet headers)
    const sessionid = (body.sessionid || body.sessionId || body.sessionID) ? String(body.sessionid || body.sessionId || body.sessionID) : '';

    // Extra is optional; if provided as an object, keep it.
    // We also tuck request context into extra._ctx so it never breaks column mapping.
    let extra = undefined;
    if (body.extra && typeof body.extra === 'object') {
      extra = body.extra;
    }
    if (extra && typeof extra === 'object') {
      extra._ctx = Object.assign({}, extra._ctx || {}, {
        ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 64),
        ua: String(req.headers['user-agent'] || '').slice(0, 220)
      });
    }

    const payload = {
      event: eventName.slice(0, 64),
      route: body.route ? String(body.route).slice(0, 120) : '',
      view: body.view ? String(body.view).slice(0, 64) : '',
      band: body.band ? String(body.band).slice(0, 120) : '',
      show: body.show ? String(body.show).slice(0, 160) : '',
      album: body.album ? String(body.album).slice(0, 180) : '',
      photo: body.photo ? String(body.photo).slice(0, 220) : '',
      year: body.year ? String(body.year).slice(0, 16) : '',
      category: body.category ? String(body.category).slice(0, 48) : '',
      source: body.source ? String(body.source).slice(0, 48) : '',
      page: body.page ? String(body.page).slice(0, 400) : '',
      referrer: body.referrer ? String(body.referrer).slice(0, 400) : '',
      sessionid: sessionid.slice(0, 80),
      extra: extra
    };

    const headers = { "Content-Type": "application/json" };
    if (ANALYTICS_KEY) headers["X-Analytics-Key"] = ANALYTICS_KEY;

    // Forward to your Apps Script Web App endpoint
    await fetch(ANALYTICS_WEBAPP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (err) {
    // Don't throw; analytics should never break the site.
    console.warn("/track forward failed:", err && err.message ? err.message : err);
  }
});

// =========================================================
// 404 (keep CORS headers on missing routes too)
// =========================================================
app.use((req, res) => {
  allowCors(res, req);
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});

// =========================================================
// SERVER START
// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on http://localhost:" + PORT);
});


