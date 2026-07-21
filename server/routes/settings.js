// Đọc/ghi cấu hình ELO (K, ELO khởi điểm, ELO sàn, ngưỡng VĐV mới)
const express = require('express');
const { getSettings, updateSettings, withWriteLock } = require('../db');
const { replayAllElo } = require('../elo');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await getSettings());
});

// Đổi config ảnh hưởng đến cách tính ELO → replay lại toàn bộ lịch sử
router.put('/', (req, res, next) =>
  withWriteLock(async () => {
    await updateSettings(req.body || {});
    await replayAllElo();
    res.json(await getSettings());
  }).catch(next)
);

module.exports = router;
