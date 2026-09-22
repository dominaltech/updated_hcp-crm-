import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import { buildGuestRegistrationHTML } from '../src/services/printService';

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

    // Pick or create a ready room
    let room = db.prepare("SELECT * FROM rooms WHERE status = 'ready' OR status = 'available' LIMIT 1").get();
    if (!room) {
      const roomRes = db.prepare(`
        INSERT INTO rooms (room_number, room_type, price, status)
        VALUES (?, ?, ?, 'ready')
      `).run('999B', 'Deluxe Executive', 3500);
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
    // Delete dummy test room if it was created
    db.prepare("DELETE FROM rooms WHERE room_number = '999B'").run();
    if (testRoomId) {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId);
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
    expect(cssContent).toContain('max-height: 272mm !important');
    expect(cssContent).toContain('page-break-after: avoid !important');
    expect(cssContent).toContain('color-scheme: light !important');
  });

  it('6. verifies BTC check-in form removes (Credit Ledger) and verbose payment pending note to avoid page 2', () => {
    const btcFormData = {
      voucherNo: '260921-675',
      checkinTime: '2026-09-21T14:59:00',
      approxCheckout: '2026-09-22T01:00:00',
      stayNights: 1,
      bookingSource: 'Corporate (BTC)',
      btcCompanyName: 'Infosys BPM Technologies',
      btcCompanyAddress: 'Hinjewadi Phase 2, Pune',
      btcGstNumber: '27AABCI1234F1Z5',
      btcPanNumber: 'MMT-9876544',
      btcApprovalRef: 'MMT-9876544',
      btcContactPerson: 'Corporate Liaison',
      guestName: 'Javid Rangrez',
      mobile: '9028850715',
      aadharNumber: '443842677809',
      docType: 'Aadhaar Card',
      roomNumber: '102',
      mealPlan: 'with_breakfast',
      adultsMale: 0,
      adultsFemale: 1,
      children: 0,
      extraBeds: 0,
      roomTariffNet: 2025,
      discountPct: 10,
      discountAmount: 225,
      taxAmount: 101,
      grandTotal: 2126,
      totalPaid: 0,
      balanceDue: 2126,
      isBtcPending: true
    };

    const html = buildGuestRegistrationHTML(btcFormData, { includePhotos: false });

    // 1. Must NOT contain '(Credit Ledger)' under Billing Status
    expect(html).not.toContain('Bill to Company (Credit Ledger)');
    expect(html).toContain('🏢 Bill to Company');

    // 2. Must NOT contain verbose BTC badge in payment modes row
    expect(html).not.toContain('PAYMENT MODES: 🏢 BILL TO COMPANY (BTC): ₹ 2,126.00');
    expect(html).not.toContain('🏢 BILL TO COMPANY (BTC): ₹');

    // 3. Must NOT contain payment pending warning or tax invoice release notice
    expect(html).not.toContain('⏳ PAYMENT PENDING FROM COMPANY');
    expect(html).not.toContain('(Official Tax Invoice will release after company payment is settled)');

    // 4. Must fit strictly within 1 A4 page with max-height constraint and avoid page break
    expect(html).toContain('max-height: 272mm;');
    expect(html).toContain('page-break-after: avoid;');

    // 5. Must still contain all crucial corporate and booking data
    expect(html).toContain('Infosys BPM Technologies');
    expect(html).toContain('27AABCI1234F1Z5');
    expect(html).toContain('Javid Rangrez');
    expect(html).toContain('₹ 2,126.00');
  });
});
