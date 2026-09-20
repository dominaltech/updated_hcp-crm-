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

import {
  formatReceiptNumberWithMode,
  formatReceiptDateTime,
  buildMoneyReceiptHTML
} from '../src/services/printService';

describe('User Receipt Enhancements (Logo 50%, Mode-Prefixed No, Stacked Date-Time, Dynamic Payment Line, Fees)', () => {

  it('1) formatReceiptNumberWithMode should prepend payment mode prefix (CR, UPI, POS, CHQ)', () => {
    expect(formatReceiptNumberWithMode('260920-596', 'cash')).toBe('CR260920-596');
    expect(formatReceiptNumberWithMode('260920-596', 'Cash')).toBe('CR260920-596');
    expect(formatReceiptNumberWithMode('260920-596', 'upi')).toBe('UPI260920-596');
    expect(formatReceiptNumberWithMode('260920-596', 'online')).toBe('UPI260920-596');
    expect(formatReceiptNumberWithMode('260920-596', 'card')).toBe('POS260920-596');
    expect(formatReceiptNumberWithMode('260920-596', 'POS')).toBe('POS260920-596');
    expect(formatReceiptNumberWithMode('260920-596', 'cheque')).toBe('CHQ260920-596');
    expect(formatReceiptNumberWithMode('20260920-596', 'cash')).toBe('CR260920-596');
    expect(formatReceiptNumberWithMode('CR260920-596', 'cash')).toBe('CR260920-596');
    expect(formatReceiptNumberWithMode('RCP-260920-596', 'upi')).toBe('UPI260920-596');
  });

  it('2) formatReceiptDateTime formats date and time as DD/MM/YYYY - hh:mm a', () => {
    const fixedDate = new Date(2026, 8, 18, 23, 56); // 18 Sept 2026, 23:56
    const formatted = formatReceiptDateTime(fixedDate);
    expect(formatted).toBe('18/09/2026 - 11:56 pm');
  });

  it('3) Cash Receipt: shows CR260920-596, Date below No, enlarged logo, single line by Cash (no Cash / Cheque), and website .com', () => {
    const cashReceipt = {
      receipt_no: '260920-596',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 2000,
      payment_mode: 'Cash',
      room_numbers: '101',
      particulars: 'Room #101 - Advance Stay Payment',
      cashier_name: 'Aamir'
    };

    const html = buildMoneyReceiptHTML(cashReceipt);

    // Mode-prefixed receipt number
    expect(html).toContain('CR260920-596');

    // Date placed with time
    expect(html).toContain('18/09/2026 - 11:56 pm');

    // Date stacked under No (check order of occurrence)
    const posNo = html.indexOf('CR260920-596');
    const posDate = html.indexOf('18/09/2026 - 11:56 pm');
    expect(posNo).toBeGreaterThan(-1);
    expect(posDate).toBeGreaterThan(posNo);

    // Top-right Logo size enlarged by 50% (height: 54px, max-width: 195px)
    expect(html).toContain('height: 54px;');
    expect(html).toContain('max-width: 195px;');

    // Correct Website and phone
    expect(html).toContain('website : hotelcityparksolapur.com');
    expect(html).not.toContain('hotelcityparksolapur.org');
    expect(html).toContain('0217-2729791, 92, 93');

    // Dynamic payment mode: "by Cash" NOT "by Cash / Cheque"
    expect(html).toContain('by Cash');
    expect(html).not.toContain('by Cash / Cheque');
    expect(html).toContain('₹ 2,000.00');

    // Table and Rs box: strictly "Room 101" without hash symbol '#'
    expect(html).toContain('Room 101 - Advance Stay Payment (Cash Payment)');
    expect(html).not.toContain('Room #101');
    expect(html).toContain('Two Thousand Rupees Only');
    expect(html).toContain('₹ 2,000.00');

    // Cashier name above For HOTEL CITY PARK: Name of cashier instead of "Front Desk Cashier"
    expect(html).toContain('Aamir');
    expect(html).not.toContain('Front Desk Cashier');
  });

  it('4) UPI Receipt: shows UPI260920-596, dynamic by Online UPI with UTR ID, fee inclusive amount and words', () => {
    const upiReceipt = {
      receipt_no: '260920-596',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 2000,
      base_amount: 2000,
      upi_tax: 10,
      utr_number: 'UTR-9876543210',
      payment_mode: 'UPI',
      room_numbers: '101',
      particulars: 'Room #101 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(upiReceipt);

    // Mode-prefixed receipt number
    expect(html).toContain('UPI260920-596');

    // Dynamic payment mode: "by Online UPI"
    expect(html).toContain('by Online UPI');
    expect(html).not.toContain('by Cash / Cheque');

    // Amount with fee (2000 + 10 = 2010) and UTR ID
    expect(html).toContain('₹ 2,010.00 (₹2,000 + ₹10 Fee) [UTR: UTR-9876543210]');

    // Table row with fee and UTR
    expect(html).toContain('Online UPI: ₹2,010 [₹2,000 + ₹10 Fee] - UTR: UTR-9876543210');

    // Total in words with fee
    expect(html).toContain('Two Thousand and Ten Rupees Only');

    // Rs box with fee
    expect(html).toContain('₹ 2,010.00');
  });

  it('5) Card POS Receipt: shows POS260920-596, dynamic by Card POS with fee inclusive amount and words', () => {
    const cardReceipt = {
      receipt_no: '260920-596',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 2000,
      base_amount: 2000,
      card_surcharge: 50,
      payment_mode: 'Card',
      room_numbers: '101',
      particulars: 'Room #101 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(cardReceipt);

    // Mode-prefixed receipt number
    expect(html).toContain('POS260920-596');

    // Dynamic payment mode: "by Card POS"
    expect(html).toContain('by Card POS');
    expect(html).not.toContain('by Cash / Cheque');

    // Amount with fee (2000 + 50 = 2050)
    expect(html).toContain('₹ 2,050.00 (₹2,000 + ₹50 Fee)');

    // Table row with fee
    expect(html).toContain('Card POS: ₹2,050 [₹2,000 + ₹50 Fee]');

    // Total in words with fee
    expect(html).toContain('Two Thousand and Fifty Rupees Only');

    // Rs box with fee
    expect(html).toContain('₹ 2,050.00');
  });

  it('6) Cheque Receipt: shows CHQ260920-596, dynamic by Cheque with cheque number and bank name', () => {
    const chequeReceipt = {
      receipt_no: '260920-596',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 2000,
      cheque_no: 'CHQ-889900',
      bank_name: 'State Bank of India',
      payment_mode: 'Cheque',
      room_numbers: '101',
      particulars: 'Room #101 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(chequeReceipt);

    // Mode-prefixed receipt number
    expect(html).toContain('CHQ260920-596');

    // Dynamic payment mode: "by Cheque"
    expect(html).toContain('by Cheque');
    expect(html).not.toContain('by Cash / Cheque');

    // Cheque details
    expect(html).toContain('Cheque No: CHQ-889900 (State Bank of India)');
  });
});
