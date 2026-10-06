import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';

describe('Checkin Split Receipts Modal Test Suite', () => {
  it('1. CheckinWizardModal.jsx collects split receipts and passes them to onCheckinSuccess', () => {
    const wizardContent = fs.readFileSync(
      path.join(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'),
      'utf-8'
    );

    // Verify check-in form is printed first
    expect(wizardContent).toContain('printGuestRegistrationA4(regData, { includePhotos: false });');

    // Verify receipts are constructed for both single and split payments
    expect(wizardContent).toContain('const hasReceipts = activeReceipts.length >= 1 && totalPaid > 0;');
    expect(wizardContent).toContain('const splitReceiptsData = hasReceipts ?');
    expect(wizardContent).toContain('onCheckinSuccess(res.booking || res, splitReceiptsData);');
  });

  it('2. App.jsx renders CheckinSplitReceiptsModal when splitReceiptsData is present', () => {
    const appContent = fs.readFileSync(
      path.join(__dirname, '../src/App.jsx'),
      'utf-8'
    );

    expect(appContent).toContain("import CheckinSplitReceiptsModal from './components/hospitality/CheckinSplitReceiptsModal';");
    expect(appContent).toContain('const [splitReceiptsData, setSplitReceiptsData] = useState(null);');
    expect(appContent).toContain('if (splitReceipts && Array.isArray(splitReceipts.receipts) && splitReceipts.receipts.length >= 1) {');
    expect(appContent).toContain('setSplitReceiptsData(splitReceipts);');
    expect(appContent).toContain('<CheckinSplitReceiptsModal');
    expect(appContent).toContain('onClose={() => setSplitReceiptsData(null)}');
  });

  it('3. CheckinSplitReceiptsModal.jsx component exists and allows printing each respected receipt without closing', () => {
    const modalContent = fs.readFileSync(
      path.join(__dirname, '../src/components/hospitality/CheckinSplitReceiptsModal.jsx'),
      'utf-8'
    );

    // Verify it imports printCashReceipt
    expect(modalContent).toMatch(/import\s*\{[^}]*printCashReceipt[^}]*\}\s*from\s*['"]\.\.\/\.\.\/services\/printService['"]/);

    // Verify printCashReceipt is called for the respected receipt
    expect(modalContent).toContain('printCashReceipt(receiptObj);');

    // Verify printedMap tracks printed receipts without closing the popup
    expect(modalContent).toContain('setPrintedMap((prev) => ({ ...prev, [r.receipt_no]: true }));');

    // Verify modal has universal close button with "X" icon that invokes onClose
    expect(modalContent).toContain('id="btn-close-split-receipts"');
    expect(modalContent).toContain('onClick={onClose}');
    expect(modalContent).toContain('&times;');
  });

  it('4. CheckinSplitReceiptsModal.jsx removes subtitle, info banner, and footer per user request', () => {
    const modalContent = fs.readFileSync(
      path.join(__dirname, '../src/components/hospitality/CheckinSplitReceiptsModal.jsx'),
      'utf-8'
    );

    // Verify subtitle under title is removed
    expect(modalContent).not.toContain('Guest: <strong>');
    expect(modalContent).not.toContain('• Advance: <strong>');

    // Verify info banner is removed
    expect(modalContent).not.toContain('Check-in form print triggered');

    // Verify footer with receipts count and Done button is removed
    expect(modalContent).not.toContain('receipts printed');
    expect(modalContent).not.toContain('btn-done-split-receipts');
  });

  it('5. Step6Stay.jsx removes Now & Clear buttons and locks Check-In Date & Time inputs as disabled', () => {
    const stayContent = fs.readFileSync(
      path.join(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx'),
      'utf-8'
    );

    // Verify Check-In Date & Time section exists
    expect(stayContent).toContain('🕒 Check-In Date &amp; Time');

    // Verify Now and Clear buttons are removed from this section
    expect(stayContent).not.toContain("handleCheckinChange(nowIso.split('T')[0]");
    expect(stayContent).not.toContain("handleCheckinChange('', '')");

    // Verify ThemedDatePicker and UnifiedTimeInput are disabled={true}
    expect(stayContent).toContain('<ThemedDatePicker\n                      value={draft.checkinTime ? draft.checkinTime.split(\'T\')[0] : \'\'}\n                      disabled={true}');
    expect(stayContent).toContain('<UnifiedTimeInput\n                      value={draft.checkinTime && draft.checkinTime.includes(\'T\') ? draft.checkinTime.split(\'T\')[1].slice(0, 5) : \'\'}\n                      disabled={true}');
  });

  it('6. printService.js displays "(UPI MDR fees)" instead of "(Processing Fee)" when UPI fee is present', () => {
    const printServiceContent = fs.readFileSync(
      path.join(__dirname, '../src/services/printService.js'),
      'utf-8'
    );

    // Verify "(Processing Fee)" is replaced with "(UPI MDR fees)"
    expect(printServiceContent).not.toContain('(Processing Fee)');
    expect(printServiceContent).toContain('Payment Mode: Online UPI (UTR: ${utr}) (UPI MDR fees)');
    expect(printServiceContent).toContain('Payment Mode: Online UPI (UPI MDR fees)');
  });
});

