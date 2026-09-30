import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../server.js';
import db from '../database.js';
import { generateToken } from '../middleware/auth.js';

describe('OTA Prepaid with F&B Bill & Dark Mode CSS Test Suite', () => {
  let authToken;

  beforeAll(() => {
    authToken = generateToken({
      id: 9992,
      username: 'test_admin_ota',
      role: 'admin',
      full_name: 'Test OTA Admin',
      can_access_manager: 1
    });
  });

  it('verifies dark mode CSS rules for restaurant cart buttons, dish names, and clean history layout', () => {
    const cssPath = path.resolve(__dirname, '../public/styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // 1. Dish names in dark mode
    expect(cssContent).toContain('.pos-dish-name');
    expect(cssContent).toContain('[data-theme="dark"] .pos-dish-name');

    // 2. Cart -, + quantity buttons
    expect(cssContent).toContain('.btn-cart-qty-ctrl');
    expect(cssContent).toContain('[data-theme="dark"] .btn-cart-qty-ctrl');

    // 3. Settled bills dark mode row
    expect(cssContent).toContain('tr.settled-bill-row');
    expect(cssContent).toContain('[data-theme="dark"] tr.settled-bill-row');

    // 4. Clean history layout rules
    expect(cssContent).toContain('.history-guest-avatar');
    expect(cssContent).toContain('.history-guest-subtext');
    expect(cssContent).toContain('.history-col-duration');
    expect(cssContent).toContain('.history-col-staff');
    expect(cssContent).toContain('.history-btc-pending-amount');
  });

  it('verifies that an OTA Prepaid stay with F&B bill settled to room returns ONLY F&B due (not Stay + F&B)', async () => {
    // 1. Create a dummy guest and OTA prepaid booking
    const guestRes = db.prepare(`
      INSERT INTO guests (name, mobile, doc_type)
      VALUES ('OTA Prepaid Guest Test', '9876543210', 'Aadhaar Card')
    `).run();
    const guestId = guestRes.lastInsertRowid;

    // Pick or create a test room
    let room = db.prepare("SELECT * FROM rooms WHERE status = 'ready' LIMIT 1").get();
    if (!room) {
      room = db.prepare("SELECT * FROM rooms LIMIT 1").get();
    }

    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time,
        booking_source, ota_platform, is_prepaid, rate_type,
        room_rate, total_room_charge, total_paid, status, ota_bill_amount
      ) VALUES (
        ?, ?, datetime('now', '-2 hours'), datetime('now', '+1 day'),
        'OTA', 'Goibibo', 1, 'prepaid',
        5000, 5000, 0, 'active', 5000
      )
    `).run(room.id, guestId);
    const bookingId = bookingRes.lastInsertRowid;

    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?").run(bookingId, room.id);

    // 2. Add an unpaid F&B order settled to room folio (₹515)
    const fnbRes = db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, room_id, customer_name, order_type,
        items_json, subtotal, tax, total, is_paid, payment_mode,
        booking_id, status, created_at
      ) VALUES (
        ?, ?, 'OTA Prepaid Guest Test', 'room',
        '[]', 490, 25, 515, 0, 'room_folio',
        ?, 'completed', datetime('now')
      )
    `).run(`RES-TEST-${Date.now()}`, room.id, bookingId);

    try {
      // 3. Call GET /api/rooms/:id/folio
      const res = await request(app)
        .get(`/api/rooms/${room.id}/folio`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const folio = res.body.folio;
      const summary = folio.summary;

      // The balance due must strictly be ₹515 (the F&B bill), NOT ₹5515 (5000 stay + 515)!
      expect(summary.balanceDue).toBe(515);
      expect(summary.foodTotal).toBe(515);
      expect(summary.isOtaPrepaid).toBe(true);
      expect(summary.isOtaPayAtHotel).toBe(false);
    } finally {
      // Clean up test data
      db.prepare('DELETE FROM restaurant_orders WHERE id = ?').run(fnbRes.lastInsertRowid);
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(room.id);
      db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
      db.prepare('DELETE FROM guests WHERE id = ?').run(guestId);
    }
  });
});
