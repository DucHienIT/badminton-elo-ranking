// Entry point: Express server — API + serve frontend tĩnh
const express = require('express');
const path = require('node:path');
const { initDb } = require('./db');

const app = express();
app.use(express.json());

// Mật khẩu admin TUỲ CHỌN (bật khi deploy công khai):
//   - Không đặt env ADMIN_PASSWORD → mọi thao tác tự do như bản local
//   - Đặt ADMIN_PASSWORD=xxx → các thao tác GHI (POST/PUT/DELETE) yêu cầu
//     header X-Admin-Password; xem/đọc vẫn công khai cho cả CLB
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
app.use('/api', (req, res, next) => {
  if (!ADMIN_PASSWORD || req.method === 'GET') return next();
  if (req.get('X-Admin-Password') === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Sai hoặc thiếu mật khẩu admin' });
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
      if (ADMIN_PASSWORD) console.log('→ Bảo vệ ghi bằng mật khẩu admin: BẬT');
    });
  })
  .catch((err) => {
    console.error('Không khởi tạo được database:', err);
    process.exit(1);
  });
