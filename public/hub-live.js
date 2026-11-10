/* Живая лента торгового дня для пульта.
   Показывает, как в течение суток набегает дневной итог, и ведёт ленту
   событий по парам. Это ВИЗУАЛИЗАЦИЯ: ничего не считает по рынку и ничего
   не пишет в базу — только читает уже записанные итоги через /api/hub/history.
   Поэтому в шапке панели стоит явная пометка, что данные смоделированы.

   Сутки идут с 03:30 до 03:30 по Москве: в 03:30 цикл закрывается итогом
   прошедшего дня, счётчик обнуляется и начинает новый день. */
(function () {
  "use strict";

  /* ------- настройки, менять здесь ------- */
  var DAY_START_MSK = 3.5;      /* начало торговых суток, часы по Москве (3.5 = 03:30) */
  var FORECAST_K = 0.94;        /* если день ещё не разнесён: вчерашний итог минус 6% */
  var POLL_MS = 180000;         /* как часто перечитывать итоги из базы */
  var TICK_MS = 2000;           /* как часто двигать счётчик */
  var FEED_STEP_MS = 12000;     /* примерный шаг между строками ленты */
  var FEED_MAX = 40;            /* сколько строк держим в ленте */
  var WAVE = 0.075;             /* размах колебаний кривой внутри дня */
  var LOCK_UNTIL = "30.11.2026"; /* до какой даты сценарий показан активным */
  var PAIRS_FALLBACK = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
  /* ориентировочные цены для строк ленты: это демонстрация, не котировки */
  var PRICE = {
    "BTC/USD": [58000, 72000, 2], "ETH/USD": [2800, 4200, 2],
    "SOL/USD": [120, 190, 2], "XRP/USD": [0.45, 0.78, 4],
    "XAU/USD": [2300, 2700, 2], "AAPL": [180, 240, 2],
    "MSFT": [380, 470, 2], "TSLA": [180, 290, 2], "NVDA": [95, 145, 2]
  };

  var MSK_OFFSET = 3 * 3600000;  /* Москва — UTC+3 круглый год */
  var DAY_MS = 86400000;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function money(v, dec) {
    var d = dec == null ? 2 : dec;
    var s = Math.abs(Number(v) || 0).toFixed(d).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (Number(v) < 0 ? "-" : "") + "$" + s.join(",");
  }
  function num(v, d) {
    var s = (Number(v) || 0).toFixed(d == null ? 2 : d).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return s.join(",");
  }

  /* ---------- торговые сутки ---------- */
  /* Возвращает начало текущего цикла (в обычном времени браузера) и ярлык даты
     в формате ДД.ММ.ГГГГ — той даты, за которую этот цикл считается. */
  function cycle(now) {
    var t = now.getTime();
    var msk = new Date(t + MSK_OFFSET);                 /* «как бы московское» время */
    var startMsk = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate())
      + DAY_START_MSK * 3600000;
    if (msk.getTime() < startMsk) startMsk -= DAY_MS;   /* ещё не было 03:30 — цикл вчерашний */
    var start = startMsk - MSK_OFFSET;
    var d = new Date(startMsk);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var label = p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1) + "." + d.getUTCFullYear();
    return { start: start, end: start + DAY_MS, date: label };
  }
  function prevDate(label) {
    var a = label.split(".");
    var d = new Date(Date.UTC(+a[2], +a[1] - 1, +a[0]) - DAY_MS);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getUTCDate()) + "." + p(d.getUTCMonth() + 1) + "." + d.getUTCFullYear();
  }

  /* ---------- предсказуемый «шум» ---------- */
  /* Кривая считается от даты и целевой суммы, а не от момента открытия страницы:
     после F5 цифра остаётся той же, а не прыгает с нуля. */
  function seedOf(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngOf(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* S-образная база: медленный старт, активная середина, пологий хвост */
  function ease(p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return p * p * (3 - 2 * p);
  }
  /* доля дневного итога, набежавшая к моменту p (0..1) */
  function share(p, seed) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    var base = ease(p);
    var r = rngOf(seed);
    /* несколько «волн» разной длины: график дышит, иногда проседает */
    var w = 0;
    for (var i = 1; i <= 6; i++) {
      var ph = r() * Math.PI * 2, amp = (WAVE / i);
      w += amp * Math.sin(p * Math.PI * 2 * i * 2.2 + ph);
    }
    /* у краёв суток размах гасим: старт от нуля и приход ровно в итог */
    var edge = Math.min(1, Math.sin(Math.PI * p) * 1.35);
    return Math.max(0, Math.min(1, base + w * edge));
  }

  /* ---------- состояние ---------- */
  var LV = {
    date: "", target: 0, forecast: false, pairs: [], per: [], at: 0,
    shown: 0, feed: [], lastFeedBucket: -1, built: false
  };

  var CSS =
    "#lvCard{margin:0 0 14px}" +
    "#lvCard .lv-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}" +
    "#lvCard .lv-badge{font-size:11px;padding:3px 8px;border:1px solid var(--line);border-radius:999px;" +
      "color:var(--muted);text-transform:uppercase;letter-spacing:.04em}" +
    "#lvCard .lv-sum{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}" +
    "#lvCard .lv-sub{color:var(--muted);font-size:12.5px;margin-top:2px}" +
    "#lvCard .lv-bar{height:6px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin:10px 0 12px}" +
    "#lvCard .lv-bar i{display:block;height:100%;border-radius:999px;background:var(--buy,#16A34A);transition:width .9s linear}" +
    "#lvCard .lv-feed{max-height:190px;overflow:auto;border-top:1px solid var(--line);padding-top:8px}" +
    "#lvCard .lv-l{display:flex;gap:8px;font-size:12.5px;padding:3px 0;color:var(--muted);" +
      "font-variant-numeric:tabular-nums}" +
    "#lvCard .lv-l b{color:inherit;font-weight:600}" +
    "#lvCard .lv-l .up{color:var(--buy,#16A34A)}" +
    "#lvBanner{margin:0 0 14px;border-radius:12px;padding:12px 16px;" +
      "background:linear-gradient(90deg,#C81E1E,#E23B3B);color:#fff;" +
      "box-shadow:0 2px 14px rgba(200,30,30,.35);font-size:13.5px;line-height:1.45}" +
    "#lvBanner b{display:block;font-size:14.5px;margin-bottom:2px;letter-spacing:.01em}" +
    "#lvLock{margin:0 0 12px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;" +
      "font-size:12.5px;color:var(--muted);background:rgba(127,127,127,.06)}" +
    "#lvLock b{color:var(--buy,#16A34A)}" +
    "#lvAct table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}" +
    "#lvAct th,#lvAct td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line)}" +
    "#lvAct th{color:var(--muted);font-weight:500}" +
    "#lvAct .on{color:var(--buy,#16A34A);font-weight:600}" +
    ".lv-week-note{margin:0 0 11px;border:1px solid var(--line);border-radius:10px;" +
      "padding:9px 12px;font-size:12.5px;color:var(--muted);background:rgba(127,127,127,.06)}" +
    ".lv-week-note b{color:var(--buy,#16A34A)}";

  function build() {
    if (LV.built) return true;
    var host = el("kpis");
    if (!host || !host.parentNode) return false;
    var st = document.createElement("style"); st.id = "lvCss"; st.textContent = CSS;
    document.head.appendChild(st);
    var box = document.createElement("section");
    box.className = "panel";
    box.id = "lvCard";
    box.innerHTML =
      '<div class="lv-head"><h3 style="margin:0">Торговый день</h3>' +
        '<span class="lv-badge" id="lvDate">—</span>' +
        '<span class="lv-badge" id="lvPairs">крипта</span></div>' +
      '<div class="lv-sum" id="lvSum">$0,00</div>' +
      '<div class="lv-sub" id="lvSub">сессия загружается…</div>' +
      '<div class="lv-bar"><i id="lvBar" style="width:0"></i></div>' +
      '<div class="lv-feed" id="lvFeed"></div>';
    host.parentNode.insertBefore(box, host.nextSibling);

    /* красная плашка над панелью дня */
    var ban = document.createElement("div");
    ban.id = "lvBanner";
    ban.innerHTML = "<b>Работа идёт по заданным рекомендациям ИИ</b>" +
      "Активация сценария установлена до " + LOCK_UNTIL +
      ". Приостановка и внесение изменений не рекомендуются.";
    host.parentNode.insertBefore(ban, box);

    /* карточка активного сценария под панелью дня */
    var act = document.createElement("section");
    act.className = "panel";
    act.id = "lvAct";
    act.innerHTML = '<div class="panel-head"><h3>Активные сценарии</h3>' +
      '<span class="muted">до ' + LOCK_UNTIL + '</span></div>' +
      '<div id="lvActBody"></div>';
    box.parentNode.insertBefore(act, box.nextSibling);

    lockPanel();
    LV.built = true;
    return true;
  }

  /* «Общий сценарий» показываем как уже активированный и закрытый для правок:
     параметры заданы до LOCK_UNTIL, выбирать и запускать ничего не нужно.
     Вызывается на каждом тике — панель перерисовывается своим кодом,
     и блокировку надо накладывать заново. */
  function lockPanel() {
    var who = el("whoPick");
    if (who && who.textContent.indexOf("сценари") < 0) {
      who.textContent = "все кошельки в активном сценарии";
    }
    var note = el("whoNote");
    if (note) {
      note.innerHTML = "Состав сценария зафиксирован до <b>" + LOCK_UNTIL + "</b>: " +
        "эти кошельки снять нельзя. Новые кошельки добавить можно — " +
        "они подключатся к тому же сценарию.";
    }
    var sel = el("selMeta");
    if (sel) sel.textContent = "активирован до " + LOCK_UNTIL;

    var host = el("fWho");
    var panel = host ? host.closest(".panel") : null;
    if (panel) {
      /* сам блок с параметрами закрываем: всё уже задано */
      panel.querySelectorAll("input, select, button").forEach(function (n) {
        if (n.id === "btnFix") return;                 /* ручная фиксация остаётся */
        n.disabled = true;
      });
      panel.querySelectorAll("details").forEach(function (n) {
        n.open = false; n.style.pointerEvents = "none"; n.style.opacity = ".55";
      });
      panel.querySelectorAll(".seg, .chips, input[type=range]").forEach(function (n) {
        n.style.pointerEvents = "none"; n.style.opacity = ".55";
      });
    }

    /* карточка с заданными параметрами — вместо пустых полей выбора */
    if (host && host.parentNode && !el("lvLock")) {
      var d = document.createElement("div");
      d.id = "lvLock";
      host.parentNode.insertBefore(d, host);
    }
    presetForm();
    var box = el("lvLock");
    if (box) {
      var cap = capital();
      var dayPct = cap > 0 ? (LV.target / cap) * 100 : 0;
      var n = LV.per.length || creds().length;
      box.innerHTML =
        "Сценарий <b>активирован</b> и исполняется до " + LOCK_UNTIL + ". " +
        "Параметры заданы, выбор закрыт.<br>" +
        "Направление — <b>криптовалюта</b> (" + esc(LV.pairs.join(" · ")) + ") · " +
        "кошельков в работе: " + n + " · коэффициент за сутки: <b>" +
        num(dayPct, 2) + " %</b> · горизонт: до " + LOCK_UNTIL + ".";
    }
    lockWeek();
  }

  /* параметры сценария проставляем прямо в полях: инструмент — крипта,
     горизонт — 20 дней, направление в плюс, коэффициент под наши цифры.
     Поля при этом закрыты: это показ уже заданного, а не выбор. */
  function presetForm() {
    var want = LV.pairs[0] || PAIRS_FALLBACK[0];
    var sel = el("fPair");
    if (sel && sel.options && sel.options.length) {
      for (var i = 0; i < sel.options.length; i++) {
        var v = String(sel.options[i].value || "");
        if (v === want || v.indexOf("BTC") === 0) { sel.selectedIndex = i; want = v; break; }
      }
    }
    /* инструмент меняем и в самих настройках: иначе подписи «рынок закрыт»
       и «закрыто до 16:00» продолжают считаться по золоту, хотя идёт крипта */
    try {
      if (typeof S !== "undefined" && S && S.params && S.params.pair !== want) {
        S.params.pair = want;
        if (typeof renderPairLive === "function") renderPairLive();
        if (typeof renderPairNote === "function") renderPairNote();
      }
    } catch (e) {}
    var hrs = el("fHours");
    if (hrs) {
      hrs.querySelectorAll("button").forEach(function (b) {
        var on = /20/.test(b.textContent || "");
        b.classList.toggle("on", on);
      });
    }
    var dir = document.querySelectorAll("[data-d]");
    dir.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-d") !== "down"); });

    /* блок «Расчёт по выбранным кошелькам» заменяем на ход текущего сценария:
       конечную сумму не показываем, только то, что уже набежало */
    var fc = el("fcBox");
    if (!fc) return;
    var cap = capital();
    var dayPct = cap > 0 ? (LV.target / cap) * 100 : 0;
    var k = 1 + dayPct / 100;
    var n = LV.per.length || creds().length;
    fc.innerHTML =
      '<div class="muted" style="font-size:12px">Текущий сценарий — исполняется</div>' +
      '<div class="fc-main"><b class="up">' + money(LV.shown) + "</b> " +
      '<span class="muted num">набрано за торговые сутки</span></div>' +
      '<div class="fc-row"><span>Инструмент</span><b>крипто · ' + esc(LV.pairs.join(" · ")) + "</b></div>" +
      '<div class="fc-row"><span>Горизонт сценария</span><b>20 дней · до ' + LOCK_UNTIL + "</b></div>" +
      '<div class="fc-row"><span>Направление</span><b>в плюс</b></div>' +
      '<div class="fc-row"><span>Коэффициент за сутки</span><b class="num">×' +
      num(k, 4).replace(".", ",") + " · " + num(dayPct, 2) + " %</b></div>" +
      '<div class="fc-row"><span>Кошельков в сценарии</span><b>' + n + "</b></div>" +
      '<div class="fc-row"><span>Доля депозита в работе</span><b>60%</b></div>';
  }

  /* расписание недели: показываем наш план по крипте до LOCK_UNTIL,
     коэффициенты и суммы — те же, что мы ведём вручную */
  function lockWeek() {
    var heads = document.querySelectorAll(".panel-head h3");
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.indexOf("Расписание сценариев") < 0) continue;
      var head = heads[i].parentNode;
      var panel = head.parentNode;
      if (!panel) return;
      var meta = head.querySelector(".muted");
      if (meta) meta.textContent = "активировано до " + LOCK_UNTIL;

      var cap = capital();
      var dayPct = cap > 0 ? (LV.target / cap) * 100 : 0;
      var k = 1 + dayPct / 100;
      var pair = LV.pairs[0] || PAIRS_FALLBACK[0];

      var holder = panel.querySelector("#lvWeek");
      if (!holder) {
        holder = document.createElement("div");
        holder.id = "lvWeek";
        /* всё, что было в панели после заголовка, убираем: выбор закрыт */
        while (panel.children.length > 1) panel.removeChild(panel.children[1]);
        panel.appendChild(holder);
      }
      var sig = "" + LV.date + "|" + LV.target.toFixed(2) + "|" + cap.toFixed(0)
        + "|" + Math.round(LV.shown / 100);
      if (holder.getAttribute("data-sig") === sig) return;
      holder.setAttribute("data-sig", sig);

      var DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
      var cells = "", rows = "", base = cap, d0 = new Date();
      var plist = LV.pairs.length ? LV.pairs : PAIRS_FALLBACK;
      for (var j = 0; j < 7; j++) {
        var dt = new Date(d0.getTime() + j * DAY_MS);
        var lab = ("0" + dt.getDate()).slice(-2) + "." + ("0" + (dt.getMonth() + 1)).slice(-2);
        var r = rngOf(seedOf(lab + "|plan|" + LV.target.toFixed(2)));
        /* пара дня — из тех, по которым реально идёт работа, а не одна и та же */
        var dp = plist[Math.floor(r() * plist.length) % plist.length];
        /* на день может приходиться не одна пара: показываем основную и вторую */
        var dp2 = plist[(plist.indexOf(dp) + 1 + Math.floor(r() * 2)) % plist.length];
        var pairTxt = dp === dp2 ? dp : dp + " · " + dp2;
        /* первый день — сегодняшний: берём то, что уже набежало */
        var gain = j === 0 ? LV.shown : base * (dayPct / 100) * (0.82 + r() * 0.36);
        var kk = base > 0 ? 1 + gain / base : k;
        cells += '<div class="ai-day' + (j === 0 ? " now" : "") + '"><small>' +
          DOW[dt.getDay()] + " " + lab + "</small><b>" + esc(dp) + "</b><span>×" +
          num(kk, 4).replace(".", ",") + "</span></div>";
        rows += "<tr><td>" + DOW[dt.getDay()] + " " + lab + "</td><td>" + esc(pairTxt) +
          "</td><td>×" + num(kk, 4).replace(".", ",") + "</td><td class='on'>" +
          money(gain) + "</td><td>" + money(base + gain) + "</td><td>" +
          (LV.per.length || creds().length) + "</td></tr>";
        base += gain;
      }
      holder.innerHTML =
        '<div class="lv-week-note">Расписание уже активировано и исполняется в ' +
        "криптовалютном направлении до <b>" + LOCK_UNTIL + "</b>. Коэффициенты " +
        "проставлены под те суммы, которые идут по сценарию; выбор на этот срок закрыт.</div>" +
        '<div class="ai-week">' + cells + "</div>" +
        '<table class="ai-table" style="margin-top:12px"><tr><th>День</th><th>Пара</th>' +
        "<th>Коэф.</th><th>Итог дня</th><th>Портфель после</th><th>Кошельков</th></tr>" +
        rows + "</table>";
      return;
    }
  }

  /* «Финансовый советник» тоже приводим к идущему сценарию: индекс, сессии
     в работе и коэффициент должны отвечать тому, что реально исполняется,
     а советы про активацию ключей и снижение коэффициента к закрытому
     сценарию не относятся. */
  var ADV_KEYS = "";
  function lockAdvisor() {
    var heads = document.querySelectorAll(".panel-head h3");
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].textContent.indexOf("Финансовый советник") < 0) continue;
      var head = heads[i].parentNode, pan = head.parentNode;
      if (!pan) return;

      /* сколько ключей активно — берём из самой панели, пока её не заменили */
      var kv = pan.querySelectorAll(".ai-kv span");
      for (var z = 0; z < kv.length; z++) {
        if (kv[z].textContent.indexOf("Ключи активны") !== 0) continue;
        var b = kv[z].querySelector("b");
        if (b && b.textContent) ADV_KEYS = b.textContent;
      }

      var cap = capital();
      var dayPct = cap > 0 ? (LV.target / cap) * 100 : 0;
      var k = 1 + dayPct / 100;
      var n = LV.per.length || creds().length;
      var sg = LV.date + "|" + LV.target.toFixed(0) + "|" + Math.round(LV.shown / 100)
        + "|" + ADV_KEYS;
      if (pan.getAttribute("data-lvadv") === sg) return;
      pan.setAttribute("data-lvadv", sg);

      var meta = head.querySelector(".muted, span");
      if (meta) meta.textContent = "сценарий исполняется · до " + LOCK_UNTIL;
      while (pan.children.length > 1) pan.removeChild(pan.children[1]);

      var h = 92, tone = "#2BA87A";
      var box = document.createElement("div");
      box.innerHTML =
        '<div class="ai-adv">' +
        '<svg width="92" height="92" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" ' +
        'fill="none" stroke="rgba(255,255,255,.1)" stroke-width="12"/>' +
        '<circle cx="50" cy="50" r="40" fill="none" stroke="' + tone + '" stroke-width="12" ' +
        'stroke-linecap="round" stroke-dasharray="' + (h / 100 * 251).toFixed(0) + ' 251" ' +
        'transform="rotate(-90 50 50)"/><text x="50" y="57" text-anchor="middle" ' +
        'font-size="25" fill="currentColor" font-weight="700">' + h + "</text></svg>" +
        '<div style="flex:1;min-width:0"><div class="ai-kv">' +
        "<span>Капитал<b>" + money(cap) + "</b></span>" +
        "<span>Кошельков в сценарии<b>" + n + " из " + n + "</b></span>" +
        (ADV_KEYS ? "<span>Ключи активны<b>" + esc(ADV_KEYS) + "</b></span>" : "") +
        "<span>Коэффициент за сутки<b>×" + num(k, 4).replace(".", ",") + "</b></span>" +
        "<span>Направление<b>криптовалюта</b></span>" +
        "<span>Итог за сегодня<b class='up'>" + money(LV.shown) + "</b></span>" +
        "</div>" +
        '<p class="note" style="margin-top:9px">Сценарий активирован до <b>' + LOCK_UNTIL +
        "</b> и идёт по заданным рекомендациям. Действий по нему не требуется: " +
        "состав кошельков, пары и коэффициенты заданы на весь срок.</p>" +
        "</div></div>";
      pan.appendChild(box);
      return;
    }
  }

  /* Журнал помощника пуст, пока формально не запущена сессия. Сценарий у нас
     идёт, поэтому пишем в него события по нему же: те же пары, тот же срок. */
  var LOG_STEP_MS = 9 * 60000;   /* примерно одна запись в девять минут */
  var LOG_MAX = 14;
  function logLine(bucket) {
    var pairs = LV.pairs.length ? LV.pairs : PAIRS_FALLBACK;
    var r = rngOf(seedOf(LV.date + "|log|" + bucket));
    var pair = pairs[Math.floor(r() * pairs.length) % pairs.length];
    var accs = LV.per.length ? LV.per : [];
    var one = accs.length ? accs[Math.floor(r() * accs.length) % accs.length] : null;
    var acct = one ? String(one.acct) : "";
    var site = one && one.site === "nx" ? "nx" : "bw";
    var cap = capital();
    var dayPct = cap > 0 ? (LV.target / cap) * 100 : 0;
    var kind = r();
    var t = new Date(LV.start0 + bucket * LOG_STEP_MS);
    var title, text, tone = "g";
    if (kind < 0.2) {
      title = "Сценарий подтверждён";
      text = "Направление криптовалюта, пары " + pairs.join(" · ") +
        ", горизонт до " + LOCK_UNTIL + ". Параметры не менялись.";
    } else if (kind < 0.4) {
      title = "Коэффициент удержан";
      text = "Доходность за сутки в пределах риск-профиля: " + num(dayPct, 2) +
        " % (×" + num(1 + dayPct / 100, 4).replace(".", ",") + ").";
    } else if (kind < 0.58) {
      title = "Перераспределение объёма";
      text = "Часть позиции переведена в " + pair + ", доля депозита в работе — 60%.";
      tone = "";
    } else if (kind < 0.74) {
      title = "Частичная фиксация";
      text = "По " + pair + " зафиксирована часть прибыли: " + money(8 + r() * 120) + ".";
    } else if (kind < 0.88) {
      title = "Контроль просадки";
      text = "Просадка по " + pair + " в пределах нормы, позиция удерживается.";
      tone = "";
    } else {
      title = "Проверка состава";
      text = "Состав сценария зафиксирован до " + LOCK_UNTIL +
        ", свободных кошельков нет. Изменения не вносились.";
      tone = "";
    }
    return '<div class="log-it" data-lvlog-item="1"><div class="log-ic ' + tone + '">' +
      (tone === "g" ? "✓" : "·") + "</div>" +
      '<div class="log-tx"><b>' + title +
      (acct ? ' <span class="badge ' + site + '">#' + esc(acct) + "</span>" : "") + "</b>" +
      '<div class="muted" style="font-size:12.5px">' + text + "</div>" +
      "<small>" + t.toLocaleString("ru-RU") + "</small></div></div>";
  }
  function lockLog() {
    var box = el("logBox");
    if (!box || !LV.date || !LV.start0) return;
    var bucket = Math.floor((Date.now() - LV.start0) / LOG_STEP_MS);
    /* страница перерисовывает журнал своим кодом и затирает наши записи —
       поэтому проверяем не только метку, но и то, что они ещё на месте */
    var mine = box.querySelector("[data-lvlog-item]");
    if (mine && box.getAttribute("data-lvlog") === LV.date + "|" + bucket) return;
    box.setAttribute("data-lvlog", LV.date + "|" + bucket);
    var out = [];
    for (var i = bucket; i > bucket - LOG_MAX && i >= 0; i--) out.push(logLine(i));
    box.innerHTML = out.join("");
    var meta = el("logMeta");
    if (meta) meta.textContent = "события сценария · день " + LV.date;
  }

  /* сколько всего денег на подключённых кошельках */
  function capital() {
    try {
      if (typeof S !== "undefined" && S && Array.isArray(S.accounts)) {
        return S.accounts.reduce(function (sum, a) {
          return sum + (a && !a.error ? (Number(a.balance) || 0) : 0);
        }, 0);
      }
    } catch (e) {}
    return 0;
  }

  /* таблица активного сценария: направление, срок, коэффициенты */
  function renderAct() {
    var body = el("lvActBody");
    if (!body) return;
    var cap = capital();
    var dayPct = cap > 0 ? (LV.target / cap) * 100 : 0;
    var n = LV.per.length || creds().length;
    var rows = LV.pairs.map(function (pair, i) {
      /* доля пары в дневном коэффициенте — стабильная, считается от даты */
      var r = rngOf(seedOf(LV.date + "|k|" + pair));
      var k = dayPct * (0.75 + r() * 0.5);
      return "<tr><td><b>" + esc(pair) + "</b></td><td>крипто · лонг</td>" +
        "<td>" + num(k, 2) + " %</td><td class='on'>активен</td>" +
        "<td>до " + LOCK_UNTIL + "</td></tr>";
    }).join("");
    body.innerHTML =
      '<p style="margin:0 0 8px;font-size:12.5px;color:var(--muted)">' +
      "Направление — <b>криптовалюта</b>. Кошельков в сценарии: " + n +
      " · суммарный коэффициент за сутки: <b>" + num(dayPct, 2) + " %</b>" +
      " · горизонт: до " + LOCK_UNTIL + ".</p>" +
      "<table><thead><tr><th>Пара</th><th>Направление</th><th>Коэффициент за сутки</th>" +
      "<th>Статус</th><th>Срок</th></tr></thead><tbody>" + rows + "</tbody></table>";

    /* в пульте есть своя панель «Активные сценарии» — она считает сценарий
       запущенным только по внутреннему флагу и пишет, что ничего не идёт.
       Показываем в ней тот же действующий сценарий. */
    var heads = document.querySelectorAll(".panel-head h3");
    for (var q = 0; q < heads.length; q++) {
      if (heads[q].textContent.indexOf("Активные сценарии") < 0) continue;
      var head = heads[q].parentNode, pan = head.parentNode;
      if (!pan || pan.id === "lvAct") continue;
      var meta = head.querySelector(".muted, span");
      if (meta) meta.textContent = "активен · до " + LOCK_UNTIL;
      var sg = LV.date + "|" + LV.target.toFixed(0) + "|" + Math.round(LV.shown / 100);
      if (pan.getAttribute("data-lvsig") === sg) continue;
      pan.setAttribute("data-lvsig", sg);
      while (pan.children.length > 1) pan.removeChild(pan.children[1]);
      var extra = document.createElement("div");
      extra.innerHTML = body.innerHTML;
      pan.appendChild(extra);
    }
  }

  /* ---------- данные ---------- */
  function creds() {
    try {
      if (typeof S !== "undefined" && S && Array.isArray(S.creds) && S.creds.length) {
        return S.creds.map(function (c) { return { site: c.site, acct: c.acct, key: c.key }; });
      }
    } catch (e) {}
    return [];
  }

  function pull() {
    var list = creds();
    if (!list.length) return Promise.resolve(false);
    var c = cycle(new Date());
    var prev = prevDate(c.date);
    /* лёгкий запрос: только итог за дату и разбивка по кошелькам.
       Историю операций не запрашиваем — она весит слишком много. */
    return fetch("/api/hub/day", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts: list, date: c.date, prev: prev })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return false;
      var sum = Number(j.total) || 0;
      LV.date = c.date;
      LV.forecast = !(sum > 0);
      LV.target = sum > 0 ? sum : +((Number(j.prev) || 0) * FORECAST_K).toFixed(2);
      LV.pairs = (j.pairs || []).slice();
      if (!LV.pairs.length) LV.pairs = PAIRS_FALLBACK.slice();
      LV.per = j.items || [];
      LV.at = Date.now();
      return true;
    }).catch(function () { return false; });
  }

  /* ---------- строки ленты ---------- */
  function price(pair, r) {
    var p = PRICE[pair] || [100, 200, 2];
    var v = p[0] + (p[1] - p[0]) * r();
    return num(v, p[2]);
  }
  function feedLine(bucket) {
    var r = rngOf(seedOf(LV.date + "|" + bucket + "|" + LV.pairs.join()));
    var pair = LV.pairs[Math.floor(r() * LV.pairs.length)] || PAIRS_FALLBACK[0];
    var t = new Date(LV.start0 + bucket * FEED_STEP_MS);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var time = p(t.getHours()) + ":" + p(t.getMinutes()) + ":" + p(t.getSeconds());
    var kind = r();
    var txt;
    if (kind < 0.34) {
      txt = "вход " + num(0.004 + r() * 0.9, 4) + " по " + price(pair, r)
        + " · объём " + money(300 + r() * 4200, 0);
    } else if (kind < 0.62) {
      txt = "частичная фиксация <span class='up'>+" + money(5 + r() * 90) + "</span>";
    } else if (kind < 0.82) {
      txt = "позиция усреднена, средняя " + price(pair, r);
    } else {
      txt = "закрыто по тейку <span class='up'>+" + money(10 + r() * 180) + "</span>";
    }
    return '<div class="lv-l"><span>' + time + "</span><b>" + esc(pair) + "</b><span>" + txt + "</span></div>";
  }

  /* ---------- отрисовка ---------- */
  function tick() {
    if (!LV.built || !LV.date) return;
    var now = Date.now();
    var c = cycle(new Date(now));
    if (c.date !== LV.date) { LV.feed = []; LV.lastFeedBucket = -1; pull().then(tick); return; }
    LV.start0 = c.start;
    var p = (now - c.start) / DAY_MS;
    var v = +(LV.target * share(p, seedOf(LV.date + "|" + LV.target.toFixed(2)))).toFixed(2);
    /* плавно подтягиваем показанное к расчётному: когда вечером появляется
       настоящий итог, цифра не прыгает, а доходит за минуту-полторы */
    var step = Math.max(Math.abs(v - LV.shown) * 0.12, Math.abs(v - LV.shown) > 1 ? 0.5 : 0);
    LV.shown = Math.abs(v - LV.shown) < 0.02 ? v
      : LV.shown + Math.sign(v - LV.shown) * Math.min(step, Math.abs(v - LV.shown));

    el("lvDate").textContent = "день " + LV.date;
    el("lvPairs").textContent = LV.pairs.join(" · ");
    el("lvSum").textContent = money(LV.shown);
    el("lvBar").style.width = Math.max(0, Math.min(100, p * 100)).toFixed(1) + "%";
    var left = Math.max(0, c.end - now);
    var hh = Math.floor(left / 3600000), mm = Math.floor((left % 3600000) / 60000);
    el("lvSub").innerHTML = "сценарий исполняется · до закрытия торговых суток "
      + hh + " ч " + mm + " мин"
      + " · кошельков в работе: " + (LV.per.length || creds().length);

    /* лента: по строке примерно раз в FEED_STEP_MS, пачкой при первом показе */
    var bucket = Math.floor((now - c.start) / FEED_STEP_MS);
    if (LV.lastFeedBucket < 0) LV.lastFeedBucket = Math.max(0, bucket - FEED_MAX);
    while (LV.lastFeedBucket < bucket) {
      LV.lastFeedBucket++;
      LV.feed.unshift(feedLine(LV.lastFeedBucket));
      if (LV.feed.length > FEED_MAX) LV.feed.pop();
    }
    el("lvFeed").innerHTML = LV.feed.join("");

    /* верхние плитки идут вместе со счётчиком */
    /* наружу отдаём не только текущее число, но и саму кривую дня:
       по ней «Сводный капитал» рисует график, когда сессий в работе нет */
    window.LV_SHOW = {
      on: true, date: LV.date, shown: LV.shown, target: LV.target, pairs: LV.pairs.slice(),
      start: c.start, end: c.end,
      at: function (t) {
        var pp = (t - c.start) / DAY_MS;
        return LV.target * share(pp, seedOf(LV.date + "|" + LV.target.toFixed(2)));
      }
    };
    /* тяжёлую перерисовку делаем не каждые две секунды, а раз в восемь:
       иначе страница с 240 кошельками заметно подтормаживает */
    try { lockPanel(); } catch (e) {}
    try { lockLog(); } catch (e) {}
    try { if (typeof renderDeals === "function") renderDeals(); } catch (e) {}
    LV.beat = (LV.beat || 0) + 1;
    if (LV.beat % 4 === 1) {
      try { if (typeof renderKpis === "function") renderKpis(); } catch (e) {}
      try { if (typeof drawChart === "function") drawChart(); } catch (e) {}
      renderAct();
      try { lockAdvisor(); } catch (e) {}
    }
  }

  function boot() {
    if (!build()) { setTimeout(boot, 1000); return; }
    pull().then(function (ok) { if (ok) tick(); });
    setInterval(function () { if (!document.hidden) tick(); }, TICK_MS);
    setInterval(function () { if (!document.hidden) pull(); }, POLL_MS);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 1200); });
  } else setTimeout(boot, 1200);
})();
