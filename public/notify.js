/* Уведомления кабинета: колокольчик в шапке и список событий.
   Серверные события (итог дня, вывод, пополнение, ответ поддержки) приходят
   из /api/notes, локальные (рынок, риск сценария) живут в браузере и, если
   есть вход, дублируются на сервер, чтобы были видны с другого устройства.
   Файл подключается и в кабинете, и на страницах ботов — внешних зависимостей нет. */
(function () {
  "use strict";
  if (window.Notify) return;

  var KINDS = {
    fix:  { ic: "M3 17l5-6 4 4 7-9", name: "Итог дня",    col: "var(--buy,#10B981)" },
    mkt:  { ic: "M12 7v5l3 2",       name: "Рынок",       col: "var(--sky,#38BDF8)" },
    risk: { ic: "M12 9v4M12 17h.01", name: "Риск",        col: "var(--warn,#F59E0B)" },
    out:  { ic: "M12 3v12M7 10l5 5 5-5", name: "Вывод",   col: "var(--sell,#EF4444)" },
    pay:  { ic: "M2 10h20M4 6h16v12H4z", name: "Пополнение", col: "var(--buy,#10B981)" },
    sup:  { ic: "M21 12a8 8 0 01-8 8H7l-4 3V12a8 8 0 018-8h2a8 8 0 018 8z", name: "Поддержка", col: "var(--accent,#4F46E5)" },
    acc:  { ic: "M12 8a4 4 0 100-8 4 4 0 000 8z", name: "Кошелёк", col: "var(--muted,#636B7E)" }
  };
  var LKEY = "notify_local_v1";
  var S = { list: [], local: [], api: false, open: false, el: null, panel: null, dot: null, busy: false };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function loadLocal() {
    try { S.local = JSON.parse(localStorage.getItem(LKEY)) || []; } catch (e) { S.local = []; }
    if (!Array.isArray(S.local)) S.local = [];
  }
  function saveLocal() {
    try { localStorage.setItem(LKEY, JSON.stringify(S.local.slice(0, 40))); } catch (e) {}
  }
  function merge() {
    var seen = {}, all = [];
    S.list.concat(S.local).forEach(function (n) {
      if (!n || !n.at) return;
      var k = n.key || n.id || (n.kind + n.title + n.at);
      if (seen[k]) return;
      seen[k] = 1; all.push(n);
    });
    all.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return all.slice(0, 60);
  }
  function unread() { return merge().filter(function (n) { return !n.read; }).length; }

  function when(at) {
    var t = new Date(at).getTime();
    if (!isFinite(t)) return "";
    var d = Math.round((Date.now() - t) / 60000);
    if (d < 1) return "только что";
    if (d < 60) return d + " мин назад";
    if (d < 1440) return Math.round(d / 60) + " ч назад";
    return new Date(t).toLocaleDateString("ru-RU") + " " +
      new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function css() {
    if (document.getElementById("ntf-css")) return;
    var st = document.createElement("style");
    st.id = "ntf-css";
    st.textContent =
      ".ntf-wrap{position:relative;display:inline-flex}" +
      ".ntf-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;" +
      "width:36px;height:36px;border-radius:10px;border:1px solid var(--line,#243041);cursor:pointer;" +
      "background:var(--surface,var(--card,#141b24));color:var(--text,#e6edf6);padding:0}" +
      ".ntf-btn:hover{border-color:var(--accent,#4F46E5)}" +
      ".ntf-btn svg{width:18px;height:18px}" +
      ".ntf-dot{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;border-radius:9px;" +
      "background:var(--sell,#EF4444);color:#fff;font:600 10.5px/17px system-ui,sans-serif;text-align:center;padding:0 4px}" +
      ".ntf-panel{position:fixed;width:330px;max-width:calc(100vw - 24px);" +
      "max-height:min(70vh,430px);overflow:auto;z-index:9999;border:1px solid var(--line,#243041);" +
      "border-radius:13px;background:var(--surface,var(--card,#151c26));color:var(--text,#e6edf6);" +
      "box-shadow:0 18px 44px rgba(8,12,20,.28)}" +
      ".ntf-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;" +
      "border-bottom:1px solid var(--line-soft,var(--line,#243041));position:sticky;top:0;" +
      "background:var(--surface,var(--card,#151c26))}" +
      ".ntf-head b{font-size:13.5px}" +
      ".ntf-all{border:0;background:none;color:var(--accent,#4F46E5);font-size:12px;cursor:pointer;padding:2px 4px}" +
      ".ntf-i{display:flex;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line-soft,var(--line,#243041))}" +
      ".ntf-i:last-child{border-bottom:0}" +
      ".ntf-i.un{background:var(--accent-soft,rgba(79,70,229,.07))}" +
      ".ntf-ic{flex:none;width:28px;height:28px;border-radius:9px;display:flex;align-items:center;" +
      "justify-content:center;background:var(--surface-2,rgba(255,255,255,.05))}" +
      ".ntf-ic svg{width:15px;height:15px}" +
      ".ntf-t{font-size:12.8px;font-weight:600;line-height:1.35;margin:0 0 3px}" +
      ".ntf-x{font-size:12px;line-height:1.45;color:var(--muted,#8b97a8);margin:0}" +
      ".ntf-w{font-size:11px;color:var(--dim,#7d8da1);margin:4px 0 0}" +
      ".ntf-empty{padding:26px 16px;text-align:center;font-size:12.5px;color:var(--muted,#8b97a8)}" +
      ".ntf-foot{padding:9px 14px;font-size:11px;color:var(--dim,#7d8da1);border-top:1px solid var(--line-soft,var(--line,#243041))}";
    document.head.appendChild(st);
  }

  function icon(kind) {
    var k = KINDS[kind] || KINDS.acc;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + k.col +
      '" stroke-width="1.9" stroke-linecap="round"><path d="' + k.ic + '"/></svg>';
  }

  function draw() {
    if (!S.panel) return;
    var list = merge();
    var n = list.filter(function (x) { return !x.read; }).length;
    if (S.dot) { S.dot.textContent = n > 9 ? "9+" : String(n); S.dot.hidden = !n; }
    S.panel.innerHTML =
      '<div class="ntf-head"><b>Уведомления</b>' +
      (n ? '<button class="ntf-all" type="button">Прочитать все</button>' : "") + "</div>" +
      (list.length ? list.map(function (x) {
        return '<div class="ntf-i' + (x.read ? "" : " un") + '">' +
          '<div class="ntf-ic">' + icon(x.kind) + "</div><div>" +
          '<p class="ntf-t">' + esc(x.title) + "</p>" +
          (x.text ? '<p class="ntf-x">' + esc(x.text) + "</p>" : "") +
          '<p class="ntf-w">' + (KINDS[x.kind] || KINDS.acc).name + " · " + when(x.at) + "</p>" +
          "</div></div>";
      }).join("") : '<div class="ntf-empty">Пока пусто. Здесь появятся итоги торгового дня, ' +
        "события рынка, предупреждения о рисках, заявки на вывод и пополнение, ответы поддержки.</div>") +
      '<div class="ntf-foot">Учебный демонстрационный стенд: события относятся к демо-кошелькам.</div>';
    var all = S.panel.querySelector(".ntf-all");
    if (all) all.onclick = function () { readAll(); };
  }

  function readAll() {
    S.local = S.local.map(function (x) { return Object.assign({}, x, { read: true }); });
    saveLocal();
    S.list = S.list.map(function (x) { return Object.assign({}, x, { read: true }); });
    draw();
    if (S.api) fetch("/api/notes/read", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify({ all: true })
    }).catch(function () {});
  }

  function pull() {
    if (!S.api || S.busy) return Promise.resolve();
    S.busy = true;
    return fetch("/api/notes", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && Array.isArray(j.notes)) { S.list = j.notes; draw(); } })
      .catch(function () {})
      .then(function () { S.busy = false; });
  }

  function add(n) {
    if (!n || !n.title) return;
    var note = {
      id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(), kind: n.kind || "acc",
      title: String(n.title), text: String(n.text || ""), key: n.key || "", read: false
    };
    if (note.key && merge().some(function (x) { return x.key === note.key; })) return;
    S.local.unshift(note); saveLocal(); draw();
    if (S.api && n.sync !== false && (note.kind === "mkt" || note.kind === "risk")) {
      fetch("/api/notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kind: note.kind, title: note.title, text: note.text, key: note.key })
      }).catch(function () {});
    }
    return note;
  }

  function mount(target, opts) {
    if (!target) return;
    css(); loadLocal();
    opts = opts || {};
    S.api = opts.api !== false;
    var wrap = document.createElement("div");
    wrap.className = "ntf-wrap";
    wrap.innerHTML = '<button class="ntf-btn" type="button" aria-label="Уведомления" title="Уведомления">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
      '<path d="M18 16V11a6 6 0 10-12 0v5l-2 3h16l-2-3z"/><path d="M10 21h4"/></svg>' +
      '<span class="ntf-dot" hidden>0</span></button><div class="ntf-panel" hidden></div>';
    target.appendChild(wrap);
    S.el = wrap;
    S.panel = wrap.querySelector(".ntf-panel");
    /* панель переносим в body: внутри шапки её перекрывают карточки страницы */
    document.body.appendChild(S.panel);
    S.dot = wrap.querySelector(".ntf-dot");
    var btn = wrap.querySelector(".ntf-btn");
    /* панель рисуем фиксированной: иначе её срезает шапка с overflow */
    function place() {
      if (!S.open) return;
      var r = btn.getBoundingClientRect();
      var w = Math.min(330, window.innerWidth - 24);
      S.panel.style.width = w + "px";
      S.panel.style.top = Math.round(r.bottom + 9) + "px";
      S.panel.style.left = Math.round(Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))) + "px";
      S.panel.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 26) + "px";
    }
    btn.onclick = function (e) {
      e.stopPropagation();
      S.open = !S.open; S.panel.hidden = !S.open;
      if (S.open) { place(); pull(); draw(); }
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("click", function (e) {
      if (S.open && !wrap.contains(e.target) && !S.panel.contains(e.target)) {
        S.open = false; S.panel.hidden = true;
      }
    });
    draw(); pull();
    setInterval(pull, 90000);
    return wrap;
  }

  /* события рынка: страница сообщает текущее состояние, повторы отсекаются ключом */
  function market(isOpen, info) {
    var day = new Date().toISOString().slice(0, 10);
    if (isOpen) add({ kind: "mkt", key: "mkt-open-" + day, title: "Биржа открыта — торги идут",
      text: info || "Сценарии продолжают работу, котировки обновляются." });
    else add({ kind: "mkt", key: "mkt-close-" + day, title: "Биржа закрыта — торги приостановлены",
      text: info || "Сделки не открываются, сценарии стоят до открытия." });
  }
  function risk(title, text, key) {
    add({ kind: "risk", key: key || ("risk-" + new Date().toISOString().slice(0, 10)), title: title, text: text });
  }

  /* страница может узнать о входе позже: тогда включаем серверные уведомления */
  function setApi(on) {
    on = !!on;
    if (S.api === on) return;
    S.api = on;
    if (on) pull(); else { S.list = []; draw(); }
  }

  window.Notify = {
    mount: mount, add: add, market: market, risk: risk, pull: pull,
    readAll: readAll, unread: unread, list: merge, setApi: setApi
  };
})();
