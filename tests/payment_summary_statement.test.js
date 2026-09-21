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

  it('2. Replaces Sr. No. with No. and Payment Mode & Details with Mode', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('>No.</th>');
    expect(html).toContain('>Mode</th>');
    expect(html).not.toContain('Sr. No.');
    expect(html).not.toContain('Payment Mode &amp; Details');
  });

  it('3. Renders single-line particulars without guest name as "paid while checkin : checkin"', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('paid while checkin : checkin');
    expect(html).not.toContain('Advance payment at check-in for Room 101 (Md Yahya Ab Wahid Mundewadi)');
  });

  it('4. Renders a complete table grid with bold 1.5px/2px borders for all columns and removes computer disclaimer', () => {
    const html = buildGuestPaymentSummaryHTML(sampleData);
    expect(html).toContain('ITEMIZED PAYMENTS &amp; SETTLEMENT LOG');
    expect(html).toContain('border: 1.5px solid #64748b;'); // Table header cell borders
    expect(html).toContain('border: 1.5px solid #94a3b8;'); // Data cell borders
    expect(html).toContain('border: 2px solid #166534;'); // Footer total borders
    expect(html).toContain('Total Net Amount Settled &amp; Received:');
    expect(html).toContain('₹ 2,000.00');

    // Verify disclaimer is removed
    expect(html).not.toContain('This is an official computer-generated statement');
  });
});
