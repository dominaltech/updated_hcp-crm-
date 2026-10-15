const db = require('../database');

/**
 * Mobile Push Notification & Owner Activity Service for Hotel City Park CRM
 * Handles instant push delivery to Android APK devices via Expo Push Service
 * and manages owner activity / notification logging.
 */

// Add compatibility column if needed
try { db.exec("ALTER TABLE owner_notifications ADD COLUMN read INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE owner_push_tokens ADD COLUMN platform TEXT DEFAULT 'android';"); } catch (e) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owner_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'discount',
      dept TEXT DEFAULT 'Room',
      bill_id TEXT,
      bill_number TEXT,
      guest_name TEXT,
      room_number TEXT,
      discount REAL DEFAULT 0,
      discount_pct REAL DEFAULT 0,
      current_total REAL DEFAULT 0,
      final_amount REAL DEFAULT 0,
      requested_by TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      status TEXT DEFAULT 'PENDING',
      action_by TEXT,
      action_at DATETIME,
      action_reason TEXT,
      metadata TEXT
    );
  `);
} catch (e) {}

function savePushToken(token, platform = 'android') {
  if (!token || typeof token !== 'string') return null;
  const cleanToken = token.trim();
  if (!cleanToken || cleanToken.includes('TEST_TOKEN')) return null;

  try {
    db.prepare(`
      INSERT INTO owner_push_tokens (token, device_name, platform, last_used)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(token) DO UPDATE SET last_used = CURRENT_TIMESTAMP, platform = excluded.platform
    `).run(cleanToken, (platform || 'Owner Android').trim(), platform);
  } catch (err) {
    console.warn('[NotificationService] Error saving push token to SQLite:', err.message);
  }

  // Also sync to Supabase Cloud 'owner_devices' table
  try {
    const h = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    };
    fetch(`${SUPABASE_URL}/rest/v1/owner_devices?fcm_token=eq.${encodeURIComponent(cleanToken)}&select=id`, { headers: h })
      .then(r => r.json())
      .then(existing => {
        if (Array.isArray(existing) && existing.length > 0) {
          fetch(`${SUPABASE_URL}/rest/v1/owner_devices?id=eq.${existing[0].id}`, {
            method: 'PATCH',
            headers: h,
            body: JSON.stringify({ updated_at: new Date().toISOString(), device_name: platform || 'Owner Android' })
          }).catch(() => null);
        } else {
          fetch(`${SUPABASE_URL}/rest/v1/owner_devices`, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ fcm_token: cleanToken, device_name: platform || 'Owner Android', updated_at: new Date().toISOString() })
          }).catch(() => null);
        }
      }).catch(() => null);
  } catch (e) {}

  return true;
}

function getPushTokens() {
  try {
    return db.prepare("SELECT token FROM owner_push_tokens WHERE token NOT LIKE '%TEST_TOKEN%'").all().map(r => r.token);
  } catch (err) {
    return [];
  }
}

async function getAllPushTokens() {
  const localTokens = getPushTokens();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/owner_devices?select=fcm_token`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const cloudDevices = await res.json();
    if (Array.isArray(cloudDevices)) {
      for (const cd of cloudDevices) {
        if (cd?.fcm_token && typeof cd.fcm_token === 'string' && !cd.fcm_token.includes('TEST_TOKEN')) {
          if (!localTokens.includes(cd.fcm_token)) {
            localTokens.push(cd.fcm_token);
            try {
              db.prepare(`
                INSERT INTO owner_push_tokens (token, device_name, platform, last_used)
                VALUES (?, 'Owner Android (Cloud Synced)', 'android', CURRENT_TIMESTAMP)
                ON CONFLICT(token) DO UPDATE SET last_used = CURRENT_TIMESTAMP
              `).run(cd.fcm_token);
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    console.warn('[NotificationService] Error fetching cloud tokens from Supabase:', err.message);
  }
  return localTokens;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hlwmsllmqfdxfmqulrat.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

async function sendPushNotification({ title, body, data = {}, type = 'general' }) {
  // 1. Store in owner_notifications database table
  try {
    db.prepare(`
      INSERT INTO owner_notifications (type, title, body, metadata, is_read, read)
      VALUES (?, ?, ?, ?, 0, 0)
    `).run(type, title, body, JSON.stringify(data));
  } catch (dbErr) {
    console.warn('[NotificationService] Error saving notification to DB:', dbErr.message);
  }

  const allTokens = await getAllPushTokens();
  console.log(`[NotificationService] Dispatching push '${title}' to ${allTokens.length} device tokens:`, allTokens.map(t => t.slice(0, 15) + '...'));

  // 2. DISPATCH VIA SUPABASE EDGE FUNCTION (send-push):
  // Dispatches Firebase FCM v1 to topic 'hotel_admin' & 'store_bills' AND directly to every registered device token
  let supabaseResult = null;
  try {
    const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        title,
        body,
        type,
        data,
        tokens: allTokens
      })
    });
    supabaseResult = await edgeRes.json().catch(() => null);
    console.log('[NotificationService] Supabase send-push edge function response:', JSON.stringify(supabaseResult));
  } catch (edgeErr) {
    console.warn('[NotificationService] Supabase send-push dispatch warning:', edgeErr.message);
  }

  // 3. Dispatch directly via Expo Push Notification API if any Expo tokens registered
  const expoTokens = allTokens.filter(t => t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));

  if (expoTokens.length > 0) {
    const messages = expoTokens.map(token => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: { ...data, type },
      channelId: 'high_importance_channel',
      priority: 'high',
      badge: 1
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messages)
      });
      const result = await res.json().catch(() => null);
      return { success: true, delivered: messages.length, result, supabase: supabaseResult };
    } catch (pushErr) {
      console.warn('[NotificationService] Direct Expo push dispatch error:', pushErr.message);
      return { success: false, error: pushErr.message, supabase: supabaseResult };
    }
  }

  return { success: true, supabase: supabaseResult };
}

function notifyCheckin({ roomNumbers = [], guestName = 'Guest', totalPaid = 0, bookingId = null, phone = '', roomType = '', voucherNumber = '', advanceReceiptNo = '' }) {
  const roomsStr = Array.isArray(roomNumbers) ? roomNumbers.join(', ') : String(roomNumbers || '');
  const title = `🛎️ Check-In: Room ${roomsStr}`;
  const paidText = totalPaid > 0 ? ` • ₹${Number(totalPaid).toLocaleString('en-IN')} paid` : '';
  const body = `${guestName} checked in${paidText}`;
  
  setImmediate(() => {
    sendPushNotification({
      title,
      body,
      type: 'checkin',
      data: { roomNumbers, room_number: roomsStr, room: roomsStr, guestName, totalPaid, bookingId, phone, roomType, voucherNumber, advanceReceiptNo }
    }).catch(e => console.warn('[NotificationService] Async checkin notice error:', e.message));
  });
}

function notifyCheckout({ roomNumbers = [], guestName = 'Guest', settleAmount = 0, refundAmount = 0, bookingId = null }) {
  const roomsStr = Array.isArray(roomNumbers) ? roomNumbers.join(', ') : String(roomNumbers || '');
  const title = `📤 Check-Out: Room ${roomsStr}`;
  let settleText = '';
  if (settleAmount > 0) settleText = ` • Settled ₹${Number(settleAmount).toLocaleString('en-IN')}`;
  else if (refundAmount > 0) settleText = ` • Refunded ₹${Number(refundAmount).toLocaleString('en-IN')}`;
  const body = `${guestName} checked out${settleText}`;

  setImmediate(() => {
    sendPushNotification({
      title,
      body,
      type: 'checkout',
      data: { roomNumbers, guestName, settleAmount, refundAmount, bookingId }
    }).catch(e => console.warn('[NotificationService] Async checkout notice error:', e.message));
  });
}

function notifyDiscountRequest({ discount = 0, total = 0, by = 'Staff', billId = null, guest = '', room = '' }) {
  const title = `⚠️ Discount Review: ₹${Number(discount).toLocaleString('en-IN')}`;
  const body = `${by} requested discount on ${room ? 'Room ' + room : 'Bill #' + billId}`;

  setImmediate(() => {
    sendPushNotification({
      title,
      body,
      type: 'discount',
      data: { discount, total, by, billId, guest, room }
    }).catch(e => console.warn('[NotificationService] Async discount notice error:', e.message));
  });
}

function getNotifications(limit = 50) {
  try {
    return db.prepare(`
      SELECT id, type, title, body, metadata, is_read, created_at
      FROM owner_notifications
      ORDER BY id DESC
      LIMIT ?
    `).all(limit).map(r => ({
      id: String(r.id),
      type: r.type,
      title: r.title,
      body: r.body,
      read: Boolean(r.is_read === 1 || r.read === 1),
      created_at: r.created_at,
      data: r.metadata ? JSON.parse(r.metadata) : {}
    }));
  } catch (err) {
    return [];
  }
}

function markNotificationRead(id) {
  try {
    if (id) {
      db.prepare('UPDATE owner_notifications SET is_read = 1, read = 1 WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE owner_notifications SET is_read = 1, read = 1').run();
    }
    return true;
  } catch (err) {
    return false;
  }
}

function getActivityFeed(type = 'all', limit = 100) {
  try {
    const list = [];

    // 1. Stored notifications
    const notifs = db.prepare(`
      SELECT id, type, title, body, metadata, created_at
      FROM owner_notifications
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);

    for (const n of notifs) {
      let meta = {};
      try { meta = n.metadata ? JSON.parse(n.metadata) : {}; } catch {}
      list.push({
        id: 'notif:' + n.id,
        type: n.type || 'general',
        tags: [n.type || 'general', 'notification'],
        title: n.title,
        body: n.body,
        created_at: n.created_at,
        dept: (n.type === 'checkin' || n.type === 'checkout') ? 'Room' : (meta.dept || 'Hotel'),
        guest: meta.guestName || meta.guest || '',
        room: Array.isArray(meta.roomNumbers) ? meta.roomNumbers.join(', ') : (meta.room || ''),
        total: Number(meta.totalPaid || meta.settleAmount || meta.total || 0),
        discount: Number(meta.discount || 0)
      });
    }

    // 2. Recent Bookings (Check-ins & Check-outs)
    try {
      const bookings = db.prepare(`
        SELECT b.id, b.room_id, r.room_number, g.name as guest_name, b.checkin_time, b.actual_checkout_time,
               b.status, b.advance_payment, b.total_room_charge, b.discount_amount
        FROM bookings b
        LEFT JOIN rooms r ON b.room_id = r.id
        LEFT JOIN guests g ON b.guest_id = g.id
        ORDER BY b.id DESC
        LIMIT 50
      `).all();

      for (const b of bookings) {
        const isCheckout = b.status === 'checked_out' && b.actual_checkout_time;
        list.push({
          id: 'stay:' + b.id,
          type: isCheckout ? 'checkout' : 'stay',
          tags: [isCheckout ? 'checkout' : 'stay', 'stay', 'checkin'],
          title: `${isCheckout ? 'Check-out' : 'Check-in'}: Room ${b.room_number || ''}`,
          body: `${b.guest_name || 'Guest'} (${isCheckout ? 'Settled' : '₹' + (b.advance_payment || 0) + ' advance'})`,
          created_at: (isCheckout ? b.actual_checkout_time : b.checkin_time) || new Date().toISOString(),
          dept: 'Room',
          guest: b.guest_name || '',
          room: String(b.room_number || ''),
          total: Number(b.total_room_charge || b.advance_payment || 0),
          discount: Number(b.discount_amount || 0)
        });
      }
    } catch (bErr) {
      console.warn('[NotificationService] Bookings feed notice:', bErr.message);
    }

    // 3. Recent Restaurant settled orders
    try {
      const restOrders = db.prepare(`
        SELECT id, order_number, table_number, customer_name, total, discount, settled_at, payment_mode
        FROM restaurant_orders
        WHERE status = 'settled'
        ORDER BY id DESC
        LIMIT 30
      `).all();

      for (const ro of restOrders) {
        list.push({
          id: 'rest:' + ro.id,
          type: 'restaurant',
          tags: ['restaurant', 'bill'],
          title: `Restaurant Bill: Table ${ro.table_number || ''}`,
          body: `${ro.order_number || ('#' + ro.id)} • ₹${ro.total || 0} (${ro.payment_mode || 'Cash'})`,
          created_at: ro.settled_at || new Date().toISOString(),
          dept: 'Restaurant',
          guest: ro.customer_name || '',
          room: '',
          total: Number(ro.total || 0),
          discount: Number(ro.discount || 0)
        });
      }
    } catch (_) {}

    // 4. Recent Bar settled orders
    try {
      const barOrders = db.prepare(`
        SELECT id, order_number, table_number, customer_name, total, discount, settled_at, payment_mode
        FROM bar_orders
        WHERE status = 'settled'
        ORDER BY id DESC
        LIMIT 30
      `).all();

      for (const bo of barOrders) {
        list.push({
          id: 'bar:' + bo.id,
          type: 'bar',
          tags: ['bar', 'bill'],
          title: `Bar Bill: Table ${bo.table_number || ''}`,
          body: `${bo.order_number || ('#' + bo.id)} • ₹${bo.total || 0} (${bo.payment_mode || 'Cash'})`,
          created_at: bo.settled_at || new Date().toISOString(),
          dept: 'Bar',
          guest: bo.customer_name || '',
          room: '',
          total: Number(bo.total || 0),
          discount: Number(bo.discount || 0)
        });
      }
    } catch (_) {}

    // Sort descending by created_at
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Filter by type if not 'all'
    if (type && type !== 'all') {
      return list.filter(item => item.tags.includes(type) || item.type === type).slice(0, limit);
    }

    return list.slice(0, limit);
  } catch (err) {
    console.warn('[NotificationService] getActivityFeed error:', err.message);
    return [];
  }
}

function createApprovalRequest({
  type = 'discount',
  dept = 'Room',
  bill_id = null,
  bill_number = '',
  guest_name = '',
  room_number = '',
  members = '',
  expected_checkout = '',
  discount = 0,
  discount_pct = 0,
  current_total = 0,
  final_amount = 0,
  requested_by = 'Front Desk',
  reason = '',
  metadata = null
}) {
  try {
    const metaStr = typeof metadata === 'object' ? JSON.stringify(metadata) : (metadata || JSON.stringify({ members, expected_checkout }));

    const info = db.prepare(`
      INSERT INTO owner_approvals (
        type, dept, bill_id, bill_number, guest_name, room_number,
        members, expected_checkout, discount, discount_pct, current_total, final_amount,
        requested_by, reason, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      type, dept, bill_id ? String(bill_id) : null, bill_number || '', guest_name || '',
      room_number ? String(room_number) : '', String(members || ''), String(expected_checkout || ''),
      Number(discount) || 0, Number(discount_pct) || 0,
      Number(current_total) || 0, Number(final_amount) || 0, requested_by || 'Front Desk', reason || '',
      metaStr
    );

    const id = info.lastInsertRowid;

    // Sync to Supabase cloud immediately so phone on 5G / outside WiFi can see and approve it!
    try {
      const supabaseService = require('./supabaseService');
      supabaseService.syncApprovalRequestToCloud({
        id,
        room_number,
        guest_name,
        members,
        expected_checkout,
        discount,
        discount_pct,
        current_total,
        final_amount,
        requested_by,
        reason
      });
    } catch (_) {}

    // Send push notification immediately with high priority & complete details
    const title = `⚠️ Discount Permission: ${discount_pct ? discount_pct + '%' : ''} (Room ${room_number || ''})`;
    const details = [
      guest_name ? `Guest: ${guest_name}` : null,
      members ? `Members: ${members}` : null,
      expected_checkout ? `Checkout: ${expected_checkout}` : null,
      `Total: ₹${Number(current_total).toLocaleString('en-IN')}`,
      `Discount: ${discount_pct}% (−₹${Number(discount).toLocaleString('en-IN')})`
    ].filter(Boolean).join(' • ');

    const body = `${details}. Tap to review and approve/reject.`;

    sendPushNotification({
      title,
      body,
      type: 'discount_approval',
      data: {
        approval_id: id,
        type: 'discount_approval',
        room_number,
        guest_name,
        members,
        expected_checkout,
        current_total,
        discount,
        discount_pct,
        final_amount
      }
    }).catch(() => {});

    return { success: true, id, status: 'PENDING' };
  } catch (err) {
    console.error('[NotificationService] createApprovalRequest error:', err);
    throw err;
  }
}

function getApprovals() {
  try {
    // 1. Get all pending and past approval requests from owner_approvals
    const approvals = db.prepare(`
      SELECT * FROM owner_approvals ORDER BY id DESC
    `).all();

    const pending = approvals.filter(a => (a.status || 'PENDING').toUpperCase() === 'PENDING');
    const pastApprovals = approvals.filter(a => (a.status || 'PENDING').toUpperCase() !== 'PENDING');

    // 2. Also gather recent historical discounts from settled bills to provide full audit history
    const history = [...pastApprovals];

    try {
      const roomDiscounts = db.prepare(`
        SELECT id, booking_id, guest_name, room_number, grand_total, discount_amount, discount_pct,
               actual_checkout_time as checkout_time, checked_in_by, created_at
        FROM hospitality_history
        WHERE discount_amount > 0
        ORDER BY id DESC LIMIT 50
      `).all();

      for (const rd of roomDiscounts) {
        history.push({
          id: 'hist:room:' + rd.id,
          dept: 'Room',
          bill_id: rd.id,
          bill_number: `R-${rd.booking_id || rd.id}`,
          guest_name: rd.guest_name,
          room_number: rd.room_number,
          discount: Number(rd.discount_amount || 0),
          discount_pct: Number(rd.discount_pct || 0),
          current_total: Number(rd.grand_total || 0) + Number(rd.discount_amount || 0),
          final_amount: Number(rd.grand_total || 0),
          requested_by: rd.checked_in_by || 'Front Desk',
          requested_at: rd.checkout_time || rd.created_at,
          status: 'APPROVED',
          action_by: 'Billed',
          reason: 'Applied at checkout'
        });
      }
    } catch (_) {}

    try {
      const fnbDiscounts = db.prepare(`
        SELECT id, order_number, table_number, customer_name, total, discount, settled_at, settled_by
        FROM restaurant_orders
        WHERE status = 'settled' AND discount > 0
        ORDER BY id DESC LIMIT 50
      `).all();

      for (const fd of fnbDiscounts) {
        history.push({
          id: 'hist:res:' + fd.id,
          dept: 'Restaurant',
          bill_id: fd.id,
          bill_number: fd.order_number || ('#' + fd.id),
          guest_name: fd.customer_name || 'Walk-in',
          room_number: '',
          discount: Number(fd.discount || 0),
          discount_pct: 0,
          current_total: Number(fd.total || 0) + Number(fd.discount || 0),
          final_amount: Number(fd.total || 0),
          requested_by: fd.settled_by || 'Cashier',
          requested_at: fd.settled_at,
          status: 'APPROVED',
          action_by: 'Billed',
          reason: 'Applied at settlement'
        });
      }
    } catch (_) {}

    return { pending, history, approvals };
  } catch (err) {
    console.warn('[NotificationService] getApprovals error:', err.message);
    return { pending: [], history: [], approvals: [] };
  }
}

function updateApprovalStatus(id, newStatus, user = 'Admin', reason = '') {
  try {
    const existing = db.prepare('SELECT * FROM owner_approvals WHERE id = ?').get(id);
    if (!existing) return null;

    db.prepare(`
      UPDATE owner_approvals
      SET status = ?, action_by = ?, action_at = CURRENT_TIMESTAMP, action_reason = ?
      WHERE id = ?
    `).run(newStatus, user, reason, id);

    return db.prepare('SELECT * FROM owner_approvals WHERE id = ?').get(id);
  } catch (err) {
    console.error('[NotificationService] updateApprovalStatus error:', err);
    throw err;
  }
}

module.exports = {
  savePushToken,
  getPushTokens,
  sendPushNotification,
  notifyCheckin,
  notifyCheckout,
  notifyDiscountRequest,
  getNotifications,
  markNotificationRead,
  getActivityFeed,
  createApprovalRequest,
  getApprovals,
  updateApprovalStatus
};

