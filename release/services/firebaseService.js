/**
 * Firebase Firestore Cloud Sync Service for Hotel City Park CRM
 * Provides seamless parallel synchronization alongside Supabase.
 * 
 * Collections managed (per FIREBASE_CONTEXT.md):
 *  - active_occupancies     : Live occupied rooms index
 *  - room_charges_inbox     : Real-time message bus & queue (Folios, KOT, Approvals, Live F&B)
 *  - store_vendors          : Vendor address book
 *  - store_bills            : Store invoices & purchase bills
 *  - store_vendor_payments  : Supplier payment ledger
 *  - hotel_analytics        : Daily revenue & occupancy metrics
 *  - owner_devices          : FCM device tokens
 */

const path = require('path');
const fs = require('fs');
let admin = null;
let firestore = null;

try {
  admin = require('firebase-admin');
  const { getFirestore } = require('firebase-admin/firestore');

  let serviceAccount = null;
  const saPaths = [
    path.resolve(__dirname, '..', 'firebase-service-account.json'),
    path.resolve(__dirname, '..', 'hotelcitypark-crm-firebase-adminsdk-fbsvc-cb2c37b86c.json'),
    path.resolve(__dirname, 'firebase-service-account.json')
  ];

  for (const p of saPaths) {
    if (fs.existsSync(p)) {
      try {
        serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
        break;
      } catch (_) {}
    }
  }

  if (serviceAccount && serviceAccount.private_key) {
    const app = admin.getApps().length > 0
      ? admin.getApp()
      : admin.initializeApp({
          credential: admin.cert(serviceAccount)
        });
    firestore = getFirestore(app);
    console.log('🔥 [Firebase Firestore] Connected successfully to project:', serviceAccount.project_id);
  } else {
    console.warn('⚠️ [Firebase Firestore] Service account file not found or invalid. Parallel Firebase sync disabled.');
  }
} catch (err) {
  console.warn('⚠️ [Firebase Firestore] Initialization error:', err.message);
}

const seenPaymentDocIds = new Set();

// Timeout helper to ensure non-blocking operation
const REQUEST_TIMEOUT_MS = 6000;
function withTimeout(thenable, ms = REQUEST_TIMEOUT_MS) {
  return Promise.race([
    thenable,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase timeout')), ms))
  ]);
}

function cleanRoomNumber(val) {
  return String(val || '')
    .replace(/^Room\s*#?/i, '')
    .replace(/\b(Bed\s*room|Bedroom|Room)\b/gi, '')
    .trim();
}

async function updateLiveState(tableName = 'general') {
  if (!firestore) return;
  try {
    await withTimeout(firestore.collection('sync_meta').doc('live_state').set({
      last_table: tableName,
      version: Date.now(),
      updated_at: new Date().toISOString()
    }, { merge: true }), 3000);
  } catch (_) {}
}

// ==========================================
// 1. ACTIVE OCCUPANCIES
// ==========================================
async function syncActiveOccupancy(room) {
  if (!firestore || !room) return;
  const roomNum = cleanRoomNumber(room.room_number || room.roomNumber || room.room);
  if (!roomNum) return;

  try {
    const data = {
      room_number: String(roomNum),
      room_id: Number(room.room_id || room.id || 0) || null,
      room_type: String(room.room_type || room.type || 'Standard'),
      guest_name: String(room.guest_name || room.name || 'Guest'),
      guest_mobile: room.guest_mobile || room.mobile || null,
      guest_email: room.guest_email || room.email || null,
      booking_id: Number(room.booking_id || room.bookingId || 0) || null,
      checkin_time: room.checkin_time || room.checkinTime || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await withTimeout(firestore.collection('active_occupancies').doc(String(roomNum)).set(data, { merge: true }));
  } catch (err) {
    console.warn(`[Firebase] syncActiveOccupancy error for Room ${roomNum}:`, err.message);
  }
}

async function removeActiveOccupancy(roomNumber) {
  if (!firestore) return;
  const roomNum = cleanRoomNumber(roomNumber);
  if (!roomNum) return;

  try {
    await withTimeout(firestore.collection('active_occupancies').doc(String(roomNum)).delete());
  } catch (err) {
    console.warn(`[Firebase] removeActiveOccupancy error for Room ${roomNum}:`, err.message);
  }
}

async function fetchActiveOccupancies() {
  if (!firestore) return [];
  try {
    const snap = await withTimeout(firestore.collection('active_occupancies').get());
    const list = [];
    snap.forEach(doc => list.push(doc.data()));
    return list;
  } catch (err) {
    console.warn('[Firebase] fetchActiveOccupancies error:', err.message);
    return [];
  }
}

// ==========================================
// 2. ROOM CHARGES INBOX & FOLIOS
// ==========================================
async function pushRoomCharge(charge) {
  if (!firestore || !charge) return;
  try {
    const roomNum = cleanRoomNumber(charge.room_number || charge.roomNumber || charge.room || '0');
    const docId = charge.id ? String(charge.id) : (charge.bill_no ? String(charge.bill_no) : undefined);
    
    const payload = {
      room_number: roomNum,
      room_id: charge.room_id || null,
      department: charge.department || 'restaurant',
      bill_no: charge.bill_no || charge.order_number || `CHG-${Date.now()}`,
      subtotal: Number(charge.subtotal || 0),
      gst: Number(charge.gst || 0),
      grand_total: Number(charge.grand_total || charge.total || 0),
      settled_by: charge.settled_by || 'Staff',
      status: charge.status || 'pending',
      items_summary: typeof charge.items_summary === 'object' ? JSON.stringify(charge.items_summary) : (charge.items_summary || '[]'),
      created_at: charge.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (docId) {
      await withTimeout(firestore.collection('room_charges_inbox').doc(docId).set(payload, { merge: true }));
    } else {
      await withTimeout(firestore.collection('room_charges_inbox').add(payload));
    }
  } catch (err) {
    console.warn('[Firebase] pushRoomCharge error:', err.message);
  }
}

async function deleteCloudRoomCharge(orderNumber, orderId) {
  if (!firestore) return;
  try {
    const col = firestore.collection('room_charges_inbox');
    const batch = firestore.batch();
    let count = 0;

    if (orderNumber) {
      const snap1 = await col.where('bill_no', '==', String(orderNumber)).get();
      snap1.forEach(doc => { batch.delete(doc.ref); count++; });
    }
    if (orderId) {
      const snap2 = await col.where('id', '==', String(orderId)).get();
      snap2.forEach(doc => { batch.delete(doc.ref); count++; });
      try {
        const directDoc = await col.doc(String(orderId)).get();
        if (directDoc.exists) { batch.delete(directDoc.ref); count++; }
      } catch (_) {}
    }

    if (count > 0) {
      await withTimeout(batch.commit());
      console.log(`[Firebase] Purged ${count} record(s) for order ${orderNumber || orderId}`);
    }
  } catch (err) {
    console.warn('[Firebase] deleteCloudRoomCharge error:', err.message);
  }
}

async function syncCheckoutToCloud(checkoutData) {
  if (!firestore || !checkoutData) return;
  try {
    const cleanRoom = cleanRoomNumber(checkoutData.roomNumber || checkoutData.room_number || '0');
    const roomsList = Array.isArray(checkoutData.roomNumbers) && checkoutData.roomNumbers.length > 0
      ? checkoutData.roomNumbers
      : (checkoutData.roomNumber ? String(checkoutData.roomNumber).split(',').map(s => s.trim()) : [cleanRoom]);
    
    let itemsMeta = null;
    if (typeof checkoutData.items_summary === 'object' && checkoutData.items_summary !== null) {
      itemsMeta = checkoutData.items_summary;
    } else if (typeof checkoutData.items_summary === 'string' && checkoutData.items_summary !== '{}' && checkoutData.items_summary.length > 5) {
      try { itemsMeta = JSON.parse(checkoutData.items_summary); } catch (_) {}
    }
    
    if (!itemsMeta) {
      itemsMeta = {
        isCheckout: true,
        bookingId: checkoutData.bookingId || checkoutData.booking_id,
        billNo: checkoutData.billNo || checkoutData.bill_no,
        guestName: String(checkoutData.guestName || checkoutData.guest_name || 'Valued Guest').trim(),
        mobile: String(checkoutData.mobile || checkoutData.phone || '').trim(),
        adults: Number(checkoutData.adults || 1),
        children: Number(checkoutData.children || 0),
        mealPlan: checkoutData.mealPlan || checkoutData.meal_plan || 'without_breakfast',
        roomCount: Number(checkoutData.roomCount || checkoutData.room_count || roomsList.length || 1),
        roomNumber: String(checkoutData.roomNumber || checkoutData.room_number || cleanRoom),
        roomNumbers: roomsList,
        checkinTime: checkoutData.checkinTime || checkoutData.checkin_time,
        checkoutTime: checkoutData.checkoutTime || checkoutData.checkout_time || new Date().toISOString(),
        checkedInBy: checkoutData.checkedInBy || checkoutData.checked_in_by || 'Front Desk',
        checkedOutBy: checkoutData.checkedOutBy || checkoutData.checked_out_by || 'Staff',
        netSettle: parseFloat(checkoutData.netSettle || checkoutData.grandTotal || checkoutData.total || 0),
        refundAmount: parseFloat(checkoutData.refundAmount || checkoutData.refund_amount || 0),
        payments: Array.isArray(checkoutData.payments) ? checkoutData.payments : []
      };
    }

    const itemsSummaryStr = JSON.stringify(itemsMeta);
    const billNo = checkoutData.billNo || checkoutData.bill_no || ('CO-' + (checkoutData.bookingId || Date.now()));
    const docId = `checkout_${billNo}`;

    const payload = {
      id: docId,
      department: 'room_checkout',
      room_number: String(checkoutData.roomNumber || checkoutData.room_number || cleanRoom),
      bill_no: billNo,
      subtotal: Number(checkoutData.subtotal || checkoutData.roomCharge || 0),
      gst: Number(checkoutData.gst || 0),
      grand_total: Number(checkoutData.grandTotal || checkoutData.grand_total || checkoutData.netSettle || checkoutData.total || 0),
      settled_by: String(checkoutData.checkedOutBy || checkoutData.settled_by || 'Staff').trim(),
      status: 'settled',
      items_summary: itemsSummaryStr,
      created_at: checkoutData.checkoutTime || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. Write the main checkout record
    await withTimeout(firestore.collection('room_charges_inbox').doc(docId).set(payload, { merge: true }));

    // 2. Also write/update each room's direct checkout doc (co_${cleanRoom}) so room.tsx fetches it instantly
    for (const r of roomsList) {
      const cr = cleanRoomNumber(r);
      if (cr) {
        await withTimeout(firestore.collection('room_charges_inbox').doc(`co_${cr}`).set({
          ...payload,
          id: `co_${cr}`,
          room_number: cr
        }, { merge: true }));
      }
    }
  } catch (err) {
    console.warn('[Firebase] syncCheckoutToCloud error:', err.message);
  }
}

async function syncApprovalRequestToCloud(req) {
  if (!firestore || !req) return;
  try {
    const docId = `APP-${req.id || req.approval_id || Date.now()}`;
    const payload = {
      id: docId,
      department: 'discount_approval',
      room_number: cleanRoomNumber(req.room_number || req.roomNumber || '0'),
      bill_no: docId,
      subtotal: Number(req.current_total || 0),
      gst: 0,
      grand_total: Number(req.final_amount || req.current_total || 0),
      settled_by: req.requested_by || 'Receptionist',
      status: (req.status || 'pending').toLowerCase(),
      items_summary: JSON.stringify(req),
      created_at: req.requested_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await withTimeout(firestore.collection('room_charges_inbox').doc(docId).set(payload, { merge: true }));
  } catch (err) {
    console.warn('[Firebase] syncApprovalRequestToCloud error:', err.message);
  }
}

async function syncLiveFBStateToCloud(state) {
  if (!firestore || !state) return;
  try {
    const payload = {
      id: 'fb_live_state',
      department: 'fb_live_state',
      room_number: 'ALL',
      bill_no: 'STATE-LIVE',
      subtotal: 0,
      gst: 0,
      grand_total: 0,
      settled_by: 'System',
      status: 'active',
      items_summary: typeof state === 'object' ? JSON.stringify(state) : String(state),
      updated_at: new Date().toISOString()
    };

    await withTimeout(firestore.collection('room_charges_inbox').doc('fb_live_state').set(payload, { merge: true }));
  } catch (err) {
    console.warn('[Firebase] syncLiveFBStateToCloud error:', err.message);
  }
}

async function fetchPendingRoomCharges() {
  if (!firestore) return [];
  try {
    const snap = await withTimeout(
      firestore.collection('room_charges_inbox').where('status', '==', 'pending').get()
    );
    const list = [];
    snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    return list;
  } catch (err) {
    console.warn('[Firebase] fetchPendingRoomCharges error:', err.message);
    return [];
  }
}

async function markChargesImported(ids) {
  if (!firestore || !ids || !ids.length) return;
  try {
    const batch = firestore.batch();
    for (const id of ids) {
      const ref = firestore.collection('room_charges_inbox').doc(String(id));
      batch.update(ref, { status: 'imported', updated_at: new Date().toISOString() });
    }
    await withTimeout(batch.commit());
  } catch (err) {
    console.warn('[Firebase] markChargesImported error:', err.message);
  }
}

// ==========================================
// 3. STORE VENDORS, BILLS & PAYMENTS
// ==========================================
async function pushStoreVendor(vendor) {
  if (!firestore || !vendor || !vendor.id) return;
  try {
    const docId = String(vendor.id);
    const payload = {
      id: vendor.id,
      name: String(vendor.name || '').trim(),
      mobile: String(vendor.mobile || '').trim(),
      address: String(vendor.address || '').trim(),
      updated_at: new Date().toISOString()
    };
    await withTimeout(firestore.collection('store_vendors').doc(docId).set(payload, { merge: true }));
  } catch (err) {
    console.warn('[Firebase] pushStoreVendor error:', err.message);
  }
}

async function pushStoreBill(bill) {
  if (!firestore || !bill || !bill.id) return;
  try {
    const docId = String(bill.id);
    let itemsArr = [];
    try {
      itemsArr = typeof bill.items === 'string' ? JSON.parse(bill.items) : (Array.isArray(bill.items) ? bill.items : []);
    } catch (_) {}

    const payload = {
      id: bill.id,
      vendor_id: bill.vendor_id || null,
      bill_number: String(bill.bill_number || ''),
      bill_date: bill.bill_date || new Date().toISOString().split('T')[0],
      total_amount: Number(bill.total_amount || 0),
      paid_amount: Number(bill.paid_amount || 0),
      pending_amount: Number(bill.pending_amount || (bill.total_amount - (bill.paid_amount || 0))),
      status: String(bill.status || 'PENDING').toUpperCase(),
      payment_mode: String(bill.payment_mode || 'Bank Transfer'),
      has_gst: Number(bill.has_gst || 0),
      bill_photo: bill.bill_photo || null,
      notes: bill.notes || '',
      created_by: bill.created_by || 'Storekeeper',
      items: itemsArr,
      updated_at: new Date().toISOString()
    };
    await withTimeout(firestore.collection('store_bills').doc(docId).set(payload, { merge: true }));
  } catch (err) {
    console.warn('[Firebase] pushStoreBill error:', err.message);
  }
}

async function deleteStoreBill(billId) {
  if (!firestore || !billId) return;
  try {
    await withTimeout(firestore.collection('store_bills').doc(String(billId)).delete());
  } catch (err) {
    console.warn(`[Firebase] deleteStoreBill error for Bill ${billId}:`, err.message);
  }
}

async function pushStorePayment(payment) {
  if (!firestore || !payment) return;
  try {
    const payload = {
      bill_id: payment.bill_id || null,
      vendor_id: payment.vendor_id || null,
      vendor_name: payment.vendor_name || 'Vendor',
      payment_amount: Number(payment.payment_amount || payment.amount || 0),
      payment_mode: payment.payment_mode || 'Bank Transfer',
      reference_no: payment.reference_no || payment.utr || '',
      paid_by: payment.paid_by || 'Admin',
      paid_at: payment.paid_at || new Date().toISOString(),
      notified: true
    };
    const ref = await withTimeout(firestore.collection('store_vendor_payments').add(payload));
    if (ref && ref.id) {
      seenPaymentDocIds.add(ref.id);
    }
  } catch (err) {
    console.warn('[Firebase] pushStorePayment error:', err.message);
  }
}

async function pushSystemSetting(key, value) {
  if (!firestore || !key) return;
  try {
    const k = String(key).trim();
    const v = String(value !== undefined && value !== null ? value : '').trim();
    await withTimeout(firestore.collection('system_settings').doc(k).set({
      key: k,
      value: v,
      updated_at: new Date().toISOString()
    }, { merge: true }));
    console.log(`🔥 [Firebase] Synced system_settings/${k} = ${v} to Firestore.`);
  } catch (err) {
    console.warn(`[Firebase] pushSystemSetting error for ${key}:`, err.message);
  }
}

// ==========================================
// 4. DAILY HOTEL ANALYTICS
// ==========================================
async function syncDailyAnalyticsToCloud(analytics) {
  if (!firestore || !analytics) return;
  const dateKey = analytics.date || analytics.id || new Date().toISOString().split('T')[0];
  try {
    const payload = {
      id: dateKey,
      today_revenue: Number(analytics.today_revenue || analytics.total_revenue || 0),
      today_cash: Number(analytics.today_cash || analytics.cash || 0),
      today_upi: Number(analytics.today_upi || analytics.upi || 0),
      today_card: Number(analytics.today_card || analytics.card || 0),
      today_checkins: Number(analytics.today_checkins || analytics.checkins || 0),
      today_checkouts: Number(analytics.today_checkouts || analytics.checkouts || 0),
      occupied_rooms: Number(analytics.occupied_rooms || 0),
      total_rooms: Number(analytics.total_rooms || 24),
      updated_at: new Date().toISOString()
    };
    await withTimeout(firestore.collection('hotel_analytics').doc(dateKey).set(payload, { merge: true }));
  } catch (err) {
    console.warn(`[Firebase] syncDailyAnalyticsToCloud error for ${dateKey}:`, err.message);
  }
}

// ==========================================
// 5. FULL SYNC OF ACTIVE OCCUPANCIES & FOLIOS
// ==========================================
function toIstIso(val) {
  if (!val) return new Date().toISOString();
  const s = String(val).trim().replace(' ', 'T');
  if (s.includes('+') || s.endsWith('Z') || /-\d{2}:\d{2}$/.test(s)) {
    return s;
  }
  const full = s.length === 16 ? s + ':00' : s;
  return full + '+05:30';
}

async function syncAllActiveRoomsFromLocal(db) {
  if (!firestore || !db) return;
  try {
    const activeRooms = db.prepare(`
      SELECT 
        r.id as room_id,
        r.room_number,
        r.room_type,
        r.price as room_price,
        r.breakfast_price,
        b.id as booking_id,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.email as guest_email,
        g.address as guest_address,
        g.dob as guest_dob,
        g.doc_type as guest_doc_type,
        g.aadhar_number as guest_aadhar,
        b.checkin_time,
        b.approx_checkout_time,
        b.room_rate,
        b.total_room_charge,
        b.advance_payment,
        b.total_paid,
        b.discount_amount,
        b.discount_pct,
        b.extra_bed_charge,
        b.advance_payment_mode,
        b.voucher_number,
        b.meal_plan,
        b.adults_male,
        b.adults_female,
        b.children,
        b.checked_in_by,
        b.booking_source
      FROM rooms r
      JOIN bookings b ON r.current_booking_id = b.id
      JOIN guests g ON b.guest_id = g.id
      WHERE r.status = 'occupied' AND b.status = 'active'
    `).all();

    const batch = firestore.batch();

    for (const room of activeRooms) {
      const roomNum = cleanRoomNumber(room.room_number);
      if (!roomNum) continue;

      const totalAdults = Math.max(1, (room.adults_male || 0) + (room.adults_female || 0));

      // 1. active_occupancies doc
      const occRef = firestore.collection('active_occupancies').doc(roomNum);
      batch.set(occRef, {
        room_number: roomNum,
        room_id: room.room_id,
        room_type: room.room_type || 'Standard',
        guest_name: room.guest_name || 'Guest',
        guest_mobile: room.guest_mobile || null,
        guest_email: room.guest_email || null,
        guest_address: room.guest_address || null,
        guest_dob: room.guest_dob || null,
        doc_type: room.guest_doc_type || 'Aadhaar Card',
        aadhar_number: room.guest_aadhar || null,
        booking_id: room.booking_id,
        adults: totalAdults,
        adults_male: room.adults_male || 0,
        adults_female: room.adults_female || 0,
        children: room.children || 0,
        meal_plan: room.meal_plan || 'without_breakfast',
        booking_source: room.booking_source || 'Walk-in',
        checked_in_by: room.checked_in_by || 'Front Desk',
        voucher_number: room.voucher_number || '',
        advance_payment: Number(room.advance_payment || 0),
        total_paid: Number(room.total_paid || room.advance_payment || 0),
        checkin_time: room.checkin_time || new Date().toISOString(),
        approx_checkout_time: room.approx_checkout_time || '',
        updated_at: new Date().toISOString()
      }, { merge: true });

      // 2. room_charges_inbox -> folio_{roomNum}
      const bId = room.booking_id;
      const validCheckin = room.checkin_time || '2000-01-01';
      const fnbOrders = db.prepare(`
        SELECT total FROM restaurant_orders 
        WHERE (booking_id = ? OR (room_id = ? AND datetime(created_at) >= ?))
      `).all(bId, room.room_id, validCheckin);

      const barOrders = db.prepare(`
        SELECT total FROM bar_orders 
        WHERE (booking_id = ? OR (room_id = ? AND datetime(created_at) >= ?))
      `).all(bId, room.room_id, validCheckin);

      const extraExpenses = db.prepare(`SELECT amount, gst_amount FROM booking_extra_expenses WHERE booking_id = ?`).all(bId);

      const payments = db.prepare(`
        SELECT receipt_no, amount, payment_mode, cashier_name, created_at, notes, payment_type 
        FROM payments 
        WHERE booking_id = ? 
        ORDER BY id ASC
      `).all(bId);

      const foodTotal = fnbOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const barTotal = barOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const extraTotal = extraExpenses.reduce((sum, e) => sum + (e.amount || 0) + (e.gst_amount || 0), 0);

      // Elapsed Stay Calculation matching CRM Folio calculateActualStayAndExtension
      let liveStayDays = 1;
      let extensionCharge = 0;
      try {
        if (room.checkin_time) {
          const dIn = new Date(toIstIso(room.checkin_time)).getTime();
          const dNow = Date.now();
          const elapsedHours = Math.max(0, (dNow - dIn) / (1000 * 60 * 60));
          if (elapsedHours >= 24) {
            const completedDays = Math.floor(elapsedHours / 24);
            const extraHours = Math.floor(elapsedHours % 24);
            const extraTotalMins = extraHours * 60;
            if (extraTotalMins <= 60) {
              liveStayDays = completedDays;
            } else if (extraTotalMins <= 180) {
              liveStayDays = completedDays;
              extensionCharge = 500;
            } else if (extraTotalMins <= 360) {
              liveStayDays = completedDays;
              extensionCharge = 1000;
            } else if (extraTotalMins <= 540) {
              liveStayDays = completedDays;
              extensionCharge = 1500;
            } else {
              liveStayDays = completedDays + 1;
            }
          }
        }
      } catch (_) {}
      liveStayDays = Math.max(1, liveStayDays);

      // Declared departure stay days from booking
      let declaredStayDays = 1;
      try {
        if (room.checkin_time && room.approx_checkout_time) {
          const dIn = new Date(toIstIso(room.checkin_time)).getTime();
          const dOut = new Date(toIstIso(room.approx_checkout_time)).getTime();
          const diffHours = (dOut - dIn) / (1000 * 60 * 60);
          declaredStayDays = Math.max(1, Math.round(diffHours / 24));
        }
      } catch (_) {}
      const targetStayDays = Math.max(declaredStayDays, liveStayDays);

      const rawDaily = Number(room.room_rate || room.room_price || 0);
      const dailyBase = (rawDaily > 0 && rawDaily < 50000) ? rawDaily : (Number(room.room_price) || 2400);
      const mp = String(room.meal_plan || '').toLowerCase();
      const hasBf = (mp === 'with_breakfast' || mp === 'breakfast' || (mp.includes('breakfast') && !mp.includes('without')));
      const bfPax = hasBf ? Math.max(1, (room.adults_male || 0) + (room.adults_female || 0)) : 0;
      const bfDaily = hasBf ? (bfPax * (Number(room.breakfast_price) || 250)) : 0;
      const extraMattressDaily = Number(room.extra_bed_charge || 0);

      const decBaseTariff = targetStayDays * dailyBase;
      const decExtraMattressCost = targetStayDays * extraMattressDaily;
      const decBreakfastCost = targetStayDays * bfDaily;
      const decPreTaxGross = decBaseTariff + decExtraMattressCost + decBreakfastCost + extensionCharge;

      const discountPct = Number(room.discount_pct || 0);
      let decDiscountAmount = discountPct > 0
        ? Math.round((decPreTaxGross * discountPct) / 100)
        : Number(room.discount_amount || 0);

      if (targetStayDays > 1 && discountPct === 0 && Number(room.discount_amount || 0) > 0) {
        decDiscountAmount = Math.round(Number(room.discount_amount || 0) * targetStayDays);
      }

      const decPreTaxRoom = decPreTaxGross - decDiscountAmount;
      const roomGst = Math.round(decPreTaxRoom * 0.05);
      const decRoomCharge = decPreTaxRoom + roomGst;

      const roomTotal = decRoomCharge > 0 ? decRoomCharge : Number(room.total_room_charge || 0);
      const grandTotal = Math.round(roomTotal + foodTotal + barTotal + extraTotal);
      const paidTotal = Math.round(Number(room.total_paid || room.advance_payment || 0));
      const pendingTotal = Math.max(0, grandTotal - paidTotal);

      const folioSummary = {
        roomCharge: roomTotal,
        tariffSubtotal: Number(decBaseTariff + decExtraMattressCost + decBreakfastCost),
        restaurant: foodTotal,
        bar: barTotal,
        foodTotal,
        barTotal,
        extra: extraTotal,
        total: grandTotal,
        grandTotal,
        paid: paidTotal,
        pending: pendingTotal,
        stayCalcDeclared: {
          roomCharge: roomTotal,
          grandTotal,
          paid: paidTotal,
          balanceDue: pendingTotal,
          refundDue: Math.max(0, paidTotal - grandTotal),
          stayDurationStr: `${targetStayDays} day${targetStayDays > 1 ? 's' : ''}`,
          chargedDays: targetStayDays,
          expectedNights: targetStayDays
        },
        stayCalcNow: {
          roomCharge: (liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05),
          grandTotal: (liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05) + foodTotal + barTotal + extraTotal,
          paid: paidTotal,
          balanceDue: Math.max(0, ((liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05) + foodTotal + barTotal + extraTotal) - paidTotal),
          refundDue: Math.max(0, paidTotal - ((liveStayDays * dailyBase) + Math.round((liveStayDays * dailyBase) * 0.05) + foodTotal + barTotal + extraTotal)),
          stayDurationStr: `${liveStayDays} day${liveStayDays > 1 ? 's' : ''}`,
          chargedDays: liveStayDays
        },
        voucherNumber: room.voucher_number || `BK-${roomNum}`,
        guestName: room.guest_name,
        mobile: room.guest_mobile,
        email: room.guest_email || '',
        address: room.guest_address || '',
        dob: room.guest_dob || '',
        docType: room.guest_doc_type || 'Aadhaar Card',
        aadharNumber: room.guest_aadhar || '',
        roomType: room.room_type || 'Standard',
        adults: totalAdults,
        adultsMale: room.adults_male || 0,
        adultsFemale: room.adults_female || 0,
        children: room.children || 0,
        mealPlan: room.meal_plan || 'without_breakfast',
        bookingSource: room.booking_source || 'Walk-in',
        checkedInBy: room.checked_in_by || 'Front Desk',
        checkinTime: room.checkin_time || '',
        approxCheckout: room.approx_checkout_time || '',
        payments: payments.map(p => ({
          receiptNo: p.receipt_no || 'CR52',
          amount: Number(p.amount || 0),
          mode: p.payment_mode || 'Cash',
          cashier: p.cashier_name || 'Staff',
          date: p.created_at || room.checkin_time,
          notes: p.notes || '',
          type: p.payment_type || 'advance'
        }))
      };

      const folioRef = firestore.collection('room_charges_inbox').doc(`folio_${roomNum}`);
      batch.set(folioRef, {
        id: `folio_${roomNum}`,
        room_number: roomNum,
        room_id: room.room_id,
        department: 'room_folio',
        bill_no: room.voucher_number || `BK-${roomNum}`,
        subtotal: roomTotal,
        gst: roomGst,
        grand_total: grandTotal,
        settled_by: 'System',
        status: pendingTotal <= 0 ? 'settled' : 'due',
        items_summary: JSON.stringify(folioSummary),
        created_at: room.checkin_time || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { merge: true });
    }

    await withTimeout(batch.commit());
    console.log(`🔥 [Firebase] Synced ${activeRooms.length} active room(s) with folios to Firestore.`);
  } catch (err) {
    console.warn('[Firebase] syncAllActiveRoomsFromLocal error:', err.message);
  }
}

/**
 * Synchronize staff users and credentials to Firebase Firestore collection `staff_users`
 */
async function syncStaffUsersToCloud(db) {
  if (!firestore || !db) return;
  try {
    const staffList = db.prepare(`
      SELECT id, username, password, plain_password, full_name, role, phone, status, can_access_manager, updated_at
      FROM staff_users
    `).all();

    if (!staffList || staffList.length === 0) return;

    const batch = firestore.batch();
    for (const s of staffList) {
      const docRef = firestore.collection('staff_users').doc(String(s.id));
      batch.set(docRef, {
        id: s.id,
        username: s.username,
        full_name: s.full_name || '',
        role: s.role || 'hospitality',
        phone: s.phone || '',
        plain_password: s.plain_password || '',
        status: s.status || 'active',
        can_access_manager: Boolean(s.can_access_manager == 1 || s.role === 'manager'),
        updated_at: s.updated_at || new Date().toISOString()
      }, { merge: true });
    }

    await withTimeout(batch.commit());
    console.log(`🔥 [Firebase] Synced ${staffList.length} staff account(s) to Firestore staff_users.`);
  } catch (err) {
    console.warn('[Firebase] syncStaffUsersToCloud error:', err.message);
  }
}

/**
 * Synchronize live restaurant & bar menus, tables, and active occupied rooms into Firebase Firestore.
 * Stored as a single consolidated package document to minimize Firestore read counts!
 */
async function syncWaiterDataToCloud(db) {
  if (!firestore || !db) return;
  try {
    const resMenu = db.prepare("SELECT id, name, category, price, is_available, is_veg FROM menu_items WHERE department = 'restaurant' AND is_available = 1").all();
    const resCats = db.prepare("SELECT * FROM restaurant_categories").all();
    const barMenu = db.prepare("SELECT id, name, category, price, is_available, is_veg FROM menu_items WHERE department = 'bar' AND is_available = 1").all();
    const barCats = db.prepare("SELECT * FROM bar_categories").all();
    const resTables = db.prepare("SELECT id, table_number, table_type, capacity, status, active_cart_json, printed_cart_json, kot_count, token_number, waiter_name, special_notes, order_started_at, customer_name, customer_phone FROM restaurant_tables").all();
    const barTables = db.prepare("SELECT id, table_number, table_type, capacity, status, active_cart_json, printed_cart_json, bot_count, token_number, waiter_name, special_notes, order_started_at, customer_name, customer_phone FROM bar_tables").all();
    const staff = db.prepare("SELECT id, username, password, full_name, role, phone FROM staff_users WHERE status = 'active'").all();
    
    let occRooms = [];
    try {
      occRooms = db.prepare(`
        SELECT r.id, r.room_number, r.status, g.name as guest_name, g.mobile as guest_phone, b.id as booking_id 
        FROM rooms r 
        JOIN bookings b ON (r.current_booking_id = b.id OR b.room_id = r.id) 
        JOIN guests g ON b.guest_id = g.id 
        WHERE b.status = 'active' OR r.status = 'occupied'
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

    const pkgJson = JSON.stringify(pkg);

    // 1. Write to room_charges_inbox (00000000-0000-0000-0000-000000000088)
    const pkgPayload = {
      id: '00000000-0000-0000-0000-000000000088',
      department: 'waiter_cloud_sync_pkg',
      items_summary: pkgJson,
      status: 'active',
      updated_at: new Date().toISOString()
    };
    await withTimeout(firestore.collection('room_charges_inbox').doc('00000000-0000-0000-0000-000000000088').set(pkgPayload, { merge: true }));
    await withTimeout(firestore.collection('room_charges_inbox').doc('waiter_cloud_sync_pkg').set({ ...pkgPayload, id: 'waiter_cloud_sync_pkg' }, { merge: true }));

    // 2. Also write to sync_meta/waiter_pkg for versioned listening
    const metaRef = firestore.collection('sync_meta').doc('waiter_pkg');
    await withTimeout(metaRef.set({
      pkgJson,
      version: Date.now(),
      updated_at: new Date().toISOString()
    }, { merge: true }));

    updateLiveState('waiter_tables').catch(() => {});
    console.log('🔥 [Firebase] Synced live Waiter & Guest dining package to Firestore.');
  } catch (err) {
    console.warn('[Firebase] syncWaiterDataToCloud error:', err.message);
  }
}

// ==========================================
// 6. REALTIME LISTENERS (Zero-Polling)
// ==========================================
let realtimeUnsubscribe = null;
let realtimeStaffUnsubscribe = null;
let realtimeStoreBillsUnsubscribe = null;
let realtimeStorePaymentsUnsubscribe = null;

function setupRealtimeListeners(db, onNewPendingOrder = null) {
  if (!firestore) return;

  // 1. Room Charges & Folio Deletions Listener
  if (!realtimeUnsubscribe) {
    try {
      const q = firestore.collection('room_charges_inbox');
      realtimeUnsubscribe = q.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          const doc = change.doc;
          const data = doc.data() || {};

          // A) Pending Order, Cancellation, Pre-bill, or Settlement from Waiter Panel / Guest
          if ((change.type === 'added' || change.type === 'modified') && data.status === 'pending') {
            const socketServer = require('./socketServer');

            // 1. Waiter Cancellation from Mobile Waiter Panel (Void Table or Void Order)
            if (data.department === 'waiter_kot_cancel') {
              try {
                let cancelInfo = {};
                try { cancelInfo = JSON.parse(data.items_summary || '{}'); } catch (_) {}
                const dept = (cancelInfo.department || 'restaurant').toLowerCase();
                const tableName = dept === 'bar' ? 'bar_tables' : 'restaurant_tables';
                const countCol = dept === 'bar' ? 'bot_count' : 'kot_count';
                const ordTable = dept === 'bar' ? 'bar_orders' : 'restaurant_orders';
                const action = cancelInfo.action || 'cancel_table';
                const tId = cancelInfo.table_id || data.room_id;
                const tNum = String(cancelInfo.table_number || data.room_number || '').trim();

                if (action === 'cancel_order') {
                  const orderId = cancelInfo.order_id || data.order_id;
                  const ordNum = cancelInfo.order_number || data.bill_no;
                  if (orderId || ordNum) {
                    try {
                      const ord = db.prepare(`SELECT * FROM ${ordTable} WHERE id = ? OR order_number = ?`).get(orderId, ordNum);
                      if (ord) {
                        db.prepare(`UPDATE ${ordTable} SET status = 'cancelled' WHERE id = ?`).run(ord.id);
                        console.log(`🗑️ [Firebase Realtime] Cancelled ${ordTable} #${ord.order_number || ord.id}`);
                        socketServer.broadcast('ORDERS_UPDATED', { orderId: ord.id, status: 'cancelled' });
                      }
                    } catch (_) {}
                  }
                }

                // Look up target table
                let targetTable = null;
                if (tId) {
                  try { targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(tId); } catch (_) {}
                }
                if (!targetTable && tNum) {
                  try {
                    targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE table_number = ? OR table_number = ? OR table_number = ?`).get(
                      tNum,
                      tNum.replace(/^Table\s*/i, 'T'),
                      tNum.replace(/^Table\s*/i, '')
                    );
                  } catch (_) {}
                }

                if (targetTable) {
                  const isTemp = targetTable.table_type === 'parcel' ||
                                 targetTable.table_type === 'room_service' ||
                                 String(targetTable.table_number).startsWith('RS-') ||
                                 String(targetTable.table_number).startsWith('P-') ||
                                 String(targetTable.table_number).startsWith('BP-');

                  if (isTemp) {
                    db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(targetTable.id);
                    console.log(`🗑️ [Firebase Realtime] Deleted temp ${targetTable.table_type} table ${targetTable.table_number} on waiter cancellation.`);
                  } else {
                    db.prepare(`
                      UPDATE ${tableName}
                      SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]',
                          ${countCol} = 0, token_number = 0, order_started_at = NULL,
                          waiter_name = '', special_notes = '', customer_name = '', customer_phone = ''
                      WHERE id = ?
                    `).run(targetTable.id);
                    console.log(`🗑️ [Firebase Realtime] Reset table ${targetTable.table_number} to available on waiter cancellation.`);
                  }

                  // Cancel running uncompleted orders for this table
                  try {
                    db.prepare(`UPDATE ${ordTable} SET status = 'cancelled' WHERE (table_number = ? OR table_id = ?) AND status NOT IN ('completed', 'cancelled')`).run(targetTable.table_number, targetTable.id);
                  } catch (_) {}

                  socketServer.broadcast(dept === 'bar' ? 'BAR_UPDATED' : 'TABLES_UPDATED', {
                    tableId: targetTable.id,
                    tableNumber: targetTable.table_number,
                    status: 'available',
                    action: 'cancel'
                  });
                } else if (tNum) {
                  // Fallback by table_number
                  if (tNum.startsWith('RS-') || tNum.startsWith('P-') || tNum.startsWith('BP-')) {
                    db.prepare(`DELETE FROM ${tableName} WHERE table_number = ?`).run(tNum);
                  } else {
                    db.prepare(`
                      UPDATE ${tableName}
                      SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]',
                          ${countCol} = 0, token_number = 0, order_started_at = NULL,
                          waiter_name = '', special_notes = '', customer_name = '', customer_phone = ''
                      WHERE table_number = ? OR table_number = ?
                    `).run(tNum, tNum.replace(/^Table\s*/i, 'T'));
                  }
                  socketServer.broadcast(dept === 'bar' ? 'BAR_UPDATED' : 'TABLES_UPDATED', {
                    tableNumber: tNum,
                    status: 'available',
                    action: 'cancel'
                  });
                }

                if (typeof syncWaiterDataToCloud === 'function') {
                  syncWaiterDataToCloud(db).catch(() => {});
                }

                doc.ref.update({ status: 'cancelled_at_crm' }).catch(() => {});
              } catch (cancelErr) {
                console.warn('[Firebase Realtime] Error processing waiter cancellation:', cancelErr.message);
              }
            }

            // 2. Pre-Bill Request from Waiter Panel
            let parsedInfo = {};
            try { parsedInfo = JSON.parse(data.items_summary || '{}'); } catch (_) {}
            const isPrebill = parsedInfo.notes === 'PREBILL_REQUEST' || String(data.bill_no).startsWith('PREBILL-');
            if (isPrebill) {
              try {
                const dept = (parsedInfo.department || 'restaurant').toLowerCase();
                const tableName = dept === 'bar' ? 'bar_tables' : 'restaurant_tables';
                const destLabel = String(parsedInfo.destination_label || data.room_number || '').trim();
                const tId = parsedInfo.destination_id || data.room_id;

                let targetTable = null;
                if (tId) {
                  try { targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(tId); } catch (_) {}
                }
                if (!targetTable && destLabel) {
                  try {
                    targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE table_number = ? OR table_number = ? OR table_number = ?`).get(
                      destLabel,
                      destLabel.replace(/^Table\s*/i, 'T'),
                      destLabel.replace(/^Table\s*/i, '')
                    );
                  } catch (_) {}
                }

                if (targetTable) {
                  let currentCart = [];
                  try { currentCart = JSON.parse(targetTable.active_cart_json || '[]'); } catch (_) {}
                  if (currentCart.length === 0) {
                    try { currentCart = JSON.parse(targetTable.printed_cart_json || '[]'); } catch (_) {}
                  }

                  if (currentCart.length > 0) {
                    db.prepare(`UPDATE ${tableName} SET status = 'billed' WHERE id = ?`).run(targetTable.id);
                    const subtotal = currentCart.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
                    const restGstPct = dept === 'bar' ? 10 : 5;
                    const tax = Math.round(subtotal * (restGstPct / 100));
                    const grandTotal = subtotal + tax;

                    if (typeof global.enqueuePrintJob === 'function') {
                      global.enqueuePrintJob('prebill', {
                        tableNumber: targetTable.table_number,
                        tokenNumber: targetTable.token_number || 1,
                        items: currentCart,
                        subtotal,
                        tax,
                        grandTotal,
                        department: dept,
                        timestamp: new Date().toISOString()
                      });
                    }

                    console.log(`🧾 [Firebase Realtime] Pre-bill generated for ${targetTable.table_number}`);
                    socketServer.broadcast(dept === 'bar' ? 'BAR_UPDATED' : 'TABLES_UPDATED', {
                      tableId: targetTable.id,
                      tableNumber: targetTable.table_number,
                      status: 'billed',
                      orderType: targetTable.table_type
                    });

                    if (typeof syncWaiterDataToCloud === 'function') {
                      syncWaiterDataToCloud(db).catch(() => {});
                    }
                  }
                }
                doc.ref.update({ status: 'prebilled_at_crm' }).catch(() => {});
              } catch (pbErr) {
                console.warn('[Firebase Realtime] Error processing prebill request:', pbErr.message);
              }
            }

            // 3. Mobile Settlement from Waiter Panel
            if (String(data.bill_no).startsWith('SETTLE-')) {
              try {
                let settleData = {};
                try { settleData = JSON.parse(data.items_summary || '{}'); } catch (_) {}
                const dept = (data.department || settleData.department || 'restaurant').toLowerCase();
                const tableName = dept === 'bar' ? 'bar_tables' : 'restaurant_tables';
                const countCol = dept === 'bar' ? 'bot_count' : 'kot_count';
                const ordTable = dept === 'bar' ? 'bar_orders' : 'restaurant_orders';
                const tNum = String(settleData.table_number || data.room_number || '').trim();
                const tId = settleData.destinationId || settleData.table_id || data.room_id;

                let targetTable = null;
                if (tId) {
                  try { targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(tId); } catch (_) {}
                }
                if (!targetTable && tNum) {
                  try {
                    targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE table_number = ? OR table_number = ? OR table_number = ?`).get(
                      tNum,
                      tNum.replace(/^Table\s*/i, 'T'),
                      tNum.replace(/^Table\s*/i, '')
                    );
                  } catch (_) {}
                }

                let items = Array.isArray(settleData.items) && settleData.items.length > 0 ? settleData.items : [];
                if (items.length === 0 && targetTable) {
                  try { items = JSON.parse(targetTable.active_cart_json || '[]'); } catch (_) {}
                  if (items.length === 0) {
                    try { items = JSON.parse(targetTable.printed_cart_json || '[]'); } catch (_) {}
                  }
                }

                const subtotal = Number(data.subtotal || settleData.subtotal || 0);
                const gst = Number(data.gst || settleData.gst || 0);
                const grandTotal = Number(data.grand_total || settleData.grand_total || 0);
                const paymentMode = (settleData.payment_mode || settleData.paymentMode || 'cash').toLowerCase();
                const waiterName = settleData.waiter_name || data.settled_by || 'Captain';
                const custName = settleData.customer_name || (targetTable ? targetTable.customer_name : '') || `Table ${tNum}`;
                const orderNumber = (dept === 'bar' ? 'BAR-' : 'RES-') + Date.now().toString().slice(-6);
                const isPaid = (paymentMode === 'room_folio' || paymentMode === 'room') ? 0 : 1;

                const insertRes = db.prepare(`
                  INSERT INTO ${ordTable} (
                    order_number, customer_name, order_type, table_number, table_id,
                    waiter_name, items_json, subtotal, tax, total, payment_mode, is_paid, status, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now', 'localtime'))
                `).run(
                  orderNumber,
                  custName,
                  targetTable ? (targetTable.table_type === 'parcel' ? 'parcel' : (targetTable.table_type === 'room_service' ? 'room' : 'table')) : 'table',
                  tNum || (targetTable ? targetTable.table_number : 'Table'),
                  targetTable ? targetTable.id : null,
                  waiterName,
                  JSON.stringify(items),
                  subtotal,
                  gst,
                  grandTotal,
                  paymentMode,
                  isPaid
                );

                // Instantly enqueue bill thermal receipt on CRM PC printer
                if (typeof global.enqueuePrintJob === 'function') {
                  global.enqueuePrintJob('bill', {
                    department: dept,
                    tableNumber: tNum || (targetTable ? targetTable.table_number : 'Table'),
                    order: {
                      id: insertRes ? insertRes.lastInsertRowid : null,
                      orderNumber,
                      order_number: orderNumber,
                      token_number: targetTable?.token_number || 1,
                      table_number: tNum || (targetTable ? targetTable.table_number : 'Table'),
                      customer_name: custName,
                      customerName: custName,
                      waiter_name: waiterName,
                      items,
                      subtotal,
                      tax: gst,
                      total: grandTotal,
                      grand_total: grandTotal,
                      payment_mode: paymentMode,
                      paymentMode: paymentMode,
                      is_paid: isPaid,
                      settled_at: new Date().toISOString()
                    }
                  });
                  console.log(`🖨️ [Firebase Realtime] Enqueued bill print job on CRM for ${tNum}: ${orderNumber}`);
                }

                if (targetTable) {
                  const isTemp = targetTable.table_type === 'parcel' ||
                                 targetTable.table_type === 'room_service' ||
                                 String(targetTable.table_number).startsWith('RS-') ||
                                 String(targetTable.table_number).startsWith('P-') ||
                                 String(targetTable.table_number).startsWith('BP-');

                  if (isTemp) {
                    db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(targetTable.id);
                  } else {
                    db.prepare(`
                      UPDATE ${tableName}
                      SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]',
                          ${countCol} = 0, token_number = 0, order_started_at = NULL,
                          waiter_name = '', special_notes = '', customer_name = '', customer_phone = ''
                      WHERE id = ?
                    `).run(targetTable.id);
                  }

                  socketServer.broadcast(dept === 'bar' ? 'BAR_UPDATED' : 'TABLES_UPDATED', {
                    tableId: targetTable.id,
                    tableNumber: targetTable.table_number,
                    status: 'available',
                    action: 'settle'
                  });
                } else if (tNum) {
                  socketServer.broadcast(dept === 'bar' ? 'BAR_UPDATED' : 'TABLES_UPDATED', {
                    tableNumber: tNum,
                    status: 'available',
                    action: 'settle'
                  });
                }

                if (typeof syncWaiterDataToCloud === 'function') {
                  syncWaiterDataToCloud(db).catch(() => {});
                }

                doc.ref.update({ status: 'settled_at_crm' }).catch(() => {});
                console.log(`💰 [Firebase Realtime] Processed mobile settlement for ${tNum}: ${orderNumber}`);
              } catch (settleErr) {
                console.warn('[Firebase Realtime] Error processing mobile settlement:', settleErr.message);
              }
            }

            // 4. Waiter KOT / BOT Order arrival from Waiter APK or Guest In-Room Dining
            if (!isPrebill && !String(data.bill_no).startsWith('SETTLE-') && (data.department === 'waiter_kot_order' || data.is_guest_web || data.waiter_name === 'Guest In-Room Mobile')) {
              try {
                let orderData = {};
                try { orderData = JSON.parse(data.items_summary || '{}'); } catch (_) {}
                const items = Array.isArray(orderData.items) ? orderData.items : [];

                if (items.length > 0) {
                  const isGuestMobile = orderData.source === 'guest_inroom_mobile' || 
                                        orderData.waiter_name === 'Guest In-Room Mobile' || 
                                        data.department === 'guest_inroom_order' ||
                                        orderData.is_guest_web;

                  if (isGuestMobile) {
                    const cleanRoomNum = String(orderData.room_number || data.room_number || 'Room')
                      .replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim();

                    const existingGuestOrder = db.prepare('SELECT id FROM guest_inroom_orders WHERE cloud_inbox_id = ? OR order_number = ?').get(String(doc.id), data.bill_no);
                    if (!existingGuestOrder) {
                      let batchNumber = 1;
                      try {
                        const countRow = db.prepare('SELECT COUNT(*) as count FROM guest_inroom_orders WHERE room_numbers = ? OR room_numbers LIKE ?').get(cleanRoomNum, `%${cleanRoomNum}%`);
                        batchNumber = (countRow?.count || 0) + 1;
                      } catch (_) {}

                      const custName = orderData.customer_name || data.settled_by || `Room ${cleanRoomNum}`;
                      const grandTotal = Number(data.grand_total || 0);

                      db.prepare(`
                        INSERT INTO guest_inroom_orders (
                          order_number, token, booking_id, room_numbers, guest_name, guest_phone,
                          batch_number, items_json, notes, subtotal, tax, grand_total, status, kot_printed, cloud_inbox_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_kitchen', 0, ?)
                      `).run(
                        data.bill_no || `RS-${cleanRoomNum}-B${batchNumber}-${Date.now().toString().slice(-4)}`,
                        orderData.token || '',
                        orderData.bookingId || 0,
                        cleanRoomNum,
                        custName,
                        orderData.customer_phone || '',
                        batchNumber,
                        JSON.stringify(items),
                        orderData.notes || '',
                        Number(data.subtotal || 0),
                        Number(data.gst || 0),
                        grandTotal,
                        String(doc.id)
                      );
                      console.log(`🔥 [Firebase Realtime] 🛎️ Guest Food Order received for Room ${cleanRoomNum} (Batch #${batchNumber})!`);

                      // Broadcast WebSocket alert to Restaurant POS immediately!
                      socketServer.broadcast('GUEST_ORDERS_UPDATED', { roomNumber: cleanRoomNum });
                    }

                    // Acknowledge in Firestore
                    doc.ref.update({ status: 'received_at_crm' }).catch(() => {});
                  } else {
                    // Waiter KOT Table, Room Service, or Takeaway Parcel Order
                    const dept = (orderData.department || 'restaurant').toLowerCase();
                    const destType = (orderData.destination_type || 'table').toLowerCase();
                    const destLabel = String(orderData.destination_label || data.room_number || '').trim();
                    const waiterName = orderData.waiter_name || data.settled_by || 'Captain';
                    const notes = orderData.notes || '';
                    const custName = orderData.customer_name || '';
                    const custPhone = orderData.customer_phone || '';
                    const tableName = dept === 'bar' ? 'bar_tables' : 'restaurant_tables';

                    const countCol = dept === 'bar' ? 'bot_count' : 'kot_count';
                    let targetTable = null;

                    if (destType === 'room' || destLabel.startsWith('RS-') || /Room\s*\d+/i.test(destLabel)) {
                      // 1. Room Service Order
                      const cleanRoomNum = String(orderData.room_number || destLabel || orderData.destination_id || '')
                        .replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim();
                      const rsTableNum = `RS-${cleanRoomNum}`;

                      targetTable = db.prepare(`
                        SELECT * FROM ${tableName} 
                        WHERE table_number = ? 
                           OR table_number = ? 
                           OR special_notes LIKE ?
                      `).get(rsTableNum, `RS-Room ${cleanRoomNum}`, `%Room ${cleanRoomNum}%`);

                      if (!targetTable) {
                        const roomRow = db.prepare('SELECT id FROM rooms WHERE room_number = ?').get(cleanRoomNum);
                        let guestName = custName || orderData.guest_name || '';
                        if (!guestName) {
                          try {
                            const bRow = db.prepare('SELECT g.name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = (SELECT current_booking_id FROM rooms WHERE room_number = ?)').get(cleanRoomNum);
                            guestName = bRow?.name || `Room ${cleanRoomNum} Guest`;
                          } catch (_) {
                            guestName = `Room ${cleanRoomNum} Guest`;
                          }
                        }
                        const insRes = db.prepare(`
                          INSERT INTO ${tableName} (table_number, table_type, capacity, room_id, status, waiter_name, special_notes, customer_name, customer_phone, active_cart_json, printed_cart_json, ${countCol}, order_started_at)
                          VALUES (?, 'room_service', 2, ?, 'occupied', ?, ?, ?, ?, '[]', '[]', 0, datetime('now', 'localtime'))
                        `).run(
                          rsTableNum,
                          roomRow?.id || orderData.destination_id || null,
                          waiterName,
                          `Room ${cleanRoomNum} (${guestName})`,
                          guestName,
                          custPhone
                        );
                        targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(insRes.lastInsertRowid);
                        console.log(`🛎️ [Firebase Realtime] Auto-created Room Service Table ${rsTableNum} in ${tableName} for Waiter ${waiterName}`);
                      }
                    } else if (destType === 'parcel' || destLabel.startsWith('P-') || destLabel.startsWith('BP-') || /Parcel/i.test(destLabel)) {
                      // 2. Takeaway Parcel Order
                      const cleanParcelNum = String(destLabel || orderData.destination_id || '')
                        .match(/\d+/)?.[0] || String(orderData.destination_id || Date.now().toString().slice(-3));
                      const parcelTableNum = dept === 'bar' ? `BP-${cleanParcelNum}` : `P-${cleanParcelNum}`;

                      targetTable = db.prepare(`
                        SELECT * FROM ${tableName} 
                        WHERE table_number = ? 
                           OR (table_type = 'parcel' AND (table_number LIKE ? OR id = ?))
                      `).get(parcelTableNum, `%${cleanParcelNum}`, orderData.destination_id);

                      if (!targetTable) {
                        const insRes = db.prepare(`
                          INSERT INTO ${tableName} (table_number, table_type, capacity, status, waiter_name, special_notes, customer_name, customer_phone, active_cart_json, printed_cart_json, ${countCol}, order_started_at)
                          VALUES (?, 'parcel', 1, 'in_process', ?, ?, ?, ?, '[]', '[]', 0, datetime('now', 'localtime'))
                        `).run(
                          parcelTableNum,
                          waiterName,
                          `Takeaway Parcel #${cleanParcelNum}`,
                          custName || `Parcel #${cleanParcelNum}`,
                          custPhone
                        );
                        targetTable = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(insRes.lastInsertRowid);
                        console.log(`📦 [Firebase Realtime] Auto-created Takeaway Parcel Table ${parcelTableNum} in ${tableName} for Waiter ${waiterName}`);
                      }
                    } else {
                      // 3. Dine-In Table Order
                      targetTable = db.prepare(`
                        SELECT * FROM ${tableName} 
                        WHERE id = ? 
                           OR table_number = ? 
                           OR table_number = ? 
                           OR table_number = ?
                      `).get(
                        orderData.destination_id, 
                        destLabel, 
                        destLabel.replace(/^Table\s*/i, 'T'), 
                        destLabel.replace(/^Table\s*/i, '')
                      );
                    }

                    if (targetTable) {
                      let currentCart = [];
                      try { currentCart = JSON.parse(targetTable.active_cart_json || '[]'); } catch (_) {}
                      const nowIso = new Date().toISOString();
                      for (const it of items) {
                        const existingIdx = currentCart.findIndex(c => String(c.id) === String(it.id));
                        if (existingIdx >= 0) {
                          currentCart[existingIdx].qty = (Number(currentCart[existingIdx].qty) || 1) + (Number(it.qty || it.quantity) || 1);
                        } else {
                          currentCart.push({ ...it, qty: Number(it.qty || it.quantity) || 1, added_at: nowIso });
                        }
                      }
                      const countCol = dept === 'bar' ? 'bot_count' : 'kot_count';
                      const kotCount = ((targetTable[countCol]) || 0) + 1;
                      const assignedToken = targetTable.token_number || kotCount;
                      const nextStatus = targetTable.table_type === 'parcel' ? (targetTable.status === 'ready' ? 'ready' : 'in_process') : 'occupied';

                      db.prepare(`
                        UPDATE ${tableName}
                        SET active_cart_json = ?, printed_cart_json = ?, ${countCol} = ?,
                            status = ?, waiter_name = ?, special_notes = ?,
                            customer_name = CASE WHEN ? <> '' THEN ? ELSE customer_name END,
                            customer_phone = CASE WHEN ? <> '' THEN ? ELSE customer_phone END,
                            order_started_at = COALESCE(order_started_at, datetime('now', 'localtime'))
                        WHERE id = ?
                      `).run(JSON.stringify(currentCart), JSON.stringify(currentCart), kotCount, nextStatus, waiterName, notes, custName, custName, custPhone, custPhone, targetTable.id);

                      // Auto-enqueue KOT / BOT print job (broadcasts via WebSocket in <10ms!)
                      if (typeof global.enqueuePrintJob === 'function') {
                        global.enqueuePrintJob(dept === 'bar' ? 'bot' : 'kot', {
                          tableNumber: targetTable.table_number,
                          tokenNumber: assignedToken,
                          waiterName,
                          notes,
                          customerName: custName,
                          kot: { kotNumber: kotCount, tokenNumber: assignedToken, items },
                          items,
                          department: dept,
                          timestamp: nowIso
                        });
                      }

                      // Broadcast WebSocket table update immediately to CRM frontend
                      socketServer.broadcast(dept === 'bar' ? 'BAR_UPDATED' : 'TABLES_UPDATED', { 
                        tableId: targetTable.id, 
                        tableNumber: targetTable.table_number,
                        status: nextStatus,
                        waiterName,
                        orderType: destType
                      });

                      // Sync updated package back to cloud so other waiters see table locked/occupied instantly
                      if (typeof syncWaiterDataToCloud === 'function') {
                        syncWaiterDataToCloud(db).catch(() => {});
                      }
                    }

                    // Acknowledge in Firestore
                    doc.ref.update({ status: 'printed' }).catch(() => {});
                  }
                }
              } catch (kotProcErr) {
                console.warn('[Firebase Realtime] Error processing KOT order:', kotProcErr.message);
              }
            }

            if (typeof onNewPendingOrder === 'function') {
              onNewPendingOrder({ id: doc.id, ...data });
            }
          }

          // B) Deletion / Cancellation adopted into local SQLite
          if (change.type === 'removed' || data.status === 'deleted' || data.status === 'cancelled' || data.is_deleted === true) {
            try {
              let affected = 0;
              if (data.bill_no) {
                const r1 = db.prepare('DELETE FROM restaurant_orders WHERE order_number = ?').run(data.bill_no);
                const r2 = db.prepare('DELETE FROM bar_orders WHERE order_number = ?').run(data.bill_no);
                affected += (r1.changes + r2.changes);
              }
              if (data.id && !isNaN(Number(data.id))) {
                const r3 = db.prepare('DELETE FROM restaurant_orders WHERE id = ?').run(data.id);
                const r4 = db.prepare('DELETE FROM bar_orders WHERE id = ?').run(data.id);
                affected += (r3.changes + r4.changes);
              }
              const expId = data.expense_id || (String(doc.id).startsWith('EXP-') ? String(doc.id).replace(/^EXP-/, '') : null);
              if (expId) {
                const r5 = db.prepare('DELETE FROM booking_extra_expenses WHERE id = ?').run(expId);
                affected += r5.changes;
              }
              if (affected > 0) {
                console.log(`⚡ [Firebase Realtime] Adopted cloud charge deletion (${doc.id}): ${affected} record(s) removed.`);
                syncAllActiveRoomsFromLocal(db).catch(() => {});
              }
            } catch (adoptErr) {
              console.warn('[Firebase Realtime] Could not adopt charge deletion:', adoptErr.message);
            }
          }

          // C) Instant Approval Decision from Admin APK (Discount or Room Transfer Shift)
          const docId = String(doc.id || '');
          const isAppDoc = docId.startsWith('APP-') || data.department === 'discount_approval';
          const st = String(data.status || '').toLowerCase();
          if (isAppDoc && (st === 'approved' || st === 'rejected')) {
            const rawId = docId.replace(/^APP-/, '');
            const approvalId = !isNaN(Number(rawId)) ? Number(rawId) : rawId;
            if (approvalId) {
              try {
                const existing = db.prepare('SELECT status FROM owner_approvals WHERE id = ?').get(approvalId);
                if (existing && existing.status === 'PENDING') {
                  const notificationService = require('./notificationService');
                  notificationService.updateApprovalStatus(approvalId, st.toUpperCase(), data.settled_by || 'Admin', data.action_reason || '');
                  console.log(`⚡ [Firebase Realtime] Admin ${st.toUpperCase()} approval #${approvalId} adopted instantly!`);
                }
              } catch (appErr) {
                console.warn('[Firebase Realtime] Error adopting approval:', appErr.message);
              }
            }
          }
        });
      }, err => {
        console.warn('[Firebase] Room charges listener error:', err.message);
      });
      console.log('⚡ [Firebase Realtime] Connected! Listening for live pending orders & charge cancellations.');
    } catch (err) {
      console.warn('[Firebase] Could not setup room charges realtime listener:', err.message);
    }
  }

  // 2. Staff Users & Password Updates Listener (Adopt Admin changes into local SQLite)
  if (!realtimeStaffUnsubscribe) {
    try {
      const bcrypt = require('bcryptjs');
      const staffCol = firestore.collection('staff_users');
      realtimeStaffUnsubscribe = staffCol.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'modified' || change.type === 'added') {
            const data = change.doc.data();
            if (!data || !data.username) return;

            try {
              const cleanUser = String(data.username).trim().toLowerCase();
              const existing = db.prepare('SELECT id, password, plain_password FROM staff_users WHERE LOWER(username) = ?').get(cleanUser);
              
              if (data.plain_password && data.plain_password.trim().length > 0) {
                const newPlain = data.plain_password.trim();
                if (!existing || existing.plain_password !== newPlain) {
                  const newHash = bcrypt.hashSync(newPlain, 10);
                  if (existing) {
                    db.prepare(`
                      UPDATE staff_users 
                      SET password = ?, plain_password = ?, full_name = COALESCE(?, full_name), role = COALESCE(?, role), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
                      WHERE id = ?
                    `).run(newHash, newPlain, data.full_name || null, data.role || null, data.status || 'active', existing.id);
                    console.log(`⚡ [Firebase Realtime] Adopted updated password for staff: "${cleanUser}" into local SQLite.`);
                  } else {
                    db.prepare(`
                      INSERT INTO staff_users (username, password, plain_password, full_name, role, phone, status, can_access_manager)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(cleanUser, newHash, newPlain, data.full_name || cleanUser, data.role || 'hospitality', data.phone || '', data.status || 'active', data.can_access_manager ? 1 : 0);
                    console.log(`⚡ [Firebase Realtime] Adopted new staff member "${cleanUser}" into local SQLite.`);
                  }
                }
              }
            } catch (staffAdoptErr) {
              console.warn('[Firebase Realtime] Staff sync error:', staffAdoptErr.message);
            }
          }
        });
      }, err => {
        console.warn('[Firebase] Staff credentials listener error:', err.message);
      });
      console.log('⚡ [Firebase Realtime] Connected! Listening for live staff credential & password updates.');
    } catch (err) {
      console.warn('[Firebase] Could not setup staff realtime listener:', err.message);
    }
  }

  // 3. Store Purchase Bills Realtime Listener (Zero-Polling)
  if (!realtimeStoreBillsUnsubscribe) {
    try {
      const qStore = firestore.collection('store_bills');
      const seenStoreBillDocIds = new Set();
      realtimeStoreBillsUnsubscribe = qStore.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const docId = String(change.doc.id || '');
            if (seenStoreBillDocIds.has(docId)) return;
            seenStoreBillDocIds.add(docId);

            const data = change.doc.data() || {};
            const createdAtMs = data.created_at ? new Date(data.created_at).getTime() : 0;
            const isRecent = createdAtMs > 0 ? (Date.now() - createdAtMs < 5 * 60 * 1000) : true;
            if (isRecent && data.notified !== true && data.status !== 'notified_to_owner') {
              try {
                const notificationService = require('./notificationService');
                const vendorName = data.vendor_name || 'Vendor';
                const billNumber = data.invoice_no || data.bill_number || '';
                const amount = Number(data.total_amount || data.amount || 0);
                const paymentMode = data.payment_mode || 'Cash';
                const hasGst = Boolean(data.has_gst);
                notificationService.notifyStoreBill({
                  vendorName,
                  billNumber,
                  amount,
                  billId: docId,
                  paymentMode,
                  hasGst
                });
                console.log(`📦 [Firebase Realtime] Store Bill for ${vendorName} (${billNumber}) notified to Owner!`);
                change.doc.ref.update({ notified: true, status: 'notified_to_owner' }).catch(() => {});
              } catch (err) {
                console.warn('[Firebase Realtime] Error notifying store bill:', err.message);
              }
            }
          }
        });
      }, err => {
        console.warn('[Firebase] Store bills listener error:', err.message);
      });
      console.log('⚡ [Firebase Realtime] Connected! Listening for live Store Purchase Bills.');
    } catch (err) {
      console.warn('[Firebase] Could not setup store bills listener:', err.message);
    }
  }

  // 4. Store Vendor Payments Realtime Listener (Alerts Storeman Panel when Admin Pays)
  if (!realtimeStorePaymentsUnsubscribe) {
    try {
      const qPayments = firestore.collection('store_vendor_payments');
      // uses module-level seenPaymentDocIds
      realtimeStorePaymentsUnsubscribe = qPayments.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const docId = String(change.doc.id || '');
            if (seenPaymentDocIds.has(docId)) return;
            seenPaymentDocIds.add(docId);

            const data = change.doc.data() || {};
            const createdAtMs = (data.created_at || data.paid_at) ? new Date(data.created_at || data.paid_at).getTime() : 0;
            const isRecent = createdAtMs > 0 ? (Date.now() - createdAtMs < 5 * 60 * 1000) : true;
            if (isRecent) {
              try {
                const socketServer = require('./socketServer');
                const amt = Number(data.payment_amount || data.amount || 0);
                const vendorName = data.vendor_name || 'Vendor';
                const billId = data.bill_id || null;
                const payMode = data.payment_mode || 'Bank Transfer';
                const paidBy = data.paid_by || 'Admin';
                console.log(`💰 [Firebase Realtime] Payment of ₹${amt} by Admin recorded for ${vendorName}! Broadcasting to Storeman...`);
                socketServer.broadcast('STORE_PAYMENT_RECORDED', {
                  type: 'store_payment',
                  paymentId: docId,
                  vendorId: data.vendor_id || null,
                  vendorName: vendorName,
                  amount: amt,
                  paymentMode: payMode,
                  paidBy: paidBy,
                  referenceNo: data.reference_no || '',
                  billId: billId,
                  timestamp: new Date().toISOString()
                });
                socketServer.broadcast('STORE_UPDATED', { type: 'payment' });
                socketServer.broadcast('BILLS_UPDATED', { type: 'payment' });

                // 🔔 Dispatch FCM Push Notification to Storeman APK only if NOT already notified!
                if (data.notified !== true && data.status !== 'notified') {
                  try {
                    const notificationService = require('./notificationService');
                    notificationService.notifyStorePayment({
                      vendorName,
                      vendorId: data.vendor_id || null,
                      amount: amt,
                      paymentMode: payMode,
                      paidBy: paidBy,
                      referenceNo: data.reference_no || '',
                      billId: billId,
                      paymentId: docId
                    });
                    change.doc.ref.update({ notified: true, status: 'notified' }).catch(() => {});
                  } catch (npErr) {
                    console.warn('[Firebase Realtime] Store payment push error:', npErr.message);
                  }
                } else {
                  console.log(`[Firebase Realtime] Skipping push notification for payment ${docId} (already marked notified)`);
                }
              } catch (err) {
                console.warn('[Firebase Realtime] Error broadcasting store payment:', err.message);
              }
            }
          }
        });
      }, err => {
        console.warn('[Firebase] Store vendor payments listener error:', err.message);
      });
      console.log('⚡ [Firebase Realtime] Connected! Listening for live Admin Store Payments.');
    } catch (err) {
      console.warn('[Firebase] Could not setup store vendor payments listener:', err.message);
    }
  }
}

async function fetchApprovalStatusFromCloud(id) {
  if (!firestore || !id) return null;
  try {
    const docId = String(id).startsWith('APP-') ? String(id) : 'APP-' + id;
    const docSnap = await withTimeout(firestore.collection('room_charges_inbox').doc(docId).get(), 2000);
    if (docSnap && docSnap.exists) {
      return docSnap.data();
    }
  } catch (err) {
    // silent fallback
  }
  return null;
}

async function pollCloudApprovals(db) {
  if (!firestore || !db) return;
  try {
    const snap = await withTimeout(
      firestore.collection('room_charges_inbox')
        .where('department', '==', 'discount_approval')
        .get(),
      3000
    );
    if (!snap || snap.empty) return;
    const notificationService = require('./notificationService');
    snap.forEach(doc => {
      const data = doc.data() || {};
      const st = String(data.status || '').toLowerCase();
      if (st === 'approved' || st === 'rejected') {
        const rawId = String(doc.id).replace(/^APP-/, '');
        const approvalId = !isNaN(Number(rawId)) ? Number(rawId) : rawId;
        if (approvalId) {
          const existing = db.prepare('SELECT status FROM owner_approvals WHERE id = ?').get(approvalId);
          if (existing && existing.status === 'PENDING') {
            notificationService.updateApprovalStatus(approvalId, st.toUpperCase(), data.settled_by || 'Admin', data.action_reason || '');
            console.log(`[Firebase Heartbeat] Adopted approval #${approvalId} -> ${st.toUpperCase()}`);
          }
        }
      }
    });
  } catch (err) {
    // silent
  }
}

function stopRealtimeListeners() {
  if (realtimeUnsubscribe) {
    try { realtimeUnsubscribe(); } catch (_) {}
    realtimeUnsubscribe = null;
  }
  if (realtimeStaffUnsubscribe) {
    try { realtimeStaffUnsubscribe(); } catch (_) {}
    realtimeStaffUnsubscribe = null;
  }
  if (realtimeStoreBillsUnsubscribe) {
    try { realtimeStoreBillsUnsubscribe(); } catch (_) {}
    realtimeStoreBillsUnsubscribe = null;
  }
}

module.exports = {
  syncActiveOccupancy,
  removeActiveOccupancy,
  fetchActiveOccupancies,
  pushRoomCharge,
  deleteCloudRoomCharge,
  syncCheckoutToCloud,
  syncApprovalRequestToCloud,
  fetchApprovalStatusFromCloud,
  pollCloudApprovals,
  syncLiveFBStateToCloud,
  syncWaiterDataToCloud,
  syncStaffUsersToCloud,
  fetchPendingRoomCharges,
  markChargesImported,
  pushStoreVendor,
  pushStoreBill,
  deleteStoreBill,
  pushStorePayment,
  pushSystemSetting,
  syncDailyAnalyticsToCloud,
  syncAllActiveRoomsFromLocal,
  updateLiveState,
  setupRealtimeListeners,
  stopRealtimeListeners,
  isConfigured: () => Boolean(firestore)
};
