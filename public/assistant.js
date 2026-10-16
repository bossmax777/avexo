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
    "#aiDock{position:fixed;right:18px;bottom:18px;width:min(680px,calc(100vw - 36px));z-index:9990;" +
    "display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;" +
    "background:var(--surface);box-shadow:0 26px 70px rgba(0,0,0,.5);overflow:hidden}" +
    "#aiDock.min{width:260px}" +
    "@media (max-width:760px){#aiDock{right:10px;left:10px;bottom:10px;width:auto}}" +
    "#aiHead{display:flex;align-items:center;gap:11px;padding:14px 16px;border-bottom:1px solid var(--line);" +
    "cursor:pointer;background:linear-gradient(180deg,rgba(124,92,255,.10),transparent)}" +
    "#aiHead b{font-size:14px;display:block}#aiHead small{font-size:11.5px;color:var(--muted)}" +
    "#aiDock.min #aiBody,#aiDock.min #aiFoot,#aiDock.min .ai-chips{display:none}" +
    "#aiBody{max-height:min(64vh,620px);overflow:auto;padding:15px 16px;display:flex;flex-direction:column;gap:10px;" +
    "scrollbar-width:thin}" +
    ".ai-m{max-width:97%;padding:11px 13px;border-radius:14px;font-size:12.9px;line-height:1.55}" +
    ".ai-m.me{align-self:flex-end;background:var(--accent);color:#0b0d16;font-weight:600;border-bottom-right-radius:5px}" +
    ".ai-m.bot{align-self:flex-start;background:var(--surface-2);border:1px solid var(--line);border-bottom-left-radius:5px}" +
    ".ai-m ul{margin:7px 0 0;padding-left:16px}.ai-m li{margin:3px 0}" +
    ".ai-m table{width:100%;border-collapse:collapse;margin-top:9px;font-size:11.9px;table-layout:auto;" +
    "background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:12px;overflow:hidden}" +
    ".ai-m th{position:sticky;top:0;text-align:left;color:var(--muted);font-weight:600;padding:7px 9px;" +
    "font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;background:var(--surface-2);" +
    "border-bottom:1px solid var(--line);white-space:nowrap}" +
    ".ai-m td{padding:7px 9px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top;" +
    "font-variant-numeric:tabular-nums}" +
    ".ai-m tr:last-child td{border-bottom:0}" +
    ".ai-m tr:hover td{background:rgba(255,255,255,.025)}" +
    ".ai-m td:first-child,.ai-m th:first-child{padding-left:11px}" +
    ".ai-m td:last-child,.ai-m th:last-child{padding-right:11px}" +
    ".ai-m .up{color:#6FE0B0}.ai-m .down{color:#F3A2A2}" +
    ".ai-do{margin-top:9px;display:flex;gap:7px;flex-wrap:wrap}" +
    ".ai-do button{font:inherit;font-size:11.8px;padding:7px 11px;border-radius:10px;cursor:pointer;" +
    "border:0;background:var(--accent);color:#0b0d16;font-weight:700}" +
    ".ai-do button.gh{background:transparent;border:1px solid var(--line);color:var(--text);font-weight:600}" +
    ".ai-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px}" +
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
    ".ai-filter button.on{border-color:var(--accent);color:var(--text);background:rgba(124,92,255,.14)}" +
    ".ai-run{margin-left:8px;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;" +
    "border:1px solid var(--line);color:var(--muted);vertical-align:middle;white-space:nowrap}" +
    ".ai-run.on{color:#6FE0B0;border-color:#53D6A066;background:rgba(83,214,160,.12)}" +
    ".ai-run.done{color:#E8C266;border-color:#E2B23A55;background:rgba(226,178,58,.12)}";

  /* ---------- окно диалога ---------- */
  function dayStamp() {
    var d = new Date(), p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return p2(d.getDate()) + "." + p2(d.getMonth() + 1) + "." + d.getFullYear();
  }
  /* переписка хранится вместе с настройками: в полночь она очищается сама,
     а администратор площадки может стереть её в любой момент */
  function keepMsg(html, who) {
    if (typeof CFG === "undefined") return;
    CFG.chatDay = dayStamp();
    CFG.chat.push({ w: who === "me" ? "me" : "bot", h: String(html), at: Date.now() });
    CFG.chat = CFG.chat.slice(-60);
    saveCfg();
  }
  function redrawChat() {
    var box = $("aiBody"); if (!box) return;
    box.innerHTML = "";
    (CFG.chat || []).forEach(function (m2) {
      var d = document.createElement("div");
      d.className = "ai-m " + (m2.w === "me" ? "me" : "bot");
      d.innerHTML = m2.h;
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }
  /* полночь: диалог начинается с чистого листа */
  function midnightTick() {
    if (typeof CFG === "undefined") return;
    if (CFG.chatDay && CFG.chatDay !== dayStamp() && CFG.chat.length) {
      CFG.chat = []; CFG.chatDay = dayStamp(); saveCfg(); redrawChat();
      say("Новый день — переписку за вчера я очистил. Чем помочь?");
    }
  }
  function say(html, who) {
    keepMsg(html, who);
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

  /* ================= потолок дневного дохода =================
     Площадки смотрят на суточный результат: когда он уходит за сотню тысяч,
     аккаунты отправляют на проверку и замораживают вывод. Помощник сам не
     предлагает такие сценарии, а если их собирает пользователь — показывает
     предупреждение на весь экран и варианты, как снизить риск. */
  var CAP = 100000;
  /* CAP — это запрет: выше него сценарии блокируются. Сам помощник предлагает
     заметно скромнее: столько за сутки площадки не разбирают. */
  var DAY_TARGET = 35000;
  /* коэффициент, с которым сценарий реально уйдёт в работу: он снимается с лестницы
     инструмента, а ночью по крипте ещё и понижается ночным режимом риска */
  function capK(k, pair) {
    var p2 = pair || ((typeof S !== "undefined" && S.params && S.params.pair) || "XAU/USD");
    var kk = (typeof coefOf === "function") ? coefOf(num(k), p2) : num(k);
    if (typeof nightCoef === "function") kk = nightCoef(kk, p2);
    return num(kk) || 1.2;
  }
  function sumOf(list) {
    return (list || []).reduce(function (s2, a) { return s2 + num(a.balance); }, 0);
  }
  /* доля депозита в работе: по ней считается итог сессии — коэффициент применяется
     к рабочей части депозита, остальное лежит нетронутым */
  function shareNow() {
    var v = (typeof S !== "undefined" && S.params) ? num(S.params.share) : 0.6;
    return Math.max(0.1, Math.min(1, v || 0.6));
  }
  /* сколько сценарий даёт за сутки по списку кошельков */
  function gainOf(list, k, share, pair) {
    var sh = (share === undefined || share === null) ? shareNow() : Math.max(0.1, Math.min(1, num(share) || 0.6));
    return sumOf(list) * sh * (capK(k, pair) - 1);
  }
  /* самый высокий коэффициент, который укладывается в потолок */
  function capCoef(list, share, pair, limit) {
    var lim = num(limit) || CAP;
    var sh = (share === undefined || share === null) ? shareNow() : Math.max(0.1, Math.min(1, num(share) || 0.6));
    var base = sumOf(list) * sh;
    if (base <= 0) return 2.5;
    var ladder = (typeof coefsFor === "function") ? coefsFor(pair) : [1.2, 1.3, 1.5, 1.6, 2, 2.5];
    var ok = ladder.filter(function (k) { return base * (capK(k, pair) - 1) <= lim; });
    return ok.length ? ok[ok.length - 1] : ladder[0];
  }
  /* сколько кошельков можно оставить при этом коэффициенте */
  function capCount(list, k, share, pair) {
    var kk = capK(k, pair);
    var sh = (share === undefined || share === null) ? shareNow() : Math.max(0.1, Math.min(1, num(share) || 0.6));
    var sorted = (list || []).slice().sort(function (a, b) { return num(a.balance) - num(b.balance); });
    var sum = 0, n = 0;
    for (var i = 0; i < sorted.length; i++) {
      var add = num(sorted[i].balance) * sh * (kk - 1);
      if (sum + add > CAP) break;
      sum += add; n++;
    }
    return { count: n, list: sorted.slice(0, n), gain: sum };
  }
  /* приводим сценарий к порогу: сначала коэффициент, если этого мало — ещё и число
     кошельков. Возвращаем набор, который гарантированно укладывается в потолок. */
  function capFit(mode, list, k, pair) {
    var r = { k: num(k) || 1.3, list: (list || []).slice(), cut: 0 };
    if (mode !== "count") r.k = capCoef(r.list, 1, pair);
    if (mode === "count" || gainOf(r.list, r.k, 1, pair) > CAP) {
      var c = capCount(r.list, r.k, 1, pair);
      r.cut += r.list.length - c.count;
      r.list = c.list;
    }
    /* крайний случай: и после обрезки порог выше — опускаем коэффициент до спокойного */
    if (gainOf(r.list, r.k, 1, pair) > CAP) {
      r.k = capCoef(r.list, 1, pair);
      var c2 = capCount(r.list, r.k, 1, pair);
      r.cut += r.list.length - c2.count;
      r.list = c2.list;
    }
    r.gain = gainOf(r.list, r.k, 1, pair);
    return r;
  }
  /* применяем правку сразу: коэффициент в общий сценарий, выбор кошельков и
     карточки с личными параметрами — чтобы расчёт слева тут же стал ниже порога */
  function capPut(r, pair, force) {
    if (typeof S === "undefined") return;
    if (pair) S.params.pair = pair;
    S.params.k = r.k;
    if (r.cut || force) {
      S.sel.clear();
      r.list.forEach(function (a) { S.sel.add(kOf(a)); });
    }
    /* личные параметры карточек тоже не должны выходить за порог */
    Object.keys(S.per || {}).forEach(function (kk) {
      var p2 = S.per[kk];
      if (p2 && num(p2.k) > r.k) S.per[kk] = Object.assign({}, p2, { k: r.k });
    });
    if (typeof buildForm === "function") buildForm();
    if (typeof renderAll === "function") renderAll();
    renderPanels();
  }
  /* прогрев кошельков: площадка спокойно смотрит на счёт, который отлежался и набрал
     объём. Когда в сценарий заводят все кошельки подряд, большая часть из них ещё не
     прогрета — именно такие аккаунты и уходят на модерацию. */
  function warmInfo(list) {
    var warm = [], cold = [];
    (list || []).forEach(function (a) {
      /* прогретым считаем только счёт, который набрал объём: «вывод возможен,
         но не рекомендуется» — это ещё прогрев */
      (outState(a).tone === "warm" ? warm : cold).push(a);
    });
    var n = (list || []).length || 1;
    return { warm: warm, cold: cold, n: (list || []).length,
             pct: Math.round(cold.length / n * 100) };
  }
  /* текст про прогрев: он нужен и в окне предупреждения, и в рекомендациях */
  function warmNote(list) {
    var w = warmInfo(list);
    if (!w.n) return "";
    if (w.cold.length && w.pct >= 50) {
      return "<b>Прогрев: " + w.cold.length + " из " + w.n + " кошельков ещё не прогреты</b> — " +
        "на счёте нет " + money(WARM_SUM) + " или не прошло " + WARM_DAYS + " дней с регистрации. " +
        "Это большинство выбранных аккаунтов: если запустить сценарий на всех сразу, по непрогретым " +
        "счетам выйдет резкий скачок на молодом аккаунте — такие площадка с высокой вероятностью " +
        "отправит на модерацию, а часть может заблокировать. Безопаснее работать прогретыми" +
        (w.warm.length ? " (" + w.warm.length + " кошельк(ов))" : "") + ", остальным дать отлежаться.";
    }
    if (w.cold.length) {
      return "Прогрев: " + w.cold.length + " из " + w.n + " кошельков ещё не прогреты — " +
        "по ним лучше держать спокойный коэффициент, иначе аккаунт уйдёт на проверку.";
    }
    return "Прогрев: все выбранные кошельки отлежались и набрали объём — вопросов к ним не будет.";
  }
  var CAP_SEEN = "";
  function capWarn(opts) {
    var o = opts || {};
    var list = o.list || sel();
    var k = num(o.k) || 1.3, share = num(o.share) || 0.6;
    var pair = o.pair || ((typeof S !== "undefined" && S.params && S.params.pair) || "XAU/USD");
    var gain = o.gain !== undefined ? num(o.gain) : gainOf(list, k, share, pair);
    if (gain <= CAP) return false;
    /* одно и то же сочетание не показываем по кругу */
    var sign = [list.length, k, pair, Math.round(gain)].join("|");
    if (!o.force && CAP_SEEN === sign) return true;
    /* одно окно за раз: второе поверх первого только мешает */
    if (document.querySelector(".cap-ovl")) return true;
    CAP_SEEN = sign;
    var byK = capFit("k", list, k, pair);
    var byCount = capFit("count", list, k, pair);
    var wi = warmInfo(list);
    /* отдельный вариант: оставить только прогретые кошельки и подобрать под них коэффициент */
    var byWarm = wi.warm.length ? capFit("k", wi.warm, k, pair) : null;
    var box = document.createElement("div");
    box.className = "cap-ovl";
    box.innerHTML =
      '<div class="cap-win"><div class="cap-h">Риск модерации и блокировки</div>' +
      "<p>Такой сценарий даёт <b>" + money(gain) + " за сутки</b> по " + list.length +
      " кошельк(ам) — это выше порога в " + money(CAP) + ", на который площадки реагируют проверкой. " +
      "Аккаунт с таким дневным результатом отправляют на модерацию, вывод замораживают до выяснения, " +
      "а при повторе — закрывают. Я такие сценарии не предлагаю и советую снизить разгон.</p>" +
      (wi.cold.length && wi.pct >= 50
        ? '<p class="cap-warm">Плюс к этому большинство кошельков (' + wi.cold.length + " из " + wi.n +
          ") ещё не прогреты: нет " + money(WARM_SUM) + " на счёте или не прошло " + WARM_DAYS +
          " дней с регистрации. Если завести в сценарий все аккаунты сразу, непрогретые с высокой " +
          "вероятностью попадут под модерацию, а часть могут заблокировать.</p>"
        : "") +
      '<div class="cap-opts">' +
      '<button data-cap="k">Снизить коэффициент до ×' + String(byK.k).replace(".", ",") +
      (byK.cut ? " и оставить " + byK.list.length + " кошельк(ов)" : "") +
      "<span>" + money(byK.gain) + " за сутки</span></button>" +
      (byCount.count !== 0 && byCount.list.length
        ? '<button data-cap="count">Оставить ' + byCount.list.length + " кошельк(ов) из " + list.length +
          " при ×" + String(byCount.k).replace(".", ",") +
          "<span>" + money(byCount.gain) + " за сутки</span></button>"
        : "") +
      (byWarm && wi.cold.length
        ? '<button data-cap="warm">Работать только прогретыми — ' + byWarm.list.length +
          " из " + wi.n + " при ×" + String(byWarm.k).replace(".", ",") +
          "<span>" + money(byWarm.gain) + " за сутки · непрогретые отдыхают</span></button>"
        : "") +
      "</div>" +
      '<p class="cap-note">Разумный режим: ×1,2–×1,6 и часть кошельков в работе — ' +
      "тогда счета растут ровно и вопросов к ним нет. Любая правка применяется сразу: " +
      "расчёт слева пересчитается под выбранный вариант.</p>" +
      '<div class="cap-act"><button class="cap-x" data-cap="close">Понимаю риск, оставить как есть</button></div></div>';
    document.body.appendChild(box);
    function done() { box.remove(); }
    box.querySelectorAll("[data-cap]").forEach(function (b) {
      b.onclick = function () {
        var w = b.dataset.cap;
        if (w !== "close") {
          var r = (w === "count") ? byCount : (w === "warm" ? byWarm : byK);
          if (!r) r = byK;
          capPut(r, pair, w === "warm");
          CAP_SEEN = "";
          say("<b>Поправил сценарий.</b> " + esc(pair) + " ×" + String(r.k).replace(".", ",") +
            (r.cut ? ", в работе " + r.list.length + " кошельк(ов) из " + list.length : "") +
            " — теперь это " + money(r.gain) + " за сутки, в пределах порога " + money(CAP) +
            ". Расчёт слева уже пересчитан." +
            (r.cut || w === "warm"
              ? "<br>Остальные кошельки сегодня отдыхают — так аккаунты выглядят спокойно." : "") +
            "<br>" + warmNote(r.list));
        }
        logEvent("Порог " + money(CAP) + " за сутки: " +
          (w === "close" ? "оставлено как есть" : "сценарий снижен"),
          w === "close" ? "warn" : "ok", "risk");
        renderPanels();
        done();
      };
    });
    return true;
  }
  /* Следим за общим сценарием. При первой загрузке окно не показываем: если
     параметры по умолчанию дают больше порога, помощник сам подбирает вариант
     под потолок и пишет об этом в чат. Окно вылезает только тогда, когда
     пользователь сам поднял коэффициент или добавил кошельков. */
  var CAP_INIT = false;
  function capTick() {
    if (typeof S === "undefined" || !S.params) return;
    var list = sel();
    if (!list.length) return;
    var g = gainOf(list, coefNow(), 1, S.params.pair);
    if (g <= CAP) { CAP_INIT = true; return; }
    if (!CAP_INIT) {
      CAP_INIT = true;
      var r = capFit("k", list, coefNow(), S.params.pair);
      if (!r.list.length) return;
      capPut(r, S.params.pair);
      logEvent("Стартовый сценарий подобран под порог " + money(CAP) + " за сутки", "ok", "risk");
      say("<b>Подобрал стартовый сценарий под порог.</b> По умолчанию на " + list.length +
        " кошельк(ах) выходило " + money(g) + " за сутки — выше " + money(CAP) +
        ", с которого площадки проверяют аккаунты. Поставил " + esc(S.params.pair) + " ×" +
        String(r.k).replace(".", ",") +
        (r.cut ? " и оставил в работе " + r.list.length + " кошельк(ов)" : "") +
        ", это " + money(r.gain) + " за сутки.<br>" + warmNote(r.list) +
        "<br>Если поднимете коэффициент выше — покажу предупреждение с вариантами.");
      return;
    }
    capWarn({ list: list, k: coefNow(), pair: S.params.pair, gain: g });
  }
  function coefNow() {
    if (typeof S === "undefined" || !S.params) return 1.3;
    return (typeof coefOf === "function") ? coefOf(S.params.k, S.params.pair) : num(S.params.k) || 1.3;
  }
  /* запуск сценария тоже проходит через проверку порога */
  function guardRun() {
    if (typeof window.runKeys !== "function" || window.runKeys.__capped) return;
    var orig = window.runKeys;
    var wrap = function (keys, params) {
      var list = (keys || []).map(function (k) {
        return accs().filter(function (a) { return kOf(a) === k; })[0];
      }).filter(Boolean);
      var p2 = params || (typeof S !== "undefined" ? S.params : {}) || {};
      var k2 = (typeof coefOf === "function") ? coefOf(p2.k, p2.pair) : num(p2.k) || 1.3;
      var g = gainOf(list, k2, 1, p2.pair);
      if (g > CAP) {
        capWarn({ list: list, k: k2, pair: p2.pair, gain: g, force: true });
        say("<b>Запуск придержал.</b> Сценарий даёт " + money(g) + " за сутки — выше порога " +
          money(CAP) + ", с которого площадки проверяют аккаунты. Поправьте разгон в окне предупреждения " +
          "или запустите меньшим числом кошельков.");
        return;
      }
      return orig.apply(null, arguments);
    };
    wrap.__capped = true;
    window.runKeys = wrap;
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
      /* потолок суточного дохода: выше порога помощник коэффициент не ставит */
      var top = capCoef([a], 1, p);
      if (k > top) { k = top; why = "ограничил коэффициент: выше порога по доходу за сутки"; }
      return { a: a, pair: p, k: k, why: why, gold: p === gold };
    });
  }
  /* приводим предложение к дневной цели: сначала пропорционально снижаем
     коэффициенты, затем выводим из плана самые «тяжёлые» кошельки */
  function fitPlan(rows, target) {
    var lim = num(target) || DAY_TARGET;
    var sh = shareNow();
    var gain = function (r) { return num(r.a.balance) * sh * (capK(r.k, r.pair) - 1); };
    var total = rows.reduce(function (s2, r) { return s2 + gain(r); }, 0);
    if (total <= lim) return { rows: rows, rest: [], total: total };
    var f = lim / total, rest = [], out = [];
    rows.forEach(function (r) {
      var want = 1 + (capK(r.k, r.pair) - 1) * f;
      var ladder = (typeof coefsFor === "function") ? coefsFor(r.pair) : [1.2, 1.3, 1.5, 1.6, 2, 2.5];
      var ok = ladder.filter(function (k) { return k <= want + 1e-9; });
      /* ниже самой спокойной ступени не опуститься — такие кошельки отсеет
         проверка лимита ниже, но часть из них в план всё равно попадёт */
      if (!ok.length) ok = [ladder[0]];
      out.push({ a: r.a, pair: r.pair, k: ok[ok.length - 1], gold: r.gold,
                 why: r.why + " · коэффициент снижен под дневной лимит" });
    });
    /* после округления по лестнице сумма может остаться выше цели */
    out.sort(function (x, y) { return gain(x) - gain(y); });
    var sum = 0, keep = [];
    out.forEach(function (r) {
      var g = gain(r);
      if (sum + g <= lim) { sum += g; keep.push(r); } else rest.push(r);
    });
    return { rows: keep, rest: rest, total: sum };
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
    var all = plan();
    if (!all.length) return say("Сначала подключите кошельки — тогда разложу их по парам.");
    var fit = fitPlan(all, DAY_TARGET);
    var rows = fit.rows, rest = fit.rest, sum = fit.total;
    if (!rows.length) {
      return say("<b>Даже самый спокойный сценарий по этим кошелькам даёт больше " + money(DAY_TARGET) +
        " за сутки.</b> Уменьшите долю депозита в работе или оставьте в выборе меньше кошельков — " +
        "тогда соберу предложение.");
    }
    var m = say("<b>Предложение на день по " + rows.length + " кошелькам</b>" +
      "<table><tr><th>Кошелёк</th><th>Пара</th><th>Коэф.</th><th>За сутки</th><th>Почему</th></tr>" +
      rows.slice(0, 14).map(function (r) {
        return "<tr><td>#" + esc(r.a.acct) + "</td><td>" + esc(r.pair) + "</td><td>×" +
          String(r.k).replace(".", ",") + "</td><td>" +
          sig(num(r.a.balance) * shareNow() * (capK(r.k, r.pair) - 1)) + "</td><td>" +
          esc(r.why) + "</td></tr>";
      }).join("") + "</table>" +
      (rows.length > 14 ? "<br>и ещё " + (rows.length - 14) + " кошельк(ов) в плане." : "") +
      "<br>Если всё отработает по плану, прибавка за сутки около " + money(sum) +
      " — держу предложение в пределах " + money(DAY_TARGET) +
      " за сутки, чтобы аккаунты не брали на проверку." +
      (rest.length
        ? "<br><b>Сегодня без сценария остаются " + rest.length + " кошельк(ов):</b> " +
          rest.slice(0, 8).map(function (r) { return "#" + esc(r.a.acct); }).join(", ") +
          (rest.length > 8 ? " и др." : "") + " — с ними дневной лимит был бы превышен."
        : "") +
      "<br>" + warmNote(rows.map(function (r) { return r.a; })));
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
  /* Запуск сессий — это не кнопка «ок», а решение: сначала роспись по каждому
     кошельку (пара, коэффициент, итог за сутки, прогрев), потом вывод и выбор. */
  function doRun() {
    var list = sel();
    if (!list.length) return say("Не выбрано ни одного кошелька.");
    var rows = list.map(function (a) {
      var pp = (typeof paramsFor === "function") ? paramsFor(a) : (S && S.params) || {};
      var pair = pp.pair || "XAU/USD";
      var k = capK(pp.k, pair);
      var st = outState(a);
      var warm = st.tone === "warm" || st.tone === "ok";
      var stop = [];
      if (typeof pairOpen === "function" && !pairOpen(pair)) stop.push("пара вне торговых часов");
      if (typeof goldBlocked === "function" && goldBlocked(a, pair)) stop.push("золото без ключа");
      var note = stop.length ? stop.join(", ")
        : (warm ? (k > 1.6 ? "прогрет, но коэффициент высокий" : "прогрет, коэффициент спокойный")
                : (k > 1.3 ? "не прогрет — коэффициент лучше снизить до ×1,3" : "не прогрет, коэффициент спокойный"));
      return { a: a, pair: pair, k: k, warm: warm, stop: stop,
               gain: num(a.balance) * (k - 1), note: note };
    });
    var ready = rows.filter(function (r) { return !r.stop.length; });
    var total = ready.reduce(function (s2, r) { return s2 + r.gain; }, 0);
    var cold = ready.filter(function (r) { return !r.warm; });
    var hotCold = cold.filter(function (r) { return r.k > 1.3; });
    var over = total > CAP;
    var safe = ready.filter(function (r) { return r.warm; });
    var safeSum = safe.reduce(function (s2, r) { return s2 + r.gain; }, 0);
    var verdict = over
      ? "<b>Запускать в таком виде не советую.</b> Суммарный итог за сутки — " + money(total) +
        ", это выше порога " + money(CAP) + ", с которого площадки проверяют аккаунты."
      : (hotCold.length
        ? "<b>Можно запускать, но с оговоркой.</b> " + hotCold.length +
          " непрогретых кошельк(ов) идут с коэффициентом выше ×1,3 — именно такие счета чаще всего " +
          "уходят на модерацию. Я бы снизил по ним разгон."
        : "<b>Сценарий выглядит спокойно.</b> Итог за сутки " + money(total) +
          " — в пределах порога " + money(CAP) + ", коэффициенты соразмерны прогреву счетов.");
    var m = say("<b>Разбор перед запуском: " + list.length + " кошельк(ов)</b>" +
      "<table><tr><th>Кошелёк</th><th>Пара</th><th>Коэф.</th><th>Итог за сутки</th><th>Прогрев</th>" +
      "<th>Комментарий</th></tr>" +
      rows.slice(0, 14).map(function (r) {
        return "<tr><td>#" + esc(r.a.acct) + "</td><td>" + esc(r.pair) + "</td><td>×" +
          String(r.k).replace(".", ",") + "</td><td>" + sig(r.gain) + "</td><td>" +
          (r.warm ? "прогрет" : "в прогреве") + "</td><td>" + esc(r.note) + "</td></tr>";
      }).join("") + "</table>" +
      (rows.length > 14 ? "<br>и ещё " + (rows.length - 14) + " кошельк(ов)." : "") +
      (rows.length - ready.length
        ? "<br>Не стартуют " + (rows.length - ready.length) + " кошельк(ов): " +
          rows.filter(function (r) { return r.stop.length; }).slice(0, 6).map(function (r) {
            return "#" + esc(r.a.acct) + " (" + esc(r.stop.join(", ")) + ")"; }).join(", ") + "."
        : "") +
      "<br><br>" + verdict + "<br>" + warmNote(ready.map(function (r) { return r.a; })));
    var btns = [];
    if (!over) {
      btns.push(["Применить и запустить (" + ready.length + ")", function () {
        if (typeof runKeys === "function") runKeys(ready.map(function (r) { return kOf(r.a); }));
      }]);
    }
    if (safe.length && safe.length !== ready.length && safeSum <= CAP) {
      btns.push(["Только прогретыми (" + safe.length + " · " + money(safeSum) + ")", function () {
        if (typeof S !== "undefined") {
          S.sel.clear(); safe.forEach(function (r) { S.sel.add(kOf(r.a)); });
          if (typeof renderAll === "function") renderAll();
        }
        if (typeof runKeys === "function") runKeys(safe.map(function (r) { return kOf(r.a); }));
      }, !over]);
    }
    if (hotCold.length) {
      btns.push(["Снизить до ×1,3 непрогретым (" + hotCold.length + ")", function () {
        hotCold.forEach(function (r) {
          S.per[kOf(r.a)] = { pair: r.pair, hours: 24, k: 1.3, share: 0.6, dir: "up" };
        });
        if (typeof renderAll === "function") renderAll();
        renderPanels();
        say("Непрогретым кошелькам поставил ×1,3 — теперь разбор можно собрать заново " +
          "командой «запусти по выбранным».");
      }, true]);
    }
    if (over) {
      btns.push(["Подобрать безопасный вариант", function () {
        capWarn({ list: ready.map(function (r) { return r.a; }), k: rows[0] ? rows[0].k : 1.6,
                  pair: rows[0] ? rows[0].pair : "XAU/USD", gain: total, force: true });
      }]);
    }
    btns.push(["Не запускать", function () { say("Хорошо, сессии не трогаю."); }, true]);
    act(m, btns);
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
  function dayRow(it, date) {
    return (it.days || []).filter(function (x) { return x.date === date; })[0] || null;
  }
  function dayOf(it, date) {
    var row = dayRow(it, date);
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
      var rows = items.map(function (it) {
        var row = dayRow(it, date);
        return { it: it, row: row, g: row ? row.amount : null };
      });
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
      var down = have.filter(function (r) { return r.g < 0; });
      /* показываем каждый кошелёк: имя клиента, площадку, пару и сумму за этот день */
      var all = have.slice().sort(function (x, y) { return y.g - x.g; });
      var posted = have.filter(function (r) { return (r.row || {}).admin; }).length;
      fill(m, "<b>Итог за " + esc(date) + ": " + sig(sum) + "</b> · кошельков с записью " +
        have.length + " из " + items.length +
        "<ul>" + Object.keys(bySite).map(function (n) {
          return "<li>" + esc(n) + " — " + sig(bySite[n]) + "</li>"; }).join("") + "</ul>" +
        "<table><tr><th>Клиент</th><th>Кошелёк</th><th>Площадка</th><th>Пара</th><th>Итог</th></tr>" +
        all.map(function (r) {
          var row = r.row || {};
          return "<tr><td>" + esc(r.it.name || "—") + "</td><td>#" + esc(r.it.acct) + "</td><td>" +
            esc(r.it.siteName || r.it.site) + "</td><td>" + esc(row.pair || "—") + "</td><td>" +
            sig(r.g) + "</td></tr>"; }).join("") + "</table>" +
        (posted ? "<br>Из них проставлено площадкой за этот день: " + posted + " кошельк(ов)." : "") +
        (down.length
          ? "<br>Просадка у " + down.length + ": " + down.slice(0, 8).map(function (r) {
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
  /* Вывод: по каждому кошельку свой вердикт — сумма, возраст счёта и прошлые заявки */
  function doPayout() {
    var list = accs();
    if (!list.length) return say("Кошельки не подключены.");
    return pullHist().then(function () {
      var rows = list.map(function (a) {
        var st = outState(a);
        var rec = (st.tone === "warm") ? "выводить можно"
          : (st.tone === "ok") ? "возможен, но не рекомендую: прогрев сбросится"
          : (st.tone === "wait") ? "подождать: заявки подряд площадка проверяет"
          : (st.tone === "cold") ? "не рекомендую: прогрев сбросится"
          : "закрыт администратором";
        return { a: a, st: st, rec: rec };
      });
      var ok = rows.filter(function (r) { return r.st.tone === "warm"; });
      var soon = rows.filter(function (r) { return r.st.tone === "ok"; });
      var no = rows.filter(function (r) { return ["cold", "wait", "off"].indexOf(r.st.tone) >= 0; });
      var sum = ok.reduce(function (s2, r) { return s2 + num(r.a.balance); }, 0);
      say("<b>Вывод средств: " + ok.length + " кошельк(ов) прогреты и готовы</b> · на них " + money(sum) +
        "<table><tr><th>Клиент</th><th>Кошелёк</th><th>Площадка</th><th>Баланс</th><th>Статус</th>" +
        "<th>Рекомендация</th></tr>" +
        rows.map(function (r) {
          return "<tr><td>" + esc(nameOf(r.a)) + "</td><td>#" + esc(r.a.acct) + "</td><td>" +
            esc(r.a.siteName || r.a.site) + "</td><td>" + money(num(r.a.balance)) + "</td><td>" +
            esc(r.st.title) + "</td><td>" + esc(r.rec) + "</td></tr>";
        }).join("") + "</table>" +
        "<br><b>Что советую:</b> " +
        (ok.length
          ? "подавать заявки с прогретых кошельков — " + ok.slice(0, 6).map(function (r) {
              return "#" + esc(r.a.acct); }).join(", ") + (ok.length > 6 ? " и др." : "") + ". "
          : "сейчас прогретых кошельков нет — вывод лучше отложить. ") +
        (soon.length ? "Ещё " + soon.length + " кошельк(ов) отлежались, но не набрали " + money(WARM_SUM) +
          " — с них лучше выводить частями. " : "") +
        (no.length ? "Не трогать " + no.length + " кошельк(ов): " + no.slice(0, 6).map(function (r) {
          return "#" + esc(r.a.acct) + " (" + esc(r.st.title.toLowerCase()) + ")"; }).join(", ") + "."
          : "") +
        "<br>Прогретым считаю счёт от " + money(WARM_SUM) + " и старше " + WARM_DAYS +
        " дней; заявка создаётся кнопкой «Вывести средства» в карточке кошелька, порог и адрес " +
        "задаёт администратор площадки.");
    });
  }
  /* имя клиента берём из истории кабинета: в карточке пульта его может не быть */
  function nameOf(a) {
    var h = (HIST || []).filter(function (x) {
      return x.site === a.site && String(x.acct) === String(a.acct); })[0];
    return (h && h.name) || a.name || "—";
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
      var need = 1 + Math.abs(+want) / 100;
      var best = ladder.reduce(function (p1, k) {
        return Math.abs(k - need) < Math.abs(p1 - need) ? k : p1; }, ladder[0]);
      var wantGain = bal * (capK(best, pair) - 1);
      if (wantGain > CAP) {
        var fit = capCoef(list, 1, pair);
        return say("<b>Столько за сутки ставить не стоит.</b> " + esc(want) + "% по " + esc(pair) +
          " — это " + money(wantGain) + " за сутки, выше порога " + money(CAP) +
          ", с которого площадки проверяют аккаунты и могут закрыть вывод." +
          "<br>Максимум, который я советую на эти кошельки: <b>×" + String(fit).replace(".", ",") +
          "</b> — " + money(gainOf(list, fit, 1, pair)) + " за сутки. " +
          "Если нужно больше — разложите по дням или оставьте в работе часть кошельков.");
      }
      return say("<b>Чтобы получить около " + esc(want) + "% за " + hours + " ч</b> по " + esc(pair) +
        " нужен коэффициент <b>×" + String(best).replace(".", ",") + "</b>." +
        "<br>На " + money(bal) + " это примерно " + sig(bal * (capK(best, pair) - 1)) + " за сессию." +
        (kindOf(pair) !== "crypto" && need > 2.5
          ? " Выше ×2,5 по этой паре не ставится — возьмите криптопару, там лестница до ×10."
          : ""));
    }
    var rows = ladder.map(function (k) {
      var gain = bal * (capK(k, pair) - 1);
      var dd = k <= 1.4 ? 3 : (k <= 1.9 ? 7 : 14);
      return { k: k, gain: gain, dd: dd, over: gain > CAP };
    });
    var m = say("<b>Сценарий на день: " + esc(pair) + ", " + hours + " ч</b> · депозит " +
      money(bal) + " по " + list.length + " кошельк(ам)" +
      "<table><tr><th>Коэф.</th><th>Итог сессии</th><th>Баланс после</th><th>Просадка до</th>" +
      "<th>Модерация</th></tr>" +
      rows.map(function (r) {
        return "<tr><td>×" + String(r.k).replace(".", ",") + "</td><td>" + sig(r.gain) +
          "</td><td>" + money(bal + r.gain) + "</td><td>" + r.dd + "%</td><td>" +
          (r.over ? "выше порога — не советую" : "в норме") + "</td></tr>"; }).join("") + "</table>" +
      "<br>Порог " + money(CAP) + " за сутки: выше него площадки отправляют аккаунты на проверку, " +
      "поэтому такие коэффициенты я не предлагаю. Можно сказать «хочу +8% за день» — подберу под цель.");
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
      "<li>«Запиши итог дня всем кошелькам обеих площадок» — как разноска из админки, с отменой там же</li>" +
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
    if (/(прогрет|прогрев|тепловая карт|тепловую карт|карт[аыу] вывод)/.test(t)) return doHeat();
    if (/(отмени|останов|сбрось)/.test(t) && /(все сценари|всех сценари|все сессии)/.test(t)) return stopAllFix();
    if (/(зафиксир|запиши|итог дня)/.test(t) && /(всем|обеих|двум|площадк)/.test(t)) return fixDayAll();
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
    if (CFG.chatDay && CFG.chatDay !== dayStamp()) { CFG.chat = []; CFG.chatDay = ""; saveCfg(); }
    if ((CFG.chat || []).length) redrawChat();
    else say("Привет. Я помощник внутри пульта: подскажу по кошелькам, ключам, парам и выводу, " +
      "разложу аккаунты по стратегиям и запущу сессии. Права у меня ваши — в админку площадки я не хожу, " +
      "поэтому коды активации и ключ администратора присылаете вы. Переписка очищается каждый день в 00:00.");
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
  function working(a) { return !!(a && typeof winOf === "function" && winOf(a)); }
  /* в карточке сразу видно, работает ли по ней сценарий */
  function markCards() {
    var box = $("accs"); if (!box) return;
    box.querySelectorAll(".acc[data-k]").forEach(function (el) {
      var a = accs().filter(function (x) { return kOf(x) === el.dataset.k; })[0];
      if (!a) return;
      var name = el.querySelector(".acc-name b");
      if (!name) return;
      var tag = name.querySelector(".ai-run");
      if (!tag) {
        tag = document.createElement("span");
        tag.className = "ai-run";
        name.appendChild(tag);
      }
      var run = working(a), over = (typeof overOf === "function") && overOf(a);
      tag.className = "ai-run " + (run && !over ? "on" : (over ? "done" : "off"));
      tag.textContent = run && !over ? "сценарий работает" : (over ? "сессия завершена" : "сценарий не запущен");
    });
  }
  function applyFilter() {
    var box = $("accs"); if (!box) return;
    box.querySelectorAll(".acc[data-k]").forEach(function (el) {
      var a = accs().filter(function (x) { return kOf(x) === el.dataset.k; })[0];
      var show = FLT === "all" ? true
        : (FLT === "on" ? live(a)
        : (FLT === "off" ? !live(a)
        : (FLT === "run" ? working(a) : !working(a))));
      el.style.display = show ? "" : "none";
    });
    markCards();
    var cnt = $("aiFltCnt");
    if (cnt) {
      var on = accs().filter(live).length, run = accs().filter(working).length;
      cnt.textContent = "ключ активирован — " + on + " · не активирован — " + (accs().length - on) +
        " · по сценарию работают — " + run;
    }
  }
  function filterRow() {
    var box = $("accs");
    if (!box || $("aiFlt")) return;
    var row = document.createElement("div");
    row.className = "ai-filter"; row.id = "aiFlt";
    row.innerHTML =
      '<button data-f="all" class="on">Все кошельки</button>' +
      '<button data-f="run">По сценарию работают</button>' +
      '<button data-f="stop">Сценарий не запущен</button>' +
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
    var d = { risk: { on: true, day: 5, dd: 7, big: 5000 }, week: {}, auto: { on: false, hour: 9 },
              log: [], chat: [], chatDay: "" };
    try {
      var raw = JSON.parse(localStorage.getItem(LSK) || "null");
      if (raw && typeof raw === "object") {
        d.risk = Object.assign(d.risk, raw.risk || {});
        d.week = raw.week || {};
        d.auto = Object.assign(d.auto, raw.auto || {});
        d.log = Array.isArray(raw.log) ? raw.log.slice(0, 20) : [];
        d.chat = Array.isArray(raw.chat) ? raw.chat.slice(-60) : [];
        d.chatDay = raw.chatDay || "";
      }
    } catch (e) {}
    return d;
  })();
  function saveCfg() {
    try { localStorage.setItem(LSK, JSON.stringify(CFG)); } catch (e) {}
    pushPrefs();
  }
  /* настройки помощника общие для кошелька: план недели, лимиты и журнал лежат
     на площадке, поэтому второй человек с теми же кошельками видит то же самое */
  var PREF_T = null, PREF_AT = 0;
  function prefBody() {
    return accs().map(function (a) { return { site: a.site, acct: a.acct, key: apiKey(a) }; })
      .filter(function (x) { return x.key; });
  }
  function pushPrefs() {
    if (typeof api !== "function") return;
    clearTimeout(PREF_T);
    PREF_T = setTimeout(function () {
      var list = prefBody(); if (!list.length) return;
      PREF_AT = Date.now();
      api("/api/hub/prefs", { method: "POST", body: JSON.stringify({ accounts: list,
        prefs: { risk: CFG.risk, week: CFG.week, auto: CFG.auto, log: CFG.log.slice(0, 20),
                 chat: CFG.chat.slice(-60), chatDay: CFG.chatDay } }) })
        .catch(function () {});
    }, 1200);
  }
  function pullPrefs() {
    if (typeof api !== "function") return Promise.resolve();
    var list = prefBody(); if (!list.length) return Promise.resolve();
    return api("/api/hub/prefs", { method: "POST", body: JSON.stringify({ accounts: list }) })
      .then(function (j) {
        var p2 = j && j.prefs;
        if (!p2) return;
        /* берём серверные настройки, если их записали позже наших */
        if (Number(p2.at || 0) <= PREF_AT) return;
        PREF_AT = Number(p2.at || 0);
        CFG.risk = Object.assign(CFG.risk, p2.risk || {});
        CFG.week = p2.week || CFG.week;
        CFG.auto = Object.assign(CFG.auto, p2.auto || {});
        if (Array.isArray(p2.log)) CFG.log = p2.log.slice(0, 20);
        /* переписка общая: её видит каждый, кто подключил эти кошельки, и чистит админ */
        if (Array.isArray(p2.chat)) { CFG.chat = p2.chat.slice(-60); CFG.chatDay = p2.chatDay || ""; redrawChat(); }
        try { localStorage.setItem(LSK, JSON.stringify(CFG)); } catch (e) {}
        renderPanels();
      }).catch(function () {});
  }
  /* kind: "risk" — события лимитов и остановок, они попадают в карточку риска;
     всё остальное (планы, стратегии) туда не пишем, чтобы не мешалось */
  function logEvent(text, tone, kind) {
    CFG.log.unshift({ at: Date.now(), text: text, tone: tone || "info", kind: kind || "plan" });
    CFG.log = CFG.log.slice(0, 20); saveCfg();
  }
  function hhmm(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* итог за сегодня, записанный площадкой: фиксация сессии и разноска
     «Итог торгового дня» из админки — берём из той же истории кабинетов */
  function postedToday(a) {
    var items = HIST || [];
    var it = items.filter(function (x) { return x.site === a.site && String(x.acct) === String(a.acct); })[0];
    if (!it) return 0;
    var d = new Date(), p = function (n3) { return (n3 < 10 ? "0" : "") + n3; };
    var today = p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
    var row = (it.days || []).filter(function (x) { return x.date === today; })[0];
    return row ? num(row.amount) : 0;
  }

  var DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  function todayIdx() { var d = new Date().getDay(); return d === 0 ? 6 : d - 1; }

  /* ---------- общие метрики портфеля ---------- */
  function metrics() {
    var list = accs();
    var total = list.reduce(function (s2, a) { return s2 + num(a.balance); }, 0);
    var run = list.filter(function (a) { return (typeof winOf === "function") && winOf(a); });
    var keys = list.filter(live).length;
    /* статус верификации приходит с площадки; пока он не загружен, кошелёк
       считаем «неизвестным» и не пишем, что по нему надо что-то подавать */
    var known = list.filter(function (a) { return !!stOf(a).kyc; });
    var kyc = known.filter(function (a) { return stOf(a).kyc === "approved"; }).length;
    var kycWait = known.filter(function (a) { return stOf(a).kyc === "pending"; }).length;
    var kycNeed = known.filter(function (a) {
      var st = stOf(a).kyc; return st && st !== "approved" && st !== "pending"; });
    var out = list.filter(function (a) { return (typeof outOk === "function") && outOk(a); }).length;
    var ks = list.map(function (a) {
      var p2 = (typeof paramsFor === "function") ? paramsFor(a) : (S && S.params) || {};
      return num(p2.k) || 1.3;
    });
    var avgK = ks.length ? ks.reduce(function (s2, x) { return s2 + x; }, 0) / ks.length : 1.3;
    var maxShare = total ? Math.max.apply(null, list.map(function (a) { return num(a.balance) / total; }).concat([0])) : 0;
    var day = list.reduce(function (s2, a) {
      return s2 + ((typeof todayOf === "function") ? todayOf(a) : 0) + postedToday(a);
    }, 0);
    var posted = list.reduce(function (s2, a) { return s2 + postedToday(a); }, 0);
    return { list: list, total: total, run: run, keys: keys, kyc: kyc, out: out,
             known: known, kycWait: kycWait, kycNeed: kycNeed,
             avgK: avgK, maxShare: maxShare, day: day, posted: posted };
  }
  /* индекс устойчивости: 100 — ровный портфель с ключами, лимитами и спокойными коэффициентами */
  /* Индекс устойчивости и разбор по пунктам: что добавит баллов до 100,
     а что их съедает — иксы, непрогретые счета, превышение порога за сутки. */
  function healthCalc(m) {
    var n = m.list.length || 1;
    var w = warmInfo(m.list);
    var pair = (typeof S !== "undefined" && S.params && S.params.pair) || "XAU/USD";
    var gain = gainOf(sel(), coefNow(), 1, pair);
    var v = 42, up = [], down = [];
    var keyP = 14 * (m.keys / n); v += keyP;
    if (m.keys < n) up.push(["активировать ключи на " + (n - m.keys) + " кошельк(ах)", 14 - keyP]);
    var kn = (m.known && m.known.length) || 0;
    var kycP = kn ? 8 * (m.kyc / kn) : 8; v += kycP;
    if (m.kycNeed && m.kycNeed.length) {
      up.push(["пройти верификацию по " + m.kycNeed.length + " кошельк(ам)", 8 - kycP]);
    }
    var warmP = 22 * (w.n ? w.warm.length / w.n : 0); v += warmP;
    if (w.cold.length) {
      up.push(["прогреть " + w.cold.length + " кошельк(ов): до " + money(WARM_SUM) + " на счёте и " +
        WARM_DAYS + " дней с регистрации", 22 - warmP]);
    }
    var outP = 6 * (m.out / n); v += outP;
    if (m.out < n) up.push(["открыть вывод " + (n - m.out) + " кошельк(ам): порог и адрес задаёт администратор", 6 - outP]);
    var kPen = 20 * Math.max(0, Math.min(1, (m.avgK - 1.2) / 1.6)); v -= kPen;
    if (kPen >= 1) {
      down.push(["средний коэффициент ×" + m.avgK.toFixed(2).replace(".", ",") +
        " — счета дают слишком большие иксы", kPen]);
    }
    var sPen = 10 * Math.max(0, Math.min(1, (m.maxShare - 0.3) / 0.5)); v -= sPen;
    if (sPen >= 1) down.push(["в одном кошельке " + Math.round(m.maxShare * 100) + "% капитала", sPen]);
    var capPen = Math.min(25, gain > CAP ? 25 * ((gain - CAP) / CAP) + 8 : 0); v -= capPen;
    if (capPen >= 1) {
      down.push(["выбранный сценарий даёт " + money(gain) + " за сутки — выше порога " + money(CAP), capPen]);
    }
    var coldRun = w.cold.filter(working).length;
    if (coldRun) {
      var cp = Math.min(14, coldRun * 2.5); v -= cp;
      down.push([coldRun + " непрогретых кошельк(ов) уже в работе — именно такие уходят на модерацию", cp]);
    }
    if (m.total > 0 && m.day < 0) {
      var dp = 8 * Math.min(1, Math.abs(m.day) / (m.total * 0.03)); v -= dp;
      down.push(["минус по дню " + sig(m.day), dp]);
    }
    /* мелочь ниже балла в разбор не выносим — она только шумит */
    up = up.filter(function (x) { return x[1] >= 1; }).sort(function (a, b) { return b[1] - a[1]; });
    down = down.filter(function (x) { return x[1] >= 1; }).sort(function (a, b) { return b[1] - a[1]; });
    return { score: Math.max(5, Math.min(100, Math.round(v))), up: up, down: down,
             warm: w, gain: gain, coldRun: coldRun };
  }
  function health(m) { return healthCalc(m).score; }
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
    if (m.kycNeed && m.kycNeed.length) {
      out.push(["Отправить заявки на верификацию по " + m.kycNeed.length + " кошельк(ам)",
        function () { doKyc(); }]);
    }
    var wi0 = warmInfo(sel());
    if (wi0.cold.length && wi0.warm.length && wi0.pct >= 50) {
      out.push(["Оставить в работе только прогретые кошельки — " + wi0.warm.length + " из " + wi0.n,
        function () {
          if (typeof S === "undefined") return;
          S.sel.clear(); wi0.warm.forEach(function (a) { S.sel.add(kOf(a)); });
          if (typeof renderAll === "function") renderAll();
          logEvent("В выборе остались прогретые кошельки: " + wi0.warm.length, "ok");
          renderPanels();
          say("<b>Оставил прогретые кошельки.</b> " + warmNote(wi0.warm));
        }]);
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
    var m = metrics(), hc = healthCalc(m), h = hc.score;
    var tone = h >= 70 ? "#2BA87A" : (h >= 45 ? "#E2B23A" : "#E5484D");
    var steps = advSteps(m);
    var w = hc.warm;
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
      "<span>Капитал<b>" + money(m.total) + "</b></span>" +
      "<span>Сессий в работе<b>" + m.run.length + " из " + m.list.length + "</b></span>" +
      "<span>Ключи активны<b>" + m.keys + " из " + m.list.length + "</b></span>" +
      "<span>Средний коэффициент<b>×" + m.avgK.toFixed(2).replace(".", ",") + "</b></span>" +
      "<span>Прогретых кошельков<b class='" + (w.cold.length && w.pct >= 50 ? "down" : "up") + "'>" +
      w.warm.length + " из " + w.n + (w.cold.length ? " · в прогреве " + w.cold.length : "") + "</b></span>" +
      "<span>Итог дня по сценарию<b class='" + (hc.gain > CAP ? "down" : "up") + "'>" +
      money(hc.gain) + "</b></span>" +
      "<span>Итог за сегодня<b class='" + (m.day >= 0 ? "up" : "down") + "'>" + sig(m.day) + "</b></span>" +
      "</div><ol class='ai-steps'>" +
      steps.map(function (st, i) {
        return "<li>" + esc(st[0]) + ' <button class="btn btn-sm" data-adv="' + i + '">сделать</button></li>';
      }).join("") + "</ol></div></div>" +
      /* адаптивный разбор: что поднимет индекс и что его тянет вниз */
      '<div class="ai-why">' +
      '<div class="ai-why-c up"><b>Что поднимет индекс до 100</b>' +
      (hc.up.length
        ? "<ul>" + hc.up.slice(0, 4).map(function (x) {
            return "<li>" + esc(x[0]) + " <span>+" + Math.round(x[1]) + "</span></li>";
          }).join("") + "</ul>"
        : "<p>Добавить нечего: ключи активны, счета прогреты, вывод открыт.</p>") + "</div>" +
      '<div class="ai-why-c down"><b>Что увеличивает риск</b>' +
      (hc.down.length
        ? "<ul>" + hc.down.slice(0, 4).map(function (x) {
            return "<li>" + esc(x[0]) + " <span>−" + Math.round(x[1]) + "</span></li>";
          }).join("") + "</ul>"
        : "<p>Рисков не вижу: иксы спокойные, порог не превышен, непрогретые счета не в работе.</p>") +
      "</div></div>" +
      '<p class="note" style="margin-top:9px">' + warmNote(sel()) + "</p>" +
      "";
    return { html: html, wire: function (box) {
      box.querySelectorAll("[data-adv]").forEach(function (b) {
        b.onclick = function () { steps[+b.dataset.adv][1](); };
      });
    } };
  }

  /* ---------- 2. расписание сценариев на неделю ---------- */
  /* Кошельки на группы не делим: в работу может идти весь портфель. Ограничений два —
     порог дохода за сутки и прогрев счетов: выше порога сценарий проверяют, а непрогретые
     кошельки на резком росте уходят на модерацию. */
  /* сколько кошельков реально стартует по этой паре: без ключа золото закрыто */
  function runnable(pair) {
    return sel().filter(function (a) { return !(typeof goldBlocked === "function" && goldBlocked(a, pair)); });
  }
  /* итог недели считаем по-честному: доход каждого дня ложится в депозит следующего */
  function weekForecast() {
    var m = metrics();
    var bal = {};
    sel().forEach(function (a) { bal[kOf(a)] = num(a.balance); });
    var base = Object.keys(bal).reduce(function (s2, k) { return s2 + bal[k]; }, 0);
    var gain = 0, rows = [], prev = null, warn = [];
    for (var i = 0; i < 5; i++) {
      var w = CFG.week[i];
      if (!w || !w.pair) { rows.push(null); prev = null; continue; }
      var share = num(w.share) || 0.3;
      var grp = runnable(w.pair);
      var kk = capK(num(w.k), w.pair);
      /* в один день портфель не должен давать больше порога: берём кошельки
         от меньшего депозита, пока итог дня укладывается в потолок */
      var sorted = grp.slice().sort(function (x, y) { return bal[kOf(x)] - bal[kOf(y)]; });
      var use = [], g = 0;
      sorted.forEach(function (a) {
        var add = bal[kOf(a)] * (kk - 1);
        if (g + add > CAP) return;
        use.push(a); g += add;
      });
      use.forEach(function (a) { bal[kOf(a)] += bal[kOf(a)] * (kk - 1); });
      var cut = grp.length - use.length;
      gain += g;
      /* два дня подряд та же пара тем же составом — повод для модерации */
      if (prev && prev.pair === w.pair) warn.push(DAYS[i - 1] + "–" + DAYS[i]);
      rows.push({ day: DAYS[i], pair: w.pair, k: num(w.k), share: share,
                  run: use.length, cut: cut, gain: g,
                  cap: Object.keys(bal).reduce(function (s2, k2) { return s2 + bal[k2]; }, 0) });
      prev = w;
    }
    /* худший счёт за неделю: именно по нему площадка задаёт вопросы */
    var worst = 0;
    sel().forEach(function (a) {
      var k = kOf(a), was = num(a.balance);
      if (was > 0) worst = Math.max(worst, (bal[k] - was) / was * 100);
    });
    return { rows: rows, gain: gain, base: base, cap: base + gain,
             total: m.list.length, worst: worst, repeat: warn };
  }

  function weekPlanSuggest() {
    var m = metrics();
    var gold = pairsOf("gold")[0] || "XAU/USD";
    var crypto = pairsOf("crypto"); if (!crypto.length) crypto = ["BTC/USD"];
    var stock = pairsOf("stock"); if (!stock.length) stock = crypto;
    /* пары чередуем: один и тот же инструмент не идёт два дня подряд */
    var line = [
      { pair: m.keys ? gold : crypto[0], k: 1.3 },
      { pair: crypto[0], k: 1.4 },
      { pair: stock[0], k: 1.3 },
      { pair: crypto[1] || crypto[0], k: 1.5 },
      { pair: m.keys ? gold : stock[0], k: 1.3 }
    ];
    CFG.week = {};
    line.forEach(function (x, i) {
      var grp = runnable(x.pair);
      /* ни один день плана не должен давать больше порога за сутки */
      var k = Math.min(x.k, capCoef(grp.length ? grp : sel(), null, x.pair, DAY_TARGET));
      CFG.week[i] = { pair: x.pair, k: k, share: 0.3 };
    });
    saveCfg();
    logEvent("План недели собран: коэффициенты подобраны под порог " + money(CAP) + " за сутки", "ok");
  }

  /* спокойный вариант плана: те же пары, но коэффициенты у нижней границы */
  function calmPlan() {
    var keep = CFG.week;
    CFG.week = {};
    Object.keys(keep).forEach(function (i) {
      var w = keep[i]; if (!w || !w.pair) return;
      CFG.week[i] = { pair: w.pair, k: kindOf(w.pair) === "crypto" ? 1.3 : 1.2, share: 0.2 };
    });
    saveCfg();
    logEvent("План недели пересобран спокойно: ×1,2–×1,3 и 20% депозита в работе", "ok");
  }
  function weekCard() {
    var f = weekForecast();
    var all = (typeof S !== "undefined" && S.pairs) ? Object.keys(S.pairs) : [];
    var pct = f.base > 0 ? f.gain / f.base * 100 : 0;
    /* на модерацию смотрят по отдельному счёту: рост портфеля сам по себе не страшен */
    var hot = pct > 30 || f.worst > 45 || f.repeat.length;
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
          }).join("")) + "</select>" +
        "</div>";
    }).join("");
    var plan = f.rows.filter(Boolean);
    var html =
      '<div class="panel-head"><h3>Расписание сценариев на неделю</h3>' +
      '<span class="muted">' + (CFG.auto.on ? "автозапуск в " + CFG.auto.hour + ":00" : "автозапуск выключен") +
      "</span></div>" +
      '<div class="ai-week">' + cells + "</div>" +
      (plan.length
        ? '<table class="ai-table" style="margin-top:12px"><tr><th>День</th><th>Пара</th><th>Коэф.</th>' +
          "<th>Итог дня</th><th>Портфель после</th><th>Кошельков</th></tr>" +
          plan.map(function (r) {
            return "<tr><td>" + r.day + "</td><td>" + esc(r.pair) + "</td><td>×" +
              String(r.k).replace(".", ",") + "</td><td>" + sig(r.gain) + "</td><td>" +
              money(r.cap) + "</td><td>" + r.run + " из " + f.total +
              (r.cut ? " <span class=\"muted\">· " + r.cut + " ждут</span>" : "") + "</td></tr>";
          }).join("") + "</table>" +
          '<p class="note" style="margin-top:9px">Итог недели по плану: <b>' + sig(f.gain) + "</b> к " +
          money(f.base) + " — это " + (pct >= 0 ? "+" : "") + pct.toFixed(1) +
          "% к портфелю, самый быстрый счёт прибавит " + f.worst.toFixed(1) + "%. " +
          "В работу идут выбранные кошельки, которым доступна пара дня; если итог дня выходит " +
          "за " + money(CAP) + ", часть кошельков в этот день остаётся без сценария.</p>" +
          '<p class="note" style="margin-top:7px">' + warmNote(sel()) + "</p>"
        : '<p class="note" style="margin-top:10px">План не задан — нажмите «Подобрать план», и я разложу неделю ' +
          "по вашим парам и аккаунтам.</p>") +
      (hot
        ? '<p class="note pair-warn" style="margin-top:9px"><b>Риск модерации.</b> ' +
          (f.repeat.length
            ? "Одна и та же пара идёт два дня подряд (" + f.repeat.join(", ") +
              ") — площадка считает это шаблонной торговлей. "
            : "") +
          (f.worst > 45 ? "Отдельный счёт прибавляет " + f.worst.toFixed(0) + "% за неделю. " : "") +
          (pct > 30 ? "Портфель растёт на " + pct.toFixed(0) + "% за неделю. " : "") +
          "Такие аккаунты отправляют на проверку и могут заморозить вывод. Не рекомендую: " +
          "поставьте ×1,2–×1,3 и чередуйте пары по дням — тогда иксы ниже, а счёт выглядит спокойным.</p>"
        : "") +
      '<div class="ai-row">' +
      '<button class="btn btn-sm btn-primary" id="aiWeekFill">Подобрать план</button>' +
      '<button class="btn btn-sm" id="aiWeekToday">Применить план на сегодня</button>' +
      (hot ? '<button class="btn btn-sm" id="aiWeekCalm">Сделать план спокойнее</button>' : "") +
      (plan.length ? '<button class="btn btn-sm" id="aiWeekClear">Очистить расписание</button>' : "") +
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
      var fb = box.querySelector("#aiWeekFill");
      if (fb) fb.onclick = function () { weekPlanSuggest(); renderPanels(); weekRoster(); };
      var t = box.querySelector("#aiWeekToday");
      if (t) t.onclick = function () { applyToday(true); };
      var c = box.querySelector("#aiWeekCalm");
      if (c) c.onclick = function () { calmPlan(); renderPanels(); weekRoster(); };
      var cl = box.querySelector("#aiWeekClear");
      if (cl) cl.onclick = function () {
        /* расписание стирается целиком: автозапуску тогда нечего ставить */
        CFG.week = {};
        CFG.auto.on = false;
        saveCfg(); renderPanels();
        logEvent("Расписание недели очищено", "info");
        say("<b>Расписание очищено.</b> Планы на дни сняты, автозапуск выключен — " +
          "сценарии больше не будут ставиться по расписанию. Собрать заново — «Подобрать план».");
      };
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
  /* роспись: какие кошельки пойдут в работу, если план согласован */
  function weekRoster() {
    var f = weekForecast();
    var plan = f.rows.filter(Boolean);
    if (!plan.length) return say("План пустой — выберите пары в расписании.");
    var pct = f.base > 0 ? f.gain / f.base * 100 : 0;
    var today = f.rows[todayIdx()];
    var wToday = CFG.week[todayIdx()] || {};
    var list = today ? runnable(today.pair) : [];
    var blocked = today ? sel().filter(function (a) { return list.indexOf(a) < 0; }) : [];
    var m = say("<b>План на неделю готов.</b> Сам я его не запускаю — запуск только по вашему согласованию." +
      "<table><tr><th>День</th><th>Пара</th><th>Коэф.</th><th>Итог дня</th></tr>" +
      plan.map(function (r) {
        return "<tr><td>" + r.day + "</td><td>" + esc(r.pair) + "</td><td>×" +
          String(r.k).replace(".", ",") + "</td><td>" + sig(r.gain) + "</td></tr>";
      }).join("") + "</table>" +
      "<br>Итог недели: <b>" + sig(f.gain) + "</b> (" + (pct >= 0 ? "+" : "") + pct.toFixed(1) +
      "% к портфелю, самый быстрый счёт +" + f.worst.toFixed(1) + "%). В работу идут все выбранные " +
      "кошельки, которым доступна пара дня — ограничение одно: итог дня не выше " + money(CAP) + "." +
      "<br>" + warmNote(sel()) +
      (f.repeat.length
        ? "<br><b>Риск модерации:</b> одна и та же пара идёт два дня подряд (" + f.repeat.join(", ") +
          ") — площадка может отправить такие счета на проверку и заморозить вывод."
        : "") +
      ((pct > 30 || f.worst > 45)
        ? "<br><b>Не рекомендую такой разгон:</b> аккаунты с таким ростом уходят на модерацию и их могут " +
          "заблокировать. Спокойнее ×1,2–×1,3 — или оставить эту стратегию только на прогретых кошельках."
        : "") +
      (today
        ? "<br><br><b>Если согласуете, сегодня (" + today.day + ") в работу пойдут " + list.length +
          " кошельк(ов):</b><ul>" + list.slice(0, 10).map(function (a) {
            return "<li>#" + esc(a.acct) + " · " + esc(a.siteName || a.site) + " · " + money(num(a.balance)) +
              " → " + esc(today.pair) + " ×" + String(today.k).replace(".", ",") + "</li>";
          }).join("") + (list.length > 10 ? "<li>и ещё " + (list.length - 10) + "</li>" : "") + "</ul>" +
          (blocked.length ? "Пара дня недоступна " + blocked.length + " кошельк(ам): " +
            blocked.slice(0, 6).map(function (a) { return "#" + esc(a.acct); }).join(", ") +
            (blocked.length > 6 ? " и др." : "") + "." : "")
        : "<br>Сегодня плана нет — ближайший запуск по расписанию в следующий торговый день."));
    var btns = [["Согласовать и запустить сегодня", function () {
      applyToday(true);
      if (typeof runKeys === "function" && list.length) runKeys(list.map(kOf));
    }], ["Только сохранить план", function () { say("Хорошо, план сохранён — запущу, когда скажете."); }, true]];
    if (pct > 30) btns.push(["Сделать спокойнее", function () { calmPlan(); renderPanels(); weekRoster(); }, true]);
    act(m, btns);
  }

  /* применяем план сегодняшнего дня к выбранным кошелькам */
  function applyToday(manual) {
    var w = CFG.week[todayIdx()];
    if (!w || !w.pair) { if (manual) say("На сегодня план не задан — нажмите «Подобрать план» или выберите пару в расписании."); return; }
    var list = runnable(w.pair);
    if (!list.length) { if (manual) say("Нет кошельков, которым доступна пара этого дня."); return; }
    var bad = sel().filter(function (a) { return list.indexOf(a) < 0; });
    var gDay = gainOf(list, num(w.k) || 1.6, 1, w.pair);
    var trimmed = 0;
    if (gDay > CAP) {
      /* порог держим сами: оставляем в работе столько кошельков, сколько в него помещается */
      var fit = capFit("count", list, num(w.k) || 1.6, w.pair);
      trimmed = list.length - fit.list.length;
      list = fit.list;
      gDay = fit.gain;
      if (!list.length) {
        if (manual) {
          capWarn({ list: sel(), k: num(w.k) || 1.6, pair: w.pair, force: true });
          say("План на сегодня даёт больше " + money(CAP) + " за сутки даже по одному кошельку — " +
            "снизьте коэффициент в окне предупреждения.");
        }
        return;
      }
    }
    list.forEach(function (a) {
      if (bad.indexOf(a) >= 0) return;
      S.per[kOf(a)] = { pair: w.pair, hours: 24, k: num(w.k) || 1.6, share: num(w.share) || 0.6, dir: "up" };
    });
    if (typeof renderAll === "function") renderAll();
    logEvent("План дня применён: " + w.pair + " ×" + String(w.k).replace(".", ","), "ok");
    var m = say("<b>План на сегодня проставлен:</b> " + esc(w.pair) + " ×" + String(w.k).replace(".", ",") +
      " — это " + list.length + " кошельк(ов), итог дня " + money(gDay) + "." +
      (trimmed ? "<br>Ещё " + trimmed + " кошельк(ов) сегодня без сценария: с ними итог дня вышел бы " +
        "за порог " + money(CAP) + "." : "") +
      (bad.length ? "<br>Ещё " + bad.length + " кошельк(ам) эта пара недоступна." : "") +
      "<br>" + warmNote(list));
    act(m, [["Запустить сейчас", function () {
      if (typeof runKeys === "function") runKeys(list.map(kOf));
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
    var list = runnable(w.pair)
      .filter(function (a) { return !(typeof winOf === "function" && winOf(a)); });
    if (!list.length) return;
    /* автозапуск никогда не выходит за порог суточного дохода */
    if (gainOf(list, num(w.k) || 1.6, 1, w.pair) > CAP) {
      logEvent("Автозапуск придержан: план дня выше порога " + money(CAP) + " за сутки", "warn", "risk");
      say("<b>Автозапуск придержал.</b> План на сегодня даёт больше " + money(CAP) +
        " за сутки — такие сценарии площадки проверяют. Поправьте план, и я запущу.");
      AUTO_DONE = stamp;
      return;
    }
    AUTO_DONE = stamp;
    list.forEach(function (a) {
      S.per[kOf(a)] = { pair: w.pair, hours: 24, k: num(w.k) || 1.6, share: num(w.share) || 0.6, dir: "up" };
    });
    if (typeof runKeys === "function") runKeys(list.map(kOf));
    logEvent("Автозапуск: " + w.pair + " ×" + String(w.k).replace(".", ",") + " · " +
      list.length + " кошельков", "ok");
    say("<b>Автозапуск сработал.</b> Поставил план дня — " + esc(w.pair) + " ×" +
      String(w.k).replace(".", ",") + " на " + list.length + " кошельк(ах).");
    renderPanels();
  }

  /* ---------- фиксация итога дня сразу всем кошелькам обеих площадок ---------- */
  /* Это администраторское действие: оно пишет итог в кабинет каждому клиенту,
     поэтому ключ администратора вводит сам пользователь, а отменить запуск
     можно в админке площадки — он сохраняется пачкой, как разноска итога дня. */
  var AK = "vxAdmKey";
  function admKey() {
    var k = "";
    try { k = sessionStorage.getItem(AK) || ""; } catch (e) {}
    if (!k) {
      k = (window.prompt("Ключ администратора площадки — нужен, чтобы записать итог дня всем кошелькам") || "").trim();
      if (k && !/[^\x20-\xFF]/.test(k)) { try { sessionStorage.setItem(AK, k); } catch (e) {} }
    }
    return k;
  }
  function admPost(url, body) {
    var k = admKey();
    if (!k) return Promise.reject(new Error("без ключа администратора это действие не выполнить"));
    return fetch(url, { method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": k },
      body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ("ошибка " + r.status));
        return j;
      });
    });
  }
  function fixDayAll() {
    var m = busy("Смотрю, по каким кошелькам есть что записать");
    return admPost("/api/admin/fix-day-all", { dry: true }).then(function (pre) {
      if (!pre.applied) {
        return fill(m, "<b>Записывать нечего.</b> Ни по одному кошельку сегодня нет запущенного сценария " +
          "с результатом — или итог за сегодня уже записан.");
      }
      fill(m, "<b>Итог дня готов к записи: " + pre.applied + " кошельк(ов), " + sig(pre.total) + "</b>" +
        "<ul>" + (pre.sites || []).map(function (x) {
          return "<li>" + esc(x.siteName || x.site) + " — " + (x.count || 0) + " кошельк(ов), " +
            sig(x.total || 0) + "</li>";
        }).join("") + "</ul>" +
        "Запись уйдёт в кабинет каждому клиенту строкой «Итог торгового дня», баланс зафиксируется " +
        "на достигнутом значении, сценарии завершатся. Отменить можно в админке площадки — " +
        "запуск сохранится пачкой, как обычная разноска итога дня.");
      var node = $("aiBody").lastChild;
      act(node, [["Записать всем", function () {
        var b2 = busy("Записываю итог дня");
        admPost("/api/admin/fix-day-all", {}).then(function (j) {
          fill(b2, "<b>Готово: " + j.applied + " кошельк(ов), " + sig(j.total) + " за " + esc(j.date) + "</b>" +
            "<ul>" + (j.sites || []).map(function (x) {
              return "<li>" + esc(x.siteName || x.site) + " — " + (x.count || 0) + " записей</li>";
            }).join("") + "</ul>" +
            "В админке площадки этот запуск виден в списке разносок — там же его можно отменить.");
          logEvent("Итог дня записан всем: " + j.applied + " кошельков", "ok");
          if (typeof refresh === "function") refresh();
          pullHist().then(renderPanels);
        }).catch(function (e) { fill(b2, "Не получилось: " + esc(e.message)); });
      }], ["Отмена", function () {}, true]]);
    }).catch(function (e) { fill(m, "Не получилось: " + esc(e.message)); });
  }

  /* отмена всех сценариев с фиксацией результата — тем же путём, что итог дня */
  function stopAllFix() {
    var m = busy("Смотрю, какие сценарии сейчас в работе");
    return admPost("/api/admin/fix-day-all", { dry: true }).then(function (pre) {
      if (!pre.applied) return fill(m, "<b>Запущенных сценариев нет.</b> Останавливать нечего.");
      fill(m, "<b>В работе " + pre.applied + " сценари(ев), результат " + sig(pre.total) + "</b>" +
        "<ul>" + (pre.sites || []).map(function (x) {
          return "<li>" + esc(x.siteName || x.site) + " — " + (x.count || 0) + " кошельк(ов), " +
            sig(x.total || 0) + "</li>";
        }).join("") + "</ul>" +
        "Остановлю их все и зафиксирую результат: баланс каждого кошелька встанет на достигнутом " +
        "значении, в кабинет клиента уйдёт строка «Итог торгового дня». Отменить можно в админке.");
      act($("aiBody").lastChild, [["Остановить и зафиксировать", function () {
        var b2 = busy("Останавливаю сценарии");
        admPost("/api/admin/fix-day-all", {}).then(function (j) {
          fill(b2, "<b>Остановлено " + j.applied + " сценари(ев), зафиксировано " + sig(j.total) + "</b><br>" +
            "Балансы сохранены, записи за " + esc(j.date) + " в кабинетах клиентов. " +
            "Пачку можно отменить в админке площадки.");
          logEvent("Все сценарии остановлены с фиксацией: " + j.applied + " кошельков", "warn", "risk");
          if (typeof refresh === "function") refresh();
          pullHist().then(renderPanels);
        }).catch(function (e) { fill(b2, "Не получилось: " + esc(e.message)); });
      }], ["Отмена", function () {}, true]]);
    }).catch(function (e) { fill(m, "Не получилось: " + esc(e.message)); });
  }

  /* ---------- тепловая карта вывода ----------
     По каждому кошельку смотрим три вещи: сколько на нём денег, как давно он
     зарегистрирован и когда с него last выводили. Площадка считает счёт
     «прогретым», когда он отлежался и набрал объём: с такого вывод проходит
     спокойно. Свежий кошелёк с небольшой суммой лучше не трогать — иначе
     статус прогрева сбрасывается и заявку отправят на проверку. */
  var WARM_SUM = 50000;      /* с этой суммы кошелёк считаем прогретым */
  var WARM_DAYS = 90;        /* три месяца с регистрации */
  var OUT_GAP = 4;           /* дней после прошлого вывода */
  var OUT_MIN = 5000;        /* с этой суммы заявку уже примут */
  function histOf(a) {
    return (HIST || []).filter(function (x) {
      return x.site === a.site && String(x.acct) === String(a.acct);
    })[0] || {};
  }
  function daysFrom(v) {
    var t = v ? new Date(v).getTime() : 0;
    if (!t || isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }
  function ruToDays(d) {
    var p2 = String(d || "").split(".");
    if (p2.length < 3) return null;
    var t = new Date(+p2[2], +p2[1] - 1, +p2[0]).getTime();
    return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
  }
  function outState(a) {
    var h = histOf(a);
    var bal = num(a.balance);
    var age = daysFrom(a.created || h.created);
    /* история выводов кошелька: даты и суммы — по ним видно, когда выводили */
    var outs = (h.payouts || []).map(function (x) {
      return { date: x.date, amount: num(x.amount), ago: ruToDays(x.date) };
    }).filter(function (x) { return x.ago !== null; }).sort(function (x, y) { return x.ago - y.ago; });
    var lastOut = outs.length ? outs[0].ago : null;
    var open = (typeof outOk === "function") ? outOk(a) : false;
    /* сколько осталось до прогрева: дней с регистрации и денег на счёте */
    var daysLeft = (age === null) ? null : Math.max(0, WARM_DAYS - age);
    var needSum = Math.max(0, WARM_SUM - bal);
    var base = { outs: outs, lastOut: lastOut, age: age, bal: bal,
                 daysLeft: daysLeft, needSum: needSum, gapLeft: null };
    function mk(tone, title, why, rec) {
      return Object.assign({}, base, { tone: tone, title: title, why: why, rec: rec });
    }
    /* порядок проверок — от жёстких запретов к рекомендациям */
    if (!open) {
      return mk("off", "Вывод закрыт",
        (typeof outTxt === "function" ? outTxt(a) : "нет привязанного адреса или сумма ниже порога"),
        "выводить нельзя: порог суммы и адрес задаёт администратор площадки");
    }
    if (lastOut !== null && lastOut <= OUT_GAP) {
      base.gapLeft = Math.max(0, OUT_GAP + 1 - lastOut);
      return mk("wait", "Недавний вывод",
        "последняя заявка " + lastOut + " дн. назад (" + outs[0].date + ", " + money(outs[0].amount) + ")",
        "не рекомендую: заявки подряд площадка проверяет. Подождать ещё " +
          Math.max(0, OUT_GAP + 1 - lastOut) + " дн.");
    }
    if (bal >= WARM_SUM) {
      return mk("warm", "Кошелёк прогрет",
        "на счёте " + money(bal) + (age !== null ? ", возраст " + age + " дн." : ""),
        "вывод доступен — счёт набрал объём, вопросов к заявке не будет");
    }
    if (bal > OUT_MIN) {
      return mk("ok", "Вывод возможен, но не рекомендуется",
        "на счёте " + money(bal) + (age !== null ? ", возраст " + age + " дн." : ""),
        "заявку примут, но прогрев сбросится: не хватает " + money(needSum) +
          (daysLeft ? " и " + daysLeft + " дн. до " + WARM_DAYS + "-дневного срока" : ""));
    }
    return mk("cold", "Прогрев не завершён",
      "на счёте " + money(bal) + " — меньше " + money(OUT_MIN) +
        (age !== null ? ", кошельку " + age + " дн." : ""),
      "выводить рано: до прогрева не хватает " + money(needSum) +
        (daysLeft ? " и " + daysLeft + " дн." : ""));
  }
  var TONES = {
    warm: ["Прогрет, вывод доступен", "#2BA87A"],
    ok:   ["Вывод возможен, не рекомендуется", "#5B8CFF"],
    cold: ["Прогрев не завершён", "#E2B23A"],
    wait: ["Недавний вывод", "#A78BFA"],
    off:  ["Вывод закрыт", "#E5484D"]
  };
  var HEAT_PICK = "";
  function heatCard() {
    var list = accs();
    var cells = list.map(function (a) {
      var st = outState(a);
      return { a: a, st: st };
    });
    var by = {};
    Object.keys(TONES).forEach(function (t) { by[t] = 0; });
    cells.forEach(function (c) { by[c.st.tone] = (by[c.st.tone] || 0) + 1; });
    var ready = cells.filter(function (c) { return c.st.tone === "warm" || c.st.tone === "ok"; });
    var sum = ready.reduce(function (s2, c) { return s2 + num(c.a.balance); }, 0);
    var html =
      '<div class="panel-head"><h3>Тепловая карта вывода</h3>' +
      '<span class="muted">' + ready.length + " из " + list.length + " кошельков готовы · " +
      money(sum) + "</span></div>" +
      (list.length
        ? '<div class="heat">' + cells.map(function (c, i) {
            return '<button class="heat-c ' + c.st.tone + (HEAT_PICK === kOf(c.a) ? " pick" : "") +
              '" data-heat="' + i + '" title="#' +
              esc(c.a.acct) + " · " + esc(c.st.title) + "\">" +
              "<b>#" + esc(String(c.a.acct).slice(-4)) + "</b>" +
              "<span>" + money(num(c.a.balance)).replace(/,\d\d$/, "") + "</span></button>";
          }).join("") + "</div>"
        : '<p class="note">Кошельки не подключены.</p>') +
      '<div class="heat-leg">' + Object.keys(TONES).map(function (t) {
        return '<span class="heat-l ' + t + '"><i></i>' + TONES[t][0] + " — " + (by[t] || 0) + "</span>";
      }).join("") + "</div>" +
      '<div id="heatInfo" class="note" style="margin-top:10px">Нажмите на квадрат — покажу даты выводов, ' +
      "рекомендацию и сколько осталось до прогрева. " +
      "почему именно такой статус. Прогретым считаю счёт от " + money(WARM_SUM) +
      "; свежим — моложе " + WARM_DAYS + " дней; выводы учитываю по истории кабинета, " +
      "включая разнесённые из админки.</div>";
    return { html: html, wire: function (box) {
      function show(c, box2) {
          var info = box2.querySelector("#heatInfo");
          if (info) {
            var st = c.st;
            var warmLine = st.tone === "warm"
              ? "Счёт прогрет: на нём " + money(st.bal) + ", это выше " + money(WARM_SUM) + "."
              : "До прогрева: не хватает " + money(st.needSum) +
                (st.daysLeft === null ? "" : (st.daysLeft > 0
                  ? ", срок с регистрации — ещё " + st.daysLeft + " дн. из " + WARM_DAYS
                  : ", срок с регистрации уже выдержан")) + ".";
            info.className = "note" + (st.tone === "off" || st.tone === "cold" || st.tone === "wait"
              ? " pair-warn" : "");
            info.innerHTML = "<b>#" + esc(c.a.acct) + " · " + esc(c.a.siteName || c.a.site) + " — " +
              esc(st.title) + "</b><br>" + esc(st.why) +
              "<br><b>" + (st.tone === "warm" ? "Рекомендация: " : "Почему не рекомендую: ") + "</b>" +
              esc(st.rec) +
              "<br>" + warmLine +
              (st.outs.length
                ? "<br><b>Выводы по кошельку:</b> " + st.outs.slice(0, 4).map(function (x) {
                    return esc(x.date) + " — " + money(x.amount) + " (" + x.ago + " дн. назад)";
                  }).join("; ") + (st.outs.length > 4 ? " и ещё " + (st.outs.length - 4) : "")
                : "<br>Выводов по этому кошельку в истории нет.") +
              (st.gapLeft ? "<br>Следующую заявку лучше подать через " + st.gapLeft + " дн." : "") +
              (st.tone === "warm"
                ? "<br>Заявка создаётся кнопкой «Вывести средства» в карточке кошелька."
                : "");
          }
      }
      box.querySelectorAll("[data-heat]").forEach(function (b) {
        b.onclick = function () {
          var c = cells[+b.dataset.heat];
          HEAT_PICK = kOf(c.a);
          box.querySelectorAll(".heat-c").forEach(function (x) { x.classList.remove("pick"); });
          b.classList.add("pick");
          show(c, box);
        };
      });
      /* после перерисовки панели раскрытый кошелёк остаётся раскрытым */
      if (HEAT_PICK) {
        var keep = cells.filter(function (c) { return kOf(c.a) === HEAT_PICK; })[0];
        if (keep) show(keep, box);
      }
    } };
  }

  /* ответ в чате про прогрев и вывод: то же, что в тепловой карте, но словами */
  function doHeat() {
    var list = accs();
    if (!list.length) return say("Кошельки не подключены — прогрев считать не по чему.");
    var cells = list.map(function (a) { return { a: a, st: outState(a) }; });
    var by = {};
    cells.forEach(function (c) { (by[c.st.tone] = by[c.st.tone] || []).push(c); });
    var ready = (by.warm || []).concat(by.ok || []);
    var sum = ready.reduce(function (s2, c) { return s2 + num(c.a.balance); }, 0);
    return say("<b>Прогрев кошельков: " + ready.length + " из " + list.length + " готовы к выводу</b> · " +
      money(sum) +
      "<table><tr><th>Статус</th><th>Кошельков</th><th>Что это значит</th></tr>" +
      Object.keys(TONES).map(function (t) {
        var n2 = (by[t] || []).length;
        if (!n2) return "";
        var ex = (by[t] || []).slice(0, 4).map(function (c) { return "#" + esc(c.a.acct); }).join(", ");
        return "<tr><td>" + esc(TONES[t][0]) + "</td><td>" + n2 + "</td><td>" + ex +
          (n2 > 4 ? " и ещё " + (n2 - 4) : "") + "</td></tr>";
      }).join("") + "</table>" +
      "<br>Прогретым считаю счёт от " + money(WARM_SUM) + "; моложе " + WARM_DAYS +
      " дней — ещё в прогреве; вывод 3–4 дня назад — подряд заявки лучше не подавать." +
      "<br>" + warmNote(sel()));
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
    ["итог дня всем площадкам", "Запиши итог дня всем кошелькам обеих площадок"],
    ["отменить все сценарии", "Отмени все сценарии с фиксацией результата"],
    ["что с ключами", "Что с ключами и сроками?"],
    ["можно ли выводить", "Можно ли выводить средства?"],
    ["карта вывода", "Покажи тепловую карту вывода"],
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
    /* показатели советника: карточками, а не строчками — так читается сразу */
    ".ai-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:9px;font-size:12.2px;" +
    "color:var(--muted)}" +
    ".ai-kv span{display:block;border:1px solid var(--line);border-radius:12px;padding:9px 11px 7px;" +
    "background:rgba(255,255,255,.02);font-size:10.6px;text-transform:uppercase;letter-spacing:.05em}" +
    ".ai-kv b{display:block;color:var(--text);font-size:14.5px;margin-top:5px;font-variant-numeric:tabular-nums;" +
    "letter-spacing:-.01em;text-transform:none}" +
    ".ai-kv b.up{color:#6FE0B0}.ai-kv b.down{color:#F3A2A2}" +
    ".ai-why{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}" +
    "@media (max-width:760px){.ai-why{grid-template-columns:1fr}}" +
    ".ai-why-c{border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:12.4px}" +
    ".ai-why-c b{display:block;font-size:12px;margin-bottom:6px}" +
    ".ai-why-c.up b{color:#8FE3BE}.ai-why-c.down b{color:#F3A2A2}" +
    ".ai-why-c ul{margin:0;padding-left:16px;line-height:1.55}" +
    ".ai-why-c li{margin:3px 0}" +
    ".ai-why-c li span{color:var(--muted);font-variant-numeric:tabular-nums}" +
    ".ai-why-c p{margin:0;color:var(--muted);line-height:1.5}" +
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
    ".ai-cmds button:hover{border-color:var(--accent)}" +
    ".heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px}" +
    ".heat-c{font:inherit;cursor:pointer;border-radius:11px;padding:9px 6px;display:flex;transition:transform .15s,box-shadow .15s;" +
    "flex-direction:column;gap:3px;align-items:center;border:1px solid var(--line);background:var(--surface-2);color:var(--text)}" +
    ".heat-c b{font-size:12px}.heat-c span{font-size:10.5px;color:var(--muted)}" +
    ".heat-c.warm{border-color:#2BA87A;background:rgba(43,168,122,.18)}" +
    ".heat-c.ok{border-color:#5B8CFF;background:rgba(91,140,255,.16)}" +
    ".heat-c.cold{border-color:#E2B23A;background:rgba(226,178,58,.16)}" +
    ".heat-c.wait{border-color:#A78BFA;background:rgba(167,139,250,.2)}" +
    ".heat-c.wait b{color:#D6C9FF}" +
    ".heat-c:hover{transform:translateY(-1px)}" +
    ".heat-c:focus-visible,.heat-c:active,.heat-c.pick{box-shadow:0 0 0 2px var(--accent) inset;outline:0}" +
    ".heat-c.off{border-color:#E5484D;background:rgba(229,72,77,.14)}" +
    ".heat-c:hover{filter:brightness(1.25)}" +
    ".heat-leg{display:flex;flex-wrap:wrap;gap:12px;margin-top:11px;font-size:11.5px;color:var(--muted)}" +
    ".heat-l{display:inline-flex;align-items:center;gap:6px}" +
    ".heat-l i{width:9px;height:9px;border-radius:3px;display:inline-block}" +
    ".heat-l.warm i{background:#2BA87A}.heat-l.ok i{background:#5B8CFF}" +
    ".heat-l.cold i{background:#E2B23A}.heat-l.wait i{background:#A78BFA}.heat-l.off i{background:#E5484D}" +
    ".cap-ovl{position:fixed;inset:0;z-index:10050;background:rgba(60,6,10,.86);display:flex;" +
    "align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}" +
    ".cap-win{max-width:560px;width:100%;background:var(--surface);border:2px solid #E5484D;" +
    "border-radius:18px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}" +
    ".cap-h{font-size:18px;font-weight:700;color:#FF8A8D;margin-bottom:10px}" +
    ".cap-win p{font-size:13px;line-height:1.55;color:var(--text);margin:0 0 12px}" +
    ".cap-win .cap-note{font-size:12px;color:var(--muted)}" +
    ".cap-win .cap-warm{font-size:12.6px;line-height:1.5;color:#F3C7C7;background:#E5484D1a;" +
    "border:1px solid #E5484D55;border-radius:12px;padding:10px 12px;margin:0 0 12px}" +
    ".cap-opts{display:flex;flex-direction:column;gap:8px;margin:14px 0}" +
    ".cap-opts button{text-align:left;font:inherit;font-size:13px;font-weight:600;cursor:pointer;" +
    "padding:11px 13px;border-radius:12px;border:1px solid #E5484D55;background:#E5484D14;color:var(--text)}" +
    ".cap-opts button:hover{border-color:#E5484D;background:#E5484D22}" +
    ".cap-opts button span{display:block;font-weight:400;font-size:11.5px;color:var(--muted);margin-top:3px}" +
    ".cap-act{display:flex;justify-content:flex-end}" +
    ".cap-x{font:inherit;font-size:12.5px;cursor:pointer;padding:9px 14px;border-radius:11px;" +
    "border:1px solid var(--line);background:transparent;color:var(--muted)}";

  var PANELS = [
    ["aiAdv", advCard], ["aiWeek", weekCard],
    ["aiHeat", heatCard], ["aiCmd", cmdCard]
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
        /* пока пользователь что-то вводит в этой карточке, не перерисовываем её.
           Нажатая кнопка тоже остаётся активным элементом, но её перерисовать можно:
           иначе результат нажатия не виден сразу. */
        var ae = document.activeElement;
        if (ae && box.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
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
    dock(); filterRow(); renderPanels(); guardRun();
    if (!HIST) pullHist().then(renderPanels);
    if (!PREF_AT) pullPrefs();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 400); });
  else setTimeout(boot, 400);
  setInterval(boot, 1500);
  setInterval(function () { if ($("aiPanels")) renderPanels(); }, 6000);
  setInterval(function () { if ($("aiPanels")) pullHist().then(renderPanels); }, 60000);
  setInterval(function () { if ($("aiPanels")) pullPrefs(); }, 30000);
  setInterval(midnightTick, 30000);
  setInterval(function () { if ($("aiPanels")) { guardRun(); capTick(); } }, 4000);
  setInterval(function () { if ($("aiPanels")) { autoTick(); } }, 7000);
})();
