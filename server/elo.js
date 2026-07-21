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
  const [a1, a2, b1, b2] = elos;
  const eloA = (a1 + a2) / 2;
  const eloB = (b1 + b2) / 2;

  // Kỳ vọng thắng của đội A theo công thức ELO chuẩn
  const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  const expectedB = 1 - expectedA;

  // Kết quả thực tế
  const scoreA = winner === 'A' ? 1 : 0;
  const scoreB = 1 - scoreA;

  // Δ của từng người = K(của người đó) * (S đội - E đội).
  // Mỗi người trong cùng đội nhận cùng (S - E), chỉ K có thể khác.
  const rawDeltas = [
    ks[0] * (scoreA - expectedA), // A1
    ks[1] * (scoreA - expectedA), // A2
    ks[2] * (scoreB - expectedB), // B1
    ks[3] * (scoreB - expectedB), // B2
  ];

  // Áp dụng ELO sàn: nếu trừ điểm làm ELO < minElo thì chặn tại minElo.
  // (Lưu delta THỰC TẾ sau khi chặn để elo_before + delta = elo_after luôn đúng.)
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
 * Với quy mô 1 CLB (vài nghìn trận), replay chạy trong vài ms — đủ nhanh.
 *
 * Quy trình:
 *   1. Reset ELO mọi VĐV về initial_elo, xoá sạch elo_history
 *   2. Duyệt các trận theo thứ tự (date ASC, id ASC) — trận nhập lùi ngày
 *      (backdate) vẫn được xếp đúng chỗ trong dòng thời gian
 *   3. Với mỗi trận: tính Δ theo computeMatchElo, ghi snapshot vào elo_history
 *   4. Ghi ELO cuối cùng vào players.elo
 * Tất cả trong 1 transaction — lỗi ở đâu thì rollback toàn bộ.
 */
function replayAllElo() {
  const settings = getSettings();
  const { initial_elo, k_base, k_new, new_threshold, min_elo } = settings;

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM elo_history');

    // State trong bộ nhớ: elo hiện tại + số trận đã đấu của từng VĐV
    const elo = new Map();      // player_id -> elo (float, KHÔNG làm tròn khi lưu)
    const played = new Map();   // player_id -> số trận đã đấu (để chọn K)
    for (const p of db.prepare('SELECT id FROM players').all()) {
      elo.set(p.id, initial_elo);
      played.set(p.id, 0);
    }

    const matches = db
      .prepare('SELECT * FROM matches ORDER BY date ASC, id ASC')
      .all();

    const insertHistory = db.prepare(
      `INSERT INTO elo_history (match_id, player_id, elo_before, elo_after, delta, date)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const m of matches) {
      const ids = [m.a1, m.a2, m.b1, m.b2];
      const before = ids.map((id) => elo.get(id));
      // K của từng người: VĐV còn "mới" (đấu < new_threshold trận) dùng k_new
      const ks = ids.map((id) =>
        played.get(id) < new_threshold ? k_new : k_base
      );

      const { deltas, after } = computeMatchElo(before, m.winner, ks, min_elo);

      ids.forEach((id, i) => {
        insertHistory.run(m.id, id, before[i], after[i], deltas[i], m.date);
        elo.set(id, after[i]);
        played.set(id, played.get(id) + 1);
      });
    }

    // Đồng bộ ELO cuối cùng về bảng players
    const updatePlayer = db.prepare('UPDATE players SET elo = ? WHERE id = ?');
    for (const [id, value] of elo) updatePlayer.run(value, id);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { computeMatchElo, replayAllElo };
