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
import { formatTaxInvoiceNumber, cleanVoucherNumber } from '../src/utils/formatters';
import { buildFinalBillA4HTML } from '../src/services/printService';

describe('User Requirement: Tax Invoice No L-prefix and Bottom Footer Pinning', () => {
  it('1. formatTaxInvoiceNumber converts date-voucher 260926-600 to HCP600', () => {
    expect(formatTaxInvoiceNumber('260926-600')).toBe('HCP600');
    expect(formatTaxInvoiceNumber('20260926-600')).toBe('HCP600');
    expect(formatTaxInvoiceNumber('HCP600')).toBe('HCP600');
    expect(formatTaxInvoiceNumber('hcp600')).toBe('HCP600');
    expect(formatTaxInvoiceNumber('L600')).toBe('HCP600');
    expect(formatTaxInvoiceNumber('600')).toBe('HCP600');
    expect(formatTaxInvoiceNumber('260920-520')).toBe('HCP520');
    expect(formatTaxInvoiceNumber('260924-001')).toBe('HCP001');
    expect(formatTaxInvoiceNumber('')).toBe('HCP1');
  });

  it('2. buildFinalBillA4HTML displays "Invoice No. : L600" and "Reg. No. : 260926-600" for voucher 260926-600', () => {
    const room = {
      guest_name: 'JAVID RANGREZ',
      address: 'S/O: AB WAHID MUNDEWADI, 259 MUSLIM PACHHA PETH, JAIL ROAD, SOLAPUR NORTH, DAJI PETH, SOLAPUR, MAHARASHTRA - 413005',
      room_number: '103',
      room_type: 'Deluxe AC',
      adults: 2,
      children: 0,
      checkin_time: '2026-09-26 12:39:00',
      voucher_number: '260926-600',
      booking_source: 'BTC',
      btc_company_name: 'Infosys BPM Technolo',
      checked_in_by: 'Cashier_1',
      checked_out_by: 'Cashier_1'
    };

    const calc = {
      grossTariff: 2500.00,
      discountPct: 0,
      discountAmount: 0,
      roomTariffNet: 2500.00,
      hotelExtrasCharge: 0,
      foodTotal: 0,
      barTotal: 0,
      advancePaid: 0,
      billableDays: 1,
      chargedDays: 1
    };

    const settlement = {
      invoiceNo: '260926-600',
      settled_at: '2026-09-26 12:54:59',
      settleAmt: 2625.00,
      checked_out_by: 'Cashier_1'
    };

    const html = buildFinalBillA4HTML(room, calc, settlement);

    // Verify Invoice No. is HCP600
    expect(html).toContain('Invoice No. :');
    expect(html).toContain('HCP600');
    expect(html).not.toContain('>260926-600</span></td>\n                    <td style="padding: 1.5px 0 1.5px 12px; width: 50%; white-space: nowrap;">\n                      <span style="color: #333; font-weight: 400;">Reg. No. :');

    // Verify Reg. No. is 260926-600
    expect(html).toContain('Reg. No. :');
    expect(html).toContain('260926-600');

    // Verify Booking Mode shows only "BTC" without company name
    expect(html).toContain('Booking Mode :');
    expect(html).toContain('>BTC</span>');
    expect(html).not.toContain('BTC (Infosys BPM Technolo');
  });

  it('3. Verified that the Tax Invoice sheet is fixed to full A4 printable height (268mm) and footer is pinned with margin-top: auto', () => {
    const room = {
      guest_name: 'JAVID RANGREZ',
      room_number: '103',
      voucher_number: '260926-600'
    };

    const html = buildFinalBillA4HTML(room, {}, {});

    // Container is full A4 printable height
    expect(html).toContain('height: 268mm;');
    expect(html).toContain('min-height: 268mm;');
    expect(html).toContain('max-height: 270mm;');
    expect(html).toContain('display: flex;');
    expect(html).toContain('flex-direction: column;');
    expect(html).toContain('justify-content: space-between;');

    // Inner container takes 100% height
    expect(html).toContain('height: 100%; min-height: 100%;');

    // Footer is pinned with margin-top: auto and flex-shrink: 0
    expect(html).toContain('tax-invoice-footer');
    expect(html).toContain('margin-top: auto;');
    expect(html).toContain('flex-shrink: 0;');

    // Verify all requested footer details are intact
    expect(html).toContain('GST No. :');
    expect(html).toContain('27AAUFJ0434H1Z7');
    expect(html).toContain('PAN No. :');
    expect(html).toContain('AAUFJ0434H');
    expect(html).toContain('Bank :');
    expect(html).toContain('HDFC Bank Ltd.');
    expect(html).toContain('A/c Name :');
    expect(html).toContain('JMG HOSPITALITY AND INFRA LLP');
    expect(html).toContain('A/c No. :');
    expect(html).toContain('50200111749594');
    expect(html).toContain('IFSC Code :');
    expect(html).toContain('HDFC0000635');
    expect(html).toContain('Subject to Solapur Jurisdiction');
    expect(html).toContain('E&amp;OE');
    expect(html).toContain('Signature of Guest');
    expect(html).toContain('For');
    expect(html).toContain('Hotel City Paark');
    expect(html).toContain('Authorised Signatory');
  });

  it('4. For Hotel City Paark is aligned at top of footer and E&OE, Signature of Guest & Authorised Signatory are on same baseline level', () => {
    const room = {
      guest_name: 'JAVID RANGREZ',
      room_number: '103',
      voucher_number: '260926-600'
    };

    const html = buildFinalBillA4HTML(room, {}, {});

    // For Hotel City Paark is in upper row
    expect(html).toContain('<span style="font-weight: 400;">For</span> <strong style="font-weight: 700;">Hotel City Paark</strong>');

    // Bottom row has all three on the exact same baseline level
    expect(html).toContain('align-items: baseline;');
    expect(html).toContain('E&amp;OE');
    expect(html).toContain('Signature of Guest');
    expect(html).toContain('Authorised Signatory');
  });

  it('5. invoiceNo derives HCP600 even when settlement has placeholder HCP1 or legacy L1 if voucher is 260926-600', () => {
    const room = {
      guest_name: 'JAVID RANGREZ',
      room_number: '103',
      voucher_number: '260926-600'
    };

    // Settlement with placeholder invoiceNo 'HCP1' or 'L1'
    const html = buildFinalBillA4HTML(room, {}, { invoiceNo: 'HCP1' });
    expect(html).toContain('Invoice No. :');
    expect(html).toContain('HCP600');
    expect(html).not.toContain('>HCP1</span>');
  });

  it('5b. pax calculation: 2 bed + 1 extra mattress = 3 pax', () => {
    const room = {
      guest_name: 'AMIR RANGREZ',
      room_number: '201',
      max_adults: 2,
      adults_male: 1,
      adults_female: 0,
      extra_beds: 1,
      voucher_number: '260926-700'
    };
    const html = buildFinalBillA4HTML(room, { extra_beds: 1 }, {});
    expect(html).toContain('Pax :');
    expect(html).toContain('>3</span>');
  });

  it('6. Booking Mode for BTC displays only "BTC" without company name', () => {
    const room = {
      guest_name: 'JAVID RANGREZ',
      room_number: '103',
      voucher_number: '260926-600',
      booking_source: 'BTC',
      btc_company_name: 'Infosys BPM Technolo'
    };

    const html = buildFinalBillA4HTML(room, {}, {});
    expect(html).toContain('Booking Mode :');
    expect(html).toContain('>BTC</span>');
    expect(html).not.toContain('BTC (Infosys BPM Technolo');
    // Verify Company Name is rendered in guest meta details
    expect(html).toContain('Company Name :');
    expect(html).toContain('INFOSYS BPM TECHNOLO');
  });

  it('7. Displays Company Details on same line as GSTIN, displays Company Address, and decreases height of For Hotel City Paark', () => {
    const room = {
      guest_name: 'JAVID RANGREZ',
      address: 'S/O: AB WAHID MUNDEWADI, 259 MUSLIM PACHHA PETH, SOLAPUR',
      room_number: '103',
      voucher_number: '260926-600',
      booking_source: 'Walk-in',
      company_name: 'Tata Consultancy Services',
      gst_number: '27AAACT2727Q1ZW',
      company_address: 'Hinjewadi Phase 2, Pune'
    };

    const html = buildFinalBillA4HTML(room, {}, {});
    expect(html).toContain('Company Name :');
    expect(html).toContain('TATA CONSULTANCY SERVICES');
    expect(html).toContain('GSTIN :');
    expect(html).toContain('27AAACT2727Q1ZW');

    // Same line structure for Company Name & GSTIN
    expect(html).toContain('display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: nowrap;');

    // Company Address rendered
    expect(html).toContain('Company Address :&nbsp;');
    // Company details are at the very last of information section (after Departure Date and right above SAC row)
    const departureIndex = html.indexOf('Departure Date :');
    const companyNameIndex = html.indexOf('Company Name :');
    const companyAddressIndex = html.indexOf('Company Address :&nbsp;');
    const sacRowIndex = html.indexOf('(Accommodation) &nbsp;SAC: 996311');

    expect(departureIndex).toBeGreaterThan(-1);
    expect(companyNameIndex).toBeGreaterThan(departureIndex);
    expect(companyAddressIndex).toBeGreaterThan(companyNameIndex);
    expect(sacRowIndex).toBeGreaterThan(companyAddressIndex);

    // For Hotel City Paark has padding-top: 28px to decrease its height more as requested
    expect(html).toContain('padding-top: 28px;');
    expect(html).toContain('<span style="font-weight: 400;">For</span> <strong style="font-weight: 700;">Hotel City Paark</strong>');
  });
});
