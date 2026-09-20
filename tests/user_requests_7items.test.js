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

import {
  buildGuestRegistrationHTML,
  buildGuestPaymentSummaryHTML,
  printGuestPaymentSummary
} from '../src/services/printService';

describe('7 Front Desk & Print Requests Validation', () => {

  const sampleBookingData = {
    voucherNo: '20260919-001',
    checkinFormatted: '19 Sept 2026 12:00 pm',
    guestName: 'Sunil Manohar Gavaskar',
    mobile: '9822100000',
    docType: 'Aadhaar Card',
    idNumber: '9876 5432 1098',
    roomNumber: '201',
    roomType: 'Executive Suite',
    stayNights: 2,
    tariffNet: 6000,
    discountAmount: 500,
    discountPct: 8,
    taxAmount: 275,
    grandTotal: 5775,
    totalPaid: 3000,
    balanceDue: 2775,
    isOta: false,
    splitCash: 1500,
    splitOnline: 1500,
    onlineUtr: '423589123456',
    cashierName: 'Aamir Razvi',
    payments: [
      {
        id: 1,
        receipt_no: '260918-254',
        created_at: '2026-09-18T14:30:00',
        amount: 1500,
        payment_mode: 'cash',
        purpose: 'Advance Check-in Deposit',
        cashier_name: 'Aamir Razvi'
      },
      {
        id: 2,
        receipt_no: '260919-012',
        created_at: '2026-09-19T10:15:00',
        amount: 1500,
        payment_mode: 'online',
        utr_number: '423589123456',
        purpose: 'Mid-stay Advance',
        cashier_name: 'Aamir Razvi'
      }
    ]
  };

  // Requirement 1: Check-in form
  it('1) Check-in form: logo size enlarged by 50% to 108px, top-right box compact, and NO remaining amount shown', () => {
    const html = buildGuestRegistrationHTML(sampleBookingData, { includePhotos: false });
    
    // Logo height increased by 50% to 108px
    expect(html).toContain('height: 108px;');
    expect(html).toContain('/hcp-logo-with-name.png');

    // Top-right box decreased in size and overlapped with main border
    expect(html).toContain('font-size: 8pt;');
    expect(html).toContain('top: -3.5px; right: -3.5px;');

    // "Should not see remaining amount"
    expect(html).not.toContain('Balance Remaining');
    expect(html).not.toContain('Balance Due:');
    expect(html).not.toContain('Payable at Desk');
  });

  // Requirement 2: Payment Summary Statement
  it('2) Payment summary: dedicated A4 statement with all payment details, date/time, modes, and net total', () => {
    const html = buildGuestPaymentSummaryHTML(sampleBookingData);

    expect(html).toContain('PAYMENT SUMMARY STATEMENT');
    expect(html).toContain('HOTEL CityPaark');
    expect(html).toContain('Sunil Manohar Gavaskar');
    expect(html).toContain('Room 201');
    expect(html).toContain('260918-254');
    expect(html).toContain('260919-012');
    expect(html).toContain('Advance Check-in Deposit');
    expect(html).toContain('Mid-stay Advance');
    expect(html).toContain('423589123456'); // UTR
    expect(html).toContain('Aamir Razvi'); // Cashier
    expect(html).toContain('Total Net Amount Settled &amp; Received:');
    expect(html).toContain('₹ 3,000.00');
    expect(html).toContain('Guest Signature');
    expect(html).toContain('For HOTEL CITY PARK');
    expect(typeof printGuestPaymentSummary).toBe('function');
  });

  // Requirement 3: Receipt footer & cashier name
  it('3) Receipt: right bottom has "For HOTEL CITY PARK" (no Partner/Manager) with Cashier Name above line', () => {
    const printServiceCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');

    // Cashier above the signature line
    expect(printServiceCode).toContain('${escapeHtml(cashierName)}');
    expect(printServiceCode).toContain('receipt-cashier-name');
    
    // For HOTEL CITY PARK (clean, with PARK not PAARK, and no Partner / Manager)
    expect(printServiceCode).toContain('For HOTEL CITY PARK</div>');
    expect(printServiceCode).not.toContain('Partner / Manager');
  });

  // Requirement 4 & 5: Petty Cash Voucher numbering starting from PCV-1 & "Original Copy"
  it('4 & 5) Petty cash voucher: numbering starts from PCV-1 and copy label is "Original Copy"', () => {
    const printServiceCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');

    // Label should be ORIGINAL COPY instead of OFFICE COPY
    expect(printServiceCode).toContain("renderVoucherCard('ORIGINAL COPY')");
    expect(printServiceCode).not.toContain("renderVoucherCard('OFFICE COPY')");

    // Starts from PCV-1
    expect(printServiceCode).toContain("voucher.id ? `PCV-${voucher.id}` : 'PCV-1'");
  });

  // Requirement 6: Single line in Particulars / Purpose & Mandatory Cheque/Bank validation
  it('6) Petty cash: only one line in particulars table, and ExpensesPage enforces mandatory Cheque Number & Bank', () => {
    const printServiceCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');
    
    // In printPettyCashVoucher tbody, there must NOT be an empty &nbsp; row
    const voucherTbodyMatch = printServiceCode.match(/<table class="voucher-mini-table">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
    expect(voucherTbodyMatch).not.toBeNull();
    expect(voucherTbodyMatch[1]).not.toContain('&nbsp;');

    // ExpensesPage.jsx validation
    const expensesPageCode = fs.readFileSync(path.resolve(__dirname, '../src/pages/ExpensesPage.jsx'), 'utf-8');
    expect(expensesPageCode).toContain("formMode === 'cheque'");
    expect(expensesPageCode).toContain('Cheque Number is mandatory for Cheque payments.');
    expect(expensesPageCode).toContain('Bank Name is mandatory for Cheque payments.');
  });

  // Requirement 7: Receipt number format 260918-254 and enlarged font size
  it('7) Receipt number format is YYMMDD-XXX (e.g. 260918-254) and font size is enlarged to 14.5pt', () => {
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf-8');
    // server.js formats RCP as YYMMDD
    expect(serverCode).toContain("prefix === 'RCP' ? `${yy}${mm}${dd}` : `${yyyy}${mm}${dd}`");

    const printServiceCode = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');
    // Normalizes 20YYMMDD-XXX to YYMMDD-XXX
    expect(printServiceCode).toContain('replace(/^20(\\d{6}-\\d+)$/, \'$1\')');

    // Stylesheet font size enlarged
    const stylesCode = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCode).toContain('font-size: 14.5pt !important;');
    expect(stylesCode).toContain('font-weight: 950 !important;');
  });
});
