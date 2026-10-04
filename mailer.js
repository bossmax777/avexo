'use strict';
/**
 * Отправка писем без внешних зависимостей: свой минимальный SMTP-клиент.
 * Настройки берутся из переменных окружения приложения:
 *   SMTP_HOST   — адрес сервера (smtp.yandex.ru, smtp.mail.ru, smtp.gmail.com …)
 *   SMTP_PORT   — 465 (сразу TLS) или 587 / 25 (STARTTLS). По умолчанию 465.
 *   SMTP_USER   — логин, он же обычно адрес отправителя
 *   SMTP_PASS   — пароль приложения
 *   MAIL_FROM   — что показывать в поле «От» («BullWaves <no-reply@…>»)
 *   SITE_URL    — базовый адрес сайта для ссылок в письмах
 * Пока переменные не заданы, письма не отправляются: вызов возвращает
 * { skipped: true } и пишет строку в лог, сайт при этом работает как обычно.
 */
const net = require('net');
const tls = require('tls');

const E = process.env;
const CFG = {
  host: E.SMTP_HOST || '',
  port: Number(E.SMTP_PORT || 465),
  user: E.SMTP_USER || '',
  pass: E.SMTP_PASS || '',
  from: E.MAIL_FROM || E.SMTP_USER || '',
  secure: E.SMTP_SECURE ? E.SMTP_SECURE !== '0' : Number(E.SMTP_PORT || 465) === 465,
  name: E.SMTP_NAME || 'localhost'
};
const ready = () => !!(CFG.host && CFG.user && CFG.pass);

/* --- кодирование --- */
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
/* заголовок с кириллицей по RFC 2047 */
function enc(s) {
  const v = String(s || '');
  return /^[\x20-\x7E]*$/.test(v) ? v : '=?UTF-8?B?' + b64(v) + '?=';
}
/* тело письма: base64 строками по 76 символов */
function body64(s) {
  return (b64(s).match(/.{1,76}/g) || []).join('\r\n');
}
function addr(v) {
  const m = String(v || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(v || '')).trim();
}

/* --- диалог с сервером --- */
function talk(sock, script, timeout) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let step = 0;
    let done = false;
    const fail = e => { if (!done) { done = true; cleanup(); reject(e instanceof Error ? e : new Error(String(e))); } };
    const ok = v => { if (!done) { done = true; cleanup(); resolve(v); } };
    const timer = setTimeout(() => fail(new Error('SMTP: сервер не ответил за ' + timeout + ' мс')), timeout);
    function cleanup() { clearTimeout(timer); sock.removeListener('data', onData); }
    function onData(chunk) {
      buf += chunk.toString('utf8');
      /* ответ полон, когда последняя строка вида «250 текст», а не «250-текст» */
      let m;
      while ((m = buf.match(/^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/))) {
        const reply = buf.slice(0, m[0].length);
        buf = buf.slice(m[0].length);
        const code = Number(m[1]);
        const expect = script[step] ? script[step].expect : null;
        if (expect && !expect.includes(code)) return fail(new Error('SMTP ' + code + ': ' + reply.trim()));
        step++;
        const next = script[step];
        if (!next) return ok({ code, reply, text: reply });
        if (next.starttls) return ok({ code, reply, starttls: true, step });
        if (next.send != null) sock.write(next.send + '\r\n');
      }
    }
    sock.on('error', fail);
    sock.on('data', onData);
    /* если первый шаг — команда, отправляем её сразу; иначе ждём приветствия */
    if (script[0] && script[0].send != null) sock.write(script[0].send + '\r\n');
  });
}

async function sendMail(opts) {
  const to = addr(opts && opts.to);
  if (!to) return { skipped: true, reason: 'нет адреса получателя' };
  if (!ready()) {
    console.log('[mail] SMTP не настроен, письмо не отправлено →', to, '·', opts.subject || '');
    return { skipped: true, reason: 'SMTP не настроен' };
  }
  const from = CFG.from || CFG.user;
  const subject = String((opts && opts.subject) || '');
  const html = String((opts && opts.html) || '');
  const text = String((opts && opts.text) || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const boundary = 'bw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const head = [
    'From: ' + (/</.test(from) ? from.replace(/^([^<]+)</, (s, n) => enc(n.trim()) + ' <') : from),
    'To: ' + to,
    'Subject: ' + enc(subject),
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Message-ID: <' + boundary + '@' + (addr(from).split('@')[1] || 'localhost') + '>',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ].join('\r\n');
  const data = head + '\r\n\r\n'
    + '--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\n'
    + 'Content-Transfer-Encoding: base64\r\n\r\n' + body64(text) + '\r\n'
    + '--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n'
    + 'Content-Transfer-Encoding: base64\r\n\r\n' + body64(html || text) + '\r\n'
    + '--' + boundary + '--\r\n';
  /* точка в начале строки экранируется, иначе она закроет DATA */
  const safe = data.replace(/\r\n\./g, '\r\n..');

  const sock = await new Promise((resolve, reject) => {
    const common = { host: CFG.host, port: CFG.port };
    const s = CFG.secure
      ? tls.connect(Object.assign({ servername: CFG.host, rejectUnauthorized: false }, common), () => resolve(s))
      : net.connect(common, () => resolve(s));
    s.setTimeout(20000);
    s.once('error', reject);
    s.once('timeout', () => { s.destroy(); reject(new Error('SMTP: таймаут соединения')); });
  });

  try {
    let sk = sock;
    if (!CFG.secure) {
      /* 25 / 587: приветствие, EHLO, STARTTLS и повторный EHLO уже по TLS */
      await talk(sk, [
        { expect: [220] },
        { send: 'EHLO ' + CFG.name, expect: [250] },
        { send: 'STARTTLS', expect: [220] }
      ], 20000);
      sk = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: CFG.host, rejectUnauthorized: false },
          () => resolve(t));
        t.once('error', reject);
      });
      await talk(sk, [{ send: 'EHLO ' + CFG.name, expect: [250] }], 20000);
    }
    const script = CFG.secure
      ? [{ expect: [220] }, { send: 'EHLO ' + CFG.name, expect: [250] }]
      : [];
    const seq = script.concat([
      { send: 'AUTH LOGIN', expect: [334] },
      { send: b64(CFG.user), expect: [334] },
      { send: b64(CFG.pass), expect: [235] },
      { send: 'MAIL FROM:<' + addr(from) + '>', expect: [250] },
      { send: 'RCPT TO:<' + to + '>', expect: [250, 251] },
      { send: 'DATA', expect: [354] },
      { send: safe + '.', expect: [250] },
      { send: 'QUIT', expect: [221] }
    ]);
    await talk(sk, seq, 30000);
    sk.end();
    console.log('[mail] отправлено →', to, '·', subject);
    return { ok: true };
  } catch (e) {
    try { sock.destroy(); } catch (x) {}
    console.error('[mail] ошибка отправки →', to, ':', e.message);
    return { ok: false, error: e.message };
  }
}

/* --- шаблон письма --- */
function layout(brand, title, lines, btn) {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="background:#0d1117;padding:28px 16px;font-family:Arial,Helvetica,sans-serif">'
    + '<div style="max-width:520px;margin:0 auto;background:#151c26;border:1px solid #243041;'
    + 'border-radius:14px;padding:26px 24px;color:#e6edf6">'
    + '<div style="font-size:19px;font-weight:700;letter-spacing:.2px;margin-bottom:18px">' + esc(brand) + '</div>'
    + '<div style="font-size:17px;font-weight:600;margin-bottom:12px">' + esc(title) + '</div>'
    + lines.map(l => '<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#b9c6d6">' + l + '</p>').join('')
    + (btn ? '<p style="margin:20px 0 6px"><a href="' + btn.href + '" style="display:inline-block;'
      + 'background:#2f7df6;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;'
      + 'font-size:14px;font-weight:600">' + esc(btn.text) + '</a></p>'
      + '<p style="margin:8px 0 0;font-size:12px;color:#7d8da1;word-break:break-all">' + btn.href + '</p>' : '')
    + '<hr style="border:0;border-top:1px solid #243041;margin:22px 0 14px">'
    + '<p style="margin:0;font-size:12px;line-height:1.5;color:#7d8da1">'
    + esc(brand) + ' — учебный демонстрационный проект. Сервис не является брокером, '
    + 'не принимает платежи и не отправляет ордера на биржу: все счета и суммы условны. '
    + 'Письмо отправлено автоматически, отвечать на него не нужно.</p>'
    + '</div></div>';
}

module.exports = { sendMail, layout, ready, CFG };
