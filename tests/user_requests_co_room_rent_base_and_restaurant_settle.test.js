import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('User Requests: Rename Date of checkout to C/O, Room Rent Base audit calculation, and Restaurant Room Service vs Table Settle', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Verifies ManagePage.jsx renames "Date of checkout" column header to "C/O"', () => {
    const manageCode = fs.readFileSync(path.join(rootDir, 'src/pages/ManagePage.jsx'), 'utf8');
    expect(manageCode).toContain('<th style={{ padding: \'11px 12px\', fontWeight: 750, whiteSpace: \'nowrap\' }}>C/O</th>');
    expect(manageCode).not.toContain('>Date of checkout</th>');
  });

  it('2. Verifies printService.js uses "C/O" in accounting print table, Excel XML, and CSV export', () => {
    const printCode = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf8');
    expect(printCode).toContain('<th style="width: 8%;">C/O</th>');
    expect(printCode).toContain('<Cell ss:StyleID="Header"><Data ss:Type="String">C/O</Data></Cell>');
    expect(printCode).toContain("'C/O',");
    expect(printCode).not.toContain('Date of checkout');
  });

  it('3. Verifies server.js and release/server.js factor stay days, precheckin fees, and extra hours into room_rent_base', () => {
    const serverCode = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
    const releaseServerCode = fs.readFileSync(path.join(rootDir, 'release/server.js'), 'utf8');

    for (const code of [serverCode, releaseServerCode]) {
      expect(code).toContain('b.is_early_checkin');
      expect(code).toContain('b.early_checkin_charge');
      expect(code).toContain('b.extension_logs_json');
      expect(code).toContain('const earlyCheckinAmt = Number(row.early_checkin_charge || 0);');
      expect(code).toContain('const earlyCheckinBase = earlyCheckinAmt > 0');
      expect(code).toContain('let extensionBase = 0;');
      expect(code).toContain('baseRentRow = (Number(row.room_rate) * stayDays) + earlyCheckinBase + extensionBase;');
    }
  });

  it('4. Verifies TableSettleModal retains pre-selected room for Room Service without prompting again', () => {
    const settleModalCode = fs.readFileSync(
      path.join(rootDir, 'src/components/restaurant/TableSettleModal.jsx'),
      'utf8'
    );

    // Initializer captures room if Room Service or chargeToRoomId
    expect(settleModalCode).toContain("let initialRoomId = '';");
    expect(settleModalCode).toContain('if (session.chargeToRoomId) {');
    expect(settleModalCode).toContain('else if (session.table?.room_id) {');
    expect(settleModalCode).toContain("initialRoomId = String(session.table.table_number).replace(/^RS-/i, '').trim();");
    expect(settleModalCode).toContain('setSelectedRoomId(initialRoomId);');

    // On occupied rooms load, does NOT reset to empty if initialRoomId was set
    expect(settleModalCode).toContain('if (initialRoomId) {');
    expect(settleModalCode).toContain('setSelectedRoomId(String(matched.id));');
  });

  it('5. Verifies TableSettleModal prompts for room after clicking settle when settling from a table', () => {
    const settleModalCode = fs.readFileSync(
      path.join(rootDir, 'src/components/restaurant/TableSettleModal.jsx'),
      'utf8'
    );

    // Settle button is not disabled when room is yet to be chosen for a table settling to room
    expect(settleModalCode).toContain('const isSettleDisabled = Boolean(isSubmitting || (roomBillStatus === \'paid\' && isDirectPaymentInvalid));');

    // Intercepts settle click and opens room picker
    expect(settleModalCode).toContain('if (isStayingGuest && !selectedRoomId) {');
    expect(settleModalCode).toContain('setIsRoomPickerOpen(true);');
    expect(settleModalCode).toContain("showToast('Please select an in-house occupied room to settle.', 'info');");

    // Quick button "Settled to Room" exists
    expect(settleModalCode).toContain('id="btn-quick-settle-to-room"');
  });
});
