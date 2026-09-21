import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

describe('BTC Zero-Rupee Checkout and Hospitality History Settlement Test Suite', () => {
  let managerToken;
  let testGuestId;
  let testRoomId;
  let testBookingId;
  let testCompanyId;

  beforeAll(() => {
    managerToken = generateToken({
      id: 8881,
      username: 'btc_tester',
      role: 'manager',
      full_name: 'BTC Test Manager',
      can_access_manager: 1
    });

    // Create or find a test company
    const compRes = db.prepare(`
      INSERT INTO btc_companies (company_name, gst_number, contact_phone, credit_limit)
      VALUES (?, ?, ?, ?)
    `).run('Tata Consultancy Services BTC', '27AABCT9999F1Z0', '9898989898', 200000);
    testCompanyId = compRes.lastInsertRowid;

    // Create a test guest
    const guestRes = db.prepare(`
      INSERT INTO guests (name, mobile, email, doc_type, aadhar_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('Vikramaditya Shinde', '9876543210', 'vikram@tcs.test', 'Aadhar', '1234-5678-9012');
    testGuestId = guestRes.lastInsertRowid;

    // Pick or create an available room
    let room = db.prepare("SELECT * FROM rooms WHERE status = 'available' LIMIT 1").get();
    if (!room) {
      const roomRes = db.prepare(`
        INSERT INTO rooms (room_number, room_type, price, status)
        VALUES (?, ?, ?, ?)
      `).run('999B', 'Deluxe Executive', 3500, 'available');
      testRoomId = roomRes.lastInsertRowid;
    } else {
      testRoomId = room.id;
    }
  });

  afterAll(() => {
    // Cleanup
    if (testBookingId) {
      db.prepare("DELETE FROM payments WHERE booking_id = ?").run(testBookingId);
      db.prepare("DELETE FROM bookings WHERE id = ?").run(testBookingId);
    }
    if (testGuestId) {
      db.prepare("DELETE FROM guests WHERE id = ?").run(testGuestId);
    }
    if (testCompanyId) {
      db.prepare("DELETE FROM btc_companies WHERE id = ?").run(testCompanyId);
    }
    if (testRoomId) {
      db.prepare("UPDATE rooms SET status = 'available', current_booking_id = NULL WHERE id = ?").run(testRoomId);
    }
  });

  it('1. should allow checking in under Bill To Company (BTC) with zero rupees advance', async () => {
    const checkinRes = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        room_id: testRoomId,
        guest_name: 'Vikramaditya Shinde',
        mobile: '9876543210',
        email: 'vikram@tcs.test',
        doc_type: 'Aadhar',
        total_room_charge: 3500,
        advance_payment: 0,
        total_paid: 0,
        cash: 0,
        card: 0,
        online: 0,
        split_cash: 0,
        split_card: 0,
        split_online: 0,
        booking_source: 'BTC',
        btc_company_id: testCompanyId,
        btc_company_name: 'Tata Consultancy Services BTC',
        btc_approval_ref: 'TCS-APP-4421',
        checked_in_by: 'Front Desk Lead'
      });

    expect(checkinRes.status).toBe(200);
    expect(checkinRes.body.success).toBe(true);

    const booking = db.prepare("SELECT * FROM bookings WHERE booking_source = 'BTC' AND status = 'active' ORDER BY id DESC LIMIT 1").get();
    expect(booking).toBeDefined();
    expect(booking.booking_source).toBe('BTC');
    expect(booking.payment_status).toBe('pending_from_company');
    expect(booking.total_paid).toBe(0);
    testBookingId = booking.id;
  });

  it('2. should allow checkout with ₹0 paid when Bill To Company (Company Pays Later) is selected', async () => {
    expect(testBookingId).toBeDefined();

    const checkoutRes = await request(app)
      .post(`/api/checkout/${testRoomId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        bookingId: testBookingId,
        booking_id: testBookingId,
        settle_amount: 0,
        settleAmount: 0,
        refund_amount: 0,
        isRefund: false,
        is_btc_pending: true,
        isBtcPending: true,
        final_payment_mode: 'btc',
        finalPaymentMode: 'btc',
        split_cash: 0,
        split_online: 0,
        split_card: 0,
        split_cheque: 0,
        checked_out_by: 'Front Desk Lead'
      });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);

    const checkedOutBooking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(testBookingId);
    expect(checkedOutBooking.status).toBe('checked_out');
    // Payment status must remain pending_from_company so it appears in Pending BTC in Hospitality History
    expect(checkedOutBooking.payment_status).toBe('pending_from_company');
    expect(checkedOutBooking.final_settlement_mode).toBe('btc');
    expect(checkedOutBooking.total_paid).toBe(0);
  });

  it('3. should retrieve the checked-out BTC stay record in /api/hospitality/history', async () => {
    const historyRes = await request(app)
      .get('/api/hospitality/history')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(historyRes.status).toBe(200);
    const historyList = historyRes.body.history || historyRes.body;
    expect(Array.isArray(historyList)).toBe(true);

    const btcRecord = historyList.find(h => h.id === testBookingId || (h.all_booking_ids && h.all_booking_ids.includes(testBookingId)));
    expect(btcRecord).toBeDefined();
    expect(btcRecord.payment_status).toBe('pending_from_company');
    expect(btcRecord.booking_source).toBe('BTC');
    expect(btcRecord.btc_company_name).toBe('Tata Consultancy Services BTC');
  });

  it('4. should successfully settle pending BTC from history with official payment logging', async () => {
    const settleRes = await request(app)
      .post(`/api/hospitality/history/${testBookingId}/payment-status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        payment_status: 'settled',
        settlement_mode: 'upi',
        amount_paid: 3500,
        cashier_name: 'Aamir Raza (Accounts)',
        transaction_id: 'UPI998877665544',
        reference_no: 'UPI998877665544',
        notes: 'Full payment received from TCS Corporate Accounts'
      });

    expect(settleRes.status).toBe(200);
    expect(settleRes.body.success).toBe(true);
    expect(settleRes.body.payment_status).toBe('settled');
    expect(settleRes.body.receipt_no).toBeDefined();

    // Verify booking in database
    const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(testBookingId);
    expect(updated.payment_status).toBe('settled');
    expect(updated.final_settlement_mode).toBe('upi');
    expect(updated.total_paid).toBe(updated.total_room_charge);

    // Verify payment was logged in payments ledger
    const paymentRow = db.prepare("SELECT * FROM payments WHERE booking_id = ? ORDER BY id DESC LIMIT 1").get(testBookingId);
    expect(paymentRow).toBeDefined();
    expect(paymentRow.payment_mode).toBe('upi');
    expect(paymentRow.amount).toBe(3500);
    expect(paymentRow.cashier_name).toBe('Aamir Raza (Accounts)');
  });

  it('5. should have high-specificity print isolation rules in public/styles.css', () => {
    const cssContent = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf8');
    expect(cssContent).toContain('@media print');
    expect(cssContent).toContain('html[data-theme="dark"]');
    expect(cssContent).toContain('body.print-sheet-active');
    expect(cssContent).toContain('min-height: 290mm !important');
    expect(cssContent).toContain('color-scheme: light !important');
  });
});
