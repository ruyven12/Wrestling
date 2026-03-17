console.log(">>> SERVER FILE VERSION: PATCHED-FULL-2 (WRESTLING SHOWS + CORS FIX) <<<");

const express = require("express");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const crypto = require("crypto");
const app = express();

const ANALYTICS_DIR = path.join(__dirname, "data");
const ANALYTICS_EVENTS_FILE = path.join(ANALYTICS_DIR, "analytics-events.ndjson");


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










