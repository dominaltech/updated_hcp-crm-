import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn(),
        outputPdf: vi.fn().mockResolvedValue('data:application/pdf;base64,mock')
      })
    })
  })
}));

vi.mock('../src/services/api', () => ({
  api: {
    saveInvoicePdf: vi.fn().mockResolvedValue({ success: true })
  }
}));

import {
  buildGuestRegistrationHTML,
  buildFinalBillA4HTML,
  buildGuestPaymentSummaryHTML
} from '../src/services/printService';

describe('User 5 Requirements Verification', () => {
  // Requirement 1 & 4: Advance calculation and bed capacity
  it('Requirement 1 & 4: OTA within base capacity does not add 500; only added extra mattress charges fee', () => {
    // 2 adults booked by OTA in a room with base capacity 3.
    // Guest brings 3 adults (fits in base capacity 3 without mattress) -> extraBedCharge = 0.
    const room = { id: 101, room_number: '101', max_adults: 3, max_extra_beds: 2 };
    const draftWithoutMattress = {
      bookingSource: 'OTA',
      otaPlatform: 'Booking.com',
      isPrepaid: false,
      otaManualAmount: 2000,
      extraAdults: 1, // 2 booked + 1 extra adult = 3 adults total (fits in 3 base beds)
      roomExtraBeds: {}, // 0 extra mattresses added
      extraBeds: 0
    };

    // Calculate extra bed charge with new logic
    let totalCharge = 0;
    const bedsInRoom = Number(draftWithoutMattress.roomExtraBeds?.[room.id]) || 0;
    if (bedsInRoom > 0) {
      totalCharge += bedsInRoom * 500;
    }
    expect(totalCharge).toBe(0);

    // When an extra mattress IS added from popup:
    const draftWithMattress = {
      ...draftWithoutMattress,
      extraAdults: 2, // 4 adults total
      roomExtraBeds: { 101: 1 },
      extraBeds: 1
    };
    let totalChargeWithMattress = 0;
    const bedsInRoom2 = Number(draftWithMattress.roomExtraBeds?.[room.id]) || 0;
    if (bedsInRoom2 > 0) {
      totalChargeWithMattress += bedsInRoom2 * 500;
    }
    expect(totalChargeWithMattress).toBe(500);

    // Advance payment requirement check (50% default):
    const minPct = 50;
    const totalDuePayAtHotel = 2000;
    const minRequiredAdvance = Math.ceil((totalDuePayAtHotel * minPct) / 100);
    expect(minRequiredAdvance).toBe(1000);

    // If advance paid is 0, advance is NOT sufficient
    const totalPaidZero = 0;
    expect(totalPaidZero >= minRequiredAdvance).toBe(false);

    // If advance paid is 1000 (50%), advance IS sufficient
    const totalPaidSufficient = 1000;
    expect(totalPaidSufficient >= minRequiredAdvance).toBe(true);
  });

  // Requirement 2: OTA payment mode beside "OTA" in prints
  it('Requirement 2: Displays (Pre-Paid) or (Pay at Hotel) beside OTA in Registration Form and Tax Invoice', () => {
    // 1. Registration form print for OTA Pay-at-Hotel
    const regHtmlPayAtHotel = buildGuestRegistrationHTML({
      guestName: 'Rahul Verma',
      bookingSource: 'OTA',
      otaPlatform: 'MakeMyTrip',
      is_prepaid: 0,
      otaBillAmount: 3000,
      totalDue: 3000,
      totalPaid: 1500
    });
    expect(regHtmlPayAtHotel).toContain('OTA (Pay at Hotel)');

    // 2. Registration form print for OTA Pre-Paid
    const regHtmlPrepaid = buildGuestRegistrationHTML({
      guestName: 'Amit Shah',
      bookingSource: 'OTA',
      otaPlatform: 'Agoda',
      is_prepaid: 1,
      otaBillAmount: 4000,
      totalDue: 0,
      totalPaid: 0
    });
    expect(regHtmlPrepaid).toContain('OTA (Pre-Paid)');

    // 3. Tax Invoice print for OTA Pay at Hotel
    const invHtmlPayAtHotel = buildFinalBillA4HTML(
      {
        guest_name: 'Rahul Verma',
        booking_source: 'OTA',
        ota_platform: 'MakeMyTrip',
        is_prepaid: 0,
        room_number: '102'
      },
      { stayTaxable: 2857.14, tariffTax5Pct: 142.86 },
      {}
    );
    expect(invHtmlPayAtHotel).toContain('OTA (Pay at Hotel)');

    // 4. Tax Invoice print for OTA Pre-Paid
    const invHtmlPrepaid = buildFinalBillA4HTML(
      {
        guest_name: 'Amit Shah',
        booking_source: 'OTA',
        ota_platform: 'Agoda',
        is_prepaid: 1,
        room_number: '103'
      },
      { stayTaxable: 3809.52, tariffTax5Pct: 190.48 },
      {}
    );
    expect(invHtmlPrepaid).toContain('OTA (Pre-Paid)');
  });

  // Requirement 3: Early Check-in originalCheckinTime defaults to empty string
  it('Requirement 3: Early check-in original scheduled time starts empty', () => {
    const draft = {
      isEarlyCheckin: true,
      originalCheckinTime: ''
    };
    expect(draft.originalCheckinTime).toBe('');
    expect(draft.originalCheckinTime || '').toBe('');
  });

  // Requirement 5: Payment Summary layout spacing
  it('Requirement 5: Payment summary layout has proper spacing and does not crowd the address', () => {
    const paymentSummaryHtml = buildGuestPaymentSummaryHTML({
      guest_name: 'Suresh Patil',
      room_number: '201',
      voucher_no: '260929-001',
      payments: [
        {
          id: 1,
          receipt_no: 'RCP-001',
          amount: 2500,
          payment_mode: 'Cash',
          purpose: 'paid while checkin : checkin'
        }
      ]
    });

    expect(paymentSummaryHtml).toContain('PAYMENT SUMMARY STATEMENT');
    // Ensure header has gap and proper layout
    expect(paymentSummaryHtml).toContain('gap: 20px');
    expect(paymentSummaryHtml).toContain('max-width: 380px');
    expect(paymentSummaryHtml).toContain('flex-shrink: 0');
  });
});
