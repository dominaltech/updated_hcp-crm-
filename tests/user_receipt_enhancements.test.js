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

  it('1) formatReceiptNumberWithMode should strictly output mode-prefixed serial numbers without date (CR01, UPI04, POS02)', () => {
    expect(formatReceiptNumberWithMode('UPI260926-004', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('260926-004', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('260926-004', 'cash')).toBe('CR04');
    expect(formatReceiptNumberWithMode('260926-004', 'card')).toBe('POS04');
    expect(formatReceiptNumberWithMode('260926-24', 'upi')).toBe('UPI24');
    expect(formatReceiptNumberWithMode('260926-24', 'cash')).toBe('CR24');
    expect(formatReceiptNumberWithMode('260920-596', 'cash')).toBe('CR596');
    expect(formatReceiptNumberWithMode('260920-596', 'Cash')).toBe('CR596');
    expect(formatReceiptNumberWithMode('260920-596', 'upi')).toBe('UPI596');
    expect(formatReceiptNumberWithMode('260920-596', 'online')).toBe('UPI596');
    expect(formatReceiptNumberWithMode('260920-596', 'card')).toBe('POS596');
    expect(formatReceiptNumberWithMode('260920-596', 'POS')).toBe('POS596');
    expect(formatReceiptNumberWithMode('260920-596', 'cheque')).toBe('CHQ596');
    expect(formatReceiptNumberWithMode('20260920-596', 'cash')).toBe('CR596');
    expect(formatReceiptNumberWithMode('CR01', 'cash')).toBe('CR01');
    expect(formatReceiptNumberWithMode('UPI04', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('POS02', 'card')).toBe('POS02');
    expect(formatReceiptNumberWithMode('CHQ01', 'cheque')).toBe('CHQ01');
    expect(formatReceiptNumberWithMode(1, 'cash')).toBe('CR01');
    expect(formatReceiptNumberWithMode(4, 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('RCP-5', 'cash')).toBe('CR05');
  });

  it('2) formatReceiptDateTime formats date and time as DD/MM/YYYY - hh:mm a', () => {
    const fixedDate = new Date(2026, 8, 18, 23, 56); // 18 Sept 2026, 23:56
    const formatted = formatReceiptDateTime(fixedDate);
    expect(formatted).toBe('18/09/2026 - 11:56 pm');
  });

  it('3) Cash Receipt: shows pure serial CR596, Voucher No: 260920-596, Date below No, enlarged logo, single line by Cash, and website .com', () => {
    const cashReceipt = {
      receipt_no: '260920-596',
      voucher_number: '260920-596',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 2000,
      payment_mode: 'Cash',
      room_numbers: '101',
      particulars: 'Room #101 - Advance Stay Payment',
      cashier_name: 'Aamir'
    };

    const html = buildMoneyReceiptHTML(cashReceipt);

    // Mode-prefixed pure serial receipt number (no date in No.)
    expect(html).toContain('CR596');

    // Prominent Voucher No display
    expect(html).toContain('Voucher No:');
    expect(html).toContain('260920-596');

    // Date placed with time
    expect(html).toContain('18/09/2026 - 11:56 pm');

    // Date stacked under No (check order of occurrence)
    const posNo = html.indexOf('CR596');
    const posDate = html.indexOf('18/09/2026 - 11:56 pm');
    expect(posNo).toBeGreaterThan(-1);
    expect(posDate).toBeGreaterThan(posNo);

    // Brand Logo size enlarged (height: 74px, max-width: 220px)
    expect(html).toContain('height: 74px;');
    expect(html).toContain('max-width: 220px;');

    // Correct Website and phone
    expect(html).toContain('website : hotelcityparksolapur.com');
    expect(html).not.toContain('hotelcityparksolapur.org');
    expect(html).toContain('0217-2729791, 92, 93');

    // Dynamic payment mode: "by Cash" NOT "by Cash / Cheque"
    expect(html).toContain('by Cash');
    expect(html).not.toContain('by Cash / Cheque');
    expect(html).toContain('₹ 2,000.00');

    // Table: Row 1 = Paid while checking, Row 2 = Payment Mode: Cash
    expect(html).toContain('Room 101 - Paid while checking');
    expect(html).toContain('Payment Mode: Cash');
    expect(html).not.toContain('Room #101');
    expect(html).toContain('Two Thousand Rupees Only');
    expect(html).toContain('₹ 2,000.00');

    // Cashier name above For HOTEL CITY PARK: Name of cashier instead of "Front Desk Cashier"
    expect(html).toContain('Aamir');
    expect(html).not.toContain('Front Desk Cashier');
  });

  it('4) UPI Receipt: shows pure serial UPI04, Voucher No: 260926-24, dynamic by Online UPI without UTR on line 3, fee inclusive amount and words', () => {
    const upiReceipt = {
      receipt_no: 'UPI04',
      voucher_number: '260926-24',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'AMIR RAZA IRFAN RANGREZ',
      amount: 2000,
      base_amount: 2000,
      upi_tax: 10,
      utr_number: 'UTR-9876543210',
      payment_mode: 'UPI',
      room_numbers: '104',
      particulars: 'Room #104 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(upiReceipt);

    // Mode-prefixed pure serial receipt number
    expect(html).toContain('UPI04');
    expect(html).not.toContain('UPI260926-004');

    // Prominent Voucher No display
    expect(html).toContain('Voucher No:');
    expect(html).toContain('260926-24');

    // Dynamic payment mode: "by Online UPI"
    expect(html).toContain('by Online UPI');
    expect(html).not.toContain('by Cash / Cheque');

    // Amount with fee (2000 + 10 = 2010), no UTR clutter on line 3
    expect(html).toContain('₹ 2,010.00');
    const line3Slice = html.slice(html.indexOf('by Online UPI'), html.indexOf('Room No.'));
    expect(line3Slice).not.toContain('UTR');

    // Table rows: Row 1 = Paid while checking, Row 2 = Payment Mode: Online UPI (UTR: ...)
    expect(html).toContain('Room 104 - Paid while checking');
    expect(html).toContain('Payment Mode: Online UPI (UTR: UTR-9876543210)');
    expect(html).not.toContain('(Cash Payment)');

    // Total in words with fee
    expect(html).toContain('Two Thousand and Ten Rupees Only');

    // Rs box with fee
    expect(html).toContain('₹ 2,010.00');
  });

  it('5) Card POS Receipt: shows pure serial POS02, Voucher No: 260926-24, dynamic by Card POS with fee inclusive amount and words', () => {
    const cardReceipt = {
      receipt_no: 'POS02',
      voucher_number: '260926-24',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'AMIR RAZA IRFAN RANGREZ',
      amount: 2000,
      base_amount: 2000,
      card_surcharge: 50,
      payment_mode: 'Card',
      room_numbers: '104',
      particulars: 'Room #104 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(cardReceipt);

    // Mode-prefixed pure serial receipt number
    expect(html).toContain('POS02');

    // Prominent Voucher No display
    expect(html).toContain('Voucher No:');
    expect(html).toContain('260926-24');

    // Dynamic payment mode: "by Card POS"
    expect(html).toContain('by Card POS');
    expect(html).not.toContain('by Cash / Cheque');

    // Amount with fee (2000 + 50 = 2050)
    expect(html).toContain('₹ 2,050.00');

    // Table row with fee (Card POS, not Cash Payment!)
    expect(html).toContain('Room 104 - Paid while checking');
    expect(html).toContain('Payment Mode: Card POS [Fee: ₹50]');
    expect(html).not.toContain('(Cash Payment)');

    // Total in words with fee
    expect(html).toContain('Two Thousand and Fifty Rupees Only');

    // Rs box with fee
    expect(html).toContain('₹ 2,050.00');
  });

  it('6) Cheque Receipt: shows pure serial CHQ01, Voucher No: 260926-24, dynamic by Cheque with cheque number and bank name', () => {
    const chequeReceipt = {
      receipt_no: 'CHQ01',
      voucher_number: '260926-24',
      receipt_date: '2026-09-18T23:56:00',
      guest_name: 'AMIR RAZA IRFAN RANGREZ',
      amount: 2000,
      cheque_no: 'CHQ-889900',
      bank_name: 'State Bank of India',
      payment_mode: 'Cheque',
      room_numbers: '104',
      particulars: 'Room #104 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(chequeReceipt);

    // Mode-prefixed pure serial receipt number
    expect(html).toContain('CHQ01');

    // Prominent Voucher No display
    expect(html).toContain('Voucher No:');
    expect(html).toContain('260926-24');

    // Dynamic payment mode: "by Cheque"
    expect(html).toContain('by Cheque');
    expect(html).not.toContain('by Cash / Cheque');

    // Cheque details in Row 2
    expect(html).toContain('Room 104 - Paid while checking');
    expect(html).toContain('Payment Mode: Cheque (#CHQ-889900 - State Bank of India)');
  });
});
