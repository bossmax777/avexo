/* Админка: раздел «Поддержка». Подключается к готовой странице и добавляет
   вкладку, панель и переписку с клиентом, не меняя остальной код админки. */
(function () {
  "use strict";
  var TK = { list: [], cur: null };
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var when = function (a) {
    var t = new Date(a);
    return isNaN(t) ? "" : t.toLocaleDateString("ru-RU") + " " +
      t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };
  var call = function (p, o) {
    if (typeof api !== "function") return Promise.reject(new Error("админка ещё не готова"));
    return api(p, o);
  };

  var CSS =
    ".tk-wrap{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:16px;align-items:start}" +
    ".tk-wrap>*{min-width:0}" +
    "@media (max-width:900px){.tk-wrap{grid-template-columns:minmax(0,1fr)}}" +
    ".tk-list{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow:auto}" +
    ".tk-card{text-align:left;border:1px solid var(--line);border-radius:11px;padding:10px 12px;" +
    "cursor:pointer;background:var(--surface,#fff);color:inherit;font:inherit}" +
    ".tk-card:hover{border-color:var(--accent)}" +
    ".tk-card.on{border-color:var(--accent);background:var(--accent-soft,rgba(79,70,229,.08))}" +
    ".tk-card b{display:block;font-size:13px;margin-bottom:3px}" +
    ".tk-card span{display:block;font-size:11.5px;color:var(--muted)}" +
    ".tk-card .tk-new{display:inline-block;width:auto;margin-top:5px;background:var(--sell,#EF4444);" +
    "color:#fff;border-radius:7px;font-size:10.5px;padding:1px 6px}" +
    ".tk-msgs{display:flex;flex-direction:column;gap:9px;max-height:380px;overflow:auto;margin:12px 0}" +
    ".tk-m{max-width:88%;border:1px solid var(--line);border-radius:12px;padding:9px 12px;" +
    "font-size:12.8px;line-height:1.5;white-space:pre-wrap;word-break:break-word}" +
    ".tk-m.user{align-self:flex-start;background:var(--surface-2,#f2f4fa)}" +
    ".tk-m.adm{align-self:flex-end;background:var(--accent-soft,rgba(79,70,229,.08))}" +
    ".tk-m i{display:block;font-size:10.5px;color:var(--muted);font-style:normal;margin-bottom:4px}" +
    ".tk-send{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);" +
    "border-radius:10px;font:inherit;font-size:13px;resize:vertical}" +
    ".tk-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}" +
    ".tk-empty{font-size:12.5px;color:var(--muted);padding:16px 2px;line-height:1.5}";

  var PANE =
    '<div class="card"><h2>Служба поддержки</h2>' +
    '<p class="sub">Обращения клиентов из кабинета. Ответ сразу виден пользователю в разделе ' +
    '«Поддержка», приходит ему в уведомления и на почту.</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn btn-ghost btn-sm" id="tkReload">Обновить</button>' +
      '<select id="tkFilter" style="padding:8px 10px;border-radius:9px;max-width:230px;width:auto">' +
        '<option value="">Все обращения</option><option value="open">В работе</option>' +
        '<option value="wait">Ждут ответа клиента</option><option value="closed">Закрытые</option></select>' +
      '<span class="sub" id="tkCount" style="margin:0"></span></div>' +
    '<div class="tk-wrap"><div class="tk-list" id="tkList"></div><div class="tk-chat" id="tkChat"></div></div></div>';

  function build() {
    if (el("tkPane")) return true;
    var host = document.querySelector('[data-pane="payouts"]');
    if (!host || !host.parentNode) return false;
    var st = document.createElement("style"); st.id = "tkCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var pane = document.createElement("div");
    pane.id = "tkPane";
    pane.setAttribute("data-pane", "support");
    pane.hidden = true;
    pane.innerHTML = PANE;
    host.parentNode.insertBefore(pane, host.nextSibling);
    var tabs = document.getElementById("tabs");
    if (tabs && !tabs.querySelector('[data-tab="support"]')) {
      var after = tabs.querySelector('[data-tab="payouts"]');
      var b = document.createElement("button");
      b.setAttribute("data-tab", "support");
      b.innerHTML = "<i></i>Поддержка";
      if (after) after.parentNode.insertBefore(b, after.nextSibling); else tabs.appendChild(b);
    }
    return true;
  }

  function list() {
    var box = el("tkList"); if (!box) return;
    if (!TK.list.length) { box.innerHTML = '<p class="tk-empty">Обращений нет.</p>'; }
    else box.innerHTML = TK.list.map(function (t) {
      return '<button class="tk-card' + (TK.cur && TK.cur.id === t.id ? " on" : "") +
        '" data-tk="' + t.id + '"><b>№' + t.id + " · " + esc(t.subject) + "</b><span>" +
        esc(t.name || t.email) + " · #" + esc(t.acct) + "</span><span>" +
        esc(t.topicName) + " · " + esc(t.statusName) + " · " + when(t.updated) + "</span>" +
        (t.unreadAdm ? '<span class="tk-new">новое сообщение</span>' : "") + "</button>";
    }).join("");
    var c = el("tkCount");
    if (c) c.textContent = TK.list.length ? ("всего " + TK.list.length + ", новых " +
      TK.list.filter(function (t) { return t.unreadAdm; }).length) : "";
  }

  function chat() {
    var box = el("tkChat"); if (!box) return;
    if (!TK.cur) {
      box.innerHTML = '<p class="tk-empty">Выберите обращение слева, чтобы прочитать переписку и ответить.</p>';
      return;
    }
    var t = TK.cur;
    box.innerHTML = '<h3 style="margin:0 0 4px">№' + t.id + " · " + esc(t.subject) + "</h3>" +
      '<p class="sub" style="margin:0">' + esc(t.name || t.email) + " · " + esc(t.email) +
      " · кошелёк #" + esc(t.acct) + " · " + esc(t.topicName) + " · " + esc(t.statusName) + "</p>" +
      '<div class="tk-msgs">' + (t.msgs || []).map(function (m) {
        return '<div class="tk-m ' + (m.who === "adm" ? "adm" : "user") + '"><i>' +
          esc(m.who === "adm" ? (m.name || "Поддержка") : (m.name || "Клиент")) + " · " + when(m.at) +
          "</i>" + esc(m.text) + "</div>";
      }).join("") + "</div>" +
      '<textarea class="tk-send" id="tkText" rows="3" maxlength="4000" placeholder="Ответ клиенту…"></textarea>' +
      '<div class="tk-act"><button class="btn btn-primary btn-sm" id="tkSend">Отправить ответ</button>' +
      '<button class="btn btn-ghost btn-sm" id="tkClose">Закрыть обращение</button>' +
      '<button class="btn btn-ghost btn-sm" id="tkOpen">Вернуть в работу</button></div>';
    var ms = box.querySelector(".tk-msgs"); if (ms) ms.scrollTop = ms.scrollHeight;
    el("tkSend").onclick = function () {
      var v = (el("tkText").value || "").trim();
      if (!v) return;
      this.disabled = true;
      call("/api/admin/tickets/" + t.id + "/msg", { method: "POST", body: JSON.stringify({ text: v }) })
        .then(function (j) { TK.cur = j.ticket; load(); })
        .catch(function (e) { alert(e.message); el("tkSend").disabled = false; });
    };
    el("tkClose").onclick = function () { setSt("closed"); };
    el("tkOpen").onclick = function () { setSt("open"); };
  }

  function setSt(st) {
    if (!TK.cur) return;
    call("/api/admin/tickets/" + TK.cur.id, { method: "PATCH", body: JSON.stringify({ status: st }) })
      .then(function (j) { TK.cur = j.ticket; load(); })
      .catch(function (e) { alert(e.message); });
  }

  function load() {
    if (!build()) return Promise.resolve();
    var f = el("tkFilter");
    return call("/api/admin/tickets" + (f && f.value ? "?status=" + f.value : ""))
      .then(function (j) {
        TK.list = (j && j.tickets) || [];
        if (TK.cur) TK.cur = TK.list.filter(function (x) { return x.id === TK.cur.id; })[0] || TK.cur;
        list(); chat();
      })
      .catch(function (e) {
        var box = el("tkList");
        if (box) box.innerHTML = '<p class="tk-empty">' + esc(e.message) + "</p>";
      });
  }
  window.renderSupport = load;

  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-tk]");
    if (c) {
      TK.cur = TK.list.filter(function (x) { return x.id === Number(c.dataset.tk); })[0] || null;
      list(); chat();
    }
    if (e.target.id === "tkReload") load();
    if (e.target.closest('[data-tab="support"]')) setTimeout(load, 60);
  });
  document.addEventListener("change", function (e) { if (e.target.id === "tkFilter") load(); });

  function boot() {
    build();
    setInterval(function () {
      if (!build()) return;
      var p = el("tkPane");
      if (p && !p.hidden) load();
    }, 45000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 500); });
  } else setTimeout(boot, 500);
})();

/* ---------------------------------------------------------------------------
   Админка: итог торгового дня сразу всем кошелькам.
   Выбираем дату, процент и направление — одна кнопка пишет каждому клиенту
   строку «Итог торгового дня · XAU/USD» и пересчитывает баланс. Процент берём
   от баланса предыдущего дня, то есть от того, что на кошельке до этой записи.
   Каждый запуск сохраняется на сервере пачкой, поэтому его можно отменить
   целиком: балансы вернутся, строки из истории операций уберутся.
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var call = function (p, o) {
    if (typeof api !== "function") return Promise.reject(new Error("админка ещё не готова"));
    return api(p, o);
  };
  var money = function (v) {
    v = Number(v) || 0;
    return (v < 0 ? "−" : "+") + "$" + Math.abs(v).toFixed(2);
  };
  var iso = function (d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  };
  var wallets = function () {
    try { return (typeof uLoad === "function" ? uLoad() : []) || []; } catch (e) { return []; }
  };

  var CSS =
    "#mdCard .md-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}" +
    "#mdCard .md-f{display:flex;flex-direction:column;gap:5px;min-width:150px}" +
    "#mdCard .md-f label{font-size:11.5px;color:var(--muted)}" +
    "#mdCard .md-f input,#mdCard .md-f select{padding:9px 10px;border:1px solid var(--line);" +
    "border-radius:9px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}" +
    "#mdCard .md-sum{font-size:12.5px;color:var(--muted);line-height:1.6;margin:0 0 12px}" +
    "#mdCard .md-sum b{color:inherit}" +
    "#mdCard .md-out{font-size:12.5px;line-height:1.6;border:1px solid var(--line);border-radius:10px;" +
    "padding:10px 12px;margin-bottom:12px}" +
    "#mdCard .md-list{display:flex;flex-direction:column;gap:7px}" +
    "#mdCard .md-b{display:flex;gap:10px;align-items:center;justify-content:space-between;" +
    "border:1px solid var(--line);border-radius:10px;padding:8px 11px;font-size:12.5px;flex-wrap:wrap}" +
    "#mdCard .md-b.off{opacity:.55}" +
    "#mdCard .md-b span{color:var(--muted)}";

  var PANE =
    '<div class="card" id="mdCard"><h2>Итог торгового дня — сразу всем кошелькам</h2>' +
    '<p class="sub">Учебная операция: одной кнопкой каждому клиенту площадки добавляется строка ' +
    '«Итог торгового дня · XAU/USD» за выбранную дату, баланс пересчитывается сразу — ' +
    'и в кабинете, и на странице бота. Процент считается от баланса предыдущего дня. ' +
    'Повторный запуск за ту же дату ничего не задваивает, а любой запуск отменяется целиком.</p>' +
    '<div class="md-row">' +
      '<div class="md-f"><label for="mdDate">Дата операции</label><input id="mdDate" type="date"></div>' +
      '<div class="md-f"><label for="mdPct">Процент к балансу</label>' +
        '<input id="mdPct" type="number" min="0.1" max="50" step="0.1" value="2"></div>' +
      '<div class="md-f"><label for="mdDir">Направление</label><select id="mdDir">' +
        '<option value="up">В плюс — прибыль</option>' +
        '<option value="down">В минус — убыток</option></select></div>' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="mdGo">Проставить всем</button></div>' +
    '</div>' +
    '<p class="md-sum" id="mdSum"></p>' +
    '<div class="md-row" style="margin-bottom:10px">' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="mdStop">Остановить все сценарии</button></div>' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="mdDrop">Сбросить сценарии без записи</button></div>' +
      '<div class="md-f" style="min-width:260px"><label>&nbsp;</label>' +
        '<span class="md-sum" id="mdStopSay" style="margin:0"></span></div>' +
    '</div>' +
    '<div class="md-out" id="mdOut" hidden></div>' +
    '<h3 style="font-size:13.5px;margin:0 0 6px">Вывод за эту же дату</h3>' +
    '<p class="sub" style="margin:0 0 10px">Доход ставится всем сразу, а вывод — точечно. ' +
    'Выберите кошелёк и сумму: строка «Вывод» уйдёт в историю операций клиента той же датой, ' +
    'баланс уменьшится, в отчёте за день вывод встанет отдельной колонкой, а на пульте сумма ' +
    'пересчитается сама. Запуск отменяется целиком, как и итог дня.</p>' +
    '<div class="md-row">' +
      '<div class="md-f" style="min-width:300px"><label for="mdOutAcct">Кошелёк</label>' +
        '<select id="mdOutAcct"></select></div>' +
      '<div class="md-f"><label for="mdOutAmt">Сумма вывода</label>' +
        '<input id="mdOutAmt" type="number" min="1" step="0.01" placeholder="например 1500"></div>' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="mdOutAdd">Добавить в список</button></div>' +
    '</div>' +
    '<div class="md-f" style="min-width:100%;margin-bottom:10px">' +
      '<label for="mdOutList">Список выводов — строка «номер кошелька сумма»</label>' +
      '<textarea id="mdOutList" rows="3" spellcheck="false" placeholder="4034823 1500"' +
      ' style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);' +
      'border-radius:10px;font:inherit;font-size:13px;line-height:1.6;resize:vertical"></textarea></div>' +
    '<div class="md-row">' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="mdOutGo">Записать выводы</button></div>' +
      '<div class="md-f" style="min-width:260px"><label>&nbsp;</label>' +
        '<span class="md-sum" id="mdOutSay" style="margin:0"></span></div>' +
    '</div>' +
    '<h3 style="font-size:13.5px;margin:0 0 6px">Итог дня списком — своя сумма каждому</h3>' +
    '<p class="sub" style="margin:0 0 10px">Когда день у кошельков разный: часть работала по золоту, ' +
    'часть по крипте, часть по акциям. Выберите пару и вставьте строки «номер кошелька сумма» — ' +
    'каждому запишется своя строка «Итог торгового дня · ПАРА» за выбранную дату, баланс пересчитается, ' +
    'а в отчёте будет видно, с какой пары заработок. Пачка отменяется целиком.</p>' +
    '<div class="md-row">' +
      '<div class="md-f" style="min-width:200px"><label for="mdRowPair">Пара</label>' +
        '<select id="mdRowPair">' +
          '<option value="XAU/USD">XAU/USD — золото</option>' +
          '<option value="BTC/USD">BTC/USD — биткоин</option>' +
          '<option value="ETH/USD">ETH/USD — эфир</option>' +
          '<option value="SOL/USD">SOL/USD</option>' +
          '<option value="XRP/USD">XRP/USD</option>' +
          '<option value="AAPL">AAPL — акции</option>' +
          '<option value="TSLA">TSLA — акции</option>' +
          '<option value="NVDA">NVDA — акции</option>' +
          '<option value="MSFT">MSFT — акции</option>' +
        '</select></div>' +
      '<div class="md-f" style="min-width:300px"><label for="mdRowAcct">Кошелёк</label>' +
        '<select id="mdRowAcct"></select></div>' +
      '<div class="md-f"><label for="mdRowAmt">Сумма итога</label>' +
        '<input id="mdRowAmt" type="number" step="0.01" placeholder="например 1250.50"></div>' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="mdRowAdd">Добавить в список</button></div>' +
    '</div>' +
    '<div class="md-f" style="min-width:100%;margin-bottom:10px">' +
      '<label for="mdRowList">Список — строка «номер кошелька сумма» (минус допускается)</label>' +
      '<textarea id="mdRowList" rows="4" spellcheck="false" placeholder="4034823 1250.50"' +
      ' style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);' +
      'border-radius:10px;font:inherit;font-size:13px;line-height:1.6;resize:vertical"></textarea></div>' +
    '<div class="md-row">' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="mdRowGo">Записать итог списком</button></div>' +
      '<div class="md-f" style="min-width:260px"><label>&nbsp;</label>' +
        '<span class="md-sum" id="mdRowSay" style="margin:0"></span></div>' +
    '</div>' +
    '<h3 style="font-size:13.5px;margin:0 0 6px">Пополнение за эту же дату</h3>' +
    '<p class="sub" style="margin:0 0 10px">Зачисление в USDT: строка «Пополнение · USDT» уйдёт ' +
    'в историю операций клиента той же датой, баланс вырастет, в отчёте за день сумма встанет ' +
    'в колонку «Пополнения», а на пульте пересчитается сама. Запуск отменяется целиком.</p>' +
    '<div class="md-row">' +
      '<div class="md-f" style="min-width:300px"><label for="mdInAcct">Кошелёк</label>' +
        '<select id="mdInAcct"></select></div>' +
      '<div class="md-f"><label for="mdInAmt">Сумма пополнения</label>' +
        '<input id="mdInAmt" type="number" min="1" step="0.01" placeholder="например 2000"></div>' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="mdInAdd">Добавить в список</button></div>' +
    '</div>' +
    '<div class="md-f" style="min-width:100%;margin-bottom:10px">' +
      '<label for="mdInList">Список пополнений — строка «номер кошелька сумма»</label>' +
      '<textarea id="mdInList" rows="3" spellcheck="false" placeholder="4034823 2000"' +
      ' style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);' +
      'border-radius:10px;font:inherit;font-size:13px;line-height:1.6;resize:vertical"></textarea></div>' +
    '<div class="md-row">' +
      '<div class="md-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="mdInGo">Записать пополнения</button></div>' +
      '<div class="md-f" style="min-width:260px"><label>&nbsp;</label>' +
        '<span class="md-sum" id="mdInSay" style="margin:0"></span></div>' +
    '</div>' +
    '<h3 style="font-size:13.5px;margin:0 0 8px">Последние запуски</h3>' +
    '<div class="md-list" id="mdList"></div></div>';

  function build() {
    if (el("mdCard")) return true;
    var host = document.querySelector('[data-pane="users"]');
    if (!host || !host.firstElementChild) return false;
    var st = document.createElement("style"); st.id = "mdCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var box = document.createElement("div");
    box.innerHTML = PANE;
    host.insertBefore(box.firstChild, host.firstElementChild);
    var d = el("mdDate");
    if (d && !d.value) d.value = iso(new Date());
    ["mdDate", "mdPct", "mdDir"].forEach(function (i) {
      var n = el(i); if (n) n.addEventListener("input", preview);
      if (n) n.addEventListener("change", preview);
    });
    el("mdGo").onclick = run;
    el("mdStop").onclick = stopAll;
    el("mdDrop").onclick = dropAll;
    el("mdOutAdd").onclick = outAdd;
    el("mdOutGo").onclick = outRun;
    el("mdInAdd").onclick = function () { cashAdd("mdIn"); };
    el("mdInGo").onclick = function () { cashRun("mdIn"); };
    el("mdRowAdd").onclick = function () { cashAdd("mdRow"); };
    el("mdRowGo").onclick = rowsRun;
    outFill();
    preview();
    return true;
  }

  /* прикидка до запуска: сколько кошельков и на сколько изменится общий капитал */
  function preview() {
    var box = el("mdSum"); if (!box) return;
    var us = wallets();
    var p = Number(el("mdPct") && el("mdPct").value) || 0;
    var down = el("mdDir") && el("mdDir").value === "down";
    var sum = 0;
    us.forEach(function (u) {
      var b = Number(u.balance) || 0;
      var a = +(b * p / 100).toFixed(2);
      sum += down ? -Math.min(a, b) : a;
    });
    box.innerHTML = us.length
      ? "Кошельков на площадке: <b>" + us.length + "</b> · изменение капитала: <b>" +
        money(sum) + "</b> (" + (down ? "убыток" : "прибыль") + " " + p + "% к балансу каждого)"
      : "Кошельков пока нет.";
  }

  /* сброс сценариев без записи результата: баланс возвращается к депозиту на
     момент запуска вместе со всем, что внесено руками за эти сутки. В кабинете
     и в отчётах остаётся только ручная разноска, кривая ничего не добавляет. */
  function dropAll() {
    var btn = el("mdDrop"), say = el("mdStopSay");
    btn.disabled = true; btn.textContent = "Считаем…";
    say.textContent = "";
    call("/api/admin/drop-all", { method: "POST", body: JSON.stringify({ dry: true }) })
      .then(function (j) {
        btn.disabled = false; btn.textContent = "Сбросить сценарии без записи";
        if (!j.dropped) { say.textContent = "Запущенных сценариев нет."; return; }
        if (!confirm("Снять сценарии на " + j.dropped + " кошельках без записи результата?\n\n" +
          "Баланс каждого вернётся к депозиту на момент запуска, всё внесённое руками " +
          "останется на месте.\nИзменение капитала: " + money(j.delta) + " · станет " +
          money(j.total).replace(/^\+/, "") + "\n\nВ историю операций ничего не пишется.")) return;
        btn.disabled = true; btn.textContent = "Снимаем…";
        return call("/api/admin/drop-all", { method: "POST", body: JSON.stringify({}) })
          .then(function (r) {
            say.textContent = "Снято сценариев без записи: " + r.dropped +
              " · капитал изменился на " + money(r.delta);
            return refresh();
          });
      })
      .catch(function (e) { say.textContent = e.message; })
      .then(function () { btn.disabled = false; btn.textContent = "Сбросить сценарии без записи"; });
  }

  /* остановка всех сценариев: баланс фиксируется там, где сессия сейчас,
     ничего не теряется и не дорисовывается */
  function stopAll() {
    var btn = el("mdStop"), say = el("mdStopSay");
    btn.disabled = true; btn.textContent = "Считаем…";
    say.textContent = "";
    call("/api/admin/stop-all", { method: "POST", body: JSON.stringify({ dry: true }) })
      .then(function (j) {
        btn.disabled = false; btn.textContent = "Остановить все сценарии";
        if (!j.stopped) { say.textContent = "Запущенных сценариев нет."; return; }
        if (!confirm("Остановить сценарии на " + j.stopped + " кошельках?\n\n" +
          "Баланс каждого зафиксируется на текущем значении сессии.\n" +
          "Суммарно к зачислению: " + money(j.delta) + " · итоговый капитал " +
          money(j.total).replace(/^\+/, "") + "\n\nОтменить это действие нельзя.")) return;
        btn.disabled = true; btn.textContent = "Останавливаем…";
        return call("/api/admin/stop-all", { method: "POST", body: JSON.stringify({}) })
          .then(function (r) {
            say.textContent = "Остановлено сценариев: " + r.stopped +
              " · зафиксировано " + money(r.delta);
            return refresh();
          });
      })
      .catch(function (e) { say.textContent = e.message; })
      .then(function () { btn.disabled = false; btn.textContent = "Остановить все сценарии"; });
  }

  function run() {
    var go = el("mdGo"), out = el("mdOut");
    var date = (el("mdDate").value || "").trim();
    var pct = Number(el("mdPct").value);
    var down = el("mdDir").value === "down";
    if (!date) return alert("Укажите дату операции");
    if (!(pct > 0)) return alert("Укажите процент больше нуля");
    var us = wallets();
    if (!confirm("Записать " + (down ? "убыток" : "прибыль") + " " + pct + "% за " +
        date.split("-").reverse().join(".") + " всем кошелькам площадки" +
        (us.length ? " (" + us.length + " шт.)" : "") + "?\n\n" +
        "Операция отменяется кнопкой «Отменить» в списке запусков.")) return;
    go.disabled = true; go.textContent = "Записываем…";
    call("/api/admin/mass-day", {
      method: "POST",
      body: JSON.stringify({ date: date, pct: pct, dir: down ? "down" : "up" })
    }).then(function (j) {
      out.hidden = false;
      out.innerHTML = j.applied
        ? "<b>Запуск №" + j.batch + " выполнен.</b><br>Кошельков обработано: " + j.applied +
          (j.skipped ? ", пропущено (итог за эту дату уже стоял): " + j.skipped : "") +
          "<br>Изменение капитала: <b>" + money(j.total) + "</b>"
        : "<b>Ничего не записано.</b><br>За эту дату итог уже проставлен всем кошелькам (" +
          j.skipped + " шт.). Выберите другую дату или отмените прежний запуск.";
      return refresh();
    }).catch(function (e) {
      out.hidden = false;
      out.textContent = "Не получилось: " + e.message;
    }).then(function () {
      go.disabled = false; go.textContent = "Проставить всем";
    });
  }

  /* список кошельков в выпадашке вывода: номер, имя и текущий баланс */
  function outFill() {
    var sel = el("mdOutAcct"); if (!sel) return;
    var us = wallets();
    var was = sel.value;
    sel.innerHTML = us.length
      ? us.map(function (u) {
          return '<option value="' + esc(u.acct || "") + '">#' + esc(u.acct || "—") + " · " +
            esc(u.name || u.email || "—") + " · $" + (Number(u.balance) || 0).toFixed(2) + "</option>";
        }).join("")
      : '<option value="">кошельков нет</option>';
    if (was) sel.value = was;
  }
  function outAdd() {
    var sel = el("mdOutAcct"), amt = el("mdOutAmt"), box = el("mdOutList");
    var a = (sel && sel.value) || "";
    var v = Number(amt && amt.value);
    if (!a) return;
    if (!(v > 0)) { el("mdOutSay").textContent = "Укажите сумму вывода"; return; }
    var cur = (box.value || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    cur = cur.filter(function (x) { return x.split(/[\s;,]+/)[0] !== a; });
    cur.push(a + " " + v);
    box.value = cur.join("\n");
    amt.value = "";
    el("mdOutSay").textContent = "В списке строк: " + cur.length;
  }
  function outParse() {
    return (el("mdOutList").value || "").split(/\r?\n/).map(function (l) {
      var p = l.trim().split(/[\s;,]+/).filter(Boolean);
      if (p.length < 2) return null;
      return { acct: p[0].replace(/\D/g, ""), amount: p[1].replace(",", ".") };
    }).filter(function (x) { return x && x.acct && Number(x.amount) > 0; });
  }
  /* сначала примерка: сколько спишется и у кого не выйдет, и только потом запись */
  function outRun() {
    var go = el("mdOutGo"), say = el("mdOutSay");
    var date = (el("mdDate").value || "").trim();
    var items = outParse();
    if (!date) { say.textContent = "Укажите дату операции"; return; }
    if (!items.length) { say.textContent = "Впишите хотя бы одну строку: номер кошелька и сумма"; return; }
    go.disabled = true; go.textContent = "Считаем…";
    say.textContent = "";
    call("/api/admin/mass-out", { method: "POST",
      body: JSON.stringify({ date: date, items: items, dry: true }) })
      .then(function (j) {
        go.disabled = false; go.textContent = "Записать выводы";
        var skip = (j.skipped || []).map(function (x) { return "#" + x.acct + " — " + x.error; });
        if (!j.applied) {
          say.textContent = "Записывать нечего." + (skip.length ? " " + skip.join("; ") : "");
          return;
        }
        if (!confirm("Записать выводы за " + date.split("-").reverse().join(".") + "?\n\n" +
          "Кошельков: " + j.applied + "\nСписание: " + money(j.total) +
          (skip.length ? "\n\nНе пройдут: " + skip.join("; ") : "") +
          "\n\nОтменить можно кнопкой «Отменить» в списке запусков.")) return;
        go.disabled = true; go.textContent = "Записываем…";
        return call("/api/admin/mass-out", { method: "POST",
          body: JSON.stringify({ date: date, items: items }) })
          .then(function (r) {
            var out = el("mdOut");
            if (out) {
              out.hidden = false;
              out.innerHTML = "<b>Выводы записаны: " + r.applied + " кошельк(ов), " + money(r.total) +
                "</b><br>Запуск №" + r.batch + " — его можно отменить целиком." +
                ((r.skipped || []).length ? "<br>Не прошли: " + r.skipped.map(function (x) {
                  return "#" + esc(x.acct) + " (" + esc(x.error) + ")"; }).join(", ") : "");
            }
            el("mdOutList").value = "";
            say.textContent = "Готово: " + r.applied + " кошельк(ов)";
            return refresh();
          });
      })
      .catch(function (e) { say.textContent = e.message; })
      .then(function () { go.disabled = false; go.textContent = "Записать выводы"; });
  }

  /* пополнение устроено так же, как вывод, только в плюс и в USDT */
  function cashAdd(pre) {
    var sel = el(pre + "Acct"), amt = el(pre + "Amt"), box = el(pre + "List"), say = el(pre + "Say");
    var a = (sel && sel.value) || "";
    var v = Number(amt && amt.value);
    if (!a) return;
    if (!(v > 0)) { if (say) say.textContent = "Укажите сумму пополнения"; return; }
    var cur = (box.value || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    cur = cur.filter(function (x) { return x.split(/[\s;,]+/)[0] !== a; });
    cur.push(a + " " + v);
    box.value = cur.join("\n");
    amt.value = "";
    if (say) say.textContent = "В списке строк: " + cur.length;
  }
  function cashParse(pre) {
    return (el(pre + "List").value || "").split(/\r?\n/).map(function (l) {
      var p = l.trim().split(/[\s;,]+/).filter(Boolean);
      if (p.length < 2) return null;
      return { acct: p[0].replace(/\D/g, ""), amount: p[1].replace(",", ".") };
    }).filter(function (x) { return x && x.acct && Number(x.amount) > 0; });
  }
  function cashRun(pre) {
    var go = el(pre + "Go"), say = el(pre + "Say");
    var date = (el("mdDate").value || "").trim();
    var items = cashParse(pre);
    if (!date) { say.textContent = "Укажите дату операции"; return; }
    if (!items.length) { say.textContent = "Впишите хотя бы одну строку: номер кошелька и сумма"; return; }
    go.disabled = true; go.textContent = "Считаем…";
    say.textContent = "";
    call("/api/admin/mass-in", { method: "POST",
      body: JSON.stringify({ date: date, items: items, dry: true }) })
      .then(function (j) {
        go.disabled = false; go.textContent = "Записать пополнения";
        var skip = (j.skipped || []).map(function (x) { return "#" + x.acct + " — " + x.error; });
        if (!j.applied) {
          say.textContent = "Записывать нечего." + (skip.length ? " " + skip.join("; ") : "");
          return;
        }
        if (!confirm("Записать пополнения за " + date.split("-").reverse().join(".") + "?\n\n" +
          "Кошельков: " + j.applied + "\nЗачисление: " + money(j.total) +
          (skip.length ? "\n\nНе пройдут: " + skip.join("; ") : "") +
          "\n\nОтменить можно кнопкой «Отменить» в списке запусков.")) return;
        go.disabled = true; go.textContent = "Записываем…";
        return call("/api/admin/mass-in", { method: "POST",
          body: JSON.stringify({ date: date, items: items }) })
          .then(function (r) {
            var out = el("mdOut");
            if (out) {
              out.hidden = false;
              out.innerHTML = "<b>Пополнения записаны: " + r.applied + " кошельк(ов), " + money(r.total) +
                "</b><br>Запуск №" + r.batch + " — его можно отменить целиком.";
            }
            el(pre + "List").value = "";
            say.textContent = "Готово: " + r.applied + " кошельк(ов)";
            return refresh();
          });
      })
      .catch(function (e) { say.textContent = e.message; })
      .then(function () { go.disabled = false; go.textContent = "Записать пополнения"; });
  }

  /* итог дня списком: у каждого кошелька своя сумма и своя пара */
  /* разбор списка итога дня: пару можно не выбирать руками — если в тексте
     встречается строка с названием пары («--- пара BTC/USD ---»), все строки
     ниже уходят по ней, пока не встретится следующая. Что до первой такой
     строки — по паре из селекта. Всё лишнее (заголовки, суммы, разделители)
     пропускается само, а чужие кошельки отсеет сервер, поэтому один и тот же
     текст можно вставить в обе админки. */
  var ROW_PAIRS = ["XAU/USD", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD",
                   "AAPL", "TSLA", "NVDA", "MSFT"];
  function rowsPairIn(line) {
    var up = line.toUpperCase();
    for (var i = 0; i < ROW_PAIRS.length; i++) {
      var p = ROW_PAIRS[i];
      if (up.indexOf(p) < 0) continue;
      /* для коротких тикеров проверяем, что это отдельное слово, а не часть числа */
      if (p.indexOf("/") < 0 && !new RegExp("(^|[^A-Z0-9])" + p + "([^A-Z0-9]|$)").test(up)) continue;
      return p;
    }
    return "";
  }
  /* какие пары и по скольку кошельков собрал список — это и показываем вместо
     одной пары из селекта */
  function rowsPairsTxt(items) {
    var m = {}, order = [];
    (items || []).forEach(function (x) {
      if (!m[x.pair]) { m[x.pair] = 0; order.push(x.pair); }
      m[x.pair]++;
    });
    return order.map(function (p) { return p + " — " + m[p]; }).join(", ");
  }

  function rowsParse(def) {
    var cur = def, out = [];
    (el("mdRowList").value || "").split(/\r?\n/).forEach(function (l) {
      var t = l.trim();
      if (!t) return;
      var p = t.split(/[\s;,]+/).filter(Boolean);
      var acct = p.length > 1 ? p[0].replace(/\D/g, "") : "";
      var amt = p.length > 1 ? p[1].replace(/\s|\u00a0/g, "").replace(",", ".") : "";
      /* строка данных — только «номер кошелька сумма», всё остальное заголовок */
      if (acct && /^-?\$?\d/.test(amt) && isFinite(Number(amt.replace("$", ""))) &&
          Number(amt.replace("$", "")) !== 0) {
        out.push({ acct: acct, amount: amt.replace("$", ""), pair: cur });
        return;
      }
      var np = rowsPairIn(t);
      if (np) cur = np;
    });
    return out;
  }

  function rowsRun() {
    var go = el("mdRowGo"), say = el("mdRowSay");
    var date = (el("mdDate").value || "").trim();
    var pair = el("mdRowPair").value;
    var items = rowsParse(pair);
    if (!date) { say.textContent = "Укажите дату операции"; return; }
    if (!items.length) { say.textContent = "Впишите хотя бы одну строку: номер кошелька и сумма"; return; }
    go.disabled = true; go.textContent = "Считаем…";
    say.textContent = "";
    call("/api/admin/mass-rows", { method: "POST",
      body: JSON.stringify({ date: date, pair: pair, items: items, dry: true }) })
      .then(function (j) {
        go.disabled = false; go.textContent = "Записать итог списком";
        var skip = (j.skipped || []).map(function (x) { return "#" + x.acct + " — " + x.error; });
        if (!j.applied) {
          say.textContent = "Записывать нечего." + (skip.length ? " " + skip.slice(0, 4).join("; ") : "");
          return;
        }
        if (!confirm("Записать итог дня за " + date.split("-").reverse().join(".") + "?\n\n" +
          "Пары: " + rowsPairsTxt(items) + "\nКошельков: " + j.applied + "\nСумма: " + money(j.total) +
          (skip.length ? "\n\nНе пройдут (" + skip.length + "): " + skip.slice(0, 4).join("; ") : "") +
          "\n\nОтменить можно кнопкой «Отменить» в списке запусков.")) return;
        go.disabled = true; go.textContent = "Записываем…";
        return call("/api/admin/mass-rows", { method: "POST",
          body: JSON.stringify({ date: date, pair: pair, items: items }) })
          .then(function (r) {
            var out = el("mdOut");
            if (out) {
              out.hidden = false;
              out.innerHTML = "<b>Итог дня записан: " + r.applied + " кошельк(ов), " + money(r.total) +
                "</b><br>Пары: " + esc(rowsPairsTxt(items)) +
                "<br>Запуск №" + r.batch + " — его можно отменить целиком." +
                ((r.skipped || []).length ? "<br>Не прошли: " + r.skipped.length : "");
            }
            el("mdRowList").value = "";
            say.textContent = "Готово: " + r.applied + " кошельк(ов)";
            return refresh();
          });
      })
      .catch(function (e) { say.textContent = e.message; })
      .then(function () { go.disabled = false; go.textContent = "Записать итог списком"; });
  }

  function undo(id) {
    if (!confirm("Отменить запуск №" + id + "?\n\n" +
      "Балансы вернутся к прежним значениям, строки за эту дату уберутся из истории операций.")) return;
    call("/api/admin/mass-day/undo", { method: "POST", body: JSON.stringify({ batch: Number(id) }) })
      .then(function (j) {
        var out = el("mdOut");
        if (out) { out.hidden = false; out.innerHTML = "<b>Запуск №" + id + " отменён.</b><br>Кошельков возвращено: " + j.restored; }
        return refresh();
      })
      .catch(function (e) { alert(e.message); });
  }

  /* перечитываем кошельки, чтобы таблица и сводка показали новые балансы */
  function refresh() {
    var p = Promise.resolve();
    if (typeof uFetch === "function") p = Promise.resolve(uFetch());
    return p.then(function () {
      if (typeof renderUsers === "function") renderUsers();
      if (typeof renderDash === "function") renderDash();
      preview();
      outFill();
      return load();
    });
  }

  function load() {
    if (!build()) return Promise.resolve();
    return call("/api/admin/mass-day").then(function (j) {
      var box = el("mdList"); if (!box) return;
      var b = (j && j.batches) || [];
      if (!b.length) { box.innerHTML = '<p class="sub" style="margin:0">Пока ничего не проставляли.</p>'; return; }
      box.innerHTML = b.map(function (x) {
        return '<div class="md-b' + (x.undone ? " off" : "") + '"><div><b>' +
          esc(String(x.day).split("-").reverse().join(".")) + "</b> · " +
          (x.dir === "rows" ? "итог дня списком " + money(x.total || 0)
            : x.dir === "in" ? "пополнения " + money(x.total || 0)
            : x.dir === "out" ? "выводы " + money(x.total || 0)
            : (x.dir === "down" ? "убыток" : "прибыль") + " " + x.pct + "%") +
          " · кошельков " + x.wallets +
          '<br><span>запуск №' + x.id + (x.undone ? " · отменён" : "") + "</span></div>" +
          (x.undone ? "" : '<button class="btn btn-ghost btn-sm" data-md-undo="' + x.id + '">Отменить</button>') +
          "</div>";
      }).join("");
    }).catch(function (e) {
      var box = el("mdList");
      if (box) box.innerHTML = '<p class="sub" style="margin:0">' + esc(e.message) + "</p>";
    });
  }
  window.renderMassDay = load;

  document.addEventListener("click", function (e) {
    var u = e.target.closest && e.target.closest("[data-md-undo]");
    if (u) undo(u.getAttribute("data-md-undo"));
    if (e.target.closest && e.target.closest('[data-tab="users"]')) setTimeout(load, 60);
  });

  function boot() { if (build()) load(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); });
  } else setTimeout(boot, 600);
})();

/* ---------------------------------------------------------------------------
   Админка: вкладка «Отчёт».
   По выбранной дате показывает построчно каждого клиента площадки: какой у него
   итог торгового дня, какие были пополнения и выводы и каким стал баланс.
   Данные берутся из тех же кошельков, что и в разделе «Кошельки», — отдельного
   запроса к серверу не нужно. Отчёт выгружается в CSV для Excel.
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var DAY = "Итог торгового дня";
  /* all = выводить в тексте и тех, у кого за этот день записи нет */
  var RP = { all: false, parts: [], part: 0 };
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var money = function (v) {
    v = Number(v) || 0;
    return (v < 0 ? "−" : "+") + "$" + Math.abs(v).toFixed(2);
  };
  var plain = function (v) { return (Number(v) || 0).toFixed(2); };
  var iso = function (d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  };
  var ru = function (v) { return String(v || "").split("-").reverse().join("."); };
  var wallets = function () {
    try { return (typeof uLoad === "function" ? uLoad() : []) || []; } catch (e) { return []; }
  };
  /* сумма из строки истории: «+$188.00» или «−$66.00» */
  var num = function (s) {
    s = String(s == null ? "" : s);
    var n = parseFloat(s.replace(/[^0-9.,]/g, "").replace(",", "."));
    if (!isFinite(n)) return 0;
    return /^\s*[-−]/.test(s) ? -n : n;
  };

  var CSS =
    "#rpCard .rp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}" +
    "#rpCard .rp-f{display:flex;flex-direction:column;gap:5px;min-width:150px}" +
    "#rpCard .rp-f label{font-size:11.5px;color:var(--muted)}" +
    "#rpCard .rp-f input{padding:9px 10px;border:1px solid var(--line);border-radius:9px;" +
    "font:inherit;font-size:13px;width:100%;box-sizing:border-box}" +
    "#rpCard .rp-kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}" +
    "#rpCard .rp-k{border:1px solid var(--line);border-radius:11px;padding:9px 13px;min-width:132px}" +
    "#rpCard .rp-k span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}" +
    "#rpCard .rp-k b{font-size:17px}" +
    "#rpCard .rp-scroll{overflow:auto;border:1px solid var(--line);border-radius:11px}" +
    "#rpCard table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:720px}" +
    "#rpCard th,#rpCard td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}" +
    "#rpCard th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}" +
    "#rpCard tr:last-child td{border-bottom:0}" +
    "#rpCard td.n{text-align:right;font-variant-numeric:tabular-nums}" +
    "#rpCard .up{color:var(--buy,#16A34A)}#rpCard .dn{color:var(--sell,#EF4444)}" +
    "#rpCard .zero{color:var(--muted)}" +
    "#rpCard .rp-empty{font-size:12.5px;color:var(--muted);padding:16px 2px;line-height:1.5}" +
    "#rpCard .rp-copy{margin-bottom:16px}" +
    "#rpCard .rp-copy-h{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:7px}" +
    "#rpCard .rp-copy-h b{font-size:13.5px}" +
    "#rpCard .rp-parts{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px}" +
    "#rpCard .rp-copy-h span{font-size:11.5px;color:var(--muted)}" +
    "#rpCard #rpText{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid var(--line);" +
    "border-radius:11px;font:inherit;font-size:13px;line-height:1.7;resize:vertical;white-space:pre}";

  var PANE =
    '<div class="card" id="rpCard"><h2>Отчёт за день</h2>' +
    '<p class="sub">Построчно по каждому клиенту площадки: итог торгового дня за выбранную дату, ' +
    'пополнения и выводы в этот же день отдельными колонками и текущий баланс кошелька. ' +
    'Строки берутся из истории операций — той самой, что видит клиент в кабинете.</p>' +
    '<div class="rp-row">' +
      '<div class="rp-f"><label for="rpDate">Дата</label><input id="rpDate" type="date"></div>' +
      '<div class="rp-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="rpPrev">← день назад</button></div>' +
      '<div class="rp-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="rpNext">день вперёд →</button></div>' +
      '<div class="rp-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="rpReload">Обновить</button></div>' +
      '<div class="rp-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="rpCsv">Скачать CSV</button></div>' +
    '</div>' +
    '<div class="rp-kpi" id="rpKpi"></div>' +
    '<div class="rp-copy">' +
      '<div class="rp-copy-h"><b>Готовый текст — можно скопировать и отправить</b>' +
        '<button class="btn btn-primary btn-sm" id="rpCopy">Скопировать</button>' +
        '<button class="btn btn-ghost btn-sm" id="rpAll">Показывать всех</button>' +
        '<span id="rpCopyNote"></span></div>' +
      '<div class="rp-parts" id="rpParts"></div>' +
      '<textarea id="rpText" rows="8" spellcheck="false"></textarea></div>' +
    '<div id="rpBox"></div></div>';

  function build() {
    if (el("rpCard")) return true;
    var host = document.querySelector('[data-pane="users"]');
    if (!host || !host.parentNode) return false;
    var st = document.createElement("style"); st.id = "rpCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var pane = document.createElement("div");
    pane.id = "rpPane";
    pane.setAttribute("data-pane", "report");
    pane.hidden = true;
    pane.innerHTML = PANE;
    host.parentNode.insertBefore(pane, host.nextSibling);
    var tabs = el("tabs");
    if (tabs && !tabs.querySelector('[data-tab="report"]')) {
      var after = tabs.querySelector('[data-tab="users"]');
      var b = document.createElement("button");
      b.setAttribute("data-tab", "report");
      b.innerHTML = "<i></i>Отчёт";
      if (after) after.parentNode.insertBefore(b, after.nextSibling); else tabs.appendChild(b);
    }
    var d = el("rpDate");
    if (d && !d.value) d.value = iso(new Date());
    el("rpDate").addEventListener("change", draw);
    el("rpPrev").onclick = function () { shift(-1); };
    el("rpNext").onclick = function () { shift(1); };
    el("rpReload").onclick = reload;
    el("rpCsv").onclick = csv;
    el("rpCopy").onclick = copy;
    el("rpAll").onclick = function () {
      RP.all = !RP.all;
      this.textContent = RP.all ? "Только с записью" : "Показывать всех";
      draw();
    };
    return true;
  }

  function shift(n) {
    var d = el("rpDate"); if (!d || !d.value) return;
    var t = new Date(d.value + "T12:00:00");
    t.setDate(t.getDate() + n);
    d.value = iso(t);
    draw();
  }

  /* разбираем историю одного кошелька за выбранный день */
  function rowFor(u, day) {
    /* доход за день и движение денег считаем раздельно: вывод и пополнение —
       это не результат торгов, и в отчёте они должны стоять своими строками */
    var res = { day: 0, cash: 0, out: 0, inc: 0, has: false, note: "", pairs: [] };
    (u.tx || []).forEach(function (t) {
      if (!t || String(t[0]) !== day) return;
      var v = num(t[2]);
      if (String(t[1]).indexOf(DAY) === 0) {
        res.day += v; res.has = true; res.note = String(t[4] || "");
        /* инструмент записан в заголовке: «Итог торгового дня · XAU/USD» */
        var mp = String(t[1]).split("·")[1];
        if (mp && res.pairs.indexOf(mp.trim()) < 0) res.pairs.push(mp.trim());
      }
      else if (v < 0) { res.out += v; res.cash += v; }
      else { res.inc += v; res.cash += v; }
    });
    res.day = +res.day.toFixed(2);
    res.cash = +res.cash.toFixed(2);
    res.out = +res.out.toFixed(2);
    res.inc = +res.inc.toFixed(2);
    return res;
  }

  function rows() {
    var day = ru((el("rpDate") || {}).value || "");
    return wallets().map(function (u) {
      var r = rowFor(u, day);
      return {
        name: u.name || u.email || "—",
        mail: u.email || "",
        acct: u.acct || "",
        balance: Number(u.balance) || 0,
        cur: u.cur || "USD",
        day: r.day, cash: r.cash, out: r.out, inc: r.inc, has: r.has, note: r.note,
        pair: (r.pairs || []).join(", ")
      };
    }).sort(function (a, b) { return b.day - a.day; });
  }

  /* сумма в стиле сообщения: +33$ у целых, +33.50$ у дробных */
  function short(v) {
    v = Number(v) || 0;
    var a = Math.abs(v);
    return (v < 0 ? "-" : "+") + (a === Math.round(a) ? String(Math.round(a)) : a.toFixed(2)) + "$";
  }

  /* суммы в тексте: разряды пробелом, копейки запятой — так читается глазами */
  function nf(v, cents) {
    v = Math.abs(Number(v) || 0);
    var s = (cents === false && v === Math.round(v)) ? String(Math.round(v)) : v.toFixed(2);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
    return p.join(",");
  }
  function bal(v) { return "$" + nf(v, true); }
  function sgn(v) { return ((Number(v) || 0) < 0 ? "\u2212" : "+") + "$" + nf(v, false); }

  /* одна карточка клиента в тексте: имя со счётом, под ней цепочка движения
     денег за день — старт, пополнение, торговый результат с парой, вывод */
  function card(x, n) {
    var start = +(x.balance - x.inc - x.out - x.day).toFixed(2);
    var run = start;
    var chain = bal(run);
    if (x.inc) {
      run = +(run + x.inc).toFixed(2);
      chain += " \u2192 пополнение " + sgn(x.inc) + " \u2192 " + bal(run);
    }
    if (x.has) {
      run = +(run + x.day).toFixed(2);
      chain += " \u2192 " + (x.day < 0 ? "убыток " : "прибыль ") + sgn(x.day) +
        (x.pair ? " (" + x.pair + ")" : "") + " \u2192 " + bal(run);
    } else {
      chain += " \u2192 итога дня нет";
    }
    if (x.out) {
      run = +(run + x.out).toFixed(2);
      chain += " \u2192 вывод " + sgn(x.out) + " \u2192 " + bal(run);
    }
    return n + ". " + x.name + " \u00b7 #" + x.acct + "\n" + chain;
  }

  /* текст для отправки режется на части: в одно сообщение мессенджера влезает
     около четырёх тысяч знаков, поэтому длинный отчёт отдаём частями, каждая
     со своей шапкой, а итог ставим в конце последней */
  var PART_MAX = 3400;
  function parts(list, day) {
    var shown = list.filter(function (x) { return RP.all || x.has || x.out || x.inc; });
    var sum = shown.reduce(function (s, x) { return s + x.day; }, 0);
    var foot = "Итого по " + shown.length + " счетам за " + day + ": " + sgn(sum);
    var head = "Отчет BullWaves \u00b7 " + day;
    if (!shown.length) return [head + "\n\n" + foot];
    var blocks = shown.map(function (x, i) { return card(x, i + 1); });
    /* сначала набираем куски по длине, потом проставляем номера частей */
    var chunks = [], cur = [], len = 0;
    blocks.forEach(function (b) {
      if (cur.length && len + b.length + 2 > PART_MAX) { chunks.push(cur); cur = []; len = 0; }
      cur.push(b); len += b.length + 2;
    });
    if (cur.length) chunks.push(cur);
    /* ровняем части между собой: иначе последняя выходит в пару строк */
    if (chunks.length > 1) {
      var per = Math.ceil(blocks.length / chunks.length), even = [];
      for (var q = 0; q < blocks.length; q += per) even.push(blocks.slice(q, q + per));
      var fits = even.every(function (c) {
        return c.join("\n\n").length <= PART_MAX + 200;
      });
      if (fits && even.length === chunks.length) chunks = even;
    }
    return chunks.map(function (c, i) {
      var h = head + (chunks.length > 1 ? " (" + (i + 1) + "/" + chunks.length + ")" : "") + " \u2705";
      var tail = i === chunks.length - 1 ? "\n\n" + foot : "";
      return h + "\n\n" + c.join("\n\n") + tail;
    });
  }

  /* показать выбранную часть в поле и подсветить её кнопку */
  function showPart(i) {
    var t = el("rpText"), box = el("rpParts");
    var all = RP.parts || [];
    RP.part = Math.max(0, Math.min(all.length - 1, i || 0));
    if (t) {
      t.value = all[RP.part] || "";
      t.rows = Math.min(18, Math.max(3, t.value.split("\n").length));
    }
    if (!box) return;
    if (all.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML = all.map(function (p, n) {
      return '<button class="btn btn-sm ' + (n === RP.part ? "btn-primary" : "btn-ghost") +
        '" data-part="' + n + '">Часть ' + (n + 1) + "</button>";
    }).join("");
    box.querySelectorAll("[data-part]").forEach(function (b) {
      b.onclick = function () { showPart(Number(b.dataset.part)); };
    });
  }

  function copy() {
    var box = el("rpText"), note = el("rpCopyNote");
    if (!box || !box.value) { if (note) note.textContent = "нечего копировать"; return; }
    var done = function () {
      if (note) note.textContent = "скопировано";
      setTimeout(function () { if (note) note.textContent = ""; }, 2500);
    };
    box.focus(); box.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(done, function () {
        try { document.execCommand("copy"); done(); } catch (e) {
          if (note) note.textContent = "скопируйте вручную: Ctrl+C";
        }
      });
      return;
    }
    try { document.execCommand("copy"); done(); }
    catch (e) { if (note) note.textContent = "скопируйте вручную: Ctrl+C"; }
  }

  function draw() {
    if (!build()) return;
    var box = el("rpBox"), kpi = el("rpKpi");
    var day = (el("rpDate") || {}).value || "";
    var list = rows();
    if (!list.length) {
      kpi.innerHTML = "";
      RP.parts = []; if (el("rpText")) el("rpText").value = "";
      box.innerHTML = '<p class="rp-empty">На площадке пока нет кошельков.</p>';
      return;
    }
    RP.parts = parts(list, ru(day));
    showPart(0);
    var sum = list.reduce(function (s, x) { return s + x.day; }, 0);
    var cash = list.reduce(function (s, x) { return s + x.cash; }, 0);
    var outs = list.reduce(function (s, x) { return s + x.out; }, 0);
    var incs = list.reduce(function (s, x) { return s + x.inc; }, 0);
    var nOut = list.filter(function (x) { return x.out; }).length;
    var up = list.filter(function (x) { return x.day > 0; }).length;
    var dn = list.filter(function (x) { return x.day < 0; }).length;
    var no = list.filter(function (x) { return !x.has; }).length;
    kpi.innerHTML =
      '<div class="rp-k"><span>Итог за ' + esc(ru(day)) + '</span><b class="' +
        (sum > 0 ? "up" : sum < 0 ? "dn" : "zero") + '">' + money(sum) + "</b></div>" +
      '<div class="rp-k"><span>Кошельков</span><b>' + list.length + "</b></div>" +
      '<div class="rp-k"><span>В плюсе</span><b class="up">' + up + "</b></div>" +
      '<div class="rp-k"><span>В минусе</span><b class="dn">' + dn + "</b></div>" +
      '<div class="rp-k"><span>Без записи</span><b class="zero">' + no + "</b></div>" +
      '<div class="rp-k"><span>Выводы за день</span><b class="' + (outs ? "dn" : "zero") + '">' +
        money(outs) + (nOut ? " · " + nOut + " шт." : "") + "</b></div>" +
      '<div class="rp-k"><span>Пополнения</span><b class="' + (incs ? "up" : "zero") + '">' +
        money(incs) + "</b></div>" +
      '<div class="rp-k"><span>Касса за день</span><b>' + money(cash) + "</b></div>";
    box.innerHTML = '<div class="rp-scroll"><table><thead><tr>' +
      "<th>Клиент</th><th>Счёт</th><th>Пара</th><th>Итог дня</th><th>Пополнения</th><th>Выводы</th>" +
      "<th>Баланс сейчас</th><th>Статус</th></tr></thead><tbody>" +
      list.map(function (x) {
        return "<tr><td>" + esc(x.name) + "<br><span class=\"zero\">" + esc(x.mail) + "</span></td>" +
          "<td>#" + esc(x.acct) + "</td><td>" + esc(x.pair || "—") + '</td><td class="n ' +
          (x.day > 0 ? "up" : x.day < 0 ? "dn" : "zero") + '">' + (x.has ? money(x.day) : "—") + "</td>" +
          '<td class="n ' + (x.inc ? "up" : "zero") + '">' + (x.inc ? money(x.inc) : "—") + "</td>" +
          '<td class="n ' + (x.out ? "dn" : "zero") + '">' + (x.out ? money(x.out) : "—") + "</td>" +
          '<td class="n">' + plain(x.balance) + " " + esc(x.cur) + "</td>" +
          "<td>" + esc(x.has ? (x.note || (x.day >= 0 ? "Прибыль" : "Убыток")) : "нет записи за этот день") +
          "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* перечитываем кошельки с сервера и перерисовываем отчёт */
  function reload() {
    var p = Promise.resolve();
    if (typeof uFetch === "function") p = Promise.resolve(uFetch());
    return p.then(function () { draw(); if (typeof renderUsers === "function") renderUsers(); })
      .catch(function (e) { if (typeof toast === "function") toast(e.message); });
  }

  function csv() {
    var day = (el("rpDate") || {}).value || "";
    var list = rows();
    var q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var lines = [["Клиент", "Email", "Счёт", "Пара", "Итог дня", "Пополнения", "Выводы", "Касса за день",
      "Баланс", "Валюта", "Статус"].map(q).join(";")];
    list.forEach(function (x) {
      lines.push([x.name, x.mail, x.acct, x.pair || "", x.has ? plain(x.day) : "", plain(x.inc), plain(x.out),
        plain(x.cash), plain(x.balance), x.cur,
        x.has ? (x.note || "") : "нет записи"].map(q).join(";"));
    });
    /* итоговая строка: по ней сразу видно доход и вывод за день целиком */
    lines.push(["ИТОГО", "", "", "", plain(list.reduce(function (s2, x) { return s2 + x.day; }, 0)),
      plain(list.reduce(function (s2, x) { return s2 + x.inc; }, 0)),
      plain(list.reduce(function (s2, x) { return s2 + x.out; }, 0)),
      plain(list.reduce(function (s2, x) { return s2 + x.cash; }, 0)),
      plain(list.reduce(function (s2, x) { return s2 + x.balance; }, 0)), "", ""].map(q).join(";"));
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "otchet-" + day + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  window.renderReport = draw;

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest('[data-tab="report"]')) setTimeout(reload, 60);
  });

  function boot() { if (build()) draw(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 700); });
  } else setTimeout(boot, 700);
})();

/* ---------------------------------------------------------------------------
   Админка: кошелёк для вывода и порог вывода у каждого клиента.
   На странице единого бота заявка на вывод проходит, только если сумма не ниже
   порога, а адрес получателя совпадает с привязанным здесь. Иначе клиент видит
   отказ: «вывод закрыт» или «неверный привязанный кошелёк».
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var call = function (p, o) {
    if (typeof api !== "function") return Promise.reject(new Error("админка ещё не готова"));
    return api(p, o);
  };
  var wallets = function () {
    try { return (typeof uLoad === "function" ? uLoad() : []) || []; } catch (e) { return []; }
  };
  var short = function (a) {
    a = String(a || "");
    return a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
  };

  var CSS =
    "#poCard .po-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}" +
    "#poCard .po-f{display:flex;flex-direction:column;gap:5px;min-width:150px}" +
    "#poCard .po-f label{font-size:11.5px;color:var(--muted)}" +
    "#poCard .po-f input,#poCard .po-f select{padding:9px 10px;border:1px solid var(--line);" +
    "border-radius:9px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}" +
    "#poCard .po-scroll{overflow:auto;border:1px solid var(--line);border-radius:11px}" +
    "#poCard table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:820px}" +
    "#poCard th,#poCard td{padding:8px 11px;text-align:left;border-bottom:1px solid var(--line)}" +
    "#poCard th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}" +
    "#poCard tr:last-child td{border-bottom:0}" +
    "#poCard td input{padding:7px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;" +
    "font-size:12.5px;width:100%;box-sizing:border-box}" +
    "#poCard td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    "#poCard .po-ok{color:var(--buy,#16A34A)}#poCard .po-no{color:var(--muted)}" +
    "#poCard .po-empty{font-size:12.5px;color:var(--muted);padding:16px 2px}";

  var PANE =
    '<div class="card" id="poCard"><h2>Вывод средств — кошелёк и порог</h2>' +
    '<p class="sub">У каждого кошелька свой адрес для вывода и своя сумма, с которой вывод открыт. ' +
    'На странице единого бота заявка пройдёт, только если клиент указал ровно привязанный адрес ' +
    'и сумма не ниже порога — иначе он увидит отказ. Пустой адрес означает, что вывод закрыт совсем. ' +
    'Порог 0 — ограничения по сумме нет.</p>' +
    '<div class="po-row">' +
      '<div class="po-f" style="min-width:300px"><label for="poAddr">Адрес для массовой привязки</label>' +
        '<input id="poAddr" placeholder="кошелёк, на который разрешён вывод"></div>' +
      '<div class="po-f" style="min-width:130px"><label for="poMin">Порог, $</label>' +
        '<input id="poMin" type="number" min="0" step="10" value="0"></div>' +
      '<div class="po-f" style="min-width:210px"><label for="poWho">Кому применить</label>' +
        '<select id="poWho">' +
          '<option value="empty">Только тем, у кого адрес пуст</option>' +
          '<option value="all">Всем кошелькам площадки</option>' +
          '<option value="same">Тем, у кого адрес совпадает с текущим ниже</option>' +
        '</select></div>' +
      '<div class="po-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="poBulk">Привязать</button></div>' +
      '<div class="po-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="poReload">Обновить</button></div>' +
    '</div>' +
    '<p class="sub" id="poSay" style="margin:0 0 12px"></p>' +
    '<div id="poBox"></div></div>';

  function build() {
    if (el("poCard")) return true;
    var host = document.querySelector('[data-pane="users"]');
    if (!host || !host.firstElementChild) return false;
    var st = document.createElement("style"); st.id = "poCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var box = document.createElement("div");
    box.innerHTML = PANE;
    /* ставим карточку второй — сразу после массового итога дня */
    var card = box.firstChild;
    var first = host.firstElementChild;
    if (first && first.nextElementSibling) host.insertBefore(card, first.nextElementSibling);
    else host.appendChild(card);
    el("poBulk").onclick = bulk;
    el("poReload").onclick = reload;
    return true;
  }

  function say(t) { var s = el("poSay"); if (s) s.textContent = t || ""; }

  function draw() {
    if (!build()) return;
    var us = wallets(), box = el("poBox");
    if (!us.length) { box.innerHTML = '<p class="po-empty">На площадке пока нет кошельков.</p>'; return; }
    box.innerHTML = '<div class="po-scroll"><table><thead><tr>' +
      "<th>Клиент</th><th>Счёт</th><th>Баланс</th><th>Кошелёк для вывода</th>" +
      "<th>Порог, $</th><th>Вывод</th><th></th></tr></thead><tbody>" +
      us.map(function (u) {
        var bal = Number(u.balance) || 0, min = Number(u.payoutMin) || 0;
        var addr = String(u.payoutAddr || "");
        var open = addr && bal >= min;
        return "<tr><td>" + esc(u.name || u.email) + "</td><td>#" + esc(u.acct) + "</td>" +
          '<td class="n">' + bal.toFixed(2) + "</td>" +
          '<td><input data-po-addr="' + u.id + '" value="' + esc(addr) + '" placeholder="вывод закрыт"></td>' +
          '<td><input data-po-min="' + u.id + '" type="number" min="0" step="10" value="' + min + '"></td>' +
          '<td class="' + (open ? "po-ok" : "po-no") + '">' +
            (!addr ? "закрыт — нет адреса" : (bal < min ? "закрыт до $" + min.toFixed(2) : "открыт на " + short(addr))) +
          "</td>" +
          '<td><button class="btn btn-ghost btn-sm" data-po-save="' + u.id + '">Сохранить</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  function save(id) {
    var a = document.querySelector('[data-po-addr="' + id + '"]');
    var m = document.querySelector('[data-po-min="' + id + '"]');
    if (!a || !m) return;
    return call("/api/admin/users/" + id, { method: "PATCH", body: JSON.stringify({
      payoutAddr: (a.value || "").trim(), payoutMin: Number(m.value) || 0
    }) });
  }

  function bulk() {
    var addr = (el("poAddr").value || "").trim();
    var min = Number(el("poMin").value) || 0;
    var who = el("poWho").value;
    var us = wallets();
    var list = us.filter(function (u) {
      var cur = String(u.payoutAddr || "");
      if (who === "all") return true;
      if (who === "empty") return !cur;
      return cur && addr && cur.toLowerCase() === addr.toLowerCase();
    });
    if (!list.length) return say("Под это условие не попал ни один кошелёк.");
    if (!confirm("Привязать кошелёк " + (addr ? short(addr) : "«пусто — вывод закрыт»") +
      " и порог $" + min.toFixed(2) + " к " + list.length + " кошелькам?")) return;
    var btn = el("poBulk"); btn.disabled = true; btn.textContent = "Сохраняем…";
    var done = 0, fail = 0;
    var step = function (i) {
      if (i >= list.length) {
        btn.disabled = false; btn.textContent = "Привязать";
        say("Обновлено кошельков: " + done + (fail ? ", с ошибкой: " + fail : ""));
        return reload();
      }
      return call("/api/admin/users/" + list[i].id, { method: "PATCH", body: JSON.stringify({
        payoutAddr: addr, payoutMin: min
      }) }).then(function () { done++; }, function () { fail++; }).then(function () { return step(i + 1); });
    };
    step(0);
  }

  /* перечитываем кошельки с сервера: таблица покажет сохранённые значения */
  function reload() {
    var p = Promise.resolve();
    if (typeof uFetch === "function") p = Promise.resolve(uFetch());
    return p.then(function () { draw(); if (typeof renderUsers === "function") renderUsers(); })
      .catch(function (e) { say(e.message); });
  }
  window.renderPayoutBind = reload;

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-po-save]");
    if (b) {
      b.disabled = true;
      var done = save(b.getAttribute("data-po-save"));
      if (done) done.then(function () { say("Сохранено"); return reload(); },
                          function (err) { say(err.message); b.disabled = false; });
      return;
    }
    if (e.target.closest && e.target.closest('[data-tab="users"]')) setTimeout(reload, 80);
  });

  function boot() { if (build()) draw(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 800); });
  } else setTimeout(boot, 800);
})();

/* ---------------------------------------------------------------------------
   Админка: ключи активации по каждому клиенту.
   Здесь владелец площадки включает бота кошельку сам — без того, чтобы клиент
   вводил код на странице бота, — продлевает срок или снимает активацию.
   Код берётся из выпущенных во вкладке «Ключи бота».
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var call = function (p, o) {
    if (typeof api !== "function") return Promise.reject(new Error("админка ещё не готова"));
    return api(p, o);
  };
  var wallets = function () {
    try { return (typeof uLoad === "function" ? uLoad() : []) || []; } catch (e) { return []; }
  };
  /* сколько осталось: тот же расчёт, что на странице бота */
  var left = function (u) {
    if (!u.botkey || !u.botkeyUntil) return null;
    return Math.max(0, new Date(u.botkeyUntil).getTime() - Date.now());
  };
  var tone = function (ms) {
    var d = ms / 86400000;
    return d <= 3 ? "r" : (d <= 10 ? "y" : "g");
  };
  var leftTxt = function (ms) {
    var d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000);
    return d > 0 ? d + " дн. " + h + " ч" : h + " ч";
  };

  /* отмеченные кошельки и статусы верификации по номеру счёта */
  var SEL = {}, KYC = {};

  var CSS =
    "#akCard .ak-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}" +
    "#akCard .ak-f{display:flex;flex-direction:column;gap:5px;min-width:150px}" +
    "#akCard .ak-f label{font-size:11.5px;color:var(--muted)}" +
    "#akCard .ak-f input,#akCard .ak-f select{padding:9px 10px;border:1px solid var(--line);" +
    "border-radius:9px;font:inherit;font-size:13px;width:100%;box-sizing:border-box}" +
    "#akCard .ak-scroll{overflow:auto;border:1px solid var(--line);border-radius:11px}" +
    "#akCard table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:780px}" +
    "#akCard th,#akCard td{padding:8px 11px;text-align:left;border-bottom:1px solid var(--line)}" +
    "#akCard th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}" +
    "#akCard tr:last-child td{border-bottom:0}" +
    "#akCard td.nw{white-space:nowrap}" +
    "#akCard .ak-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}" +
    "#akCard .ak-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;" +
    "font-size:11px;font-weight:600;border:1px solid currentColor}" +
    "#akCard .ak-pill.g{color:#16A34A}#akCard .ak-pill.y{color:#C98A04}#akCard .ak-pill.r{color:#E5484D}" +
    "#akCard .ak-pill.o{color:var(--muted)}" +
    "#akCard .ak-pill.v{color:#2BA87A}" +
    "#akCard td.c,#akCard th.c{width:34px;text-align:center}" +
    "#akCard input[type=checkbox]{width:16px;height:16px;cursor:pointer}" +
    "#akCard tr.on{background:var(--accent-soft,rgba(79,70,229,.07))}" +
    "#akCard .ak-empty{font-size:12.5px;color:var(--muted);padding:16px 2px}";

  var PANE =
    '<div class="card" id="akCard"><h2>Активация бота по клиентам</h2>' +
    '<p class="sub">Включить бота кошельку можно прямо отсюда — клиенту не нужно вводить код ' +
    'на странице бота. Берётся свободный код из выпущенных во вкладке «Ключи бота». ' +
    'Срок активации задаётся здесь и отсчитывается от этой минуты: поставьте 0, чтобы взять срок ' +
    'самого кода, и тогда код без срока включится бессрочно. Той же кнопкой «Продлить» срок ' +
    'пересчитывается заново. Снятие гасит плашку «Бот активен» у клиента сразу.</p>' +
    '<p class="sub">Отмечайте кошельки галочками: одной группе можно выдать ключ на 30 дней, ' +
    'другой — на 7. Здесь же проставляется верификация: подтверждённый кошелёк видит на странице ' +
    'бота плашку «Аккаунт верифицирован».</p>' +
    '<div class="ak-row">' +
      '<div class="ak-f" style="min-width:220px"><label for="akCode">Код для активации</label>' +
        '<input id="akCode" placeholder="пусто — возьму свободный" maxlength="19"></div>' +
      '<div class="ak-f" style="min-width:170px"><label for="akDays">Срок активации, дней</label>' +
        '<input id="akDays" type="number" min="0" max="3650" value="30"></div>' +
      '<div class="ak-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" id="akAll">Активировать выбранным</button></div>' +
      '<div class="ak-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="akNone">Снять у выбранных</button></div>' +
      '<div class="ak-f" style="min-width:auto"><label>&nbsp;</label>' +
        '<button class="btn btn-ghost" id="akReload">Обновить</button></div>' +
    '</div>' +
    '<div class="ak-row" style="margin-bottom:10px">' +
      '<div class="ak-f" style="min-width:auto"><label>Верификация выбранных</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost btn-sm" id="akVyes">Подтвердить</button>' +
          '<button class="btn btn-ghost btn-sm" id="akVno">Снять</button>' +
          '<button class="btn btn-ghost btn-sm" id="akPick">Отметить всех</button>' +
          '<button class="btn btn-ghost btn-sm" id="akClear">Снять отметки</button>' +
        '</div></div>' +
      '<div class="ak-f" style="min-width:auto"><label>Сразу на обеих площадках</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-primary btn-sm" id="akVall">Подтвердить всем на BullWaves и второй площадке</button>' +
          '<button class="btn btn-ghost btn-sm" id="akVallNo">Снять у всех на обеих</button>' +
        '</div></div>' +
    '</div>' +
    '<p class="sub" id="akSay" style="margin:0 0 12px"></p>' +
    '<div id="akBox"></div></div>';

  function build() {
    if (el("akCard")) return true;
    var host = document.querySelector('[data-pane="users"]');
    if (!host || !host.firstElementChild) return false;
    var st = document.createElement("style"); st.id = "akCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var box = document.createElement("div");
    box.innerHTML = PANE;
    var card = box.firstChild;
    /* ставим карточку третьей — после массового итога дня и настроек вывода */
    var kids = host.children;
    if (kids.length > 2) host.insertBefore(card, kids[2]);
    else host.appendChild(card);
    el("akAll").onclick = function () { bulk(true); };
    el("akNone").onclick = function () { bulk(false); };
    el("akReload").onclick = reload;
    el("akVyes").onclick = function () { verify("approved"); };
    el("akVno").onclick = function () { verify("none"); };
    el("akVall").onclick = function () { verifyAll("approved"); };
    el("akVallNo").onclick = function () { verifyAll("none"); };
    el("akPick").onclick = function () { wallets().forEach(function (u) { SEL[u.acct] = true; }); draw(); };
    el("akClear").onclick = function () { SEL = {}; draw(); };
    return true;
  }

  function say(t) { var s = el("akSay"); if (s) s.textContent = t || ""; }

  function draw() {
    if (!build()) return;
    var us = wallets(), box = el("akBox");
    if (!us.length) { box.innerHTML = '<p class="ak-empty">На площадке пока нет кошельков.</p>'; return; }
    box.innerHTML = '<div class="ak-scroll"><table><thead><tr>' +
      '<th class="c"><input type="checkbox" id="akChkAll"></th>' +
      "<th>Клиент</th><th>Счёт</th><th>Ключ</th><th>Срок</th><th>Верификация</th><th></th>" +
      "</tr></thead><tbody>" +
      us.map(function (u) {
        var ms = left(u);
        var pill = !u.botkey
          ? '<span class="ak-pill o">не активирован</span>'
          : (ms === null ? '<span class="ak-pill g">бессрочно</span>'
            : (ms > 0 ? '<span class="ak-pill ' + tone(ms) + '">' + leftTxt(ms) + "</span>"
                      : '<span class="ak-pill r">срок вышел</span>'));
        var vst = KYC[String(u.acct)] || "none";
        var vpill = vst === "approved" ? '<span class="ak-pill v">верифицирован</span>'
          : vst === "pending" ? '<span class="ak-pill y">на проверке</span>'
          : vst === "rejected" ? '<span class="ak-pill r">отклонена</span>'
          : '<span class="ak-pill o">нет</span>';
        return '<tr class="' + (SEL[u.acct] ? "on" : "") + '">' +
          '<td class="c"><input type="checkbox" data-ak-sel="' + esc(u.acct) + '"' +
            (SEL[u.acct] ? " checked" : "") + "></td>" +
          "<td>" + esc(u.name || u.email) + "</td><td>#" + esc(u.acct) + "</td>" +
          '<td class="ak-code">' + (u.botkey ? esc(u.botkey) : "—") + "</td>" +
          '<td class="nw">' + pill + "</td>" +
          '<td class="nw">' + vpill + "</td>" +
          '<td class="nw">' +
            '<button class="btn btn-ghost btn-sm" data-ak-on="' + u.id + '">' +
              (u.botkey ? "Перевыдать" : "Активировать") + "</button> " +
            (u.botkey ? '<button class="btn btn-ghost btn-sm" data-ak-ext="' + u.id + '">Продлить</button> ' +
                        '<button class="btn btn-ghost btn-sm" data-ak-off="' + u.id + '">Снять</button>' : "") +
          "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* срок из формы: 0 или пусто — взять срок самого кода */
  function akDays() {
    var d = parseInt((el("akDays") || {}).value, 10);
    return isFinite(d) && d > 0 ? Math.min(3650, d) : 0;
  }
  function onOne(id) {
    var code = (el("akCode").value || "").trim();
    var body = { user: Number(id), days: akDays() };
    if (code) body.code = code;
    return call("/api/admin/botkeys/assign", { method: "POST", body: JSON.stringify(body) });
  }
  function offOne(id) {
    return call("/api/admin/botkeys/revoke", { method: "POST", body: JSON.stringify({ user: Number(id) }) });
  }
  function extOne(id) {
    return call("/api/admin/botkeys/extend", { method: "POST",
      body: JSON.stringify({ user: Number(id), days: akDays() }) });
  }

  /* массовые действия: активировать тем, у кого ключа нет, или снять у всех */
  /* выбранные кошельки; если ничего не отмечено — работаем по всем */
  function picked() {
    var us = wallets();
    var mine = us.filter(function (u) { return SEL[u.acct]; });
    return mine.length ? mine : null;
  }

  function bulk(on) {
    var us = picked();
    if (!us) return say("Отметьте кошельки галочками — действие применяется к выбранным.");
    var list = on ? us : us.filter(function (u) { return !!u.botkey; });
    if (!list.length) return say(on ? "Выбранные кошельки пусты." : "У выбранных нет активаций.");
    var d = akDays();
    if (!confirm(on
      ? "Активировать бота на " + list.length + " выбранных кошельках?\n\n" +
        (d ? "Срок активации: " + d + " дн. с этой минуты." : "Срок — тот, что записан у кода.")
      : "Снять активацию у " + list.length + " кошельков? Плашка «Бот активен» у клиентов погаснет.")) return;
    var btn = on ? el("akAll") : el("akNone");
    var was = btn.textContent;
    btn.disabled = true; btn.textContent = "Готовим…";
    var done = 0, fail = 0, err = "";
    var step = function (i) {
      if (i >= list.length) {
        btn.disabled = false; btn.textContent = was;
        say((on ? "Активировано: " : "Снято: ") + done + (fail ? ", с ошибкой: " + fail + " · " + err : ""));
        return reload();
      }
      return (on ? onOne(list[i].id) : offOne(list[i].id))
        .then(function () { done++; }, function (e) { fail++; err = e.message; })
        .then(function () { return step(i + 1); });
    };
    step(0);
  }

  /* верификация выбранных кошельков: подтвердить или снять отметку */
  function verify(status) {
    var us = picked();
    if (!us) return say("Отметьте кошельки галочками — верификация ставится выбранным.");
    if (!confirm(status === "approved"
      ? "Подтвердить верификацию у " + us.length + " кошельков? На странице бота у них появится плашка «Аккаунт верифицирован»."
      : "Снять верификацию у " + us.length + " кошельков?")) return;
    var btn = status === "approved" ? el("akVyes") : el("akVno");
    var was = btn.textContent;
    btn.disabled = true; btn.textContent = "Готовим…";
    call("/api/admin/kyc/bulk", { method: "POST", body: JSON.stringify({
      accts: us.map(function (u) { return String(u.acct); }), status: status
    }) }).then(function (j) {
      say((status === "approved" ? "Подтверждено кошельков: " : "Снято у кошельков: ") + j.count);
      return reload();
    }, function (e) { say(e.message); })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }

  /* верификация сразу всем кошелькам обеих площадок: база у них общая,
     поэтому отметка ставится и на BullWaves, и на второй площадке одним запросом */
  function verifyAll(status) {
    if (!confirm(status === "approved"
      ? "Подтвердить верификацию ВСЕМ кошелькам обеих площадок?\n\n" +
        "У каждого клиента на странице бота появится плашка «Аккаунт верифицирован»."
      : "Снять верификацию у ВСЕХ кошельков обеих площадок?")) return;
    var btn = status === "approved" ? el("akVall") : el("akVallNo");
    var was = btn.textContent;
    btn.disabled = true; btn.textContent = "Готовим…";
    call("/api/admin/kyc/bulk", { method: "POST",
      body: JSON.stringify({ all: true, both: true, status: status }) })
      .then(function (j) {
        var by = (j.sites || []).map(function (x) {
          return (x.site === "nx" ? "вторая площадка" : "BullWaves") + ": " +
            (x.error ? "недоступна" : x.count);
        }).join(" · ");
        say((status === "approved" ? "Подтверждено кошельков: " : "Снято у кошельков: ") +
          j.count + (by ? " (" + by + ")" : ""));
        return reload();
      }, function (e) { say(e.message); })
      .then(function () { btn.disabled = false; btn.textContent = was; });
  }

  /* статусы верификации берём из заявок — по ним рисуется колонка */
  function loadKyc() {
    return call("/api/admin/kyc").then(function (j) {
      KYC = {};
      (j.list || []).forEach(function (x) { KYC[String(x.acct)] = x.status; });
    }, function () {});
  }

  function reload() {
    var p = Promise.resolve();
    if (typeof uFetch === "function") p = Promise.resolve(uFetch());
    return p.then(loadKyc).then(function () { draw(); if (typeof renderUsers === "function") renderUsers(); })
      .catch(function (e) { say(e.message); });
  }
  window.renderBotAssign = reload;

  document.addEventListener("change", function (e) {
    var c = e.target.closest && e.target.closest("[data-ak-sel]");
    if (c) {
      SEL[c.getAttribute("data-ak-sel")] = c.checked;
      var tr = c.closest("tr"); if (tr) tr.className = c.checked ? "on" : "";
      return;
    }
    if (e.target.id === "akChkAll") {
      var v = e.target.checked;
      wallets().forEach(function (u) { SEL[u.acct] = v; });
      draw();
      var a = el("akChkAll"); if (a) a.checked = v;
    }
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t.closest) return;
    var on = t.closest("[data-ak-on]"), off = t.closest("[data-ak-off]"), ex = t.closest("[data-ak-ext]");
    var run = function (btn, p, okTxt) {
      btn.disabled = true;
      p.then(function (j) { say(okTxt(j)); return reload(); },
             function (err) { say(err.message); btn.disabled = false; });
    };
    if (on) return run(on, onOne(on.getAttribute("data-ak-on")),
      function (j) { return "Кошелёк #" + j.acct + ": активирован кодом " + j.code +
        (j.days ? " на " + j.days + " дн." : " бессрочно"); });
    if (off) return run(off, offOne(off.getAttribute("data-ak-off")),
      function (j) { return "Кошелёк #" + j.acct + ": активация снята"; });
    if (ex) return run(ex, extOne(ex.getAttribute("data-ak-ext")),
      function (j) { return "Кошелёк #" + j.acct + ": срок " + (j.days ? "продлён на " + j.days + " дн." : "снят, ключ бессрочный"); });
    if (t.closest('[data-tab="users"]')) setTimeout(reload, 90);
  });

  function boot() { if (build()) { loadKyc().then(draw); } }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 900); });
  } else setTimeout(boot, 900);
})();


/* ---------------------------------------------------------------------------
   Выпадашка «Кошелёк» в блоке вывода за день: карточка собирается раньше, чем
   приходит список клиентов, поэтому список подставляем, как только он появился,
   и обновляем после каждой операции — иначе там остаётся «кошельков нет».
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  function fill() {
    var us = [];
    try { us = (typeof uLoad === "function" ? uLoad() : []) || []; } catch (e) { us = []; }
    if (!us.length) return;
    var sign = us.map(function (u) { return String(u.acct) + ":" + u.balance; }).join("|");
    var html = us.map(function (u) {
      return '<option value="' + esc(u.acct || "") + '">#' + esc(u.acct || "—") + " · " +
        esc(u.name || u.email || "—") + " · $" + (Number(u.balance) || 0).toFixed(2) + "</option>";
    }).join("");
    ["mdOutAcct", "mdInAcct", "mdRowAcct"].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel || sel.dataset.sign === sign) return;
      var was = sel.value;
      sel.dataset.sign = sign;
      sel.innerHTML = html;
      if (was) sel.value = was;
    });
  }
  setInterval(fill, 2000);
  document.addEventListener("click", function () { setTimeout(fill, 400); });
})();

/* ---------------------------------------------------------------------------
   Админка BullWaves: вкладка «Сводка за день».
   Собирает таблицу сразу по двум площадкам за выбранную дату — итог дня,
   пополнения, выводы и общий баланс по каждому клиенту — и отдаёт готовый
   .xlsx с тремя вкладками: «Сводка», «BullWaves» и вторая площадка.
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  var el = function (i) { return document.getElementById(i); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var money = function (v) {
    v = Number(v) || 0;
    return (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("ru-RU",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var iso = function (d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  };
  function key() {
    try { return sessionStorage.getItem("avexo_admin_key") || ""; } catch (e) { return ""; }
  }
  function call(url, opt) {
    opt = opt || {};
    opt.headers = Object.assign({ "Content-Type": "application/json", "x-admin-key": key() }, opt.headers || {});
    return fetch(url, opt);
  }

  var CSS =
    "#dsCard .ds-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}" +
    "#dsCard .ds-f{display:flex;flex-direction:column;gap:5px}" +
    "#dsCard .ds-f label{font-size:11.5px;color:var(--muted)}" +
    "#dsCard .ds-f input{padding:9px 10px;border:1px solid var(--line);border-radius:9px;" +
    "font:inherit;font-size:13px}" +
    "#dsCard .ds-kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}" +
    "#dsCard .ds-k{border:1px solid var(--line);border-radius:11px;padding:9px 13px;min-width:140px}" +
    "#dsCard .ds-k span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}" +
    "#dsCard .ds-k b{font-size:17px}" +
    "#dsCard .ds-scroll{overflow:auto;border:1px solid var(--line);border-radius:11px}" +
    "#dsCard table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:900px}" +
    "#dsCard th,#dsCard td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}" +
    "#dsCard th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}" +
    "#dsCard td.n{text-align:right;font-variant-numeric:tabular-nums}" +
    "#dsCard tr:last-child td{border-bottom:0;font-weight:600}" +
    "#dsCard .up{color:var(--buy,#16A34A)}#dsCard .dn{color:var(--sell,#EF4444)}" +
    "#dsCard .zero{color:var(--muted)}";

  var PANE =
    '<div class="card" id="dsCard"><h2>Сводка за день — обе площадки</h2>' +
    '<p class="sub">Таблица по выбранной дате сразу по двум сайтам: итог торгового дня, пополнения, ' +
    'выводы и общий баланс по каждому клиенту. Кабинеты сопоставляются по почте. ' +
    'Кнопка «Скачать Excel» отдаёт файл с тремя вкладками: «Сводка», «BullWaves» и вторая площадка.</p>' +
    '<div class="ds-row">' +
      '<div class="ds-f"><label for="dsDate">Дата</label><input id="dsDate" type="date"></div>' +
      '<div class="ds-f"><label>&nbsp;</label><button class="btn btn-ghost" id="dsPrev">← день назад</button></div>' +
      '<div class="ds-f"><label>&nbsp;</label><button class="btn btn-ghost" id="dsNext">день вперёд →</button></div>' +
      '<div class="ds-f"><label>&nbsp;</label><button class="btn btn-ghost" id="dsLoad">Собрать</button></div>' +
      '<div class="ds-f"><label>&nbsp;</label><button class="btn btn-primary" id="dsXls">Скачать Excel</button></div>' +
      '<div class="ds-f"><label>&nbsp;</label><span class="sub" id="dsSay" style="margin:0"></span></div>' +
    '</div>' +
    '<div class="ds-kpi" id="dsKpi"></div><div id="dsBox"></div></div>';

  var DS = { data: null };

  function build() {
    if (el("dsCard")) return true;
    var host = document.querySelector('[data-pane="users"]');
    if (!host || !host.parentNode) return false;
    var st = document.createElement("style"); st.id = "dsCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var pane = document.createElement("div");
    pane.id = "dsPane";
    pane.setAttribute("data-pane", "daysum");
    pane.hidden = true;
    pane.innerHTML = PANE;
    host.parentNode.insertBefore(pane, host.nextSibling);
    var tabs = el("tabs");
    if (tabs && !tabs.querySelector('[data-tab="daysum"]')) {
      var after = tabs.querySelector('[data-tab="report"]') || tabs.querySelector('[data-tab="users"]');
      var b = document.createElement("button");
      b.setAttribute("data-tab", "daysum");
      b.innerHTML = "<i></i>Сводка за день";
      if (after && after.parentNode) after.parentNode.insertBefore(b, after.nextSibling);
      else tabs.appendChild(b);
    }
    var d = el("dsDate");
    if (d && !d.value) d.value = iso(new Date());
    el("dsLoad").onclick = load;
    el("dsXls").onclick = xls;
    el("dsDate").onchange = load;
    el("dsPrev").onclick = function () { shift(-1); };
    el("dsNext").onclick = function () { shift(1); };
    return true;
  }

  function shift(n) {
    var d = el("dsDate"); if (!d || !d.value) return;
    var t = new Date(d.value + "T12:00:00");
    t.setDate(t.getDate() + n);
    d.value = iso(t);
    load();
  }

  function load() {
    if (!build()) return;
    var say = el("dsSay");
    var date = (el("dsDate").value || "").trim();
    if (!date) { say.textContent = "Выберите дату"; return; }
    say.textContent = "Собираем…";
    call("/api/admin/day-report", { method: "POST", body: JSON.stringify({ date: date }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "ошибка"); return j; }); })
      .then(function (j) { DS.data = j; say.textContent = ""; draw(); })
      .catch(function (e) { say.textContent = e.message; });
  }

  function draw() {
    var d = DS.data; if (!d) return;
    var kpi = el("dsKpi"), box = el("dsBox");
    var totBal = d.sites.map(function (st) {
      return d.bySite[st].rows.reduce(function (s, r) { return s + r.balance; }, 0); });
    var totDay = d.sites.map(function (st) {
      return d.bySite[st].rows.reduce(function (s, r) { return s + r.day; }, 0); });
    var totOut = d.sites.map(function (st) {
      return d.bySite[st].rows.reduce(function (s, r) { return s + r.out; }, 0); });
    var totInc = d.sites.map(function (st) {
      return d.bySite[st].rows.reduce(function (s, r) { return s + r.inc; }, 0); });
    var add = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };
    kpi.innerHTML =
      d.labels.map(function (l, i) {
        return '<div class="ds-k"><span>Капитал ' + esc(l) + "</span><b>" + money(totBal[i]) + "</b></div>";
      }).join("") +
      '<div class="ds-k"><span>Капитал всего</span><b>' + money(add(totBal)) + "</b></div>" +
      '<div class="ds-k"><span>Заработано за день</span><b class="up">' + money(add(totDay)) + "</b></div>" +
      '<div class="ds-k"><span>Пополнения</span><b class="up">' + money(add(totInc)) + "</b></div>" +
      '<div class="ds-k"><span>Выводы</span><b class="dn">' + money(add(totOut)) + "</b></div>" +
      '<div class="ds-k"><span>Клиентов</span><b>' + d.merged.length + "</b></div>";
    box.innerHTML = '<div class="ds-scroll"><table><thead><tr>' +
      "<th>Клиент</th>" +
      d.labels.map(function (l) { return "<th>Счёт " + esc(l) + "</th>"; }).join("") +
      d.labels.map(function (l) { return "<th>Баланс " + esc(l) + "</th>"; }).join("") +
      "<th>Общий баланс</th><th>Итог дня</th><th>Пары</th><th>Пополнения</th><th>Выводы</th>" +
      "</tr></thead><tbody>" +
      d.merged.map(function (m) {
        return "<tr><td>" + esc(m.name) + '<br><span class="zero">' + esc(m.mail) + "</span></td>" +
          m.acct.map(function (a) { return "<td>" + (a ? "#" + esc(a) : "—") + "</td>"; }).join("") +
          m.bal.map(function (v) { return '<td class="n">' + money(v) + "</td>"; }).join("") +
          '<td class="n"><b>' + money(m.total) + "</b></td>" +
          '<td class="n ' + (m.dayAll > 0 ? "up" : m.dayAll < 0 ? "dn" : "zero") + '">' +
            (m.dayAll ? money(m.dayAll) : "—") + "</td><td>" + esc(m.pair || "—") + "</td>" +
          '<td class="n ' + (m.incAll ? "up" : "zero") + '">' + (m.incAll ? money(m.incAll) : "—") + "</td>" +
          '<td class="n ' + (m.outAll ? "dn" : "zero") + '">' + (m.outAll ? money(m.outAll) : "—") + "</td></tr>";
      }).join("") +
      "<tr><td>ИТОГО</td>" + d.labels.map(function () { return "<td></td>"; }).join("") +
      totBal.map(function (v) { return '<td class="n">' + money(v) + "</td>"; }).join("") +
      '<td class="n">' + money(add(totBal)) + '</td><td class="n">' + money(add(totDay)) +
      '</td><td></td><td class="n">' + money(add(totInc)) + '</td><td class="n">' + money(add(totOut)) +
      "</td></tr></tbody></table></div>";
  }

  function xls() {
    var say = el("dsSay");
    var date = (el("dsDate").value || "").trim();
    if (!date) { say.textContent = "Выберите дату"; return; }
    say.textContent = "Готовим файл…";
    call("/api/admin/day-report.xlsx", { method: "POST", body: JSON.stringify({ date: date }) })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || "ошибка"); });
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "svodka-" + date + ".xlsx";
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        say.textContent = "файл скачан";
        setTimeout(function () { say.textContent = ""; }, 2500);
      })
      .catch(function (e) { say.textContent = e.message; });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest('[data-tab="daysum"]')) setTimeout(load, 60);
  });
  function boot() { build(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 800); });
  } else setTimeout(boot, 800);
})();
