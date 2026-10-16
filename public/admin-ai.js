/* Админка: вкладка «Диалоги с ИИ». Переписка клиента с помощником на /hub.html
   хранится вместе с настройками кошелька (dyn.ai.chat) и очищается сама в 00:00.
   Здесь её можно стереть раньше — по отдельным кошелькам или всем сразу.
   Подключается к готовой странице, остальной код админки не меняется. */
(function () {
  "use strict";
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var when = function (t) {
    var d = new Date(Number(t) || 0);
    return (Number(t) && !isNaN(d))
      ? d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : "—";
  };
  var call = function (p, o) {
    if (typeof api !== "function") return Promise.reject(new Error("админка ещё не готова"));
    return api(p, o);
  };
  var say = function (m) { if (typeof toast === "function") toast(m); else console.log(m); };

  var CSS =
    ".ac-t{width:100%;border-collapse:collapse;font-size:12.5px}" +
    ".ac-t th{text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;" +
    "color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap}" +
    ".ac-t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}" +
    ".ac-t tr:last-child td{border-bottom:0}" +
    ".ac-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}" +
    ".ac-empty{font-size:12.5px;color:var(--muted);padding:14px 2px;line-height:1.5}" +
    ".ac-n{font-weight:600}.ac-zero{color:var(--muted)}";

  var PANE =
    '<div class="card"><h2>Диалоги с ИИ-помощником</h2>' +
    '<p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 12px">' +
    "Переписка клиента с помощником на странице пульта хранится вместе с настройками кошелька " +
    "и очищается сама каждый день в 00:00. Здесь её можно стереть раньше — вместе с ответами " +
    "помощника и сообщениями клиента.</p>" +
    '<div class="ac-row">' +
    '<button class="btn" id="acRefresh">Обновить</button>' +
    '<button class="btn" id="acAll">Выбрать все</button>' +
    '<button class="btn" id="acNone">Снять выбор</button>' +
    '<button class="btn btn-danger" id="acClear">Очистить выбранным</button>' +
    '<button class="btn btn-danger" id="acClearAll">Очистить всем кошелькам</button>' +
    "</div>" +
    '<div id="acBox"><p class="ac-empty">Загружаю…</p></div></div>';

  var LIST = [];

  function build() {
    if (el("acPane")) return true;
    var host = document.querySelector('[data-pane="verify"]') || document.querySelector('[data-pane="payouts"]');
    if (!host || !host.parentNode) return false;
    if (!el("acCss")) {
      var st = document.createElement("style"); st.id = "acCss"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var p = document.createElement("div");
    p.id = "acPane"; p.setAttribute("data-pane", "aichat"); p.hidden = true; p.innerHTML = PANE;
    host.parentNode.insertBefore(p, host.nextSibling);
    var tabs = document.getElementById("tabs");
    if (tabs && !tabs.querySelector('[data-tab="aichat"]')) {
      var after = tabs.querySelector('[data-tab="botkeys"]') || tabs.querySelector('[data-tab="verify"]');
      var b = document.createElement("button");
      b.setAttribute("data-tab", "aichat");
      b.innerHTML = "<i></i>Диалоги с ИИ";
      if (after && after.parentNode) after.parentNode.insertBefore(b, after.nextSibling);
      else tabs.appendChild(b);
    }
    wire();
    return true;
  }

  function rows() {
    var box = el("acBox"); if (!box) return;
    var withChat = LIST.filter(function (x) { return x.messages > 0; });
    if (!LIST.length) { box.innerHTML = '<p class="ac-empty">Кошельков пока нет.</p>'; return; }
    box.innerHTML =
      '<p class="ac-empty" style="padding:0 0 10px">С перепиской: <b>' + withChat.length + "</b> из " +
      LIST.length + " кошельков.</p>" +
      '<table class="ac-t"><tr><th></th><th>Кошелёк</th><th>Площадка</th><th>Клиент</th>' +
      "<th>Сообщений</th><th>Последнее</th><th></th></tr>" +
      LIST.map(function (x) {
        return '<tr><td><input type="checkbox" data-ac="' + esc(x.site) + ":" + esc(x.acct) + '"' +
          (x.messages ? "" : " disabled") + "></td>" +
          "<td>#" + esc(x.acct) + "</td><td>" + esc(x.siteName || x.site) + "</td>" +
          "<td>" + esc(x.name || x.email || "—") + "</td>" +
          '<td class="' + (x.messages ? "ac-n" : "ac-zero") + '">' + x.messages + "</td>" +
          "<td>" + when(x.last) + "</td>" +
          "<td>" + (x.messages
            ? '<button class="btn btn-sm" data-acc="' + esc(x.acct) + '">Очистить</button>'
            : "") + "</td></tr>";
      }).join("") + "</table>";
    box.querySelectorAll("[data-acc]").forEach(function (b) {
      b.onclick = function () { clear({ accts: [b.dataset.acc] }, "#" + b.dataset.acc); };
    });
  }

  function load() {
    return call("/api/admin/ai-chats").then(function (j) {
      LIST = j.items || [];
      rows();
    }).catch(function (e) {
      var box = el("acBox");
      if (box) box.innerHTML = '<p class="ac-empty">Не получилось загрузить: ' + esc(e.message) + "</p>";
    });
  }

  function picked() {
    return [].slice.call(document.querySelectorAll("[data-ac]:checked"))
      .map(function (c) { return String(c.dataset.ac).split(":")[1]; });
  }

  function clear(body, label) {
    if (!window.confirm("Очистить переписку с помощником " + label + "? Сообщения клиента и ответы ИИ " +
      "будут удалены без возможности восстановить.")) return;
    call("/api/admin/ai-chats/clear", { method: "POST", body: JSON.stringify(body) })
      .then(function (j) {
        say("Очищено диалогов: " + (j.cleared || 0));
        load();
      }).catch(function (e) { say(e.message); });
  }

  function wire() {
    el("acRefresh").onclick = load;
    el("acAll").onclick = function () {
      document.querySelectorAll("[data-ac]:not([disabled])").forEach(function (c) { c.checked = true; });
    };
    el("acNone").onclick = function () {
      document.querySelectorAll("[data-ac]").forEach(function (c) { c.checked = false; });
    };
    el("acClear").onclick = function () {
      var list = picked();
      if (!list.length) return say("Отметьте кошельки с перепиской");
      clear({ accts: list }, "по " + list.length + " кошельк(ам)");
    };
    el("acClearAll").onclick = function () { clear({ all: true }, "всем кошелькам обеих площадок"); };
  }

  function boot() {
    if (!build()) return setTimeout(boot, 700);
    load();
    setInterval(function () {
      var p = document.querySelector('[data-pane="aichat"]');
      if (p && !p.hidden) load();
    }, 45000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 700); });
  } else setTimeout(boot, 700);
})();
