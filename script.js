// ================== CONFIG ==================
const API_BASE = "https://wrestling-archive.onrender.com/";

// ================== DOM REFS ==================
const headerEl = document.querySelector("header");
const titleEl = document.getElementById("page-title");
const wrapEl = document.querySelector(".wrap");

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", () => {
  initHeader();
});

// ================== HEADER / TITLE ONLY ==================
function initHeader() {
  // Defensive: header might not exist yet
  if (!headerEl) return;

  // Clear anything injected by the Music version
  headerEl.innerHTML = "";

  // Build title
  const title = document.createElement("div");
  title.textContent = "The Wrestling Archives";
  title.style.fontSize = "20px";
  title.style.fontWeight = "600";
  title.style.letterSpacing = "0.04em";
  title.style.color = "#e2e8f0";

  // Optional right-side credit
  const credit = document.createElement("div");
  credit.textContent = "Voodoo Media";
  credit.style.fontSize = "12px";
  credit.style.opacity = "0.65";
  credit.style.marginLeft = "auto";

  // Header layout
  headerEl.style.display = "flex";
  headerEl.style.alignItems = "center";
  headerEl.style.gap = "14px";
  headerEl.style.padding = "12px 20px";

  headerEl.appendChild(title);
  headerEl.appendChild(credit);
}
