import { useEffect } from 'react';
import { socketClient } from '../services/socketClient';

/**
 * React hook to subscribe to real-time WebSocket events.
 * Automatically cleans up listener on unmount.
 *
 * Example usage:
 * useRealtimeSocket({
 *   ROOMS_UPDATED: () => refreshRooms(),
 *   TABLES_UPDATED: () => refreshTables()
 * });
 */
export function useRealtimeSocket(eventMap = {}) {
  useEffect(() => {
    const unsubs = [];

    Object.entries(eventMap).forEach(([event, callback]) => {
      if (typeof callback === 'function') {
        const unsub = socketClient.on(event, callback);
        unsubs.push(unsub);
      }
    });

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [eventMap]);
}

export default useRealtimeSocket;
