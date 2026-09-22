import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import app from '../server.js';
import db from '../database.js';
import { generateToken } from '../middleware/auth.js';
import { buildFinalBillA4HTML } from '../src/services/printService.js';

describe('Folio F&B Addition to Balance Due & Tax Invoice Test Suite', () => {
  let testRoomId = null;
  let testBookingId = null;
  let authToken = null;

  beforeAll(() => {
    authToken = generateToken({
      id: 9991,
      username: 'test_admin',
      role: 'admin',
      full_name: 'Test Administrator',
      can_access_manager: 1
    });

    // Find or create an occupied room for testing
    const existingRoom = db.prepare("SELECT * FROM rooms WHERE status = 'occupied' LIMIT 1").get();
    if (existingRoom) {
      testRoomId = existingRoom.id;
      testBookingId = existingRoom.current_booking_id;
    } else {
      // Find any room
      const room = db.prepare("SELECT * FROM rooms WHERE id = 101 OR room_number = '101' LIMIT 1").get() || db.prepare("SELECT * FROM rooms LIMIT 1").get();
      testRoomId = room.id;
      const ins = db.prepare(`
        INSERT INTO bookings (room_id, guest_name, checkin_time, approx_checkout_time, total_room_charge, initial_paid, status, voucher_number)
        VALUES (?, 'Test Guest Folio', datetime('now'), datetime('now', '+1 day'), 3413, 2000, 'active', '260922-991')
      `).run(room.id);
      testBookingId = ins.lastInsertRowid;
      db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(testBookingId, room.id);
    }
  });

  it('1. verifies /api/rooms/:id/folio calculates balanceDue including pending F&B orders and keeps roomGrossTariff clean', async () => {
    const orderNum = `ORD-${Date.now()}`;
    // Add a pending restaurant order linked to this room and booking
    const orderIns = db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, booking_id, room_id, customer_name, order_type,
        items_json, subtotal, tax, total,
        payment_mode, is_paid, created_at
      ) VALUES (?, ?, ?, 'Test Guest Folio', 'room', '[]', 630, 32, 662, 'room_folio', 0, datetime('now'))
    `).run(orderNum, testBookingId, testRoomId);

    const res = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { summary } = res.body.folio;
    expect(summary).toBeDefined();

    // Verify foodTotal is 662 or includes 662
    expect(summary.foodTotal).toBeGreaterThanOrEqual(662);

    // Verify roomGrossTariff does NOT include foodTotal
    expect(summary.roomGrossTariff).toBeDefined();
    expect(summary.roomGrossTariff).toBeLessThan(summary.grandTotal);

    // Verify balanceDue accurately includes the F&B pending amount
    // grandTotal = roomCharge + foodTotal + barTotal
    // balanceDue = grandTotal - advancePaid
    const expectedGrand = summary.roomCharge + summary.foodTotal + summary.barTotal;
    expect(summary.grandTotal).toBe(expectedGrand);
    expect(summary.balanceDue).toBe(expectedGrand - summary.advancePaid);

    // Clean up created order
    db.prepare("DELETE FROM restaurant_orders WHERE id = ?").run(orderIns.lastInsertRowid);
  });

  it('2. verifies buildFinalBillA4HTML displays room tariff without double-counting and prints F&B charges', () => {
    const mockRoom = {
      room_number: '101',
      guest_name: 'MD YAHYA',
      total_room_charge: 3413,
      initial_paid: 2000,
      voucher_number: '260920-596'
    };

    const mockCalc = {
      roomGrossTariff: 3250,
      roomTariffNet: 3250,
      roomCharge: 3413,
      grossTariff: 3250,
      discountAmount: 0,
      discountPct: 0,
      stayTax: 163,
      foodTotal: 662,
      barTotal: 0,
      advancePaid: 2000,
      balanceDue: 2075
    };

    const mockSettlement = {
      settleAmt: 2075,
      splitCash: 2075
    };

    const html = buildFinalBillA4HTML(mockRoom, mockCalc, mockSettlement);

    // Room Tariff row should show 3250.00
    expect(html).toContain('3250.00');

    // Restaurant Charges row should show 662.00
    expect(html).toContain('662.00');

    // Total Invoice should be 4075
    expect(html).toContain('4075.00');

    // Advance should be 2000
    expect(html).toContain('2000.00');

    // Net Payable should be 2075
    expect(html).toContain('2075.00');
  });

  it('3. verifies checkout marks all unpaid F&B orders linked to room as paid', async () => {
    const orderNum = `ORD-${Date.now()}-2`;
    // Create an unpaid order linked to this booking
    const orderIns = db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, booking_id, room_id, customer_name, order_type,
        items_json, subtotal, tax, total,
        payment_mode, is_paid, created_at
      ) VALUES (?, ?, ?, 'Test Guest Folio', 'room', '[]', 630, 32, 662, 'room_folio', 0, datetime('now'))
    `).run(orderNum, testBookingId, testRoomId);

    const orderId = orderIns.lastInsertRowid;

    // Check before checkout: is_paid should be 0
    const beforeOrder = db.prepare("SELECT is_paid FROM restaurant_orders WHERE id = ?").get(orderId);
    expect(beforeOrder.is_paid).toBe(0);

    // Get current balance due from folio API
    const folioRes = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${authToken}`);
    const dueAmt = folioRes.body.folio?.summary?.balanceDue || 0;

    // Checkout room with the exact due amount
    const checkoutRes = await request(app)
      .post(`/api/checkout/${testRoomId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        splitCash: dueAmt,
        split_cash: dueAmt,
        checked_out_by: 'Front Desk'
      });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);

    // After checkout, the order linked to booking must be marked paid
    const afterOrder = db.prepare("SELECT is_paid FROM restaurant_orders WHERE id = ?").get(orderId);
    expect(afterOrder.is_paid).toBe(1);

    // Clean up
    db.prepare("DELETE FROM restaurant_orders WHERE id = ?").run(orderId);
    // Restore room state if needed
    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(testBookingId, testRoomId);
    db.prepare("UPDATE bookings SET status = 'active' WHERE id = ?").run(testBookingId);
  });
});
