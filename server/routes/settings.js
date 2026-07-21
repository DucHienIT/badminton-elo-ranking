// Đọc/ghi cấu hình ELO (K, ELO khởi điểm, ELO sàn, ngưỡng VĐV mới)
const express = require('express');
const { getSettings, updateSettings } = require('../db');
const { replayAllElo } = require('../elo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getSettings());
});

// Đổi config ảnh hưởng đến cách tính ELO → replay lại toàn bộ lịch sử
router.put('/', (req, res) => {
  updateSettings(req.body || {});
  replayAllElo();
  res.json(getSettings());
});

module.exports = router;
