import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import db from '../database.js';
import { generateToken } from '../middleware/auth.js';

describe('Visitor Breakfast Plan F&B Billing & GST Suite', () => {
  let testRoom = null;
  let testBookingId = null;
  let authToken = null;
  let createdVisitorIds = [];
  let createdOrderIds = [];

  beforeAll(() => {
    authToken = generateToken({
      id: 9988,
      username: 'test_manager',
      role: 'manager',
      full_name: 'Test Manager',
      can_access_manager: 1
    });

    // Create a temporary guest and occupied room
    const guestResult = db.prepare(`
      INSERT INTO guests (name, mobile, doc_type)
      VALUES ('Visitor Test Guest', '9876543210', 'Aadhar Card')
    `).run();
    const guestId = guestResult.lastInsertRowid;

    // Pick or create a room
    testRoom = db.prepare("SELECT * FROM rooms WHERE status = 'ready' LIMIT 1").get();
    if (!testRoom) {
      testRoom = db.prepare("SELECT * FROM rooms LIMIT 1").get();
    }

    const bookingResult = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time,
        room_rate, total_room_charge, total_paid, status, voucher_number
      ) VALUES (?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'), 2000, 2000, 2000, 'active', 'VIS-TEST-001')
    `).run(testRoom.id, guestId);
    testBookingId = bookingResult.lastInsertRowid;

    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(testBookingId, testRoom.id);
  });

  afterAll(() => {
    try {
      // Clean up visitors and orders
      if (createdVisitorIds.length > 0) {
        const placeholders = createdVisitorIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM room_visitors WHERE id IN (${placeholders})`).run(...createdVisitorIds);
      }
      if (createdOrderIds.length > 0) {
        const placeholders = createdOrderIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM restaurant_orders WHERE id IN (${placeholders})`).run(...createdOrderIds);
      }
      // Restore room
      if (testRoom && testBookingId) {
        db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoom.id);
        db.prepare("DELETE FROM bookings WHERE id = ?").run(testBookingId);
      }
    } catch (_) {}
  });

  it('1. logs a visitor with 🍳 Visitor Breakfast Plan (₹250) and auto-generates F&B restaurant order with 5% GST & ₹0 discount', async () => {
    const res = await request(app)
      .post(`/api/rooms/${testRoom.id}/visitors`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        visitor_name: 'Amit Kumar',
        phone: '9988776655',
        relation: 'Business Associate',
        purpose: 'Morning Meeting',
        has_breakfast: 1,
        breakfast_status: 'pending',
        breakfast_amount: 250
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.visitor).toBeDefined();
    expect(res.body.visitor.visitor_name).toBe('Amit Kumar');
    expect(res.body.visitor.has_breakfast).toBe(1);
    expect(res.body.visitor.fnb_order_id).toBeGreaterThan(0);

    const visitorId = res.body.visitor.id;
    const fnbOrderId = res.body.visitor.fnb_order_id;
    createdVisitorIds.push(visitorId);
    createdOrderIds.push(fnbOrderId);

    // Verify restaurant_orders record
    const order = db.prepare('SELECT * FROM restaurant_orders WHERE id = ?').get(fnbOrderId);
    expect(order).toBeDefined();
    expect(order.room_id).toBe(testRoom.id);
    expect(order.booking_id).toBe(testBookingId);
    expect(order.subtotal).toBe(250);
    expect(order.discount).toBe(0); // Without discount
    expect(order.tax).toBe(13); // 5% GST on 250 is 12.5 -> Math.round is 13
    expect(order.total).toBe(263); // 250 + 13
    expect(order.is_paid).toBe(0);
    expect(order.payment_mode).toBe('room_folio');
    expect(order.waiter_name).toBe('Visitor Breakfast');
    expect(order.customer_name).toContain('Amit Kumar');
  });

  it('2. logs a 2nd visitor with breakfast plan and verifies multiple visitors work accurately without collision', async () => {
    const res = await request(app)
      .post(`/api/rooms/${testRoom.id}/visitors`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        visitor_name: 'Pooja Verma',
        phone: '9123456780',
        relation: 'Colleague',
        purpose: 'Project Review',
        has_breakfast: true,
        breakfast_status: 'pending',
        breakfast_amount: 250
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.visitor.has_breakfast).toBe(1);
    expect(res.body.visitor.fnb_order_id).toBeGreaterThan(0);

    const visitorId2 = res.body.visitor.id;
    const fnbOrderId2 = res.body.visitor.fnb_order_id;
    createdVisitorIds.push(visitorId2);
    createdOrderIds.push(fnbOrderId2);

    expect(fnbOrderId2).not.toBe(createdOrderIds[0]);

    const order2 = db.prepare('SELECT * FROM restaurant_orders WHERE id = ?').get(fnbOrderId2);
    expect(order2).toBeDefined();
    expect(order2.customer_name).toContain('Pooja Verma');
    expect(order2.subtotal).toBe(250);
    expect(order2.discount).toBe(0);
    expect(order2.tax).toBe(13);
    expect(order2.total).toBe(263);
  });

  it('3. verifies room folio shows both visitor breakfast orders in F&B bill when clicking the room', async () => {
    const res = await request(app)
      .get(`/api/rooms/${testRoom.id}/folio`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.folio).toBeDefined();

    const restaurantOrders = res.body.folio.restaurantOrders || [];
    const visitorOrders = restaurantOrders.filter(o => o.waiter_name === 'Visitor Breakfast');
    expect(visitorOrders.length).toBe(2);

    const totalVisitorAmt = visitorOrders.reduce((sum, o) => sum + o.total, 0);
    expect(totalVisitorAmt).toBe(526); // 263 * 2

    // Both orders have 0 discount and 13 tax each
    visitorOrders.forEach(o => {
      expect(o.subtotal).toBe(250);
      expect(o.discount).toBe(0);
      expect(o.tax).toBe(13);
      expect(o.total).toBe(263);
    });
  });

  it('4. settles one F&B order and verifies room_visitors.breakfast_status updates to paid', async () => {
    const fnbOrderIdToSettle = createdOrderIds[0];

    const res = await request(app)
      .post('/api/hospitality/settle-fnb-order')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderId: fnbOrderIdToSettle,
        department: 'restaurant',
        paymentMode: 'cash',
        staffName: 'Cashier Test'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify order is paid
    const order = db.prepare('SELECT is_paid FROM restaurant_orders WHERE id = ?').get(fnbOrderIdToSettle);
    expect(order.is_paid).toBe(1);

    // Verify visitor record is marked paid
    const visitor = db.prepare('SELECT breakfast_status FROM room_visitors WHERE fnb_order_id = ?').get(fnbOrderIdToSettle);
    expect(visitor.breakfast_status).toBe('paid');
  });

  it('5. deleting an unpaid visitor removes the linked restaurant order so no ghost F&B bill remains', async () => {
    const visitorIdToDelete = createdVisitorIds[1];
    const orderIdToCheck = createdOrderIds[1];

    const res = await request(app)
      .delete(`/api/visitors/${visitorIdToDelete}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const deletedVisitor = db.prepare('SELECT id FROM room_visitors WHERE id = ?').get(visitorIdToDelete);
    expect(deletedVisitor).toBeUndefined();

    const deletedOrder = db.prepare('SELECT id FROM restaurant_orders WHERE id = ?').get(orderIdToCheck);
    expect(deletedOrder).toBeUndefined();
  });
});
