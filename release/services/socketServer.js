const { WebSocketServer, WebSocket } = require('ws');

let wss = null;
const clients = new Set();

/**
 * Initializes the WebSocket server attached to the existing Node.js HTTP server.
 * Handles client connections, ping/pong heartbeats, and graceful disconnection.
 */
function initSocketServer(server) {
  if (wss) {
    console.log('[SocketServer] WebSocket server already initialized.');
    return wss;
  }

  wss = new WebSocketServer({ 
    server,
    path: '/ws'
  });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    clients.add(ws);
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        } else if (parsed.type === 'subscribe') {
          ws.subscriptions = ws.subscriptions || new Set();
          if (Array.isArray(parsed.events)) {
            parsed.events.forEach(e => ws.subscriptions.add(e));
          }
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.warn('[SocketServer] Client error from', clientIp, err.message);
      clients.delete(ws);
    });

    // Send immediate welcome handshake with server timestamp
    ws.send(JSON.stringify({
      event: 'CONNECTED',
      message: 'Hotel City Park Real-Time WebSocket Connected',
      timestamp: Date.now()
    }));
  });

  // Staggered heartbeat ping every 25 seconds to drop dead sockets
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_) {}
    });
  }, 25000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('⚡ [SocketServer] Real-Time WebSocket Server initialized on path: /ws');
  return wss;
}

/**
 * Broadcasts an event to all connected WebSocket clients with zero delay (<20ms).
 * @param {string} event - Event name (e.g. 'ROOMS_UPDATED', 'TABLES_UPDATED', 'PRINT_JOB')
 * @param {object} data - Event payload
 */
function broadcast(event, data = {}) {
  if (!wss || clients.size === 0) return;

  const payload = JSON.stringify({
    event,
    data,
    timestamp: Date.now()
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        console.warn('[SocketServer] Send error:', err.message);
      }
    }
  });
}

/**
 * Get count of active connected WebSocket clients.
 */
function getConnectedClientsCount() {
  return clients.size;
}

module.exports = {
  initSocketServer,
  broadcast,
  getConnectedClientsCount
};
