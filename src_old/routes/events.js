const express = require('express');
const { addClient } = require('../services/events');

const router = express.Router();

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  addClient(res);
});

module.exports = router;