/* Кабинет: верификация профиля. Файл подключается к готовой странице и ничего
   в ней не переписывает — раздел «Верификация», кнопка в меню и стили добавляются
   отсюда, дальше используются функции самого кабинета (api, toast, currentUser). */
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
  var apiOn = function () { try { return typeof API !== "undefined" && !!API.on; } catch (e) { return false; } };

  var SLOTS = [
    { k: "id", t: "Документ, удостоверяющий личность",
      h: "Паспорт или ID-карта: разворот с фотографией, все четыре угла в кадре." },
    { k: "selfie", t: "Селфи с документом",
      h: "Лицо и документ в одном кадре, данные читаются." },
    { k: "addr", t: "Подтверждение адреса (необязательно)",
      h: "Счёт за коммунальные услуги или выписка банка не старше трёх месяцев." }
  ];
  var ST_CLS = { none: "", pending: "kyc-wait", approved: "kyc-ok", rejected: "kyc-no" };

  var CSS =
    ".kyc-wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,320px);gap:16px;align-items:start}" +
    ".kyc-wrap>*{min-width:0}" +
    "@media (max-width:860px){.kyc-wrap{grid-template-columns:minmax(0,1fr)}}" +
    ".kyc-state{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:11px;" +
    "padding:12px 14px;margin-bottom:14px;font-size:13px}" +
    ".kyc-state b{font-size:13.5px}" +
    ".kyc-state.kyc-wait{border-color:#C9962F;background:rgba(201,150,47,.09)}" +
    ".kyc-state.kyc-ok{border-color:#2BA87A;background:rgba(43,168,122,.1)}" +
    ".kyc-state.kyc-no{border-color:var(--sell,#e4435a);background:rgba(228,67,90,.1)}" +
    ".kyc-state i{width:9px;height:9px;border-radius:50%;background:var(--muted);flex:none}" +
    ".kyc-state.kyc-wait i{background:#C9962F}.kyc-state.kyc-ok i{background:#2BA87A}" +
    ".kyc-state.kyc-no i{background:var(--sell,#e4435a)}" +
    ".kyc-slot{border:1px solid var(--line);border-radius:11px;padding:12px 14px;margin-bottom:10px}" +
    ".kyc-slot b{display:block;font-size:13px;margin-bottom:3px}" +
    ".kyc-slot span{display:block;font-size:11.5px;color:var(--muted);line-height:1.5}" +
    ".kyc-slot .kyc-pick{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}" +
    ".kyc-slot input[type=file]{display:none}" +
    ".kyc-file{font-size:11.5px;color:var(--muted)}" +
    ".kyc-thumb{width:66px;height:46px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}" +
    ".kyc-note{font-size:11.5px;color:var(--muted);line-height:1.55;margin:12px 0 0}" +
    ".kyc-list{font-size:12.5px;color:var(--muted);line-height:1.7;padding-left:18px;margin:8px 0 0}" +
    ".kyc-list li{list-style:disc}" +
    ".kyc-doc{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:7px 0;" +
    "border-bottom:1px solid var(--line)}" +
    ".kyc-doc:last-child{border-bottom:0}.kyc-doc span{color:var(--muted)}";

  var VIEW =
    '<h2>Верификация профиля</h2>' +
    '<p class="pane-sub">Подтвердите личность, чтобы снять ограничения на вывод. ' +
    'Снимки видит только администратор площадки.</p>' +
    '<div id="kycState" class="kyc-state"><i></i><b>Статус: загрузка…</b></div>' +
    '<div class="kyc-wrap">' +
      '<div class="panel"><div class="panel-head"><h3>Документы</h3></div>' +
        '<div id="kycSlots"></div>' +
        '<button class="btn btn-primary" id="kycSend">Отправить на проверку</button>' +
        '<p class="kyc-note">Принимаются JPG, PNG и WEBP. Снимок уменьшается прямо в браузере, ' +
        'на сервер уходит сжатая копия. Документы хранятся только для проверки и не передаются ' +
        'третьим лицам. Это учебный стенд — не загружайте настоящие документы.</p>' +
      '</div>' +
      '<div class="panel"><div class="panel-head"><h3>Как пройти проверку</h3></div>' +
        '<ul class="kyc-list">' +
          '<li>Снимайте при дневном свете, без вспышки и бликов.</li>' +
          '<li>Документ целиком, все углы в кадре.</li>' +
          '<li>Данные должны читаться без увеличения.</li>' +
          '<li>Имя в профиле должно совпадать с документом.</li>' +
          '<li>Скриншоты и сканы с правками не принимаются.</li>' +
        '</ul>' +
        '<div id="kycSent" style="margin-top:14px"></div>' +
      '</div>' +
    '</div>';

  var NAV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
    '<path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>';

  var picked = {};   /* выбранные файлы: ключ слота → data URL */

  function build() {
    if (document.getElementById("kycPane")) return true;
    var any = document.querySelector('[data-view="dash"]');
    if (!any || !any.parentNode) return false;
    var st = document.createElement("style"); st.id = "kycCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var pane = document.createElement("div");
    pane.id = "kycPane";
    pane.setAttribute("data-view", "kyc");
    pane.hidden = true;
    pane.innerHTML = VIEW;
    any.parentNode.appendChild(pane);
    var side = document.getElementById("side");
    if (side && !side.querySelector('[data-pane="kyc"]')) {
      var b = document.createElement("button");
      b.setAttribute("data-pane", "kyc");
      b.innerHTML = NAV_SVG + "Верификация";
      var sp = side.querySelector(".spacer");
      if (sp) side.insertBefore(b, sp); else side.appendChild(b);
    }
    slots();
    document.getElementById("kycSend").onclick = send;
    return true;
  }

  function slots() {
    var box = document.getElementById("kycSlots");
    if (!box) return;
    box.innerHTML = SLOTS.map(function (s) {
      return '<div class="kyc-slot" data-k="' + s.k + '"><b>' + esc(s.t) + "</b><span>" + esc(s.h) + "</span>" +
        '<div class="kyc-pick">' +
          '<input type="file" accept="image/jpeg,image/png,image/webp" id="kycF-' + s.k + '">' +
          '<button class="btn btn-ghost" style="padding:8px 14px" data-pick="' + s.k + '">Выбрать файл</button>' +
          '<span class="kyc-file" data-name="' + s.k + '">файл не выбран</span>' +
        "</div></div>";
    }).join("");
    box.querySelectorAll("[data-pick]").forEach(function (b) {
      var k = b.getAttribute("data-pick");
      var inp = document.getElementById("kycF-" + k);
      b.onclick = function () { inp.click(); };
      inp.onchange = function () { take(k, inp.files && inp.files[0]); };
    });
  }

  /* уменьшаем снимок в браузере: на сервер уходит копия до 1280 px по длинной стороне */
  function shrink(file) {
    return new Promise(function (done, fail) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return fail(new Error("Нужен снимок JPG, PNG или WEBP"));
      if (file.size > 25 * 1024 * 1024) return fail(new Error("Файл больше 25 МБ"));
      var fr = new FileReader();
      fr.onerror = function () { fail(new Error("Не удалось прочитать файл")); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { fail(new Error("Это не похоже на изображение")); };
        img.onload = function () {
          var max = 1280, w = img.width, h = img.height;
          var k = Math.min(1, max / Math.max(w, h));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(w * k));
          cv.height = Math.max(1, Math.round(h * k));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          var out = cv.toDataURL("image/jpeg", 0.78);
          if (out.length > 880000) out = cv.toDataURL("image/jpeg", 0.6);
          if (out.length > 880000) return fail(new Error("Снимок слишком тяжёлый, сфотографируйте мельче"));
          done(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function take(k, file) {
    if (!file) return;
    shrink(file).then(function (data) {
      picked[k] = { kind: k, name: file.name, data: data };
      var slot = document.querySelector('.kyc-slot[data-k="' + k + '"]');
      var nm = slot && slot.querySelector('[data-name="' + k + '"]');
      if (nm) nm.textContent = file.name + " · " + Math.round(data.length / 1400) + " КБ";
      if (slot && !slot.querySelector(".kyc-thumb")) {
        var im = document.createElement("img");
        im.className = "kyc-thumb";
        slot.querySelector(".kyc-pick").appendChild(im);
        im.src = data;
      } else if (slot) {
        slot.querySelector(".kyc-thumb").src = data;
      }
    }).catch(function (e) { say(e.message); });
  }

  function send() {
    var docs = SLOTS.map(function (s) { return picked[s.k]; }).filter(Boolean);
    if (docs.length < 2) return say("Нужны минимум два снимка: документ и селфи с ним");
    var btn = document.getElementById("kycSend");
    btn.disabled = true; btn.style.opacity = ".6";
    post("/api/kyc", { docs: docs })
      .then(function (j) {
        picked = {};
        slots();
        show(j.kyc);
        say("Документы отправлены на проверку");
      })
      .catch(function (e) { say(e.message); })
      .then(function () { btn.disabled = false; btn.style.opacity = ""; });
  }

  function show(k) {
    var box = document.getElementById("kycState");
    if (!box || !k) return;
    box.className = "kyc-state " + (ST_CLS[k.status] || "");
    var txt = "<i></i><b>Статус: " + esc(k.statusName || k.status) + "</b>";
    if (k.status === "pending") txt += '<span class="muted" style="font-size:12px">Обычно отвечаем в течение рабочего дня</span>';
    if (k.comment) txt += '<span class="muted" style="font-size:12px">' + esc(k.comment) + "</span>";
    box.innerHTML = txt;
    var send = document.getElementById("kycSend");
    if (send) {
      var block = k.status === "pending" || k.status === "approved";
      send.disabled = block;
      send.style.opacity = block ? ".5" : "";
      send.textContent = k.status === "rejected" ? "Отправить заново"
        : k.status === "approved" ? "Профиль подтверждён"
        : k.status === "pending" ? "Заявка на проверке" : "Отправить на проверку";
    }
    var sent = document.getElementById("kycSent");
    if (sent) {
      sent.innerHTML = (k.docs && k.docs.length)
        ? "<h3 style=\"font-size:13px;margin:0 0 6px\">Отправлено</h3>" + k.docs.map(function (d) {
            return '<div class="kyc-doc"><span>' + esc(d.kindName || d.kind) + "</span><span>"
              + Math.round((d.size || 0) / 1400) + " КБ</span></div>";
          }).join("")
        : "";
    }
  }

  function load() {
    if (!apiOn() || !logged()) return;
    req("/api/kyc").then(function (j) { show(j.kyc); }).catch(function () {});
  }

  function boot() {
    if (!build()) return setTimeout(boot, 600);
    load();
    setInterval(function () { if (build()) load(); }, 60000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 500); });
  } else setTimeout(boot, 500);
})();
