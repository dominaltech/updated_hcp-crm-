import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Cross-Stay F&B Order Isolation & OTA Pay-at-Hotel Entire Amount', () => {
  let token;
  let testRoomId1;
  let testRoomId2;

  beforeAll(async () => {
    token = generateToken({
      id: 9991,
      username: 'test_frontdesk_isolation',
      role: 'manager',
      full_name: 'Isolation Test Officer',
      can_access_manager: 1
    });

    // Room 881
    let r1 = db.prepare("SELECT id FROM rooms WHERE room_number = '881'").get();
    if (!r1) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status) VALUES ('881', 'Deluxe AC', 2000, 'ready')").run();
      testRoomId1 = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(r1.id);
      testRoomId1 = r1.id;
    }

    // Room 882
    let r2 = db.prepare("SELECT id FROM rooms WHERE room_number = '882'").get();
    if (!r2) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status) VALUES ('882', 'Deluxe AC', 2000, 'ready')").run();
      testRoomId2 = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(r2.id);
      testRoomId2 = r2.id;
    }
  });

  it('ensures orders from a previous customer do NOT appear on a new customer stay in the same room', async () => {
    // 1. Check in Guest A in Room 881
    const checkinA = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        room_id: testRoomId1,
        guest_name: 'Guest A (Previous)',
        mobile: '9876543210',
        checkin_time: new Date(Date.now() - 3600000).toISOString(),
        stay_nights: 1,
        booking_source: 'Walk-in'
      });
    expect(checkinA.status).toBe(200);
    const bookingIdA = checkinA.body.booking?.id || checkinA.body.bookingId;

    // 2. Create an F&B order for Room 881 during Guest A's stay via table settle
    const tableRow = db.prepare("SELECT * FROM restaurant_tables WHERE table_number = 'RS-881'").get();
    let tableId = tableRow?.id;
    if (!tableId) {
      const insTable = db.prepare("INSERT INTO restaurant_tables (table_number, table_type, status, room_id) VALUES ('RS-881', 'dine_in', 'available', ?)").run(testRoomId1);
      tableId = insTable.lastInsertRowid;
    }

    const orderResA = await request(app)
      .post(`/api/restaurant/tables/${tableId}/settle`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        room_id: testRoomId1,
        customer_name: 'Guest A',
        items: [{ id: 1, name: 'Biryani', price: 300, quantity: 1, qty: 1 }],
        payment_mode: 'cash',
        split_cash: 300,
        split_details: { cash: 300 }
      });
    expect(orderResA.status).toBe(200);
    const orderIdA = orderResA.body.order?.id;

    // Verify orderIdA is linked to bookingIdA
    const savedOrderA = db.prepare('SELECT booking_id FROM restaurant_orders WHERE id = ?').get(orderIdA);
    expect(savedOrderA.booking_id).toBe(bookingIdA);

    // 3. Checkout Guest A
    const checkoutA = await request(app)
      .post(`/api/checkout/${testRoomId1}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        final_payment_mode: 'cash',
        settle_amount: 2000
      });
    expect(checkoutA.status).toBe(200);

    // Mark room ready
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId1);

    // 4. Check in Guest B in Room 881
    const checkinB = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        room_id: testRoomId1,
        guest_name: 'Guest B (New Customer)',
        mobile: '9123456780',
        checkin_time: new Date().toISOString(),
        stay_nights: 1,
        booking_source: 'Walk-in'
      });
    expect(checkinB.status).toBe(200);

    // 5. Fetch Room 881 Folio for Guest B
    const folioB = await request(app)
      .get(`/api/rooms/${testRoomId1}/folio`)
      .set('Authorization', `Bearer ${token}`);
    expect(folioB.status).toBe(200);

    // VERIFY: Guest A's order does NOT appear in Guest B's stay!
    const ordersB = folioB.body.folio?.restaurantOrders || [];
    const foundOrderA = ordersB.find(o => o.id === orderIdA);
    expect(foundOrderA).toBeUndefined();
    expect(ordersB.length).toBe(0);
    expect(folioB.body.folio?.summary?.foodTotal).toBe(0);
  });

  it('ensures OTA Pay-at-Hotel shows and calculates the ENTIRE amount (voucher + hotel extras)', async () => {
    // Check in with OTA Agoda, Pay at Hotel, voucher 1200, extra bed 500
    const checkinOta = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        room_id: testRoomId2,
        guest_name: 'Rahul Agoda',
        mobile: '9888877777',
        checkin_time: new Date().toISOString(),
        stay_nights: 1,
        booking_source: 'OTA',
        ota_platform: 'Agoda',
        ota_booking_id: 'AG-998877',
        ota_bill_amount: 1200,
        is_prepaid: 0,
        rate_type: 'pay_at_hotel',
        extra_beds: 1,
        extra_bed_charge: 500,
        extra_adults: 1,
        split_cash: 0,
        split_card: 0,
        split_online: 0
      });
    expect(checkinOta.status).toBe(200);
    const booking = checkinOta.body.booking;

    // In DB, total_room_charge must be 1700 (1200 voucher + 500 extra bed)
    const savedBooking = db.prepare('SELECT total_room_charge, is_prepaid, ota_bill_amount, extra_bed_charge FROM bookings WHERE id = ?').get(booking.id);
    expect(savedBooking.is_prepaid).toBe(0);
    expect(savedBooking.total_room_charge).toBe(1700);

    // Fetch Folio
    const folioRes = await request(app)
      .get(`/api/rooms/${testRoomId2}/folio`)
      .set('Authorization', `Bearer ${token}`);
    expect(folioRes.status).toBe(200);

    const summary = folioRes.body.folio?.summary;
    expect(summary.isOtaPayAtHotel).toBe(true);
    expect(summary.isOtaPrepaid).toBe(false);
    expect(summary.roomCharge).toBe(1700); // ENTIRE amount, not just 500!
    expect(summary.netTotalCharge).toBe(1700);
    expect(summary.balanceDue).toBe(1700);

    // Settle checkout with 1700
    const checkoutRes = await request(app)
      .post(`/api/checkout/${testRoomId2}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        final_payment_mode: 'cash',
        settle_amount: 1700,
        split_cash: 1700
      });
    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
  });

  it('ensures multi-room Group Booking for OTA Pay-at-Hotel accurately calculates total package + extras, advance, and remaining balance due', async () => {
    // Reset rooms to ready
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id IN (?, ?)").run(testRoomId1, testRoomId2);

    // Check in 2 rooms: Room 881 (primary) + Room 882 (additional)
    // OTA voucher: 1,200 (Agoda - 2 Rooms, 1 Night)
    // Hotel extra bed: 4 beds @ 500 = 2,000
    // Total entire booking: 1,200 + 2,000 = 3,200
    // Advance paid at checkin: 2,000
    // Expected remaining balance due: 1,200
    const checkinGroup = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        room_id: testRoomId1,
        additional_room_ids: [testRoomId2],
        additionalRooms: [testRoomId2],
        guest_name: 'Group Agoda Guest',
        mobile: '9811223344',
        checkin_time: new Date().toISOString(),
        stay_nights: 1,
        booking_source: 'OTA',
        ota_platform: 'Agoda',
        ota_booking_id: 'AG-GROUP-102103',
        ota_bill_amount: 1200,
        is_prepaid: 0,
        rate_type: 'pay_at_hotel',
        extra_beds: 4,
        extra_bed_charge: 2000,
        extra_adults: 4,
        split_cash: 2000,
        split_card: 0,
        split_online: 0,
        advance_payment: 2000
      });
    expect(checkinGroup.status).toBe(200);

    // Fetch Folio for Room 881
    const folioGroup = await request(app)
      .get(`/api/rooms/${testRoomId1}/folio`)
      .set('Authorization', `Bearer ${token}`);
    expect(folioGroup.status).toBe(200);

    const summary = folioGroup.body.folio?.summary;
    expect(summary.isOtaPayAtHotel).toBe(true);
    expect(summary.isOtaPrepaid).toBe(false);
    expect(summary.otaBillAmount).toBe(1200);
    expect(summary.hotelExtrasCharge).toBe(2000);
    expect(summary.roomCharge).toBe(3200); // 1200 voucher + 2000 extras
    expect(summary.grandTotal).toBe(3200);
    expect(summary.advancePaid).toBe(2000);
    expect(summary.balanceDue).toBe(1200); // 3200 - 2000 = 1200 remaining due!

    // Verify linked rooms in folio
    expect(folioGroup.body.folio?.room?.is_combined).toBe(true);
    expect(folioGroup.body.folio?.room?.all_group_rooms?.length).toBe(2);

    // Settle checkout with remaining 1200
    const checkoutGroup = await request(app)
      .post(`/api/checkout/${testRoomId1}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        final_payment_mode: 'cash',
        settle_amount: 1200,
        split_cash: 1200
      });
    expect(checkoutGroup.status).toBe(200);
    expect(checkoutGroup.body.success).toBe(true);

    // Both rooms must now be marked needs_cleaning
    const r1 = db.prepare('SELECT status, current_booking_id FROM rooms WHERE id = ?').get(testRoomId1);
    const r2 = db.prepare('SELECT status, current_booking_id FROM rooms WHERE id = ?').get(testRoomId2);
    expect(r1.status).toBe('needs_cleaning');
    expect(r1.current_booking_id).toBeNull();
    expect(r2.status).toBe('needs_cleaning');
    expect(r2.current_booking_id).toBeNull();
  });
});
