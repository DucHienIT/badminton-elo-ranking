// Entry point: Express server — API + serve frontend tĩnh
const express = require('express');
const path = require('node:path');

const app = express();
app.use(express.json());

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
app.listen(PORT, () => {
  console.log(`BXH Cầu lông chạy tại http://localhost:${PORT}`);
});
