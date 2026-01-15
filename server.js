console.log(">>> SERVER FILE VERSION: ZIP+ALBUM SIZES + CORS (ARCHIVER DEP) <<<");

const express = require("express");
let archiver = null;
try { archiver = require("archiver"); } catch (e) { /* optional */ }
if (!archiver) { console.warn("WARNING: archiver not installed; /zip will return 501. Add it to dependencies."); }
const app = express();

// Parse JSON bodies (needed for POST /zip)
app.use(express.json({ limit: "10mb" }));

// Global CORS (so even early errors include headers)
app.use((req, res, next) => {
  allowCors(res, req);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});


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
  // Allow SmugMug-hosted pages to call this API (ZIP POST requires preflight)
  const origin = req && req.headers ? String(req.headers.origin || "") : "";
  const allowList = new Set([
    "https://vmpix.smugmug.com",
    "https://www.vmpix.smugmug.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);

  // Use explicit origin when possible (keeps browsers happy with preflight), otherwise fall back to "*"
  if (origin && allowList.has(origin)) {
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
// IMAGE SIZES HELPERS (for ZIP downloads)
// SmugMug album image listings often don't include full-size URLs.
// We fetch sizes per ImageKey and cache them in-memory.
// =========================================================
const __imgSizeCache = new Map(); // imageKey -> { ...Url fields }
async function getImageSizesUrls(imageKey) {
  const k = String(imageKey || "").trim();
  if (!k) return {};
  if (__imgSizeCache.has(k)) return __imgSizeCache.get(k);

  // Smug: /image/<key>-0!sizes
  // smug() appends &APIKey=..., so include a query string first.
  let data = null;
  try {
    data = await smug(`/image/${encodeURIComponent(k)}-0!sizes?_accept=application/json&_verbosity=1`);
  } catch (e) {
    // cache negative result to avoid repeated hits
    __imgSizeCache.set(k, {});
    return {};
  }

  const root = (data && data.Response) ? data.Response : data;

  // Pull any *Url string fields from the sizes response (robust against schema variation)
  const out = {};
  const seen = new Set();
  function visit(obj, depth) {
    if (!obj || typeof obj !== "object" || depth > 4) return;
    if (seen.has(obj)) return;
    seen.add(obj);

    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" && /Url$/i.test(key) && val) {
        out[key] = val;
      } else if (val && typeof val === "object") {
        visit(val, depth + 1);
      }
    }
  }
  visit(root, 0);

  __imgSizeCache.set(k, out);
  return out;
}

async function mapLimit(arr, limit, fn) {
  const a = Array.isArray(arr) ? arr : [];
  const out = new Array(a.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= a.length) return;
      out[idx] = await fn(a[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, a.length)) }, () => worker());
  await Promise.all(workers);
  return out;
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
  // CORS already applied by global middleware, but keep explicit for clarity
  allowCors(res, req);

  // If we have a fresh cache (last 10 minutes), serve it immediately.
  const now = Date.now();
  if (__cache.showsCsv && now - __cache.showsFetchedAt < 10 * 60 * 1000) {
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
  allowCors(res, req);

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

     // Enrich AlbumImage items with full-size URL fields (needed for ZIP downloads)
     try {
       const list =
         (data && data.Response && Array.isArray(data.Response.AlbumImage) && data.Response.AlbumImage) ||
         (data && data.Response && Array.isArray(data.Response.AlbumImages) && data.Response.AlbumImages) ||
         [];

       // Only fetch sizes if the listing doesn't already contain an obvious full-size url field.
       const needs = list.some((it) => {
         const top = it || {};
         const img = (it && it.Image) ? it.Image : {};
         return !(
           top.OriginalUrl || top.LargestImageUrl || top.X3LargeUrl || top.XLargeUrl || top.LargeUrl ||
           img.OriginalUrl || img.LargestImageUrl || img.X3LargeUrl || img.XLargeUrl || img.LargeUrl
         );
       });

       if (needs && list.length) {
         await mapLimit(list, 6, async (it) => {
           const img = (it && it.Image) ? it.Image : {};
           const imageKey = (img && img.ImageKey) || it.ImageKey || "";
           if (!imageKey) return it;

           const urls = await getImageSizesUrls(imageKey);

           // Flatten URL fields to BOTH the AlbumImage item and the embedded Image object
           for (const [k, v] of Object.entries(urls)) {
             if (v && !it[k]) it[k] = v;
             if (v && img && !img[k]) img[k] = v;
           }

           // Keep filename handy for ZIP naming if present
           if (img && img.FileName && !it.FileName) it.FileName = img.FileName;

           it.Image = img;
           return it;
         });
       }
     } catch (e) {
       console.warn("album enrich sizes failed:", e && e.message ? e.message : e);
     }

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

// =========================================================
// SERVER START
// =========================================================
const PORT = process.env.PORT || 3000;


// ---------------- ZIP DOWNLOAD (optional, used by front-end Select -> Download ZIP) ----------------
// POST /zip { items: [{url, filename}] }
app.post("/zip", async (req, res) => {
  try {
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
        const r = await fetch(url);
        if (!r.ok) {
          console.warn("zip fetch failed", r.status, url);
          continue;
        }
        archive.append(r.body, { name: filename });
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
