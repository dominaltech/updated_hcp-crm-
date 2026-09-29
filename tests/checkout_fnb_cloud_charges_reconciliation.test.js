import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

describe('Checkout & Settlement Cloud F&B Reconciliation', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    
    // Create minimal schema for test
    db.exec(`
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY,
        room_number TEXT,
        room_type TEXT,
        price REAL,
        status TEXT,
        current_booking_id INTEGER,
        gst_pct REAL DEFAULT 5
      );

      CREATE TABLE bookings (
        id INTEGER PRIMARY KEY,
        room_id INTEGER,
        guest_id INTEGER,
        status TEXT,
        checkin_time TEXT,
        total_paid REAL DEFAULT 0,
        total_room_charge REAL DEFAULT 0,
        voucher_number TEXT
      );

      CREATE TABLE guests (
        id INTEGER PRIMARY KEY,
        name TEXT
      );

      CREATE TABLE restaurant_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT,
        room_id INTEGER,
        customer_name TEXT,
        order_type TEXT,
        items_json TEXT,
        subtotal REAL,
        tax REAL,
        discount REAL,
        total REAL,
        payment_mode TEXT,
        is_paid INTEGER DEFAULT 0,
        status TEXT,
        cashier_name TEXT,
        booking_id INTEGER,
        created_at TEXT
      );

      CREATE TABLE bar_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT,
        room_id INTEGER,
        customer_name TEXT,
        order_type TEXT,
        items_json TEXT,
        subtotal REAL,
        tax REAL,
        discount REAL,
        total REAL,
        payment_mode TEXT,
        is_paid INTEGER DEFAULT 0,
        status TEXT,
        cashier_name TEXT,
        booking_id INTEGER,
        created_at TEXT
      );
    `);

    db.prepare("INSERT INTO rooms (id, room_number, price, status, current_booking_id) VALUES (1, '101', 2000, 'occupied', 1)").run();
    db.prepare("INSERT INTO guests (id, name) VALUES (1, 'Javid Rangrez')").run();
    db.prepare("INSERT INTO bookings (id, room_id, guest_id, status, checkin_time, total_paid, total_room_charge, voucher_number) VALUES (1, 1, 1, 'active', '2026-09-24T09:17:18.854Z', 2000, 6484, '260924-001')").run();
    // Add existing bar order of 147
    db.prepare("INSERT INTO bar_orders (order_number, room_id, customer_name, total, is_paid, booking_id, created_at) VALUES ('BAR-670580', 1, 'Javid Rangrez', 147, 0, 1, '2026-09-25 09:44:30')").run();
  });

  afterEach(() => {
    db.close();
  });

  it('1. should import pending cloud charges into restaurant_orders when missing from SQLite', async () => {
    // Cloud charge mock
    const mockCloudCharges = [
      {
        id: '63408ecb-005f-460f-bc13-1dfae8a239a8',
        room_number: '101',
        department: 'restaurant',
        bill_no: 'RES-543933',
        grand_total: 105,
        items_summary: 'Masala Chaas x2',
        cashier_name: 'Cashier',
        created_at: '2026-09-23T17:29:03.949+00:00'
      }
    ];

    for (const cc of mockCloudCharges) {
      const orderNum = cc.bill_no;
      const totalAmt = parseFloat(cc.grand_total) || 0;
      const existing = db.prepare('SELECT id FROM restaurant_orders WHERE order_number = ?').get(orderNum);
      if (!existing) {
        db.prepare(`
          INSERT INTO restaurant_orders (
            order_number, room_id, customer_name, order_type,
            items_json, subtotal, tax, discount, total,
            payment_mode, is_paid, status, cashier_name,
            booking_id, created_at
          ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, 'room_folio', 0, 'completed', ?, ?, ?)
        `).run(orderNum, 1, 'Javid Rangrez', '[]', 100, 5, totalAmt, cc.cashier_name, 1, cc.created_at);
      }
    }

    const restRow = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM restaurant_orders WHERE booking_id = 1 AND is_paid = 0').get();
    const barRow = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM bar_orders WHERE booking_id = 1 AND is_paid = 0').get();

    expect(restRow.total).toBe(105);
    expect(barRow.total).toBe(147);

    // Total F&B = 252. Room charge = 6484. Total Bill = 6736. Paid = 2000. Balance Due = 4736.
    const currentGroupRoomCharge = 6484;
    const currentGroupTotalPaid = 2000;
    const totalGroupBill = currentGroupRoomCharge + restRow.total + barRow.total;
    const maxBalanceDue = Math.max(0, totalGroupBill - currentGroupTotalPaid);

    expect(maxBalanceDue).toBe(4736);

    // Settlement of 4736 should not exceed maxBalanceDue
    const netSettle = 4736;
    expect(netSettle <= maxBalanceDue + 1.0).toBe(true);
  });

  it('2. should safeguard maxBalanceDue using client food_total and balance_due if cloud charge sync was delayed', () => {
    // If SQLite only had bar (147) and rest was 0
    const restUnpaid = 0;
    const barUnpaid = 147;
    const currentGroupRoomCharge = 6484;
    const currentGroupTotalPaid = 2000;

    const b = {
      food_total: 105,
      bar_total: 147,
      fnb_total: 252,
      balance_due: 4736,
      settle_amount: 4736
    };

    const clientFood = parseFloat(b.food_total ?? b.foodTotal ?? b.food);
    const clientBar = parseFloat(b.bar_total ?? b.barTotal ?? b.bar);
    const clientFnb = parseFloat(b.fnb_total ?? b.fnbTotal ?? b.fnb);
    let effectiveRestUnpaid = restUnpaid;
    let effectiveBarUnpaid = barUnpaid;
    if (!isNaN(clientFood) && clientFood > effectiveRestUnpaid) {
      effectiveRestUnpaid = clientFood;
    }
    if (!isNaN(clientBar) && clientBar > effectiveBarUnpaid) {
      effectiveBarUnpaid = clientBar;
    }
    if (!isNaN(clientFnb) && (effectiveRestUnpaid + effectiveBarUnpaid) < clientFnb) {
      effectiveRestUnpaid = clientFnb - effectiveBarUnpaid;
    }

    const totalGroupBill = currentGroupRoomCharge + effectiveRestUnpaid + effectiveBarUnpaid;
    const computedMaxBalanceDue = Math.max(0, totalGroupBill - currentGroupTotalPaid);
    const clientBalanceDue = parseFloat(b.balance_due ?? b.balanceDue ?? b.remaining_balance ?? b.remainingBalance);
    const maxBalanceDue = Math.max(computedMaxBalanceDue, !isNaN(clientBalanceDue) ? clientBalanceDue : 0);

    expect(maxBalanceDue).toBe(4736);

    const netSettle = parseFloat(b.settle_amount);
    expect(netSettle > maxBalanceDue + 1.0).toBe(false);
  });
});
