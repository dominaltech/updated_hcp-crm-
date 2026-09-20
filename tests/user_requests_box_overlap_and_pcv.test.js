import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import { buildGuestRegistrationHTML } from '../src/services/printService';

describe('User Requests: Check-in Box Overlap, Expenses Modal CSS, & PCV-1 with UPI UTR', () => {
  const sampleBookingData = {
    voucherNo: '20260919-386',
    checkinFormatted: '19 Sept 2026 01:58 pm',
    guestName: 'AMIR RAZA IRFAN RANGREZ',
    mobile: '6546465465',
    docType: 'Passport',
    idNumber: 'R9570989',
    roomNumber: '101',
    stayStatus: 'Walk-in',
    tariffNet: 2993,
    advanceAmount: 2900,
    grandTotal: 2993,
    payments: []
  };

  it('1. Check-in Top-Right Box borders (top & right) overlap with the main outer border', () => {
    const html = buildGuestRegistrationHTML(sampleBookingData, { includePhotos: false });
    
    // Positioned absolutely at top -3.5px and right -3.5px
    expect(html).toContain('position: absolute; top: -3.5px; right: -3.5px;');
    
    // Top & Right borders match the 3.5px outer border
    expect(html).toContain('border-top: 3.5px solid #1e3a8a;');
    expect(html).toContain('border-right: 3.5px solid #1e3a8a;');
    
    // Content is preserved
    expect(html).toContain('Voucher / Reg No:');
    expect(html).toContain('260919-386');
    expect(html).toContain('Check-in Date:');
  });

  it('2. Petty Cash Voucher Header formats sequence as PCV-1 and label Cash Voucher No.', () => {
    const printServiceCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');
    
    // Heading badge uses Cash Voucher No.
    expect(printServiceCode).toContain('Cash Voucher No. <span class="voucher-no-highlight">');
    
    // Normalizes sequence to PCV-X
    expect(printServiceCode).toContain("voucher.id ? `PCV-${voucher.id}` : 'PCV-1'");
    expect(printServiceCode).toContain("voucherNo = `PCV-${seq}`;");
    expect(printServiceCode).toContain("voucherNo = `PCV-${parseInt(voucherNo, 10)}`;");
  });

  it('3. Petty Cash Voucher Payment Row: Cash does not show Cheque No, UPI shows UTR No, Cheque shows Cheque & Bank', () => {
    const printServiceCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');

    // When cash: displays Payment Mode: CASH and does NOT show Cash / Cheques No. Cash
    expect(printServiceCode).toContain('<span>Payment Mode: <span class="voucher-underlined" style="font-weight: 900; padding: 0 16px;">CASH</span></span>');
    expect(printServiceCode).not.toContain('Cash / Cheques No. <span class="voucher-underlined">${escapeHtml(chqNo)}</span>');

    // When UPI: shows Payment Mode: ONLINE / UPI and UTR No.
    expect(printServiceCode).toContain('<span>Payment Mode: <span class="voucher-underlined" style="font-weight: 850;">ONLINE / UPI</span></span>');
    expect(printServiceCode).toContain('UTR No. <span class="voucher-underlined" style="font-weight: 900;">${escapeHtml(utrNo || \'-\')}</span>');

    // When Cheque: shows Cheque No. and Bank
    expect(printServiceCode).toContain('<span>Cheque No. <span class="voucher-underlined" style="font-weight: 900;">${escapeHtml(chqNo || \'-\')}</span></span>');
    expect(printServiceCode).toContain('Bank <span class="voucher-underlined" style="font-weight: 900;">${escapeHtml(bankName)}</span>');
  });

  it('4. ExpensesPage: Modal has clean CSS (560px max-width, min-width: 0 on grid columns, and UPI UTR field)', () => {
    const expensesPageCode = fs.readFileSync(path.resolve(__dirname, '../src/pages/ExpensesPage.jsx'), 'utf-8');

    // Modal width enlarged
    expect(expensesPageCode).toContain("maxWidth: '560px'");
    
    // Clean payment mode options
    expect(expensesPageCode).toContain('<option value="cash">💵 Cash</option>');
    expect(expensesPageCode).toContain('<option value="cheque">🏦 Cheque</option>');
    expect(expensesPageCode).toContain('<option value="online">📱 UPI / Online</option>');

    // Mandatory UTR validation
    expect(expensesPageCode).toContain("Online UTR Reference Number is mandatory.");
    expect(expensesPageCode).toContain("Online / UPI UTR Reference Number *");
  });

  it('5. server.js getNextPettyCashVoucherNumber returns PCV-1 sequence format', () => {
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf-8');
    expect(serverCode).toContain('return `PCV-${nextSeq}`;');
    expect(serverCode).toContain("return 'PCV-1';");
  });
});
