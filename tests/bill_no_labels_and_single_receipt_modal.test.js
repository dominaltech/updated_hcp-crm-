import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock html2pdf.js before importing printService
vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        toPdf: () => ({
          get: () => ({
            then: (cb) => {
              cb({ internal: { getNumberOfPages: () => 1 }, setPage: () => {}, deletePage: () => {} });
              return { save: vi.fn().mockResolvedValue(true) };
            }
          })
        })
      })
    })
  })
}));

import {
  buildGuestRegistrationHTML,
  buildGuestPaymentSummaryHTML,
  buildFinalBillA4HTML,
  buildMoneyReceiptHTML
} from '../src/services/printService';

describe('Bill No Labels and Single/Split Receipt Popup Suite', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Voucher top-right box displays "Bill No:" for both Walk-in and OTA, while banner preserves "Voucher Ref: #" only for OTA', () => {
    // Walk-in
    const walkinHtml = buildGuestRegistrationHTML({
      voucherNo: '261005-626',
      guestName: 'Md Yahya',
      mobile: '9028850715',
      checkinTime: '2026-10-05T22:18:00',
      approxCheckout: '2026-10-06T10:00:00',
      room: { room_number: '307', price: 2500 },
      isOta: false
    });
    expect(walkinHtml).toContain('Bill No:');
    expect(walkinHtml).toContain('261005-626');
    expect(walkinHtml).not.toContain('Voucher / Reg No:');
    expect(walkinHtml).not.toContain('Voucher Ref:');

    // OTA
    const otaHtml = buildGuestRegistrationHTML({
      voucherNo: '261005-627',
      guestName: 'Md Yahya Ab Wahid Mundewadi',
      otaPlatform: 'Booking.com',
      otaBookingId: 'asasasas',
      room: { room_number: '306', price: 3000 },
      isOta: true,
      booking_source: 'OTA'
    });
    // Top-right box must be Bill No:
    expect(otaHtml).toContain('Bill No:');
    expect(otaHtml).toContain('261005-627');
    // Booking case banner retains Voucher Ref: #asasasas
    expect(otaHtml).toContain('Voucher Ref: #asasasas');
  });

  it('2. Receipt displays "Bill No:" consistently', () => {
    const printServiceCode = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf-8');
    expect(printServiceCode).toContain("const receiptBillOrVoucherLabel = 'Bill No:';");
  });

  it('3. PAYMENT SUMMARY STATEMENT displays "Bill No" consistently and ensures bottom border safety', () => {
    // Non-OTA
    const summaryHtml = buildGuestPaymentSummaryHTML({
      guestName: 'Md Yahya',
      room_numbers: '307',
      voucher_no: '261005-626',
      advance_amount: 1500,
      payment_mode: 'Cash',
      isOta: false
    });
    expect(summaryHtml).toContain('Bill No');
    expect(summaryHtml).toContain('261005-626');
    expect(summaryHtml).not.toContain('Voucher Number');

    // OTA
    const otaSummaryHtml = buildGuestPaymentSummaryHTML({
      guestName: 'OTA Guest',
      room_numbers: '308',
      voucher_no: '261005-999',
      ota_platform: 'Booking.com',
      isOta: true
    });
    expect(otaSummaryHtml).toContain('Bill No');
    expect(otaSummaryHtml).toContain('261005-999');

    // CSS bottom border safety check
    const css = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf-8');
    expect(css).toContain('.guest-payment-summary-sheet');
    expect(css).toContain('border-bottom: 3.5px solid #1e3a8a !important;');
  });

  it('4. Tax Invoice replaces "Reg. No." with "Bill No." across all bookings', () => {
    // Non-OTA
    const taxInvoiceHtml = buildFinalBillA4HTML({
      room_number: '307',
      guestName: 'Md Yahya',
      voucher_no: '261005-626',
      totalDue: 2625,
      rateType: 'standard',
      booking_source: 'Walk-in'
    });
    expect(taxInvoiceHtml).toContain('Bill No. :');
    expect(taxInvoiceHtml).toContain('261005-626');
    expect(taxInvoiceHtml).not.toContain('Reg. No. :');

    // OTA
    const otaInvoiceHtml = buildFinalBillA4HTML({
      room_number: '307',
      guestName: 'OTA Guest',
      voucher_no: '261005-626',
      booking_source: 'OTA',
      ota_platform: 'MakeMyTrip'
    });
    expect(otaInvoiceHtml).toContain('Bill No. :');
    expect(otaInvoiceHtml).not.toContain('Voucher No. :');
  });

  it('5. Check-in opens receipt print popup for single payment method as well as split payment', () => {
    const wizardCode = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'), 'utf-8');
    expect(wizardCode).toContain('const hasReceipts = activeReceipts.length >= 1 && totalPaid > 0;');
    expect(wizardCode).toContain('const splitReceiptsData = hasReceipts ?');

    const appCode = fs.readFileSync(path.join(rootDir, 'src/App.jsx'), 'utf-8');
    expect(appCode).toContain('if (splitReceipts && Array.isArray(splitReceipts.receipts) && splitReceipts.receipts.length >= 1) {');
    expect(appCode).toContain('setSplitReceiptsData(splitReceipts);');
  });

  it('6. Receipt Table Row 1 displays "Room 307 - Paid for Check In" instead of "Paid while checking"', () => {
    const receipt = {
      receipt_no: 'CR25',
      voucher_number: '261005-626',
      receipt_date: '2026-10-05T16:49:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 1500,
      payment_mode: 'Cash',
      room_numbers: '307',
      particulars: 'Room 307 - Advance payment at check-in'
    };
    const html = buildMoneyReceiptHTML(receipt);
    expect(html).toContain('Room 307 - Paid for Check In');
    expect(html).not.toContain('Paid while checking');
  });
});
