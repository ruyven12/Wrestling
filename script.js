// ================== CONFIG ==================
const API_BASE = "https://wrestling-archive.onrender.com";
const SHOWS_ENDPOINT = `${API_BASE}/sheet/shows`;

// ================== STATE ==================
let SHOWS = [];
let YEARS = [];

// ================== DOM REFS ==================
const headerEl = document.querySelector("header");

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
  setCrumbs("Select a year from the list.");

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

      // placeholder for next step (show list/posters)
      setCrumbs(`Year selected: ${year}`);
      // next: buildShowsForYear(year)
    });

    row.appendChild(btn);
  });
}
