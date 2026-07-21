// Khởi tạo database qua @libsql/client — MỘT code path cho cả 2 chế độ:
//   - Local (dev):   file SQLite  →  data/club.db (mặc định, không cần cấu hình)
//   - Cloud (prod):  Turso        →  đặt env TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
const { createClient } = require('@libsql/client');
const path = require('node:path');
const fs = require('node:fs');

let url = process.env.TURSO_DATABASE_URL || process.env.DB_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  const DATA_DIR = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  url = 'file:' + path.join(DATA_DIR, 'club.db');
}

const db = createClient({ url, authToken });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    note        TEXT,
    elo         REAL NOT NULL DEFAULT 1000,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    a1          INTEGER NOT NULL REFERENCES players(id),
    a2          INTEGER NOT NULL REFERENCES players(id),
    b1          INTEGER NOT NULL REFERENCES players(id),
    b2          INTEGER NOT NULL REFERENCES players(id),
    winner      TEXT NOT NULL CHECK (winner IN ('A','B')),
    score       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS elo_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id),
    elo_before  REAL NOT NULL,
    elo_after   REAL NOT NULL,
    delta       REAL NOT NULL,
    date        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_player ON elo_history(player_id);
  CREATE INDEX IF NOT EXISTS idx_history_match  ON elo_history(match_id);
  CREATE INDEX IF NOT EXISTS idx_matches_date   ON matches(date);
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const DEFAULT_SETTINGS = {
  initial_elo: '1000', // ELO khởi điểm cho VĐV mới
  k_base: '32',        // Hệ số K mặc định
  k_new: '32',         // K cho VĐV "mới" (< new_threshold trận). Bằng k_base = tắt
  new_threshold: '10', // Ngưỡng số trận để hết được coi là VĐV mới
  min_elo: '100'       // ELO sàn
};

/** Tạo schema + seed settings mặc định. Gọi 1 lần khi server khởi động. */
async function initDb() {
  await db.executeMultiple(SCHEMA);
  await db.batch(
    Object.entries(DEFAULT_SETTINGS).map(([k, v]) => ({
      sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      args: [k, v],
    })),
    'write'
  );
}

/** Đọc toàn bộ settings, ép kiểu số. */
async function getSettings() {
  const r = await db.execute('SELECT key, value FROM settings');
  const s = {};
  for (const row of r.rows) s[row.key] = Number(row.value);
  return s;
}

/** Ghi settings (chỉ nhận các key hợp lệ). */
async function updateSettings(partial) {
  const stmts = [];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (partial[key] !== undefined && Number.isFinite(Number(partial[key]))) {
      stmts.push({
        sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ' +
             'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        args: [key, String(Number(partial[key]))],
      });
    }
  }
  if (stmts.length) await db.batch(stmts, 'write');
}

/**
 * Khoá tuần tự cho các thao tác GHI (thêm/sửa/xoá trận, đổi settings):
 * vì handler giờ là async, 2 request ghi cùng lúc có thể xen kẽ nhau giữa
 * lúc ghi match và lúc replay ELO → chạy lần lượt qua 1 promise chain.
 */
let _chain = Promise.resolve();
function withWriteLock(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.catch(() => {}); // lỗi của request trước không chặn request sau
  return run;
}

module.exports = { db, initDb, getSettings, updateSettings, withWriteLock, DEFAULT_SETTINGS };
