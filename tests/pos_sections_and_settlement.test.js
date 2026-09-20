import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('POS Sections, Bar Parcels & Table Settlement Tests', () => {
  let managerToken;
  let restoToken;
  let barToken;
  let testRoomId;
  let testBookingId;
  let testGuestId;

  beforeAll(async () => {
    managerToken = generateToken({
      id: 9981,
      username: 'pos_admin',
      role: 'manager',
      full_name: 'POS Admin',
      can_access_manager: 1
    });

    restoToken = generateToken({
      id: 9982,
      username: 'resto_waiter',
      role: 'restaurant',
      full_name: 'Resto Waiter',
      can_access_manager: 0
    });

    barToken = generateToken({
      id: 9983,
      username: 'bar_tender',
      role: 'bar',
      full_name: 'Bar Tender',
      can_access_manager: 0
    });

    // Ensure an occupied test room exists
    const guestRes = db.prepare(`
      INSERT INTO guests (name, mobile, email, doc_type)
      VALUES ('Test Diner', '9876543210', 'diner@test.com', 'Aadhar Card')
    `).run();
    testGuestId = guestRes.lastInsertRowid;

    // Check if room 888 exists, create if not
    let room = db.prepare('SELECT * FROM rooms WHERE room_number = ?').get('888');
    if (!room) {
      const rRes = db.prepare(`
        INSERT INTO rooms (room_number, room_type, price, status)
        VALUES ('888', 'Deluxe', 2500, 'occupied')
      `).run();
      testRoomId = rRes.lastInsertRowid;
    } else {
      testRoomId = room.id;
      db.prepare("UPDATE rooms SET status = 'occupied' WHERE id = ?").run(testRoomId);
    }

    const bRes = db.prepare(`
      INSERT INTO bookings (room_id, guest_id, checkin_time, room_rate, total_room_charge, status, total_paid)
      VALUES (?, ?, datetime('now'), 2500, 2500, 'active', 0)
    `).run(testRoomId, testGuestId);
    testBookingId = bRes.lastInsertRowid;

    db.prepare('UPDATE rooms SET current_booking_id = ? WHERE id = ?').run(testBookingId, testRoomId);
  });

  afterAll(() => {
    try {
      db.prepare('DELETE FROM bookings WHERE id = ?').run(testBookingId);
      db.prepare('DELETE FROM rooms WHERE room_number = ?').run('888');
      db.prepare('DELETE FROM guests WHERE id = ?').run(testGuestId);
      db.prepare("DELETE FROM restaurant_tables WHERE table_number LIKE 'TEST-%' OR table_number = 'RS-888'").run();
      db.prepare("DELETE FROM bar_tables WHERE table_number LIKE 'TEST-%' OR table_number LIKE 'BP-%'").run();
      db.prepare("DELETE FROM restaurant_orders WHERE customer_name = 'Test Diner'").run();
      db.prepare("DELETE FROM bar_orders WHERE customer_name LIKE '%Test%'").run();
    } catch (e) {
      console.warn('Cleanup error:', e.message);
    }
  });

  it('1. should allow restaurant staff to create a room service table with room_id and settle it as Paid Now at counter', async () => {
    // 1. Create Room Service table RS-888
    const createRes = await request(app)
      .post('/api/restaurant/tables')
      .set('Authorization', `Bearer ${restoToken}`)
      .send({
        table_number: 'RS-888',
        table_type: 'room_service',
        capacity: 2,
        room_id: testRoomId,
        special_notes: 'Room 888 (Test Diner)'
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body.success).toBe(true);
    const tableId = createRes.body.tableId;

    // 2. Add cart items to table
    const cartRes = await request(app)
      .post(`/api/restaurant/tables/${tableId}/cart`)
      .set('Authorization', `Bearer ${restoToken}`)
      .send({
        cart: [{ id: 101, name: 'Paneer Butter Masala', price: 250, quantity: 1 }],
        waiterName: 'Resto Waiter',
        chargeToRoomId: testRoomId
      });
    expect(cartRes.status).toBe(200);

    // 3. Settle as Paid Now in cash with room attribution (verifying error doesn't block)
    const settleRes = await request(app)
      .post(`/api/restaurant/tables/${tableId}/settle`)
      .set('Authorization', `Bearer ${restoToken}`)
      .send({
        cart: [{ id: 101, name: 'Paneer Butter Masala', price: 250, quantity: 1 }],
        payment_mode: 'cash',
        split_cash: 263,
        split_online: 0,
        split_card: 0,
        subtotal: 250,
        tax: 13,
        grandTotal: 263,
        chargeToRoomId: testRoomId,
        room_id: testRoomId,
        room_service_for: 'room_mates',
        is_paid: 1,
        settledBy: 'Resto Waiter'
      });

    expect(settleRes.status).toBe(200);
    expect(settleRes.body.success).toBe(true);
    expect(settleRes.body.order).toBeDefined();
    expect(settleRes.body.order.room_service_for).toBe('room_mates');

    // Verify order was saved in database
    const savedOrder = db.prepare('SELECT * FROM restaurant_orders WHERE id = ?').get(settleRes.body.order.id);
    expect(savedOrder).toBeDefined();
    expect(savedOrder.room_service_for).toBe('room_mates');
    expect(savedOrder.is_paid).toBe(1);
    expect(savedOrder.room_id).toBe(testRoomId);
  });

  it('2. should allow bar staff to create a takeaway parcel table (BP-1), order drinks, and settle it cleanly', async () => {
    // 1. Create Bar Parcel BP-1
    const createRes = await request(app)
      .post('/api/bar/tables')
      .set('Authorization', `Bearer ${barToken}`)
      .send({
        table_number: 'BP-1',
        table_type: 'parcel',
        capacity: 1,
        special_notes: 'Bar Takeaway Parcel #1'
      });

    expect(createRes.status).toBe(200);
    expect(createRes.body.success).toBe(true);
    const tableId = createRes.body.tableId;

    // 2. Add drink item to cart
    const cartRes = await request(app)
      .post(`/api/bar/tables/${tableId}/cart`)
      .set('Authorization', `Bearer ${barToken}`)
      .send({
        cart: [{ id: 201, name: 'Mocktail Mojito', price: 180, quantity: 2 }],
        waiterName: 'Bar Tender'
      });
    expect(cartRes.status).toBe(200);

    // 3. Settle Bar Parcel
    const settleRes = await request(app)
      .post(`/api/bar/tables/${tableId}/settle`)
      .set('Authorization', `Bearer ${barToken}`)
      .send({
        cart: [{ id: 201, name: 'Mocktail Mojito', price: 180, quantity: 2 }],
        payment_mode: 'cash',
        split_cash: 378,
        split_online: 0,
        split_card: 0,
        is_paid: 1,
        settledBy: 'Bar Tender'
      });

    expect(settleRes.status).toBe(200);
    expect(settleRes.body.success).toBe(true);

    // Verify bar order type is 'parcel'
    const barOrderId = settleRes.body.order?.id || settleRes.body.order?.orderId || settleRes.body.orderId;
    const barOrder = db.prepare('SELECT * FROM bar_orders WHERE id = ?').get(barOrderId);
    expect(barOrder).toBeDefined();
    expect(barOrder.order_type).toBe('parcel');

    // Verify the temporary parcel table BP-1 is cleaned up from bar_tables
    const tableCheck = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(tableId);
    expect(tableCheck).toBeUndefined();
  });

  it('3. should verify role isolation: restaurant staff cannot create bar tables and vice-versa', async () => {
    // Restaurant staff trying to create a bar table -> 403 Forbidden
    const res1 = await request(app)
      .post('/api/bar/tables')
      .set('Authorization', `Bearer ${restoToken}`)
      .send({
        table_number: 'TEST-BAR-99',
        table_type: 'table',
        capacity: 4
      });
    expect(res1.status).toBe(403);

    // Bar staff trying to create a restaurant table -> 403 Forbidden
    const res2 = await request(app)
      .post('/api/restaurant/tables')
      .set('Authorization', `Bearer ${barToken}`)
      .send({
        table_number: 'TEST-REST-99',
        table_type: 'dine_in',
        capacity: 4
      });
    expect(res2.status).toBe(403);

    // Manager can create both
    const res3 = await request(app)
      .post('/api/restaurant/tables')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        table_number: 'TEST-REST-99',
        table_type: 'dine_in',
        capacity: 4
      });
    expect(res3.status).toBe(200);

    const res4 = await request(app)
      .post('/api/bar/tables')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        table_number: 'TEST-BAR-99',
        table_type: 'table',
        capacity: 4
      });
    expect(res4.status).toBe(200);
  });
});
