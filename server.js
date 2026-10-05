'use strict';
/**
 * BullWaves — сервер учебного макета.
 * Отдаёт статику из public/ и API для демо-кошельков и настроек сайта.
 * Данные живут в PostgreSQL, пароли хранятся в виде scrypt-хеша.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { q, init } = require('./db');
const X = require('./extra');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const SESSION_DAYS = 30;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ---------- пароли ---------- */
function hashPass(pass, salt = crypto.randomBytes(16).toString('hex')) {
  const dk = crypto.scryptSync(String(pass), salt, 32).toString('hex');
  return `scrypt$${salt}$${dk}`;
}
function checkPass(pass, stored) {
  try {
    const [alg, salt, dk] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const calc = crypto.scryptSync(String(pass), salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(dk, 'hex'));
  } catch { return false; }
}

/* ---------- представление пользователя ---------- */
const toUser = r => r && ({
  card: r.card || {},
  id: Number(r.id),
  email: r.email,
  name: r.name,
  phone: r.phone,
  country: r.country,
  acct: r.acct,
  cur: r.cur,
  balance: Number(r.balance),
  dyn: r.dyn || {},
  positions: r.positions || [],
  tx: r.tx || [],
  hist: r.hist || [],
  apikey: r.apikey || '',
  created: r.created_at
});
const newAcct = () => String(4030000 + Math.floor(Math.random() * 9000) + Math.floor(Math.random() * 99));
const bad = (res, code, msg) => res.status(code).json({ error: msg });

/* ---------- сессии ---------- */
async function sessionUser(req) {
  const token = req.cookies && req.cookies.avexo_session;
  if (!token) return null;
  const r = await q(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`, [token]);
  return toUser(r.rows[0]);
}
async function openSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000);
  await q('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)', [token, userId, exp]);
  res.cookie('avexo_session', token, {
    httpOnly: true, sameSite: 'lax', secure: true, expires: exp, path: '/'
  });
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return bad(res, 503, 'ADMIN_KEY не задан в переменных окружения приложения');
  const key = req.get('x-admin-key') || '';
  if (key !== ADMIN_KEY) return bad(res, 401, 'Неверный ключ администратора');
  next();
}

/* ---------- служебное ---------- */
app.get('/api/health', async (_req, res) => {
  try {
    const r = await q('SELECT count(*)::int AS users FROM users');
    res.json({ ok: true, db: 'up', users: r.rows[0].users, time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'down', error: e.message });
  }
});

/* ---------- регистрация и вход ---------- */
app.post('/api/register', async (req, res) => {
  const { name = '', email = '', pass = '', cur = 'USD' } = req.body || {};
  const mail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return bad(res, 400, 'Введите корректный email');
  if (String(pass).length < 6) return bad(res, 400, 'Пароль не короче 6 символов');
  try {
    const r = await q(
      `INSERT INTO users (email, pass_hash, name, acct, cur)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [mail, hashPass(pass), String(name).trim() || mail.split('@')[0], newAcct(), cur === 'EUR' ? 'EUR' : 'USD']);
    const user = toUser(r.rows[0]);
    await openSession(res, user.id);
    X.onRegister(user, req);
    res.json({ user });
  } catch (e) {
    if (e.code === '23505') return bad(res, 409, 'Такой email уже зарегистрирован');
    console.error('[register]', e.message);
    bad(res, 500, 'Не удалось создать кошелёк');
  }
});

app.post('/api/login', async (req, res) => {
  const mail = String((req.body || {}).email || '').trim().toLowerCase();
  const pass = String((req.body || {}).pass || '');
  try {
    const r = await q('SELECT * FROM users WHERE email = $1', [mail]);
    if (!r.rows[0]) return bad(res, 404, 'Аккаунт с таким email не найден');
    if (!checkPass(pass, r.rows[0].pass_hash)) return bad(res, 401, 'Неверный пароль');
    const user = toUser(r.rows[0]);
    await openSession(res, user.id);
    res.json({ user });
  } catch (e) {
    console.error('[login]', e.message);
    bad(res, 500, 'Ошибка входа');
  }
});

app.post('/api/logout', async (req, res) => {
  const token = req.cookies && req.cookies.avexo_session;
  if (token) await q('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {});
  res.clearCookie('avexo_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  try {
    const user = await sessionUser(req);
    res.json({ user: user || null });
  } catch (e) { bad(res, 500, e.message); }
});

/* профиль */
app.patch('/api/me', async (req, res) => {
  try {
    const me = await sessionUser(req);
    if (!me) return bad(res, 401, 'Нужен вход');
    const { name, email, phone, country, pass } = req.body || {};
    const mail = email ? String(email).trim().toLowerCase() : me.email;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return bad(res, 400, 'Введите корректный email');
    if (pass && String(pass).length < 6) return bad(res, 400, 'Пароль не короче 6 символов');
    const r = await q(
      `UPDATE users SET
         name = COALESCE($2, name), email = $3,
         phone = COALESCE($4, phone), country = COALESCE($5, country),
         pass_hash = COALESCE($6, pass_hash)
       WHERE id = $1 RETURNING *`,
      [me.id, name ?? null, mail, phone ?? null, country ?? null, pass ? hashPass(pass) : null]);
    res.json({ user: toUser(r.rows[0]) });
  } catch (e) {
    if (e.code === '23505') return bad(res, 409, 'Этот email уже занят');
    bad(res, 500, e.message);
  }
});

/* состояние кошелька: баланс, позиции, история */
app.put('/api/me/state', async (req, res) => {
  try {
    const me = await sessionUser(req);
    if (!me) return bad(res, 401, 'Нужен вход');
    const { balance, positions, tx, hist } = req.body || {};
    const r = await q(
      `UPDATE users SET
         balance   = COALESCE($2, balance),
         positions = COALESCE($3, positions),
         tx        = COALESCE($4, tx),
         hist      = COALESCE($5, hist)
       WHERE id = $1 RETURNING *`,
      [me.id,
       Number.isFinite(Number(balance)) ? Number(balance) : null,
       positions ? JSON.stringify(positions.slice(0, 200)) : null,
       tx ? JSON.stringify(tx.slice(0, 200)) : null,
       hist ? JSON.stringify(hist.slice(0, 200)) : null]);
    res.json({ user: toUser(r.rows[0]) });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- ключ REST API ---------- */
const newKey = acct => 'avx_' + acct + '_' + crypto.randomBytes(12).toString('hex');

app.get('/api/me/apikey', async (req, res) => {
  try {
    const me = await sessionUser(req);
    if (!me) return bad(res, 401, 'Нужен вход');
    res.json({ key: me.apikey || '' });
  } catch (e) { bad(res, 500, e.message); }
});

app.post('/api/me/apikey', async (req, res) => {
  try {
    const me = await sessionUser(req);
    if (!me) return bad(res, 401, 'Нужен вход');
    const key = newKey(me.acct);
    await q('UPDATE users SET apikey = $2 WHERE id = $1', [me.id, key]);
    res.json({ key });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- торговый бот (отдельная страница /bot) ---------- */
/* Учебная симуляция: бот не отправляет ордера на биржу, он рассчитывает
   прогноз по выбранным параметрам и включает сценарий роста демо-кошелька. */
const BOT_PAIRS = {
  'XAU/USD': { name: 'Золото', vol: 1.00 },
  'XAG/USD': { name: 'Серебро', vol: 1.35 },
  'EUR/USD': { name: 'Евро / Доллар', vol: 0.55 },
  'GBP/USD': { name: 'Фунт / Доллар', vol: 0.70 },
  'USD/JPY': { name: 'Доллар / Иена', vol: 0.65 },
  'BTC/USD': { name: 'Bitcoin', vol: 2.10 },
  'US500':   { name: 'S&P 500', vol: 0.75 },
  'USOIL':   { name: 'WTI Crude', vol: 1.20 }
};
const BOT_RISK = {
  calm:    { name: 'Консервативный', day: 0.009, noise: 0.22, dd: 3 },
  balance: { name: 'Сбалансированный', day: 0.021, noise: 0.34, dd: 7 },
  turbo:   { name: 'Агрессивный', day: 0.042, noise: 0.52, dd: 14 }
};
/* прогноз: сложный процент от доли депозита в работе, с поправкой на волатильность пары */
const BOT_TRADES = { calm: 9, balance: 18, turbo: 34 };   /* сделок в сутки */
/* сборы площадки: комиссия за лот, своп за лот в сутки, сервисный процент с прибыли */
const FEES = { lot: 3.5, swap: 4.2, plat: 1.5 };
function botForecast({ balance, pair, hours, risk, share, fees }) {
  const p = BOT_PAIRS[pair] || BOT_PAIRS['XAU/USD'];
  const r = BOT_RISK[risk] || BOT_RISK.balance;
  const f = Object.assign({}, FEES, fees || {});
  const days = Math.max(hours, 1) / 24;
  const work = balance * Math.max(0.1, Math.min(1, share));
  const rate = r.day * (0.72 + p.vol * 0.38);
  const gross = work * (Math.pow(1 + rate, days) - 1);
  const perDay = BOT_TRADES[risk] || BOT_TRADES.balance;
  const trades = Math.max(4, Math.round(perDay * days));
  const avgLot = 0.3;
  const commission = trades * avgLot * f.lot;
  const swap = avgLot * f.swap * days * Math.max(1, Math.round(perDay / 6));
  const service = Math.max(0, gross) * f.plat / 100;
  const fee = commission + swap + service;
  const gain = gross - fee;
  return {
    pairName: p.name,
    riskName: r.name,
    noise: r.noise,
    work: +work.toFixed(2),
    gross: +gross.toFixed(2),
    commission: +commission.toFixed(2),
    swap: +swap.toFixed(2),
    service: +service.toFixed(2),
    fee: +fee.toFixed(2),
    trades,
    gain: +gain.toFixed(2),
    low: +(gain * 0.62).toFixed(2),
    high: +(gain * 1.31).toFixed(2),
    target: +(balance + gain).toFixed(2),
    pct: balance > 0 ? +(gain / balance * 100).toFixed(2) : 0,
    dd: r.dd,
    days: +days.toFixed(2)
  };
}
/* сборы берём из настроек сайта, если админ их задал */
async function siteFees() {
  try {
    const r = await q('SELECT data FROM site_config WHERE id = 1');
    const f = (r.rows[0] && r.rows[0].data && r.rows[0].data.fees) || {};
    const n = (v, d) => (isFinite(Number(v)) && String(v).trim() !== '') ? Number(v) : d;
    return { lot: n(f.lot, FEES.lot), swap: n(f.swap, FEES.swap), plat: n(f.plat, FEES.plat) };
  } catch (e) { return Object.assign({}, FEES); }
}

async function botUser(req, res) {
  const me = await sessionUser(req);
  if (!me) { bad(res, 401, 'Нужен вход'); return null; }
  return me;
}

/* проверка ключа, выпущенного в личном кабинете */
app.post('/api/bot/connect', async (req, res) => {
  try {
    const me = await botUser(req, res); if (!me) return;
    const key = String((req.body || {}).key || '').trim();
    if (!me.apikey) return bad(res, 409, 'Для этого кошелька ключ ещё не выпущен. Нажмите «Выпустить ключ для этого кошелька» ниже или создайте его в кабинете: Профиль → Ключ REST API → Сгенерировать');
    if (/^avx-/i.test(key)) return bad(res, 403, 'Это идентификатор интеграции из карточки (avx-…). Для бота нужен ключ REST API вида avx_' + me.acct + '_… из блока «Ключ REST API»');
    if (key.toLowerCase() !== String(me.apikey).toLowerCase())
      return bad(res, 403, 'Ключ не подходит к кошельку #' + me.acct + '. Выпустите новый ключ кнопкой ниже или скопируйте актуальный из кабинета');
    res.json({ ok: true, user: { name: me.name, acct: me.acct, cur: me.cur, balance: me.balance }, dyn: me.dyn || {} });
  } catch (e) { bad(res, 500, e.message); }
});

app.get('/api/bot/state', async (req, res) => {
  try {
    const me = await botUser(req, res); if (!me) return;
    res.json({
      user: { name: me.name, acct: me.acct, cur: me.cur, balance: me.balance, hasKey: !!me.apikey },
      dyn: me.dyn || {},
      pairs: BOT_PAIRS, risks: BOT_RISK
    });
  } catch (e) { bad(res, 500, e.message); }
});

/* расчёт прогноза без запуска */
app.post('/api/bot/forecast', async (req, res) => {
  try {
    const me = await botUser(req, res); if (!me) return;
    const b = req.body || {};
    const fees = await siteFees();
    res.json({ forecast: botForecast({
      balance: me.balance,
      pair: b.pair, hours: Number(b.hours) || 24,
      risk: b.risk, share: Number(b.share) || 0.6, fees
    }), fees });
  } catch (e) { bad(res, 500, e.message); }
});

/* запуск: включает сценарий роста кошелька — тот же, что настраивается в админке */
app.post('/api/bot/start', async (req, res) => {
  try {
    const me = await botUser(req, res); if (!me) return;
    const b = req.body || {};
    const key = String(b.key || '').trim();
    if (!me.apikey || key.toLowerCase() !== String(me.apikey).toLowerCase())
      return bad(res, 403, 'Нужен действующий ключ API этого кошелька');
    const pair = BOT_PAIRS[b.pair] ? b.pair : 'XAU/USD';
    const risk = BOT_RISK[b.risk] ? b.risk : 'balance';
    const hours = Math.max(1, Math.min(2160, Math.round(Number(b.hours) || 24)));
    const share = Math.max(0.1, Math.min(1, Number(b.share) || 0.6));
    if (me.balance <= 0) return bad(res, 400, 'На кошельке нет средств — бот не может начать работу');
    const fees = await siteFees();
    const f = botForecast({ balance: me.balance, pair, hours, risk, share, fees });
    const now = new Date();
    const dyn = {
      ...(me.dyn || {}),
      on: true,
      from: +me.balance.toFixed(2),
      to: f.target,
      hours,
      noise: f.noise,
      pair, risk, share,
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + hours * 3600000).toISOString(),
      bot: { on: true, pair, risk, share, startedAt: now.toISOString(), forecast: f.gain }
    };
    await q('UPDATE users SET dyn = $2::jsonb WHERE id = $1', [me.id, JSON.stringify(dyn)]);
    res.json({ ok: true, dyn, forecast: f });
  } catch (e) { bad(res, 500, e.message); }
});

/* остановка: фиксируем достигнутый результат как новый баланс и гасим сценарий */
app.post('/api/bot/stop', async (req, res) => {
  try {
    const me = await botUser(req, res); if (!me) return;
    const d = me.dyn || {};
    const st = new Date(d.startedAt || 0).getTime(), en = new Date(d.endsAt || 0).getTime();
    let value = me.balance;
    if (d.on && isFinite(st) && isFinite(en) && en > st) {
      const pr = Math.max(0, Math.min(1, (Date.now() - st) / (en - st)));
      const from = Number(d.from) || me.balance, to = Number(d.to) || from;
      value = from + (to - from) * pr;
    }
    const dyn = { ...d, on: false, bot: { ...(d.bot || {}), on: false, stoppedAt: new Date().toISOString() } };
    await q('UPDATE users SET dyn = $2::jsonb, balance = $3 WHERE id = $1',
      [me.id, JSON.stringify(dyn), +value.toFixed(2)]);
    res.json({ ok: true, balance: +value.toFixed(2), dyn });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- настройки сайта ---------- */
app.get('/api/config', async (_req, res) => {
  try {
    const r = await q('SELECT data, updated_at FROM site_config WHERE id = 1');
    res.json({
      config: (r.rows[0] && r.rows[0].data) || {},
      v: r.rows[0] ? new Date(r.rows[0].updated_at).getTime() : 0
    });
  } catch (e) { res.json({ config: {}, v: 0, error: e.message }); }
});
/* лёгкая проверка «не изменились ли настройки» — сайт опрашивает её раз в несколько секунд */
app.get('/api/config/v', async (_req, res) => {
  try {
    const r = await q('SELECT updated_at FROM site_config WHERE id = 1');
    res.json({ v: r.rows[0] ? new Date(r.rows[0].updated_at).getTime() : 0 });
  } catch (e) { res.json({ v: 0 }); }
});
app.put('/api/config', requireAdmin, async (req, res) => {
  try {
    await q(`UPDATE site_config SET data = $1::jsonb, updated_at = now() WHERE id = 1`,
      [JSON.stringify(req.body || {})]);
    res.json({ ok: true });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- админка ---------- */
app.get('/api/admin/ping', requireAdmin, (_req, res) => res.json({ ok: true }));

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const r = await q('SELECT * FROM users ORDER BY created_at');
    res.json({ users: r.rows.map(toUser) });
  } catch (e) { bad(res, 500, e.message); }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { name = '', email = '', pass = 'demo123', cur = 'USD' } = req.body || {};
  const mail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return bad(res, 400, 'Некорректный email');
  try {
    const r = await q(
      `INSERT INTO users (email, pass_hash, name, acct, cur) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [mail, hashPass(pass), String(name).trim() || mail.split('@')[0], newAcct(), cur]);
    res.json({ user: toUser(r.rows[0]) });
  } catch (e) {
    if (e.code === '23505') return bad(res, 409, 'Такой email уже есть');
    bad(res, 500, e.message);
  }
});

/* начисление, списание, сценарий, номер счёта */
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { delta, balance: balSet, dyn, note, acct, card, date, pass, email: mailSet, tx: txSet, hist: histSet } = req.body || {};
  try {
    const cur = await q('SELECT * FROM users WHERE id = $1', [id]);
    if (!cur.rows[0]) return bad(res, 404, 'Кошелёк не найден');
    const u = toUser(cur.rows[0]);

    if (delta !== undefined) {
      const amt = Number(delta);
      if (!Number.isFinite(amt) || amt === 0) return bad(res, 400, 'Некорректная сумма');
      if (amt < 0 && Math.abs(amt) > u.balance) return bad(res, 400, 'На кошельке меньше этой суммы');
      const when = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
        ? date.split('-').reverse().join('.')
        : new Date().toLocaleDateString('ru-RU');
      const sum = (amt > 0 ? '+' : '−') + '$' + Math.abs(amt).toFixed(2);
      const ref = 'AVX-' + String(Date.now()).slice(-6) + '-' +
        Math.random().toString(36).slice(2, 5).toUpperCase();
      const defMeth = amt > 0 ? ('Криптовалюта · заявка ' + ref) : ('Вывод на реквизиты клиента · заявка ' + ref);
      const tx = [[when, note || defMeth, sum, 'ok', amt > 0 ? 'Исполнено' : 'Списано'], ...u.tx];
      const hist = [[when, amt > 0 ? 'Пополнение' : 'Вывод', ref, sum, 'ok'], ...u.hist];
      await q('UPDATE users SET balance = balance + $2, tx = $3::jsonb, hist = $4::jsonb WHERE id = $1',
        [id, amt, JSON.stringify(tx.slice(0, 200)), JSON.stringify(hist.slice(0, 200))]);
      X.onAdminDelta(id, amt, ref);
    }
    if (mailSet !== undefined) {
      const m = String(mailSet).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) return bad(res, 400, 'Некорректный email');
      try {
        await q('UPDATE users SET email = $2 WHERE id = $1', [id, m]);
      } catch (e) {
        if (e.code === '23505') return bad(res, 409, 'Такой email уже есть у другого кошелька');
        throw e;
      }
    }
    if (balSet !== undefined) {
      const v = Number(balSet);
      if (!Number.isFinite(v) || v < 0) return bad(res, 400, 'Некорректный баланс');
      await q('UPDATE users SET balance = $2 WHERE id = $1', [id, v.toFixed(2)]);
    }
    if (pass !== undefined) {
      const pw = String(pass);
      if (pw.length < 4) return bad(res, 400, 'Пароль слишком короткий');
      await q('UPDATE users SET pass_hash = $2 WHERE id = $1', [id, hashPass(pw)]);
    }
    if (dyn !== undefined) {
      await q('UPDATE users SET dyn = $2::jsonb WHERE id = $1', [id, JSON.stringify(dyn || {})]);
    }
    if (txSet !== undefined || histSet !== undefined) {
      await q('UPDATE users SET tx = COALESCE($2,tx), hist = COALESCE($3,hist) WHERE id = $1',
        [id,
         txSet ? JSON.stringify(txSet.slice(0, 200)) : null,
         histSet ? JSON.stringify(histSet.slice(0, 200)) : null]);
    }
    if (card !== undefined) {
      await q('UPDATE users SET card = $2::jsonb WHERE id = $1', [id, JSON.stringify(card || {})]);
    }
    if (acct !== undefined) {
      const num = String(acct).trim();
      if (!/^\d{5,12}$/.test(num)) return bad(res, 400, 'Номер счёта — от 5 до 12 цифр');
      await q('UPDATE users SET acct = $2 WHERE id = $1', [id, num]);
    }
    const r = await q('SELECT * FROM users WHERE id = $1', [id]);
    res.json({ user: toUser(r.rows[0]) });
  } catch (e) { bad(res, 500, e.message); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await q('DELETE FROM users WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- массовый итог торгового дня по всем кошелькам ---------- */
/* Учебная функция админки: одной кнопкой записать всем клиентам результат за
   выбранную дату. Процент считается от баланса предыдущего дня — то есть от
   того, что на кошельке сейчас, до записи за эту дату. Каждый запуск
   сохраняется пачкой в таблице mass_days, поэтому его можно отменить целиком:
   балансы вернутся, а строки из истории операций уберутся. */
const MASS_TITLE = 'Итог торгового дня · XAU/USD';
const MASS_SITE = 'bw';
const massRu = iso => String(iso).slice(0, 10).split('-').reverse().join('.');
const massSum = v => (v < 0 ? '−' : '+') + '$' + Math.abs(v).toFixed(2);
/* из истории убираем ровно одну строку — ту, что добавил этот запуск */
function massDrop(rows, hit) {
  const out = (rows || []).slice();
  for (let i = 0; i < out.length; i++) if (hit(out[i])) { out.splice(i, 1); break; }
  return out;
}

app.get('/api/admin/mass-day', requireAdmin, async (_req, res) => {
  try {
    const r = await q(
      `SELECT id, to_char(day, 'YYYY-MM-DD') AS day, pct, dir, undone, created_at,
              jsonb_array_length(items) AS wallets
         FROM mass_days WHERE site = $1 ORDER BY id DESC LIMIT 20`, [MASS_SITE]);
    res.json({ batches: r.rows.map(b => ({
      id: Number(b.id), day: b.day, pct: Number(b.pct), dir: b.dir,
      undone: !!b.undone, wallets: Number(b.wallets), at: b.created_at
    })) });
  } catch (e) { bad(res, 500, e.message); }
});

app.post('/api/admin/mass-day', requireAdmin, async (req, res) => {
  const { date, pct, dir } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return bad(res, 400, 'Укажите дату в виде ГГГГ-ММ-ДД');
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0 || p > 50) return bad(res, 400, 'Процент — число больше нуля и не больше 50');
  const down = String(dir || 'up').toLowerCase() === 'down';
  const when = massRu(date);
  try {
    const r = await q('SELECT * FROM users ORDER BY id');
    const items = [];
    let skipped = 0;
    for (const row of r.rows) {
      const u = toUser(row);
      /* повторный запуск за ту же дату ничего не задваивает */
      if ((u.tx || []).some(t => t && t[0] === when && String(t[1]) === MASS_TITLE)) { skipped++; continue; }
      const before = Number(u.balance) || 0;
      let amt = +(before * p / 100).toFixed(2);
      if (down) amt = -Math.min(amt, before);     /* в минус, но не ниже нуля */
      if (!amt) { skipped++; continue; }
      const sum = massSum(amt);
      const tx = [[when, MASS_TITLE, sum, 'ok', amt >= 0 ? 'Прибыль' : 'Убыток'], ...(u.tx || [])];
      const hist = [[when, 'Результат дня', 'XAU/USD', sum, 'ok'], ...(u.hist || [])];
      await q('UPDATE users SET balance = $2, tx = $3::jsonb, hist = $4::jsonb WHERE id = $1',
        [u.id, (before + amt).toFixed(2), JSON.stringify(tx.slice(0, 200)), JSON.stringify(hist.slice(0, 200))]);
      items.push({ id: u.id, acct: u.acct, name: u.name || '', amount: amt, before });
    }
    /* если записывать было нечего — пустой запуск в список не добавляем */
    if (!items.length) return res.json({ ok: true, batch: 0, applied: 0, skipped, total: 0, items: [] });
    const b = await q(
      'INSERT INTO mass_days (site, day, pct, dir, items) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id',
      [MASS_SITE, date, p, down ? 'down' : 'up', JSON.stringify(items)]);
    res.json({
      ok: true, batch: Number(b.rows[0].id), applied: items.length, skipped,
      total: +items.reduce((s, x) => s + x.amount, 0).toFixed(2),
      items: items.map(x => ({ acct: x.acct, name: x.name, amount: x.amount }))
    });
  } catch (e) { bad(res, 500, e.message); }
});

app.post('/api/admin/mass-day/undo', requireAdmin, async (req, res) => {
  const id = Number((req.body || {}).batch);
  try {
    const b = await q(`SELECT id, to_char(day, 'YYYY-MM-DD') AS day, items, undone
                         FROM mass_days WHERE id = $1 AND site = $2`, [id || 0, MASS_SITE]);
    const row = b.rows[0];
    if (!row) return bad(res, 404, 'Такого запуска нет');
    if (row.undone) return bad(res, 400, 'Этот запуск уже отменён');
    const when = massRu(row.day);
    let back = 0;
    for (const it of (row.items || [])) {
      const cur = await q('SELECT * FROM users WHERE id = $1', [Number(it.id)]);
      if (!cur.rows[0]) continue;
      const u = toUser(cur.rows[0]);
      const amt = Number(it.amount) || 0;
      const sum = massSum(amt);
      const tx = massDrop(u.tx, t => t && t[0] === when && String(t[1]) === MASS_TITLE && String(t[2]) === sum);
      const hist = massDrop(u.hist, t => t && t[0] === when && String(t[1]) === 'Результат дня' && String(t[3]) === sum);
      const bal = Math.max(0, (Number(u.balance) || 0) - amt);
      await q('UPDATE users SET balance = $2, tx = $3::jsonb, hist = $4::jsonb WHERE id = $1',
        [u.id, bal.toFixed(2), JSON.stringify(tx), JSON.stringify(hist)]);
      back++;
    }
    await q('UPDATE mass_days SET undone = true, undone_at = now() WHERE id = $1', [Number(row.id)]);
    res.json({ ok: true, restored: back });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- единый бот Verdix AI (страница /hub.html) ---------- */
/* Учебная симуляция. Страница работает поверх двух демо-площадок, которые
   живут в одной базе: BullWaves — таблица users, Nordis — users_nordis.
   Аккаунт подключается номером кошелька и ключом REST API, выпущенным в кабинете.
   Ордера на биржу не отправляются: бот включает тот же сценарий, что и в кабинете. */
const HUB_SITES = {
  bw: { users: 'users',        cfg: 'site_config',        label: 'BullWaves', brand: 'BullWaves' },
  nx: { users: 'users_nordis', cfg: 'site_config_nordis', label: 'FxPro',    brand: 'FxPro' }
};
function hubSrv(site, v) {
  const s = HUB_SITES[site] || HUB_SITES.bw;
  let n = String(v || s.brand).trim().replace(/[<>"']/g, '').slice(0, 24);
  n = n.replace(/[-_ ]?(demo|live|real)$/i, '').replace(/[-_ ]+$/, '');
  if (!n) n = s.brand;
  return n + '-LIVE';
}
async function hubFees(site) {
  const s = HUB_SITES[site] || HUB_SITES.bw;
  try {
    const r = await q('SELECT data FROM ' + s.cfg + ' WHERE id = 1');
    const f = (r.rows[0] && r.rows[0].data && r.rows[0].data.fees) || {};
    const srv = (r.rows[0] && r.rows[0].data && r.rows[0].data.account && r.rows[0].data.account.srv) || '';
    const n = (v, d) => (isFinite(Number(v)) && String(v).trim() !== '') ? Number(v) : d;
    return { fees: { lot: n(f.lot, FEES.lot), swap: n(f.swap, FEES.swap), plat: n(f.plat, FEES.plat) }, srv };
  } catch (e) { return { fees: Object.assign({}, FEES), srv: '' }; }
}
/* поиск кошелька по одному ключу API: номер счёта и площадка определяются сами.
   Ключ выдаётся в кабинете и привязан к одному кошельку, поэтому его достаточно. */
async function hubUser(a) {
  const key = String((a && a.key) || '').trim();
  if (key.length < 12) return null;
  const hint = String((a && a.site) || '').toLowerCase();
  const order = HUB_SITES[hint] ? [hint].concat(Object.keys(HUB_SITES).filter(x => x !== hint))
                                : Object.keys(HUB_SITES);
  for (const site of order) {
    const r = await q('SELECT * FROM ' + HUB_SITES[site].users + ' WHERE lower(apikey) = lower($1) LIMIT 1', [key]);
    const u = r.rows[0];
    if (u && u.apikey) { u._site = site; return u; }
  }
  return null;
}
async function hubCard(u) {
  const site = u._site;
  const meta = await hubFees(site);
  return {
    site,
    siteName: HUB_SITES[site].label,
    acct: u.acct,
    name: u.name || '',
    cur: u.cur || 'USD',
    balance: Number(u.balance) || 0,
    srv: hubSrv(site, meta.srv),
    dyn: u.dyn || {},
    fees: meta.fees,
    demo: true
  };
}
function hubList(body) {
  const arr = (body && Array.isArray(body.accounts)) ? body.accounts : [];
  return arr.slice(0, 40);
}

/* вход по почте и паролю: ищем кошельки с такими данными на обеих площадках
   и возвращаем ключи API — на самой странице пароль не сохраняется */
app.post('/api/hub/login', async (req, res) => {
  try {
    const mail = String((req.body || {}).email || '').trim().toLowerCase();
    const pass = String((req.body || {}).pass || '');
    if (!mail || !pass) return bad(res, 400, 'Укажите почту и пароль');
    const found = [];
    for (const site of Object.keys(HUB_SITES)) {
      const r = await q('SELECT * FROM ' + HUB_SITES[site].users + ' WHERE email = $1 LIMIT 1', [mail]);
      const u = r.rows[0];
      if (!u) continue;
      if (!checkPass(pass, u.pass_hash)) continue;
      /* ключ выпускаем автоматически, если его ещё нет */
      let key = u.apikey || '';
      if (!key) {
        key = newKey(u.acct);
        await q('UPDATE ' + HUB_SITES[site].users + ' SET apikey = $2 WHERE id = $1', [u.id, key]);
        u.apikey = key;
      }
      u._site = site;
      found.push(Object.assign({ key }, await hubCard(u)));
    }
    if (!found.length) return bad(res, 403, 'Кошельки с такой почтой и паролем не найдены ни на одной площадке');
    res.json({ ok: true, accounts: found, pairs: BOT_PAIRS, risks: BOT_RISK });
  } catch (e) { bad(res, 500, e.message); }
});

/* подключение одного кошелька по ключу API */
app.post('/api/hub/link', async (req, res) => {
  try {
    const u = await hubUser(req.body || {});
    if (!u) return bad(res, 403, 'Кошелёк не найден или ключ API не подходит. Ключ выпускается в кабинете площадки: Профиль → Ключ REST API');
    res.json({ ok: true, account: await hubCard(u), pairs: BOT_PAIRS, risks: BOT_RISK });
  } catch (e) { bad(res, 500, e.message); }
});

/* состояние всех подключённых кошельков */
app.post('/api/hub/state', async (req, res) => {
  try {
    const list = hubList(req.body);
    const out = [];
    for (const a of list) {
      const u = await hubUser(a);
      if (u) out.push(await hubCard(u));
      else out.push({ site: String(a.site || ''), acct: String(a.acct || ''), error: 'Ключ больше не подходит' });
    }
    res.json({ ok: true, accounts: out, pairs: BOT_PAIRS, risks: BOT_RISK, now: Date.now() });
  } catch (e) { bad(res, 500, e.message); }
});

/* расчёт прогноза сразу по списку кошельков */
app.post('/api/hub/forecast', async (req, res) => {
  try {
    const b = req.body || {};
    const list = hubList(b);
    const out = [];
    for (const a of list) {
      const u = await hubUser(a);
      if (!u) continue;
      const p = a.params || b.params || {};
      const meta = await hubFees(u._site);
      out.push({
        site: u._site, acct: u.acct,
        forecast: botForecast({
          balance: Number(u.balance) || 0,
          pair: p.pair, hours: Number(p.hours) || 24,
          risk: p.risk, share: Number(p.share) || 0.6, fees: meta.fees
        })
      });
    }
    res.json({ ok: true, items: out });
  } catch (e) { bad(res, 500, e.message); }
});

/* запуск сценария: массово или по одному кошельку */
app.post('/api/hub/start', async (req, res) => {
  try {
    const b = req.body || {};
    const list = hubList(b);
    const out = [];
    for (const a of list) {
      const u = await hubUser(a);
      if (!u) { out.push({ site: a.site, acct: a.acct, ok: false, error: 'Ключ не подходит' }); continue; }
      const balance = Number(u.balance) || 0;
      if (balance <= 0) { out.push({ site: u._site, acct: u.acct, ok: false, error: 'На кошельке нет средств' }); continue; }
      const p = a.params || b.params || {};
      const pair = BOT_PAIRS[p.pair] ? p.pair : 'XAU/USD';
      const risk = BOT_RISK[p.risk] ? p.risk : 'balance';
      const hours = Math.max(1, Math.min(2160, Math.round(Number(p.hours) || 24)));
      const share = Math.max(0.1, Math.min(1, Number(p.share) || 0.6));
      /* направление сценария: 'down' — демонстрация убыточной сессии */
      const dir = String(p.dir || '').toLowerCase() === 'down' ? 'down' : 'up';
      const meta = await hubFees(u._site);
      const f = botForecast({ balance, pair, hours, risk, share, fees: meta.fees });
      /* в минус уходит и рыночный результат, и сборы площадки */
      const gain = dir === 'down' ? -(f.gross + f.fee) : f.gain;
      const target = Math.max(0, +(balance + gain).toFixed(2));
      const now = new Date();
      const dyn = Object.assign({}, u.dyn || {}, {
        on: true,
        from: +balance.toFixed(2),
        to: target,
        hours, noise: f.noise, pair, risk, share, dir,
        startedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + hours * 3600000).toISOString(),
        bot: { on: true, pair, risk, share, dir, startedAt: now.toISOString(), forecast: +gain.toFixed(2), via: 'hub' },
        fixDaily: true,
        fix: { last: '', lastVal: +balance.toFixed(2) }
      });
      await q('UPDATE ' + HUB_SITES[u._site].users + ' SET dyn = $2::jsonb WHERE id = $1',
        [u.id, JSON.stringify(dyn)]);
      out.push({ site: u._site, acct: u.acct, ok: true, dyn, dir, forecast: Object.assign({}, f, { gain: +gain.toFixed(2), target }) });
    }
    res.json({ ok: true, items: out });
  } catch (e) { bad(res, 500, e.message); }
});

/* остановка: фиксируем достигнутое значение как баланс кошелька */
app.post('/api/hub/stop', async (req, res) => {
  try {
    const list = hubList(req.body);
    const out = [];
    for (const a of list) {
      const u = await hubUser(a);
      if (!u) { out.push({ site: a.site, acct: a.acct, ok: false, error: 'Ключ не подходит' }); continue; }
      const d = u.dyn || {};
      const st = new Date(d.startedAt || 0).getTime(), en = new Date(d.endsAt || 0).getTime();
      let value = Number(u.balance) || 0;
      if (d.on && isFinite(st) && isFinite(en) && en > st) {
        const pr = Math.max(0, Math.min(1, (Date.now() - st) / (en - st)));
        const from = Number(d.from) || value, to = Number(d.to) || from;
        value = from + (to - from) * pr;
      }
      const dyn = Object.assign({}, d, {
        on: false,
        bot: Object.assign({}, d.bot || {}, { on: false, stoppedAt: new Date().toISOString() })
      });
      await q('UPDATE ' + HUB_SITES[u._site].users + ' SET dyn = $2::jsonb, balance = $3 WHERE id = $1',
        [u.id, JSON.stringify(dyn), +value.toFixed(2)]);
      out.push({ site: u._site, acct: u.acct, ok: true, balance: +value.toFixed(2), dyn });
    }
    res.json({ ok: true, items: out });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- фиксация результата торгового дня ----------
   Раз в будний день в 21:00 по Шанхаю (UTC+8) по каждому кошельку с включённым
   сценарием дописывается строка «Результат дня» в историю операций кабинета.
   Баланс при этом не трогаем: сценарий ведёт его сам, строка — только журнал. */
const FIX_TZ = 'Asia/Shanghai';
const FIX_HOUR = 21;

/* сдвиг биржевого времени — тот же расчёт, что в кабинетах */
const MKT_TZ = 'America/New_York';
const _mktOff = new Map();
function mktOff(ts) {
  const k = Math.floor(ts / 3600000);
  if (_mktOff.has(k)) return _mktOff.get(k);
  let off = -5 * 3600000;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: MKT_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ts)).reduce((o, x) => (o[x.type] = x.value, o), {});
    off = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second)
      - Math.floor(ts / 1000) * 1000;
  } catch (e) {}
  if (_mktOff.size > 500) _mktOff.clear();
  _mktOff.set(k, off);
  return off;
}
function mktSegs(dow) {
  if (dow === 6) return [];
  if (dow === 0) return [[18, 24]];
  if (dow === 5) return [[0, 17]];
  return [[0, 17], [18, 24]];
}
function mktElapsed(a, b) {
  if (!(b > a)) return 0;
  if (b - a > 400 * 86400000) return b - a;
  const off = mktOff(a), A = a + off, B = b + off;
  let total = 0;
  for (let day = Math.floor(A / 86400000) * 86400000; day < B; day += 86400000) {
    for (const [h0, h1] of mktSegs(new Date(day).getUTCDay())) {
      const s = day + h0 * 3600000, e = day + h1 * 3600000;
      total += Math.max(0, Math.min(B, e) - Math.max(A, s));
    }
  }
  return total;
}
/* кривая сценария — один в один с кабинетом, чтобы цифры совпадали */
const FIX_FREQ = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
function fixPhase(i, seed) {
  const a = Math.sin(i * 374.761 + seed * 911.13) * 43758.5453;
  return (a - Math.floor(a)) * Math.PI * 2;
}
function fixWave(p, seed, k) {
  let v = 0; const m = k || 1;
  for (let i = 0; i < FIX_FREQ.length; i++) {
    const f = FIX_FREQ[i] * m;
    v += Math.sin(2 * Math.PI * f * p + fixPhase(i, seed)) / Math.pow(f, 0.78);
  }
  return v;
}
function fixPath(p, seed, k) {
  const w0 = fixWave(0, seed, k), w1 = fixWave(1, seed, k);
  return (fixWave(p, seed, k) - ((1 - p) * w0 + p * w1)) / 1.9;
}
function fixCurve(d, pr, st, span) {
  const from = Number(d.from) || 0, to = Number(d.to) || 0;
  const seed = (st / 60000) % 9973;
  const c = (d && d.chart) || {};
  const num = v => (v === '' || v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
  const up = num(c.up), down = num(c.down), drift = num(c.drift) || 0, speed = num(c.speed) || 1;
  let base = from + (to - from) * pr;
  if (drift) base += from * (drift / 100) * (span * pr / 86400000);
  const w = fixPath(pr, seed, speed);
  let amp;
  if (up !== null || down !== null) amp = (w >= 0 ? (up !== null ? up : 2) : (down !== null ? down : 2)) / 100 * from;
  else amp = Math.max(Math.abs(to - from), from * 0.03) * (Number(d.noise) || 0) * 0.55;
  return Math.max(0, base + w * amp);
}
/* значение сценария в момент t (прогресс считается торговым временем) */
function fixValue(dyn, t) {
  const d = dyn || {};
  if (!d.on || !d.startedAt) return null;
  const st = new Date(d.startedAt).getTime(), en = new Date(d.endsAt || 0).getTime();
  if (!isFinite(st) || !isFinite(en) || en <= st) return null;
  const tspan = en - st;
  const pr = Math.max(0, Math.min(1, mktElapsed(st, t || Date.now()) / tspan));
  return fixCurve(d, pr, st, tspan);
}
/* дата и день недели по Шанхаю */
function fixStamp(ts) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: FIX_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' })
    .formatToParts(new Date(ts)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return {
    date: p.day + '.' + p.month + '.' + p.year,
    hour: (+p.hour) % 24,
    weekend: p.weekday === 'Sat' || p.weekday === 'Sun'
  };
}
const fixMoney = n => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);

/* одна фиксация по кошельку; возвращает строку журнала или null */
async function hubFixOne(site, u, now) {
  const d = u.dyn || {};
  if (!d.on || d.fixDaily === false) return null;
  const val = fixValue(d, now);
  if (val === null) return null;
  const st = fixStamp(now);
  const fix = d.fix || {};
  if (fix.last === st.date) return null;                 /* за сегодня уже есть */
  const prev = isFinite(Number(fix.lastVal)) ? Number(fix.lastVal) : (Number(d.from) || val);
  const gain = +(val - prev).toFixed(2);
  if (Math.abs(gain) < 0.01) return null;
  const pair = d.pair || 'XAU/USD';
  const row = [st.date, 'Результат дня', pair, fixMoney(gain), 'ok'];
  const hist = [row].concat(Array.isArray(u.hist) ? u.hist : []).slice(0, 200);
  const dyn = Object.assign({}, d, { fix: { last: st.date, lastVal: +val.toFixed(2) } });
  await q('UPDATE ' + HUB_SITES[site].users + ' SET hist = $2::jsonb, dyn = $3::jsonb WHERE id = $1',
    [u.id, JSON.stringify(hist), JSON.stringify(dyn)]);
  X.onFix(HUB_SITES[site].users, u.id, st.date, pair, fixMoney(gain));
  return { site, acct: u.acct, date: st.date, pair, sum: fixMoney(gain), gain: gain, val: +val.toFixed(2) };
}

/* обход всех кошельков с включённым сценарием */
async function hubFixAll(force) {
  const now = Date.now();
  const st = fixStamp(now);
  if (!force && (st.weekend || st.hour < FIX_HOUR)) return [];
  const out = [];
  for (const site of Object.keys(HUB_SITES)) {
    try {
      const r = await q("SELECT * FROM " + HUB_SITES[site].users +
        " WHERE (dyn->>'on') = 'true' LIMIT 500");
      for (const u of r.rows) {
        try { const x = await hubFixOne(site, u, now); if (x) out.push(x); }
        catch (e) { console.error('[fix]', site, u.acct, e.message); }
      }
    } catch (e) { console.error('[fix]', site, e.message); }
  }
  if (out.length) {
    console.log('[fix] записано строк: ' + out.length);
    /* отчёт за сутки одним сообщением в общий чат */
    await X.onDayReport(out.map(x => ({
      site: x.site, siteName: HUB_SITES[x.site].label, acct: x.acct,
      pair: x.pair, gain: Number(x.gain) || 0, val: x.val
    })), st.date);
  }
  return out;
}
/* проверяем каждые пять минут: сервер мог быть перезапущен или спать */
setInterval(() => { hubFixAll(false).catch(() => {}); }, 5 * 60000);
setTimeout(() => { hubFixAll(false).catch(() => {}); }, 20000);

/* ручная фиксация по выбранным кошелькам — для показа, не дожидаясь 21:00 */
app.post('/api/hub/fix', async (req, res) => {
  try {
    const list = hubList(req.body);
    const now = Date.now();
    const out = [];
    for (const a of list) {
      const u = await hubUser(a);
      if (!u) { out.push({ site: a.site, acct: a.acct, ok: false, error: 'Ключ не подходит' }); continue; }
      const x = await hubFixOne(u._site, u, now);
      if (x) out.push(Object.assign({ ok: true }, x));
      else out.push({ site: u._site, acct: u.acct, ok: false, error: 'Нечего фиксировать: сценарий выключен или за сегодня уже записано' });
    }
    res.json({ ok: true, items: out });
  } catch (e) { bad(res, 500, e.message); }
});

/* включение и выключение автофиксации по кошельку */
app.post('/api/hub/fixmode', async (req, res) => {
  try {
    const b = req.body || {};
    const want = b.on !== false;
    const list = hubList(b);
    const out = [];
    for (const a of list) {
      const u = await hubUser(a);
      if (!u) continue;
      const dyn = Object.assign({}, u.dyn || {}, { fixDaily: want });
      await q('UPDATE ' + HUB_SITES[u._site].users + ' SET dyn = $2::jsonb WHERE id = $1',
        [u.id, JSON.stringify(dyn)]);
      out.push({ site: u._site, acct: u.acct, ok: true, fixDaily: want });
    }
    res.json({ ok: true, items: out });
  } catch (e) { bad(res, 500, e.message); }
});

/* ---------- дополнения: письма, уведомления, поддержка, вывод и отчёты ---------- */
X.install(app, {
  q, bad, crypto, pub: path.join(__dirname, 'public'),
  users: 'users', sessions: 'sessions', tag: 'bw', brand: 'BullWaves',
  sessionUser, openSession, hashPass, toUser, requireAdmin,
  hub: true, sites: HUB_SITES, hubUser, hubList, fixValue, fixStamp
});

/* ---------- статика ---------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (_req, res) => X.sendPage(res, 'index.html'));

/* ---------- старт ---------- */
(async () => {
  const ok = await init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[avexo] слушает порт ${PORT}, база ${ok ? 'подключена' : 'недоступна'}`);
    if (!ADMIN_KEY) console.warn('[avexo] ADMIN_KEY не задан — админка работать не будет');
  });
  setInterval(() => q('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}), 3600000);
})();
