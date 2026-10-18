// offlineSync.js - Offline Queue & Local Caching Engine for Waiter Panel PWA

const QUEUE_KEY = 'hcp_waiter_offline_queue';

export const getOfflineQueue = () => {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Error reading offline queue:', e);
    return [];
  }
};

export const addToOfflineQueue = (orderData) => {
  try {
    const queue = getOfflineQueue();
    const entry = {
      queueId: `off_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      queuedAt: new Date().toISOString(),
      orderData
    };
    queue.push(entry);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return entry;
  } catch (e) {
    console.error('Error saving to offline queue:', e);
    return null;
  }
};

export const removeFromOfflineQueue = (queueId) => {
  try {
    const queue = getOfflineQueue();
    const updated = queue.filter((item) => item.queueId !== queueId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('Error removing from offline queue:', e);
    return getOfflineQueue();
  }
};

export const clearOfflineQueue = () => {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch (e) {}
};

// Dispatch all queued offline orders to the server
export const syncOfflineQueue = async (api, onProgress) => {
  const queue = getOfflineQueue();
  if (!queue || queue.length === 0) {
    return { success: true, syncedCount: 0, remainingCount: 0 };
  }

  let syncedCount = 0;
  const remaining = [];

  for (const entry of queue) {
    try {
      if (onProgress) {
        onProgress({
          status: 'syncing',
          current: syncedCount + 1,
          total: queue.length,
          entry
        });
      }

      await api.punchOrder(entry.orderData);
      syncedCount++;
    } catch (err) {
      console.warn(`[OfflineSync] Order ${entry.queueId} sync failed:`, err.message);
      remaining.push(entry);
    }
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));

  return {
    success: remaining.length === 0,
    syncedCount,
    remainingCount: remaining.length
  };
};

// Offline Menu Caching
export const getCachedMenu = (dept = 'restaurant') => {
  try {
    const raw = localStorage.getItem(`hcp_cached_menu_${dept}`);
    return raw ? JSON.parse(raw) : { items: [], categories: [] };
  } catch {
    return { items: [], categories: [] };
  }
};

export const setCachedMenu = (dept, items, categories) => {
  try {
    localStorage.setItem(
      `hcp_cached_menu_${dept}`,
      JSON.stringify({
        items: items || [],
        categories: categories || [],
        cachedAt: new Date().toISOString()
      })
    );
  } catch (e) {
    console.warn('Error caching menu:', e);
  }
};

// Offline Tables Caching
export const getCachedTables = (dept = 'restaurant') => {
  try {
    const raw = localStorage.getItem(`hcp_cached_tables_${dept}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const setCachedTables = (dept, tables) => {
  try {
    localStorage.setItem(`hcp_cached_tables_${dept}`, JSON.stringify(tables || []));
  } catch (e) {
    console.warn('Error caching tables:', e);
  }
};
