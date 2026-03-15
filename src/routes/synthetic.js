const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { CONFIG } = require('../config');
const { startSyntheticGenJob } = require('../services/jobs');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(CONFIG.syntheticInputDir)) {
      fs.mkdirSync(CONFIG.syntheticInputDir, { recursive: true });
    }
    cb(null, CONFIG.syntheticInputDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage });

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    ok: true,
    filename: req.file.originalname,
    path: req.file.path,
  });
});

module.exports = router;
