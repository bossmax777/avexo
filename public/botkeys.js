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

  var ST = {};      /* ключ карточки → состояние активации */
  var HOST = {};     /* готовая строка активации: переносим тот же узел в новую карточку */
  var DRAFT = {};    /* запасная копия набранного кода */
  var FOCUS = null;  /* в каком поле стоял курсор, чтобы вернуть его после перерисовки */
  var CARET = 0;

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
    ".bk-left{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;" +
    "font-size:11.5px;font-weight:600;border:1px solid currentColor;background:rgba(255,255,255,.04)}" +
    ".bk-left i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}" +
    ".bk-left.g{color:#2BA87A}.bk-left.y{color:#E2B23A}.bk-left.r{color:#E5484D}" +
    ".bk-badge.gold{color:#C98A1E;border-color:#C98A1E55;background:#C98A1E14}" +
    ".bk-badge.gold i{background:#C98A1E}.bk-badge.off i{background:#E5484D}" +
    ".bk-badge.off{border-color:#E5484D;color:#E5484D;background:rgba(229,72,77,.12)}" +
    ".bk-badge.wait{border-color:#E2B23A;color:#E2B23A;background:rgba(226,178,58,.12)}" +
    ".bk-badge.wait i{background:#E2B23A;box-shadow:0 0 0 3px rgba(226,178,58,.18)}" +
    ".bk-kyc{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}" +
    ".bk-win{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(6,8,12,.82);backdrop-filter:blur(5px);padding:18px}" +
    ".bk-win-box{width:100%;max-width:430px;border:1px solid var(--line);border-radius:16px;" +
    "background:var(--surface,#11151c);padding:20px 22px 22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}" +
    ".bk-win h4{margin:0 0 6px;font-size:16px}" +
    ".bk-win p{margin:0 0 14px;font-size:12.5px;color:var(--muted);line-height:1.55}" +
    ".bk-file{display:block;margin-bottom:12px;font-size:12.5px;color:var(--muted)}" +
    ".bk-file input{display:block;margin-top:6px;width:100%;font:inherit;font-size:12.5px;color:var(--text)}" +
    ".bk-win-act{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}" +
    ".bk-err{color:#E5484D;font-size:12px;margin:0 0 10px;min-height:14px}" +
    ".bk-badge.off i{background:#E5484D;box-shadow:0 0 0 3px rgba(229,72,77,.18)}" +
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

  /* браузер шлёт blur и при обычном удалении узла, поэтому «ушёл ли пользователь»
     определяем по тому, куда он перевёл фокус или кликнул, а не по blur */
  function watch() {
    if (watch.on) return;
    watch.on = true;
    var away = function (t) {
      if (!t || !t.closest) return false;
      /* при удалении поля фокус уезжает на <body> — это перерисовка, а не уход */
      if (t === document.body || t === document.documentElement) return false;
      var i = t.closest("[data-code]");
      if (i) { FOCUS = i.getAttribute("data-code"); return false; }
      return !t.closest("[data-go]");
    };
    document.addEventListener("focusin", function (e) { if (away(e.target)) FOCUS = null; }, true);
    document.addEventListener("pointerdown", function (e) { if (away(e.target)) FOCUS = null; }, true);
  }

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
  /* кнопка верификации в карточке кошелька */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-kyc]");
    if (b) { e.preventDefault(); e.stopPropagation(); kycWin(b.getAttribute("data-kyc")); }
  });

  var LOADED = 0;
  function rows() {
    css();
    var box = $("accs");
    if (!box) return;
    var need = false;
    box.querySelectorAll(".acc").forEach(function (card) {
      var k = card.dataset.k;
      if (!k) return;
      var host = card.querySelector("[data-bk]");
      if (!host) {
        /* страница перерисовывает список кошельков раз в секунду. Если каждый раз
           создавать поле заново, набранный код исчезает прямо под руками, поэтому
           переносим в новую карточку ТОТ ЖЕ узел: значение и курсор в нём целы */
        host = HOST[k];
        if (!host) {
          host = document.createElement("div");
          host.setAttribute("data-bk", k);
          host.style.cssText = "padding:11px 16px 13px;border-top:1px solid var(--line)";
          HOST[k] = host;
        }
        /* строка активации живёт в самой карточке, а не в раскрывающейся части:
           она должна быть видна, даже когда карточка свёрнута */
        var top = card.querySelector(".acc-top");
        if (top && top.nextSibling) card.insertBefore(host, top.nextSibling);
        else card.appendChild(host);
      }
      paint(host, k);
      /* кошелёк появился в списке, а его состояния ещё нет — спрашиваем сервер.
         Иначе срок ключа показался бы только через 45 секунд, на следующем опросе. */
      if (!ST[k]) need = true;
    });
    if (need && Date.now() - LOADED > 4000) { LOADED = Date.now(); load(); }
  }

  /* сколько осталось до конца срока: сервер присылает дату, пересчитываем на лету,
     чтобы отсчёт шёл и между запросами к серверу */
  function leftMs(s) {
    if (!s || !s.until) return null;
    return Math.max(0, new Date(s.until).getTime() - Date.now());
  }
  /* цвет полоски срока: 30 дней и больше зелёный, от 10 жёлтый, последние 3 дня красный */
  function leftTone(ms) {
    var d = ms / 86400000;
    return d <= 3 ? "r" : (d <= 10 ? "y" : "g");
  }
  function leftTxt(ms) {
    var d = Math.floor(ms / 86400000);
    var h = Math.floor(ms % 86400000 / 3600000);
    var m = Math.floor(ms % 3600000 / 60000);
    var sec = Math.floor(ms % 60000 / 1000);
    if (d > 0) return d + " д " + h + " ч";
    if (h > 0) return h + " ч " + m + " мин";
    return m + " мин " + (sec < 10 ? "0" : "") + sec + " с";
  }

  /* верификация кошелька: показываем состояние и кнопку отправки документов.
     Строка появляется только у активированных кошельков — как и просил владелец. */
  function kycRow(s, k) {
    var st = s && s.kyc;
    if (st === "approved") {
      return '<div class="bk-kyc"><span class="bk-badge"><i></i>Аккаунт верифицирован</span>' +
        '<span class="bk-note" style="width:auto;margin:0">документы приняты площадкой</span></div>';
    }
    if (st === "pending") {
      return '<div class="bk-kyc"><span class="bk-badge wait"><i></i>Документы на проверке</span>' +
        '<span class="bk-note" style="width:auto;margin:0">решение придёт в кабинет</span></div>';
    }
    return '<div class="bk-kyc">' +
      '<button class="btn btn-sm" data-kyc="' + k + '">Отправить паспорт</button>' +
      '<span class="bk-note" style="width:auto;margin:0">' +
      (st === "rejected" ? "верификация отклонена — можно отправить документы заново"
                         : "аккаунт не верифицирован") + "</span></div>";
  }

  /* файл в строку data:URL — в таком виде снимок уходит на площадку */
  function readFile(f) {
    return new Promise(function (ok, no) {
      if (!f) return ok(null);
      if (f.size > 4 * 1024 * 1024) return no(new Error("Файл больше 4 МБ: " + f.name));
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return no(new Error("Нужен снимок JPG, PNG или WEBP"));
      var r = new FileReader();
      r.onload = function () { ok({ kind: "id", name: f.name, data: String(r.result) }); };
      r.onerror = function () { no(new Error("Не удалось прочитать файл")); };
      r.readAsDataURL(f);
    });
  }

  /* доступ к кошельку по ключу карточки: ключ API берём из того же хранилища,
     что и остальная страница */
  function credOfKey(k) {
    var S0 = state();
    var a = ((S0 && S0.accounts) || []).filter(function (x) { return kOf(x) === k; })[0];
    return a ? cred(a) : null;
  }
  /* общее окно «готово»: тот же вид, что и после активации ключа */
  function okBox(title, text) {
    var el = document.createElement("div");
    el.className = "bk-ok";
    el.innerHTML = '<div class="bk-ok-box">' +
      '<svg viewBox="0 0 64 64" fill="none" stroke="#2BA87A" stroke-width="3.4" stroke-linecap="round">' +
      '<circle cx="32" cy="32" r="27"/><path d="M20 33l8.5 8.5L45 25"/></svg>' +
      "<b>" + esc(title) + "</b><p>" + esc(text) + "</p></div>";
    document.body.appendChild(el);
    var close = function () { el.remove(); };
    el.onclick = close;
    setTimeout(close, 4200);
  }

  function kycWin(k) {
    var cr = credOfKey(k);
    if (!cr) return;
    var win = document.createElement("div");
    win.className = "bk-win";
    win.innerHTML = '<div class="bk-win-box">' +
      "<h4>Верификация кошелька</h4>" +
      "<p>Нужны два снимка: страница паспорта с фотографией и селфи с этим же документом в руках. " +
      "JPG, PNG или WEBP, до 4 МБ каждый. Учебный стенд: снимки видит только администратор площадки.</p>" +
      '<label class="bk-file">Паспорт — страница с фотографией' +
        '<input type="file" accept="image/jpeg,image/png,image/webp" data-f="doc"></label>' +
      '<label class="bk-file">Селфи с паспортом' +
        '<input type="file" accept="image/jpeg,image/png,image/webp" data-f="self"></label>' +
      '<p class="bk-err" data-err></p>' +
      '<div class="bk-win-act"><button class="btn btn-sm" data-no>Отмена</button>' +
      '<button class="btn btn-sm btn-primary" data-go>Отправить</button></div></div>';
    document.body.appendChild(win);
    var err = win.querySelector("[data-err]");
    var close = function () { win.remove(); };
    win.onclick = function (e) { if (e.target === win) close(); };
    win.querySelector("[data-no]").onclick = close;
    win.querySelector("[data-go]").onclick = function () {
      var go = this;
      var a = win.querySelector('[data-f="doc"]').files[0];
      var b = win.querySelector('[data-f="self"]').files[0];
      err.textContent = "";
      if (!a || !b) { err.textContent = "Приложите оба снимка"; return; }
      go.disabled = true; go.textContent = "Отправляем…";
      Promise.all([readFile(a), readFile(b)])
        .then(function (docs) {
          return call("/api/hub/kyc", { method: "POST",
            body: JSON.stringify({ key: cr.key, docs: [docs[0], { kind: "selfie", name: docs[1].name, data: docs[1].data }] }) });
        })
        .then(function (j) {
          if (j && j.state) ST[k] = j.state;
          close(); rows();
          okBox("Документы отправлены", "Заявка на верификацию принята. Решение примет администратор площадки.");
        })
        .catch(function (e) {
          err.textContent = e.message; go.disabled = false; go.textContent = "Отправить";
        });
    };
  }

  function paint(host, k) {
    var s = ST[k];
    if (s && s.on) {
      var ms = leftMs(s);
      var timer = "";
      if (ms !== null) {
        var tone = leftTone(ms);
        timer = ' <span class="bk-left ' + tone + '" data-left="' + k + '"><i></i>' +
          (ms > 0 ? "осталось " + leftTxt(ms) : "срок вышел") + "</span>";
      }
      host.innerHTML = '<div class="bk-row"><span class="bk-badge"><i></i>Бот активен' +
        (s.code ? " <s>" + esc(s.code) + "</s>" : "") + "</span>" + timer +
        '<span class="bk-badge gold"><i></i>Ключ активирован для золотой пары</span></div>' +
        '<p class="bk-note">Код принят.' +
        (ms !== null
          ? " Активация действует до " + new Date(s.until).toLocaleDateString("ru-RU") + "."
          : " Ключ бессрочный.") +
        " Пара XAU/USD — Золото открыта для сценариев, крипта и акции доступны без ключа.</p>" +
        kycRow(s, k);
      return;
    }
    /* срок вышел: показываем это над полем и просим ввести новый код */
    var gone = !!(s && s.expired);
    /* узел перенесён из прежней карточки — он уже собран, вернуть нужно только курсор */
    if (host.querySelector("input")) { aim(host, k); return; }
    host.innerHTML =
      '<div class="bk-row"><span class="bk-badge off"><i></i>' +
      (gone ? "Срок ключа истёк" : "Ключ не активирован") + "</span>" +
      '<span class="bk-badge off"><i></i>Золотая пара закрыта</span></div>' +
      '<div class="bk-row">' +
      '<input maxlength="19" placeholder="X7K9P-4M2QD-V8R3N" autocomplete="off" ' +
      'autocapitalize="characters" spellcheck="false" data-code="' + k + '">' +
      '<button class="btn btn-sm" data-go="' + k + '">Активировать</button></div>' +
      '<p class="bk-note">' + (gone
        ? "Активация закончилась" + (s.until ? " " + new Date(s.until).toLocaleDateString("ru-RU") : "") +
          ". Введите новый ключ — его выдаёт администратор площадки."
        : "Ключ активации выдаёт администратор площадки.") + "</p>";
    var inp = host.querySelector("input");
    var btn = host.querySelector("button");
    /* страница хаба обновляет карточки сама, поле при этом создаётся заново —
       возвращаем набранное и курсор, иначе код «пропадает» прямо во время ввода */
    if (DRAFT[k]) inp.value = DRAFT[k];
    var fmt = function () {
      var v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
      inp.value = v.replace(/^(.{5})(.{1,5})?(.{1,5})?$/, function (m, a, b, c) {
        return a + (b ? "-" + b : "") + (c ? "-" + c : "");
      });
      DRAFT[k] = inp.value;
      CARET = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    };
    if (inp.value) fmt();
    inp.oninput = fmt;
    inp.onpaste = function () { setTimeout(fmt, 0); };
    inp.onfocus = function () { FOCUS = k; };
    inp.onkeydown = function (e) {
      FOCUS = k;
      if (e.key === "Enter") { e.preventDefault(); go(k, inp, btn); }
    };
    inp.onkeyup = function () {
      if (inp.selectionStart != null) CARET = inp.selectionStart;
    };
    inp.onclick = function (e) { e.stopPropagation(); FOCUS = k; };
    btn.onclick = function (e) { e.stopPropagation(); go(k, inp, btn); };
    aim(host, k);
  }

  /* вернуть курсор в поле после перерисовки карточек */
  function aim(host, k) {
    if (FOCUS !== k) return;
    var inp = host.querySelector("input");
    if (!inp || document.activeElement === inp) return;
    try {
      inp.focus({ preventScroll: true });
      var c = Math.min(CARET, inp.value.length);
      inp.setSelectionRange(c, c);
    } catch (e) {}
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
        delete DRAFT[k];
        FOCUS = null;
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
    LOADED = Date.now();
    return call("/api/hub/bot/state", { method: "POST", body: JSON.stringify({ accounts: body }) })
      .then(function (j) {
        (j.items || []).forEach(function (it) { ST[it.site + ":" + it.acct] = it; });
        rows();
      })
      .catch(function () {});
  }

  function boot() {
    css(); watch(); rows(); load();
    var box = $("accs");
    if (box) new MutationObserver(function () { rows(); }).observe(box, { childList: true });
    setInterval(function () { load(); }, 45000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 500); });
  } else setTimeout(boot, 500);
})();
