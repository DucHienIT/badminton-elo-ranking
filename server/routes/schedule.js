// Lịch thi đấu — tách khỏi bảng matches để trận chưa diễn ra không tác động ELO.
const express = require('express');
const { db } = require('../db');

const router = express.Router();
const STATUSES = new Set(['scheduled', 'cancelled']);

async function validateSchedule(body) {
  const match_type = body.match_type === 'singles' ? 'singles' : 'doubles';
  const rated = body.rated === false || Number(body.rated) === 0 ? 0 : 1;
  const ids = (match_type === 'singles'
    ? [body.a1, body.b1]
    : [body.a1, body.a2, body.b1, body.b2]).map(Number);

  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { error: `Phải chọn đủ ${match_type === 'singles' ? 2 : 4} VĐV` };
  }
  if (new Set(ids).size !== ids.length) {
    return { error: 'Các VĐV trong một kèo đấu phải khác nhau' };
  }
  const placeholders = ids.map(() => '?').join(', ');
  const found = await db.execute({
    sql: `SELECT COUNT(*) c FROM players WHERE id IN (${placeholders})`,
    args: ids,
  });
  if (found.rows[0].c !== ids.length) return { error: 'Có VĐV không tồn tại' };

  const scheduled_at = String(body.scheduled_at || '').trim();
  if (!scheduled_at || Number.isNaN(Date.parse(scheduled_at))) {
    return { error: 'Ngày giờ thi đấu không hợp lệ' };
  }
  const clean = (value, max, label) => {
    const text = String(value || '').trim();
    return text.length > max ? { error: `${label} tối đa ${max} ký tự` } : (text || null);
  };
  const venue = clean(body.venue, 120, 'Địa điểm');
  const stakes = clean(body.stakes, 200, 'Kèo cược');
  const note = clean(body.note, 500, 'Ghi chú');
  for (const value of [venue, stakes, note]) if (value?.error) return value;

  const status = STATUSES.has(body.status) ? body.status : 'scheduled';
  return match_type === 'singles'
    ? { scheduled_at, match_type, rated, a1: ids[0], a2: null, b1: ids[1], b2: null, venue, stakes, note, status }
    : { scheduled_at, match_type, rated, a1: ids[0], a2: ids[1], b1: ids[2], b2: ids[3], venue, stakes, note, status };
}

const LIST_SQL = `
  SELECT s.*,
    pa1.name a1_name, pa1.elo a1_elo, pa1.avatar_url a1_avatar_url,
    pa2.name a2_name, pa2.elo a2_elo, pa2.avatar_url a2_avatar_url,
    pb1.name b1_name, pb1.elo b1_elo, pb1.avatar_url b1_avatar_url,
    pb2.name b2_name, pb2.elo b2_elo, pb2.avatar_url b2_avatar_url
  FROM scheduled_matches s
  JOIN players pa1 ON pa1.id = s.a1
  LEFT JOIN players pa2 ON pa2.id = s.a2
  JOIN players pb1 ON pb1.id = s.b1
  LEFT JOIN players pb2 ON pb2.id = s.b2`;

router.get('/', async (req, res) => {
  const result = await db.execute(`${LIST_SQL}
    ORDER BY CASE s.status WHEN 'scheduled' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
      s.scheduled_at ASC, s.id ASC`);
  res.json(result.rows);
});

router.get('/:id', async (req, res) => {
  const result = await db.execute({
    sql: `${LIST_SQL} WHERE s.id = ?`,
    args: [Number(req.params.id)],
  });
  if (!result.rows[0]) return res.status(404).json({ error: 'Không tìm thấy lịch đấu' });
  res.json(result.rows[0]);
});

router.post('/', async (req, res) => {
  const value = await validateSchedule(req.body || {});
  if (value.error) return res.status(400).json({ error: value.error });
  const result = await db.execute({
    sql: `INSERT INTO scheduled_matches
      (scheduled_at, match_type, rated, a1, a2, b1, b2, venue, stakes, note, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [value.scheduled_at, value.match_type, value.rated, value.a1, value.a2, value.b1, value.b2,
      value.venue, value.stakes, value.note, value.status],
  });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.execute({ sql: 'SELECT status FROM scheduled_matches WHERE id = ?', args: [id] });
  if (!current.rows[0]) return res.status(404).json({ error: 'Không tìm thấy lịch đấu' });
  if (current.rows[0].status === 'completed') {
    return res.status(409).json({ error: 'Trận đã có kết quả, không thể sửa lịch' });
  }
  const value = await validateSchedule(req.body || {});
  if (value.error) return res.status(400).json({ error: value.error });
  await db.execute({
    sql: `UPDATE scheduled_matches SET scheduled_at=?, match_type=?, rated=?, a1=?, a2=?, b1=?, b2=?,
      venue=?, stakes=?, note=?, status=? WHERE id=?`,
    args: [value.scheduled_at, value.match_type, value.rated, value.a1, value.a2, value.b1, value.b2,
      value.venue, value.stakes, value.note, value.status, id],
  });
  res.json({ ok: true });
});

router.put('/:id/complete', async (req, res) => {
  const id = Number(req.params.id);
  const matchId = Number(req.body?.match_id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return res.status(400).json({ error: 'Mã trận kết quả không hợp lệ' });
  }
  const linked = await db.execute({
    sql: `SELECT s.match_type s_type, s.rated s_rated, s.a1 s_a1, s.a2 s_a2, s.b1 s_b1, s.b2 s_b2,
            m.match_type m_type, m.rated m_rated, m.a1 m_a1, m.a2 m_a2, m.b1 m_b1, m.b2 m_b2
          FROM scheduled_matches s JOIN matches m ON m.id = ? WHERE s.id = ?`,
    args: [matchId, id],
  });
  const row = linked.rows[0];
  if (!row) return res.status(404).json({ error: 'Không tìm thấy lịch đấu hoặc trận kết quả' });
  const samePlayers = row.s_type === row.m_type && row.s_rated === row.m_rated &&
    row.s_a1 === row.m_a1 && row.s_a2 === row.m_a2 &&
    row.s_b1 === row.m_b1 && row.s_b2 === row.m_b2;
  if (!samePlayers) return res.status(409).json({ error: 'Kết quả không khớp VĐV trong lịch đấu' });
  const result = await db.execute({
    sql: `UPDATE scheduled_matches SET status='completed', completed_match_id=?
          WHERE id=? AND status!='completed'`,
    args: [matchId, id],
  });
  if (!result.rowsAffected) return res.status(404).json({ error: 'Không tìm thấy lịch đấu hoặc lịch đã hoàn tất' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.execute({ sql: 'SELECT status FROM scheduled_matches WHERE id = ?', args: [id] });
  if (!current.rows[0]) return res.status(404).json({ error: 'Không tìm thấy lịch đấu' });
  if (current.rows[0].status === 'completed') {
    return res.status(409).json({ error: 'Trận đã có kết quả, không thể xoá lịch' });
  }
  await db.execute({ sql: 'DELETE FROM scheduled_matches WHERE id = ?', args: [id] });
  res.json({ ok: true });
});

module.exports = router;
