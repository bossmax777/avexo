'use strict';
/**
 * Avexo Trade — сервер учебного макета.
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

/* ---------- настройки сайта ---------- */
app.get('/api/config', async (_req, res) => {
  try {
    const r = await q('SELECT data FROM site_config WHERE id = 1');
    res.json({ config: (r.rows[0] && r.rows[0].data) || {} });
  } catch (e) { res.json({ config: {}, error: e.message }); }
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

/* начисление, списание, сценарий */
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { delta, dyn, note } = req.body || {};
  try {
    const cur = await q('SELECT * FROM users WHERE id = $1', [id]);
    if (!cur.rows[0]) return bad(res, 404, 'Кошелёк не найден');
    const u = toUser(cur.rows[0]);

    if (delta !== undefined) {
      const amt = Number(delta);
      if (!Number.isFinite(amt) || amt === 0) return bad(res, 400, 'Некорректная сумма');
      if (amt < 0 && Math.abs(amt) > u.balance) return bad(res, 400, 'На кошельке меньше этой суммы');
      const date = new Date().toLocaleDateString('ru-RU');
      const sum = (amt > 0 ? '+' : '−') + '$' + Math.abs(amt).toFixed(2);
      const tx = [[date, note || 'Начисление администратором', sum, 'ok', amt > 0 ? 'Исполнено' : 'Списано'], ...u.tx];
      const hist = [[date, amt > 0 ? 'Начисление' : 'Списание', '—', sum, 'ok'], ...u.hist];
      await q('UPDATE users SET balance = balance + $2, tx = $3::jsonb, hist = $4::jsonb WHERE id = $1',
        [id, amt, JSON.stringify(tx.slice(0, 200)), JSON.stringify(hist.slice(0, 200))]);
    }
    if (dyn !== undefined) {
      await q('UPDATE users SET dyn = $2::jsonb WHERE id = $1', [id, JSON.stringify(dyn || {})]);
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
