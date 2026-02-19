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
  // SmugMug endpoints can be passed with or without querystring.
  // IMPORTANT: APIKey must be appended with ? or & depending on whether a querystring exists.
  const ep = String(endpoint || "");
  const joiner = ep.includes("?") ? "&" : "?";
  const url = `https://api.smugmug.com/api/v2${ep}${joiner}APIKey=${SMUG_API_KEY}`;

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
// KEYWORD → ALBUMS (WRESTLING SCOPE)
// =========================================================
// Frontend calls:
//   GET  /smug/albums-by-keyword?keyword=<kw>
//   POST /smug/albums-by-keyword  { keyword: "<kw>" }
// Returns:
//   { albums: [{ albumKey, title, date, url, thumb }] }
//
// Notes:
// - Primary strategy: use SmugMug keyword endpoint to get album keys.
// - Fallback strategy: if keyword endpoint returns empty (or changes), scan the
//   shows CSV, build match album URLs, resolve AlbumKey, then check album keywords.

const __kwCache = new Map(); // key -> { ts:number, data:any }
const __KW_TTL_MS = 10 * 60 * 1000;

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function extractAlbumsFromKeywordResponse(payload) {
  const r = payload?.Response || {};
  const a = r.Album;
  if (Array.isArray(a)) return a;
  if (a) return [a];
  return [];
}

function urlLooksWrestling(url) {
  const u = String(url || "");
  return /\/Wrestling\//i.test(u);
}

async function fetchAlbumMetaSlim(albumKey) {
  const k = String(albumKey || "").trim();
  if (!k) return null;
  const data = await smug(`/album/${encodeURIComponent(k)}?_accept=application/json&_verbosity=1&_expand=Uris&_expand=KeywordArray&_expand=Keywords&_expand=HighlightImage`);
  const album = data?.Response?.Album || data?.Response || null;
  if (!album) return null;

  const webUri =
    pick(album, ["WebUri", "WebURL", "WebUrl", "Url"]) ||
    pick(album?.Uris?.WebUri, ["Uri"]) ||
    "";

  // Try to find a thumb quickly
  let thumb = "";
  const hi = album?.HighlightImage || album?.Uris?.HighlightImage || null;
  const hiUri = pick(hi, ["Uri"]) || "";
  if (hiUri) {
    try {
      const imageKey = extractImageKeyFromUri(hiUri);
      if (imageKey) {
        const sizes = await getImageSizesUrls(imageKey);
        thumb =
          pick(sizes, [
            "TinyImageUrl",
            "ThumbUrl",
            "ThumbnailUrl",
            "SmallImageUrl",
            "MediumImageUrl",
          ]) || "";
      }
    } catch (_) {}
  }

  // Keywords can appear in multiple shapes
  const kws = new Set();
  const ka = album?.KeywordArray;
  if (Array.isArray(ka)) {
    for (const it of ka) {
      if (!it) continue;
      const v = String(it.Name || it.Keyword || it.Value || it).trim();
      if (v) kws.add(v);
    }
  }
  const k2 = album?.Keywords;
  if (Array.isArray(k2)) {
    for (const it of k2) {
      const v = String(it?.Name || it?.Keyword || it?.Value || "").trim();
      if (v) kws.add(v);
    }
  }
  const ks = typeof album?.Keywords === "string" ? String(album.Keywords).trim() : "";
  if (ks && /,/.test(ks)) {
    ks.split(",").map(s => s.trim()).filter(Boolean).forEach(v => kws.add(v));
  }

  return {
    albumKey: k,
    title: String(pick(album, ["Title", "Name"]) || "").trim(),
    date: String(pick(album, ["Date", "LastUpdated", "Time"]) || "").trim(),
    url: String(webUri).trim(),
    thumb: String(thumb || "").trim(),
    _keywords: Array.from(kws),
  };
}

async function keywordAlbumsPrimary(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];

  const payload = await smug(`/keyword/${encodeURIComponent(kw)}!albums?_accept=application/json&_verbosity=1`);
  const albums = extractAlbumsFromKeywordResponse(payload);
  const keys = albums
    .map(a => String(a?.AlbumKey || a?.Key || "").trim())
    .filter(Boolean);

  const metas = await mapWithConcurrency(keys, 6, async (k) => {
    try {
      const m = await fetchAlbumMetaSlim(k);
      if (!m) return null;
      if (!urlLooksWrestling(m.url)) return null;
      return m;
    } catch (_) {
      return null;
    }
  });

  return metas.filter(Boolean);
}

// Fallback: scan the Shows CSV for match album URLs/paths.
async function keywordAlbumsFallbackScanCsv(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];

  // Fetch shows CSV (use existing cache if present)
  let csv = "";
  try {
    const now = Date.now();
    if (__cache.showsCsv && now - __cache.showsFetchedAt < 10 * 60 * 1000) {
      csv = __cache.showsCsv;
    } else {
      const out = await fetchTextWithTimeout(SHOWS_SHEET_URL, 10000);
      if (out.ok) {
        csv = out.text;
        __cache.showsCsv = out.text;
        __cache.showsFetchedAt = now;
      }
    }
  } catch (_) {}
  if (!csv) return [];

  // Minimal CSV parse (handles quoted commas)
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(cur); cur = ""; }
        else if (ch === '\n') {
          row.push(cur); cur = "";
          rows.push(row); row = [];
        } else if (ch !== '\r') cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h || "").trim());

  const urlFields = headers
    .map((h, idx) => ({ h, idx }))
    .filter(o => /_url$/i.test(o.h));

  const baseFields = headers
    .map((h, idx) => ({ h, idx }))
    .filter(o => /(show_.*url|show_url|event_url|album_url|folder_url|smugmug_url)/i.test(o.h));

  const urls = new Set();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Find a per-row base URL if present
    let baseUrl = "";
    for (const bf of baseFields) {
      const v = String(row[bf.idx] || "").trim();
      if (/^https?:\/\//i.test(v) && /smugmug\.com/i.test(v) && urlLooksWrestling(v)) {
        baseUrl = v.replace(/\/$/, "");
        break;
      }
    }

    for (const uf of urlFields) {
      const raw = String(row[uf.idx] || "").trim();
      if (!raw) continue;
      if (/^https?:\/\//i.test(raw)) {
        if (urlLooksWrestling(raw)) urls.add(raw);
      } else if (baseUrl && /^match-/i.test(raw)) {
        urls.add(`${baseUrl}/${raw}`);
      }
    }
  }

  const urlList = Array.from(urls);
  if (!urlList.length) return [];

  const target = kw.toLowerCase();
  const host = process.env.RENDER_EXTERNAL_URL ? String(process.env.RENDER_EXTERNAL_URL).replace(/\/$/, "") : "";
  if (!host) return [];

  const metas = await mapWithConcurrency(urlList, 4, async (u) => {
    try {
      const rr = await fetch(`${host}/smug/resolve-album?url=${encodeURIComponent(u)}`, { cache: "no-store" });
      const j = await rr.json().catch(() => ({}));
      const albumKey = String(j?.albumKey || j?.AlbumKey || "").trim();
      if (!albumKey) return null;
      const meta = await fetchAlbumMetaSlim(albumKey);
      if (!meta) return null;
      if (!urlLooksWrestling(meta.url)) return null;
      const has = (meta._keywords || []).some(k => String(k).toLowerCase() === target);
      if (!has) return null;
      return meta;
    } catch (_) {
      return null;
    }
  });

  return metas.filter(Boolean);
}

async function albumsByKeyword(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return [];
  const cacheKey = kw.toLowerCase();
  const now = Date.now();
  const cached = __kwCache.get(cacheKey);
  if (cached && now - cached.ts < __KW_TTL_MS) return cached.data;

  let data = [];
  try { data = await keywordAlbumsPrimary(kw); } catch (_) { data = []; }
  if (!data.length) {
    try { data = await keywordAlbumsFallbackScanCsv(kw); } catch (_) {}
  }

  const out = (data || []).map((m) => ({
    albumKey: String(m.albumKey || "").trim(),
    title: String(m.title || "").trim(),
    date: String(m.date || "").trim(),
    url: String(m.url || "").trim(),
    thumb: String(m.thumb || "").trim(),
  })).filter(a => a.albumKey || a.url);

  __kwCache.set(cacheKey, { ts: now, data: out });
  return out;
}

app.get("/smug/albums-by-keyword", async (req, res) => {
  allowCors(res, req);
  const keyword = String(req.query.keyword || "").trim();
  try {
    const albums = await albumsByKeyword(keyword);
    return res.json({ albums });
  } catch (e) {
    console.error("albums-by-keyword failed:", e && e.message ? e.message : e);
    return res.status(500).json({ albums: [], error: "albums-by-keyword failed" });
  }
});

app.post("/smug/albums-by-keyword", async (req, res) => {
  allowCors(res, req);
  const keyword = String(req.body?.keyword || "").trim();
  try {
    const albums = await albumsByKeyword(keyword);
    return res.json({ albums });
  } catch (e) {
    console.error("albums-by-keyword failed:", e && e.message ? e.message : e);
    return res.status(500).json({ albums: [], error: "albums-by-keyword failed" });
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
