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
    '<div class="md-out" id="mdOut" hidden></div>' +
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
          (x.dir === "down" ? "убыток" : "прибыль") + " " + x.pct + "% · кошельков " + x.wallets +
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
  var RP = { all: false };
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
    "#rpCard .rp-copy-h span{font-size:11.5px;color:var(--muted)}" +
    "#rpCard #rpText{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid var(--line);" +
    "border-radius:11px;font:inherit;font-size:13px;line-height:1.7;resize:vertical;white-space:pre}";

  var PANE =
    '<div class="card" id="rpCard"><h2>Отчёт за день</h2>' +
    '<p class="sub">Построчно по каждому клиенту площадки: итог торгового дня за выбранную дату, ' +
    'пополнения и выводы в этот же день и текущий баланс кошелька. ' +
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
    var res = { day: 0, cash: 0, has: false, note: "" };
    (u.tx || []).forEach(function (t) {
      if (!t || String(t[0]) !== day) return;
      var v = num(t[2]);
      if (String(t[1]).indexOf(DAY) === 0) { res.day += v; res.has = true; res.note = String(t[4] || ""); }
      else res.cash += v;
    });
    res.day = +res.day.toFixed(2);
    res.cash = +res.cash.toFixed(2);
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
        day: r.day, cash: r.cash, has: r.has, note: r.note
      };
    }).sort(function (a, b) { return b.day - a.day; });
  }

  /* сумма в стиле сообщения: +33$ у целых, +33.50$ у дробных */
  function short(v) {
    v = Number(v) || 0;
    var a = Math.abs(v);
    return (v < 0 ? "-" : "+") + (a === Math.round(a) ? String(Math.round(a)) : a.toFixed(2)) + "$";
  }

  /* построчный текст для копирования:
     Sergei Shklyaev (ID 08211372) - 05.10.2026 +33$ */
  function text(list, day) {
    return list.filter(function (x) { return RP.all || x.has; })
      .map(function (x) {
        return x.name + " (ID " + x.acct + ") - " + day + " " + short(x.day);
      }).join("\n");
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
      if (el("rpText")) el("rpText").value = "";
      box.innerHTML = '<p class="rp-empty">На площадке пока нет кошельков.</p>';
      return;
    }
    var t = el("rpText");
    if (t) {
      t.value = text(list, ru(day));
      t.rows = Math.min(16, Math.max(3, t.value.split("\n").length));
    }
    var sum = list.reduce(function (s, x) { return s + x.day; }, 0);
    var cash = list.reduce(function (s, x) { return s + x.cash; }, 0);
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
      '<div class="rp-k"><span>Касса за день</span><b>' + money(cash) + "</b></div>";
    box.innerHTML = '<div class="rp-scroll"><table><thead><tr>' +
      "<th>Клиент</th><th>Счёт</th><th>Итог дня</th><th>Пополнения и выводы</th>" +
      "<th>Баланс сейчас</th><th>Статус</th></tr></thead><tbody>" +
      list.map(function (x) {
        return "<tr><td>" + esc(x.name) + "<br><span class=\"zero\">" + esc(x.mail) + "</span></td>" +
          "<td>#" + esc(x.acct) + '</td><td class="n ' +
          (x.day > 0 ? "up" : x.day < 0 ? "dn" : "zero") + '">' + (x.has ? money(x.day) : "—") + "</td>" +
          '<td class="n ' + (x.cash ? (x.cash > 0 ? "up" : "dn") : "zero") + '">' +
          (x.cash ? money(x.cash) : "—") + "</td>" +
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
    var lines = [["Клиент", "Email", "Счёт", "Итог дня", "Пополнения и выводы", "Баланс", "Валюта", "Статус"].map(q).join(";")];
    list.forEach(function (x) {
      lines.push([x.name, x.mail, x.acct, x.has ? plain(x.day) : "", plain(x.cash),
        plain(x.balance), x.cur, x.has ? (x.note || "") : "нет записи"].map(q).join(";"));
    });
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
