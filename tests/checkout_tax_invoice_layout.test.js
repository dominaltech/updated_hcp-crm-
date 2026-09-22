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

describe('Checkout Tax Invoice Redesign (Hotel City Paark Layout & Watermark)', () => {
  it('generates the exact tax invoice HTML matching the physical paper invoice from Hotel City Paark', () => {
    const room = {
      guest_name: 'DR. NEHARKAR',
      address: 'PUNE',
      room_number: '310',
      room_type: 'Deluxe AC',
      adults_male: 2,
      adults_female: 0,
      children: 0,
      checkin_time: '2026-09-12 08:12:00',
      voucher_number: '21168',
      initial_paid: 0,
      checked_in_by: 'bhuvi'
    };

    const calc = {
      grossTariff: 4495.00,
      discountPct: 10,
      discountAmount: 449.50,
      roomTariffNet: 4045.50,
      foodTotal: 0,
      barTotal: 0,
      hotelExtrasCharge: 0,
      advancePaid: 0,
      billableDays: 1,
      chargedDays: 1
    };

    const settlement = {
      invoiceNo: 'L1573',
      settled_at: '2026-09-13 10:27:02',
      settleAmt: 4248.00,
      checked_out_by: 'bhuvi'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    try {
      const previewPath = 'C:/Users/91937/.gemini/antigravity-ide/brain/debe5013-e92d-4ab5-9e14-f2bf4ec644aa/scratch/preview_invoice.html';
      const renderedHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice Preview</title>
  <style>
    @page { size: A4; margin: 0; }
    body { margin: 0; padding: 20px 0; background: #cbd5e1; display: flex; justify-content: center; }
    .page-container { width: 210mm; min-height: 297mm; background: #fff; box-shadow: 0 10px 25px rgba(0,0,0,0.2); box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="page-container">
    ${html.replaceAll('/hcp-logo-with-name-transparent.png', 'file:///C:/Aamir%20Delta/city_backup/public/hcp-logo-with-name-transparent.png')}
  </div>
</body>
</html>`;
      fs.writeFileSync(previewPath, renderedHtml);
    } catch (_) {}

    // 1. Header & Contact
    expect(html).toContain('119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)');
    expect(html).toContain('0217-2729791');
    expect(html).toContain('9960013388');
    expect(html).toContain('hcitypark@rediffmail.com');
    expect(html).toContain('hotelcityparksolapur.com');
    expect(html).toContain('hcp-logo-with-name-transparent.png');
    expect(html).toContain('by JMG HOSPITALITY AND INFRA LLP');
    expect(html).toContain('TAX INVOICE');

    // 2. Centered Background Watermark Logo (Vibrant Opacity for Colorful Print)
    expect(html).toContain('opacity: 0.14');
    expect(html).toContain('hcp-logo-with-name-transparent.png');

    // 3. Guest & Stay Metadata (Invoice No. = Check-in Form Number)
    expect(html).toContain('DR. NEHARKAR');
    expect(html).toContain('PUNE');
    expect(html).toContain('Invoice No. :');
    expect(html).toContain('21168');
    expect(html).toContain('Reg. No. :');
    expect(html).toContain('21168');
    expect(html).toContain('310');
    expect(html).toContain('12-09-2026');
    expect(html).toContain('08:12:00');
    expect(html).toContain('13-09-2026');
    expect(html).toContain('10:27:02');

    // 3b. Exact 2-Row Dates Layout with Time (Preventing Line Wrapping and Cutoff)
    expect(html).toContain('white-space: nowrap;');
    expect(html).toContain('Arrival Date :');
    expect(html).toContain('Departure Date :');
    expect(html).toContain('Time :');

    // 4. Charges Table & Exact Values from Photograph
    expect(html).toContain('SAC: 996311');
    expect(html).toContain('4495.00'); // Gross tariff
    expect(html).toContain('Less Discount @10.00%');
    expect(html).toContain('449.50'); // Discount
    expect(html).toContain('Effective Tariff');
    expect(html).toContain('4045.50'); // Effective
    expect(html).toContain('CGST @ 2.5%');
    expect(html).toContain('101.14'); // CGST
    expect(html).toContain('SGST @ 2.5%');
    expect(html).toContain('101.14'); // SGST
    expect(html).toContain('Round-off');
    expect(html).toContain('+0.22'); // Round-off
    expect(html).toContain('Invoice Total');
    expect(html).toContain('4248.00'); // Final Invoice Total
    expect(html).toContain('Four Thousand Two Hundred And Forty Eight');

    // 5. Settlement Summary Box
    expect(html).toContain('Gross Payable Amount');
    expect(html).toContain('Advance Received');
    expect(html).toContain('Net Payable Amount');
    expect(html).toContain('Check-In by : <strong style="color: #000;">bhuvi</strong>');
    expect(html).toContain('Check-Out by : <strong style="color: #000;">bhuvi</strong>');

    // 6. Footer, Banking & Signatures
    expect(html).toContain('27AAUFJ0434H1Z7');
    expect(html).toContain('AAUFJ0434H');
    expect(html).toContain('HDFC Bank Ltd.');
    expect(html).toContain('JMG HOSPITALITY AND INFRA LLP');
    expect(html).toContain('50200111749594');
    expect(html).toContain('HDFC0000635');
    expect(html).toContain('Subject to Solapur Jurisdiction');
    expect(html).toContain('E&amp;OE');
    expect(html).toContain('Signature of Guest');
    expect(html).toContain('For Hotel City Paark');
    expect(html).toContain('Authorised Signatory');
  });

  it('formats century-prefixed vouchers from 20260920-520 to 260920-520 and sets invoice number equal to checkin voucher', () => {
    const room = {
      guest_name: 'Rahul Sharma',
      room_number: '205',
      room_type: 'Executive AC',
      checkin_time: '2026-09-20 14:00:00',
      voucher_number: '20260920-520',
      total_room_charge: 2500,
      initial_paid: 1000
    };

    const calc = {
      grossTariff: 2380.95,
      roomTariffNet: 2380.95,
      tariffTax5Pct: 119.05,
      advancePaid: 1000
    };

    const settlement = {
      settled_at: '2026-09-21 11:00:00',
      settleAmt: 1500
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);
    // Must convert 20260920-520 -> 260920-520
    expect(html).not.toContain('20260920-520');
    expect(html).toContain('260920-520');
    // Invoice number must match check-in form number
    expect(html).toContain('Invoice No. :</td>\n                    <td style="padding: 1.5px 0; font-weight: 850; color: #000; width: 25%; white-space: nowrap;">260920-520');
    expect(html).toContain('Reg. No. :</td>\n                    <td style="padding: 1.5px 0; font-weight: 850; color: #000; width: 30%; white-space: nowrap;">260920-520');
    // Two row dates
    expect(html).toContain('Arrival Date :');
    expect(html).toContain('Departure Date :');
    expect(html).toContain('Time :');
    expect(html).toContain('by JMG HOSPITALITY AND INFRA LLP');
  });

  it('handles zero-discount room stay correctly', () => {
    const room = {
      guest_name: 'Dominal Technology',
      room_number: '101',
      room_type: 'Deluxe AC',
      total_room_charge: 1000,
      initial_paid: 1000
    };

    const calc = {
      grossTariff: 952.38,
      roomTariffNet: 952.38,
      tariffTax5Pct: 47.62,
      foodTotal: 0,
      barTotal: 0,
      advancePaid: 1000
    };

    const html = buildFinalBillA4HTML(room, calc, {});
    expect(html).toContain('DOMINAL TECHNOLOGY');
    expect(html).toContain('101');
    expect(html).toContain('TAX INVOICE');
    expect(html).toContain('1000.00');
    expect(html).toContain('One Thousand');
    expect(html).toContain('Advance Received');
  });

  it('verifies FolioSettlementModal invokes printFinalBillA4 and provides Tax Invoice button', () => {
    const modalPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    expect(content).toContain('printFinalBillA4(room, folioData');
    expect(content).toContain('🧾 Print Tax Invoice (A4)');
  });

  it('verifies HospitalityHistory and RoomFolioPage provide Tax Invoice buttons', () => {
    const historyPath = path.resolve(__dirname, '../src/components/hospitality/HospitalityHistory.jsx');
    const historyContent = fs.readFileSync(historyPath, 'utf8');
    expect(historyContent).toContain('Tax Invoice');

    const folioPath = path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx');
    const folioContent = fs.readFileSync(folioPath, 'utf8');
    expect(folioContent).toContain('Tax Invoice');
  });
});
