// CRUD trận đấu — MỌI thay đổi (thêm/sửa/xoá) đều kích hoạt replay toàn bộ ELO
// (mục 3.4 spec: an toàn nhất là tính lại từ đầu theo thứ tự thời gian)
const express = require('express');
const { db } = require('../db');
const { replayAllElo } = require('../elo');

const router = express.Router();

// Tỷ số dạng "21-15, 18-21, 21-19" (tuỳ chọn)
const SCORE_RE = /^\s*\d{1,3}\s*-\s*\d{1,3}(\s*,\s*\d{1,3}\s*-\s*\d{1,3})*\s*$/;

/** Kiểm tra dữ liệu trận đấu; trả về object sạch hoặc {error}. */
function validateMatch(body) {
  const ids = [body.a1, body.a2, body.b1, body.b2].map(Number);
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) {
    return { error: 'Phải chọn đủ 4 VĐV' };
  }
  if (new Set(ids).size !== 4) {
    return { error: '4 VĐV phải khác nhau' };
  }
  const found = db
    .prepare(`SELECT COUNT(*) c FROM players WHERE id IN (?, ?, ?, ?)`)
    .get(...ids).c;
  if (found !== 4) return { error: 'Có VĐV không tồn tại' };

  if (body.winner !== 'A' && body.winner !== 'B') {
    return { error: 'Đội thắng phải là A hoặc B' };
  }

  let score = (body.score || '').trim() || null;
  if (score && !SCORE_RE.test(score)) {
    return { error: 'Tỷ số không hợp lệ (ví dụ: 21-15, 18-21, 21-19)' };
  }

  // Ngày giờ: nhận ISO string; mặc định = hiện tại
  let date = (body.date || '').trim();
  if (!date) date = new Date().toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
  if (Number.isNaN(Date.parse(date))) return { error: 'Ngày giờ không hợp lệ' };

  return { a1: ids[0], a2: ids[1], b1: ids[2], b2: ids[3], winner: body.winner, score, date };
}

// GET /api/matches — toàn bộ trận, mới nhất trước, kèm tên VĐV + delta từng người
router.get('/', (req, res) => {
  const matches = db
    .prepare(
      `SELECT m.*,
        pa1.name AS a1_name, pa2.name AS a2_name,
        pb1.name AS b1_name, pb2.name AS b2_name
       FROM matches m
       JOIN players pa1 ON pa1.id = m.a1
       JOIN players pa2 ON pa2.id = m.a2
       JOIN players pb1 ON pb1.id = m.b1
       JOIN players pb2 ON pb2.id = m.b2
       ORDER BY m.date DESC, m.id DESC`
    )
    .all();

  // Gắn delta của từng người trong trận (từ elo_history)
  const histStmt = db.prepare(
    'SELECT player_id, delta, elo_after FROM elo_history WHERE match_id = ?'
  );
  for (const m of matches) {
    m.deltas = {};
    for (const h of histStmt.all(m.id)) {
      m.deltas[h.player_id] = { delta: h.delta, elo_after: h.elo_after };
    }
  }
  res.json(matches);
});

// GET /api/matches/:id — 1 trận (phục vụ form sửa)
router.get('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Không tìm thấy trận đấu' });
  res.json(m);
});

// POST /api/matches — ghi nhận trận mới → replay ELO
router.post('/', (req, res) => {
  const v = validateMatch(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db
    .prepare(
      `INSERT INTO matches (date, a1, a2, b1, b2, winner, score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.date, v.a1, v.a2, v.b1, v.b2, v.winner, v.score);
  replayAllElo(); // trận có thể backdate → luôn replay để đúng thứ tự thời gian
  const id = Number(info.lastInsertRowid);
  const deltas = db
    .prepare('SELECT player_id, delta, elo_after FROM elo_history WHERE match_id = ?')
    .all(id);
  res.status(201).json({ id, deltas });
});

// PUT /api/matches/:id — sửa trận → replay ELO
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM matches WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Không tìm thấy trận đấu' });
  }
  const v = validateMatch(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare(
    `UPDATE matches SET date=?, a1=?, a2=?, b1=?, b2=?, winner=?, score=? WHERE id=?`
  ).run(v.date, v.a1, v.a2, v.b1, v.b2, v.winner, v.score, id);
  replayAllElo();
  res.json({ ok: true });
});

// DELETE /api/matches/:id — xoá trận → replay ELO
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM matches WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Không tìm thấy trận đấu' });
  }
  db.prepare('DELETE FROM matches WHERE id = ?').run(id);
  replayAllElo();
  res.json({ ok: true });
});

module.exports = router;
