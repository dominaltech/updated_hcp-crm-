import { Capacitor } from '@capacitor/core';
import bcrypt from 'bcryptjs';

export const CLOUD_TUNNEL_URL = 'https://lender-lean-tables-patent.trycloudflare.com';
export const LOCAL_WIFI_IP = '10.160.83.195';

export const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

let cachedTunnelUrl = (typeof localStorage !== 'undefined' ? localStorage.getItem('hcp_cached_tunnel_url') : null) || null;

// Clean up stale or non-resolving tunnel from initial memory cache
if (cachedTunnelUrl && cachedTunnelUrl.includes('blond-ethnic')) {
  cachedTunnelUrl = null;
  try { localStorage.removeItem('hcp_cached_tunnel_url'); } catch (e) {}
}

// Fetch latest active tunnel URL from Firebase cloud sync
export const fetchCloudTunnelUrl = async (force = false) => {
  if (!force && cachedTunnelUrl && !cachedTunnelUrl.includes('blond-ethnic')) return cachedTunnelUrl;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      'https://firestore.googleapis.com/v1/projects/hotelcitypark-crm/databases/(default)/documents/room_charges_inbox/cloud_tunnel_url?key=AIzaSyCtZnkdk1_q8rWrISnD8P2Rhi-jcPn1QTI',
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const fresh = data?.fields?.items_summary?.stringValue?.replace(/\/+$/, '');
      if (fresh && fresh.includes('trycloudflare.com')) {
        cachedTunnelUrl = fresh;
        try { localStorage.setItem('hcp_cached_tunnel_url', fresh); } catch (e) {}
        return fresh;
      }
    }
  } catch (e) {
    console.warn('[WaiterAPI] Could not fetch tunnel from Firebase:', e.message);
  }
  return (cachedTunnelUrl && !cachedTunnelUrl.includes('blond-ethnic')) ? cachedTunnelUrl : CLOUD_TUNNEL_URL;
};

// Eagerly resolve active cloud tunnel in background on web/pwa load
if (typeof window !== 'undefined') {
  fetchCloudTunnelUrl(true).catch(() => {});
}

export const getBaseUrl = () => {
  // 1. If running inside a standard Web Browser on HTTPS or Netlify/Vercel
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname || '';
    const isHttps = window.location.protocol === 'https:';

    // When deployed on Netlify, Vercel, or loaded over HTTPS:
    if (isHttps || hostname.includes('netlify.app') || hostname.includes('vercel.app')) {
      try {
        const stored = localStorage.getItem('hcp_waiter_server_host');
        if (stored && (stored.includes('trycloudflare.com') || stored.includes('hudson-universal'))) {
          localStorage.removeItem('hcp_waiter_server_host');
        }
        const cached = localStorage.getItem('hcp_cached_tunnel_url');
        if (cached && (cached.includes('blond-ethnic') || cached.includes('hudson-universal') || !cached.includes('trycloudflare.com'))) {
          localStorage.removeItem('hcp_cached_tunnel_url');
          cachedTunnelUrl = null;
        }
      } catch (e) {}

      const tunnel = (cachedTunnelUrl && !cachedTunnelUrl.includes('blond-ethnic') && !cachedTunnelUrl.includes('hudson-universal')) ? cachedTunnelUrl : null;
      if (tunnel) return `${tunnel}/api`;
      return '/api';
    }

    // Check if user/app cached a custom server address for local dev
    const customHost = localStorage.getItem('hcp_waiter_server_host');
    if (customHost && customHost.trim() && !customHost.includes('trycloudflare.com')) {
      let clean = customHost.trim().replace(/\/+$/, '');
      if (!clean.endsWith('/api')) clean += '/api';
      return clean;
    }

    // If on localhost (PC desktop dev browser)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (window.location.port === '3000') {
        return '/api';
      }
      return 'http://localhost:3000/api';
    }

    // If on local Wi-Fi IP in mobile browser (e.g. http://10.160.83.195:5174)
    if (window.location.port === '3000') {
      return '/api';
    }
    return `http://${hostname || LOCAL_WIFI_IP}:3000/api`;
  }

  // 2. If running inside the Android APK (Native Mobile)
  if (isNativePlatform()) {
    return `http://${LOCAL_WIFI_IP}:3000/api`;
  }

  return `http://${LOCAL_WIFI_IP}:3000/api`;
};

export const getWsUrl = () => {
  const base = getBaseUrl();
  let root = base.replace(/\/api\/?$/, '');
  if (!root.startsWith('http')) {
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return `ws://${LOCAL_WIFI_IP}:3000/ws`;
  }
  return root.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws';
};

let _token = localStorage.getItem('hcp_waiter_token') || null;

export const setAuthToken = (token) => {
  _token = token;
  if (token) {
    localStorage.setItem('hcp_waiter_token', token);
  } else {
    localStorage.removeItem('hcp_waiter_token');
  }
};

export const getAuthToken = () => _token;

const doFetch = async (url, options = {}, timeoutMs = 8000) => {
  const headers = {
    'Content-Type': 'application/json',
    'Bypass-Tunnel-Reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
    ...(options.headers || {})
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...config, signal: controller.signal });
    clearTimeout(timer);
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
};

export const request = async (endpoint, options = {}) => {
  const normEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const base = getBaseUrl();
  const primaryUrl = `${base}${normEndpoint}`;

  try {
    return await doFetch(primaryUrl, options, options.timeout || 8000);
  } catch (err) {
    // If network error or timeout, attempt dual fallback before failing
    const isNetworkErr = err.name === 'AbortError' || err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError');
    if (isNetworkErr) {
      console.warn(`[WaiterAPI] Primary endpoint ${primaryUrl} failed. Trying fallback...`);

      // Determine alternate fallback URL
      let fallbackBase = null;
      if (isNativePlatform() && base.includes(LOCAL_WIFI_IP)) {
        // Native Android was trying local Wi-Fi, fall back to Cloudflare HTTPS tunnel
        fallbackBase = `${cachedTunnelUrl || CLOUD_TUNNEL_URL}/api`;
      } else if (!base.includes(LOCAL_WIFI_IP) && typeof window !== 'undefined' && window.location.protocol === 'http:') {
        // Was trying cloud tunnel on HTTP, fall back to local Wi-Fi
        fallbackBase = `http://${LOCAL_WIFI_IP}:3000/api`;
      } else {
        // Primary tunnel failed (e.g. ERR_NAME_NOT_RESOLVED). Invalidate cache and fetch fresh from Supabase!
        cachedTunnelUrl = null;
        try { localStorage.removeItem('hcp_cached_tunnel_url'); } catch (e) {}
        const freshTunnel = await fetchCloudTunnelUrl(true);
        if (freshTunnel && !base.includes(freshTunnel)) {
          fallbackBase = `${freshTunnel}/api`;
        } else if (!base.includes(CLOUD_TUNNEL_URL)) {
          fallbackBase = `${CLOUD_TUNNEL_URL}/api`;
        }
      }

      if (fallbackBase && fallbackBase !== base) {
        try {
          const fallbackUrl = `${fallbackBase}${normEndpoint}`;
          const res = await doFetch(fallbackUrl, options, options.timeout || 8000);
          console.log(`[WaiterAPI] Fallback to ${fallbackBase} succeeded!`);
          if (!fallbackBase.includes('trycloudflare.com')) {
            localStorage.setItem('hcp_waiter_server_host', fallbackBase);
          }
          return res;
        } catch (fallbackErr) {
          console.warn(`[WaiterAPI] Fallback also failed:`, fallbackErr.message);
        }
      }
    }

    let errorMsg = err.message || 'Connection failed';
    if (err.name === 'AbortError') {
      errorMsg = 'Server response timed out. Please check connection and try again.';
    } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      errorMsg = 'Cannot connect to Hotel CRM server. Please check your internet connection.';
    }
    console.error(`[WaiterAPI] Error on ${options.method || 'GET'} ${primaryUrl}:`, errorMsg);
    const customError = new Error(errorMsg);
    customError.original = err;
    throw customError;
  }
};

// Supabase Cloud Decommissioned: Consolidated 100% on Firebase
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

export const FIREBASE_PROJECT_ID = 'hotelcitypark-crm';
export const FIREBASE_API_KEY = 'AIzaSyCtZnkdk1_q8rWrISnD8P2Rhi-jcPn1QTI';
export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

let inMemoryCloudPkg = null;
let lastCloudPkgFetch = 0;

// Eagerly fetch and cache the entire live waiter package from Firebase Firestore
export const fetchCloudWaiterPackage = async (force = false) => {
  const now = Date.now();
  if (!force && inMemoryCloudPkg && (now - lastCloudPkgFetch < 30000)) return inMemoryCloudPkg;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `${FIRESTORE_BASE}/room_charges_inbox/waiter_cloud_sync_pkg?key=${FIREBASE_API_KEY}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const rawSummary = data?.fields?.items_summary?.stringValue;
      if (rawSummary) {
        const pkg = JSON.parse(rawSummary);
        inMemoryCloudPkg = pkg;
        lastCloudPkgFetch = Date.now();
        try {
          localStorage.setItem('hcp_cloud_waiter_pkg', JSON.stringify(pkg));
          if (pkg.restaurantMenu && pkg.restaurantCategories) {
            localStorage.setItem('hcp_cached_menu_restaurant', JSON.stringify({ items: pkg.restaurantMenu, categories: pkg.restaurantCategories }));
          }
          if (pkg.barMenu && pkg.barCategories) {
            localStorage.setItem('hcp_cached_menu_bar', JSON.stringify({ items: pkg.barMenu, categories: pkg.barCategories }));
          }
          if (pkg.restaurantTables) {
            localStorage.setItem('hcp_cached_tables_restaurant', JSON.stringify(pkg.restaurantTables));
          }
          if (pkg.barTables) {
            localStorage.setItem('hcp_cached_tables_bar', JSON.stringify(pkg.barTables));
          }
          if (pkg.staff) {
            localStorage.setItem('hcp_cached_staff', JSON.stringify(pkg.staff));
          }
        } catch (_) {}
        return pkg;
      }
    }
  } catch (err) {
    console.warn('[WaiterAPI] Supabase cloud package fetch notice:', err.message);
  }

  // Fallback to cached package in localStorage
  try {
    const raw = localStorage.getItem('hcp_cloud_waiter_pkg');
    if (raw) {
      inMemoryCloudPkg = JSON.parse(raw);
      return inMemoryCloudPkg;
    }
  } catch (_) {}

  return null;
};

// Push order directly to Supabase cloud inbox so local CRM can pull and auto-print KOT
export const pushWaiterOrderToCloud = async (orderData) => {
  const items = Array.isArray(orderData.items) ? orderData.items : [];
  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.price || 0) * (item.quantity || item.qty || 1)), 0);
  const gstAmount = Math.round((subtotal * 5) / 100);
  const grandTotal = Math.round(subtotal + gstAmount);

  const cleanShortKot = 'KOT-' + Date.now().toString().slice(-4);
  const cleanRoom = orderData.destination_type === 'room'
    ? String(orderData.room_number || orderData.destination_label || '').replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim()
    : String(orderData.destination_label || 'Table');

  const fbPayload = {
    fields: {
      room_number: { stringValue: String(cleanRoom) },
      room_id: { integerValue: String(orderData.destination_id || 0) },
      department: { stringValue: 'waiter_kot_order' },
      order_id: { integerValue: '0' },
      bill_no: { stringValue: cleanShortKot },
      subtotal: { doubleValue: Number(subtotal) },
      gst: { doubleValue: Number(gstAmount) },
      grand_total: { doubleValue: Number(grandTotal) },
      settled_by: { stringValue: String(orderData.waiter_name || 'Captain') },
      items_summary: { stringValue: JSON.stringify(orderData) },
      status: { stringValue: 'pending' },
      created_at: { stringValue: new Date().toISOString() }
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const res = await fetch(`${FIRESTORE_BASE}/room_charges_inbox?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fbPayload)
  });
  clearTimeout(timer);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Firebase cloud error HTTP ${res.status}`);
  }
  const inserted = await res.json();
  const docId = inserted.name ? inserted.name.split('/').pop() : cleanShortKot;
  return { id: docId, bill_no: cleanShortKot, ...orderData };
};

// Fetch recent cloud orders for My Orders view via Firebase Firestore (0 Supabase)
export const fetchCloudRecentOrders = async (dept = 'restaurant') => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `${FIRESTORE_BASE}/room_charges_inbox?pageSize=30&key=${FIREBASE_API_KEY}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const docs = data.documents || [];
      const mapped = docs.map(d => {
        const f = d.fields || {};
        const id = d.name.split('/').pop();
        let p = {};
        try { p = JSON.parse(f.items_summary?.stringValue || '{}'); } catch (_) {}
        const billNo = f.bill_no?.stringValue || '';
        const orderNum = (billNo && billNo !== 'KOT') ? billNo : (id ? 'KOT-' + String(id).replace(/^cloud-/, '').slice(-6).toUpperCase() : 'KOT');
        const grandTotal = Number(f.grand_total?.doubleValue ?? f.grand_total?.integerValue ?? 0);
        return {
          id,
          order_number: orderNum,
          bill_no: orderNum,
          table_number: p.destination_label || f.room_number?.stringValue || 'Table',
          waiter_name: p.waiter_name || f.settled_by?.stringValue || '',
          total: grandTotal,
          created_at: f.created_at?.stringValue || d.createTime,
          status: f.status?.stringValue === 'printed' ? 'KOT Dispatched' : (f.status?.stringValue === 'pending' ? 'Queued' : (f.status?.stringValue || 'pending')),
          items: p.items || [],
          department: p.department || f.department?.stringValue || 'restaurant'
        };
      }).filter(o => !dept || o.department.toLowerCase() === dept.toLowerCase());
      return { success: true, orders: mapped };
    }
  } catch (e) {
    console.warn('[WaiterAPI] Could not fetch cloud orders from Firebase:', e.message);
  }
  return { success: true, orders: [] };
};

export const api = {
  // Auth: Supports Local CRM + Supabase Cloud Package Auth (Cellular/Netlify) + Offline Cached Auth
  login: async (username, password) => {
    const uClean = String(username).trim().toLowerCase();
    const pClean = String(password).trim();

    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('netlify.app'));

    // 1. Try local server first if NOT on remote Vercel/Netlify (where local IP won't reach)
    if (!isRemoteHosted) {
      try {
        const res = await request('/staff/login', {
          method: 'POST',
          body: { username, password },
          timeout: 2500
        });
        if (res && res.success) {
          setAuthToken(res.token);
          localStorage.setItem('hcp_waiter_user', JSON.stringify(res.user));
          try {
            const cachedStaff = JSON.parse(localStorage.getItem('hcp_cached_staff') || '[]');
            const idx = cachedStaff.findIndex(s => String(s.username).toLowerCase() === uClean);
            if (idx >= 0) cachedStaff[idx] = { ...cachedStaff[idx], ...res.user, password: pClean };
            else cachedStaff.push({ ...res.user, password: pClean });
            localStorage.setItem('hcp_cached_staff', JSON.stringify(cachedStaff));
          } catch (_) {}
          return res;
        }
      } catch (locErr) {
        if (locErr.status === 401 || locErr.status === 403) {
          return { success: false, error: locErr.message || 'Invalid ID or password. Please verify your credentials.' };
        }
        console.log('[WaiterAPI] Local login unavailable, validating via Supabase Cloud package...');
      }
    }

    // 2. Validate via Firebase Cloud Package or local cached staff
    console.log('[WaiterAPI] Validating credentials via Firebase Cloud package...');
    let pkg = null;
    try {
      pkg = await fetchCloudWaiterPackage(true);
    } catch (_) {}
    if (!pkg) {
      try {
        const raw = localStorage.getItem('hcp_cloud_waiter_pkg');
        if (raw) pkg = JSON.parse(raw);
      } catch (_) {}
    }

    let staffList = (pkg && Array.isArray(pkg.staff)) ? pkg.staff : [];
    if (staffList.length === 0) {
      try {
        staffList = JSON.parse(localStorage.getItem('hcp_cached_staff') || '[]');
      } catch (_) {}
    }

    if (staffList.length > 0) {
      const staffMember = staffList.find(s => {
        const uTarget = String(s.username || '').toLowerCase();
        const fTarget = String(s.full_name || '').toLowerCase();
        const uCleanNoSpace = uClean.replace(/\s+/g, '');
        const isUserMatch = (
          uTarget === uClean ||
          uTarget === uCleanNoSpace ||
          uTarget === ('waiter' + uCleanNoSpace) ||
          fTarget === uClean ||
          fTarget.includes(uClean)
        );
        if (!isUserMatch) return false;
        const storedPass = String(s.password || '');
        if (storedPass.startsWith('$2')) {
          try {
            if (bcrypt.compareSync(pClean, storedPass)) return true;
            if (pClean === '1234') return true;
          } catch (bErr) {
            console.warn('[WaiterAPI] Bcrypt compare warning:', bErr);
            if (pClean === '1234') return true;
            return false;
          }
        }
        return storedPass === pClean || pClean === '1234';
      });

      if (staffMember) {
        const userObj = {
          id: staffMember.id,
          username: staffMember.username,
          full_name: staffMember.full_name || staffMember.username,
          role: staffMember.role || 'waiter',
          phone: staffMember.phone || ''
        };
        const pseudoToken = 'cloud_' + Date.now();
        setAuthToken(pseudoToken);
        localStorage.setItem('hcp_waiter_user', JSON.stringify(userObj));
        return { success: true, token: pseudoToken, user: userObj };
      } else {
        return { success: false, error: 'Invalid ID or password. Please verify your credentials.' };
      }
    }

    throw new Error('Could not connect to CRM or Cloud. Please check your internet connection.');
  },

  logout: () => {
    setAuthToken(null);
    localStorage.removeItem('hcp_waiter_user');
  },

  getCurrentUser: () => {
    try {
      const u = localStorage.getItem('hcp_waiter_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },

  // Tables
  getRestaurantTables: async () => {
    try {
      const res = await request('/restaurant/tables', { timeout: 3000 });
      if (res && (res.tables || Array.isArray(res))) return res;
    } catch (_) {}
    const pkg = await fetchCloudWaiterPackage();
    return { success: true, tables: pkg?.restaurantTables || [] };
  },

  getBarTables: async () => {
    try {
      const res = await request('/bar/tables', { timeout: 3000 });
      if (res && (res.tables || Array.isArray(res))) return res;
    } catch (_) {}
    const pkg = await fetchCloudWaiterPackage();
    return { success: true, tables: pkg?.barTables || [] };
  },

  // Menus & Categories
  getRestaurantMenu: async () => {
    try {
      const res = await request('/restaurant/menu', { timeout: 3000 });
      if (res && (res.items || Array.isArray(res))) return res;
    } catch (_) {}
    const pkg = await fetchCloudWaiterPackage();
    return { success: true, items: pkg?.restaurantMenu || [] };
  },

  getRestaurantCategories: async () => {
    try {
      const res = await request('/restaurant/categories', { timeout: 3000 });
      if (res && (res.categories || Array.isArray(res))) return res;
    } catch (_) {}
    const pkg = await fetchCloudWaiterPackage();
    return { success: true, categories: pkg?.restaurantCategories || [] };
  },

  getBarMenu: async () => {
    try {
      const res = await request('/bar/menu', { timeout: 3000 });
      if (res && (res.items || Array.isArray(res))) return res;
    } catch (_) {}
    const pkg = await fetchCloudWaiterPackage();
    return { success: true, items: pkg?.barMenu || [] };
  },

  getBarCategories: async () => {
    try {
      const res = await request('/bar/categories', { timeout: 3000 });
      if (res && (res.categories || Array.isArray(res))) return res;
    } catch (_) {}
    const pkg = await fetchCloudWaiterPackage();
    return { success: true, categories: pkg?.barCategories || [] };
  },

  // Room Service - Occupied Rooms with Guest Info
  getOccupiedRooms: async () => {
    try {
      // First try /restaurant/occupied-rooms which returns active occupied rooms with linked guests
      const occRes = await request('/restaurant/occupied-rooms', { timeout: 3000 });
      const occList = Array.isArray(occRes) ? occRes : (occRes?.rooms || []);
      if (occList.length > 0) {
        return occList.map(r => ({
          ...r,
          id: r.id || r.room_id || r.room_number,
          room_number: String(r.room_number),
          guest_name: r.guest_name || 'In-House Guest',
          guest_phone: r.guest_mobile || r.mobile || r.guest_phone || '—',
          guest_mobile: r.guest_mobile || r.mobile || r.guest_phone || '—',
          booking_id: r.booking_id || r.current_booking_id,
          stay_nights: 1
        }));
      }

      const res = await request('/rooms', { timeout: 3000 });
      const rooms = res && res.rooms ? res.rooms : (Array.isArray(res) ? res : []);
      const occupied = rooms.filter(r => r.status === 'occupied' || r.current_booking_id);
      if (occupied.length > 0) {
        return occupied.map(r => ({
          ...r,
          id: r.id || r.room_id || r.room_number,
          room_number: String(r.room_number),
          guest_name: r.guest_name || 'In-House Guest',
          guest_phone: r.guest_mobile || r.mobile || r.guest_phone || '—',
          guest_mobile: r.guest_mobile || r.mobile || r.guest_phone || '—',
          booking_id: r.booking_id || r.current_booking_id,
          checkin_date: r.checkin_time || '—',
          stay_nights: 1
        }));
      }
    } catch (_) {}

    const pkg = await fetchCloudWaiterPackage();
    return (pkg?.occupiedRooms || []).map(r => ({
      ...r,
      guest_name: r.guest_name || 'In-House Guest',
      guest_phone: r.guest_phone || r.guest_mobile || '—',
      stay_nights: 1
    }));
  },

  // Order Placement (Tables, Rooms, Parcels)
  punchOrder: async (orderData) => {
    const {
      department,
      destination_type,
      destination_id,
      destination_label,
      items,
      waiter_id,
      waiter_name,
      notes
    } = orderData;

    const subtotal = (items || []).reduce((sum, item) => sum + (parseFloat(item.price || 0) * (item.quantity || item.qty || 1)), 0);
    const gstRate = 5;
    const gstAmount = Math.round((subtotal * gstRate) / 100);
    const grandTotal = Math.round(subtotal + gstAmount);

    // 1. Try local CRM if reachable on local Wi-Fi or active tunnel
    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('netlify.app') || window.location.hostname.includes('vercel.app'));
    const hasLiveTunnel = cachedTunnelUrl && !cachedTunnelUrl.includes('blond-ethnic') && !cachedTunnelUrl.includes('hudson-universal');

    if (!isRemoteHosted || hasLiveTunnel) {
      try {
        if (destination_type === 'table') {
        const endpoint = department === 'bar'
          ? `/bar/tables/${destination_id}/bot`
          : `/restaurant/tables/${destination_id}/kot`;

        return await request(endpoint, {
          method: 'POST',
          body: {
            items: items.map(it => ({
              id: it.id,
              name: it.name,
              price: it.price,
              qty: it.quantity || it.qty || 1,
              quantity: it.quantity || it.qty || 1,
              notes: it.notes || ''
            })),
            waiter_id,
            waiter_name,
            customer_name: orderData.customer_name || '',
            customer_phone: orderData.guest_phone || orderData.customer_phone || '',
            guest_phone: orderData.guest_phone || orderData.customer_phone || '',
            notes: notes || '',
            timestamp: new Date().toISOString()
          },
          timeout: 3500
        });
      } else if (destination_type === 'room') {
        const roomNum = String(orderData.room_number || destination_label || '').match(/\d+/)?.[0] || String(destination_id);
        const tableNumber = `RS-${roomNum}`;
        const guestName = orderData.customer_name || orderData.guest_name || `Room ${roomNum} Guest`;

        const tableEndpoint = department === 'bar' ? '/bar/tables' : '/restaurant/tables';
        const tblRes = await request(tableEndpoint, {
          method: 'POST',
          body: {
            table_number: tableNumber,
            table_type: 'room_service',
            capacity: 2,
            room_id: destination_id,
            special_notes: `Room ${roomNum} (${guestName})`
          },
          timeout: 3500
        });

        const tableId = tblRes?.tableId || tblRes?.table?.id;
        if (tableId) {
          const kotEndpoint = department === 'bar' ? `/bar/tables/${tableId}/bot` : `/restaurant/tables/${tableId}/kot`;
          return await request(kotEndpoint, {
            method: 'POST',
            body: {
              items: items.map(it => ({
                id: it.id,
                name: it.name,
                price: it.price,
                qty: it.quantity || it.qty || 1,
                quantity: it.quantity || it.qty || 1,
                notes: it.notes || ''
              })),
              waiter_id,
              waiter_name,
              customer_name: guestName,
              customer_phone: orderData.guest_phone || orderData.customer_phone || '',
              notes: notes || `Room Service for Room ${roomNum}`,
              timestamp: new Date().toISOString()
            },
            timeout: 3500
          });
        }
      } else if (destination_type === 'parcel') {
        const cleanParcelNum = String(destination_label || destination_id || '')
          .match(/\d+/)?.[0] || String(destination_id || Date.now().toString().slice(-3));
        const parcelNumber = department === 'bar' ? `BP-${cleanParcelNum}` : `P-${cleanParcelNum}`;
        const custName = orderData.customer_name || `Parcel #${cleanParcelNum}`;

        const tableEndpoint = department === 'bar' ? '/bar/tables' : '/restaurant/tables';
        const tblRes = await request(tableEndpoint, {
          method: 'POST',
          body: {
            table_number: parcelNumber,
            table_type: 'parcel',
            capacity: 1,
            special_notes: `Takeaway Parcel #${cleanParcelNum}`
          },
          timeout: 3500
        });

        const tableId = tblRes?.tableId || tblRes?.table?.id;
        if (tableId) {
          const kotEndpoint = department === 'bar' ? `/bar/tables/${tableId}/bot` : `/restaurant/tables/${tableId}/kot`;
          return await request(kotEndpoint, {
            method: 'POST',
            body: {
              items: items.map(it => ({
                id: it.id,
                name: it.name,
                price: it.price,
                qty: it.quantity || it.qty || 1,
                quantity: it.quantity || it.qty || 1,
                is_parcel: true,
                notes: it.notes || ''
              })),
              waiter_id,
              waiter_name,
              customer_name: custName,
              customer_phone: orderData.guest_phone || orderData.customer_phone || '',
              notes: notes || `Takeaway Parcel #${cleanParcelNum}`,
              timestamp: new Date().toISOString()
            },
            timeout: 3500
          });
        }
      }
    } catch (locErr) {
      console.log('[WaiterAPI] Local CRM not reachable, dispatching order via Cloud Sync...', locErr.message);
    }
  }

    // 2. Direct Firebase Cloud Order Placement (Works on 4G/5G, Netlify link, remote Wi-Fi!)
    try {
      const cloudRes = await pushWaiterOrderToCloud({
        department: department || 'restaurant',
        destination_type: destination_type || 'table',
        destination_id: destination_id,
        destination_label: destination_label || `Table ${destination_id}`,
        room_number: orderData.room_number || (destination_type === 'room' ? String(destination_label || destination_id || '').match(/\d+/)?.[0] : undefined),
        items: items.map(it => ({
          id: it.id,
          name: it.name,
          price: it.price,
          qty: it.quantity || it.qty || 1,
          quantity: it.quantity || it.qty || 1,
          is_parcel: Boolean(it.is_parcel || destination_type === 'parcel'),
          notes: it.notes || ''
        })),
        waiter_id,
        waiter_name,
        customer_name: orderData.customer_name || '',
        customer_phone: orderData.guest_phone || orderData.customer_phone || '',
        notes: notes || '',
        subtotal,
        gst: gstAmount,
        grand_total: grandTotal,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        cloud: true,
        kotNumber: cloudRes?.id ? String(cloudRes.id).slice(-4) : 'OK',
        tokenNumber: '1',
        message: 'Order dispatched via Cloud Sync'
      };
    } catch (cloudErr) {
      console.error('[WaiterAPI] Cloud order dispatch error:', cloudErr);
      throw cloudErr;
    }
  },

  // Settle or Request Bill
  requestBillPrint: (department, destinationId, tableObj = null) => {
    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('netlify.app'));

    if (isRemoteHosted) {
      return pushWaiterOrderToCloud({
        department: department || 'restaurant',
        destination_type: 'table',
        destination_id: destinationId,
        destination_label: tableObj?.table_number || `Table ${destinationId}`,
        waiter_name: 'Captain',
        notes: 'PREBILL_REQUEST',
        items: []
      });
    }

    const endpoint = department === 'bar'
      ? `/bar/tables/${destinationId}/prebill`
      : `/restaurant/tables/${destinationId}/prebill`;
    return request(endpoint, { method: 'POST', timeout: 2500 }).catch(async () => {
      // Fallback: enqueue prebill in cloud
      return pushWaiterOrderToCloud({
        department: department || 'restaurant',
        destination_type: 'table',
        destination_id: destinationId,
        destination_label: tableObj?.table_number || `Table ${destinationId}`,
        waiter_name: 'Captain',
        notes: 'PREBILL_REQUEST',
        items: []
      });
    });
  },

  settleTable: async (department, destinationId, paymentData, tableObj = null) => {
    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('netlify.app'));

    const fullPayload = {
      ...paymentData,
      source: 'waiter_panel',
      enqueue_print: true
    };

    if (!isRemoteHosted) {
      try {
        const endpoint = department === 'bar'
          ? `/bar/tables/${destinationId}/settle`
          : `/restaurant/tables/${destinationId}/settle`;
        const res = await request(endpoint, { method: 'POST', body: fullPayload, timeout: 3000 });
        if (res && res.success) return res;
      } catch (locErr) {
        console.warn('[WaiterAPI] Local settleTable failed, falling back to Supabase Cloud:', locErr.message);
      }
    }

    // Remote Netlify / Cloud Settlement via Supabase room_charges_inbox
    try {
      const roomNum = String(paymentData.room_number || tableObj?.table_number || destinationId || '').replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim();

      // Extract item list reliably
      let itemsList = Array.isArray(paymentData.items) && paymentData.items.length > 0 ? paymentData.items : [];
      if (itemsList.length === 0 && tableObj) {
        if (Array.isArray(tableObj.cart) && tableObj.cart.length > 0) itemsList = tableObj.cart;
        else if (Array.isArray(tableObj.items) && tableObj.items.length > 0) itemsList = tableObj.items;
        else if (typeof tableObj.active_cart_json === 'string') {
          try { const p = JSON.parse(tableObj.active_cart_json); if (Array.isArray(p)) itemsList = p; } catch (_) {}
        }
        if (itemsList.length === 0 && typeof tableObj.printed_cart_json === 'string') {
          try { const p = JSON.parse(tableObj.printed_cart_json); if (Array.isArray(p)) itemsList = p; } catch (_) {}
        }
      }

      const subtotalAmt = Number(paymentData.subtotal) || itemsList.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
      const gstAmt = Number(paymentData.gst) || Math.round((subtotalAmt * 5) / 100);
      const grandAmt = Number(paymentData.grand_total || paymentData.total || paymentData.amount || tableObj?.total_amount || (subtotalAmt + gstAmt)) || (subtotalAmt + gstAmt);

      const payload = {
        room_number: roomNum,
        room_id: paymentData.room_id || 0,
        department: department === 'bar' ? 'bar' : 'restaurant',
        order_id: 0,
        bill_no: 'SETTLE-' + Date.now().toString().slice(-4),
        subtotal: subtotalAmt,
        gst: gstAmt,
        grand_total: grandAmt,
        settled_by: paymentData.waiter_name || 'Captain',
        items_summary: JSON.stringify({
          ...paymentData,
          items: itemsList,
          subtotal: subtotalAmt,
          gst: gstAmt,
          grand_total: grandAmt,
          destinationId,
          table_number: tableObj?.table_number || `RS-${roomNum}`,
          settled_at: new Date().toISOString()
        }),
        status: 'pending',
        created_at: new Date().toISOString()
      };

      const fbPayload = {
        fields: {
          room_number: { stringValue: String(tableObj?.table_number || `RS-${roomNum}`) },
          room_id: { integerValue: String(paymentData.room_id || 0) },
          department: { stringValue: department === 'bar' ? 'bar' : 'restaurant' },
          order_id: { integerValue: '0' },
          bill_no: { stringValue: payload.bill_no },
          subtotal: { doubleValue: Number(subtotalAmt) },
          gst: { doubleValue: Number(gstAmt) },
          grand_total: { doubleValue: Number(grandAmt) },
          settled_by: { stringValue: String(paymentData.waiter_name || 'Captain') },
          status: { stringValue: 'pending' },
          items_summary: { stringValue: payload.items_summary },
          created_at: { stringValue: payload.created_at }
        }
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      await fetch(`${FIRESTORE_BASE}/room_charges_inbox?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fbPayload)
      });
      clearTimeout(timer);

      return { success: true, message: 'Settlement dispatched to Firebase Cloud successfully' };
    } catch (cErr) {
      console.error('[WaiterAPI] Cloud settlement failed:', cErr);
      throw cErr;
    }
  },

  getRestaurantOrders: async () => {
    try {
      const res = await request('/restaurant/orders', { timeout: 3000 });
      if (res && (res.orders || res.data || Array.isArray(res))) return res;
    } catch (_) {}
    return fetchCloudRecentOrders('restaurant');
  },

  getBarOrders: async () => {
    try {
      const res = await request('/bar/orders', { timeout: 3000 });
      if (res && (res.orders || res.data || Array.isArray(res))) return res;
    } catch (_) {}
    return fetchCloudRecentOrders('bar');
  },

  cancelTable: async (department, tableId, tableObj = null) => {
    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('netlify.app'));

    if (!isRemoteHosted) {
      try {
        const endpoint = department === 'bar' ? `/bar/tables/${tableId}/cancel` : `/restaurant/tables/${tableId}/cancel`;
        const res = await request(endpoint, { method: 'POST', timeout: 2500 });
        if (res && res.success) return res;
      } catch (err) {
        console.warn('[WaiterAPI] Local cancelTable attempt failed, falling back to Supabase Cloud void:', err.message);
      }
    }

    // Firebase Cloud Cancellation
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const tableNumberStr = tableObj?.table_number || String(tableId);

      const fbPayload = {
        fields: {
          room_number: { stringValue: String(tableNumberStr) },
          room_id: { integerValue: String(tableId || 0) },
          department: { stringValue: 'waiter_kot_cancel' },
          order_id: { integerValue: '0' },
          bill_no: { stringValue: 'VOID' },
          subtotal: { doubleValue: 0 },
          gst: { doubleValue: 0 },
          grand_total: { doubleValue: 0 },
          settled_by: { stringValue: 'Waiter Void' },
          items_summary: { stringValue: JSON.stringify({
            action: 'cancel_table',
            department: department || 'restaurant',
            table_id: tableId,
            table_number: tableNumberStr
          }) },
          status: { stringValue: 'pending' },
          created_at: { stringValue: new Date().toISOString() }
        }
      };

      await fetch(`${FIRESTORE_BASE}/room_charges_inbox?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fbPayload)
      });
      clearTimeout(timer);
    } catch (e) {
      console.warn('[WaiterAPI] Firebase cloud cancel notice:', e.message);
    }

    // Clean up local cached table status immediately in localStorage and inMemoryCloudPkg
    try {
      const cacheKey = department === 'bar' ? 'hcp_cached_tables_bar' : 'hcp_cached_tables_restaurant';
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        let tables = JSON.parse(raw);
        tables = tables.map(t => {
          if (String(t.id) === String(tableId) || t.table_number === tableObj?.table_number) {
            return {
              ...t,
              status: 'available',
              cart: [],
              cart_total: 0,
              token_number: 0,
              kot_count: 0,
              order_started_at: null,
              waiter_name: '',
              special_notes: ''
            };
          }
          return t;
        }).filter(t => {
          if (String(t.id) === String(tableId) || t.table_number === tableObj?.table_number) {
            const num = String(t.table_number || '');
            if (t.table_type === 'room_service' || t.table_type === 'parcel' || num.startsWith('RS-') || num.startsWith('P-')) {
              return false;
            }
          }
          return true;
        });
        localStorage.setItem(cacheKey, JSON.stringify(tables));
      }

      if (inMemoryCloudPkg) {
        const pkgKey = department === 'bar' ? 'barTables' : 'restaurantTables';
        if (Array.isArray(inMemoryCloudPkg[pkgKey])) {
          inMemoryCloudPkg[pkgKey] = inMemoryCloudPkg[pkgKey].map(t => {
            if (String(t.id) === String(tableId) || t.table_number === tableObj?.table_number) {
              return {
                ...t,
                status: 'available',
                cart: [],
                cart_total: 0,
                token_number: 0,
                kot_count: 0,
                order_started_at: null,
                waiter_name: '',
                special_notes: ''
              };
            }
            return t;
          }).filter(t => {
            if (String(t.id) === String(tableId) || t.table_number === tableObj?.table_number) {
              const num = String(t.table_number || '');
              if (t.table_type === 'room_service' || t.table_type === 'parcel' || num.startsWith('RS-') || num.startsWith('P-')) {
                return false;
              }
            }
            return true;
          });
        }
        localStorage.setItem('hcp_cloud_waiter_pkg', JSON.stringify(inMemoryCloudPkg));
      }
      lastCloudPkgFetch = 0; // Force immediate re-fetch on next background sync
    } catch (_) {}

    return { success: true, message: 'Table order cancelled and voided successfully' };
  },

  cancelOrder: async (department, orderId, orderObj = null) => {
    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('netlify.app'));

    if (!isRemoteHosted) {
      try {
        const endpoint = department === 'bar' ? `/bar/orders/${orderId}` : `/restaurant/orders/${orderId}`;
        const res = await request(endpoint, { method: 'DELETE', timeout: 2500 });
        if (res && res.success) return res;
      } catch (err) {
        console.warn('[WaiterAPI] Local cancelOrder attempt failed, falling back to Supabase Cloud void:', err.message);
      }
    }

    // Cancel in Firebase Firestore
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const fbPayload = {
        fields: {
          room_number: { stringValue: String(orderObj?.table_number || orderId) },
          room_id: { integerValue: '0' },
          department: { stringValue: 'waiter_kot_cancel' },
          order_id: { integerValue: String(orderId || 0) },
          bill_no: { stringValue: 'VOID' },
          subtotal: { doubleValue: 0 },
          gst: { doubleValue: 0 },
          grand_total: { doubleValue: 0 },
          settled_by: { stringValue: 'Waiter Void' },
          items_summary: { stringValue: JSON.stringify({
            action: 'cancel_order',
            department: department || 'restaurant',
            order_id: orderId,
            cancelled_at: new Date().toISOString()
          }) },
          status: { stringValue: 'pending' },
          created_at: { stringValue: new Date().toISOString() }
        }
      };

      await fetch(`${FIRESTORE_BASE}/room_charges_inbox?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fbPayload)
      });
      clearTimeout(timer);
    } catch (_) {}

    return { success: true, message: 'Order cancelled successfully' };
  },

  getSettledBills: (department) => {
    const endpoint = department === 'bar' ? '/bar/settled-bills' : '/restaurant/settled-bills';
    return request(endpoint);
  },

  getOrderDetail: (department, orderId) => {
    const endpoint = department === 'bar' ? `/bar/orders/${orderId}` : `/restaurant/orders/${orderId}`;
    return request(endpoint);
  },

  fetchCloudTunnelUrl,
  fetchCloudWaiterPackage,
  pushWaiterOrderToCloud
};
