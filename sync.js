/* Sync lead ticks across browsers through a private (secret) GitHub gist.
   The token is kept only in this browser's localStorage. */
(function () {
  var KEYS = ["leadstatus", "sheetdb"];
  var FILE = "tql-lead-ticks.json";
  var API = window.TQL_SYNC_API || "https://api.github.com";
  var T = "ghsync_token", G = "ghsync_gist", D = "ghsync_dirty", S = "ghsync_snap";
  var ls = window.localStorage;
  function get(k) { try { return ls.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { rawSet.call(ls, k, v); } catch (e) {} }
  function del(k) { try { ls.removeItem(k); } catch (e) {} }
  var rawSet = Storage.prototype.setItem;

  function snapshot() {
    var o = {};
    KEYS.forEach(function (k) { var v = get(k); if (v) { try { o[k] = JSON.parse(v); } catch (e) {} } });
    return o;
  }
  function canon(o) { return JSON.stringify(KEYS.map(function (k) { return o[k] || {}; })); }

  /* ---------- status pill ---------- */
  var css = document.createElement("style");
  css.textContent = ".tqls{position:fixed;right:14px;bottom:14px;z-index:50;font:600 12px system-ui,sans-serif;padding:6px 12px;border-radius:99px;border:1px solid #0093d0;background:Canvas;color:#0093d0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}.tqls.ok{background:#0093d0;color:#fff}.tqls.err{border-color:#c0392b;color:#c0392b}" +
    ".tqlp{position:fixed;right:14px;bottom:56px;z-index:51;width:min(380px,calc(100vw - 28px));background:Canvas;color:CanvasText;border:1px solid #0093d0;border-radius:12px;padding:14px 16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18)}.tqlp input{width:100%;box-sizing:border-box;padding:7px 9px;margin:6px 0 10px;font:13px ui-monospace,monospace;border:1px solid #999;border-radius:6px;background:Canvas;color:CanvasText}.tqlp button{font:600 13px system-ui;padding:6px 12px;border-radius:6px;border:1px solid #0093d0;background:#0093d0;color:#fff;cursor:pointer;margin-right:6px}.tqlp button.alt{background:transparent;color:#0093d0}.tqlp a{color:#0093d0}.tqlp p{margin:0 0 8px}";
  document.head.appendChild(css);
  var pill = document.createElement("button");
  pill.type = "button"; pill.className = "tqls";
  document.body.appendChild(pill);
  function status(text, cls) { pill.textContent = text; pill.className = "tqls" + (cls ? " " + cls : ""); }

  var panel = null;
  function openPanel() {
    if (panel) { panel.remove(); panel = null; return; }
    panel = document.createElement("div"); panel.className = "tqlp";
    var on = !!get(T);
    panel.innerHTML = on
      ? "<p><b>Sync is on.</b> Ticks save to a private gist on your GitHub and load in any browser where you've pasted the same token.</p><button type='button' data-a='now'>Sync now</button><button type='button' class='alt' data-a='off'>Turn off in this browser</button>"
      : "<p><b>Sync ticks across browsers</b></p><p>Paste a GitHub token with only the <b>gist</b> permission. <a href='https://github.com/settings/tokens/new?scopes=gist&description=TQL%20lead%20ticks' target='_blank' rel='noopener'>Make one here ↗</a> (set expiration to No expiration if you like). Use the same token in each browser.</p><input type='password' placeholder='ghp_...' autocomplete='off'><button type='button' data-a='save'>Turn on sync</button><button type='button' class='alt' data-a='close'>Cancel</button>";
    document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      var a = e.target.getAttribute && e.target.getAttribute("data-a");
      if (a === "close") { openPanel(); }
      if (a === "off") { del(T); del(G); del(D); del(S); openPanel(); status("Sync off"); }
      if (a === "now") { openPanel(); pull(true); }
      if (a === "save") {
        var v = panel.querySelector("input").value.trim();
        if (!v) return;
        put(T, v); del(G); openPanel(); first = true; pull(true);
      }
    });
  }
  pill.addEventListener("click", openPanel);

  /* ---------- GitHub ---------- */
  function gh(method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: { "Authorization": "Bearer " + get(T), "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 401 ? "Token not accepted" : "GitHub error " + r.status);
      return r.json();
    });
  }
  function findGist() {
    var id = get(G);
    if (id) return Promise.resolve(id);
    return gh("GET", "/gists?per_page=100").then(function (list) {
      for (var i = 0; i < list.length; i++) if (list[i].files && list[i].files[FILE]) { put(G, list[i].id); return list[i].id; }
      var files = {}; files[FILE] = { content: JSON.stringify(snapshot()) };
      return gh("POST", "/gists", { description: "TQL lead ticks (synced by the lead pages)", public: false, files: files }).then(function (g) { put(G, g.id); put(S, canon(snapshot())); return g.id; });
    });
  }
  function readRemote(id) {
    return gh("GET", "/gists/" + id).then(function (g) {
      var f = g.files && g.files[FILE];
      if (!f) return {};
      if (f.truncated && f.raw_url) return fetch(f.raw_url, { cache: "no-store" }).then(function (r) { return r.json(); });
      try { return JSON.parse(f.content || "{}"); } catch (e) { return {}; }
    });
  }

  var busy = false, first = false;
  function apply(remote) {
    var changed = canon(remote) !== canon(snapshot());
    KEYS.forEach(function (k) { if (remote[k]) put(k, JSON.stringify(remote[k])); else del(k); });
    put(S, canon(remote));
    if (changed) { status("Loading ticks…"); location.reload(); }
  }
  function pull(manual) {
    if (!get(T) || busy) return;
    busy = true; status("Syncing…");
    findGist().then(function (id) {
      return readRemote(id).then(function (remote) {
        var local = snapshot();
        var remoteEmpty = canon(remote) === canon({});
        // first connect in a browser: keep whichever side has ticks; if both do, merge (local wins per lead)
        if (first) {
          first = false;
          var merged = {};
          KEYS.forEach(function (k) { merged[k] = Object.assign({}, remote[k] || {}, local[k] || {}); });
          if (canon(merged) !== canon(remote)) return push(id, merged).then(function () { apply(merged); });
          return apply(remote);
        }
        if (get(D) === "1") return push(id, local);       // unsent local edits win
        if (remoteEmpty && canon(local) !== canon({})) return push(id, local);
        apply(remote);
      });
    }).then(function () { busy = false; if (get(T)) status("Synced ✓", "ok"); })
      .catch(function (e) { busy = false; status("Sync error: " + e.message, "err"); });
  }
  function push(id, obj) {
    var files = {}; files[FILE] = { content: JSON.stringify(obj) };
    return gh("PATCH", "/gists/" + id, { files: files }).then(function () { del(D); put(S, canon(obj)); });
  }

  var timer = null;
  function schedulePush() {
    if (!get(T)) return;
    put(D, "1"); status("Saving…");
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (busy) { schedulePush(); return; }
      busy = true;
      findGist().then(function (id) { return push(id, snapshot()); })
        .then(function () { busy = false; status("Synced ✓", "ok"); })
        .catch(function (e) { busy = false; status("Not saved: " + e.message, "err"); });
    }, 1200);
  }
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === ls && KEYS.indexOf(k) !== -1) schedulePush();
  };

  if (get(T)) { status("Syncing…"); pull(); } else status("Sync off");
  var last = Date.now();
  function refocus() { if (document.visibilityState === "visible" && Date.now() - last > 3000) { last = Date.now(); if (get(D) !== "1") pull(); } }
  document.addEventListener("visibilitychange", refocus);
  window.addEventListener("focus", refocus);
})();
