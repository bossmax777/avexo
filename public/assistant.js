/* ИИ-ассистент пульта: принимает задачи словами и сам дергает нужные ручки.
   Подключается к готовой странице — разметка /hub.html не меняется.
   Что умеет: регистрация кабинетов, верификация, активация ключей на срок,
   сводка за вчера с просадками, остановка всех сценариев с фиксацией баланса,
   подсказка по коэффициенту для выбранного инструмента.
   Плюс фильтр кошельков по состоянию ключа в разделе «Подключённые кошельки». */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var esc = function (t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var money = function (n) {
    return "$" + Number(n || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var sig = function (n) { return (n >= 0 ? "+" : "−") + money(Math.abs(n)); };
  var AK = "vxAdmKey";

  var CSS =
    "#aiDock{position:fixed;right:18px;bottom:18px;width:392px;max-width:calc(100vw - 28px);z-index:9990;" +
    "display:flex;flex-direction:column;gap:0;border:1px solid var(--line);border-radius:18px;" +
    "background:var(--surface);box-shadow:0 26px 70px rgba(0,0,0,.5);overflow:hidden}" +
    "#aiDock.min{width:232px}" +
    "#aiHead{display:flex;align-items:center;gap:11px;padding:13px 14px;border-bottom:1px solid var(--line);cursor:pointer}" +
    "#aiHead b{font-size:14px;display:block}" +
    "#aiHead small{font-size:11.5px;color:var(--muted)}" +
    "#aiDock.min #aiBody,#aiDock.min #aiFoot{display:none}" +
    "#aiBody{max-height:min(58vh,520px);overflow:auto;padding:13px 14px;display:flex;flex-direction:column;gap:9px}" +
    ".ai-m{max-width:92%;padding:10px 12px;border-radius:14px;font-size:12.8px;line-height:1.5}" +
    ".ai-m.me{align-self:flex-end;background:var(--accent);color:#0b0d16;font-weight:600;border-bottom-right-radius:5px}" +
    ".ai-m.bot{align-self:flex-start;background:var(--surface-2);border:1px solid var(--line);border-bottom-left-radius:5px}" +
    ".ai-m b{color:var(--text)}" +
    ".ai-m ul{margin:7px 0 0;padding-left:16px}.ai-m li{margin:3px 0}" +
    ".ai-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 11px}" +
    ".ai-chips button{font:inherit;font-size:11.5px;padding:6px 10px;border-radius:999px;cursor:pointer;" +
    "border:1px solid var(--line);background:var(--surface-2);color:var(--text)}" +
    ".ai-chips button:hover{border-color:var(--accent)}" +
    "#aiFoot{border-top:1px solid var(--line);padding:11px 12px;display:flex;gap:8px;align-items:center}" +
    "#aiText{flex:1;min-width:0;padding:9px 11px;border-radius:11px;border:1px solid var(--line);" +
    "background:var(--surface-2);color:var(--text);font:inherit;font-size:12.5px}" +
    "#aiGo{border:0;border-radius:11px;padding:9px 13px;background:var(--accent);color:#0b0d16;font:inherit;" +
    "font-weight:700;cursor:pointer}" +
    "#aiDot{width:8px;height:8px;border-radius:50%;background:#2BA87A;box-shadow:0 0 8px #2BA87A;flex:none}" +
    ".ai-filter{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}" +
    ".ai-filter button{font:inherit;font-size:12px;padding:7px 12px;border-radius:999px;cursor:pointer;" +
    "border:1px solid var(--line);background:var(--surface-2);color:var(--muted)}" +
    ".ai-filter button.on{border-color:var(--accent);color:var(--text);background:rgba(124,92,255,.14)}";

  /* ---------- вспомогательное ---------- */
  function accs() { return (typeof S !== "undefined" && S.accounts) ? S.accounts.filter(function (a) { return !a.error; }) : []; }
  function live(a) { return !!(a && (a.keyLive || a.goldOpen)); }
  function admKey() {
    var k = "";
    try { k = sessionStorage.getItem(AK) || ""; } catch (e) {}
    if (!k) {
      k = window.prompt("Ключ администратора площадки (нужен для этой задачи)") || "";
      k = k.trim();
      if (k && !/[^\x20-\xFF]/.test(k)) { try { sessionStorage.setItem(AK, k); } catch (e) {} }
    }
    return k;
  }
  function adm(url, body) {
    var k = admKey();
    if (!k) return Promise.reject(new Error("без ключа администратора эту задачу не выполнить"));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": k },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ("ошибка " + r.status));
        return j;
      });
    });
  }
  function admGet(url) {
    var k = admKey();
    if (!k) return Promise.reject(new Error("нужен ключ администратора"));
    return fetch(url, { headers: { "x-admin-key": k } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ("ошибка " + r.status));
        return j;
      });
    });
  }

  /* ---------- окно диалога ---------- */
  function say(html, who) {
    var box = $("aiBody"); if (!box) return;
    var d = document.createElement("div");
    d.className = "ai-m " + (who === "me" ? "me" : "bot");
    d.innerHTML = html;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }
  function busy(text) { return say("<i>" + esc(text) + "…</i>"); }
  function fill(node, html) { if (node) node.innerHTML = html; var b = $("aiBody"); if (b) b.scrollTop = b.scrollHeight; }

  /* ---------- задачи ---------- */
  /* 1. регистрация кабинетов */
  function doSignup(n, both, kyc) {
    var items = [], i, tag;
    for (i = 0; i < n; i++) {
      tag = Math.random().toString(36).slice(2, 8);
      items.push({ email: "client" + tag + "@mail.ru", pass: "Pass" + tag.toUpperCase(), name: "" });
    }
    var sites = both ? ["bw", "nx"] : ["bw"];
    var m = busy("Создаю " + n + " кабинет(ов) на " + (both ? "обеих площадках" : "площадке"));
    return adm("/api/hub/signup", { items: items, sites: sites }).then(function (j) {
      var made = j.made || 0, added = 0;
      (j.items || []).forEach(function (x) {
        if (!x.ok || !x.key || typeof S === "undefined") return;
        if (S.creds.some(function (c) { return c.site === x.site && String(c.acct) === String(x.acct); })) return;
        S.creds.push({ site: x.site, acct: x.acct, key: x.key }); added++;
      });
      if (added && typeof saveCreds === "function") { saveCreds(); if (typeof refresh === "function") refresh(); }
      fill(m, "<b>Создано кабинетов: " + made + "</b>" +
        (added ? "<br>Подключено к пульту: " + added : "") +
        "<ul>" + (j.items || []).slice(0, 12).map(function (x) {
          return "<li>#" + esc(x.acct || "—") + " · " + esc(x.siteName || x.site) + " — " +
            (x.ok ? "создан" : esc(x.error)) + "</li>";
        }).join("") + "</ul>");
      if (kyc) return doKycAll();
    }).catch(function (e) { fill(m, "Не получилось: " + esc(e.message)); });
  }

  /* 2. верификация всем на обеих площадках */
  function doKycAll() {
    var m = busy("Ставлю отметку «верификация пройдена» всем кошелькам обеих площадок");
    return adm("/api/admin/kyc/bulk", { both: true, all: true, status: "approved", comment: "Документы приняты площадкой" })
      .then(function (j) {
        var total = (j.done || []).reduce(function (s, x) { return s + (x.count || 0); }, 0) || j.count || 0;
        fill(m, "<b>Верификация проставлена: " + total + " кошельк(ов)</b><br>" +
          "В карточках на пульте теперь плашка «Аккаунт верифицирован».");
        if (typeof refresh === "function") refresh();
      }).catch(function (e) { fill(m, "Не получилось: " + esc(e.message)); });
  }

  /* 3. активация ключей на срок тем, у кого нет */
  function doKeys(days) {
    var need = accs().filter(function (a) { return !live(a); });
    if (!need.length) return Promise.resolve(say("<b>Все подключённые кошельки уже с активным ключом</b> — золотая пара открыта везде."));
    var m = busy("Активирую ключи на " + days + " дн. — кошельков без ключа: " + need.length);
    return admGet("/api/admin/kyc/wallets").then(function (j) {
      var all = j.items || j.wallets || [];
      var jobs = need.map(function (a) {
        var row = all.filter(function (w) { return w.site === a.site && String(w.acct) === String(a.acct); })[0];
        if (!row) return Promise.resolve({ acct: a.acct, ok: false, error: "кошелёк не найден в админке" });
        return adm("/api/admin/botkeys/assign", { user: row.id, days: days })
          .then(function (r) { return { acct: a.acct, ok: true, code: r.code, until: r.until }; })
          .catch(function (e) { return { acct: a.acct, ok: false, error: e.message }; });
      });
      return Promise.all(jobs).then(function (res) {
        var ok = res.filter(function (x) { return x.ok; });
        fill(m, "<b>Ключи активированы: " + ok.length + " из " + res.length + "</b> — на " + days + " дн." +
          "<ul>" + res.slice(0, 12).map(function (x) {
            return "<li>#" + esc(x.acct) + " — " + (x.ok ? "ключ выдан, золото открыто" : esc(x.error)) + "</li>";
          }).join("") + "</ul>");
        if (typeof refresh === "function") refresh();
      });
    }).catch(function (e) { fill(m, "Не получилось: " + esc(e.message)); });
  }

  /* 4. сводка за вчера и просадки */
  function dayGain(a, back) {
    if (typeof valOf !== "function" || typeof winOf !== "function") return 0;
    var w = winOf(a); if (!w) return 0;
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var to = d0.getTime() - (back - 1) * 86400000, from = d0.getTime() - back * 86400000;
    to = Math.min(to, Date.now());
    if (to <= from) return 0;
    return valOf(a, to) - valOf(a, from);
  }
  function doSummary() {
    var list = accs();
    if (!list.length) return say("Кошельки не подключены — сводку собрать не из чего.");
    var rows = list.map(function (a) { return { a: a, g: dayGain(a, 1) }; });
    var sum = rows.reduce(function (s, x) { return s + x.g; }, 0);
    var down = rows.filter(function (x) { return x.g < 0; }).sort(function (x, y) { return x.g - y.g; });
    var top = rows.slice().sort(function (x, y) { return y.g - x.g; }).slice(0, 3);
    say("<b>Вчера по " + list.length + " кошелькам: " + sig(sum) + "</b>" +
      "<ul>" + top.map(function (x) {
        return "<li>#" + esc(x.a.acct) + " · " + esc(x.a.siteName || x.a.site) + " — " + sig(x.g) + "</li>";
      }).join("") + "</ul>" +
      (down.length
        ? "<br>Просадка у " + down.length + ": " + down.slice(0, 6).map(function (x) {
            return "#" + esc(x.a.acct) + " (" + sig(x.g) + ")";
          }).join(", ")
        : "<br>Просадки нет ни на одном кошельке."));
  }

  /* 5. остановить всё и зафиксировать балансы */
  function doStopAll() {
    var m = busy("Останавливаю все сценарии и фиксирую балансы");
    return adm("/api/admin/stop-all", {}).then(function (j) {
      fill(m, "<b>Сценарии остановлены: " + (j.stopped || j.count || 0) + "</b><br>" +
        "Баланс каждого кошелька записан на текущем значении, деньги не тронуты.");
      if (typeof refresh === "function") refresh();
    }).catch(function (e) { fill(m, "Не получилось: " + esc(e.message)); });
  }

  /* 6. совет по стратегии на день */
  function kindOf(pair) {
    var p = (typeof S !== "undefined" && S.pairs && S.pairs[pair]) || {};
    return p.kind || "fx";
  }
  function doAdvice() {
    var sel = (typeof selected === "function" ? selected() : accs());
    if (!sel.length) sel = accs();
    if (!sel.length) return say("Сначала подключите кошельки — тогда посчитаю стратегию.");
    var pair = (typeof S !== "undefined" && S.params && S.params.pair) || "XAU/USD";
    var kind = kindOf(pair);
    var k = kind === "crypto" ? 4.5 : (kind === "stock" ? 1.5 : 1.6);
    var noKey = sel.filter(function (a) { return !live(a); });
    var bal = sel.reduce(function (s, a) { return s + (Number(a.balance) || 0); }, 0);
    var html = "<b>Совет на день по " + sel.length + " кошелькам</b>" +
      "<ul><li>Инструмент: " + esc(pair) + (kind === "crypto" ? " — волатильность выше, коэффициент можно поднимать" : "") + "</li>" +
      "<li>Коэффициент: ×" + String(k).replace(".", ",") + "</li>" +
      "<li>Горизонт: 24 ч, доля депозита в работе 60%</li>" +
      "<li>Ожидаемый итог: " + sig(bal * (k - 1) * 0.6) + " к " + money(bal) + "</li></ul>";
    if (kind === "gold" && noKey.length) {
      html += "<br>По золоту не запустится у " + noKey.length + " кошельк(ов) — ключ не активирован: " +
        noKey.slice(0, 5).map(function (a) { return "#" + esc(a.acct); }).join(", ") +
        ". Могу активировать ключи на 30 дней.";
    }
    say(html);
    if (typeof S !== "undefined" && S.params) {
      S.params.k = k;
      if (typeof buildForm === "function") buildForm();
      if (typeof renderForecast === "function") renderForecast();
    }
  }

  /* ---------- разбор команды ---------- */
  function handle(text) {
    var t = String(text || "").toLowerCase().trim();
    if (!t) return;
    say(esc(text), "me");
    var num = (t.match(/(\d+)\s*(аккаунт|кабинет|кошель)/) || [])[1];
    var days = (t.match(/(\d+)\s*(дн|день|дня|дней|суток)/) || [])[1];
    var both = /обе|двух|обоих|two/.test(t);
    var wantKyc = /верифик|паспорт|kyc/.test(t);

    if (/регистр|заведи|создай|зарегистр/.test(t) && num) return doSignup(Math.max(1, Math.min(50, +num)), both || true, wantKyc);
    if (/ключ/.test(t) && /активир|включи|выдай|продли/.test(t)) return doKeys(Math.max(1, Math.min(3650, +(days || 30))));
    if (wantKyc && /всем|все|подтверд|проставь/.test(t)) return doKycAll();
    if (/останов|стоп|заверши/.test(t)) return doStopAll();
    if (/заработал|итог|сводк|просадк|вчера/.test(t)) return doSummary();
    if (/стратег|совет|коэффициент|что поставить/.test(t)) return doAdvice();

    say("Я умею так:<ul>" +
      "<li>«Зарегистрируй 10 аккаунтов на обеих площадках + пройди верификацию»</li>" +
      "<li>«Активируй ключи на 30 дней тем, у кого нет»</li>" +
      "<li>«Подтверди верификацию всем»</li>" +
      "<li>«Сколько заработали вчера и у кого просадка?»</li>" +
      "<li>«Останови всё и зафиксируй балансы»</li>" +
      "<li>«Посоветуй стратегию на день»</li></ul>");
  }

  /* ---------- панель ---------- */
  var CHIPS = [
    ["Зарегистрировать 10 аккаунтов", "Зарегистрируй 10 аккаунтов на обеих площадках + пройди верификацию"],
    ["Ключи на 30 дней", "Активируй ключи на 30 дней тем, у кого нет"],
    ["Верификация всем", "Подтверди верификацию всем"],
    ["Итог вчера и просадка", "Сколько заработали вчера и у кого просадка?"],
    ["Совет по стратегии", "Посоветуй стратегию на день по выбранным аккаунтам"],
    ["Остановить всё", "Останови всё и зафиксируй балансы"]
  ];
  function dock() {
    if ($("aiDock")) return;
    var d = document.createElement("aside");
    d.id = "aiDock";
    d.innerHTML =
      '<div id="aiHead"><span id="aiDot"></span><span style="flex:1"><b>ИИ-ассистент</b>' +
      "<small>ставьте задачи словами — выполню на обеих площадках</small></span>" +
      '<span id="aiMin" style="color:var(--muted);font-size:17px">–</span></div>' +
      '<div id="aiBody"></div>' +
      '<div class="ai-chips">' + CHIPS.map(function (c, i) {
        return '<button data-c="' + i + '">' + esc(c[0]) + "</button>";
      }).join("") + "</div>" +
      '<div id="aiFoot"><input id="aiText" placeholder="Напишите задачу ассистенту…" autocomplete="off">' +
      '<button id="aiGo">↑</button></div>';
    document.body.appendChild(d);
    say("Привет. Могу зарегистрировать кабинеты, проставить верификацию, выдать ключи на срок, " +
      "собрать сводку за вчера и остановить все сценарии с фиксацией балансов. " +
      "Задачи, которые меняют площадку, попросят ключ администратора.");
    $("aiHead").onclick = function (e) {
      if (e.target && e.target.id === "aiMin") { d.classList.toggle("min"); return; }
      if (d.classList.contains("min")) d.classList.remove("min");
    };
    d.querySelectorAll("[data-c]").forEach(function (b) {
      b.onclick = function () { handle(CHIPS[+b.dataset.c][1]); };
    });
    $("aiGo").onclick = function () { var v = $("aiText").value; $("aiText").value = ""; handle(v); };
    $("aiText").onkeydown = function (e) { if (e.key === "Enter") $("aiGo").click(); };
  }

  /* ---------- фильтр кошельков по ключу ---------- */
  var FLT = "all";
  function applyFilter() {
    var box = $("accs"); if (!box) return;
    box.querySelectorAll(".acc[data-k]").forEach(function (el) {
      var k = el.dataset.k;
      var a = accs().filter(function (x) {
        return ((typeof keyOf === "function") ? keyOf(x) : (x.site + ":" + x.acct)) === k;
      })[0];
      var show = FLT === "all" || (FLT === "on" ? live(a) : !live(a));
      el.style.display = show ? "" : "none";
    });
    var cnt = $("aiFltCnt");
    if (cnt) {
      var on = accs().filter(live).length, off = accs().length - on;
      cnt.textContent = "ключ активирован — " + on + " · не активирован — " + off;
    }
  }
  function filterRow() {
    var box = $("accs");
    if (!box || $("aiFlt")) return;
    var row = document.createElement("div");
    row.className = "ai-filter"; row.id = "aiFlt";
    row.innerHTML =
      '<button data-f="all" class="on">Все кошельки</button>' +
      '<button data-f="on">Ключ активирован</button>' +
      '<button data-f="off">Ключ не активирован</button>' +
      '<span id="aiFltCnt" class="note" style="align-self:center;margin:0 0 0 4px"></span>';
    box.parentNode.insertBefore(row, box);
    row.querySelectorAll("[data-f]").forEach(function (b) {
      b.onclick = function () {
        FLT = b.dataset.f;
        row.querySelectorAll("[data-f]").forEach(function (x) { x.classList.toggle("on", x === b); });
        applyFilter();
      };
    });
    new MutationObserver(applyFilter).observe(box, { childList: true });
    applyFilter();
  }

  function boot() {
    if (!$("aiCss")) {
      var st = document.createElement("style"); st.id = "aiCss"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var desk = $("desk");
    if (!desk || desk.classList.contains("hidden")) return;
    dock(); filterRow();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 400); });
  else setTimeout(boot, 400);
  setInterval(boot, 1500);
})();
