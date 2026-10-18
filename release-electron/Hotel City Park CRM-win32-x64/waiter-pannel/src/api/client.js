import { Capacitor } from '@capacitor/core';

export const CLOUD_TUNNEL_URL = 'https://hotelcitypark-api.loca.lt';
export const LOCAL_WIFI_IP = '10.160.83.195';

export const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export const getBaseUrl = () => {
  // 1. Check if user configured a custom server address
  const customHost = localStorage.getItem('hcp_waiter_server_host');
  if (customHost && customHost.trim()) {
    let clean = customHost.trim().replace(/\/+$/, '');
    if (!clean.endsWith('/api')) clean += '/api';
    return clean;
  }

  // 2. If running inside the Android APK (Native Mobile)
  if (isNativePlatform()) {
    // In native Android, "localhost" refers to the phone itself, NOT the CRM computer.
    // Default directly to the hotel CRM Wi-Fi server IP.
    return `http://${LOCAL_WIFI_IP}:3000/api`;
  }

  // 3. If running inside a standard Web Browser
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname || '';
    const isHttps = window.location.protocol === 'https:';

    // When deployed on Netlify, Vercel, or loaded over HTTPS:
    if (isHttps || hostname.includes('netlify.app') || hostname.includes('vercel.app')) {
      return `${CLOUD_TUNNEL_URL}/api`;
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

export const request = async (endpoint, options = {}) => {
  const base = getBaseUrl();
  const url = `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

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

  // AbortController timeout to prevent infinite "Signing in..." freeze
  const controller = new AbortController();
  const timeoutMs = options.timeout || 7500; // 7.5 seconds
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res = await fetch(url, { ...config, signal: controller.signal });
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
    let errorMsg = err.message || 'Connection failed';
    if (err.name === 'AbortError') {
      errorMsg = `Server timed out (${base.replace('/api', '')}). Ensure phone is connected to Hotel Wi-Fi, or check Server IP below.`;
    } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      errorMsg = `Cannot connect to CRM server (${base.replace('/api', '')}). Check phone Wi-Fi or update Server IP.`;
    }
    console.error(`[WaiterAPI] Error on ${options.method || 'GET'} ${url}:`, errorMsg);
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
