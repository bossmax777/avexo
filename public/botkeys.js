/* Страница единого бота: ключ активации в карточке каждого кошелька.
   Код выпускается в админке площадки и работает, пока не отозван. Файл ничего
   в разметке страницы не переписывает — строка активации и плашка «Бот активен»
   добавляются отсюда, данные берутся через /api/hub/bot/*. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var note = function (m) { if (typeof toast === "function") toast(m); else console.log(m); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var state = function () { return (typeof S !== "undefined") ? S : null; };
  var kOf = function (a) { return (typeof keyOf === "function") ? keyOf(a) : (a.site + ":" + a.acct); };
  var cred = function (a) { return (typeof credOf === "function") ? credOf(a) : null; };
  var call = function (u, o) {
    return fetch(u, Object.assign({ headers: { "Content-Type": "application/json" } }, o || {}))
      .then(function (r) { return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ("Ошибка " + r.status)); return j; }); });
  };

  var ST = {};   /* ключ карточки → состояние активации */

  var CSS =
    ".bk-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:9px 0 2px}" +
    ".bk-row input{flex:1;min-width:142px;box-sizing:border-box;padding:9px 11px;border-radius:10px;" +
    "border:1px solid var(--line);background:var(--surface-2);color:var(--text);font:inherit;" +
    "font-size:12.5px;letter-spacing:.06em;text-transform:uppercase}" +
    ".bk-row input:focus{outline:none;border-color:var(--accent,#3b82f6)}" +
    ".bk-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;" +
    "font-size:11.5px;font-weight:600;border:1px solid #2BA87A;color:#2BA87A;background:rgba(43,168,122,.12)}" +
    ".bk-badge i{width:7px;height:7px;border-radius:50%;background:#2BA87A;flex:none;" +
    "box-shadow:0 0 0 3px rgba(43,168,122,.18)}" +
    ".bk-badge s{text-decoration:none;color:var(--muted);font-weight:400;letter-spacing:.06em}" +
    ".bk-note{font-size:11px;color:var(--muted);line-height:1.5;margin:4px 0 0;width:100%}" +
    ".bk-ok{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(6,8,12,.82);backdrop-filter:blur(5px);animation:bkIn .18s ease-out}" +
    "@keyframes bkIn{from{opacity:0}to{opacity:1}}" +
    "@keyframes bkPop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}" +
    ".bk-ok-box{text-align:center;padding:34px 30px;border-radius:18px;border:1px solid #2BA87A;" +
    "background:var(--surface,#11151c);box-shadow:0 30px 80px rgba(0,0,0,.6);max-width:380px;width:92%;" +
    "animation:bkPop .22s ease-out}" +
    ".bk-ok-box svg{width:62px;height:62px;margin-bottom:14px}" +
    ".bk-ok-box b{display:block;font-size:24px;letter-spacing:-.01em;margin-bottom:8px}" +
    ".bk-ok-box p{margin:0;font-size:13px;color:var(--muted);line-height:1.55}" +
    ".bk-ok-box code{display:inline-block;margin-top:12px;padding:7px 12px;border-radius:9px;" +
    "border:1px solid var(--line);font-size:13px;letter-spacing:.1em}";

  function css() {
    if ($("bkCss")) return;
    var st = document.createElement("style"); st.id = "bkCss"; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- экран «Активировано» ---------- */
  function okScreen(acct, code) {
    var el = document.createElement("div");
    el.className = "bk-ok";
    el.innerHTML = '<div class="bk-ok-box">' +
      '<svg viewBox="0 0 64 64" fill="none" stroke="#2BA87A" stroke-width="3.4" stroke-linecap="round">' +
      '<circle cx="32" cy="32" r="27"/><path d="M20 33l8.5 8.5L45 25"/></svg>' +
      "<b>Активировано</b>" +
      "<p>Бот включён для кошелька №" + esc(acct) + ".<br>Плашка «Бот активен» появилась в карточке.</p>" +
      "<code>" + esc(code) + "</code></div>";
    document.body.appendChild(el);
    var close = function () { el.remove(); };
    el.onclick = close;
    setTimeout(close, 4200);
  }

  /* ---------- строка активации в карточке ---------- */
  function rows() {
    css();
    var box = $("accs");
    if (!box) return;
    box.querySelectorAll(".acc").forEach(function (card) {
      var k = card.dataset.k;
      if (!k) return;
      var host = card.querySelector("[data-bk]");
      if (!host) {
        /* строка активации живёт в самой карточке, а не в раскрывающейся части:
           она должна быть видна, даже когда карточка свёрнута */
        var top = card.querySelector(".acc-top");
        host = document.createElement("div");
        host.setAttribute("data-bk", k);
        host.style.cssText = "padding:11px 16px 13px;border-top:1px solid var(--line)";
        if (top && top.nextSibling) card.insertBefore(host, top.nextSibling);
        else card.appendChild(host);
      }
      paint(host, k);
    });
  }

  function paint(host, k) {
    var s = ST[k];
    if (s && s.on) {
      host.innerHTML = '<div class="bk-row"><span class="bk-badge"><i></i>Бот активен' +
        (s.code ? " <s>" + esc(s.code) + "</s>" : "") + "</span></div>" +
        '<p class="bk-note">Код принят' + (s.at ? " · " + new Date(s.at).toLocaleDateString("ru-RU") : "") +
        ". Снять активацию может только администратор площадки.</p>";
      return;
    }
    if (host.querySelector("input")) return;   /* не затираем то, что уже набрано */
    host.innerHTML = '<div class="bk-row">' +
      '<input maxlength="19" placeholder="X7K9P-4M2QD-V8R3N" data-code="' + k + '">' +
      '<button class="btn btn-sm" data-go="' + k + '">Активировать</button></div>' +
      '<p class="bk-note">Ключ активации выдаёт администратор площадки.</p>';
    var inp = host.querySelector("input");
    var btn = host.querySelector("button");
    inp.oninput = function () {
      var v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
      inp.value = v.replace(/^(.{5})(.{1,5})?(.{1,5})?$/, function (m, a, b, c) {
        return a + (b ? "-" + b : "") + (c ? "-" + c : "");
      });
    };
    inp.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); go(k, inp, btn); } };
    inp.onclick = function (e) { e.stopPropagation(); };
    btn.onclick = function (e) { e.stopPropagation(); go(k, inp, btn); };
  }

  function go(k, inp, btn) {
    var S0 = state();
    var a = S0 && (S0.accounts || []).filter(function (x) { return kOf(x) === k; })[0];
    var c = a && cred(a);
    if (!a || !c) return note("Кошелёк не подключён");
    var code = (inp.value || "").trim();
    if (code.replace(/[^A-Z0-9]/gi, "").length < 9) return note("Код неполный. Формат: X7K9P-4M2QD-V8R3N");
    btn.disabled = true; btn.style.opacity = ".6";
    call("/api/hub/bot/activate", { method: "POST", body: JSON.stringify({ key: c.key, code: code }) })
      .then(function (j) {
        ST[k] = j.state;
        var host = document.querySelector('[data-bk="' + k + '"]');
        if (host) { host.innerHTML = ""; paint(host, k); }
        okScreen(a.acct, j.state.code || code);
        if (window.Notify) Notify.add({ kind: "acc", title: "Бот активирован · #" + a.acct,
          text: "Код " + (j.state.code || code) + " принят, торговый помощник включён." });
      })
      .catch(function (e) { note(e.message); })
      .then(function () { btn.disabled = false; btn.style.opacity = ""; });
  }

  /* ---------- состояние активации по всем кошелькам ---------- */
  function load() {
    var S0 = state();
    var list = (S0 && S0.accounts) || [];
    if (!list.length) return Promise.resolve();
    var body = list.map(function (a) { var c = cred(a); return c ? { key: c.key } : null; }).filter(Boolean);
    if (!body.length) return Promise.resolve();
    return call("/api/hub/bot/state", { method: "POST", body: JSON.stringify({ accounts: body }) })
      .then(function (j) {
        (j.items || []).forEach(function (it) { ST[it.site + ":" + it.acct] = it; });
        rows();
      })
      .catch(function () {});
  }

  function boot() {
    css(); rows(); load();
    var box = $("accs");
    if (box) new MutationObserver(function () { rows(); }).observe(box, { childList: true });
    setInterval(function () { load(); }, 45000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 500); });
  } else setTimeout(boot, 500);
})();
