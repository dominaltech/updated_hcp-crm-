import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Stay Extension Payment with 50% Gate and Split Receipts Test Suite', () => {
  let hospitalityToken;
  let testRoomId;
  let testBookingId;

  beforeAll(async () => {
    hospitalityToken = generateToken({
      id: 9991,
      username: 'test_extend_cashier',
      role: 'hospitality',
      full_name: 'Extension Test Cashier',
      can_access_manager: 1
    });

    // Create or reset test room 881
    let r = db.prepare("SELECT id FROM rooms WHERE room_number = '881'").get();
    if (!r) {
      const ins = db.prepare(`
        INSERT INTO rooms (room_number, room_type, price, status, gst_pct, ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate)
        VALUES ('881', 'Executive Room', 2500, 'ready', 5, 60, 500, 1000, 1500)
      `).run();
      testRoomId = ins.lastInsertRowid;
    } else {
      db.prepare(`
        UPDATE rooms SET status = 'ready', current_booking_id = NULL, price = 2500, gst_pct = 5,
        ext_grace_mins = 60, ext_3h_rate = 500, ext_6h_rate = 1000, ext_9h_rate = 1500
        WHERE id = ?
      `).run(r.id);
      testRoomId = r.id;
    }

    const now = new Date();
    const checkinTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const approxCheckoutTime = new Date(now.getTime() + 22 * 60 * 60 * 1000).toISOString();

    const guestRes = db.prepare("INSERT INTO guests (name, mobile, doc_type) VALUES (?, ?, 'Aadhaar')")
      .run(`Test Extension Guest ${Date.now()}`, '9876543210');
    const guestId = guestRes.lastInsertRowid;

    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time, room_rate, total_room_charge,
        total_paid, split_cash, status, voucher_number
      ) VALUES (?, ?, ?, ?, 2500, 2625, 2000, 2000, 'active', '261005-881')
    `).run(testRoomId, guestId, checkinTime, approxCheckoutTime);
    testBookingId = bookingRes.lastInsertRowid;

    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?")
      .run(testBookingId, testRoomId);
  });

  it('1. Rejects extension when extended_amount > 0 and paid_amount is less than 50%', async () => {
    const extendedCheckout = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/bookings/${testBookingId}/extend-checkout`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        approx_checkout_time: extendedCheckout,
        extended_amount: 2000,
        paid_amount: 800, // < 50% (need min 1000)
        payments: [
          { mode: 'cash', amount: 800, label: 'Cash' }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Minimum 50% advance payment required');
  });

  it('2. Accepts extension with single mode (Cash) paying >= 50%, generates CR receipt and updates totals', async () => {
    const extendedCheckout = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/bookings/${testBookingId}/extend-checkout`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        approx_checkout_time: extendedCheckout,
        extended_amount: 1000,
        paid_amount: 500, // Exactly 50%
        payments: [
          { mode: 'cash', amount: 500, label: 'Cash' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.approx_checkout_time).toBe(extendedCheckout);
    expect(res.body.extended_amount).toBe(1000);
    expect(res.body.paid_amount).toBe(500);
    expect(Array.isArray(res.body.receipts)).toBe(true);
    expect(res.body.receipts.length).toBe(1);
    expect(res.body.receipts[0].mode).toBe('cash');
    expect(res.body.receipts[0].amount).toBe(500);
    expect(res.body.receipts[0].receipt_no).toMatch(/^CR\d+/i);

    // Verify database booking row
    const updatedBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(testBookingId);
    expect(updatedBooking.approx_checkout_time).toBe(extendedCheckout);
    expect(updatedBooking.total_room_charge).toBe(2625 + 1000);
    expect(updatedBooking.total_paid).toBe(2000 + 500);
    expect(updatedBooking.split_cash).toBe(2000 + 500);
  });

  it('3. Accepts extension with split payments across 2 modes (Cash + UPI) >= 50%, generates CR and UPI receipts', async () => {
    const extendedCheckout = new Date(Date.now() + 60 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/bookings/${testBookingId}/extend-checkout`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        approx_checkout_time: extendedCheckout,
        extended_amount: 2000,
        paid_amount: 1200, // 60% (> 50%)
        payments: [
          { mode: 'cash', amount: 600, label: 'Cash' },
          { mode: 'upi', amount: 600, label: 'Online UPI', utr_number: 'UTR-EXT-12345' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.receipts.length).toBe(2);

    const cashReceipt = res.body.receipts.find(r => r.mode === 'cash');
    const upiReceipt = res.body.receipts.find(r => r.mode === 'upi');

    expect(cashReceipt).toBeDefined();
    expect(cashReceipt.receipt_no).toMatch(/^CR\d+/i);
    expect(cashReceipt.amount).toBe(600);

    expect(upiReceipt).toBeDefined();
    expect(upiReceipt.receipt_no).toMatch(/^UPI\d+/i);
    expect(upiReceipt.amount).toBe(600);
    expect(upiReceipt.utr_number).toBe('UTR-EXT-12345');

    // Verify payments table records
    const upiPaymentRow = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND receipt_no = ?").get(testBookingId, upiReceipt.receipt_no);
    expect(upiPaymentRow).toBeDefined();
    expect(upiPaymentRow.payment_mode).toBe('upi');
    expect(upiPaymentRow.utr_number).toBe('UTR-EXT-12345');
    expect(upiPaymentRow.amount).toBe(600);
  });

  it('4. Accepts extension with 3 modes (Cash + UPI + Card) >= 50%, generates CR, UPI, and POS receipts', async () => {
    const extendedCheckout = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/bookings/${testBookingId}/extend-checkout`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        approx_checkout_time: extendedCheckout,
        extended_amount: 3000,
        paid_amount: 1800, // 60%
        payments: [
          { mode: 'cash', amount: 600, label: 'Cash' },
          { mode: 'upi', amount: 600, label: 'Online UPI', utr_number: 'UTR-3WAY-999' },
          { mode: 'card', amount: 600, label: 'Card POS', card_digits: '4455' }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.receipts.length).toBe(3);

    const modes = res.body.receipts.map(r => r.mode);
    expect(modes).toContain('cash');
    expect(modes).toContain('upi');
    expect(modes).toContain('card');

    const cardReceipt = res.body.receipts.find(r => r.mode === 'card');
    expect(cardReceipt.receipt_no).toMatch(/^POS\d+/i);
    expect(cardReceipt.amount).toBe(600);
    expect(cardReceipt.card_digits).toBe('4455');
  });

  it('5. Allows 0 extension amount without payment (e.g. grace period extension)', async () => {
    const graceExtension = new Date(Date.now() + 72.5 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/bookings/${testBookingId}/extend-checkout`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        approx_checkout_time: graceExtension,
        extended_amount: 0,
        paid_amount: 0,
        payments: []
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.approx_checkout_time).toBe(graceExtension);
  });
});
