'use strict';
/**
 * Ключи активации торгового бота и верификация профиля.
 *   — bot_keys: коды вида X7K9P-4M2QD-V8R3N, которые владелец выпускает в админке;
 *     код вводится в карточке кошелька на странице единого бота и включает плашку
 *     «Бот активен». Код многоразовый: работает, пока не отозван в админке;
 *   — kyc: заявка на верификацию с документами, подаётся в кабинете, решение
 *     принимается в админке площадки.
 * Подключается из extra.js, собственных зависимостей не имеет.
 */
const crypto = require('crypto');

let CTX = null, H = {};
const q = (t, p) => CTX.q(t, p);
const bad = (res, c, m) => CTX.bad(res, c, m);

/* ---------- коды активации ---------- */
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* без похожих символов */
function newCode() {
  const part = () => Array.from({ length: 5 },
    () => ALPH[crypto.randomBytes(1)[0] % ALPH.length]).join('');
  return part() + '-' + part() + '-' + part();
}
/* приводим ввод к единому виду: регистр, пробелы и лишние дефисы не важны */
function normCode(v) {
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 9 || s.length > 24) return '';
  return s.length === 15 ? s.slice(0, 5) + '-' + s.slice(5, 10) + '-' + s.slice(10) : s;
}

/* ---------- заявки на верификацию ---------- */
const KYC_ST = { none: 'не подавалась', pending: 'на проверке',
                 approved: 'подтверждён', rejected: 'отклонена' };
const DOC_KIND = {
  id:     'Документ, удостоверяющий личность',
  selfie: 'Селфи с документом',
  addr:   'Подтверждение адреса'
};
const DOC_MAX = 900000;   /* ~650 КБ на файл после сжатия в браузере */
const clean = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n);

function docsIn(list) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, 3).forEach(d => {
    const kind = DOC_KIND[String(d && d.kind)] ? String(d.kind) : 'id';
    const data = String((d && d.data) || '');
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) return;
    if (data.length > DOC_MAX) return;
    out.push({ kind, name: clean(d.name, 80), size: data.length, data });
  });
  return out;
}
const docsOut = docs => (Array.isArray(docs) ? docs : []).map(d => ({
  kind: d.kind, kindName: DOC_KIND[d.kind] || DOC_KIND.id, name: d.name || '', size: d.size || 0
}));
function kycView(r, withData) {
  if (!r) return null;
  return {
    id: Number(r.id), site: r.site, email: r.email, acct: r.acct, name: r.name,
    status: r.status, statusName: KYC_ST[r.status] || r.status,
    comment: r.comment || '',
    docs: withData
      ? (Array.isArray(r.docs) ? r.docs : []).map(function (d) {
          return { kind: d.kind, kindName: DOC_KIND[d.kind] || DOC_KIND.id,
                   name: d.name || '', size: d.size || 0, data: d.data };
        })
      : docsOut(r.docs),
    created: r.created_at, updated: r.updated_at
  };
}

function install(app, ctx, helpers) {
  CTX = ctx;
  H = helpers || {};
  const T_USERS = ctx.users;
  const SITE = ctx.tag;
  const requireAdmin = ctx.requireAdmin;
  const sessionUser = ctx.sessionUser;

  /* ---------- кабинет: верификация ---------- */
  app.get('/api/kyc', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const r = await q('SELECT * FROM kyc WHERE site = $1 AND user_id = $2', [SITE, me.id]);
      res.json({
        ok: true, kinds: DOC_KIND, statuses: KYC_ST,
        kyc: r.rows[0] ? kycView(r.rows[0]) : { status: 'none', statusName: KYC_ST.none, docs: [], comment: '' }
      });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/kyc', async (req, res) => {
    try {
      const me = await sessionUser(req);
      if (!me) return bad(res, 401, 'Нужен вход');
      const cur = await q('SELECT status FROM kyc WHERE site = $1 AND user_id = $2', [SITE, me.id]);
      if (cur.rows[0] && cur.rows[0].status === 'pending') {
        return bad(res, 409, 'Заявка уже на проверке — дождитесь решения');
      }
      if (cur.rows[0] && cur.rows[0].status === 'approved') {
        return bad(res, 409, 'Профиль уже подтверждён');
      }
      const docs = docsIn((req.body || {}).docs);
      if (docs.length < 2) {
        return bad(res, 400, 'Нужны минимум два снимка: документ и селфи с ним. Форматы JPG, PNG или WEBP');
      }
      const r = await q(
        'INSERT INTO kyc (site, user_id, email, acct, name, status, docs, comment, updated_at)'
        + " VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb,'',now())"
        + ' ON CONFLICT (site, user_id) DO UPDATE SET'
        + " status = 'pending', docs = EXCLUDED.docs, comment = '', updated_at = now()"
        + ' RETURNING *',
        [SITE, me.id, me.email, me.acct, me.name || '', JSON.stringify(docs)]);
      if (H.pushNote) {
        H.pushNote(T_USERS, me.id, {
          kind: 'acc', title: 'Документы отправлены на проверку',
          text: 'Заявка на верификацию принята. Решение придёт в кабинет, обычно в течение рабочего дня.'
        }).catch(() => {});
      }
      res.json({ ok: true, kyc: kycView(r.rows[0]) });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* ---------- админка: верификация ---------- */
  app.get('/api/admin/kyc', requireAdmin, async (req, res) => {
    try {
      const st = String(req.query.status || '');
      const args = [SITE];
      let where = 'site = $1';
      if (KYC_ST[st] && st !== 'none') { where += ' AND status = $2'; args.push(st); }
      const r = await q('SELECT * FROM kyc WHERE ' + where + ' ORDER BY updated_at DESC LIMIT 200', args);
      res.json({ list: r.rows.map(x => kycView(x)), statuses: KYC_ST, kinds: DOC_KIND });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.get('/api/admin/kyc/:id', requireAdmin, async (req, res) => {
    try {
      const r = await q('SELECT * FROM kyc WHERE id = $1 AND site = $2', [Number(req.params.id), SITE]);
      if (!r.rows[0]) return bad(res, 404, 'Заявка не найдена');
      res.json({ kyc: kycView(r.rows[0], true) });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/admin/kyc/:id', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const st = String(b.status || '');
      if (st !== 'approved' && st !== 'rejected' && st !== 'pending') return bad(res, 400, 'Неизвестное решение');
      const comment = clean(b.comment, 400);
      const r = await q('UPDATE kyc SET status = $2, comment = $3, updated_at = now()'
        + ' WHERE id = $1 AND site = $4 RETURNING *', [Number(req.params.id), st, comment, SITE]);
      const row = r.rows[0];
      if (!row) return bad(res, 404, 'Заявка не найдена');
      if (row.user_id && H.pushNote && st !== 'pending') {
        H.pushNote(T_USERS, row.user_id, st === 'approved'
          ? { kind: 'acc', title: 'Профиль подтверждён',
              text: 'Документы приняты, верификация пройдена.' + (comment ? ' ' + comment : '') }
          : { kind: 'acc', title: 'Документы отклонены',
              text: (comment || 'Снимки не подошли: загрузите документ заново, целиком и без бликов.') }
        ).catch(() => {});
      }
      if (row.email && H.sendMail && H.layout && st !== 'pending') {
        H.sendMail({
          to: row.email,
          subject: H.brand() + (st === 'approved' ? ': профиль подтверждён' : ': документы отклонены'),
          html: H.layout(H.brand(), st === 'approved' ? 'Профиль подтверждён' : 'Документы отклонены', [
            'Кошелёк №' + (row.acct || ''),
            st === 'approved'
              ? 'Документы приняты, верификация пройдена.'
              : 'Загруженные документы не подошли.' + (comment ? '<br>Причина: ' + comment : ''),
            st === 'approved' ? '' : 'Подать заявку заново можно в кабинете, раздел «Верификация».'
          ].filter(Boolean))
        }).catch(() => {});
      }
      res.json({ ok: true, kyc: kycView(row) });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* ---------- админка: ключи активации ---------- */
  app.get('/api/admin/botkeys', requireAdmin, async (_req, res) => {
    try {
      const r = await q('SELECT * FROM bot_keys WHERE site = $1 ORDER BY created_at DESC LIMIT 500', [SITE]);
      const w = await q('SELECT botkey, count(*)::int AS n FROM ' + T_USERS
        + " WHERE botkey <> '' GROUP BY botkey");
      const used = {};
      w.rows.forEach(x => { used[x.botkey] = x.n; });
      res.json({
        list: r.rows.map(x => ({
          id: Number(x.id), code: x.code, note: x.note || '', active: !!x.active,
          uses: Number(x.uses) || 0, wallets: used[x.code] || 0, created: x.created_at
        }))
      });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* выпуск новых кодов: либо сгенерировать count штук, либо добавить свои */
  app.post('/api/admin/botkeys', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const note = clean(b.note, 120);
      let codes = [];
      if (b.codes) {
        codes = String(b.codes).split(/[\s,;]+/).map(normCode).filter(Boolean);
        if (!codes.length) return bad(res, 400, 'Не разобрал ни одного кода. Формат: X7K9P-4M2QD-V8R3N');
      } else {
        const n = Math.min(100, Math.max(1, parseInt(b.count, 10) || 1));
        for (let i = 0; i < n; i++) codes.push(newCode());
      }
      codes = codes.slice(0, 100);
      const added = [];
      for (const code of codes) {
        const r = await q('INSERT INTO bot_keys (site, code, note) VALUES ($1,$2,$3)'
          + ' ON CONFLICT (site, code) DO NOTHING RETURNING code', [SITE, code, note]);
        if (r.rows[0]) added.push(code);
      }
      res.json({ ok: true, added, skipped: codes.length - added.length });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.patch('/api/admin/botkeys/:id', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const r = await q('UPDATE bot_keys SET active = $2, note = COALESCE($3, note)'
        + ' WHERE id = $1 AND site = $4 RETURNING *',
        [Number(req.params.id), !!b.active, b.note == null ? null : clean(b.note, 120), SITE]);
      if (!r.rows[0]) return bad(res, 404, 'Код не найден');
      res.json({ ok: true, code: r.rows[0].code, active: !!r.rows[0].active });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.delete('/api/admin/botkeys/:id', requireAdmin, async (req, res) => {
    try {
      const r = await q('DELETE FROM bot_keys WHERE id = $1 AND site = $2 RETURNING code',
        [Number(req.params.id), SITE]);
      if (!r.rows[0]) return bad(res, 404, 'Код не найден');
      res.json({ ok: true });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* ---------- страница единого бота ---------- */
  if (!ctx.hub) return;
  const { hubUser, hubList, sites } = ctx;

  /* активен ли кошелёк: код записан и всё ещё не отозван в админке */
  async function stateOf(u) {
    const code = String(u.botkey || '');
    let on = false;
    if (code) {
      const r = await q('SELECT 1 FROM bot_keys WHERE site = $1 AND code = $2 AND active', [u._site, code]);
      on = !!r.rows[0];
    }
    let kyc = 'none';
    try {
      const k = await q('SELECT status FROM kyc WHERE site = $1 AND user_id = $2', [u._site, u.id]);
      if (k.rows[0]) kyc = k.rows[0].status;
    } catch (e) {}
    return {
      site: u._site, siteName: sites[u._site].label, acct: u.acct,
      on, code: on ? code : '', at: u.botkey_at || null,
      kyc, kycName: KYC_ST[kyc] || kyc
    };
  }

  app.post('/api/hub/bot/state', async (req, res) => {
    try {
      const list = hubList(req.body);
      const out = [];
      for (const a of list) {
        const u = await hubUser(a);
        if (u) out.push(await stateOf(u));
      }
      res.json({ items: out });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/hub/bot/activate', async (req, res) => {
    try {
      const b = req.body || {};
      const u = await hubUser(b);
      if (!u) return bad(res, 403, 'Кошелёк не найден или ключ API не подходит');
      const code = normCode(b.code);
      if (!code) return bad(res, 400, 'Код неполный. Формат: X7K9P-4M2QD-V8R3N');
      const r = await q('SELECT * FROM bot_keys WHERE site = $1 AND code = $2', [u._site, code]);
      const row = r.rows[0];
      if (!row) return bad(res, 403, 'Такой код не выпускался для этой площадки');
      if (!row.active) return bad(res, 403, 'Код отозван администратором');
      const table = sites[u._site].users;
      await q('UPDATE ' + table + ' SET botkey = $2, botkey_at = now() WHERE id = $1', [u.id, code]);
      await q('UPDATE bot_keys SET uses = uses + 1 WHERE id = $1', [row.id]).catch(() => {});
      if (H.pushNote) {
        H.pushNote(table, u.id, {
          kind: 'acc', title: 'Бот активирован',
          text: 'Код ' + code + ' принят, торговый помощник включён для кошелька №' + u.acct + '.'
        }).catch(() => {});
      }
      if (H.tg) {
        H.tg.send('🔑 <b>Активация бота</b>\n' + sites[u._site].label + ' · кошелёк #' + u.acct
          + '\nКод: ' + code + '\n<i>Учебный демо-стенд.</i>').catch(() => {});
      }
      const st = await stateOf(Object.assign({}, u, { botkey: code }));
      res.json({ ok: true, state: st });
    } catch (e) { bad(res, 500, e.message); }
  });
}

module.exports = { install, newCode, normCode, KYC_ST, DOC_KIND };
