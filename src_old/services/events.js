const clients = new Set();

let heartbeatInterval = null;

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    if (clients.size === 0) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      return;
    }
    emitEvent('heartbeat', { alive: true });
  }, 30000);
}

function addClient(res) {
  clients.add(res);
  startHeartbeat();

  res.on('close', () => {
    clients.delete(res);
  });

  res.on('error', () => {
    clients.delete(res);
  });
}

function emitEvent(type, payload = {}) {
  const chunk = `event: ${type}\ndata: ${JSON.stringify({
    type,
    payload,
    time: new Date().toISOString(),
  })}\n\n`;

  for (const client of clients) {
    try {
      client.write(chunk);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = {
  addClient,
  emitEvent,
};