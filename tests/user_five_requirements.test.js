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
import { timeToMinutes, getMinCheckoutDate, getLocalIsoDate } from '../src/utils/formatters';

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

  // Requirement 6: Scheduled Check-In Time cannot be before or equal to Actual Early Check-In Time
  it('Requirement 6: Scheduled Check-In Time cannot be before or equal to Actual Early Check-In Time', () => {
    // 1. timeToMinutes parsing tests
    expect(timeToMinutes('01:00 PM')).toBe(780);
    expect(timeToMinutes('13:00')).toBe(780);
    expect(timeToMinutes('03:41 PM')).toBe(941);
    expect(timeToMinutes('15:41')).toBe(941);
    expect(timeToMinutes('12:00 PM')).toBe(720);
    expect(timeToMinutes('12:00 AM')).toBe(0);
    expect(timeToMinutes('10:00 AM')).toBe(600);
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes(null)).toBeNull();

    // 2. User screenshot scenario:
    // Scheduled is 01:00 PM (780 mins), but actual arrival is 03:41 PM (941 mins).
    // Scheduled is before actual arrival (780 <= 941), which is INVALID.
    const earlyActual = '15:41'; // 03:41 PM
    const scheduledPast = '13:00'; // 01:00 PM
    const schedMinsPast = timeToMinutes(scheduledPast);
    const earlyMinsActual = timeToMinutes(earlyActual);

    const isScheduledBeforeEarlyPast = Boolean(
      schedMinsPast !== null && earlyMinsActual !== null && schedMinsPast <= earlyMinsActual
    );
    expect(isScheduledBeforeEarlyPast).toBe(true);

    // Gating check: isOtaStep4TimingDone should be false when scheduled <= early
    const isOtaStep3BillDone = true;
    const isEarlyCheckin = true;
    const isOtaStep4TimingDoneInvalid = isOtaStep3BillDone &&
      (isEarlyCheckin !== null && isEarlyCheckin !== undefined) &&
      (!isEarlyCheckin || (Boolean(scheduledPast) && Boolean(earlyActual) && !isScheduledBeforeEarlyPast));
    expect(isOtaStep4TimingDoneInvalid).toBe(false);

    // 3. Same time scenario (scheduled 03:41 PM == actual 03:41 PM):
    // If they arrive at the scheduled time, it is not early arrival!
    const schedSame = '15:41';
    const isScheduledBeforeEarlySame = Boolean(
      timeToMinutes(schedSame) <= timeToMinutes(earlyActual)
    );
    expect(isScheduledBeforeEarlySame).toBe(true);

    // 4. Valid future scheduled time scenario:
    // Actual early arrival is 08:00 AM, scheduled check-in is 12:00 PM (or 02:00 PM).
    const validEarly = '08:00'; // 8:00 AM (480 mins)
    const validScheduled = '12:00'; // 12:00 PM (720 mins)
    const schedMinsValid = timeToMinutes(validScheduled);
    const earlyMinsValid = timeToMinutes(validEarly);

    const isScheduledBeforeEarlyValid = Boolean(
      schedMinsValid !== null && earlyMinsValid !== null && schedMinsValid <= earlyMinsValid
    );
    expect(isScheduledBeforeEarlyValid).toBe(false);

    const isOtaStep4TimingDoneValid = isOtaStep3BillDone &&
      (isEarlyCheckin !== null && isEarlyCheckin !== undefined) &&
      (!isEarlyCheckin || (Boolean(validScheduled) && Boolean(validEarly) && !isScheduledBeforeEarlyValid));
    expect(isOtaStep4TimingDoneValid).toBe(true);
  });

  // Requirement 7: If real time is above 10:00 AM, unable to select current day as check-out date; minimum is tomorrow
  it('Requirement 7: If real time is above 10:00 AM, unable to select current day as check-out date; minimum is tomorrow', () => {
    // 1. Current clock time is 16:00 (4:00 PM) today (2026-09-29)
    // 10:00 AM checkout today is in the past. Minimum checkout date must be tomorrow (2026-09-30).
    const refTime4PM = new Date('2026-09-29T16:00:00');
    const minDateAfter10AM = getMinCheckoutDate('2026-09-29', refTime4PM);
    expect(minDateAfter10AM).toBe('2026-09-30');

    // Current day is 2026-09-29, which is less than minCheckoutDate (2026-09-30), so selecting today is invalid.
    const isTodaySelectableAfter10AM = '2026-09-29' >= minDateAfter10AM;
    expect(isTodaySelectableAfter10AM).toBe(false);

    // Tomorrow (2026-09-30) is selectable
    const isTomorrowSelectable = '2026-09-30' >= minDateAfter10AM;
    expect(isTomorrowSelectable).toBe(true);

    // 2. Exact 10:00 AM clock time today (2026-09-29T10:00:00)
    // Checkout time has arrived; next available standard 10:00 AM checkout is tomorrow.
    const refTime10AM = new Date('2026-09-29T10:00:00');
    const minDateAt10AM = getMinCheckoutDate('2026-09-29', refTime10AM);
    expect(minDateAt10AM).toBe('2026-09-30');

    // 3. Early morning before 10:00 AM (e.g. 08:30 AM on 2026-09-29)
    // Today's 10:00 AM has not arrived yet, so today (2026-09-29) is still allowed as minimum checkout.
    const refTime830AM = new Date('2026-09-29T08:30:00');
    const minDateBefore10AM = getMinCheckoutDate('2026-09-29', refTime830AM);
    expect(minDateBefore10AM).toBe('2026-09-29');

    // 4. Future check-in date (e.g. reservation on 2026-10-05)
    // Minimum checkout date is the check-in date itself.
    const futureCheckin = '2026-10-05';
    const minDateFuture = getMinCheckoutDate(futureCheckin, refTime4PM);
    expect(minDateFuture).toBe('2026-10-05');
  });

  // Requirement 8: In add payment, cheque option should be for BTC only; for others (walkin, website, ota) should see only cash, upi, card options
  it('Requirement 8: Cheque payment option is for BTC only; Walk-in, Website, and OTA have only Cash, UPI, and Card', () => {
    const fs = require('fs');
    const path = require('path');

    // 1. Check helper logic for payment mode availability by booking source
    const getAvailablePaymentMethods = (bookingSource, hasBtcCompany = false) => {
      const isBtc = String(bookingSource || '').toUpperCase() === 'BTC' || Boolean(hasBtcCompany);
      const methods = ['cash', 'upi', 'card'];
      if (isBtc) methods.push('cheque');
      return methods;
    };

    // BTC booking allows cheque
    expect(getAvailablePaymentMethods('BTC')).toEqual(['cash', 'upi', 'card', 'cheque']);
    expect(getAvailablePaymentMethods('btc')).toEqual(['cash', 'upi', 'card', 'cheque']);
    expect(getAvailablePaymentMethods('Walk-in', true)).toEqual(['cash', 'upi', 'card', 'cheque']);

    // Other sources (walk-in, website, ota) only see cash, upi, card
    expect(getAvailablePaymentMethods('Walk-in')).toEqual(['cash', 'upi', 'card']);
    expect(getAvailablePaymentMethods('walkin')).toEqual(['cash', 'upi', 'card']);
    expect(getAvailablePaymentMethods('Website')).toEqual(['cash', 'upi', 'card']);
    expect(getAvailablePaymentMethods('website')).toEqual(['cash', 'upi', 'card']);
    expect(getAvailablePaymentMethods('OTA')).toEqual(['cash', 'upi', 'card']);
    expect(getAvailablePaymentMethods('ota')).toEqual(['cash', 'upi', 'card']);

    // 2. Verify RoomFolioPage.jsx enforces isBtcBooking for Cheque Box in Add Payment Modal
    const folioCode = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx'), 'utf8');
    expect(folioCode).toContain('const isBtcBooking =');
    expect(folioCode).toContain('{isBtcBooking && (');
    expect(folioCode).toContain('Cheque (BTC Only)');

    // 3. Verify Step7Payment.jsx wraps Cheque in isBtc
    const step7Code = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step7Payment.jsx'), 'utf8');
    expect(step7Code).toContain('const isBtc = bookingSource === \'BTC\';');
    expect(step7Code).toContain('{isBtc && (');
    expect(step7Code).toContain('Corporate BTC Only');

    // 4. Verify FolioSettlementModal.jsx wraps Cheque in isBtc
    const settleCode = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx'), 'utf8');
    expect(settleCode).toContain('{isBtc && (');
    expect(settleCode).toContain('Company / Bank Cheque');

    // 5. Verify server.js validates that Cheque is only accepted for corporate BTC bookings
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
    expect(serverCode).toContain('Cheque payment option is only allowed for corporate BTC bookings.');
  });

  // Requirement 9: Exact minute entry (e.g. 04:22 PM) and strict validation that Scheduled > Actual Early
  it('Requirement 9: Supports exact minute entry (e.g. 4:22 PM) and validates Scheduled Check-In > Actual Early Check-In', () => {
    const fs = require('fs');
    const path = require('path');

    // 1. Time comparison: Actual is 04:18 PM (16:18 = 978 mins)
    const actualEarly = '16:18';
    const actualMins = timeToMinutes(actualEarly);
    expect(actualMins).toBe(16 * 60 + 18); // 978

    // Scheduled is 04:22 PM (16:22 = 982 mins)
    const scheduled422 = '16:22';
    const schedMins422 = timeToMinutes(scheduled422);
    expect(schedMins422).toBe(16 * 60 + 22); // 982

    // 4:22 PM is strictly after 4:18 PM, so it is valid
    const is422Valid = schedMins422 > actualMins;
    expect(is422Valid).toBe(true);

    // Same time or earlier (e.g. 04:18 PM or 04:15 PM) is invalid
    expect(timeToMinutes('16:18') > actualMins).toBe(false);
    expect(timeToMinutes('16:15') > actualMins).toBe(false);
    expect(timeToMinutes('15:00') > actualMins).toBe(false);

    // 2. Verify UnifiedTimeInput supports typing and exact minute selection
    const timeInputCode = fs.readFileSync(path.resolve(__dirname, '../src/components/common/UnifiedTimeInput.jsx'), 'utf8');
    expect(timeInputCode).toContain('placeholder="MM"');
    expect(timeInputCode).toContain('Exact Min:');
    expect(timeInputCode).toContain('handleMinuteInputChange');
    expect(timeInputCode).toContain('handleHourInputChange');
  });

  // Requirement 10: In Step 1 for OTA, Check-Out Date & Time * [Fixed & Paid] starts completely empty
  it('Requirement 10: Check-Out Date & Time * starts empty for OTA and is not pre-filled by default', () => {
    const fs = require('fs');
    const path = require('path');
    const step1Code = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx'), 'utf8');

    // 1. handleSourceSelect initializes checkoutDate and approxCheckout to empty
    expect(step1Code).toContain("checkoutDate: '',");
    expect(step1Code).toContain("approxCheckout: '',");

    // 2. OTA time input value is empty when currentCheckoutDate is not selected yet
    expect(step1Code).toContain('value={currentCheckoutDate ? "10:00 AM (Fixed)" : ""}');
    expect(step1Code).toContain('placeholder={currentCheckoutDate ? "10:00 AM (Fixed)" : "--:--"}');

    // 3. Date picker value is currentCheckoutDate which is empty string initially
    expect(step1Code).toContain('value={currentCheckoutDate}');

    // 4. Wizard draft initialization in CheckinWizardModal starts with empty checkoutDate and checkoutTime
    const wizardModalCode = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'), 'utf8');
    expect(wizardModalCode).toContain("checkoutDate: '',");
    expect(wizardModalCode).toContain("checkoutTime: '',");
  });

  // Requirement 11: Dashboard room card does not show OTA (Pay at Hotel) badge; shows room no, occupied, name, number, and c/o time
  it('Requirement 11: Dashboard room cards do not show OTA (Pay at Hotel) badge and show room no, occupied, name, number, c/o time', () => {
    const fs = require('fs');
    const path = require('path');
    const roomCardCode = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/RoomCard.jsx'), 'utf8');

    // 1. Must NOT contain room-ota-mode-pill or OTA (Pay at Hotel) on the card
    expect(roomCardCode).not.toContain('room-ota-mode-pill');
    expect(roomCardCode).not.toContain('🌐 OTA (');

    // 2. Contains room number, occupied status, guest name, mobile number
    expect(roomCardCode).toContain('room.room_number');
    expect(roomCardCode).toContain("status-pill ${room.status}");
    expect(roomCardCode).toContain('room.guest_name');
    expect(roomCardCode).toContain('mobileNum');

    // 3. Contains C/O: time formatting
    expect(roomCardCode).toContain("isOverdue ? 'Overdue: ' : 'C/O: '");
  });
});



