import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

describe('Room Folio Split Payment Separate Receipts Test Suite', () => {
  let hospitalityToken;
  let testRoomId;
  let testBookingId;

  beforeAll(async () => {
    hospitalityToken = generateToken({
      id: 8882,
      username: 'test_split_cashier',
      role: 'hospitality',
      full_name: 'Split Payment Cashier',
      can_access_manager: 1
    });

    // Create or reset test room 996
    let r = db.prepare("SELECT id FROM rooms WHERE room_number = '996'").get();
    if (!r) {
      const ins = db.prepare(`
        INSERT INTO rooms (room_number, room_type, price, status, gst_pct)
        VALUES ('996', 'Deluxe Room', 2000, 'ready', 5)
      `).run();
      testRoomId = ins.lastInsertRowid;
    } else {
      db.prepare(`
        UPDATE rooms SET status = 'ready', current_booking_id = NULL, price = 2000, gst_pct = 5
        WHERE id = ?
      `).run(r.id);
      testRoomId = r.id;
    }

    const now = new Date();
    const checkinTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const approxCheckoutTime = new Date(now.getTime() + 22 * 60 * 60 * 1000).toISOString();

    const guestRes = db.prepare("INSERT INTO guests (name, mobile, doc_type) VALUES (?, ?, 'Aadhaar')")
      .run(`Test Split Guest ${Date.now()}`, '9876543210');
    const guestId = guestRes.lastInsertRowid;

    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time, room_rate, total_room_charge,
        total_paid, split_cash, status
      ) VALUES (?, ?, ?, ?, 2000, 2100, 1000, 1000, 'active')
    `).run(testRoomId, guestId, checkinTime, approxCheckoutTime);
    testBookingId = bookingRes.lastInsertRowid;

    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?")
      .run(testBookingId, testRoomId);
  });

  it('1. POST /api/rooms/:id/payments with split payment (50 Cash, 50 UPI, 50 Card) records 3 distinct payment records', async () => {
    const res = await request(app)
      .post(`/api/rooms/${testRoomId}/payments`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        amount: 150,
        payment_mode: 'split',
        split_cash: 50,
        split_online: 50,
        split_card: 50,
        utr_number: '65654654654',
        card_surcharge: 0,
        upi_tax: 0,
        notes: 'In-stay advance payment'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payments).toBeDefined();
    expect(res.body.payments.length).toBe(3);

    // Verify cash item
    const cashItem = res.body.payments.find(p => p.payment_mode === 'cash');
    expect(cashItem).toBeDefined();
    expect(cashItem.amount).toBe(50);
    expect(cashItem.receipt_no).toMatch(/^CR\d+/);

    // Verify upi item
    const upiItem = res.body.payments.find(p => p.payment_mode === 'upi');
    expect(upiItem).toBeDefined();
    expect(upiItem.amount).toBe(50);
    expect(upiItem.receipt_no).toMatch(/^UPI\d+/);
    expect(upiItem.utr_number).toBe('65654654654');

    // Verify card item
    const cardItem = res.body.payments.find(p => p.payment_mode === 'card');
    expect(cardItem).toBeDefined();
    expect(cardItem.amount).toBe(50);
    expect(cardItem.receipt_no).toMatch(/^POS\d+/);

    // Verify in database
    const dbPayments = db.prepare('SELECT * FROM payments WHERE booking_id = ?').all(testBookingId);
    expect(dbPayments.length).toBe(3);
  });

  it('2. GET /api/rooms/:id/folio returns each separate payment record individually', async () => {
    const res = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.folio.payments).toBeDefined();
    expect(res.body.folio.payments.length).toBe(3);

    const modes = res.body.folio.payments.map(p => p.payment_mode);
    expect(modes).toContain('cash');
    expect(modes).toContain('upi');
    expect(modes).toContain('card');
  });

  it('3. RoomFolioPage.jsx does not display the redundant subtitle', () => {
    const content = fs.readFileSync(path.join(__dirname, '../src/pages/RoomFolioPage.jsx'), 'utf-8');
    expect(content.includes('Payments recorded for this booking. Click "Receipt" to print official cash receipt (Receipt 1, 2-on-A4).')).toBe(false);
  });

  it('4. Independent serial numbers: Cash increments when cash is paid, while UPI and POS only increment when their mode is billed', async () => {
    // Step 1: Cash only payment
    const cashOnlyRes = await request(app)
      .post(`/api/rooms/${testRoomId}/payments`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        amount: 50,
        payment_mode: 'cash',
        split_cash: 50
      });

    expect(cashOnlyRes.status).toBe(200);
    const cash1Receipt = cashOnlyRes.body.receipt_no;
    const cash1Num = parseInt(cash1Receipt.replace(/\D/g, ''), 10);

    // Step 2: Split payment with Cash, UPI, and Card
    const splitRes = await request(app)
      .post(`/api/rooms/${testRoomId}/payments`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        amount: 60,
        payment_mode: 'split',
        split_cash: 20,
        split_online: 20,
        split_card: 20,
        utr_number: '9988776655'
      });

    expect(splitRes.status).toBe(200);
    const splitPayments = splitRes.body.payments;
    const cashPart = splitPayments.find(p => p.payment_mode === 'cash');
    const upiPart = splitPayments.find(p => p.payment_mode === 'upi');
    const cardPart = splitPayments.find(p => p.payment_mode === 'card');

    const cash2Num = parseInt(cashPart.receipt_no.replace(/\D/g, ''), 10);
    const upiNum = parseInt(upiPart.receipt_no.replace(/\D/g, ''), 10);
    const cardNum = parseInt(cardPart.receipt_no.replace(/\D/g, ''), 10);

    // Cash sequence strictly incremented by 1 from the cash-only payment
    expect(cash2Num).toBe(cash1Num + 1);

    // Crucial: UPI and Card must have their own lower serial numbers and NEVER jump to match the Cash sequence number!
    expect(upiNum).toBeLessThan(cash2Num);
    expect(cardNum).toBeLessThan(cash2Num);
  });
});

