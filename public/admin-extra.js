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
