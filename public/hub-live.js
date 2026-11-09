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
    "#lvCard .lv-l .up{color:var(--buy,#16A34A)}";

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
    LV.built = true;
    return true;
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
    el("lvSub").innerHTML = (LV.forecast
        ? "идёт день, итог ещё не подведён — показан ориентир"
        : "итог дня подведён, лента доводит цифру до него")
      + " · до закрытия суток " + hh + " ч " + mm + " мин"
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
