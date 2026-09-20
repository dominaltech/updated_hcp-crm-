import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('OTA Early Check-In Time and Fixed 10:00 AM Checkout Rules', () => {
  const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
  const step1Content = fs.readFileSync(step1Path, 'utf-8');

  const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
  const step6Content = fs.readFileSync(step6Path, 'utf-8');

  it('verifies in Step 1 that handleOtaEarlyCheckinToggle auto-captures current clock time and fixes checkout to 10:00 AM', () => {
    // Should capture current time
    expect(step1Content).toContain('handleOtaEarlyCheckinToggle = (isEarly) =>');
    expect(step1Content).toContain('const now = new Date();');
    expect(step1Content).toContain('earlyCheckinTime: currentActualTime');
    expect(step1Content).toContain("checkoutTime: '10:00'");
  });

  it('verifies in Step 1 that Actual Early Check-In Time input is read-only and unable to edit', () => {
    expect(step1Content).toContain('🌅 Actual Early Check-In Time *');
    expect(step1Content).toContain('⏱️ Current Time (Locked)');
    expect(step1Content).toContain('readOnly');
    expect(step1Content).toContain('disabled');
    expect(step1Content).toContain('🔒 Auto-captured live clock time — unable to edit');
  });

  it('verifies in Step 1 that Checkout Time is locked to 10:00 AM (Fixed) when Early Check-In is active', () => {
    expect(step1Content).toContain("draft.isEarlyCheckin ? '🔒 10:00 AM Fixed' : 'Fixed & Paid'");
    expect(step1Content).toContain('10:00 AM (Fixed)');
    expect(step1Content).toContain('applyCheckoutUpdate');
    expect(step1Content).toContain("const isOtaEarly = draft.bookingSource === 'OTA' && draft.isEarlyCheckin === true;");
    expect(step1Content).toContain("const targetTime = isOtaEarly ? '10:00'");
  });

  it('verifies in Step 1 that Checkout Date remains an interactive date picker', () => {
    expect(step1Content).toContain('<input');
    expect(step1Content).toContain('type="date"');
    expect(step1Content).toContain('value={currentCheckoutDate}');
    expect(step1Content).toContain("applyCheckoutUpdate(e.target.value, draft.isEarlyCheckin ? '10:00' : currentCheckoutTime)");
  });

  it('verifies in Step 6 (Stay) that Checkout Time is locked to 10:00 AM and disabled for OTA early check-in', () => {
    expect(step6Content).toContain("const isOtaEarly = isOta && draft.isEarlyCheckin === true;");
    expect(step6Content).toContain("const tStr = isOtaEarly ? '10:00'");
    expect(step6Content).toContain('isOta && draft.isEarlyCheckin === true ?');
    expect(step6Content).toContain('10:00 AM (Fixed)');
    expect(step6Content).toContain('cursor: \'not-allowed\'');
  });

  it('verifies in Step 6 (Stay) that Checkout Date picker remains editable and updates with 10:00 AM preserved', () => {
    expect(step6Content).toContain('value={checkoutDateStr}');
    expect(step6Content).toContain('handleCheckoutChange(e.target.value, checkoutTimeStr)');
  });
});

describe('OTA Progressive Step Gating (Sequential Flow)', () => {
  const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
  const step1Content = fs.readFileSync(step1Path, 'utf-8');

  it('verifies sequential gating states defined in Step1Source', () => {
    expect(step1Content).toContain('const isOtaStep1PlatformDone = Boolean(draft.otaPlatform);');
    expect(step1Content).toContain('const isOtaStep2PaymentDone = isOtaStep1PlatformDone && (draft.isPrepaid !== null && draft.isPrepaid !== undefined);');
    expect(step1Content).toContain('const isOtaStep3BillDone = isOtaStep2PaymentDone && Boolean(draft.otaManualAmount && Number(draft.otaManualAmount) > 0);');
    expect(step1Content).toContain('const isOtaStep4TimingDone = isOtaStep3BillDone && (draft.isEarlyCheckin !== null && draft.isEarlyCheckin !== undefined)');
    expect(step1Content).toContain('const isOtaReady = isOta');
  });

  it('verifies Step 2 (Payment Mode) is non-clickable until Step 1 (Platform) is chosen', () => {
    expect(step1Content).toContain("pointerEvents: isOtaStep1PlatformDone ? 'auto' : 'none'");
    expect(step1Content).toContain('🔒 Choose Platform First');
  });

  it('verifies Step 3 (Bill & Dates) is non-clickable until Step 2 (Payment Mode) is chosen', () => {
    expect(step1Content).toContain("pointerEvents: isOtaStep2PaymentDone ? 'auto' : 'none'");
    expect(step1Content).toContain('🔒 Choose Payment Mode First');
  });

  it('verifies Step 4 (Breakfast & Timing) is non-clickable until Step 3 (Bill) is entered', () => {
    expect(step1Content).toContain("pointerEvents: isOtaStep3BillDone ? 'auto' : 'none'");
    expect(step1Content).toContain('🔒 Enter Bill Amount First');
  });

  it('verifies Step 5 (Pre-Booked Rooms) is non-clickable until Step 4 (Timing) is completed', () => {
    expect(step1Content).toContain("pointerEvents: isOtaStep4TimingDone ? 'auto' : 'none'");
    expect(step1Content).toContain('🔒 Complete Step 4 First');
  });

  it('verifies Section 2 (Document Selection) is blocked until all mandatory OTA steps are ready', () => {
    expect(step1Content).toContain('!isChannelSelected || !isBtcReady || !isOtaReady ? \'locked\' : \'\'');
    expect(step1Content).toContain('Complete OTA Details First');
    expect(step1Content).toContain('triggerShake');
  });
});

