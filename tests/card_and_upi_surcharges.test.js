import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Card Surcharge (2.5%) & UPI Convenience Tax (0.4% > ₹2,000) Test Suite', () => {
  let managerToken;
  let hospitalityToken;
  let testRoomId;

  beforeAll(async () => {
    managerToken = generateToken({
      id: 9991,
      username: 'test_manager',
      role: 'manager',
      full_name: 'Hotel Manager',
      can_access_manager: 1
    });

    hospitalityToken = generateToken({
      id: 9992,
      username: 'test_frontdesk',
      role: 'hospitality',
      full_name: 'Front Desk',
      can_access_manager: 1
    });

    // Ensure dedicated test room
    let room = db.prepare("SELECT id, room_number FROM rooms WHERE room_number = '888'").get();
    if (!room) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status) VALUES (?, ?, ?, ?)").run('888', 'Executive Suite', 3000, 'ready');
      testRoomId = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(room.id);
      testRoomId = room.id;
    }

    // Reset surcharge settings to default (2.5%, 0.4%, 2000)
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('card_surcharge_pct', '2.5', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = '2.5', updated_at = CURRENT_TIMESTAMP
    `).run();
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('upi_tax_pct', '0.4', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = '0.4', updated_at = CURRENT_TIMESTAMP
    `).run();
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES ('upi_tax_threshold', '2000', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = '2000', updated_at = CURRENT_TIMESTAMP
    `).run();
  });

  it('1. should calculate and record 2.5% card surcharge and 0.4% UPI tax on Check-in Advance', async () => {
    // Card = ₹4,000 (surcharge = 4000 * 0.025 = 100)
    // UPI = ₹5,000 (tax = 5000 * 0.004 = 20)
    const checkinPayload = {
      roomId: testRoomId,
      guestName: 'Vikram Malhotra',
      mobile: '9876541230',
      stayNights: 3,
      baseRate: 3000,
      totalDue: 9000,
      totalPaid: 9000,
      splitCash: 0,
      splitCard: 4000,
      splitOnline: 5000,
      onlineUtr: 'UTR123456789012',
      bookingSource: 'Walk-in'
    };

    const res = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send(checkinPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const bookingId = res.body.booking?.id || res.body.data?.id || res.body.bookingId;
    expect(bookingId).toBeDefined();

    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
    expect(booking).toBeDefined();
    // 2.5% on 4000 = 100
    expect(booking.advance_card_surcharge).toBe(100);
    // 0.4% on 5000 = 20
    expect(booking.advance_upi_tax).toBe(20);

    // Verify payments ledger
    const pmt = db.prepare("SELECT * FROM payments WHERE booking_id = ? AND payment_type = 'advance'").get(bookingId);
    expect(pmt).toBeDefined();
    expect(pmt.card_surcharge).toBe(100);
    expect(pmt.upi_tax).toBe(20);
  });

  it('2. should incur 0% UPI tax when UPI amount is <= ₹2,000', async () => {
    // Set room ready again
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId);

    const checkinPayload = {
      roomId: testRoomId,
      guestName: 'Rahul Verma',
      mobile: '9876541231',
      stayNights: 1,
      baseRate: 2000,
      totalDue: 2000,
      totalPaid: 2000,
      splitCash: 500,
      splitCard: 0,
      splitOnline: 1500, // <= 2000 => 0 tax
      onlineUtr: 'UTR999999999999',
      bookingSource: 'Walk-in'
    };

    const res = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send(checkinPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const bookingId = res.body.booking?.id || res.body.data?.id || res.body.bookingId;
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
    expect(booking.advance_card_surcharge).toBe(0);
    expect(booking.advance_upi_tax).toBe(0);
  });

  it('3. should calculate and persist card surcharge and UPI tax on Restaurant Table settle', async () => {
    // Ensure test restaurant table
    let table = db.prepare("SELECT id FROM restaurant_tables WHERE table_number = 'T-99'").get();
    let tableId;
    if (!table) {
      const ins = db.prepare("INSERT INTO restaurant_tables (table_number, table_type, capacity, status) VALUES ('T-99', 'dine_in', 4, 'available')").run();
      tableId = ins.lastInsertRowid;
    } else {
      tableId = table.id;
    }

    const settlePayload = {
      cart: [
        { id: 1, name: 'Paneer Butter Masala', price: 2500, qty: 1 },
        { id: 2, name: 'Butter Naan', price: 500, qty: 5 }
      ],
      paymentMode: 'split',
      splitCash: 0,
      splitCard: 2000,  // 2.5% of 2000 = 50
      splitOnline: 3000, // 0.4% of 3000 = 12
      utr_number: 'UTR888888888888',
      subtotal: 5000,
      gst: 250,
      grandTotal: 5000,
      is_paid: 1,
      settledBy: 'Cashier'
    };

    const res = await request(app)
      .post(`/api/restaurant/tables/${tableId}/settle`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send(settlePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const orderId = res.body.order?.orderId || res.body.order?.id;
    const order = db.prepare("SELECT * FROM restaurant_orders WHERE id = ?").get(orderId);
    expect(order).toBeDefined();
    expect(order.card_surcharge).toBe(50);
    expect(order.upi_tax).toBe(12);
  });

  it('4. should aggregate card surcharges and UPI taxes in Manager Analytics', async () => {
    const res = await request(app)
      .get('/api/manager/analytics')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const stats = res.body.stats;
    expect(stats.totalCardSurcharge).toBeGreaterThanOrEqual(150); // 100 + 50
    expect(stats.totalUpiTax).toBeGreaterThanOrEqual(32); // 20 + 12
    expect(stats.totalSurcharges).toBe(stats.totalCardSurcharge + stats.totalUpiTax);

    // Verify analytics breakdown
    const analytics = res.body.analytics;
    expect(analytics.surcharges).toBeDefined();
    expect(analytics.surcharges.cardSurcharge).toBe(stats.totalCardSurcharge);
    expect(analytics.surcharges.upiTax).toBe(stats.totalUpiTax);
    expect(analytics.surcharges.total).toBe(stats.totalSurcharges);
  });

  it('5. should record and retrieve checkout extension audit log with cashier name, from_time and to_time', async () => {
    // Reset test room
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId);

    // 1. Checkin
    const checkinRes = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        roomId: testRoomId,
        guestName: 'Arjun Kapoor',
        mobile: '9876541234',
        stayNights: 1,
        baseRate: 3000,
        totalDue: 3000,
        totalPaid: 3000,
        splitCash: 3000,
        approxCheckout: '2026-09-20T11:00:00',
        bookingSource: 'Walk-in'
      });

    expect(checkinRes.status).toBe(200);
    const bookingId = checkinRes.body.booking?.id || checkinRes.body.data?.id || checkinRes.body.bookingId;

    // 2. Extend Checkout
    const extendRes = await request(app)
      .post(`/api/bookings/${bookingId}/extend-checkout`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        approx_checkout_time: '2026-09-22T12:00:00',
        extended_by: 'Rohit Cashier'
      });

    expect(extendRes.status).toBe(200);
    expect(extendRes.body.success).toBe(true);
    expect(extendRes.body.extension_log).toBeDefined();
    expect(extendRes.body.extension_log.extended_by).toBe('Rohit Cashier');
    expect(extendRes.body.extension_log.to_time).toBe('2026-09-22T12:00:00');

    // 3. Fetch Folio
    const folioRes = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(folioRes.status).toBe(200);
    expect(folioRes.body.folio?.room?.extension_logs).toBeDefined();
    expect(folioRes.body.folio.room.extension_logs.length).toBeGreaterThanOrEqual(1);

    const latestLog = folioRes.body.folio.room.extension_logs[folioRes.body.folio.room.extension_logs.length - 1];
    expect(latestLog.extended_by).toBe('Rohit Cashier');
    expect(latestLog.to_time).toBe('2026-09-22T12:00:00');
  });

  it('6. should fetch default surcharge settings from GET /api/settings/surcharges', async () => {
    const res = await request(app)
      .get('/api/settings/surcharges')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.settings).toBeDefined();
    expect(typeof res.body.settings.card_surcharge_pct).toBe('number');
    expect(typeof res.body.settings.upi_tax_pct).toBe('number');
    expect(typeof res.body.settings.upi_tax_threshold).toBe('number');
  });

  it('7. should update surcharge settings via POST /api/settings/surcharges and dynamically apply them', async () => {
    // 1. Update rates: Card to 3.0%, UPI to 0.5%, threshold to 1500
    const updateRes = await request(app)
      .post('/api/settings/surcharges')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        card_surcharge_pct: 3.0,
        upi_tax_pct: 0.5,
        upi_tax_threshold: 1500
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.settings.card_surcharge_pct).toBe(3.0);
    expect(updateRes.body.settings.upi_tax_pct).toBe(0.5);
    expect(updateRes.body.settings.upi_tax_threshold).toBe(1500);

    // 2. Perform a checkin and verify new dynamic rates are applied
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId);

    const checkinPayload = {
      roomId: testRoomId,
      guestName: 'Neha Sharma',
      mobile: '9876541239',
      stayNights: 2,
      baseRate: 3000,
      totalDue: 6000,
      totalPaid: 6000,
      splitCash: 0,
      splitCard: 4000,   // 3.0% of 4000 = 120
      splitOnline: 2000, // > 1500 threshold, so 0.5% of 2000 = 10
      onlineUtr: 'UTR777777777777',
      bookingSource: 'Walk-in'
    };

    const res = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send(checkinPayload);

    expect(res.status).toBe(200);
    const bookingId = res.body.booking?.id || res.body.data?.id || res.body.bookingId;
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(bookingId);
    expect(booking.advance_card_surcharge).toBe(120);
    expect(booking.advance_upi_tax).toBe(10);

    // 3. Reset back to defaults (2.5%, 0.4%, 2000)
    await request(app)
      .post('/api/settings/surcharges')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        card_surcharge_pct: 2.5,
        upi_tax_pct: 0.4,
        upi_tax_threshold: 2000
      });
  });

  afterAll(async () => {
    try {
      db.pragma('foreign_keys = OFF');
      if (testRoomId) {
        const bookings = db.prepare("SELECT id FROM bookings WHERE room_id = ?").all(testRoomId);
        for (const b of bookings) {
          db.prepare("DELETE FROM payments WHERE booking_id = ?").run(b.id);
          db.prepare("DELETE FROM checkout_extension_logs WHERE booking_id = ?").run(b.id);
          db.prepare("DELETE FROM bookings WHERE id = ?").run(b.id);
        }
        db.prepare("DELETE FROM rooms WHERE id = ?").run(testRoomId);
      }
      db.prepare("DELETE FROM guests WHERE name IN ('Vikram Malhotra', 'Rahul Verma', 'Arjun Kapoor')").run();
      db.prepare("DELETE FROM restaurant_orders WHERE table_number = 'T-99'").run();
      db.prepare("DELETE FROM restaurant_tables WHERE table_number = 'T-99'").run();
      db.pragma('foreign_keys = ON');
    } catch (e) {}
  });
});
