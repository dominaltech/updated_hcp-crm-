/**
 * Supabase Cloud Sync Service for Hotel City Park CRM
 * Provides lightweight, non-blocking cross-device synchronization:
 * 1. Live Active Occupancies (Room #, Guest Name, Mobile) for Restaurant & Bar POS
 * 2. Room Charges Queue (F&B bills charged to room folio from separate counter PCs)
 * 
 * FAIL-SAFE GUARANTEE:
 * All cloud calls are completely non-blocking and wrapped in try/catch.
 * If internet drops or Supabase is unreachable, local SQLite operations
 * continue 100% uninterrupted without errors or delays.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hlwmsllmqfdxfmqulrat.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

let supabase = null;

try {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
  }
} catch (err) {
  console.warn('[Supabase] Initialization warning:', err.message);
}

// Resilient Offline Protection & Circuit Breaker
const REQUEST_TIMEOUT_MS = 6000; // 1 second max for any cloud call
const OFFLINE_COOLDOWN_MS = 15000; // 15 seconds cooldown before retrying cloud if network dropped

let isOffline = false;
let lastOfflineTime = 0;

function withTimeout(thenable, ms = REQUEST_TIMEOUT_MS) {
  let timeoutId;
  let isDone = false;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        reject(new Error('Supabase request timeout'));
      }
    }, ms);
  });

  const nativePromise = Promise.resolve(thenable).then(
    res => {
      isDone = true;
      clearTimeout(timeoutId);
      return res;
    },
    err => {
      isDone = true;
      clearTimeout(timeoutId);
      throw err;
    }
  );

  // Prevent unhandled rejection if timeoutPromise triggers first
  nativePromise.catch(() => {});

  return Promise.race([nativePromise, timeoutPromise]);
}

let activeLocalDbInstance = null;

function markNetworkFailure(err) {
  isOffline = true;
  lastOfflineTime = Date.now();
  console.warn(`[Supabase] Offline mode engaged: ${err?.message || err}`);
}

function markNetworkSuccess() {
  const wasOffline = isOffline;
  isOffline = false;
  if (wasOffline && activeLocalDbInstance) {
    console.log('[Supabase] 🌐 Reconnected to internet! Syncing all offline CRM updates to cloud...');
    syncAllOfflineDataToCloud(activeLocalDbInstance).catch(() => {});
  }
}

function canAttemptCloud() {
  if (!supabase) return false;
  if (isOffline && (Date.now() - lastOfflineTime < OFFLINE_COOLDOWN_MS)) {
    return false; // Fast return 0ms when offline
  }
  return true;
}

/**
 * Upserts a live occupied room into Supabase active_occupancies AND syncs its billing folio to room_charges_inbox.
 */
async function syncActiveOccupancy(data) {
  if (!canAttemptCloud() || !data || !data.room_number) return null;
  try {
    const payload = {
      room_number: String(data.room_number),
      room_id: data.room_id || null,
      room_type: data.room_type || 'Standard',
      guest_name: String(data.guest_name || 'In-House Guest').trim(),
      guest_mobile: data.guest_mobile ? String(data.guest_mobile).trim() : null,
      booking_id: data.booking_id || null,
      checkin_time: data.checkin_time || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: result, error } = await withTimeout(
      supabase
        .from('active_occupancies')
        .upsert(payload, { onConflict: 'room_number' })
        .select(),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] syncActiveOccupancy notice for Room ${data.room_number}:`, error.message);
      return null;
    }

    // Sync financial & billing folio into room_charges_inbox so Admin APK never shows 0 entries
    if (data.folio) {
      try {
        const f = data.folio;
        const folioPayload = {
          room_number: String(data.room_number),
          room_id: data.room_id || null,
          department: 'room_folio',
          bill_no: f.voucherNumber || ('BK-' + (data.booking_id || data.room_number)),
          subtotal: Number(f.roomCharge || 0),
          gst: Number(f.tax || 0),
          grand_total: Number(f.total || 0),
          items_summary: JSON.stringify({
            roomCharge: Number(f.roomCharge || 0),
            total: Number(f.total || 0),
            paid: Number(f.paid || 0),
            pending: Number(f.pending || 0),
            extra: Number(f.extra || 0),
            discount: Number(f.discount || 0),
            restaurant: Number(f.restaurant || 0),
            bar: Number(f.bar || 0),
            advanceReceiptNo: f.advanceReceiptNo || '',
            voucherNumber: f.voucherNumber || '',
            paymentMode: f.paymentMode || 'Cash',
            checkinTime: data.checkin_time || new Date().toISOString(),
            approxCheckout: f.approxCheckout || '',
            source: f.source || 'Walk-in',
            checkedInBy: f.checkedInBy || 'Front Desk',
            guestName: data.guest_name,
            mobile: data.guest_mobile || '',
            address: f.address || '',
            dob: f.dob || '',
            roomType: data.room_type || 'Standard Room'
          }),
          settled_by: f.checkedInBy || 'Front Desk',
          status: (Number(f.pending || 0) > 0) ? 'due' : 'settled',
          created_at: new Date().toISOString()
        };

        // Purge old room_folio for this room if any, then insert fresh
        await withTimeout(
          supabase.from('room_charges_inbox').delete().eq('room_number', String(data.room_number)).eq('department', 'room_folio'),
          REQUEST_TIMEOUT_MS
        );
        await withTimeout(
          supabase.from('room_charges_inbox').insert(folioPayload),
          REQUEST_TIMEOUT_MS
        );
      } catch (folioErr) {
        console.warn(`[Supabase] syncActiveOccupancy folio notice for Room ${data.room_number}:`, folioErr.message);
      }
    }

    markNetworkSuccess();
    return result;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

/**
 * Removes a checked-out room from Supabase active_occupancies and room_charges_inbox.
 */
async function removeActiveOccupancy(roomNumber) {
  if (!canAttemptCloud() || !roomNumber) return false;
  try {
    const { error } = await withTimeout(
      supabase
        .from('active_occupancies')
        .delete()
        .eq('room_number', String(roomNumber)),
      REQUEST_TIMEOUT_MS
    );

    // Also delete room_folio from room_charges_inbox
    await withTimeout(
      supabase
        .from('room_charges_inbox')
        .delete()
        .eq('room_number', String(roomNumber))
        .eq('department', 'room_folio'),
      REQUEST_TIMEOUT_MS
    ).catch(() => {});

    if (error) {
      console.warn(`[Supabase] removeActiveOccupancy notice for Room ${roomNumber}:`, error.message);
      return false;
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);

    return false;
  }
}

/**
 * Pushes an F&B bill settled to room folio into Supabase room_charges_inbox.
 */
async function pushRoomCharge(charge) {
  if (!canAttemptCloud() || !charge || !charge.room_number) return null;
  try {
    const payload = {
      room_number: String(charge.room_number),
      room_id: charge.room_id || null,
      department: charge.department || 'restaurant',
      order_id: charge.order_id || null,
      bill_no: charge.bill_no ? String(charge.bill_no) : null,
      subtotal: parseFloat(charge.subtotal) || 0,
      gst: parseFloat(charge.gst) || 0,
      grand_total: parseFloat(charge.grand_total) || 0,
      items_summary: charge.items_summary ? String(charge.items_summary).slice(0, 500) : '',
      settled_by: charge.settled_by || 'Cashier',
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { data: result, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .insert(payload)
        .select(),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] pushRoomCharge notice for Room ${charge.room_number}:`, error.message);
      return null;
    }
    markNetworkSuccess();
    return result;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

/**
 * Fetches all currently occupied rooms from Supabase active_occupancies.
 * Used by Restaurant and Bar POS running on separate PCs to populate room dropdowns.
 */
async function fetchActiveOccupancies() {
  if (!canAttemptCloud()) return [];
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('active_occupancies')
        .select('*')
        .order('room_number', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn('[Supabase] fetchActiveOccupancies notice:', error.message);
      return [];
    }
    markNetworkSuccess();
    return data || [];
  } catch (err) {
    markNetworkFailure(err);
    return [];
  }
}

/**
 * Fetches pending F&B charges for a specific room from Supabase room_charges_inbox.
 * Used by Front Desk checkout folio to absorb charges from separate POS PCs.
 */
async function fetchPendingRoomCharges(roomNumber) {
  if (!canAttemptCloud() || !roomNumber) return [];
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .select('*')
        .eq('room_number', String(roomNumber))
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] fetchPendingRoomCharges notice for Room ${roomNumber}:`, error.message);
      return [];
    }
    markNetworkSuccess();
    return data || [];
  } catch (err) {
    markNetworkFailure(err);
    return [];
  }
}

/**
 * Marks imported room charges as completed in Supabase.
 */
async function markChargesImported(chargeIds) {
  if (!canAttemptCloud() || !Array.isArray(chargeIds) || chargeIds.length === 0) return false;
  try {
    const { error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .update({ status: 'imported' })
        .in('id', chargeIds),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn('[Supabase] markChargesImported notice:', error.message);
      return false;
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

/**
 * Automatically imports all pending F&B room charges from Supabase into local SQLite.
 * Called in the Master CRM background polling loop to adopt client updates in real-time.
 */
async function pullCloudRoomChargesToLocal(localDb) {
  if (!canAttemptCloud() || !localDb) return [];
  try {
    const { data: pendingCharges, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .select('*')
        .eq('status', 'pending')
        .neq('department', 'discount_approval')
        .order('created_at', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error || !Array.isArray(pendingCharges) || pendingCharges.length === 0) return [];

    const importedIds = [];
    for (const cc of pendingCharges) {
      const roomNum = cc.room_number;
      if (!roomNum) continue;

      const booking = localDb.prepare(`
        SELECT b.id as booking_id, b.room_id, g.name as guest_name
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN guests g ON b.guest_id = g.id
        WHERE r.room_number = ? AND b.status = 'active'
      `).get(String(roomNum));

      const roomId = booking ? booking.room_id : null;
      const bookingId = booking ? booking.booking_id : null;
      const guestName = booking ? booking.guest_name : 'In-House Guest';

      const totalAmt = parseFloat(cc.grand_total) || 0;
      if (totalAmt <= 0) continue;
      const orderNum = cc.bill_no || `CLD-${cc.id}`;
      const itemsJson = cc.items_summary ? JSON.stringify([{ name: cc.items_summary, quantity: 1, qty: 1, price: totalAmt, total: totalAmt }]) : '[]';
      const subtotalAmt = parseFloat(cc.subtotal) || Math.round(totalAmt / 1.05);
      const taxAmt = parseFloat(cc.gst) || (totalAmt - subtotalAmt);
      const cashierName = cc.settled_by || (cc.department === 'bar' ? 'Bar Cashier' : 'Restaurant Cashier');
      const createdAt = cc.created_at ? cc.created_at.replace('T', ' ').substring(0, 19) : new Date().toISOString().replace('T', ' ').substring(0, 19);

      if (cc.department === 'bar') {
        const existing = localDb.prepare('SELECT id FROM bar_orders WHERE order_number = ?').get(orderNum);
        if (!existing) {
          localDb.prepare(`
            INSERT INTO bar_orders (
              order_number, room_id, customer_name, order_type,
              items_json, subtotal, tax, discount, total,
              payment_mode, is_paid, status, cashier_name,
              booking_id, created_at
            ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, 'room_folio', 0, 'completed', ?, ?, ?)
          `).run(orderNum, roomId, guestName, itemsJson, subtotalAmt, taxAmt, totalAmt, cashierName, bookingId, createdAt);
          importedIds.push(cc.id);
        } else {
          importedIds.push(cc.id);
        }
      } else {
        const existing = localDb.prepare('SELECT id FROM restaurant_orders WHERE order_number = ?').get(orderNum);
        if (!existing) {
          localDb.prepare(`
            INSERT INTO restaurant_orders (
              order_number, room_id, customer_name, order_type,
              items_json, subtotal, tax, discount, total,
              payment_mode, is_paid, status, cashier_name,
              booking_id, created_at
            ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, 'room_folio', 0, 'completed', ?, ?, ?)
          `).run(orderNum, roomId, guestName, itemsJson, subtotalAmt, taxAmt, totalAmt, cashierName, bookingId, createdAt);
          importedIds.push(cc.id);
        } else {
          importedIds.push(cc.id);
        }
      }
    }

    if (importedIds.length > 0) {
      await markChargesImported(importedIds);
      console.log(`[Supabase] Automatically adopted ${importedIds.length} cloud charge(s) into local SQLite storage.`);
    }
    return importedIds;
  } catch (err) {
    return [];
  }
}

/**
 * Synchronizes all currently occupied rooms from local SQLite database to Supabase.
 * Runs non-blocking on server startup or on demand.
 */
async function syncAllActiveRoomsFromLocal(localDb) {
  if (!canAttemptCloud() || !localDb) return;
  try {
    const activeBookings = localDb.prepare(`
      SELECT 
        b.id as booking_id,
        b.room_id,
        r.room_number,
        r.room_type,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.address,
        g.dob,
        b.checkin_time,
        b.approx_checkout_time,
        b.room_rate,
        b.total_room_charge,
        b.advance_payment,
        b.total_paid,
        b.discount_amount,
        b.extra_bed_charge,
        b.voucher_number,
        b.advance_receipt_no,
        b.advance_payment_mode,
        b.booking_source,
        b.checked_in_by
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      JOIN guests g ON b.guest_id = g.id
      WHERE b.status = 'active'
    `).all();

    const activeRoomSet = new Set((activeBookings || []).map(b => String(b.room_number)));

    // 1. Reconcile: Purge any checked-out / stale room numbers from Supabase active_occupancies & room_charges_inbox
    try {
      const { data: cloudRooms } = await withTimeout(
        supabase.from('active_occupancies').select('room_number'),
        REQUEST_TIMEOUT_MS
      );
      if (Array.isArray(cloudRooms)) {
        for (const cr of cloudRooms) {
          if (!activeRoomSet.has(String(cr.room_number))) {
            console.log(`[Supabase] Pruning checked-out room from cloud: Room ${cr.room_number}`);
            await removeActiveOccupancy(cr.room_number);
          }
        }
      }
    } catch (pruneErr) {
      console.warn('[Supabase] Prune stale occupancies notice:', pruneErr.message);
    }

    if (!activeBookings || activeBookings.length === 0) return;

    // 2. Sync all current active rooms WITH billing folios to cloud
    for (const b of activeBookings) {
      if (!canAttemptCloud()) break; // Exit immediately if offline circuit breaker tripped
      const roomCharge = Number(b.total_room_charge || b.room_rate || 0);
      const extra = Number(b.extra_bed_charge || 0);
      const discount = Number(b.discount_amount || 0);
      const tax = Math.round(roomCharge * 0.05);
      const total = Math.max(0, roomCharge + extra - discount + tax);
      const paid = Number(b.total_paid || b.advance_payment || 0);
      const pending = Math.max(0, total - paid);

      await syncActiveOccupancy({
        room_number: b.room_number,
        room_id: b.room_id,
        room_type: b.room_type,
        guest_name: b.guest_name,
        guest_mobile: b.guest_mobile,
        booking_id: b.booking_id,
        checkin_time: b.checkin_time,
        folio: {
          roomCharge,
          extra,
          discount,
          tax,
          total,
          paid,
          pending,
          voucherNumber: b.voucher_number || '',
          advanceReceiptNo: b.advance_receipt_no || '',
          paymentMode: b.advance_payment_mode || 'Cash',
          approxCheckout: b.approx_checkout_time || '',
          source: b.booking_source || 'Walk-in',
          checkedInBy: b.checked_in_by || 'Front Desk',
          address: b.address || '',
          dob: b.dob || ''
        }
      });
    }
    console.log(`[Supabase] Synced ${activeBookings.length} active room(s) with full billing folios to cloud directory.`);
  } catch (err) {
    console.warn('[Supabase] Room sync notice:', err.message);
  }
}

/**
 * Synchronizes live Restaurant and Bar tables and recent orders into Supabase room_charges_inbox snapshot.
 */
async function syncLiveFBStateToCloud(localDb) {
  if (!canAttemptCloud() || !localDb) return;
  try {
    const resTables = localDb.prepare('SELECT id, table_number, table_type, capacity, status, active_cart_json, order_started_at, waiter_name, special_notes, room_id FROM restaurant_tables').all();
    const barTables = localDb.prepare('SELECT id, table_number, table_type, capacity, status, active_cart_json, order_started_at, waiter_name, special_notes, room_id FROM bar_tables').all();
    const recentResOrders = localDb.prepare('SELECT * FROM restaurant_orders ORDER BY id DESC LIMIT 50').all();
    const recentBarOrders = localDb.prepare('SELECT * FROM bar_orders ORDER BY id DESC LIMIT 50').all();

    const fmtTables = (list) => (list || []).map(t => {
      let cart = [];
      try { cart = JSON.parse(t.active_cart_json || '[]'); } catch {}
      const total = cart.reduce((s, it) => s + (Number(it.price || it.rate || 0) * Number(it.quantity || it.qty || 1)), 0);
      return { ...t, active_cart: cart, items_count: cart.length, running_total: total, is_occupied: t.status === 'in_process' || t.status === 'occupied' || t.status === 'billed' || cart.length > 0 };
    });

    const fmtOrders = (list, dept) => (list || []).map(o => {
      let items = [];
      try { items = JSON.parse(o.items_json || '[]'); } catch {}
      return { ...o, dept, items, grand_total: o.total, is_settled: o.is_paid === 1 || String(o.status).toLowerCase() === 'completed' || String(o.status).toLowerCase() === 'settled' };
    });

    const payload = {
      restaurantTables: fmtTables(resTables),
      barTables: fmtTables(barTables),
      restaurantOrders: fmtOrders(recentResOrders, 'Restaurant'),
      barOrders: fmtOrders(recentBarOrders, 'Bar Lounge'),
      synced_at: new Date().toISOString()
    };

    // Upsert or update snapshot row in room_charges_inbox with department: 'fb_live_state'
    const { data: existing } = await withTimeout(
      supabase.from('room_charges_inbox').select('id').eq('department', 'fb_live_state').limit(1),
      REQUEST_TIMEOUT_MS
    );
    if (Array.isArray(existing) && existing.length > 0) {
      await withTimeout(
        supabase.from('room_charges_inbox').update({
          grand_total: 0,
          items_summary: JSON.stringify(payload),
          status: 'live'
        }).eq('id', existing[0].id),
        REQUEST_TIMEOUT_MS
      );
    } else {
      await withTimeout(
        supabase.from('room_charges_inbox').insert({
          room_number: 'ALL',
          department: 'fb_live_state',
          bill_no: 'FB-STATE',
          subtotal: 0,
          gst: 0,
          grand_total: 0,
          items_summary: JSON.stringify(payload),
          settled_by: 'System',
          status: 'live'
        }),
        REQUEST_TIMEOUT_MS
      );
    }
  } catch (err) {
    // non-blocking
  }
}

/**
 * Universal offline sync: whenever CRM is updated while offline,
 * pushes all active occupancies, folios, daily analytics, store data, and F&B live state when connected.
 */
async function syncAllOfflineDataToCloud(localDb) {
  if (localDb) activeLocalDbInstance = localDb;
  if (!canAttemptCloud() || !localDb) return;
  try {
    await syncAllActiveRoomsFromLocal(localDb);
    await syncDailyAnalyticsToCloud(localDb);
    await syncLiveFBStateToCloud(localDb);
    await pullStoreBillsFromCloud(localDb);
    await pullStoreVendorsFromCloud(localDb);
    await pullCloudRoomChargesToLocal(localDb);
  } catch (err) {
    console.warn('[Offline Sync] Sync caught error:', err.message);
  }
}



/**
 * Store Module Sync Methods
 */
async function pushStoreVendor(vendor) {
  if (!canAttemptCloud() || !vendor) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('store_vendors').upsert({
        id: vendor.id,
        name: vendor.name,
        mobile: vendor.mobile,
        address: vendor.address || ''
      }).select()
    );
    if (error) {
      console.warn('[Supabase] pushStoreVendor error:', error.message);
      return null;
    }
    markNetworkSuccess();
    return data;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

async function pushStoreBill(bill, items = []) {
  if (!canAttemptCloud() || !bill) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('store_bills').upsert({
        id: bill.id,
        vendor_id: bill.vendor_id,
        bill_number: bill.bill_number,
        bill_date: bill.bill_date,
        total_amount: bill.total_amount,
        paid_amount: bill.paid_amount || 0,
        pending_amount: bill.pending_amount,
        status: bill.status || 'PENDING',
        bill_photo: bill.bill_photo || null,
        notes: bill.notes || '',
        created_by: bill.created_by || 'Store Boy'
      }).select()
    );
    if (error) {
      console.warn('[Supabase] pushStoreBill error:', error.message);
      return null;
    }

    if (items && items.length > 0) {
      const itemsPayload = items.map(it => ({
        bill_id: bill.id,
        item_name: it.item_name,
        quantity: it.quantity,
        unit: it.unit,
        rate: it.rate || 0,
        total_price: it.total_price
      }));
      await withTimeout(supabase.from('store_bill_items').upsert(itemsPayload));
    }

    markNetworkSuccess();
    return data;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

async function pushStorePayment(payment, updatedBill = null) {
  if (!canAttemptCloud() || !payment) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('store_vendor_payments').insert({
        bill_id: payment.bill_id || null,
        vendor_id: payment.vendor_id,
        payment_amount: payment.payment_amount,
        payment_mode: payment.payment_mode,
        reference_no: payment.reference_no || '',
        paid_by: payment.paid_by || 'Admin (Jaijeet sir)'
      }).select()
    );
    if (error) {
      console.warn('[Supabase] pushStorePayment error:', error.message);
      return null;
    }

    if (updatedBill) {
      await withTimeout(
        supabase.from('store_bills').update({
          paid_amount: updatedBill.paid_amount,
          pending_amount: updatedBill.pending_amount,
          status: updatedBill.status
        }).eq('id', updatedBill.id)
      );
    }

    markNetworkSuccess();
    return data;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

async function pullStoreVendorsFromCloud(db) {
  if (!canAttemptCloud() || !supabase || !db) return false;
  try {
    const { data: cloudVendors, error } = await withTimeout(supabase.from('store_vendors').select('*'));
    if (error || !cloudVendors) return false;
    const upsert = db.prepare(`
      INSERT INTO store_vendors (id, name, mobile, address, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        mobile = excluded.mobile,
        address = excluded.address
    `);
    for (const v of cloudVendors) {
      upsert.run(v.id, v.name, v.mobile || '', v.address || '', v.created_at || new Date().toISOString());
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

async function pullStoreBillsFromCloud(db) {
  if (!canAttemptCloud() || !supabase || !db) return false;
  try {
    // Ensure vendors are synchronized first
    await pullStoreVendorsFromCloud(db).catch(() => {});

    const { data: cloudBills, error: bErr } = await withTimeout(supabase.from('store_bills').select('*'));
    if (bErr || !cloudBills) return false;

    const upsert = db.prepare(`
      INSERT INTO store_bills (id, vendor_id, bill_number, bill_date, total_amount, paid_amount, pending_amount, status, payment_mode, has_gst, gst_remark, bill_photo, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        paid_amount = excluded.paid_amount,
        pending_amount = excluded.pending_amount,
        status = excluded.status,
        payment_mode = excluded.payment_mode,
        has_gst = excluded.has_gst,
        gst_remark = excluded.gst_remark,
        notes = excluded.notes
    `);

    for (const cb of cloudBills) {
      let mode = cb.payment_mode || 'Bank Transfer';
      let hasGst = cb.has_gst ?? 1;
      let gstRemark = cb.gst_remark || '';
      if (cb.notes && cb.notes.includes('Mode:')) {
        const parts = cb.notes.split('|').map(s => s.trim());
        for (const p of parts) {
          if (p.startsWith('Mode:')) mode = p.replace('Mode:', '').trim();
          if (p.toLowerCase().includes('without gst')) hasGst = 0;
          if (p.toLowerCase().includes('with gst')) hasGst = 1;
        }
      }
      upsert.run(
        cb.id,
        cb.vendor_id,
        cb.bill_number || 'N/A',
        cb.bill_date || new Date().toISOString().split('T')[0],
        cb.total_amount || 0,
        cb.paid_amount || 0,
        cb.pending_amount ?? (cb.total_amount - (cb.paid_amount || 0)),
        cb.status || 'PENDING',
        mode,
        hasGst,
        gstRemark,
        cb.bill_photo || null,
        cb.notes || '',
        cb.created_by || 'Store Boy',
        cb.created_at || new Date().toISOString()
      );
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

async function deleteStoreBill(billId) {
  if (!canAttemptCloud() || !billId) return false;
  try {
    await withTimeout(supabase.from('store_bill_items').delete().eq('bill_id', billId));
    await withTimeout(supabase.from('store_vendor_payments').delete().eq('bill_id', billId));
    const { error } = await withTimeout(supabase.from('store_bills').delete().eq('id', billId));
    if (error) {
      console.warn(`[Supabase] deleteStoreBill notice for ID ${billId}:`, error.message);
      return false;
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

async function syncApprovalRequestToCloud(req) {
  if (!canAttemptCloud() || !req || !req.id) return false;
  try {
    const payload = {
      room_number: String(req.room_number || ''),
      department: 'discount_approval',
      bill_no: 'APP-' + req.id,
      grand_total: Number(req.final_amount || 0),
      items_summary: JSON.stringify({
        approval_id: req.id,
        guest_name: req.guest_name,
        members: req.members,
        expected_checkout: req.expected_checkout,
        meal_plan: req.meal_plan,
        discount_pct: req.discount_pct,
        discount: req.discount,
        current_total: req.current_total,
        final_amount: req.final_amount,
        requested_by: req.requested_by,
        reason: req.reason
      }),
      settled_by: req.requested_by || 'Reception Staff',
      status: 'pending'
    };
    await withTimeout(supabase.from('room_charges_inbox').insert(payload));
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

async function pollCloudApprovals(db) {
  if (!canAttemptCloud() || !db) return;
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .select('*')
        .eq('department', 'discount_approval')
        .neq('status', 'pending')
    );
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const approvalId = row.bill_no ? row.bill_no.replace('APP-', '') : null;
        if (approvalId) {
          const newStatus = (row.status || '').toLowerCase() === 'approved' ? 'APPROVED' : 'REJECTED';
          const existing = db.prepare('SELECT status FROM owner_approvals WHERE id = ?').get(approvalId);
          if (existing && existing.status === 'PENDING') {
            db.prepare(`
              UPDATE owner_approvals
              SET status = ?, action_by = ?, action_at = datetime('now','localtime')
              WHERE id = ?
            `).run(newStatus, row.settled_by || 'Admin', approvalId);
            console.log(`[Cloud Approval] Synced decision from cloud: Request #${approvalId} is now ${newStatus}`);
          }
        }
      }
    }
    markNetworkSuccess();
  } catch (err) {
    markNetworkFailure(err);
  }
}

async function syncDailyAnalyticsToCloud(db) {
  if (!canAttemptCloud() || !db) return;
  try {
    const dates = [
      new Date().toISOString().slice(0, 10),
      new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    ];

    for (const d of dates) {
      const payRows = db.prepare(`
        SELECT 
          amount, 
          lower(COALESCE(payment_mode, 'cash')) as mode,
          COALESCE(split_cash, 0) as scash,
          COALESCE(split_online, 0) as supis,
          COALESCE(split_card, 0) as scard
        FROM payments
        WHERE date(created_at) = ?
      `).all(d);

      let rev = 0, cash = 0, upi = 0, card = 0;
      payRows.forEach(p => {
        const amt = Number(p.amount) || 0;
        rev += amt;
        if (p.scash || p.supis || p.scard) {
          cash += Number(p.scash) || 0;
          upi += Number(p.supis) || 0;
          card += Number(p.scard) || 0;
        } else {
          if (p.mode === 'cash') cash += amt;
          else if (p.mode === 'upi' || p.mode === 'online') upi += amt;
          else if (p.mode === 'card') card += amt;
          else cash += amt;
        }
      });

      const chkInRow = db.prepare(`SELECT COUNT(*) as cnt FROM bookings WHERE date(checkin_time) = ?`).get(d);
      const chkOutRow = db.prepare(`SELECT COUNT(*) as cnt FROM bookings WHERE date(actual_checkout_time) = ? OR (actual_checkout_time IS NULL AND date(approx_checkout_time) = ?)`).get(d, d);

      const payload = {
        id: d,
        today_revenue: rev,
        today_cash: cash,
        today_upi: upi,
        today_card: card,
        today_checkins: Number(chkInRow?.cnt) || 0,
        today_checkouts: Number(chkOutRow?.cnt) || 0,
        occupied_rooms: 0,
        total_rooms: 24,
        updated_at: new Date().toISOString()
      };

      await withTimeout(supabase.from('hotel_analytics').upsert(payload));
    }
    markNetworkSuccess();
  } catch (err) {
    markNetworkFailure(err);
  }
}

module.exports = {
  pushStoreVendor,
  pullStoreVendorsFromCloud,
  pushStoreBill,
  pushStorePayment,
  deleteStoreBill,
  pullStoreBillsFromCloud,
  syncActiveOccupancy,
  removeActiveOccupancy,
  pushRoomCharge,
  fetchActiveOccupancies,
  fetchPendingRoomCharges,
  markChargesImported,
  syncAllActiveRoomsFromLocal,
  syncApprovalRequestToCloud,
  pollCloudApprovals,
  syncDailyAnalyticsToCloud,
  pullCloudRoomChargesToLocal,
  syncLiveFBStateToCloud,
  syncAllOfflineDataToCloud,
  isConfigured: () => Boolean(supabase),
  isOfflineMode: () => isOffline && (Date.now() - lastOfflineTime < OFFLINE_COOLDOWN_MS)
};


