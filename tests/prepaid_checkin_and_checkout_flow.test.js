import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Prepaid OTA Check-In & Checkout Requirement Tests', () => {
  const step7Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step7Payment.jsx');
  const wizardModalPath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
  const folioSettlementPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');
  const roomFolioPagePath = path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx');
  const serverPath = path.resolve(__dirname, '../server.js');

  it('Step7Payment.jsx defines isOtaPrepaid and isPrepaidZeroExtras for OTA prepaid check-in', () => {
    const code = fs.readFileSync(step7Path, 'utf8');
    expect(code).toContain('const isOtaPrepaid = isOta && isPrepaid;');
    expect(code).toContain('const isPrepaidZeroExtras = isOtaPrepaid && totalDue === 0;');
  });

  it('Step7Payment.jsx renders dedicated Prepaid Status Card when no extra person is added', () => {
    const code = fs.readFileSync(step7Path, 'utf8');
    expect(code).toContain('id="checkin-prepaid-status-card"');
    expect(code).toContain('PREPAID BOOKING');
    expect(code).toContain('100% Voucher Covered');
    expect(code).toContain('₹0.00 advance required at front desk');
    expect(code).toContain('Complete Check-In (Pre-Paid) & Print Reg Card');
  });

  it('Step7Payment.jsx exempts prepaid bookings from min advance policy and collapses payment grid when 0 extras', () => {
    const code = fs.readFileSync(step7Path, 'utf8');
    expect(code).toContain('const isMinAdvanceEnforced = !isBtc && !isOtaPrepaid && minAdvancePct > 0 && totalDue > 0;');
    expect(code).toContain('!isPrepaidZeroExtras && (');
  });

  it('CheckinWizardModal.jsx ensures zeroed advance payments and sets prepaid payment mode for prepaid check-in with 0 extras', () => {
    const code = fs.readFileSync(wizardModalPath, 'utf8');
    expect(code).toContain('if (isOta && isOtaPrepaid && totalDue === 0) {');
    expect(code).toContain('draft.splitCash = 0;');
    expect(code).toContain("advance_payment_mode: (isOta && isOtaPrepaid && totalDue === 0) ? 'prepaid' : undefined");
  });

  it('FolioSettlementModal.jsx detects isOtaPrepaid and isolates F&B bill when checking out', () => {
    const code = fs.readFileSync(folioSettlementPath, 'utf8');
    expect(code).toContain('const isOtaPrepaid = isOta && Boolean(');
    expect(code).toContain('const otaPrepaidBalanceDue = Math.max(0, (hotelExtrasChargeVal + extensionChargeVal + fnbPendingTotal) - effectiveAdvancePaid);');
    expect(code).toContain('const balanceDue = isOtaPrepaid');
  });

  it('FolioSettlementModal.jsx displays Room Tariff as covered by OTA voucher and shows only F&B to pay', () => {
    const code = fs.readFileSync(folioSettlementPath, 'utf8');
    expect(code).toContain("isOtaPrepaid ? 'Covered (OTA)' : formatCurrency(effectiveRoomTariff)");
    expect(code).toContain("Pre-Paid Stay — Fully Settled (₹0.00 Due)");
    expect(code).toContain("Complete Checkout (Pre-Paid — ₹0 Due)");
    expect(code).toContain("Settle F&B & Checkout (${formatCurrency(balanceDue)})");
  });

  it('RoomFolioPage.jsx passes enriched folioData with isOtaPrepaid and folioDueAmount to FolioSettlementModal', () => {
    const code = fs.readFileSync(roomFolioPagePath, 'utf8');
    expect(code).toContain('balanceDue: folioDueAmount');
    expect(code).toContain('isOtaPrepaid');
  });

  it('server.js marks updatedPaymentStatus as settled for prepaid bookings without outstanding balance', () => {
    const code = fs.readFileSync(serverPath, 'utf8');
    expect(code).toContain('const isOtaPrepaidBooking = (primaryBooking.booking_source || \'\').toUpperCase() === \'OTA\'');
    expect(code).toContain('const isPrepaidSettled = isOtaPrepaidBooking && (netSettle >= maxBalanceDue || maxBalanceDue <= 0.5);');
    expect(code).toContain('const updatedPaymentStatus = isSettlingNow || isPrepaidSettled');
  });
});
