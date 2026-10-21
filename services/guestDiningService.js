const crypto = require('crypto');
const db = require('../database');
const notificationService = require('./notificationService');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hlwmsllmqfdxfmqulrat.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

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

  // Default to official hotel web domain
  return 'https://hotelcityparksolapur.com';
}

/**
 * Generate a new secure in-room dining token for a checked-in booking
 */
function generateDiningToken({ bookingId, guestId, guestName, mobile, roomNumbers, checkinTime, approxCheckoutTime }) {
  if (!bookingId || !guestName) throw new Error('Booking ID and Guest Name are required');

  const cleanRooms = Array.isArray(roomNumbers) ? roomNumbers.join(', ') : String(roomNumbers || '');
  const cleanMobile = String(mobile || '').replace(/[^0-9]/g, '');

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
  const guestUrl = `${baseUrl}/guest-order?token=${token}`;

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

  // Sync token to Supabase Cloud asynchronously (fail-safe)
  try {
    fetch(`${SUPABASE_URL}/rest/v1/guest_dining_tokens`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        token,
        booking_id: bookingId,
        guest_name: guestName.trim(),
        mobile: cleanMobile,
        room_numbers: cleanRooms,
        checkin_time: checkinTime,
        approx_checkout_time: approxCheckoutTime,
        status: 'active',
        created_at: new Date().toISOString()
      })
    }).catch(() => null);
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
      SELECT id, order_number, batch_number, items_json, notes, subtotal, tax, grand_total, status, created_at
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
    hasPendingKitchen
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

  const orderNumber = `RS-${targetRoom}-B${batchNumber}-${Date.now().toString().slice(-4)}`;

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

  // Also ensure / update the Room Service table RS-<room> in restaurant_tables so it appears on POS
  const rsTableNumber = `RS-${targetRoom}`;
  try {
    const existingTable = db.prepare('SELECT id, active_cart_json FROM restaurant_tables WHERE table_number = ?').get(rsTableNumber);
    if (!existingTable) {
      db.prepare(`
        INSERT INTO restaurant_tables (table_number, table_type, status, active_cart_json, waiter_name, special_notes)
        VALUES (?, 'room_service', 'occupied', ?, 'Guest In-Room', ?)
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

  // Sync to Supabase Cloud asynchronously (fail-safe)
  try {
    fetch(`${SUPABASE_URL}/rest/v1/guest_inroom_orders`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: orderId,
        order_number: orderNumber,
        token,
        booking_id: guest.bookingId,
        room_numbers: guest.roomNumbers,
        guest_name: guest.name,
        guest_phone: guest.mobile,
        batch_number: batchNumber,
        items_json: JSON.stringify(cleanItems),
        notes,
        subtotal,
        tax,
        grand_total: grandTotal,
        status: 'pending_kitchen',
        created_at: new Date().toISOString()
      })
    }).catch(() => null);
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
        has_incremental_items: previousItems.length > 0
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
  const rsTableNumber = `RS-${targetRoom}`;

  try {
    const existingTable = db.prepare('SELECT id, active_cart_json, printed_cart_json, kot_count FROM restaurant_tables WHERE table_number = ?').get(rsTableNumber);
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
        SET active_cart_json = ?, printed_cart_json = ?, kot_count = kot_count + 1, status = 'occupied'
        WHERE id = ?
      `).run(JSON.stringify(updatedCart), JSON.stringify(updatedPrinted), existingTable.id);
    }
  } catch (e) {
    console.warn('[GuestDining] Notice updating restaurant table:', e.message);
  }

  // Update Supabase Cloud asynchronously (fail-safe)
  try {
    fetch(`${SUPABASE_URL}/rest/v1/guest_inroom_orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: acceptedBy,
        kot_printed: 1
      })
    }).catch(() => null);
  } catch (cloudErr) {}

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
      waiterName: 'Room Service (Guest Web)',
      notes: order.notes,
      items: items // Only the new items in this batch!
    }
  };
}

/**
 * Expire all dining tokens for a booking upon checkout
 */
function expireTokensForBooking(bookingId) {
  if (!bookingId) return;
  try {
    db.prepare("UPDATE guest_dining_tokens SET status = 'expired' WHERE booking_id = ?").run(bookingId);
    
    // Cloud sync
    fetch(`${SUPABASE_URL}/rest/v1/guest_dining_tokens?booking_id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'expired' })
    }).catch(() => null);
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

module.exports = {
  getGuestPortalBaseUrl,
  generateDiningToken,
  getGuestSession,
  submitGuestOrder,
  getPendingKitchenOrders,
  acceptKitchenOrder,
  expireTokensForBooking,
  getRoomPendingOrdersStatus
};
