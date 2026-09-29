import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Room Folio Itemized Checkout Comparison Breakdown Test Suite', () => {
  let hospitalityToken;
  let testRoomId;
  let testBookingId;

  beforeAll(async () => {
    hospitalityToken = generateToken({
      id: 8881,
      username: 'test_cashier_breakdown',
      role: 'hospitality',
      full_name: 'Breakdown Cashier',
      can_access_manager: 1
    });

    // Create or reset room 995 (₹2,500 base rate, 5% GST, extension rates)
    let r = db.prepare("SELECT id FROM rooms WHERE room_number = '995'").get();
    if (!r) {
      const ins = db.prepare(`
        INSERT INTO rooms (
          room_number, room_type, price, status, gst_pct,
          ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate, breakfast_price
        ) VALUES ('995', 'Executive Suite', 2500, 'ready', 5, 60, 500, 1000, 1500, 250)
      `).run();
      testRoomId = ins.lastInsertRowid;
    } else {
      db.prepare(`
        UPDATE rooms SET 
          status = 'ready', current_booking_id = NULL, price = 2500, gst_pct = 5,
          ext_grace_mins = 60, ext_3h_rate = 500, ext_6h_rate = 1000, ext_9h_rate = 1500, breakfast_price = 250
        WHERE id = ?
      `).run(r.id);
      testRoomId = r.id;
    }

    // Checkin: 25 hours 15 mins ago (1 day & 1 hr elapsed, exceeds 60m grace period)
    const now = new Date();
    const checkinTime = new Date(now.getTime() - (25 * 60 + 15) * 60 * 1000).toISOString();
    const approxCheckoutTime = new Date(now.getTime() + 47 * 60 * 60 * 1000).toISOString(); // 72 hours total from check-in

    // Create guest
    const guestRes = db.prepare("INSERT INTO guests (name, mobile, doc_type) VALUES (?, ?, 'Aadhaar')")
      .run(`Test Guest Itemized ${Date.now()}`, '9998887776');
    const guestId = guestRes.lastInsertRowid;

    // Create booking: 3 days, ₹2,500/day base + 1 extra bed @ ₹500/day + with_breakfast @ ₹250/day
    // Pre-tax per day = 2500 + 500 + 250 = 3250.
    // 3 days pre-tax = 9750. 5% GST = 488. Total = 10238.
    // Initial advance paid = 2000.
    const bookingRes = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, checkin_time, approx_checkout_time, room_rate, total_room_charge,
        total_paid, split_cash, extra_beds, extra_bed_charge, meal_plan,
        adults_male, adults_female, status
      ) VALUES (?, ?, ?, ?, 2500, 10238, 2000, 2000, 1, 500, 'with_breakfast', 1, 0, 'active')
    `).run(testRoomId, guestId, checkinTime, approxCheckoutTime);

    testBookingId = bookingRes.lastInsertRowid;
    db.prepare("UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?")
      .run(testBookingId, testRoomId);

    const uniqRcpt = `RCP-ADV-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    db.prepare(`
      INSERT INTO payments (
        receipt_no, booking_id, room_id, department, payment_type, payment_mode,
        amount, cashier_name, notes
      ) VALUES (?, ?, ?, 'hospitality', 'advance', 'cash', 2000, 'Front Desk', 'Advance 2000 payment')
    `).run(uniqRcpt, testBookingId, testRoomId);

    // Add an unpaid restaurant order of ₹252 (₹240 taxable + ₹12 GST)
    const orderNum = `ORD-995-${Date.now()}`;
    db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, booking_id, room_id, customer_name, order_type,
        items_json, subtotal, tax, total,
        payment_mode, is_paid, created_at
      ) VALUES (?, ?, ?, 'Test Guest Itemized', 'room', '[]', 240, 12, 252, 'room_folio', 0, datetime('now'))
    `).run(orderNum, testBookingId, testRoomId);
  });

  it('1. GET /api/rooms/:id/folio returns enriched itemized breakdown for stayCalcNow', async () => {
    const res = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const nowCalc = res.body.folio.summary.stayCalcNow;
    expect(nowCalc).toBeDefined();

    // 1 day + 1 hr elapsed
    expect(nowCalc.chargedDays).toBe(1);
    expect(nowCalc.extraHours).toBe(1);

    // Base room tariff: 1 day * 2500 = 2500, 5% GST = 125, Total = 2625
    expect(nowCalc.baseRoomTariff).toBe(2500);
    expect(nowCalc.baseRoomTariffGst).toBe(125);
    expect(nowCalc.baseRoomTotal).toBe(2625);

    // Extra mattress: 1 day * 500 = 500, 5% GST = 25, Total = 525
    expect(nowCalc.extraMattressCost).toBe(500);
    expect(nowCalc.extraMattressGst).toBe(25);
    expect(nowCalc.extraMattressTotal).toBe(525);

    // Breakfast: 1 pax * 1 day * 250 = 250, 5% GST = 13 (Math.round(12.5)), Total = 263
    expect(nowCalc.breakfastCost).toBe(250);
    expect(nowCalc.breakfastGst).toBe(13);
    expect(nowCalc.breakfastTotal).toBe(263);

    // 1 hr extension (≤ 3 hours tier = 500), 5% GST = 25, Total = 525
    expect(nowCalc.extensionCharge).toBe(500);
    expect(nowCalc.extensionGst).toBe(25);
    expect(nowCalc.extensionTotal).toBe(525);

    // Sum of inclusive items: 2625 + 525 + 263 + 525 = 3938
    expect(nowCalc.baseRoomTotal + nowCalc.extraMattressTotal + nowCalc.breakfastTotal + nowCalc.extensionTotal).toBe(nowCalc.roomCharge);

    // Pre-tax subtotal = 2500 + 500 + 250 + 500 = 3750
    expect(nowCalc.roomSubtotalPreTax).toBe(3750);
    // GST = 188
    expect(nowCalc.roomGst).toBe(188);
    // Room Charge (Incl. GST) = 3938
    expect(nowCalc.roomCharge).toBe(3938);

    // F&B: 252 total (240 taxable + 12 GST)
    expect(nowCalc.fnbTotal).toBe(252);
    expect(nowCalc.fnbTaxable).toBe(240);
    expect(nowCalc.fnbGst).toBe(12);

    // Grand total: 3938 + 252 = 4190
    expect(nowCalc.grandTotal).toBe(4190);
    // Paid: 2000
    expect(nowCalc.paid).toBe(2000);
    // Balance to collect: 2190
    expect(nowCalc.balanceDue).toBe(2190);
    expect(nowCalc.refundDue).toBe(0);
  });

  it('2. GET /api/rooms/:id/folio returns enriched itemized breakdown for stayCalcDeclared', async () => {
    const res = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const decCalc = res.body.folio.summary.stayCalcDeclared;
    expect(decCalc).toBeDefined();

    // 3 days booked (72 hours)
    expect(decCalc.expectedNights).toBe(3);

    // Base room tariff: 3 days * 2500 = 7500, 5% GST = 375, Total = 7875
    expect(decCalc.baseRoomTariff).toBe(7500);
    expect(decCalc.baseRoomTariffGst).toBe(375);
    expect(decCalc.baseRoomTotal).toBe(7875);

    // Extra mattress: 3 days * 500 = 1500, 5% GST = 75, Total = 1575
    expect(decCalc.extraMattressCost).toBe(1500);
    expect(decCalc.extraMattressGst).toBe(75);
    expect(decCalc.extraMattressTotal).toBe(1575);

    // Breakfast: 1 pax * 3 days * 250 = 750, 5% GST = 38 (Math.round(37.5)), Total = 788
    expect(decBreakfastCost(decCalc)).toBe(750);
    expect(decCalc.breakfastGst).toBe(38);
    expect(decCalc.breakfastTotal).toBe(788);

    // No extension for declared time
    expect(decCalc.extensionCharge).toBe(0);
    expect(decCalc.extensionTotal).toBe(0);

    // Sum of inclusive items: 7875 + 1575 + 788 = 10238
    expect(decCalc.baseRoomTotal + decCalc.extraMattressTotal + decCalc.breakfastTotal).toBe(decCalc.roomCharge);

    // Pre-tax subtotal = 7500 + 1500 + 750 = 9750
    expect(decCalc.roomSubtotalPreTax).toBe(9750);
    // GST = 488
    expect(decCalc.roomGst).toBe(488);
    // Room Charge (Incl. GST) = 10238
    expect(decCalc.roomCharge).toBe(10238);

    // F&B: 252 total (240 taxable + 12 GST)
    expect(decCalc.fnbTotal).toBe(252);
    expect(decCalc.fnbTaxable).toBe(240);
    expect(decCalc.fnbGst).toBe(12);

    // Grand total: 10238 + 252 = 10490
    expect(decCalc.grandTotal).toBe(10490);
    // Paid: 2000
    expect(decCalc.paid).toBe(2000);
    // Balance to collect: 8490
    expect(decCalc.balanceDue).toBe(8490);
    expect(decCalc.refundDue).toBe(0);
  });

  it('3. GET /api/rooms/:id/folio properly calculates stay duration (1 day & 2 hrs), includes 2h extension tier charge (+ ₹500), and computes discount and taxable base accurately', async () => {
    // Reset room 995 with 26 hours elapsed (1 day & 2 hrs) and ₹2000 rate
    const now = new Date();
    const checkinTime = new Date(now.getTime() - (26 * 60 + 34) * 60 * 1000).toISOString(); // 26h 34m ago
    const approxCheckoutTime = new Date(now.getTime() + 45 * 60 * 60 * 1000).toISOString(); // 3 days total

    db.prepare('UPDATE rooms SET price = 2000 WHERE id = ?').run(testRoomId);
    // Update booking checkin_time, 5% discount
    db.prepare(`
      UPDATE bookings SET
        checkin_time = ?, approx_checkout_time = ?, room_rate = 2000,
        discount_pct = 5, discount_amount = 163, total_room_charge = 3241,
        total_paid = 2000, split_cash = 2000, extra_beds = 1, extra_bed_charge = 500,
        meal_plan = 'with_breakfast', adults_male = 1, adults_female = 2
      WHERE id = ?
    `).run(checkinTime, approxCheckoutTime, testBookingId);

    const res = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const nowCalc = res.body.folio.summary.stayCalcNow;
    expect(nowCalc).toBeDefined();

    // 1 day + 2 hrs elapsed
    expect(nowCalc.stayDurationStr).toBe('1 day & 2 hrs');
    expect(nowCalc.chargedDays).toBe(1);
    expect(nowCalc.extraHours).toBe(2);

    // Extension charge for 2h (between 60m and 180m = 500)
    expect(nowCalc.extensionCharge).toBe(500);

    // Base Room Tariff = 1 * 2000 = 2000
    expect(nowCalc.baseRoomTariff).toBe(2000);
    // Base Extra Mattress = 1 * 500 = 500
    expect(nowCalc.extraMattressCost).toBe(500);
    // Breakfast = 3 pax * 250 = 750
    expect(nowCalc.breakfastCost).toBe(750);

    // Total Base Tariff = 2000 + 500 + 750 + 500 = 3750
    const totalBase = nowCalc.baseRoomTariff + nowCalc.extraMattressCost + nowCalc.breakfastCost + nowCalc.extensionCharge;
    expect(totalBase).toBe(3750);

    // Discount Applied (5% of 3750) = 188
    expect(nowCalc.discountAmount).toBe(188);

    // Net Taxable Subtotal = 3750 - 188 = 3562
    expect(nowCalc.roomSubtotalPreTax).toBe(3562);

    // Room GST (5% of 3562) = 178
    expect(nowCalc.roomGst).toBe(178);

    // Room Stay (Incl. GST) = 3562 + 178 = 3740
    expect(nowCalc.roomCharge).toBe(3740);

    // F&B = 252 (240 taxable + 12 GST)
    expect(nowCalc.fnbTotal).toBe(252);

    // Total Stay Bill = 3740 + 252 = 3992
    expect(nowCalc.grandTotal).toBe(3992);

    // Advance Paid = 2000
    expect(nowCalc.paid).toBe(2000);

    // Balance to Collect = 3992 - 2000 = 1992
    expect(nowCalc.balanceDue).toBe(1992);
  });
});

function decBreakfastCost(decCalc) {
  return decCalc.breakfastCost;
}
