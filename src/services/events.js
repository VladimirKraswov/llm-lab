const clients = new Set();

function addClient(res) {
  clients.add(res);

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