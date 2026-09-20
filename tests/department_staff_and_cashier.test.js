import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Department-Specific Staff Management & Cashier Tracking Tests', () => {
  let managerToken;
  let restoManagerStaff;
  let restoManagerToken;
  let restoRegularStaff;
  let restoRegularToken;
  let barStaff;
  let barToken;

  beforeAll(async () => {
    // Generate token for general manager
    managerToken = generateToken({
      id: 9991,
      username: 'test_admin',
      role: 'manager',
      full_name: 'Super Manager',
      can_access_manager: 1
    });

    // Create a restaurant staff with can_access_manager = 1
    const r1Res = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        username: `test_rest_mgr_${Date.now()}`,
        password: 'password123',
        full_name: 'Resto Manager',
        role: 'restaurant',
        can_access_manager: 1
      });
    expect(r1Res.status).toBe(200);
    restoManagerStaff = r1Res.body.user;

    restoManagerToken = generateToken({
      id: restoManagerStaff.id,
      username: restoManagerStaff.username,
      role: 'restaurant',
      full_name: restoManagerStaff.full_name,
      can_access_manager: 1
    });

    // Create a regular restaurant staff with can_access_manager = 0
    const r2Res = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        username: `test_rest_reg_${Date.now()}`,
        password: 'password123',
        full_name: 'Resto Regular',
        role: 'restaurant',
        can_access_manager: 0
      });
    expect(r2Res.status).toBe(200);
    restoRegularStaff = r2Res.body.user;

    restoRegularToken = generateToken({
      id: restoRegularStaff.id,
      username: restoRegularStaff.username,
      role: 'restaurant',
      full_name: restoRegularStaff.full_name,
      can_access_manager: 0
    });

    // Create a bar staff
    const bRes = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        username: `test_bar_${Date.now()}`,
        password: 'password123',
        full_name: 'Bar Staff',
        role: 'bar',
        can_access_manager: 0
      });
    expect(bRes.status).toBe(200);
    barStaff = bRes.body.user;

    barToken = generateToken({
      id: barStaff.id,
      username: barStaff.username,
      role: 'bar',
      full_name: barStaff.full_name,
      can_access_manager: 0
    });
  });

  afterAll(() => {
    // Cleanup test users
    if (restoManagerStaff) db.prepare('DELETE FROM staff_users WHERE id = ?').run(restoManagerStaff.id);
    if (restoRegularStaff) db.prepare('DELETE FROM staff_users WHERE id = ?').run(restoRegularStaff.id);
    if (barStaff) db.prepare('DELETE FROM staff_users WHERE id = ?').run(barStaff.id);
  });

  describe('1. Department-Specific Staff Isolation', () => {
    it('1.1 should filter GET /api/staff by department=restaurant', async () => {
      const res = await request(app)
        .get('/api/staff?department=restaurant')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.staff)).toBe(true);
      expect(res.body.staff.length).toBeGreaterThan(0);
      res.body.staff.forEach((u) => {
        expect(u.role).toBe('restaurant');
      });
    });

    it('1.2 should filter GET /api/staff by department=bar', async () => {
      const res = await request(app)
        .get('/api/staff?department=bar')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.staff)).toBe(true);
      expect(res.body.staff.length).toBeGreaterThan(0);
      res.body.staff.forEach((u) => {
        expect(u.role).toBe('bar');
      });
    });

    it('1.3 should allow restaurant staff with can_access_manager to manage restaurant staff', async () => {
      const uname = `sub_rest_${Date.now()}`;
      const res = await request(app)
        .post('/api/staff')
        .set('Authorization', `Bearer ${restoManagerToken}`)
        .send({
          username: uname,
          password: 'password123',
          full_name: 'Sub Resto Cashier',
          role: 'restaurant',
          can_access_manager: 0
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const createdId = res.body.staff_id;
      db.prepare('DELETE FROM staff_users WHERE id = ?').run(createdId);
    });
  });

  describe('2. Manager Panel Access Permissions (can_access_manager)', () => {
    it('2.1 should allow staff with can_access_manager = 1 into manager routes', async () => {
      const res = await request(app)
        .get('/api/staff?department=restaurant')
        .set('Authorization', `Bearer ${restoManagerToken}`);

      expect(res.status).toBe(200);
    });

    it('2.2 should BLOCK staff with can_access_manager = 0 from manager routes', async () => {
      const res = await request(app)
        .get('/api/staff?department=bar') // Regular resto staff attempting to fetch other department staff
        .set('Authorization', `Bearer ${restoRegularToken}`);

      expect(res.status).toBe(403);
    });

    it('2.3 should embed can_access_manager in JWT and login response', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: restoManagerStaff.username,
          password: 'password123'
        });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(Boolean(res.body.user.can_access_manager)).toBe(true);
      expect(res.body.token).toBeDefined();
    });
  });

  describe('3. Cashier Tracking on Settled Bills', () => {
    it('3.1 should record cashier name on restaurant order settle', async () => {
      // Create a test table or ensure one exists
      let testTable = db.prepare("SELECT id, table_number FROM restaurant_tables WHERE status = 'available' LIMIT 1").get();
      if (!testTable) {
        const ins = db.prepare("INSERT INTO restaurant_tables (table_number, table_type, capacity, status, active_cart_json) VALUES ('TEST-T99', 'dine_in', 4, 'available', '[]')").run();
        testTable = { id: ins.lastInsertRowid, table_number: 'TEST-T99' };
      }

      // Add cart to table
      await request(app)
        .post(`/api/restaurant/tables/${testTable.id}/cart`)
        .set('Authorization', `Bearer ${restoManagerToken}`)
        .send({
          cart: [{ id: 9999, name: 'Test Paneer', price: 200, quantity: 1, is_veg: 1 }]
        });

      // Settle table with cashier_name
      const settleRes = await request(app)
        .post(`/api/restaurant/tables/${testTable.id}/settle`)
        .set('Authorization', `Bearer ${restoManagerToken}`)
        .send({
          payment_mode: 'Cash',
          cashier_name: 'Resto Manager'
        });

      expect(settleRes.status).toBe(200);
      expect(settleRes.body.success).toBe(true);
      expect(settleRes.body.order).toBeDefined();
      expect(settleRes.body.order.cashier_name).toBe('Resto Manager');

      // Cleanup
      if (settleRes.body.order?.orderId || settleRes.body.order?.id) {
        const oId = settleRes.body.order.orderId || settleRes.body.order.id;
        db.prepare('DELETE FROM restaurant_orders WHERE id = ?').run(oId);
      }
      db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]' WHERE id = ?").run(testTable.id);
      if (testTable.table_number === 'TEST-T99') {
        db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(testTable.id);
      }
    });

    it('3.2 should record cashier name on bar order settle', async () => {
      let testTable = db.prepare("SELECT id, table_number FROM bar_tables WHERE status = 'available' LIMIT 1").get();
      if (!testTable) {
        const ins = db.prepare("INSERT INTO bar_tables (table_number, table_type, capacity, status, active_cart_json) VALUES ('TEST-B99', 'table', 4, 'available', '[]')").run();
        testTable = { id: ins.lastInsertRowid, table_number: 'TEST-B99' };
      }

      // Add cart to bar table
      await request(app)
        .post(`/api/bar/tables/${testTable.id}/cart`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          cart: [{ id: 9998, name: 'Test Mocktail', price: 250, quantity: 1, is_veg: 1 }]
        });

      // Settle bar table with cashier_name
      const settleRes = await request(app)
        .post(`/api/bar/tables/${testTable.id}/settle`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          payment_mode: 'Online',
          cashier_name: 'Bar Cashier Super'
        });

      expect(settleRes.status).toBe(200);
      expect(settleRes.body.success).toBe(true);
      expect(settleRes.body.order).toBeDefined();
      expect(settleRes.body.order.cashier_name).toBe('Bar Cashier Super');

      // Cleanup
      if (settleRes.body.order?.orderId || settleRes.body.order?.id) {
        const oId = settleRes.body.order.orderId || settleRes.body.order.id;
        db.prepare('DELETE FROM bar_orders WHERE id = ?').run(oId);
      }
      db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]' WHERE id = ?").run(testTable.id);
      if (testTable.table_number === 'TEST-B99') {
        db.prepare('DELETE FROM bar_tables WHERE id = ?').run(testTable.id);
      }
    });

    it('9. should return ONLY hospitality staff & general managers for hospitality manager panel (strictly excluding resto & bar)', async () => {
      const res = await request(app)
        .get('/api/auth/staff-list-public?department=manager&manager_for=hospitality');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.staff)).toBe(true);

      // Verify no restaurant or bar staff are present
      const hasResto = res.body.staff.some(s => s.role === 'restaurant');
      const hasBar = res.body.staff.some(s => s.role === 'bar');
      expect(hasResto).toBe(false);
      expect(hasBar).toBe(false);

      // Verify general managers and hospitality managers are allowed
      const onlyValidRoles = res.body.staff.every(s => s.role === 'manager' || s.role === 'hospitality');
      expect(onlyValidRoles).toBe(true);
    });

    it('10. should reject restaurant or bar staff from unlocking the hospitality manager panel', async () => {
      const res = await request(app)
        .post('/api/auth/verify-manager-lock')
        .send({
          username: restoManagerStaff.username,
          password: 'password123',
          target_department: 'hospitality'
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('hospitality');
    });
  });
});
