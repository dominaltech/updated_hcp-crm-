import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Dynamic Early Checkout & Refund Settlement Test Suite', () => {
  let hospitalityToken;
  let testRoomId1;
  let testRoomId2;

  beforeAll(async () => {
    hospitalityToken = generateToken({
      id: 9993,
      username: 'test_frontdesk_early',
      role: 'hospitality',
      full_name: 'Front Desk Officer',
      can_access_manager: 1
    });

    // Create or reset room 771 (₹2,000/night)
    let r1 = db.prepare("SELECT id FROM rooms WHERE room_number = '771'").get();
    if (!r1) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status, ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate) VALUES ('771', 'Deluxe AC', 2000, 'ready', 60, 500, 1000, 1500)").run();
      testRoomId1 = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL, price = 2000, ext_grace_mins = 60, ext_3h_rate = 500, ext_6h_rate = 1000, ext_9h_rate = 1500 WHERE id = ?").run(r1.id);
      testRoomId1 = r1.id;
    }

    // Create or reset room 772 (₹3,000/night)
    let r2 = db.prepare("SELECT id FROM rooms WHERE room_number = '772'").get();
    if (!r2) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status, ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate) VALUES ('772', 'Super Deluxe', 3000, 'ready', 60, 500, 1000, 1500)").run();
      testRoomId2 = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL, price = 3000, ext_grace_mins = 60, ext_3h_rate = 500, ext_6h_rate = 1000, ext_9h_rate = 1500 WHERE id = ?").run(r2.id);
      testRoomId2 = r2.id;
    }
  });

  it('1. Rule 1: Minimum 1-day rent charged when guest checks out within 1 hour (same day)', async () => {
    // Check in guest for 2 days
    const now = new Date();
    const checkinTime = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
    const expectedCheckout = new Date(now.getTime() + 47 * 60 * 60 * 1000).toISOString(); // 2 days total

    // Create guest & booking directly
    const guestRes = db.prepare("INSERT INTO guests (name, mobile, doc_type) VALUES (?, ?, 'Aadhaar')").run(`Rahul Sharma ${Date.now()}`, '9811122233');
    const guestId = guestRes.lastInsertRowid;

    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time, room_rate, total_room_charge,
        total_paid, split_cash, status
      ) VALUES (?, ?, ?, ?, 2000, 4000, 4000, 4000, 'active')
    `).run(testRoomId1, guestId, checkinTime, expectedCheckout);

    const bookingId = bookingRes.lastInsertRowid;
    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(bookingId, testRoomId1);

    // Call folio endpoint to verify stay calculation
    const folioRes = await request(app).get(`/api/rooms/${testRoomId1}/folio`);
    expect(folioRes.status).toBe(200);
    expect(folioRes.body.success).toBe(true);

    const summary = folioRes.body.folio?.summary;
    expect(summary).toBeDefined();
    // 1-hour stay (<24 hrs): chargedDays must be 1, recalculatedRoomCharge must be at least 1 day's rent (₹2,000)
    expect(summary.chargedDays).toBe(1);
    expect(summary.recalculatedRoomCharge).toBe(2000);
    expect(summary.isEarlyCheckout).toBe(true);
    // Paid ₹4,000 - recalculated ₹2,000 = refund of ₹2,000
    expect(summary.refundAmount).toBe(2000);

    // Clean up room
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId1);
  });

  it('2. Rule 2: Expected checkout 3 days, stayed 2 days & 3 hours -> charges 2 full days + 3h extension charge (₹500)', async () => {
    // Check in guest with expected checkout 3 days
    // Stayed 2 days + 3 hours = 51 hours elapsed
    const now = new Date();
    const checkinTime = new Date(now.getTime() - 51 * 60 * 60 * 1000).toISOString();
    const expectedCheckout = new Date(now.getTime() + 21 * 60 * 60 * 1000).toISOString(); // 72 hours total (3 days)

    const guestName = `Amit Verma ${Date.now()}`;
    const guestRes = db.prepare("INSERT INTO guests (name, mobile, doc_type) VALUES (?, ?, 'Aadhaar')").run(guestName, '9822233344');
    const guestId = guestRes.lastInsertRowid;

    // Room 771 is ₹2,000/day. 3 days booked = ₹6,000. Advance paid ₹6,000.
    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time, room_rate, total_room_charge,
        total_paid, split_online, status
      ) VALUES (?, ?, ?, ?, 2000, 6000, 6000, 6000, 'active')
    `).run(testRoomId1, guestId, checkinTime, expectedCheckout);

    const bookingId = bookingRes.lastInsertRowid;
    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(bookingId, testRoomId1);

    // Insert advance payment row with unique receipt_no
    const uniqRcpt = `RCP-ADV-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    db.prepare(`
      INSERT INTO payments (
        receipt_no, booking_id, room_id, department, payment_type, payment_mode,
        amount, cashier_name, notes
      ) VALUES (?, ?, ?, 'hospitality', 'advance', 'online', 6000, 'Front Desk', 'Advance 3 days payment')
    `).run(uniqRcpt, bookingId, testRoomId1);

    // Call folio endpoint
    const folioRes = await request(app).get(`/api/rooms/${testRoomId1}/folio`);
    expect(folioRes.status).toBe(200);
    expect(folioRes.body.success).toBe(true);

    const summary = folioRes.body.folio?.summary;
    expect(summary).toBeDefined();
    expect(summary.isEarlyCheckout).toBe(true);
    expect(summary.completedDays).toBe(2);
    expect(summary.earlyStayHours).toBe(3);
    expect(summary.earlyExtensionCharge).toBe(500); // 3h extension tier rate = ₹500
    // Recalculated room charge = (2 * 2000) + 500 = 4500
    expect(summary.recalculatedRoomCharge).toBe(4500);
    // Excess advance refund: ₹6,000 - ₹4,500 = ₹1,500
    expect(summary.refundAmount).toBe(1500);

    // Now execute checkout with Return Type = 'online' (UPI) with UTR
    const checkoutPayload = {
      recalculated_room_charge: 4500,
      refund_amount: 1500,
      return_mode: 'online',
      return_utr: 'UTR789012345678',
      refund_reason: 'Early checkout: Stayed 2 days & 3 hours instead of 3 days',
      checked_out_by: 'Front Desk Officer'
    };

    const checkoutRes = await request(app)
      .post(`/api/checkout/${testRoomId1}`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send(checkoutPayload);

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
    expect(checkoutRes.body.data.netRefund).toBe(1500);
    expect(checkoutRes.body.data.refund_mode).toBe('online');
    expect(checkoutRes.body.data.refundVoucherNo).toMatch(/^DEB-\d+/);

    const debVoucherNo = checkoutRes.body.data.refundVoucherNo;

    // Verify booking row was updated with refund details
    const updatedBooking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
    expect(updatedBooking.status).toBe('checked_out');
    expect(updatedBooking.refund_amount).toBe(1500);
    expect(updatedBooking.refund_mode).toBe('online');
    expect(updatedBooking.refund_voucher_no).toBe(debVoucherNo);
    expect(updatedBooking.refund_utr).toBe('UTR789012345678');
    expect(updatedBooking.refund_reason).toContain('Stayed 2 days & 3 hours');

    // Verify expenses table recorded the debit voucher under 'Guest Refund A/c'
    const expenseRow = db.prepare("SELECT * FROM expenses WHERE voucher_no = ?").get(debVoucherNo);
    expect(expenseRow).toBeDefined();
    expect(expenseRow.category).toBe('refund');
    expect(expenseRow.debit_account).toBe('Guest Refund A/c');
    expect(expenseRow.amount).toBe(1500);
    expect(expenseRow.payment_mode).toBe('online');
    expect(expenseRow.paid_to).toBe(guestName);

    // Verify payments table recorded the refund entry
    const paymentRow = db.prepare("SELECT * FROM payments WHERE receipt_no = ? AND payment_type = 'refund'").get(debVoucherNo);
    expect(paymentRow).toBeDefined();
    expect(paymentRow.amount).toBe(1500);
    expect(paymentRow.payment_mode).toBe('online');
    expect(paymentRow.utr_number).toBe('UTR789012345678');

    // Verify Room is set to needs_cleaning
    const roomState = db.prepare("SELECT status, current_booking_id FROM rooms WHERE id = ?").get(testRoomId1);
    expect(roomState.status).toBe('needs_cleaning');
    expect(roomState.current_booking_id).toBeNull();
  });

  it('3. Rule 3: Hospitality History returns early checkout badge, refund details, and debit row in payment ledger', async () => {
    const historyRes = await request(app)
      .get('/api/hospitality/history')
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.success).toBe(true);

    const records = historyRes.body.history || historyRes.body.records || [];
    const amitRecord = records.find(r => r.guest_name && r.guest_name.includes('Amit Verma'));
    expect(amitRecord).toBeDefined();
    expect(amitRecord.refund_amount).toBe(1500);
    expect(amitRecord.refund_mode).toBe('online');
    expect(amitRecord.refund_voucher_no).toMatch(/^DEB-\d+/);
    expect(amitRecord.is_early_checkout).toBe(true);

    // Verify GET /api/hospitality/history/:id includes payments array with refund row
    const detailRes = await request(app)
      .get(`/api/hospitality/history/${amitRecord.id}`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.success).toBe(true);
    const bookingData = detailRes.body.booking || detailRes.body.data;
    expect(bookingData.refund_amount).toBe(1500);
    expect(bookingData.refund_mode).toBe('online');

    const refundPayment = bookingData.payments.find(p => p.payment_type === 'refund');
    expect(refundPayment).toBeDefined();
    expect(refundPayment.amount).toBe(1500);
    expect(refundPayment.payment_mode).toBe('online');
    expect(refundPayment.utr_number).toBe('UTR789012345678');
  });

  it('4. Rule 4: Cash return type records cash refund voucher correctly', async () => {
    // Guest in room 772 (₹3,000/day) booked 2 days (₹6,000), paid ₹6,000 advance
    // Stays 1 day + 2 hours = 26 hours. Grace period 60m passed, extra 2 hours <= 3h -> ext_3h_rate = ₹500
    // Recalculated room rent = 1 * 3000 + 500 = ₹3,500
    // Refund to return = ₹6,000 - ₹3,500 = ₹2,500 in Cash
    const now = new Date();
    const checkinTime = new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString();
    const expectedCheckout = new Date(now.getTime() + 22 * 60 * 60 * 1000).toISOString();

    const guestRes = db.prepare("INSERT INTO guests (name, mobile, doc_type) VALUES (?, ?, 'Aadhaar')").run(`Pooja Patel ${Date.now()}`, '9833344455');
    const guestId = guestRes.lastInsertRowid;

    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time, room_rate, total_room_charge,
        total_paid, split_cash, status
      ) VALUES (?, ?, ?, ?, 3000, 6000, 6000, 6000, 'active')
    `).run(testRoomId2, guestId, checkinTime, expectedCheckout);

    const bookingId = bookingRes.lastInsertRowid;
    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(bookingId, testRoomId2);

    const folioRes = await request(app).get(`/api/rooms/${testRoomId2}/folio`);
    expect(folioRes.status).toBe(200);
    const summary = folioRes.body.folio?.summary;
    expect(summary).toBeDefined();
    expect(summary.completedDays).toBe(1);
    expect(summary.earlyStayHours).toBe(2);
    expect(summary.earlyExtensionCharge).toBe(500);
    expect(summary.recalculatedRoomCharge).toBe(3500);
    expect(summary.refundAmount).toBe(2500);

    // Execute Cash checkout
    const checkoutRes = await request(app)
      .post(`/api/checkout/${testRoomId2}`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        recalculated_room_charge: 3500,
        refund_amount: 2500,
        return_mode: 'cash',
        refund_reason: 'Early checkout: Stayed 1 day & 2 hours',
        checked_out_by: 'Cashier Desk'
      });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
    expect(checkoutRes.body.data.netRefund).toBe(2500);
    expect(checkoutRes.body.data.refund_mode).toBe('cash');

    const debNo = checkoutRes.body.data.refundVoucherNo;
    const expRow = db.prepare("SELECT * FROM expenses WHERE voucher_no = ?").get(debNo);
    expect(expRow.amount).toBe(2500);
    expect(expRow.payment_mode).toBe('cash');
    expect(expRow.debit_account).toBe('Guest Refund A/c');
  });

  it('5. Rule 5: Right click is completely disabled on checked-in (occupied) rooms across components', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // 1. Verify RoomCard.jsx disables right-click for occupied rooms
    const roomCardContent = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/RoomCard.jsx'), 'utf-8');
    expect(roomCardContent).toContain("if (room.status === 'occupied')");
    expect(roomCardContent).toMatch(/onContextMenu=\{[\s\S]*?if\s*\(\s*room\.status\s*===\s*'occupied'\s*\)\s*\{\s*return;/);

    // 2. Verify HospitalityContext.jsx guards openContextMenu against occupied rooms
    const hospCtxContent = fs.readFileSync(path.resolve(__dirname, '../src/context/HospitalityContext.jsx'), 'utf-8');
    expect(hospCtxContent).toMatch(/openContextMenu\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*!room\s*\|\|\s*room\.status\s*===\s*'occupied'\s*\)\s*\{\s*return;/);

    // 3. Verify RoomContextMenu.jsx suppresses context menu when room is occupied
    const menuContent = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/RoomContextMenu.jsx'), 'utf-8');
    expect(menuContent).toContain("contextMenu.room.status === 'occupied'");
  });
});
