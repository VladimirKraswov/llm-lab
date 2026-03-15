const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { CONFIG } = require('../config');
const { getJobById } = require('../services/jobs');
const { previewSyntheticJsonlFile } = require('../services/synthetic-datasets');

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

router.get('/jobs/:jobId/preview', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
    const job = await getJobById(req.params.jobId);

    if (job.type !== 'synthetic-gen') {
      return res.status(400).json({ error: 'Job is not a synthetic generation job' });
    }

    const finalPath = job.syntheticMeta?.finalPath;
    if (!finalPath) {
      return res.status(404).json({ error: 'Synthetic final file is not available yet' });
    }

    const preview = await previewSyntheticJsonlFile(finalPath, limit);

    res.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      progressStep: job.syntheticMeta?.progressStep || null,
      ...preview,
    });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

module.exports = router;