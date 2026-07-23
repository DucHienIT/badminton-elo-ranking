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

/**
 * Avatar hợp lệ: null, URL http(s), hoặc data-URL ảnh (frontend đã resize
 * về 256px JPEG trước khi gửi). Trả về giá trị sạch hoặc {error}.
 */
function validateAvatar(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (/^https?:\/\//.test(s) && s.length <= 2048) return s;
  if (/^data:image\/(jpeg|png|webp|gif);base64,/.test(s) && s.length <= 700000) return s;
  return { error: 'Ảnh đại diện không hợp lệ (hoặc quá lớn)' };
}

function withDerivedStats(row) {
  const losses = row.matches_played - row.wins;
  return {
    ...row,
    losses,
    win_rate: row.matches_played > 0 ? row.wins / row.matches_played : null,
  };
}

// GET /api/players — danh sách VĐV kèm thống kê (leaderboard + quản lý)
router.get('/', async (req, res) => {
  const r = await db.execute(`${STATS_SQL} ORDER BY p.elo DESC, p.name ASC`);
  res.json(r.rows.map(withDerivedStats));
});

// POST /api/players — thêm VĐV mới (ELO khởi điểm lấy từ settings)
router.post('/', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Tên VĐV không được để trống' });
  const avatar = validateAvatar(req.body.avatar_url);
  if (avatar && avatar.error) return res.status(400).json({ error: avatar.error });
  const { initial_elo } = await getSettings();
  const info = await db.execute({
    sql: 'INSERT INTO players (name, avatar_url, note, elo) VALUES (?, ?, ?, ?)',
    args: [name, avatar, req.body.note || null, initial_elo],
  });
  const id = Number(info.lastInsertRowid);
  const row = await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [id] });
  res.status(201).json(row.rows[0]);
});

// PUT /api/players/:id — sửa thông tin (không đụng ELO)
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const found = await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [id] });
  const existing = found.rows[0];
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy VĐV' });
  const name = (req.body.name ?? existing.name).trim();
  if (!name) return res.status(400).json({ error: 'Tên VĐV không được để trống' });
  let avatar = existing.avatar_url;
  if (req.body.avatar_url !== undefined) {
    avatar = validateAvatar(req.body.avatar_url);
    if (avatar && avatar.error) return res.status(400).json({ error: avatar.error });
  }
  await db.execute({
    sql: 'UPDATE players SET name = ?, avatar_url = ?, note = ? WHERE id = ?',
    args: [
      name,
      avatar,
      req.body.note !== undefined ? req.body.note || null : existing.note,
      id,
    ],
  });
  const updated = await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [id] });
  res.json(updated.rows[0]);
});

// DELETE /api/players/:id — chỉ cho xoá khi chưa có trận nào (giữ toàn vẹn lịch sử)
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const found = await db.execute({ sql: 'SELECT id FROM players WHERE id = ?', args: [id] });
  if (!found.rows[0]) return res.status(404).json({ error: 'Không tìm thấy VĐV' });
  const cnt = await db.execute({
    sql: 'SELECT COUNT(*) c FROM matches WHERE ? IN (a1, a2, b1, b2)',
    args: [id],
  });
  const count = cnt.rows[0].c;
  if (count > 0) {
    return res.status(409).json({
      error: `VĐV đã đấu ${count} trận. Hãy xoá các trận liên quan trước khi xoá VĐV.`,
    });
  }
  await db.execute({ sql: 'DELETE FROM players WHERE id = ?', args: [id] });
  res.json({ ok: true });
});

// GET /api/players/:id — chi tiết: thống kê, diễn biến ELO, lịch sử trận
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const found = await db.execute({ sql: `${STATS_SQL} WHERE p.id = ?`, args: [id] });
  if (!found.rows[0]) return res.status(404).json({ error: 'Không tìm thấy VĐV' });
  const player = withDerivedStats(found.rows[0]);

  // Gom 3 query đọc — tránh N+1 vì DB có thể là remote (Turso)
  const [historyRes, matchesRes, namesRes] = await Promise.all([
    db.execute({
      sql: `SELECT match_id, elo_before, elo_after, delta, date
            FROM elo_history WHERE player_id = ?
            ORDER BY date ASC, match_id ASC`,
      args: [id],
    }),
    db.execute({
      sql: `SELECT m.*,
              pa1.name AS a1_name, pa2.name AS a2_name,
              pb1.name AS b1_name, pb2.name AS b2_name,
              h.delta, h.elo_after
            FROM matches m
            JOIN players pa1 ON pa1.id = m.a1
            LEFT JOIN players pa2 ON pa2.id = m.a2
            JOIN players pb1 ON pb1.id = m.b1
            LEFT JOIN players pb2 ON pb2.id = m.b2
            LEFT JOIN elo_history h ON h.match_id = m.id AND h.player_id = ?
            WHERE ? IN (m.a1, m.a2, m.b1, m.b2)
            ORDER BY m.date DESC, m.id DESC`,
      args: [id, id],
    }),
    db.execute('SELECT id, name FROM players'),
  ]);
  const nameById = new Map(namesRes.rows.map((r) => [r.id, r.name]));

  // Thống kê đồng đội / đối thủ gặp nhiều nhất
  const partners = new Map(); // id -> {games, wins}
  const opponents = new Map();
  for (const m of matchesRes.rows) {
    const onA = m.a1 === id || m.a2 === id;
    const won = (m.winner === 'A') === onA;
    const partnerId = onA ? (m.a1 === id ? m.a2 : m.a1) : (m.b1 === id ? m.b2 : m.b1);
    const oppIds = (onA ? [m.b1, m.b2] : [m.a1, m.a2]).filter((pid) => pid != null);
    const bump = (map, pid) => {
      const cur = map.get(pid) || { games: 0, wins: 0 };
      cur.games += 1;
      if (won) cur.wins += 1;
      map.set(pid, cur);
    };
    if (partnerId != null) bump(partners, partnerId);
    oppIds.forEach((pid) => bump(opponents, pid));
  }
  const topOf = (map) =>
    [...map.entries()]
      .map(([pid, s]) => ({ id: pid, name: nameById.get(pid) || '?', ...s }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 3);

  res.json({
    player,
    elo_history: historyRes.rows,
    matches: matchesRes.rows,
    top_partners: topOf(partners),
    top_opponents: topOf(opponents),
  });
});

module.exports = router;
