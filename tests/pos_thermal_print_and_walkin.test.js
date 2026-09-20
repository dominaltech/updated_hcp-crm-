import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import { printThermalBillSlip, printCheckoutSlip, formatPaymentBreakdown } from '../src/services/printService';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

describe('Restaurant & Bar 80mm Thermal Print & Walk-In Settlement Tests', () => {
  let restoToken;
  let barToken;
  let testTableId;

  beforeAll(() => {
    restoToken = generateToken({
      id: 9991,
      username: 'test_resto_cashier',
      role: 'restaurant',
      full_name: 'Resto Cashier',
      can_access_manager: 0
    });

    barToken = generateToken({
      id: 9992,
      username: 'test_bar_cashier',
      role: 'bar',
      full_name: 'Bar Cashier',
      can_access_manager: 0
    });

    // Clean up any existing test table
    db.prepare("DELETE FROM restaurant_tables WHERE table_number = 'T99TEST'").run();

    // Create a temporary test table
    const tblRes = db.prepare(`
      INSERT INTO restaurant_tables (table_number, table_type, capacity, status, active_cart_json)
      VALUES ('T99TEST', 'dine_in', 4, 'occupied', '[{"id":1,"name":"Paneer Tikka","price":280,"qty":2,"tax":14}]')
    `).run();
    testTableId = tblRes.lastInsertRowid;
  });

  afterAll(() => {
    db.prepare("DELETE FROM restaurant_tables WHERE table_number = 'T99TEST'").run();
  });

  it('verifies TableSettleModal does NOT import or call printCashReceipt', () => {
    const modalPath = path.resolve(__dirname, '../src/components/restaurant/TableSettleModal.jsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    // Must NOT import printCashReceipt
    expect(content).not.toContain('import { printCashReceipt');
    expect(content).not.toContain('printCashReceipt({');

    // Must import printThermalBillSlip
    expect(content).toContain('printThermalBillSlip');
  });

  it('formatPaymentBreakdown formats cash, card fee, upi utr, and split correctly', () => {
    const cashOrder = { payment_mode: 'cash', total: 500 };
    expect(formatPaymentBreakdown(cashOrder)).toBe('Cash: ₹500');

    const upiOrder = { payment_mode: 'online', total: 2500, upi_tax: 10, utr_number: 'UTR4321' };
    const upiFormatted = formatPaymentBreakdown(upiOrder);
    expect(upiFormatted).toContain('Online UPI');
    expect(upiFormatted).toContain('UTR: UTR4321');

    const splitOrder = {
      payment_mode: 'split',
      split_cash: 300,
      split_online: 500,
      split_card: 200,
      card_surcharge: 5,
      utr_number: 'SPLIT999'
    };
    const splitFormatted = formatPaymentBreakdown(splitOrder);
    expect(splitFormatted).toContain('Cash: ₹300');
    expect(splitFormatted).toContain('UPI: ₹500');
    expect(splitFormatted).toContain('UTR: SPLIT999');
    expect(splitFormatted).toContain('Card: ₹205');
  });

  it('printCheckoutSlip handles direct order and nested res.order without error', () => {
    // Should safely format without throws even in headless environment (where window.print / iframe might fail silently)
    const directOrder = {
      orderNumber: 'POS-TEST-1',
      token_number: 7,
      table_number: 'T1',
      customer_name: 'Table T1 Guest',
      subtotal: 560,
      tax: 28,
      total: 588,
      items: [{ name: 'Butter Naan', qty: 4, price: 40 }, { name: 'Dal Tadka', qty: 2, price: 200 }]
    };

    expect(() => {
      printThermalBillSlip(directOrder, 'HOTEL CITY PARK - RESTAURANT');
    }).not.toThrow();

    // Nested response object from api.settleRestaurantTable
    const nestedRes = {
      success: true,
      order: directOrder
    };

    expect(() => {
      printThermalBillSlip(nestedRes, 'HOTEL CITY PARK - RESTAURANT');
    }).not.toThrow();
  });

  it('settles a walk-in dining table via API with proper thermal slip fields returned', async () => {
    const settlePayload = {
      cart: [{ id: 1, name: 'Paneer Tikka', price: 280, qty: 2 }],
      items: [{ id: 1, name: 'Paneer Tikka', price: 280, qty: 2 }],
      paymentMode: 'cash',
      payment_mode: 'cash',
      splitCash: 588,
      split_cash: 588,
      splitOnline: 0,
      splitCard: 0,
      subtotal: 560,
      gst: 28,
      grandTotal: 588,
      chargeToRoomId: null,
      room_id: null,
      room_service_for: null,
      customer_name: 'Table T99 Guest',
      is_paid: 1,
      settledBy: 'Resto Cashier'
    };

    const res = await request(app)
      .post(`/api/restaurant/tables/${testTableId}/settle`)
      .set('Authorization', `Bearer ${restoToken}`)
      .send(settlePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.orderNumber).toBeDefined();
    expect(res.body.order.customer_name).toBe('Table T99 Guest');
    expect(res.body.order.total).toBe(588);
    expect(res.body.order.is_bar).toBe(false);

    // Clean up created order
    if (res.body.order.id) {
      db.prepare('DELETE FROM restaurant_orders WHERE id = ?').run(res.body.order.id);
      db.prepare('DELETE FROM bill_logs WHERE order_id = ?').run(res.body.order.id);
    }
  });
});
