import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Checkout Settlement Fixes: TDZ and Input Persistence', () => {
  const serverPath = path.resolve(__dirname, '../server.js');
  const releaseServerPath = path.resolve(__dirname, '../release/server.js');
  const folioSettlementPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');

  it('1. server.js defines primaryBooking BEFORE isOtaPrepaidInitial and final_payment_mode', () => {
    const serverCode = fs.readFileSync(serverPath, 'utf8');
    const primaryBookingIndex = serverCode.indexOf("const primaryBooking = db.prepare('SELECT b.*, g.name as guest_name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);");
    const isOtaPrepaidIndex = serverCode.indexOf("const isOtaPrepaidInitial = (primaryBooking.booking_source || '').toUpperCase() === 'OTA'");

    expect(primaryBookingIndex).toBeGreaterThan(-1);
    expect(isOtaPrepaidIndex).toBeGreaterThan(-1);
    // primaryBooking MUST be declared BEFORE isOtaPrepaidInitial
    expect(isOtaPrepaidIndex).toBeGreaterThan(primaryBookingIndex);
  });

  it('2. release/server.js defines primaryBooking BEFORE isOtaPrepaidInitial and final_payment_mode', () => {
    const releaseCode = fs.readFileSync(releaseServerPath, 'utf8');
    const primaryBookingIndex = releaseCode.indexOf("const primaryBooking = db.prepare('SELECT b.*, g.name as guest_name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);");
    const isOtaPrepaidIndex = releaseCode.indexOf("const isOtaPrepaidInitial = (primaryBooking.booking_source || '').toUpperCase() === 'OTA'");

    expect(primaryBookingIndex).toBeGreaterThan(-1);
    expect(isOtaPrepaidIndex).toBeGreaterThan(-1);
    // primaryBooking MUST be declared BEFORE isOtaPrepaidInitial
    expect(isOtaPrepaidIndex).toBeGreaterThan(primaryBookingIndex);
  });

  it('3. FolioSettlementModal guards input state reset so typing is NOT cleared on background re-renders', () => {
    const code = fs.readFileSync(folioSettlementPath, 'utf8');
    expect(code).toContain('prevOpenRef.current');
    expect(code).toContain('activeBookingIdRef.current');
    expect(code).toContain('const justOpened = isOpen && !prevOpenRef.current;');
    expect(code).toContain('const bookingChanged = isOpen && currentBookingId && activeBookingIdRef.current !== currentBookingId;');
    expect(code).toContain('if (justOpened || bookingChanged) {');
  });
});
