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
      members TEXT,
      expected_checkout TEXT,
      meal_plan TEXT,
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

  // Also sync to Firebase Cloud 'owner_devices' collection
  try {
    const firebaseService = require('./firebaseService');
    const docId = cleanToken.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    firebaseService.pushRoomCharge('owner_devices', {
      id: docId,
      fcm_token: cleanToken,
      device_name: platform || 'Owner Android',
      platform: platform || 'android',
      updated_at: new Date().toISOString()
    }).catch(() => {});
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const FIREBASE_REST_URL = 'https://firestore.googleapis.com/v1/projects/hotelcitypark-crm/databases/(default)/documents';
    const FIREBASE_API_KEY = 'AIzaSyCtZnkdk1_q8rWrISnD8P2Rhi-jcPn1QTI';
    const res = await fetch(`${FIREBASE_REST_URL}/owner_devices?key=${FIREBASE_API_KEY}`, {
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const data = await res.json();
      if (data.documents && Array.isArray(data.documents)) {
        for (const d of data.documents) {
          const tok = d.fields?.fcm_token?.stringValue;
          if (tok && typeof tok === 'string' && !tok.includes('TEST_TOKEN') && !localTokens.includes(tok)) {
            localTokens.push(tok);
            try {
              db.prepare(`
                INSERT INTO owner_push_tokens (token, device_name, platform, last_used)
                VALUES (?, 'Owner Android (Cloud Synced)', 'android', CURRENT_TIMESTAMP)
                ON CONFLICT(token) DO UPDATE SET last_used = CURRENT_TIMESTAMP
              `).run(tok);
            } catch {}
          }
        }
      }
    }
  } catch (err) {}
  return localTokens;
}

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

  // 2. Broadcast immediately over WebSocket to all open screens
  try {
    const socketServer = require('./socketServer');
    socketServer.broadcast('NOTIFICATION', { title, body, type, data, created_at: new Date().toISOString() });
  } catch (_) {}

  const allTokens = await getAllPushTokens();
  console.log(`[NotificationService] Dispatching push '${title}' to ${allTokens.length} device tokens:`, allTokens.map(t => t.slice(0, 15) + '...'));

  // 3. Dispatch to Native Android APKs via Firebase Cloud Messaging (FCM)
  const fcmTokens = allTokens.filter(t => t && !t.startsWith('ExponentPushToken[') && !t.startsWith('ExpoPushToken[') && t.length > 20);
  if (fcmTokens.length > 0) {
    try {
      const admin = require('firebase-admin');
      const { getMessaging } = require('firebase-admin/messaging');
      let app = admin.getApps().length > 0 ? admin.getApp() : null;
      if (!app) {
        const path = require('path');
        const fs = require('fs');
        const saPaths = [
          path.resolve(__dirname, '..', 'firebase-service-account.json'),
          path.resolve(__dirname, '..', 'hotelcitypark-crm-firebase-adminsdk-fbsvc-cb2c37b86c.json'),
          path.resolve(__dirname, 'firebase-service-account.json')
        ];
        for (const p of saPaths) {
          if (fs.existsSync(p)) {
            try {
              const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
              app = admin.initializeApp({ credential: admin.cert(sa) });
              break;
            } catch (_) {}
          }
        }
      }

      if (app) {
        const messaging = getMessaging(app);
        
        // Convert all data fields to string format for FCM compatibility
        const stringData = {};
        if (data && typeof data === 'object') {
          for (const [k, v] of Object.entries(data)) {
            stringData[k] = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
          }
        }
        stringData.title = String(title || '');
        stringData.body = String(body || '');
        stringData.type = String(type || 'general');

        // FCM supports up to 500 tokens per multicast batch
        for (let i = 0; i < fcmTokens.length; i += 500) {
          const batch = fcmTokens.slice(i, i + 500);
          const fcmMessage = {
            tokens: batch,
            notification: {
              title: String(title),
              body: String(body)
            },
            data: stringData,
            android: {
              priority: 'high',
              notification: {
                channelId: 'high_importance_channel',
                sound: 'default',
                defaultSound: true,
                defaultVibrateTimings: true,
                priority: 'high'
              }
            }
          };

          const fcmRes = await messaging.sendEachForMulticast(fcmMessage);
          console.log(`[NotificationService] FCM Multicast dispatch: ${fcmRes.successCount} succeeded, ${fcmRes.failureCount} failed`);

          // Clean up dead/unregistered tokens from SQLite AND Firestore
          if (fcmRes.failureCount > 0) {
            fcmRes.responses.forEach((resp, idx) => {
              if (!resp.success && resp.error) {
                const code = resp.error.code || resp.error.message || '';
                if (code.includes('not-registered') || code.includes('invalid-registration') || code.includes('NotRegistered')) {
                  const deadToken = batch[idx];
                  try {
                    db.prepare('DELETE FROM owner_push_tokens WHERE token = ?').run(deadToken);
                    console.log('[NotificationService] Cleaned up unregistered FCM token from SQLite:', deadToken.slice(0, 15) + '...');
                  } catch (_) {}
                  try {
                    const docId = deadToken.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
                    const FIREBASE_REST_URL = 'https://firestore.googleapis.com/v1/projects/hotelcitypark-crm/databases/(default)/documents';
                    const FIREBASE_API_KEY = 'AIzaSyCtZnkdk1_q8rWrISnD8P2Rhi-jcPn1QTI';
                    fetch(`${FIREBASE_REST_URL}/owner_devices/${docId}?key=${FIREBASE_API_KEY}`, { method: 'DELETE' }).catch(() => {});
                    console.log('[NotificationService] Cleaned up unregistered FCM token from Firestore:', docId);
                  } catch (_) {}
                }
              }
            });
          }
        }
      }
    } catch (fcmErr) {
      console.warn('[NotificationService] FCM dispatch error:', fcmErr.message);
    }
  }

  // 4. Dispatch directly via Expo Push Service (for Expo Go / Expo tokens)
  const expoTokens = allTokens.filter(t => t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
  if (expoTokens.length === 0) {
    return { success: true, count: fcmTokens.length };
  }

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messages)
    }).finally(() => clearTimeout(timer));
    const expoResult = await res.json().catch(() => null);
    return { success: true, expo: expoResult, fcmCount: fcmTokens.length };
  } catch (pushErr) {
    console.warn('[NotificationService] Direct Expo push dispatch error:', pushErr.message);
    return { success: true, error: pushErr.message, fcmCount: fcmTokens.length };
  }
}

const recentStoreBillNotifs = new Map();

function notifyStoreBill({ vendorName = 'Vendor', billNumber = '', amount = 0, billId = null, paymentMode = 'Cash', hasGst = false }) {
  const dedupKey = String(billId || billNumber || `${vendorName}_${amount}`).trim();
  if (dedupKey) {
    const now = Date.now();
    const lastSent = recentStoreBillNotifs.get(dedupKey) || 0;
    if (now - lastSent < 30000) {
      console.log(`[NotificationService] Skipping duplicate store bill notification for ${dedupKey} (dispatched ${now - lastSent}ms ago)`);
      return;
    }
    recentStoreBillNotifs.set(dedupKey, now);

    // Housekeeping to prevent memory growth
    if (recentStoreBillNotifs.size > 200) {
      for (const [k, t] of recentStoreBillNotifs.entries()) {
        if (now - t > 60000) recentStoreBillNotifs.delete(k);
      }
    }
  }

  const formattedAmt = `₹${Number(amount || 0).toLocaleString('en-IN')}`;
  const title = `📦 New Store Bill: ${vendorName}`;
  const body = `Bill #${billNumber || ('SB-' + String(Date.now()).slice(-4))} for ${formattedAmt} (${paymentMode}${hasGst ? ' • GST' : ' • No GST'})`;
  const deepLink = `hcpowner://store?billId=${billId || ''}`;

  setImmediate(() => {
    sendPushNotification({
      title,
      body,
      type: 'store_bill',
      data: {
        type: 'store_bill',
        deepLink,
        url: deepLink,
        billId: billId ? String(billId) : '',
        vendorName,
        billNumber,
        amount,
        paymentMode
      }
    }).catch(e => console.warn('[NotificationService] Async store bill notice error:', e.message));
  });
}


const recentStorePaymentNotifs = new Map();

function notifyStorePayment({
  vendorName = 'Vendor',
  vendorId = null,
  amount = 0,
  paymentMode = 'Bank Transfer',
  paidBy = 'Admin',
  referenceNo = '',
  billId = null,
  paymentId = null
}) {
  const normVendor = String(vendorId || vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const numAmt = parseFloat(String(amount).replace(/,/g, '')) || 0;
  const primaryKey = `store_pay_${normVendor}_${numAmt}`;
  const secondaryKey = paymentId ? `store_pay_id_${paymentId}` : null;
  const now = Date.now();
  const lastPrimary = recentStorePaymentNotifs.get(primaryKey) || 0;
  const lastSecondary = secondaryKey ? (recentStorePaymentNotifs.get(secondaryKey) || 0) : 0;
  const lastSent = Math.max(lastPrimary, lastSecondary);
  if (now - lastSent < 60000) {
    console.log(`[NotificationService] Skipping duplicate store payment notification for ${primaryKey} (dispatched ${now - lastSent}ms ago)`);
    return;
  }
  recentStorePaymentNotifs.set(primaryKey, now);
  if (secondaryKey) recentStorePaymentNotifs.set(secondaryKey, now);

  if (recentStorePaymentNotifs.size > 200) {
    for (const [k, t] of recentStorePaymentNotifs.entries()) {
      if (now - t > 60000) recentStorePaymentNotifs.delete(k);
    }
  }

  const formattedAmt = `₹${numAmt > 0 ? numAmt.toLocaleString('en-IN') : amount}`;
  const title = `💰 Payment Received: ${formattedAmt}`;
  const body = `${paidBy || 'Admin'} paid ${formattedAmt} for ${vendorName} (${paymentMode})${referenceNo ? ` • Ref: ${referenceNo}` : ''}`;
  const deepLink = 'storeman://recent?tab=recent&subTab=partyDues';

  const stringData = {
    type: 'store_payment',
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
    action: 'FLUTTER_NOTIFICATION_CLICK',
    deepLink,
    url: deepLink,
    vendorId: String(vendorId || ''),
    vendorName: String(vendorName || 'Vendor'),
    amount: String(numAmt || amount || '0'),
    paymentMode: String(paymentMode || 'Bank Transfer'),
    paidBy: String(paidBy || 'Admin'),
    referenceNo: String(referenceNo || ''),
    billId: billId ? String(billId) : '',
    title,
    body
  };

  setImmediate(async () => {
    let fcmSucceeded = false;
    // 1. Primary: Send FCM Push to topic 'store_bills' (Storeman APK rings even when killed!)
    try {
      const admin = require('firebase-admin');
      const { getMessaging } = require('firebase-admin/messaging');
      let app = admin.getApps().length > 0 ? admin.getApp() : null;
      if (!app) {
        const p = path.resolve(__dirname, '..', 'hotelcitypark-crm-firebase-adminsdk-fbsvc-cb2c37b86c.json');
        if (fs.existsSync(p)) {
          const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
          app = admin.initializeApp({ credential: admin.cert(sa) });
        }
      }

      if (app) {
        const messaging = getMessaging(app);
        const fcmMessage = {
          topic: 'store_bills',
          notification: {
            title,
            body
          },
          data: stringData,
          android: {
            priority: 'high',
            collapseKey: `store_payment_${normVendor || 'vendor'}`,
            notification: {
              channelId: 'high_importance_channel',
              sound: 'default',
              defaultSound: true,
              defaultVibrateTimings: true,
              priority: 'max',
              tag: `store_payment_${normVendor || 'vendor'}`,
              clickAction: 'FLUTTER_NOTIFICATION_CLICK'
            }
          }
        };

        const fcmRes = await messaging.send(fcmMessage);
        console.log(`[NotificationService] FCM Topic dispatch to 'store_bills' for Storeman APK: succeeded (${fcmRes})`);
        fcmSucceeded = true;
      }
    } catch (fcmErr) {
      console.warn('[NotificationService] FCM store payment topic dispatch error:', fcmErr.message);
    }

    // 2. Fallback: If primary FCM failed, dispatch via Supabase Edge Function
    if (!fcmSucceeded) {
      try {
        fetch('https://hlwmsllmqfdxfmqulrat.supabase.co/functions/v1/send-store-push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDY5NDIsImV4cCI6MjA3NTQyMjk0Mn0.p1b2Yq9mZ0WXZG1z0B8Yy7v9o0T0_h0T1a2B3c4D5eF',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDY5NDIsImV4cCI6MjA3NTQyMjk0Mn0.p1b2Yq9mZ0WXZG1z0B8Yy7v9o0T0_h0T1a2B3c4D5eF'
          },
          body: JSON.stringify({
            type: 'store_payment',
            topic: 'store_bills',
            title,
            body,
            amount: String(numAmt),
            vendor_name: vendorName,
            payment_mode: paymentMode,
            paid_by: paidBy,
            bill_id: billId ? String(billId) : ''
          })
        }).catch(() => {});
      } catch (_) {}
    }
  });
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
      data: {
        notifType: 'checkout',
        type: 'checkout',
        roomNumbers,
        room_number: roomsStr,
        room: roomsStr,
        guestName,
        settleAmount,
        refundAmount,
        bookingId
      }
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

function notifyExpense({ voucherNo = '', amount = 0, category = 'General', paidTo = '', cashierName = 'Staff', description = '' }) {
  const formattedAmt = `₹${Number(amount || 0).toLocaleString('en-IN')}`;
  const title = `💸 Expense Recorded: ${formattedAmt}`;
  const body = `${String(category || 'Expense').toUpperCase()} • Paid to ${paidTo || 'Vendor'} by ${cashierName}${voucherNo ? ` (Voucher #${voucherNo})` : ''}`;
  return sendPushNotification({
    title,
    body,
    type: 'expense',
    data: {
      type: 'expense',
      voucherNo,
      amount,
      category,
      paidTo,
      cashierName,
      url: '/expenses'
    }
  }).catch(e => console.warn('[NotificationService] Async expense notice error:', e.message));
}

function getNotifications(limit = 50) {
  try {
    return db.prepare(`
      SELECT id, type, title, body, deep_link, metadata, is_read, created_at
      FROM owner_notifications
      ORDER BY id DESC
      LIMIT ?
    `).all(limit).map(r => ({
      id: String(r.id),
      type: r.type,
      title: r.title,
      body: r.body,
      deep_link: r.deep_link || (r.metadata ? (JSON.parse(r.metadata).deepLink || JSON.parse(r.metadata).url) : null),
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

    // 5. Recent Store purchase bills
    try {
      const storeBills = db.prepare(`
        SELECT sb.id, sb.bill_number, sb.bill_date, sb.total_amount, sb.paid_amount, sb.pending_amount, sb.status, sb.created_at, sv.name as vendor_name
        FROM store_bills sb
        LEFT JOIN store_vendors sv ON sb.vendor_id = sv.id
        ORDER BY sb.id DESC
        LIMIT 30
      `).all();

      for (const sb of storeBills) {
        list.push({
          id: 'store:' + sb.id,
          type: 'store_bill',
          tags: ['store', 'store_bill', 'bill'],
          title: `Store Bill: ${sb.vendor_name || 'Vendor'}`,
          body: `Bill #${sb.bill_number || sb.id} • ₹${sb.total_amount || 0} (${sb.status || 'PENDING'})`,
          created_at: sb.created_at || sb.bill_date || new Date().toISOString(),
          dept: 'Store',
          guest: sb.vendor_name || '',
          room: '',
          total: Number(sb.total_amount || 0),
          discount: 0
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

try { db.prepare('ALTER TABLE owner_approvals ADD COLUMN meal_plan TEXT').run(); } catch (_) {}
try { db.prepare('ALTER TABLE owner_approvals ADD COLUMN members TEXT').run(); } catch (_) {}
try { db.prepare('ALTER TABLE owner_approvals ADD COLUMN expected_checkout TEXT').run(); } catch (_) {}

function createApprovalRequest({
  type = 'discount',
  dept = 'Room',
  bill_id = null,
  bill_number = '',
  guest_name = '',
  room_number = '',
  room_count = null,
  rooms_list = null,
  members = '',
  expected_checkout = '',
  meal_plan = '',
  discount = 0,
  discount_pct = 0,
  current_total = 0,
  final_amount = 0,
  requested_by = 'Front Desk',
  reason = '',
  metadata = null
}) {
  try {
    const derivedRoomCount = Number(room_count) || (metadata && metadata.room_count) || (room_number && room_number.includes(',') ? room_number.split(',').length : 1);
    const roomLabel = String(room_number || '').trim().startsWith('Room')
      ? room_number
      : (derivedRoomCount > 1 ? `Rooms ${room_number}` : `Room ${room_number}`);

    const metaObj = typeof metadata === 'object' && metadata !== null
      ? { ...metadata, room_count: derivedRoomCount, rooms_list, meal_plan, requested_by }
      : { room_count: derivedRoomCount, rooms_list, members, expected_checkout, meal_plan, requested_by };
    const metaStr = JSON.stringify(metaObj);

    const info = db.prepare(`
      INSERT INTO owner_approvals (
        type, dept, bill_id, bill_number, guest_name, room_number,
        members, expected_checkout, meal_plan, discount, discount_pct, current_total, final_amount,
        requested_by, reason, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      type, dept, bill_id ? String(bill_id) : null, bill_number || '', guest_name || '',
      room_number ? String(room_number) : '', String(members || ''), String(expected_checkout || ''),
      String(meal_plan || ''),
      Number(discount) || 0, Number(discount_pct) || 0,
      Number(current_total) || 0, Number(final_amount) || 0, requested_by || 'Front Desk', reason || '',
      metaStr
    );

    const id = info.lastInsertRowid;

    // Sync to Firebase & Supabase cloud immediately so Admin phone on 5G / outside WiFi can see and approve it!
    try {
      const firebaseService = require('./firebaseService');
      firebaseService.syncApprovalRequestToCloud({
        id,
        type,
        room_number,
        room_count: derivedRoomCount,
        rooms_list,
        guest_name,
        members,
        expected_checkout,
        meal_plan,
        discount,
        discount_pct,
        current_total,
        final_amount,
        requested_by,
        reason,
        metadata: metaObj
      });
    } catch (_) {}



    // Broadcast immediately over WebSocket to any open CRM / APK panels
    try {
      const socketServer = require('./socketServer');
      socketServer.broadcast('APPROVAL_REQUEST', {
        id,
        type,
        room_number,
        room_count: derivedRoomCount,
        rooms_list,
        guest_name,
        members,
        expected_checkout,
        meal_plan,
        discount,
        discount_pct,
        current_total,
        final_amount,
        requested_by,
        reason,
        metadata: metaObj
      });
    } catch (_) {}

    // Send push notification immediately with high priority & complete details
    let title, body, pushType;
    if (type === 'room_transfer') {
      const fromType = (metaObj && metaObj.from_room_type) || '';
      const toRoom = (metaObj && metaObj.to_room_number) || '';
      const toType = (metaObj && metaObj.to_room_type) || '';
      title = `🔄 Room Category Shift: Room ${room_number} ➔ Room ${toRoom}`;
      body = `Shift ${guest_name ? guest_name + ' ' : ''}from Room ${room_number} (${fromType}) to Room ${toRoom} (${toType}). Declared check-in rates preserved (no extra cost). Tap to approve.`;
      pushType = 'room_transfer_approval';
    } else {
      title = `⚠️ Discount Permission: ${discount_pct ? discount_pct + '%' : ''} (${roomLabel})`;
      const details = [
        derivedRoomCount > 1 ? `Total Rooms: ${derivedRoomCount}` : null,
        guest_name ? `Guest: ${guest_name}` : null,
        members ? `Members: ${members}` : null,
        expected_checkout ? `Checkout: ${expected_checkout}` : null,
        meal_plan ? `Plan: ${meal_plan}` : null,
        requested_by ? `Raised by: ${requested_by}` : null,
        `Tariff: ₹${Number(current_total).toLocaleString('en-IN')}`,
        `Discount: ${discount_pct}% (−₹${Number(discount).toLocaleString('en-IN')})`,
        `Net: ₹${Number(final_amount).toLocaleString('en-IN')}`
      ].filter(Boolean).join(' • ');
      body = `${details}. Tap to review and approve/reject.`;
      pushType = 'discount_approval';
    }

    sendPushNotification({
      title,
      body,
      type: pushType,
      data: {
        approval_id: id,
        type: pushType,
        ...metaObj,
        room_number,
        room_count: derivedRoomCount,
        rooms_list,
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

    const formattedApprovals = approvals.map(a => {
      let meta = {};
      try { meta = JSON.parse(a.metadata || '{}'); } catch {}
      const rCount = meta.room_count || (a.room_number && a.room_number.includes(',') ? a.room_number.split(',').length : 1);
      return {
        ...a,
        room_count: rCount,
        rooms_list: meta.rooms_list || null
      };
    });

    const pending = formattedApprovals.filter(a => (a.status || 'PENDING').toUpperCase() === 'PENDING');
    const pastApprovals = formattedApprovals.filter(a => (a.status || 'PENDING').toUpperCase() !== 'PENDING');

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

function executeRoomTransferFromApproval(approval, user = 'Admin') {
  try {
    let meta = {};
    try {
      meta = typeof approval.metadata === 'string' ? JSON.parse(approval.metadata) : (approval.metadata || {});
    } catch (_) {}

    const fromRoomId = meta.from_room_id;
    const toRoomId = meta.to_room_id;
    if (!fromRoomId || !toRoomId) return false;

    const fromRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(fromRoomId);
    const toRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(toRoomId);
    if (!fromRoom || !toRoom || fromRoom.status !== 'occupied' || toRoom.status !== 'ready') return false;

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND status = ?').get(fromRoom.current_booking_id, 'active');
    if (!booking) return false;

    const transferTx = db.transaction(() => {
      // 1. Move active booking to new destination room (preserving all checkin rates and tariff!)
      db.prepare(`UPDATE bookings SET room_id = ? WHERE id = ?`).run(toRoom.id, booking.id);

      // 2. Mark destination room as occupied with this booking
      db.prepare(`UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?`).run(booking.id, toRoom.id);

      // 3. Mark source room vacated (needs cleaning)
      db.prepare(`UPDATE rooms SET status = 'needs_cleaning', current_booking_id = NULL WHERE id = ?`).run(fromRoom.id);

      // 4. Update payments to reference new room
      db.prepare(`UPDATE payments SET room_id = ? WHERE booking_id = ?`).run(toRoom.id, booking.id);

      // 5. Update room service / unpaid folio restaurant orders to new room
      db.prepare(`
        UPDATE restaurant_orders 
        SET room_id = ?, table_number = ? 
        WHERE booking_id = ? AND payment_mode = 'room_folio'
      `).run(toRoom.id, `Room ${toRoom.room_number}`, booking.id);

      // 6. Update room service / unpaid folio bar orders to new room
      db.prepare(`
        UPDATE bar_orders 
        SET room_id = ? 
        WHERE booking_id = ? AND payment_mode = 'room_folio'
      `).run(toRoom.id, booking.id);

      // 7. Update active room visitors to new room
      db.prepare(`
        UPDATE room_visitors 
        SET room_id = ? 
        WHERE booking_id = ?
      `).run(toRoom.id, booking.id);

      // 8. Record audit log entry in booking extension_logs_json
      let extLogs = [];
      try {
        extLogs = booking.extension_logs_json ? JSON.parse(booking.extension_logs_json) : [];
      } catch (e) {
        extLogs = [];
      }
      extLogs.push({
        type: 'room_transfer',
        from_room_id: fromRoom.id,
        from_room_number: fromRoom.room_number,
        from_room_type: fromRoom.room_type,
        to_room_id: toRoom.id,
        to_room_number: toRoom.room_number,
        to_room_type: toRoom.room_type,
        transferred_at: new Date().toISOString(),
        transferred_by: user || 'Admin',
        rates_preserved: true,
        reason: meta.reason || `Cross-category room shift approved by ${user} (check-in rates preserved with zero extra cost)`
      });
      db.prepare(`UPDATE bookings SET extension_logs_json = ? WHERE id = ?`).run(JSON.stringify(extLogs), booking.id);
    });

    transferTx();

    try {
      const firebaseService = require('./firebaseService');
      firebaseService.syncAllActiveRoomsFromLocal(db).catch(() => {});
    } catch (_) {}

    return true;
  } catch (err) {
    console.error('[NotificationService] executeRoomTransferFromApproval error:', err);
    return false;
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

    // If approved and this was a room_transfer, immediately execute the room shift!
    if (newStatus === 'APPROVED' && existing.type === 'room_transfer') {
      executeRoomTransferFromApproval(existing, user);
    }

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
  notifyExpense,
  notifyStoreBill,
  notifyStorePayment,
  getNotifications,
  markNotificationRead,
  getActivityFeed,
  createApprovalRequest,
  getApprovals,
  updateApprovalStatus
};

