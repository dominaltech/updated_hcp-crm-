import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { printPreBillSlip, printCheckoutSlip, printPosThermalClosingSlip } from '../src/services/printService';

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
    createElement: (tag) => ({
      style: {},
      contentWindow: {
        document: {
          open: () => {},
          write: (content) => { lastPrintedHtml = content; },
          close: () => {}
        },
        focus: () => {},
        print: () => {}
      }
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {}
    }
  };
}

describe('Bar VAT vs Restaurant GST & Isolated Panels Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    lastPrintedHtml = '';
  });

  describe('printService: Pre-Bill Slip (Check)', () => {
    it('prints VAT (5%) on pre-bill slip when department is bar', () => {
      const table = { table_number: 'B-1', is_bar: true };
      const cart = [{ name: 'Mojito Cocktail', price: 250, quantity: 2 }];

      printPreBillSlip(table, cart, 'Bartender', 'bar');
      expect(lastPrintedHtml).toContain('VAT (5%):');
      expect(lastPrintedHtml).toContain('₹ 25.00'); // 500 * 0.05
      expect(lastPrintedHtml).not.toContain('CGST');
      expect(lastPrintedHtml).not.toContain('SGST');
      expect(lastPrintedHtml).toMatch(/HOTEL CITY PARK - BAR (&|&amp;) LOUNGE/);
    });

    it('prints CGST (2.5%) and SGST (2.5%) on pre-bill slip when department is restaurant', () => {
      const table = { table_number: 'T-1' };
      const cart = [{ name: 'Paneer Butter Masala', price: 300, quantity: 1 }];

      printPreBillSlip(table, cart, 'Captain', 'restaurant');
      expect(lastPrintedHtml).toContain('CGST (2.5%):');
      expect(lastPrintedHtml).toContain('SGST (2.5%):');
      expect(lastPrintedHtml).not.toContain('VAT (5%):');
      expect(lastPrintedHtml).toMatch(/Restaurant (&|&amp;) Dining Floor/);
    });
  });

  describe('printService: Checkout / Thermal Settlement Slip', () => {
    it('prints VAT (5%): on checkout thermal slip for Bar', () => {
      const order = {
        id: 101,
        is_bar: true,
        department: 'bar',
        items: [{ name: 'Blended Scotch 60ml', price: 400, quantity: 1 }],
        subtotal: 400,
        tax: 20,
        total: 420,
        payment_mode: 'cash'
      };

      printCheckoutSlip(order, 'HOTEL CITY PARK - BAR & LOUNGE');
      expect(lastPrintedHtml).toContain('VAT (5%):');
      expect(lastPrintedHtml).not.toContain('GST (5%):');
      expect(lastPrintedHtml).toMatch(/HOTEL CITY PARK - BAR (&|&amp;) LOUNGE/);
    });

    it('prints GST (5%): on checkout thermal slip for Restaurant', () => {
      const order = {
        id: 102,
        is_bar: false,
        department: 'restaurant',
        items: [{ name: 'Veg Biryani', price: 250, quantity: 1 }],
        subtotal: 250,
        tax: 12.5,
        total: 262.5,
        payment_mode: 'cash'
      };

      printCheckoutSlip(order, 'HOTEL CITY PARK - RESTAURANT');
      expect(lastPrintedHtml).toContain('GST (5%):');
      expect(lastPrintedHtml).not.toContain('VAT (5%):');
      expect(lastPrintedHtml).toContain('HOTEL CITY PARK - RESTAURANT');
    });
  });

  describe('printService: Shift & Closing Audit Slip', () => {
    it('shows Liquor VAT on bar closing audit slip and GST on restaurant closing audit slip', () => {
      const analyticsBar = {
        department: 'bar',
        summary: { totalSubtotal: 10000, totalTax: 500, grossSales: 10500 },
        paymentModes: {},
        orderTypes: {}
      };
      printPosThermalClosingSlip(analyticsBar, 'bar');
      expect(lastPrintedHtml).toContain('Liquor VAT:');

      lastPrintedHtml = '';
      const analyticsRest = {
        department: 'restaurant',
        summary: { totalSubtotal: 20000, totalTax: 1000, grossSales: 21000 },
        paymentModes: {},
        orderTypes: {}
      };
      printPosThermalClosingSlip(analyticsRest, 'restaurant');
      expect(lastPrintedHtml).toContain('GST:');
      expect(lastPrintedHtml).not.toContain('Liquor VAT:');
    });
  });

  describe('UI Component Code Integrity for Isolated Panels & VAT', () => {
    it('PosManagerPanel strictly isolates Restaurant vs Bar settings and labels', () => {
      const posManagerCode = fs.readFileSync(path.join(process.cwd(), 'src/components/restaurant/PosManagerPanel.jsx'), 'utf8');

      // 1. Settings tab title uses Tax & VAT for bar
      expect(posManagerCode).toContain("department === 'bar' ? 'Tax & VAT Settings' : 'Tax & GST Settings'");

      // 2. Settings tab isolates Restaurant GST to restaurant only
      expect(posManagerCode).toContain("department === 'restaurant' && (");
      expect(posManagerCode).toContain('Restaurant GST (%)');

      // 3. Settings tab isolates Bar VAT and PAX cover charge to bar only
      expect(posManagerCode).toContain("department === 'bar' && (");
      expect(posManagerCode).toContain('Bar Lounge VAT (%)');
      expect(posManagerCode).toContain('Bar Lounge PAX / Cover Charge');

      // 4. Analytics uses Liquor VAT for bar
      expect(posManagerCode).toContain("department === 'bar' ? 'Liquor VAT Collected:' : 'GST Collected (CGST + SGST):'");

      // 5. Tables tab subnav is Bar Seats & Tables vs Tables & Counters
      expect(posManagerCode).toContain("department === 'bar' ? 'Bar Seats & Tables' : 'Tables & Counters'");
    });

    it('TableSettleModal uses VAT for bar and GST for restaurant', () => {
      const settleModalCode = fs.readFileSync(path.join(process.cwd(), 'src/components/restaurant/TableSettleModal.jsx'), 'utf8');
      expect(settleModalCode).toContain("department === 'bar' ? 'VAT (5%)' : 'GST (5%)'");
    });

    it('TableSessionView uses VAT for bar and GST for restaurant', () => {
      const sessionViewCode = fs.readFileSync(path.join(process.cwd(), 'src/components/restaurant/TableSessionView.jsx'), 'utf8');
      expect(sessionViewCode).toContain("department === 'bar' ? 'VAT (5%):' : 'GST (5%):'");
    });

    it('BillEditModal uses VAT for bar and GST for restaurant', () => {
      const billEditCode = fs.readFileSync(path.join(process.cwd(), 'src/components/restaurant/BillEditModal.jsx'), 'utf8');
      expect(billEditCode).toContain("department === 'bar' ? 'VAT (5%):' : 'GST (5%):'");
    });
  });
});
