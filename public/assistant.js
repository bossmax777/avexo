/* Помощник пульта /hub. Работает только правами самого пользователя:
   теми же ручками, что и кнопки страницы (ключ API кошелька), в админку не ходит.
   Что умеет: разобрать состояние кошельков и ответить на вопросы по пульту,
   предложить стратегию по каждому аккаунту и применить её в карточки,
   принять коды активации из чата и включить ими бота,
   собрать заявки на верификацию из приложенных снимков,
   запустить, остановить и зафиксировать сессии по выбранным кошелькам.
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
  var num = function (v) { return Number(v) || 0; };

  /* ---------- данные страницы ---------- */
  function accs() {
    return (typeof S !== "undefined" && S.accounts) ? S.accounts.filter(function (a) { return !a.error; }) : [];
  }
  function sel() {
    var s = (typeof selected === "function") ? selected() : [];
    return s.length ? s : accs();
  }
  function kOf(a) { return (typeof keyOf === "function") ? keyOf(a) : (a.site + ":" + a.acct); }
  function apiKey(a) {
    var c = (typeof credOf === "function") ? credOf(a) : null;
    return c ? c.key : "";
  }
  function live(a) { return !!(a && (a.keyLive || a.goldOpen)); }
  function kindOf(pair) {
    var p = (typeof S !== "undefined" && S.pairs && S.pairs[pair]) || {};
    return p.kind || "fx";
  }
  function pairsOf(kind) {
    var all = (typeof S !== "undefined" && S.pairs) ? Object.keys(S.pairs) : [];
    return all.filter(function (p) { return kindOf(p) === kind; });
  }
  /* состояние ключа и верификации приходит той же ручкой, что и в карточках */
  var ST = {};
  function pullState() {
    var list = accs().map(function (a) { return { site: a.site, acct: a.acct, key: apiKey(a) }; })
      .filter(function (x) { return x.key; });
    if (!list.length || typeof api !== "function") return Promise.resolve(ST);
    return api("/api/hub/bot/state", { method: "POST", body: JSON.stringify({ accounts: list }) })
      .then(function (j) {
        (j.items || []).forEach(function (s) { ST[s.site + ":" + s.acct] = s; });
        return ST;
      }).catch(function () { return ST; });
  }
  function stOf(a) { return ST[a.site + ":" + a.acct] || {}; }

  var CSS =
    "#aiDock{position:fixed;right:18px;bottom:18px;width:396px;max-width:calc(100vw - 28px);z-index:9990;" +
    "display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;" +
    "background:var(--surface);box-shadow:0 26px 70px rgba(0,0,0,.5);overflow:hidden}" +
    "#aiDock.min{width:250px}" +
    "#aiHead{display:flex;align-items:center;gap:11px;padding:13px 14px;border-bottom:1px solid var(--line);cursor:pointer}" +
    "#aiHead b{font-size:14px;display:block}#aiHead small{font-size:11.5px;color:var(--muted)}" +
    "#aiDock.min #aiBody,#aiDock.min #aiFoot,#aiDock.min .ai-chips{display:none}" +
    "#aiBody{max-height:min(56vh,500px);overflow:auto;padding:13px 14px;display:flex;flex-direction:column;gap:9px}" +
    ".ai-m{max-width:93%;padding:10px 12px;border-radius:14px;font-size:12.8px;line-height:1.5}" +
    ".ai-m.me{align-self:flex-end;background:var(--accent);color:#0b0d16;font-weight:600;border-bottom-right-radius:5px}" +
    ".ai-m.bot{align-self:flex-start;background:var(--surface-2);border:1px solid var(--line);border-bottom-left-radius:5px}" +
    ".ai-m ul{margin:7px 0 0;padding-left:16px}.ai-m li{margin:3px 0}" +
    ".ai-m table{width:100%;border-collapse:collapse;margin-top:7px;font-size:11.8px}" +
    ".ai-m th{text-align:left;color:var(--muted);font-weight:600;padding:4px 5px;border-bottom:1px solid var(--line)}" +
    ".ai-m td{padding:4px 5px;border-bottom:1px solid rgba(255,255,255,.05)}" +
    ".ai-do{margin-top:9px;display:flex;gap:7px;flex-wrap:wrap}" +
    ".ai-do button{font:inherit;font-size:11.8px;padding:7px 11px;border-radius:10px;cursor:pointer;" +
    "border:0;background:var(--accent);color:#0b0d16;font-weight:700}" +
    ".ai-do button.gh{background:transparent;border:1px solid var(--line);color:var(--text);font-weight:600}" +
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
    ".ai-filter{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px;align-items:center}" +
    ".ai-filter button{font:inherit;font-size:12px;padding:7px 12px;border-radius:999px;cursor:pointer;" +
    "border:1px solid var(--line);background:var(--surface-2);color:var(--muted)}" +
    ".ai-filter button.on{border-color:var(--accent);color:var(--text);background:rgba(124,92,255,.14)}";

  /* ---------- окно диалога ---------- */
  function say(html, who) {
    var box = $("aiBody"); if (!box) return null;
    var d = document.createElement("div");
    d.className = "ai-m " + (who === "me" ? "me" : "bot");
    d.innerHTML = html;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
    return d;
  }
  function fill(node, html) {
    if (node) node.innerHTML = html;
    var b = $("aiBody"); if (b) b.scrollTop = b.scrollHeight;
  }
  function busy(t) { return say("<i>" + esc(t) + "…</i>"); }
  /* кнопка под ответом: действие выполняет сам пользователь, одним кликом */
  function act(node, label, fn, ghost) {
    var row = document.createElement("div"); row.className = "ai-do";
    (Array.isArray(label) ? label : [[label, fn, ghost]]).forEach(function (x) {
      var b = document.createElement("button");
      b.textContent = x[0]; if (x[2]) b.className = "gh";
      b.onclick = function () { row.remove(); x[1](); };
      row.appendChild(b);
    });
    if (node) node.appendChild(row);
    var bx = $("aiBody"); if (bx) bx.scrollTop = bx.scrollHeight;
  }

  /* ---------- 1. стратегия по каждому аккаунту ---------- */
  /* раскладываем кошельки по парам: золото — только тем, у кого ключ активен,
     крупным даём спокойный коэффициент, мелким — крипту с высоким */
  function plan() {
    var list = sel().slice().sort(function (a, b) { return num(b.balance) - num(a.balance); });
    var gold = pairsOf("gold")[0] || "XAU/USD";
    var crypto = pairsOf("crypto"); if (!crypto.length) crypto = ["BTC/USD"];
    var stock = pairsOf("stock"); if (!stock.length) stock = crypto;
    return list.map(function (a, i) {
      var bal = num(a.balance), ok = live(a), p, k, why;
      /* золото достаётся кошелькам с активным ключом — через одного, чтобы пары не повторялись */
      if (ok && i % 2 === 0) {
        p = gold; k = 1.6; why = "ключ активен, золото открыто — ровная кривая";
      } else if (bal >= 20000) {
        p = stock[i % stock.length]; k = 1.5; why = "крупный депозит — акции и спокойный коэффициент";
      } else if (bal >= 2000) {
        p = crypto[i % crypto.length]; k = 2.2; why = "средний депозит — крипта, умеренный риск";
      } else {
        p = crypto[(i + 1) % crypto.length]; k = 4.5; why = "небольшой депозит — крипта, высокий коэффициент";
      }
      return { a: a, pair: p, k: k, why: why, gold: p === gold };
    });
  }
  function applyPlan(rows) {
    if (typeof S === "undefined") return;
    rows.forEach(function (r) {
      S.per[kOf(r.a)] = { pair: r.pair, hours: 24, k: r.k, share: 0.6, dir: "up" };
    });
    if (typeof renderAll === "function") renderAll();
    say("<b>Готово.</b> Параметры проставлены в карточки — у каждого кошелька своя пара и коэффициент. " +
      "Запускать можно кнопкой в карточке или командой «запусти по выбранным».");
  }
  function doAdvice() {
    var rows = plan();
    if (!rows.length) return say("Сначала подключите кошельки — тогда разложу их по парам.");
    var sum = rows.reduce(function (s, r) { return s + num(r.a.balance) * (r.k - 1) * 0.6; }, 0);
    var m = say("<b>Предложение на день по " + rows.length + " кошелькам</b>" +
      "<table><tr><th>Кошелёк</th><th>Пара</th><th>Коэф.</th><th>Почему</th></tr>" +
      rows.slice(0, 14).map(function (r) {
        return "<tr><td>#" + esc(r.a.acct) + "</td><td>" + esc(r.pair) + "</td><td>×" +
          String(r.k).replace(".", ",") + "</td><td>" + esc(r.why) + "</td></tr>";
      }).join("") + "</table>" +
      "<br>Если всё отработает по плану, прибавка за сутки около " + money(sum) + ".");
    act(m, [["Применить к карточкам", function () { applyPlan(rows); }],
            ["Только золото тем, у кого ключ", function () {
              var g = rows.filter(function (r) { return live(r.a); })
                .map(function (r) { return { a: r.a, pair: pairsOf("gold")[0] || "XAU/USD", k: 1.6 }; });
              if (!g.length) return say("Ни у одного выбранного кошелька ключ не активирован — золото закрыто.");
              applyPlan(g);
            }, true]]);
  }

  /* ---------- 2. активация ключей кодами из чата ---------- */
  var WAIT = null;  /* чего ждём от пользователя следующим сообщением */
  function askCodes() {
    return pullState().then(function () {
      var need = accs().filter(function (a) { return !live(a); });
      if (!need.length) {
        return say("<b>У всех подключённых кошельков ключ активен.</b> Золотая пара открыта везде, " +
          "коды сейчас не нужны.");
      }
      WAIT = "codes";
      say("Доступа к админке у меня нет — коды активации выдаёт администратор площадки. " +
        "<b>Пришлите коды сюда в чат</b>, по одному в строке (формат X7K9P-4M2QD-V8R3N) — " +
        "я включу ими бота на кошельках без ключа:<ul>" +
        need.slice(0, 12).map(function (a) {
          return "<li>#" + esc(a.acct) + " · " + esc(a.siteName || a.site) + "</li>";
        }).join("") + "</ul>Нужно кодов: " + need.length + ". Срок активации зашит в самом коде.");
    });
  }
  function useCodes(text) {
    var codes = String(text).toUpperCase().match(/[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/g) || [];
    if (!codes.length) {
      WAIT = "codes";
      return say("Не вижу ни одного кода. Формат такой: <b>X7K9P-4M2QD-V8R3N</b>, по одному в строке.");
    }
    var need = accs().filter(function (a) { return !live(a); });
    if (!need.length) return say("Пока ждали, ключи уже активировались — коды не понадобились.");
    var m = busy("Активирую: кодов " + codes.length + ", кошельков без ключа " + need.length);
    var pairs = need.slice(0, codes.length).map(function (a, i) { return { a: a, code: codes[i] }; });
    return Promise.all(pairs.map(function (x) {
      return api("/api/hub/bot/activate", { method: "POST",
        body: JSON.stringify({ site: x.a.site, acct: x.a.acct, key: apiKey(x.a), code: x.code }) })
        .then(function () { return { acct: x.a.acct, ok: true }; })
        .catch(function (e) { return { acct: x.a.acct, ok: false, error: e.message }; });
    })).then(function (res) {
      var ok = res.filter(function (r) { return r.ok; }).length;
      fill(m, "<b>Активировано: " + ok + " из " + res.length + "</b>" +
        "<ul>" + res.map(function (r) {
          return "<li>#" + esc(r.acct) + " — " + (r.ok ? "ключ принят, золото открыто" : esc(r.error)) + "</li>";
        }).join("") + "</ul>" +
        (codes.length < need.length ? "Ещё без ключа: " + (need.length - codes.length) + " — пришлите остальные коды." : ""));
      if (typeof refresh === "function") refresh();
      pullState();
    });
  }

  /* ---------- 3. заявки на верификацию ---------- */
  function readFiles(files) {
    return Promise.all([].slice.call(files).slice(0, 2).map(function (f) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res({ kind: "passport", name: f.name, data: String(r.result) }); };
        r.onerror = function () { rej(new Error("не читается файл " + f.name)); };
        r.readAsDataURL(f);
      });
    }));
  }
  function doKyc() {
    return pullState().then(function () {
      var need = accs().filter(function (a) {
        var s = stOf(a); return s.kyc !== "approved" && s.kyc !== "pending";
      });
      if (!need.length) {
        return say("<b>Заявки не нужны.</b> По всем кошелькам верификация уже пройдена или документы на проверке.");
      }
      var m = say("Поставить отметку «верификация пройдена» может только администратор площадки — " +
        "я могу <b>отправить заявки</b> от вашего имени. Нужны два снимка: страница паспорта и селфи с ним. " +
        "Заявки уйдут по " + need.length + " кошельк(ам): " +
        need.slice(0, 8).map(function (a) { return "#" + esc(a.acct); }).join(", ") + ".");
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp"; inp.multiple = true; inp.hidden = true;
      document.body.appendChild(inp);
      inp.onchange = function () {
        if (inp.files.length < 2) { say("Нужны оба снимка сразу: паспорт и селфи."); return; }
        var b = busy("Отправляю заявки");
        readFiles(inp.files).then(function (docs) {
          var body = [docs[0], { kind: "selfie", name: docs[1].name, data: docs[1].data }];
          return Promise.all(need.map(function (a) {
            return api("/api/hub/kyc", { method: "POST",
              body: JSON.stringify({ site: a.site, acct: a.acct, key: apiKey(a), docs: body }) })
              .then(function () { return { acct: a.acct, ok: true }; })
              .catch(function (e) { return { acct: a.acct, ok: false, error: e.message }; });
          }));
        }).then(function (res) {
          var ok = res.filter(function (r) { return r.ok; }).length;
          fill(b, "<b>Заявки отправлены: " + ok + " из " + res.length + "</b><br>" +
            "Статус в карточках — «Документы на проверке». Решение примет администратор площадки." +
            (res.filter(function (r) { return !r.ok; }).length
              ? "<ul>" + res.filter(function (r) { return !r.ok; }).map(function (r) {
                  return "<li>#" + esc(r.acct) + " — " + esc(r.error) + "</li>"; }).join("") + "</ul>"
              : ""));
          pullState();
        }).catch(function (e) { fill(b, "Не получилось: " + esc(e.message)); });
      };
      act(m, [["Выбрать снимки", function () { inp.click(); }]]);
    });
  }

  /* ---------- 4. регистрация кабинетов (ключ администратора вводит сам пользователь) ---------- */
  function doSignup(n) {
    var box = $("regBox"), list = $("regList");
    if (!box || !list) return say("Блок создания кабинетов на странице не нашёлся.");
    var rows = [], i, tag;
    for (i = 0; i < n; i++) {
      tag = Math.random().toString(36).slice(2, 8);
      rows.push("client" + tag + "@mail.ru Pass" + tag.toUpperCase());
    }
    list.value = rows.join("\n");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    var m = say("Создавать кабинеты может только администратор, поэтому я подготовил список на " + n +
      " кабинет(ов) в блоке «Создать кабинеты на площадках» — почта и пароль на каждую строку. " +
      "Впишите туда <b>ключ администратора</b> и нажмите «Создать кабинеты и подключить»: " +
      "кабинеты сразу подключатся к пульту.");
    act(m, [["Показать блок", function () { box.scrollIntoView({ behavior: "smooth", block: "center" }); }, true]]);
  }

  /* ---------- 5. сессии: запуск, остановка, фиксация ---------- */
  function doRun() {
    var list = sel();
    if (!list.length) return say("Не выбрано ни одного кошелька.");
    var m = say("Запущу сценарий по " + list.length + " кошельк(ам) с параметрами из карточек " +
      "(где их нет — из общего сценария слева).");
    act(m, [["Запустить", function () {
      if (typeof runKeys === "function") runKeys(list.map(kOf));
    }], ["Отмена", function () {}, true]]);
  }
  function doStop() {
    var list = sel().filter(function (a) { return (typeof winOf === "function") && winOf(a); });
    if (!list.length) return say("Сейчас нет запущенных сессий среди выбранных кошельков.");
    var m = say("Остановлю " + list.length + " сессию(й). Баланс остаётся таким, какой есть на момент остановки — " +
      "деньги с кошельков никуда не уходят.");
    act(m, [["Остановить", function () {
      if (typeof stopKeys === "function") stopKeys(list.map(kOf));
    }], ["Отмена", function () {}, true]]);
  }
  function doFix() {
    var list = sel();
    if (!list.length) return say("Не выбрано ни одного кошелька.");
    var m = say("Запишу итог дня в историю кабинета по " + list.length + " кошельк(ам).");
    act(m, [["Зафиксировать", function () {
      if (typeof fixNow === "function") fixNow(list.map(kOf));
    }], ["Отмена", function () {}, true]]);
  }

  /* ---------- 6. ответы по пульту ---------- */
  /* итоги по дням берём с сервера: это те же записи, что видит клиент в кабинете,
     включая разноску «Итог торгового дня» из админки по обеим площадкам */
  var HIST = null;
  function pullHist() {
    var list = accs().map(function (a) { return { site: a.site, acct: a.acct, key: apiKey(a) }; })
      .filter(function (x) { return x.key; });
    if (!list.length || typeof api !== "function") return Promise.resolve([]);
    return api("/api/hub/history", { method: "POST", body: JSON.stringify({ accounts: list, days: 60 }) })
      .then(function (j) { HIST = j.items || []; return HIST; })
      .catch(function () { return HIST || []; });
  }
  function ruDate(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
  }
  function dayOf(it, date) {
    var row = (it.days || []).filter(function (x) { return x.date === date; })[0];
    return row ? row.amount : null;
  }
  /* «вчера», «позавчера», «15.10» или «за 7 дней» */
  function dateFrom(t) {
    var m = t.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
    if (m) {
      var y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(new Date().getFullYear());
      return (m[1].length < 2 ? "0" : "") + m[1] + "." + (m[2].length < 2 ? "0" : "") + m[2] + "." + y;
    }
    var d = new Date(); d.setHours(0, 0, 0, 0);
    if (/позавчера/.test(t)) d.setDate(d.getDate() - 2);
    else if (/сегодня/.test(t)) { /* как есть */ }
    else d.setDate(d.getDate() - 1);
    return ruDate(d);
  }
  function doHistory(t) {
    var m = busy("Смотрю итоги в истории кабинетов");
    return pullHist().then(function (items) {
      if (!items.length) return fill(m, "История пустая — по этим кошелькам ещё нет записанных итогов дня.");
      var range = (t.match(/за\s*(\d+)\s*(дн|день|дня|дней)/) || [])[1];
      if (range) return fill(m, rangeHtml(items, Math.min(30, +range)));
      var date = dateFrom(t);
      var rows = items.map(function (it) { return { it: it, g: dayOf(it, date) }; });
      var have = rows.filter(function (r) { return r.g !== null; });
      if (!have.length) {
        var known = {};
        items.forEach(function (it) { (it.days || []).forEach(function (d) { known[d.date] = 1; }); });
        var list = Object.keys(known).slice(0, 6);
        return fill(m, "<b>За " + esc(date) + " записей нет.</b>" +
          (list.length ? "<br>Итоги есть за: " + list.map(esc).join(", ") +
            ". Назовите дату — покажу по ней." : ""));
      }
      var sum = have.reduce(function (s2, r) { return s2 + r.g; }, 0);
      var bySite = {};
      have.forEach(function (r) {
        var n = r.it.siteName || r.it.site;
        bySite[n] = (bySite[n] || 0) + r.g;
      });
      var down = have.filter(function (r) { return r.g < 0; }).sort(function (x, y) { return x.g - y.g; });
      var top = have.slice().sort(function (x, y) { return y.g - x.g; }).slice(0, 5);
      fill(m, "<b>Итог за " + esc(date) + ": " + sig(sum) + "</b> · кошельков с записью " +
        have.length + " из " + items.length +
        "<ul>" + Object.keys(bySite).map(function (n) {
          return "<li>" + esc(n) + " — " + sig(bySite[n]) + "</li>"; }).join("") + "</ul>" +
        "<table><tr><th>Кошелёк</th><th>Площадка</th><th>Итог</th></tr>" +
        top.map(function (r) {
          return "<tr><td>#" + esc(r.it.acct) + "</td><td>" + esc(r.it.siteName || r.it.site) +
            "</td><td>" + sig(r.g) + "</td></tr>"; }).join("") + "</table>" +
        (down.length
          ? "<br>Просадка у " + down.length + ": " + down.slice(0, 6).map(function (r) {
              return "#" + esc(r.it.acct) + " (" + sig(r.g) + ")"; }).join(", ")
          : "<br>Просадки за этот день нет."));
    });
  }
  function rangeHtml(items, n) {
    var byDay = {};
    items.forEach(function (it) {
      (it.days || []).forEach(function (d) { byDay[d.date] = (byDay[d.date] || 0) + d.amount; });
    });
    var days = Object.keys(byDay).sort(function (a, b) {
      var pa = a.split("."), pb = b.split(".");
      return (pb[2] + pb[1] + pb[0]) > (pa[2] + pa[1] + pa[0]) ? 1 : -1;
    }).slice(0, n);
    var sum = days.reduce(function (s2, d) { return s2 + byDay[d]; }, 0);
    return "<b>Итоги за последние " + days.length + " дн.: " + sig(sum) + "</b>" +
      "<table><tr><th>Дата</th><th>Итог</th></tr>" +
      days.map(function (d) {
        return "<tr><td>" + esc(d) + "</td><td>" + sig(byDay[d]) + "</td></tr>"; }).join("") + "</table>" +
      "<br>В расчёте и фиксация сессий, и разноска итогов дня из админки по обеим площадкам.";
  }

  function doBalances() {
    var list = accs();
    if (!list.length) return say("Кошельки не подключены.");
    var total = list.reduce(function (s, a) { return s + num(a.balance); }, 0);
    var byS = {};
    list.forEach(function (a) {
      var n = a.siteName || a.site; byS[n] = (byS[n] || 0) + num(a.balance);
    });
    say("<b>Суммарный капитал: " + money(total) + "</b><ul>" +
      Object.keys(byS).map(function (n) { return "<li>" + esc(n) + " — " + money(byS[n]) + "</li>"; }).join("") +
      "</ul>Кошельков: " + list.length + ", сессий в работе: " +
      list.filter(function (a) { return (typeof winOf === "function") && winOf(a); }).length + ".");
  }
  function doKeysInfo() {
    return pullState().then(function () {
      var list = accs();
      var on = list.filter(live), off = list.filter(function (a) { return !live(a); });
      var soon = on.map(function (a) {
        var s = stOf(a); return { a: a, left: s.left };
      }).filter(function (x) { return x.left !== null && x.left !== undefined; })
        .sort(function (x, y) { return x.left - y.left; });
      say("<b>Ключи: активны " + on.length + ", не активированы " + off.length + "</b>" +
        (soon.length ? "<br>Ближайшие к окончанию:<ul>" + soon.slice(0, 5).map(function (x) {
          return "<li>#" + esc(x.a.acct) + " — осталось " +
            (typeof fmtLeft === "function" ? fmtLeft(x.left) : Math.round(x.left / 86400000) + " д") + "</li>";
        }).join("") + "</ul>" : "") +
        (off.length ? "<br>Без ключа золотая пара закрыта: " + off.slice(0, 8).map(function (a) {
          return "#" + esc(a.acct); }).join(", ") + ". Пришлите коды — активирую." : ""));
    });
  }
  function doKycInfo() {
    return pullState().then(function () {
      var list = accs(), by = { approved: [], pending: [], none: [], rejected: [] };
      list.forEach(function (a) { (by[stOf(a).kyc || "none"] || by.none).push(a); });
      say("<b>Верификация</b><ul>" +
        "<li>Пройдена: " + by.approved.length + "</li>" +
        "<li>На проверке: " + by.pending.length + "</li>" +
        "<li>Не отправлена: " + (by.none.length + by.rejected.length) + "</li></ul>" +
        (by.none.length ? "Могу отправить заявки — скажите «отправь заявки на верификацию»." : ""));
    });
  }
  function doPayout() {
    var list = accs();
    var open = list.filter(function (a) { return (typeof outOk === "function") ? outOk(a) : false; });
    var closed = list.filter(function (a) { return open.indexOf(a) < 0; });
    say("<b>Вывод дохода: открыт у " + open.length + " из " + list.length + "</b>" +
      (closed.length ? "<ul>" + closed.slice(0, 8).map(function (a) {
        return "<li>#" + esc(a.acct) + " — " + esc(typeof outTxt === "function" ? outTxt(a) : "закрыт") + "</li>";
      }).join("") + "</ul>Порог суммы и привязанный кошелёк задаёт администратор площадки в карточке клиента."
        : "<br>Заявку можно создать кнопкой «Вывести средства» в карточке кошелька."));
  }
  function doMarket() {
    var open = (typeof mktOpen === "function") ? mktOpen() : true;
    say("<b>Биржа сейчас " + (open ? "открыта" : "закрыта") + ".</b> " +
      (open ? "Новые сессии запускаются." : "Пока торги стоят, новые сессии не запускаются — кнопка запуска вернёт предупреждение.") +
      " Расписание: будни круглосуточно с перерывом, выходные — закрыто.");
  }
  function doPairs() {
    var all = (typeof S !== "undefined" && S.pairs) ? Object.keys(S.pairs) : [];
    var g = pairsOf("gold"), c = pairsOf("crypto"), st = pairsOf("stock");
    say("<b>Инструменты пульта</b><ul>" +
      "<li>Золото: " + (g.join(", ") || "—") + " — только с активным ключом, коэффициент ×1,2…×2,5</li>" +
      "<li>Крипта: " + (c.join(", ") || "—") + " — коэффициент до ×10, доступна без ключа</li>" +
      "<li>Акции: " + (st.join(", ") || "—") + " — коэффициент ×1,2…×2,5, без ключа</li>" +
      (all.filter(function (p) { return ["gold", "crypto", "stock"].indexOf(kindOf(p)) < 0; }).length
        ? "<li>Остальное: " + all.filter(function (p) {
            return ["gold", "crypto", "stock"].indexOf(kindOf(p)) < 0; }).join(", ") + "</li>"
        : "") + "</ul>");
  }
  function doExplain(t) {
    /* «подключить» — это про привязку кошелька, а не про ключ бота */
    if (/подключ|привязать|добавить кошел|добавить аккаунт|безопасн|хранит|пароль/.test(t)) return null;
    if (/коэффициент|во сколько раз/.test(t)) {
      return say("<b>Коэффициент</b> — во сколько раз вырастет депозит к концу горизонта. " +
        "×1,6 за сутки значит: 1000 превратятся в 1600. Чем выше коэффициент, тем резче кривая, " +
        "больше сделок и глубже просадка внутри сессии. По крипте лестница доходит до ×10.");
    }
    if (/горизонт/.test(t)) {
      return say("<b>Горизонт</b> — за какое время сценарий должен прийти к цели: от часа до 20 дней. " +
        "Чем длиннее горизонт, тем плавнее кривая при том же коэффициенте.");
    }
    if (/доля|депозит/.test(t)) {
      return say("<b>Доля депозита в работе</b> — какая часть баланса участвует в сценарии. " +
        "Остальное лежит нетронутым и в просадке не участвует.");
    }
    if (/ключ/.test(t)) {
      return say("<b>Ключ бота</b> включает помощника для кошелька и открывает пару с золотом. " +
        "Код выдаёт администратор площадки, срок зашит в самом коде — в карточке виден отсчёт. " +
        "Крипта и акции работают и без ключа.");
    }
    if (/верифик|паспорт/.test(t)) {
      return say("<b>Верификация</b> — заявка с двумя снимками: страница паспорта и селфи с ним. " +
        "Отправить её можно отсюда, но отметку «пройдена» ставит администратор площадки.");
    }
    return null;
  }
  /* ---------- сценарий дня: что даст тот или иной коэффициент ---------- */
  function coefLadder(pair) {
    var base = [1.3, 1.5, 1.6, 1.9, 2.2, 2.5];
    return kindOf(pair) === "crypto" ? base.concat([4, 5, 7, 10]) : base;
  }
  function doScenario(t) {
    var list = sel();
    if (!list.length) return say("Сначала подключите кошельки — тогда посчитаю сценарий.");
    var bal = list.reduce(function (s2, a) { return s2 + num(a.balance); }, 0);
    var pair = (typeof S !== "undefined" && S.params && S.params.pair) || "XAU/USD";
    var share = (typeof S !== "undefined" && S.params && num(S.params.share)) || 0.6;
    var hours = (typeof S !== "undefined" && S.params && num(S.params.hours)) || 24;
    /* хотят конкретный процент за день — подбираем коэффициент под него */
    var want = (t.match(/([+-]?\d{1,3})\s*%/) || [])[1];
    var ladder = coefLadder(pair);
    if (want) {
      var need = 1 + Math.abs(+want) / 100 / Math.max(share, 0.1);
      var best = ladder.reduce(function (p1, k) {
        return Math.abs(k - need) < Math.abs(p1 - need) ? k : p1; }, ladder[0]);
      return say("<b>Чтобы получить около " + esc(want) + "% за " + hours + " ч</b> по " + esc(pair) +
        " при доле депозита " + Math.round(share * 100) + "% нужен коэффициент <b>×" +
        String(best).replace(".", ",") + "</b>." +
        "<br>На " + money(bal) + " это примерно " + sig(bal * (best - 1) * share) + " за сессию." +
        (kindOf(pair) !== "crypto" && need > 2.5
          ? " Выше ×2,5 по этой паре не ставится — возьмите криптопару, там лестница до ×10."
          : ""));
    }
    var rows = ladder.map(function (k) {
      var gain = bal * (k - 1) * share;
      var dd = k <= 1.4 ? 3 : (k <= 1.9 ? 7 : 14);
      return { k: k, gain: gain, dd: dd };
    });
    var m = say("<b>Сценарий на день: " + esc(pair) + ", " + hours + " ч, доля " +
      Math.round(share * 100) + "%</b> · в работе " + money(bal) + " по " + list.length + " кошельк(ам)" +
      "<table><tr><th>Коэф.</th><th>Итог сессии</th><th>Баланс после</th><th>Просадка до</th></tr>" +
      rows.map(function (r) {
        return "<tr><td>×" + String(r.k).replace(".", ",") + "</td><td>" + sig(r.gain) +
          "</td><td>" + money(bal + r.gain) + "</td><td>" + r.dd + "%</td></tr>"; }).join("") + "</table>" +
      "<br>Можно сказать «хочу +8% за день» — подберу коэффициент под цель.");
    act(m, [["Поставить ×1,6", function () {
      if (typeof S === "undefined") return;
      S.params.k = 1.6;
      if (typeof buildForm === "function") buildForm();
      if (typeof renderForecast === "function") renderForecast();
      say("Коэффициент ×1,6 проставлен в общий сценарий слева.");
    }], ["Разложить по аккаунтам", function () { doAdvice(); }, true]]);
  }

  /* ---------- свободные вопросы по пульту ---------- */
  /* короткая база знаний: ключевые слова → ответ. Ассистент отвечает ими,
     когда вопрос не сводится к действию, и всегда остаётся в рамках пульта. */
  var FAQ = [
    [/подключ.*кошел|добавить кошел|добавить аккаунт|как привязать/,
     "Кошелёк подключается ключом API из кабинета площадки: кнопка «Добавить кошелёк» вверху, " +
     "поле «Ключ API кошелька». Можно войти почтой и паролем кабинета — тогда подтянутся все кошельки сразу."],
    [/как.*вывест|заявка на вывод|вывод средств/,
     "Вывод — кнопка «Вывести средства» в карточке кошелька или «Вывести» в шапке. " +
     "Заявка уходит на площадку и попадает в историю операций кабинета. Площадка хранит только последние " +
     "четыре знака реквизитов."],
    [/почему.*вывод.*закрыт|вывод закрыт|минимальн.*вывод|порог/,
     "Вывод закрывается, когда баланс ниже минимальной суммы или кошельку не задан привязанный адрес. " +
     "И сумму, и адрес задаёт администратор площадки в карточке клиента — в пульте это поле «Вывод дохода»."],
    [/журнал|сделк|история сделок|лог/,
     "Журнал сделок — таблица под графиком: время, кошелёк, инструмент, объём и результат. " +
     "Строки рисуются по текущей сессии в рабочие часы биржи и подстраиваются под ваш часовой пояс."],
    [/сессия завершена|почему.*стоит|не запущен|сценарий не идёт/,
     "«Сессия завершена» значит, что горизонт вышел: кривая дошла до цели и баланс зафиксирован площадкой. " +
     "Чтобы пойти дальше, запустите сценарий заново — кнопка «Перезапустить» в карточке."],
    [/ключ не активирован|золот.*закрыт|почему.*золото/,
     "Пара с золотом открыта только кошелькам с активным ключом бота. Если ключа нет, сценарий по XAU/USD " +
     "не запустится — появится предупреждение. Крипта и акции работают без ключа. Коды выдаёт администратор, " +
     "пришлите их мне в чат — активирую."],
    [/смен.*пар|поменять инструмент|выбрать пару/,
     "Инструмент выбирается в «Общем сценарии» слева — он применится ко всем выбранным кошелькам. " +
     "В карточке есть своё поле «Инструмент сценария», оно перебивает общий выбор для этого кошелька."],
    [/в минус|убыточн|минус.*сценар/,
     "Направление «В минус — убыток» рисует падающую кривую: баланс идёт не вверх, а вниз в то же число раз. " +
     "Это для демонстрации неудачной сессии, деньги при этом никуда не уходят."],
    [/фиксац|итог дня|21:00|автофикс/,
     "Фиксация записывает итог дня в историю кабинета: по будням в 21:00 по Китаю, если галочка в карточке стоит. " +
     "Руками — кнопка «Зафиксировать день». Разноска «Итог торгового дня» из админки попадает в ту же историю."],
    [/telegram|телеграм|уведомл|колокол/,
     "Отчёт за сутки уходит в Telegram вместе с фиксацией итога; кнопка под фиксацией отправляет его вручную. " +
     "Для этого на площадке должны быть заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID. " +
     "Колокольчик в шапке — уведомления кабинета."],
    [/обновля|как часто|реальном времени/,
     "Пульт опрашивает площадки раз в несколько секунд: баланс, прогресс сессии и состояние ключей приходят оттуда, " +
     "а кривая между запросами дорисовывается на странице."],
    [/демо|учебн|настоящ|реальн.*деньги|это по-настоящему/,
     "Это учебный стенд: площадки, кошельки и сделки вымышлены, ордеров на бирже и переводов денег нет. " +
     "Все цифры считает сам стенд."],
    [/сколько кошельк|сколько аккаунт|сколько подключ/, null],
    [/безопасн|пароль|ключ api|хранит/,
     "Пароль кабинета страница не сохраняет — после входа остаётся только ключ API кошелька, он лежит в браузере. " +
     "Ключ администратора я не знаю и не храню: его вы вводите сами в форме создания кабинетов."]
  ];
  function doFaq(t) {
    for (var i = 0; i < FAQ.length; i++) {
      if (FAQ[i][0].test(t)) {
        if (!FAQ[i][1]) { doBalances(); return true; }
        return say(FAQ[i][1]);
      }
    }
    return null;
  }
  /* если вопрос совсем незнакомый — отвечаем сводкой состояния и подсказкой */
  function doFallback() {
    var list = accs(), on = list.filter(live).length;
    var run = list.filter(function (a) { return (typeof winOf === "function") && winOf(a); }).length;
    var total = list.reduce(function (s2, a) { return s2 + num(a.balance); }, 0);
    say("Отвечаю в рамках пульта — вот как сейчас обстоят дела: кошельков " + list.length +
      ", капитал " + money(total) + ", сессий в работе " + run + ", ключ активен у " + on + "." +
      "<br>Спросите про итоги за дату, ключи, верификацию, вывод, пары и коэффициенты, " +
      "журнал сделок или фиксацию итога дня — или скажите, что сделать: " +
      "«разложи по стратегиям», «запусти», «останови», «какой сценарий даст +8% за день».");
  }

  function doHelp() {
    say("Я помощник внутри пульта и работаю вашими правами — в админку не хожу. Умею так:<ul>" +
      "<li>«Посоветуй стратегию на день» — разложу кошельки по парам и проставлю в карточки</li>" +
      "<li>«Активируй ключи» — пришлите коды в чат, включу ими бота</li>" +
      "<li>«Отправь заявки на верификацию» — соберу заявки из ваших снимков</li>" +
      "<li>«Подготовь 10 кабинетов» — заполню форму создания, ключ администратора вводите вы</li>" +
      "<li>«Запусти / останови / зафиксируй» — по выбранным кошелькам</li>" +
      "<li>«Сколько заработали вчера», «какой баланс», «что с ключами», «что с верификацией», " +
      "«можно ли выводить», «биржа открыта?», «какие пары есть»</li>" +
      "<li>«Что такое коэффициент / горизонт / доля депозита»</li></ul>");
  }

  /* ---------- разбор команды ---------- */
  function handle(text) {
    var raw = String(text || "").trim();
    if (!raw) return;
    say(esc(raw), "me");
    var t = raw.toLowerCase();

    if (WAIT === "codes") { WAIT = null; return useCodes(raw); }
    if (/[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/.test(raw.toUpperCase())) return useCodes(raw);

    /* вопрос «что значит / как / почему / когда» — сначала объяснение, а не действие */
    var asks = /^(что|как|почему|зачем|когда|где|какой|какая|сколько|можно ли|а если|это )/.test(t) ||
      /\?$/.test(raw);
    if (asks) {
      var e0 = doExplain(t); if (e0) return e0;
      var f0 = doFaq(t); if (f0) return f0;
    }

    var n = (t.match(/(\d+)\s*(аккаунт|кабинет|кошель)/) || [])[1];
    if (/(регистр|заведи|создай|подготов)/.test(t) && n) return doSignup(Math.max(1, Math.min(50, +n)));
    if (/(активируй|активировать|включи|выдай|продли)/.test(t) && /ключ/.test(t)) return askCodes();
    if (/(отправ|подай|подать|собери)/.test(t) && /(верифик|паспорт|kyc|заявк)/.test(t)) return doKyc();
    if (/^(запусти|старт|включи сцена)/.test(t) || /запусти (сцена|по|сесс)/.test(t)) return doRun();
    if (/(останов|стоп|заверши)/.test(t)) return doStop();
    if (/(план на сегодня|применить план|расписани)/.test(t)) { applyToday(true); return; }
    if (/(зафиксир|фиксац)/.test(t) && !/когда|как|во сколько/.test(t)) return doFix();
    if (/(сценари|что даст|какой результат|прогноз)/.test(t) || /\d+\s*%/.test(t)) return doScenario(t);
    if (/(стратег|совет|что поставить|разложи|предлож|рекоменд)/.test(t)) return doAdvice();
    if (/(telegram|телеграм)/.test(t)) return doFaq("telegram") || doHelp();
    if (/(заработал|вчера|позавчера|сводк|просадк|отч[её]т по дням|итог за|за \d{1,2}[.\/]\d{1,2}|за \d+\s*дн)/.test(t)
        || (/итог/.test(t) && !/итог дня|фиксац/.test(t))) return doHistory(t);
    if (/(баланс|капитал|сколько денег|всего на счет)/.test(t)) return doBalances();
    if (/(срок|истека)/.test(t) || /ключи\b/.test(t) || /что с ключ/.test(t)) return doKeysInfo();
    if (/(верифик|паспорт|kyc)/.test(t)) return doKycInfo();
    if (/(вывод|вывест|выплат)/.test(t)) return doPayout();
    if (/(биржа|рынок|торги)/.test(t)) return doMarket();
    if (/(пар[аы]\b|инструмент|золот|крипт|акци)/.test(t) && !/стратег/.test(t)) return doPairs();
    if (/(что умеешь|что можешь|помощь|команды|help)/.test(t)) return doHelp();

    var ex = doExplain(t); if (ex) return ex;
    var f = doFaq(t); if (f) return f;
    return doFallback();
  }

  /* ---------- панель ---------- */
  var CHIPS = [
    ["Стратегия на день", "Посоветуй стратегию на день"],
    ["Активировать ключи", "Активируй ключи тем, у кого нет"],
    ["Заявки на верификацию", "Отправь заявки на верификацию"],
    ["Итог вчера", "Сколько заработали вчера и у кого просадка?"],
    ["Что с ключами", "Что с ключами и сроками?"],
    ["Можно ли выводить", "Можно ли выводить средства?"],
    ["Запустить сессии", "Запусти по выбранным кошелькам"],
    ["Остановить сессии", "Останови сессии по выбранным"],
    ["Что умеешь", "Что умеешь?"]
  ];
  function dock() {
    if ($("aiDock")) return;
    var d = document.createElement("aside");
    d.id = "aiDock";
    d.innerHTML =
      '<div id="aiHead"><span id="aiDot"></span><span style="flex:1"><b>Помощник пульта</b>' +
      "<small>подскажет и сделает в рамках вашего доступа</small></span>" +
      '<span id="aiMin" style="color:var(--muted);font-size:17px">–</span></div>' +
      '<div id="aiBody"></div>' +
      '<div class="ai-chips">' + CHIPS.map(function (c, i) {
        return '<button data-c="' + i + '">' + esc(c[0]) + "</button>";
      }).join("") + "</div>" +
      '<div id="aiFoot"><input id="aiText" placeholder="Спросите или поставьте задачу…" autocomplete="off">' +
      '<button id="aiGo">↑</button></div>';
    document.body.appendChild(d);
    say("Привет. Я помощник внутри пульта: подскажу по кошелькам, ключам, парам и выводу, " +
      "разложу аккаунты по стратегиям и запущу сессии. Права у меня ваши — в админку площадки я не хожу, " +
      "поэтому коды активации и ключ администратора присылаете вы.");
    $("aiHead").onclick = function (e) {
      if (e.target && e.target.id === "aiMin") { d.classList.toggle("min"); return; }
      if (d.classList.contains("min")) d.classList.remove("min");
    };
    d.querySelectorAll("[data-c]").forEach(function (b) {
      b.onclick = function () { handle(CHIPS[+b.dataset.c][1]); };
    });
    $("aiGo").onclick = function () { var v = $("aiText").value; $("aiText").value = ""; handle(v); };
    $("aiText").onkeydown = function (e) { if (e.key === "Enter") $("aiGo").click(); };
    pullState();
  }

  /* ---------- фильтр кошельков по ключу ---------- */
  var FLT = "all";
  function applyFilter() {
    var box = $("accs"); if (!box) return;
    box.querySelectorAll(".acc[data-k]").forEach(function (el) {
      var a = accs().filter(function (x) { return kOf(x) === el.dataset.k; })[0];
      var show = FLT === "all" || (FLT === "on" ? live(a) : !live(a));
      el.style.display = show ? "" : "none";
    });
    var cnt = $("aiFltCnt");
    if (cnt) {
      var on = accs().filter(live).length;
      cnt.textContent = "ключ активирован — " + on + " · не активирован — " + (accs().length - on);
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
      '<span id="aiFltCnt" class="note" style="margin:0 0 0 4px"></span>';
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

  /* ================= панели пульта: советник, расписание, риск, сравнение, команды =========
     Всё считается по данным самого хаба: балансы и сессии из S.accounts, итоги дней —
     из истории кабинетов, состояние ключей и верификации — из /api/hub/bot/state.
     Настройки (лимиты риска, расписание недели) лежат в браузере пользователя. ===== */
  var LSK = "vx_hub_assistant";
  var CFG = (function () {
    var d = { risk: { on: true, day: 5, dd: 7, big: 5000 }, week: {}, auto: { on: false, hour: 9 }, log: [] };
    try {
      var raw = JSON.parse(localStorage.getItem(LSK) || "null");
      if (raw && typeof raw === "object") {
        d.risk = Object.assign(d.risk, raw.risk || {});
        d.week = raw.week || {};
        d.auto = Object.assign(d.auto, raw.auto || {});
        d.log = Array.isArray(raw.log) ? raw.log.slice(0, 20) : [];
      }
    } catch (e) {}
    return d;
  })();
  function saveCfg() { try { localStorage.setItem(LSK, JSON.stringify(CFG)); } catch (e) {} }
  function logEvent(text, tone) {
    CFG.log.unshift({ at: Date.now(), text: text, tone: tone || "info" });
    CFG.log = CFG.log.slice(0, 20); saveCfg();
  }
  function hhmm(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  function todayIdx() { var d = new Date().getDay(); return d === 0 ? 6 : d - 1; }

  /* ---------- общие метрики портфеля ---------- */
  function metrics() {
    var list = accs();
    var total = list.reduce(function (s2, a) { return s2 + num(a.balance); }, 0);
    var run = list.filter(function (a) { return (typeof winOf === "function") && winOf(a); });
    var keys = list.filter(live).length;
    var kyc = list.filter(function (a) { return stOf(a).kyc === "approved"; }).length;
    var out = list.filter(function (a) { return (typeof outOk === "function") && outOk(a); }).length;
    var ks = list.map(function (a) {
      var p2 = (typeof paramsFor === "function") ? paramsFor(a) : (S && S.params) || {};
      return num(p2.k) || 1.3;
    });
    var avgK = ks.length ? ks.reduce(function (s2, x) { return s2 + x; }, 0) / ks.length : 1.3;
    var maxShare = total ? Math.max.apply(null, list.map(function (a) { return num(a.balance) / total; }).concat([0])) : 0;
    var day = list.reduce(function (s2, a) { return s2 + ((typeof todayOf === "function") ? todayOf(a) : 0); }, 0);
    return { list: list, total: total, run: run, keys: keys, kyc: kyc, out: out,
             avgK: avgK, maxShare: maxShare, day: day };
  }
  /* индекс устойчивости: 100 — ровный портфель с ключами, лимитами и спокойными коэффициентами */
  function health(m) {
    var n = m.list.length || 1;
    var v = 50;
    v += 15 * (m.keys / n);
    v += 10 * (m.kyc / n);
    v += CFG.risk.on ? 10 : 0;
    v -= 18 * Math.max(0, Math.min(1, (m.avgK - 1.2) / 1.6));
    v -= 12 * Math.max(0, Math.min(1, (m.maxShare - 0.3) / 0.5));
    if (m.total > 0 && m.day < 0) v -= 8 * Math.min(1, Math.abs(m.day) / (m.total * 0.03));
    return Math.max(5, Math.min(98, Math.round(v)));
  }
  /* приоритетные шаги советника — каждый со своей кнопкой */
  function advSteps(m) {
    var out = [], hot = m.list.filter(function (a) {
      var p2 = (typeof paramsFor === "function") ? paramsFor(a) : {};
      return (num(p2.k) || 0) >= 2 && kindOf(p2.pair) !== "crypto";
    });
    if (hot.length) {
      out.push(["Снизить коэффициент до ×1,6 на " + hot.length + " кошельк(ах) — минус примерно треть риска",
        function () {
          hot.forEach(function (a) {
            var p2 = Object.assign({ pair: "XAU/USD", hours: 24, share: 0.6, dir: "up" },
              (typeof paramsFor === "function") ? paramsFor(a) : {}, { k: 1.6 });
            S.per[kOf(a)] = p2;
          });
          if (typeof renderAll === "function") renderAll();
          logEvent("Коэффициент снижен до ×1,6 на " + hot.length + " кошельках", "ok");
          renderPanels(); say("Коэффициент ×1,6 проставлен на " + hot.length + " кошельках.");
        }]);
    }
    if (m.keys < m.list.length) {
      out.push(["Активировать ключи на " + (m.list.length - m.keys) + " кошельк(ах) — откроется пара с золотом",
        function () { askCodes(); }]);
    }
    if (m.kyc < m.list.length) {
      out.push(["Отправить заявки на верификацию по " + (m.list.length - m.kyc) + " кошельк(ам)",
        function () { doKyc(); }]);
    }
    if (!CFG.risk.on) {
      out.push(["Включить контроль рисков: стоп-лосс −" + CFG.risk.day + "% в день",
        function () { CFG.risk.on = true; saveCfg(); logEvent("Контроль рисков включён", "ok"); renderPanels(); }]);
    }
    if (m.maxShare > 0.35) {
      out.push(["Разложить сценарии по разным парам — сейчас " + Math.round(m.maxShare * 100) +
        "% капитала в одном кошельке", function () { doAdvice(); }]);
    }
    if (m.out < m.list.length) {
      out.push(["Вывод закрыт у " + (m.list.length - m.out) + " кошельк(ов): порог суммы и адрес задаёт администратор",
        function () { doPayout(); }]);
    }
    if (!out.length) {
      out.push(["Портфель в порядке: ключи активны, лимиты стоят, коэффициенты спокойные",
        function () { doScenario(""); }]);
    }
    return out.slice(0, 4);
  }

  /* ---------- 1. карточка «Финансовый советник» ---------- */
  function advCard() {
    var m = metrics(), h = health(m);
    var tone = h >= 70 ? "#2BA87A" : (h >= 45 ? "#E2B23A" : "#E5484D");
    var steps = advSteps(m);
    var html =
      '<div class="panel-head"><h3>Финансовый советник</h3>' +
      '<span class="muted">индекс устойчивости портфеля · ' + h + ' из 100</span></div>' +
      '<div class="ai-adv">' +
      '<svg width="92" height="92" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" ' +
      'stroke="rgba(255,255,255,.1)" stroke-width="12"/><circle cx="50" cy="50" r="40" fill="none" stroke="' + tone +
      '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (h / 100 * 251).toFixed(0) +
      ' 251" transform="rotate(-90 50 50)"/><text x="50" y="57" text-anchor="middle" font-size="25" ' +
      'fill="currentColor" font-weight="700">' + h + "</text></svg>" +
      '<div style="flex:1;min-width:0"><div class="ai-kv">' +
      "<span>Капитал</span><b>" + money(m.total) + "</b>" +
      "<span>Сессий в работе</span><b>" + m.run.length + " из " + m.list.length + "</b>" +
      "<span>Ключи активны</span><b>" + m.keys + " из " + m.list.length + "</b>" +
      "<span>Средний коэффициент</span><b>×" + m.avgK.toFixed(2).replace(".", ",") + "</b>" +
      "<span>Итог за сегодня</span><b class='" + (m.day >= 0 ? "up" : "down") + "'>" + sig(m.day) + "</b>" +
      "</div><ol class='ai-steps'>" +
      steps.map(function (st, i) {
        return "<li>" + esc(st[0]) + ' <button class="btn btn-sm" data-adv="' + i + '">сделать</button></li>';
      }).join("") + "</ol></div></div>";
    return { html: html, wire: function (box) {
      box.querySelectorAll("[data-adv]").forEach(function (b) {
        b.onclick = function () { steps[+b.dataset.adv][1](); };
      });
    } };
  }

  /* ---------- 2. расписание сценариев на неделю ---------- */
  function weekPlanSuggest() {
    var m = metrics();
    var gold = pairsOf("gold")[0] || "XAU/USD";
    var crypto = pairsOf("crypto"); if (!crypto.length) crypto = ["BTC/USD"];
    var stock = pairsOf("stock"); if (!stock.length) stock = crypto;
    var mix = [
      { pair: m.keys ? gold : crypto[0], k: 1.6 },
      { pair: crypto[0], k: 2.2 },
      { pair: stock[0], k: 1.5 },
      { pair: crypto[1] || crypto[0], k: 2.5 },
      { pair: m.keys ? gold : stock[0], k: 1.6 }
    ];
    CFG.week = {};
    mix.forEach(function (x, i) { CFG.week[i] = x; });
    saveCfg();
    logEvent("Помощник расписал сценарии на неделю", "ok");
  }
  function weekCard() {
    var m = metrics();
    var all = (typeof S !== "undefined" && S.pairs) ? Object.keys(S.pairs) : [];
    var sum = 0;
    for (var i = 0; i < 5; i++) {
      var w = CFG.week[i];
      if (w) sum += m.total * (num(w.k) - 1) * 0.6 / 5;
    }
    var cells = DAYS.map(function (d, i) {
      if (i > 4) return '<div class="ai-day off"><small>' + d + "</small><b>—</b><span>биржа закрыта</span></div>";
      var w = CFG.week[i] || {};
      return '<div class="ai-day' + (i === todayIdx() ? " now" : "") + '"><small>' + d + "</small>" +
        '<select data-wp="' + i + '">' + ['<option value="">— не задан</option>'].concat(all.map(function (p2) {
          return '<option value="' + p2 + '"' + (w.pair === p2 ? " selected" : "") + ">" + p2 + "</option>";
        })).join("") + "</select>" +
        '<select data-wk="' + i + '">' + ((typeof coefsFor === "function" ? coefsFor(w.pair) : [1.3, 1.6, 2, 2.5])
          .map(function (k) {
            return '<option value="' + k + '"' + (num(w.k) === k ? " selected" : "") + ">×" +
              String(k).replace(".", ",") + "</option>";
          }).join("")) + "</select></div>";
    }).join("");
    var html =
      '<div class="panel-head"><h3>Расписание сценариев на неделю</h3>' +
      '<span class="muted">' + (CFG.auto.on ? "автозапуск в " + CFG.auto.hour + ":00" : "автозапуск выключен") +
      "</span></div>" +
      '<div class="ai-week">' + cells + "</div>" +
      '<p class="note" style="margin-top:10px">Если план на день задан, помощник ставит его выбранным кошелькам. ' +
      "Ожидаемый итог недели по плану: <b>" + sig(sum * 5) + "</b> к " + money(m.total) + ".</p>" +
      '<div class="ai-row">' +
      '<button class="btn btn-sm btn-primary" id="aiWeekFill">Подобрать план</button>' +
      '<button class="btn btn-sm" id="aiWeekToday">Применить план на сегодня</button>' +
      '<label class="ai-chk"><input type="checkbox" id="aiAuto"' + (CFG.auto.on ? " checked" : "") +
      "><span>Автозапуск каждый торговый день в</span></label>" +
      '<input class="num ai-hour" id="aiHour" type="number" min="0" max="23" value="' + CFG.auto.hour + '">' +
      "</div>";
    return { html: html, wire: function (box) {
      box.querySelectorAll("[data-wp]").forEach(function (sl) {
        sl.onchange = function () {
          var i = sl.dataset.wp;
          CFG.week[i] = Object.assign({ k: 1.6 }, CFG.week[i] || {}, { pair: sl.value });
          if (!sl.value) delete CFG.week[i];
          saveCfg(); renderPanels();
        };
      });
      box.querySelectorAll("[data-wk]").forEach(function (sl) {
        sl.onchange = function () {
          var i = sl.dataset.wk;
          CFG.week[i] = Object.assign({ pair: (CFG.week[i] || {}).pair || "XAU/USD" }, CFG.week[i] || {},
            { k: num(sl.value) });
          saveCfg(); renderPanels();
        };
      });
      var f = box.querySelector("#aiWeekFill");
      if (f) f.onclick = function () { weekPlanSuggest(); renderPanels(); say("План на неделю готов — смотрите блок расписания."); };
      var t = box.querySelector("#aiWeekToday");
      if (t) t.onclick = function () { applyToday(true); };
      var a = box.querySelector("#aiAuto");
      if (a) a.onchange = function () {
        CFG.auto.on = a.checked; saveCfg();
        logEvent(a.checked ? "Автозапуск расписания включён" : "Автозапуск расписания выключен", "info");
        renderPanels();
      };
      var h = box.querySelector("#aiHour");
      if (h) h.onchange = function () { CFG.auto.hour = Math.max(0, Math.min(23, parseInt(h.value, 10) || 9)); saveCfg(); renderPanels(); };
    } };
  }
  /* применяем план сегодняшнего дня к выбранным кошелькам */
  function applyToday(manual) {
    var w = CFG.week[todayIdx()];
    if (!w || !w.pair) { if (manual) say("На сегодня план не задан — нажмите «Подобрать план» или выберите пару в расписании."); return; }
    var list = sel();
    if (!list.length) { if (manual) say("Нет выбранных кошельков."); return; }
    var bad = list.filter(function (a) { return (typeof goldBlocked === "function") && goldBlocked(a, w.pair); });
    list.forEach(function (a) {
      if (bad.indexOf(a) >= 0) return;
      S.per[kOf(a)] = { pair: w.pair, hours: 24, k: num(w.k) || 1.6, share: 0.6, dir: "up" };
    });
    if (typeof renderAll === "function") renderAll();
    logEvent("План дня применён: " + w.pair + " ×" + String(w.k).replace(".", ","), "ok");
    var m = say("<b>План на сегодня проставлен:</b> " + esc(w.pair) + " ×" + String(w.k).replace(".", ",") +
      " по " + (list.length - bad.length) + " кошельк(ам)." +
      (bad.length ? "<br>Пропущено без ключа: " + bad.length + "." : ""));
    act(m, [["Запустить сейчас", function () {
      if (typeof runKeys === "function") runKeys(list.filter(function (a) { return bad.indexOf(a) < 0; }).map(kOf));
    }], ["Позже", function () {}, true]]);
  }
  /* автозапуск: раз в минуту смотрим, не пора ли поставить сегодняшний план */
  var AUTO_DONE = "";
  function autoTick() {
    if (!CFG.auto.on) return;
    var now = new Date(), stamp = now.toDateString();
    if (AUTO_DONE === stamp) return;
    if (todayIdx() > 4) return;
    if (now.getHours() < CFG.auto.hour) return;
    if (typeof mktOpen === "function" && !mktOpen()) return;
    var w = CFG.week[todayIdx()];
    if (!w || !w.pair) return;
    var list = sel().filter(function (a) { return !(typeof winOf === "function" && winOf(a)); })
      .filter(function (a) { return !(typeof goldBlocked === "function" && goldBlocked(a, w.pair)); });
    if (!list.length) return;
    AUTO_DONE = stamp;
    list.forEach(function (a) { S.per[kOf(a)] = { pair: w.pair, hours: 24, k: num(w.k) || 1.6, share: 0.6, dir: "up" }; });
    if (typeof runKeys === "function") runKeys(list.map(kOf));
    logEvent("Автозапуск: " + w.pair + " ×" + String(w.k).replace(".", ",") + " на " + list.length + " кошельках", "ok");
    say("<b>Автозапуск сработал.</b> Поставил план дня — " + esc(w.pair) + " ×" +
      String(w.k).replace(".", ",") + " на " + list.length + " кошельк(ах).");
    renderPanels();
  }

  /* ---------- 3. контроль рисков в реальном времени ---------- */
  var PEAK = {};
  function riskTick() {
    if (!CFG.risk.on) return;
    var m = metrics();
    /* просадка по кошельку: считаем от максимума, который видели за сессию */
    m.run.forEach(function (a) {
      var k = kOf(a), cur = (typeof valOf === "function") ? valOf(a) : num(a.balance);
      PEAK[k] = Math.max(PEAK[k] || cur, cur);
      var dd = PEAK[k] > 0 ? (PEAK[k] - cur) / PEAK[k] * 100 : 0;
      if (dd >= num(CFG.risk.dd)) {
        if (typeof stopKeys === "function") stopKeys([k]);
        delete PEAK[k];
        logEvent("Просадка " + dd.toFixed(1) + "% на #" + a.acct + " — сценарий остановлен", "warn");
        say("<b>Сработал лимит просадки.</b> #" + esc(a.acct) + " ушёл на " + dd.toFixed(1) +
          "% от максимума — сценарий остановлен, баланс зафиксирован.");
        renderPanels();
      }
    });
    /* дневной стоп-лосс по всему портфелю */
    if (m.total > 0 && m.day < 0 && Math.abs(m.day) / m.total * 100 >= num(CFG.risk.day)) {
      var running = m.run.map(kOf);
      if (running.length) {
        if (typeof stopKeys === "function") stopKeys(running);
        logEvent("Дневной стоп-лосс −" + CFG.risk.day + "%: остановлено сессий " + running.length, "warn");
        say("<b>Дневной стоп-лосс.</b> Портфель ушёл ниже −" + CFG.risk.day +
          "% — остановил все сессии и зафиксировал балансы.");
        renderPanels();
      }
    }
  }
  function riskCard() {
    var m = metrics();
    var worst = m.run.map(function (a) {
      var k = kOf(a), cur = (typeof valOf === "function") ? valOf(a) : num(a.balance);
      var pk = PEAK[k] || cur;
      return { a: a, dd: pk > 0 ? (pk - cur) / pk * 100 : 0 };
    }).sort(function (x, y) { return y.dd - x.dd; })[0];
    var html =
      '<div class="panel-head"><h3>Контроль рисков в реальном времени</h3>' +
      '<span class="muted">' + (CFG.risk.on ? "следит за каждой сессией" : "выключен") + "</span></div>" +
      '<div class="ai-row">' +
      '<label class="ai-chk"><input type="checkbox" id="aiRiskOn"' + (CFG.risk.on ? " checked" : "") +
      "><span>Контроль включён</span></label>" +
      '<label class="ai-f"><span>Стоп-лосс за день, %</span><input class="num" id="aiRiskDay" type="number" min="1" max="50" value="' + CFG.risk.day + '"></label>' +
      '<label class="ai-f"><span>Просадка по кошельку, %</span><input class="num" id="aiRiskDd" type="number" min="1" max="50" value="' + CFG.risk.dd + '"></label>' +
      '<label class="ai-f"><span>Подтверждать вывод от, $</span><input class="num" id="aiRiskBig" type="number" min="0" step="100" value="' + CFG.risk.big + '"></label>' +
      "</div>" +
      '<div class="ai-kv" style="margin-top:12px">' +
      "<span>Итог за сегодня</span><b class='" + (m.day >= 0 ? "up" : "down") + "'>" + sig(m.day) +
      " (" + (m.total ? (m.day / m.total * 100).toFixed(2) : "0.00") + "%)</b>" +
      "<span>Худшая просадка сейчас</span><b>" + (worst ? "#" + esc(worst.a.acct) + " · " + worst.dd.toFixed(1) + "%" : "—") + "</b>" +
      "<span>Под наблюдением</span><b>" + m.run.length + " сессий</b></div>" +
      (CFG.log.length ? '<ul class="ai-log">' + CFG.log.slice(0, 6).map(function (e) {
        return '<li class="' + esc(e.tone) + '"><span>' + hhmm(e.at) + "</span>" + esc(e.text) + "</li>";
      }).join("") + "</ul>" : '<p class="note" style="margin-top:10px">Событий пока нет — лимиты стоят, сессии в норме.</p>');
    return { html: html, wire: function (box) {
      var on = box.querySelector("#aiRiskOn");
      if (on) on.onchange = function () { CFG.risk.on = on.checked; saveCfg(); renderPanels(); };
      [["aiRiskDay", "day"], ["aiRiskDd", "dd"], ["aiRiskBig", "big"]].forEach(function (x) {
        var el = box.querySelector("#" + x[0]);
        if (el) el.onchange = function () { CFG.risk[x[1]] = Math.max(0, num(el.value)); saveCfg(); renderPanels(); };
      });
    } };
  }

  /* ---------- 4. сравнение стратегий ---------- */
  var STRATS = [
    { name: "Консервативная", k: 1.3, dd: 3, note: "ровная кривая, клиенты спокойны" },
    { name: "Умеренная", k: 1.6, dd: 7, note: "лучший баланс дохода и риска" },
    { name: "Агрессивная", k: 2.3, dd: 14, note: "высокий доход, заметная просадка" }
  ];
  function cmpCard() {
    var m = metrics();
    var pair = (typeof S !== "undefined" && S.params && S.params.pair) || "XAU/USD";
    var rows = STRATS.slice();
    if (kindOf(pair) === "crypto") {
      rows = rows.concat([{ name: "Крипто-турбо", k: 4.5, dd: 22, note: "только крипта, лестница до ×10" }]);
    }
    var best = "Умеренная";
    var html =
      '<div class="panel-head"><h3>Сравнение стратегий · ' + esc(pair) + "</h3>" +
      '<span class="muted">расчёт по вашему капиталу ' + money(m.total) + "</span></div>" +
      '<table class="ai-table"><tr><th>Стратегия</th><th>Коэф.</th><th>За сутки</th><th>За 30 дней</th>' +
      "<th>Макс. просадка</th><th>Вывод</th></tr>" +
      rows.map(function (r) {
        var day = m.total * (r.k - 1) * 0.6;
        return "<tr" + (r.name === best ? ' class="best"' : "") + "><td>" + esc(r.name) + "</td><td>×" +
          String(r.k).replace(".", ",") + "</td><td>" + sig(day) + "</td><td>" + sig(day * 22) +
          "</td><td>" + r.dd + "%</td><td>" + esc(r.note) + "</td></tr>";
      }).join("") + "</table>" +
      '<div class="ai-row" style="margin-top:12px">' +
      rows.map(function (r, i) {
        return '<button class="btn btn-sm' + (r.name === best ? " btn-primary" : "") + '" data-st="' + i + '">Поставить ' +
          esc(r.name.toLowerCase()) + "</button>";
      }).join("") +
      '<button class="btn btn-sm" id="aiCmpMix">Разложить по аккаунтам</button></div>' +
      '<p class="note" style="margin-top:9px">За 30 дней показан итог, если повторять сценарий каждый торговый день ' +
      "(22 дня). Просадка — ожидаемый провал внутри сессии при этом коэффициенте.</p>";
    return { html: html, wire: function (box) {
      box.querySelectorAll("[data-st]").forEach(function (b) {
        b.onclick = function () {
          var r = rows[+b.dataset.st];
          var list = sel();
          list.forEach(function (a) {
            if (typeof goldBlocked === "function" && goldBlocked(a, pair)) return;
            S.per[kOf(a)] = { pair: pair, hours: 24, k: r.k, share: 0.6, dir: "up" };
          });
          if (typeof S !== "undefined" && S.params) {
            S.params.k = r.k;
            if (typeof buildForm === "function") buildForm();
            if (typeof renderForecast === "function") renderForecast();
          }
          if (typeof renderAll === "function") renderAll();
          logEvent("Стратегия «" + r.name + "» (×" + r.k + ") проставлена на " + list.length + " кошельках", "ok");
          say("Стратегия «" + esc(r.name) + "» ×" + String(r.k).replace(".", ",") + " проставлена по " +
            list.length + " кошельк(ам).");
          renderPanels();
        };
      });
      var mix = box.querySelector("#aiCmpMix");
      if (mix) mix.onclick = function () { doAdvice(); };
    } };
  }

  /* ---------- 5. командная строка помощника ---------- */
  var CMDS = [
    ["разложи по стратегиям", "Разложи аккаунты по стратегиям"],
    ["план на сегодня", "Применить план на сегодня"],
    ["итог вчера", "Сколько заработали вчера и у кого просадка?"],
    ["отчёт за 7 дней", "Покажи отчёт за 7 дней"],
    ["что даст сценарий", "Что даст сценарий на день?"],
    ["хочу +8% за день", "Хочу +8% за день"],
    ["активируй ключи", "Активируй ключи тем, у кого нет"],
    ["заявки на верификацию", "Отправь заявки на верификацию"],
    ["запусти сессии", "Запусти по выбранным кошелькам"],
    ["останови всё", "Останови сессии по выбранным"],
    ["зафиксируй день", "Зафиксируй итог дня"],
    ["что с ключами", "Что с ключами и сроками?"],
    ["можно ли выводить", "Можно ли выводить средства?"],
    ["какие пары есть", "Какие пары есть?"]
  ];
  function cmdCard() {
    var html =
      '<div class="panel-head"><h3>Командная строка помощника</h3>' +
      '<span class="muted">текстом, по обеим площадкам</span></div>' +
      '<div class="ai-cmds">' + CMDS.map(function (c, i) {
        return '<button data-cmd="' + i + '">' + esc(c[0]) + "</button>";
      }).join("") + "</div>" +
      '<div class="ai-row" style="margin-top:11px">' +
      '<input id="aiCmdLine" placeholder="или впишите свою задачу — например «поставь BTC/USD ×4,5 всем»">' +
      '<button class="btn btn-sm btn-primary" id="aiCmdGo">Выполнить</button></div>';
    return { html: html, wire: function (box) {
      box.querySelectorAll("[data-cmd]").forEach(function (b) {
        b.onclick = function () { openDock(); handle(CMDS[+b.dataset.cmd][1]); };
      });
      var go = box.querySelector("#aiCmdGo"), line = box.querySelector("#aiCmdLine");
      function run() { if (!line.value.trim()) return; openDock(); handle(line.value); line.value = ""; }
      if (go) go.onclick = run;
      if (line) line.onkeydown = function (e) { if (e.key === "Enter") run(); };
    } };
  }
  function openDock() {
    var d = $("aiDock");
    if (d) d.classList.remove("min");
  }

  /* ---------- сборка панелей ---------- */
  var PANEL_CSS =
    "#aiPanels{display:flex;flex-direction:column;gap:16px;margin-bottom:16px}" +
    ".ai-adv{display:flex;gap:18px;align-items:flex-start;color:var(--text)}" +
    ".ai-kv{display:grid;grid-template-columns:auto auto;gap:4px 14px;font-size:12.5px;color:var(--muted)}" +
    ".ai-kv b{color:var(--text);text-align:right}" +
    ".ai-steps{margin:12px 0 0;padding-left:18px;font-size:12.8px;line-height:1.6}" +
    ".ai-steps li{margin:4px 0}" +
    ".ai-steps button{margin-left:6px}" +
    ".ai-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:9px}" +
    ".ai-day{border:1px solid var(--line);border-radius:12px;padding:9px;background:var(--surface-2);" +
    "display:flex;flex-direction:column;gap:6px}" +
    ".ai-day.now{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}" +
    ".ai-day.off{opacity:.55;align-items:flex-start}" +
    ".ai-day small{font-size:11px;color:var(--muted)}" +
    ".ai-day b{font-size:15px}.ai-day span{font-size:10.5px;color:var(--muted)}" +
    ".ai-day select{width:100%;box-sizing:border-box;font:inherit;font-size:11.5px;padding:5px 6px;" +
    "border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--text)}" +
    ".ai-row{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-top:12px}" +
    ".ai-row input{font:inherit;font-size:12.5px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);" +
    "background:var(--surface-2);color:var(--text)}" +
    "#aiCmdLine{flex:1;min-width:220px}" +
    ".ai-chk{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted)}" +
    ".ai-f{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}" +
    ".ai-f input,.ai-hour{width:92px}" +
    ".ai-log{list-style:none;margin:12px 0 0;padding:0;font-size:12.3px}" +
    ".ai-log li{display:flex;gap:9px;padding:5px 0;border-top:1px solid var(--line);color:var(--text)}" +
    ".ai-log li span{color:var(--muted);flex:none;font-variant-numeric:tabular-nums}" +
    ".ai-log li.warn{color:#F3A2A2}.ai-log li.ok{color:#8FE3BE}" +
    ".ai-table{width:100%;border-collapse:collapse;font-size:12.5px}" +
    ".ai-table th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;padding:7px 8px;" +
    "border-bottom:1px solid var(--line)}" +
    ".ai-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,.05)}" +
    ".ai-table tr.best td{background:rgba(124,92,255,.12)}" +
    ".ai-cmds{display:flex;flex-wrap:wrap;gap:7px}" +
    ".ai-cmds button{font:inherit;font-size:11.8px;padding:7px 11px;border-radius:999px;cursor:pointer;" +
    "border:1px solid var(--line);background:var(--surface-2);color:var(--text)}" +
    ".ai-cmds button:hover{border-color:var(--accent)}";

  var PANELS = [
    ["aiAdv", advCard], ["aiWeek", weekCard], ["aiRisk", riskCard], ["aiCmp", cmpCard], ["aiCmd", cmdCard]
  ];
  function panelsHost() {
    var accsBox = $("accs");
    if (!accsBox) return null;
    var wallets = accsBox.closest(".panel");
    if (!wallets || !wallets.parentNode) return null;
    var host = $("aiPanels");
    if (!host) {
      host = document.createElement("div");
      host.id = "aiPanels";
      wallets.parentNode.insertBefore(host, wallets);
    }
    return host;
  }
  var BUSY_PANELS = false;
  function renderPanels() {
    if (BUSY_PANELS) return;
    var host = panelsHost();
    if (!host) return;
    BUSY_PANELS = true;
    try {
      PANELS.forEach(function (p2) {
        var box = $(p2[0]);
        if (!box) {
          box = document.createElement("div");
          box.className = "panel"; box.id = p2[0];
          host.appendChild(box);
        }
        /* пока пользователь что-то вводит в этой карточке, не перерисовываем её */
        if (box.contains(document.activeElement)) return;
        var made = p2[1]();
        box.innerHTML = made.html;
        if (made.wire) made.wire(box);
      });
    } finally { BUSY_PANELS = false; }
  }

  function boot() {
    if (!$("aiCss")) {
      var st = document.createElement("style"); st.id = "aiCss"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!$("aiPanelCss")) {
      var st2 = document.createElement("style"); st2.id = "aiPanelCss"; st2.textContent = PANEL_CSS;
      document.head.appendChild(st2);
    }
    var desk = $("desk");
    if (!desk || desk.classList.contains("hidden")) return;
    dock(); filterRow(); renderPanels();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 400); });
  else setTimeout(boot, 400);
  setInterval(boot, 1500);
  setInterval(function () { if ($("aiPanels")) renderPanels(); }, 6000);
  setInterval(function () { if ($("aiPanels")) { riskTick(); autoTick(); } }, 7000);
})();
