/* Админка: вкладки «Ключи бота» и «Верификация». Подключается к готовой странице
   и добавляет две панели, не меняя остальной код админки.
   Ключи выпускаются здесь и вводятся клиентом в карточке кошелька на /hub.html. */
(function () {
  "use strict";
  var KS = { list: [] };
  var VS = { list: [], cur: null, filter: "pending" };
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
  var say = function (m) { if (typeof toast === "function") toast(m); else console.log(m); };

  var CSS =
    ".bk-t{width:100%;border-collapse:collapse;font-size:12.5px}" +
    ".bk-t th{text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;" +
    "color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap}" +
    ".bk-t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}" +
    ".bk-t tr:last-child td{border-bottom:0}" +
    ".bk-code{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;font-size:13px;cursor:copy}" +
    ".bk-on{color:#15803d;font-weight:600}.bk-off{color:var(--muted)}" +
    ".bk-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}" +
    ".bk-form label{display:block;font-size:11.5px;color:var(--muted);margin-bottom:4px}" +
    ".bk-form input,.bk-form textarea{padding:9px 11px;border:1px solid var(--line);border-radius:9px;" +
    "font:inherit;font-size:13px;box-sizing:border-box}" +
    ".bk-form textarea{width:100%;resize:vertical}" +
    ".kv-wrap{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:16px;align-items:start}" +
    ".kv-wrap>*{min-width:0}" +
    "@media (max-width:900px){.kv-wrap{grid-template-columns:minmax(0,1fr)}}" +
    ".kv-list{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow:auto}" +
    ".kv-card{text-align:left;border:1px solid var(--line);border-radius:11px;padding:10px 12px;" +
    "cursor:pointer;background:var(--surface,#fff);color:inherit;font:inherit}" +
    ".kv-card:hover{border-color:var(--accent)}" +
    ".kv-card.on{border-color:var(--accent);background:var(--accent-soft,rgba(79,70,229,.08))}" +
    ".kv-card b{display:block;font-size:13px;margin-bottom:3px}" +
    ".kv-card span{display:block;font-size:11.5px;color:var(--muted)}" +
    ".kv-st{display:inline-block;width:auto;margin-top:5px;border-radius:7px;font-size:10.5px;padding:1px 7px}" +
    ".kv-st.pending{background:#C9962F;color:#fff}.kv-st.approved{background:#15803d;color:#fff}" +
    ".kv-st.rejected{background:var(--sell,#EF4444);color:#fff}" +
    ".kv-docs{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:12px 0}" +
    ".kv-docs figure{margin:0;border:1px solid var(--line);border-radius:11px;overflow:hidden}" +
    ".kv-docs img{display:block;width:100%;height:150px;object-fit:cover;background:#111;cursor:zoom-in}" +
    ".kv-docs figcaption{font-size:11px;color:var(--muted);padding:7px 9px}" +
    ".kv-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}" +
    ".kv-empty{font-size:12.5px;color:var(--muted);padding:16px 2px;line-height:1.5}" +
    ".kv-full{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;" +
    "align-items:center;justify-content:center;padding:20px;cursor:zoom-out}" +
    ".kv-full img{max-width:100%;max-height:100%;border-radius:10px}";

  var PANE_K =
    '<div class="card"><h2>Ключи активации бота</h2>' +
    '<p class="sub">Код вводится клиентом в карточке кошелька на странице единого бота и включает ' +
    'плашку «Бот активен». Код действует, пока не отозван здесь, и работает только на этой площадке.</p>' +
    '<div class="bk-form">' +
      '<div><label for="bkCount">Сколько выпустить</label>' +
        '<input id="bkCount" type="number" min="1" max="100" value="5" style="width:120px"></div>' +
      '<div><label for="bkNote">Заметка</label>' +
        '<input id="bkNote" maxlength="120" placeholder="например: партия для рекламы" style="width:260px"></div>' +
      '<button class="btn btn-primary btn-sm" id="bkGen">Выпустить</button>' +
      '<button class="btn btn-ghost btn-sm" id="bkReload">Обновить</button></div>' +
    '<div style="margin-bottom:14px"><label class="sub" for="bkOwn" style="display:block;margin-bottom:5px">' +
      'Добавить свои коды — через пробел, запятую или с новой строки</label>' +
      '<textarea id="bkOwn" rows="3" placeholder="X7K9P-4M2QD-V8R3N&#10;F3W8L-Z6T1K-Q9P4X"></textarea>' +
      '<button class="btn btn-ghost btn-sm" id="bkAdd" style="margin-top:8px">Добавить коды</button></div>' +
    '<div style="overflow-x:auto"><table class="bk-t"><thead><tr><th>Код</th><th>Заметка</th>' +
      '<th>Статус</th><th>Активаций</th><th>Кошельков</th><th>Выпущен</th><th></th></tr></thead>' +
      '<tbody id="bkRows"></tbody></table></div>' +
    '<p class="sub" id="bkCount2" style="margin-top:10px"></p></div>';

  var PANE_V =
    '<div class="card"><h2>Верификация профилей</h2>' +
    '<p class="sub">Документы клиент загружает в кабинете, в разделе «Верификация». ' +
    'Решение сразу видно ему там же, приходит в уведомления и на почту.</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn btn-ghost btn-sm" id="kvReload">Обновить</button>' +
      '<select id="kvFilter" style="padding:8px 10px;border-radius:9px;max-width:230px;width:auto">' +
        '<option value="pending">На проверке</option><option value="">Все заявки</option>' +
        '<option value="approved">Подтверждённые</option><option value="rejected">Отклонённые</option></select>' +
      '<span class="sub" id="kvCount" style="margin:0"></span></div>' +
    '<div class="bk-form" style="margin-bottom:6px">' +
      '<div><label for="kvWho">Кошелёк или почта клиента</label>' +
        '<input id="kvWho" placeholder="4034823 или mail@example.com" style="width:270px"></div>' +
      '<div><label for="kvNoteM">Комментарий клиенту</label>' +
        '<input id="kvNoteM" maxlength="200" placeholder="необязательно" style="width:240px"></div>' +
      '<button class="btn btn-primary btn-sm" id="kvMarkOk">Отметить пройденной</button>' +
      '<button class="btn btn-ghost btn-sm" id="kvMarkNo">Отклонить</button>' +
      '<button class="btn btn-ghost btn-sm" id="kvMarkClear">Сбросить статус</button></div>' +
    '<p class="sub" style="margin-bottom:14px">Статус можно выставить вручную, даже если клиент ' +
    'не загружал документы: в его кабинете раздел «Верификация» сразу покажет, что проверка пройдена.</p>' +
    '<div class="kv-wrap"><div class="kv-list" id="kvList"></div><div id="kvView"></div></div></div>';

  function build() {
    if (el("bkPane")) return true;
    var host = document.querySelector('[data-pane="payouts"]');
    if (!host || !host.parentNode) return false;
    var st = document.createElement("style"); st.id = "bkCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var p1 = document.createElement("div");
    p1.id = "bkPane"; p1.setAttribute("data-pane", "botkeys"); p1.hidden = true; p1.innerHTML = PANE_K;
    var p2 = document.createElement("div");
    p2.id = "kvPane"; p2.setAttribute("data-pane", "verify"); p2.hidden = true; p2.innerHTML = PANE_V;
    host.parentNode.insertBefore(p1, host.nextSibling);
    p1.parentNode.insertBefore(p2, p1.nextSibling);
    var tabs = document.getElementById("tabs");
    if (tabs) {
      var after = tabs.querySelector('[data-tab="support"]') || tabs.querySelector('[data-tab="payouts"]');
      var mk = function (key, text) {
        if (tabs.querySelector('[data-tab="' + key + '"]')) return;
        var b = document.createElement("button");
        b.setAttribute("data-tab", key);
        b.innerHTML = "<i></i>" + text;
        if (after && after.parentNode) { after.parentNode.insertBefore(b, after.nextSibling); after = b; }
        else tabs.appendChild(b);
      };
      mk("verify", "Верификация");
      mk("botkeys", "Ключи бота");
    }
    wire();
    return true;
  }

  function wire() {
    el("bkGen").onclick = function () {
      var n = parseInt(el("bkCount").value, 10) || 1;
      call("/api/admin/botkeys", { method: "POST",
        body: JSON.stringify({ count: n, note: el("bkNote").value || "" }) })
        .then(function (j) { say("Выпущено кодов: " + (j.added || []).length); keys(); })
        .catch(function (e) { say(e.message); });
    };
    el("bkAdd").onclick = function () {
      var v = (el("bkOwn").value || "").trim();
      if (!v) return say("Впишите коды");
      call("/api/admin/botkeys", { method: "POST",
        body: JSON.stringify({ codes: v, note: el("bkNote").value || "" }) })
        .then(function (j) {
          say("Добавлено: " + (j.added || []).length + (j.skipped ? ", уже были: " + j.skipped : ""));
          el("bkOwn").value = ""; keys();
        })
        .catch(function (e) { say(e.message); });
    };
    el("bkReload").onclick = function () { keys(); };
    el("kvReload").onclick = function () { verify(); };
    el("kvFilter").onchange = function () { VS.filter = el("kvFilter").value; verify(); };
    var mark = function (status) {
      var who = (el("kvWho").value || "").trim();
      if (!who) return say("Укажите номер кошелька или почту клиента");
      call("/api/admin/kyc/mark", { method: "POST",
        body: JSON.stringify({ who: who, status: status, comment: (el("kvNoteM").value || "").trim() }) })
        .then(function (j) {
          say(j.removed ? "Статус снят"
            : status === "approved" ? "Профиль подтверждён вручную" : "Верификация отклонена");
          el("kvWho").value = ""; el("kvNoteM").value = "";
          verify();
        })
        .catch(function (e) { say(e.message); });
    };
    el("kvMarkOk").onclick = function () { mark("approved"); };
    el("kvMarkNo").onclick = function () { mark("rejected"); };
    el("kvMarkClear").onclick = function () { mark("none"); };
  }

  /* ---------- ключи ---------- */
  function keys() {
    return call("/api/admin/botkeys").then(function (j) {
      KS.list = j.list || [];
      var box = el("bkRows");
      if (!box) return;
      box.innerHTML = KS.list.length ? KS.list.map(function (k) {
        return "<tr><td><span class=\"bk-code\" data-copy=\"" + esc(k.code) + "\">" + esc(k.code) + "</span></td>" +
          "<td>" + esc(k.note || "—") + "</td>" +
          '<td class="' + (k.active ? "bk-on" : "bk-off") + '">' + (k.active ? "активен" : "отозван") + "</td>" +
          "<td>" + k.uses + "</td><td>" + k.wallets + "</td><td>" + when(k.created) + "</td>" +
          '<td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-tog="' + k.id + '" ' +
          'data-act="' + (k.active ? "0" : "1") + '">' + (k.active ? "Отозвать" : "Включить") + "</button> " +
          '<button class="btn btn-ghost btn-sm" data-del="' + k.id + '">Удалить</button></td></tr>';
      }).join("") : '<tr><td colspan="7" class="kv-empty">Кодов пока нет.</td></tr>';
      var c = el("bkCount2");
      if (c) c.textContent = KS.list.length
        ? ("всего " + KS.list.length + ", активных " + KS.list.filter(function (k) { return k.active; }).length)
        : "";
      box.querySelectorAll("[data-copy]").forEach(function (s) {
        s.onclick = function () {
          var t = s.getAttribute("data-copy");
          if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { say("Код скопирован"); });
        };
      });
      box.querySelectorAll("[data-tog]").forEach(function (b) {
        b.onclick = function () {
          call("/api/admin/botkeys/" + b.getAttribute("data-tog"), { method: "PATCH",
            body: JSON.stringify({ active: b.getAttribute("data-act") === "1" }) })
            .then(function () { keys(); }).catch(function (e) { say(e.message); });
        };
      });
      box.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () {
          call("/api/admin/botkeys/" + b.getAttribute("data-del"), { method: "DELETE" })
            .then(function () { say("Код удалён"); keys(); }).catch(function (e) { say(e.message); });
        };
      });
    }).catch(function () {});
  }

  /* ---------- верификация ---------- */
  function verify() {
    var qs = VS.filter ? "?status=" + encodeURIComponent(VS.filter) : "";
    return call("/api/admin/kyc" + qs).then(function (j) {
      VS.list = j.list || [];
      var box = el("kvList");
      if (!box) return;
      box.innerHTML = VS.list.length ? VS.list.map(function (k) {
        return '<button class="kv-card' + (VS.cur && VS.cur.id === k.id ? " on" : "") +
          '" data-kv="' + k.id + '"><b>#' + esc(k.acct) + " · " + esc(k.name || k.email) + "</b>" +
          "<span>" + esc(k.email) + "</span><span>" + when(k.updated) + " · документов: " +
          (k.docs ? k.docs.length : 0) + "</span>" +
          '<span class="kv-st ' + esc(k.status) + '">' + esc(k.statusName) + "</span></button>";
      }).join("") : '<p class="kv-empty">Заявок нет.</p>';
      var c = el("kvCount");
      if (c) c.textContent = VS.list.length ? ("всего " + VS.list.length) : "";
      box.querySelectorAll("[data-kv]").forEach(function (b) {
        b.onclick = function () { open(b.getAttribute("data-kv")); };
      });
      if (VS.cur) {
        var still = VS.list.filter(function (x) { return x.id === VS.cur.id; })[0];
        if (!still) { VS.cur = null; el("kvView").innerHTML = ""; }
      }
    }).catch(function () {});
  }

  function open(id) {
    call("/api/admin/kyc/" + id).then(function (j) {
      VS.cur = j.kyc;
      verify();
      var box = el("kvView");
      var k = j.kyc;
      box.innerHTML = '<div class="card" style="margin:0"><h3 style="margin:0 0 4px">Заявка №' + k.id +
        " · кошелёк #" + esc(k.acct) + "</h3>" +
        '<p class="sub">' + esc(k.name || "без имени") + " · " + esc(k.email) + " · " +
        esc(k.statusName) + " · " + when(k.updated) + "</p>" +
        ((k.docs && k.docs.length)
          ? '<div class="kv-docs">' + k.docs.map(function (d, i) {
              return "<figure><img src=\"" + d.data + "\" alt=\"\" data-full=\"" + i + "\">" +
                "<figcaption>" + esc(d.kindName || d.kind) + "</figcaption></figure>";
            }).join("") + "</div>"
          : '<p class="kv-empty">Документы не загружались — статус выставлен вручную.</p>') +
        '<label class="sub" for="kvC" style="display:block;margin-bottom:5px">Комментарий клиенту</label>' +
        '<textarea id="kvC" rows="2" style="width:100%;box-sizing:border-box;padding:10px 12px;' +
        'border:1px solid var(--line);border-radius:10px;font:inherit;font-size:13px" ' +
        'placeholder="Например: селфи нечитаемо, переснимите при дневном свете">' + esc(k.comment || "") + "</textarea>" +
        '<div class="kv-act"><button class="btn btn-primary btn-sm" id="kvOk">Подтвердить</button>' +
        '<button class="btn btn-ghost btn-sm" id="kvNo">Отклонить</button>' +
        '<button class="btn btn-ghost btn-sm" id="kvWait">Вернуть на проверку</button></div></div>';
      box.querySelectorAll("[data-full]").forEach(function (im, i) {
        im.onclick = function () {
          var f = document.createElement("div");
          f.className = "kv-full";
          f.innerHTML = '<img src="' + k.docs[i].data + '" alt="">';
          f.onclick = function () { f.remove(); };
          document.body.appendChild(f);
        };
      });
      var decide = function (st) {
        call("/api/admin/kyc/" + k.id, { method: "POST",
          body: JSON.stringify({ status: st, comment: (el("kvC").value || "").trim() }) })
          .then(function () {
            say(st === "approved" ? "Профиль подтверждён" : st === "rejected" ? "Заявка отклонена" : "Возвращена на проверку");
            VS.cur = null; el("kvView").innerHTML = ""; verify();
          })
          .catch(function (e) { say(e.message); });
      };
      el("kvOk").onclick = function () { decide("approved"); };
      el("kvNo").onclick = function () {
        if (!(el("kvC").value || "").trim()) return say("Впишите причину отказа — клиент её увидит");
        decide("rejected");
      };
      el("kvWait").onclick = function () { decide("pending"); };
    }).catch(function (e) { say(e.message); });
  }

  function boot() {
    if (!build()) return setTimeout(boot, 700);
    keys(); verify();
    setInterval(function () {
      var p = document.querySelector('[data-pane="botkeys"]');
      var v = document.querySelector('[data-pane="verify"]');
      if (p && !p.hidden) keys();
      if (v && !v.hidden) verify();
    }, 45000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); });
  } else setTimeout(boot, 600);
})();
