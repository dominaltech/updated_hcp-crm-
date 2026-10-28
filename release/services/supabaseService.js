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

// Supabase decommissioned: all cloud operations redirect to Firebase Firestore
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

let supabase = null;

// Resilient Offline Protection & Circuit Breaker
const REQUEST_TIMEOUT_MS = 8000; // 8 seconds max for any cloud call
const OFFLINE_COOLDOWN_MS = 30000; // 30 seconds cooldown before retrying cloud if network dropped
const FAILURE_THRESHOLD = 2; // Require 2 consecutive failures before engaging offline mode

let consecutiveFailures = 0;
let isOffline = false;
let lastOfflineTime = 0;
let lastFullOfflineSyncTime = 0;
let isSyncingOffline = false;
let offlineSyncTimer = null;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

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
  const errMsg = String(err?.message || err || '');
  consecutiveFailures++;
  const isHardCloudError = errMsg.includes('503') || errMsg.includes('schema cache') || errMsg.includes('budget') || errMsg.includes('timeout');
  if (consecutiveFailures >= FAILURE_THRESHOLD || isHardCloudError) {
    if (!isOffline) {
      isOffline = true;
      lastOfflineTime = Date.now();
      console.warn(`[Supabase] ⚠️ Offline mode engaged (${errMsg})`);
    }
  }
}

function markNetworkSuccess() {
  const wasOffline = isOffline;
  consecutiveFailures = 0;
  isOffline = false;

  // Debounced reconnect: do NOT blast 50 queries immediately upon first recovery!
  // Wait 15 seconds for network to stabilize, and ensure at least 10 minutes elapsed since last heavy sync.
  if (wasOffline && activeLocalDbInstance) {
    if (offlineSyncTimer) clearTimeout(offlineSyncTimer);
    offlineSyncTimer = setTimeout(() => {
      offlineSyncTimer = null;
      const now = Date.now();
      if (now - lastFullOfflineSyncTime >= 10 * 60 * 1000) {
        console.log('[Supabase] 🌐 Network stable! Initiating paced offline sync to cloud...');
        syncAllOfflineDataToCloud(activeLocalDbInstance).catch(() => {});
      }
    }, 15000);
  }
}

function isSupabaseSyncEnabled() {
  return false; // Decommissioned per user directive: all cloud sync consolidated onto Firebase
}

function canAttemptCloud() {
  if (!supabase) return false;
  if (!isSupabaseSyncEnabled()) return false;
  if (isOffline && (Date.now() - lastOfflineTime < OFFLINE_COOLDOWN_MS)) {
    return false; // Fast return 0ms when offline
  }
  return true;
}

function cleanRoomNumber(val) {
  return String(val || '')
    .replace(/^Room\s*#?/i, '')
    .replace(/\b(Bed\s*room|Bedroom|Room)\b/gi, '')
    .trim();
}

function toIstIso(val) {
  if (!val) return new Date().toISOString();
  const s = String(val).trim().replace(' ', 'T');
  if (s.includes('+') || s.endsWith('Z') || /-\d{2}:\d{2}$/.test(s)) {
    return s;
  }
  const full = s.length === 16 ? s + ':00' : s;
  return full + '+05:30';
}

/**
 * Upserts a live occupied room into Supabase active_occupancies AND syncs its billing folio to room_charges_inbox.
 */
async function syncActiveOccupancy(data) {
  if (!canAttemptCloud() || !data || !data.room_number) return null;
  try {
    const cleanNum = cleanRoomNumber(data.room_number);
    const checkinTimeIso = toIstIso(data.checkin_time);

    const payload = {
      room_number: cleanNum,
      room_id: data.room_id || null,
      room_type: data.room_type || 'Standard',
      guest_name: String(data.guest_name || 'In-House Guest').trim(),
      guest_mobile: data.guest_mobile ? String(data.guest_mobile).trim() : null,
      booking_id: data.booking_id || null,
      checkin_time: checkinTimeIso,
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
        const fPaid = Number(f.paid || 0);
        const fTotal = Number(f.total || f.grandTotal || 0);
        const fRefundDue = Number(f.refundDue ?? Math.max(0, fPaid - fTotal));
        const fPending = Number(f.pending ?? Math.max(0, fTotal - fPaid));

        const folioPayload = {
          room_number: cleanNum,
          room_id: data.room_id || null,
          department: 'room_folio',
          bill_no: f.voucherNumber || ('BK-' + (data.booking_id || cleanNum)),
          subtotal: Number(f.roomCharge || 0),
          gst: Number(f.tax || 0),
          grand_total: fTotal,
          items_summary: JSON.stringify({
            roomCharge: Number(f.roomCharge || 0),
            dailyRate: Number(f.dailyRate || f.room_rate || f.baseRate || 0),
            room_rate: Number(f.room_rate || f.dailyRate || f.baseRate || 0),
            baseRate: Number(f.baseRate || f.dailyRate || f.room_rate || 0),
            tariffSubtotal: Number(f.tariffSubtotal || 0),
            total: fTotal,
            grandTotal: fTotal,
            paid: fPaid,
            pending: fPending,
            refundDue: fRefundDue,
            balanceDue: fPending,
            stayCalcNow: f.stayCalcNow || {
              roomCharge: Number(f.roomCharge || 0),
              grandTotal: fTotal,
              paid: fPaid,
              refundDue: fRefundDue,
              balanceDue: fPending
            },
            extra: Number(f.extra || 0),
            discount: Number(f.discount || 0),
            restaurant: Number(f.restaurant || f.foodTotal || 0),
            bar: Number(f.bar || f.barTotal || 0),
            foodTotal: Number(f.foodTotal || f.restaurant || 0),
            barTotal: Number(f.barTotal || f.bar || 0),
            advanceReceiptNo: f.advanceReceiptNo || '',
            voucherNumber: f.voucherNumber || '',
            paymentMode: f.paymentMode || 'Cash',
            checkinTime: checkinTimeIso,
            approxCheckout: f.approxCheckout || '',
            source: f.source || 'Walk-in',
            checkedInBy: f.checkedInBy || 'Front Desk',
            guestName: data.guest_name,
            mobile: data.guest_mobile || '',
            email: f.email || data.guest_email || '',
            aadharNumber: f.aadharNumber || data.aadhar_number || '',
            aadhar_number: f.aadharNumber || data.aadhar_number || '',
            docType: f.docType || data.doc_type || 'Aadhaar Card',
            address: f.address || '',
            dob: f.dob || '',
            roomType: data.room_type || 'Standard Room'
          }),
          settled_by: f.checkedInBy || 'Front Desk',
          status: (fRefundDue > 0 || fPending === 0) ? 'settled' : 'due',
          created_at: new Date().toISOString()
        };

        // Update existing room_folio in-place by ID if it exists, otherwise insert.
        // Also prune duplicate room_folio rows for this room so exactly one authoritative row exists.
        const { data: existingFolios } = await withTimeout(
          supabase
            .from('room_charges_inbox')
            .select('id')
            .eq('room_number', String(data.room_number))
            .eq('department', 'room_folio')
            .order('created_at', { ascending: false }),
          REQUEST_TIMEOUT_MS
        );

        if (Array.isArray(existingFolios) && existingFolios.length > 0) {
          await withTimeout(
            supabase
              .from('room_charges_inbox')
              .update(folioPayload)
              .eq('id', existingFolios[0].id),
            REQUEST_TIMEOUT_MS
          );
          if (existingFolios.length > 1) {
            const staleIds = existingFolios.slice(1).map(x => x.id);
            await withTimeout(
              supabase.from('room_charges_inbox').delete().in('id', staleIds),
              REQUEST_TIMEOUT_MS
            ).catch(() => {});
          }
        } else {
          await withTimeout(
            supabase.from('room_charges_inbox').insert(folioPayload),
            REQUEST_TIMEOUT_MS
          );
        }
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
    const rawNum = String(roomNumber).trim();
    const cleanNum = cleanRoomNumber(roomNumber);

    await Promise.allSettled([
      withTimeout(
        supabase.from('active_occupancies').delete().eq('room_number', rawNum),
        REQUEST_TIMEOUT_MS
      ),
      cleanNum !== rawNum ? withTimeout(
        supabase.from('active_occupancies').delete().eq('room_number', cleanNum),
        REQUEST_TIMEOUT_MS
      ) : Promise.resolve(),
      withTimeout(
        supabase.from('room_charges_inbox').delete().eq('room_number', rawNum).eq('department', 'room_folio'),
        REQUEST_TIMEOUT_MS
      ),
      cleanNum !== rawNum ? withTimeout(
        supabase.from('room_charges_inbox').delete().eq('room_number', cleanNum).eq('department', 'room_folio'),
        REQUEST_TIMEOUT_MS
      ) : Promise.resolve()
    ]);

    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

/**
 * Persists a completed checkout record into Supabase room_charges_inbox.
 * Allows remote Admin APK over mobile data/cellular to view full checkout details and history.
 */
async function syncCheckoutToCloud(data) {
  if (!canAttemptCloud() || !data) return null;
  try {
    const payload = {
      room_number: String(data.roomNumber || data.room_number || ''),
      room_id: data.roomId || data.room_id || null,
      department: 'room_checkout',
      bill_no: data.billNo || data.bill_no || ('CO-' + (data.bookingId || data.booking_id || Date.now())),
      subtotal: parseFloat(data.subtotal || data.roomCharge || 0),
      gst: parseFloat(data.gst || data.tax || 0),
      grand_total: parseFloat(data.grandTotal || data.netSettle || data.total || 0),
      items_summary: JSON.stringify({
        isCheckout: true,
        bookingId: data.bookingId || data.booking_id,
        guestName: String(data.guestName || data.guest_name || 'Guest').trim(),
        mobile: String(data.mobile || data.phone || '').trim(),
        adults: Number(data.adults || 1),
        children: Number(data.children || 0),
        mealPlan: data.mealPlan || 'without_breakfast',
        roomCount: Number(data.roomCount || 1),
        roomNumber: String(data.roomNumber || data.room_number || ''),
        roomNumbers: Array.isArray(data.roomNumbers) ? data.roomNumbers : [String(data.roomNumber || data.room_number || '')],
        checkinTime: data.checkinTime || data.checkin_time,
        checkoutTime: data.checkoutTime || data.checkout_time || new Date().toISOString(),
        checkedInBy: data.checkedInBy || data.checked_in_by || 'Front Desk',
        checkedOutBy: data.checkedOutBy || data.checked_out_by || 'Staff',
        netSettle: parseFloat(data.netSettle || data.grandTotal || 0),
        refundAmount: parseFloat(data.refundAmount || 0),
        payments: Array.isArray(data.payments) ? data.payments : []
      }),
      settled_by: String(data.checkedOutBy || data.checked_out_by || 'Staff').trim(),
      status: 'settled',
      created_at: data.checkoutTime || data.checkout_time || new Date().toISOString()
    };

    const { data: result, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .insert(payload)
        .select(),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] syncCheckoutToCloud notice for Room ${data.roomNumber}:`, error.message);
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
        .in('department', ['restaurant', 'bar', 'room_service', 'room_folio'])
        .order('created_at', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] fetchPendingRoomCharges notice for Room ${roomNumber}:`, error.message);
      markNetworkFailure(error);
      return [];
    }
    markNetworkSuccess();
    // Exclude any running KOT tickets or non-settled items
    const settledCharges = (data || []).filter(row => 
      row.department !== 'waiter_kot_order' && 
      !String(row.bill_no || '').startsWith('KOT-')
    );
    return settledCharges;
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
 * Permanently deletes or voids a room charge in Supabase room_charges_inbox
 * so that deleted restaurant/bar bills never resurrect upon cloud sync.
 */
async function deleteCloudRoomCharge(orderNumber, orderId) {
  if (!canAttemptCloud()) return false;
  try {
    let deleted = false;
    if (orderNumber) {
      const cleanNum = String(orderNumber).trim();
      const { error: err1 } = await withTimeout(
        supabase
          .from('room_charges_inbox')
          .delete()
          .eq('bill_no', cleanNum),
        REQUEST_TIMEOUT_MS
      );
      if (!err1) deleted = true;
    }
    if (orderId) {
      const { error: err2 } = await withTimeout(
        supabase
          .from('room_charges_inbox')
          .delete()
          .eq('order_id', Number(orderId)),
        REQUEST_TIMEOUT_MS
      );
      if (!err2) deleted = true;
    }
    if (deleted) markNetworkSuccess();
    return deleted;
  } catch (err) {
    console.warn('[Supabase] deleteCloudRoomCharge notice:', err.message);
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
        .in('department', ['restaurant', 'bar', 'room_service', 'room_folio'])
        .order('created_at', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error || !Array.isArray(pendingCharges) || pendingCharges.length === 0) return [];

    const importedIds = [];
    for (const cc of pendingCharges) {
      const orderNum = cc.bill_no || `CLD-${cc.id}`;
      // CRITICAL: Running kitchen KOT tickets must NEVER be imported as room charges into restaurant_orders!
      if (cc.department === 'waiter_kot_order' || String(orderNum).startsWith('KOT-')) {
        continue;
      }

      const rawRoomNum = cc.room_number;
      if (!rawRoomNum) continue;

      const roomNum = String(rawRoomNum).replace(/^RS-/i, '').replace(/^Room\s*/i, '').trim();

      const booking = localDb.prepare(`
        SELECT b.id as booking_id, b.room_id, g.name as guest_name
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        JOIN guests g ON b.guest_id = g.id
        WHERE (r.room_number = ? OR r.room_number = ? OR r.id = ?) AND b.status = 'active'
        ORDER BY b.id DESC LIMIT 1
      `).get(roomNum, rawRoomNum, cc.room_id || 0);

      let roomId = booking ? booking.room_id : null;
      let bookingId = booking ? booking.booking_id : null;
      let guestName = booking ? booking.guest_name : null;

      if (!roomId) {
        const roomRow = localDb.prepare(`
          SELECT r.id, r.current_booking_id, g.name as guest_name
          FROM rooms r
          LEFT JOIN bookings b ON r.current_booking_id = b.id
          LEFT JOIN guests g ON b.guest_id = g.id
          WHERE r.room_number = ? OR r.room_number = ? OR r.id = ?
          LIMIT 1
        `).get(roomNum, rawRoomNum, cc.room_id || 0);

        if (roomRow) {
          roomId = roomRow.id;
          bookingId = roomRow.current_booking_id;
          guestName = roomRow.guest_name || 'In-House Guest';
        }
      }
      if (!guestName) guestName = 'In-House Guest';

      let parsedSummary = null;
      try {
        parsedSummary = typeof cc.items_summary === 'string' ? JSON.parse(cc.items_summary) : cc.items_summary;
      } catch (_) {}

      const totalAmt = parseFloat(cc.grand_total) || (parsedSummary ? parseFloat(parsedSummary.grand_total || parsedSummary.total) : 0) || 0;
      if (totalAmt <= 0) continue;

      // Extract real item breakdown
      let itemsList = [];
      if (parsedSummary && Array.isArray(parsedSummary.items) && parsedSummary.items.length > 0) {
        itemsList = parsedSummary.items;
      } else if (Array.isArray(cc.items) && cc.items.length > 0) {
        itemsList = cc.items;
      } else if (typeof cc.items_summary === 'string' && !cc.items_summary.startsWith('{') && !cc.items_summary.startsWith('[')) {
        itemsList = [{ name: cc.items_summary, quantity: 1, qty: 1, price: totalAmt, total: totalAmt }];
      } else {
        itemsList = [{ name: `${cc.department === 'bar' ? 'Bar' : 'Restaurant'} Room Service`, quantity: 1, qty: 1, price: totalAmt, total: totalAmt }];
      }
      const itemsJson = JSON.stringify(itemsList);

      const subtotalAmt = parseFloat(cc.subtotal) || (parsedSummary?.subtotal ? parseFloat(parsedSummary.subtotal) : Math.round(totalAmt / 1.05));
      const taxAmt = parseFloat(cc.gst) || (parsedSummary?.gst ? parseFloat(parsedSummary.gst) : (totalAmt - subtotalAmt));
      const cashierName = cc.settled_by || (parsedSummary?.waiter_name) || (cc.department === 'bar' ? 'Bar Cashier' : 'Restaurant Cashier');
      const createdAt = cc.created_at ? cc.created_at.replace('T', ' ').substring(0, 19) : new Date().toISOString().replace('T', ' ').substring(0, 19);

      let paymentMode = cc.payment_mode || (parsedSummary?.payment_mode) || (parsedSummary?.payment_method) || 'room_folio';
      let isPaid = (cc.is_paid !== undefined) ? Number(cc.is_paid) : (parsedSummary?.is_paid !== undefined ? Number(parsedSummary.is_paid) : 0);

      if (cc.department === 'bar') {
        const existing = localDb.prepare('SELECT id FROM bar_orders WHERE order_number = ?').get(orderNum);
        if (!existing) {
          localDb.prepare(`
            INSERT INTO bar_orders (
              order_number, room_id, customer_name, order_type,
              items_json, subtotal, tax, discount, total,
              payment_mode, is_paid, status, cashier_name,
              booking_id, created_at
            ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, ?, ?, 'completed', ?, ?, ?)
          `).run(orderNum, roomId, guestName, itemsJson, subtotalAmt, taxAmt, totalAmt, paymentMode, isPaid, cashierName, bookingId, createdAt);
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
            ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, ?, ?, 'completed', ?, ?, ?)
          `).run(orderNum, roomId, guestName, itemsJson, subtotalAmt, taxAmt, totalAmt, paymentMode, isPaid, cashierName, bookingId, createdAt);
          importedIds.push(cc.id);
        } else {
          importedIds.push(cc.id);
        }
      }

      // Clear or delete matching table from active tables
      const rsNumber = `RS-${roomNum}`;
      try {
        localDb.prepare(`DELETE FROM restaurant_tables WHERE table_number = ? OR table_number = ? OR table_number = ?`).run(rsNumber, `Room ${roomNum}`, rawRoomNum);
        localDb.prepare(`DELETE FROM bar_tables WHERE table_number = ? OR table_number = ? OR table_number = ?`).run(rsNumber, `Room ${roomNum}`, rawRoomNum);
        localDb.prepare(`UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE table_number = ? OR table_number = ?`).run(roomNum, rawRoomNum);
        localDb.prepare(`UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE table_number = ? OR table_number = ?`).run(roomNum, rawRoomNum);
      } catch (_) {}
    }

    if (importedIds.length > 0) {
      await markChargesImported(importedIds);
      await syncAllActiveRoomsFromLocal(localDb);
      await syncWaiterDataToCloud(localDb);
      console.log(`[Supabase] Automatically adopted ${importedIds.length} cloud charge(s) into local SQLite storage.`);
    }
    return importedIds;
  } catch (err) {
    return [];
  }
}

function formatToLocalSqliteString(isoDateStr) {
  if (!isoDateStr) return null;
  const raw = String(isoDateStr).trim();
  if (!raw || raw === 'null' || raw === 'undefined' || raw === 'NaN') return null;
  // If already in YYYY-MM-DD HH:mm:ss format, return directly without timezone alteration
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw.replace('T', ' ').substring(0, 19);
  }
  try {
    // If tagged with +00:00 or Z, check if treating as UTC pushes it past current local time
    if (raw.endsWith('+00:00') || raw.endsWith('Z')) {
      const stripped = raw.replace(/\+00:00$/, '').replace(/Z$/, '').replace('T', ' ');
      const parsedUtc = new Date(raw).getTime();
      if (parsedUtc > Date.now()) {
        return stripped.substring(0, 19);
      }
    }
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
  } catch (_) {
    return null;
  }
}

function syncPaymentsForBooking(localDb, bookingId, roomId, paidAmount, fMeta, checkinTime) {
  if (!localDb || !bookingId) return;
  const paymentsList = Array.isArray(fMeta?.payments) && fMeta.payments.length > 0
    ? fMeta.payments
    : (paidAmount > 0 ? [{
        receiptNo: fMeta?.advanceReceiptNo || (fMeta?.voucherNumber ? `RCP-${fMeta.voucherNumber}` : `RCP-260920-${bookingId}`),
        mode: fMeta?.paymentMode || 'cash',
        amount: paidAmount,
        cashier: fMeta?.checkedInBy || 'Staff',
        date: checkinTime,
        type: 'advance',
        notes: 'paid while checkin : ' + (fMeta?.paymentMode || 'Cash')
      }] : []);

  for (const p of paymentsList) {
    let recNo = String(p.receiptNo || p.receipt_no || '').trim();
    const pAmount = Number(p.amount || 0);
    if (pAmount <= 0) continue;
    if (!recNo) recNo = 'RCP-' + bookingId;

    const existingForBooking = localDb.prepare('SELECT id FROM payments WHERE booking_id = ? AND (receipt_no = ? OR (payment_type = ? AND amount = ?))').get(bookingId, recNo, p.type || 'advance', pAmount);
    if (existingForBooking) continue;

    const existingOther = localDb.prepare('SELECT id, booking_id FROM payments WHERE receipt_no = ?').get(recNo);
    if (existingOther && existingOther.booking_id !== bookingId) {
      recNo = recNo + '-' + bookingId;
    }

    try {
      localDb.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, split_cash, cashier_name, notes, realized_at, created_at
        ) VALUES (?, ?, ?, 'hospitality', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        recNo, bookingId, roomId,
        p.type || 'advance',
        (p.mode || 'cash').toLowerCase(),
        pAmount,
        (p.mode || 'cash').toLowerCase() === 'cash' ? pAmount : 0,
        p.cashier || fMeta?.checkedInBy || 'Staff',
        p.notes || `Advance payment: ${p.mode || 'Cash'}`,
        p.date || checkinTime || new Date().toISOString(),
        p.date || checkinTime || new Date().toISOString()
      );
    } catch (_) {}
  }
}

/**
 * Pulls all active room occupancies and check-in folios from Supabase into the local SQLite database.
 * Ensures multi-terminal consistency: rooms checked in on any client PC or terminal
 * immediately show up as occupied in the Front Desk Room Grid, Folios, and Accounting.
 */
async function pullCloudOccupanciesToLocal(localDb) {
  if (!canAttemptCloud() || !localDb) return { success: false, pulled: 0 };
  try {
    const [occRes, folioRes, coRes] = await Promise.all([
      withTimeout(supabase.from('active_occupancies').select('*'), REQUEST_TIMEOUT_MS),
      withTimeout(supabase.from('room_charges_inbox').select('*').eq('department', 'room_folio'), REQUEST_TIMEOUT_MS),
      withTimeout(supabase.from('room_charges_inbox').select('*').eq('department', 'room_checkout').order('created_at', { ascending: false }).limit(50), REQUEST_TIMEOUT_MS)
    ]);

    const cloudRooms = occRes?.data || [];
    const folios = folioRes?.data || [];
    const checkouts = coRes?.data || [];

    if (!Array.isArray(cloudRooms)) return { success: false, pulled: 0 };

    const folioMap = new Map();
    for (const f of folios) {
      const rn = cleanRoomNumber(f.room_number);
      let meta = {};
      try { meta = JSON.parse(f.items_summary || '{}'); } catch (_) {}
      folioMap.set(rn, { ...f, meta });
    }

    const cloudActiveSet = new Set(cloudRooms.map(c => cleanRoomNumber(c.room_number)));
    let pulledCount = 0;
    let updatedCount = 0;

    for (const cr of cloudRooms) {
      const rNum = cleanRoomNumber(cr.room_number);
      let room = localDb.prepare('SELECT * FROM rooms WHERE room_number = ?').get(rNum);
      if (!room) continue;

      const folioInfo = folioMap.get(rNum) || {};
      const fMeta = folioInfo.meta || {};

      const guestName = String(cr.guest_name || fMeta.guestName || 'In-House Guest').trim();
      const guestMobile = String(cr.guest_mobile || fMeta.mobile || '').trim();
      const guestEmail = String(fMeta.email || '').trim();
      const aadharNumber = String(fMeta.aadharNumber || fMeta.aadhar_number || '').trim();
      const docType = String(fMeta.docType || fMeta.doc_type || 'Aadhaar Card').trim();
      const address = String(fMeta.address || '').trim();
      const dob = String(fMeta.dob || '').trim();

      let activeBooking = null;
      if (room.current_booking_id) {
        activeBooking = localDb.prepare('SELECT * FROM bookings WHERE id = ? AND status = ?').get(room.current_booking_id, 'active');
      }
      if (!activeBooking) {
        activeBooking = localDb.prepare('SELECT * FROM bookings WHERE room_id = ? AND status = ?').get(room.id, 'active');
      }

      if (!activeBooking) {
        // Find or create guest
        let guest = null;
        if (guestMobile) {
          guest = localDb.prepare('SELECT * FROM guests WHERE mobile = ?').get(guestMobile);
        }
        if (!guest && guestName && guestName !== 'In-House Guest') {
          guest = localDb.prepare('SELECT * FROM guests WHERE name = ?').get(guestName);
        }
        if (!guest) {
          const insG = localDb.prepare(`
            INSERT INTO guests (name, mobile, email, aadhar_number, doc_type, address, dob, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(guestName, guestMobile, guestEmail, aadharNumber, docType, address, dob);
          guest = { id: insG.lastInsertRowid };
        } else {
          localDb.prepare(`
            UPDATE guests
            SET email = COALESCE(NULLIF(?, ''), email),
                aadhar_number = COALESCE(NULLIF(?, ''), aadhar_number),
                doc_type = COALESCE(NULLIF(?, ''), doc_type),
                address = COALESCE(NULLIF(?, ''), address),
                dob = COALESCE(NULLIF(?, ''), dob)
            WHERE id = ?
          `).run(guestEmail, aadharNumber, docType, address, dob, guest.id);
        }

        const checkinTime = formatToLocalSqliteString(fMeta.checkinTime || fMeta.checkin_time || cr.checkin_time);
        let approxCheckout = formatToLocalSqliteString(fMeta.approxCheckout || fMeta.expectedCheckout || fMeta.approx_checkout_time || cr.approx_checkout_time || cr.expected_checkout_time || null);
        if (!approxCheckout && checkinTime) {
          try {
            const dIn = new Date(String(checkinTime).includes('T') ? checkinTime : String(checkinTime).replace(' ', 'T') + '+05:30').getTime();
            if (!isNaN(dIn)) {
              approxCheckout = formatToLocalSqliteString(new Date(dIn + 24 * 60 * 60 * 1000));
            }
          } catch (_) {}
        }
        const rawNewRate = Number(fMeta.dailyRate || fMeta.baseRate || fMeta.room_rate || 0);
        const roomRate = (rawNewRate > 0 && rawNewRate < 50000) ? rawNewRate : Number(room.price_single || room.price || 2400);

        let stayDays = 1;
        try {
          if (checkinTime && approxCheckout) {
            const dIn = new Date(String(checkinTime).includes('T') ? checkinTime : String(checkinTime).replace(' ', 'T') + '+05:30').getTime();
            const dOut = new Date(String(approxCheckout).includes('T') ? approxCheckout : String(approxCheckout).replace(' ', 'T') + '+05:30').getTime();
            if (!isNaN(dIn) && !isNaN(dOut) && dOut > dIn) {
              stayDays = Math.max(1, Math.round((dOut - dIn) / (24 * 3600 * 1000)));
            }
          }
        } catch (_) {}

        const rawTotalCharge = Number(fMeta.roomCharge || folioInfo.subtotal || 0);
        const totalRoomCharge = (rawTotalCharge > 0 && rawTotalCharge < 200000) ? rawTotalCharge : Math.round(roomRate * stayDays);
        const paid = Number(fMeta.paid || cr.total_paid || (String(cr.payment_status || fMeta.payment_status || '').toLowerCase() === 'paid' ? totalRoomCharge : 0));
        const discount = Number(fMeta.discount || 0);
        const voucherNumber = fMeta.voucherNumber || folioInfo.bill_no || ('BK-' + (cr.booking_id || rNum));
        const source = fMeta.source || 'Walk-in';
        const checkedInBy = fMeta.checkedInBy || folioInfo.settled_by || 'Front Desk';
        const paymentMode = fMeta.paymentMode || 'Cash';
        const adultsMale = fMeta.adultsMale ?? fMeta.adults_male ?? 1;
        const adultsFemale = fMeta.adultsFemale ?? fMeta.adults_female ?? 0;

        const insB = localDb.prepare(`
          INSERT INTO bookings (
            room_id, guest_id, checkin_time, approx_checkout_time,
            room_rate, total_room_charge, advance_payment, total_paid,
            discount_amount, voucher_number, booking_source, checked_in_by,
            advance_payment_mode, adults_male, adults_female, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
        `).run(
          room.id, guest.id, checkinTime, approxCheckout,
          roomRate, totalRoomCharge, paid, paid,
          discount, voucherNumber, source, checkedInBy,
          paymentMode, adultsMale, adultsFemale
        );
        const newBookingId = insB.lastInsertRowid;

        localDb.prepare(`
          UPDATE rooms 
          SET status = 'occupied', current_booking_id = ?
          WHERE id = ?
        `).run(newBookingId, room.id);

        syncPaymentsForBooking(localDb, newBookingId, room.id, paid, fMeta, checkinTime);

        pulledCount++;
      } else {
        // Room is already active locally - check if room.status is set correctly
        if (room.status !== 'occupied' || room.current_booking_id !== activeBooking.id) {
          localDb.prepare(`UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?`).run(activeBooking.id, room.id);
        }

        // Update guest details
        if (activeBooking.guest_id) {
          localDb.prepare(`
            UPDATE guests
            SET email = COALESCE(NULLIF(?, ''), email),
                aadhar_number = COALESCE(NULLIF(?, ''), aadhar_number),
                doc_type = COALESCE(NULLIF(?, ''), doc_type),
                address = COALESCE(NULLIF(?, ''), address),
                dob = COALESCE(NULLIF(?, ''), dob)
            WHERE id = ?
          `).run(guestEmail, aadharNumber, docType, address, dob, activeBooking.guest_id);
        }

        const cloudCheckin = formatToLocalSqliteString(fMeta.checkinTime || fMeta.checkin_time || cr.checkin_time);
        const cloudApproxOut = formatToLocalSqliteString(fMeta.approxCheckout || fMeta.expectedCheckout || fMeta.approx_checkout_time || cr.approx_checkout_time || cr.expected_checkout_time || null);
        
        // Never clobber local approx_checkout_time with an older, null, or corrupted timestamp
        let shouldUpdateCheckout = false;
        if (cloudApproxOut) {
          if (!activeBooking.approx_checkout_time) {
            shouldUpdateCheckout = true;
          } else {
            try {
              const dCloud = new Date(String(cloudApproxOut).includes('T') ? cloudApproxOut : String(cloudApproxOut).replace(' ', 'T') + '+05:30').getTime();
              const dLocal = new Date(String(activeBooking.approx_checkout_time).includes('T') ? activeBooking.approx_checkout_time : String(activeBooking.approx_checkout_time).replace(' ', 'T') + '+05:30').getTime();
              // Only update if cloud date is genuinely extending the stay by at least 12 hours
              if (!isNaN(dCloud) && !isNaN(dLocal) && (dCloud - dLocal) > 12 * 3600 * 1000) {
                shouldUpdateCheckout = true;
              }
            } catch (_) {}
          }
        }
        const effectiveApproxOut = shouldUpdateCheckout ? cloudApproxOut : activeBooking.approx_checkout_time;
        const effectiveCheckin = cloudCheckin || activeBooking.checkin_time;

        // RATE RECOVERY & SANITIZATION:
        // room_rate MUST STRICTLY be the 1-night per-day room rate.
        // It must NEVER be overwritten with multi-day stay sums!
        const rawRate = Number(fMeta.dailyRate || fMeta.baseRate || fMeta.room_rate || 0);
        const currentValidRate = Number(activeBooking.room_rate && activeBooking.room_rate < 50000 ? activeBooking.room_rate : (room.price_single || room.price || 2400));
        const safeRate = (rawRate > 0 && rawRate < 50000) ? rawRate : currentValidRate;

        let stayDays = 1;
        try {
          const tIn = effectiveCheckin;
          const tOut = effectiveApproxOut;
          if (tIn && tOut) {
            const dIn = new Date(String(tIn).includes('T') ? tIn : String(tIn).replace(' ', 'T') + '+05:30').getTime();
            const dOut = new Date(String(tOut).includes('T') ? tOut : String(tOut).replace(' ', 'T') + '+05:30').getTime();
            if (!isNaN(dIn) && !isNaN(dOut) && dOut > dIn) {
              stayDays = Math.max(1, Math.round((dOut - dIn) / (24 * 3600 * 1000)));
            }
          }
        } catch (_) {}

        const rawTotal = Number(fMeta.total || fMeta.grandTotal || fMeta.roomCharge || folioInfo.grand_total || 0);
        const safeTotal = (rawTotal > 0 && rawTotal < 200000) ? rawTotal : Math.round(safeRate * stayDays);
        const cloudPaid = Number(fMeta.paid || cr.total_paid || (String(cr.payment_status || fMeta.payment_status || '').toLowerCase() === 'paid' ? safeTotal : 0));
        const adultsMale = fMeta.adultsMale ?? fMeta.adults_male ?? null;
        const adultsFemale = fMeta.adultsFemale ?? fMeta.adults_female ?? null;
        const checkedInBy = fMeta.checkedInBy || folioInfo.settled_by || null;
        const advReceiptNo = fMeta.advanceReceiptNo || null;

        localDb.prepare(`
          UPDATE bookings 
          SET checkin_time = COALESCE(?, checkin_time),
              approx_checkout_time = COALESCE(?, approx_checkout_time),
              room_rate = ?,
              total_room_charge = ?,
              total_paid = MAX(COALESCE(total_paid, 0), ?),
              advance_payment = MAX(COALESCE(advance_payment, 0), ?),
              advance_receipt_no = COALESCE(?, advance_receipt_no),
              checked_in_by = COALESCE(?, checked_in_by),
              adults_male = CASE WHEN ? IS NOT NULL THEN ? ELSE adults_male END,
              adults_female = CASE WHEN ? IS NOT NULL THEN ? ELSE adults_female END
          WHERE id = ?
        `).run(
          effectiveCheckin,
          effectiveApproxOut,
          safeRate,
          safeTotal,
          cloudPaid, cloudPaid,
          advReceiptNo, checkedInBy,
          adultsMale, adultsMale,
          adultsFemale, adultsFemale,
          activeBooking.id
        );

        syncPaymentsForBooking(localDb, activeBooking.id, room.id, cloudPaid, fMeta, cloudCheckin || activeBooking.checkin_time);

        updatedCount++;
      }
    }

    // Handle remote checkouts: if a room was checked out in cloud, free it locally
    const localOccupied = localDb.prepare(`SELECT r.id, r.room_number, r.current_booking_id FROM rooms r WHERE r.status = 'occupied'`).all();
    let checkoutCount = 0;
    for (const lr of localOccupied) {
      const rn = cleanRoomNumber(lr.room_number);
      if (!cloudActiveSet.has(rn)) {
        const co = checkouts.find(c => cleanRoomNumber(c.room_number) === rn);
        if (co) {
          let coMeta = {};
          try { coMeta = JSON.parse(co.items_summary || '{}'); } catch (_) {}
          const coTime = formatToLocalSqliteString(co.created_at || coMeta.checkoutTime);
          const settledBy = co.settled_by || coMeta.checkedOutBy || 'Staff';

          if (lr.current_booking_id) {
            localDb.prepare(`
              UPDATE bookings 
              SET status = 'checked_out', actual_checkout_time = ?, checked_out_by = ?
              WHERE id = ? AND status = 'active'
            `).run(coTime, settledBy, lr.current_booking_id);
          }

          localDb.prepare(`UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?`).run(lr.id);
          checkoutCount++;
        }
      }
    }

    markNetworkSuccess();
    if (pulledCount > 0 || checkoutCount > 0) {
      console.log(`[Supabase Cloud Sync] Pulled ${pulledCount} room(s) into local DB, reconciled ${checkoutCount} checkout(s).`);
    }
    return { success: true, pulled: pulledCount, updated: updatedCount, checkouts: checkoutCount };
  } catch (err) {
    markNetworkFailure(err);
    console.warn('[Supabase Sync] pullCloudOccupanciesToLocal notice:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Synchronizes all currently occupied rooms from local SQLite database to Supabase.
 * Runs non-blocking on server startup or on demand.
 */
async function syncAllActiveRoomsFromLocal(localDb) {
  if (!canAttemptCloud() || !localDb) return;
  try {
    // 1. Pull any occupancies created on other terminals/client PCs into local database first
    try {
      await pullCloudOccupanciesToLocal(localDb);
    } catch (pullErr) {
      console.warn('[Supabase] Inbound occupancy sync notice:', pullErr.message);
    }

    const activeBookings = localDb.prepare(`
      SELECT 
        b.id as booking_id,
        b.room_id,
        r.room_number,
        r.room_type,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.email,
        g.aadhar_number,
        g.doc_type,
        g.address,
        g.dob,
        b.checkin_time,
        b.approx_checkout_time,
        b.room_rate,
        b.total_room_charge,
        b.advance_payment,
        b.total_paid,
        b.discount_amount,
        b.discount_pct,
        b.extra_bed_charge,
        b.voucher_number,
        b.advance_receipt_no,
        b.advance_payment_mode,
        b.booking_source,
        b.checked_in_by,
        b.meal_plan,
        b.adults_male,
        b.adults_female,
        b.adults_other,
        b.children,
        r.price as room_price,
        r.breakfast_price,
        r.ext_grace_mins,
        r.ext_3h_rate,
        r.ext_6h_rate,
        r.ext_9h_rate
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      JOIN guests g ON b.guest_id = g.id
      WHERE b.status = 'active'
    `).all();

    const activeRoomSet = new Set((activeBookings || []).map(b => String(b.room_number)));

    if (!activeBookings || activeBookings.length === 0) return;

    // 2. Sync all current active rooms WITH billing folios & itemized F&B orders to cloud
    for (const b of activeBookings) {
      if (!canAttemptCloud()) break; // Exit immediately if offline circuit breaker tripped
      
      // Query active restaurant and bar orders for this booking/room
      let restOrders = [];
      let barOrders = [];
      try {
        restOrders = localDb.prepare(`
          SELECT * FROM restaurant_orders
          WHERE (booking_id = ? OR (room_id = ? AND datetime(created_at) >= ?))
          ORDER BY created_at ASC
        `).all(b.booking_id, b.room_id, b.checkin_time || '2000-01-01');

        barOrders = localDb.prepare(`
          SELECT * FROM bar_orders
          WHERE (booking_id = ? OR (room_id = ? AND datetime(created_at) >= ?))
          ORDER BY created_at ASC
        `).all(b.booking_id, b.room_id, b.checkin_time || '2000-01-01');
      } catch (orderErr) {
        console.warn('[Supabase] Active orders fetch notice:', orderErr.message);
      }

      // Elapsed Stay Calculation matching CRM Folio calculateActualStayAndExtension
      let liveStayDays = 1;
      let extensionCharge = 0;
      let extraHours = 0;
      try {
        if (b.checkin_time) {
          const dIn = new Date(toIstIso(b.checkin_time)).getTime();
          const dNow = Date.now();
          const elapsedHours = Math.max(0, (dNow - dIn) / (1000 * 60 * 60));
          if (elapsedHours < 24) {
            liveStayDays = 1;
            extraHours = Math.floor(elapsedHours);
            extensionCharge = 0;
          } else {
            const completedDays = Math.floor(elapsedHours / 24);
            extraHours = Math.floor(elapsedHours % 24);
            const extraTotalMins = extraHours * 60;
            const graceMins = b.ext_grace_mins !== undefined && b.ext_grace_mins !== null ? Number(b.ext_grace_mins) : 60;
            const r3h = b.ext_3h_rate !== undefined && b.ext_3h_rate !== null ? Number(b.ext_3h_rate) : 500;
            const r6h = b.ext_6h_rate !== undefined && b.ext_6h_rate !== null ? Number(b.ext_6h_rate) : 1000;
            const r9h = b.ext_9h_rate !== undefined && b.ext_9h_rate !== null ? Number(b.ext_9h_rate) : 1500;

            if (extraTotalMins <= graceMins) {
              extensionCharge = 0;
              liveStayDays = completedDays;
            } else if (extraTotalMins <= 180) {
              extensionCharge = r3h;
              liveStayDays = completedDays;
            } else if (extraTotalMins <= 360) {
              extensionCharge = r6h;
              liveStayDays = completedDays;
            } else if (extraTotalMins <= 540) {
              extensionCharge = r9h;
              liveStayDays = completedDays;
            } else {
              liveStayDays = completedDays + 1;
              extensionCharge = 0;
              extraHours = 0;
            }
          }
        }
      } catch (_) {}
      liveStayDays = Math.max(1, liveStayDays);

      // Declared departure stay days from booking
      let declaredStayDays = 1;
      try {
        if (b.checkin_time && b.approx_checkout_time) {
          const dIn = new Date(toIstIso(b.checkin_time)).getTime();
          const dOut = new Date(toIstIso(b.approx_checkout_time)).getTime();
          const diffHours = (dOut - dIn) / (1000 * 60 * 60);
          declaredStayDays = Math.max(1, Math.round(diffHours / 24));
        }
      } catch (_) {}
      const targetStayDays = Math.max(declaredStayDays, liveStayDays);

      const rawDaily = Number(b.room_rate || b.room_price || 0);
      const dailyBase = (rawDaily > 0 && rawDaily < 50000) ? rawDaily : (Number(b.room_price) || 2400);
      const mp = String(b.meal_plan || '').toLowerCase();
      const hasBf = (mp === 'with_breakfast' || mp === 'breakfast' || (mp.includes('breakfast') && !mp.includes('without')));
      const bfPax = hasBf ? Math.max(1, (b.adults_male || 0) + (b.adults_female || 0)) : 0;
      const bfDaily = hasBf ? (bfPax * (Number(b.breakfast_price) || 250)) : 0;
      const extraMattressDaily = Number(b.extra_bed_charge || 0);

      const decBaseTariff = targetStayDays * dailyBase;
      const decExtraMattressCost = targetStayDays * extraMattressDaily;
      const decBreakfastCost = targetStayDays * bfDaily;
      const decPreTaxGross = decBaseTariff + decExtraMattressCost + decBreakfastCost + extensionCharge;

      const discountPct = Number(b.discount_pct || 0);
      let decDiscountAmount = discountPct > 0
        ? Math.round((decPreTaxGross * discountPct) / 100)
        : Number(b.discount_amount || 0);

      if (targetStayDays > 1 && discountPct === 0 && Number(b.discount_amount || 0) > 0) {
        decDiscountAmount = Math.round(Number(b.discount_amount || 0) * targetStayDays);
      }

      const decPreTaxRoom = decPreTaxGross - decDiscountAmount;
      const roomGst = Math.round(decPreTaxRoom * 0.05);
      const decRoomCharge = decPreTaxRoom + roomGst;

      const foodTotal = restOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const barTotal = barOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const roomCharge = decRoomCharge > 0 ? decRoomCharge : (Number(b.total_room_charge || 0));
      const extra = Number(b.extra_bed_charge || 0);
      const discount = decDiscountAmount;
      const tax = roomGst;
      const grandTotal = Math.max(0, roomCharge + foodTotal + barTotal);
      const paid = Number(b.total_paid || b.advance_payment || 0);
      const refundDue = Math.max(0, paid - grandTotal);
      const pending = Math.max(0, grandTotal - paid);

      let bookingPayments = [];
      try {
        bookingPayments = localDb.prepare('SELECT receipt_no as receiptNo, receipt_no, payment_mode as mode, amount, cashier_name as cashier, realized_at as date, notes, payment_type as type FROM payments WHERE booking_id = ? ORDER BY id ASC').all(b.booking_id);
      } catch (_) {}

      await syncActiveOccupancy({
        room_number: cleanRoomNumber(b.room_number),
        room_id: b.room_id,
        room_type: b.room_type,
        guest_name: b.guest_name,
        guest_mobile: b.guest_mobile,
        guest_email: b.email,
        aadhar_number: b.aadhar_number,
        doc_type: b.doc_type || 'Aadhaar Card',
        booking_id: b.booking_id,
        checkin_time: toIstIso(b.checkin_time),
        food_total: foodTotal,
        bar_total: barTotal,
        total_paid: paid,
        grand_total: grandTotal,
        balance_due: pending,
        folio: {
          roomCharge,
          dailyRate: dailyBase,
          room_rate: dailyBase,
          baseRate: dailyBase,
          tariffSubtotal: Number(decBaseTariff + decExtraMattressCost + decBreakfastCost),
          restaurant: foodTotal,
          bar: barTotal,
          foodTotal,
          barTotal,
          extra,
          discount,
          tax,
          total: grandTotal,
          grandTotal,
          paid,
          pending,
          refundDue,
          stayCalcDeclared: {
            roomCharge,
            grandTotal,
            paid,
            refundDue,
            balanceDue: pending,
            stayDurationStr: `${targetStayDays} day${targetStayDays > 1 ? 's' : ''}`,
            chargedDays: targetStayDays,
            expectedNights: targetStayDays
          },
          stayCalcNow: {
            roomCharge: (liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05),
            grandTotal: (liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05) + foodTotal + barTotal,
            paid,
            refundDue: Math.max(0, paid - ((liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05) + foodTotal + barTotal)),
            balanceDue: Math.max(0, ((liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05) + foodTotal + barTotal) - paid),
            stayDurationStr: `${liveStayDays} day${liveStayDays > 1 ? 's' : ''}`,
            chargedDays: liveStayDays,
            extraHours
          },
          voucherNumber: b.voucher_number || '',
          advanceReceiptNo: b.advance_receipt_no || '',
          paymentMode: b.advance_payment_mode || 'Cash',
          payments: bookingPayments,
          approxCheckout: b.approx_checkout_time || '',
          source: b.booking_source || 'Walk-in',
          checkedInBy: b.checked_in_by || 'Front Desk',
          address: b.address || '',
          dob: b.dob || '',
          email: b.email || '',
          aadharNumber: b.aadhar_number || '',
          docType: b.doc_type || 'Aadhaar Card',
          adultsMale: b.adults_male,
          adultsFemale: b.adults_female
        }
      });

      // Gentle pause between rooms to ensure Supabase connection pool is never overwhelmed
      await sleep(150);
    }

    // 3. Ensure any cloud active rooms (e.g. checked in from other terminals like 104, 211) have a valid room_folio
    try {
      const { data: cloudAllOccs } = await withTimeout(
        supabase.from('active_occupancies').select('*'),
        REQUEST_TIMEOUT_MS
      );
      if (Array.isArray(cloudAllOccs)) {
        for (const co of cloudAllOccs) {
          const rNum = cleanRoomNumber(co.room_number);
          if (!activeRoomSet.has(rNum)) {
            const { data: hasFolio } = await withTimeout(
              supabase.from('room_charges_inbox').select('id').eq('room_number', rNum).eq('department', 'room_folio').limit(1),
              REQUEST_TIMEOUT_MS
            );
            if (!hasFolio || hasFolio.length === 0) {
              const rType = String(co.room_type || '').toLowerCase();
              const baseRate = rType.includes('pent') ? 4500 : (rType.includes('suit') ? 3500 : (rType.includes('plus') ? 2800 : (rType.includes('deluxe') ? 2200 : 2350)));
              let sNights = 1;
              try {
                if (co.checkin_time) {
                  const dIn = new Date(co.checkin_time).getTime();
                  sNights = Math.max(1, Math.ceil((Date.now() - dIn) / (24 * 3600 * 1000)));
                }
              } catch (_) {}
              const rmCharge = baseRate * sNights;
              const gst = Math.round(rmCharge * 0.05);
              const gTotal = rmCharge + gst;
              const pd = Number(co.total_paid || co.advance_payment || 0);
              const pnd = Math.max(0, gTotal - pd);
              const ref = Math.max(0, pd - gTotal);

              await syncActiveOccupancy({
                room_number: rNum,
                room_id: co.room_id,
                room_type: co.room_type,
                guest_name: co.guest_name,
                guest_mobile: co.guest_mobile,
                booking_id: co.booking_id,
                checkin_time: co.checkin_time,
                folio: {
                  roomCharge: gTotal,
                  grandTotal: gTotal,
                  total: gTotal,
                  paid: pd,
                  pending: pnd,
                  refundDue: ref,
                  stayCalcNow: {
                    roomCharge: gTotal,
                    grandTotal: gTotal,
                    paid: pd,
                    balanceDue: pnd,
                    refundDue: ref,
                    chargedDays: sNights
                  },
                  guestName: co.guest_name,
                  mobile: co.guest_mobile,
                  roomType: co.room_type
                }
              });
              await sleep(150);
            }
          }
        }
      }
    } catch (extraRoomErr) {
      console.warn('[Supabase] Extra room folio init notice:', extraRoomErr.message);
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
 * Paced gently with concurrency lock and cooldown to prevent connection exhaustion.
 */
async function syncAllOfflineDataToCloud(localDb) {
  if (localDb) activeLocalDbInstance = localDb;
  if (!canAttemptCloud() || !localDb || isSyncingOffline) return;

  const now = Date.now();
  if (now - lastFullOfflineSyncTime < 5 * 60 * 1000) {
    // Only allow full sync once every 5 minutes max
    return;
  }

  isSyncingOffline = true;
  lastFullOfflineSyncTime = now;

  try {
    console.log('[Supabase Sync] 🔄 Starting gentle offline sync...');
    await syncAllActiveRoomsFromLocal(localDb);
    await sleep(350);
    if (!canAttemptCloud()) return;

    await syncDailyAnalyticsToCloud(localDb);
    await sleep(350);
    if (!canAttemptCloud()) return;

    await syncLiveFBStateToCloud(localDb);
    await sleep(350);
    if (!canAttemptCloud()) return;

    await pullStoreBillsFromCloud(localDb);
    await sleep(350);
    if (!canAttemptCloud()) return;

    await pullCloudRoomChargesToLocal(localDb);
    console.log('[Supabase Sync] ✅ Gentle offline sync completed successfully.');
  } catch (err) {
    console.warn('[Offline Sync] Sync caught error:', err.message);
  } finally {
    isSyncingOffline = false;
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
        room_number: req.room_number,
        room_count: req.room_count || 1,
        rooms_list: req.rooms_list || null,
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
            try {
              const notificationService = require('./notificationService');
              notificationService.updateApprovalStatus(approvalId, newStatus, row.settled_by || 'Admin');
              console.log(`[Cloud Approval] Synced decision from cloud: Request #${approvalId} is now ${newStatus}`);
            } catch (syncErr) {
              db.prepare(`
                UPDATE owner_approvals
                SET status = ?, action_by = ?, action_at = datetime('now','localtime')
                WHERE id = ?
              `).run(newStatus, row.settled_by || 'Admin', approvalId);
            }
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

// --------------------------------------------------------------------------
// WAITER PANEL CLOUD SYNC & KOT AUTO-PRINTER (Independent Internet / 4G / 5G)
// --------------------------------------------------------------------------

/**
 * Uploads live restaurant/bar menus, categories, tables, and waiter staff to Supabase
 * so remote Waiter Panels (Netlify, 4G/5G, outside Wi-Fi) can operate completely independently.
 */
async function syncWaiterDataToCloud(db) {
  if (!canAttemptCloud() || !db) return;
  try {
    const resMenu = db.prepare("SELECT id, name, category, price, is_available, is_veg FROM menu_items WHERE department = 'restaurant' AND is_available = 1").all();
    const resCats = db.prepare("SELECT * FROM restaurant_categories").all();
    const barMenu = db.prepare("SELECT id, name, category, price, is_available, is_veg FROM menu_items WHERE department = 'bar' AND is_available = 1").all();
    const barCats = db.prepare("SELECT * FROM bar_categories").all();
    const resTables = db.prepare("SELECT id, table_number, table_type, capacity, status, active_cart_json, printed_cart_json, kot_count, token_number, waiter_name, special_notes, order_started_at, customer_name, customer_phone FROM restaurant_tables").all();
    const barTables = db.prepare("SELECT id, table_number, table_type, capacity, status, active_cart_json, printed_cart_json, bot_count, token_number, waiter_name, special_notes, order_started_at, customer_name, customer_phone FROM bar_tables").all();
    const staff = db.prepare("SELECT id, username, password, full_name, role, phone FROM staff_users WHERE status = 'active'").all();
    
    // In-house occupied rooms for room service orders
    let occRooms = [];
    try {
      occRooms = db.prepare(`
        SELECT r.id, r.room_number, r.status, g.name as guest_name, g.mobile as guest_phone, b.id as booking_id 
        FROM rooms r 
        JOIN bookings b ON r.current_booking_id = b.id 
        JOIN guests g ON b.guest_id = g.id 
        WHERE b.status = 'active'
      `).all();
    } catch (_) {}

    let guestTokens = [];
    try {
      guestTokens = db.prepare(`
        SELECT token, booking_id, guest_name, mobile, room_numbers, checkin_time, approx_checkout_time, status
        FROM guest_dining_tokens
        WHERE status = 'active'
      `).all();
    } catch (_) {}

    const pkg = {
      restaurantMenu: resMenu || [],
      restaurantCategories: resCats || [],
      barMenu: barMenu || [],
      barCategories: barCats || [],
      restaurantTables: resTables || [],
      barTables: barTables || [],
      staff: staff || [],
      occupiedRooms: occRooms || [],
      guestTokens: guestTokens || [],
      syncedAt: new Date().toISOString()
    };

    const payload = {
      id: '00000000-0000-0000-0000-000000000088',
      room_number: '0',
      room_id: 0,
      department: 'waiter_cloud_sync_pkg',
      order_id: 0,
      bill_no: 'PKG',
      subtotal: 0,
      gst: 0,
      grand_total: 0,
      settled_by: 'local_crm',
      items_summary: JSON.stringify(pkg),
      status: 'active'
    };

    await withTimeout(supabase.from('room_charges_inbox').upsert(payload));

    // Also sync cleanly to dedicated staff_users table in Supabase
    try {
      for (const s of (staff || [])) {
        await withTimeout(
          supabase.from('staff_users').upsert({
            id: s.id,
            username: s.username,
            password: s.password,
            full_name: s.full_name,
            role: s.role,
            phone: s.phone || '',
            status: 'active',
            updated_at: new Date().toISOString()
          }, { onConflict: 'username' }),
          3000
        ).catch(() => {});
      }
    } catch (_) {}

    markNetworkSuccess();
  } catch (err) {
    markNetworkFailure(err);
  }
}

/**
 * Pulls pending orders punched by waiters from Supabase cloud (via 4G/5G, Netlify, or Wi-Fi),
 * writes them into local SQLite tables, and automatically triggers the kitchen KOT printer.
 */
async function pullCloudWaiterOrdersToLocal(db) {
  if (!canAttemptCloud() || !db) return;
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .select('*')
        .eq('department', 'waiter_kot_order')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
    );

    if (!error && Array.isArray(data) && data.length > 0) {
      for (const row of data) {
      try {
        let orderData = {};
        try {
          orderData = JSON.parse(row.items_summary || '{}');
        } catch (_) {
          continue;
        }

        const items = Array.isArray(orderData.items) ? orderData.items : [];
        if (items.length === 0) {
          // Mark invalid order processed
          await withTimeout(supabase.from('room_charges_inbox').update({ status: 'invalid' }).eq('id', row.id));
          continue;
        }

        const isGuestMobile = orderData.source === 'guest_inroom_mobile' || 
                              orderData.waiter_name === 'Guest In-Room Mobile' || 
                              row.department === 'guest_inroom_order';

        if (isGuestMobile) {
          const cleanRoomNum = String(orderData.room_number || row.room_number || 'Room')
            .replace(/^RS-/i, '')
            .replace(/^Room\s*/i, '')
            .replace(/•.*$/, '')
            .trim();

          const existingGuestOrder = db.prepare('SELECT id FROM guest_inroom_orders WHERE cloud_inbox_id = ? OR order_number = ?').get(String(row.id), row.bill_no);
          if (!existingGuestOrder) {
            let batchNumber = 1;
            try {
              const countRow = db.prepare('SELECT COUNT(*) as count FROM guest_inroom_orders WHERE room_numbers = ? OR room_numbers LIKE ?').get(cleanRoomNum, `%${cleanRoomNum}%`);
              batchNumber = (countRow?.count || 0) + 1;
            } catch (_) {}

            const orderNotes = orderData.notes || '';
            const custName = orderData.customer_name || row.settled_by || `Room ${cleanRoomNum}`;
            const custPhone = orderData.customer_phone || '';
            const grandTotal = Number(row.grand_total || 0);

            db.prepare(`
              INSERT INTO guest_inroom_orders (
                order_number, token, booking_id, room_numbers, guest_name, guest_phone,
                batch_number, items_json, notes, subtotal, tax, grand_total, status, kot_printed, cloud_inbox_id
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_kitchen', 0, ?)
            `).run(
              row.bill_no || `RS-${cleanRoomNum}-B${batchNumber}-${Date.now().toString().slice(-4)}`,
              orderData.token || '',
              orderData.bookingId || 0,
              cleanRoomNum,
              custName,
              custPhone,
              batchNumber,
              JSON.stringify(items),
              orderNotes,
              Number(row.subtotal || 0),
              Number(row.gst || 0),
              grandTotal,
              String(row.id)
            );
            console.log(`[Supabase] 🛎️ In-Room Guest Food Order received for Room ${cleanRoomNum} (Batch #${batchNumber}) -> Waiting for Kitchen Acceptance & KOT Print!`);

            // Dispatch instant push notification to Admin APK
            try {
              const notificationService = require('./notificationService');
              const itemSummaryText = items.map(i => `${i.quantity || 1}x ${i.name}`).join(', ');
              notificationService.sendPushNotification({
                title: `🛎️ In-Room Food Order - Room ${cleanRoomNum}`,
                body: `${custName}: ${itemSummaryText} (₹${grandTotal}). Waiting for Kitchen POS confirmation.`,
                data: {
                  type: 'guest_room_order',
                  roomNumber: cleanRoomNum,
                  orderToken: row.bill_no,
                  grandTotal
                },
                type: 'food_order'
              }).catch(e => console.warn('[Supabase] Guest order push notification warning:', e.message));
            } catch (pErr) {
              console.warn('[Supabase] Push dispatch notice:', pErr.message);
            }
          }

          // Mark cloud order as 'received_at_crm' so it is not re-imported in loop
          await withTimeout(
            supabase
              .from('room_charges_inbox')
              .update({ status: 'received_at_crm' })
              .eq('id', row.id)
          );
          continue;
        }

        const dept = (orderData.department || 'restaurant').toLowerCase();
        const destType = orderData.destination_type || 'table';
        const destId = orderData.destination_id;
        const destLabel = orderData.destination_label || row.room_number || 'Table';
        const waiterName = orderData.waiter_name || row.settled_by || 'Captain';
        const notes = orderData.notes || '';
        const custName = orderData.customer_name || '';
        const custPhone = orderData.customer_phone || '';

        let tableId = destId;
        const tableName = dept === 'bar' ? 'bar_tables' : 'restaurant_tables';

        // Clean room service table identifier
        const cleanRoomNum = String(orderData.room_number || destLabel || '')
          .replace(/^RS-/i, '')
          .replace(/^Room\s*/i, '')
          .replace(/•.*$/, '')
          .trim();
        const rsNumber = `RS-Room ${cleanRoomNum}`;

        // Find table by ID or table_number
        let targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ? OR table_number = ?`).get(destId, destLabel);
        if (!targetTable && destType === 'room') {
          // Room service virtual table - look for RS-Room 501, RS-501, or any variation
          targetTable = db.prepare(`
            SELECT * FROM ${tableName} 
            WHERE table_number = ? 
               OR table_number = ? 
               OR table_number LIKE ? 
               OR table_number LIKE ? 
            LIMIT 1
          `).get(rsNumber, `RS-${cleanRoomNum}`, `RS-Room ${cleanRoomNum}%`, `RS-${cleanRoomNum}%`);

          if (!targetTable) {
            try {
              const info = db.prepare(`INSERT INTO ${tableName} (table_number, table_type, capacity, special_notes, status, order_started_at) VALUES (?, 'room_service', 2, ?, 'occupied', datetime('now', 'localtime'))`).run(rsNumber, notes || `Room Service for Room ${cleanRoomNum}`);
              targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(info.lastInsertRowid);
            } catch (_) {}
          }
        } else if (!targetTable && destType === 'parcel') {
          const pToken = String(destId || custName || Date.now().toString().slice(-4)).replace(/^P-/i, '');
          const pNumber = `P-${pToken}`;
          targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE table_number = ?`).get(pNumber);
          if (!targetTable) {
            try {
              const info = db.prepare(`INSERT INTO ${tableName} (table_number, table_type, capacity, special_notes, status, order_started_at) VALUES (?, 'parcel', 1, ?, 'occupied', datetime('now', 'localtime'))`).run(pNumber, `Takeaway Parcel #${pToken}`);
              targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(info.lastInsertRowid);
            } catch (_) {}
          }
        }

        let assignedToken = 1;
        if (targetTable) {
          tableId = targetTable.id;
          let currentCart = [];
          try { currentCart = JSON.parse(targetTable.active_cart_json || '[]'); } catch (_) {}
          
          // Merge newly ordered items into table's active cart with timestamp
          const nowIso = new Date().toISOString();
          for (const it of items) {
            const existingIdx = currentCart.findIndex(c => String(c.id) === String(it.id) && Boolean(c.is_parcel) === Boolean(it.is_parcel));
            const itTimestamp = it.added_at || it.time || nowIso;
            if (existingIdx >= 0) {
              currentCart[existingIdx].qty = (Number(currentCart[existingIdx].qty) || 1) + (Number(it.qty || it.quantity) || 1);
              currentCart[existingIdx].added_at = itTimestamp;
            } else {
              currentCart.push({
                id: it.id,
                name: it.name,
                price: it.price,
                qty: Number(it.qty || it.quantity) || 1,
                is_parcel: Boolean(it.is_parcel),
                notes: it.notes || '',
                added_at: itTimestamp
              });
            }
          }

          const countCol = dept === 'bar' ? 'bot_count' : 'kot_count';
          const kotCount = ((targetTable[countCol]) || 0) + 1;
          assignedToken = targetTable.token_number || kotCount;

          db.prepare(`
            UPDATE ${tableName}
            SET active_cart_json = ?, printed_cart_json = ?, ${countCol} = ?,
                status = 'occupied', waiter_name = ?, special_notes = ?,
                customer_name = CASE WHEN ? <> '' THEN ? ELSE customer_name END,
                customer_phone = CASE WHEN ? <> '' THEN ? ELSE customer_phone END,
                order_started_at = COALESCE(order_started_at, datetime('now', 'localtime'))
            WHERE id = ?
          `).run(
            JSON.stringify(currentCart),
            JSON.stringify(currentCart),
            kotCount,
            waiterName,
            notes,
            custName, custName,
            custPhone, custPhone,
            tableId
          );
        }

        // Auto-enqueue KOT / BOT print job for the kitchen thermal printer!
        if (typeof global.enqueuePrintJob === 'function') {
          global.enqueuePrintJob(dept === 'bar' ? 'bot' : 'kot', {
            tableNumber: targetTable ? targetTable.table_number : destLabel,
            tokenNumber: assignedToken,
            waiterName: waiterName,
            notes: notes,
            customerName: custName,
            kot: {
              kotNumber: 1,
              tokenNumber: assignedToken,
              items: items
            },
            items: items,
            department: dept,
            timestamp: new Date().toISOString()
          });
        }

        // Mark the Supabase cloud order as printed so it is never re-processed
        await withTimeout(
          supabase
            .from('room_charges_inbox')
            .update({ status: 'printed' })
            .eq('id', row.id)
        );

        console.log(`[Supabase] 🍳 Waiter KOT pulled & queued for print: ${destLabel} (${items.length} items) by ${waiterName}`);
      } catch (itemErr) {
        console.error('[Supabase] Error processing cloud waiter order:', itemErr.message);
      }
    }

    // Immediately push updated tables to Supabase cloud package so Waiter Panel on Netlify sees Active Running in <1s!
    await syncWaiterDataToCloud(db);
  }

  // Pull and process pending waiter cancellation requests from cloud
  try {
    const { data: cancelData } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .select('*')
        .eq('department', 'waiter_kot_cancel')
        .eq('status', 'pending')
    );

    if (Array.isArray(cancelData) && cancelData.length > 0) {
      for (const crow of cancelData) {
        try {
          let cancelInfo = {};
          try { cancelInfo = JSON.parse(crow.items_summary || '{}'); } catch (_) {}
          const dept = (cancelInfo.department || 'restaurant').toLowerCase();
          const tName = dept === 'bar' ? 'bar_tables' : 'restaurant_tables';
          const ordTable = dept === 'bar' ? 'bar_orders' : 'restaurant_orders';
          const tId = cancelInfo.table_id || crow.room_id;
          const tNum = cancelInfo.table_number || crow.room_number;

          if (tNum && (String(tNum).startsWith('RS-') || String(tNum).startsWith('P-'))) {
            db.prepare(`DELETE FROM ${tName} WHERE id = ? OR table_number = ?`).run(tId, tNum);
          } else if (tId || tNum) {
            db.prepare(`UPDATE ${tName} SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ? OR table_number = ?`).run(tId, tNum);
          }

          try {
            db.prepare(`UPDATE ${ordTable} SET status = 'cancelled' WHERE (table_number = ? OR table_id = ?) AND status NOT IN ('completed', 'cancelled')`).run(tNum, tId);
          } catch (_) {}

          await withTimeout(
            supabase.from('room_charges_inbox').update({ status: 'cancelled' }).eq('id', crow.id)
          );
          console.log(`[Supabase] 🗑️ Processed waiter cancellation for ${tNum || tId}`);
        } catch (cErr) {
          console.warn('[Supabase] Cancel processing notice:', cErr.message);
        }
      }

      // Immediately sync clean tables back to cloud package
      await syncWaiterDataToCloud(db);
    }
  } catch (_) {}

    markNetworkSuccess();
  } catch (err) {
    markNetworkFailure(err);
  }
}

let realtimeChannel = null;

function setupRealtimeListeners(db) {
  if (!supabase) return;
  try {
    if (realtimeChannel) {
      try { supabase.removeChannel(realtimeChannel); } catch (_) {}
      realtimeChannel = null;
    }

    realtimeChannel = supabase
      .channel('hcp-crm-cloud-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_charges_inbox' },
        (payload) => {
          const row = payload.new || {};
          const dept = row.department;
          console.log(`[Supabase Realtime] Event on room_charges_inbox (${dept || 'unknown'}): ${payload.eventType}`);

          if (dept === 'waiter_kot_order') {
            pullCloudWaiterOrdersToLocal(db).catch(() => {});
          } else if (dept === 'discount_approval') {
            pollCloudApprovals(db).catch(() => {});
          } else if (dept === 'room_folio' || dept === 'room_checkout') {
            pullCloudOccupanciesToLocal(db).catch(() => {});
          } else if (dept !== 'waiter_cloud_sync_pkg' && dept !== 'fb_live_state') {
            pullCloudRoomChargesToLocal(db).catch(() => {});
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'active_occupancies' },
        (payload) => {
          console.log('[Supabase Realtime] Event on active_occupancies:', payload.eventType);
          pullCloudOccupanciesToLocal(db).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'store_bills' },
        (payload) => {
          console.log('[Supabase Realtime] Event on store_bills:', payload.eventType);
          pullStoreBillsFromCloud(db).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'store_vendors' },
        (payload) => {
          console.log('[Supabase Realtime] Event on store_vendors:', payload.eventType);
          pullStoreVendorsFromCloud(db).catch(() => {});
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('⚡ [Supabase Realtime] Connected! Listening for Admin & Waiter live updates (zero polling overhead).');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn(`[Supabase Realtime] Channel status: ${status}. Fallback heartbeat active.`);
        }
      });
  } catch (err) {
    console.warn('[Supabase Realtime] Setup notice:', err.message);
  }
}

function stopRealtimeListeners() {
  if (realtimeChannel && supabase) {
    try { supabase.removeChannel(realtimeChannel); } catch (_) {}
    realtimeChannel = null;
  }
}

async function syncStaffUserToCloud(user) {
  if (!canAttemptCloud() || !user) return;
  try {
    await withTimeout(
      supabase.from('staff_users').upsert({
        id: user.id,
        username: user.username,
        password: user.password,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone || '',
        status: user.status || 'active',
        can_access_manager: user.can_access_manager || 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'username' }),
      4000
    );
  } catch (_) {}
}

async function syncAllStaffUsersToCloud(db) {
  if (!canAttemptCloud() || !db) return;
  try {
    const staff = db.prepare(`SELECT id, username, password, full_name, role, phone, status, can_access_manager FROM staff_users`).all();
    for (const s of staff) {
      await withTimeout(
        supabase.from('staff_users').upsert({
          id: s.id,
          username: s.username,
          password: s.password,
          full_name: s.full_name,
          role: s.role,
          phone: s.phone || '',
          status: s.status || 'active',
          can_access_manager: s.can_access_manager || 0,
          updated_at: new Date().toISOString()
        }, { onConflict: 'username' }),
        3000
      ).catch(() => {});
    }
  } catch (_) {}
}

module.exports = {
  setupRealtimeListeners,
  stopRealtimeListeners,
  pushStoreVendor,
  pullStoreVendorsFromCloud,
  pushStoreBill,
  pushStorePayment,
  deleteStoreBill,
  pullStoreBillsFromCloud,
  syncActiveOccupancy,
  removeActiveOccupancy,
  syncCheckoutToCloud,
  pushRoomCharge,
  fetchActiveOccupancies,
  fetchPendingRoomCharges,
  markChargesImported,
  deleteCloudRoomCharge,
  syncAllActiveRoomsFromLocal,
  syncApprovalRequestToCloud,
  pollCloudApprovals,
  syncDailyAnalyticsToCloud,
  pullCloudRoomChargesToLocal,
  pullCloudOccupanciesToLocal,
  syncLiveFBStateToCloud,
  syncAllOfflineDataToCloud,
  syncWaiterDataToCloud,
  pullCloudWaiterOrdersToLocal,
  syncStaffUserToCloud,
  syncAllStaffUsersToCloud,
  isConfigured: () => Boolean(supabase),
  isOfflineMode: () => isOffline && (Date.now() - lastOfflineTime < OFFLINE_COOLDOWN_MS)
};


