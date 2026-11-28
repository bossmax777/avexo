/* Итог дня одной кнопкой: «как вчера, но на N %».
   Берём по каждому кошельку его вчерашний итог торгового дня, умножаем на
   заданный процент и записываем тем же механизмом, что и ручной список.
   Ничего нового на сервере не требуется: читаем /api/admin/users,
   пишем через /api/admin/mass-rows — сначала вхолостую, потом по подтверждению. */
(function () {
  "use strict";

  var KEYS = ["avexo_admin_key", "nordis_admin_key", "hub_admin_key"];
  function el(id) { return document.getElementById(id); }
  function key() {
    if (window.API && API.key) return API.key;
    for (var i = 0; i < KEYS.length; i++) {
      var v = sessionStorage.getItem(KEYS[i]);
      if (v) return v;
    }
    return "";
  }
  function money(v) {
    var s = Math.abs(Number(v) || 0).toFixed(2).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (Number(v) < 0 ? "-" : "") + "$" + s.join(",");
  }
  function ask(url, body) {
    return fetch(url, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", "X-Admin-Key": key() }
        : { "X-Admin-Key": key() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {}
        if (!j) throw new Error("сервер ответил не по форме (" + r.status + ")");
        if (j.error) throw new Error(j.error);
        return j;
      });
    });
  }
  /* 2026-11-28 -> 27.11.2026 (предыдущий день в том виде, в каком он лежит в истории) */
  function prevRu(iso) {
    var p = String(iso || "").split("-");
    if (p.length < 3) return "";
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) - 86400000);
    var z = function (n) { return (n < 10 ? "0" : "") + n; };
    return z(d.getUTCDate()) + "." + z(d.getUTCMonth() + 1) + "." + d.getUTCFullYear();
  }
  function ruOf(iso) {
    var p = String(iso || "").split("-");
    return p.length < 3 ? iso : p[2] + "." + p[1] + "." + p[0];
  }
  function amt(s) { return Number(String(s).replace(/[^0-9.\-]/g, "")) || 0; }

  var CSS =
    "#dpBox{margin:0 0 14px}" +
    "#dpBox .dp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}" +
    "#dpBox input{width:120px}" +
    "#dpBox .dp-say{margin-top:8px;font-size:13px;opacity:.8}" +
    "#dpBox .dp-prev{margin-top:10px;font-size:13px;line-height:1.5}" +
    "#dpBox .dp-prev b{font-size:15px}";

  function build() {
    if (el("dpBox")) return true;
    var anchor = el("mdRowList") || el("mdDate");
    if (!anchor) return false;
    var host = anchor.closest(".card") || anchor.closest("section") || anchor.parentNode;
    if (!host || !host.parentNode) return false;

    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    var box = document.createElement("section");
    box.className = host.className || "card";
    box.id = "dpBox";
    box.innerHTML =
      '<h3 style="margin:0 0 4px">Итог дня в один клик</h3>' +
      '<div class="muted" style="font-size:12.5px;margin-bottom:10px">' +
      "Берёт вчерашний итог по каждому кошельку и пересчитывает его на заданный " +
      "процент. Дата берётся из поля выше. Пары и пропорции между кошельками " +
      "остаются прежними.</div>" +
      '<div class="dp-row">' +
        '<label>Процент к вчерашнему дню</label>' +
        '<input id="dpPct" type="text" inputmode="decimal" placeholder="например 3,2 или -4,7">' +
        '<button id="dpGo" type="button">Посчитать</button>' +
      "</div>" +
      '<div class="dp-say" id="dpSay"></div>' +
      '<div class="dp-prev" id="dpPrev" hidden></div>';
    host.parentNode.insertBefore(box, host);
    el("dpGo").addEventListener("click", run);
    return true;
  }

  var PLAN = null;

  function run() {
    var say = el("dpSay"), prev = el("dpPrev"), go = el("dpGo");
    prev.hidden = true; prev.innerHTML = "";
    PLAN = null;

    if (!key()) { say.textContent = "Сначала введите ключ администратора."; return; }
    var iso = ((el("mdDate") || {}).value || "").trim();
    if (!iso) { say.textContent = "Укажите дату операции в поле выше."; return; }
    var pct = Number(String((el("dpPct") || {}).value || "").replace(",", ".").replace("+", ""));
    if (!isFinite(pct) || pct === 0) { say.textContent = "Укажите процент, например 3,2 или -4,7"; return; }

    var day = prevRu(iso);
    var mul = 1 + pct / 100;
    go.disabled = true;
    say.textContent = "Читаю вчерашний день (" + day + ")…";

    ask("/api/admin/users").then(function (j) {
      var users = j.users || j.items || [];
      var items = [], miss = 0;
      users.forEach(function (u) {
        var row = (u.tx || []).filter(function (t) {
          return t && t[0] === day && /Итог торгового дня/.test(String(t[1] || ""));
        })[0];
        if (!row) { miss++; return; }
        var pair = (String(row[1]).split("·")[1] || "BTC/USD").trim();
        var v = amt(row[2]) * mul;
        if (!v) { miss++; return; }
        items.push({ acct: String(u.acct), amount: v.toFixed(2), pair: pair });
      });
      if (!items.length) throw new Error("за " + day + " итогов дня не нашлось — проверьте дату");

      say.textContent = "Проверяю на сервере…";
      return ask("/api/admin/mass-rows", {
        date: iso, pair: items[0].pair, items: items, dry: true
      }).then(function (d) {
        PLAN = { iso: iso, items: items, pct: pct, day: day };
        var was = items.reduce(function (a, x) { return a + Number(x.amount) / mul; }, 0);
        var skip = (d.skipped || []);
        prev.hidden = false;
        prev.innerHTML =
          "Дата: <b>" + ruOf(iso) + "</b> · вчера было " + money(was) +
          " → станет <b>" + money(d.total) + "</b> (" + (pct > 0 ? "+" : "") +
          String(pct).replace(".", ",") + " %)<br>" +
          "Кошельков в расчёте: <b>" + d.applied + "</b>" +
          (miss ? " · без вчерашнего дня, пропущены: " + miss : "") +
          (skip.length ? " · не пройдут: " + skip.length + " (" +
            skip.slice(0, 2).map(function (x) { return "#" + x.acct + " — " + x.error; }).join("; ") + ")" : "") +
          "<br><button id='dpWrite' type='button' style='margin-top:8px'>Записать итог за " +
          ruOf(iso) + "</button>";
        say.textContent = "";
        if (!d.applied) { say.textContent = "Записывать нечего."; return; }
        el("dpWrite").addEventListener("click", write);
      });
    }).catch(function (e) {
      say.textContent = "Не получилось: " + e.message;
    }).then(function () { go.disabled = false; });
  }

  function write() {
    if (!PLAN) return;
    var say = el("dpSay"), btn = el("dpWrite");
    btn.disabled = true; btn.textContent = "Записываю…";
    ask("/api/admin/mass-rows", {
      date: PLAN.iso, pair: PLAN.items[0].pair, items: PLAN.items
    }).then(function (r) {
      el("dpPrev").innerHTML = "<b>Записано: " + r.applied + " кошельк(ов), " +
        money(r.total) + "</b><br>Запуск №" + r.batch + " — его можно отменить целиком.";
      say.textContent = "Готово.";
      PLAN = null;
      if (typeof refresh === "function") { try { refresh(); } catch (e) {} }
    }).catch(function (e) {
      say.textContent = "Не получилось записать: " + e.message;
      btn.disabled = false; btn.textContent = "Повторить запись";
    });
  }

  function boot() { if (!build()) setTimeout(boot, 800); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 400); });
  } else setTimeout(boot, 400);
})();
