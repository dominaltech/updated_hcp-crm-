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

import { buildFinalBillA4HTML, buildGuestRegistrationHTML } from '../src/services/printService.js';

describe('User Requirements: OTA 5% Inclusive GST and HCP605 Itemized Tax Invoice', () => {
  const hcp605Booking = {
    id: 6,
    room_id: 4,
    guest_name: 'MD YAHYA AB WAHID MUNDEWADI',
    address: 'S/O: AB WAHID MUNDEWAIDI, 259 MUSLIM PACHHA PETH, SOLAPUR',
    room_number: '103',
    room_type: 'Super Deluxe AC',
    pax: 3,
    adults_male: 1,
    adults_female: 1,
    children: 1,
    checkin_time: '2026-09-29T16:54:00',
    checkout_time: '2026-09-30T12:42:07',
    actual_checkout_time: '2026-09-30T12:42:07',
    voucher_number: '260929-605',
    invoice_no: 'HCP605',
    booking_source: 'OTA',
    ota_platform: 'Booking.com',
    ota_bill_amount: 5000,
    rate_type: 'pay_at_hotel',
    is_prepaid: 0,
    is_early_checkin: 1,
    early_checkin_charge: 900,
    extra_beds: 0,
    extra_bed_charge: 0,
    total_room_charge: 5900,
    advance_payment: 3000,
    final_settlement_payment: 2900,
    total_paid: 5900,
    company_name: 'WIPRO',
    gst_number: 'ASFASDASDF',
    checked_in_by: 'cap-1',
    checked_out_by: 'Jaijeet sir',
    status: 'checked_out'
  };

  it('generates 100% mathematically correct Tax Invoice for HCP605 with base tariff and early checkin separated', () => {
    const html = buildFinalBillA4HTML(hcp605Booking, hcp605Booking, {
      settleAmt: 2900,
      settled_at: '2026-09-30T12:42:07',
      invoiceNo: 'HCP605',
      checked_out_by: 'Jaijeet sir'
    });

    // 1. Header & Identity
    expect(html).toContain('TAX INVOICE');
    expect(html).toContain('HCP605');
    expect(html).toContain('260929-605');
    expect(html).toContain('MD YAHYA AB WAHID MUNDEWADI');
    expect(html).toContain('WIPRO');
    expect(html).toContain('ASFASDASDF');

    // 2. Base room tariff must be pre-tax 5000 / 1.05 = 4761.90 (NOT 5900.00!)
    expect(html).toContain('Room Tariff -');
    expect(html).toContain('4761.90');

    // 3. Early check-in must be 900 / 1.05 = 857.14 and labeled Early Check-In Charge (NOT Extra Mattress!)
    expect(html).toContain('Early Check-In Charge');
    expect(html).toContain('857.14');
    expect(html).not.toContain('Extra Mattress Base Tariff');

    // 4. CGST & SGST @ 2.5% on 5619.04 = 140.48 each
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('SGST @ 2.5%');
    expect(html).toContain('140.48');

    // 5. Room Bill Total must be exactly 5900.00 in both columns (NOT 3900.00 in middle vs 4050.00!)
    expect(html).toContain('Room Bill Total');
    expect(html).toContain('5900.00');
    expect(html).not.toContain('3900.00');
    expect(html).not.toContain('4050.00');

    // 6. Round-off must be 0.00 (NOT 4050.00!)
    expect(html).toContain('Round-off');
    expect(html).toContain('0.00');

    // 7. Invoice Total
    expect(html).toContain('Invoice Total');
    expect(html).toContain('Rs. Five Thousand Nine Hundred Only');

    // 8. Settlement breakdown: Gross 5900.00, Advance 3000.00, Net Payable 2900.00
    expect(html).toContain('Gross Payable Amount');
    expect(html).toContain('5900.00');
    expect(html).toContain('Advance Received');
    expect(html).toContain('3000.00');
    expect(html).toContain('Net Payable Amount');
    expect(html).toContain('2900.00');
    expect(html).toContain('Rs. Two Thousand Nine Hundred Only');
  });

  it('correctly shows extra mattress base tariff when extra mattress is actually present', () => {
    const otaBookingWithMattress = {
      ...hcp605Booking,
      is_early_checkin: 0,
      early_checkin_charge: 0,
      extra_beds: 1,
      extra_bed_charge: 500,
      total_room_charge: 5500
    };

    const html = buildFinalBillA4HTML(otaBookingWithMattress, otaBookingWithMattress, {});

    // Room Tariff: 5000 / 1.05 = 4761.90
    expect(html).toContain('4761.90');
    // Extra Mattress: 500 / 1.05 = 476.19
    expect(html).toContain('Extra Mattress Base Tariff');
    expect(html).toContain('476.19');
    // Room Bill Total: 5500.00
    expect(html).toContain('5500.00');
  });

  it('displays 5% included GST in Check-in Form payment summary for OTA Prepaid and Pay-at-Hotel', () => {
    // 1. OTA Prepaid (Image 1 case)
    const otaPrepaid = {
      booking_source: 'OTA',
      ota_platform: 'Goibibo',
      ota_bill_amount: 1500,
      rate_type: 'prepaid',
      is_prepaid: 1,
      total_paid: 1500
    };
    const htmlPrepaid = buildGuestRegistrationHTML(otaPrepaid);
    expect(htmlPrepaid).toContain('71.43'); // 5% inclusive GST on 1500
    expect(htmlPrepaid).toContain('(In Voucher)');

    // 2. OTA Prepaid with Extra Mattress (Image 3 case)
    const otaPrepaidWithExtras = {
      booking_source: 'OTA',
      ota_platform: 'Goibibo',
      ota_bill_amount: 2300,
      extra_beds: 1,
      extra_bed_charge: 500,
      rate_type: 'prepaid',
      is_prepaid: 1,
      total_paid: 500
    };
    const htmlWithExtras = buildGuestRegistrationHTML(otaPrepaidWithExtras);
    expect(htmlWithExtras).toContain('133.33'); // 5% inclusive GST on 2800 (2300 + 500)
    expect(htmlWithExtras).toContain('(In Voucher)');
  });
});
