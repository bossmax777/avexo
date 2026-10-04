/* Единый бот: вывод средств по кошельку, отчёт за сутки в Telegram и уведомления.
   Подключается к готовой странице: кнопки и окно добавляются отсюда,
   остальной код страницы не меняется. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var money = function (n) {
    return "$" + Number(n || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var note = function (m) { if (typeof toast === "function") toast(m); };
  var call = function (u, o) {
    if (typeof api !== "function") return Promise.reject(new Error("страница ещё не готова"));
    return api(u, o);
  };
  var state = function () { return (typeof S !== "undefined") ? S : null; };
  var kOf = function (a) { return (typeof keyOf === "function") ? keyOf(a) : (a.site + ":" + a.acct); };

  var CSS =
    ".ovl{position:fixed;inset:0;background:rgba(6,9,14,.72);display:flex;align-items:center;" +
    "justify-content:center;padding:18px;z-index:9998;overflow:auto}" +
    ".ovl-box{position:relative;width:100%;max-width:430px;background:var(--surface);" +
    "border:1px solid var(--line);border-radius:16px;padding:22px 20px;box-shadow:0 24px 60px rgba(0,0,0,.45)}" +
    ".ovl-box h3{margin:0 0 8px;font-size:17px}" +
    ".ovl-x{position:absolute;top:10px;right:12px;background:none;border:0;color:var(--muted);" +
    "font-size:22px;line-height:1;cursor:pointer}" +
    ".of-row{margin:0 0 11px}" +
    ".of-row label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}" +
    ".of-row input,.of-row select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;" +
    "border:1px solid var(--line);background:var(--surface-2);color:var(--text);font:inherit;font-size:13px}" +
    ".of-calc{border:1px solid var(--line);border-radius:11px;padding:10px 12px;margin:12px 0 10px}" +
    "#repPre{white-space:pre-wrap;font-size:11.5px;line-height:1.5;color:var(--muted);" +
    "border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:10px;" +
    "max-height:200px;overflow:auto}";

  function build() {
    if (!$("hubExtraCss")) {
      var st = document.createElement("style"); st.id = "hubExtraCss"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    /* колокольчик в шапке */
    if (window.Notify && !$("bellSlot")) {
      var out = $("btnOut");
      if (out && out.parentNode) {
        var slot = document.createElement("span");
        slot.id = "bellSlot";
        slot.style.display = "inline-flex";
        out.parentNode.insertBefore(slot, out);
        Notify.mount(slot, { api: false });
      }
    }
    /* кнопка отчёта под кнопкой фиксации */
    if (!$("btnReport")) {
      var fix = $("btnFix");
      if (fix && fix.parentNode) {
        var b = document.createElement("button");
        b.className = "btn btn-full"; b.id = "btnReport";
        b.style.marginTop = "9px";
        b.textContent = "Отчёт за сутки в Telegram";
        var pre = document.createElement("div");
        pre.id = "repPre"; pre.hidden = true;
        var p = document.createElement("p");
        p.className = "note"; p.style.marginTop = "8px";
        p.textContent = "Отчёт за сутки по каждому кошельку уходит в Telegram автоматически вместе " +
          "с фиксацией итога дня. Кнопка выше отправляет его по выбранным кошелькам сразу; для работы " +
          "нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в переменных приложения.";
        fix.parentNode.insertBefore(b, fix.nextSibling);
        b.parentNode.insertBefore(pre, b.nextSibling);
        var last = fix.parentNode.querySelectorAll("p.note");
        (last.length ? last[last.length - 1] : pre).insertAdjacentElement("afterend", p);
        b.onclick = function () { sendReport(); };
      }
    }
    outButtons();
  }

  /* кнопка вывода в карточке каждого кошелька */
  function outButtons() {
    var box = $("accs"); if (!box) return;
    box.querySelectorAll(".acc").forEach(function (card) {
      var k = card.dataset.k;
      if (!k || card.querySelector("[data-out]")) return;
      var row = card.querySelector("[data-del]");
      if (!row || !row.parentNode) return;
      var b = document.createElement("button");
      b.className = "btn btn-sm";
      b.setAttribute("data-out", k);
      b.textContent = "Вывести средства";
      row.parentNode.insertBefore(b, row);
      b.onclick = function (e) { e.stopPropagation(); withdrawBox(k); };
    });
  }

  /* ---------- отчёт за сутки ---------- */
  function sendReport() {
    var S0 = state(); if (!S0) return;
    var keys = [].concat(Array.from(S0.sel || []));
    var list = (typeof credsOf === "function") ? credsOf(keys) : [];
    var btn = $("btnReport");
    if (btn) { btn.disabled = true; btn.style.opacity = ".6"; }
    call("/api/hub/report", { method: "POST", body: JSON.stringify({ accounts: list }) })
      .then(function (j) {
        if (j.sent) {
          note("Отчёт отправлен в Telegram по " + j.items + " кошельку(ам)");
          if (window.Notify) Notify.add({ kind: "fix", title: "Отчёт за сутки отправлен в Telegram",
            text: "Кошельков в отчёте: " + j.items });
        } else note(j.error || "Отчёт не отправлен");
        var pre = $("repPre");
        if (pre && j.preview) { pre.hidden = false; pre.textContent = j.preview; }
      })
      .catch(function (e) { note(e.message); })
      .then(function () { if (btn) { btn.disabled = false; btn.style.opacity = ""; } });
  }

  /* ---------- вывод средств ---------- */
  var METH = null;
  function methods() {
    if (METH) return Promise.resolve(METH);
    return call("/api/hub/methods").then(function (j) { METH = j.methods || {}; return METH; })
      .catch(function () { METH = {}; return METH; });
  }
  function withdrawBox(k) {
    var S0 = state(); if (!S0) return;
    var a = (S0.accounts || []).filter(function (x) { return kOf(x) === k; })[0];
    var c = (a && typeof credOf === "function") ? credOf(a) : null;
    if (!a || !c) return note("Кошелёк не подключён");
    methods().then(function (M) {
      var keys = Object.keys(M);
      if (!keys.length) return note("Способы вывода недоступны");
      var el = document.createElement("div");
      el.className = "ovl";
      el.innerHTML = '<div class="ovl-box"><button class="ovl-x" aria-label="Закрыть">×</button>' +
        "<h3>Вывод средств · кошелёк #" + a.acct + "</h3>" +
        '<p class="note">Площадка ' + (a.siteName || a.site) + " · доступно " + money(a.balance) +
        ". Заявка попадёт в историю операций кабинета и в панель администратора площадки.</p>" +
        '<div class="of-row"><label>Способ получения</label><select id="ofM">' +
        keys.map(function (x) {
          return '<option value="' + x + '">' + M[x].name + " · сбор " + (M[x].fee * 100).toFixed(1) +
            "% · от $" + M[x].min + " · " + M[x].eta + "</option>";
        }).join("") + "</select></div>" +
        '<div class="of-row"><label>Сумма вывода, $</label>' +
        '<input id="ofA" class="num" type="number" min="10" step="10" value="' +
        Math.max(10, Math.floor(Number(a.balance) || 0)) + '"></div>' +
        '<div class="of-row"><label>Реквизиты получателя</label>' +
        '<input id="ofR" placeholder="номер карты, счёта или адрес кошелька" autocomplete="off"></div>' +
        '<div class="of-row"><label>Получатель (необязательно)</label>' +
        '<input id="ofN" maxlength="60" placeholder="как указано в реквизитах" value="' +
        (a.name || "") + '"></div>' +
        '<div class="of-calc" id="ofCalc"></div>' +
        '<p class="note">Сервер сохраняет только последние четыре знака реквизитов — полный номер ' +
        "не хранится и не показывается. Это учебный стенд: настоящих переводов не происходит.</p>" +
        '<div class="err" id="ofErr"></div>' +
        '<button class="btn btn-primary btn-full" id="ofGo" style="margin-top:10px">' +
        "Создать заявку на вывод</button></div>";
      document.body.appendChild(el);
      var close = function () { el.remove(); };
      el.querySelector(".ovl-x").onclick = close;
      el.onclick = function (e) { if (e.target === el) close(); };
      var err = function (m) {
        var e = el.querySelector("#ofErr");
        e.textContent = m || ""; e.style.display = m ? "block" : "none";
      };
      function calc() {
        var m = M[el.querySelector("#ofM").value] || M[keys[0]];
        var amt = Number(el.querySelector("#ofA").value) || 0;
        var fee = amt * m.fee, net = Math.max(0, amt - fee);
        el.querySelector("#ofCalc").innerHTML =
          '<div class="fc-row"><span>Сбор площадки</span><b class="num down">' + money(fee) + "</b></div>" +
          '<div class="fc-row"><span>К зачислению</span><b class="num">' + money(net) + "</b></div>" +
          '<div class="fc-row"><span>Остаток на кошельке</span><b class="num">' +
          money(Math.max(0, (Number(a.balance) || 0) - amt)) + "</b></div>" +
          '<div class="fc-row"><span>Срок</span><b>' + m.eta + "</b></div>";
      }
      el.querySelector("#ofM").onchange = function () { err(""); calc(); };
      el.querySelector("#ofA").oninput = function () { err(""); calc(); };
      el.querySelector("#ofR").oninput = function () { err(""); };
      calc();
      el.querySelector("#ofGo").onclick = function () {
        var m = el.querySelector("#ofM").value;
        var amt = Number(el.querySelector("#ofA").value) || 0;
        var rq = (el.querySelector("#ofR").value || "").trim();
        var nm = (el.querySelector("#ofN").value || "").trim();
        if (amt <= 0) return err("Укажите сумму вывода");
        if (amt > (Number(a.balance) || 0)) return err("На кошельке только " + money(a.balance));
        if (rq.replace(/\s+/g, "").length < 4) return err("Укажите реквизиты получателя");
        var go = el.querySelector("#ofGo");
        go.disabled = true; go.style.opacity = ".6";
        call("/api/hub/withdraw", { method: "POST", body: JSON.stringify({
          site: a.site, acct: a.acct, key: c.key, method: m, amount: amt, req: rq, name: nm }) })
          .then(function (j) {
            close();
            note("Заявка " + j.ref + " на " + money(j.amount) + " создана · " + j.mask);
            if (window.Notify) Notify.add({ kind: "out",
              title: "Заявка на вывод " + money(j.amount) + " · #" + j.acct,
              text: j.method + " · " + j.mask + " · к зачислению " + money(j.net) +
                " · срок " + j.eta + " · заявка " + j.ref });
            if (typeof refresh === "function") refresh();
          })
          .catch(function (e) { go.disabled = false; go.style.opacity = ""; err(e.message); });
      };
      el.querySelector("#ofA").focus();
    });
  }

  /* ---------- уведомления о рынке и фиксации ---------- */
  function market() {
    if (!window.Notify || typeof mktOpen !== "function") return;
    var open = !!mktOpen();
    var info = open ? "Обе площадки работают, сценарии продолжаются." : "";
    if (!open) {
      var t = $("mktStopT");
      info = (t && t.textContent) || "Новые сессии не запускаются, сценарии на паузе.";
    }
    Notify.market(open, info);
  }
  /* к штатной фиксации добавляем уведомление, саму функцию не переписываем */
  function wrapFix() {
    if (typeof window.fixNow !== "function" || window.fixNow._wrapped) return;
    var orig = window.fixNow;
    var wrapped = function (keys) {
      var before = $("toast") ? $("toast").textContent : "";
      var r = orig.apply(this, arguments);
      setTimeout(function () {
        var t = $("toast");
        if (!t || !window.Notify) return;
        var txt = t.textContent || "";
        if (txt && txt !== before && /Записано в историю/.test(txt)) {
          Notify.add({ kind: "fix", key: "fixhub:" + new Date().toISOString().slice(0, 10) + ":" + txt,
            title: "Итог дня записан", text: txt.replace("Записано в историю: ", "") +
              " · строка «Результат дня» добавлена в историю операций кабинета." });
        }
      }, 1200);
      return r;
    };
    wrapped._wrapped = true;
    window.fixNow = wrapped;
  }

  function boot() {
    build(); wrapFix(); market();
    var box = $("accs");
    if (box) new MutationObserver(function () { outButtons(); }).observe(box, { childList: true });
    setInterval(function () { build(); wrapFix(); market(); }, 30000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 350); });
  } else setTimeout(boot, 350);
})();
