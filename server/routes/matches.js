// CRUD trận đấu — MỌI thay đổi (thêm/sửa/xoá) đều kích hoạt replay toàn bộ ELO
// (mục 3.4 spec). Các thao tác ghi chạy qua withWriteLock để không xen kẽ nhau.
const express = require('express');
const { db, withWriteLock } = require('../db');
const { replayAllElo } = require('../elo');

const router = express.Router();

// Tỷ số dạng "21-15, 18-21, 21-19" (tuỳ chọn)
const SCORE_RE = /^\s*\d{1,3}\s*-\s*\d{1,3}(\s*,\s*\d{1,3}\s*-\s*\d{1,3})*\s*$/;

/** Kiểm tra dữ liệu trận đấu; trả về object sạch hoặc {error}. */
async function validateMatch(body) {
  const ids = [body.a1, body.a2, body.b1, body.b2].map(Number);
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) {
    return { error: 'Phải chọn đủ 4 VĐV' };
  }
  if (new Set(ids).size !== 4) {
    return { error: '4 VĐV phải khác nhau' };
  }
  const found = await db.execute({
    sql: 'SELECT COUNT(*) c FROM players WHERE id IN (?, ?, ?, ?)',
    args: ids,
  });
  if (found.rows[0].c !== 4) return { error: 'Có VĐV không tồn tại' };

  if (body.winner !== 'A' && body.winner !== 'B') {
    return { error: 'Đội thắng phải là A hoặc B' };
  }

  let score = (body.score || '').trim() || null;
  if (score && !SCORE_RE.test(score)) {
    return { error: 'Tỷ số không hợp lệ (ví dụ: 21-15, 18-21, 21-19)' };
  }

  let date = (body.date || '').trim();
  if (!date) date = new Date().toISOString().slice(0, 16);
  if (Number.isNaN(Date.parse(date))) return { error: 'Ngày giờ không hợp lệ' };

  return { a1: ids[0], a2: ids[1], b1: ids[2], b2: ids[3], winner: body.winner, score, date };
}

// GET /api/matches — toàn bộ trận, mới nhất trước, kèm tên VĐV + delta từng người
router.get('/', async (req, res) => {
  // 2 query cố định (không N+1) — quan trọng khi DB là remote
  const [matchesRes, historyRes] = await Promise.all([
    db.execute(
      `SELECT m.*,
        pa1.name AS a1_name, pa2.name AS a2_name,
        pb1.name AS b1_name, pb2.name AS b2_name
       FROM matches m
       JOIN players pa1 ON pa1.id = m.a1
       JOIN players pa2 ON pa2.id = m.a2
       JOIN players pb1 ON pb1.id = m.b1
       JOIN players pb2 ON pb2.id = m.b2
       ORDER BY m.date DESC, m.id DESC`
    ),
    db.execute('SELECT match_id, player_id, delta, elo_after FROM elo_history'),
  ]);

  const byMatch = new Map();
  for (const h of historyRes.rows) {
    if (!byMatch.has(h.match_id)) byMatch.set(h.match_id, {});
    byMatch.get(h.match_id)[h.player_id] = { delta: h.delta, elo_after: h.elo_after };
  }
  const matches = matchesRes.rows.map((m) => ({ ...m, deltas: byMatch.get(m.id) || {} }));
  res.json(matches);
});

// GET /api/matches/:id — 1 trận (phục vụ form sửa)
router.get('/:id', async (req, res) => {
  const r = await db.execute({
    sql: 'SELECT * FROM matches WHERE id = ?',
    args: [Number(req.params.id)],
  });
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy trận đấu' });
  res.json(r.rows[0]);
});

// POST /api/matches — ghi nhận trận mới → replay ELO
router.post('/', (req, res, next) =>
  withWriteLock(async () => {
    const v = await validateMatch(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const info = await db.execute({
      sql: `INSERT INTO matches (date, a1, a2, b1, b2, winner, score)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [v.date, v.a1, v.a2, v.b1, v.b2, v.winner, v.score],
    });
    await replayAllElo(); // trận có thể backdate → luôn replay theo thứ tự thời gian
    const id = Number(info.lastInsertRowid);
    const deltas = await db.execute({
      sql: 'SELECT player_id, delta, elo_after FROM elo_history WHERE match_id = ?',
      args: [id],
    });
    res.status(201).json({ id, deltas: deltas.rows });
  }).catch(next)
);

// PUT /api/matches/:id — sửa trận → replay ELO
router.put('/:id', (req, res, next) =>
  withWriteLock(async () => {
    const id = Number(req.params.id);
    const found = await db.execute({ sql: 'SELECT id FROM matches WHERE id = ?', args: [id] });
    if (!found.rows[0]) return res.status(404).json({ error: 'Không tìm thấy trận đấu' });
    const v = await validateMatch(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    await db.execute({
      sql: 'UPDATE matches SET date=?, a1=?, a2=?, b1=?, b2=?, winner=?, score=? WHERE id=?',
      args: [v.date, v.a1, v.a2, v.b1, v.b2, v.winner, v.score, id],
    });
    await replayAllElo();
    res.json({ ok: true });
  }).catch(next)
);

// DELETE /api/matches/:id — xoá trận → replay ELO
router.delete('/:id', (req, res, next) =>
  withWriteLock(async () => {
    const id = Number(req.params.id);
    const found = await db.execute({ sql: 'SELECT id FROM matches WHERE id = ?', args: [id] });
    if (!found.rows[0]) return res.status(404).json({ error: 'Không tìm thấy trận đấu' });
    await db.execute({ sql: 'DELETE FROM elo_history WHERE match_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM matches WHERE id = ?', args: [id] });
    await replayAllElo();
    res.json({ ok: true });
  }).catch(next)
);

module.exports = router;
