/* Кабинет: уведомления, восстановление пароля и служба поддержки.
   Файл подключается к готовой странице и ничего в ней не переписывает:
   раздел «Поддержка», кнопка в меню и стили добавляются из этого скрипта,
   а дальше используются функции самого кабинета (api, toast, showPane, dynCfg). */
(function () {
  "use strict";
  var has = function (n) { return typeof window[n] === "function"; };
  var say = function (m) { if (has("toast")) toast(m); else console.log(m); };
  var req = function (p, o) { return has("api") ? api(p, o) : Promise.reject(new Error("нет связи с сервером")); };
  var post = function (p, b) { return req(p, { method: "POST", body: JSON.stringify(b || {}) }); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var logged = function () { return has("currentUser") ? !!currentUser() : false; };
  /* API объявлен через const в основном скрипте: на window его нет, берём лексически */
  var apiOn = function () { try { return typeof API !== "undefined" && !!API.on; } catch (e) { return false; } };

  /* ---------- стили и разметка раздела ---------- */
  var CSS =
    ".sup-wrap{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:16px;align-items:start}" +
    ".sup-wrap>*{min-width:0}" +
    "@media (max-width:860px){.sup-wrap{grid-template-columns:minmax(0,1fr)}}" +
    ".sup-wrap .panel-head{flex-wrap:wrap;gap:8px}.sup-wrap .panel-head h3{margin-right:auto}" +
    ".sup-list{display:flex;flex-direction:column;gap:8px;max-height:430px;overflow:auto}" +
    ".sup-card{text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:11px;" +
    "padding:10px 12px;cursor:pointer;color:inherit;font:inherit}" +
    ".sup-card:hover{border-color:var(--accent)}" +
    ".sup-card.on{border-color:var(--accent);background:var(--accent-soft)}" +
    ".sup-card b{display:block;font-size:13px;margin-bottom:3px}" +
    ".sup-card span{display:block;font-size:11.5px;color:var(--muted)}" +
    ".sup-card .sup-un{display:inline-block;width:auto;margin-top:5px;background:var(--sell);color:#fff;" +
    "border-radius:7px;font-size:10.5px;padding:1px 6px}" +
    ".sup-row{margin-bottom:12px}" +
    ".sup-row label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}" +
    ".sup-row input,.sup-row select,.sup-row textarea,#supText{width:100%;box-sizing:border-box;" +
    "padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);" +
    "color:var(--text);font:inherit;font-size:13px;resize:vertical}" +
    ".sup-note{font-size:11.5px;color:var(--muted);margin:10px 0 0;line-height:1.5}" +
    ".sup-msgs{display:flex;flex-direction:column;gap:9px;max-height:340px;overflow:auto;margin-bottom:12px}" +
    ".sup-m{max-width:88%;border-radius:12px;padding:9px 12px;font-size:12.8px;line-height:1.5;" +
    "white-space:pre-wrap;word-break:break-word}" +
    ".sup-m.me{align-self:flex-end;background:var(--accent-soft);border:1px solid var(--line)}" +
    ".sup-m.op{align-self:flex-start;background:var(--surface-2);border:1px solid var(--line)}" +
    ".sup-m i{display:block;font-size:10.5px;color:var(--muted);font-style:normal;margin-bottom:4px}" +
    ".sup-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}" +
    ".sup-empty{font-size:12.5px;color:var(--muted);padding:14px 2px;line-height:1.5}";

  var VIEW =
    '<h2>Служба поддержки</h2>' +
    '<p class="pane-sub">Напишите в поддержку по кошельку — вопрос попадёт оператору в панель ' +
    'администратора. Ответ появится здесь, в уведомлениях и на почте.</p>' +
    '<div class="sup-wrap">' +
      '<div class="panel"><div class="panel-head"><h3>Мои обращения</h3>' +
        '<button class="btn btn-ghost" id="supNew" style="padding:7px 13px">Новое обращение</button></div>' +
        '<div id="supList" class="sup-list"></div></div>' +
      '<div class="panel"><div class="panel-head"><h3 id="supTitle">Новое обращение</h3>' +
        '<span class="muted" id="supMeta"></span></div>' +
        '<div id="supForm">' +
          '<div class="sup-row"><label for="supTopic">Тема</label><select id="supTopic">' +
            '<option value="pay">Пополнение и вывод</option>' +
            '<option value="acc">Счёт и доступ</option>' +
            '<option value="trade">Терминал и сценарии</option>' +
            '<option value="tech">Техническая проблема</option>' +
            '<option value="other">Другое</option></select></div>' +
          '<div class="sup-row"><label for="supSubj">Коротко о вопросе</label>' +
            '<input id="supSubj" maxlength="120" placeholder="Например: не проходит заявка на вывод"></div>' +
          '<div class="sup-row"><label for="supBody">Сообщение</label>' +
            '<textarea id="supBody" rows="5" maxlength="4000" placeholder="Опишите, что произошло: ' +
            'номер заявки, сумма, время."></textarea></div>' +
          '<button class="btn btn-primary" id="supCreate">Отправить обращение</button>' +
          '<p class="sup-note">Пароли, коды из писем и полные номера карт в переписку не пишите — ' +
          'поддержка их не спрашивает.</p>' +
        '</div>' +
        '<div id="supChat" hidden>' +
          '<div class="sup-msgs" id="supMsgs"></div>' +
          '<textarea id="supText" rows="3" maxlength="4000" placeholder="Ваш ответ…"></textarea>' +
          '<div class="sup-act"><button class="btn btn-primary" id="supSend">Отправить</button>' +
          '<button class="btn btn-ghost" id="supDone" style="padding:9px 15px">Вопрос решён</button>' +
          '<button class="btn btn-ghost" id="supBack" style="padding:9px 15px">К списку</button></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  var NAV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M21 12a8 8 0 01-8 8H7l-4 3V12a8 8 0 018-8h2a8 8 0 018 8z"/><path d="M9 11h6M9 15h3"/></svg>';

  function build() {
    if (document.getElementById("supPane")) return true;
    var any = document.querySelector('[data-view="dash"]');
    if (!any || !any.parentNode) return false;
    var st = document.createElement("style"); st.id = "supCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var pane = document.createElement("div");
    pane.id = "supPane";
    pane.setAttribute("data-view", "sup");
    pane.hidden = true;
    pane.innerHTML = VIEW;
    any.parentNode.appendChild(pane);
    var side = document.getElementById("side");
    if (side && !side.querySelector('[data-pane="sup"]')) {
      var b = document.createElement("button");
      b.setAttribute("data-pane", "sup");
      b.innerHTML = NAV_SVG + "Поддержка";
      var sp = side.querySelector(".spacer");
      if (sp) side.insertBefore(b, sp); else side.appendChild(b);
    }
    wire();
    return true;
  }

  /* ---------- колокольчик в шапке ---------- */
  var bellUp = false;
  function bell() {
    if (bellUp || !window.Notify) return;
    var box = document.querySelector("header.app-head .acct-badge")
      || document.querySelector("header.app-head .head-right")
      || document.querySelector("header.app-head .app-head-in");
    if (!box) return;
    var slot = document.createElement("span");
    slot.style.display = "inline-flex";
    /* в макете мог быть колокольчик-заглушка: убираем его и ставим рабочий */
    var old = document.getElementById("hdrBell");
    if (old) { old.dataset.ready = "1"; old.hidden = true; old.style.display = "none"; }
    var av = box.querySelector(".avatar") || box.querySelector(".head-user") || old;
    if (av && av.parentNode === box) box.insertBefore(slot, av); else box.appendChild(slot);
    Notify.mount(slot, { api: apiOn() });
    bellUp = true;
  }

  /* ---------- события рынка и риски сценария ---------- */
  var RISK_DD = { calm: 3, balance: 7, turbo: 14 };
  var RISK_NAME = { calm: "консервативный", balance: "сбалансированный", turbo: "агрессивный" };
  function watch() {
    if (!window.Notify) return;
    if (Notify.setApi) Notify.setApi(apiOn() && logged());
    if (!logged()) return;
    try {
      if (has("mktOpen")) {
        var open = !!mktOpen();
        var info = "Котировки обновляются, сценарии продолжают работу.";
        if (!open && has("mktStopText")) {
          var t = mktStopText();
          info = (t && typeof t === "object") ? [t.head, t.sub].filter(Boolean).join(" ") : String(t || "");
        }
        Notify.market(open, info);
      }
      var d = has("dynCfg") ? dynCfg() : null;
      if (d && d.on) {
        var day = new Date().toISOString().slice(0, 10);
        var rk = String(d.risk || "balance");
        Notify.add({ kind: "risk", key: "run-" + String(d.startedAt || ""),
          title: "Сценарий запущен · " + (RISK_NAME[rk] || rk) + " режим",
          text: "Инструмент " + (d.pair || "XAU/USD") + ", в работе " +
            Math.round((Number(d.share) || 0.6) * 100) + "% депозита. Допустимая просадка по режиму — до " +
            (RISK_DD[rk] || 7) + "%. Пока сценарий идёт, баланс может временно уходить вниз." });
        if (rk === "turbo") Notify.add({ kind: "risk", key: "turbo-" + day,
          title: "Агрессивный режим: повышенный риск",
          text: "Просадка до " + RISK_DD.turbo + "% считается нормой для этого режима. " +
            "Снизить риск можно в разделе «Помощник»." });
        var pr = has("dynProgress") ? dynProgress() : null;
        var cur = has("dynValue") ? dynValue() : null;
        if (cur != null && Number(d.from) && cur < Number(d.from)) {
          var dd = (1 - cur / Number(d.from)) * 100;
          if (dd >= 1) Notify.add({ kind: "risk", key: "dd-" + day,
            title: "Просадка по сценарию " + dd.toFixed(1) + "%",
            text: "Баланс ниже стартового значения сценария. Это ожидаемо внутри сессии; " +
              "сценарий можно остановить в разделе «Помощник»." });
        }
        if (pr != null && pr >= 1) Notify.add({ kind: "risk", key: "done-" + String(d.startedAt || ""),
          title: "Сценарий завершён",
          text: "Цель сессии достигнута, новые сделки по сценарию не открываются." });
      }
    } catch (e) {}
  }

  /* ---------- восстановление пароля ---------- */
  function shell(title, sub, inner) {
    var el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' +
      '<button class="modal-x" aria-label="Закрыть">×</button><h3>' + esc(title) + "</h3>" +
      (sub ? '<p class="sub">' + esc(sub) + "</p>" : "") + inner +
      '<p id="f-err" class="sub" style="color:var(--sell);margin:10px 0 0" hidden></p></div>';
    document.body.appendChild(el);
    var close = function () { el.remove(); };
    el.querySelector(".modal-x").onclick = close;
    el.onclick = function (e) { if (e.target === el) close(); };
    el.err = function (m) { var e = el.querySelector("#f-err"); e.textContent = m || ""; e.hidden = !m; };
    return el;
  }
  function forgotModal(mail) {
    var el = shell("Восстановление пароля",
      "Пришлём письмо со ссылкой: по ней можно задать новый пароль. Ссылка действует час.",
      '<div class="field"><label for="f-mail">Email кошелька</label>' +
      '<input id="f-mail" type="email" placeholder="you@example.com" value="' + esc(mail || "") + '"></div>' +
      '<button class="btn btn-primary btn-block" id="f-go">Отправить ссылку</button>');
    var go = el.querySelector("#f-go");
    go.onclick = function () {
      var m = (el.querySelector("#f-mail").value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) return el.err("Введите корректный email");
      go.disabled = true; go.style.opacity = ".6";
      post("/api/forgot", { email: m }).then(function () {
        el.remove();
        say("Если такой кошелёк есть, письмо со ссылкой отправлено на " + m);
      }).catch(function (e) { go.disabled = false; go.style.opacity = ""; el.err(e.message); });
    };
    el.querySelector("#f-mail").focus();
  }
  function resetModal(token) {
    var el = shell("Новый пароль", "Задайте пароль для входа в кошелёк.",
      '<div class="field"><label for="r-p1">Новый пароль</label>' +
      '<input id="r-p1" type="password" placeholder="минимум 6 символов"></div>' +
      '<div class="field"><label for="r-p2">Повторите пароль</label>' +
      '<input id="r-p2" type="password" placeholder="ещё раз"></div>' +
      '<button class="btn btn-primary btn-block" id="r-go">Сохранить пароль</button>');
    req("/api/reset/check?token=" + encodeURIComponent(token)).then(function (j) {
      var s = el.querySelector(".sub");
      if (s && j && j.email) s.textContent = "Кошелёк " + j.email + " — задайте новый пароль.";
    }).catch(function (e) { el.err(e.message); });
    var go = el.querySelector("#r-go");
    go.onclick = function () {
      var a = el.querySelector("#r-p1").value || "", b = el.querySelector("#r-p2").value || "";
      if (a.length < 6) return el.err("Пароль не короче 6 символов");
      if (a !== b) return el.err("Пароли не совпадают");
      go.disabled = true; go.style.opacity = ".6";
      post("/api/reset", { token: token, pass: a }).then(function (j) {
        el.remove();
        history.replaceState(null, "", location.pathname);
        say("Пароль изменён — вы вошли в кошелёк");
        try { if (j && j.user && typeof ME !== "undefined") ME = j.user; } catch (x) {}
        if (has("setSession") && j && j.user) setSession(j.user.email);
        if (has("openApp")) openApp("dash");
      }).catch(function (e) { go.disabled = false; go.style.opacity = ""; el.err(e.message); });
    };
    el.querySelector("#r-p1").focus();
  }
  /* ссылку «Забыли пароль?» подставляем в готовую модалку входа, не меняя её код */
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      [].forEach.call(m.addedNodes || [], function (n) {
        if (!n || n.nodeType !== 1 || !n.classList || !n.classList.contains("overlay")) return;
        var foot = n.querySelector(".modal-foot");
        var swap = n.querySelector("#m-swap");
        if (!foot || !swap || n.querySelector("#m-forgot")) return;
        if (/Зарегистрироваться/.test(swap.textContent || "")) {
          var a = document.createElement("a");
          a.id = "m-forgot"; a.href = "#"; a.textContent = "Забыли пароль?";
          a.style.cssText = "color:var(--accent);display:inline-block;margin-top:7px";
          foot.appendChild(document.createElement("br")); foot.appendChild(a);
          a.onclick = function (e) {
            e.preventDefault();
            var mail = (n.querySelector("#m-mail") || {}).value || "";
            n.remove(); forgotModal(mail);
          };
        }
      });
    });
  }).observe(document.body, { childList: true });

  /* ---------- служба поддержки ---------- */
  var SUP = { list: [], cur: null, loaded: false };
  var el = function (id) { return document.getElementById(id); };
  function supTime(at) {
    var t = new Date(at);
    if (isNaN(t)) return "";
    return t.toLocaleDateString("ru-RU") + " " +
      t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  function supRender() {
    var box = el("supList"); if (!box) return;
    if (!SUP.list.length) {
      box.innerHTML = '<p class="sup-empty">Обращений пока нет. Нажмите «Новое обращение» — ' +
        "ответ придёт сюда и на почту.</p>";
    } else {
      box.innerHTML = SUP.list.map(function (t) {
        return '<button class="sup-card' + (SUP.cur && SUP.cur.id === t.id ? " on" : "") +
          '" data-tid="' + t.id + '"><b>№' + t.id + " · " + esc(t.subject) + "</b><span>" +
          esc(t.topicName) + " · " + esc(t.statusName) + " · " + supTime(t.updated) + "</span>" +
          (t.unreadUser ? '<span class="sup-un">новый ответ</span>' : "") + "</button>";
      }).join("");
    }
    var form = el("supForm"), chat = el("supChat");
    if (SUP.cur) {
      form.hidden = true; chat.hidden = false;
      el("supTitle").textContent = "Обращение №" + SUP.cur.id + " · " + SUP.cur.subject;
      el("supMeta").textContent = SUP.cur.topicName + " · " + SUP.cur.statusName;
      el("supMsgs").innerHTML = (SUP.cur.msgs || []).map(function (m) {
        return '<div class="sup-m ' + (m.who === "adm" ? "op" : "me") + '"><i>' +
          esc(m.who === "adm" ? (m.name || "Служба поддержки") : "Вы") + " · " + supTime(m.at) +
          "</i>" + esc(m.text) + "</div>";
      }).join("");
      var ms = el("supMsgs"); ms.scrollTop = ms.scrollHeight;
      el("supDone").hidden = SUP.cur.status === "closed";
    } else {
      form.hidden = false; chat.hidden = true;
      el("supTitle").textContent = "Новое обращение";
      el("supMeta").textContent = "";
    }
  }
  function supLoad(force) {
    if (!apiOn() || !logged()) {
      var box = el("supList");
      if (box) box.innerHTML = '<p class="sup-empty">Поддержка доступна после входа в кошелёк.</p>';
      return Promise.resolve();
    }
    if (SUP.loaded && !force) { supRender(); return Promise.resolve(); }
    return req("/api/tickets").then(function (j) {
      SUP.list = (j && j.tickets) || []; SUP.loaded = true;
      if (SUP.cur) {
        SUP.cur = SUP.list.filter(function (t) { return t.id === SUP.cur.id; })[0] || null;
      }
      supRender();
    }).catch(function (e) {
      var box = el("supList");
      if (box) box.innerHTML = '<p class="sup-empty">' + esc(e.message) + "</p>";
    });
  }
  function supOpen(id) {
    var t = SUP.list.filter(function (x) { return x.id === Number(id); })[0];
    if (!t) return;
    SUP.cur = t; supRender();
    if (t.unreadUser) {
      post("/api/tickets/" + t.id + "/read").then(function () { t.unreadUser = 0; supRender(); })
        .catch(function () {});
    }
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest(".sup-card");
    if (c) { supOpen(c.dataset.tid); return; }
    if (e.target.closest('[data-pane="sup"]')) setTimeout(function () { supLoad(true); }, 40);
  });
  function wire() {
    var nb = el("supNew"); if (nb) nb.onclick = function () { SUP.cur = null; supRender(); };
    var bk = el("supBack"); if (bk) bk.onclick = function () { SUP.cur = null; supRender(); };
    var cr = el("supCreate");
    if (cr) cr.onclick = function () {
      var topic = el("supTopic").value, subject = (el("supSubj").value || "").trim();
      var text = (el("supBody").value || "").trim();
      if (text.length < 5) return say("Опишите вопрос подробнее");
      cr.disabled = true;
      post("/api/tickets", { topic: topic, subject: subject, text: text }).then(function (j) {
        cr.disabled = false;
        el("supSubj").value = ""; el("supBody").value = "";
        say("Обращение №" + j.ticket.id + " отправлено");
        if (window.Notify) Notify.add({ kind: "sup", title: "Обращение №" + j.ticket.id + " отправлено",
          text: j.ticket.subject + " · ответ придёт сюда и на почту.", sync: false });
        supLoad(true).then(function () { supOpen(j.ticket.id); });
      }).catch(function (e) { cr.disabled = false; say(e.message); });
    };
    var sd = el("supSend");
    if (sd) sd.onclick = function () {
      if (!SUP.cur) return;
      var t = (el("supText").value || "").trim();
      if (!t) return say("Пустое сообщение");
      sd.disabled = true;
      post("/api/tickets/" + SUP.cur.id + "/msg", { text: t }).then(function (j) {
        sd.disabled = false; el("supText").value = "";
        SUP.cur = j.ticket; supLoad(true);
      }).catch(function (e) { sd.disabled = false; say(e.message); });
    };
    var dn = el("supDone");
    if (dn) dn.onclick = function () {
      if (!SUP.cur) return;
      post("/api/tickets/" + SUP.cur.id + "/close").then(function (j) {
        SUP.cur = j.ticket; say("Обращение закрыто"); supLoad(true);
      }).catch(function (e) { say(e.message); });
    };
  }

  /* ---------- старт ---------- */
  function boot() {
    build(); bell();
    var qs = new URLSearchParams(location.search);
    var rt = qs.get("reset");
    if (rt && rt.length >= 20) resetModal(rt);
    var sid = qs.get("support");
    if (sid && logged() && has("openApp")) {
      openApp("sup");
      supLoad(true).then(function () { supOpen(sid); });
      history.replaceState(null, "", location.pathname);
    }
    watch();
    setTimeout(watch, 1600); setTimeout(watch, 4000);
    setInterval(function () { build(); bell(); watch(); }, 45000);
    setInterval(function () {
      var v = document.querySelector('[data-view="sup"]');
      if (v && !v.hidden) supLoad(true);
    }, 60000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 400); });
  } else setTimeout(boot, 400);
})();
