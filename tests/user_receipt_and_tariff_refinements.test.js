import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

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

import { buildMoneyReceiptHTML } from '../src/services/printService';

describe('User Advance Money Receipt & Tariff Touch/Edit Refinements', () => {

  it('1) Base Tariff in Step6Stay displays Standard Base Tariff', () => {
    const step6Code = fs.readFileSync(path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf-8');
    expect(step6Code).toContain('Standard Base Tariff');
  });

  it('2) Date is cleanly displayed and NOT inside a box', () => {
    const receipt = {
      receipt_no: 'CR01',
      voucher_number: '260926-601',
      receipt_date: '2026-09-26T14:57:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 1000,
      base_amount: 1000,
      payment_mode: 'Cash',
      mode: 'cash',
      room_numbers: '101',
      particulars: 'Room 101 - Check-In Advance Payment (Cash)'
    };

    const html = buildMoneyReceiptHTML(receipt);

    // Date must be present
    expect(html).toContain('Date:');
    expect(html).toContain('26/09/2026 - 02:57 pm');

    // CSS must have removed the box border and background from .receipt-date-highlight
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCss).toContain('.receipt-date-highlight {');
    expect(stylesCss).toMatch(/\.receipt-date-highlight\s*\{[^}]*border:\s*none\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-date-highlight\s*\{[^}]*background-color:\s*transparent\s*!important/);
  });

  it('3) "Voucher No:" is on a single line (no wrap) and voucher number is in bold font', () => {
    const receipt = {
      receipt_no: 'CR01',
      voucher_number: '260926-601',
      receipt_date: '2026-09-26T14:57:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 1000,
      base_amount: 1000,
      payment_mode: 'Cash',
      mode: 'cash',
      room_numbers: '101',
      particulars: 'Room 101 - Check-In Advance Payment (Cash)'
    };

    const html = buildMoneyReceiptHTML(receipt);

    // Bill No / Voucher No label has white-space: nowrap to prevent wrap
    expect(html).toMatch(/white-space:\s*nowrap;">(Bill No:|Voucher No:)<\/span>/);
    // Voucher number 260926-601 is in bold font-weight: 950
    expect(html).toContain('font-weight: 950');
    expect(html).toContain('260926-601');
  });

  it('4) Copy tags are "ORIGINAL" and "HOTEL COPY" below "RECEIPT" in little font without a box', () => {
    const receipt = {
      receipt_no: 'CR01',
      voucher_number: '260926-601',
      receipt_date: '2026-09-26T14:57:00',
      guest_name: 'Md Yahya Ab Wahid Mundewadi',
      amount: 1000,
      payment_mode: 'Cash',
      mode: 'cash',
      room_numbers: '101'
    };

    const html = buildMoneyReceiptHTML(receipt);

    // Must have ORIGINAL and HOTEL COPY
    expect(html).toContain('>ORIGINAL</div>');
    expect(html).toContain('>HOTEL COPY</div>');

    // Must NOT have old wording "ORIGINAL (GUEST COPY)"
    expect(html).not.toContain('ORIGINAL (GUEST COPY)');
    expect(html).not.toContain('HOTEL ACCOUNTS COPY');

    // In CSS, .receipt-copy-tag must have border: none and background: transparent
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCss).toMatch(/\.receipt-copy-tag\s*\{[^}]*border:\s*none\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-copy-tag\s*\{[^}]*background:\s*transparent\s*!important/);
  });

  it('5) City Paark logo size is enlarged in the receipt header', () => {
    const receipt = {
      receipt_no: 'CR01',
      voucher_number: '260926-601',
      payment_mode: 'Cash'
    };

    const html = buildMoneyReceiptHTML(receipt);
    expect(html).toContain('height: 74px;');
    expect(html).toContain('max-height: 80px;');

    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCss).toMatch(/\.receipt-brand-logo-img\s*\{[^}]*height:\s*74px\s*!important/);
  });

  it('6) Table uses both rows: Top row has "Paid for Check In", second row has Mode and UPI UTR', () => {
    // UPI Case
    const upiReceipt = {
      receipt_no: 'UPI01',
      voucher_number: '260926-601',
      payment_mode: 'Online UPI',
      mode: 'upi',
      amount: 1000,
      base_amount: 1000,
      utr_number: '654654654654',
      particulars: 'Room 101 - Check-In Advance Payment (UPI)'
    };

    const upiHtml = buildMoneyReceiptHTML(upiReceipt);

    // Row 1: Room 101 - Paid for Check In
    expect(upiHtml).toContain('Room 101 - Paid for Check In</div>');
    // Row 2: Payment Mode: Online UPI (UTR: 654654654654)
    expect(upiHtml).toContain('Payment Mode: Online UPI (UTR: 654654654654)</div>');

    // Cash Case
    const cashReceipt = {
      receipt_no: 'CR01',
      voucher_number: '260926-601',
      payment_mode: 'Cash',
      mode: 'cash',
      amount: 1000,
      base_amount: 1000,
      particulars: 'Room 101 - Check-In Advance Payment (Cash)'
    };

    const cashHtml = buildMoneyReceiptHTML(cashReceipt);
    expect(cashHtml).toContain('Room 101 - Paid for Check In</div>');
    expect(cashHtml).toContain('Payment Mode: Cash</div>');
  });

  it('7) Body text and table text font sizes are enlarged to 12.5pt / 12pt', () => {
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');

    expect(stylesCss).toMatch(/\.receipt-line-row\s*\{[^}]*font-size:\s*12\.5pt\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-lbl\s*\{[^}]*font-size:\s*12\.5pt\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-fill-line\s*\{[^}]*font-size:\s*12\.5pt\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-mini-table\s*\{[^}]*font-size:\s*12pt\s*!important/);
    expect(stylesCss).toMatch(/\.receipt-mini-table\s+th\s*\{[^}]*font-size:\s*12\.5pt\s*!important/);
  });

  it('8) "by Online UPI ₹ 1,000.00" does NOT contain UTR ID (avoiding clutter in line 3)', () => {
    const upiReceipt = {
      receipt_no: 'UPI01',
      voucher_number: '260926-601',
      payment_mode: 'Online UPI',
      mode: 'upi',
      amount: 1000,
      base_amount: 1000,
      utr_number: '654654654654',
      particulars: 'Room 101 - Check-In Advance Payment (UPI)'
    };

    const html = buildMoneyReceiptHTML(upiReceipt);

    // Line 3 dynamicModeValue must be clean ₹ 1,000.00 without UTR
    expect(html).toContain('by Online UPI</span>');
    // Ensure line 3 does NOT have [UTR: 654654654654]
    const line3Slice = html.slice(html.indexOf('by Online UPI'), html.indexOf('Room No.'));
    expect(line3Slice).not.toContain('UTR');
    expect(line3Slice).toContain('₹ 1,000.00');
  });

  it('9) Card height and sheet max-height use full A4 height without bottom blank space and with perforation gap', () => {
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCss).toMatch(/\.half-a4-receipt-card\s*\{[^}]*height:\s*136mm\s*!important/);
    expect(stylesCss).toMatch(/#print-money-receipt-sheet\.print-active[^{]*\{[^}]*max-height:\s*288mm\s*!important/);
    expect(stylesCss).toMatch(/\.two-per-a4-perforation\s*\{[^}]*height:\s*10mm\s*!important/);
    expect(stylesCss).toMatch(/@page\s*\{[^}]*margin:\s*4mm\s*6mm\s*4mm\s*6mm\s*!important/);
  });

  it('10) Middle divider is a pure dotted line with NO scissors or text icon and equal distance above and below', () => {
    const receipt = {
      receipt_no: 'CR01',
      voucher_number: '260926-601',
      payment_mode: 'Cash',
      amount: 1000
    };
    const html = buildMoneyReceiptHTML(receipt);

    // No scissors icon or PERFORATION CUT LINE text in middle
    expect(html).not.toContain('✂');
    expect(html).not.toContain('PERFORATION CUT LINE');

    // Clean dotted line element with centered equal distance
    expect(html).toContain('class="perforation-dotted-line"');
    expect(html).toContain('border-top: 1.5px dotted #000000');

    // Equal vertical margin and centering in .two-per-a4-perforation
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');
    expect(stylesCss).toMatch(/\.two-per-a4-perforation\s*\{[^}]*display:\s*flex\s*!important/);
    expect(stylesCss).toMatch(/\.two-per-a4-perforation\s*\{[^}]*align-items:\s*center\s*!important/);
    expect(stylesCss).toMatch(/\.two-per-a4-perforation\s*\{[^}]*margin:\s*3\.5mm\s*0\s*!important/);
  });
});



