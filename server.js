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
  const { delta, dyn, note, acct, card, date, tx: txSet, hist: histSet } = req.body || {};
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
      const tx = [[when, note || 'Начисление администратором', sum, 'ok', amt > 0 ? 'Исполнено' : 'Списано'], ...u.tx];
      const hist = [[when, amt > 0 ? 'Начисление' : 'Списание', '—', sum, 'ok'], ...u.hist];
      await q('UPDATE users SET balance = balance + $2, tx = $3::jsonb, hist = $4::jsonb WHERE id = $1',
        [id, amt, JSON.stringify(tx.slice(0, 200)), JSON.stringify(hist.slice(0, 200))]);
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

/* ---------- статика ---------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ---------- старт ---------- */
(async () => {
  const ok = await init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[avexo] слушает порт ${PORT}, база ${ok ? 'подключена' : 'недоступна'}`);
    if (!ADMIN_KEY) console.warn('[avexo] ADMIN_KEY не задан — админка работать не будет');
  });
  setInterval(() => q('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}), 3600000);
})();
