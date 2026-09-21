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
import { buildGuestRegistrationHTML } from '../src/services/printService';

describe('BTC Settlement Accounting, Cheque Tracking & Full Screen Modal Test Suite', () => {
  let managerToken;
  let guestId;
  let roomId;
  let testCompanyId;
  let bookingCashId;
  let bookingUpiId;
  let bookingChequeId;

  beforeAll(() => {
    managerToken = generateToken({
      id: 9991,
      username: 'test_manager',
      role: 'manager',
      full_name: 'Hotel Manager',
      can_access_manager: 1
    });

    // Create test guest
    const guestRes = db.prepare(`
      INSERT INTO guests (name, mobile, doc_type, aadhar_number)
      VALUES ('Javid Rangrez', '9028850715', 'Aadhaar Card', '123456789012')
    `).run();
    guestId = guestRes.lastInsertRowid;

    // Create test room
    const roomRes = db.prepare(`
      INSERT INTO rooms (room_number, room_type, price, status)
      VALUES ('T-102', 'Deluxe AC', 2000, 'occupied')
    `).run();
    roomId = roomRes.lastInsertRowid;

    // Create test BTC company
    const compRes = db.prepare(`
      INSERT INTO btc_companies (company_name, gst_number, credit_limit, is_active)
      VALUES ('Infosys BPM Technologies', '27AABCI1234F1Z5', 100000, 1)
    `).run();
    testCompanyId = compRes.lastInsertRowid;

    // Create 3 BTC bookings
    const b1 = db.prepare(`
      INSERT INTO bookings (
        guest_id, room_id, room_rate, checkin_time, total_room_charge, total_paid,
        booking_source, btc_company_id, btc_company_name, payment_status, status
      ) VALUES (?, ?, 2000, datetime('now'), 2126, 0, 'BTC', ?, 'Infosys BPM Technologies', 'pending_from_company', 'checked_out')
    `).run(guestId, roomId, testCompanyId);
    bookingCashId = b1.lastInsertRowid;

    const b2 = db.prepare(`
      INSERT INTO bookings (
        guest_id, room_id, room_rate, checkin_time, total_room_charge, total_paid,
        booking_source, btc_company_id, btc_company_name, payment_status, status
      ) VALUES (?, ?, 3500, datetime('now'), 3500, 0, 'BTC', ?, 'Infosys BPM Technologies', 'pending_from_company', 'checked_out')
    `).run(guestId, roomId, testCompanyId);
    bookingUpiId = b2.lastInsertRowid;

    const b3 = db.prepare(`
      INSERT INTO bookings (
        guest_id, room_id, room_rate, checkin_time, total_room_charge, total_paid,
        booking_source, btc_company_id, btc_company_name, payment_status, status
      ) VALUES (?, ?, 5000, datetime('now'), 5000, 0, 'BTC', ?, 'Infosys BPM Technologies', 'pending_from_company', 'checked_out')
    `).run(guestId, roomId, testCompanyId);
    bookingChequeId = b3.lastInsertRowid;
  });

  afterAll(() => {
    if (bookingCashId) db.prepare("DELETE FROM payments WHERE booking_id = ?").run(bookingCashId);
    if (bookingUpiId) db.prepare("DELETE FROM payments WHERE booking_id = ?").run(bookingUpiId);
    if (bookingChequeId) db.prepare("DELETE FROM payments WHERE booking_id = ?").run(bookingChequeId);
    if (bookingCashId) db.prepare("DELETE FROM bookings WHERE id = ?").run(bookingCashId);
    if (bookingUpiId) db.prepare("DELETE FROM bookings WHERE id = ?").run(bookingUpiId);
    if (bookingChequeId) db.prepare("DELETE FROM bookings WHERE id = ?").run(bookingChequeId);
    if (testCompanyId) db.prepare("DELETE FROM btc_companies WHERE id = ?").run(testCompanyId);
    if (roomId) db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
    if (guestId) db.prepare("DELETE FROM guests WHERE id = ?").run(guestId);
  });

  it('1. Check-in Registration Form: should NOT contain "HOTEL INCIDENTALS BREAKDOWN: ROOM & SERVICES Room Tariff: ₹ 0 Total Paid / Settled: ₹ 0"', () => {
    const btcBookingData = {
      id: 872,
      guest_name: 'Javid Rangrez',
      mobile: '9028850715',
      room_number: '102',
      booking_source: 'BTC',
      btc_company_name: 'Infosys BPM Technologies',
      total_room_charge: 2126,
      total_paid: 0,
      extra_bed_charge: 0,
      fnb_total: 0
    };

    const html = buildGuestRegistrationHTML(btcBookingData);
    expect(html).not.toContain('HOTEL INCIDENTALS BREAKDOWN: ROOM &amp; SERVICES');
    expect(html).not.toContain('HOTEL INCIDENTALS BREAKDOWN: ROOM & SERVICES');
    expect(html).not.toContain('Total Paid / Settled: ₹ 0');
  });

  it('2. Settle BTC via Cash: should increase cash inflow, drawer cash, and hospitality cash', async () => {
    // Settle bookingCashId via Cash
    const res = await request(app)
      .post(`/api/hospitality/history/${bookingCashId}/payment-status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        payment_status: 'settled',
        settlement_mode: 'cash',
        amount_paid: 2126,
        cashier_name: 'Cashier 1'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify analytics reflects the settled cash
    const today = new Date().toISOString().slice(0, 10);
    const analyticsRes = await request(app)
      .get(`/api/manager/analytics?fromDate=${today}&toDate=${today}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(analyticsRes.status).toBe(200);
    const an = analyticsRes.body.analytics;
    expect(an.breakdown.btcSettlements.cash).toBeGreaterThanOrEqual(2126);
    expect(an.breakdown.hospitality.cash).toBeGreaterThanOrEqual(2126);
    expect(an.paymentModes.cash).toBeGreaterThanOrEqual(2126);
    expect(an.drawer.totalCashInflow).toBeGreaterThanOrEqual(2126);
  });

  it('3. Settle BTC via UPI: should increase UPI inflow and hospitality UPI', async () => {
    // Settle bookingUpiId via UPI
    const res = await request(app)
      .post(`/api/hospitality/history/${bookingUpiId}/payment-status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        payment_status: 'settled',
        settlement_mode: 'upi',
        amount_paid: 3500,
        cashier_name: 'Cashier 1',
        transaction_id: 'UPI1234567890'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify analytics reflects the settled UPI
    const today = new Date().toISOString().slice(0, 10);
    const analyticsRes = await request(app)
      .get(`/api/manager/analytics?fromDate=${today}&toDate=${today}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(analyticsRes.status).toBe(200);
    const an = analyticsRes.body.analytics;
    expect(an.breakdown.btcSettlements.upi).toBeGreaterThanOrEqual(3500);
    expect(an.breakdown.hospitality.upi).toBeGreaterThanOrEqual(3500);
    expect(an.paymentModes.upi).toBeGreaterThanOrEqual(3500);
  });

  it('4. Settle BTC via Cheque: should track in btcCheque and passed cheques', async () => {
    // Settle bookingChequeId via Cheque
    const res = await request(app)
      .post(`/api/hospitality/history/${bookingChequeId}/payment-status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        payment_status: 'settled',
        settlement_mode: 'cheque',
        amount_paid: 5000,
        cashier_name: 'Accounts',
        cheque_no: 'CHQ-882201',
        bank_name: 'State Bank of India',
        cheque_status: 'realized'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify analytics reflects BTC Cheque passed
    const today = new Date().toISOString().slice(0, 10);
    const analyticsRes = await request(app)
      .get(`/api/manager/analytics?fromDate=${today}&toDate=${today}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(analyticsRes.status).toBe(200);
    const an = analyticsRes.body.analytics;
    expect(an.btcCheque).toBeDefined();
    expect(an.btcCheque.passed_amount).toBeGreaterThanOrEqual(5000);
    expect(an.paymentModes.btcCheque).toBeGreaterThanOrEqual(5000);
    expect(an.breakdown.hospitality.cheque_realized).toBeGreaterThanOrEqual(5000);
    expect(an.btcCorporate.btc_cheque_passed).toBeGreaterThanOrEqual(5000);
  });

  it('5. Daily Closing API: should include BTC Cash, UPI, and Cheque settlements accurately', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const closingRes = await request(app)
      .get(`/api/reports/daily-closing?date=${today}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(closingRes.status).toBe(200);
    expect(closingRes.body.success).toBe(true);
    const rep = closingRes.body.data;
    expect(rep.btcSettlement).toBeDefined();
    expect(rep.btcSettlement.cash).toBeGreaterThanOrEqual(2126);
    expect(rep.btcSettlement.online).toBeGreaterThanOrEqual(3500);
    expect(rep.btcSettlement.cheque).toBeGreaterThanOrEqual(5000);
    expect(rep.summary.totalInflowCash).toBeGreaterThanOrEqual(2126);
    expect(rep.onlineCollections).toBeGreaterThanOrEqual(3500);
    expect(rep.chequeCollections).toBeGreaterThanOrEqual(5000);
  });
});
