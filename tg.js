'use strict';
/**
 * Отправка сообщений в Telegram. Настройки — в переменных окружения:
 *   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID   — чат, куда идут отчёты (ваш id, группа или канал)
 * Пока переменные не заданы, вызов ничего не отправляет и возвращает
 * { skipped: true } — сайт работает как обычно.
 */
const https = require('https');

const E = process.env;
const TOKEN = () => E.TELEGRAM_BOT_TOKEN || E.TG_BOT_TOKEN || '';
const CHAT = () => E.TELEGRAM_CHAT_ID || E.TG_CHAT_ID || '';
const ready = () => !!(TOKEN() && CHAT());

function call(method, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      host: 'api.telegram.org',
      path: '/bot' + TOKEN() + '/' + method,
      method: 'POST',
      timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let s = '';
      r.on('data', c => { s += c; });
      r.on('end', () => {
        let j = null; try { j = JSON.parse(s); } catch (e) {}
        if (j && j.ok) return resolve({ ok: true, result: j.result });
        resolve({ ok: false, error: (j && j.description) || ('HTTP ' + r.statusCode) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Telegram не ответил за 15 с' }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(text, chat) {
  const to = chat || CHAT();
  if (!TOKEN() || !to) {
    console.log('[tg] Telegram не настроен, сообщение не отправлено');
    return { skipped: true, reason: 'Telegram не настроен' };
  }
  const r = await call('sendMessage', {
    chat_id: to, text: String(text).slice(0, 4000),
    parse_mode: 'HTML', disable_web_page_preview: true
  });
  if (r.ok) console.log('[tg] отправлено в чат', to);
  else console.error('[tg] ошибка отправки:', r.error);
  return r;
}

module.exports = { send, ready, esc, call };
