// ================== CONFIG ==================
const API_BASE = "https://wrestling-archive.onrender.com/";

// ================== DOM REFS ==================
const headerEl = document.querySelector("header");
const wrapEl = document.querySelector(".wrap");

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  initHeader();
  initInstructionLine(); // ✅ new
});

// ================== HEADER ONLY (CURRENT PHASE) ==================
function initHeader() {
  // Defensive guard
  if (!headerEl) return;

  // Clear anything static or leftover
  headerEl.innerHTML = "";

  // Header layout (matches screenshot)
  headerEl.style.display = "flex";
  headerEl.style.alignItems = "center";
  headerEl.style.justifyContent = "space-between";
  headerEl.style.padding = "12px 20px";
  headerEl.style.width = "100%";

  // Left: Title
  const title = document.createElement("div");
  title.textContent = "The Wrestling Archives";
  title.style.fontSize = "14px";
  title.style.fontWeight = "700";
  title.style.color = "#ffffff";

  // Right: Credit
  const credit = document.createElement("div");
  credit.textContent = "Voodoo Media";
  credit.style.fontSize = "11px";
  credit.style.opacity = "0.7";
  credit.style.color = "#ffffff";

  headerEl.appendChild(title);
  headerEl.appendChild(credit);
}

// ================== INSTRUCTION LINE (UNDER HEADER) ==================
function initInstructionLine() {
  const head = document.querySelector(".results-head");
  if (!head) return;

  // Clear anything already in there (safe because it's empty right now)
  head.innerHTML = "";

  const line = document.createElement("div");
  line.id = "crumbs"; // matches the ID used in the music version layout
  line.textContent = "NOTE: This is a work in progress, and some things will be missing for a bit. Bear with me as I get this coded.";
  line.style.fontSize = "15px";
  line.style.opacity = "0.85";
  line.style.textAlign = "center";
  line.style.marginTop = "6px";

  head.appendChild(line);
}