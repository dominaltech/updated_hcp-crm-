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

import { buildMoneyReceiptHTML, normalizeReceiptData } from '../src/services/printService';
import fs from 'fs';
import path from 'path';

describe('Receipt Amount Match, Base/Card Charge/Entire Breakdown & Overlap Fixes', () => {
  it('1) Booking #3 POS03 (amount: 666, surcharge: 16, split_card: 650) matches History Table amount and shows base, card charge, and entire', () => {
    const payment = {
      id: 16,
      receipt_no: 'POS03',
      booking_id: 3,
      payment_type: 'bill_settlement',
      payment_mode: 'card',
      amount: 666,
      card_surcharge: 16,
      split_card: 650,
      room_numbers: '101',
      voucher_number: '260929-602',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      created_at: '2026-09-30 09:34:40',
      cashier_name: 'Jaijeet sir'
    };

    const normalized = normalizeReceiptData(payment);
    expect(normalized.amount).toBe(666);
    expect(normalized.base_amount).toBe(650);
    expect(normalized.card_surcharge).toBe(16);

    const html = buildMoneyReceiptHTML(payment);

    // History table shows 666, receipt must show 666.00 (NOT 683.00)
    expect(html).toContain('₹ 666.00');
    expect(html).not.toContain('683');
    expect(html).not.toContain('682');

    // Words must be Six Hundred and Sixty Six
    expect(html).toContain('Six Hundred and Sixty Six Rupees Only');

    // Line 3 dynamicModeValue must be single line without wrapping or overlap
    expect(html).toContain('by Card POS');
    expect(html).toContain('₹ 666.00');
    expect(html).not.toContain('(+₹16 Fee)');

    // Table must show Base Amount, Card Charge, then Entire Amount
    expect(html).toContain('(Base Amount)');
    expect(html).toContain('₹ 650.00');
    expect(html).toContain('(Card Charge)');
    expect(html).toContain('₹ 16.00');
    expect(html).toContain('(Entire Amount)');
    expect(html).toContain('₹ 666.00');
  });

  it('2) When caller passes amount: 666, base_amount: 650, card_surcharge: 16, it resolves base to 650 and total to 666', () => {
    const paymentCall = {
      receipt_no: 'POS03',
      voucher_number: '260929-602',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 666,
      base_amount: 650,
      card_surcharge: 16,
      payment_mode: 'card',
      room_numbers: '101'
    };

    const normalized = normalizeReceiptData(paymentCall);
    expect(normalized.amount).toBe(666);
    expect(normalized.base_amount).toBe(650);
    expect(normalized.card_surcharge).toBe(16);

    const html = buildMoneyReceiptHTML(paymentCall);
    expect(html).toContain('₹ 666.00');
    expect(html).not.toContain('683');
    expect(html).not.toContain('682');
  });

  it('3) .receipt-fill-line CSS in styles.css contains white-space: nowrap !important to prevent multi-line collision', () => {
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCss).toMatch(/\.receipt-fill-line\s*\{[^}]*white-space:\s*nowrap\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-fill-line\s*\{[^}]*overflow:\s*hidden\s*!important/);
  });
});
