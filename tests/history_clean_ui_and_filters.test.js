import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Hospitality History Clean UI, Filter Drawer & Fullscreen View Tests', () => {
  const historyPath = path.resolve(__dirname, '../src/components/hospitality/HospitalityHistory.jsx');
  const historyCode = fs.readFileSync(historyPath, 'utf8');

  it('1. Column heading removes # below Booking and shows clean Booking label', () => {
    expect(historyCode).toContain('>Booking</th>');
    expect(historyCode).not.toContain('>Booking #</th>');
  });

  it('2. Buttons View, Delete, and Clear All are removed from history table and toolbar', () => {
    // Should not have row Action buttons for View, Delete or top Clear All
    expect(historyCode).not.toContain('Clear All Completed Stay Records');
    expect(historyCode).not.toContain('🗑️ Delete');
    expect(historyCode).not.toContain('👁️ View');
    expect(historyCode).not.toContain('btn-refresh-history" onClick={handleClearAll}');
  });

  it('3. Room number is rendered in a box badge without key icon 🔑 and without #', () => {
    expect(historyCode).toContain('className="history-room-badge"');
    expect(historyCode).not.toContain('🔑 #{r.room_number');
  });

  it('4. Amount paid shows clean number and little mode without verbose text or icons', () => {
    expect(historyCode).toContain('({modeLabel.toLowerCase()})');
    expect(historyCode).not.toContain('✓ Passed (PREPAID + CASH) ✏️');
    expect(historyCode).not.toContain('Prepaid via Booking.com (₹1,000)');
  });

  it('5. Entire row has reddish styling if pending from BTC', () => {
    expect(historyCode).toContain('isBtcPending ? \'history-row-btc-pending\' : \'\'');
    expect(historyCode).toContain("isBtcPending ? '#fff1f2'");
    expect(historyCode).toContain("isBtcPending");
    expect(historyCode).toContain("'4px solid #ef4444'");
  });

  it('6. All Time, Today, This Week, This Month are removed and replaced with Filter button and range drawer', () => {
    expect(historyCode).not.toContain("'All Time'");
    expect(historyCode).not.toContain("'This Week'");
    expect(historyCode).not.toContain("'This Month'");
    expect(historyCode).toContain('history-filter-toggle-btn');
    expect(historyCode).toContain('history-filter-panel');
    expect(historyCode).toContain('filterFromNo');
    expect(historyCode).toContain('filterToNo');
    expect(historyCode).toContain('filterFromDate');
    expect(historyCode).toContain('filterToDate');
  });

  it('7. Clicking row opens full-page view with entire height/width (not a popup)', () => {
    expect(historyCode).toContain('className="history-fullscreen-view"');
    expect(historyCode).toContain('Back to History');
    expect(historyCode).not.toContain('Stay Details & Payment History Modal');
  });

  it('8. Cheque scan options are not shown directly in the history tab rows, but appear inside the full view', () => {
    // In table body:
    expect(historyCode).not.toContain('<button type="button" onClick={() => handleOpenScanCheque(r)}');
    // Inside detail view:
    expect(historyCode).toContain('onClick={() => handleOpenScanCheque(detailBooking)}');
  });

  it('9. Adds 2 columns: Voucher No and Invoice No to table header and body', () => {
    expect(historyCode).toContain('>Voucher No</th>');
    expect(historyCode).toContain('>Invoice No</th>');
    expect(historyCode).toContain('className="history-col-voucher"');
    expect(historyCode).toContain('className="history-col-invoice"');
  });

  it('10. Filter drawer has side heading "Show:" with buttons Checkin, Checkout, Voucher/Invoice No', () => {
    expect(historyCode).toContain('Show:');
    expect(historyCode).toContain('filterShowScope === \'checkin\'');
    expect(historyCode).toContain('filterShowScope === \'checkout\'');
    expect(historyCode).toContain('filterShowScope === \'number_range\'');
    expect(historyCode).toContain('Voucher / Invoice No');
  });

  it('11. History records sort latest modified/activity on top (payments, F&B orders, checkin/checkout)', () => {
    expect(historyCode).toContain('getActivityTimestamp(b) - getActivityTimestamp(a)');
    expect(historyCode).toContain('last_activity_time');
  });

  it('12. Cheque scan modal only provides save button, removing pass cheque credit account button', () => {
    // Inside cheque scan modal footer:
    expect(historyCode).toContain('Save Cheque Scan');
    expect(historyCode).not.toContain('Pass Cheque (Credit Account)</button>\n              </div>\n            </div>\n          </div>\n        </div>\n      )}');
  });

  it('13. Settle BTC includes Cheque confirmation checkbox, Bounce Cheque, Change Payment, and Payment Audit Log', () => {
    expect(historyCode).toContain('Confirm Cheque Passed &amp; Cleared');
    expect(historyCode).toContain('handleMarkChequeBounced');
    expect(historyCode).toContain('handleOpenChangePayment');
    expect(historyCode).toContain('Payment &amp; Cheque Audit Log');
  });

  it('14. Check-in time has whiteSpace nowrap to prevent text from overflowing to a 2nd line', () => {
    expect(historyCode).toContain('className="history-col-checkin" style={{ width: \'160px\', minWidth: \'155px\', whiteSpace: \'nowrap\' }}');
    expect(historyCode).toContain('className="history-checkin-date" style={{ fontSize: \'0.84rem\', fontWeight: 700, color: \'var(--text-primary, #0f172a)\', whiteSpace: \'nowrap\' }}');
  });

  it('15. Able to navigate on rows with Up/Down arrow keys and Enter to open stay folio', () => {
    expect(historyCode).toContain('focusedRowIndex');
    expect(historyCode).toContain('setFocusedRowIndex');
    expect(historyCode).toContain('data-history-row-index');
    expect(historyCode).toContain('history-row-focused');
    expect(historyCode).toContain('e.key === \'ArrowDown\'');
    expect(historyCode).toContain('e.key === \'ArrowUp\'');
    expect(historyCode).toContain('e.key === \'Enter\'');
  });
});
