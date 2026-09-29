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

import { buildGuestRegistrationHTML } from '../src/services/printService';

describe('User Registration Card Refinements: Voucher No label & Bottom Footer Docking', () => {
  const sampleData = {
    guestName: 'Md Yahya Ab Wahid Mundewadi',
    mobile: '9028850715',
    dob: '2004-08-26',
    age: '22',
    docType: 'Aadhaar Card',
    aadharNumber: '443842677809',
    bookingSource: 'Walk-in',
    companyName: 'Wipro Pvt ltd',
    gstNumber: '654654654654',
    address: 'S/O: Ab Wahid Mundewadi, 259 Muslim Pachha Peth, Jail Road, Solapur North, Daji Peth, Solapur, Maharashtra, 413005',
    email: 'javidrangrez4@gmail.com',
    voucher_number: '260926-601',
    voucherNo: '260926-601',
    checkinTime: '2026-09-26T14:50:00',
    approxCheckout: '2026-09-27T14:00:00',
    stayNights: 1,
    roomNumber: '101',
    adultsMale: 1,
    adultsFemale: 1,
    children: 1,
    extraBeds: 0,
    roomTariffNet: 2494,
    discountAmount: 125,
    taxAmount: 119,
    grandTotal: 2494,
    totalPaid: 2000,
    splitCash: 1000,
    splitOnline: 1000,
    onlineUtr: '654654654654',
    checkedInBy: 'Cashier_1'
  };

  it('1) Displays "Voucher No: 260926-601" instead of "Folio: #260926-601" in the case banner', () => {
    const html = buildGuestRegistrationHTML(sampleData, { includePhotos: false });

    // Must contain Voucher No: 260926-601
    expect(html).toContain('Voucher No: 260926-601');

    // Must NOT contain the old "Folio: #260926-601"
    expect(html).not.toContain('Folio: #260926-601');
    expect(html).not.toContain('Folio: #');
  });

  it('2) Registration Card page-1 has full A4 height (276mm) and inner body has height 100%', () => {
    const html = buildGuestRegistrationHTML(sampleData, { includePhotos: false });

    expect(html).toContain('height: 276mm;');
    expect(html).toContain('min-height: 276mm;');
    expect(html).toContain('height: 100%;');
  });

  it('3) Footer has class registration-footer-row with margin-top: auto for bottom docking', () => {
    const html = buildGuestRegistrationHTML(sampleData, { includePhotos: false });

    expect(html).toContain('class="registration-footer-row"');
    expect(html).toContain('margin-top: auto;');
    expect(html).toContain('Guest Signature');
    expect(html).toContain('Front Desk Cashier');
    expect(html).toContain('Cashier_1');
  });

  it('4) CSS styles enforce full A4 height (276mm) and margin-top: auto on registration-footer-row', () => {
    const stylesCss = fs.readFileSync(path.resolve(__dirname, '../public/styles.css'), 'utf-8');

    // full-a4-registration-card has 276mm height
    expect(stylesCss).toMatch(/\.full-a4-registration-card[^{]*\{[^}]*height:\s*276mm\s*!important/);
    expect(stylesCss).toMatch(/\.full-a4-registration-card[^{]*\{[^}]*min-height:\s*276mm\s*!important/);

    // registration-footer-row has margin-top: auto
    expect(stylesCss).toMatch(/\.registration-footer-row\s*\{[^}]*margin-top:\s*auto\s*!important/);

    // registration-page-1 is removed from height: auto !important
    expect(stylesCss).not.toMatch(/\.registration-page-1:only-child[^{]*\{[^}]*height:\s*auto/);
  });
});
