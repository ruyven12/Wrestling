console.log(">>> SERVER FILE VERSION: PATCHED-FULL-2 (WRESTLING SHOWS + CORS FIX) <<<");

const SERVER_BUILD_TAG = "facebook-pages-connect-v3";

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
const FACEBOOK_CONNECTION_FILE = path.join(ANALYTICS_DIR, "facebook-page-connection.json");
const FACEBOOK_PUBLISH_HISTORY_FILE = path.join(ANALYTICS_DIR, "facebook-publish-history.ndjson");
const FACEBOOK_PAGE_NAME_TARGET = String(process.env.FACEBOOK_PAGE_NAME_TARGET || "Voodoo Media").trim();
const FACEBOOK_PAGE_ID_TARGET = String(process.env.FACEBOOK_PAGE_ID_TARGET || "766767130020404").trim();
const META_APP_ID = String(process.env.META_APP_ID || "").trim();
const META_APP_SECRET = String(process.env.META_APP_SECRET || "").trim();
const META_REDIRECT_URI = String(
  process.env.META_REDIRECT_URI || "https://wrestling-archive.onrender.com/admin/facebook/connect/callback"
).trim();
const META_GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v22.0").trim();
const META_OAUTH_STATE_SECRET = String(process.env.META_OAUTH_STATE_SECRET || "vm-meta-oauth-dev-secret").trim();
const META_OAUTH_SUCCESS_REDIRECT = String(process.env.META_OAUTH_SUCCESS_REDIRECT || "https://vmpix.onrender.com/admin").trim();
const META_OAUTH_ERROR_REDIRECT = String(process.env.META_OAUTH_ERROR_REDIRECT || "https://vmpix.onrender.com/admin").trim();

function _facebookRequestedScopes() {
  return [
    "pages_show_list",
    "pages_manage_posts",
    "pages_read_engagement",
    "business_management"
  ];
}

function _defaultFacebookConnectionRecord() {
  return {
    connected: false,
    page: {
      id: "",
      name: ""
    },
    page_access_token: "",
    user_access_token: "",
    user_token_expires_at: null,
    token_status: "not_connected",
    last_checked_at: null,
    last_publish_at: null,
    last_available_pages: [],
    last_error: "",
    scopes: [],
    granted_scopes: [],
    declined_scopes: [],
    debug_user: null,
    updated_at: null
  };
}

function _toPublicFacebookConnectionState(record) {
  const src = record && typeof record === "object" ? record : _defaultFacebookConnectionRecord();
  const page = src.page && typeof src.page === "object" ? src.page : {};
  return {
    connected: !!src.connected,
    page: {
      id: _safeString(page.id, 120),
      name: _safeString(page.name, 160)
    },
      token_status: _safeString(src.token_status, 48) || "not_connected",
      last_checked_at: _safeString(src.last_checked_at, 80) || null,
      last_publish_at: _safeString(src.last_publish_at, 80) || null,
      user_token_expires_at: _safeString(src.user_token_expires_at, 80) || null,
      last_available_pages: Array.isArray(src.last_available_pages) ? src.last_available_pages.map((item) => ({
        id: _safeString(item && item.id, 120),
        name: _safeString(item && item.name, 160),
        tasks: Array.isArray(item && item.tasks) ? item.tasks.map((task) => _safeString(task, 80)).filter(Boolean) : []
      })) : [],
      last_error: _safeString(src.last_error, 500) || "",
      scopes: Array.isArray(src.scopes) ? src.scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
      granted_scopes: Array.isArray(src.granted_scopes) ? src.granted_scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
      declined_scopes: Array.isArray(src.declined_scopes) ? src.declined_scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
      debug_user: src.debug_user && typeof src.debug_user === "object" ? {
        id: _safeString(src.debug_user.id, 120),
        name: _safeString(src.debug_user.name, 160)
      } : null,
      updated_at: _safeString(src.updated_at, 80) || null
    };
}

function _readFacebookConnectionRecord() {
  try {
    if (!fs.existsSync(FACEBOOK_CONNECTION_FILE)) return _defaultFacebookConnectionRecord();
    const raw = fs.readFileSync(FACEBOOK_CONNECTION_FILE, "utf8");
    if (!raw.trim()) return _defaultFacebookConnectionRecord();
    const parsed = JSON.parse(raw);
    const base = _defaultFacebookConnectionRecord();
    const page = parsed && parsed.page && typeof parsed.page === "object" ? parsed.page : {};
    const scopes = Array.isArray(parsed && parsed.scopes) ? parsed.scopes : [];
    return {
      connected: !!parsed.connected,
      page: {
        id: _safeString(page.id, 120),
        name: _safeString(page.name, 160)
      },
      page_access_token: _safeString(parsed.page_access_token, 2000),
      user_access_token: _safeString(parsed.user_access_token, 2000),
      user_token_expires_at: _safeString(parsed.user_token_expires_at, 80) || null,
      token_status: _safeString(parsed.token_status, 48) || base.token_status,
      last_checked_at: _safeString(parsed.last_checked_at, 80) || null,
      last_publish_at: _safeString(parsed.last_publish_at, 80) || null,
      last_available_pages: Array.isArray(parsed.last_available_pages) ? parsed.last_available_pages.map((item) => ({
        id: _safeString(item && item.id, 120),
        name: _safeString(item && item.name, 160),
        tasks: Array.isArray(item && item.tasks) ? item.tasks.map((task) => _safeString(task, 80)).filter(Boolean) : []
      })) : [],
      last_error: _safeString(parsed.last_error, 500) || "",
      scopes: scopes.map((scope) => _safeString(scope, 80)).filter(Boolean),
      granted_scopes: Array.isArray(parsed.granted_scopes) ? parsed.granted_scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
      declined_scopes: Array.isArray(parsed.declined_scopes) ? parsed.declined_scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
      debug_user: parsed.debug_user && typeof parsed.debug_user === "object" ? {
        id: _safeString(parsed.debug_user.id, 120),
        name: _safeString(parsed.debug_user.name, 160)
      } : null,
      updated_at: _safeString(parsed.updated_at, 80) || null
    };
  } catch (err) {
    console.error("facebook connection state read failed:", err);
    return _defaultFacebookConnectionRecord();
  }
}

function _writeFacebookConnectionState(nextState) {
  const base = _defaultFacebookConnectionRecord();
  const next = nextState && typeof nextState === "object" ? nextState : {};
  const payload = {
    connected: !!next.connected,
    page: {
      id: _safeString(next.page && next.page.id, 120),
      name: _safeString(next.page && next.page.name, 160)
    },
    page_access_token: _safeString(next.page_access_token, 2000),
    user_access_token: _safeString(next.user_access_token, 2000),
    user_token_expires_at: _safeString(next.user_token_expires_at, 80) || null,
    token_status: _safeString(next.token_status, 48) || base.token_status,
    last_checked_at: _safeString(next.last_checked_at, 80) || null,
    last_publish_at: _safeString(next.last_publish_at, 80) || null,
    last_available_pages: Array.isArray(next.last_available_pages) ? next.last_available_pages.map((item) => ({
      id: _safeString(item && item.id, 120),
      name: _safeString(item && item.name, 160),
      tasks: Array.isArray(item && item.tasks) ? item.tasks.map((task) => _safeString(task, 80)).filter(Boolean) : []
    })) : [],
    last_error: _safeString(next.last_error, 500) || "",
    scopes: Array.isArray(next.scopes) ? next.scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
    granted_scopes: Array.isArray(next.granted_scopes) ? next.granted_scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
    declined_scopes: Array.isArray(next.declined_scopes) ? next.declined_scopes.map((scope) => _safeString(scope, 80)).filter(Boolean) : [],
    debug_user: next.debug_user && typeof next.debug_user === "object" ? {
      id: _safeString(next.debug_user.id, 120),
      name: _safeString(next.debug_user.name, 160)
    } : null,
    updated_at: new Date().toISOString()
  };
  try {
    _ensureAnalyticsDir();
    fs.writeFileSync(FACEBOOK_CONNECTION_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.error("facebook connection state write failed:", err);
    throw err;
  }
  return payload;
}

function _facebookConfigSummary() {
  return {
    page_target: FACEBOOK_PAGE_NAME_TARGET,
    page_id_target: FACEBOOK_PAGE_ID_TARGET || null,
    app_id_configured: !!META_APP_ID,
    app_secret_configured: !!META_APP_SECRET,
    redirect_uri_configured: !!META_REDIRECT_URI,
    oauth_success_redirect_configured: !!META_OAUTH_SUCCESS_REDIRECT,
    oauth_error_redirect_configured: !!META_OAUTH_ERROR_REDIRECT,
    graph_version: META_GRAPH_VERSION || null,
    connect_ready: !!(META_APP_ID && META_APP_SECRET && META_REDIRECT_URI)
  };
}

function _base64UrlEncode(input) {
  return Buffer.from(String(input || ""), "utf8").toString("base64url");
}

function _base64UrlDecode(input) {
  return Buffer.from(String(input || ""), "base64url").toString("utf8");
}

function _createFacebookOauthState(payload) {
  const encoded = _base64UrlEncode(JSON.stringify(payload || {}));
  const sig = crypto.createHmac("sha256", META_OAUTH_STATE_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function _verifyFacebookOauthState(rawState) {
  const raw = String(rawState || "").trim();
  if (!raw || raw.indexOf(".") === -1) return null;
  const parts = raw.split(".");
  const encoded = parts[0] || "";
  const sig = parts[1] || "";
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac("sha256", META_OAUTH_STATE_SECRET).update(encoded).digest("base64url");
  if (!_adminSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(_base64UrlDecode(encoded));
    const issuedAt = Number(payload && payload.iat || 0);
    if (!issuedAt || (Date.now() - issuedAt) > (15 * 60 * 1000)) return null;
    return payload && typeof payload === "object" ? payload : null;
  } catch (_) {
    return null;
  }
}

function _facebookGraphBase() {
  return `https://graph.facebook.com/${META_GRAPH_VERSION}`;
}

function _facebookDialogBase() {
  return "https://www.facebook.com/dialog/oauth";
}

async function _facebookJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await r.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : {};
  } catch (_) {
    data = body;
  }
  if (!r.ok) {
    const msg = typeof data === "object" && data && data.error && data.error.message
      ? data.error.message
      : (typeof data === "string" ? data : `HTTP ${r.status}`);
    throw new Error(`facebook request failed: ${msg}`);
  }
  return data;
}

async function _exchangeFacebookCodeForUserToken(code) {
  const url = new URL(`${_facebookGraphBase()}/oauth/access_token`);
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("code", String(code || "").trim());
  return _facebookJson(url.toString());
}

async function _exchangeForLongLivedUserToken(shortLivedToken) {
  const url = new URL(`${_facebookGraphBase()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("client_secret", META_APP_SECRET);
  url.searchParams.set("fb_exchange_token", String(shortLivedToken || "").trim());
  return _facebookJson(url.toString());
}

async function _fetchFacebookManagedPages(userAccessToken) {
  const url = new URL(`${_facebookGraphBase()}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,tasks");
  url.searchParams.set("access_token", String(userAccessToken || "").trim());
  const data = await _facebookJson(url.toString());
  return Array.isArray(data && data.data) ? data.data : [];
}

async function _fetchFacebookPageById(userAccessToken, pageId) {
  const id = _safeString(pageId, 120);
  if (!id) return null;
  const url = new URL(`${_facebookGraphBase()}/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "id,name,access_token,tasks");
  url.searchParams.set("access_token", String(userAccessToken || "").trim());
  const data = await _facebookJson(url.toString());
  return data && typeof data === "object" ? data : null;
}

async function _facebookSearchPages(userAccessToken, query) {
  const token = _safeString(userAccessToken, 2000);
  const q = _safeString(query, 120);
  if (!token || !q) return [];
  const qLower = q.toLowerCase();
  const seen = new Map();
  const endpoints = [
    (() => {
      const url = new URL(`${_facebookGraphBase()}/search`);
      url.searchParams.set("type", "page");
      url.searchParams.set("q", q);
      url.searchParams.set("fields", "id,name,category");
      url.searchParams.set("limit", "8");
      url.searchParams.set("access_token", token);
      return url.toString();
    })(),
    (() => {
      const url = new URL(`${_facebookGraphBase()}/pages/search`);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "8");
      url.searchParams.set("access_token", token);
      return url.toString();
    })()
  ];

  for (let i = 0; i < endpoints.length; i++) {
    try {
      const data = await _facebookJson(endpoints[i]);
      const items = Array.isArray(data && data.data) ? data.data : [];
      items.forEach((item) => {
        const id = _safeString(item && item.id, 120);
        const name = _safeString(item && item.name, 200);
        const category = _safeString(item && item.category, 120);
        if (name.toLowerCase().indexOf(qLower) < 0) return;
        if (!id || !name || seen.has(id)) return;
        seen.set(id, {
          id,
          page_id: id,
          name,
          label: name,
          subtitle: category || "Facebook Page",
          handle: ""
        });
      });
      if (seen.size) break;
    } catch (_) {}
  }

  try {
    const managed = await _fetchFacebookManagedPages(token);
    managed.forEach((item) => {
      const id = _safeString(item && item.id, 120);
      const name = _safeString(item && item.name, 200);
      if (!id || !name) return;
      if (name.toLowerCase().indexOf(qLower) < 0) return;
      if (seen.has(id)) return;
      seen.set(id, {
        id,
        page_id: id,
        name,
        label: name,
        subtitle: "Managed Page",
        handle: ""
      });
    });
  } catch (_) {}

  return Array.from(seen.values()).slice(0, 8);
}

async function _fetchFacebookGrantedScopes(userAccessToken) {
  const url = new URL(`${_facebookGraphBase()}/me/permissions`);
  url.searchParams.set("access_token", String(userAccessToken || "").trim());
  const data = await _facebookJson(url.toString());
  const granted = [];
  const declined = [];
  (Array.isArray(data && data.data) ? data.data : []).forEach((item) => {
    const permission = _safeString(item && item.permission, 80);
    const status = _safeString(item && item.status, 40).toLowerCase();
    if (!permission) return;
    if (status === "granted") granted.push(permission);
    else if (status === "declined") declined.push(permission);
  });
  return { granted, declined };
}

async function _fetchFacebookUserProfile(userAccessToken) {
  const url = new URL(`${_facebookGraphBase()}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", String(userAccessToken || "").trim());
  return _facebookJson(url.toString());
}

async function _fetchFacebookLiveDebug(userAccessToken) {
  const token = String(userAccessToken || "").trim();
  if (!token) {
    return {
      user: null,
      accounts: [],
      granted: [],
      declined: [],
      errors: ["missing user token"]
    };
  }

  const out = {
    user: null,
    accounts: [],
    granted: [],
    declined: [],
    errors: []
  };

  try {
    const user = await _fetchFacebookUserProfile(token);
    out.user = {
      id: _safeString(user && user.id, 120),
      name: _safeString(user && user.name, 160)
    };
  } catch (err) {
    out.errors.push(`me: ${err && err.message ? err.message : String(err || "unknown error")}`);
  }

  try {
    const pages = await _fetchFacebookManagedPages(token);
    out.accounts = _facebookPageSummaries(pages);
  } catch (err) {
    out.errors.push(`me/accounts: ${err && err.message ? err.message : String(err || "unknown error")}`);
  }

  try {
    const scopes = await _fetchFacebookGrantedScopes(token);
    out.granted = Array.isArray(scopes && scopes.granted) ? scopes.granted : [];
    out.declined = Array.isArray(scopes && scopes.declined) ? scopes.declined : [];
  } catch (err) {
    out.errors.push(`me/permissions: ${err && err.message ? err.message : String(err || "unknown error")}`);
  }

  return out;
}

function _findTargetFacebookPage(pages) {
  const items = Array.isArray(pages) ? pages : [];
  const target = String(FACEBOOK_PAGE_NAME_TARGET || "").trim().toLowerCase();
  const targetId = String(FACEBOOK_PAGE_ID_TARGET || "").trim();
  if (!items.length) return null;
  if (targetId) {
    const byId = items.find((page) => _safeString(page && page.id, 120) === targetId);
    if (byId) return byId;
  }
  if (!target) return items[0] || null;
  let exact = null;
  let contains = null;
  let normalizedExact = null;
  let normalizedContains = null;
  const norm = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const targetNorm = norm(target);
  items.forEach((page) => {
    const name = String(page && page.name || "").trim().toLowerCase();
    if (!exact && name === target) exact = page;
    if (!contains && name && name.indexOf(target) >= 0) contains = page;
    const normalized = norm(name);
    if (!normalizedExact && normalized && targetNorm && normalized === targetNorm) normalizedExact = page;
    if (!normalizedContains && normalized && targetNorm && normalized.indexOf(targetNorm) >= 0) normalizedContains = page;
  });
  if (exact || contains || normalizedExact || normalizedContains) {
    return exact || contains || normalizedExact || normalizedContains || null;
  }
  if (items.length === 1) return items[0];
  return null;
}

function _facebookPageSummaries(pages) {
  return (Array.isArray(pages) ? pages : []).map((page) => ({
    id: _safeString(page && page.id, 120),
    name: _safeString(page && page.name, 160),
    tasks: Array.isArray(page && page.tasks) ? page.tasks.map((task) => _safeString(task, 80)).filter(Boolean) : []
  }));
}

function _facebookDebugEnabled() {
  return String(process.env.FACEBOOK_DEBUG_MODE || "").trim() === "1";
}

function _buildFacebookOauthAuthorizeUrl(returnTo) {
  const state = _createFacebookOauthState({
    iat: Date.now(),
    return_to: _safeString(returnTo, 500) || META_OAUTH_SUCCESS_REDIRECT || "",
    page_target: FACEBOOK_PAGE_NAME_TARGET,
    scopes: _facebookRequestedScopes()
  });
  const url = new URL(_facebookDialogBase());
  url.searchParams.set("client_id", META_APP_ID);
  url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", _facebookRequestedScopes().join(","));
  return { url: url.toString(), state };
}

function _appendQueryParams(baseUrl, params) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value == null || value === "") return;
      u.searchParams.set(key, String(value));
    });
    return u.toString();
  } catch (_) {
    return raw;
  }
}

function _isHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function _normalizeFacebookDraft(input) {
  const body = input && typeof input === "object" ? input : {};
  const section = _safeString(body.section, 32).toLowerCase();
  const entityType = _safeString(body.entity_type, 32).toLowerCase() || "show";
  const entityId = _safeString(body.entity_id, 160);
  const entityLabel = _safeString(body.entity_label, 240);
  const caption = _safeString(body.caption, 5000);
  const linkUrl = _safeString(body.link_url, 2000);
  const imageUrl = _safeString(body.image_url, 2000);
  const meta = _safeMeta(body.meta);
  const errors = [];
  const isNormalPost = entityType === "normal_post";

  if (!section) errors.push("section is required");
  if (!entityType) errors.push("entity_type is required");
  if (!entityId) errors.push("entity_id is required");
  if (!entityLabel) errors.push("entity_label is required");
  if (!caption) errors.push("caption is required");
  if (linkUrl && !_isHttpUrl(linkUrl)) errors.push("link_url must be a valid http(s) URL");
  if (!isNormalPost && (!imageUrl || !_isHttpUrl(imageUrl))) errors.push("image_url must be a valid http(s) URL");

  const finalMessage = [caption, linkUrl].filter(Boolean).join("\n\n").trim();
  if (!finalMessage) errors.push("final publish message is empty");

  return {
    ok: errors.length === 0,
    errors,
    draft: {
      section,
      entity_type: entityType,
      entity_id: entityId,
      entity_label: entityLabel,
      caption,
      link_url: linkUrl,
      image_url: imageUrl,
      final_message: finalMessage,
      meta,
      post_kind: isNormalPost ? "feed" : "photo"
    }
  };
}
function _appendFacebookPublishHistory(item) {
  if (!item || typeof item !== "object") return;
  _ensureAnalyticsDir();
  fs.appendFileSync(FACEBOOK_PUBLISH_HISTORY_FILE, JSON.stringify(item) + "\n", "utf8");
}

function _readFacebookPublishHistory(limit) {
  try {
    if (!fs.existsSync(FACEBOOK_PUBLISH_HISTORY_FILE)) return [];
    const raw = fs.readFileSync(FACEBOOK_PUBLISH_HISTORY_FILE, "utf8");
    if (!raw.trim()) return [];
    const items = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
    const max = Math.max(1, Number(limit) || 20);
    return items.slice(-max).reverse();
  } catch (err) {
    console.error("facebook publish history read failed:", err);
    return [];
  }
}

async function _facebookPostPhoto(connectionRecord, draft) {
  const pageId = _safeString(connectionRecord && connectionRecord.page && connectionRecord.page.id, 120);
  const pageAccessToken = _safeString(connectionRecord && connectionRecord.page_access_token, 2000);
  if (!pageId || !pageAccessToken) throw new Error("facebook page is not connected");

  const url = new URL(`${_facebookGraphBase()}/${encodeURIComponent(pageId)}/photos`);
  const body = new URLSearchParams();
  body.set("url", String(draft.image_url || "").trim());
  body.set("caption", String(draft.final_message || "").trim());
  body.set("access_token", pageAccessToken);

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!r.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${r.status}`;
    throw new Error(msg || "facebook photo publish failed");
  }
  return data || {};
}

async function _facebookPostFeed(connectionRecord, draft) {
  const pageId = _safeString(connectionRecord && connectionRecord.page && connectionRecord.page.id, 120);
  const pageAccessToken = _safeString(connectionRecord && connectionRecord.page_access_token, 2000);
  if (!pageId || !pageAccessToken) throw new Error("facebook page is not connected");

  const url = new URL(`${_facebookGraphBase()}/${encodeURIComponent(pageId)}/feed`);
  const body = new URLSearchParams();
  body.set("message", String(draft.final_message || "").trim());
  body.set("access_token", pageAccessToken);

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!r.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${r.status}`;
    throw new Error(msg || "facebook feed publish failed");
  }
  return data || {};
}

// =========================================================
// UNIVERSAL CORS
// =========================================================
function allowCors(res, req) {
  // If the browser sends credentials (cookies), we cannot use "*" for ACAO.
  // We keep a small allowlist for known frontends, and fall back to "*" otherwise.
  const origin = req && req.headers ? req.headers.origin : "";
  const allowList = String(process.env.CORS_ALLOW_ORIGINS || "https://vmpix.onrender.com,https://vmpix.smugmug.com")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const isAllowed = origin && allowList.includes(origin);

  if (isAllowed) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
  } else {
    // Public, non-credentialed requests
    res.set("Access-Control-Allow-Origin", "*");
  }

  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  // Include common headers used by fetch() and browsers
  res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Requested-With, X-Analytics-Key");
  // Optional: make it easier to debug in DevTools
  res.set("Access-Control-Expose-Headers", "Content-Type, Content-Length");
}

// Always attach CORS headers (including for static files) and handle OPTIONS fast
app.use((req, res, next) => {
  allowCors(res, req);
  if (req.method === "OPTIONS") return res.status(204).send("");
  next();
});


app.use(express.static(__dirname));
app.use(express.json({ limit: "2mb" }));

// =========================================================
// KEEP-WARM PING ENDPOINT
// Lightweight health check to prevent Render cold starts
// =========================================================
app.get("/ping", (req, res) => {
  allowCors(res, req);
  res.status(200).send("OK");
});

app.get("/__vm/diagnostics", async (req, res) => {
  allowCors(res, req);
  const rawConnection = _readFacebookConnectionRecord();
  const connection = _toPublicFacebookConnectionState(rawConnection);
  let liveDebug = null;
  if (_facebookDebugEnabled() && rawConnection && rawConnection.user_access_token) {
    try {
      liveDebug = await _fetchFacebookLiveDebug(rawConnection.user_access_token);
    } catch (err) {
      liveDebug = {
        user: null,
        accounts: [],
        granted: [],
        declined: [],
        errors: [err && err.message ? err.message : String(err || "unknown error")]
      };
    }
  }
  return res.json({
    ok: true,
    build: SERVER_BUILD_TAG,
    facebook: {
      page_target: FACEBOOK_PAGE_NAME_TARGET,
      app_id_configured: !!META_APP_ID,
      app_secret_configured: !!META_APP_SECRET,
      redirect_uri_configured: !!META_REDIRECT_URI,
      oauth_success_redirect_configured: !!META_OAUTH_SUCCESS_REDIRECT,
      oauth_error_redirect_configured: !!META_OAUTH_ERROR_REDIRECT,
      debug_mode: _facebookDebugEnabled(),
      graph_version: META_GRAPH_VERSION || null,
      last_error: connection.last_error || "",
      last_available_pages: Array.isArray(connection.last_available_pages) ? connection.last_available_pages : [],
      granted_scopes: Array.isArray(connection.granted_scopes) ? connection.granted_scopes : [],
      declined_scopes: Array.isArray(connection.declined_scopes) ? connection.declined_scopes : [],
      debug_user: connection.debug_user || null,
      live_debug: liveDebug
    }
  });
});



// SmugMug API Key
const SMUG_API_KEY = "SQLhhqgXZJd7MzqgVX563bkbjdCfXt9T";

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "101815");
const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || "vm-admin-dev-secret");
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || (8 * 60 * 60 * 1000));

function _adminSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(aa, bb);
  } catch (_) {
    return false;
  }
}

function _createAdminToken() {
  const payload = {
    v: 1,
    exp: Date.now() + Math.max(60 * 1000, ADMIN_TOKEN_TTL_MS)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function _verifyAdminToken(token) {
  const raw = String(token || "").trim();
  if (!raw || raw.indexOf(".") === -1) return null;
  const parts = raw.split(".");
  const encoded = parts[0] || "";
  const sig = parts[1] || "";
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(encoded).digest("base64url");
  if (!_adminSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    const exp = Number(payload.exp || 0);
    if (!exp || Date.now() > exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function _readAdminBearerToken(req) {
  const auth = String((req && req.headers && req.headers.authorization) || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String((req && req.query && req.query.token) || "").trim();
}

function _requireAdmin(req, res) {
  const token = _readAdminBearerToken(req);
  const payload = _verifyAdminToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "invalid token" });
    return null;
  }
  return payload;
}

function _ensureAnalyticsDir() {
  try {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  } catch (_) {}
}

function _safeString(value, maxLen) {
  const out = String(value == null ? "" : value).trim();
  return out.slice(0, Math.max(0, Number(maxLen) || out.length));
}

function _safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _safeMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const text = JSON.stringify(value);
    if (!text) return {};
    if (text.length > 12000) return { truncated: true };
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

function _normalizeAnalyticsEvent(input) {
  const body = input && typeof input === "object" ? input : {};
  const eventName = _safeString(body.event_name, 80);
  const occurredAt = _safeString(body.occurred_at, 64);
  const sessionId = _safeString(body.session_id, 120);
  const visitorId = _safeString(body.visitor_id, 120);
  const route = _safeString(body.route, 240);
  const section = _safeString(body.section, 48);
  const source = _safeString(body.source, 64);
  const eventVersion = _safeNumber(body.event_version, 0);

  if (!eventName || !occurredAt || !sessionId || !visitorId || !route || !section || !source || !eventVersion) {
    return null;
  }

  return {
    id: "evt_" + crypto.randomBytes(12).toString("hex"),
    received_at: new Date().toISOString(),
    event_name: eventName,
    occurred_at: occurredAt,
    client_time: _safeString(body.client_time, 120),
    session_id: sessionId,
    visitor_id: visitorId,
    pageview_id: _safeString(body.pageview_id, 120),
    route,
    pathname: _safeString(body.pathname, 240),
    hash: _safeString(body.hash, 160),
    section,
    subsection: _safeString(body.subsection, 48),
    source,
    event_version: eventVersion,
    referrer: _safeString(body.referrer, 400),
    utm_source: _safeString(body.utm_source, 120),
    utm_medium: _safeString(body.utm_medium, 120),
    utm_campaign: _safeString(body.utm_campaign, 160),
    utm_term: _safeString(body.utm_term, 160),
    utm_content: _safeString(body.utm_content, 160),
    device_type: _safeString(body.device_type, 24),
    viewport_w: _safeNumber(body.viewport_w, 0),
    viewport_h: _safeNumber(body.viewport_h, 0),
    language: _safeString(body.language, 32),
    timezone: _safeString(body.timezone, 80),
    entity_type: _safeString(body.entity_type, 48),
    entity_id: _safeString(body.entity_id, 240),
    entity_label: _safeString(body.entity_label, 240),
    meta: _safeMeta(body.meta)
  };
}

function _appendAnalyticsEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  _ensureAnalyticsDir();
  console.log("[analytics append] count:", events.length, "file:", ANALYTICS_EVENTS_FILE);
  const lines = events.map((evt) => JSON.stringify(evt)).join("\n") + "\n";
  fs.appendFileSync(ANALYTICS_EVENTS_FILE, lines, "utf8");
}

function _readAnalyticsEvents() {
  try {
    if (!fs.existsSync(ANALYTICS_EVENTS_FILE)) return [];
    const raw = fs.readFileSync(ANALYTICS_EVENTS_FILE, "utf8");
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.error("analytics read failed:", err);
    return [];
  }
}

function _clearAnalyticsEvents() {
  try {
    if (fs.existsSync(ANALYTICS_EVENTS_FILE)) {
      fs.unlinkSync(ANALYTICS_EVENTS_FILE);
    }
    return true;
  } catch (err) {
    console.error("analytics clear failed:", err);
    return false;
  }
}

function _rangeCutoff(range) {
  const now = Date.now();
  if (range === "24h") return now - (24 * 60 * 60 * 1000);
  if (range === "30d") return now - (30 * 24 * 60 * 60 * 1000);
  return now - (7 * 24 * 60 * 60 * 1000);
}

function _filterAnalyticsEvents(events, opts) {
  const options = opts || {};
  const cutoff = _rangeCutoff(_safeString(options.range, 12) || "7d");
  const section = _safeString(options.section, 48);
  const eventName = _safeString(options.event_name, 80);
  const entityType = _safeString(options.entity_type, 48);
  return (Array.isArray(events) ? events : []).filter((evt) => {
    const when = Date.parse(String(evt && evt.occurred_at || evt && evt.received_at || ""));
    if (!Number.isFinite(when) || when < cutoff) return false;
    if (section && String(evt.section || "") !== section) return false;
    if (eventName && String(evt.event_name || "") !== eventName) return false;
    if (entityType && String(evt.entity_type || "") !== entityType) return false;
    return true;
  });
}

function _countDistinct(events, key) {
  const set = new Set();
  (events || []).forEach((evt) => {
    const value = _safeString(evt && evt[key], 240);
    if (value) set.add(value);
  });
  return set.size;
}

function _toTopItems(map, limit, formatter) {
  return Array.from(map.entries())
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, Math.max(1, Number(limit) || 25))
    .map(([key, value]) => formatter(key, value));
}

app.post("/admin/auth", (req, res) => {
  allowCors(res, req);
  const password = String((req.body && req.body.password) || "").trim();
  if (!_adminSafeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: "invalid password" });
  }
  const token = _createAdminToken();
  const payload = _verifyAdminToken(token);
  return res.json({
    ok: true,
    token,
    expiresAt: payload && payload.exp ? new Date(payload.exp).toISOString() : null
  });
});

app.get("/admin/verify", (req, res) => {
  allowCors(res, req);
  const token = _readAdminBearerToken(req);
  const payload = _verifyAdminToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "invalid token" });
  }
  return res.json({
    ok: true,
    expiresAt: payload.exp ? new Date(payload.exp).toISOString() : null
  });
});

app.get("/admin/facebook/status", (req, res) => {
  allowCors(res, req);
  try {
    return res.json({
      ok: true,
      config: _facebookConfigSummary(),
      connection: _toPublicFacebookConnectionState(_readFacebookConnectionRecord())
    });
  } catch (err) {
    console.error("/admin/facebook/status failed:", err);
    return res.status(500).json({ ok: false, error: "facebook status failed" });
  }
});

app.get("/admin/facebook/mentions/search", async (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const q = _safeString(req.query && req.query.q, 120);
    if (!q) return res.json({ ok: true, items: [] });
    const record = _readFacebookConnectionRecord();
    const userAccessToken = _safeString(record && record.user_access_token, 2000);
    if (!userAccessToken) {
      return res.status(400).json({ ok: false, error: "facebook page is not connected" });
    }
    const items = await _facebookSearchPages(userAccessToken, q);
    return res.json({ ok: true, items });
  } catch (err) {
    console.error("/admin/facebook/mentions/search failed:", err);
    return res.status(500).json({ ok: false, error: "facebook mention search failed" });
  }
});

app.post("/admin/facebook/connect/start", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
      return res.status(400).json({
        ok: false,
        error: "facebook config incomplete",
        config: _facebookConfigSummary()
      });
    }
    const returnTo = _safeString(req.body && req.body.return_to, 500) || META_OAUTH_SUCCESS_REDIRECT || "";
    const auth = _buildFacebookOauthAuthorizeUrl(returnTo);
    return res.json({
      ok: true,
      authorize_url: auth.url,
      page_target: FACEBOOK_PAGE_NAME_TARGET,
      scopes: _facebookRequestedScopes()
    });
  } catch (err) {
    console.error("/admin/facebook/connect/start failed:", err);
    return res.status(500).json({ ok: false, error: "facebook connect start failed" });
  }
});

app.get("/admin/facebook/connect/callback", async (req, res) => {
  allowCors(res, req);
  const fail = (errorMessage, payload, extraParams) => {
    const message = _safeString(errorMessage, 240) || "facebook connect failed";
    const statePayload = payload && typeof payload === "object" ? payload : null;
    const returnTo = _safeString(
      (statePayload && statePayload.return_to) || META_OAUTH_ERROR_REDIRECT || META_OAUTH_SUCCESS_REDIRECT || "",
      500
    );
    const extras = extraParams && typeof extraParams === "object" ? extraParams : {};
    if (returnTo) return res.redirect(_appendQueryParams(returnTo, Object.assign({ facebook: "error", message }, extras)));
    return res.status(400).json(Object.assign({ ok: false, error: message }, extras));
  };

  try {
    const statePayload = _verifyFacebookOauthState(req.query && req.query.state);
    if (!statePayload) return fail("invalid facebook oauth state");
    if (req.query && req.query.error) {
      const msg = _safeString((req.query.error_description || req.query.error_message || req.query.error), 240) || "facebook authorization denied";
      return fail(msg, statePayload);
    }

    const code = _safeString(req.query && req.query.code, 1200);
    if (!code) return fail("missing facebook authorization code", statePayload);

    const shortToken = await _exchangeFacebookCodeForUserToken(code);
    let userAccessToken = _safeString(shortToken && shortToken.access_token, 2000);
    let expiresAt = null;
    if (!userAccessToken) return fail("facebook user token missing", statePayload);

    try {
      const longToken = await _exchangeForLongLivedUserToken(userAccessToken);
      if (longToken && longToken.access_token) {
        userAccessToken = _safeString(longToken.access_token, 2000) || userAccessToken;
        if (Number.isFinite(Number(longToken.expires_in))) {
          expiresAt = new Date(Date.now() + (Number(longToken.expires_in) * 1000)).toISOString();
        }
      } else if (Number.isFinite(Number(shortToken && shortToken.expires_in))) {
        expiresAt = new Date(Date.now() + (Number(shortToken.expires_in) * 1000)).toISOString();
      }
    } catch (tokenErr) {
      console.warn("facebook long-lived token exchange skipped:", tokenErr && tokenErr.message ? tokenErr.message : tokenErr);
      if (Number.isFinite(Number(shortToken && shortToken.expires_in))) {
        expiresAt = new Date(Date.now() + (Number(shortToken.expires_in) * 1000)).toISOString();
      }
    }

    let pages = await _fetchFacebookManagedPages(userAccessToken);
    let grantedScopeInfo = { granted: [], declined: [] };
    let debugUser = null;
    try {
      grantedScopeInfo = await _fetchFacebookGrantedScopes(userAccessToken);
    } catch (scopeErr) {
      console.warn("facebook permissions lookup failed:", scopeErr && scopeErr.message ? scopeErr.message : scopeErr);
    }
    try {
      debugUser = await _fetchFacebookUserProfile(userAccessToken);
    } catch (userErr) {
      console.warn("facebook user profile lookup failed:", userErr && userErr.message ? userErr.message : userErr);
    }
    let page = _findTargetFacebookPage(pages);
    if ((!page || !page.id || !page.access_token) && FACEBOOK_PAGE_ID_TARGET) {
      try {
        const directPage = await _fetchFacebookPageById(userAccessToken, FACEBOOK_PAGE_ID_TARGET);
        if (directPage && directPage.id) {
          const existingIndex = pages.findIndex((item) => _safeString(item && item.id, 120) === _safeString(directPage.id, 120));
          if (existingIndex >= 0) pages[existingIndex] = Object.assign({}, pages[existingIndex], directPage);
          else pages = pages.concat([directPage]);
          page = _findTargetFacebookPage(pages);
        }
      } catch (directErr) {
        console.warn("facebook direct page lookup failed:", directErr && directErr.message ? directErr.message : directErr);
      }
    }
    if (!page || !page.id || !page.access_token) {
      const availablePages = _facebookPageSummaries(pages);
      try {
        const previous = _readFacebookConnectionRecord();
        _writeFacebookConnectionState(Object.assign({}, previous, {
          connected: false,
          page: { id: "", name: "" },
          page_access_token: "",
          user_access_token: userAccessToken,
          user_token_expires_at: expiresAt,
          token_status: "not_connected",
          last_checked_at: new Date().toISOString(),
          last_available_pages: availablePages,
          last_error: `unable to find target page "${FACEBOOK_PAGE_NAME_TARGET}"`,
          granted_scopes: grantedScopeInfo.granted,
          declined_scopes: grantedScopeInfo.declined,
          debug_user: debugUser
        }));
      } catch (_) {}
      console.warn("facebook connect callback: target page not found", {
        target: FACEBOOK_PAGE_NAME_TARGET,
        available_pages: availablePages
      });
      const availableNames = availablePages.map((item) => item.name).filter(Boolean);
      const debugParams = _facebookDebugEnabled() && availableNames.length
        ? { available_pages: availableNames.join(" | ") }
        : {};
      return fail(
        `unable to find target page "${FACEBOOK_PAGE_NAME_TARGET}"${availableNames.length ? ` (available: ${availableNames.join(", ")})` : ""}`,
        statePayload,
        debugParams
      );
    }

    _writeFacebookConnectionState({
      connected: true,
      page: {
        id: _safeString(page.id, 120),
        name: _safeString(page.name, 160)
      },
      page_access_token: _safeString(page.access_token, 2000),
      user_access_token: userAccessToken,
      user_token_expires_at: expiresAt,
      token_status: "valid",
      last_checked_at: new Date().toISOString(),
      last_publish_at: null,
      last_available_pages: _facebookPageSummaries(pages),
      last_error: "",
      scopes: Array.isArray(statePayload.scopes) ? statePayload.scopes : _facebookRequestedScopes(),
      granted_scopes: grantedScopeInfo.granted,
      declined_scopes: grantedScopeInfo.declined,
      debug_user: debugUser
    });

    const returnTo = _safeString(statePayload.return_to, 500) || META_OAUTH_SUCCESS_REDIRECT || "";
    if (returnTo) {
      return res.redirect(_appendQueryParams(returnTo, {
        facebook: "connected",
        page_id: _safeString(page.id, 120),
        page_name: _safeString(page.name, 160)
      }));
    }

    return res.json({
      ok: true,
      connected: true,
      page: {
        id: _safeString(page.id, 120),
        name: _safeString(page.name, 160)
      }
    });
  } catch (err) {
    console.error("/admin/facebook/connect/callback failed:", err);
    return fail(err && err.message ? err.message : "facebook callback failed");
  }
});

app.post("/admin/facebook/disconnect", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const cleared = _writeFacebookConnectionState(_defaultFacebookConnectionRecord());
    return res.json({
      ok: true,
      connection: _toPublicFacebookConnectionState(cleared)
    });
  } catch (err) {
    console.error("/admin/facebook/disconnect failed:", err);
    return res.status(500).json({ ok: false, error: "facebook disconnect failed" });
  }
});

app.post("/admin/facebook/preview", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const normalized = _normalizeFacebookDraft(req.body);
    if (!normalized.ok) {
      return res.status(400).json({
        ok: false,
        error: normalized.errors[0] || "invalid facebook draft",
        errors: normalized.errors
      });
    }
    const record = _readFacebookConnectionRecord();
    return res.json({
      ok: true,
      preview: {
        page_name: _safeString(record && record.page && record.page.name, 160) || FACEBOOK_PAGE_NAME_TARGET,
        page_id: _safeString(record && record.page && record.page.id, 120),
        connected: !!record.connected,
        token_status: _safeString(record.token_status, 48) || "not_connected",
        section: normalized.draft.section,
        entity_type: normalized.draft.entity_type,
        entity_id: normalized.draft.entity_id,
        entity_label: normalized.draft.entity_label,
        caption: normalized.draft.caption,
        link_url: normalized.draft.link_url,
        image_url: normalized.draft.image_url,
        final_message: normalized.draft.final_message,
        meta: normalized.draft.meta
      }
    });
  } catch (err) {
    console.error("/admin/facebook/preview failed:", err);
    return res.status(500).json({ ok: false, error: "facebook preview failed" });
  }
});

app.post("/admin/facebook/publish", async (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  const historyItem = {
    id: "fbpub_" + crypto.randomBytes(8).toString("hex"),
    created_at: new Date().toISOString(),
    section: "",
    entity_type: "",
    entity_id: "",
    entity_label: "",
    status: "failed",
    page_id: "",
    page_name: "",
    image_url: "",
    link_url: "",
    caption: "",
    final_message: "",
    facebook_post_id: "",
    facebook_photo_id: "",
    error: "",
    meta: {}
  };

  try {
    const normalized = _normalizeFacebookDraft(req.body);
    if (!normalized.ok) {
      historyItem.error = normalized.errors.join("; ");
      _appendFacebookPublishHistory(historyItem);
      return res.status(400).json({
        ok: false,
        error: normalized.errors[0] || "invalid facebook draft",
        errors: normalized.errors
      });
    }

    const draft = normalized.draft;
    historyItem.section = draft.section;
    historyItem.entity_type = draft.entity_type;
    historyItem.entity_id = draft.entity_id;
    historyItem.entity_label = draft.entity_label;
    historyItem.image_url = draft.image_url;
    historyItem.link_url = draft.link_url;
    historyItem.caption = draft.caption;
    historyItem.final_message = draft.final_message;
    historyItem.meta = draft.meta;

    const record = _readFacebookConnectionRecord();
    if (!record.connected || !record.page_access_token || !(record.page && record.page.id)) {
      historyItem.error = "facebook page is not connected";
      _appendFacebookPublishHistory(historyItem);
      return res.status(400).json({ ok: false, error: "facebook page is not connected" });
    }

    historyItem.page_id = _safeString(record.page.id, 120);
    historyItem.page_name = _safeString(record.page.name, 160);

    const publishResult = draft.post_kind === "feed"
      ? await _facebookPostFeed(record, draft)
      : await _facebookPostPhoto(record, draft);
    historyItem.status = "success";
    historyItem.facebook_post_id = _safeString((publishResult && (publishResult.post_id || publishResult.id)), 240);
    historyItem.facebook_photo_id = draft.post_kind === "photo"
      ? _safeString(publishResult && publishResult.id, 240)
      : "";
    _appendFacebookPublishHistory(historyItem);

    _writeFacebookConnectionState(Object.assign({}, record, {
      token_status: "valid",
      last_checked_at: new Date().toISOString(),
      last_publish_at: historyItem.created_at
    }));

    return res.json({
      ok: true,
      publish_id: historyItem.id,
      facebook_post_id: historyItem.facebook_post_id || null,
      facebook_photo_id: historyItem.facebook_photo_id || null,
      published_at: historyItem.created_at
    });
  } catch (err) {
    historyItem.error = _safeString(err && err.message, 500) || "facebook publish failed";
    _appendFacebookPublishHistory(historyItem);
    console.error("/admin/facebook/publish failed:", err);
    return res.status(500).json({ ok: false, error: historyItem.error || "facebook publish failed" });
  }
});

app.get("/admin/facebook/history", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query && req.query.limit) || 20));
    return res.json({
      ok: true,
      items: _readFacebookPublishHistory(limit)
    });
  } catch (err) {
    console.error("/admin/facebook/history failed:", err);
    return res.status(500).json({ ok: false, error: "facebook history failed" });
  }
});

app.post("/admin/people-index/rebuild", async (req, res) => {
  allowCors(res, req);
  const token = _readAdminBearerToken(req);
  const payload = _verifyAdminToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "invalid token" });
  }
  try {
    const rebuilt = await _buildWrestlingPeopleIndex(true);
    return res.json({
      ok: true,
      generatedAt: rebuilt && rebuilt.generatedAt ? rebuilt.generatedAt : null,
      totalPeople: Number(rebuilt && rebuilt.totalPeople || 0),
      totalAppearances: Number(rebuilt && rebuilt.totalAppearances || 0)
    });
  } catch (err) {
    console.error('/admin/people-index/rebuild failed:', err);
    return res.status(500).json({ ok: false, error: 'rebuild failed' });
  }
});

app.post("/analytics/collect", (req, res) => {
  allowCors(res, req);
  try {
    const evt = _normalizeAnalyticsEvent(req.body);
    if (!evt) {
      return res.status(400).json({ ok: false, error: "invalid event" });
    }
    _appendAnalyticsEvents([evt]);
    return res.json({ ok: true, ingested: 1 });
  } catch (err) {
    console.error("/analytics/collect failed:", err);
    return res.status(500).json({ ok: false, error: "collect failed" });
  }
});

app.post("/analytics/batch", (req, res) => {
  allowCors(res, req);
  try {
    const rawEvents = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 100) : [];
    const normalized = rawEvents.map(_normalizeAnalyticsEvent).filter(Boolean);
    _appendAnalyticsEvents(normalized);
    return res.json({
      ok: true,
      accepted: normalized.length,
      rejected: Math.max(0, rawEvents.length - normalized.length)
    });
  } catch (err) {
    console.error("/analytics/batch failed:", err);
    return res.status(500).json({ ok: false, error: "batch failed" });
  }
});

app.get("/admin/analytics/overview", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const range = _safeString(req.query && req.query.range, 12) || "7d";
    const events = _filterAnalyticsEvents(_readAnalyticsEvents(), { range });
    const sections = new Map();
    let lastIngestAt = "";

    events.forEach((evt) => {
      const key = String(evt.section || "unknown");
      const entry = sections.get(key) || { section: key, pageviews: 0, events: 0 };
      entry.events += 1;
      if (String(evt.event_name || "") === "page_view") entry.pageviews += 1;
      sections.set(key, entry);
      const receivedAt = String(evt.received_at || "");
      if (receivedAt && (!lastIngestAt || receivedAt > lastIngestAt)) lastIngestAt = receivedAt;
    });

    return res.json({
      ok: true,
      range,
      totals: {
        events: events.length,
        pageviews: events.filter((evt) => String(evt.event_name || "") === "page_view").length,
        visitors: _countDistinct(events, "visitor_id"),
        sessions: _countDistinct(events, "session_id")
      },
      sections: Array.from(sections.values()).sort((a, b) => b.events - a.events),
      lastIngestAt: lastIngestAt || null
    });
  } catch (err) {
    console.error("/admin/analytics/overview failed:", err);
    return res.status(500).json({ ok: false, error: "overview failed" });
  }
});

app.get("/admin/analytics/routes", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const range = _safeString(req.query && req.query.range, 12) || "7d";
    const limit = _safeNumber(req.query && req.query.limit, 25);
    const events = _filterAnalyticsEvents(_readAnalyticsEvents(), { range });
    const routes = new Map();

    events.forEach((evt) => {
      const key = String(evt.route || "");
      if (!key) return;
      const entry = routes.get(key) || { route: key, section: String(evt.section || ""), pageviews: 0, events: 0 };
      entry.events += 1;
      if (String(evt.event_name || "") === "page_view") entry.pageviews += 1;
      routes.set(key, entry);
    });

    return res.json({
      ok: true,
      items: Array.from(routes.values())
        .sort((a, b) => b.events - a.events)
        .slice(0, Math.max(1, limit))
    });
  } catch (err) {
    console.error("/admin/analytics/routes failed:", err);
    return res.status(500).json({ ok: false, error: "routes failed" });
  }
});

app.get("/admin/analytics/entities", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const range = _safeString(req.query && req.query.range, 12) || "7d";
    const limit = _safeNumber(req.query && req.query.limit, 25);
    const entityType = _safeString(req.query && req.query.entity_type, 48);
    const events = _filterAnalyticsEvents(_readAnalyticsEvents(), { range, entity_type: entityType });
    const entities = new Map();

    events.forEach((evt) => {
      const type = String(evt.entity_type || "");
      const id = String(evt.entity_id || "");
      if (!type || !id) return;
      const key = type + "::" + id;
      const entry = entities.get(key) || {
        entity_type: type,
        entity_id: id,
        entity_label: String(evt.entity_label || id),
        events: 0
      };
      entry.events += 1;
      entities.set(key, entry);
    });

    return res.json({
      ok: true,
      items: Array.from(entities.values())
        .sort((a, b) => b.events - a.events)
        .slice(0, Math.max(1, limit))
    });
  } catch (err) {
    console.error("/admin/analytics/entities failed:", err);
    return res.status(500).json({ ok: false, error: "entities failed" });
  }
});

app.get("/admin/analytics/events", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    const range = _safeString(req.query && req.query.range, 12) || "7d";
    const limit = _safeNumber(req.query && req.query.limit, 100);
    const section = _safeString(req.query && req.query.section, 48);
    const eventName = _safeString(req.query && req.query.event_name, 80);
    const events = _filterAnalyticsEvents(_readAnalyticsEvents(), {
      range,
      section,
      event_name: eventName
    });

    return res.json({
      ok: true,
      items: events
        .sort((a, b) => String(b.occurred_at || b.received_at || "").localeCompare(String(a.occurred_at || a.received_at || "")))
        .slice(0, Math.max(1, limit))
    });
  } catch (err) {
    console.error("/admin/analytics/events failed:", err);
    return res.status(500).json({ ok: false, error: "events failed" });
  }
});

app.post("/admin/analytics/reset", (req, res) => {
  allowCors(res, req);
  if (!_requireAdmin(req, res)) return;
  try {
    console.log("[analytics reset] request received");
    console.log("[analytics reset] file:", ANALYTICS_EVENTS_FILE);
    const beforeCount = _readAnalyticsEvents().length;
    console.log("[analytics reset] before:", beforeCount);

    _ensureAnalyticsDir();

    let ok = false;
    try {
      if (fs.existsSync(ANALYTICS_EVENTS_FILE)) {
        fs.unlinkSync(ANALYTICS_EVENTS_FILE);
      }
      ok = true;
    } catch (unlinkErr) {
      console.error("[analytics reset] unlink failed:", unlinkErr);
      try {
        fs.writeFileSync(ANALYTICS_EVENTS_FILE, "", "utf8");
        ok = true;
      } catch (truncateErr) {
        console.error("[analytics reset] truncate failed:", truncateErr);
      }
    }

    const afterCount = _readAnalyticsEvents().length;
    console.log("[analytics reset] after:", afterCount);
    if (!ok || afterCount !== 0) {
      return res.status(500).json({
        ok: false,
        error: "reset failed",
        beforeCount,
        afterCount
      });
    }
    return res.json({
      ok: true,
      beforeCount,
      afterCount,
      clearedAt: new Date().toISOString(),
      file: ANALYTICS_EVENTS_FILE
    });
  } catch (err) {
    console.error("/admin/analytics/reset failed:", err);
    return res.status(500).json({ ok: false, error: "reset failed" });
  }
});

// Google Sheets (your existing CSV sources)
const BANDS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdi19qTDyPeBGzq0PpkdlDS_bNg34XpdRiXy8aBa-Jlu-jg2Wzkj1SnLXtRVFU4TGOh5KHJPK8Lwhc/pub?gid=0&single=true&output=csv";

// Music shows CSV (legacy)
const MUSIC_SHOWS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTdi19qTDyPeBGzq0PpkdlDS_bNg34XpdRiXy8aBa-Jlu-jg2Wzkj1SnLXtRVFU4TGOh5KHJPK8Lwhc/pub?gid=1306635885&single=true&output=csv";

// Wrestling shows CSV (published)
const WRESTLING_SHOWS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTGNw3uAMsoML1yS4d12v8FKwrAZQK0OSuZkoml3cQT2s_KEQa7Qs5flD0c_zjJnR2Qy5D465-_6F8/pub?output=csv";

// Wrestling people CSV (People tab)
const WRESTLING_PEOPLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTGNw3uAMsoML1yS4d12v8FKwrAZQK0OSuZkoml3cQT2s_KEQa7Qs5flD0c_zjJnR2Qy5D465-_6F8/pub?gid=1853953954&single=true&output=csv";

// Default /sheet/shows source. For the wrestling server, this should be Wrestling.
// You can override via env SHOWS_SHEET_URL if you deploy a music-only instance.
const SHOWS_SHEET_URL = String(process.env.SHOWS_SHEET_URL || WRESTLING_SHOWS_SHEET_URL).trim() || WRESTLING_SHOWS_SHEET_URL;
const PEOPLE_SHEET_URL = String(process.env.PEOPLE_SHEET_URL || WRESTLING_PEOPLE_SHEET_URL).trim() || WRESTLING_PEOPLE_SHEET_URL;


// Stats tab (Fix / Metadata) – gid provided by Chris
// NOTE: Uses the Google Sheet "export?format=csv" URL style.
// This will work as long as the sheet (or at least this tab) is readable without auth.
const STATS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/12P8b85K24dcyy9jubil_h4DN6xXr3wYFsILz-5LkGkk/export?format=csv&gid=1973247444";


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
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /bands fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("sheet error");
  }
});

app.get("/sheet/shows", async (req, res) => {
  try {
    const r = await fetch(SHOWS_SHEET_URL);
    const csv = await r.text();
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /shows fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("shows sheet error");
  }
});

app.get('/index/shows', async (req, res) => {
  allowCors(res, req);
  try {
    const force = String(req.query.force || '').trim() === '1';
    if (force) {
      const upstream = await fetch(SHOWS_SHEET_URL, { headers: { Accept: 'text/plain,text/csv;q=0.9,*/*;q=0.8', 'Cache-Control': 'no-cache' } });
      const csv = await upstream.text();
      if (!upstream.ok || /^\s*</.test(csv)) {
        throw new Error('shows sheet upstream returned ' + (upstream.status || 500));
      }
      const payload = _buildWrestlingShowIndexPayload(csv);
      _saveWrestlingShowIndexSnapshot(payload);
      return res.json(payload);
    }

    const snapshot = _loadWrestlingShowIndexSnapshot();
    if (snapshot) {
      return res.json(snapshot);
    }

    return res.status(503).json({
      error: 'show index unavailable',
      message: 'No Wrestling show snapshot is available yet. Use force=1 to generate a fresh export.'
    });
  } catch (err) {
    console.error('/index/shows failed:', err);
    res.status(500).json({ error: 'show index error' });
  }
});

app.get("/sheet/people", async (req, res) => {
  try {
    const r = await fetch(PEOPLE_SHEET_URL);
    const csv = await r.text();
    if (!r.ok || /^\s*</.test(csv)) {
      throw new Error(`people sheet upstream returned ${r.status || 500}`);
    }
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /people fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("people sheet error");
  }
});

// Stats tab (Fix / Metadata)
// Aliases included to match different frontend endpoint names used over time.
async function sendStatsCsv(req, res) {
  try {
    const r = await fetch(STATS_SHEET_URL);
    const csv = await r.text();
    allowCors(res, req);
    res.type("text/plain").send(csv);
  } catch (err) {
    console.error("sheet /stats fetch failed:", err);
    allowCors(res, req);
    res.status(500).send("stats sheet error");
  }
}

app.get("/sheet/stats", sendStatsCsv);
app.get("/sheet/stats/", sendStatsCsv);
app.get("/sheet/fix_metadata", sendStatsCsv);
app.get("/sheet/fix_metadata/", sendStatsCsv);
app.get("/sheet/fix-metadata", sendStatsCsv);
app.get("/sheet/fix-metadata/", sendStatsCsv);
app.get("/sheet/fixmetadata", sendStatsCsv);
app.get("/sheet/fixmetadata/", sendStatsCsv);
app.get("/sheet/fix", sendStatsCsv);
app.get("/sheet/fix/", sendStatsCsv);

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



function _splitPeopleNames(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const seen = new Set();
  return s.split(/[;,]/g)
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((name) => {
      const key = String(name || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function _slugifyPersonName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function _wrestlingMatchField(row, idx, field) {
  const n = Number(idx);
  const keys = [
    `match-${n}_${field}`,
    `match_${n}_${field}`,
    `match-${n}-${field}`,
    `match_${n}-${field}`,
    `part_${n}_${field}`,
  ];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : "";
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function _wrestlingShowSlugFromDate(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2, "0");
    const dd = String(m[2]).padStart(2, "0");
    let yy = String(m[3]);
    if (yy.length === 4) yy = yy.slice(2);
    return mm + dd + yy;
  }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return String(m[2]) + String(m[3]) + String(m[1]).slice(2);
  return "";
}

function _wrestlingMatchSlug(urlCell, idx) {
  const raw = String(urlCell || "").trim();
  if (raw && !/^https?:\/\//i.test(raw) && !raw.startsWith("/")) {
    const clean = raw
      .toLowerCase()
      .replace(/[^a-z0-9\-_ ]+/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (clean) return clean;
  }
  return `match-${String(Number(idx) || 1)}`;
}

const WRESTLING_PEOPLE_INDEX_TTL_MS = Number(process.env.WRESTLING_PEOPLE_INDEX_TTL_MS || (6 * 60 * 60 * 1000));
const WRESTLING_PEOPLE_INDEX_FILE = path.join(__dirname, "index", "people-index.json");
const WRESTLING_SHOW_INDEX_FILE = path.join(__dirname, "_tmp_wrestling_show_index.json");
let _wrestlingPeopleIndex = { builtAt: 0, payload: null };
let _wrestlingPeopleIndexPromise = null;

function _loadWrestlingPeopleIndexSnapshot() {
  try {
    if (!fs.existsSync(WRESTLING_PEOPLE_INDEX_FILE)) return null;
    const raw = fs.readFileSync(WRESTLING_PEOPLE_INDEX_FILE, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.people) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _saveWrestlingPeopleIndexSnapshot(payload) {
  try {
    fs.mkdirSync(path.dirname(WRESTLING_PEOPLE_INDEX_FILE), { recursive: true });
    fs.writeFileSync(WRESTLING_PEOPLE_INDEX_FILE, JSON.stringify(payload, null, 2));
    return true;
  } catch (err) {
    console.error("failed to save wrestling people snapshot:", err);
    return false;
  }
}

function _loadWrestlingShowIndexSnapshot() {
  try {
    if (!fs.existsSync(WRESTLING_SHOW_INDEX_FILE)) return null;
    const raw = fs.readFileSync(WRESTLING_SHOW_INDEX_FILE, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.shows)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _saveWrestlingShowIndexSnapshot(payload) {
  try {
    fs.writeFileSync(WRESTLING_SHOW_INDEX_FILE, JSON.stringify(payload, null, 2));
    return true;
  } catch (err) {
    console.error("failed to save wrestling show snapshot:", err);
    return false;
  }
}

function _buildWrestlingShowIndexPayload(csvText) {
  const rows = _csvParse(csvText);
  const shows = rows.map((sourceRow) => {
    const row = {};
    Object.keys(sourceRow || {}).forEach((key) => {
      const normalizedKey = String(key || "").trim().toLowerCase();
      if (!normalizedKey) return;
      row[normalizedKey] = String(sourceRow[key] || "").trim();
    });

    const showName = String(row.show_name || row.title || row.event || '').trim();
    const showDate = String(row.show_date || row.date || '').trim();
    return Object.assign({}, row, {
      title: showName,
      show_name: showName,
      date: showDate,
      show_date: showDate
    });
  }).filter((row) => String(row.show_name || row.title || '').trim());

  return {
    generatedAt: new Date().toISOString(),
    count: shows.length,
    shows
  };
}

function _parseWrestlingPeopleCaption(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const seen = new Set();
  const out = [];
  s.split(";").forEach((part) => {
    const token = String(part || "").trim();
    if (!token) return;
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(token);
  });
  return out;
}

function _extractCaptionOnly(albumImage) {
  if (!albumImage) return "";
  const direct = typeof albumImage.Caption === "string" ? albumImage.Caption.trim() : (typeof albumImage.caption === "string" ? albumImage.caption.trim() : "");
  if (direct) return direct;
  const nested = albumImage.Image || null;
  if (!nested) return "";
  if (typeof nested.Caption === "string" && nested.Caption.trim()) return nested.Caption.trim();
  if (typeof nested.caption === "string" && nested.caption.trim()) return nested.caption.trim();
  return "";
}

function _extractImageKey(albumImage) {
  return String((albumImage && (albumImage.ImageKey || (albumImage.Image && albumImage.Image.ImageKey) || albumImage.imageKey)) || "").trim();
}

async function _fetchWrestlingImageCaption(imageKey) {
  if (!imageKey) return "";
  try {
    const detail = await smug(`/image/${encodeURIComponent(imageKey)}-0?_verbosity=1&_expand=Image`);
    const resp = detail && detail.Response ? detail.Response : detail;
    const img = resp && resp.Image ? resp.Image : null;
    if (!img) return "";
    return String(img.Caption || img.caption || "").trim();
  } catch (_) {
    return "";
  }
}

async function _fetchWrestlingAlbumImagesAll(albumKey) {
  const out = [];
  let start = 1;
  const count = 200;
  while (true) {
    const data = await smug(`/album/${encodeURIComponent(albumKey)}!images?count=${count}&start=${start}&_expand=Image`);
    const resp = data && data.Response ? data.Response : data;
    let images = [];
    if (Array.isArray(resp && resp.AlbumImage)) images = resp.AlbumImage;
    else if (resp && resp.AlbumImage) images = [resp.AlbumImage];
    else if (Array.isArray(resp && resp.AlbumImages)) images = resp.AlbumImages;
    else if (resp && resp.AlbumImages) images = [resp.AlbumImages];
    images = (images || []).filter(Boolean);
    if (!images.length) break;
    out.push(...images);
    if (images.length < count) break;
    start += count;
  }
  return out;
}

function _wrestlingRouteFromUriPath(uriPath) {
  const p = String(uriPath || "").trim();
  if (!p) return "/wrestling/shows";
  const parts = p.split("/").filter(Boolean);
  const mmddyy = _extractMmddyyFromUriPath(p);
  if (!mmddyy) return "/wrestling/shows";
  const idx = parts.findIndex((seg) => String(seg || "").trim() === mmddyy);
  if (idx === -1) return `/wrestling/shows/${mmddyy}`;
  const next = String(parts[idx + 1] || "").trim();
  if (!next) return `/wrestling/shows/${mmddyy}`;
  const slug = next.toLowerCase().replace(/[^a-z0-9\-_ ]+/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `/wrestling/shows/${mmddyy}/${slug}` : `/wrestling/shows/${mmddyy}`;
}

async function _buildWrestlingPeopleIndex(force) {
  const now = Date.now();
  if (!force && _wrestlingPeopleIndex.builtAt && (now - _wrestlingPeopleIndex.builtAt) < WRESTLING_PEOPLE_INDEX_TTL_MS && _wrestlingPeopleIndex.payload) {
    return _wrestlingPeopleIndex.payload;
  }
  if (_wrestlingPeopleIndexPromise) return _wrestlingPeopleIndexPromise;

  _wrestlingPeopleIndexPromise = (async () => {
    const idx = await _buildWrestlingAlbumIndex(force);
    const albums = Array.isArray(idx && idx.albums) ? idx.albums : [];
    const people = Object.create(null);
    let appearanceCount = 0;

    const concurrency = Number(process.env.WRESTLING_PEOPLE_INDEX_CONCURRENCY || 2);
    let cursor = 0;

    async function worker() {
      while (cursor < albums.length) {
        const current = albums[cursor++];
        const albumKey = String(current && current.albumKey || "").trim();
        if (!albumKey) continue;

        let images = [];
        try {
          images = await _fetchWrestlingAlbumImagesAll(albumKey);
        } catch (_) {
          images = [];
        }
        if (!images.length) continue;

        const perAlbum = Object.create(null);
        for (let i = 0; i < images.length; i++) {
          const img = images[i] || {};
          let caption = _extractCaptionOnly(img);
          if (!caption) {
            const imageKey = _extractImageKey(img);
            if (imageKey) caption = await _fetchWrestlingImageCaption(imageKey);
          }
          const names = _parseWrestlingPeopleCaption(caption);
          if (!names.length) continue;
          for (let j = 0; j < names.length; j++) {
            const person = names[j];
            const key = String(person || "").trim().toLowerCase();
            if (!key) continue;
            perAlbum[key] = perAlbum[key] || { person, photoCount: 0 };
            perAlbum[key].photoCount += 1;
          }
        }

        const showTitle = String(current.showName || current.company || current.title || "").trim() || "Show";
        const detailTitle = String(current.title || "").trim() || "Album";
        const showDate = String(current.date || "").trim();
        const route = _wrestlingRouteFromUriPath(String(current.uriPath || "").trim());
        const albumUrl = String(current.url || "").trim();

        Object.keys(perAlbum).forEach((key) => {
          const entry = perAlbum[key] || {};
          if (!people[key]) {
            people[key] = {
              person: entry.person,
              slug: _slugifyPersonName(entry.person),
              photoCount: 0,
              appearances: []
            };
          }
          people[key].photoCount += Number(entry.photoCount || 0);
          people[key].appearances.push({
            showTitle,
            showDate,
            title: detailTitle,
            route,
            albumUrl,
            albumKey,
            photoCount: Number(entry.photoCount || 0)
          });
          appearanceCount += 1;
        });
      }
    }

    const workers = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) workers.push(worker());
    await Promise.all(workers);

    Object.keys(people).forEach((key) => {
      people[key].appearances.sort((a, b) => String(b.showDate || "").localeCompare(String(a.showDate || "")));
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      debugSource: 'caption-only-v1',
      debugCaptionOnly: true,
      totalPeople: Object.keys(people).length,
      totalAppearances: appearanceCount,
      people
    };

    _saveWrestlingPeopleIndexSnapshot(payload);
    _wrestlingPeopleIndex = { builtAt: Date.now(), payload };
    _wrestlingPeopleIndexPromise = null;
    return payload;
  })();

  try {
    return await _wrestlingPeopleIndexPromise;
  } finally {
    _wrestlingPeopleIndexPromise = null;
  }
}

app.get('/index/people', async (req, res) => {
  allowCors(res, req);
  const force = String(req.query.force || "").trim() === "1";
  try {
    if (!force) {
      const snapshot = _loadWrestlingPeopleIndexSnapshot();
      if (snapshot) {
        _wrestlingPeopleIndex = { builtAt: Date.now(), payload: snapshot };
        return res.json(Object.assign({}, snapshot, { cache: { hit: true, layer: 'file' } }));
      }
      return res.status(503).json({
        error: 'people index cache unavailable',
        message: 'No cached People index is available yet. Use force=1 to rebuild.',
        cache: { hit: false, layer: 'none' }
      });
    }

    const payload = await _buildWrestlingPeopleIndex(true);
    return res.json(Object.assign({}, payload, { cache: { hit: false, layer: 'rebuilt' } }));
  } catch (err) {
    console.error('/index/people failed:', err);
    res.status(500).json({ error: 'people index error' });
  }
});
// =========================================================
// SMART FOLDER → ALBUMS
// =========================================================

// =========================================================
// ✔ NEW: RESOLVE A SMUGMUG ALBUM URL → AlbumKey (Wrestling)
// IMPORTANT: This MUST be defined BEFORE /smug/:slug because otherwise
// /smug/resolve-album gets treated as a band slug and returns Album:[]
// =========================================================
function extractAlbumKeyFromUri(uri) {
  const s = String(uri || "");
  // Examples:
  //  /api/v2/album/AbCdEf
  //  https://api.smugmug.com/api/v2/album/AbCdEf
  const m = s.match(/\/album\/([^/?#]+)/i);
  return m ? String(m[1]).trim() : "";
}

async function resolveAlbumKeyViaNodeUrlPath(urlString) {
  const u = new URL(urlString);
  const urlPath = u.pathname || "";
  if (!urlPath || urlPath === "/") return { albumKey: "", nodeKey: "", finalUrl: u.toString() };

  // SmugMug supports resolving a Node by UrlPath.
  // If this UrlPath is an Album node, it typically includes an AlbumUri.
  const data = await smug(`/node?UrlPath=${encodeURIComponent(urlPath)}&_verbosity=1`);

  const resp = (data && data.Response) || {};
  const node = (Array.isArray(resp.Node) && resp.Node[0]) ? resp.Node[0] : resp.Node;

  let nodeKey = "";
  let albumKey = "";

  if (node && typeof node === "object") {
    if (typeof node.NodeKey === "string") nodeKey = node.NodeKey.trim();
    if (typeof node.AlbumKey === "string") albumKey = node.AlbumKey.trim();
    if (!albumKey && typeof node.AlbumUri === "string") albumKey = extractAlbumKeyFromUri(node.AlbumUri);

    // Some responses nest Uris
    if (!albumKey && node.Uris && typeof node.Uris === "object") {
      const maybeAlbumUri = node.Uris.Album || node.Uris.album || node.Uris.AlbumUri;
      if (typeof maybeAlbumUri === "string") albumKey = extractAlbumKeyFromUri(maybeAlbumUri);
    }

    // Sometimes the node itself is an album and its Uri contains /album/<key>
    if (!albumKey && typeof node.Uri === "string") albumKey = extractAlbumKeyFromUri(node.Uri);
  }

  return { albumKey, nodeKey, finalUrl: u.toString(), urlPath };
}

async function resolveAlbumKeyViaHtmlScrape(urlString) {
  // Fallback: fetch the SmugMug page HTML and scrape AlbumKey.
  const r = await fetch(urlString, {
    headers: {
      "User-Agent": "SmugProxy/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const html = await r.text();

  // Common patterns seen in SmugMug pages.
  const m1 = html.match(/"AlbumKey"\s*:\s*"([A-Za-z0-9]+)"/);
  if (m1 && m1[1]) return String(m1[1]).trim();
  const m2 = html.match(/AlbumKey"\s*"\s*:\s*"([A-Za-z0-9]+)"/);
  if (m2 && m2[1]) return String(m2[1]).trim();
  const m3 = html.match(/albumKey\s*[:=]\s*"([A-Za-z0-9]+)"/i);
  if (m3 && m3[1]) return String(m3[1]).trim();
  return "";
}

app.get("/smug/resolve-album", async (req, res) => {
  allowCors(res, req);
  const input = String(req.query.url || "").trim();
  if (!input) return res.status(400).json({ error: "missing url" });

  let albumKey = "";
  let nodeKey = "";
  let finalUrl = input;
  let urlPath = "";

  try {
    // Try API resolve first (fast + clean).
    const out = await resolveAlbumKeyViaNodeUrlPath(input);
    albumKey = out.albumKey || "";
    nodeKey = out.nodeKey || "";
    finalUrl = out.finalUrl || input;
    urlPath = out.urlPath || "";
  } catch (e) {
    console.log("resolve-album via node failed:", e && e.message ? e.message : e);
  }

  try {
    // Fallback for edge cases.
    if (!albumKey) albumKey = await resolveAlbumKeyViaHtmlScrape(input);
  } catch (e) {
    console.log("resolve-album via html failed:", e && e.message ? e.message : e);
  }

  return res.json({
    albumKey: albumKey || "",
    AlbumKey: albumKey || "",
    nodeKey: nodeKey || "",
    finalUrl,
    urlPath
  });
});

// Resolve shop node info as well (frontend calls this first)
app.get("/smug/resolve-shop-node", async (req, res) => {
  allowCors(res, req);
  const input = String(req.query.url || "").trim();
  if (!input) return res.status(400).json({ error: "missing url" });

  let albumKey = "";
  let nodeKey = "";
  let finalUrl = input;
  let urlPath = "";

  try {
    const out = await resolveAlbumKeyViaNodeUrlPath(input);
    albumKey = out.albumKey || "";
    nodeKey = out.nodeKey || "";
    finalUrl = out.finalUrl || input;
    urlPath = out.urlPath || "";
  } catch (e) {
    console.log("resolve-shop-node via node failed:", e && e.message ? e.message : e);
  }

  try {
    if (!albumKey) albumKey = await resolveAlbumKeyViaHtmlScrape(input);
  } catch (_) {}

  return res.json({
    nodeKey: nodeKey || "",
    albumKey: albumKey || "",
    AlbumKey: albumKey || "",
    finalUrl,
    urlPath
  });
});


// =========================================================
// ✔ NEW: GLOBAL WRESTLING ALBUM KEYWORD SEARCH (Option A)
// GET /smug/albums-by-keyword?keyword=...
// Crawls /Wrestling folder recursively, caches AlbumKey+Title+Url+Keywords,
// then filters albums whose keyword list matches the query.
// MUST be defined BEFORE /smug/:slug so it isn't treated as a band slug.
// =========================================================
const SMUG_WEB_ORIGIN = "https://vmpix.smugmug.com";

// Cache + build lock (to avoid re-crawling on every click)
const WRESTLING_KEYWORD_CACHE_TTL_MS = Number(process.env.WRESTLING_KEYWORD_CACHE_TTL_MS || (6 * 60 * 60 * 1000)); // 6h default
let _wrestlingAlbumIndex = { builtAt: 0, albums: [] };
let _wrestlingIndexPromise = null;

function _smugEndpointFromUri(uri) {
  const s = String(uri || "").trim();
  if (!s) return "";
  // Accept /api/v2/... or https://api.smugmug.com/api/v2/...
  let out = s.replace(/^https?:\/\/api\.smugmug\.com\/api\/v2/i, "");
  out = out.replace(/^\/api\/v2/i, "");
  if (!out.startsWith("/")) out = "/" + out;
  return out;
}

function _normKw(s) {
  return String(s || "").trim().toLowerCase();
}



// ===============================
// SHOWS SHEET LOOKUP (date -> company/show_name)
// ===============================
function _csvParse(text) {
  const rows = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (!lines.length) return rows;

  function parseLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          // Escaped quote
          if (i + 1 < line.length && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out.map(v => String(v || "").trim());
  }

  // Find header
  let header = null;
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    header = parseLine(line).map(h => String(h || "").trim());
    headerIdx = i;
    break;
  }
  if (!header || headerIdx === -1) return rows;

  const keyIndex = {};
  for (let i = 0; i < header.length; i++) {
    const k = String(header[i] || "").trim();
    if (!k) continue;
    keyIndex[k] = i;
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = parseLine(line);
    const obj = {};
    for (const k in keyIndex) {
      obj[k] = cols[keyIndex[k]] || "";
    }
    rows.push(obj);
  }
  return rows;
}

function _mmddyyFromShowDate(showDate) {
  const s = String(showDate || "").trim();
  if (!s) return "";
  // Accept M/D/YY, MM/DD/YY, M/D/YYYY, MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let y = String(m[3]);
  if (!(mm >= 1 && mm <= 12)) return "";
  if (!(dd >= 1 && dd <= 31)) return "";
  if (y.length === 4) y = y.slice(2);
  if (y.length !== 2) return "";
  const mm2 = String(mm).padStart(2, "0");
  const dd2 = String(dd).padStart(2, "0");
  return `${mm2}${dd2}${y}`;
}

function _normLoose(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function _fetchShowsLookup() {
  // Builds a lookup map: mmddyy -> [{ company, show_name }...]
  const map = Object.create(null);

  const r = await fetch(SHOWS_SHEET_URL);
  const csvText = await r.text();
  const rows = _csvParse(csvText);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const company = String(row.company || row.Company || "").trim();
    const showName = String(row.show_name || row.showName || row.ShowName || row["show_name"] || "").trim();
    const showDate = String(row.show_date || row.showDate || row.ShowDate || row["show_date"] || "").trim();

    const key = _mmddyyFromShowDate(showDate);
    if (!key) continue;

    if (!map[key]) map[key] = [];
    map[key].push({ company, showName });
  }

  return map;
}

function _splitKeywords(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  // SmugMug commonly uses semicolons, but we accept commas too
  return s.split(/[;,]/g).map(x => String(x || "").trim()).filter(Boolean);
}

// ===============================
// DATE HELPERS (UriPath -> Pretty)
// ===============================
// Example UriPath: /Wrestling/Limitless/011626/Match-1
// We extract "011626" (MMDDYY) and format "January 16th, 2026".
function _extractMmddyyFromUriPath(uriPath) {
  const p = String(uriPath || "").trim();
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  // Find the first 6-digit segment (defensive; supports other feds/paths too)
  for (let i = 0; i < parts.length; i++) {
    const seg = String(parts[i] || "").trim();
    if (/^\d{6}$/.test(seg)) return seg;
  }
  return "";
}

function _ordinalSuffix(day) {
  const d = Number(day);
  if (!Number.isFinite(d)) return "th";
  if (d % 100 >= 11 && d % 100 <= 13) return "th";
  if (d % 10 === 1) return "st";
  if (d % 10 === 2) return "nd";
  if (d % 10 === 3) return "rd";
  return "th";
}

function _prettyDateFromMmddyy(mmddyy) {
  const s = String(mmddyy || "").trim();
  if (!/^\d{6}$/.test(s)) return "";
  const mm = Number(s.slice(0, 2));
  const dd = Number(s.slice(2, 4));
  const yy = Number(s.slice(4, 6));
  if (!(mm >= 1 && mm <= 12)) return "";
  if (!(dd >= 1 && dd <= 31)) return "";
  const year = 2000 + yy;
  const date = new Date(year, mm - 1, dd);
  if (isNaN(date.getTime())) return "";
  const monthName = date.toLocaleString("en-US", { month: "long" });
  return `${monthName} ${dd}${_ordinalSuffix(dd)}, ${year}`;
}

function _prettyDateFromUriPath(uriPath) {
  const mmddyy = _extractMmddyyFromUriPath(uriPath);
  if (!mmddyy) return "";
  return _prettyDateFromMmddyy(mmddyy);
}

async function _fetchAllPaged(endpointBase, responseKey) {
  // endpointBase should contain '?', e.g. "/folder/...!albums?count=100"
  const out = [];
  let start = 1;
  let more = true;

  while (more) {
    const joiner = endpointBase.indexOf("?") === -1 ? "?" : "&";
    const endpoint = `${endpointBase}${joiner}start=${start}&count=100&_verbosity=1`;
    const data = await smug(endpoint);

    const resp = (data && data.Response) || {};
    let items = resp[responseKey];

    if (Array.isArray(items)) {
      // ok
    } else if (items) {
      items = [items];
    } else {
      items = [];
    }

    for (let i = 0; i < items.length; i++) out.push(items[i]);

    const pages = resp.Pages || {};
    const total = Number(pages.Total) || 0;
    const count = Number(pages.Count) || items.length || 100;
    const gotSoFar = (start - 1) + items.length;

    if (!total || gotSoFar >= total || items.length === 0) {
      more = false;
    } else {
      start += count;
    }
  }

  return out;
}

async function _crawlFolderRecursive(folderUriOrEndpoint, accumAlbums) {
  const folderEp = _smugEndpointFromUri(folderUriOrEndpoint);
  if (!folderEp) return;

  // 1) albums in this folder
  try {
    const albums = await _fetchAllPaged(`${folderEp}!albums?`, "Album");
    for (let i = 0; i < albums.length; i++) {
      const a = albums[i] || {};
      const albumKey = String(a.AlbumKey || a.Key || "").trim();
      if (!albumKey) continue;

      // Try to keep a usable web URL (some responses include WebUri)
      let url = "";
      if (typeof a.WebUri === "string") url = a.WebUri.trim();
      if (!url && typeof a.Url === "string") url = a.Url.trim();
      if (!url && typeof a.Uri === "string") {
        // As a fallback, provide a stable open-by-key link
        url = `${SMUG_WEB_ORIGIN}/gallery/${encodeURIComponent(albumKey)}`;
      }
      const title = String(a.Title || a.Name || "").trim();

      accumAlbums.push({
        albumKey,
        title,
        url,
        // Keywords filled later
        keywordsRaw: "",
        keywords: []
      });
    }
  } catch (e) {
    console.warn("crawl albums failed for", folderEp, e && e.message ? e.message : e);
  }

  // 2) recurse into subfolders
  try {
    const folders = await _fetchAllPaged(`${folderEp}!folders?`, "Folder");
    for (let i = 0; i < folders.length; i++) {
      const f = folders[i] || {};
      const nextUri = f.Uri || f.FolderUri || "";
      if (!nextUri) continue;
      await _crawlFolderRecursive(nextUri, accumAlbums);
    }
  } catch (e) {
    // Some folders may not expose subfolders; that's fine.
  }
}

async function _buildWrestlingAlbumIndex(force) {
  const now = Date.now();
  if (!force && _wrestlingAlbumIndex.builtAt && (now - _wrestlingAlbumIndex.builtAt) < WRESTLING_KEYWORD_CACHE_TTL_MS) {
    return _wrestlingAlbumIndex;
  }

  // Build lock
  if (_wrestlingIndexPromise) return _wrestlingIndexPromise;

  _wrestlingIndexPromise = (async () => {
    const albums = [];
    // Root wrestling folder
    await _crawlFolderRecursive("/folder/user/vmpix/Wrestling", albums);

    // Deduplicate by AlbumKey (recursive crawl can surface duplicates)
    const seen = new Set();
    const uniq = [];
    for (let i = 0; i < albums.length; i++) {
      const k = String(albums[i].albumKey || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniq.push(albums[i]);
    }

    // Fetch shows sheet once per index build (company/show_name lookup)
    let showsLookup = Object.create(null);
    try {
      showsLookup = await _fetchShowsLookup();
    } catch (e) {
      // Fail-soft: show metadata is optional
      showsLookup = Object.create(null);
    }

    // Fetch keywords per album with small concurrency
    const concurrency = Number(process.env.WRESTLING_KEYWORD_CONCURRENCY || 4);
    let idx = 0;

    async function worker() {
      while (idx < uniq.length) {
        const cur = idx++;
        const item = uniq[cur];
        const key = item.albumKey;

        try {
          const meta = await smug(`/album/${encodeURIComponent(key)}?_verbosity=1`);
          const resp = (meta && meta.Response) || {};
          const album = (resp.Album && Array.isArray(resp.Album)) ? resp.Album[0] : resp.Album;

          const raw =
            (album && typeof album.Keywords === "string") ? album.Keywords :
            (album && typeof album.Keyword === "string") ? album.Keyword :
            "";

                    // Capture UriPath (if available) so the frontend can show a show-date.
          // This is derived from your folder naming convention: /Wrestling/<FED>/MMDDYY/...
          const uriPath = (album && typeof album.UriPath === "string") ? album.UriPath : "";

          // Some SmugMug album responses do not include UriPath. Fall back to parsing the web URL pathname.
          let derivedPath = String(uriPath || "").trim();
          if (!derivedPath) {
            try {
              const u = new URL(String(item.url || "").trim());
              derivedPath = String(u.pathname || "").trim();
            } catch (_) {
              derivedPath = "";
            }
          }

          item.uriPath = derivedPath;
          item.date = _prettyDateFromUriPath(item.uriPath);
// Attach show metadata (company + show name) from Google Sheet by matching date
          const mmddyy = _extractMmddyyFromUriPath(item.uriPath);
          const candidates = (mmddyy && showsLookup && showsLookup[mmddyy]) ? showsLookup[mmddyy] : null;

          let picked = null;
          if (candidates && candidates.length) {
            if (candidates.length === 1) {
              picked = candidates[0];
            } else {
              const pathNorm = _normLoose(item.uriPath);
              for (let j = 0; j < candidates.length; j++) {
                const c = candidates[j] || {};
                const cn = _normLoose(c.company);
                if (cn && pathNorm.indexOf(cn) !== -1) { picked = c; break; }
              }
              if (!picked) picked = candidates[0];
            }
          }

          item.company = picked && picked.company ? String(picked.company) : "";
          item.showName = picked && picked.showName ? String(picked.showName) : "";

          item.keywordsRaw = String(raw || "").trim();
          item.keywords = _splitKeywords(item.keywordsRaw).map(_normKw);
        } catch (e) {
          // Fail-soft: keep album without keywords
          item.keywordsRaw = "";
          item.keywords = [];
          item.uriPath = item.uriPath || "";
          item.date = item.date || "";
          item.company = item.company || "";
          item.showName = item.showName || "";
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) workers.push(worker());
    await Promise.all(workers);

    _wrestlingAlbumIndex = { builtAt: Date.now(), albums: uniq };
    _wrestlingIndexPromise = null;
    return _wrestlingAlbumIndex;
  })();

  try {
    return await _wrestlingIndexPromise;
  } finally {
    // If it throws, clear lock so next request can retry
    // (avoid permanent lock)
    _wrestlingIndexPromise = null;
  }
}

app.get("/smug/albums-by-keyword", async (req, res) => {
  allowCors(res, req);

  const kw =
    String(req.query.keyword || req.query.kw || req.query.q || req.query.term || req.query.name || "").trim();

  if (!kw) return res.status(400).json({ error: "missing keyword" });

  const needle = _normKw(kw);
  const force = String(req.query.force || "").trim() === "1";

  try {
    const idx = await _buildWrestlingAlbumIndex(force);

    // Match rule: exact keyword match OR substring match (handles "Nate Speckman" vs "Speckman")
    const results = (idx.albums || []).filter(a => {
      const list = Array.isArray(a.keywords) ? a.keywords : [];
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        if (!k) continue;
        if (k === needle) return true;
        if (k.indexOf(needle) !== -1) return true;
        if (needle.indexOf(k) !== -1) return true;
      }
      return false;
    }).map(a => ({
      albumKey: a.albumKey,
      AlbumKey: a.albumKey,
      title: a.title,
      Title: a.title,
      url: a.url,
      Url: a.url,
      // Derived from UriPath segment MMDDYY -> "January 16th, 2026" (best-effort)
      date: a.date || "",
      Date: a.date || "",
      // Show metadata (from Google Sheet by date; best-effort)
      company: a.company || "",
      Company: a.company || "",
      showName: a.showName || "",
      ShowName: a.showName || "",
      uriPath: a.uriPath || "",
      UriPath: a.uriPath || "",
      // optional: return raw keywords for debugging if needed
      keywords: a.keywordsRaw
    }));

    return res.json({
      keyword: kw,
      count: results.length,
      albums: results
    });
  } catch (e) {
    console.error("albums-by-keyword failed:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "albums-by-keyword failed" });
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



function fetchStreamWithRedirects(inputUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    try {
      if (!inputUrl || redirectsLeft < 0) return reject(new Error("Too many redirects"));
      const u = new URL(inputUrl);
      const lib = u.protocol === "https:" ? https : http;

      const req = lib.get(
        inputUrl,
        {
          headers: {
            "User-Agent": "MusicArchiveZip/1.0",
            "Accept": "*/*",
          },
        },
        (res) => {
          const code = res.statusCode || 0;

          // Redirects
          if (code >= 300 && code < 400 && res.headers.location) {
            const next = new URL(res.headers.location, inputUrl).toString();
            res.resume();
            return resolve(fetchStreamWithRedirects(next, redirectsLeft - 1));
          }

          if (code < 200 || code >= 300) {
            res.resume();
            return reject(new Error(`HTTP ${code} for ${inputUrl}`));
          }

          return resolve(res);
        }
      );

      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}


// =========================================================
// ✔ NEW: ZIP BUILDER (multi-download)
// Expects: { items: [{ url, filename }, ...] }
// Returns: application/zip stream
// =========================================================
app.options("/zip", (req, res) => {
  allowCors(res, req);
  return res.status(204).send("");
});

app.post("/zip", async (req, res) => {
  try {
    allowCors(res, req);

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).send("No items provided");
    if (items.length > 120) return res.status(400).send("Too many items (max 120)");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="photos.zip"');

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("warning", (err) => {
      console.warn("zip warning:", err);
    });

    archive.on("error", (err) => {
      console.error("zip error:", err);
      try { if (!res.headersSent) res.status(500).send("ZIP error"); } catch (_) {}
      try { res.end(); } catch (_) {}
    });

    archive.pipe(res);

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const url = String(it.url || "").trim();
      let filename = String(it.filename || `photo-${i + 1}.jpg`).trim();

      // basic sanitization
      filename = filename.replace(/[\/\\:*?"<>|]+/g, "-").slice(0, 160) || `photo-${i + 1}.jpg`;

      if (!/^https?:\/\//i.test(url)) continue;

      // Server-to-server fetch as stream (no global fetch needed)
      let stream;
      try {
        stream = await fetchStreamWithRedirects(url);
      } catch (e) {
        console.warn("zip fetch failed:", String(e && e.message ? e.message : e), url);
        continue;
      }

      archive.append(stream, { name: filename });
    }

    await archive.finalize();
  } catch (err) {
    console.error("POST /zip failed:", err);
    try {
      allowCors(res, req);
      return res.status(500).send("ZIP failed");
    } catch (_) {
      try { res.end(); } catch (_) {}
    }
  }
});

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











