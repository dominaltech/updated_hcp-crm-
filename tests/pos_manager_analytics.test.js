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

import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';
import { printPosThermalClosingSlip } from '../src/services/printService';
import fs from 'fs';
import path from 'path';

describe('POS Departmental Manager Analytics (Restaurant vs Bar Isolation)', () => {
  let managerToken;
  let restoToken;
  let barToken;
  let testRestoOrderId;
  let testBarOrderId;

  beforeAll(() => {
    managerToken = generateToken({
      id: 9981,
      username: 'test_manager_user',
      role: 'manager',
      full_name: 'General Manager',
      can_access_manager: 1
    });

    restoToken = generateToken({
      id: 9982,
      username: 'test_resto_user',
      role: 'restaurant',
      full_name: 'Resto Supervisor',
      can_access_manager: 1
    });

    barToken = generateToken({
      id: 9983,
      username: 'test_bar_user',
      role: 'bar',
      full_name: 'Bar Supervisor',
      can_access_manager: 1
    });

    // Clean up any previous test orders
    db.prepare("DELETE FROM restaurant_orders WHERE order_number = 'TEST-REST-AN-01'").run();
    db.prepare("DELETE FROM bar_orders WHERE order_number = 'TEST-BAR-AN-01'").run();

    const todayDate = new Date().toISOString().slice(0, 10);

    // Insert completed restaurant order
    const rRes = db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, table_number, customer_name, waiter_name, cashier_name,
        order_type, subtotal, tax, discount, total, payment_mode, is_paid,
        status, items_json, created_at
      ) VALUES (
        'TEST-REST-AN-01', 'T-99', 'Resto Analytics Guest', 'Sunil Waiter', 'Ramesh Cashier',
        'dine_in', 500, 25, 0, 525, 'cash', 1,
        'completed', '[{"id":101,"name":"Mughlai Biryani Special","category":"Main Course","price":500,"qty":1}]',
        datetime('now')
      )
    `).run();
    testRestoOrderId = rRes.lastInsertRowid;

    // Insert completed bar order
    const bRes = db.prepare(`
      INSERT INTO bar_orders (
        order_number, table_number, customer_name, waiter_name, cashier_name,
        order_type, subtotal, tax, discount, total, payment_mode, is_paid,
        card_surcharge, status, items_json, created_at
      ) VALUES (
        'TEST-BAR-AN-01', 'B-99', 'Bar Analytics Guest', 'Vikram Bartender', 'Suresh Cashier',
        'dine_in', 1000, 50, 0, 1050, 'card', 1,
        26.25, 'completed', '[{"id":201,"name":"Single Malt Scotch","category":"Whiskey","price":1000,"qty":1}]',
        datetime('now')
      )
    `).run();
    testBarOrderId = bRes.lastInsertRowid;
  });

  afterAll(() => {
    db.prepare("DELETE FROM restaurant_orders WHERE order_number = 'TEST-REST-AN-01'").run();
    db.prepare("DELETE FROM bar_orders WHERE order_number = 'TEST-BAR-AN-01'").run();
  });

  it('Restaurant analytics returns ONLY restaurant data and excludes bar data', async () => {
    const res = await request(app)
      .get('/api/restaurant/manager/analytics')
      .set('Authorization', `Bearer ${restoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.department).toBe('restaurant');
    expect(res.body.summary).toBeDefined();

    // Check that Mughlai Biryani is in restaurant data
    const orders = res.body.orders || [];
    const hasRestoOrder = orders.some(o => o.order_number === 'TEST-REST-AN-01');
    const hasBarOrder = orders.some(o => o.order_number === 'TEST-BAR-AN-01');

    expect(hasRestoOrder).toBe(true);
    expect(hasBarOrder).toBe(false); // CRITICAL: Strict department isolation

    const hasBiryani = (res.body.topItems || []).some(i => i.name.includes('Mughlai Biryani Special'));
    const hasScotch = (res.body.topItems || []).some(i => i.name.includes('Single Malt Scotch'));

    expect(hasBiryani).toBe(true);
    expect(hasScotch).toBe(false); // Must not leak bar drinks into restaurant
  });

  it('Bar analytics returns ONLY bar data and excludes restaurant data', async () => {
    const res = await request(app)
      .get('/api/bar/manager/analytics')
      .set('Authorization', `Bearer ${barToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.department).toBe('bar');
    expect(res.body.summary).toBeDefined();

    const orders = res.body.orders || [];
    const hasBarOrder = orders.some(o => o.order_number === 'TEST-BAR-AN-01');
    const hasRestoOrder = orders.some(o => o.order_number === 'TEST-REST-AN-01');

    expect(hasBarOrder).toBe(true);
    expect(hasRestoOrder).toBe(false); // CRITICAL: Strict department isolation

    const hasScotch = (res.body.topItems || []).some(i => i.name.includes('Single Malt Scotch'));
    const hasBiryani = (res.body.topItems || []).some(i => i.name.includes('Mughlai Biryani Special'));

    expect(hasScotch).toBe(true);
    expect(hasBiryani).toBe(false); // Must not leak restaurant dishes into bar
  });

  it('supports Manager and Admin roles across both departmental endpoints', async () => {
    const restoRes = await request(app)
      .get('/api/restaurant/manager/analytics')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(restoRes.status).toBe(200);

    const barRes = await request(app)
      .get('/api/bar/manager/analytics')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(barRes.status).toBe(200);
  });

  it('verifies printPosThermalClosingSlip function exists and is exported in printService', () => {
    expect(typeof printPosThermalClosingSlip).toBe('function');
  });

  it('verifies PosManagerPanel has the Financial Analytics subnav pill and activeTab view', () => {
    const panelPath = path.resolve(__dirname, '../src/components/restaurant/PosManagerPanel.jsx');
    const content = fs.readFileSync(panelPath, 'utf8');

    expect(content).toContain("activeTab === 'analytics'");
    expect(content).toContain("Financial Analytics");
    expect(content).toContain("printPosThermalClosingSlip");
    expect(content).toContain("Print Shift Audit (80mm)");
    expect(content).toContain("Total Realized Revenue");
    expect(content).toContain("Net Cash in Drawer");
    expect(content).toContain("Room Folio");
  });
});
