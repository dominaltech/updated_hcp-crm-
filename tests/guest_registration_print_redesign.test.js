import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import { buildGuestRegistrationHTML, getIdNumberLabel } from '../src/services/printService';

describe('Guest Registration Print Redesign (A4 Full Sheet & Clean Typography)', () => {
  const mockRegistrationData = {
    guestName: 'Md Yahya Ab Wahid Mundewadi',
    mobile: '9876543210',
    altMobile: '9123456780',
    fatherName: 'Wahid Mundewadi',
    dob: '1985-05-12',
    address: 'Solapur, Maharashtra',
    docType: 'Aadhaar Card',
    aadharNumber: '443842677809',
    bookingSource: 'Walk-in',
    voucherNo: '20260917-001',
    checkinTime: '2026-09-17T12:00:00',
    approxCheckout: '2026-09-18T11:00:00',
    stayNights: 1,
    roomNumber: '101',
    roomType: 'Deluxe AC',
    adultsMale: 2,
    adultsFemale: 1,
    children: 0,
    roomTariffNet: 2000,
    taxAmount: 100,
    totalDue: 2100,
    totalPaid: 2000,
    splitCash: 0,
    splitCard: 0,
    splitOnline: 2000,
    onlineUtr: 'mtm-654654we',
    memberDocuments: [
      { name: 'Companion ID #1', relation: 'Friend', idNumber: '99887766' },
      { name: 'Companion ID #2', relation: 'Friend', idNumber: '99887765' },
      { name: 'Companion ID #3', relation: 'Friend', idNumber: '99887764' }
    ]
  };

  it('a) Document Verification line should only show "✓ Aadhaar Card" (the chosen doc)', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).toContain('Document Verification:');
    expect(html).toContain('✓ Aadhaar Card');
    // Ensure no long trailing string like "✓ Aadhaar Card & Live Webcam Photo Verified • Digitally Preserved in System Folio (443842677809)"
    expect(html).not.toContain('& Live Webcam Photo Verified');
    expect(html).not.toContain('Digitally Preserved in System Folio');
  });

  it('b) Header banner "GUEST REGISTRATION CARD" must be removed', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).not.toContain('GUEST REGISTRATION CARD');
  });

  it('c) Section header must be "STAY DETAILS" in a clean table with NO emojis', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).toContain('<span>STAY DETAILS</span>');
    expect(html).not.toContain('COMBINED ROOM ALLOCATION & STAY DETAILS');
    expect(html).not.toContain('🛏️');
  });

  it('d) Companion room members section must be removed from physical paper print', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).not.toContain('COMPANION ROOM MEMBERS');
    expect(html).not.toContain('SCANNED COPIES DIGITALLY STORED IN SYSTEM');
    expect(html).not.toContain('Companion ID #1');
    expect(html).not.toContain('Companion ID #2');
    expect(html).not.toContain('Companion ID #3');
  });

  it('e) Payment section should be "PAYMENT SUMMARY" and show UTR only once (no duplicate UTR box)', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).toContain('<span>PAYMENT SUMMARY</span>');
    expect(html).not.toContain('TARIFF SUMMARY & PAYMENT SETTLEMENT');
    
    // UTR should be inside the online UPI badge
    expect(html).toContain('mtm-654654we');
    // Count occurrences of the UTR in the generated HTML to ensure no duplicate second box
    const utrMatches = html.match(/mtm-654654we/g);
    expect(utrMatches).not.toBeNull();
    expect(utrMatches.length).toBe(1);
    expect(html).not.toContain('UPI UTR Ref: mtm-654654we');
  });

  it('f) Hotel logo height must be enlarged by 50% to 108px for prominent branding', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).toContain('height: 108px;');
    expect(html).toContain('/hcp-logo-with-name.png');
  });

  it('g) Full A4 page fit: page-break-inside avoid, flex layout, 36px signature clearance, and visible watermark without name', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).toContain('page-break-inside: avoid;');
    expect(html).toContain('break-inside: avoid;');
    expect(html).toContain('display: flex;');
    expect(html).toContain('justify-content: space-between;');
    expect(html).toContain('height: 36px;'); // Compact signature clearance guaranteeing 1-page fit on standard A4
    expect(html).toContain('opacity: 0.38;'); // Darkened visible watermark
    expect(html).toContain('HCP New Logo Png_witought-name.png'); // Standalone logo without name
    expect(html).toContain('by JMG HOSPITALITY AND INFRA LLP'); // Subtitle below HOTEL CityPaark
    expect(html).toContain('/phone-call.png'); // Phone-call image from public
    expect(html).toContain(': 0217-2729791, 92, 93, +91 9960013388, 9370013388');
    expect(html).toContain('hcitypark@rediffmail.com');
    expect(html).toContain('119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)');
    expect(html).not.toContain('📞'); // No emoji
    expect(html).not.toContain('Front Desk: 0217-2725388');
    expect(html).not.toContain('border-top: 1px dashed'); // Dashed line removed
  });

  it('h) Father / Spouse row and Guest Declaration disclaimer must be completely removed', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).not.toContain('Father / Spouse:');
    expect(html).not.toContain('Guest Declaration');
    expect(html).not.toContain('Hazardous materials, firearms');
  });

  it('i) Voucher No & Check-in Date must be in clean key-value table and Walk-in banner cleaned', () => {
    const html = buildGuestRegistrationHTML(mockRegistrationData, { includePhotos: false });
    expect(html).toContain('Voucher / Reg No:');
    expect(html).toContain('Check-in Date:');
    expect(html).toContain('border: 3.5px solid #1e3a8a;');
    
    // Direct walk-in banner cleanup:
    expect(html).toContain('BOOKING CASE: DIRECT WALK-IN GUEST');
    expect(html).not.toContain('(FRONT DESK REGISTRATION)');
    expect(html).not.toContain('Standard hotel walk-in registration');
    expect(html).not.toContain('Room tariff and taxes are billed directly to guest folio');
  });

  it('j) Occupied Room Voucher - OTA Pre-Paid with Extra Member & F&B orders clearly explains case in one look', () => {
    const otaOccupiedData = {
      guestName: 'Rajesh Kumar Verma',
      mobile: '9822012345',
      roomNumber: '101',
      roomType: 'Deluxe AC',
      bookingSource: 'OTA',
      otaPlatform: 'MakeMyTrip',
      otaBookingId: 'MMT-2026-99381',
      rateType: 'prepaid',
      isOccupiedStay: true,
      stayStatus: 'OCCUPIED',
      stayNights: 2,
      checkinTime: '2026-09-17T12:00:00',
      approxCheckout: '2026-09-19T11:00:00',
      mealPlan: 'with_breakfast',
      adultsMale: 2,
      adultsFemale: 1,
      children: 1,
      extraBeds: 2,
      extraBedCharge: 500, // 1 bed included in OTA package + 1 bed hotel charged
      roomTariffNet: 4000,
      taxAmount: 200,
      foodTotal: 650,
      barTotal: 0,
      fnbPendingTotal: 650,
      grandTotal: 5350,
      totalPaid: 500,
      splitCash: 500,
      splitCard: 2500,
      splitOnline: 2500,
      onlineUtr: 'mmt-upi-9988'
    };

    const html = buildGuestRegistrationHTML(otaOccupiedData, { includePhotos: false });

    // 1. Top Case Banner & Status (OCCUPIED STAY badge removed, extra member displayed, banner subtitle removed)
    expect(html).toContain('BOOKING CASE: OTA PRE-PAID RESERVATION (MAKEMYTRIP) WITH EXTRA MEMBER');
    expect(html).not.toContain('OCCUPIED STAY');
    expect(html).not.toContain('Stay Status:');
    expect(html).not.toContain('Room stay tariff is FULLY COVERED by OTA Voucher');
    expect(html).toContain('Voucher Ref: #MMT-2026-99381');

    // 2. Stay Details (Meal Plan & Extra bed breakdown, key-value people lived in)
    expect(html).toContain('With Breakfast • OTA Pre-booked');
    expect(html).toContain('1 Bed (OTA Included) + 1 Bed (₹500 Hotel Added)');
    expect(html).toContain('Male:');
    expect(html).toContain('Female:');
    expect(html).toContain('Children:');
    expect(html).toContain('Extra Bed:');

    // 3. Clear Breakdown: Pre-booked via OTA, Extra Booking @ Hotel, and Calculation
    expect(html).toContain('Pre-Booked via OTA');
    expect(html).toContain('Extra Booking @ Hotel');
    expect(html).toContain('[PREPAID]');
    expect(html).toContain('HOTEL INCIDENTALS BREAKDOWN:');
    expect(html).toContain('(Voucher Covered)');
    expect(html).toContain('Extra Bed(s): <strong>₹ 500</strong>');
    expect(html).toContain('F&amp;B Orders: <strong>₹ 650</strong>');

    // 4. Payment modes show card fee and tax on UPI (only for > 2000)
    expect(html).toContain('Card POS: ₹ 2,563 (₹2,500 + ₹63 Fee)');
    expect(html).toContain('Online UPI: ₹ 2,510 (₹2,500 + ₹10 Fee)');

    // 5. Case Summary narrative row is completely removed
    expect(html).not.toContain('CASE SUMMARY (ONE-LOOK OVERVIEW):');
  });

  it('k) OTA Pay at Hotel case clearly shows pay-at-hotel banner with extra member detection', () => {
    const otaPayAtHotelData = {
      guestName: 'Pooja Sharma',
      mobile: '9845012345',
      roomNumber: '204',
      bookingSource: 'OTA',
      otaPlatform: 'Agoda',
      otaBookingId: 'AGODA-77182',
      rateType: 'pay_at_hotel',
      isOccupiedStay: true,
      roomTariffNet: 3000,
      taxAmount: 150,
      grandTotal: 3150,
      totalPaid: 1000,
      balanceDue: 2150
    };

    const html = buildGuestRegistrationHTML(otaPayAtHotelData, { includePhotos: false });
    expect(html).toContain('BOOKING CASE: OTA RESERVATION (AGODA) • PAY AT HOTEL');
    expect(html).toContain('Entire room stay tariff + hotel incidentals must be collected directly from guest');
    expect(html).not.toContain('OCCUPIED STAY');
    expect(html).not.toContain('Stay Status:');
  });

  it('l) Corporate Bill to Company (BTC) case shows company name, credit ledger debit & personal guest extras', () => {
    const btcData = {
      guestName: 'Anil Desai',
      mobile: '9876500000',
      roomNumber: '302',
      bookingSource: 'Corporate (BTC)',
      btcCompanyName: 'Infosys Limited',
      btcApprovalRef: 'INF-2026-441',
      isOccupiedStay: true,
      roomTariffNet: 3500,
      taxAmount: 175,
      foodTotal: 400,
      grandTotal: 4075,
      totalPaid: 0,
      balanceDue: 4075
    };

    const html = buildGuestRegistrationHTML(btcData, { includePhotos: false });
    expect(html).toContain('BOOKING CASE: CORPORATE BILL TO COMPANY (BTC) — INFOSYS LIMITED');
    expect(html).toContain('debited to Company Credit Ledger');
    expect(html).toContain('Approval: #INF-2026-441');
    expect(html).toContain('F&amp;B Orders: <strong>₹ 400</strong>');
  });

  it('m) Group booking (multi-room) displays clean room format "Rooms 101, 102, 103"', () => {
    const groupData = {
      guestName: 'Vikram Singhania',
      roomNumber: '101',
      all_group_rooms: [
        { room_number: '101', room_type: 'Executive' },
        { room_number: '102', room_type: 'Executive' },
        { room_number: '103', room_type: 'Deluxe AC' }
      ],
      adultsMale: 4,
      adultsFemale: 3,
      children: 2,
      bookingSource: 'Walk-in',
      isOccupiedStay: true
    };

    const html = buildGuestRegistrationHTML(groupData, { includePhotos: false });
    expect(html).toContain('GROUP (3 ROOMS)');
    // Clean room format: "Rooms 101, 102, 103"
    expect(html).toContain('Rooms 101, 102, 103');
    expect(html).not.toContain('Room #101 (Executive) + Room #102 (Executive)');
    // Key-value people lived in
    expect(html).toContain('Male:');
    expect(html).toContain('Female:');
    expect(html).toContain('Children:');
    expect(html).toContain('Extra Bed:');
  });

  it('n) UPI Exemption Threshold rule: payments <= ₹2,000 incur 0% fee (no tax added), payments > ₹2,000 incur 0.4%', () => {
    // Case 1: Small payment <= 2000 (e.g. ₹500 from user's case)
    const smallUpiData = {
      ...mockRegistrationData,
      splitCash: 1000,
      splitCard: 500,
      splitOnline: 500,
      onlineUtr: 'UPI-SMALL-500'
    };
    const smallHtml = buildGuestRegistrationHTML(smallUpiData, { includePhotos: false });
    expect(smallHtml).toContain('Online UPI: ₹ 500 [UTR: <strong>UPI-SMALL-500</strong>]');
    expect(smallHtml).not.toContain('UPI Tax');
    expect(smallHtml).not.toContain('+₹2');

    // Case 2: Exactly 2000 (boundary condition: all payments UP TO 2000 incur 0% fee)
    const exactUpiData = {
      ...mockRegistrationData,
      splitCash: 0,
      splitCard: 0,
      splitOnline: 2000,
      onlineUtr: 'UPI-EXACT-2000'
    };
    const exactHtml = buildGuestRegistrationHTML(exactUpiData, { includePhotos: false });
    expect(exactHtml).toContain('Online UPI: ₹ 2,000 [UTR: <strong>UPI-EXACT-2000</strong>]');
    expect(exactHtml).not.toContain('UPI Tax');

    // Case 3: More than 2000 (e.g. ₹5,000 -> 0.4% = ₹20)
    const largeUpiData = {
      ...mockRegistrationData,
      splitCash: 0,
      splitCard: 0,
      splitOnline: 5000,
      onlineUtr: 'UPI-LARGE-5000'
    };
    const largeHtml = buildGuestRegistrationHTML(largeUpiData, { includePhotos: false });
    expect(largeHtml).toContain('Online UPI: ₹ 5,020 (₹5,000 + ₹20 Fee) [UTR: <strong>UPI-LARGE-5000</strong>]');
  });

  it('o) OTA Pre-Paid Group (2 rooms) with Extra Member: clearly identifies OTA booked members vs Hotel extra booked members and charges', () => {
    const otaGroupExtraData = {
      guestName: 'Md Aamir Raza',
      mobile: '9370013388',
      voucherNo: '20260918-267',
      bookingSource: 'OTA',
      otaPlatform: 'MakeMyTrip',
      otaBookingId: '20260918-267',
      rateType: 'prepaid',
      isOccupiedStay: true,
      all_group_rooms: [
        { room_number: '101', room_type: 'Deluxe' },
        { room_number: '102', room_type: 'Deluxe' }
      ],
      checkinTime: '2026-09-18T11:19:00',
      approxCheckout: '2026-09-19T11:00:00',
      stayNights: 1,
      mealPlan: 'room_only',
      adultsMale: 3,
      adultsFemale: 1,
      children: 1,
      extraBeds: 1,
      otaBookedAdults: 2,
      otaBookedChildren: 0,
      otaBookedExtraBeds: 0,
      extraAdults: 1,
      extraChildren: 1,
      hotelChargedBeds: 1,
      voucherIncludedBeds: 0,
      extraBedCharge: 500,
      otaBillAmount: 3500,
      roomTariffNet: 3500,
      totalDue: 4000,
      totalPaid: 500,
      splitCash: 500
    };

    const html = buildGuestRegistrationHTML(otaGroupExtraData, { includePhotos: false });
    // Case banner with group and extra member
    expect(html).toContain('BOOKING CASE: OTA PRE-PAID RESERVATION (MAKEMYTRIP) WITH EXTRA MEMBER');
    expect(html).toContain('GROUP (2 ROOMS)');
    expect(html).toContain('Voucher Ref: #20260918-267');
    
    // Living in people
    expect(html).toContain('Male:');
    expect(html).toContain('Female:');
    expect(html).toContain('Children:');
    expect(html).toContain('Extra Bed:');

    // OTA Booked vs Hotel extra breakdown
    expect(html).toContain('OTA Booked: 2 Adults');
    expect(html).toContain('Hotel Extra: +1 Adult(s) +1 Child +1 Bed (+₹500)');

    // Payment reconciliation:
    expect(html).toContain('Pre-Booked via OTA');
    expect(html).toContain('Extra Booking @ Hotel');
    expect(html).toContain('₹ 3,500.00');
    expect(html).toContain('₹ 500.00');
    // Remaining balance is removed from check-in form as requested
    expect(html).not.toContain('Balance Remaining');
  });

  it('l) should accurately calculate and reconcile OTA Pre-Paid booking with ₹1,500 voucher and ₹3,000 desk advance (Total ₹4,500, Remaining ₹0.00, no rack rate inflation)', () => {
    const otaCaseData = {
      guestName: 'Md Yahya Ab Wahid Mundewadi',
      mobile: '9028850715',
      bookingSource: 'OTA',
      otaPlatform: 'MakeMyTrip',
      otaBookingId: 'lkjhlkjhkjh',
      otaBillAmount: 1500,
      isPrepaid: true,
      roomNumber: '104',
      all_group_rooms: [{ room_number: '104' }, { room_number: '105' }],
      adultsMale: 1,
      adultsFemale: 2,
      children: 2,
      extraBeds: 3,
      extraBedCharge: 1000,
      otaBookedAdults: 1,
      otaBookedChildren: 0,
      otaBookedExtraBeds: 1,
      extraAdults: 2,
      extraChildren: 2,
      // Room rack rates (5000) that MUST NOT inflate the total booking value:
      roomTariffNet: 4762,
      grandTotal: 5000,
      totalDue: 5000,
      totalPaid: 3000,
      splitCash: 1000,
      splitCard: 1000,
      splitOnline: 1000
    };

    const html = buildGuestRegistrationHTML(otaCaseData, { includePhotos: false });

    // Pre-booked OTA column: ₹ 1,500.00
    expect(html).toContain('₹ 1,500.00');
    expect(html).toContain('(OTA Pre-Paid)');

    // Hotel Extras: ₹ 3,000.00 (Extra Bed: ₹1,000 • Other Extras: ₹2,000)
    expect(html).toContain('₹ 3,000.00');
    expect(html).toContain('Extra Bed: ₹1,000');
    expect(html).toContain('Other Extras: ₹2,000');

    // Tax should be 0 (in voucher) for OTA prepaid
    expect(html).toContain('₹ 0.00');
    expect(html).toContain('(In Voucher)');

    // Total Booking Value: 1,500 + 3,000 = 4,500. MUST NOT be 5,000!
    expect(html).toContain('₹ 4,500.00');
    expect(html).not.toContain('₹ 5,000.00');

    // Amount collected: 1,500 + 3,000 = 4,500
    expect(html).toContain('₹ 4,500.00');
    expect(html).toContain('₹1,500 Prepaid + ₹3,000 Desk');

    // Balance remaining should NOT be seen on check-in form
    expect(html).not.toContain('Balance Remaining');
  });
});

describe('Room Card UI Cleanup (Clean Cards on Live Rooms Grid)', () => {
  const roomCardPath = require('path').resolve(__dirname, '../src/components/hospitality/RoomCard.jsx');
  const roomCardCode = require('fs').readFileSync(roomCardPath, 'utf-8');

  it('verifies that OTA pill and Early Check-in pill have been completely removed from RoomCard', () => {
    expect(roomCardCode).not.toContain('room-ota-pill');
    expect(roomCardCode).not.toContain('room-early-ci-pill');
    expect(roomCardCode).not.toContain('Early C/I:');
  });
});

describe('Safe Print Margins (HP LaserJet & Desktop Printer Roller Protection)', () => {
  const stylesCssPath = require('path').resolve(__dirname, '../public/styles.css');
  const stylesCss = require('fs').readFileSync(stylesCssPath, 'utf-8');
  const printServicePath = require('path').resolve(__dirname, '../src/services/printService.js');
  const printServiceCode = require('fs').readFileSync(printServicePath, 'utf-8');

  it('verifies @page rules specify safe top and bottom margin of at least 8mm to prevent physical roller cutoff', () => {
    expect(stylesCss).toContain('margin: 8mm 6mm 8mm 6mm !important;');
    expect(stylesCss).not.toContain('margin: 3mm 5mm !important;');
  });

  it('verifies #print-registration-sheet.print-active has top padding clearance', () => {
    expect(stylesCss).toContain('#print-registration-sheet.print-active');
    expect(stylesCss).toContain('padding-top: 2mm !important;');
  });

  it('verifies 2-per-A4 templates are calibrated to fit within 1-page A4 height with zero overlap and >25mm bottom clearance', () => {
    expect(stylesCss).toContain('height: 126mm !important;');
    expect(stylesCss).toContain('max-height: 126mm !important;');
    expect(stylesCss).toContain('height: 7mm !important;');
    expect(stylesCss).toContain('position: static !important;');
  });

  it('verifies downloadGuestRegistrationPDF uses safe top margin [8, 5, 5, 5]', () => {
    expect(printServiceCode).toContain('margin: [8, 5, 5, 5]');
  });

  it('verifies printDailyClosingReport is implemented and exported in printService.js', () => {
    expect(printServiceCode).toContain('export function printDailyClosingReport(');
    expect(printServiceCode).toContain('DAILY CLOSING &amp; AUDIT REPORT');
    expect(printServiceCode).toContain('Net Cash in Drawer');
  });
});

describe('Dynamic Document ID Labeling & Driving License / Passport Parity', () => {
  it('getIdNumberLabel returns accurate labels for all supported document types', () => {
    expect(getIdNumberLabel('Passport')).toBe('Passport No:');
    expect(getIdNumberLabel('passport')).toBe('Passport No:');
    expect(getIdNumberLabel('Driving License')).toBe('Driving License No:');
    expect(getIdNumberLabel('driving licence')).toBe('Driving License No:');
    expect(getIdNumberLabel('DL')).toBe('Driving License No:');
    expect(getIdNumberLabel('Aadhaar Card')).toBe('Aadhaar No:');
    expect(getIdNumberLabel('Aadhar Card')).toBe('Aadhaar No:');
    expect(getIdNumberLabel('Voter ID')).toBe('Voter ID No:');
    expect(getIdNumberLabel('PAN Card')).toBe('PAN No:');
    expect(getIdNumberLabel('Government ID')).toBe('Government ID No:');
  });

  it('prints Passport No: when document type is Passport (Digital PDF & Physical Sheet)', () => {
    const passportData = {
      guestName: 'AMIR RAZA IRFAN RANGREZ',
      mobile: '6546465465',
      docType: 'Passport',
      aadharNumber: 'R9570989',
      roomNumber: '101'
    };
    const htmlDigital = buildGuestRegistrationHTML(passportData, { includePhotos: true });
    const htmlPaper = buildGuestRegistrationHTML(passportData, { includePhotos: false });

    expect(htmlDigital).toContain('Passport No:');
    expect(htmlDigital).toContain('R9570989');
    expect(htmlDigital).not.toContain('Aadhar / ID No:');

    expect(htmlPaper).toContain('Passport No:');
    expect(htmlPaper).toContain('R9570989');
    expect(htmlPaper).not.toContain('Aadhar / ID No:');
  });

  it('prints Driving License No: when document type is Driving License', () => {
    const dlData = {
      guestName: 'Rahul Patil',
      mobile: '9876543210',
      docType: 'Driving License',
      aadharNumber: 'MH13 20180004523',
      roomNumber: '102'
    };
    const html = buildGuestRegistrationHTML(dlData, { includePhotos: false });
    expect(html).toContain('Driving License No:');
    expect(html).toContain('MH13 20180004523');
    expect(html).not.toContain('Aadhar / ID No:');
  });

  it('correctly formats check-in form for Voucher 260920-556 with full Aadhaar, Email, Address, 108px logo, and single-line hotel address', () => {
    const voucherData = {
      voucherNo: '260920-556',
      checkinTime: '2026-09-20T17:16:00',
      guestName: 'Group Agoda Guest',
      mobile: '9811223344',
      email: 'hcitypark@rediffmail.com',
      address: '119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)',
      docType: 'Aadhaar Card',
      aadharNumber: '4438 4267 7809',
      roomNumber: '881',
      roomType: 'Deluxe AC',
      bookingSource: 'OTA',
      otaPlatform: 'Agoda',
      otaBookingId: 'AG-GROUP-102103'
    };

    const html = buildGuestRegistrationHTML(voucherData, { includePhotos: false });

    // Logo size enlarged by 50% (108px)
    expect(html).toContain('height: 108px;');

    // Hotel address single line
    expect(html).toContain('119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)');
    expect(html).toContain('white-space: nowrap;');

    // Hotel contact info
    expect(html).toContain('0217-2729791, 92, 93');
    expect(html).not.toContain('0217-2725388');
    expect(html).toContain('hcitypark@rediffmail.com');
    expect(html).not.toContain('info@hotelcitypaark.com');

    // Voucher and check-in date
    expect(html).toContain('260920-556');
    expect(html).toContain('20 Sept 2026 05:16 pm');

    // Guest personal details must not be '-'
    expect(html).toContain('4438 4267 7809');
    expect(html).toContain('Aadhaar No:');
    expect(html).toContain('Permanent Address:');
    expect(html).toContain('Email Address:');
  });
});

describe('Annexure Page 2 (6-Scan Aligned Grid, Leader Priority, Page 1 Clean UI)', () => {
  const mockWithScans = {
    guestName: 'Amir Raza Rangrez',
    mobile: '9370013388',
    docType: 'Passport',
    aadharNumber: 'R9570989',
    roomNumber: '101',
    voucherNo: '20260919-881',
    docFront: 'data:image/png;base64,leader_front_data',
    docBack: 'data:image/png;base64,leader_back_data',
    guestPhoto: 'data:image/png;base64,leader_webcam_data',
    memberDocuments: [
      {
        name: 'Farhan Shaikh',
        docType: 'Aadhaar Card',
        idNumber: '1122-3344-5566',
        docFront: 'data:image/png;base64,comp1_front_data',
        docBack: 'data:image/png;base64,comp1_back_data'
      }
    ]
  };

  it('renders clean Page 1 without any scan thumbnails when includePhotos: false (paper print)', () => {
    const html = buildGuestRegistrationHTML(mockWithScans, { includePhotos: false });
    expect(html).toContain('Amir Raza Rangrez');
    expect(html).toContain('Guest Signature');
    expect(html).toContain('Front Desk Cashier');
    // Annexure should NOT be rendered on physical paper print
    expect(html).not.toContain('annexure-sheet');
    expect(html).not.toContain('LEADER ID (FRONT)');
    expect(html).not.toContain('leader_front_data');
  });

  it('renders Page 2 Annexure when includePhotos: true with Leader priority first', () => {
    const html = buildGuestRegistrationHTML(mockWithScans, { includePhotos: true });
    expect(html).toContain('full-a4-registration-card annexure-sheet');
    expect(html).toContain('HOTEL CityPaark — Document Verification Annexure');
    expect(html).toContain('Official Scanned Records &bull; Primary Guest / Room Leader First &bull; 6 Scans Aligned Per Sheet');
    expect(html).toContain('Voucher: 260919-881');
    expect(html).toContain('Sheet 2 of 2');

    // Check order: Leader Front, Leader Back, Leader Live Photo, then Companion Front, Companion Back
    const posLeaderFront = html.indexOf('LEADER ID (FRONT)');
    const posLeaderBack = html.indexOf('LEADER ID (BACK)');
    const posLeaderPhoto = html.indexOf('LEADER LIVE PHOTO');
    const posComp1Front = html.indexOf('COMPANION #1 (FRONT)');
    const posComp1Back = html.indexOf('COMPANION #1 (BACK)');

    expect(posLeaderFront).toBeGreaterThan(-1);
    expect(posLeaderBack).toBeGreaterThan(posLeaderFront);
    expect(posLeaderPhoto).toBeGreaterThan(posLeaderBack);
    expect(posComp1Front).toBeGreaterThan(posLeaderPhoto);
    expect(posComp1Back).toBeGreaterThan(posComp1Front);

    // 5 scans provided, so 1 blank slot generated to complete the 6-slot aligned grid
    expect(html).toContain('Blank Slot 6 of 6');
    expect(html).toContain('Slot 1 of 6');
    expect(html).toContain('Slot 5 of 6');
  });

  it('partitions scans into multiple annexure pages when total scans exceed 6', () => {
    const mockManyScans = {
      ...mockWithScans,
      memberDocuments: [
        {
          name: 'Companion One',
          docFront: 'data:image/png;base64,c1_front',
          docBack: 'data:image/png;base64,c1_back'
        },
        {
          name: 'Companion Two',
          docFront: 'data:image/png;base64,c2_front',
          docBack: 'data:image/png;base64,c2_back'
        }
      ]
    };
    // 3 leader scans + 4 companion scans = 7 scans total -> 2 annexure sheets
    const html = buildGuestRegistrationHTML(mockManyScans, { includePhotos: true });
    expect(html).toContain('Sheet 2 of 3');
    expect(html).toContain('Sheet 3 of 3');
    expect(html).toContain('Blank Slot 2 of 6'); // 7th scan is on sheet 3, slots 2-6 are blank
  });

  it('supports up to 15 scanned copies aligned 6 per A4 paper across 3 annexure sheets (4 pages total)', () => {
    // 3 leader scans (Front, Back, Webcam) + 12 companion scans = 15 scans total
    const companions12Scans = [];
    for (let c = 1; c <= 6; c++) {
      companions12Scans.push({
        name: `Companion ${c}`,
        docFront: `data:image/png;base64,c${c}_front`,
        docBack: `data:image/png;base64,c${c}_back`
      });
    }

    const mock15Scans = {
      ...mockWithScans,
      memberDocuments: companions12Scans
    };

    const html = buildGuestRegistrationHTML(mock15Scans, { includePhotos: true });

    // 15 scans -> Math.ceil(15 / 6) = 3 annexure sheets + 1 page of details = 4 pages total
    expect(html).toContain('Sheet 2 of 4');
    expect(html).toContain('Sheet 3 of 4');
    expect(html).toContain('Sheet 4 of 4');

    // Page break divs for html2pdf.js
    expect(html).toContain('class="html2pdf__page-break"');
    const pageBreaks = html.match(/class="html2pdf__page-break"/g);
    expect(pageBreaks).not.toBeNull();
    expect(pageBreaks.length).toBe(3); // 3 annexure sheets, 3 page breaks

    // Page 4 has 3 scans (15 total - 12 from previous 2 sheets), so 3 blank slots remaining
    expect(html).toContain('Blank Slot 4 of 6');
    expect(html).toContain('Blank Slot 5 of 6');
    expect(html).toContain('Blank Slot 6 of 6');
  });
});
