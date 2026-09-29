import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn(),
        outputPdf: vi.fn()
      })
    })
  })
}));

import {
  formatReceiptNumberWithMode,
  buildMoneyReceiptHTML,
  normalizeReceiptData
} from '../src/services/printService';
import { cleanVoucherNumber } from '../src/utils/formatters';

describe('User Requirement: Serial-only Receipt Number (UPI04, CR01) & Voucher No Display', () => {

  it('1) formatReceiptNumberWithMode formats serial-only number without date component', () => {
    // Exact user case: 'UPI260926-004' -> 'UPI04'
    expect(formatReceiptNumberWithMode('UPI260926-004', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('260926-004', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('260926-004', 'cash')).toBe('CR04');
    expect(formatReceiptNumberWithMode('260926-004', 'card')).toBe('POS04');
    expect(formatReceiptNumberWithMode('260926-004', 'cheque')).toBe('CHQ04');
    expect(formatReceiptNumberWithMode('260926-004', 'btc')).toBe('BTC04');

    // Single digits pad to 2 digits
    expect(formatReceiptNumberWithMode('1', 'cash')).toBe('CR01');
    expect(formatReceiptNumberWithMode('4', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode(2, 'card')).toBe('POS02');
    expect(formatReceiptNumberWithMode(1, 'cheque')).toBe('CHQ01');

    // Checkin registration voucher format '260926-24'
    expect(formatReceiptNumberWithMode('260926-24', 'upi')).toBe('UPI24');
    expect(formatReceiptNumberWithMode('260926-24', 'cash')).toBe('CR24');
    expect(formatReceiptNumberWithMode('260926-24', 'card')).toBe('POS24');
  });

  it('2) cleanVoucherNumber cleanly extracts voucher number like 260926-24 from prefixes and centuries', () => {
    expect(cleanVoucherNumber('260926-24')).toBe('260926-24');
    expect(cleanVoucherNumber('20260926-24')).toBe('260926-24');
    expect(cleanVoucherNumber('REG-260926-24')).toBe('260926-24');
    expect(cleanVoucherNumber('REG260926-24')).toBe('260926-24');
    expect(cleanVoucherNumber('UPI260926-004')).toBe('260926-004');
    expect(cleanVoucherNumber('CR260926-004')).toBe('260926-004');
  });

  it('3) Receipt HTML shows pure serial in No. box and key:value Voucher No in both copies', () => {
    const receipt = {
      receipt_no: 'UPI260926-004',
      voucher_number: '260926-24',
      receipt_date: '2026-09-26T05:22:00',
      guest_name: 'AMIR RAZA IRFAN RANGREZ',
      amount: 1000,
      base_amount: 1000,
      payment_mode: 'Online UPI',
      mode: 'upi',
      utr_number: '321321321321',
      room_numbers: '104',
      particulars: 'Room 104 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(receipt);

    // 1. Receipt serial number box (No.) must be strictly UPI04, NOT UPI260926-004
    expect(html).toContain('No.');
    expect(html).toContain('<span class="receipt-no-highlight">UPI04</span>');
    expect(html).not.toContain('UPI260926-004');

    // 2. Key:Value Voucher No prominently displayed in header
    expect(html).toContain('Voucher No:');
    expect(html).toContain('260926-24');

    // 3. Both Original and Hotel Copy contain the voucher and serial No.
    expect(html).toContain('ORIGINAL');
    expect(html).toContain('HOTEL COPY');

    // Count occurrences: exactly 1 of each copy label for 2-per-A4 receipt
    const guestCopyMatches = html.match(/>ORIGINAL</g);
    expect(guestCopyMatches?.length).toBe(1);
    const accountsCopyMatches = html.match(/>HOTEL COPY</g);
    expect(accountsCopyMatches?.length).toBe(1);

    // Voucher No rendered in both receipt cards
    const voucherMatches = html.match(/Voucher No:/g);
    expect(voucherMatches?.length).toBeGreaterThanOrEqual(2);

    // Row 1: Paid while checking / living / checkout
    expect(html).toContain('Room 104 - Paid while checking');
    // Row 2: Mode & UPI UTR
    expect(html).toContain('Payment Mode: Online UPI (UTR: 321321321321)');
    expect(html).not.toContain('(Cash Payment)');
  });

  it('4) If receipt_no was legacy date-based and voucher_number was not passed, it recovers the voucher for display', () => {
    const legacyReceipt = {
      receipt_no: 'UPI260926-004',
      // voucher_number not passed
      receipt_date: '2026-09-26T05:22:00',
      guest_name: 'AMIR RAZA IRFAN RANGREZ',
      amount: 1000,
      base_amount: 1000,
      payment_mode: 'Online UPI',
      mode: 'upi',
      utr_number: '321321321321',
      room_numbers: '104',
      particulars: 'Room 104 - Advance Stay Payment'
    };

    const html = buildMoneyReceiptHTML(legacyReceipt);

    // Recovers serial No UPI04
    expect(html).toContain('<span class="receipt-no-highlight">UPI04</span>');
    // Extracts voucher 260926-004 from receipt_no
    expect(html).toContain('Voucher No:');
    expect(html).toContain('260926-004');
  });

  it('5) normalizeReceiptData preserves voucher_number across different alias properties', () => {
    const norm1 = normalizeReceiptData({
      voucher_number: '260926-24',
      amount: 1500,
      payment_mode: 'Cash'
    });
    expect(norm1.voucher_number).toBe('260926-24');

    const norm2 = normalizeReceiptData({
      voucherNumber: '260926-25',
      amount: 1500,
      payment_mode: 'Cash'
    });
    expect(norm2.voucher_number).toBe('260926-25');

    const norm3 = normalizeReceiptData({
      checkin_voucher_no: '260926-26',
      amount: 1500,
      payment_mode: 'Cash'
    });
    expect(norm3.voucher_number).toBe('260926-26');
  });

});
