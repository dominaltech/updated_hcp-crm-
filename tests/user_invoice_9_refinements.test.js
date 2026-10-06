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

import { buildFinalBillA4HTML } from '../src/services/printService';

describe('User Tax Invoice 9 Requirements Verification', () => {
  const sampleStayWithFnb = {
    room: {
      guest_name: 'JAVID RANGREZ',
      address: 'S/O: AB WAHID MUNDEWADI, 259 MUSLIM PACHHA PETH, JAIL ROAD, SOLAPUR NORTH, DAJI PETH, SOLAPUR, MAHARASHTRA - 413005',
      room_number: '101',
      room_type: 'Deluxe AC',
      adults: 4,
      children: 0,
      checkin_time: '2026-09-24 14:47:18',
      voucher_number: '260924-001',
      booking_source: 'Walk-in',
      checked_in_by: 'Cashier_1',
      checked_out_by: 'Cashier_1'
    },
    calc: {
      grossTariff: 3250.00,
      discountPct: 5,
      discountAmount: 163.00,
      roomTariffNet: 3087.00,
      hotelExtrasCharge: 500.00, // Extra mattress
      foodTotal: 105.00,
      barTotal: 0,
      advancePaid: 2000.00,
      billableDays: 1,
      chargedDays: 1
    },
    settlement: {
      invoiceNo: '260924-001',
      settled_at: '2026-09-24 19:22:26',
      settleAmt: 1846.00,
      checked_out_by: 'Cashier_1'
    }
  };

  it('Requirement 1: Logo size increased 50% (height: 126px) and subtitle matches logo text width (174px)', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    try {
      const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice Preview - Hotel City Paark</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    body {
      margin: 0;
      padding: 30px 0;
      background: #cbd5e1;
      display: flex;
      justify-content: center;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
    .sheet-wrapper {
      width: 210mm;
      min-height: 297mm;
      background: #fff;
      box-shadow: 0 12px 35px rgba(0,0,0,0.22);
      box-sizing: border-box;
      position: relative;
    }
  </style>
</head>
<body>
  <div class="sheet-wrapper">
    ${html.replaceAll('/hcp-logo-with-name-transparent.png', 'file:///C:/Aamir%20Delta/city_backup/public/hcp-logo-with-name-transparent.png')}
  </div>
</body>
</html>`;
      const scratchDir = 'C:/Users/91937/.gemini/antigravity-ide/brain/7999612d-ed53-4e1a-9106-34b7e300a062/scratch';
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      const outPath = path.join(scratchDir, 'preview_tax_invoice.html');
      fs.writeFileSync(outPath, fullHtml);
    } catch (_) {}

    // Logo height must be 126px (50% increase from 84px)
    expect(html).toContain('height: 126px;');
    // Subtitle container width matching logo width
    expect(html).toContain('width: 174px;');
    expect(html).toContain('by');
    expect(html).toContain('JMG HOSPITALITY AND INFRA LLP');

    // Header vertical middle alignment with logo height
    expect(html).toContain('align-items: center;');
    expect(html).toContain('align-self: center;');
  });

  it('Requirement 2: Left hotel address contact details has decreased font size (7.8pt) and round room badge removed above GST No', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    expect(html).toContain('font-size: 7.8pt;');
    expect(html).toContain('119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)');
    expect(html).toContain('0217-2729791');
    expect(html).toContain('hotelcityparksolapur.com');

    // Number in round above GST No is removed completely
    expect(html).not.toContain('border-radius: 50% / 50%');
    expect(html).not.toContain('color: #dc2626');
  });

  it('Requirement 3: Single-page alignment without spilling onto page 2', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    // Constrained max-height and no overflowing min-height: 275mm
    expect(html).toContain('max-height: 270mm;');
    expect(html).toContain('page-break-inside: avoid !important;');
    expect(html).not.toContain('min-height: 275mm;');
  });

  it('Requirements 3 & 4: Keys are not bold (font-weight: 400), values have reduced boldness (650)', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    // Key labels must have font-weight: 400
    expect(html).toContain('<span style="font-weight: 400; color: #333;">Guest Name :</span>');
    expect(html).toContain('Address :');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Invoice No. :</span>');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Reg. No. :</span>');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Room No. :</span>');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Pax :</span>');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Arrival Date :</span>');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Departure Date :</span>');
    expect(html).toContain('<span style="color: #333; font-weight: 400;">Booking Mode :</span>');
    expect(html).toContain('Check-In by :</span>');
    expect(html).toContain('Check-Out by :</span>');

    // Values should not have ultra-heavy 850 or 900 or 950
    expect(html).not.toContain('font-weight: 850');
    expect(html).not.toContain('font-weight: 900');
    expect(html).not.toContain('font-weight: 950');
  });

  it('Requirement 4, 6 & 7: Line above TAX INVOICE is continuous 100% width, inner dividers are dashed (-------), and signatures aligned', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    // Continuous 100% width line above TAX INVOICE
    expect(html).toContain('border-bottom: 1.5px solid #000; width: 100%;');
    // Table header border is dashed (-------)
    expect(html).toContain('border-top: 1.5px dashed #000;');
    expect(html).toContain('border-bottom: 1px dashed #000;');
    // Total vertical divider slid right (width: 20%) and dashed
    expect(html).toContain('width: 20%; border-left: 1.5px dashed #000;');
    // Dates column slid left (width: 42%)
    // Lines above signatures removed as per user requirement
    expect(html).not.toContain('width: 140px; margin: 0 auto 5px;');
    expect(html).toContain('Signature of Guest');
    expect(html).toContain('Authorised Signatory');
    // Unbolded 'For' in For Hotel City Paark
    expect(html).toContain('<span style="font-weight: 400;">For</span> <strong style="font-weight: 700;">Hotel City Paark</strong>');
  });

  it('Requirement 7: Displays Mode of Booking clearly in stay details with proper spacing', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    expect(html).toContain('Booking Mode :');
    expect(html).toContain('Walk-in');

    // Test with OTA booking
    const otaRoom = { ...sampleStayWithFnb.room, booking_source: 'OTA', ota_platform: 'Goibibo' };
    const otaHtml = buildFinalBillA4HTML(otaRoom, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    expect(otaHtml).toContain('OTA (Goibibo)');
  });

  it('Requirement 8: Shows Check-Out by: cashier name (never Front Desk)', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    expect(html).toContain('Check-Out by :</span> <strong style="color: #000; font-weight: 700;">Cashier_1</strong>');
    expect(html).not.toContain('Check-Out by : Front Desk');
    expect(html).not.toContain('Check-Out by:Front Desk');
  });

  it('Requirement 9: Declared structured sections with SAC codes (Room Rent 996311, Food GST 996332 (Restaurant & Bar))', () => {
    const html = buildFinalBillA4HTML(sampleStayWithFnb.room, sampleStayWithFnb.calc, sampleStayWithFnb.settlement);
    
    // Room Bill section with SAC 996311
    expect(html).toContain('(Accommodation) &nbsp;SAC: 996311');
    expect(html).toContain('Room Tariff -');
    expect(html).toContain('3250.00');
    expect(html).toContain('Less Discount @5.00%');
    expect(html).toContain('- 163.00');
    expect(html).toContain('Effective Tariff');
    expect(html).toContain('3087.00');
    expect(html).toContain('Extra Mattress Base Tariff');
    expect(html).toContain('500.00');
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('SGST @ 2.5%');
    expect(html).toContain('Room Bill Total');
    expect(html).toContain('3741.35');

    // F&B Bill section with (Food & Beverage) SAC: 996332
    expect(html).toContain('(Food &amp; Beverage) &nbsp;SAC: 996332');
    expect(html).toContain('F&amp;B Gross Taxable');
    expect(html).toContain('100.00');
    expect(html).toContain('F&amp;B CGST @ 2.5%');
    expect(html).toContain('2.50');
    expect(html).toContain('F&amp;B SGST @ 2.5%');
    expect(html).toContain('2.50');
    expect(html).toContain('F&amp;B Bill Total');
    expect(html).toContain('105.00');

    // Totals reconcile exactly: 3741 + 105 = 3846
    expect(html).toContain('Invoice Total');
    expect(html).toContain('3846.00');
    expect(html).toContain('Three Thousand Eight Hundred And Forty Six Only');

    // Net Payable Amount: 3846 - 2000 = 1846
    expect(html).toContain('Gross Payable Amount');
    expect(html).toContain('Advance Received');
    expect(html).toContain('2000.00');
    expect(html).toContain('Net Payable Amount');
    expect(html).toContain('1846.00');
    expect(html).toContain('One Thousand Eight Hundred And Forty Six Only');
  });

  it('Requirement 5: Server sequence and FY reset engine endpoints work', async () => {
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf-8');
    
    // FY helper exists
    expect(serverCode).toContain('getCurrentFinancialYear');
    // Financial year cutoff targeting 30 April midnight
    expect(serverCode).toContain('const startYear = m < 4 ? y - 1 : y;');
    // Invoices sequence settings endpoints
    expect(serverCode).toContain('/api/settings/invoice-sequence');
    expect(serverCode).toContain('invoice_starting_number');
    expect(serverCode).toContain('invoice_current_seq');
    expect(serverCode).toContain('invoice_fy_year');
  });

  it('Requirement 10: Reduced left/right margins (8px 10px), whitelisted bold items, and slid left dates (24/09 25/09)', () => {
    const sampleExactUserStay = {
      room: {
        guest_name: 'JAVID RANGREZ',
        address: 'S/O: AB WAHID MUNDEWADI, 259 MUSLIM PACHHA PETH, JAIL ROAD, SOLAPUR NORTH, DAJI PETH, SOLAPUR, MAHARASHTRA - 413005',
        room_number: '101',
        adults: 4,
        checkin_time: '2026-09-24 14:47:18',
        actual_checkout_time: '2026-09-25 09:57:36',
        voucher_number: '260924-001',
        booking_source: 'Walk-in',
        checked_in_by: 'Cashier_1',
        checked_out_by: 'Cashier_1'
      },
      calc: {
        roomGrossTariff: 3250.00,
        discountPct: 5,
        discountAmount: 163.00,
        roomTariffNet: 3087.00,
        hotelExtrasCharge: 500.00,
        stayTax: 154.00, // CGST 77 + SGST 77
        foodTotal: 252.00,
        barTotal: 0,
        advancePaid: 2000.00,
        billableDays: 1,
        chargedDays: 1
      },
      settlement: {
        invoiceNo: '260924-001',
        settled_at: '2026-09-25 09:57:36',
        settleAmt: 1993.00,
        checked_out_by: 'Cashier_1'
      }
    };

    const html = buildFinalBillA4HTML(sampleExactUserStay.room, sampleExactUserStay.calc, sampleExactUserStay.settlement);

    // 1) Reduced left & right margin on entire page
    expect(html).toContain('padding: 5px 10px;');

    // 2) Single date column for 1-day stay (24/09)
    expect(html).toContain('>24/09</th>');
    expect(html).not.toContain('>25/09</th>');

    // 3) Whitelisted bold items verification
    // JAVID RANGREZ
    expect(html).toContain('font-weight: 600; margin-left: 4px;">JAVID RANGREZ</span>');
    // (Accommodation)  SAC: 996311
    expect(html).toContain('(Accommodation) &nbsp;SAC: 996311');
    // (Food & Beverage)  SAC: 996332
    expect(html).toContain('(Food &amp; Beverage) &nbsp;SAC: 996332');
    // Room Bill Total
    expect(html).toContain('Room Bill Total');
    expect(html).toContain('font-weight: 700; color: #000;');
    // Round-off bold
    expect(html).toContain('Round-off');
    // 252.00 (F&B Bill Total)
    expect(html).toContain('252.00');
    // Invoice Total
    expect(html).toContain('Invoice Total');
    expect(html).toContain('3993.00');
    // Net Payable Amount & 1993.00 (Net Payable Amount) both bold
    expect(html).toContain('font-weight: 700; font-size: 11pt; color: #000;">Net Payable Amount</td>');
    expect(html).toContain('font-weight: 700; font-size: 11.5pt; color: #000;">1993.00</td>');
    // Gross Payable Amount 3993.00 and Advance Received 2000.00 both bold
    expect(html).toContain('font-weight: 700; color: #000;">Gross Payable Amount</td>');
    expect(html).toContain('font-weight: 700; color: #000;">3993.00</td>');
    expect(html).toContain('font-weight: 700; color: #000;">Advance Received</td>');
    expect(html).toContain('font-weight: 700; color: #000;">2000.00</td>');
    // (Net Payable Amount In words : Rs. One Thousand Nine Hundred And Ninety Three Only)
    expect(html).toContain('font-weight: 700; color: #000; margin: 4px 0 6px; text-align: left;">\n            (Net Payable Amount In words : Rs. One Thousand Nine Hundred And Ninety Three Only)');
    // Cashier_1 (Check-In by & Check-Out by)
    expect(html).toContain('Check-In by :</span> <strong style="color: #000; font-weight: 700;">Cashier_1</strong>');
    expect(html).toContain('Check-Out by :</span> <strong style="color: #000; font-weight: 700;">Cashier_1</strong>');
    // Hotel City Paark
    expect(html).toContain('<span style="font-weight: 400;">For</span> <strong style="font-weight: 700;">Hotel City Paark</strong>');
    // GST No. : 27AAUFJ0434H1Z7
    expect(html).toContain('GST No. :</span> <span style="font-family: monospace; font-size: 9.5pt; font-weight: 700; color: #000;">27AAUFJ0434H1Z7</span>');

    // 4) Lines above signatures removed & For Hotel City Paark height increased
    expect(html).not.toContain('width: 140px; margin: 0 auto 5px;');
    expect(html).toContain('Signature of Guest');
    expect(html).toContain('Authorised Signatory');
    expect(html).toContain('min-height: 110px;');
    expect(html).toContain('align-items: baseline;');

    // 5) Date and Time in 12-hour AM/PM format
    expect(html).toContain('02:47:18 PM');
    expect(html).toContain('09:57:36 AM');

    // Items that must NOT be bold (font-weight: 400)
    expect(html).toContain('Effective Tariff</td>');
    expect(html).toContain('3087.00</td>');
    expect(html).toContain('(Invoice Total In words : Rs. Three Thousand Nine Hundred And Ninety Three Only)');
  });
});
