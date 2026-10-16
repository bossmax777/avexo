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
