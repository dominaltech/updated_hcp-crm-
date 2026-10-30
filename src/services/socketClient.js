/**
 * Universal WebSocket Client for Hotel City Park CRM Frontend
 * Provides zero-latency real-time push updates across all screens.
 * Automatically reconnects with exponential backoff on network blips.
 */

class SocketClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map(); // eventName -> Set of callback functions
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
    this.isConnected = false;
    this.init();
  }

  getSocketUrl() {
    if (typeof window === 'undefined') return 'ws://localhost:3000/ws';

    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = loc.host || 'localhost:3000';

    // If running in Vite dev server (port 5173 / 5174), point to Express backend on port 3000
    if (loc.port && loc.port !== '3000' && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1')) {
      return `${protocol}//${loc.hostname}:3000/ws`;
    }

    return `${protocol}//${host}/ws`;
  }

  init() {
    if (typeof window === 'undefined') return;

    try {
      const url = this.getSocketUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('⚡ [RealTime Socket] Connected successfully to', url);
        this.emit('STATUS_CHANGED', { connected: true });
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.event) {
            this.emit(payload.event, payload.data || {});
          }
          // Also fire wildcard listener for global debug/activity tracking
          this.emit('*', payload);
        } catch (err) {
          console.warn('[RealTime Socket] Message parse error:', err.message);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('STATUS_CHANGED', { connected: false });
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        // Socket closed will handle reconnect
        this.isConnected = false;
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.init();
    }, delay);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return cleanup function for easy use in useEffect()
    return () => {
      const set = this.listeners.get(event);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(event);
      }
    };
  }

  emit(event, data) {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[RealTime Socket] Error in listener for ${event}:`, err);
        }
      });
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }
}

export const socketClient = new SocketClient();
