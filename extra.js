'use strict';
/**
 * Дополнения поверх основного сервера площадки:
 *   — письма о регистрации и восстановлении пароля (mailer.js);
 *   — уведомления кошелька (колонка notes);
 *   — служба поддержки: обращения клиента и ответы оператора (таблица tickets);
 *   — вывод средств и отчёт за сутки в Telegram со страницы единого бота;
 *   — подключение клиентских файлов к страницам без правки самих HTML-файлов.
 * Подключается одной строкой в server.js, существующие маршруты не меняет.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendMail, layout } = require('./mailer');
const tg = require('./tg');
const KYC = require('./kyc');

let CTX = null;
let T_USERS = 'users';
let T_SESS = 'sessions';
let SITE_TAG = 'bw';
let SITE_BRAND = 'BullWaves';
const q = (t, p) => CTX.q(t, p);
const bad = (res, code, msg) => CTX.bad(res, code, msg);
const clean = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);

function siteUrl(req) {
  const env = String(process.env.SITE_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const host = (req && req.get && req.get('host')) || '';
  return host ? 'https://' + host : '';
}

/* ---------- название площадки ---------- */
/* Сайт переименован, а в больших HTML-файлах осталось прежнее имя: подменяем его
   при отдаче страницы, в письмах и в названиях площадок. Когда Имя поправят в
   самом HTML, замена просто перестанет что-либо находить. */
const RENAME = {
  bw: [['BullWaves', 'BullWaves'], ['BULLWAVES', 'BULLWAVES'], ['bullwaves', 'bullwaves']],
  nx: [['FxPro', 'FxPro'], ['FXPRO', 'FXPRO'], ['fxpro', 'fxpro'],
       ['Nordis', 'FxPro'], ['NORDIS', 'FXPRO'], ['nordis', 'fxpro']]
};
function rename(text) {
  const map = RENAME[SITE_TAG] || [];
  let s = String(text == null ? '' : text);
  for (const pair of map) s = s.split(pair[0]).join(pair[1]);
  return s;
}

/* ---------- подключение клиентских файлов к готовым страницам ---------- */
/* HTML-файлы площадки не трогаем: нужные скрипты добавляются при отдаче страницы. */
const INJECT = {
  'index.html': ['notify.js', 'cabinet-extra.js', 'kyc.js', 'mktopen.js'],
  'admin.html': ['admin-extra.js', 'admin-kyc.js'],
  'bot.html':   ['mktopen.js'],
  'hub.html':   ['notify.js', 'hub-extra.js', 'botkeys.js', 'mktopen.js']
};
const _page = new Map();
function readPage(name) {
  const file = path.join(CTX.pub, name);
  let st;
  try { st = fs.statSync(file); } catch (e) { return null; }
  const was = _page.get(name);
  if (was && was.mtime === st.mtimeMs) return was.html;
  let html = fs.readFileSync(file, 'utf8');
  const tags = (INJECT[name] || [])
    .filter(src => html.indexOf('"' + src + '"') < 0)
    .map(src => '<script src="' + src + '"></script>')
    .join('\n');
  if (tags) {
    html = html.indexOf('</body>') >= 0 ? html.replace('</body>', tags + '\n</body>') : html + tags;
  }
  html = rename(html);
  _page.set(name, { mtime: st.mtimeMs, html });
  return html;
}
function sendPage(res, name) {
  const html = readPage(name || 'index.html');
  if (html === null) return res.status(404).send('Страница не найдена');
  res.type('html').set('Cache-Control', 'no-cache').send(html);
}

/* ---------- уведомления кошелька ---------- */
const NOTE_CAP = 60;
const NOTE_KINDS = ['fix', 'mkt', 'risk', 'out', 'pay', 'sup', 'acc'];
function mkNote(n) {
  n = n || {};
  return {
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    kind: NOTE_KINDS.indexOf(String(n.kind)) >= 0 ? String(n.kind) : 'acc',
    title: String(n.title || '').slice(0, 90),
    text: String(n.text || '').slice(0, 400),
    key: String(n.key || '').slice(0, 60),
    read: false
  };
}
/* добавляет уведомление в начало списка; key защищает от повторов */
async function pushNote(table, id, note) {
  const n = mkNote(note);
  try {
    if (n.key) {
      const ex = await q('SELECT 1 FROM ' + table + ' WHERE id = $1 AND notes @> $2::jsonb',
        [id, JSON.stringify([{ key: n.key }])]);
      if (ex.rows[0]) return null;
    }
    await q('UPDATE ' + table + ' SET notes = ('
      + " SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb)"
      + " FROM jsonb_array_elements($2::jsonb || COALESCE(notes, '[]'::jsonb))"
      + ' WITH ORDINALITY AS t(e, i) WHERE i <= $3) WHERE id = $1',
      [id, JSON.stringify([n]), NOTE_CAP]);
    return n;
  } catch (e) { console.error('[notes]', e.message); return null; }
}

/* ---------- служба поддержки: справочники ---------- */
const TICKET_TOPICS = {
  pay: 'Пополнение и вывод',
  acc: 'Счёт и доступ',
  trade: 'Терминал и сценарии',
  tech: 'Техническая проблема',
  other: 'Другое'
};
const TICKET_ST = { open: 'в работе', wait: 'ждёт ответа клиента', closed: 'закрыто' };
function tView(r) {
  const msgs = Array.isArray(r.msgs) ? r.msgs : [];
  return {
    id: Number(r.id), site: r.site, email: r.email, acct: r.acct, name: r.name,
    topic: r.topic, topicName: TICKET_TOPICS[r.topic] || TICKET_TOPICS.other,
    subject: r.subject, status: r.status, statusName: TICKET_ST[r.status] || r.status,
    msgs, last: msgs.length ? msgs[msgs.length - 1] : null,
    unreadUser: Number(r.unread_user) || 0, unreadAdm: Number(r.unread_adm) || 0,
    created: r.created_at, updated: r.updated_at
  };
}

/* ---------- вывод средств со страницы единого бота ---------- */
/*  */
const HUB_OUT = {
  card:   { name: 'Банковская карта',           fee: 0.015, min: 10,  eta: '1–3 рабочих дня' },
  sbp:    { name: 'СБП по номеру телефона',     fee: 0.010, min: 10,  eta: 'до 24 часов' },
  crypto: { name: 'Криптовалюта USDT (TRC-20)', fee: 0.005, min: 20,  eta: 'до 2 часов' },
  wire:   { name: 'Банковский перевод',         fee: 0.020, min: 100, eta: '2–5 рабочих дней' }
};
function hubMask(v) {
  const c = String(v || '').replace(/\s+/g, '');
  return c.length < 4 ? '' : '•••• ' + c.slice(-4);
}
const hubRef = p => p + '-' + String(Date.now()).slice(-6) + '-'
  + Math.random().toString(36).slice(2, 5).toUpperCase();
const money = n => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);

/* результат текущего дня по кошельку: та же математика, что и у фиксации */
function hubDay(u) {
  const d = u.dyn || {};
  if (!d.on) return null;
  const val = CTX.fixValue(d, Date.now());
  if (val === null) return null;
  const fix = d.fix || {};
  const prev = isFinite(Number(fix.lastVal)) ? Number(fix.lastVal) : (Number(d.from) || val);
  return { val: +val.toFixed(2), gain: +(val - prev).toFixed(2), pair: d.pair || 'XAU/USD' };
}
function reportText(rows, title) {
  const total = rows.reduce((s, r) => s + r.gain, 0);
  const line = r => (r.gain >= 0 ? '🟢' : '🔴') + ' ' + tg.esc(r.siteName) + ' · #' + tg.esc(r.acct)
    + ' · ' + tg.esc(r.pair) + ': <b>' + money(r.gain) + '</b>'
    + (r.val != null ? ' · баланс $' + r.val.toFixed(2) : '');
  return '📊 <b>' + title + '</b>\n' + rows.map(line).join('\n')
    + '\n\nИтого: <b>' + money(+total.toFixed(2)) + '</b> по '
    + rows.length + (rows.length === 1 ? ' кошельку' : ' кошелькам')
    + '\n<i>Учебный демо-стенд: сделки симулируются, суммы условны.</i>';
}
async function reportAll() {
  const S = CTX.sites || {};
  const rows = [];
  for (const site of Object.keys(S)) {
    try {
      const r = await q('SELECT * FROM ' + S[site].users + " WHERE (dyn->>'on') = 'true' LIMIT 500");
      for (const u of r.rows) {
        const d = hubDay(u);
        if (d) rows.push({ site, siteName: S[site].label, acct: u.acct, pair: d.pair, gain: d.gain, val: d.val });
      }
    } catch (e) { console.error('[report]', site, e.message); }
  }
  return rows;
}

/* ---------- события основного сервера ---------- */
/* письмо и уведомление после регистрации кошелька */
function onRegister(user, req) {
  sendMail({
    to: user.email,
    subject: SITE_BRAND + ': кошелёк №' + user.acct + ' создан',
    html: layout(SITE_BRAND, 'Кошелёк создан', [
      'Здравствуйте' + (user.name ? ', ' + user.name : '') + '!',
      '<b>Номер кошелька:</b> ' + user.acct + '<br><b>Валюта:</b> ' + user.cur
        + '<br><b>Вход:</b> ' + user.email,
      'Баланс пока нулевой: пополнение оформляется заявкой в разделе «Платежи», '
        + 'сценарии торгового помощника включаются в разделе «Помощник».',
      'Пароль мы не храним в открытом виде и не присылаем письмом. Забыли — на странице входа '
        + 'есть ссылка «Забыли пароль?».'
    ], { href: siteUrl(req) + '/', text: 'Войти в кабинет' })
  }).catch(() => {});
  pushNote(T_USERS, user.id, {
    kind: 'acc', title: 'Кошелёк №' + user.acct + ' создан',
    text: 'Добро пожаловать. Пополнение — в разделе «Платежи», сценарии — в разделе «Помощник».'
  }).catch(() => {});
}
/* уведомление после проведения заявки администратором */
function onAdminDelta(id, amt, ref) {
  const sum = '$' + Math.abs(Number(amt) || 0).toFixed(2);
  pushNote(T_USERS, id, amt > 0
    ? { kind: 'pay', title: 'Счёт пополнен на ' + sum,
        text: 'Заявка ' + ref + ' проведена, сумма уже на балансе кошелька.' }
    : { kind: 'out', title: 'Вывод ' + sum + ' исполнен',
        text: 'Заявка ' + ref + ' проведена, сумма списана с баланса кошелька.' }).catch(() => {});
}
/* уведомление о записанном итоге торгового дня */
function onFix(table, id, date, pair, sum) {
  pushNote(table, id, {
    kind: 'fix', key: 'fix:' + date,
    title: 'Итог торгового дня: ' + sum,
    text: pair + ' · ' + date + ' · строка «Результат дня» добавлена в историю операций.'
  }).catch(() => {});
}
/* сводка за сутки в Telegram после автофиксации */
async function onDayReport(rows, date) {
  if (!rows.length) return;
  try { await tg.send(reportText(rows, 'Итог торгового дня · ' + date)); }
  catch (e) { console.error('[fix] отчёт в Telegram:', e.message); }
}

/* ---------- маршруты ---------- */
function install(app, ctx) {
  CTX = ctx;
  T_USERS = ctx.users;
  T_SESS = ctx.sessions;
  SITE_TAG = ctx.tag;
  SITE_BRAND = process.env.BRAND_NAME || rename(ctx.brand);
  /* те же названия в карточках единого бота и в отчётах Telegram */
  if (ctx.sites) {
    Object.keys(ctx.sites).forEach(k => {
      const prev = SITE_TAG;
      SITE_TAG = k;
      ctx.sites[k].label = rename(ctx.sites[k].label);
      ctx.sites[k].brand = rename(ctx.sites[k].brand);
      SITE_TAG = prev;
    });
  }
  const sessionUser = ctx.sessionUser;
  const openSession = ctx.openSession;
  const hashPass = ctx.hashPass;
  const toUser = ctx.toUser;
  const requireAdmin = ctx.requireAdmin;

  /* страницы с подключёнными файлами — маршруты идут до express.static */
  app.get('/', (_req, res) => sendPage(res, 'index.html'));
  Object.keys(INJECT).forEach(name => {
    app.get('/' + name, (_req, res) => sendPage(res, name));
    app.get('/' + name.replace(/\.html$/, ''), (_req, res) => sendPage(res, name));
  });

  /* --- уведомления --- */
  app.get('/api/notes', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const r = await q('SELECT notes FROM ' + T_USERS + ' WHERE id = $1', [me.id]);
      const list = (r.rows[0] && r.rows[0].notes) || [];
      res.json({ notes: list, unread: list.filter(x => !x.read).length });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* события, которые видит только браузер: рынок и риск по сценарию */
  app.post('/api/notes', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const b = req.body || {};
      const kind = String(b.kind || '');
      if (kind !== 'mkt' && kind !== 'risk') return bad(res, 400, 'Такое уведомление сервер не записывает');
      const n = await pushNote(T_USERS, me.id, { kind, title: b.title, text: b.text, key: b.key });
      res.json({ ok: true, note: n });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/notes/read', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const b = req.body || {};
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : null;
      const r = await q('SELECT notes FROM ' + T_USERS + ' WHERE id = $1', [me.id]);
      const list = ((r.rows[0] && r.rows[0].notes) || []).map(n =>
        (b.all || (ids && ids.indexOf(String(n.id)) >= 0)) ? Object.assign({}, n, { read: true }) : n);
      await q('UPDATE ' + T_USERS + ' SET notes = $2::jsonb WHERE id = $1', [me.id, JSON.stringify(list)]);
      res.json({ ok: true, notes: list, unread: list.filter(x => !x.read).length });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* --- восстановление пароля --- */
  const RESET_TTL = 60 * 60000;
  app.post('/api/forgot', async (req, res) => {
    const mail = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return bad(res, 400, 'Введите корректный email');
    try {
      const r = await q('SELECT id, email, name, acct FROM ' + T_USERS + ' WHERE email = $1', [mail]);
      const u = r.rows[0];
      if (u) {
        const token = crypto.randomBytes(24).toString('hex');
        await q('UPDATE ' + T_USERS + ' SET reset_token = $2, reset_exp = $3 WHERE id = $1',
          [u.id, token, new Date(Date.now() + RESET_TTL)]);
        const link = siteUrl(req) + '/?reset=' + token;
        sendMail({
          to: u.email,
          subject: SITE_BRAND + ': восстановление пароля',
          html: layout(SITE_BRAND, 'Восстановление пароля', [
            'Здравствуйте' + (u.name ? ', ' + u.name : '') + '. Для кошелька №' + u.acct
              + ' запрошена смена пароля.',
            'Нажмите кнопку ниже и задайте новый пароль. Ссылка действует один час и срабатывает один раз.',
            'Если пароль меняли не вы — просто не переходите по ссылке, старый пароль продолжит работать.'
          ], { href: link, text: 'Задать новый пароль' })
        }).catch(() => {});
        pushNote(T_USERS, u.id, {
          kind: 'acc', title: 'Запрошено восстановление пароля',
          text: 'Ссылка отправлена на ' + u.email + ' и действует час. Если это были не вы — смените пароль в профиле.'
        }).catch(() => {});
      }
      /* ответ одинаковый, существует адрес или нет: иначе почту можно перебирать */
      res.json({ ok: true });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.get('/api/reset/check', async (req, res) => {
    try {
      const token = String(req.query.token || '');
      if (token.length < 20) return bad(res, 400, 'Ссылка неполная');
      const r = await q('SELECT email FROM ' + T_USERS + ' WHERE reset_token = $1 AND reset_exp > now()', [token]);
      if (!r.rows[0]) return bad(res, 410, 'Ссылка устарела или уже использована — запросите новую');
      const m = String(r.rows[0].email).split('@');
      res.json({ ok: true, email: m[0].slice(0, 2) + '•••@' + (m[1] || '') });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/reset', async (req, res) => {
    const b = req.body || {};
    const token = String(b.token || '');
    const pass = String(b.pass || '');
    if (token.length < 20) return bad(res, 400, 'Ссылка неполная');
    if (pass.length < 6) return bad(res, 400, 'Пароль не короче 6 символов');
    try {
      const r = await q('SELECT * FROM ' + T_USERS + ' WHERE reset_token = $1 AND reset_exp > now()', [token]);
      const u = r.rows[0];
      if (!u) return bad(res, 410, 'Ссылка устарела или уже использована — запросите новую');
      await q('UPDATE ' + T_USERS + " SET pass_hash = $2, reset_token = '', reset_exp = NULL WHERE id = $1",
        [u.id, hashPass(pass)]);
      /* старые входы закрываем: пароль сменился */
      await q('DELETE FROM ' + T_SESS + ' WHERE user_id = $1', [u.id]).catch(() => {});
      await openSession(res, u.id);
      pushNote(T_USERS, u.id, {
        kind: 'acc', title: 'Пароль изменён',
        text: 'Новый пароль сохранён, остальные сессии закрыты.'
      }).catch(() => {});
      sendMail({
        to: u.email, subject: SITE_BRAND + ': пароль изменён',
        html: layout(SITE_BRAND, 'Пароль изменён', [
          'Пароль кошелька №' + u.acct + ' только что изменён.',
          'Если это были не вы — напишите в службу поддержки из кабинета, мы приостановим доступ.'
        ])
      }).catch(() => {});
      res.json({ ok: true, user: toUser(u) });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* --- обращения клиента --- */
  app.get('/api/tickets', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const r = await q('SELECT * FROM tickets WHERE site = $1 AND user_id = $2'
        + ' ORDER BY updated_at DESC LIMIT 50', [SITE_TAG, me.id]);
      res.json({ tickets: r.rows.map(tView), topics: TICKET_TOPICS });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/tickets', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const b = req.body || {};
      const topic = TICKET_TOPICS[String(b.topic)] ? String(b.topic) : 'other';
      const subject = clean(b.subject, 120) || TICKET_TOPICS[topic];
      const text = clean(b.text, 4000);
      if (text.length < 5) return bad(res, 400, 'Опишите вопрос подробнее');
      const open = await q('SELECT count(*)::int AS n FROM tickets'
        + " WHERE site = $1 AND user_id = $2 AND status <> 'closed'", [SITE_TAG, me.id]);
      if (open.rows[0].n >= 10) return bad(res, 429, 'Слишком много открытых обращений — дождитесь ответа');
      const msg = { at: new Date().toISOString(), who: 'user', name: me.name || me.email, text };
      const r = await q('INSERT INTO tickets (site, user_id, email, acct, name, topic, subject, status, msgs, unread_adm)'
        + " VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8::jsonb,1) RETURNING *",
        [SITE_TAG, me.id, me.email, me.acct, me.name || '', topic, subject, JSON.stringify([msg])]);
      const t = tView(r.rows[0]);
      sendMail({
        to: me.email, subject: SITE_BRAND + ': обращение №' + t.id + ' принято',
        html: layout(SITE_BRAND, 'Обращение №' + t.id + ' принято', [
          '<b>Тема:</b> ' + t.subject + ' · ' + t.topicName,
          'Ответ придёт в кабинет, в раздел «Поддержка», и на этот адрес. '
            + 'Обычно отвечаем в течение рабочего дня.'
        ], { href: siteUrl(req) + '/?support=' + t.id, text: 'Открыть обращение' })
      }).catch(() => {});
      res.json({ ok: true, ticket: t });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/tickets/:id/msg', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const id = Number(req.params.id);
      const text = clean((req.body || {}).text, 4000);
      if (text.length < 1) return bad(res, 400, 'Пустое сообщение');
      const cur = await q('SELECT * FROM tickets WHERE id = $1 AND site = $2 AND user_id = $3',
        [id, SITE_TAG, me.id]);
      if (!cur.rows[0]) return bad(res, 404, 'Обращение не найдено');
      const msgs = (Array.isArray(cur.rows[0].msgs) ? cur.rows[0].msgs : [])
        .concat([{ at: new Date().toISOString(), who: 'user', name: me.name || me.email, text }]).slice(-100);
      const r = await q('UPDATE tickets SET msgs = $2::jsonb, status = $3,'
        + ' unread_adm = unread_adm + 1, updated_at = now() WHERE id = $1 RETURNING *',
        [id, JSON.stringify(msgs), cur.rows[0].status === 'closed' ? 'open' : cur.rows[0].status]);
      res.json({ ok: true, ticket: tView(r.rows[0]) });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/tickets/:id/read', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      await q('UPDATE tickets SET unread_user = 0 WHERE id = $1 AND site = $2 AND user_id = $3',
        [Number(req.params.id), SITE_TAG, me.id]);
      res.json({ ok: true });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/tickets/:id/close', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const r = await q("UPDATE tickets SET status = 'closed', updated_at = now()"
        + ' WHERE id = $1 AND site = $2 AND user_id = $3 RETURNING *',
        [Number(req.params.id), SITE_TAG, me.id]);
      if (!r.rows[0]) return bad(res, 404, 'Обращение не найдено');
      res.json({ ok: true, ticket: tView(r.rows[0]) });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* --- поддержка со стороны админки --- */
  app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
    try {
      const st = String(req.query.status || '');
      const args = [SITE_TAG];
      let where = 'site = $1';
      if (TICKET_ST[st]) { where += ' AND status = $2'; args.push(st); }
      const r = await q('SELECT * FROM tickets WHERE ' + where + ' ORDER BY updated_at DESC LIMIT 200', args);
      res.json({ tickets: r.rows.map(tView), topics: TICKET_TOPICS, statuses: TICKET_ST });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/admin/tickets/:id/msg', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const text = clean(b.text, 4000);
      if (text.length < 1) return bad(res, 400, 'Пустое сообщение');
      const who = clean(b.name, 40) || 'Служба поддержки';
      const cur = await q('SELECT * FROM tickets WHERE id = $1 AND site = $2', [id, SITE_TAG]);
      if (!cur.rows[0]) return bad(res, 404, 'Обращение не найдено');
      const t0 = cur.rows[0];
      const msgs = (Array.isArray(t0.msgs) ? t0.msgs : [])
        .concat([{ at: new Date().toISOString(), who: 'adm', name: who, text }]).slice(-100);
      const r = await q("UPDATE tickets SET msgs = $2::jsonb, status = 'wait',"
        + ' unread_user = unread_user + 1, unread_adm = 0, updated_at = now() WHERE id = $1 RETURNING *',
        [id, JSON.stringify(msgs)]);
      if (t0.user_id) {
        pushNote(T_USERS, t0.user_id, {
          kind: 'sup', title: 'Ответ службы поддержки · обращение №' + id, text: text.slice(0, 160)
        }).catch(() => {});
        sendMail({
          to: t0.email, subject: SITE_BRAND + ': ответ по обращению №' + id,
          html: layout(SITE_BRAND, 'Ответ по обращению №' + id, [
            '<b>Тема:</b> ' + t0.subject,
            text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
            'Ответить можно в кабинете, в разделе «Поддержка».'
          ], { href: siteUrl(req) + '/?support=' + id, text: 'Открыть переписку' })
        }).catch(() => {});
      }
      res.json({ ok: true, ticket: tView(r.rows[0]) });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.patch('/api/admin/tickets/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const st = String((req.body || {}).status || '');
      if (!TICKET_ST[st]) return bad(res, 400, 'Неизвестный статус');
      const r = await q('UPDATE tickets SET status = $2, updated_at = now()'
        + ' WHERE id = $1 AND site = $3 RETURNING *', [id, st, SITE_TAG]);
      if (!r.rows[0]) return bad(res, 404, 'Обращение не найдено');
      res.json({ ok: true, ticket: tView(r.rows[0]) });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* --- ключи активации бота и верификация профиля --- */
  KYC.install(app, ctx, {
    pushNote: pushNote, sendMail: sendMail, layout: layout, tg: tg,
    brand: function () { return SITE_BRAND; }
  });

  /* --- вывод средств и отчёт: только на площадке с единым ботом --- */
  if (!ctx.hub) return;
  const { hubUser, hubList, sites } = ctx;

  app.get('/api/hub/methods', (_req, res) => res.json({ methods: HUB_OUT }));

  app.post('/api/hub/withdraw', async (req, res) => {
    try {
      const b = req.body || {};
      const u = await hubUser(b);
      if (!u) return bad(res, 403, 'Кошелёк не найден или ключ API не подходит');
      const m = HUB_OUT[String(b.method || 'card')] || HUB_OUT.card;
      const amt = Math.round((Number(b.amount) || 0) * 100) / 100;
      if (!isFinite(amt) || amt <= 0) return bad(res, 400, 'Укажите сумму вывода');
      if (amt < m.min) return bad(res, 400, 'Минимальная сумма для «' + m.name + '» — $' + m.min);
      const bal = Number(u.balance) || 0;
      if (amt > bal) return bad(res, 400, 'На кошельке только $' + bal.toFixed(2));
      if (amt > 50000) return bad(res, 400, 'Суточный лимит вывода — $50 000');
      const mask = hubMask(b.req);
      if (!mask) return bad(res, 400, 'Укажите реквизиты получателя — достаточно последних цифр счёта или карты');
      const who = String(b.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
      const fee = +(amt * m.fee).toFixed(2);
      const net = +(amt - fee).toFixed(2);
      const ref = hubRef('OUT');
      const date = new Date().toLocaleDateString('ru-RU');
      const table = sites[u._site].users;
      const label = m.name + ' · ' + mask + (who ? ' · ' + who : '') + ' · заявка ' + ref;
      const tx = [[date, label, '−$' + amt.toFixed(2), 'wait', 'На рассмотрении']]
        .concat(Array.isArray(u.tx) ? u.tx : []).slice(0, 200);
      const hist = [[date, 'Заявка на вывод', mask, '−$' + amt.toFixed(2), 'wait']]
        .concat(Array.isArray(u.hist) ? u.hist : []).slice(0, 200);
      await q('UPDATE ' + table + ' SET balance = $2, tx = $3::jsonb, hist = $4::jsonb WHERE id = $1',
        [u.id, (bal - amt).toFixed(2), JSON.stringify(tx), JSON.stringify(hist)]);
      pushNote(table, u.id, {
        kind: 'out', title: 'Заявка на вывод $' + amt.toFixed(2) + ' создана',
        text: m.name + ' · ' + mask + ' · к зачислению $' + net.toFixed(2)
          + ' · срок ' + m.eta + ' · заявка ' + ref
      }).catch(() => {});
      tg.send('💸 <b>Заявка на вывод</b>\n'
        + sites[u._site].label + ' · кошелёк #' + u.acct + '\n'
        + 'Сумма: $' + amt.toFixed(2) + ' · сбор $' + fee.toFixed(2)
        + ' · к зачислению $' + net.toFixed(2) + '\n'
        + 'Способ: ' + m.name + ' · реквизиты ' + mask + '\n'
        + 'Заявка ' + ref + ' · ' + date + '\n'
        + '<i>Учебный демо-стенд: настоящих переводов нет.</i>').catch(() => {});
      res.json({
        ok: true, site: u._site, siteName: sites[u._site].label, acct: u.acct,
        ref, amount: amt, fee, net, mask, method: m.name, eta: m.eta,
        balance: +(bal - amt).toFixed(2)
      });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* ручная отправка отчёта за сутки: по выбранным кошелькам либо по всем активным */
  app.post('/api/hub/report', async (req, res) => {
    try {
      const list = hubList(req.body);
      const st = ctx.fixStamp(Date.now());
      let rows = [];
      if (list.length) {
        for (const a of list) {
          const u = await hubUser(a);
          if (!u) continue;
          const d = hubDay(u);
          if (d) rows.push({ site: u._site, siteName: sites[u._site].label, acct: u.acct,
            pair: d.pair, gain: d.gain, val: d.val });
        }
      } else {
        rows = await reportAll();
      }
      if (!rows.length) return bad(res, 400, 'Нет кошельков с включённым сценарием — отчитываться пока нечего');
      const text = reportText(rows, 'Отчёт за сутки · ' + st.date);
      const plain = text.replace(/<[^>]+>/g, '');
      const r = await tg.send(text);
      if (r.skipped) return res.json({ ok: false, sent: false, preview: plain,
        error: 'Telegram не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в переменных приложения' });
      if (!r.ok) return res.json({ ok: false, sent: false, preview: plain, error: r.error });
      res.json({ ok: true, sent: true, items: rows.length, preview: plain });
    } catch (e) { bad(res, 500, e.message); }
  });
}

module.exports = {
  install, sendPage, pushNote,
  onRegister, onAdminDelta, onFix, onDayReport,
  reportText, TICKET_TOPICS, HUB_OUT
};
