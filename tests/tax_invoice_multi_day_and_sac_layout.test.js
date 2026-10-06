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

import { buildFinalBillA4HTML } from '../src/services/printService';

describe('Tax Invoice Dynamic Multi-Day and SAC Layout', () => {
  it('Requirement 1 & 2: Header is "(Accommodation)  SAC: 996311" and 1-day stay renders only ONE date column', () => {
    const room = {
      guest_name: 'Rahul Sharma',
      room_number: '201',
      checkin_time: '2026-10-05 14:00:00',
      checkout_time: '2026-10-06 11:00:00',
      voucher_number: 'HCP-101',
      booking_source: 'Direct'
    };
    const calc = {
      billableDays: 1,
      grossTariff: 1500,
      roomCharge: 1575
    };
    const settlement = {
      settled_at: '2026-10-06 11:00:00',
      checked_out_by: 'Cashier_1'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    // 1. Header has "(Accommodation)  SAC: 996311"
    expect(html).toContain('(Accommodation) &nbsp;SAC: 996311');

    // 2. Only ONE date column (05/10) for 1-day stay
    expect(html).toContain('>05/10</th>');
    expect(html).not.toContain('>06/10</th>');

    // 3. Room Tariff and tax directly below 05/10 and in Total
    expect(html).toContain('Room Tariff');
    expect(html).toContain('1500.00');
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('37.50');
    expect(html).toContain('SGST @ 2.5%');
    expect(html).toContain('37.50');
    expect(html).toContain('Room Bill Total');
    expect(html).toContain('1575.00');
  });

  it('Requirement 3: 2-day stay renders TWO date columns (05/10, 06/10) with daily costing underneath', () => {
    const room = {
      guest_name: 'Priya Patel',
      room_number: '302',
      checkin_time: '2026-10-05 12:00:00',
      checkout_time: '2026-10-07 10:00:00',
      voucher_number: 'HCP-102',
      booking_source: 'Direct'
    };
    const calc = {
      billableDays: 2,
      grossTariff: 3000,
      roomCharge: 3150
    };
    const settlement = {
      settled_at: '2026-10-07 10:00:00',
      checked_out_by: 'Cashier_1'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    // Both dates appear in header
    expect(html).toContain('>05/10</th>');
    expect(html).toContain('>06/10</th>');

    // Daily tariff 1500.00 and Total 3000.00
    expect(html).toContain('Room Tariff - (2 Days)');
    expect(html).toContain('1500.00');
    expect(html).toContain('3000.00');

    // Daily CGST 37.50 and Total 75.00
    expect(html).toContain('37.50');
    expect(html).toContain('75.00');

    // Daily Room Total 1575.00 and Total 3150.00
    expect(html).toContain('1575.00');
    expect(html).toContain('3150.00');
  });

  it('Requirement 4: 5-day stay renders 5 dynamic date columns', () => {
    const room = {
      guest_name: 'Amitabh Kumar',
      room_number: '105',
      checkin_time: '2026-10-01 10:00:00',
      checkout_time: '2026-10-06 10:00:00',
      voucher_number: 'HCP-103'
    };
    const calc = {
      billableDays: 5,
      grossTariff: 5000,
      roomCharge: 5250
    };
    const settlement = {
      settled_at: '2026-10-06 10:00:00'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    expect(html).toContain('>01/10</th>');
    expect(html).toContain('>02/10</th>');
    expect(html).toContain('>03/10</th>');
    expect(html).toContain('>04/10</th>');
    expect(html).toContain('>05/10</th>');
    expect(html).not.toContain('>06/10</th>');
    expect(html).toContain('5000.00');
  });

  it('Requirement 5: More than 10 days stay chunks into continuing blocks and unlocks page 2 height', () => {
    const room = {
      guest_name: 'Corporate Long Stay',
      room_number: '401',
      checkin_time: '2026-10-01 12:00:00',
      checkout_time: '2026-10-15 11:00:00',
      voucher_number: 'HCP-104'
    };
    const calc = {
      billableDays: 14,
      grossTariff: 14000,
      roomCharge: 14700
    };
    const settlement = {
      settled_at: '2026-10-15 11:00:00'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    // Block 1 (Days 1 to 10)
    expect(html).toContain('(Accommodation) &nbsp;SAC: 996311');
    expect(html).toContain('Total (Days 1-10)');
    expect(html).toContain('>01/10</th>');
    expect(html).toContain('>10/10</th>');

    // Block 2 (Days 11 to 14 - continuing below)
    expect(html).toContain('(Accommodation) &nbsp;SAC: 996311 (Contd.)');
    expect(html).toContain('Total (Days 11-14)');
    expect(html).toContain('>11/10</th>');
    expect(html).toContain('>14/10</th>');

    // Overall summary across all 14 days
    expect(html).toContain('Room Bill Total (All 14 Days)');
    expect(html).toContain('14700.00');

    // Multi-page height unlock
    expect(html).toContain('height: auto; max-height: none;');
  });

  it('Requirement 6: 3-day stay with checkout / today F&B places F&B under today\'s date column (06/10)', () => {
    const room = {
      guest_name: 'MD YAHYA AB WAHID MUNDEWADI',
      room_number: '309',
      checkin_time: '2026-10-03 14:38:00',
      checkout_time: '2026-10-06 14:15:20',
      voucher_number: '261003-622',
      booking_source: 'Walk-in',
      advance_payment: 2259
    };
    const calc = {
      billableDays: 3,
      grossTariff: 9000,
      roomCharge: 9450,
      foodTotal: 378,
      advancePaid: 2259,
      restaurantOrders: [
        {
          id: 1,
          order_number: 'RES-298495',
          subtotal: 360,
          tax: 18,
          total: 378,
          created_at: '2026-10-06 14:14:58'
        }
      ]
    };
    const settlement = {
      settled_at: '2026-10-06 14:15:20',
      checked_out_by: 'emp2',
      cardSurcharge: 1,
      upiTax: 8
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    // 1. All 4 dates (03/10, 04/10, 05/10, 06/10) must appear as columns
    expect(html).toContain('>03/10</th>');
    expect(html).toContain('>04/10</th>');
    expect(html).toContain('>05/10</th>');
    expect(html).toContain('>06/10</th>');

    // 2. Room Tariff (3000 each) under 03/10, 04/10, 05/10 and total 9000
    expect(html).toContain('Room Tariff - (3 Days)');
    expect(html).toContain('9000.00');

    // 3. F&B section with (Food & Beverage) SAC: 996332 and dotted line below it
    expect(html).toContain('(Food &amp; Beverage) &nbsp;SAC: 996332');
    expect(html).toContain('border-bottom: 1px dashed #000;');
    expect(html).toContain('F&amp;B Gross Taxable');
    expect(html).toContain('360.00');
    expect(html).toContain('F&amp;B CGST @ 2.5%');
    expect(html).toContain('9.00');
    expect(html).toContain('F&amp;B SGST @ 2.5%');
    expect(html).toContain('9.00');
    expect(html).toContain('F&amp;B Bill Total');
    expect(html).toContain('378.00');

    // 4. Totals match
    expect(html).toContain('Invoice Total');
    expect(html).toContain('9837.00');
    expect(html).toContain('Gross Payable Amount');
    expect(html).toContain('Advance Received');
    expect(html).toContain('2259.00');
    expect(html).toContain('Net Payable Amount');
    expect(html).toContain('7578.00');
  });

  it('Requirement: Extra hours charge is displayed on checkout day column with taxes and room bill total', () => {
    const room = {
      room_number: '105',
      customer_name: 'VIKRAM MORE',
      checkin_time: '2026-10-03 12:00:00',
      checkout_time: '2026-10-05 15:00:00',
      check_in: '2026-10-03 12:00:00',
      check_out: '2026-10-05 15:00:00',
      room_rate: 2000,
      total_room_charge: 4500, // 2 nights @ 2000 + 500 extension
      extension_hours: 2,
      extension_charge: 500,
      checked_in_by: 'Cashier_1'
    };

    const calc = {
      days: 2,
      billableDays: 2,
      roomCharge: 4500,
      extensionHours: 2,
      extensionCharge: 500,
      grossTariff: 4000,
      discountAmount: 200, // Pre-tax model active
      discountPct: 5,
      roomTariffNet: 3800
    };

    const settlement = {
      checked_out_by: 'emp1'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    // 1. Checkout date (05/10) must appear as a column along with stay dates (03/10, 04/10)
    expect(html).toContain('>03/10</th>');
    expect(html).toContain('>04/10</th>');
    expect(html).toContain('>05/10</th>');

    // 2. Extra hours row header
    expect(html).toContain('Extra Hours Charge (2 Hours)');

    // 3. Extension charge 500 under 05/10 and total
    expect(html).toContain('500.00');

    // 4. Room Bill Total includes the extension on checkout day
    // Extension: 500 pre-tax + 2.5% CGST (12.50) + 2.5% SGST (12.50) = 525.00
    expect(html).toContain('525.00');
  });
});

