'use strict';
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!url) console.warn('[db] DATABASE_URL не задан — сервер поднимется, но запросы к базе будут падать');

const pool = new Pool({
  connectionString: url,
  ssl: /sslmode=(require|prefer|verify-ca|verify-full)/.test(url) || process.env.PGSSL === '1'
    ? { rejectUnauthorized: false }
    : false,
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
