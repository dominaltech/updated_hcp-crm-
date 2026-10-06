/**
 * Central API Service Layer for Hotel City Park CRM
 * Handles all communication with the Express backend on /api/*
 */

const BASE_URL = '/api';

// JWT Token storage
let _authToken = null;

function setAuthToken(token) {
  _authToken = token;
  if (token) {
    localStorage.setItem('hotel_auth_token', token);
  } else {
    localStorage.removeItem('hotel_auth_token');
  }
}

function getAuthToken() {
  if (!_authToken) {
    _authToken = localStorage.getItem('hotel_auth_token') || null;
  }
  return _authToken;
}

function clearAuthToken() {
  _authToken = null;
  localStorage.removeItem('hotel_auth_token');
}

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Attach JWT Authorization header if token exists
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

  try {
    const res = await fetch(url, config);
    const contentType = res.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      if (res.status === 401) {
        clearAuthToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('hotel:auth_unauthorized'));
        }
      }
      const errorMsg = (data && data.error) || (data && data.message) || (typeof data === 'string' && data) || `HTTP error ${res.status}`;
      const err = new Error(errorMsg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    console.error(`API Error on [${options.method || 'GET'}] ${url}:`, err);
    throw err;
  }
}

export const api = {
  get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options) => request(endpoint, { ...options, method: 'PUT', body }),
  delete: (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' }),

  // Hospitality & Rooms
  getRooms: () => request('/rooms'),
  getStats: () => request('/stats'),
  markRoomClean: (id, data = {}) => request(`/rooms/${id}/clean`, { method: 'POST', body: data }),
  toggleRoomMaintenance: (id, enabled) => request(`/rooms/${id}/maintenance`, { method: 'POST', body: { enabled } }),
  updateRoomStatus: (id, status) => request(`/rooms/${id}/status`, { method: 'POST', body: { status } }),
  getRoomFolio: (id) => request(`/rooms/${id}/folio`),
  createRoom: (data) => request('/rooms', { method: 'POST', body: data }),
  updateRoom: (id, data) => request(`/rooms/${id}`, { method: 'PUT', body: data }),
  deleteRoom: (id) => request(`/rooms/${id}`, { method: 'DELETE' }),
  transferRoom: (data) => request('/rooms/transfer', { method: 'POST', body: data }),

  // Cleaner / Housekeeping Staff
  getCleaners: () => request('/cleaners'),
  getManagerCleaners: () => request('/manager/cleaners'),
  createCleaner: (data) => request('/manager/cleaners', { method: 'POST', body: data }),
  updateCleaner: (id, data) => request(`/manager/cleaners/${id}`, { method: 'PUT', body: data }),
  deleteCleaner: (id) => request(`/manager/cleaners/${id}`, { method: 'DELETE' }),

  // Check-in & Booking
  checkin: (data) => request('/checkin', { method: 'POST', body: data }),
  checkout: (id, data) => request(`/checkout/${id}`, { method: 'POST', body: data }),
  extendCheckout: (id, data) => request(`/bookings/${id}/extend-checkout`, { method: 'POST', body: data }),
  updatePaymentStatus: (id, data) => request(`/bookings/${id}/payment-status`, { method: 'POST', body: data }),
  passCheque: (id, data) => request(`/bookings/${id}/pass-cheque`, { method: 'POST', body: data || {} }),
  bounceCheque: (id, data = {}) => request(`/bookings/${id}/bounce-cheque`, { method: 'POST', body: data }),
  changePaymentMethod: (id, data = {}) => request(`/bookings/${id}/change-payment-method`, { method: 'POST', body: data }),
  uploadChequePhoto: (id, data) => request(`/bookings/${id}/cheque-photo`, { method: 'POST', body: data }),
  getBookingDetails: (id) => request(`/bookings/${id}`),
  getStayHistory: (params = '') => request(`/hospitality/history${params ? `?${params}` : ''}`),

  // OCR & AI Vision
  analyzeIdCard: (data) => request('/ocr/analyze-id', { method: 'POST', body: data }),
  getAiKey: () => request('/settings/ai-key'),
  saveAiKey: (key, slot = null) => request('/settings/ai-key', { method: 'POST', body: slot ? { key, apiKey: key, slot } : { key, apiKey: key } }),
  saveAiKeySlot: (slot, key) => request('/settings/ai-key', { method: 'POST', body: { slot, key } }),
  clearAiKeySlot: (slot) => request('/settings/ai-key', { method: 'POST', body: { slot, clear: true } }),
  saveAiKeysBulk: (keys) => request('/settings/ai-key', { method: 'POST', body: { keys } }),
  testAiKey: (key, slot = null) => request('/settings/test-gemini', { method: 'POST', body: { key, apiKey: key, slot } }),
  testAllAiKeys: () => request('/settings/test-gemini', { method: 'POST', body: { testAll: true } }),
  getRoomGst: () => request('/settings/room-gst'),
  saveRoomGst: (room_gst_pct) => request('/settings/room-gst', { method: 'POST', body: { room_gst_pct } }),

  // Corporate BTC & OTA
  getBtcCompanies: () => request('/btc-companies'),
  createBtcCompany: (data) => request('/btc-companies', { method: 'POST', body: data }),
  updateBtcCompany: (id, data) => request(`/btc-companies/${id}`, { method: 'PUT', body: data }),
  deleteBtcCompany: (id) => request(`/btc-companies/${id}`, { method: 'DELETE' }),
  getOtaPlatforms: () => request('/ota-platforms'),
  addOtaPlatform: (name) => request('/ota-platforms', { method: 'POST', body: { name } }),
  deleteOtaPlatform: (name) => request(`/ota-platforms/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  saveOtaPlatforms: (platforms) => request('/ota-platforms', { method: 'POST', body: { platforms } }),

  // Staff & Auth
  getStaff: (params) => {
    const q = params && typeof params === 'object' ? new URLSearchParams(params).toString() : (typeof params === 'string' ? params : '');
    return request(`/staff${q ? `?${q}` : ''}`);
  },
  getPublicStaffList: (params) => {
    const q = params && typeof params === 'object' ? new URLSearchParams(params).toString() : (typeof params === 'string' ? params : '');
    return request(`/auth/staff-list-public${q ? `?${q}` : ''}`);
  },
  createStaff: (data) => request('/staff', { method: 'POST', body: data }),
  updateStaff: (id, data) => request(`/staff/${id}`, { method: 'PUT', body: data }),
  deleteStaff: (id) => request(`/staff/${id}`, { method: 'DELETE' }),
  loginStaff: (data) => request('/staff/login', { method: 'POST', body: data }),
  logoutShift: (data) => request('/staff/logout-shift', { method: 'POST', body: data }),
  verifyManagerLock: (data) => request('/auth/verify-manager-lock', { method: 'POST', body: data }),

  // Restaurant POS
  getRestaurantMenu: () => request('/restaurant/menu'),
  saveRestaurantDish: (data) => request('/restaurant/menu', { method: 'POST', body: data }),
  updateRestaurantDish: (id, data) => request(`/restaurant/menu/${id}`, { method: 'PUT', body: data }),
  deleteRestaurantDish: (id) => request(`/restaurant/menu/${id}`, { method: 'DELETE' }),
  getRestaurantCategories: () => request('/restaurant/categories'),
  saveRestaurantCategory: (data) => request('/restaurant/categories', { method: 'POST', body: data }),
  renameRestaurantCategory: (id, data) => request(`/restaurant/categories/${id}`, { method: 'PUT', body: data }),
  deleteRestaurantCategory: (id) => request(`/restaurant/categories/${id}`, { method: 'DELETE' }),
  getRestaurantTables: () => request('/restaurant/tables'),
  saveRestaurantTable: (data) => request('/restaurant/tables', { method: 'POST', body: data }),
  updateRestaurantTable: (id, data) => request(`/restaurant/tables/${id}`, { method: 'PUT', body: data }),
  deleteRestaurantTable: (id) => request(`/restaurant/tables/${id}`, { method: 'DELETE' }),
  saveRestaurantCart: (id, data) => request(`/restaurant/tables/${id}/cart`, { method: 'POST', body: data }),
  generateKOT: (id, data) => request(`/restaurant/tables/${id}/kot`, { method: 'POST', body: data }),
  generateRestaurantPrebill: (id, data) => request(`/restaurant/tables/${id}/prebill`, { method: 'POST', body: data }),
  settleRestaurantTable: (id, data) => request(`/restaurant/tables/${id}/settle`, { method: 'POST', body: data }),
  updateRestaurantTableStatus: (id, status) => request(`/restaurant/tables/${id}/status`, { method: 'POST', body: { status } }),
  getRestaurantSettledBills: () => request('/restaurant/settled-bills'),
  getRestaurantOrderDetail: (id) => request(`/restaurant/orders/${id}`),
  resettleRestaurantOrder: (id, data) => request(`/restaurant/orders/${id}/resettle`, { method: 'POST', body: data }),
  cancelRestaurantTable: (id) => request(`/restaurant/tables/${id}/cancel`, { method: 'POST' }),
  deleteRestaurantSettledBill: (id) => request(`/restaurant/settled-bills/${id}`, { method: 'DELETE' }),

  // Bar Lounge POS
  getBarMenu: () => request('/bar/menu'),
  saveBarDrink: (data) => request('/bar/menu', { method: 'POST', body: data }),
  updateBarDrink: (id, data) => request(`/bar/menu/${id}`, { method: 'PUT', body: data }),
  deleteBarDrink: (id) => request(`/bar/menu/${id}`, { method: 'DELETE' }),
  getBarCategories: () => request('/bar/categories'),
  saveBarCategory: (data) => request('/bar/categories', { method: 'POST', body: data }),
  renameBarCategory: (id, data) => request(`/bar/categories/${id}`, { method: 'PUT', body: data }),
  deleteBarCategory: (id) => request(`/bar/categories/${id}`, { method: 'DELETE' }),
  getBarTables: () => request('/bar/tables'),
  saveBarTable: (data) => request('/bar/tables', { method: 'POST', body: data }),
  updateBarTable: (id, data) => request(`/bar/tables/${id}`, { method: 'PUT', body: data }),
  deleteBarTable: (id) => request(`/bar/tables/${id}`, { method: 'DELETE' }),
  updateBarTableStatus: (id, status) => request(`/bar/tables/${id}/status`, { method: 'POST', body: { status } }),
  saveBarCart: (id, data) => request(`/bar/tables/${id}/cart`, { method: 'POST', body: data }),
  cancelBarTable: (id) => request(`/bar/tables/${id}/cancel`, { method: 'POST' }),
  generateBOT: (id, data) => request(`/bar/tables/${id}/bot`, { method: 'POST', body: data }),
  generateBarPrebill: (id, data) => request(`/bar/tables/${id}/prebill`, { method: 'POST', body: data }),
  settleBarTable: (id, data) => request(`/bar/tables/${id}/settle`, { method: 'POST', body: data }),
  getBarSettledBills: () => request('/bar/settled-bills'),
  getBarOrderDetail: (id) => request(`/bar/orders/${id}`),
  resettleBarOrder: (id, data) => request(`/bar/orders/${id}/resettle`, { method: 'POST', body: data }),

  // POS Manager Analytics (Restaurant & Bar)
  getPosAnalytics: (department = 'restaurant', params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/${department}/manager/analytics${qs ? '?' + qs : ''}`);
  },

  // POS Tax & GST Settings
  getPosSettings: () => request('/pos/settings'),
  savePosSettings: (data) => request('/pos/settings', { method: 'POST', body: data }),

  // Card & UPI Surcharges Settings
  getSurcharges: () => request('/settings/surcharges'),
  saveSurcharges: (data) => request('/settings/surcharges', { method: 'POST', body: data }),

  // Check-In Advance Payment Policy
  getCheckinPolicy: () => request('/settings/checkin-policy'),
  saveCheckinPolicy: (min_checkin_advance_pct) => request('/settings/checkin-policy', { method: 'POST', body: { min_checkin_advance_pct } }),

  // Auto-Save Directory & PDF Silent Export
  getAutoSaveDir: () => request('/settings/auto-save-dir'),
  saveAutoSaveDir: (auto_save_directory) => request('/settings/auto-save-dir', { method: 'POST', body: { auto_save_directory } }),
  saveInvoicePdf: (data) => request('/save-invoice-pdf', { method: 'POST', body: data }),

  // Invoice Sequence & Financial Year Settings
  getInvoiceSettings: () => request('/settings/invoice-sequence'),
  saveInvoiceSettings: (data) => request('/settings/invoice-sequence', { method: 'POST', body: data }),

  // Visitors
  getVisitors: (roomId) => request(`/rooms/${roomId}/visitors`),
  addVisitor: (roomId, data) => request(`/rooms/${roomId}/visitors`, { method: 'POST', body: data }),
  checkoutVisitor: (visitorId) => request(`/visitors/${visitorId}/checkout`, { method: 'POST' }),
  deleteVisitor: (visitorId) => request(`/visitors/${visitorId}`, { method: 'DELETE' }),

  // Hospitality namespace alias for components expecting api.hospitality.*
  hospitality: {
    getRooms: () => request('/rooms'),
    getStats: () => request('/stats'),
    getFolio: (id) => request(`/rooms/${id}/folio`),
    markRoomClean: (id) => request(`/rooms/${id}/clean`, { method: 'POST' }),
    toggleRoomMaintenance: (id, enabled) => request(`/rooms/${id}/maintenance`, { method: 'POST', body: { enabled } }),
    updateRoomStatus: (id, status) => request(`/rooms/${id}/status`, { method: 'POST', body: { status } }),
    getVisitors: (roomId) => request(`/rooms/${roomId}/visitors`),
    addVisitor: (roomId, data) => request(`/rooms/${roomId}/visitors`, { method: 'POST', body: data }),
    checkoutVisitor: (visitorId) => request(`/visitors/${visitorId}/checkout`, { method: 'POST' }),
    deleteVisitor: (visitorId) => request(`/visitors/${visitorId}`, { method: 'DELETE' })
  },

  // Hospitality F&B Settle & Mobile Dispatch
  settleFnbOrder: (data) => request('/hospitality/settle-fnb-order', { method: 'POST', body: data }),
  sendOrderBillToMobile: (data) => request('/orders/send-bill-mobile', { method: 'POST', body: data }),

  // Multi-Machine Cloud Sync
  getOccupiedRooms: () => request('/restaurant/occupied-rooms'),
  getSyncOccupancies: () => request('/sync/occupancies'),
  pushSyncNow: () => request('/sync/push-now', { method: 'POST' }),

  // Payments for room folio (In-stay advance payment)
  addRoomPayment: (roomId, data) => request(`/rooms/${roomId}/payments`, { method: 'POST', body: data }),

  // Expenses & Petty Cash
  getExpenses: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/expenses${qs ? '?' + qs : ''}`);
  },
  createExpense: (data) => request('/expenses', { method: 'POST', body: data }),
  adjustExpense: (id, data) => request(`/expenses/${id}/adjust`, { method: 'POST', body: data }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: 'DELETE' }),
  getExpenseCategoriesConfig: () => request('/expense-categories-config'),
  updateExpenseCategoriesConfig: (data) => request('/expense-categories-config', { method: 'POST', body: data }),

  // Manager Accounting & Analysis
  getAccountingAnalysis: (params = {}) => {
    const cleanParams = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        cleanParams[k] = v;
      }
    });
    const qs = new URLSearchParams(cleanParams).toString();
    return request(`/manager/accounting-analysis${qs ? '?' + qs : ''}`);
  },
  getAccountingEmail: () => request('/manager/accounting-email'),
  saveAccountingEmail: (data) => request('/manager/accounting-email', { method: 'POST', body: data }),
  sendAccountingEmail: (data) => request('/manager/send-accounting-email', { method: 'POST', body: data }),
  getSmtpSettings: () => request('/manager/smtp-settings'),
  saveSmtpSettings: (data) => request('/manager/smtp-settings', { method: 'POST', body: data }),

  // Hardware Scanner Integration
  getScannerDevices: async () => {
    try {
      return await request('/scanner/devices');
    } catch (err) {
      try {
        const res = await fetch('http://localhost:3000/api/scanner/devices');
        if (res.ok) return await res.json();
      } catch (e) {}
      throw err;
    }
  },
  scanHardwareDocument: async () => {
    try {
      return await request('/scanner/scan', { method: 'POST' });
    } catch (err) {
      try {
        const res = await fetch('http://localhost:3000/api/scanner/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) return await res.json();
      } catch (e) {}
      throw err;
    }
  },
  getLatestScannedDocument: async () => {
    try {
      return await request('/scanner/latest');
    } catch (err) {
      try {
        const res = await fetch('http://localhost:3000/api/scanner/latest');
        if (res.ok) return await res.json();
      } catch (e) {}
      throw err;
    }
  },

  // Generic HTTP helper (underlying request function)
  cleanDemoData: () => request('/settings/clean-demo-data', { method: 'POST' }),
  request,

  // Auth Token Management
  setAuthToken,
  getAuthToken,
  clearAuthToken
};

