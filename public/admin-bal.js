/* Админка: вкладка «Балансы списком». Меняет только конечный баланс кошелька
   по номеру счёта — история операций и сделок остаётся нетронутой. Нужна,
   когда цифры в кабинете разошлись с отчётной таблицей: вставляем столбцы
   «номер — баланс», смотрим предварительный просчёт и применяем. */
(function () {
  "use strict";
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var money = function (n) {
    return "$" + Number(n || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var sig = function (n) { return (n >= 0 ? "+" : "−") + money(Math.abs(n)); };
  var call = function (p, o) {
    if (typeof api !== "function") return Promise.reject(new Error("админка ещё не готова"));
    return api(p, o);
  };
  var say = function (m) { if (typeof toast === "function") toast(m); else console.log(m); };

  var CSS =
    ".ab-t{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:12px}" +
    ".ab-t th{text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;" +
    "color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap}" +
    ".ab-t td{padding:8px 10px;border-bottom:1px solid var(--line)}" +
    ".ab-t tr:last-child td{border-bottom:0}" +
    ".ab-up{color:#2BA87A}.ab-down{color:#E5484D}.ab-bad{color:#E5484D}" +
    "#abList{width:100%;min-height:190px;font:inherit;font-size:12.5px;line-height:1.6;padding:11px 12px;" +
    "border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);" +
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
    ".ab-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:11px}" +
    ".ab-note{font-size:12.5px;color:var(--muted);line-height:1.55;margin:0 0 12px}";

  var PANE =
    '<div class="card"><h2>Балансы списком</h2>' +
    '<p class="ab-note">Меняет <b>только конечный баланс</b> кошелька — история операций и журнал ' +
    "сделок остаются как есть. Подходит, когда цифры в кабинете разошлись с отчётной таблицей.<br>" +
    "Одна строка — один кошелёк: <b>номер счёта и баланс</b>, через пробел или табуляцию " +
    "(можно вставить прямо из таблицы). Кошелёк ищется на обеих площадках по номеру.</p>" +
    '<textarea id="abList" spellcheck="false" placeholder="08210958\t89 835,47&#10;4032620\t411,58"></textarea>' +
    '<div class="ab-row">' +
    '<button class="btn" id="abCheck">Просчитать</button>' +
    '<button class="btn btn-primary" id="abApply" disabled>Применить балансы</button>' +
    '<button class="btn" id="abClear">Очистить</button>' +
    "</div>" +
    '<div id="abOut"></div></div>';

  var READY = [];

  function parse() {
    var txt = (el("abList") || {}).value || "";
    var rows = [];
    txt.split(/\n+/).forEach(function (line) {
      var s = line.replace(/ /g, " ").trim();
      if (!s) return;
      /* номер счёта — первое длинное число, баланс — последнее число строки */
      var acct = (s.match(/\d{5,}/) || [])[0] || "";
      var rest = acct ? s.slice(s.indexOf(acct) + acct.length) : s;
      var num = (rest.match(/-?[\d  ]+(?:[.,]\d{1,2})?\s*$/) || [])[0] || "";
      var bal = num.replace(/[  ]/g, "").replace(",", ".");
      if (!acct || bal === "") return;
      rows.push({ acct: acct, balance: bal });
    });
    return rows;
  }

  function draw(items, dry) {
    var box = el("abOut"); if (!box) return;
    var ok = items.filter(function (x) { return x.ok; });
    var bad = items.filter(function (x) { return !x.ok; });
    box.innerHTML =
      '<table class="ab-t"><tr><th>Кошелёк</th><th>Площадка</th><th>Клиент</th>' +
      "<th>Было</th><th>Станет</th><th>Разница</th></tr>" +
      ok.map(function (x) {
        return "<tr><td>#" + esc(x.acct) + "</td><td>" + esc(x.siteName || x.site) + "</td><td>" +
          esc(x.name || "—") + "</td><td>" + money(x.was) + "</td><td>" + money(x.now) +
          '</td><td class="' + (x.diff >= 0 ? "ab-up" : "ab-down") + '">' + sig(x.diff) + "</td></tr>";
      }).join("") + "</table>" +
      (bad.length
        ? '<p class="ab-note ab-bad" style="margin-top:10px">Не прошли ' + bad.length + ": " +
          bad.map(function (x) { return esc(x.acct || "—") + " (" + esc(x.error) + ")"; }).join("; ") + "</p>"
        : "") +
      '<p class="ab-note" style="margin-top:10px">' +
      (dry ? "Это предварительный просчёт — ничего ещё не записано." : "Балансы записаны.") + "</p>";
  }

  function check() {
    var rows = parse();
    if (!rows.length) return say("Не вижу ни одной строки «номер — баланс»");
    call("/api/admin/set-balances", { method: "POST", body: JSON.stringify({ rows: rows, dry: true }) })
      .then(function (j) {
        READY = rows;
        draw(j.items || [], true);
        el("abApply").disabled = !(j.items || []).some(function (x) { return x.ok; });
        say("Просчитано строк: " + rows.length);
      }).catch(function (e) { say(e.message); });
  }

  function apply() {
    if (!READY.length) return say("Сначала просчитайте список");
    if (!window.confirm("Записать новые балансы по " + READY.length + " строкам? " +
      "История операций не меняется, только конечные суммы.")) return;
    call("/api/admin/set-balances", { method: "POST", body: JSON.stringify({ rows: READY }) })
      .then(function (j) {
        draw(j.items || [], false);
        el("abApply").disabled = true;
        say("Балансы обновлены: " + (j.applied || 0));
      }).catch(function (e) { say(e.message); });
  }

  function build() {
    if (el("abPane")) return true;
    var host = document.querySelector('[data-pane="aichat"]') || document.querySelector('[data-pane="verify"]');
    if (!host || !host.parentNode) return false;
    if (!el("abCss")) {
      var st = document.createElement("style"); st.id = "abCss"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var p = document.createElement("div");
    p.id = "abPane"; p.setAttribute("data-pane", "balances"); p.hidden = true; p.innerHTML = PANE;
    host.parentNode.insertBefore(p, host.nextSibling);
    var tabs = document.getElementById("tabs");
    if (tabs && !tabs.querySelector('[data-tab="balances"]')) {
      var after = tabs.querySelector('[data-tab="aichat"]') || tabs.querySelector('[data-tab="verify"]');
      var b = document.createElement("button");
      b.setAttribute("data-tab", "balances");
      b.innerHTML = "<i></i>Балансы списком";
      if (after && after.parentNode) after.parentNode.insertBefore(b, after.nextSibling);
      else tabs.appendChild(b);
    }
    el("abCheck").onclick = check;
    el("abApply").onclick = apply;
    el("abClear").onclick = function () {
      el("abList").value = ""; el("abOut").innerHTML = ""; el("abApply").disabled = true; READY = [];
    };
    el("abList").oninput = function () { el("abApply").disabled = true; READY = []; };
    return true;
  }

  function boot() { if (!build()) setTimeout(boot, 700); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 700); });
  } else setTimeout(boot, 700);
})();
