'use strict';
const { Pool } = require('pg');

/* Строку подключения берём либо целиком из DATABASE_URL,
   либо собираем из отдельных переменных панели Timeweb. */
const env = process.env;
const host = env.POSTGRESQL_HOST || env.PGHOST || '';
const url = env.DATABASE_URL || env.POSTGRES_URL || (host
  ? `postgresql://${encodeURIComponent(env.POSTGRESQL_USER || env.PGUSER || 'gen_user')}:` +
    `${encodeURIComponent(env.POSTGRESQL_PASSWORD || env.PGPASSWORD || '')}@${host}:` +
    `${env.POSTGRESQL_PORT || env.PGPORT || 5432}/${env.POSTGRESQL_DBNAME || env.PGDATABASE || 'default_db'}`
  : '');
if (!url) console.warn('[db] не заданы ни DATABASE_URL, ни POSTGRESQL_HOST — запросы к базе будут падать');

const needSsl = env.PGSSL === '0'
  ? false
  : /sslmode=(require|prefer|verify-ca|verify-full)/.test(url) || /twc1\.net|twc\d/.test(url) || env.PGSSL === '1';

const pool = new Pool({
  connectionString: url,
  ssl: needSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000
});

pool.on('error', e => console.error('[db] ошибка пула:', e.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  pass_hash   TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  acct        TEXT NOT NULL,
  cur         TEXT NOT NULL DEFAULT 'USD',
  balance     NUMERIC(18,2) NOT NULL DEFAULT 0,
  dyn         JSONB NOT NULL DEFAULT '{}'::jsonb,
  positions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  tx          JSONB NOT NULL DEFAULT '[]'::jsonb,
  hist        JSONB NOT NULL DEFAULT '[]'::jsonb,
  card        JSONB NOT NULL DEFAULT '{}'::jsonb,
  apikey      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS site_config (
  id          INT PRIMARY KEY DEFAULT 1,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_config_single CHECK (id = 1)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS card JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apikey TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_exp TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_chat TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS users_reset_idx ON users(reset_token);
/* обращения в службу поддержки: одна таблица на обе площадки, площадка в поле site */
CREATE TABLE IF NOT EXISTS tickets (
  id          BIGSERIAL PRIMARY KEY,
  site        TEXT NOT NULL DEFAULT 'bw',
  user_id     BIGINT,
  email       TEXT NOT NULL DEFAULT '',
  acct        TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  topic       TEXT NOT NULL DEFAULT 'other',
  subject     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  msgs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  unread_user INT NOT NULL DEFAULT 0,
  unread_adm  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_site_idx ON tickets(site, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS tickets_user_idx ON tickets(site, user_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS botkey TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS botkey_at TIMESTAMPTZ;
/* ключи активации торгового бота: выпускаются в админке площадки,
   вводятся в карточке кошелька на странице единого бота */
CREATE TABLE IF NOT EXISTS bot_keys (
  id          BIGSERIAL PRIMARY KEY,
  site        TEXT NOT NULL DEFAULT 'bw',
  code        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT true,
  uses        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_keys_code_idx ON bot_keys(site, code);
/* заявки на верификацию профиля: документы подаются в кабинете, решение — в админке */
CREATE TABLE IF NOT EXISTS kyc (
  id          BIGSERIAL PRIMARY KEY,
  site        TEXT NOT NULL DEFAULT 'bw',
  user_id     BIGINT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  acct        TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  docs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_user_idx ON kyc(site, user_id);
CREATE INDEX IF NOT EXISTS kyc_site_idx ON kyc(site, status, updated_at DESC);
INSERT INTO bot_keys (site, code, note) VALUES
  ('bw','X7K9P-4M2QD-V8R3N','стартовая партия'),
  ('bw','F3W8L-Z6T1K-Q9P4X','стартовая партия'),
  ('bw','N5R2V-H8J7M-C4K9D','стартовая партия'),
  ('bw','Q8T4Y-P2L6W-X7N3F','стартовая партия'),
  ('bw','M9K3R-V5D8Q-J2T7P','стартовая партия'),
  ('bw','C6X4N-W9F2L-R8K5V','стартовая партия'),
  ('bw','P7D3M-Q4X9T-H6W2K','стартовая партия'),
  ('bw','V2L8F-N5R7C-K9Q4M','стартовая партия'),
  ('bw','J4T6P-X8W3N-D5K9R','стартовая партия'),
  ('bw','R9Q2V-M7C4F-P8L5X','стартовая партия'),
  ('bw','W5N8K-T3R9D-X6P2Q','стартовая партия'),
  ('bw','D7F4X-K9M5V-Q2R8L','стартовая партия'),
  ('nx','X7K9P-4M2QD-V8R3N','стартовая партия'),
  ('nx','F3W8L-Z6T1K-Q9P4X','стартовая партия'),
  ('nx','N5R2V-H8J7M-C4K9D','стартовая партия'),
  ('nx','Q8T4Y-P2L6W-X7N3F','стартовая партия'),
  ('nx','M9K3R-V5D8Q-J2T7P','стартовая партия'),
  ('nx','C6X4N-W9F2L-R8K5V','стартовая партия'),
  ('nx','P7D3M-Q4X9T-H6W2K','стартовая партия'),
  ('nx','V2L8F-N5R7C-K9Q4M','стартовая партия'),
  ('nx','J4T6P-X8W3N-D5K9R','стартовая партия'),
  ('nx','R9Q2V-M7C4F-P8L5X','стартовая партия'),
  ('nx','W5N8K-T3R9D-X6P2Q','стартовая партия'),
  ('nx','D7F4X-K9M5V-Q2R8L','стартовая партия')
ON CONFLICT DO NOTHING;
INSERT INTO site_config (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
`;

async function init(retries = 10) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query(SCHEMA);
      console.log('[db] схема готова');
      return true;
    } catch (e) {
      console.error(`[db] попытка ${i}/${retries}: ${e.message}`);
      if (i === retries) return false;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

module.exports = { pool, init, q: (t, p) => pool.query(t, p) };
