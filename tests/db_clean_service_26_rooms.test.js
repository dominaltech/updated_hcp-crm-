import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { cleanDemoData } from '../services/dbCleanService';

describe('Clean Slate / Purge Demo Data - 26 Official Rooms Preservation', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_number TEXT UNIQUE NOT NULL,
        floor TEXT DEFAULT 'First Floor',
        room_type TEXT NOT NULL,
        price REAL NOT NULL,
        price_single REAL DEFAULT NULL,
        max_adults INTEGER NOT NULL DEFAULT 2,
        max_children INTEGER NOT NULL DEFAULT 1,
        max_discount_pct REAL NOT NULL DEFAULT 15,
        ext_grace_mins INTEGER NOT NULL DEFAULT 60,
        ext_3h_rate REAL NOT NULL DEFAULT 500,
        ext_6h_rate REAL NOT NULL DEFAULT 1000,
        ext_9h_rate REAL NOT NULL DEFAULT 1500,
        breakfast_price REAL DEFAULT 250,
        max_extra_beds INTEGER DEFAULT 1,
        extra_bed_price REAL DEFAULT 500,
        gst_pct REAL NOT NULL DEFAULT 5,
        extra_bed_gst_pct REAL DEFAULT 5,
        breakfast_gst_pct REAL DEFAULT 5,
        ext_3h_gst_pct REAL DEFAULT 5,
        ext_6h_gst_pct REAL DEFAULT 5,
        ext_9h_gst_pct REAL DEFAULT 5,
        single_gst_pct REAL DEFAULT 5,
        ota_early_checkin_price REAL DEFAULT 900,
        ota_early_checkin_max_hours INTEGER DEFAULT 6,
        ota_early_checkin_gst_pct REAL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'ready',
        current_booking_id INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS guests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        guest_id INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restaurant_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bar_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restaurant_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT DEFAULT 'available',
        active_cart_json TEXT DEFAULT '[]',
        printed_cart_json TEXT DEFAULT '[]',
        kot_count INTEGER DEFAULT 0,
        token_number INTEGER DEFAULT 0,
        waiter_name TEXT DEFAULT '',
        special_notes TEXT DEFAULT '',
        order_started_at DATETIME DEFAULT NULL,
        is_split INTEGER DEFAULT 0,
        parent_table_id INTEGER DEFAULT NULL,
        room_id INTEGER DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS bar_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT DEFAULT 'available',
        active_cart_json TEXT DEFAULT '[]',
        printed_cart_json TEXT DEFAULT '[]',
        bot_count INTEGER DEFAULT 0,
        token_number INTEGER DEFAULT 0,
        waiter_name TEXT DEFAULT '',
        special_notes TEXT DEFAULT '',
        order_started_at DATETIME DEFAULT NULL,
        is_split INTEGER DEFAULT 0,
        parent_table_id INTEGER DEFAULT NULL,
        room_id INTEGER DEFAULT NULL
      );
    `);

    // Insert dummy demo transactions
    db.prepare("INSERT INTO guests (name) VALUES ('Test Guest 1'), ('Test Guest 2')").run();
    db.prepare("INSERT INTO bookings (room_id, guest_id, status) VALUES (1, 1, 'active'), (2, 2, 'checked_out')").run();
    db.prepare("INSERT INTO payments (amount) VALUES (1500), (2500)").run();
    db.prepare("INSERT INTO expenses (amount) VALUES (300)").run();
    db.prepare("INSERT INTO restaurant_orders (order_number) VALUES ('ORD-991')").run();
    db.prepare("INSERT INTO bar_orders (order_number) VALUES ('BAR-881')").run();

    // Insert some temporary/demo rooms (771, 881, 101) alongside some real ones (102)
    db.prepare("INSERT INTO rooms (room_number, room_type, price, status, current_booking_id) VALUES ('771', 'Temp Room', 1000, 'occupied', 1)").run();
    db.prepare("INSERT INTO rooms (room_number, room_type, price, status, current_booking_id) VALUES ('881', 'Temp Room', 1000, 'occupied', 2)").run();
    db.prepare("INSERT INTO rooms (room_number, room_type, price, status, current_booking_id) VALUES ('101', 'Old Test Room', 1000, 'ready', NULL)").run();
    db.prepare("INSERT INTO rooms (room_number, room_type, price, status, current_booking_id) VALUES ('102', 'Old Exec', 2000, 'occupied', 1)").run();
  });

  it('purges all demo transactions and guarantees all 26 official rooms in ready status', () => {
    const stats = cleanDemoData(db);

    expect(stats.bookingsDeleted).toBe(2);
    expect(stats.guestsDeleted).toBe(2);
    expect(stats.paymentsDeleted).toBe(2);
    expect(stats.expensesDeleted).toBe(1);
    expect(stats.restOrdersDeleted).toBe(1);
    expect(stats.barOrdersDeleted).toBe(1);
    expect(stats.roomsPreserved).toBe(26);

    // Verify all transactions are gone
    expect(db.prepare('SELECT COUNT(*) as cnt FROM bookings').get().cnt).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as cnt FROM guests').get().cnt).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as cnt FROM payments').get().cnt).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as cnt FROM expenses').get().cnt).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as cnt FROM restaurant_orders').get().cnt).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as cnt FROM bar_orders').get().cnt).toBe(0);

    // Verify demo rooms (771, 881, 101) are gone
    const demoRooms = db.prepare("SELECT room_number FROM rooms WHERE room_number IN ('771', '881', '101')").all();
    expect(demoRooms.length).toBe(0);

    // Verify exactly 26 rooms exist
    const allRooms = db.prepare('SELECT room_number, room_type, price, price_single, status, current_booking_id FROM rooms ORDER BY CAST(room_number AS INTEGER) ASC').all();
    expect(allRooms.length).toBe(26);

    // All rooms must be 'ready' with NULL current_booking_id
    allRooms.forEach(r => {
      expect(r.status).toBe('ready');
      expect(r.current_booking_id).toBeNull();
    });

    // Check specific room configurations
    const r102 = allRooms.find(r => r.room_number === '102');
    expect(r102.room_type).toBe('Executive Room');
    expect(r102.price).toBe(2500);
    expect(r102.price_single).toBe(2200);

    const r201 = allRooms.find(r => r.room_number === '201');
    expect(r201.room_type).toBe('Deluxe Room');
    expect(r201.price).toBe(2800);
    expect(r201.price_single).toBe(2500);

    const r310 = allRooms.find(r => r.room_number === '310');
    expect(r310.room_type).toBe('Suit Room');
    expect(r310.price).toBe(4500);
    expect(r310.price_single).toBe(3600);

    const r401 = allRooms.find(r => r.room_number === '401');
    expect(r401.room_type).toBe('Pent Hosue');
    expect(r401.price).toBe(4800);
    expect(r401.price_single).toBe(4200);
  });
});
