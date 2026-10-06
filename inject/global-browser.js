(() => {
  "use strict";
  if (window.__codexGlobalBrowser) return;

  const STORAGE = "codex-workspace-enhancer:global-browser-v1";
  const HOME = "https://www.google.com/?igu=1";
  let root, shadow, viewport, address, tabsBar, status, resize, layoutTimer;
  let railLeft, railRight, recentList;
  let threadFloat, threadFloatTitle, threadFloatState, threadFloatLog, threadFloatInput;
  let open = false, activeId = "", initialization = null, destroyed = false, threadPanelOpen = false, threadFloatOpen = false, threadTarget = null;
  const tabs = new Map();
  const events = new AbortController();

  function makeEmbeddable(url) {
    try {
      const parsed = new URL(url);
      if (/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname)) parsed.searchParams.set("igu", "1");
      return parsed.href;
    } catch { return url; }
  }

  function normalizeUrl(input) {
    const value = String(input || "").trim();
    if (!value || value === "about:blank") return "about:blank";
    if (/^https?:\/\//i.test(value)) return makeEmbeddable(new URL(value).href);
    if (/^(localhost|[\w.-]+\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?([/?#].*)?$/i.test(value)) {
      return makeEmbeddable(new URL(`${/^localhost[:/?#]|^localhost$/i.test(value) ? "http" : "https"}://${value}`).href);
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) throw new Error("请输入 http 或 https 网址");
    return `https://www.google.com/search?igu=1&q=${encodeURIComponent(value)}`;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        activeId,
        tabs: [...tabs.values()].map(tab => ({ id: tab.id, url: tab.url, title: tab.title, history: tab.history, historyIndex: tab.historyIndex })),
      }));
    } catch { setStatus("标签页暂未保存；当前页面仍可继续使用"); }
  }

  function setStatus(message = "") {
    if (status) { status.textContent = message; status.hidden = !message; }
  }

  function button(label, text, action) {
    const node = document.createElement("button");
    node.type = "button";
    node.title = label;
    node.setAttribute("aria-label", label);
    node.textContent = text;
    node.addEventListener("click", action);
    return node;
  }

  function mount() {
    root = document.createElement("section");
    root.id = "codex-global-browser";
    root.hidden = true;
    root.setAttribute("aria-label", "浏览器");
    Object.assign(root.style, { position: "fixed", right: "auto", bottom: "auto", zIndex: "2147483000", pointerEvents: "none" });
    shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host { color: var(--color-text-primary,#e8eaed); font: 13px var(--font-sans,system-ui,sans-serif); pointer-events:none; }
      * { box-sizing: border-box; } [hidden] { display:none !important; }
      .shell { position:relative; height:100%; display:flex; flex-direction:column; background:var(--color-surface,#202528); border-left:1px solid color-mix(in srgb,currentColor 18%,transparent); box-shadow:-12px 0 32px rgb(0 0 0 / 18%); pointer-events:auto; }
      .top,.nav { display:flex; align-items:center; gap:8px; padding:8px 14px; flex:none; }
      .top { border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); min-height:48px; }
      .tabs { display:flex; flex:1; min-width:0; gap:4px; overflow-x:auto; }
      .tab { display:flex; min-width:128px; max-width:260px; border-radius:8px; background:var(--color-surface-secondary,#2d3338); overflow:hidden; }
      .tab[aria-current=true] { background:var(--color-surface-selected,#334a59); box-shadow:inset 0 -2px 0 #9ecdf0; }
      .tab > .label { min-width:0; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; text-align:left; }
      button { color:inherit; font:inherit; min-width:34px; height:34px; border:0; border-radius:8px; background:transparent; padding:0 10px; cursor:pointer; flex:none; }
      button:hover { background:color-mix(in srgb,currentColor 12%,transparent); }
      button:disabled { opacity:.45; cursor:default; }
      button:focus-visible,input:focus-visible { outline:2px solid #86c7f4; outline-offset:-2px; }
      .workspace { display:grid; grid-template-columns:132px minmax(0,1fr); min-height:0; flex:1; }
      .rail-left,.rail-right { min-width:0; background:color-mix(in srgb,var(--color-surface,#202528) 92%,#0b1114); }
      .rail-left { display:flex; flex-direction:column; gap:10px; padding:12px 8px 10px; border-right:1px solid color-mix(in srgb,currentColor 12%,transparent); }
      .rail-right { display:none; position:absolute; top:12px; right:12px; z-index:5; width:min(344px,calc(100% - 24px)); height:min(560px,calc(100% - 24px)); flex-direction:column; padding:12px 10px 10px; overflow:hidden; border:1px solid color-mix(in srgb,currentColor 16%,transparent); border-radius:12px; box-shadow:-14px 12px 36px rgb(0 0 0 / 28%); }
      .rail-right[data-open=true] { display:flex; }
      .browser-column { display:flex; flex-direction:column; min-width:0; min-height:0; }
      .nav { border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); } .nav form { flex:1; min-width:0; } input { width:100%; height:36px; border:1px solid color-mix(in srgb,currentColor 26%,transparent); border-radius:9px; padding:0 13px; color:inherit; background:var(--color-surface-secondary,#2d3338); font:inherit; }
      input::placeholder { color:var(--color-text-primary,#d5dbe0); }
      .viewport { position:relative; flex:1; min-height:0; overflow:hidden; background:#15181b; }
      iframe { position:absolute; inset:0; width:100%; height:100%; border:0; background:#fff; display:none; }
      iframe[data-active=true] { display:block; }
      .status { padding:6px 12px; color:inherit; margin:0; }
      .name { font-size:12px; white-space:nowrap; padding:0 6px; }
      .rail-brand,.account-action { display:flex; align-items:center; width:100%; min-width:0; gap:9px; padding:8px 6px; text-align:left; }
      .rail-brand { height:36px; color:#e8f3f7; font-size:13px; font-weight:650; }
      .rail-brand-mark { display:grid; width:22px; height:22px; place-items:center; border:1px solid #7aa8c7; border-radius:7px; color:#b8ddf5; font-size:11px; }
      .rail-divider { height:1px; margin:0 4px; background:color-mix(in srgb,currentColor 12%,transparent); }
      .usage-panel { display:flex; flex-direction:column; gap:6px; padding:8px 7px 9px; border:1px solid color-mix(in srgb,currentColor 14%,transparent); border-radius:10px; background:color-mix(in srgb,currentColor 4%,transparent); }
      .usage-heading,.tibo-probability,.usage-detail-row { display:flex; align-items:baseline; justify-content:space-between; gap:8px; min-width:0; }
      .usage-heading span,.usage-reset,.tibo-probability span,.usage-detail-row span { color:color-mix(in srgb,currentColor 66%,transparent); font-size:10px; white-space:nowrap; }
      .usage-heading strong { color:#f0f5f8; font-size:17px; font-weight:680; letter-spacing:-.03em; }
      .usage-reset { overflow:hidden; text-overflow:ellipsis; }
      .usage-meter { height:3px; margin:1px 0 2px; overflow:hidden; border-radius:99px; background:color-mix(in srgb,currentColor 13%,transparent); }
      .usage-meter span { display:block; width:100%; height:100%; transform:scaleX(0); transform-origin:left center; border-radius:inherit; background:#8ebfe7; transition:transform 180ms ease,background 180ms ease; }
      .tibo-probability { padding-top:6px; border-top:1px solid color-mix(in srgb,currentColor 10%,transparent); }
      .tibo-probability strong { color:#c8d7e1; font-size:11px; font-weight:650; font-variant-numeric:tabular-nums; transition:color 160ms ease,font-size 160ms ease; }
      .usage-detail { display:flex; flex-direction:column; gap:5px; margin-top:2px; padding-top:7px; border-top:1px solid color-mix(in srgb,currentColor 10%,transparent); }
      .usage-detail-row strong { min-width:0; overflow:hidden; color:#eef3f6; font-size:10px; font-weight:580; text-align:right; text-overflow:ellipsis; white-space:nowrap; }
      .account-action { margin-top:auto; border:1px solid color-mix(in srgb,currentColor 12%,transparent); background:transparent; }
      .account-action:hover { border-color:color-mix(in srgb,#9ecdf0 44%,transparent); background:color-mix(in srgb,#9ecdf0 9%,transparent); }
      .account-icon { display:grid; width:22px; height:22px; place-items:center; border:1px solid color-mix(in srgb,currentColor 28%,transparent); border-radius:50%; color:#b9cad5; font-size:11px; }
      .account-copy { display:flex; min-width:0; flex-direction:column; gap:1px; }
      .account-copy strong { font-size:11px; font-weight:600; }
      .account-copy small { overflow:hidden; color:color-mix(in srgb,currentColor 60%,transparent); font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
      .rail-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 2px 9px; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); }
      .rail-heading strong { font-size:12px; font-weight:620; }
      .rail-heading-actions { display:flex; align-items:center; gap:6px; }
      .rail-heading span { color:color-mix(in srgb,currentColor 56%,transparent); font-size:10px; }
      .thread-launcher { width:62px; min-width:62px; height:30px; padding:0; border:1px solid color-mix(in srgb,#9ecdf0 28%,transparent); border-radius:8px; color:#b9d9ec; background:color-mix(in srgb,#9ecdf0 6%,transparent); font-size:11px; }
      .thread-launcher:hover { border-color:color-mix(in srgb,#9ecdf0 58%,transparent); background:color-mix(in srgb,#9ecdf0 13%,transparent); }
      .thread-panel-close { width:28px; min-width:28px; height:28px; padding:0; color:color-mix(in srgb,currentColor 62%,transparent); font-size:18px; line-height:1; }
      .new-thread-button { width:28px; min-width:28px; height:28px; padding:0; border:1px solid color-mix(in srgb,#9ecdf0 32%,transparent); border-radius:8px; color:#b9d9ec; background:color-mix(in srgb,#9ecdf0 7%,transparent); font-size:18px; line-height:1; }
      .new-thread-button:hover { border-color:color-mix(in srgb,#9ecdf0 60%,transparent); background:color-mix(in srgb,#9ecdf0 15%,transparent); }
      .recent-list { display:flex; min-height:0; flex:1; flex-direction:column; overflow:auto; padding:5px 0; }
      .recent-item { display:flex; width:100%; min-height:42px; align-items:flex-start; gap:8px; padding:8px 7px; border-radius:8px; color:inherit; text-align:left; }
      .recent-item:hover,.recent-item[aria-current=true] { background:color-mix(in srgb,#9ecdf0 12%,transparent); }
      .recent-item[aria-current=true] { box-shadow:inset 2px 0 0 #9ecdf0; }
      .recent-index { flex:none; width:15px; color:color-mix(in srgb,currentColor 45%,transparent); font-size:10px; line-height:18px; text-align:center; font-variant-numeric:tabular-nums; }
      .recent-title { min-width:0; overflow:hidden; font-size:11px; line-height:18px; text-overflow:ellipsis; white-space:nowrap; }
      .recent-empty { padding:16px 8px; color:color-mix(in srgb,currentColor 54%,transparent); font-size:11px; line-height:1.6; }
      .thread-float { position:absolute; top:58px; right:18px; z-index:8; display:flex; width:min(360px,calc(100% - 36px)); height:min(430px,calc(100% - 76px)); flex-direction:column; overflow:hidden; border:1px solid color-mix(in srgb,#9ecdf0 30%,transparent); border-radius:14px; background:color-mix(in srgb,var(--color-surface,#202528) 96%,#0b1114); box-shadow:0 18px 50px rgb(0 0 0 / 34%),0 0 0 1px rgb(255 255 255 / 3%); }
      .thread-float-head { display:flex; min-height:52px; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); }
      .thread-float-heading { min-width:0; display:flex; flex-direction:column; gap:3px; }
      .thread-float-heading strong { overflow:hidden; font-size:12px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
      .thread-float-heading span { color:#91bfd7; font-size:10px; }
      .thread-float-close { width:28px; min-width:28px; height:28px; padding:0; color:color-mix(in srgb,currentColor 68%,transparent); font-size:18px; line-height:1; }
      .thread-float-log { display:flex; min-height:0; flex:1; flex-direction:column; gap:8px; overflow:auto; padding:12px; }
      .thread-float-note { padding:9px 10px; border:1px solid color-mix(in srgb,currentColor 10%,transparent); border-radius:9px; color:color-mix(in srgb,currentColor 66%,transparent); background:color-mix(in srgb,currentColor 3%,transparent); font-size:11px; line-height:1.5; }
      .thread-float-message { align-self:flex-end; max-width:88%; padding:8px 10px; border-radius:10px 10px 3px 10px; color:#eaf4f8; background:color-mix(in srgb,#82bce0 19%,transparent); font-size:11px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
      .thread-float-compose { display:flex; align-items:flex-end; gap:7px; padding:10px; border-top:1px solid color-mix(in srgb,currentColor 12%,transparent); }
      .thread-float-compose textarea { min-width:0; flex:1; min-height:36px; max-height:92px; resize:vertical; border:1px solid color-mix(in srgb,currentColor 22%,transparent); border-radius:9px; padding:9px 10px; color:inherit; background:var(--color-surface-secondary,#2d3338); font:inherit; font-size:11px; line-height:1.35; }
      .thread-float-compose button { width:38px; min-width:38px; height:36px; padding:0; border:1px solid color-mix(in srgb,#9ecdf0 36%,transparent); border-radius:9px; color:#c7e6f6; background:color-mix(in srgb,#9ecdf0 11%,transparent); font-size:16px; }
      .thread-float-compose button:disabled { opacity:.4; }
      @media(max-width:1150px) { .workspace { grid-template-columns:124px minmax(0,1fr); } .rail-left { padding-inline:7px; } .rail-right { padding-inline:8px; } }
      @media(max-width:820px) { .workspace { grid-template-columns:128px minmax(0,1fr); } .rail-right { width:min(330px,calc(100% - 16px)); right:8px; } }
      @media(max-width:950px) { .name { display:none; } .top,.nav { padding-inline:6px; gap:3px; } }
    </style><div class="shell"><div class="top"><span class="name">浏览器</span><div class="tabs" aria-label="浏览器标签页"></div><button class="thread-launcher" type="button" data-thread-launcher title="快速打开 Codex 对话" aria-label="快速打开 Codex 对话" aria-expanded="false">快速打开</button></div><div class="workspace"><aside class="rail-left" aria-label="Codex 状态"><section class="usage-panel" aria-label="Codex 额度"><div class="usage-heading"><span data-rail-usage-label>剩余量</span><strong data-rail-usage-value>--</strong></div><div class="usage-meter" aria-hidden="true"><span></span></div><div class="usage-reset" data-rail-reset>可用重置 --</div><div class="tibo-probability"><span>Tibo 概率</span><strong data-rail-probability>0%</strong></div><div class="usage-detail"><div class="usage-detail-row"><span>正常重置</span><strong data-rail-normal>--</strong></div><div class="usage-detail-row"><span>重置卡</span><strong data-rail-card>--</strong></div><div class="usage-detail-row" data-rail-tibo-row hidden><span>Tibo预计</span><strong data-rail-tibo>--</strong></div></div></section><button class="account-action" type="button" data-rail-account title="账户 / 快速切换"><span class="account-icon" aria-hidden="true">↺</span><span class="account-copy"><strong>账户</strong><small data-rail-account-state>账户菜单</small></span></button></aside><section class="browser-column"><div class="nav"><form><input aria-label="网址或搜索" placeholder="搜索或输入网址" autocomplete="off" spellcheck="false"></form></div><p class="status" role="status" hidden></p><div class="viewport"></div></section><aside class="rail-right" aria-label="Codex 对话" data-open="false"><div class="rail-heading"><div><strong>Codex 对话</strong><span>切换或新建</span></div><div class="rail-heading-actions"><button class="thread-panel-close" type="button" data-thread-panel-close title="关闭对话面板" aria-label="关闭对话面板">×</button><button class="new-thread-button" type="button" data-new-codex-thread title="新建 Codex 线程" aria-label="新建 Codex 线程">＋</button></div></div><div class="recent-list"></div></aside><section class="thread-float" data-thread-float hidden aria-label="Codex 快速对话"><div class="thread-float-head"><div class="thread-float-heading"><strong data-thread-float-title>Codex 对话</strong><span data-thread-float-state>等待连接</span></div><button class="thread-float-close" type="button" data-thread-float-close title="关闭浮窗" aria-label="关闭浮窗">×</button></div><div class="thread-float-log" data-thread-float-log><div class="thread-float-note">从右上角选择一个 Codex 线程，消息会直接发送到该线程。</div></div><form class="thread-float-compose" data-thread-float-form><textarea data-thread-float-input rows="1" placeholder="在这个线程里输入…" aria-label="快速对话输入"></textarea><button type="submit" title="发送" aria-label="发送">↑</button></form></section></div></div>`;
    tabsBar = shadow.querySelector(".tabs");
    railLeft = shadow.querySelector(".rail-left");
    railRight = shadow.querySelector(".rail-right");
    recentList = shadow.querySelector(".recent-list");
    threadFloat = shadow.querySelector("[data-thread-float]");
    threadFloatTitle = shadow.querySelector("[data-thread-float-title]");
    threadFloatState = shadow.querySelector("[data-thread-float-state]");
    threadFloatLog = shadow.querySelector("[data-thread-float-log]");
    threadFloatInput = shadow.querySelector("[data-thread-float-input]");
    const threadLauncher = shadow.querySelector("[data-thread-launcher]");
    const setThreadPanelOpen = (value) => {
      threadPanelOpen = Boolean(value);
      railRight.dataset.open = String(threadPanelOpen);
      threadLauncher.setAttribute("aria-expanded", String(threadPanelOpen));
    };
    threadLauncher.addEventListener("click", () => setThreadPanelOpen(!threadPanelOpen));
    shadow.querySelector("[data-thread-panel-close]").addEventListener("click", () => setThreadPanelOpen(false));
    shadow.querySelector("[data-thread-float-close]").addEventListener("click", closeThreadFloat);
    shadow.querySelector("[data-thread-float-form]").addEventListener("submit", event => {
      event.preventDefault();
      sendToActiveThread(threadFloatInput.value);
    });
    threadFloatInput.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendToActiveThread(threadFloatInput.value); }
    });
    viewport = shadow.querySelector(".viewport");
    address = shadow.querySelector("input");
    status = shadow.querySelector(".status");
    shadow.querySelector(".top").append(button("新建标签页", "+", () => newTab()), button("收起浏览器（保留标签页）", "收起", hide));
    shadow.querySelector("[data-rail-account]").addEventListener("click", () => {
      hide();
      window.setTimeout(() => {
        const source = document.querySelector("#codex-account-host > button")
          || document.querySelector('nav[data-app-navigation-rail] button[aria-label="打开个人资料菜单"]')
          || document.querySelector('nav[class*="group/sidebar-rail"] button[aria-label="打开个人资料菜单"]');
        source?.click();
      }, 0);
    });
    shadow.querySelector("[data-new-codex-thread]").addEventListener("click", () => {
      const source = document.querySelector('[data-codex-sidebar-shortcut-source-name="新对话"]')
        || document.querySelector('[data-codex-sidebar-shortcut-name="新对话"]');
      if (source) {
        setThreadPanelOpen(false);
        source.click();
        openThreadFloat({ id: "new", source: "local", title: "新对话" }, { activate: false });
        threadFloatState.textContent = "新对话已就绪";
      }
      else setStatus("暂时找不到 Codex 新对话入口");
    });
    const nav = shadow.querySelector(".nav");
    nav.prepend(button("后退", "←", () => navigation("goBack")), button("前进", "→", () => navigation("goForward")), button("刷新 / 停止", "↻", () => {
      const tab = tabs.get(activeId);
      navigation(tab?.loading ? "stop" : "reload");
    }));
    shadow.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      navigate(address.value).catch(error => setStatus(error.message));
    });
    address.addEventListener("focus", () => address.select());
    shadow.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); if (threadFloatOpen) closeThreadFloat(); else if (threadPanelOpen) setThreadPanelOpen(false); else hide(); }
    });
    document.body.insertBefore(root, document.querySelector("[data-embedded-frame-host-root]"));
    resize = new ResizeObserver(position);
    resize.observe(viewport);
    window.addEventListener("resize", position, { signal: events.signal });
    layoutTimer = setInterval(() => { if (open) { position(); syncRails(); syncThreadFloat(); } }, 500);
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      if (destroyed) throw new Error("浏览器已关闭");
      mount();
      let saved;
      try { saved = JSON.parse(localStorage.getItem(STORAGE) || "null"); } catch {}
      for (const record of Array.isArray(saved?.tabs) ? saved.tabs : []) {
        if (typeof record.id !== "string" || tabs.has(record.id)) continue;
        try { addTab({ id: record.id, url: normalizeUrl(record.url), title: String(record.title || "新标签页"), history: record.history, historyIndex: record.historyIndex }); } catch {}
      }
      if (!tabs.size) addTab({ url: HOME });
      activeId = tabs.has(saved?.activeId) ? saved.activeId : tabs.keys().next().value;
      render();
    })().catch(error => { initialization = null; throw error; });
    return initialization;
  }

  function addTab({ id = crypto.randomUUID(), url = HOME, title = "新标签页", history, historyIndex } = {}) {
    const list = Array.isArray(history) && history.length ? history.map(item => normalizeUrl(item)) : [url];
    const index = Number.isInteger(historyIndex) && historyIndex >= 0 && historyIndex < list.length ? historyIndex : Math.max(0, list.indexOf(url));
    const tab = { id, url: list[index] || url, title, history: list, historyIndex: index, frame: null, ready: false, loading: false, error: "", listeners: new AbortController() };
    tabs.set(id, tab);
    return tab;
  }

  function ensureFrame(tab) {
    if (tab.frame?.isConnected) return tab.frame;
    tab.listeners.abort();
    tab.listeners = new AbortController();
    tab.ready = false;
    const frame = document.createElement("iframe");
    frame.src = tab.url;
    frame.dataset.tabId = tab.id;
    frame.setAttribute("title", tab.title || "浏览器页面");
    tab.frame = frame;
    const listen = (name, fn) => frame.addEventListener(name, fn, { signal: tab.listeners.signal });
    listen("load", () => {
      tab.ready = true;
      tab.loading = false;
      tab.error = "";
      try {
        const current = frame.contentWindow?.location?.href;
        if (current && current !== "about:blank") tab.url = current;
      } catch {}
      try { tab.title = frame.contentDocument?.title || new URL(tab.url).hostname || tab.title; } catch {}
      save();
      render();
    });
    listen("error", () => {
      tab.loading = false;
      tab.error = "页面暂时无法打开，请检查网址或稍后重试";
      render();
    });
    viewport.append(frame);
    tab.loading = true;
    return frame;
  }

  function position() {
    if (!root || !open || destroyed) return;
    const content = document.querySelector("[data-app-shell-main-content-layout]");
    const contentRect = content?.getBoundingClientRect();
    const top = contentRect?.top || 48;
    const left = 0;
    const width = innerWidth;
    const height = Math.max(0, innerHeight - top);
    const geometry = `${left}:${top}:${width}:${height}`;
    if (root.dataset.geometry !== geometry) {
      root.dataset.geometry = geometry;
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.width = `${width}px`;
      root.style.height = `${height}px`;
    }
    syncWebviews();
  }

  function syncWebviews() {
    if (!viewport) return;
    for (const tab of tabs.values()) {
      const visible = open && tab.id === activeId;
      if (visible) ensureFrame(tab);
      if (tab.frame) tab.frame.dataset.active = String(visible);
    }
  }

  function findNativeThreadRow(entry) {
    if (!entry) return null;
    const key = `${entry.source}:${entry.id}`;
    return [...document.querySelectorAll("[data-app-action-sidebar-thread-row]")]
      .find(row => {
        const raw = row.getAttribute("data-app-action-sidebar-thread-id");
        return raw === key || raw === entry.id;
      }) || null;
  }

  function appendThreadFloatMessage(text) {
    if (!threadFloatLog || !String(text || "").trim()) return;
    const message = document.createElement("div");
    message.className = "thread-float-message";
    message.textContent = String(text).trim();
    threadFloatLog.appendChild(message);
    threadFloatLog.scrollTop = threadFloatLog.scrollHeight;
  }

  function openThreadFloat(entry, { activate = true } = {}) {
    threadTarget = entry ? { id: String(entry.id || ""), source: String(entry.source || "local"), title: String(entry.title || "Codex 对话") } : null;
    if (!threadFloat || !threadTarget) return;
    threadFloatOpen = true;
    threadFloat.hidden = false;
    threadFloatTitle.textContent = threadTarget.title;
    threadFloatState.textContent = "连接中…";
    threadFloatLog.replaceChildren();
    const note = document.createElement("div");
    note.className = "thread-float-note";
    note.textContent = "消息会直接发送到这个 Codex 线程，浏览器和主页面不会跳转。";
    threadFloatLog.appendChild(note);
    if (activate) {
      const row = findNativeThreadRow(threadTarget);
      if (row) {
        row.click();
        window.setTimeout(() => syncThreadFloat(), 120);
      } else {
        threadFloatState.textContent = "线程暂未加载";
      }
    }
    threadFloatInput.value = "";
    threadFloatInput.focus();
  }

  function closeThreadFloat() {
    threadFloatOpen = false;
    threadTarget = null;
    if (threadFloat) threadFloat.hidden = true;
  }

  function visibleCodexEditor() {
    return [...document.querySelectorAll('[contenteditable="true"][aria-label="随心输入"]')]
      .find(editor => { const rect = editor.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) || null;
  }

  function sendToActiveThread(value) {
    const text = String(value || "").trim();
    if (!text || !threadTarget) return;
    const editor = visibleCodexEditor();
    if (!editor) { threadFloatState.textContent = "找不到 Codex 输入框"; return; }
    editor.focus();
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch {}
    if (!inserted || !editor.textContent.includes(text)) {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      editor.replaceChildren(paragraph);
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    window.setTimeout(() => {
      const form = editor.closest("form");
      const send = form?.querySelector('button[aria-label="发送"]')
        || [...document.querySelectorAll('button[aria-label="发送"]')].find(button => { const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
      if (!send || send.disabled || send.getAttribute("aria-disabled") === "true") {
        threadFloatState.textContent = "输入已填入，请在主线程发送";
        return;
      }
      send.click();
      appendThreadFloatMessage(text);
      threadFloatInput.value = "";
      threadFloatState.textContent = "已发送 · 回复生成中";
    }, 60);
  }

  function syncThreadFloat() {
    if (!threadFloatOpen || !threadTarget) return;
    const row = findNativeThreadRow(threadTarget);
    const selected = row?.getAttribute("data-app-action-sidebar-thread-selected") === "true"
      || row?.getAttribute("data-app-action-sidebar-thread-active") === "true";
    threadFloatState.textContent = selected ? "已连接" : row ? "切换中…" : "线程暂未加载";
  }

  function syncRails() {
    if (!railLeft || !railRight) return;
    const source = document.getElementById("codex-conversation-usage-status");
    const read = (selector, fallback = "--") => source?.querySelector(selector)?.textContent?.trim() || fallback;
    const label = read(".codex-conversation-usage-text", "剩余量");
    const value = read(".codex-conversation-usage-value");
    railLeft.querySelector("[data-rail-usage-label]").textContent = label;
    railLeft.querySelector("[data-rail-usage-value]").textContent = value;
    railLeft.querySelector("[data-rail-reset]").textContent = read(".codex-conversation-usage-reset-available", "可用重置 --");
    railLeft.querySelector("[data-rail-normal]").textContent = read(".codex-conversation-usage-normal-reset .codex-conversation-usage-meta-value");
    railLeft.querySelector("[data-rail-card]").textContent = read(".codex-conversation-usage-reset-card .codex-conversation-usage-meta-value");
    const tiboRow = railLeft.querySelector("[data-rail-tibo-row]");
    const tibo = source?.querySelector(".codex-conversation-usage-tibo");
    const tiboText = read(".codex-conversation-usage-tibo .codex-conversation-usage-meta-value");
    tiboRow.hidden = !tibo || tibo.hidden || tiboText === "--";
    railLeft.querySelector("[data-rail-tibo]").textContent = tiboText;
    const probability = source?.querySelector(".codex-conversation-usage-tibo-probability-value");
    const probabilityValue = probability?.textContent?.trim() || "0%";
    const railProbability = railLeft.querySelector("[data-rail-probability]");
    railProbability.textContent = probabilityValue;
    if (probability) {
      railProbability.style.color = probability.style.color || "";
      railProbability.style.fontSize = probability.style.fontSize || "";
      railProbability.style.fontWeight = probability.style.fontWeight || "";
    }
    const remaining = Number(source?.dataset.remainingPercent);
    const fill = railLeft.querySelector(".usage-meter span");
    fill.style.transform = `scaleX(${Number.isFinite(remaining) ? Math.min(100, Math.max(0, remaining)) / 100 : 0})`;
    fill.style.background = source?.dataset.tone === "critical" ? "#d46d68" : source?.dataset.tone === "warning" ? "#d1a35c" : "#8ebfe7";
    const accountState = railLeft.querySelector("[data-rail-account-state]");
    const accountSource = document.querySelector("#codex-account-host > button")
      || document.querySelector('nav[data-app-navigation-rail] button[aria-label="打开个人资料菜单"]')
      || document.querySelector('nav[class*="group/sidebar-rail"] button[aria-label="打开个人资料菜单"]');
    accountState.textContent = accountSource ? "可快速切换" : "账户菜单";

    const entries = Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-row]"))
      .map(row => {
        const rawId = String(row.getAttribute("data-app-action-sidebar-thread-id") || "").trim();
        const match = /^(local|cloud):(.+)$/i.exec(rawId);
        const source = (match?.[1] || (location.pathname.startsWith("/cloud/") ? "cloud" : "local")).toLowerCase();
        const id = (match?.[2] || rawId).trim();
        const title = row.getAttribute("data-app-action-sidebar-thread-title")
          || row.querySelector("[data-thread-title]")?.textContent
          || row.textContent;
        return { id, source, title: String(title || "未命名对话").replace(/\s+/g, " ").trim() || "未命名对话" };
      })
      .filter(entry => entry.id)
      .filter((entry, index, list) => list.findIndex(candidate => candidate.id === entry.id && candidate.source === entry.source) === index)
      .slice(0, 12);
    const signature = entries.map(entry => `${entry.source}:${entry.id}\n${entry.title}`).join("\u0000");
    if (recentList.dataset.signature !== signature) {
      recentList.dataset.signature = signature;
      recentList.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement("div");
        empty.className = "recent-empty";
        empty.textContent = "暂时没有可打开的对话";
        recentList.appendChild(empty);
      } else entries.forEach((entry, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "recent-item";
        item.dataset.threadId = entry.id;
        item.dataset.threadSource = entry.source;
        item.title = entry.title;
        item.setAttribute("aria-label", `打开对话：${entry.title}`);
        const number = document.createElement("span");
        number.className = "recent-index";
        number.textContent = String(index + 1).padStart(2, "0");
        const title = document.createElement("span");
        title.className = "recent-title";
        title.textContent = entry.title;
        item.append(number, title);
        item.addEventListener("click", () => {
          threadPanelOpen = false;
          railRight.dataset.open = "false";
          shadow.querySelector("[data-thread-launcher]").setAttribute("aria-expanded", "false");
          openThreadFloat(entry);
        });
        recentList.appendChild(item);
      });
    }
    const currentPath = String(location.pathname || "");
    const selectedRow = document.querySelector('[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-selected="true"]')
      || document.querySelector('[data-app-action-sidebar-thread-row][data-selected="true"]')
      || document.querySelector('[data-app-action-sidebar-thread-row][aria-current="page"]')
      || document.querySelector('[data-app-action-sidebar-thread-row][data-active="true"]');
    const selectedRawId = selectedRow?.getAttribute("data-app-action-sidebar-thread-id") || "";
    const selectedMatch = /^(local|cloud):(.+)$/i.exec(selectedRawId);
    const selectedKey = selectedRawId ? `${(selectedMatch?.[1] || (location.pathname.startsWith("/cloud/") ? "cloud" : "local")).toLowerCase()}:${selectedMatch?.[2] || selectedRawId}` : "";
    recentList.querySelectorAll(".recent-item").forEach(item => {
      const key = `${item.dataset.threadSource}:${item.dataset.threadId}`;
      item.setAttribute("aria-current", currentPath.endsWith(`/${key.replace(":", "/")}`) || key === selectedKey ? "true" : "false");
    });
  }

  function render() {
    if (!root) return;
    for (const child of [...tabsBar.children]) if (!tabs.has(child.dataset.tabId)) child.remove();
    for (const tab of tabs.values()) {
      let item = [...tabsBar.children].find(child => child.dataset.tabId === tab.id);
      if (!item) {
        item = document.createElement("div");
        item.className = "tab";
        item.dataset.tabId = tab.id;
        const label = button(tab.title, tab.title, () => selectTab(tab.id));
        label.className = "label";
        item.append(label, button("关闭标签页", "×", () => closeTab(tab.id)));
        tabsBar.appendChild(item);
      }
      item.setAttribute("aria-current", String(tab.id === activeId));
      const label = item.firstChild;
      const text = `${tab.loading ? "· " : ""}${tab.title || "新标签页"}`;
      if (label.textContent !== text) label.textContent = text;
      label.title = tab.title || tab.url;
      label.setAttribute("aria-label", label.title);
    }
    const active = tabs.get(activeId);
    if (shadow.activeElement !== address) address.value = active?.url === "about:blank" ? "" : active?.url || "";
    const [back, forward, reload] = shadow.querySelectorAll(".nav > button");
    back.disabled = !active || active.historyIndex <= 0;
    forward.disabled = !active || active.historyIndex >= active.history.length - 1;
    reload.textContent = active?.loading ? "×" : "↻";
    setStatus(active?.error || "");
    syncRails();
    window.dispatchEvent(new Event("codex-global-browser-change"));
    position();
  }

  async function show() {
    try {
      await initialize();
      open = true;
      root.hidden = false;
      render();
      return true;
    } catch (error) {
      window.alert(`浏览器未能打开：${error.message}`);
      return false;
    }
  }

  function hide() {
    open = false;
    threadPanelOpen = false;
    closeThreadFloat();
    if (railRight) railRight.dataset.open = "false";
    shadow?.querySelector("[data-thread-launcher]")?.setAttribute("aria-expanded", "false");
    syncWebviews();
    if (root) root.hidden = true;
    window.dispatchEvent(new Event("codex-global-browser-change"));
    document.querySelector('[data-codex-sidebar-shortcut-name="浏览器"]')?.focus();
  }

  function selectTab(id) {
    if (!tabs.has(id)) throw new Error("标签页不存在");
    if (id !== activeId && shadow?.activeElement === address) address.blur();
    activeId = id;
    render();
    save();
  }

  async function newTab(input = HOME) {
    await initialize();
    const tab = addTab({ url: normalizeUrl(input) });
    selectTab(tab.id);
    if (open) address.focus();
    return tab.id;
  }

  async function navigate(input, id = activeId) {
    const url = normalizeUrl(input);
    const tab = tabs.get(id);
    if (!tab) throw new Error("标签页不存在");
    tab.url = url;
    tab.error = "";
    tab.history = [...tab.history.slice(0, tab.historyIndex + 1), url];
    tab.historyIndex = tab.history.length - 1;
    const frame = ensureFrame(tab);
    tab.loading = true;
    frame.src = url;
    if (shadow?.activeElement === address) address.blur();
    save();
    render();
  }

  function navigation(action) {
    const tab = tabs.get(activeId);
    if (!tab) return;
    if (action === "reload") { tab.loading = true; tab.error = ""; if (tab.frame) tab.frame.src = tab.url; render(); return; }
    if (action === "stop") { tab.loading = false; render(); return; }
    const delta = action === "goBack" ? -1 : action === "goForward" ? 1 : 0;
    const next = tab.historyIndex + delta;
    if (!delta || next < 0 || next >= tab.history.length) return;
    tab.historyIndex = next;
    tab.url = tab.history[next];
    tab.loading = true;
    tab.error = "";
    const frame = ensureFrame(tab);
    frame.src = tab.url;
    save();
    render();
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    tab.listeners.abort();
    tab.frame?.remove();
    tabs.delete(id);
    if (!tabs.size) addTab({ url: HOME });
    if (activeId === id) activeId = tabs.keys().next().value;
    render();
    save();
  }

  function getState() {
    return { open, activeId, tabs: [...tabs.values()].map(tab => ({
      id: tab.id, title: tab.title, url: tab.url, ready: tab.ready, registered: Boolean(tab.frame?.isConnected),
      error: tab.error, historyIndex: tab.historyIndex, historyLength: tab.history.length,
    })) };
  }

  function destroy() {
    hide();
    destroyed = true;
    events.abort();
    resize?.disconnect();
    clearInterval(layoutTimer);
    for (const tab of tabs.values()) { tab.listeners.abort(); tab.frame?.remove(); }
    tabs.clear();
    root?.remove();
    delete window.__codexGlobalBrowser;
  }

  window.__codexGlobalBrowser = { open: show, hide, newTab, selectTab, closeTab, navigate, getState, destroy, normalizeUrl };
})();
