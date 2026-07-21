// Khởi tạo SQLite database (dùng module built-in node:sqlite của Node 22+)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Cho phép override đường dẫn DB qua biến môi trường (phục vụ test)
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'club.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    note        TEXT,
    elo         REAL NOT NULL DEFAULT 1000,  -- ELO hiện tại (đồng bộ lại sau mỗi lần replay)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,               -- ISO datetime, thứ tự thời gian của trận
    a1          INTEGER NOT NULL REFERENCES players(id),
    a2          INTEGER NOT NULL REFERENCES players(id),
    b1          INTEGER NOT NULL REFERENCES players(id),
    b2          INTEGER NOT NULL REFERENCES players(id),
    winner      TEXT NOT NULL CHECK (winner IN ('A','B')),
    score       TEXT,                        -- ví dụ "21-15, 18-21, 21-19"
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Snapshot ELO của từng VĐV sau mỗi trận (phục vụ biểu đồ + audit).
  -- Bảng này được XOÁ và GHI LẠI TOÀN BỘ mỗi lần replay (xem elo.js).
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
`);

// Cấu hình mặc định (chỉ chèn nếu chưa có)
const DEFAULT_SETTINGS = {
  initial_elo: '1000', // ELO khởi điểm cho VĐV mới
  k_base: '32',        // Hệ số K mặc định
  k_new: '32',         // K cho VĐV "mới" (< new_threshold trận). Để bằng k_base = tắt tính năng
  new_threshold: '10', // Ngưỡng số trận để hết được coi là VĐV mới
  min_elo: '100'       // ELO sàn, không cho tụt dưới mức này
};
const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
);
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

/** Đọc toàn bộ settings, ép kiểu số. */
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = Number(r.value);
  return s;
}

/** Ghi settings (chỉ nhận các key hợp lệ). */
function updateSettings(partial) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (partial[key] !== undefined && Number.isFinite(Number(partial[key]))) {
      upsert.run(key, String(Number(partial[key])));
    }
  }
}

module.exports = { db, getSettings, updateSettings, DEFAULT_SETTINGS };
