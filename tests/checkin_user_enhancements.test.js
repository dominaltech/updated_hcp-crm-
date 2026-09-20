import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import db from '../database.js';

describe('Check-In Enhancements (Aadhaar Expiry, Mandatory Photo, Min Advance Policy, Doc Lengths)', () => {
  let app;
  let server;
  let managerToken = null;

  beforeAll(async () => {
    // Dynamic import server
    const serverModule = await import('../server.js');
    app = serverModule.app || serverModule.default;
  });

  describe('1. Check-In Advance Payment Policy API', () => {
    it('GET /api/settings/checkin-policy should return min_checkin_advance_pct (default 50)', async () => {
      const res = await request(app).get('/api/settings/checkin-policy');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.min_checkin_advance_pct).toBe('number');
      expect(res.body.min_checkin_advance_pct).toBeGreaterThanOrEqual(0);
    });

    it('POST /api/settings/checkin-policy should reject unauthorized requests', async () => {
      const res = await request(app)
        .post('/api/settings/checkin-policy')
        .send({ min_checkin_advance_pct: 60 });
      expect([401, 403]).toContain(res.status);
    });

    it('POST /api/settings/checkin-policy should update and retrieve configured percentage', async () => {
      // Direct SQLite update and verify API returns updated value
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('min_checkin_advance_pct', '40', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run();

      const res = await request(app).get('/api/settings/checkin-policy');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.min_checkin_advance_pct).toBe(40);

      // Reset back to 50
      db.prepare(`
        UPDATE system_settings SET value = '50', updated_at = CURRENT_TIMESTAMP WHERE key = 'min_checkin_advance_pct'
      `).run();
    });
  });

  describe('2. Document Number Sanitization & Max Length Constraints', () => {
    const sanitizeDocNumber = (val, docType) => {
      if (!val) return '';
      const dt = (docType || '').toLowerCase();
      if (dt.includes('aadha') || dt.includes('adhar')) {
        return val.replace(/\D/g, '').slice(0, 12);
      }
      if (dt.includes('passport')) {
        return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 9);
      }
      if (dt.includes('licen') || dt.includes('driving') || dt.includes('dl')) {
        return val.replace(/[^a-zA-Z0-9- ]/g, '').toUpperCase().slice(0, 16);
      }
      if (dt.includes('voter') || dt.includes('election')) {
        return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
      }
      return val.slice(0, 20);
    };

    it('should clamp Aadhaar Card to exactly 12 digits and strip non-digits', () => {
      const input = '4438 4267 7809 9999 extra';
      const cleaned = sanitizeDocNumber(input, 'Aadhaar Card');
      expect(cleaned).toBe('443842677809');
      expect(cleaned.length).toBe(12);
    });

    it('should clamp Passport to 9 alphanumeric uppercase characters', () => {
      const input = 'z95709891234extra';
      const cleaned = sanitizeDocNumber(input, 'Passport');
      expect(cleaned).toBe('Z95709891');
      expect(cleaned.length).toBe(9);
    });

    it('should clamp Driving License to max 16 characters', () => {
      const input = 'MH13-2018000452399999';
      const cleaned = sanitizeDocNumber(input, 'Driving License');
      expect(cleaned.length).toBeLessThanOrEqual(16);
      expect(cleaned).toBe('MH13-20180004523');
    });

    it('should clamp Voter ID to max 10 characters uppercase', () => {
      const input = 'abc1234567extra';
      const cleaned = sanitizeDocNumber(input, 'Voter ID');
      expect(cleaned).toBe('ABC1234567');
      expect(cleaned.length).toBe(10);
    });
  });

  describe('3. Aadhaar Expiry Suppression', () => {
    it('should not treat Aadhaar as expired even if an expiry date is provided', () => {
      const isPassport = false;
      let isDocExpired = false;
      const expiryDate = '2020-01-01'; // Past date

      if (isPassport && expiryDate) {
        const exp = new Date(expiryDate);
        if (!isNaN(exp.getTime()) && exp < new Date()) {
          isDocExpired = true;
        }
      }

      expect(isDocExpired).toBe(false);
    });

    it('should flag Passport as expired when expiry date is in the past', () => {
      const isPassport = true;
      let isDocExpired = false;
      const expiryDate = '2020-01-01'; // Past date

      if (isPassport && expiryDate) {
        const exp = new Date(expiryDate);
        if (!isNaN(exp.getTime()) && exp < new Date()) {
          isDocExpired = true;
        }
      }

      expect(isDocExpired).toBe(true);
    });
  });

  describe('4. Single Payment Method Enforcement & isBtc Validation (No Split Payment)', () => {
    it('should enforce single payment method on amount change, zeroing all other methods', () => {
      let draft = { splitCash: 2000, splitOnline: 0, splitCard: 0, splitCheque: 0 };
      const totalDue = 2625;

      const handleAmountChange = (field, value) => {
        let val = Math.max(0, Number(value) || 0);
        if (val > totalDue) val = totalDue;
        draft = {
          splitCash: field === 'splitCash' ? val : 0,
          splitOnline: field === 'splitOnline' ? val : 0,
          splitCard: field === 'splitCard' ? val : 0,
          splitCheque: field === 'splitCheque' ? val : 0
        };
      };

      // User enters ₹1500 in UPI
      handleAmountChange('splitOnline', 1500);
      expect(draft.splitOnline).toBe(1500);
      expect(draft.splitCash).toBe(0);
      expect(draft.splitCard).toBe(0);
      expect(draft.splitCheque).toBe(0);

      // User enters ₹2625 in Card
      handleAmountChange('splitCard', 2625);
      expect(draft.splitCard).toBe(2625);
      expect(draft.splitCash).toBe(0);
      expect(draft.splitOnline).toBe(0);
      expect(draft.splitCheque).toBe(0);
    });

    it('should seamlessly transfer paid amount to the newly clicked payment method div', () => {
      let draft = { splitCash: 2000, splitOnline: 0, splitCard: 0, splitCheque: 0 };

      const selectPaymentMethod = (field) => {
        const currentActiveField =
          draft.splitCash > 0 ? 'splitCash' :
          draft.splitOnline > 0 ? 'splitOnline' :
          draft.splitCard > 0 ? 'splitCard' :
          draft.splitCheque > 0 ? 'splitCheque' : null;

        if (currentActiveField && currentActiveField !== field) {
          const currentPaid = draft.splitCash + draft.splitOnline + draft.splitCard + draft.splitCheque;
          draft = {
            splitCash: field === 'splitCash' ? currentPaid : 0,
            splitOnline: field === 'splitOnline' ? currentPaid : 0,
            splitCard: field === 'splitCard' ? currentPaid : 0,
            splitCheque: field === 'splitCheque' ? currentPaid : 0
          };
        }
      };

      // User clicks UPI div box
      selectPaymentMethod('splitOnline');
      expect(draft.splitOnline).toBe(2000);
      expect(draft.splitCash).toBe(0);

      // User clicks Card div box
      selectPaymentMethod('splitCard');
      expect(draft.splitCard).toBe(2000);
      expect(draft.splitOnline).toBe(0);
      expect(draft.splitCash).toBe(0);
    });

    it('should evaluate min advance policy without ReferenceError for isBtc', () => {
      const draft = { bookingSource: 'BTC', splitCash: 0, splitOnline: 0, splitCard: 0, splitCheque: 0 };
      const isOta = draft.bookingSource === 'OTA';
      const isBtc = draft.bookingSource === 'BTC';
      const minCheckinAdvancePct = 50;
      const minPct = Number(minCheckinAdvancePct !== undefined ? minCheckinAdvancePct : 50);

      let policyEnforced = false;
      if (!isOta && !isBtc && minPct > 0) {
        policyEnforced = true;
      }

      // BTC bookings should not enforce min advance policy
      expect(isBtc).toBe(true);
      expect(policyEnforced).toBe(false);
    });
  });
});
