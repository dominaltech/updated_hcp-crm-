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

    // 2. Base room tariff must be pre-tax (Option B flat 5%: 5000 * 0.95 = 4750.00)
    expect(html).toContain('Room Tariff -');
    expect(html).toContain('4750.00');

    // 3. Early check-in must be 900 * 0.95 = 855.00 and labeled Early Check-In Charge (NOT Extra Mattress!)
    expect(html).toContain('Early Check-In Charge');
    expect(html).toContain('855.00');
    expect(html).not.toContain('Extra Mattress Base Tariff');

    // 4. CGST & SGST @ 2.5% on 5605.00 = 147.50 each (Total GST: 295.00 = 5% of 5900)
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('SGST @ 2.5%');
    expect(html).toContain('147.50');

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

    // Room Tariff: 5000 * 0.95 = 4750.00
    expect(html).toContain('4750.00');
    // Extra Mattress: 500 * 0.95 = 475.00
    expect(html).toContain('Extra Mattress Base Tariff');
    expect(html).toContain('475.00');
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
    expect(htmlPrepaid).toContain('75.00'); // Option B: 5% flat GST on 1500
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
    expect(htmlWithExtras).toContain('140.00'); // Option B: 5% flat GST on 2800 (2300 + 500)
    expect(htmlWithExtras).toContain('(In Voucher)');
  });

  it('correctly calculates Room 105 OTA Prepaid Tax Invoice with 0 balance and voucher credit', () => {
    const room105 = {
      room_number: '105',
      booking_source: 'OTA',
      ota_platform: 'Goibibo',
      ota_booking_id: 'lkjkjhlkh',
      ota_bill_amount: 1000,
      room_rate: 2000,
      price: 2000,
      total_room_charge: 0,
      is_prepaid: 1,
      rate_type: 'prepaid',
      voucher_number: '260930-606',
      invoice_no: 'HCP606'
    };
    const calc105 = {
      ...room105,
      room: room105,
      summary: {
        otaBillAmount: 1000,
        roomCharge: 0,
        roomGrossTariff: 0,
        grossTariff: 0
      }
    };
    const html = buildFinalBillA4HTML(room105, calc105, {
      settled_at: '2026-09-30T14:04:09',
      invoiceNo: 'HCP606',
      checked_out_by: 'Jaijeet sir'
    });

    // 1. Base Room Tariff (Option B: 1000 * 0.95 = 950.00)
    expect(html).toContain('Room Tariff -');
    expect(html).toContain('950.00');
    expect(html).not.toContain('1904.76');

    // 2. CGST & SGST @ 2.5% on 950.00 = 25.00 each (Total GST: 50.00 = 5% of 1000)
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('SGST @ 2.5%');
    expect(html).toContain('25.00');

    // 3. Room Bill Total: exactly 1000.00
    expect(html).toContain('Room Bill Total');
    expect(html).toContain('1000.00');

    // 4. Round-off: 0.00 (NOT 2000.00!)
    expect(html).toContain('Round-off');
    expect(html).toContain('0.00');
    expect(html).not.toContain('2000.00');

    // 5. Invoice Total: 1000.00 & Words
    expect(html).toContain('Invoice Total');
    expect(html).toContain('Rs. One Thousand Only');

    // 6. Settlement Box: Gross 1000.00, OTA Pre-Paid Voucher 1000.00, Net Payable 0.00
    expect(html).toContain('Gross Payable Amount');
    expect(html).toContain('OTA Pre-Paid Voucher');
    expect(html).toContain('Net Payable Amount');
    expect(html).toContain('0.00');
    expect(html).toContain('(Net Payable Amount In words : Rs. Zero Only)');
  });

  it('correctly calculates Room 105 with F&B bill showing only F&B to pay', () => {
    const room105WithFnb = {
      room_number: '105',
      booking_source: 'OTA',
      ota_platform: 'Goibibo',
      ota_booking_id: 'lkjkjhlkh',
      ota_bill_amount: 1000,
      room_rate: 2000,
      price: 2000,
      total_room_charge: 0,
      is_prepaid: 1,
      rate_type: 'prepaid',
      voucher_number: '260930-606',
      invoice_no: 'HCP606'
    };
    const calc105WithFnb = {
      ...room105WithFnb,
      foodTotal: 300,
      barTotal: 0,
      summary: {
        otaBillAmount: 1000,
        roomCharge: 0,
        foodTotal: 300,
        barTotal: 0
      }
    };
    const html = buildFinalBillA4HTML(room105WithFnb, calc105WithFnb, {
      settled_at: '2026-09-30T14:04:09',
      invoiceNo: 'HCP606',
      checked_out_by: 'Jaijeet sir'
    });

    // Room 1000 + F&B 300 = Invoice Total 1300
    expect(html).toContain('Invoice Total');
    expect(html).toContain('1300.00');
    expect(html).toContain('Rs. One Thousand Three Hundred Only');

    // Settlement: Gross 1300.00, OTA Voucher 1000.00, Net Payable 300.00
    expect(html).toContain('Gross Payable Amount');
    expect(html).toContain('1300.00');
    expect(html).toContain('OTA Pre-Paid Voucher');
    expect(html).toContain('1000.00');
    expect(html).toContain('Net Payable Amount');
    expect(html).toContain('300.00');
    expect(html).toContain('Rs. Three Hundred Only');
  });
});


