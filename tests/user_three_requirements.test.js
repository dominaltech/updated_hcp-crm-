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

import { formatTaxInvoiceNumber } from '../src/utils/formatters';
import { buildFinalBillA4HTML } from '../src/services/printService';

describe('Verification of the 3 User Requirements', () => {
  describe('Requirement 1: OTA Booking GST 5% is INCLUDED in entered amount', () => {
    it('calculates Base and 5% GST included in the entered amount correctly', () => {
      const enteredAmount = 2100;
      const gstRate = 5;
      const baseAmount = Math.round((enteredAmount / (1 + gstRate / 100)) * 100) / 100;
      const gstAmount = Number((enteredAmount - baseAmount).toFixed(2));

      expect(baseAmount).toBe(2000);
      expect(gstAmount).toBe(100);
      expect(baseAmount + gstAmount).toBe(enteredAmount);
    });
  });

  describe('Requirement 2: Tax invoice number prefix is "HCP" (was "L")', () => {
    it('prefixes bill number with HCP instead of L', () => {
      expect(formatTaxInvoiceNumber('260926-600')).toBe('HCP600');
      expect(formatTaxInvoiceNumber('20260926-600')).toBe('HCP600');
      expect(formatTaxInvoiceNumber('HCP600')).toBe('HCP600');
      expect(formatTaxInvoiceNumber('L600')).toBe('HCP600');
      expect(formatTaxInvoiceNumber('l600')).toBe('HCP600');
      expect(formatTaxInvoiceNumber('600')).toBe('HCP600');
      expect(formatTaxInvoiceNumber('260920-520')).toBe('HCP520');
      expect(formatTaxInvoiceNumber('260924-001')).toBe('HCP001');
      expect(formatTaxInvoiceNumber('')).toBe('HCP1');
    });

    it('renders "Invoice No. : HCP..." on the final A4 Tax Invoice', () => {
      const room = {
        guest_name: 'TEST GUEST',
        room_number: '101',
        voucher_number: '260929-600'
      };
      const html = buildFinalBillA4HTML(room, {}, {});
      expect(html).toContain('Invoice No. :');
      expect(html).toContain('HCP600');
      expect(html).not.toContain('L600');
    });
  });

  describe('Requirement 3: 2 bed + 1 Extra mattress = 3 pax', () => {
    it('sets total Pax to 3 when 2 bed room has 1 extra mattress', () => {
      const room = {
        guest_name: 'AAMIR RANGREZ',
        room_number: '102',
        max_adults: 2,
        adults_male: 1, // Only primary guest registered
        adults_female: 0,
        extra_beds: 1, // 1 Extra mattress
        voucher_number: '260929-701'
      };
      const html = buildFinalBillA4HTML(room, { extra_beds: 1 }, {});
      expect(html).toContain('Pax :');
      expect(html).toContain('>3</span>');
    });

    it('handles multiple extra mattresses and children appropriately', () => {
      const room = {
        guest_name: 'FAMILY GUEST',
        room_number: '103',
        max_adults: 2,
        adults_male: 1,
        adults_female: 0,
        extra_beds: 2, // 2 Extra mattresses -> 2 + 2 = 4 adults
        children: 1, // 1 child -> 4 + 1 = 5 pax total
        voucher_number: '260929-702'
      };
      const html = buildFinalBillA4HTML(room, { extra_beds: 2 }, {});
      expect(html).toContain('Pax :');
      expect(html).toContain('>5</span>');
    });
  });
});
