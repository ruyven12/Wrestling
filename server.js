console.log(">>> SERVER FILE VERSION: PATCHED-FULL-1 <<<");

const express = require("express");
const app = express();

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
function allowCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
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
  try {
    const r = await fetch(SHOWS_SHEET_URL);
    const csv = await r.text();
    allowCors(res);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /shows fetch failed:", err);
    allowCors(res);
    res.status(500).send("shows sheet error");
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
// ✔ NEW: RESOLVE ALBUM URL → AlbumKey
// =========================================================
// The Shows UI calls /smug/resolve-album?url=<smugmug-album-url>
// We try to resolve a web URL by listing albums in the inferred parent folder
// and matching the last path segment against Album.UrlName / Name / Title.
app.get("/smug/resolve-album", async (req, res) => {
  allowCors(res);

  const rawUrl = String(req.query.url || "").trim();
  if (!rawUrl) return res.status(400).json({ error: "missing url" });

  // Helpers
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

  let urlObj = null;
  try { urlObj = new URL(rawUrl); } catch (_) {}

  // If it's not a valid URL, bail soft with empty.
  if (!urlObj) {
    return res.json({ AlbumKey: "", albumKey: "", info: "invalid url" });
  }

  // Only attempt for vmpix.smugmug.com (or any smugmug domain) style URLs.
  const parts = String(urlObj.pathname || "")
    .split("/")
    .filter(Boolean);

  // Need at least 2 segments to have a parent folder and an album-ish leaf.
  if (parts.length < 2) {
    return res.json({ AlbumKey: "", albumKey: "", info: "url path too short" });
  }

  // Leaf is the album-ish name, parentPath are folders above it.
  const leaf = parts[parts.length - 1];
  const parentParts = parts.slice(0, parts.length - 1);

  // Try a few parent depths, because some URLs may include extra segments we don't want.
  // Example URL coming from posters inference:
  //   /Wrestling/Limitless/110825/Match-1
  // Parent folder: /Wrestling/Limitless/110825
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

      // Try match against common fields
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

        // Loose contains match (helps when leaf is "Match-1" but album title includes extra words)
        if (urlName && (urlName.indexOf(leafNorm) !== -1 || urlName.indexOf(leafDash) !== -1)) { hit = a; break; }
      }

      if (hit) {
        const k = String(hit.AlbumKey || hit.Key || "").trim();
        return res.json({
          AlbumKey: k,
          albumKey: k,
          Response: { Album: hit },
          _tried: tried
        });
      }
    } catch (err) {
      // continue trying other parent candidates
      console.error("resolve-album error for", apiPath, err.message);
    }
  }

  // Not found
  return res.json({
    Response: { Album: [] },
    AlbumKey: "",
    albumKey: "",
    info: `No album resolved for url=${rawUrl} (tried: ${tried.join(" | ")})`
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
app.listen(PORT, () => {
  console.log("Server listening on http://localhost:" + PORT);
});
