import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

describe('Official Hotel Rooms Seeder', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_number TEXT UNIQUE NOT NULL,
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

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  it('contains exactly 40 rooms in DEFAULT_ROOMS_CATALOG matching all user specs', async () => {
    const mainDb = await import('../database.js');
    const catalog = mainDb.default.DEFAULT_ROOMS_CATALOG;
    expect(catalog).toBeDefined();
    expect(catalog.length).toBe(40);

    // Executive Rooms (29 rooms: 15 original + 402-409 + 501-506)
    const execRooms = catalog.filter(r => r.room_type === 'Executive Room');
    expect(execRooms.length).toBe(29);
    expect(execRooms.map(r => r.room_number)).toEqual([
      '102', '103', '104', '204', '205', '206', '207', '208', '209', '303', '304', '305', '306', '307', '308',
      '402', '403', '404', '405', '406', '407', '408', '409',
      '501', '502', '503', '504', '505', '506'
    ]);
    const updatedExec = execRooms.filter(r => !['209', '308'].includes(r.room_number));
    updatedExec.forEach(r => {
      expect(r.price_single).toBe(2050);
      expect(r.price).toBe(2350);
    });

    // 6 Executive Plus Rooms
    const execPlusRooms = catalog.filter(r => r.room_type === 'Executive Plus');
    expect(execPlusRooms.length).toBe(6);
    expect(execPlusRooms.map(r => r.room_number)).toEqual(['202', '203', '210', '211', '302', '309']);
    execPlusRooms.forEach(r => {
      expect(r.price_single).toBe(2150);
      expect(r.price).toBe(2450);
    });

    // 3 Deluxe Rooms
    const deluxeRooms = catalog.filter(r => r.room_type === 'Deluxe Room');
    expect(deluxeRooms.length).toBe(3);
    expect(deluxeRooms.map(r => r.room_number)).toEqual(['201', '212', '301']);
    deluxeRooms.forEach(r => {
      expect(r.price_single).toBe(2350);
      expect(r.price).toBe(2650);
      expect(r.max_discount_pct).toBe(15);
      expect(r.max_adults).toBe(2);
      expect(r.max_children).toBe(2);
      expect(r.max_extra_beds).toBe(2);
      expect(r.extra_bed_price).toBe(600);
    });

    // 1 Suit Room (310)
    const suitRoom = catalog.find(r => r.room_number === '310');
    expect(suitRoom).toBeDefined();
    expect(suitRoom.room_type).toBe('Suit Room');
    expect(suitRoom.price_single).toBe(3500);
    expect(suitRoom.price).toBe(4000);
    expect(suitRoom.max_discount_pct).toBe(15);
    expect(suitRoom.max_adults).toBe(2);
    expect(suitRoom.max_children).toBe(2);
    expect(suitRoom.max_extra_beds).toBe(3);
    expect(suitRoom.extra_bed_price).toBe(600);

    // 1 Pent House (401)
    const pentRoom = catalog.find(r => r.room_number === '401');
    expect(pentRoom).toBeDefined();
    expect(pentRoom.room_type).toBe('Pent House');
    expect(pentRoom.price_single).toBe(4500);
    expect(pentRoom.price).toBe(5000);
    expect(pentRoom.max_discount_pct).toBe(15);
    expect(pentRoom.max_adults).toBe(2);
    expect(pentRoom.max_children).toBe(2);
    expect(pentRoom.max_extra_beds).toBe(3);
    expect(pentRoom.extra_bed_price).toBe(600);
  });
});
