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
  /* ключ активации один на обе площадки: выпущенный здесь работает и на соседней.
     Поэтому код заводится сразу двумя строками, а отзыв снимает обе. */
  const ALL_SITES = ['bw', 'nx'];
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

  /* отметка вручную: статус можно выставить без заявки, по номеру кошелька или почте.
     Маршрут идёт до /:id, иначе express примет слово mark за номер заявки. */
  app.post('/api/admin/kyc/mark', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const who = clean(b.who, 120);
      if (!who) return bad(res, 400, 'Укажите номер кошелька или почту клиента');
      const st = b.status === 'rejected' ? 'rejected'
        : b.status === 'pending' ? 'pending'
        : b.status === 'none' ? 'none' : 'approved';
      const comment = clean(b.comment, 400);
      const u = await q('SELECT id, email, acct, name FROM ' + T_USERS
        + ' WHERE acct = $1 OR lower(email) = lower($1) LIMIT 1', [who]);
      const me = u.rows[0];
      if (!me) return bad(res, 404, 'Кошелёк с таким номером или почтой на этой площадке не найден');
      if (st === 'none') {
        await q('DELETE FROM kyc WHERE site = $1 AND user_id = $2', [SITE, me.id]);
        return res.json({ ok: true, removed: true, acct: me.acct });
      }
      const r = await q(
        'INSERT INTO kyc (site, user_id, email, acct, name, status, docs, comment, updated_at)'
        + " VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,now())"
        + ' ON CONFLICT (site, user_id) DO UPDATE SET'
        + ' status = EXCLUDED.status, comment = EXCLUDED.comment, updated_at = now()'
        + ' RETURNING *',
        [SITE, me.id, me.email, me.acct, me.name || '', st, comment]);
      const row = r.rows[0];
      if (H.pushNote && st !== 'pending') {
        H.pushNote(T_USERS, me.id, st === 'approved'
          ? { kind: 'acc', title: 'Профиль подтверждён',
              text: 'Верификация пройдена.' + (comment ? ' ' + comment : '') }
          : { kind: 'acc', title: 'Верификация отклонена',
              text: comment || 'Обратитесь в службу поддержки из кабинета.' }).catch(() => {});
      }
      if (me.email && H.sendMail && H.layout && st === 'approved') {
        H.sendMail({
          to: me.email, subject: H.brand() + ': профиль подтверждён',
          html: H.layout(H.brand(), 'Профиль подтверждён', [
            'Кошелёк №' + (me.acct || ''),
            'Верификация пройдена, ограничения на вывод сняты.' + (comment ? '<br>' + comment : '')
          ])
        }).catch(() => {});
      }
      res.json({ ok: true, kyc: kycView(row) });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* массовая отметка: список номеров кошельков или слово all — сразу все на площадке */
  app.post('/api/admin/kyc/bulk', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const st = b.status === 'rejected' ? 'rejected'
        : b.status === 'pending' ? 'pending'
        : b.status === 'none' ? 'none' : 'approved';
      const comment = clean(b.comment, 400);
      let rows;
      if (b.all) {
        rows = (await q('SELECT id, email, acct, name FROM ' + T_USERS + ' ORDER BY id')).rows;
      } else {
        const list = (Array.isArray(b.accts) ? b.accts : []).map(x => String(x)).slice(0, 500);
        if (!list.length) return bad(res, 400, 'Не выбран ни один кошелёк');
        rows = (await q('SELECT id, email, acct, name FROM ' + T_USERS
          + ' WHERE acct = ANY($1::text[]) ORDER BY id', [list])).rows;
      }
      if (!rows.length) return bad(res, 404, 'Кошельки не найдены');
      for (const me of rows) {
        if (st === 'none') {
          await q('DELETE FROM kyc WHERE site = $1 AND user_id = $2', [SITE, me.id]);
          continue;
        }
        await q(
          'INSERT INTO kyc (site, user_id, email, acct, name, status, docs, comment, updated_at)'
          + " VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,now())"
          + ' ON CONFLICT (site, user_id) DO UPDATE SET'
          + ' status = EXCLUDED.status, comment = EXCLUDED.comment, updated_at = now()',
          [SITE, me.id, me.email, me.acct, me.name || '', st, comment]);
        if (H.pushNote && st === 'approved') {
          H.pushNote(T_USERS, me.id, { kind: 'acc', title: 'Профиль подтверждён',
            text: 'Верификация пройдена.' + (comment ? ' ' + comment : '') }).catch(() => {});
        }
      }
      res.json({ ok: true, status: st, count: rows.length, accts: rows.map(x => x.acct) });
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
          days: Number(x.days) || 0,
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
      /* срок годности ключа: сколько дней он работает с момента активации, 0 — бессрочно */
      const days = Math.max(0, Math.min(3650, parseInt(b.days, 10) || 0));
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
        let fresh = false;
        for (const site of ALL_SITES) {
          const r = await q('INSERT INTO bot_keys (site, code, note, days) VALUES ($1,$2,$3,$4)'
            + ' ON CONFLICT (site, code) DO NOTHING RETURNING code', [site, code, note, days]);
          if (r.rows[0] && site === SITE) fresh = true;
        }
        if (fresh) added.push(code);
      }
      res.json({ ok: true, added, skipped: codes.length - added.length, days });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.patch('/api/admin/botkeys/:id', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const days = b.days == null ? null : Math.max(0, Math.min(3650, parseInt(b.days, 10) || 0));
      const one = await q('SELECT code FROM bot_keys WHERE id = $1 AND site = $2',
        [Number(req.params.id), SITE]);
      if (!one.rows[0]) return bad(res, 404, 'Код не найден');
      /* код действует на обеих площадках, поэтому правим все его строки сразу */
      const r = await q('UPDATE bot_keys SET active = $2, note = COALESCE($3, note),'
        + ' days = COALESCE($4, days)'
        + ' WHERE code = $1 RETURNING *',
        [one.rows[0].code, !!b.active, b.note == null ? null : clean(b.note, 120), days]);
      res.json({ ok: true, code: r.rows[0].code, active: !!r.rows[0].active });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.delete('/api/admin/botkeys/:id', requireAdmin, async (req, res) => {
    try {
      const one = await q('SELECT code FROM bot_keys WHERE id = $1 AND site = $2',
        [Number(req.params.id), SITE]);
      if (!one.rows[0]) return bad(res, 404, 'Код не найден');
      const r = await q('DELETE FROM bot_keys WHERE code = $1 RETURNING code', [one.rows[0].code]);
      res.json({ ok: true });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* ---------- активация ключа администратором ---------- */
  /* В админке можно включить бота клиенту, не прося его вводить код, и так же снять.
     Код берётся из выпущенных: можно указать конкретный, иначе берётся свежий активный. */
  app.post('/api/admin/botkeys/assign', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const id = Number(b.user);
      if (!id) return bad(res, 400, 'Не указан кошелёк');
      const u = await q('SELECT id, acct, botkey FROM ' + T_USERS + ' WHERE id = $1', [id]);
      if (!u.rows[0]) return bad(res, 404, 'Кошелёк не найден');
      let row = null;
      const want = normCode(b.code);
      if (want) {
        const r = await q('SELECT * FROM bot_keys WHERE code = $1 ORDER BY (site = $2) DESC, id LIMIT 1',
          [want, SITE]);
        row = r.rows[0];
        if (!row) return bad(res, 404, 'Такой код не выпускался');
        if (!row.active) return bad(res, 403, 'Код отозван');
      } else {
        /* свободный активный код: сперва тот, которым ещё никто не пользовался */
        const r = await q('SELECT k.* FROM bot_keys k WHERE k.site = $1 AND k.active'
          + ' ORDER BY (SELECT count(*) FROM ' + T_USERS + ' w WHERE w.botkey = k.code), k.id LIMIT 1',
          [SITE]);
        row = r.rows[0];
        if (!row) return bad(res, 404, 'Нет ни одного активного кода — выпустите их во вкладке «Ключи бота»');
      }
      /* срок берём из формы, если он там задан; иначе — тот, что записан у кода */
      const asked = Math.max(0, Math.min(3650, parseInt(b.days, 10) || 0));
      const days = asked > 0 ? asked : (Number(row.days) || 0);
      const until = days > 0 ? new Date(Date.now() + days * 86400000) : null;
      await q('UPDATE ' + T_USERS + ' SET botkey = $2, botkey_at = now(), botkey_until = $3 WHERE id = $1',
        [id, row.code, until]);
      await q('UPDATE bot_keys SET uses = uses + 1 WHERE code = $1 AND site = $2', [row.code, SITE]).catch(() => {});
      res.json({ ok: true, acct: u.rows[0].acct, code: row.code, days, until });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/admin/botkeys/revoke', requireAdmin, async (req, res) => {
    try {
      const id = Number((req.body || {}).user);
      if (!id) return bad(res, 400, 'Не указан кошелёк');
      const r = await q('UPDATE ' + T_USERS + " SET botkey = '', botkey_until = NULL"
        + ' WHERE id = $1 RETURNING acct', [id]);
      if (!r.rows[0]) return bad(res, 404, 'Кошелёк не найден');
      res.json({ ok: true, acct: r.rows[0].acct });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* продлить активацию: срок считается заново от этой минуты */
  app.post('/api/admin/botkeys/extend', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const id = Number(b.user);
      const days = Math.max(0, Math.min(3650, parseInt(b.days, 10) || 0));
      if (!id) return bad(res, 400, 'Не указан кошелёк');
      const until = days > 0 ? new Date(Date.now() + days * 86400000) : null;
      const r = await q('UPDATE ' + T_USERS + ' SET botkey_until = $2'
        + " WHERE id = $1 AND botkey <> '' RETURNING acct", [id, until]);
      if (!r.rows[0]) return bad(res, 404, 'У этого кошелька нет активации');
      res.json({ ok: true, acct: r.rows[0].acct, days, until });
    } catch (e) { bad(res, 500, e.message); }
  });

  /* ---------- страница единого бота ---------- */
  if (!ctx.hub) return;
  const { hubUser, hubList, sites } = ctx;

  /* активен ли кошелёк: код записан и всё ещё не отозван в админке */
  async function stateOf(u) {
    const code = String(u.botkey || '');
    let on = false, days = 0, until = null, expired = false;
    if (code) {
      const r = await q('SELECT active, days FROM bot_keys WHERE code = $1'
        + ' ORDER BY (site = $2) DESC, id LIMIT 1', [code, u._site]);
      const row = r.rows[0];
      on = !!(row && row.active);
      days = row ? (Number(row.days) || 0) : 0;
      until = u.botkey_until || null;
      /* срок вышел — активация больше не действует, но запись о ней остаётся */
      if (on && until && new Date(until).getTime() <= Date.now()) { on = false; expired = true; }
    }
    let kyc = 'none';
    try {
      const k = await q('SELECT status FROM kyc WHERE site = $1 AND user_id = $2', [u._site, u.id]);
      if (k.rows[0]) kyc = k.rows[0].status;
    } catch (e) {}
    return {
      site: u._site, siteName: sites[u._site].label, acct: u.acct,
      on, code: on ? code : '', at: u.botkey_at || null,
      days, until, expired,
      /* сколько осталось в миллисекундах: по этому числу страница рисует отсчёт */
      left: (on && until) ? Math.max(0, new Date(until).getTime() - Date.now()) : null,
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

  /* отправка документов прямо со страницы бота: кошелёк опознаётся по ключу API,
     а дальше заявка идёт тем же путём, что и из кабинета площадки */
  app.post('/api/hub/kyc', async (req, res) => {
    try {
      const b = req.body || {};
      const u = await hubUser(b);
      if (!u) return bad(res, 403, 'Кошелёк не найден или ключ API не подходит');
      const site = u._site;
      const cur = await q('SELECT status FROM kyc WHERE site = $1 AND user_id = $2', [site, u.id]);
      const was = cur.rows[0] && cur.rows[0].status;
      if (was === 'pending') return bad(res, 409, 'Документы уже на проверке — дождитесь решения');
      if (was === 'approved') return bad(res, 409, 'Этот кошелёк уже верифицирован');
      const docs = docsIn(b.docs);
      if (docs.length < 2) {
        return bad(res, 400, 'Нужны два снимка: страница паспорта и селфи с ним. Форматы JPG, PNG или WEBP');
      }
      await q(
        'INSERT INTO kyc (site, user_id, email, acct, name, status, docs, comment, updated_at)'
        + " VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb,'',now())"
        + ' ON CONFLICT (site, user_id) DO UPDATE SET'
        + " status = 'pending', docs = EXCLUDED.docs, comment = '', updated_at = now()",
        [site, u.id, u.email, u.acct, u.name || '', JSON.stringify(docs)]);
      if (H.pushNote) {
        H.pushNote(sites[site].users, u.id, {
          kind: 'acc', title: 'Документы отправлены на проверку',
          text: 'Заявка на верификацию принята. Решение придёт в кабинет.'
        }).catch(() => {});
      }
      res.json({ ok: true, state: await stateOf(Object.assign({}, u, { _site: site })) });
    } catch (e) { bad(res, 500, e.message); }
  });

  app.post('/api/hub/bot/activate', async (req, res) => {
    try {
      const b = req.body || {};
      const u = await hubUser(b);
      if (!u) return bad(res, 403, 'Кошелёк не найден или ключ API не подходит');
      const code = normCode(b.code);
      if (!code) return bad(res, 400, 'Код неполный. Формат: X7K9P-4M2QD-V8R3N');
      /* код общий для площадок: берём строку своей площадки, а если её нет — любую */
      const r = await q('SELECT * FROM bot_keys WHERE code = $1'
        + ' ORDER BY (site = $2) DESC, id LIMIT 1', [code, u._site]);
      const row = r.rows[0];
      if (!row) return bad(res, 403, 'Такой код не выпускался');
      if (!row.active) return bad(res, 403, 'Код отозван администратором');
      const table = sites[u._site].users;
      /* срок годности отсчитывается от момента активации; 0 дней — ключ бессрочный */
      const days = Number(row.days) || 0;
      const until = days > 0 ? new Date(Date.now() + days * 86400000) : null;
      await q('UPDATE ' + table + ' SET botkey = $2, botkey_at = now(), botkey_until = $3 WHERE id = $1',
        [u.id, code, until]);
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
      /* в ответ отдаём состояние уже с новым сроком, иначе страница показала бы прежний */
      const st = await stateOf(Object.assign({}, u, { botkey: code, botkey_until: until }));
      res.json({ ok: true, state: st });
    } catch (e) { bad(res, 500, e.message); }
  });
}

module.exports = { install, newCode, normCode, KYC_ST, DOC_KIND };
