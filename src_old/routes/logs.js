const express = require('express');
const fs = require('fs');
const readline = require('readline');
const { LOG_FILE } = require('../utils/logger');

const router = express.Router();

router.get('/', async (req, res) => {
  const { level, q, limit = 500 } = req.query;

  if (!fs.existsSync(LOG_FILE)) {
    return res.json([]);
  }

  const fileStream = fs.createReadStream(LOG_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const results = [];

  // We read the whole file to filter, but in a production app we'd use a better storage
  // For now, streaming it line by line to keep memory low
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);

      if (level && entry.level !== level) continue;
      if (q && !JSON.stringify(entry).toLowerCase().includes(q.toLowerCase())) continue;

      results.push(entry);
    } catch (e) {
      // skip invalid lines
    }
  }

  // Return last N logs
  res.json(results.reverse().slice(0, Number(limit)));
});

module.exports = router;
