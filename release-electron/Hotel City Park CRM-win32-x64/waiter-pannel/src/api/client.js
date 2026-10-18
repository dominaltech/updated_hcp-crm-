import { Capacitor } from '@capacitor/core';

export const CLOUD_TUNNEL_URL = 'https://speech-recording-ordering-designer.trycloudflare.com';
export const LOCAL_WIFI_IP = '10.160.83.195';

export const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

let cachedTunnelUrl = null;

// Fetch latest active tunnel URL from Supabase cloud sync if ever needed
export const fetchCloudTunnelUrl = async () => {
  if (cachedTunnelUrl) return cachedTunnelUrl;
  try {
    const res = await fetch(
      'https://hlwmsllmqfdxfmqulrat.supabase.co/rest/v1/room_charges_inbox?department=eq.cloud_tunnel_url&select=items_summary&limit=1',
      {
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk'
        }
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.items_summary) {
        cachedTunnelUrl = data[0].items_summary.replace(/\/+$/, '');
        return cachedTunnelUrl;
      }
    }
  } catch (e) {
    console.warn('[WaiterAPI] Could not fetch tunnel from Supabase:', e.message);
  }
  return CLOUD_TUNNEL_URL;
};

export const getBaseUrl = () => {
  // 1. Check if user/app cached a custom server address
  const customHost = localStorage.getItem('hcp_waiter_server_host');
  if (customHost && customHost.trim()) {
    let clean = customHost.trim().replace(/\/+$/, '');
    if (!clean.endsWith('/api')) clean += '/api';
    return clean;
  }

  // 2. If running inside the Android APK (Native Mobile)
  if (isNativePlatform()) {
    return `http://${LOCAL_WIFI_IP}:3000/api`;
  }

  // 3. If running inside a standard Web Browser
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname || '';
    const isHttps = window.location.protocol === 'https:';

    // When deployed on Netlify, Vercel, or loaded over HTTPS:
    if (isHttps || hostname.includes('netlify.app') || hostname.includes('vercel.app')) {
      const tunnel = cachedTunnelUrl || CLOUD_TUNNEL_URL;
      return `${tunnel}/api`;
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
        // Check if Supabase has a newer tunnel URL
        const freshTunnel = await fetchCloudTunnelUrl();
        if (freshTunnel && !base.includes(freshTunnel)) {
          fallbackBase = `${freshTunnel}/api`;
        }
      }

      if (fallbackBase && fallbackBase !== base) {
        try {
          const fallbackUrl = `${fallbackBase}${normEndpoint}`;
          const res = await doFetch(fallbackUrl, options, options.timeout || 8000);
          console.log(`[WaiterAPI] Fallback to ${fallbackBase} succeeded! Saving host.`);
          localStorage.setItem('hcp_waiter_server_host', fallbackBase);
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

export const api = {
  // Auth
  login: async (username, password) => {
    const res = await request('/staff/login', {
      method: 'POST',
      body: { username, password }
    });
    if (res && res.success) {
      setAuthToken(res.token);
      localStorage.setItem('hcp_waiter_user', JSON.stringify(res.user));
    }
    return res;
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
  getRestaurantTables: () => request('/restaurant/tables'),
  getBarTables: () => request('/bar/tables'),

  // Menus & Categories
  getRestaurantMenu: () => request('/restaurant/menu'),
  getRestaurantCategories: () => request('/restaurant/categories'),
  getBarMenu: () => request('/bar/menu'),
  getBarCategories: () => request('/bar/categories'),

  // Room Service - Occupied Rooms with Guest Info
  getOccupiedRooms: async () => {
    const res = await request('/rooms');
    const rooms = res && res.rooms ? res.rooms : (Array.isArray(res) ? res : []);
    // Filter rooms that are occupied or have current_booking_id
    const occupied = rooms.filter(r => r.status === 'occupied' || r.current_booking_id);

    // Fetch live guest folios in parallel for accurate names & phones
    const enriched = await Promise.all(
      occupied.map(async (r) => {
        try {
          const folio = await request(`/rooms/${r.id}/folio`);
          const booking = folio && (folio.booking || folio.bookingDetails);
          const guest = folio && folio.guest;
          return {
            ...r,
            guest_name: guest?.name || booking?.guest_name || 'In-House Guest',
            guest_phone: guest?.mobile || booking?.guest_mobile || '—',
            booking_id: booking?.id || r.current_booking_id,
            checkin_date: booking?.checkin_date || '—',
            stay_nights: booking?.stay_duration_nights || 1
          };
        } catch {
          return {
            ...r,
            guest_name: 'In-House Guest',
            guest_phone: '—',
            booking_id: r.current_booking_id
          };
        }
      })
    );

    return enriched;
  },

  // Order Placement (Tables, Rooms, Parcels)
  punchOrder: async (orderData) => {
    const {
      department, // 'restaurant' | 'bar'
      destination_type, // 'table' | 'room' | 'parcel'
      destination_id, // table_id, room_id, or parcel token/customer name
      destination_label, // 'Table 3', 'Room 204', 'Parcel #12'
      items, // [{ id, name, price, quantity, notes }]
      waiter_id,
      waiter_name,
      notes
    } = orderData;

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
    const gstRate = department === 'bar' ? 5 : 5; // standard 5% GST
    const gstAmount = Math.round((subtotal * gstRate) / 100);
    const grandTotal = Math.round(subtotal + gstAmount);

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
            qty: it.quantity,
            quantity: it.quantity,
            notes: it.notes || ''
          })),
          waiter_id,
          waiter_name,
          notes: notes || '',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (destination_type === 'room') {
      // Room service order charged directly to room booking folio
      const endpoint = department === 'bar' ? '/bar/order' : '/restaurant/order';
      return await request(endpoint, {
        method: 'POST',
        body: {
          order_type: 'room',
          room_id: destination_id,
          department,
          payment_mode: 'room_folio',
          subtotal,
          tax: gstAmount,
          discount: 0,
          total: grandTotal,
          table_number: destination_label || `Room ${destination_id}`,
          items: items.map(it => ({
            id: it.id,
            name: it.name,
            price: parseFloat(it.price) || 0,
            qty: parseInt(it.quantity || it.qty || 1, 10) || 1,
            quantity: parseInt(it.quantity || it.qty || 1, 10) || 1,
            total: (parseFloat(it.price) || 0) * (parseInt(it.quantity || it.qty || 1, 10) || 1),
            notes: it.notes || ''
          })),
          notes: notes || `Room Service by ${waiter_name}`,
          waiter_id,
          waiter_name,
          payment_method: 'room_folio',
          is_room_service: true
        }
      });
    }

    // Parcel / Takeaway order
    const parcelEndpoint = department === 'bar' ? '/bar/order' : '/restaurant/order';
    return await request(parcelEndpoint, {
      method: 'POST',
      body: {
        order_type: 'parcel',
        department,
        customer_name: destination_label || 'Parcel Customer',
        table_number: destination_label || 'Parcel',
        payment_mode: 'cash',
        subtotal,
        tax: gstAmount,
        discount: 0,
        total: grandTotal,
        items: items.map(it => ({
          id: it.id,
          name: it.name,
          price: parseFloat(it.price) || 0,
          qty: parseInt(it.quantity || it.qty || 1, 10) || 1,
          quantity: parseInt(it.quantity || it.qty || 1, 10) || 1,
          total: (parseFloat(it.price) || 0) * (parseInt(it.quantity || it.qty || 1, 10) || 1),
          notes: it.notes || ''
        })),
        notes: notes || `Takeaway by ${waiter_name}`,
        waiter_id,
        waiter_name,
        payment_method: 'pending'
      }
    });
  },

  // Settle or Request Bill
  requestBillPrint: (department, destinationId) => {
    const endpoint = department === 'bar'
      ? `/bar/tables/${destinationId}/prebill`
      : `/restaurant/tables/${destinationId}/prebill`;
    return request(endpoint, { method: 'POST' });
  },

  settleTable: (department, destinationId, paymentData) => {
    const endpoint = department === 'bar'
      ? `/bar/tables/${destinationId}/settle`
      : `/restaurant/tables/${destinationId}/settle`;
    return request(endpoint, { method: 'POST', body: paymentData });
  },

  getRestaurantOrders: () => request('/restaurant/orders'),
  getBarOrders: () => request('/bar/orders')
};
