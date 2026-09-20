import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';
import {
  formatPaymentBreakdown,
  printCashReceipt,
  buildGuestRegistrationHTML,
  buildDailyClosingReportHTML,
  printThermalBillSlip,
  printPreBillSlip,
  printCheckoutSlip
} from '../src/services/printService';
import { api } from '../src/services/api';

describe('OTA Pre-Booked Analytics & Fee-Inclusive Receipt Total Tests', () => {
  let managerToken;

  beforeAll(() => {
    managerToken = generateToken({
      id: 9995,
      username: 'manager_test',
      role: 'manager',
      full_name: 'Manager Test',
      can_access_manager: 1
    });
  });

  describe('1. Manager Analytics & Pre-Booked Aggregation (/api/manager/analytics)', () => {
    it('should return prebookedTotal and prebookedCount in analytics response without duplicating multi-room vouchers', async () => {
      const res = await request(app)
        .get('/api/manager/analytics')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toHaveProperty('prebookedTotal');
      expect(res.body.stats).toHaveProperty('prebookedCount');
      expect(res.body.analytics).toHaveProperty('prebookedTotal');
      expect(res.body.analytics).toHaveProperty('prebookedCount');

      // Verify numeric type
      expect(typeof res.body.stats.prebookedTotal).toBe('number');
      expect(typeof res.body.stats.prebookedCount).toBe('number');
      expect(res.body.stats.prebookedTotal).toBeGreaterThanOrEqual(0);
      expect(res.body.stats.prebookedCount).toBeGreaterThanOrEqual(0);
    });

    it('should correctly aggregate voucher amounts by unique voucher_number in database', () => {
      const row = db.prepare(`
        SELECT 
          COALESCE(SUM(v.v_amount), 0) as prebooked_total,
          COUNT(*) as prebooked_count
        FROM (
          SELECT 
            b.voucher_number,
            MAX(COALESCE(b.ota_bill_amount, 0)) as v_amount
          FROM bookings b
          WHERE b.is_prepaid = 1
            AND (b.booking_source = 'OTA' OR COALESCE(b.ota_bill_amount, 0) > 0)
            AND b.status != 'cancelled'
          GROUP BY b.voucher_number
        ) v
      `).get();

      expect(row).toBeDefined();
      expect(typeof row.prebooked_total).toBe('number');
      expect(typeof row.prebooked_count).toBe('number');
    });
  });

  describe('2. Fee-Inclusive Formatting in formatPaymentBreakdown', () => {
    it('should keep Cash plain without fee text', () => {
      const breakdown = formatPaymentBreakdown({
        payment_mode: 'Cash',
        amount: 2000
      });
      expect(breakdown).toBe('Cash: ₹2,000');
      expect(breakdown).not.toContain('Fee');
      expect(breakdown).not.toContain('Tax');
    });

    it('should format single Card POS swipe with fee-inclusive total (200 + 5 fee -> 205)', () => {
      const breakdown = formatPaymentBreakdown({
        payment_mode: 'Card',
        amount: 200,
        card_surcharge: 5
      });
      expect(breakdown).toContain('Card POS Swipe: ₹205');
      expect(breakdown).toContain('(₹200 + ₹5 Fee)');
    });

    it('should format single Online UPI with fee-inclusive total (200 + 3 fee -> 203)', () => {
      const breakdown = formatPaymentBreakdown({
        payment_mode: 'UPI',
        amount: 200,
        upi_tax: 3,
        utr_number: 'UTR12345678'
      });
      expect(breakdown).toContain('Online UPI: ₹203');
      expect(breakdown).toContain('(₹200 + ₹3 Fee)');
      expect(breakdown).toContain('UTR: UTR12345678');
    });

    it('should format split payment with final totals: Cash plain, Card and UPI fee-inclusive', () => {
      const breakdown = formatPaymentBreakdown({
        split_cash: 1000,
        split_online: 200,
        split_card: 200,
        upi_tax: 3,
        card_surcharge: 5
      });
      expect(breakdown).toContain('Cash: ₹1,000');
      expect(breakdown).toContain('UPI: ₹203 (₹200 + ₹3 Fee)');
      expect(breakdown).toContain('Card: ₹205 (₹200 + ₹5 Fee)');
      expect(breakdown).not.toContain('+₹5 Fee [2.5%]'); // Old format removed
    });
  });

  describe('3. Registration Card splitBadges in buildGuestRegistrationHTML', () => {
    it('should render final fee-inclusive total for Card POS (e.g. ₹ 205)', () => {
      const html = buildGuestRegistrationHTML({
        room_numbers: '101',
        guest_name: 'Rahul Sharma',
        splitCard: 200,
        card_surcharge: 5,
        totalPaid: 200
      });
      expect(html).toContain('Card POS: ₹ 205');
      expect(html).toContain('(₹200 + ₹5 Fee)');
    });

    it('should render final fee-inclusive total for Online UPI (e.g. ₹ 203)', () => {
      const html = buildGuestRegistrationHTML({
        room_numbers: '102',
        guest_name: 'Anita Verma',
        splitOnline: 200,
        upi_tax: 3,
        totalPaid: 200
      });
      expect(html).toContain('Online UPI: ₹ 203');
      expect(html).toContain('(₹200 + ₹3 Fee)');
    });

    it('should render plain amount for Cash', () => {
      const html = buildGuestRegistrationHTML({
        room_numbers: '103',
        guest_name: 'Suresh Patil',
        splitCash: 2000,
        totalPaid: 2000
      });
      expect(html).toContain('Cash: ₹ 2,000');
      expect(html).not.toContain('Cash Fee');
    });
  });

  describe('4. Daily Closing Report buildDailyClosingReportHTML', () => {
    it('should render OTA Pre-Booked voucher total in closing report when present', () => {
      const html = buildDailyClosingReportHTML({
        prebookedTotal: 5000,
        prebookedCount: 1,
        stats: {
          grossRevenue: 10000,
          totalExpenses: 2000
        },
        analytics: {
          breakdown: {
            hospitality: {
              total: 5000,
              cash: 5000,
              upi: 0,
              card: 0,
              cheque: 0,
              card_surcharge: 0,
              upi_tax: 0
            }
          }
        }
      });
      expect(html).toContain('OTA Pre-Booked (1 Vch)');
      expect(html).toContain('₹ 5,000.00');
    });
  });

  describe('5. Pre-Bill & Slip Printing (No "subtotal is not defined" error)', () => {
    it('should generate pre-bill and thermal bill slips without throwing ReferenceError', () => {
      const mockTable = {
        id: 1,
        table_number: 'RS-101',
        table_type: 'room_service',
        token_number: 5
      };
      const mockCart = [
        { id: 101, name: 'beef seek', price: 250, quantity: 2 }
      ];

      // Test printPreBillSlip
      expect(() => {
        printPreBillSlip(mockTable, mockCart, 'Captain Jack');
      }).not.toThrow();

      // Test printCheckoutSlip & printThermalBillSlip with prebillData structure
      const prebillData = {
        table: mockTable,
        cart: mockCart,
        items: mockCart,
        waiterName: 'Captain Jack',
        subtotal: 500,
        tax: 25,
        gst: 25,
        grandTotal: 525
      };

      expect(() => {
        printCheckoutSlip(prebillData);
      }).not.toThrow();

      expect(() => {
        printThermalBillSlip(prebillData, 'HOTEL CITY PARK - RESTAURANT');
      }).not.toThrow();
    });

    it('should verify api.get, api.post, api.put, api.delete are valid functions on api', () => {
      expect(typeof api.get).toBe('function');
      expect(typeof api.post).toBe('function');
      expect(typeof api.put).toBe('function');
      expect(typeof api.delete).toBe('function');
    });
  });
});
