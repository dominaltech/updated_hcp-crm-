const crypto = require('crypto');
const db = require('../database');
const notificationService = require('./notificationService');


/**
 * Guest Dining & In-Room Ordering Service for Hotel City Park CRM
 * Handles:
 * 1. Secure token generation & lifecycle (active during stay, instantly expired upon checkout)
 * 2. WhatsApp automated invite link formulation
 * 3. In-room dining guest ordering with batching (Batch #1, Batch #2 for extra items)
 * 4. Multi-room group booking support
 * 5. Real-time push notification dispatch to Admin APK
 * 6. Cloud bridge synchronization with Supabase
 */

// Helper to get configured or default host domain for guest links
function getGuestPortalBaseUrl() {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'guest_portal_url'").get();
    if (row && row.value && row.value.trim().startsWith('http')) {
      return row.value.trim().replace(/\/$/, '');
    }
  } catch (e) {}

  // Check if CLOUD_TUNNEL_URL or custom domain is configured in environment
  if (process.env.GUEST_PORTAL_URL) {
    return process.env.GUEST_PORTAL_URL.trim().replace(/\/$/, '');
  }

  // Default to official Vercel deployment domain
  return 'https://hcprso.vercel.app';
}

/**
 * Retrieve configured restaurant operating and closing hours from system_settings
 */
function getRestaurantTimings() {
  try {
    const rows = db.prepare("SELECT key, value FROM system_settings WHERE key IN ('restaurant_close_start', 'restaurant_close_end', 'restaurant_order_start', 'restaurant_order_end', 'restaurant_prep_time')").all();
    const map = {
      closeStart: '22:55',
      closeEnd: '08:00',
      orderStart: '08:00',
      orderEnd: '21:30',
      prepTime: '25-45 min'
    };
    rows.forEach(r => {
      if (r.key === 'restaurant_close_start') map.closeStart = r.value;
      if (r.key === 'restaurant_close_end') map.closeEnd = r.value;
      if (r.key === 'restaurant_order_start') map.orderStart = r.value;
      if (r.key === 'restaurant_order_end') map.orderEnd = r.value;
      if (r.key === 'restaurant_prep_time') map.prepTime = r.value;
    });

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = map.closeStart.split(':').map(Number);
    const [eH, eM] = map.closeEnd.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;
    const isClosedNow = startMins > endMins
      ? (currentMins >= startMins || currentMins < endMins)
      : (currentMins >= startMins && currentMins < endMins);

    return { ...map, isClosedNow };
  } catch (_) {
    return {
      closeStart: '22:55',
      closeEnd: '08:00',
      orderStart: '08:00',
      orderEnd: '21:30',
      prepTime: '25-45 min',
      isClosedNow: false
    };
  }
}

/**
 * Generate a new secure in-room dining token for a checked-in booking
 */
function generateDiningToken({ bookingId, guestId, guestName, mobile, roomNumbers, checkinTime, approxCheckoutTime }) {
  if (!bookingId || !guestName) throw new Error('Booking ID and Guest Name are required');

  const cleanRooms = Array.isArray(roomNumbers) ? roomNumbers.join(', ') : String(roomNumbers || '');
  const cleanMobile = String(mobile || '').replace(/[^0-9]/g, '');

  // Expire any existing active token for this booking before creating a fresh one
  try {
    db.prepare("UPDATE guest_dining_tokens SET status = 'expired' WHERE booking_id = ? AND status = 'active'").run(bookingId);
  } catch (e) {}

  // Generate 24-character cryptographically secure token
  const token = 'hcp_' + crypto.randomBytes(12).toString('hex');

  // Insert into SQLite database
  db.prepare(`
    INSERT INTO guest_dining_tokens (
      token, booking_id, guest_id, guest_name, mobile, room_numbers, checkin_time, approx_checkout_time, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(
    token,
    bookingId,
    guestId || null,
    guestName.trim(),
    cleanMobile,
    cleanRooms,
    checkinTime || new Date().toISOString(),
    approxCheckoutTime || null
  );

  const baseUrl = getGuestPortalBaseUrl();
  const guestUrl = `${baseUrl}/?token=${token}`;

  // Formulate WhatsApp Welcome & In-Room Dining Message
  const phoneWithCountry = cleanMobile.length === 10 ? '91' + cleanMobile : cleanMobile;
  const whatsappText = 
    `🏨 *HOTEL CITY PARK, SOLAPUR*\n` +
    `*Char Hutatma Chowk, Murarji Peth*\n\n` +
    `Dear *${guestName.trim()}*,\n` +
    `Welcome to Hotel City Park! We are delighted to have you stay with us.\n\n` +
    `🚪 *Room(s):* ${cleanRooms}\n` +
    `🛎️ *In-Room Food & Beverages:*\n` +
    `You can browse our complete restaurant menu and order food directly to your room without calling reception:\n\n` +
    `👉 *Order Here:* ${guestUrl}\n\n` +
    `Just select your dishes and tap *"Give Order"*. Our kitchen will prepare and deliver fresh to your room.\n\n` +
    `Have a wonderful stay!`;

  const whatsappUrl = phoneWithCountry ? `https://api.whatsapp.com/send?phone=${phoneWithCountry}&text=${encodeURIComponent(whatsappText)}` : null;

  // Sync token to Firebase Cloud asynchronously (fail-safe)
  try {
    const firebaseService = require('./firebaseService');
    firebaseService.syncWaiterDataToCloud(db).catch(() => {});
  } catch (err) {}

  return {
    token,
    url: guestUrl,
    whatsappText,
    whatsappUrl,
    roomNumbers: cleanRooms,
    guestName
  };
}

/**
 * Retrieve guest session by token.
 * If booking has checked out, automatically mark token expired and return expired flag.
 */
function getGuestSession(token) {
  if (!token) return { success: false, error: 'Token is required' };

  const tokenRecord = db.prepare('SELECT * FROM guest_dining_tokens WHERE token = ?').get(token);
  if (!tokenRecord) {
    return { success: false, expired: true, notFound: true, message: 'Invalid dining link' };
  }

  // Check booking status in bookings table
  const booking = db.prepare('SELECT id, status, room_id, checkin_time, approx_checkout_time FROM bookings WHERE id = ?').get(tokenRecord.booking_id);
  
  if (!booking || booking.status !== 'active' || tokenRecord.status !== 'active') {
    // If not active, ensure token status in DB is expired
    if (tokenRecord.status !== 'expired') {
      try {
        db.prepare("UPDATE guest_dining_tokens SET status = 'expired' WHERE token = ?").run(token);
      } catch (e) {}
    }
    return {
      success: false,
      expired: true,
      guestName: tokenRecord.guest_name,
      roomNumbers: tokenRecord.room_numbers,
      checkinTime: tokenRecord.checkin_time,
      approxCheckoutTime: tokenRecord.approx_checkout_time,
      message: 'Your stay has concluded. In-room dining session is now closed.'
    };
  }

  // Fetch available restaurant categories and menu items
  let categories = [];
  try {
    categories = db.prepare('SELECT id, name FROM restaurant_categories ORDER BY sort_order ASC, name ASC').all();
  } catch (e) { categories = []; }

  let dishes = [];
  try {
    dishes = db.prepare(`
      SELECT id, department, category, name, price, description, is_available, shortcode
      FROM menu_items 
      WHERE department = 'restaurant' AND (is_available = 1 OR is_available IS NULL)
      ORDER BY category ASC, name ASC
    `).all();
  } catch (e) { dishes = []; }

  // Fetch order history for this guest session
  let orderHistory = [];
  try {
    orderHistory = db.prepare(`
      SELECT id, order_number, batch_number, items_json, notes, subtotal, tax, grand_total, status, rejection_reason, cancelled_at, created_at
      FROM guest_inroom_orders
      WHERE token = ?
      ORDER BY batch_number ASC, created_at ASC
    `).all(token);

    orderHistory = orderHistory.map(oh => {
      let parsed = [];
      try { parsed = JSON.parse(oh.items_json); } catch (e) { parsed = []; }
      return { ...oh, items: parsed };
    });
  } catch (e) { orderHistory = []; }

  // Check if there are any pending orders waiting for kitchen acceptance
  const hasPendingKitchen = orderHistory.some(o => o.status === 'pending_kitchen');
  const restaurantTimings = getRestaurantTimings();

  return {
    success: true,
    expired: false,
    guest: {
      name: tokenRecord.guest_name,
      mobile: tokenRecord.mobile,
      roomNumbers: tokenRecord.room_numbers,
      checkinTime: tokenRecord.checkin_time,
      approxCheckoutTime: tokenRecord.approx_checkout_time,
      bookingId: tokenRecord.booking_id
    },
    categories,
    menu: dishes,
    orderHistory,
    hasPendingKitchen,
    restaurantTimings
  };
}

/**
 * Submit in-room dining food order from guest mobile interface
 */
async function submitGuestOrder({ token, items, notes = '', selectedRoom = '' }) {
  if (!token) throw new Error('Valid guest token is required');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Please select at least one item');

  // Verify active session
  const session = getGuestSession(token);
  if (!session || !session.success || session.expired) {
    throw new Error(session.message || 'Dining session has expired or is invalid');
  }

  const { guest } = session;
  const targetRoom = selectedRoom || guest.roomNumbers.split(',')[0].trim();

  // Validate items and calculate totals
  let subtotal = 0;
  const cleanItems = items.map(it => {
    const qty = Math.max(1, parseInt(it.quantity || it.qty || 1));
    const price = Math.max(0, parseFloat(it.price || 0));
    const lineTotal = price * qty;
    subtotal += lineTotal;
    return {
      id: it.id,
      name: (it.name || 'Food Item').trim(),
      category: it.category || '',
      price,
      quantity: qty,
      total: lineTotal,
      is_veg: it.is_veg !== undefined ? it.is_veg : 1,
      notes: it.notes || ''
    };
  });

  const tax = Math.round(subtotal * 0.05 * 100) / 100; // 5% GST
  const grandTotal = Math.round((subtotal + tax) * 100) / 100;

  // Determine batch number for incremental orders (Batch 1, Batch 2, etc.)
  let batchNumber = 1;
  try {
    const countRow = db.prepare('SELECT COUNT(*) as count FROM guest_inroom_orders WHERE token = ?').get(token);
    batchNumber = (countRow?.count || 0) + 1;
  } catch (e) {}

  const orderNumber = `RSCW-${targetRoom}-B${batchNumber}-${Date.now().toString().slice(-4)}`;

  // Save to SQLite
  const stmt = db.prepare(`
    INSERT INTO guest_inroom_orders (
      order_number, token, booking_id, room_numbers, guest_name, guest_phone,
      batch_number, items_json, notes, subtotal, tax, grand_total, status, kot_printed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_kitchen', 0)
  `);

  const result = stmt.run(
    orderNumber,
    token,
    guest.bookingId,
    guest.roomNumbers,
    guest.name,
    guest.mobile,
    batchNumber,
    JSON.stringify(cleanItems),
    notes.trim(),
    subtotal,
    tax,
    grandTotal
  );

  const orderId = result.lastInsertRowid;

  // Also ensure / update the Room Service table RSCW-<room> in restaurant_tables so it appears on POS
  const rsTableNumber = `RSCW-${targetRoom}`;
  try {
    const existingTable = db.prepare('SELECT id, active_cart_json FROM restaurant_tables WHERE table_number IN (?, ?)').get(rsTableNumber, `RS-${targetRoom}`);
    if (!existingTable) {
      db.prepare(`
        INSERT INTO restaurant_tables (table_number, table_type, status, active_cart_json, waiter_name, special_notes)
        VALUES (?, 'room_service', 'occupied', ?, 'Customer Web Link [RSCW]', ?)
      `).run(rsTableNumber, JSON.stringify(cleanItems), notes || `Guest Order Batch #${batchNumber}`);
    }
  } catch (e) {
    console.warn('[GuestDining] Error syncing RS table:', e.message);
  }

  // Dispatch Push Notification to Admin APK
  try {
    await notificationService.sendPushNotification({
      title: `🛎️ In-Room Food Order - Room ${targetRoom}`,
      body: `${guest.name} ordered ${cleanItems.length} items (₹${grandTotal}). Awaiting kitchen acceptance.`,
      type: 'guest_room_order',
      data: {
        orderId,
        orderNumber,
        batchNumber,
        roomNumber: targetRoom,
        guestName: guest.name,
        grandTotal,
        itemsCount: cleanItems.length
      }
    });
  } catch (notifErr) {
    console.warn('[GuestDining] Error dispatching push to Admin APK:', notifErr.message);
  }

  // Sync to Firebase Cloud asynchronously (fail-safe)
  try {
    const firebaseService = require('./firebaseService');
    const firstRoom = String(guest.roomNumbers).split(',')[0].trim();
    firebaseService.pushRoomCharge({
      room_number: firstRoom,
      department: 'waiter_kot_order',
      bill_no: orderNumber,
      subtotal,
      gst: tax,
      grand_total: grandTotal,
      settled_by: guest.name || 'In-House Guest',
      items_summary: JSON.stringify({
        order_type: 'room_service',
        source: 'guest_inroom_mobile',
        order_source: 'web_link',
        customer_name: guest.name || `Room ${guest.roomNumbers}`,
        token: token || '',
        notes: (notes || '').trim(),
        items: cleanItems
      }),
      status: 'pending'
    }).catch(() => {});
  } catch (cloudErr) {}

  return {
    success: true,
    orderId,
    orderNumber,
    batchNumber,
    roomNumber: targetRoom,
    subtotal,
    tax,
    grandTotal,
    items: cleanItems
  };
}

/**
 * Fetch all pending in-room food orders for Restaurant POS acceptance popup.
 * Groups by room/booking and includes:
 * - previous_items (from earlier accepted batches in GREY)
 * - new_items (from current pending batch in COLOR)
 */
function getPendingKitchenOrders() {
  try {
    const pendingOrders = db.prepare(`
      SELECT * FROM guest_inroom_orders 
      WHERE status = 'pending_kitchen'
      ORDER BY created_at ASC
    `).all();

    const timings = getRestaurantTimings();

    return pendingOrders.map(order => {
      let currentItems = [];
      try { currentItems = JSON.parse(order.items_json); } catch (e) { currentItems = []; }

      // Fetch any earlier accepted batches for the same token to show as previous items in grey
      let previousBatches = [];
      try {
        previousBatches = db.prepare(`
          SELECT id, batch_number, items_json, created_at
          FROM guest_inroom_orders
          WHERE token = ? AND id != ? AND status = 'accepted'
          ORDER BY batch_number ASC
        `).all(order.token, order.id);
      } catch (e) { previousBatches = []; }

      let previousItems = [];
      previousBatches.forEach(pb => {
        try {
          const items = JSON.parse(pb.items_json);
          previousItems.push(...items.map(it => ({ ...it, batch_number: pb.batch_number })));
        } catch (e) {}
      });

      return {
        ...order,
        items: currentItems,
        previous_items: previousItems,
        new_items: currentItems,
        has_incremental_items: previousItems.length > 0,
        is_closed_hours: timings.isClosedNow,
        restaurant_timings: timings
      };
    });
  } catch (err) {
    console.error('[GuestDining] Error fetching pending kitchen orders:', err.message);
    return [];
  }
}

/**
 * Accept in-room dining order on Restaurant CRM:
 * 1. Stops the beep sound
 * 2. Marks the order as 'accepted'
 * 3. Appends new items to the Room Service Table & Folio
 * 4. Returns KOT slip payload for ONLY THE NEW ITEMS
 */
function acceptKitchenOrder(orderId, acceptedBy = 'Restaurant Counter') {
  if (!orderId) throw new Error('Order ID is required');

  const order = db.prepare('SELECT * FROM guest_inroom_orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Order not found');
  if (order.status === 'accepted') {
    return { success: true, message: 'Order already accepted', alreadyAccepted: true };
  }

  let items = [];
  try { items = JSON.parse(order.items_json); } catch (e) { items = []; }

  // Update order status in SQLite
  db.prepare(`
    UPDATE guest_inroom_orders 
    SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, accepted_by = ?, kot_printed = 1
    WHERE id = ?
  `).run(acceptedBy, orderId);

  // Sync to Room Service Table active cart
  const targetRoom = order.room_numbers.split(',')[0].trim();
  const rsTableNumber = (order.order_number && String(order.order_number).startsWith('RSCW-')) ? `RSCW-${targetRoom}` : `RS-${targetRoom}`;

  try {
    const existingTable = db.prepare('SELECT id, active_cart_json, printed_cart_json, kot_count FROM restaurant_tables WHERE table_number IN (?, ?)').get(rsTableNumber, `RS-${targetRoom}`);
    if (existingTable) {
      let currentCart = [];
      try { currentCart = JSON.parse(existingTable.active_cart_json || '[]'); } catch (e) {}
      let printedCart = [];
      try { printedCart = JSON.parse(existingTable.printed_cart_json || '[]'); } catch (e) {}

      // Append new items
      const updatedCart = [...currentCart, ...items];
      const updatedPrinted = [...printedCart, ...items];

      db.prepare(`
        UPDATE restaurant_tables 
        SET active_cart_json = ?, printed_cart_json = ?, kot_count = kot_count + 1, status = 'occupied', waiter_name = 'Customer Web Link [RSCW]'
        WHERE id = ?
      `).run(JSON.stringify(updatedCart), JSON.stringify(updatedPrinted), existingTable.id);
    } else {
      db.prepare(`
        INSERT INTO restaurant_tables (table_number, table_type, status, active_cart_json, printed_cart_json, kot_count, waiter_name, special_notes, order_started_at)
        VALUES (?, 'room_service', 'occupied', ?, ?, 1, 'Customer Web Link [RSCW]', ?, datetime('now', 'localtime'))
      `).run(rsTableNumber, JSON.stringify(items), JSON.stringify(items), order.notes || `Room ${targetRoom} (${order.guest_name || 'Guest'})`);
    }

    // Immediately push updated tables snapshot to Supabase so Waiter APK sees this room service order!
    try {
      const firebaseService = require('./firebaseService');
      firebaseService.syncWaiterDataToCloud(db).catch(() => {});
    } catch (_) {}
  } catch (e) {
    console.warn('[GuestDining] Notice updating restaurant table:', e.message);
  }

  // Return KOT print payload: ONLY NEW ITEMS to be printed!
  return {
    success: true,
    orderId,
    orderNumber: order.order_number,
    roomNumber: targetRoom,
    guestName: order.guest_name,
    batchNumber: order.batch_number,
    kotPayload: {
      kotNumber: order.batch_number,
      tokenNumber: order.batch_number,
      tableNumber: rsTableNumber,
      waiterName: 'Customer Web Link [RSCW]',
      notes: order.notes,
      items: items // Only the new items in this batch!
    }
  };
}

/**
 * Cancel / Reject in-room dining food order from Restaurant POS
 * Used when order arrives during closing hours or cannot be fulfilled.
 */
function cancelKitchenOrder(orderId, reason = 'restaurant_closed', cancelledBy = 'Kitchen Staff') {
  if (!orderId) throw new Error('Order ID is required');

  const order = db.prepare('SELECT * FROM guest_inroom_orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Order not found');

  // Update SQLite
  db.prepare(`
    UPDATE guest_inroom_orders 
    SET status = 'cancelled', rejection_reason = ?, cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?
    WHERE id = ?
  `).run(reason, cancelledBy, orderId);

  // If a transient table RSCW-<room> or RS-<room> exists without other items, clean it up
  const targetRoom = String(order.room_numbers || '').split(',')[0].trim();
  try {
    const tRows = db.prepare("SELECT id, active_cart_json FROM restaurant_tables WHERE table_number IN (?, ?)").all(`RSCW-${targetRoom}`, `RS-${targetRoom}`);
    tRows.forEach(t => {
      let cart = [];
      try { cart = JSON.parse(t.active_cart_json || '[]'); } catch (_) {}
      if (cart.length === 0 || cart.length <= (Array.isArray(order.items_json) ? order.items_json.length : 5)) {
        db.prepare("DELETE FROM restaurant_tables WHERE id = ?").run(t.id);
      }
    });
  } catch (_) {}

  // Sync cancellation to Firebase Cloud asynchronously
  try {
    const firebaseService = require('./firebaseService');
    if (typeof firebaseService.deleteCloudRoomCharge === 'function') {
      firebaseService.deleteCloudRoomCharge(order.order_number).catch(() => {});
    }
  } catch (_) {}

  return {
    success: true,
    orderId,
    orderNumber: order.order_number,
    roomNumber: targetRoom,
    status: 'cancelled',
    rejection_reason: reason
  };
}

/**
 * Expire all dining tokens for a booking upon checkout
 */
function expireTokensForBooking(bookingId) {
  if (!bookingId) return;
  try {
    db.prepare("UPDATE guest_dining_tokens SET status = 'expired' WHERE booking_id = ?").run(bookingId);
    
    // Cloud sync via Firebase
    const firebaseService = require('./firebaseService');
    firebaseService.syncWaiterDataToCloud(db).catch(() => {});
  } catch (err) {
    console.warn('[GuestDining] Error expiring tokens for booking:', err.message);
  }
}

/**
 * Check if a room currently has pending in-room food orders (for Yellow Badge on RoomCard)
 */
function getRoomPendingOrdersStatus() {
  try {
    const rows = db.prepare(`
      SELECT room_numbers, COUNT(*) as count 
      FROM guest_inroom_orders 
      WHERE status = 'pending_kitchen'
      GROUP BY room_numbers
    `).all();

    const map = {};
    rows.forEach(r => {
      const rooms = String(r.room_numbers || '').split(',').map(s => s.trim());
      rooms.forEach(rm => {
        map[rm] = (map[rm] || 0) + (r.count || 0);
      });
    });
    return map;
  } catch (err) {
    return {};
  }
}

/**
 * Retrieve active dining token & details for a booking (e.g. for Room Folio display)
 */
function getActiveDiningToken(bookingId) {
  if (!bookingId) return { hasActiveLink: false };
  try {
    const row = db.prepare(`
      SELECT * FROM guest_dining_tokens 
      WHERE booking_id = ? AND status = 'active'
      ORDER BY id DESC LIMIT 1
    `).get(bookingId);

    if (!row) {
      return { hasActiveLink: false };
    }

    const baseUrl = getGuestPortalBaseUrl();
    const guestUrl = `${baseUrl}/?token=${row.token}`;
    const cleanMobile = String(row.mobile || '').replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanMobile.length === 10 ? '91' + cleanMobile : cleanMobile;

    const whatsappText = 
      `🏨 *HOTEL CITY PARK, SOLAPUR*\n` +
      `*Char Hutatma Chowk, Murarji Peth*\n\n` +
      `Dear *${row.guest_name ? row.guest_name.trim() : 'Guest'}*,\n` +
      `Welcome to Hotel City Park! We are delighted to have you stay with us.\n\n` +
      `🚪 *Room(s):* ${row.room_numbers || ''}\n` +
      `🛎️ *In-Room Food & Beverages:*\n` +
      `You can browse our complete restaurant menu and order food directly to your room without calling reception:\n\n` +
      `👉 *Order Here:* ${guestUrl}\n\n` +
      `Just select your dishes and tap *"Give Order"*. Our kitchen will prepare and deliver fresh to your room.\n\n` +
      `Have a wonderful stay!`;

    const whatsappUrl = phoneWithCountry ? `https://api.whatsapp.com/send?phone=${phoneWithCountry}&text=${encodeURIComponent(whatsappText)}` : null;

    return {
      hasActiveLink: true,
      token: row.token,
      url: guestUrl,
      whatsappUrl,
      whatsappText,
      guestName: row.guest_name,
      mobile: row.mobile,
      roomNumbers: row.room_numbers,
      createdAt: row.created_at,
      status: 'active'
    };
  } catch (err) {
    console.warn('[GuestDining] Error getting active dining token:', err.message);
    return { hasActiveLink: false };
  }
}

/**
 * Delete / revoke active dining token for a booking
 */
function deleteDiningToken(bookingId) {
  if (!bookingId) return { success: false, error: 'Booking ID required' };
  try {
    db.prepare("UPDATE guest_dining_tokens SET status = 'expired' WHERE booking_id = ?").run(bookingId);
    
    // Cloud sync via Firebase
    const firebaseService = require('./firebaseService');
    firebaseService.syncWaiterDataToCloud(db).catch(() => {});

    return { success: true, message: 'Dining link deleted/revoked successfully' };
  } catch (err) {
    console.error('[GuestDining] Error deleting dining token:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getGuestPortalBaseUrl,
  getRestaurantTimings,
  generateDiningToken,
  getActiveDiningToken,
  deleteDiningToken,
  getGuestSession,
  submitGuestOrder,
  getPendingKitchenOrders,
  acceptKitchenOrder,
  cancelKitchenOrder,
  expireTokensForBooking,
  getRoomPendingOrdersStatus
};
