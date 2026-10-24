import { Capacitor } from '@capacitor/core';
import bcrypt from 'bcryptjs';

export const CLOUD_TUNNEL_URL = 'https://birmingham-objectives-trainers-organisation.trycloudflare.com';
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

// Fetch latest active tunnel URL from Supabase cloud sync
export const fetchCloudTunnelUrl = async (force = false) => {
  if (!force && cachedTunnelUrl && !cachedTunnelUrl.includes('blond-ethnic')) return cachedTunnelUrl;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      'https://hlwmsllmqfdxfmqulrat.supabase.co/rest/v1/room_charges_inbox?department=eq.cloud_tunnel_url&select=items_summary&limit=1',
      {
        signal: controller.signal,
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk'
        }
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.items_summary) {
        const fresh = data[0].items_summary.replace(/\/+$/, '');
        if (fresh && fresh.includes('trycloudflare.com')) {
          cachedTunnelUrl = fresh;
          try { localStorage.setItem('hcp_cached_tunnel_url', fresh); } catch (e) {}
          return fresh;
        }
      }
    }
  } catch (e) {
    console.warn('[WaiterAPI] Could not fetch tunnel from Supabase:', e.message);
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

// Supabase Cloud Direct Endpoints for Independent Internet & Cellular Sync
export const SUPABASE_URL = 'https://hlwmsllmqfdxfmqulrat.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

let inMemoryCloudPkg = null;
let lastCloudPkgFetch = 0;

// Eagerly fetch and cache the entire live waiter package from Supabase Cloud
export const fetchCloudWaiterPackage = async (force = false) => {
  const now = Date.now();
  if (!force && inMemoryCloudPkg && (now - lastCloudPkgFetch < 5000)) return inMemoryCloudPkg;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/room_charges_inbox?department=eq.waiter_cloud_sync_pkg&select=items_summary&limit=1`,
      {
        signal: controller.signal,
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.items_summary) {
        const pkg = JSON.parse(data[0].items_summary);
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

  const payload = {
    room_number: cleanRoom,
    room_id: orderData.destination_id || 0,
    department: 'waiter_kot_order',
    order_id: 0,
    bill_no: cleanShortKot,
    subtotal: subtotal,
    gst: gstAmount,
    grand_total: grandTotal,
    settled_by: orderData.waiter_name || 'Captain',
    items_summary: JSON.stringify(orderData),
    status: 'pending',
    created_at: new Date().toISOString()
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/room_charges_inbox`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  clearTimeout(timer);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `Supabase cloud error HTTP ${res.status}`);
  }
  const inserted = await res.json();
  return Array.isArray(inserted) ? inserted[0] : inserted;
};

// Fetch recent cloud orders for My Orders view
export const fetchCloudRecentOrders = async (dept = 'restaurant') => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/room_charges_inbox?department=eq.waiter_kot_order&order=created_at.desc&limit=30`,
      {
        signal: controller.signal,
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const rows = await res.json();
      const mapped = rows.map(r => {
        let p = {};
        try { p = JSON.parse(r.items_summary || '{}'); } catch (_) {}
        const orderNum = (r.bill_no && r.bill_no !== 'KOT') ? r.bill_no : (r.id ? 'KOT-' + String(r.id).replace(/^cloud-/, '').slice(-6).toUpperCase() : 'KOT');
        return {
          id: r.id,
          order_number: orderNum,
          bill_no: orderNum,
          table_number: p.destination_label || r.room_number,
          waiter_name: p.waiter_name || r.settled_by,
          total: r.grand_total,
          created_at: r.created_at,
          status: r.status === 'printed' ? 'KOT Dispatched' : (r.status === 'pending' ? 'Queued' : r.status),
          items: p.items || [],
          department: p.department || 'restaurant'
        };
      }).filter(o => !dept || o.department.toLowerCase() === dept.toLowerCase());
      return { success: true, orders: mapped };
    }
  } catch (e) {
    console.warn('[WaiterAPI] Could not fetch cloud orders:', e.message);
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

    // 2. Check dedicated Supabase staff_users table directly
    try {
      const staffRes = await fetch(
        `${SUPABASE_URL}/rest/v1/staff_users?username=ilike.${encodeURIComponent(uClean)}&status=eq.active&select=*&limit=1`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        }
      );
      if (staffRes.ok) {
        const matched = await staffRes.json();
        if (Array.isArray(matched) && matched.length > 0) {
          const s = matched[0];
          const storedPass = String(s.password || '');
          let isValid = false;
          if (storedPass.startsWith('$2')) {
            try {
              isValid = bcrypt.compareSync(pClean, storedPass);
            } catch (_) {
              isValid = false;
            }
          } else {
            isValid = (storedPass === pClean);
          }
          if (isValid) {
            const userObj = {
              id: s.id,
              username: s.username,
              full_name: s.full_name || s.username,
              role: s.role || 'waiter',
              phone: s.phone || ''
            };
            const pseudoToken = 'cloud_' + Date.now();
            setAuthToken(pseudoToken);
            localStorage.setItem('hcp_waiter_user', JSON.stringify(userObj));
            return { success: true, token: pseudoToken, user: userObj };
          } else {
            return { success: false, error: 'Invalid ID or password. Please verify your credentials.' };
          }
        }
      }
    } catch (supErr) {
      console.log('[WaiterAPI] staff_users query notice:', supErr.message);
    }

    // 3. Fallback: Validate via Supabase Cloud Package
    console.log('[WaiterAPI] Validating credentials via Supabase Cloud package...');
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
        if (String(s.username || '').toLowerCase() !== uClean) return false;
        const storedPass = String(s.password || '');
        if (storedPass.startsWith('$2')) {
          try {
            return bcrypt.compareSync(pClean, storedPass);
          } catch (bErr) {
            console.warn('[WaiterAPI] Bcrypt compare warning:', bErr);
            return false;
          }
        }
        return storedPass === pClean;
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
      const res = await request('/rooms', { timeout: 3000 });
      const rooms = res && res.rooms ? res.rooms : (Array.isArray(res) ? res : []);
      const occupied = rooms.filter(r => r.status === 'occupied' || r.current_booking_id);
      if (occupied.length > 0) {
        return occupied.map(r => ({
          ...r,
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
      }
    } catch (locErr) {
      console.log('[WaiterAPI] Local CRM not reachable, dispatching order via Supabase Cloud...', locErr.message);
    }
  }

    // 2. Direct Supabase Cloud Order Placement (Works on 4G/5G, Netlify link, remote Wi-Fi!)
    try {
      const cloudRes = await pushWaiterOrderToCloud({
        department: department || 'restaurant',
        destination_type: destination_type || 'table',
        destination_id: destination_id,
        destination_label: destination_label || `Table ${destination_id}`,
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
  requestBillPrint: (department, destinationId) => {
    const endpoint = department === 'bar'
      ? `/bar/tables/${destinationId}/prebill`
      : `/restaurant/tables/${destinationId}/prebill`;
    return request(endpoint, { method: 'POST', timeout: 4000 }).catch(async () => {
      // Fallback: enqueue prebill in cloud
      return pushWaiterOrderToCloud({
        department: department || 'restaurant',
        destination_type: 'table',
        destination_id: destinationId,
        destination_label: `Table ${destinationId}`,
        waiter_name: 'Captain',
        notes: 'PREBILL_REQUEST',
        items: []
      });
    });
  },

  settleTable: async (department, destinationId, paymentData, tableObj = null) => {
    const isRemoteHosted = typeof window !== 'undefined' && 
      (window.location.hostname.includes('vercel.app') || window.location.hostname.includes('netlify.app'));

    if (!isRemoteHosted) {
      try {
        const endpoint = department === 'bar'
          ? `/bar/tables/${destinationId}/settle`
          : `/restaurant/tables/${destinationId}/settle`;
        const res = await request(endpoint, { method: 'POST', body: paymentData, timeout: 3000 });
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      await fetch(`${SUPABASE_URL}/rest/v1/room_charges_inbox`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });
      clearTimeout(timer);

      // Also mark any matching active orders in room_charges_inbox as settled
      const tableNumberStr = tableObj?.table_number || String(destinationId);
      await fetch(
        `${SUPABASE_URL}/rest/v1/room_charges_inbox?department=eq.waiter_kot_order&room_number=eq.${encodeURIComponent(tableNumberStr)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'settled' })
        }
      ).catch(() => {});

      return { success: true, message: 'Settlement dispatched to cloud successfully' };
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

    // Supabase Cloud Cancellation
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const tableNumberStr = tableObj?.table_number || String(tableId);

      // Cancel matching pending order in cloud inbox
      await fetch(
        `${SUPABASE_URL}/rest/v1/room_charges_inbox?department=eq.waiter_kot_order&room_number=eq.${encodeURIComponent(tableNumberStr)}`,
        {
          method: 'PATCH',
          signal: controller.signal,
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'cancelled' })
        }
      ).catch(() => {});

      // Dispatch cancel event for local CRM printer and SQLite cleanup
      await fetch(`${SUPABASE_URL}/rest/v1/room_charges_inbox`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          room_number: tableNumberStr,
          room_id: Number(tableId) || 0,
          department: 'waiter_kot_cancel',
          order_id: 0,
          bill_no: 'VOID',
          subtotal: 0,
          gst: 0,
          grand_total: 0,
          settled_by: 'Waiter',
          items_summary: JSON.stringify({
            action: 'cancel_table',
            department: department || 'restaurant',
            table_id: tableId,
            table_number: tableNumberStr
          }),
          status: 'pending',
          created_at: new Date().toISOString()
        })
      }).catch(() => {});

      clearTimeout(timer);
    } catch (e) {
      console.warn('[WaiterAPI] Cloud cancel notice:', e.message);
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

    // Cancel in Supabase Cloud
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      await fetch(
        `${SUPABASE_URL}/rest/v1/room_charges_inbox?id=eq.${orderId}`,
        {
          method: 'PATCH',
          signal: controller.signal,
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'cancelled' })
        }
      ).catch(() => {});

      // Send cancel event to CRM
      await fetch(`${SUPABASE_URL}/rest/v1/room_charges_inbox`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          room_number: String(orderObj?.table_number || orderId),
          room_id: 0,
          department: 'waiter_kot_cancel',
          order_id: Number(orderId) || 0,
          bill_no: 'VOID',
          subtotal: 0,
          gst: 0,
          grand_total: 0,
          settled_by: 'Waiter',
          items_summary: JSON.stringify({
            action: 'cancel_order',
            department: department || 'restaurant',
            order_id: orderId
          }),
          status: 'pending',
          created_at: new Date().toISOString()
        })
      }).catch(() => {});

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
