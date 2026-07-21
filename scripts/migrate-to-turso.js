// Đẩy toàn bộ dữ liệu từ SQLite local (data/club.db) lên Turso.
// Cách chạy (PowerShell):
//   $env:TURSO_DATABASE_URL = "libsql://ten-db-cua-ban.turso.io"
//   $env:TURSO_AUTH_TOKEN   = "eyJ..."
//   node scripts/migrate-to-turso.js
const path = require('node:path');
const { createClient } = require('@libsql/client');

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('Thiếu env TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Xem hướng dẫn trong DEPLOY.md');
  process.exit(1);
}

// db.js đọc env lúc require → require ở đây sẽ trỏ vào Turso (remote)
const { db: remote, initDb } = require('../server/db');
const { replayAllElo } = require('../server/elo');

const local = createClient({
  url: 'file:' + path.join(__dirname, '..', 'data', 'club.db'),
});

(async () => {
  // An toàn: không import đè nếu Turso đã có dữ liệu
  await initDb();
  const existing = (await remote.execute('SELECT COUNT(*) c FROM players')).rows[0].c;
  if (existing > 0) {
    console.error(`Turso đã có ${existing} VĐV — không import đè. Xoá database trên Turso rồi chạy lại nếu muốn import lại từ đầu.`);
    process.exit(1);
  }

  const players = (await local.execute('SELECT * FROM players')).rows;
  const matches = (await local.execute('SELECT * FROM matches')).rows;
  const settings = (await local.execute('SELECT * FROM settings')).rows;
  console.log(`Local: ${players.length} VĐV, ${matches.length} trận`);

  // Giữ nguyên id để các tham chiếu a1/a2/b1/b2 không đổi
  const stmts = [];
  for (const p of players) {
    stmts.push({
      sql: 'INSERT INTO players (id, name, avatar_url, note, elo, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [p.id, p.name, p.avatar_url, p.note, p.elo, p.created_at],
    });
  }
  for (const m of matches) {
    stmts.push({
      sql: 'INSERT INTO matches (id, date, a1, a2, b1, b2, winner, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [m.id, m.date, m.a1, m.a2, m.b1, m.b2, m.winner, m.score, m.created_at],
    });
  }
  for (const s of settings) {
    stmts.push({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [s.key, s.value],
    });
  }
  await remote.batch(stmts, 'write');

  // Không copy elo_history — replay lại từ đầu trên Turso cho chắc chắn nhất quán
  await replayAllElo();
  const check = (await remote.execute('SELECT COUNT(*) c FROM elo_history')).rows[0].c;
  console.log(`✅ Xong: đã import và replay ELO trên Turso (${check} dòng lịch sử).`);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
