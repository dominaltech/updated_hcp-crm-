import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

let lastPrintedHtml = '';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    open: () => ({
      document: {
        open: () => {},
        write: (content) => { lastPrintedHtml = content; },
        close: () => {}
      },
      focus: () => {},
      print: () => {}
    })
  };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({
      style: {},
      contentWindow: {
        document: {
          open: () => {},
          write: (content) => { lastPrintedHtml = content; },
          close: () => {}
        },
        focus: () => {},
        print: () => {}
      },
      remove: () => {}
    }),
    body: {
      appendChild: () => {}
    }
  };
}

import { printPreBillSlip, printCheckoutSlip } from '../src/services/printService';

describe('Restaurant Bill Print Layout Refinements', () => {
  beforeEach(() => {
    lastPrintedHtml = '';
  });

  const sampleTable = {
    table_number: 'T1',
    token_number: 2
  };

  const sampleCart = [
    { name: 'Masala Chaas', price: 50, quantity: 2 },
    { name: 'Mutton Dum Biryani', price: 360, quantity: 1 },
    { name: 'Dal Khichdi', price: 180, quantity: 1 },
    { name: 'Butter Chicken', price: 320, quantity: 1 }
  ];

  it('1) Increases logo height to at least 50px (increased from 38px)', () => {
    printPreBillSlip(sampleTable, sampleCart, 'Captain Jack', 'restaurant');
    expect(lastPrintedHtml).toContain('/hcp-logo-with-name.png');
    expect(lastPrintedHtml).toContain('height: 52px;');
  });

  it('2) Renders address in one line with font-size reduced to 8px and white-space: nowrap', () => {
    printPreBillSlip(sampleTable, sampleCart, 'Captain Jack', 'restaurant');
    expect(lastPrintedHtml).toContain('119, Murarji Peth, Char Hutatma Chowk, Solapur 413 001');
    expect(lastPrintedHtml).toContain('font-size: 8px;');
    expect(lastPrintedHtml).toContain('white-space: nowrap;');
    // Should not contain the old 9px multi-line format
    expect(lastPrintedHtml).not.toContain('<p style="font-size: 9px; line-height: 1.25;">119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001</p>');
  });

  it('3) Uses correct landline number 0217-2729791', () => {
    printPreBillSlip(sampleTable, sampleCart, 'Captain Jack', 'restaurant');
    expect(lastPrintedHtml).toContain('0217-2729791');
    expect(lastPrintedHtml).not.toContain('0217-2725388');
  });

  it('4) Changes title from "PRE-BILL / CHECK" to "Restaurant Bill/Cheque"', () => {
    printPreBillSlip(sampleTable, sampleCart, 'Captain Jack', 'restaurant');
    expect(lastPrintedHtml).toContain('*** Restaurant Bill/Cheque ***');
    expect(lastPrintedHtml).not.toContain('*** PRE-BILL / CHECK ***');
  });

  it('5) Replaces footer pre-bill disclaimer with "This is an Bill/Cheque for the, Consider this as an Tax Invoice"', () => {
    printPreBillSlip(sampleTable, sampleCart, 'Captain Jack', 'restaurant');
    expect(lastPrintedHtml).toContain('This is an Bill/Cheque for the, Consider this as an Tax Invoice');
    expect(lastPrintedHtml).not.toContain('This is a pre-bill check, not a tax invoice.');
  });

  describe('Settled Restaurant Bill (printCheckoutSlip) Layout Updates', () => {
    const settledOrder = {
      id: 143957,
      orderNumber: 'RES-143957',
      order_number: 'RES-143957',
      token_number: 2,
      table_number: 'RS-104',
      order_type: 'room',
      customer_name: 'Md Yahya Ab Wahid Mundewadi',
      cashier_name: 'Jaijeet sir',
      items: [{ name: 'Chicken Handi', price: 310, quantity: 2 }],
      subtotal: 620,
      tax: 31,
      grand_total: 651,
      payment_mode: 'ROOM_FOLIO',
      is_paid: 1
    };

    it('1) Footer replaces "Thank you for visiting us! Please visit us again." with "This is an Bill/Cheque for the  Consider this as an Tax Invoice"', () => {
      printCheckoutSlip(settledOrder);
      expect(lastPrintedHtml).toContain('This is an Bill/Cheque for the  Consider this as an Tax Invoice');
      expect(lastPrintedHtml).not.toContain('Thank you for visiting us!');
      expect(lastPrintedHtml).not.toContain('Please visit us again.');
    });

    it('2) Header displays "Restaurant Bill/Cheque" instead of "HOTEL CITY PARK - RESTAURANT"', () => {
      // Default / empty customDeptTitle
      printCheckoutSlip(settledOrder);
      expect(lastPrintedHtml).toContain('Restaurant Bill/Cheque');
      expect(lastPrintedHtml).not.toContain('HOTEL CITY PARK - RESTAURANT');

      // Even if legacy 'HOTEL CITY PARK - RESTAURANT' is passed explicitly
      printCheckoutSlip(settledOrder, 'HOTEL CITY PARK - RESTAURANT');
      expect(lastPrintedHtml).toContain('Restaurant Bill/Cheque');
      expect(lastPrintedHtml).not.toContain('HOTEL CITY PARK - RESTAURANT');
    });

    it('3) Displays "Bill No: RES-143957" instead of "Bill #: RES-143957"', () => {
      printCheckoutSlip(settledOrder);
      expect(lastPrintedHtml).toContain('Bill No: <strong>RES-143957</strong>');
      expect(lastPrintedHtml).not.toContain('Bill #:');
    });

    it('4) Displays "Payment Mode: SETTLED TO ROOM" when payment_mode is ROOM_FOLIO', () => {
      printCheckoutSlip(settledOrder);
      expect(lastPrintedHtml).toContain('<span>Payment Mode:</span>');
      expect(lastPrintedHtml).toContain('SETTLED TO ROOM');
      expect(lastPrintedHtml).not.toContain('>ROOM_FOLIO<');
    });

    it('4b) Also handles lowercase "room_folio" and renders "SETTLED TO ROOM"', () => {
      const orderLower = { ...settledOrder, payment_mode: 'room_folio' };
      printCheckoutSlip(orderLower);
      expect(lastPrintedHtml).toContain('SETTLED TO ROOM');
      expect(lastPrintedHtml).not.toContain('>room_folio<');
    });

    it('5) Removes "• GSTIN: 27AAAAA0000A1Z5" from header', () => {
      printCheckoutSlip(settledOrder);
      expect(lastPrintedHtml).toContain(': 0217-2729791, +91 99600 13388');
      expect(lastPrintedHtml).not.toContain('GSTIN:');
      expect(lastPrintedHtml).not.toContain('27AAAAA0000A1Z5');
    });

    it('6) Removes "[Room Service]" from Room display and renders Date & Time in 12hr am/pm format', () => {
      const orderWithDate = {
        ...settledOrder,
        settled_at: '2026-10-02T08:56:00'
      };
      printCheckoutSlip(orderWithDate);
      expect(lastPrintedHtml).toContain('Room: <strong>104</strong>');
      expect(lastPrintedHtml).not.toContain('[Room Service]');
      expect(lastPrintedHtml).toMatch(/02 Oct 2026,\s*08:56\s*am/i);
      expect(lastPrintedHtml).toContain('<span style="white-space: nowrap;">Room: <strong>104</strong></span>');
    });

    it('7) Formats item rate and amt with "/-" (e.g. 310/-, 620/-), subtotal & grand total with "/-", while GST keeps decimal number', () => {
      const orderSample = {
        ...settledOrder,
        items: [{ name: 'Mutton Dum Biryani', price: 360, quantity: 2 }],
        subtotal: 720,
        tax: 36,
        grand_total: 756
      };
      printCheckoutSlip(orderSample);
      // Items table Rate and Amt formatted with /-
      expect(lastPrintedHtml).toContain('<td style="text-align: right;">360/-</td>');
      expect(lastPrintedHtml).toContain('<td style="text-align: right;">720/-</td>');
      expect(lastPrintedHtml).not.toContain('360.00');
      expect(lastPrintedHtml).not.toContain('720.00');
      // Subtotal & Grand total
      expect(lastPrintedHtml).toContain('<span>Subtotal:</span>');
      expect(lastPrintedHtml).toContain('<span>₹720/-</span>');
      expect(lastPrintedHtml).toContain('<span>Grand Total:</span>');
      expect(lastPrintedHtml).toContain('<span>₹756/-</span>');
      // GST keeps decimal number
      expect(lastPrintedHtml).toContain('<span>GST (5%):</span>');
      expect(lastPrintedHtml).toContain('<span>₹36.00</span>');
    });

    it('8) Pre-bill slip also formats rate and amt with "/-" and keeps decimal taxes', () => {
      printPreBillSlip(sampleTable, sampleCart, 'Captain Jack', 'restaurant');
      expect(lastPrintedHtml).toContain('<td style="text-align: right;">360/-</td>');
      expect(lastPrintedHtml).toContain('<span>ESTIMATED TOTAL:</span>');
      expect(lastPrintedHtml).toMatch(/<span>₹\d+\/-<\/span>/);
      expect(lastPrintedHtml).not.toContain('GSTIN:');
    });
  });
});

