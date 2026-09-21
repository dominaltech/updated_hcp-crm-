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

import { buildGuestPaymentSummaryHTML } from '../src/services/printService';

describe('Payment Summary Statement Print Template', () => {
  const sampleData = {
    id: 571,
    guest_name: 'Md Yahya Ab Wahid Mundewadi',
    room_numbers: '101',
    room_type: 'Deluxe AC',
    phone: '9028850715',
    voucher_no: '260920-571',
    checkin_time: '2026-09-20T12:41:00',
    approx_checkout_time: '2026-09-22T10:00:00',
    cashier_name: 'Cashier_1',
    payments: [
      {
        id: 596,
        receipt_no: '260920-596',
        created_at: '2026-09-20T12:41:00',
        payment_mode: 'CASH',
        notes: 'Advance payment at check-in for Room 101 (Md Yahya Ab Wahid Mundewadi)',
        cashier_name: 'cap-1',
        amount: 2000
      }
    ]
  };

  it('1. Displays accurate check-in and check-out date & time instead of -', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('20/09/2026, 12:41 pm');
    expect(html).toContain('22/09/2026, 10:00 am');
    // Ensure it does not show plain '-' for Check-In or Check-Out
    expect(html).not.toMatch(/Check-In<\/span>\s*<strong[^>]*>-<\/strong>/);
    expect(html).not.toMatch(/Check-Out<\/span>\s*<strong[^>]*>-<\/strong>/);
  });

  it('2. Replaces # with Sr. No. in table header', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('Sr. No.');
    expect(html).not.toContain('<th style="padding: 7px 6px; text-align: center; width: 5%;">#</th>');
  });

  it('3. Renders single-line particulars without guest name as "paid while checkin : checkin"', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('paid while checkin : checkin');
    expect(html).not.toContain('Advance payment at check-in for Room 101 (Md Yahya Ab Wahid Mundewadi)');
  });

  it('4. Renders a complete table grid with cell borders for all columns', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('ITEMIZED PAYMENTS &amp; SETTLEMENT LOG');
    expect(html).toContain('border: 1px solid #94a3b8;'); // Table header cell borders
    expect(html).toContain('border: 1px solid #cbd5e1;'); // Data cell borders
    expect(html).toContain('Total Net Amount Settled &amp; Received:');
    expect(html).toContain('₹ 2,000.00');
  });
});
