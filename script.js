// ================== CONFIG ==================
const API_BASE = "https://wrestling-archive.onrender.com/";

// ================== DOM REFS ==================
const headerEl = document.querySelector("header");

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  initHeader();
  buildShowsHeaderUI();
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

// ================== SHOWS HEADER UI (YEARS ONLY) ==================
function buildShowsHeaderUI() {
  clearResultsHead();
  setCrumbs("NOTE: This is a work in progress and by no means complete - keep checking back for more details.");

  const head = getResultsHead();
  if (!head) return;

  const yearRow = document.createElement("div");
  yearRow.id = "year-groups";
  yearRow.className = "letter-groups";

  // Years requested
  const years = [2025, 2024, 2023, 2022, 2021];

  years.forEach((year) => {
    const btn = document.createElement("button");
    btn.className = "letter-pill";
    btn.textContent = String(year);

    btn.addEventListener("click", () => {
      // toggle active state
      yearRow
        .querySelectorAll(".letter-pill")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });

    yearRow.appendChild(btn);
  });

  head.appendChild(yearRow);
}
