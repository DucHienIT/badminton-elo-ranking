// ============================================================================
// LOGIC TÍNH ELO CHO ĐÁNH ĐÔI — phần quan trọng nhất của hệ thống
// Triển khai đúng công thức ở mục 3 của spec (badminton-elo-ranking-spec.md)
// ============================================================================
const { db, getSettings } = require('./db');

/**
 * Tính thay đổi ELO cho 1 trận đấu đôi (thuần túy, không đụng DB — dễ test).
 *
 * Công thức (mục 3.2):
 *   EloA = (elo(A1) + elo(A2)) / 2        — ELO trung bình đội A
 *   EloB = (elo(B1) + elo(B2)) / 2        — ELO trung bình đội B
 *   E_A  = 1 / (1 + 10^((EloB - EloA)/400))  — kỳ vọng thắng của đội A
 *   S_A  = 1 nếu A thắng, 0 nếu thua
 *   Δ    = K * (S - E)                    — cùng mức cho cả 2 người trong đội
 *
 * Mở rộng (nice-to-have mục 3.2): K có thể khác nhau theo từng VĐV —
 * VĐV mới (đấu < newThreshold trận) dùng kNew để hội tụ nhanh hơn.
 * Vì vậy hàm nhận K RIÊNG cho từng người; kỳ vọng E vẫn tính chung theo đội.
 * (Khi kNew = kBase thì mọi người cùng K, đúng nguyên bản công thức spec.)
 *
 * @param {number[]} elos   [eloA1, eloA2, eloB1, eloB2] — ELO TRƯỚC trận
 * @param {'A'|'B'} winner  đội thắng
 * @param {number[]} ks     [kA1, kA2, kB1, kB2] — hệ số K của từng người
 * @param {number} minElo   ELO sàn (không cho tụt dưới mức này)
 * @returns {{deltas:number[], after:number[], expectedA:number}}
 *          deltas/after theo đúng thứ tự [A1, A2, B1, B2]
 */
function computeMatchElo(elos, winner, ks, minElo) {
  const teamSize = elos.length / 2;
  const teamA = elos.slice(0, teamSize);
  const teamB = elos.slice(teamSize);
  const eloA = teamA.reduce((sum, value) => sum + value, 0) / teamSize;
  const eloB = teamB.reduce((sum, value) => sum + value, 0) / teamSize;

  // Kỳ vọng thắng của đội A theo công thức ELO chuẩn
  const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  const expectedB = 1 - expectedA;

  // Kết quả thực tế
  const scoreA = winner === 'A' ? 1 : 0;
  const scoreB = 1 - scoreA;

  // Δ của từng người = K(của người đó) * (S đội - E đội).
  // Mỗi người trong cùng đội nhận cùng (S - E), chỉ K có thể khác.
  const rawDeltas = ks.map((k, i) =>
    k * ((i < teamSize ? scoreA : scoreB) - (i < teamSize ? expectedA : expectedB))
  );

  // Áp dụng ELO sàn: nếu trừ điểm làm ELO < minElo thì chặn tại minElo.
  const after = [];
  const deltas = [];
  elos.forEach((elo, i) => {
    const next = elo + rawDeltas[i];
    if (next < minElo) {
      // Chạm sàn: delta thực tế nhỏ hơn delta lý thuyết
      after.push(minElo);
      deltas.push(minElo - elo);
    } else {
      after.push(next);
      deltas.push(rawDeltas[i]);
    }
  });

  return { deltas, after, expectedA };
}

/**
 * REPLAY TOÀN BỘ LỊCH SỬ (mục 3.4):
 * ELO là tích lũy tuần tự nên khi thêm/sửa/xoá bất kỳ trận nào, cách an toàn
 * nhất là tính lại từ đầu cho toàn bộ hệ thống theo đúng thứ tự thời gian.
 *
 * Thiết kế cho DB REMOTE (Turso): mỗi statement là 1 round-trip mạng, nên
 * thay vì ghi từng dòng như bản SQLite local, ta:
 *   1. ĐỌC 2 query: danh sách VĐV + toàn bộ trận (ORDER BY date, id)
 *   2. TÍNH toàn bộ chuỗi ELO trong bộ nhớ (computeMatchElo cho từng trận,
 *      chọn K theo số trận đã đấu của từng người tại thời điểm đó)
 *   3. GHI 1 batch duy nhất: DELETE elo_history + INSERT snapshot từng
 *      người-từng trận + UPDATE elo cuối cùng của mỗi VĐV.
 *      db.batch(..., 'write') chạy trong 1 transaction → lỗi là rollback hết.
 */
async function replayAllElo() {
  const { initial_elo, k_base, k_new, new_threshold, min_elo } = await getSettings();

  const playersRes = await db.execute('SELECT id FROM players');
  const matchesRes = await db.execute(
    'SELECT * FROM matches ORDER BY date ASC, id ASC'
  );

  // State trong bộ nhớ: elo hiện tại + số trận đã đấu của từng VĐV
  const elo = new Map();    // player_id -> elo (float, KHÔNG làm tròn khi lưu)
  const played = new Map(); // player_id -> số trận đã đấu (để chọn K)
  for (const p of playersRes.rows) {
    elo.set(p.id, initial_elo);
    played.set(p.id, 0);
  }

  // Gom toàn bộ lệnh ghi vào 1 batch (1 transaction, 1 round-trip)
  const stmts = [{ sql: 'DELETE FROM elo_history', args: [] }];

  for (const m of matchesRes.rows) {
    if (Number(m.rated) === 0) continue;
    const ids = m.match_type === 'singles' ? [m.a1, m.b1] : [m.a1, m.a2, m.b1, m.b2];
    const before = ids.map((id) => elo.get(id));
    // K của từng người: VĐV còn "mới" (đấu < new_threshold trận) dùng k_new
    const ks = ids.map((id) => (played.get(id) < new_threshold ? k_new : k_base));

    const { deltas, after } = computeMatchElo(before, m.winner, ks, min_elo);

    ids.forEach((id, i) => {
      stmts.push({
        sql: `INSERT INTO elo_history (match_id, player_id, elo_before, elo_after, delta, date)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [m.id, id, before[i], after[i], deltas[i], m.date],
      });
      elo.set(id, after[i]);
      played.set(id, played.get(id) + 1);
    });
  }

  // Đồng bộ ELO cuối cùng về bảng players
  for (const [id, value] of elo) {
    stmts.push({ sql: 'UPDATE players SET elo = ? WHERE id = ?', args: [value, id] });
  }

  await db.batch(stmts, 'write');
}

module.exports = { computeMatchElo, replayAllElo };
