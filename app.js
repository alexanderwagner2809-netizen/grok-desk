/* Grok Bot desk — STEP 8 plan B static app. No made-up numbers. */
(() => {
  const RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const LABELS = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
  const LS_D = "grokdesk.dataPath";
  const LS_READ = "grokdesk.activityReadAt";

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const params = new URLSearchParams(location.search);
  const DEMO = params.get("demo"); // empty | error | null

  let dataPath = localStorage.getItem(LS_D) || "";
  let route = { name: "home" };
  let state = null;
  let account = null;
  let settings = null;
  let activity = [];
  let agentFull = {};
  let charts = {};
  let coinCache = {};
  let auditCache = {};
  let range = "LIVE";
  let lastGoodAt = null;
  let offline = false;
  let retryIn = 0;
  let searchOpen = false;
  let toastTimer = null;
  let loadedOnce = false;
  let forceError = false;
  const fetchedOk = new Set();
  let beamToken = 0;

  function parseHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    const bits = raw.split("&").filter(Boolean);
    let path = "";
    bits.forEach((b) => {
      if (b.startsWith("d=")) {
        dataPath = decodeURIComponent(b.slice(2));
        if (dataPath) localStorage.setItem(LS_D, dataPath);
      } else if (b.startsWith("t=")) {
        /* plan A token, ignored on plan B */
      } else if (!path) {
        path = b.startsWith("/") ? b : "/" + b;
      }
    });
    // Also support #/home style as the only hash after strip
    if (!path && raw.startsWith("/")) path = raw.split("&")[0];
    // Strip d= from the address bar after storing.
    if (raw.includes("d=")) {
      const keep = bits.filter((b) => !b.startsWith("d=") && !b.startsWith("t=")).join("&");
      history.replaceState(null, "", location.pathname + location.search + (keep ? "#" + keep : "#/home"));
      path = keep.startsWith("/") ? keep : path || "/home";
    }
    route = parseRoute(path || "/home");
  }

  function parseRoute(path) {
    const p = (path || "/home").replace(/^#/, "");
    const parts = p.split("/").filter(Boolean);
    const name = parts[0] || "home";
    if (name === "coin") return { name: "coin", mint: parts[1] || "" };
    if (name === "auditor") return { name: "auditor", mint: parts[1] || "" };
    if (["home", "agents", "activity", "account"].includes(name)) return { name };
    return { name: "home" };
  }

  function go(path) {
    location.hash = path.startsWith("/") ? path : "/" + path;
  }

  function currentDataPath() {
    if (!dataPath) dataPath = localStorage.getItem(LS_D) || "";
    return dataPath;
  }

  function baseUrl() {
    const d = currentDataPath();
    if (!d) return null;
    // Relative to this app (Pages project root or local /)
    return "d/" + d + "/";
  }

  async function getJSON(rel) {
    const b = baseUrl();
    if (!b) throw new Error("no-data-path");
    const key = rel.split("?")[0];
    // Error demo: first successful read of each file is kept, later polls fail.
    if (DEMO === "error" && forceError && fetchedOk.has(key)) {
      throw new Error("offline");
    }
    const url = b + rel + (rel.includes("?") ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    fetchedOk.add(key);
    return data;
  }

  function emptyNight() {
    const agents = AGENTS.map((name) => {
      const colors = { scanner: "#64d2ff", auditor: "#ffffff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a" };
      const base = { name, color: colors[name], status: "idle", ok: false, paused: false, count: 0 };
      if (name === "scanner") Object.assign(base, { card: "0 pools", feed: [], empty: "Listening for graduations" });
      if (name === "auditor") Object.assign(base, { card: "0 taken apart", layers: [], rejected: 0, empty: "No coin taken apart yet" });
      if (name === "analyst") Object.assign(base, { card: "Scoring", score: null, minScore: 70 });
      if (name === "executor") Object.assign(base, { card: "0 trades", detail: null, bar: null });
      if (name === "risk") Object.assign(base, { card: "Guarding", lastExit: null, openCount: 0, pills: { stop: "stop -6%", trail: "trail 12%" } });
      return base;
    });
    return {
      ts: new Date().toISOString(),
      mode: "PAPER",
      balance: 200,
      startStack: 200,
      todayPct: 0,
      multiplier: 1,
      running: 0,
      agents,
      activity: [],
    };
  }

  function emptyChart() {
    const now = Math.floor(Date.now() / 1000);
    return { range, start: 200, points: [{ t: now - 60, value: 200 }, { t: now, value: 200 }], marks: [], empty: true };
  }

  function emptyAccount() {
    return {
      mode: "PAPER",
      handle: "alex020809",
      profileUrl: "https://fomo.family/profile/alex020809?source=share_link&r=savipww",
      inviteUrl: "https://fomo.family/r/savipww",
      signupUrl: "https://fomo.family/r/savipww",
      stack: 200,
      balance: 200,
      telegramConnected: false,
      hosting: "B",
      readOnly: true,
      webPushAvailable: false,
      webPushMessage: "web push not available on this hosting, pushes come via Telegram",
    };
  }

  async function loadAll() {
    if (DEMO === "empty") {
      state = emptyNight();
      activity = [];
      account = emptyAccount();
      settings = { readOnly: true, groups: {} };
      charts[range] = emptyChart();
      lastGoodAt = new Date();
      offline = false;
      loadedOnce = true;
      return;
    }
    try {
      const [st, act, acc, set, ch] = await Promise.all([
        getJSON("state.json"),
        getJSON("activity.json"),
        getJSON("account.json"),
        getJSON("settings.json"),
        getJSON("chart/" + range + ".json"),
      ]);
      state = st;
      activity = (act && act.items) || st.activity || [];
      account = acc;
      settings = set;
      charts[range] = ch;
      lastGoodAt = new Date();
      offline = false;
      loadedOnce = true;
    } catch (e) {
      if (loadedOnce && state) {
        offline = true;
        retryIn = 8;
      } else {
        offline = true;
        retryIn = 8;
      }
    }
  }

  async function loadRange(r) {
    range = r;
    if (DEMO === "empty") {
      charts[r] = emptyChart();
      return;
    }
    try {
      charts[r] = await getJSON("chart/" + r + ".json");
      offline = false;
    } catch (e) {
      offline = true;
    }
  }

  async function loadCoin(mint) {
    if (!mint) return null;
    if (DEMO === "empty") return { mint, label: null, candles: [], stats: {}, position: null, exitLines: null };
    if (coinCache[mint]) return coinCache[mint];
    if (DEMO === "error" && forceError) return null;
    try {
      const c = await getJSON("coin/" + mint + ".json");
      coinCache[mint] = c;
      return c;
    } catch (e) {
      return coinCache[mint] || null;
    }
  }

  async function loadAudit(mint) {
    if (!mint) return null;
    if (DEMO === "empty") return { mint, layers: [], passed: null, status: null };
    try {
      const a = await getJSON("audit/" + mint + ".json");
      auditCache[mint] = a;
      return a;
    } catch (e) {
      return auditCache[mint] || { mint, layers: [], passed: null, status: null };
    }
  }

  async function loadAgent(name) {
    if (DEMO === "empty") return state.agents.find((a) => a.name === name);
    try {
      const a = await getJSON("agents/" + name + ".json");
      agentFull[name] = a;
      return a;
    } catch (e) {
      return agentFull[name] || (state && state.agents.find((x) => x.name === name));
    }
  }

  /* ---------- formatters (honest, no fakes) ---------- */
  function fmtMoney(n, asPrice) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const x = Number(n);
    const abs = Math.abs(x);
    let d = 2;
    if (asPrice) {
      if (abs === 0) d = 2;
      else if (abs < 0.000001) d = 10;
      else if (abs < 0.0001) d = 8;
      else if (abs < 0.01) d = 6;
      else if (abs < 1) d = 4;
      else d = 2;
    }
    const sign = x < 0 ? "-" : "";
    return sign + "$" + abs.toFixed(d);
  }
  function fmtPct(n, signed) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const x = Number(n);
    const body = (signed ? (x > 0 ? "+" : "") : x > 0 && signed !== false ? "" : "") + x.toFixed(2) + "%";
    if (signed) return (x > 0 ? "+" : "") + x.toFixed(2) + "%";
    return x.toFixed(2) + "%";
  }
  function fmtToday(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const x = Number(n);
    const sign = x >= 0 ? "+" : "";
    return sign + x.toFixed(2) + "%";
  }
  function fmtMult(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toFixed(2) + "×";
  }
  function fmtUsdShort(n) {
    if (n == null || Number.isNaN(Number(n))) return "n/a";
    const x = Number(n);
    if (Math.abs(x) >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
    if (Math.abs(x) >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
    return "$" + x.toFixed(0);
  }
  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  }
  function fmtLastUpdate(d) {
    if (!d) return "—";
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  }
  function fmtDur(s) {
    if (s == null) return "—";
    const n = Math.max(0, Number(s));
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    if (h) return h + "h " + m + "m";
    return m + "m";
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- chrome ---------- */
  function iconAvatar() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2c1.4-3.2 3.7-4.7 6.5-4.7s5.1 1.5 6.5 4.7"/></svg>`;
  }
  function iconSearch() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.2"/><path d="M16.2 16.2L20 20" stroke-linecap="round"/></svg>`;
  }
  function iconBell() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.2 2H4.8L6 16z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0" stroke-linecap="round"/></svg>`;
  }
  function tabIcon(name, on) {
    const c = "currentColor";
    if (name === "home") return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5z"/></svg>`;
    if (name === "agents") return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><circle cx="8" cy="9" r="2.2"/><circle cx="16" cy="9" r="2.2"/><circle cx="12" cy="14.5" r="2.2"/><path d="M4.5 19c.8-2.2 2.2-3.2 3.5-3.2M19.5 19c-.8-2.2-2.2-3.2-3.5-3.2M9.2 19c.6-1.6 1.6-2.3 2.8-2.3s2.2.7 2.8 2.3"/></svg>`;
    if (name === "activity") return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><path d="M5 6h14M5 12h14M5 18h10" stroke-linecap="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2c1.4-3.2 3.7-4.7 6.5-4.7s5.1 1.5 6.5 4.7"/></svg>`;
  }

  function hasUnread() {
    const items = activity || [];
    if (!items.length) return false;
    const readAt = localStorage.getItem(LS_READ);
    if (!readAt) return true;
    const t = Date.parse(items[0].ts);
    return Number.isFinite(t) && t > Date.parse(readAt);
  }

  function renderNavbar() {
    const nav = $("navbar");
    const onAccount = route.name === "account";
    const showSearchBell = route.name === "home" || route.name === "activity" || route.name === "agents" || route.name === "account";
    const unread = hasUnread();
    nav.innerHTML = "";
    const av = el("button", "avatar hit");
    av.setAttribute("aria-label", "Account");
    av.innerHTML = iconAvatar();
    av.addEventListener("click", () => go("/account"));
    nav.appendChild(av);

    const brand = el("button", "brand");
    brand.innerHTML = `Grok Bot<span class="chev">›</span>`;
    brand.addEventListener("click", () => go("/home"));
    nav.appendChild(brand);
    nav.appendChild(el("div", "nav-spacer"));

    if (showSearchBell) {
      const s = el("button", "icon-btn");
      s.setAttribute("aria-label", "Search");
      s.innerHTML = iconSearch();
      s.addEventListener("click", () => toggleSearch(true));
      nav.appendChild(s);
      const b = el("button", "icon-btn");
      b.setAttribute("aria-label", "Notifications");
      b.innerHTML = iconBell() + `<span class="unread-dot"${unread ? "" : " hidden"}></span>`;
      b.addEventListener("click", () => {
        localStorage.setItem(LS_READ, new Date().toISOString());
        go("/activity");
        renderNavbar();
      });
      nav.appendChild(b);
    }
    void onAccount;
  }

  function renderBanner() {
    const b = $("errorBanner");
    if (!offline) {
      b.hidden = true;
      b.textContent = "";
      return;
    }
    b.hidden = false;
    b.textContent = `Desk offline · retrying in ${Math.max(0, retryIn)}s · last update ${fmtLastUpdate(lastGoodAt)}`;
  }

  function renderTabs() {
    const bar = $("tabbar");
    const tabs = [
      ["home", "Home"],
      ["agents", "Agents"],
      ["activity", "Activity"],
      ["account", "Account"],
    ];
    const on = route.name === "coin" || route.name === "auditor" ? "home" : route.name;
    bar.innerHTML = "";
    tabs.forEach(([id, label]) => {
      const t = el("button", "tab" + (on === id ? " on" : ""));
      t.innerHTML = tabIcon(id, on === id) + `<span>${label}</span>`;
      t.addEventListener("click", () => go("/" + id));
      bar.appendChild(t);
    });
  }

  function toggleSearch(open) {
    searchOpen = open;
    const sheet = $("searchSheet");
    if (!open) {
      sheet.hidden = true;
      sheet.innerHTML = "";
      return;
    }
    sheet.hidden = false;
    sheet.innerHTML = `<input class="search-input" id="q" placeholder="Name, symbol or mint" autocomplete="off">
      <div id="searchResults"></div>`;
    const q = $("q");
    q.addEventListener("input", () => renderSearch(q.value));
    q.focus();
    renderSearch("");
  }

  function allCoins() {
    const map = new Map();
    const add = (mint, name, symbol, label) => {
      if (!mint) return;
      if (!map.has(mint)) map.set(mint, { mint, name, symbol, label: label || name || symbol || mint.slice(0, 8) });
    };
    (state && state.agents || []).forEach((a) => {
      (a.feed || []).forEach((f) => add(f.mint, null, null, f.label));
    });
    activity.forEach((r) => add(r.mint, r.name, r.symbol, r.label));
    return [...map.values()];
  }

  function renderSearch(q) {
    const box = $("searchResults");
    if (!box) return;
    const s = (q || "").trim().toLowerCase();
    const items = allCoins().filter((c) => {
      if (!s) return true;
      return (c.label || "").toLowerCase().includes(s)
        || (c.name || "").toLowerCase().includes(s)
        || (c.symbol || "").toLowerCase().includes(s)
        || (c.mint || "").toLowerCase().includes(s);
    });
    if (!items.length) {
      box.innerHTML = `<div class="empty-note">${s ? "No matches" : "No coins yet"}</div>`;
      return;
    }
    box.innerHTML = "";
    items.slice(0, 40).forEach((c) => {
      const row = el("button", "search-hit");
      row.innerHTML = `<div><div>${escapeHtml(c.label)}</div><div class="sub">${escapeHtml((c.mint || "").slice(0, 12) + "…")}</div></div>`;
      row.addEventListener("click", () => {
        toggleSearch(false);
        go("/coin/" + c.mint);
      });
      box.appendChild(row);
    });
  }

  /* ---------- odometer ---------- */
  function renderOdometer(host, value) {
    const text = fmtMoney(value, false); // $200.00
    const prev = host.getAttribute("data-val");
    const reduce = window.ChartKit && ChartKit.reduceMotion && ChartKit.reduceMotion();
    host.setAttribute("data-val", text);
    host.innerHTML = "";
    const chars = text.split("");
    // stagger right to left: rightmost digit first (delay 0), then leftward +30ms
    const digitIdx = [];
    chars.forEach((ch, i) => { if (/\d/.test(ch)) digitIdx.push(i); });
    chars.forEach((ch, i) => {
      if (!/\d/.test(ch)) {
        const s = el("span", "od-static");
        s.textContent = ch;
        host.appendChild(s);
        return;
      }
      const col = el("span", "od-digit");
      const strip = el("span", "od-strip");
      for (let d = 0; d <= 9; d++) {
        const n = el("span");
        n.textContent = String(d);
        strip.appendChild(n);
      }
      const target = Number(ch);
      const fromRight = digitIdx.length - 1 - digitIdx.indexOf(i);
      const delay = fromRight * 30;
      const apply = () => { strip.style.transform = `translateY(${-target}em)`; };
      if (reduce || !prev) {
        strip.style.transition = "none";
        apply();
      } else {
        const oldCh = (prev[i] && /\d/.test(prev[i])) ? Number(prev[i]) : 0;
        strip.style.transition = "none";
        strip.style.transform = `translateY(${-oldCh}em)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            strip.style.transition = `transform 600ms ease-out ${delay}ms`;
            apply();
          });
        });
      }
      col.appendChild(strip);
      host.appendChild(col);
    });
  }

  /* ---------- HOME ---------- */
  function agentCardNode(a, clickable) {
    const card = el("article", "agent-card");
    if (clickable) card.style.cursor = "pointer";
    const name = LABELS[a.name] || a.name;
    const running = a.status === "running";
    const color = a.color || "#fff";
    let body = "";
    if (a.name === "scanner") {
      if (a.empty && !(a.feed && a.feed.length)) {
        body = `<div class="ac-empty">${escapeHtml(a.empty)}</div>`;
      } else {
        body = `<div>${(a.feed || []).map((f) => {
          const killed = f.verdict && f.verdict !== "pass";
          const cls = killed ? "killed" : "pass";
          return `<div class="feed-row ${cls}"><span class="label">${escapeHtml(f.label || "")}</span><span class="reason">${escapeHtml(f.subtitle || f.reason || "")}</span></div>`;
        }).join("")}</div>`;
      }
    } else if (a.name === "auditor") {
      const strips = (a.layers || []).map((L) => {
        const cls = L.pass === true ? "ok" : L.pass === false ? "bad" : "";
        return `<div class="layer-strip ${cls}"><span class="mark"></span><span>${escapeHtml((L.n || "") + (L.name ? " " + L.name : ""))}</span></div>`;
      }).join("");
      const headline = a.headline ? `<div style="color:${color}">${escapeHtml(a.headline)}</div>` : "";
      const empty = a.empty && !(a.layers && a.layers.some((L) => L.name)) ? `<div class="ac-empty">${escapeHtml(a.empty)}</div>` : "";
      const rej = a.rejected ? `<div style="margin-top:8px;color:var(--secondary)">${a.rejected} rejected</div>` : "";
      body = empty || `${headline}<div class="layers-grid">${strips}</div>${rej}`;
    } else if (a.name === "analyst") {
      body = `<div class="score-row"><canvas data-ring="${a.name}"></canvas>
        <div>${a.score == null ? `<div class="ac-empty">No score yet</div>` : `<div>Score ${a.score}</div>`}</div></div>`;
    } else if (a.name === "executor") {
      const detail = a.detail ? `<div>${escapeHtml(a.detail)}</div>` : "";
      const bar = a.bar ? `<div class="exec-bar">${escapeHtml(a.bar)}</div>` : "";
      const empty = a.count ? detail + bar : `<div class="ac-empty">No trades yet</div>`;
      body = empty;
    } else if (a.name === "risk") {
      const last = a.lastExit ? `<div>${escapeHtml(a.lastExit)}</div>` : `<div class="ac-empty">No exits yet</div>`;
      const pills = a.pills ? `<div class="pills"><span class="pill stop">${escapeHtml(a.pills.stop)}</span><span class="pill trail">${escapeHtml(a.pills.trail)}</span></div>` : "";
      body = last + pills;
    }
    card.innerHTML = `
      <div class="ac-top">
        <div class="ac-name" style="color:${color}"><span class="dot${running ? " on" : ""}"></span>${escapeHtml(name)}</div>
      </div>
      <div class="ac-count">${escapeHtml(a.card || "")}</div>
      <div class="ac-body">${body}</div>`;
    if (clickable) card.addEventListener("click", () => go("/agents"));
    return card;
  }

  function paintCardExtras(root) {
    root.querySelectorAll("canvas[data-ring]").forEach((cv) => {
      const name = cv.getAttribute("data-ring");
      const a = (state.agents || []).find((x) => x.name === name);
      ChartKit.ring(cv, { score: a && a.score, min: (a && a.minScore) || 70 });
    });
  }

  function renderHome() {
    const main = $("main");
    main.innerHTML = "";
    if (!state) {
      main.innerHTML = `
        <div class="skel" style="height:66px;width:70%;margin:8px 0 10px"></div>
        <div class="skel" style="height:22px;width:40%;margin:0 0 14px"></div>
        <div class="skel" style="height:200px;width:100%;margin:0 0 12px"></div>
        <div class="skel" style="height:32px;width:100%;margin:0 0 22px"></div>
        <div class="skel agent-card" style="margin:0"></div>`;
      return;
    }
    const row = el("div", "balance-row");
    const od = el("div", "odometer");
    od.setAttribute("aria-label", "Balance");
    row.appendChild(od);
    if ((state.mode || "PAPER") === "PAPER") {
      const pill = el("span", "paper-pill");
      pill.textContent = "PAPER";
      row.appendChild(pill);
    }
    main.appendChild(row);
    renderOdometer(od, state.balance);

    const meta = el("div", "hero-meta");
    const pct = Number(state.todayPct);
    const pcls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    meta.innerHTML = `<span class="today-pct ${pcls}">${fmtToday(state.todayPct)}</span>
      <span class="mult-pill">${fmtMult(state.multiplier)}</span>`;
    main.appendChild(meta);

    const wrap = el("div", "chart-wrap");
    const cv = document.createElement("canvas");
    wrap.appendChild(cv);
    main.appendChild(wrap);
    const ch = charts[range] || { points: [], marks: [], start: state.startStack, empty: true };
    ChartKit.line(cv, ch);

    const sw = el("div", "range-switch");
    RANGES.forEach((r) => {
      const b = el("button", r === range ? "on" : "");
      b.textContent = r;
      b.addEventListener("click", async () => {
        await loadRange(r);
        renderAll();
      });
      sw.appendChild(b);
    });
    main.appendChild(sw);

    const running = state.running != null ? state.running : (state.agents || []).filter((a) => a.status === "running").length;
    const headA = el("div", "section-head");
    headA.innerHTML = `<span>Agents · <span class="dim">${running} running</span></span>`;
    main.appendChild(headA);

    const car = el("div", "carousel");
    (state.agents || []).forEach((a) => car.appendChild(agentCardNode(a, true)));
    main.appendChild(car);
    paintCardExtras(car);

    const headB = el("div", "section-head");
    const see = el("button", "link");
    see.textContent = "See all";
    see.addEventListener("click", () => go("/activity"));
    headB.innerHTML = `<span>Activity</span>`;
    headB.appendChild(see);
    // rebuild to "Activity · See all"
    headB.innerHTML = "";
    const left = el("span");
    left.innerHTML = `Activity · `;
    const see2 = el("button", "link");
    see2.textContent = "See all";
    see2.style.minHeight = "auto";
    see2.style.display = "inline";
    see2.style.color = "var(--secondary)";
    see2.addEventListener("click", () => go("/activity"));
    left.appendChild(see2);
    // Simpler: one line "Activity · See all" with See all tappable
    const title = el("span");
    title.textContent = "Activity · ";
    const link = el("button", "link");
    link.textContent = "See all";
    link.addEventListener("click", () => go("/activity"));
    headB.appendChild(title);
    headB.appendChild(link);
    // The spec is a section header 'Activity · See all'. Keep both on one row.
    headB.style.justifyContent = "flex-start";
    headB.style.gap = "0";
    link.style.minHeight = "44px";
    main.appendChild(headB);

    const last5 = (state.activity || activity || []).slice(0, 5);
    if (!last5.length) {
      main.appendChild(el("div", "empty-note", "Nothing yet tonight"));
    } else {
      main.appendChild(activityList(last5));
    }
  }

  function activityList(items) {
    const ul = el("div", "act-list");
    items.forEach((r) => ul.appendChild(activityRow(r)));
    return ul;
  }

  function activityRow(r) {
    const btn = el("button", "act-row");
    const title = r.title || defaultTitle(r);
    const sub = r.subtitle || defaultSub(r);
    const val = r.value || defaultVal(r);
    let vcls = "";
    if (r.kind === "sold" || (typeof val === "string" && val.startsWith("+"))) vcls = "up";
    if (r.kind === "stopped" || (typeof val === "string" && val.startsWith("-"))) vcls = "down";
    if (r.kind === "rejected" || val === "Skipped") vcls = "skip";
    btn.innerHTML = `<div class="title">${escapeHtml(title)}</div>
      <div class="val ${vcls}">${escapeHtml(val)}</div>
      <div class="sub">${escapeHtml(sub)}</div>`;
    btn.addEventListener("click", () => {
      if (!r.mint) return;
      if (r.kind === "rejected" || r.tap === "auditor") go("/auditor/" + r.mint);
      else go("/coin/" + r.mint);
    });
    return btn;
  }

  function defaultTitle(r) {
    const x = r.label || r.symbol || r.name || "";
    const map = { bought: "Bought ", sold: "Sold ", stopped: "Stopped ", rejected: "Rejected " };
    if (map[r.kind]) return map[r.kind] + x;
    return r.title || x || "Update";
  }
  function defaultSub(r) {
    if (r.subtitle) return r.subtitle;
    const agent = LABELS[r.agent] || r.agent || "";
    if (r.kind === "bought") return `${agent} · ${fmtTime(r.ts)}`;
    if (r.kind === "sold") return `${agent} · trailing stop`;
    if (r.kind === "stopped") return `${agent} · stop`;
    if (r.kind === "rejected" && r.agent === "analyst") return `Analyst · ${r.reason || "rejected"}`;
    if (r.kind === "rejected") return `${agent} · ${r.reason || ""}`.trim();
    return `${agent} · ${fmtTime(r.ts)}`;
  }
  function defaultVal(r) {
    if (r.value) return r.value;
    if (r.kind === "rejected") return "Skipped";
    return "";
  }

  /* ---------- AGENTS TAB ---------- */
  async function renderAgents() {
    const main = $("main");
    main.innerHTML = `<div class="page-title">Agents</div>`;
    if (!state) {
      main.innerHTML += `<div class="skel" style="height:220px;margin-bottom:14px"></div>`.repeat(3);
      return;
    }
    for (const name of AGENTS) {
      const a = await loadAgent(name);
      main.appendChild(agentFullCard(a || { name }));
    }
  }

  function agentFullCard(a) {
    const box = el("section", "agent-full");
    const running = a.status === "running";
    const paused = !!a.paused;
    const count = a.count != null ? a.count : 0;
    const todayLabel = todayCountLabel(a, count);
    const locked = a.name === "risk" && a.openCount > 0;
    const on = running && !paused;
    const recent = a.recent || a.decisions || [];
    const decisions = recent.map((d) => {
      const href = d.mint ? (a.name === "auditor" && d.verdict !== "pass" ? `#/auditor/${d.mint}` : `#/coin/${d.mint}`) : "";
      const coin = d.link || href
        ? `<a class="coin" href="${href || "#/coin/" + d.mint}">${escapeHtml(d.label || "coin")}</a>`
        : `<span class="coin">${escapeHtml(d.label || "")}</span>`;
      return `<div class="decision"><span class="t">${escapeHtml(fmtTime(d.ts))}</span>${coin}<span class="verdict">${escapeHtml((d.verdict || "") + (d.reason ? " · " + d.reason : ""))}</span></div>`;
    }).join("") || `<div class="empty-note">No decisions yet</div>`;
    box.innerHTML = `
      <div class="head">
        <span class="status-dot ${paused ? "paused" : running ? "running" : "idle"}"></span>
        <h2>${escapeHtml(LABELS[a.name] || a.name)}</h2>
        <button class="settings-link" data-go-settings>Settings</button>
        <div class="switch ${on ? "on" : ""}" title="${locked ? "Risk is locked while a position is open" : "Read-only on this hosting"}" aria-disabled="true"><i></i></div>
      </div>
      <div class="today">${escapeHtml(todayLabel)}</div>
      ${decisions}`;
    box.querySelector("[data-go-settings]").addEventListener("click", () => go("/account"));
    return box;
  }

  function todayCountLabel(a, count) {
    if (a.name === "scanner") return count + " pool" + (count === 1 ? "" : "s") + " today";
    if (a.name === "auditor") return count + " taken apart today";
    if (a.name === "analyst") return count + " score" + (count === 1 ? "" : "s") + " today";
    if (a.name === "executor") return count + " trade" + (count === 1 ? "" : "s") + " today";
    if (a.name === "risk") return (a.openCount || 0) + " open";
    return String(count);
  }

  /* ---------- ACTIVITY ---------- */
  function renderActivity() {
    const main = $("main");
    main.innerHTML = `<div class="page-title">Activity</div>`;
    const items = activity || [];
    if (!items.length) {
      main.appendChild(el("div", "empty-note", "Nothing yet tonight"));
      return;
    }
    main.appendChild(activityList(items));
  }

  /* ---------- ACCOUNT ---------- */
  function renderAccount() {
    const main = $("main");
    main.innerHTML = `<div class="page-title">Account</div>`;
    const acc = account || emptyAccount();
    const mode = acc.mode || "PAPER";

    const gMode = el("div", "group");
    gMode.innerHTML = `<h3>Mode</h3>
      <div class="row"><span class="label">Trading mode</span>
        <div class="seg"><span class="${mode === "PAPER" ? "on" : ""}">PAPER</span><span class="${mode === "LIVE" ? "on" : ""}">LIVE</span></div>
      </div>
      <div class="note">Read-only on this hosting. LIVE needs you to type LIVE (STEP 11).</div>
      <div class="row"><span class="label">Starting stack</span>
        <input class="stack-field" type="text" value="${escapeHtml(String(acc.stack ?? 200))}" readonly>
      </div>`;
    main.appendChild(gMode);

    const gProf = el("div", "group");
    gProf.innerHTML = `<h3>FOMO</h3>`;
    const prof = el("a", "row");
    prof.href = acc.profileUrl || "#";
    prof.target = "_blank";
    prof.rel = "noopener";
    prof.innerHTML = `<span class="label">Your FOMO profile</span><span class="meta">${escapeHtml(acc.handle || "")} ›</span>`;
    gProf.appendChild(prof);
    const inv = el("button", "row");
    inv.innerHTML = `<span class="label">Invite a friend</span><span class="meta">Share</span>`;
    inv.addEventListener("click", () => shareInvite(acc.inviteUrl || acc.signupUrl));
    gProf.appendChild(inv);
    main.appendChild(gProf);

    const gPush = el("div", "group");
    const tg = acc.telegramConnected ? "Connected" : "Not connected";
    gPush.innerHTML = `<h3>Pushes</h3>
      <div class="row"><span class="label">Telegram</span><span class="meta">${tg}</span></div>
      <div class="row" style="opacity:.55"><span class="label">Send test push</span><span class="meta">Telegram only</span></div>
      <div class="note">${escapeHtml(acc.webPushMessage || "web push not available on this hosting, pushes come via Telegram")}</div>`;
    main.appendChild(gPush);

    const groups = (settings && settings.groups) || {};
    const order = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
    const titles = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk", desk: "Desk" };
    order.forEach((g) => {
      const items = groups[g];
      if (!items || !items.length) return;
      const box = el("div", "group");
      box.innerHTML = `<h3>${titles[g] || g}</h3>`;
      items.forEach((it) => box.appendChild(settingRow(it)));
      main.appendChild(box);
    });
  }

  function settingRow(it) {
    const wrap = el("div", "setting");
    const key = it.key || "";
    const short = key.split(".").slice(1).join(".") || key;
    wrap.innerHTML = `<div class="lab">${escapeHtml(short)}</div><div class="ctrl"></div>`;
    const ctrl = wrap.querySelector(".ctrl");
    if (it.type === "bool" || typeof it.value === "boolean") {
      const sw = el("div", "switch" + (it.value ? " on" : ""));
      sw.innerHTML = "<i></i>";
      ctrl.appendChild(sw);
    } else if (it.choices && it.choices.length) {
      const sel = document.createElement("select");
      sel.disabled = true;
      it.choices.forEach((c) => {
        const o = document.createElement("option");
        o.value = c; o.textContent = c;
        if (String(c) === String(it.value)) o.selected = true;
        sel.appendChild(o);
      });
      ctrl.appendChild(sel);
    } else if (it.type === "int" || it.type === "float" || typeof it.value === "number") {
      const rangeEl = document.createElement("input");
      rangeEl.type = "range";
      rangeEl.disabled = true;
      rangeEl.min = it.min != null ? it.min : 0;
      rangeEl.max = it.max != null ? it.max : (Number(it.value) || 0) * 2 || 100;
      rangeEl.step = it.type === "int" ? 1 : "any";
      rangeEl.value = it.value != null ? it.value : 0;
      const num = document.createElement("input");
      num.type = "number";
      num.disabled = true;
      num.value = it.value != null ? it.value : "";
      ctrl.appendChild(rangeEl);
      ctrl.appendChild(num);
    } else {
      const num = document.createElement("input");
      num.type = "text";
      num.disabled = true;
      num.value = it.value != null ? it.value : "";
      num.style.width = "140px";
      ctrl.appendChild(num);
    }
    return wrap;
  }

  async function shareInvite(url) {
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ url, title: "FOMO" });
        return;
      }
    } catch (e) { /* fall through */ }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch (e) {
      showToast("Link copied");
    }
  }

  function showToast(msg) {
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    const t = el("div", "toast");
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 1800);
  }

  /* ---------- COIN ---------- */
  async function renderCoin() {
    const main = $("main");
    const mint = route.mint;
    main.innerHTML = `<button class="back-btn" id="back">‹ Back</button>`;
    $("back").addEventListener("click", () => history.back());
    if (!mint) {
      main.appendChild(el("div", "empty-note", "No coin selected"));
      return;
    }
    if (!state && DEMO !== "empty") {
      main.innerHTML += `<div class="skel" style="height:40px;width:60%;margin:8px 0"></div>
        <div class="skel" style="height:40px;width:40%;margin:8px 0"></div>
        <div class="skel" style="height:240px;margin:8px 0"></div>`;
    }
    const coin = await loadCoin(mint);
    if (!coin) {
      main.appendChild(el("div", "empty-note", "No data for this coin yet"));
      return;
    }
    // rebuild with data (keep back)
    main.innerHTML = "";
    const back = el("button", "back-btn");
    back.textContent = "‹ Back";
    back.addEventListener("click", () => go("/home"));
    main.appendChild(back);

    const head = el("div", "coin-head");
    const left = el("div");
    const titleRow = el("div");
    titleRow.style.display = "flex";
    titleRow.style.alignItems = "center";
    titleRow.style.gap = "8px";
    const h1 = el("h1");
    h1.textContent = coin.label || coin.name || coin.symbol || mint.slice(0, 8);
    titleRow.appendChild(h1);
    if ((state && state.mode) === "PAPER" || (account && account.mode === "PAPER") || (!state && DEMO === "empty")) {
      const p = el("span", "paper-pill");
      p.textContent = "PAPER";
      p.style.marginBottom = "0";
      titleRow.appendChild(p);
    }
    left.appendChild(titleRow);
    const bits = [coin.symbol || null, "Solana", coin.age || null].filter(Boolean);
    left.appendChild(el("div", "coin-kicker", escapeHtml(bits.join(" · "))));
    head.appendChild(left);
    if (coin.shield) {
      const sh = el("span", "shield");
      sh.textContent = coin.shield;
      head.appendChild(sh);
    }
    main.appendChild(head);

    const price = el("div", "coin-price");
    price.textContent = fmtMoney(coin.price, true);
    main.appendChild(price);
    if (coin.position && coin.sinceEntryPct != null) {
      const se = el("div", "since-entry" + (coin.sinceEntryPct < 0 ? " down" : ""));
      const arrow = coin.sinceEntryPct < 0 ? "▼" : "▲";
      se.textContent = `${arrow} ${fmtPct(coin.sinceEntryPct, true)} since entry`;
      main.appendChild(se);
    }

    const wrap = el("div", "candle-wrap");
    const cv = document.createElement("canvas");
    wrap.appendChild(cv);
    main.appendChild(wrap);
    const trail = coin.exitLines && (coin.exitLines.trail != null ? coin.exitLines.trail : null);
    ChartKit.candles(cv, { candles: coin.candles || [], trail });

    const st = coin.stats || {};
    const holders = st.holders;
    const stats = el("div", "stats");
    const rows = [
      ["Market cap", st.marketCap != null ? fmtUsdShort(st.marketCap) : "n/a"],
      ["Liquidity", st.liquidity != null ? fmtUsdShort(st.liquidity) : "n/a"],
      ["24h volume", st.volume24h != null ? fmtUsdShort(st.volume24h) : "n/a"],
      ["Holders", holders != null ? String(holders) : "n/a"],
    ];
    rows.forEach(([k, v]) => {
      const s = el("div", "stat");
      s.innerHTML = `<div class="k">${k}</div><div class="v">${escapeHtml(v)}</div>`;
      stats.appendChild(s);
    });
    main.appendChild(stats);

    if (coin.position) {
      const pc = el("div", "pos-card");
      const sz = fmtMoney(coin.position.sizeUsd, false);
      pc.innerHTML = `<h3>Your position · ${escapeHtml(sz)} in · Executor</h3>
        <div class="exit-line"><span>Entry</span><b>${escapeHtml(fmtMoney(coin.position.entryPrice, true))}</b></div>`;
      main.appendChild(pc);
      if (coin.exitLines) {
        const ex = el("div", "exit-card");
        const eln = coin.exitLines;
        ex.innerHTML = `<h3>Exit</h3>
          <div class="exit-line"><span>Stop line</span><b>${escapeHtml(fmtMoney(eln.stop, true))}</b></div>
          <div class="exit-line"><span>Trail line</span><b>${eln.trail != null ? escapeHtml(fmtMoney(eln.trail, true)) : "—"}</b></div>
          <div class="exit-line"><span>Time left</span><b>${escapeHtml(fmtDur(eln.timeoutLeftS))}</b></div>`;
        main.appendChild(ex);
      }
    }

    if (coin.link) {
      const btn = el("a", "fomo-btn" + (coin.position ? " sell" : ""));
      btn.href = coin.link;
      btn.target = "_blank";
      btn.rel = "noopener";
      btn.textContent = coin.position ? "Sell on FOMO" : "Buy on FOMO";
      main.appendChild(btn);
    }
  }

  /* ---------- AUDITOR ---------- */
  async function renderAuditor() {
    const main = $("main");
    const mint = route.mint;
    main.innerHTML = "";
    const back = el("button", "back-btn");
    back.textContent = "‹ Back";
    back.addEventListener("click", () => go("/home"));
    main.appendChild(back);

    const audit = mint ? await loadAudit(mint) : { layers: [], passed: null };
    const layers = (audit && audit.layers) || [];
    const hasAny = layers.some((L) => L && (L.name || L.pass != null || (L.value && L.value !== "not checked")));
    if (!mint || !hasAny) {
      main.appendChild(el("div", "empty-note", "No coin taken apart yet"));
      renderAuditorToggle(main, audit);
      return;
    }

    const label = audit.label || audit.name || mint.slice(0, 8);
    const h = el("h1", "page-title");
    h.style.fontSize = "28px";
    h.textContent = label;
    main.appendChild(h);

    const stack = el("div", "disc-stack");
    const beam = el("div", "disc-beam");
    stack.appendChild(beam);
    for (let i = 1; i <= 8; i++) {
      const d = el("div", "disc");
      d.dataset.n = String(i);
      stack.appendChild(d);
    }
    main.appendChild(stack);

    const values = el("div", "values");
    layers.forEach((L) => {
      const row = el("div", "value-row" + (L.pass === true ? " ok" : L.pass === false ? " bad" : ""));
      const name = L.name || ("Layer " + L.n);
      row.innerHTML = `<span class="k">${escapeHtml(L.n + " · " + name)}</span><span class="v">${escapeHtml(L.value != null ? L.value : "—")}</span>`;
      values.appendChild(row);
    });
    main.appendChild(values);

    if (audit.headline) {
      const hd = el("div", "audit-head");
      hd.textContent = audit.headline;
      main.appendChild(hd);
    }
    if (audit.sub) {
      const sub = el("div", "audit-sub");
      sub.textContent = audit.sub;
      main.appendChild(sub);
    }

    renderAuditorToggle(main, audit);

    if (audit.link) {
      const btn = el("a", "fomo-btn");
      btn.href = audit.link;
      btn.target = "_blank";
      btn.rel = "noopener";
      btn.textContent = "Open on FOMO";
      main.appendChild(btn);
    }

    runBeam(stack, layers);
  }

  function renderAuditorToggle(main, audit) {
    const enabled = audit && audit.auditorEnabled != null
      ? audit.auditorEnabled
      : settings && settings.groups && settings.groups.auditor
        ? (settings.groups.auditor.find((x) => x.key === "auditor.enabled") || {}).value
        : true;
    const row = el("div", "toggle-row");
    row.innerHTML = `<span>Take apart before buying</span>`;
    const sw = el("div", "switch" + (enabled ? " on" : ""));
    sw.title = "Read-only on this hosting";
    sw.innerHTML = "<i></i>";
    row.appendChild(sw);
    main.appendChild(row);
  }

  function runBeam(stack, layers) {
    const reduce = window.ChartKit && ChartKit.reduceMotion && ChartKit.reduceMotion();
    const discs = [...stack.querySelectorAll(".disc")];
    const beam = stack.querySelector(".disc-beam");
    const token = ++beamToken;
    function paint(i, done) {
      const L = layers[i];
      const d = discs[i];
      if (!d || !L) return;
      if (L.pass === true) {
        d.classList.add("ok");
        d.textContent = "✓";
      } else if (L.pass === false) {
        d.classList.add("bad");
        d.textContent = "✕";
      }
    }
    if (reduce) {
      layers.forEach((_, i) => paint(i, true));
      if (beam) beam.style.opacity = "0";
      return;
    }
    // 350ms per layer top to bottom, then 150ms to green/red. Never show a result the server didn't send.
    let i = 0;
    beam.style.opacity = "1";
    const step = () => {
      if (token !== beamToken) return;
      if (i >= 8) {
        beam.style.opacity = "0";
        return;
      }
      const disc = discs[i];
      const top = disc.offsetTop + disc.offsetHeight / 2 - 14;
      beam.style.transition = "top 350ms ease";
      beam.style.top = top + "px";
      const idx = i;
      setTimeout(() => {
        if (token !== beamToken) return;
        const L = layers[idx];
        if (L && L.pass != null) {
          setTimeout(() => paint(idx, true), 0);
        }
        i += 1;
        setTimeout(step, 150);
      }, 350);
    };
    requestAnimationFrame(step);
  }

  /* ---------- render all ---------- */
  async function renderAll() {
    renderNavbar();
    renderBanner();
    renderTabs();
    const name = route.name;
    if (searchOpen && name === "home") { /* keep */ } else { toggleSearch(false); }
    if (name === "home") renderHome();
    else if (name === "agents") await renderAgents();
    else if (name === "activity") renderActivity();
    else if (name === "account") renderAccount();
    else if (name === "coin") await renderCoin();
    else if (name === "auditor") await renderAuditor();
  }

  async function boot() {
    parseHash();
    renderNavbar();
    renderTabs();
    renderBanner();
    // First paint skeletons
    if (route.name === "home") renderHome();
    await loadAll();
    if (DEMO === "error") {
      // Load succeeded first (loadedOnce), subsequent polls fail and banner keeps last good numbers.
      forceError = true;
      offline = true;
      retryIn = 8;
    }
    await renderAll();
    window.addEventListener("hashchange", async () => {
      parseHash();
      await renderAll();
    });
    setInterval(async () => {
      if (offline && retryIn > 0) {
        retryIn -= 1;
        renderBanner();
        if (retryIn > 0) return;
      }
      if (DEMO === "empty") return;
      if (DEMO === "error") {
        offline = true;
        retryIn = 8;
        renderBanner();
        return;
      }
      const prev = state && state.balance;
      await loadAll();
      if (route.name === "coin" && route.mint) coinCache[route.mint] = null;
      await renderAll();
      void prev;
    }, 1000);
    // The 1s tick only decrements the retry countdown; data reload every 15s would be nicer.
    // Re-bind a slower poll for data. The interval above reloads every 1s which is heavy.
  }

  // Use a cleaner poll: 1s for countdown when offline, 15s for data otherwise.
  async function boot2() {
    parseHash();
    renderNavbar();
    renderTabs();
    renderBanner();
    renderHome();
    await loadAll();
    if (route.name === "coin" && route.mint) await loadCoin(route.mint);
    if (route.name === "auditor" && route.mint) await loadAudit(route.mint);
    if (DEMO === "error") {
      forceError = true;
      offline = true;
      retryIn = 8;
    }
    await renderAll();
    window.addEventListener("hashchange", async () => {
      parseHash();
      await renderAll();
    });
    let acc = 0;
    setInterval(async () => {
      acc += 1;
      if (offline) {
        retryIn = Math.max(0, retryIn - 1);
        renderBanner();
        if (retryIn === 0 && DEMO !== "error") {
          await loadAll();
          if (!offline) await renderAll();
          else retryIn = 8;
          renderBanner();
        }
        if (DEMO === "error" && retryIn === 0) retryIn = 8;
        return;
      }
      if (DEMO === "empty") return;
      if (acc % 15 === 0) {
        await loadAll();
        if (route.name === "coin" && route.mint) delete coinCache[route.mint];
        await renderAll();
      }
    }, 1000);
  }

  boot2();
})();
