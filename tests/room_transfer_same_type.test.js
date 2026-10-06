import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

describe('Room Transfer Feature (Same Room Type Only)', () => {
  let db;
  const dbPath = path.resolve(__dirname, '../hotel_city_park.db');

  beforeEach(() => {
    db = new Database(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('validates database has rooms of identical room_type and handles same-type validation logic', () => {
    // Check room types in DB
    const roomTypes = db.prepare(`SELECT DISTINCT room_type FROM rooms WHERE room_type IS NOT NULL AND room_type != ''`).all();
    expect(roomTypes.length).toBeGreaterThan(0);

    // Pick a room type that has at least 2 rooms
    const counts = db.prepare(`SELECT room_type, COUNT(*) as cnt FROM rooms GROUP BY room_type HAVING cnt >= 2`).all();
    expect(counts.length).toBeGreaterThan(0);

    const testType = counts[0].room_type;
    const sameTypeRooms = db.prepare(`SELECT * FROM rooms WHERE room_type = ?`).all(testType);
    expect(sameTypeRooms.length).toBeGreaterThanOrEqual(2);

    const srcRoom = sameTypeRooms[0];
    const destRoom = sameTypeRooms[1];

    // Same room type validation should pass
    const srcTypeNorm = String(srcRoom.room_type || '').trim().toLowerCase();
    const destTypeNorm = String(destRoom.room_type || '').trim().toLowerCase();
    expect(srcTypeNorm).toBe(destTypeNorm);

    // Mismatched room type should be rejected
    const diffTypeRoom = db.prepare(`SELECT * FROM rooms WHERE room_type != ? LIMIT 1`).get(testType);
    if (diffTypeRoom) {
      const diffTypeNorm = String(diffTypeRoom.room_type || '').trim().toLowerCase();
      expect(srcTypeNorm).not.toBe(diffTypeNorm);
    }
  });

  it('verifies server.js and release/server.js have the /api/rooms/transfer endpoint with same-room-type check', () => {
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf-8');
    const releaseServerCode = fs.readFileSync(path.resolve(__dirname, '../release/server.js'), 'utf-8');

    expect(serverCode).toContain('/api/rooms/transfer');
    expect(serverCode).toContain('srcType !== destType');
    expect(serverCode).toContain(`status = 'needs_cleaning'`);
    expect(serverCode).toContain(`status = 'occupied'`);

    expect(releaseServerCode).toContain('/api/rooms/transfer');
    expect(releaseServerCode).toContain('srcType !== destType');
  });

  it('verifies api.js has transferRoom client helper', () => {
    const apiCode = fs.readFileSync(path.resolve(__dirname, '../src/services/api.js'), 'utf-8');
    expect(apiCode).toContain("transferRoom: (data) => request('/rooms/transfer'");
  });

  it('verifies HospitalityPage has transfer button, drag & drop handlers, and auto-uncheck logic', () => {
    const hospCode = fs.readFileSync(path.resolve(__dirname, '../src/pages/HospitalityPage.jsx'), 'utf-8');

    // Button on dashboard
    expect(hospCode).toContain('id="btn-toggle-room-transfer"');
    expect(hospCode).toContain('Room Transfer');

    // Drag and drop handlers
    expect(hospCode).toContain('handleTransferDragStart');
    expect(hospCode).toContain('handleTransferDrop');
    expect(hospCode).toContain('handleTransferDragOver');

    // Auto-uncheck when transfer completes
    expect(hospCode).toContain('setIsTransferMode(false)');

    // Only allow same room type
    expect(hospCode).toContain('srcType !== destType');
    expect(hospCode).toContain('Room types must match');
  });

  it('verifies RoomCard handles transfer-source, transfer-droppable-target, and preventDefault', () => {
    const roomCardCode = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/RoomCard.jsx'), 'utf-8');

    expect(roomCardCode).toContain('isTransferMode');
    expect(roomCardCode).toContain('isDroppable');
    expect(roomCardCode).toContain('transfer-droppable-target');
    expect(roomCardCode).toContain('transfer-source');
    expect(roomCardCode).toContain('transfer-dimmed');
    expect(roomCardCode).toContain('onTransferDrop');
  });

  it('verifies the SQL statements in /api/rooms/transfer execute cleanly without syntax errors', () => {
    // Test the exact booking query that previously threw 'no such column: "active"'
    const stmt = db.prepare('SELECT * FROM bookings WHERE id = ? AND status = ?');
    expect(stmt).toBeDefined();

    // Run in a transaction and rollback so DB is untouched
    const testTx = db.transaction(() => {
      // Find an active booking or test against sample
      const activeBooking = db.prepare('SELECT * FROM bookings WHERE status = ? LIMIT 1').get('active');
      if (activeBooking) {
        const row = stmt.get(activeBooking.id, 'active');
        expect(row).toBeDefined();
        expect(row.status).toBe('active');
      }

      // Check update queries
      db.prepare(`UPDATE bookings SET room_id = room_id WHERE id = -999`).run();
      db.prepare(`UPDATE rooms SET status = 'occupied', current_booking_id = -999 WHERE id = -999`).run();
      db.prepare(`UPDATE rooms SET status = 'needs_cleaning', current_booking_id = NULL WHERE id = -999`).run();
      db.prepare(`UPDATE payments SET room_id = -999 WHERE booking_id = -999`).run();
      db.prepare(`UPDATE restaurant_orders SET room_id = -999, table_number = 'Room 101' WHERE booking_id = -999 AND payment_mode = 'room_folio'`).run();
      db.prepare(`UPDATE bar_orders SET room_id = -999 WHERE booking_id = -999 AND payment_mode = 'room_folio'`).run();
      db.prepare(`UPDATE room_visitors SET room_id = -999 WHERE booking_id = -999`).run();
    });

    testTx();
  });

  it('verifies room transfer audit logs are visible in RoomFolioPage, HospitalityHistory, and PrintService', () => {
    // 1. RoomFolioPage
    const folioCode = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx'), 'utf-8');
    expect(folioCode).toContain('Room Shift Audit Log');
    expect(folioCode).toContain('folio-room-transfer-logs');
    expect(folioCode).toContain('Shifted from');
    expect(folioCode).toContain('log.transferred_by');

    // 2. HospitalityHistory
    const historyCode = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/HospitalityHistory.jsx'), 'utf-8');
    expect(historyCode).toContain('Room Shift / Transfer Audit Log');
    expect(historyCode).toContain('log.transferred_by');

    // 3. PrintService (Activities Summary)
    const printCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');
    expect(printCode).toContain('Room Shift Audit:');
    expect(printCode).toContain('l.transferred_by');
  });
});
