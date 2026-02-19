console.log(">>> SERVER FILE VERSION: PATCHED-FULL-1 <<<");

const express = require("express");
const { Readable } = require("stream");
let archiver = null;
try { archiver = require("archiver"); } catch (e) { /* optional */ }
const app = express();

// Global CORS (so even early errors include headers)
app.use((req, res, next) => {
  allowCors(res, req);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

// SmugMug API Key
const SMUG_API_KEY = "SQLhhqgXZJd7MzqgVX563bkbjdCfXt9T";

// Google Sheets (your existing CSV sources)
const BANDS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdi19qTDyPeBGzq0PpkdlDS_bNg34XpdRiXy8aBa-Jlu-jg2Wzkj1SnLXtRVFU4TGOh5KHJPK8Lwhc/pub?gid=0&single=true&output=csv";

const SHOWS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTGNw3uAMsoML1yS4d12v8FKwrAZQK0OSuZkoml3cQT2s_KEQa7Qs5flD0c_zjJnR2Qy5D465-_6F8/pub?output=csv";

// =========================================================
// UNIVERSAL CORS
// =========================================================
function allowCors(res, req) {
  const origin = req && req.headers ? String(req.headers.origin || "") : "";
  // SmugMug-hosted pages call this API from https://vmpix.smugmug.com
  if (origin && /^https:\/\/vmpix\.smugmug\.com$/i.test(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.set("Access-Control-Max-Age", "86400");
}


// =========================================================
// SIMPLE CACHE + TIMEOUT HELPERS (avoid Render edge 502 timeouts)
// =========================================================
const __cache = {
  showsCsv: null,
  showsFetchedAt: 0,
};

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, text: txt };
  } finally {
    clearTimeout(t);
  }
}


// =========================================================
// ✔ FIXED: SmugMug API helper (must be ABOVE all routes)
// =========================================================
async function smug(endpoint) {
  // endpoint may or may not already include a query string. Ensure APIKey is appended safely.
  const joiner = String(endpoint || "").includes("?") ? "&" : "?";
  const url = `https://api.smugmug.com/api/v2${endpoint}${joiner}APIKey=${SMUG_API_KEY}`;

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
// ✔ NEW: KEYWORD → ALBUMS (used by Wrestling keyword search modal)
// =========================================================
// GET  /smug/albums-by-keyword?keyword=<kw>
// POST /smug/albums-by-keyword { keyword: "<kw>" }
// Returns: { albums: [{ title, date, url, thumb, albumKey }] }
const __kwCache = {
  // normalized keyword -> { ts:number, albums:[] }
  byKw: new Map(),
  // url -> { ts:number, albumKey:string }
  urlToAlbumKey: new Map(),
  // albumKeyLower -> { ts:number, album:object, kwSet:Set<string> }
  albumMeta: new Map(),
  // parsed shows rows cache (to avoid re-parsing CSV repeatedly)
  showsRows: null,
  showsRowsTs: 0,
};

function _normKw(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function ensureShowsRows() {
  const now = Date.now();
  if (__kwCache.showsRows && now - __kwCache.showsRowsTs < 10 * 60 * 1000) {
    return __kwCache.showsRows;
  }

  // Prefer the already-cached CSV from /sheet/shows
  let csv = __cache.showsCsv;
  if (!csv || !String(csv).trim()) {
    const out = await fetchTextWithTimeout(SHOWS_SHEET_URL, 8000);
    if (!out.ok) throw new Error(`shows csv fetch failed (${out.status})`);
    csv = out.text;
    __cache.showsCsv = csv;
    __cache.showsFetchedAt = now;
  }

  const text = String(csv || "");
  const lines = text.split(/\r?\n/).filter((l) => String(l || "").trim());
  if (!lines.length) {
    __kwCache.showsRows = [];
    __kwCache.showsRowsTs = now;
    return [];
  }

  const header = parseCsvLine(lines.shift()).map((h) => String(h || "").trim());
  const headerLower = header.map((h) => h.toLowerCase());

  const rows = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) {
      row[headerLower[i]] = String(cols[i] || "").trim();
    }
    row.show_date = row.show_date || row.date || "";
    rows.push(row);
  }

  __kwCache.showsRows = rows;
  __kwCache.showsRowsTs = now;
  return rows;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (!k) continue;
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function getMatchField(obj, i, field) {
  const n = Number(i);
  const dash = `match-${n}`;
  const under = `match_${n}`;
  const legacy = `part_${n}`;
  const suffixes = [`_${field}`, `-${field}`];
  const keys = [];
  for (const suf of suffixes) {
    keys.push(`${dash}${suf}`);
    keys.push(`${under}${suf}`);
  }
  keys.push(`${legacy}_${field}`);
  return pickFirst(obj, keys);
}

const SMUG_ORIGIN = "https://vmpix.smugmug.com";

function resolveMatchUrl(urlCell, showRow) {
  const raw = String(urlCell || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return SMUG_ORIGIN.replace(/\/$/, "") + raw;

  function inferShowBaseUrl(r) {
    const base = String((r && (r.show_url || r.showurl || r.show)) || "").trim();
    if (base) return base;

    const rawDate = String((r && (r.show_date || r.date)) || "").trim();
    const mmddyy = (function () {
      if (!rawDate) return "";
      const m1 = rawDate.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/);
      if (m1) {
        const mm = String(m1[1]).padStart(2, "0");
        const dd = String(m1[2]).padStart(2, "0");
        let yy = String(m1[3]);
        if (yy.length === 4) yy = yy.slice(2);
        return mm + dd + yy;
      }
      const m2 = rawDate.match(/^\s*(\d{4})-(\d{2})-(\d{2})\s*$/);
      if (m2) {
        const yy = m2[1].slice(2);
        return m2[2] + m2[3] + yy;
      }
      return "";
    })();

    if (mmddyy) return SMUG_ORIGIN.replace(/\/$/, "") + "/Wrestling/Limitless/" + mmddyy;

    const poster = String((r && (r.show_poster || r.poster_url)) || "").trim();
    if (!poster) return "";
    try {
      const u = new URL(poster);
      const parts = String(u.pathname || "").split("/").filter(Boolean);
      for (let i = 0; i < parts.length - 2; i++) {
        if (String(parts[i]).toLowerCase() === "wrestling" && /^\d{6}$/.test(parts[i + 2])) {
          return SMUG_ORIGIN.replace(/\/$/, "") + "/" + parts.slice(i, i + 3).join("/");
        }
      }
    } catch (_) {}
    return "";
  }

  const base2 = inferShowBaseUrl(showRow);
  if (base2) return base2.replace(/\/$/, "") + "/" + raw.replace(/^\//, "");
  return raw;
}

async function resolveAlbumKeyFromUrlFast(albumUrl) {
  const rawUrl = String(albumUrl || "").trim();
  if (!rawUrl) return "";

  const now = Date.now();
  const cached = __kwCache.urlToAlbumKey.get(rawUrl);
  if (cached && now - cached.ts < 6 * 60 * 60 * 1000) return String(cached.albumKey || "");

  let urlObj = null;
  try { urlObj = new URL(rawUrl); } catch (_) {}
  if (!urlObj) return "";

  const parts = String(urlObj.pathname || "").split("/").filter(Boolean);
  if (parts.length < 2) return "";

  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/%20/g, " ")
      .replace(/[+]/g, " ")
      .replace(/[_]/g, "-")
      .replace(/\s+/g, " ");
  }
  function normDash(s) {
    return norm(s).replace(/\s+/g, "-");
  }

  const leaf = parts[parts.length - 1];
  const parentParts = parts.slice(0, parts.length - 1);
  const parentCandidates = [];
  for (let cut = parentParts.length; cut >= Math.max(1, parentParts.length - 2); cut--) {
    parentCandidates.push(parentParts.slice(0, cut));
  }

  const leafNorm = norm(leaf);
  const leafDash = normDash(leaf);

  // IMPORTANT: SmugMug folder paths must be URL-encoded per path segment.
  // Some folder names can contain spaces/punctuation; encode each segment to avoid upstream errors.
  function encodeFolderPath(partsArr) {
    return partsArr
      .map((p) => {
        try {
          return encodeURIComponent(decodeURIComponent(String(p || "")));
        } catch (_) {
          return encodeURIComponent(String(p || ""));
        }
      })
      .join("/");
  }

  for (const parent of parentCandidates) {
    const folderPathEnc = encodeFolderPath(parent);
    const apiPath = `/folder/user/vmpix/${folderPathEnc}!albums?_accept=application/json`;
    try {
      const data = await smug(apiPath);
      const albums = (data && data.Response && Array.isArray(data.Response.Album)) ? data.Response.Album : [];
      for (const a of albums) {
        const key = String(a.AlbumKey || a.Key || "").trim();
        if (!key) continue;
        const urlName = norm(a.UrlName || a.Urlname || "");
        const name = norm(a.Name || "");
        const title = norm(a.Title || "");

        if (urlName === leafNorm || urlName === leafDash) { __kwCache.urlToAlbumKey.set(rawUrl, { ts: now, albumKey: key }); return key; }
        if (name === leafNorm || name === leafDash) { __kwCache.urlToAlbumKey.set(rawUrl, { ts: now, albumKey: key }); return key; }
        if (title === leafNorm || title === leafDash) { __kwCache.urlToAlbumKey.set(rawUrl, { ts: now, albumKey: key }); return key; }
        if (urlName && (urlName.indexOf(leafNorm) !== -1 || urlName.indexOf(leafDash) !== -1)) { __kwCache.urlToAlbumKey.set(rawUrl, { ts: now, albumKey: key }); return key; }
      }
    } catch (_) {}
  }

  __kwCache.urlToAlbumKey.set(rawUrl, { ts: now, albumKey: "" });
  return "";
}

function extractAlbumKeywords(album) {
  if (!album) return [];
  let arr = [];
  if (Array.isArray(album.KeywordArray) && album.KeywordArray.length) {
    arr = album.KeywordArray
      .map((k) => {
        if (!k) return "";
        if (typeof k === "string") return k;
        if (typeof k === "object" && typeof k.Name === "string") return k.Name;
        if (typeof k === "object" && typeof k.value === "string") return k.value;
        return "";
      })
      .filter(Boolean);
  } else if (typeof album.Keywords === "string" && album.Keywords.trim()) {
    arr = album.Keywords.split(/[;,]+/).map((k) => String(k || "").trim()).filter(Boolean);
  }

  const seen = new Set();
  const out = [];
  for (const k of arr) {
    const nk = _normKw(k);
    if (!nk) continue;
    if (seen.has(nk)) continue;
    seen.add(nk);
    out.push(String(k).trim());
  }
  return out;
}

async function getAlbumMetaCached(albumKey) {
  const key = String(albumKey || "").trim();
  if (!key) return null;
  const keyLower = key.toLowerCase();
  const now = Date.now();
  const cached = __kwCache.albumMeta.get(keyLower);
  if (cached && now - cached.ts < 6 * 60 * 60 * 1000) return cached;

  try {
    // Do NOT mutate AlbumKey casing. SmugMug AlbumKey lookups can fail if case is altered.
    const d = await smug(`/album/${encodeURIComponent(key)}?_accept=application/json&_verbosity=1`);
    const album = (d && d.Response && d.Response.Album) ? d.Response.Album : null;
    const kws = extractAlbumKeywords(album);
    const kwSet = new Set(kws.map((k) => _normKw(k)));
    const pack = { ts: now, album, kwSet };
    __kwCache.albumMeta.set(keyLower, pack);
    return pack;
  } catch (_) {
    const pack = { ts: now, album: null, kwSet: new Set() };
    __kwCache.albumMeta.set(keyLower, pack);
    return pack;
  }
}

async function albumsByKeyword(keywordRaw) {
  const kwNorm = _normKw(keywordRaw);
  if (!kwNorm) return [];

  const now = Date.now();
  const cached = __kwCache.byKw.get(kwNorm);
  if (cached && now - cached.ts < 2 * 60 * 1000) return cached.albums || [];

  // Fast path: use SmugMug keyword endpoint to avoid scanning every match album.
  // Note: the keyword endpoint sometimes returns album stubs without WebUri/UrlPath,
  // so we enrich each hit via /album/<AlbumKey> before returning.
  let kwAlbums = [];
  try {
    const d = await smug(`/keyword/${encodeURIComponent(String(keywordRaw || "").trim())}!albums?_accept=application/json&_verbosity=1`);
    kwAlbums = (d && d.Response && Array.isArray(d.Response.Album)) ? d.Response.Album : [];
  } catch (e) {
    kwAlbums = [];
  }

  const candidateKeys = Array.from(
    new Set(
      (kwAlbums || [])
        .map((a) => String(a && (a.AlbumKey || a.Key || "") || "").trim())
        .filter(Boolean)
    )
  );

  const matches = [];
  {
    let idx = 0;
    const max = Math.min(5, candidateKeys.length || 1);
    const workers = new Array(max).fill(0).map(async () => {
      while (true) {
        const i = idx++;
        if (i >= candidateKeys.length) break;
        const albumKey = candidateKeys[i];
        const pack = await getAlbumMetaCached(albumKey);
        if (!pack || !pack.album || !pack.kwSet || !pack.kwSet.has(kwNorm)) continue;
        const a = pack.album;
        const url = String(a.WebUri || a.Url || "").trim();
        // Scope to wrestling section only.
        if (!url || url.toLowerCase().indexOf("/wrestling/") === -1) continue;
        const title = String(a.Title || a.Name || "").trim();
        const date = String(a.Date || a.LastUpdated || a.Created || "").trim();
        const outKey = String(a.AlbumKey || a.Key || albumKey || "").trim() || albumKey;
        matches.push({ title, date, url, thumb: "", albumKey: outKey });
      }
    });
    await Promise.all(workers);
  }

  matches.sort((a, b) => {
    const da = Date.parse(a.date || "") || 0;
    const db = Date.parse(b.date || "") || 0;
    if (db !== da) return db - da;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  __kwCache.byKw.set(kwNorm, { ts: now, albums: matches });
  return matches;
}

app.get("/smug/albums-by-keyword", async (req, res) => {
  allowCors(res, req);
  try {
    const kw = String(req.query.keyword || "");
    const albums = await albumsByKeyword(kw);
    return res.json({ albums });
  } catch (err) {
    console.error("albums-by-keyword failed:", err && err.message ? err.message : err);
    return res.status(500).json({ albums: [], error: "Keyword search failed" });
  }
});

app.post("/smug/albums-by-keyword", async (req, res) => {
  allowCors(res, req);
  try {
    const kw = String((req.body && req.body.keyword) || "");
    const albums = await albumsByKeyword(kw);
    return res.json({ albums });
  } catch (err) {
    console.error("albums-by-keyword failed:", err && err.message ? err.message : err);
    return res.status(500).json({ albums: [], error: "Keyword search failed" });
  }
});
// =========================================================
// IMAGE SIZES CACHE (for ZIP downloads)
// =========================================================
const __imgSizeCache = new Map(); // imageKey -> { ts:number, urls:object }
const __IMG_SIZE_TTL_MS = 60 * 60 * 1000; // 1 hour

function extractImageKeyFromUri(uri) {
  const m = String(uri || "").match(/\/image\/([A-Za-z0-9]+)-0/i);
  return m && m[1] ? m[1] : "";
}

async function getImageSizesUrls(imageKey) {
  const key = String(imageKey || "").trim();
  if (!key) return {};
  const now = Date.now();
  const cached = __imgSizeCache.get(key);
  if (cached && now - cached.ts < __IMG_SIZE_TTL_MS) return cached.urls;

  try {
    // SmugMug ImageSizes endpoint
    const sizesData = await smug(
      `/image/${encodeURIComponent(key)}-0!sizes?_accept=application/json&_verbosity=1`
    );

    const sz =
      (sizesData && sizesData.Response && (sizesData.Response.ImageSizes || sizesData.Response.ImageSize)) ||
      sizesData?.Response ||
      {};

    // Pull any *Url fields we can find (SmugMug commonly returns these)
    const urls = {};
    for (const k of Object.keys(sz || {})) {
      if (/Url$/i.test(k) && typeof sz[k] === "string" && sz[k]) {
        urls[k] = sz[k];
      }
    }

    __imgSizeCache.set(key, { ts: now, urls });
    return urls;
  } catch (e) {
    // Cache negative result briefly to avoid hammering
    __imgSizeCache.set(key, { ts: now, urls: {} });
    return {};
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}


// =========================================================
// SHEETS → CSV
// =========================================================
app.get("/sheet/bands", async (req, res) => {
  try {
    const r = await fetch(BANDS_SHEET_URL);
    const csv = await r.text();
    allowCors(res);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /bands fetch failed:", err);
    allowCors(res);
    res.status(500).send("sheet error");
  }
});

app.get("/sheet/shows", async (req, res) => {
  // CORS already applied by global middleware, but keep explicit for clarity
  allowCors(res);

  // Help browsers/proxies not cache this CSV (we already have our own server cache)
  res.set("Cache-Control", "no-store");

  // Allow bypassing cache during testing:
  //   /sheet/shows?nocache=1
  const bypass = String(req.query.nocache || "") === "1";

  // If we have a fresh cache (last 10 minutes), serve it immediately.
  const now = Date.now();
  if (!bypass && __cache.showsCsv && now - __cache.showsFetchedAt < 10 * 60 * 1000) {
    res.set("X-Cache", "HIT");
    return res.type("text/plain").send(__cache.showsCsv);
  }
  try {
    // Fast timeout so the edge proxy never returns a 502 without CORS headers
    const out = await fetchTextWithTimeout(SHOWS_SHEET_URL, 8000);

    if (!out.ok) {
      console.error("sheet /shows upstream not ok:", out.status);
      // If we have any cache, serve stale instead of failing hard
      if (__cache.showsCsv) {
        res.set("X-Cache", "STALE");
        return res.type("text/plain").send(__cache.showsCsv);
      }
      return res.status(502).send("shows sheet upstream error");
    }

    __cache.showsCsv = out.text;
    __cache.showsFetchedAt = now;

    res.set("X-Cache", "MISS");
    return res.type("text/plain").send(out.text);
  } catch (err) {
    console.error("sheet /shows fetch failed:", err && err.message ? err.message : err);
    if (__cache.showsCsv) {
      res.set("X-Cache", "STALE");
      return res.type("text/plain").send(__cache.showsCsv);
    }
    return res.status(500).send("shows sheet error");
  }
});

// =========================================================
// IMAGE PROXY (posters)
// =========================================================
app.get("/show-poster", async (req, res) => {
  allowCors(res);
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

// =========================================================
// SMART FOLDER → ALBUMS
// =========================================================

// =========================================================
// ✔ RESOLVE ALBUM URL → AlbumKey (handles album-like URLs AND photo URLs)
// =========================================================
// Frontend calls: /smug/resolve-album?url=<smugmug-url>
// We attempt, in order:
//  1) Follow redirects and if final URL is a photo page, extract ImageKey and resolve → AlbumKey via Smug API
//  2) Otherwise, treat last path segment as album-ish leaf and try to find a matching album under parent folder.
app.get("/smug/resolve-album", async (req, res) => {
  allowCors(res);

  const rawUrl = String(req.query.url || "").trim();
  if (!rawUrl) return res.status(400).json({ error: "missing url" });

  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/%20/g, " ")
      .replace(/[+]/g, " ")
      .replace(/[_]/g, "-")
      .replace(/\s+/g, " ");
  }
  function normDash(s) {
    return norm(s).replace(/\s+/g, "-");
  }

  // Try to follow redirects (SmugMug often redirects album-ish URLs to /photos/i-<ImageKey>/...)
  let finalUrl = rawUrl;
  try {
    const r = await fetch(rawUrl, { redirect: "follow" });
    if (r && r.url) finalUrl = r.url;
  } catch (err) {
    // ignore redirect failures; we'll attempt other resolution methods
    console.log("resolve-album redirect check failed:", err.message);
  }

  // If final URL looks like a SmugMug photo URL, extract ImageKey and resolve Image → AlbumKey
  // Example: https://vmpix.smugmug.com/photos/i-DkRNfbM/0/Match-1  => ImageKey = DkRNfbM
  try {
    const u = new URL(finalUrl);
    const p = String(u.pathname || "");
    const m = p.match(/\/photos\/i-([A-Za-z0-9]+)\//i) || p.match(/\/i-([A-Za-z0-9]+)\//i);

    if (m && m[1]) {
      const imageKey = m[1];

      // Ask SmugMug for image details and expand ImageAlbum (the parent gallery)
      // smug() helper appends "&APIKey=..." so endpoint must include a query string before that.
      const imgData = await smug(
        `/image/${encodeURIComponent(imageKey)}-0?_accept=application/json&_verbosity=1&_expand=Image&_expand=Image.ImageAlbum`
      );

      const img = imgData && imgData.Response ? (imgData.Response.Image || imgData.Response.ImageDetail || imgData.Response) : null;

      // Try common locations for the ImageAlbum URI
      const albumUri =
        (img && img.ImageAlbum && img.ImageAlbum.Uri) ||
        (img && img.Uris && img.Uris.ImageAlbum && img.Uris.ImageAlbum.Uri) ||
        (imgData && imgData.Response && imgData.Response.ImageAlbum && imgData.Response.ImageAlbum.Uri) ||
        "";

      const uriStr = String(albumUri || "");
      const albumKeyFromUri = (uriStr.match(/\/album\/([A-Za-z0-9]+)/i) || [])[1];

      if (albumKeyFromUri) {
        return res.json({
          AlbumKey: albumKeyFromUri,
          albumKey: albumKeyFromUri,
          via: "image",
          imageKey,
          finalUrl
        });
      }

      // If we couldn't parse it, still return helpful debug info
      console.log("resolve-album: could not parse AlbumKey from image response", { imageKey, albumUri: uriStr });
    }
  } catch (err) {
    console.log("resolve-album imageKey path failed:", err.message);
  }

  // Fallback: treat as album-ish URL and try to match leaf segment under parent folder.
  let urlObj = null;
  try { urlObj = new URL(finalUrl); } catch (_) {}

  if (!urlObj) {
    return res.json({ AlbumKey: "", albumKey: "", info: "invalid url", finalUrl });
  }

  const parts = String(urlObj.pathname || "")
    .split("/")
    .filter(Boolean);

  if (parts.length < 2) {
    return res.json({ AlbumKey: "", albumKey: "", info: "url path too short", finalUrl });
  }

  const leaf = parts[parts.length - 1];
  const parentParts = parts.slice(0, parts.length - 1);

  const parentCandidates = [];
  for (let cut = parentParts.length; cut >= Math.max(1, parentParts.length - 2); cut--) {
    parentCandidates.push(parentParts.slice(0, cut));
  }

  const leafNorm = norm(leaf);
  const leafDash = normDash(leaf);

  const tried = [];

  for (const parent of parentCandidates) {
    const folderPath = parent.map(p => decodeURIComponent(p)).join("/");
    const apiPath = `/folder/user/vmpix/${folderPath}!albums?_accept=application/json`;

    tried.push(apiPath);

    try {
      const data = await smug(apiPath);
      const albums = data && data.Response && Array.isArray(data.Response.Album) ? data.Response.Album : [];

      let hit = null;
      for (const a of albums) {
        const urlName = norm(a.UrlName || a.Urlname || "");
        const name = norm(a.Name || "");
        const title = norm(a.Title || "");
        const key = String(a.AlbumKey || a.Key || "").trim();
        if (!key) continue;

        if (urlName === leafNorm || urlName === leafDash) { hit = a; break; }
        if (name === leafNorm || name === leafDash) { hit = a; break; }
        if (title === leafNorm || title === leafDash) { hit = a; break; }

        if (urlName && (urlName.indexOf(leafNorm) !== -1 || urlName.indexOf(leafDash) !== -1)) { hit = a; break; }
      }

      if (hit) {
        const k = String(hit.AlbumKey || hit.Key || "").trim();
        return res.json({
          AlbumKey: k,
          albumKey: k,
          via: "folder",
          finalUrl,
          _tried: tried
        });
      }
    } catch (err) {
      console.error("resolve-album error for", apiPath, err.message);
    }
  }

  return res.json({
    Response: { Album: [] },
    AlbumKey: "",
    albumKey: "",
    finalUrl,
    info: `No album resolved for url=${rawUrl} (finalUrl=${finalUrl}) (tried: ${tried.join(" | ")})`
  });
});


// =========================================================
// ✔ NEW: RESOLVE ALBUM URL → Shop NodeKey (for /shop?nodeKey=...)
// =========================================================
// Frontend calls: /smug/resolve-shop-node?url=<smugmug-album-or-photo-url>
// Returns: { nodeKey, albumKey, finalUrl, via }
// Notes:
// - SmugMug's /shop page expects a *NodeKey* (not always the same as AlbumKey).
// - We first reuse /smug/resolve-album to get AlbumKey, then fetch album details to extract NodeKey.
app.get("/smug/resolve-shop-node", async (req, res) => {
  allowCors(res);

  const rawUrl = String(req.query.url || "").trim();
  if (!rawUrl) return res.status(400).json({ error: "missing url" });

  // Reuse our existing resolver to get AlbumKey (keeps behavior consistent)
  let albumKey = "";
  let finalUrl = rawUrl;
  let via = "";
  try {
    const base = req.protocol + "://" + req.get("host");
    const r = await fetch(base + "/smug/resolve-album?url=" + encodeURIComponent(rawUrl), { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    albumKey = String(j?.albumKey || j?.AlbumKey || "").trim();
    finalUrl = String(j?.finalUrl || rawUrl);
    via = String(j?.via || "");
  } catch (e) {
    // If this fails, we still attempt a direct albumKey parse below (best-effort)
    console.log("resolve-shop-node: could not call resolve-album:", e && e.message ? e.message : e);
  }

  if (!albumKey) {
    return res.json({ nodeKey: "", albumKey: "", finalUrl, via: via || "none", info: "No AlbumKey resolved" });
  }

  // Fetch album details and try to extract a NodeKey (SmugMug shop uses nodeKey)
  try {
    const data = await smug(
      `/album/${encodeURIComponent(albumKey)}?_accept=application/json&_verbosity=1&_expand=Node&_expand=Uris`
    );

    const album = data?.Response?.Album || data?.Response || {};

    // Common locations for NodeKey
    let nodeKey =
      String(album?.NodeKey || "").trim() ||
      String(album?.Node?.NodeKey || "").trim() ||
      String(data?.Response?.NodeKey || "").trim() ||
      "";

    // Try parsing node URI from common places
    if (!nodeKey) {
      const uri =
        album?.Uris?.Node?.Uri ||
        album?.Uris?.ParentNode?.Uri ||
        album?.Node?.Uri ||
        "";
      const m = String(uri || "").match(/\/node\/([A-Za-z0-9]+)/i);
      if (m && m[1]) nodeKey = m[1];
    }

    // Last resort: regex scan the whole payload for a /node/<key> URI
    if (!nodeKey) {
      try {
        const blob = JSON.stringify(data || {});
        const m2 = blob.match(/\/node\/([A-Za-z0-9]+)/i);
        if (m2 && m2[1]) nodeKey = m2[1];
      } catch (_) {}
    }

    return res.json({
      nodeKey: nodeKey || "",
      albumKey,
      finalUrl,
      via: via || "album",
    });
  } catch (err) {
    console.error("resolve-shop-node failed:", err && err.message ? err.message : err);
    return res.status(500).json({ nodeKey: "", albumKey, finalUrl, via, error: "Failed to resolve nodeKey" });
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

  allowCors(res);

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
  )}!images?APIKey=${SMUG_API_KEY}&count=${count}&start=${start}&_accept=application/json&_verbosity=1&_expand=Image`;

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
      allowCors(res, req);
      return res.status(upstream.status).json({ error: "album images upstream error" });
    }

const data = await upstream.json();

// Enrich AlbumImage entries with downloadable URLs (Original/Largest/etc.)
// so the front-end ZIP builder can always find a usable URL.
try {
  const list = data && data.Response && Array.isArray(data.Response.AlbumImage) ? data.Response.AlbumImage : [];
  await mapWithConcurrency(list, 6, async (it) => {
    const img = it && it.Image ? it.Image : {};
    const imageKey = (img && img.ImageKey) || it.ImageKey || extractImageKeyFromUri(img && img.Uri) || "";
    if (!imageKey) return;
    const urls = await getImageSizesUrls(imageKey);

    // Flatten onto both AlbumImage and Image for maximum compatibility
    if (urls && typeof urls === "object") {
      Object.assign(it, urls);
      if (img && typeof img === "object") Object.assign(img, urls);
    }
  });
} catch (e) {
  // If enrichment fails, still return base payload for UI thumbnails.
  console.warn("album enrichment skipped:", e && e.message ? e.message : e);
}

res.set("Access-Control-Allow-Origin", "*");
return res.json(data);

  } catch (err) {
    console.error("album images proxy error:", err);
    allowCors(res, req);
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

    allowCors(res);
    return res.json(result);
  } catch (err) {
    console.error("Error fetching album metadata:", err);
    allowCors(res);
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

    allowCors(res);
    return res.json(data);
  } catch (err) {
    console.error("error fetching image detail:", err);
    allowCors(res);
    return res.status(500).json({ error: "image detail fetch failed" });
  }
});

// =========================================================
// SERVER START
// =========================================================
const PORT = process.env.PORT || 3000;


// ---------------- ZIP DOWNLOAD (optional, used by front-end Select -> Download ZIP) ----------------
// POST /zip { items: [{url, filename}] }
app.post("/zip", async (req, res) => {
  try {
    // Ensure ZIP responses include CORS headers (SmugMug-hosted pages call this endpoint)
    allowCors(res, req);

    if (!archiver) {
      return res.status(501).send("ZIP not available (missing dependency: archiver). Run: npm i archiver");
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).send("No items provided");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="photos.zip"');

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("archiver error", err);
      try { res.status(500).end(); } catch (_) {}
    });
    archive.pipe(res);

    for (const it of items) {
      const url = String(it?.url || "").trim();
      if (!url) continue;
      const filename = String(it?.filename || "photo.jpg").replace(/[\\/]+/g, "_");

      try {
        const r = await fetch(url, {
          headers: {
            // Some CDNs behave better with a UA; also keeps our upstream requests consistent.
            "User-Agent": "SmugProxy/1.0"
          }
        });
        if (!r.ok) {
          console.warn("zip fetch failed", r.status, url);
          continue;
        }

        // node-fetch/undici returns a Web ReadableStream. Archiver expects a Node stream or Buffer.
        const body = r.body;
        if (!body) {
          console.warn("zip fetch missing body", url);
          continue;
        }

        const nodeStream = (typeof Readable.fromWeb === "function" && typeof body.getReader === "function")
          ? Readable.fromWeb(body)
          : body;

        archive.append(nodeStream, { name: filename });
      } catch (e) {
        console.warn("zip fetch exception", url, e);
      }
    }

    await archive.finalize();
  } catch (e) {
    console.error("zip route failed", e);
    try { res.status(500).send("ZIP failed"); } catch (_) {}
  }
});
app.listen(PORT, () => {
  console.log("Server listening on http://localhost:" + PORT);
});
