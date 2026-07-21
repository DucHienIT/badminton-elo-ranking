// Entry point: Express server — API + serve frontend tĩnh
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { initDb } = require('./db');

const app = express();
// limit 2mb: avatar upload là data-URL JPEG 256px (~10-20KB), 2mb là trần an toàn
app.use(express.json({ limit: '2mb' }));

// ===================== Đăng nhập (session token) =====================
// - Không đặt env ADMIN_PASSWORD → chế độ mở: không cần đăng nhập (dev local)
// - Đặt ADMIN_PASSWORD → phải đăng nhập mới được GHI (POST/PUT/DELETE);
//   Guest (chưa đăng nhập) chỉ XEM: BXH, VĐV, lịch sử đấu.
// Token = SHA-256(salt + mật khẩu): không lưu state trên server nên sống sót
// qua restart/redeploy (Render free hay restart); đổi mật khẩu = vô hiệu token cũ.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Tên đăng nhập: mặc định "admin", đổi được qua env ADMIN_USERNAME
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const TOKEN = ADMIN_PASSWORD
  ? crypto.createHash('sha256')
      .update('bxh-auth-v1:' + ADMIN_USERNAME + ':' + ADMIN_PASSWORD)
      .digest('hex')
  : null;

// So sánh chuỗi an toàn thời gian (chống timing attack)
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const isAuthed = (req) => !ADMIN_PASSWORD || safeEqual(req.get('X-Auth-Token'), TOKEN);

// Trạng thái đăng nhập — frontend gọi lúc mở trang để quyết định UI
app.get('/api/auth', (req, res) => {
  res.json({ required: !!ADMIN_PASSWORD, logged_in: isAuthed(req) });
});

// Đăng nhập: sai 5 lần liên tiếp (theo IP) → khoá thử 5 phút
const loginFails = new Map(); // ip -> { n, until }
app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(400).json({ error: 'Server đang ở chế độ mở, không cần đăng nhập' });
  }
  const ip = req.ip;
  const f = loginFails.get(ip);
  if (f && f.until > Date.now()) {
    return res.status(429).json({ error: 'Sai quá nhiều lần. Thử lại sau 5 phút.' });
  }
  const { username, password } = req.body || {};
  // & không phải && để cả 2 phép so sánh đều chạy (không lộ qua timing
  // việc tên đăng nhập đúng hay sai)
  if (safeEqual(username, ADMIN_USERNAME) & safeEqual(password, ADMIN_PASSWORD)) {
    loginFails.delete(ip);
    return res.json({ token: TOKEN });
  }
  const n = (f?.n || 0) + 1;
  loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
  res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
});

// Chặn mọi thao tác GHI khi chưa đăng nhập (GET vẫn mở cho Guest xem)
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || isAuthed(req)) return next();
  res.status(401).json({ error: 'Cần đăng nhập để thực hiện thao tác này' });
});

app.use('/api/players', require('./routes/players'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/settings', require('./routes/settings'));

// 404 cho API không tồn tại
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Frontend tĩnh
app.use(express.static(path.join(__dirname, '..', 'public')));

// Bắt lỗi chung — trả JSON thay vì stack trace HTML
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi server: ' + err.message });
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`BXH Cầu lông chạy tại http://localhost:${PORT}`);
      console.log(
        process.env.TURSO_DATABASE_URL
          ? '→ Database: Turso (remote)'
          : '→ Database: SQLite local (data/club.db)'
      );
      if (ADMIN_PASSWORD) console.log('→ Đăng nhập: BẬT (Guest chỉ xem; ghi/sửa cần đăng nhập)');
    });
  })
  .catch((err) => {
    console.error('Không khởi tạo được database:', err);
    process.exit(1);
  });
