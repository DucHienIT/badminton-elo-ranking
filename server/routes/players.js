// CRUD VĐV + trang chi tiết VĐV
const express = require('express');
const { db, getSettings } = require('../db');

const router = express.Router();

// Thống kê thắng/thua của mọi VĐV, tính từ bảng matches
const STATS_SQL = `
  SELECT p.id, p.name, p.avatar_url, p.note, p.elo, p.created_at,
    (SELECT COUNT(*) FROM matches m
      WHERE p.id IN (m.a1, m.a2, m.b1, m.b2)) AS matches_played,
    (SELECT COUNT(*) FROM matches m
      WHERE (m.winner = 'A' AND p.id IN (m.a1, m.a2))
         OR (m.winner = 'B' AND p.id IN (m.b1, m.b2))) AS wins
  FROM players p
`;

function withDerivedStats(row) {
  const losses = row.matches_played - row.wins;
  return {
    ...row,
    losses,
    win_rate: row.matches_played > 0 ? row.wins / row.matches_played : null,
  };
}

// GET /api/players — danh sách VĐV kèm thống kê (dùng cho leaderboard + quản lý)
router.get('/', (req, res) => {
  const rows = db.prepare(`${STATS_SQL} ORDER BY p.elo DESC, p.name ASC`).all();
  res.json(rows.map(withDerivedStats));
});

// POST /api/players — thêm VĐV mới (ELO khởi điểm lấy từ settings)
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Tên VĐV không được để trống' });
  const { initial_elo } = getSettings();
  const info = db
    .prepare('INSERT INTO players (name, avatar_url, note, elo) VALUES (?, ?, ?, ?)')
    .run(name, req.body.avatar_url || null, req.body.note || null, initial_elo);
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json(row);
});

// PUT /api/players/:id — sửa thông tin (không đụng ELO)
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy VĐV' });
  const name = (req.body.name ?? existing.name).trim();
  if (!name) return res.status(400).json({ error: 'Tên VĐV không được để trống' });
  db.prepare('UPDATE players SET name = ?, avatar_url = ?, note = ? WHERE id = ?').run(
    name,
    req.body.avatar_url !== undefined ? req.body.avatar_url || null : existing.avatar_url,
    req.body.note !== undefined ? req.body.note || null : existing.note,
    id
  );
  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(id));
});

// DELETE /api/players/:id — chỉ cho xoá khi chưa có trận nào (giữ toàn vẹn lịch sử)
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy VĐV' });
  const count = db
    .prepare('SELECT COUNT(*) c FROM matches WHERE ? IN (a1, a2, b1, b2)')
    .get(id).c;
  if (count > 0) {
    return res.status(409).json({
      error: `VĐV đã đấu ${count} trận. Hãy xoá các trận liên quan trước khi xoá VĐV.`,
    });
  }
  db.prepare('DELETE FROM players WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/players/:id — chi tiết: thống kê, diễn biến ELO, lịch sử trận
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`${STATS_SQL} WHERE p.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy VĐV' });
  const player = withDerivedStats(row);

  // Diễn biến ELO theo thời gian (mỗi điểm = sau 1 trận)
  const eloHistory = db
    .prepare(
      `SELECT h.match_id, h.elo_before, h.elo_after, h.delta, h.date
       FROM elo_history h WHERE h.player_id = ?
       ORDER BY h.date ASC, h.match_id ASC`
    )
    .all(id);

  // Lịch sử trận (mới nhất trước), kèm tên 4 người và delta của VĐV này
  const matches = db
    .prepare(
      `SELECT m.*,
        pa1.name AS a1_name, pa2.name AS a2_name,
        pb1.name AS b1_name, pb2.name AS b2_name,
        h.delta, h.elo_after
       FROM matches m
       JOIN players pa1 ON pa1.id = m.a1
       JOIN players pa2 ON pa2.id = m.a2
       JOIN players pb1 ON pb1.id = m.b1
       JOIN players pb2 ON pb2.id = m.b2
       LEFT JOIN elo_history h ON h.match_id = m.id AND h.player_id = ?
       WHERE ? IN (m.a1, m.a2, m.b1, m.b2)
       ORDER BY m.date DESC, m.id DESC`
    )
    .all(id, id);

  // Thống kê đồng đội / đối thủ gặp nhiều nhất
  const partners = new Map(); // id -> {games, wins}
  const opponents = new Map();
  for (const m of matches) {
    const onA = m.a1 === id || m.a2 === id;
    const won = (m.winner === 'A') === onA;
    const partnerId = onA ? (m.a1 === id ? m.a2 : m.a1) : (m.b1 === id ? m.b2 : m.b1);
    const oppIds = onA ? [m.b1, m.b2] : [m.a1, m.a2];
    const bump = (map, pid) => {
      const cur = map.get(pid) || { games: 0, wins: 0 };
      cur.games += 1;
      if (won) cur.wins += 1;
      map.set(pid, cur);
    };
    bump(partners, partnerId);
    oppIds.forEach((pid) => bump(opponents, pid));
  }
  const nameOf = db.prepare('SELECT name FROM players WHERE id = ?');
  const topOf = (map) =>
    [...map.entries()]
      .map(([pid, s]) => ({ id: pid, name: nameOf.get(pid)?.name || '?', ...s }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 3);

  res.json({
    player,
    elo_history: eloHistory,
    matches,
    top_partners: topOf(partners),
    top_opponents: topOf(opponents),
  });
});

module.exports = router;
