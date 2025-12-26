// ================== CONFIG ==================
const API_BASE = "https://wrestling-archive.onrender.com";
const SHOWS_ENDPOINT = `${API_BASE}/sheet/shows`;

// ================== STATE ==================
let SHOWS = [];
let YEARS = [];

// ================== DOM REFS ==================
const headerEl = document.querySelector("header");
const resultsEl = document.getElementById("results");

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", async () => {
  initHeader();
  buildShowsHeaderSkeleton(); // creates crumbs + empty year row

  // Load shows CSV → build year bubbles from real data
  SHOWS = await loadShowsFromCsv();
  YEARS = extractYearsFromShows(SHOWS);

  // Only show 2021–2025 (your request), in descending order
  const filtered = YEARS.filter((y) => y >= 2021 && y <= 2025).sort((a, b) => b - a);
  renderYearBubbles(filtered);
});

// ================== HEADER ONLY ==================
function initHeader() {
  if (!headerEl) return;

  headerEl.innerHTML = "";

  headerEl.style.display = "flex";
  headerEl.style.alignItems = "center";
  headerEl.style.justifyContent = "space-between";
  headerEl.style.padding = "12px 20px";
  headerEl.style.width = "100%";

  const title = document.createElement("div");
  title.textContent = "The Wrestling Archives";
  title.style.fontSize = "14px";
  title.style.fontWeight = "700";
  title.style.color = "#ffffff";

  const credit = document.createElement("div");
  credit.textContent = "Voodoo Media";
  credit.style.fontSize = "11px";
  credit.style.opacity = "0.7";
  credit.style.color = "#ffffff";

  headerEl.appendChild(title);
  headerEl.appendChild(credit);
}

// ================== RESULTS-HEAD HELPERS ==================
function getResultsHead() {
  return document.querySelector(".results-head");
}

function clearResultsHead() {
  const head = getResultsHead();
  if (!head) return;
  head.innerHTML = "";
}

function setCrumbs(text) {
  const head = getResultsHead();
  if (!head) return;

  let crumbs = document.getElementById("crumbs");
  if (!crumbs) {
    crumbs = document.createElement("div");
    crumbs.id = "crumbs";
    head.appendChild(crumbs);
  }

  crumbs.textContent = text;
  crumbs.style.fontSize = "15px";
  crumbs.style.opacity = "0.85";
  crumbs.style.textAlign = "center";
  crumbs.style.marginTop = "6px";
}

// Create the “Select a year…” line + a container where year bubbles will go
function buildShowsHeaderSkeleton() {
  clearResultsHead();
  setCrumbs("NOTE: This is a work in progress - bear with me as it gets coded.");

  const head = getResultsHead();
  if (!head) return;

  const yearRow = document.createElement("div");
  yearRow.id = "year-groups";
  yearRow.className = "letter-groups";
  head.appendChild(yearRow);
}

// ================== CSV PARSER (music-style) ==================
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
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

// ================== LOAD SHOWS FROM CSV ==================
async function loadShowsFromCsv() {
  try {
    const res = await fetch(SHOWS_ENDPOINT);
    const text = await res.text();
    if (!text.trim()) return [];

    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    const headerLine = lines.shift();
    const header = parseCsvLine(headerLine);
    const headerLower = header.map((h) => h.trim().toLowerCase());

    // Try to find date column like music version does
    const dateIdx =
      headerLower.indexOf("show_date") !== -1
        ? headerLower.indexOf("show_date")
        : headerLower.indexOf("date");

    const rows = [];

    lines.forEach((line) => {
      const cols = parseCsvLine(line);

      // Keep the whole row as key/value, but we only NEED date right now
      const row = {};
      header.forEach((colName, i) => {
        row[colName.trim().toLowerCase()] = (cols[i] || "").trim();
      });

      // Normalize a common "date" field
      row.date =
        dateIdx !== -1 ? (cols[dateIdx] || "").trim() : (row.show_date || row.date || "");

      rows.push(row);
    });

    return rows;
  } catch (err) {
    console.error("Error loading shows CSV:", err);
    setCrumbs("Error loading shows data.");
    return [];
  }
}

// ================== YEARS FROM SHOWS ==================
function yearFromDateString(raw) {
  // Expect "MM/DD/YY" or "MM/DD/YYYY" (same as music script assumptions)
  if (!raw) return null;
  const parts = raw.split("/");
  if (parts.length !== 3) return null;

  let y = (parts[2] || "").trim();
  if (!y) return null;

  // "25" -> 2025
  if (y.length === 2) y = "20" + y;

  const yr = Number(y);
  return Number.isFinite(yr) ? yr : null;
}

function extractYearsFromShows(shows) {
  const set = new Set();
  (shows || []).forEach((s) => {
    const yr = yearFromDateString(s.date || s.show_date || "");
    if (yr) set.add(yr);
  });
  return Array.from(set);
}

// ================== RESULTS RENDERING ==================
function getShowsForYear(year) {
  const yr = Number(year);
  return (SHOWS || []).filter((row) => {
    const raw = (row.show_date || row.date || "").trim();
    const y = yearFromDateString(raw);
    return y === yr;
  });
}

function clearResults() {
  if (!resultsEl) return;
  resultsEl.innerHTML = "";
  // When showing a table, don't force the card grid layout
  resultsEl.style.display = "block";
}

function formatPrettyDate(raw) {
  if (!raw) return "";

  // Expect MM/DD/YY or MM/DD/YYYY
  const parts = raw.split("/");
  if (parts.length !== 3) return raw;

  let [m, d, y] = parts.map((p) => p.trim());
  if (!m || !d || !y) return raw;

  // Normalize year
  if (y.length === 2) y = "20" + y;
  const year = Number(y);
  const month = Number(m) - 1;
  const day = Number(d);

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return raw;

  const monthName = date.toLocaleString("en-US", { month: "long" });

  // Ordinal suffix
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";

  return `${monthName} ${day}${suffix}, ${year}`;
}

function renderShowsCards(rows) {
  clearResults();
  if (!resultsEl) return;

  if (!rows || rows.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No shows found for this year.";
    msg.style.opacity = "0.8";
    msg.style.textAlign = "center";
    msg.style.padding = "18px";
    resultsEl.appendChild(msg);
    return;
  }

  resultsEl.style.display = "grid";
  resultsEl.style.gridTemplateColumns = "repeat(auto-fit, minmax(420px, 1fr))";
  resultsEl.style.gap = "16px";
  resultsEl.style.width = "100%";
  resultsEl.style.maxWidth = "1200px";
  resultsEl.style.margin = "0 auto";

  rows.forEach((r) => {
    const title = (r.show_name || r.title || "").trim();
    const rawDate = (r.show_date || r.date || "").trim();
    const city = (r.show_city || r.city || "").trim();
    const state = (r.show_state || r.state || "").trim();
    const venue = (r.show_venue || r.venue || "").trim();
    const posterUrl = (r.show_poster || r.poster_url || "").trim();

    const card = document.createElement("article");
    card.style.display = "grid";
    card.style.gridTemplateColumns = "120px 1fr";
    card.style.gap = "14px";
    card.style.alignItems = "center";
    card.style.padding = "12px 14px";
    card.style.borderRadius = "12px";
    card.style.background = "rgba(15, 23, 42, 0.25)";
    card.style.border = "1px solid rgba(255,255,255,0.08)";

    const posterBox = document.createElement("div");
    posterBox.style.width = "110px";
    posterBox.style.height = "110px";
    posterBox.style.borderRadius = "10px";
    posterBox.style.overflow = "hidden";
    posterBox.style.background = "rgba(0,0,0,0.35)";
    posterBox.style.border = "1px solid rgba(255,255,255,0.10)";
    posterBox.style.display = "flex";
    posterBox.style.alignItems = "center";
    posterBox.style.justifyContent = "center";

    if (posterUrl) {
      const img = document.createElement("img");
      img.src = `${API_BASE}/show-poster?url=${encodeURIComponent(posterUrl)}`;
      img.alt = title || "poster";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      posterBox.appendChild(img);
    }

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.gap = "6px";

    const company = (r.company || "").trim();
    let companyText = "";
    if (company) companyText = company;

    const companyEl = document.createElement("div");
    companyEl.textContent = companyText;
    companyEl.style.fontSize = "13px";
    companyEl.style.fontWeight = "600";
    companyEl.style.color = "rgba(200,0,0,0.95)";

    const titleEl = document.createElement("div");
    titleEl.textContent = title || "(Untitled show)";
    titleEl.style.fontSize = "18px";
    titleEl.style.fontWeight = "700";

    const dateEl = document.createElement("div");
    dateEl.textContent = formatPrettyDate(rawDate);
    dateEl.style.fontSize = "12px";

    if (companyText) right.appendChild(companyEl);
    right.appendChild(titleEl);
    if (rawDate) right.appendChild(dateEl);

    const details = document.createElement("div");
    details.style.gridColumn = "1 / -1";
    details.style.maxHeight = "0px";
    details.style.overflow = "hidden";
    details.style.transition = "max-height 0.3s ease";

    function buildPartsWrap(row) {
      const wrap = document.createElement("div");

      // Single-column stacked list (instead of tile grid)
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "8px";
      wrap.style.padding = "10px 0";

      let any = false;

      for (let i = 1; i <= 10; i++) {
        const type = (row[`part_${i}_type`] || "").trim();
        const stip = (row[`part_${i}_stip`] || "").trim();
        const title = (row[`part_${i}_title`] || "").trim();
        const people = (row[`part_${i}_people`] || "").trim();

        if (!type && !stip && !title && !people) continue;
        any = true;

        const box = document.createElement("div");

        // Row-style match display
        box.style.display = "flex";
        box.style.flexDirection = "column";
        box.style.padding = "10px 14px";
        box.style.borderRadius = "10px";
        box.style.border = "1px solid rgba(255,255,255,0.08)";
        box.style.background = "rgba(15, 23, 42, 0.22)";
        box.style.transition = "background 0.15s ease";

        // Optional hover polish
        box.addEventListener("mouseenter", () => {
          box.style.background = "rgba(30, 41, 59, 0.35)";
        });
        box.addEventListener("mouseleave", () => {
          box.style.background = "rgba(15, 23, 42, 0.22)";
        });

        const head = document.createElement("div");
        head.style.fontWeight = "800";
        head.style.fontSize = "14px";
        head.style.marginBottom = "4px";

        // Header label priority:
        // 1) If there's a part title (e.g., "Limitless Championship"), use that as the label
        // 2) Else, if there's a stip (e.g., "Hardcore"), use "<stip> Match"
        // 3) Else fall back to the type (e.g., "Singles Match")
        const headerLabel = title
          ? `${title} Match`
          : stip
          ? `${stip} Match`
          : type;

        head.textContent = headerLabel;

        box.appendChild(head);

        const lines = [];
        // Keep the body focused on the participants/details.
        if (people) lines.push(people);

        if (lines.length) {
          const body = document.createElement("div");
          body.textContent = lines.join("\n");
          body.style.fontSize = "13px";
          body.style.opacity = "0.9";
          box.appendChild(body);
        }

        wrap.appendChild(box);
      }

      if (!any) {
        const none = document.createElement("div");
        none.textContent = "No match info yet.";
        wrap.appendChild(none);
      }

      return wrap;
    }

    posterBox.addEventListener("click", () => {
      const open = details.classList.toggle("open");
      if (!open) {
        details.style.maxHeight = "0px";
        return;
      }
      details.innerHTML = "";
      const wrap = buildPartsWrap(r);
      details.appendChild(wrap);
      requestAnimationFrame(() => {
        details.style.maxHeight = wrap.offsetHeight + 32 + "px";
      });
    });

    card.appendChild(posterBox);
    card.appendChild(right);
    card.appendChild(details);
    resultsEl.appendChild(card);
  });
}

// ================== RENDER YEAR BUBBLES ==================
function renderYearBubbles(years) {
  const row = document.getElementById("year-groups");
  if (!row) return;

  row.innerHTML = "";

  // If nothing found, keep UI but show message
  if (!years || years.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No years found in the shows sheet.";
    msg.style.opacity = "0.7";
    msg.style.fontSize = "13px";
    msg.style.textAlign = "center";
    msg.style.width = "100%";
    row.appendChild(msg);
    return;
  }

  years.forEach((year) => {
    const btn = document.createElement("button");
    btn.className = "letter-pill";
    btn.textContent = String(year);

    btn.addEventListener("click", () => {
      row.querySelectorAll(".letter-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update the instruction line + show the data below
      setCrumbs(`Shows for ${year}`);
      const rows = getShowsForYear(year);
      renderShowsCards(rows);
    });

    row.appendChild(btn);
  });
}
