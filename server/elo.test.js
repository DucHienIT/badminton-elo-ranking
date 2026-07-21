// Test logic ELO: chạy `npm test`
// Dùng DB tạm để không đụng dữ liệu thật
process.env.DB_PATH = ':memory:';

const assert = require('node:assert');
const { computeMatchElo, replayAllElo } = require('./elo');
const { db } = require('./db');

// ---------- Test 1: đúng ví dụ minh hoạ mục 3.3 của spec ----------
{
  // A1=1000, A2=1100, B1=950, B2=1050, K=32, đội A thắng
  const { deltas, expectedA } = computeMatchElo(
    [1000, 1100, 950, 1050], 'A', [32, 32, 32, 32], 100
  );
  assert.ok(Math.abs(expectedA - 0.5715) < 0.001, `E_A ≈ 0.572, got ${expectedA}`);
  assert.ok(Math.abs(deltas[0] - 13.71) < 0.05, `Δ_A ≈ +13.7, got ${deltas[0]}`);
  assert.strictEqual(deltas[0], deltas[1], 'A1 và A2 nhận cùng Δ');
  assert.ok(Math.abs(deltas[2] + 13.71) < 0.05, `Δ_B ≈ -13.7, got ${deltas[2]}`);
  assert.strictEqual(Math.round(deltas[0]), 14, 'hiển thị làm tròn +14');
  console.log('✔ Test 1: khớp ví dụ mục 3.3 (E_A≈0.572, Δ≈±13.7)');
}

// ---------- Test 2: zero-sum khi K bằng nhau ----------
{
  const { deltas } = computeMatchElo(
    [1200, 980, 1010, 1150], 'B', [32, 32, 32, 32], 100
  );
  const sum = deltas.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9, `tổng Δ phải = 0, got ${sum}`);
  console.log('✔ Test 2: zero-sum (tổng Δ = 0)');
}

// ---------- Test 3: ELO sàn ----------
{
  // Hai đội ngang điểm (Δ thua = -16) nhưng chỉ còn 105 → chặn tại sàn 100
  const { after, deltas } = computeMatchElo(
    [105, 105, 105, 105], 'B', [32, 32, 32, 32], 100
  );
  assert.strictEqual(after[0], 100, 'không được tụt dưới sàn 100');
  assert.strictEqual(deltas[0], -5, 'delta thực tế bị chặn tại sàn');
  console.log('✔ Test 3: ELO sàn hoạt động');
}

// ---------- Test 4: K cao hơn cho VĐV mới ----------
{
  const { deltas } = computeMatchElo(
    [1000, 1000, 1000, 1000], 'A', [48, 32, 32, 32], 100
  );
  assert.strictEqual(deltas[0], 24, 'VĐV mới K=48: Δ = 48*0.5 = 24');
  assert.strictEqual(deltas[1], 16, 'VĐV cũ K=32: Δ = 32*0.5 = 16');
  console.log('✔ Test 4: K riêng theo từng VĐV');
}

// ---------- Test 5: replay toàn bộ lịch sử ----------
{
  const ins = db.prepare("INSERT INTO players (name) VALUES (?)");
  const ids = ['An', 'Bình', 'Cường', 'Dũng'].map((n) => Number(ins.run(n).lastInsertRowid));
  const [an, binh, cuong, dung] = ids;

  const insM = db.prepare(
    "INSERT INTO matches (date, a1, a2, b1, b2, winner) VALUES (?, ?, ?, ?, ?, ?)"
  );
  // Trận 2 nhập TRƯỚC nhưng có ngày SAU → replay phải xếp theo date
  const m1 = Number(insM.run('2026-07-02T10:00', an, binh, cuong, dung, 'A').lastInsertRowid);
  const m2 = Number(insM.run('2026-07-01T10:00', an, cuong, binh, dung, 'B').lastInsertRowid);

  replayAllElo();

  // Trận ngày 01/07 (m2) phải chạy trước: mọi người 1000, đội B (Bình, Dũng) thắng +16
  const h = (mid, pid) =>
    db.prepare('SELECT * FROM elo_history WHERE match_id=? AND player_id=?').get(mid, pid);
  assert.strictEqual(h(m2, an).elo_before, 1000, 'm2 chạy trước, elo_before = 1000');
  assert.strictEqual(h(m2, binh).elo_after, 1016, 'Bình thắng m2: 1016');
  // Trận ngày 02/07 (m1): An(984)+Bình(1016)=avg 1000 vs Cường(984)+Dũng(1016)=avg 1000 → ±16
  assert.strictEqual(h(m1, an).elo_before, 984, 'm1 dùng ELO sau m2');
  assert.strictEqual(h(m1, an).elo_after, 1000, 'An thắng m1: 984+16=1000');

  const anElo = db.prepare('SELECT elo FROM players WHERE id=?').get(an).elo;
  assert.strictEqual(anElo, 1000, 'players.elo được đồng bộ sau replay');

  // Xoá m2 rồi replay lại → như chỉ còn m1
  db.prepare('DELETE FROM matches WHERE id=?').run(m2);
  replayAllElo();
  assert.strictEqual(h(m1, an).elo_before, 1000, 'sau khi xoá m2, m1 tính từ 1000');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) c FROM elo_history').get().c, 4,
    'history chỉ còn 4 dòng của m1'
  );
  console.log('✔ Test 5: replay đúng thứ tự thời gian, xử lý xoá trận');
}

console.log('\nTất cả test ELO đã pass ✅');
