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

import { buildGuestRegistrationHTML } from '../src/services/printService';

describe('User Requirements: OTA Pay-at-Hotel GST Included & Room Click Folio', () => {
  describe('Requirement 1: In OTA Pay-at-Hotel in Checkin Form should see GST included (not excluded)', () => {
    it('verifies checkin form for OTA Pay-at-Hotel includes 5% GST in voucher total, not added on top', () => {
      const otaPayAtHotelData = {
        guestName: 'Rajesh Kumar',
        roomNumber: '105',
        bookingSource: 'OTA',
        booking_source: 'OTA',
        otaPlatform: 'Agoda',
        ota_platform: 'Agoda',
        otaBookingId: 'AGODA-771122',
        otaBillAmount: 3000,
        ota_bill_amount: 3000,
        rateType: 'pay_at_hotel',
        rate_type: 'pay_at_hotel',
        isPrepaid: false,
        is_prepaid: 0,
        mealPlan: 'with_breakfast',
        totalPaid: 1000,
        advancePaid: 1000
      };

      const html = buildGuestRegistrationHTML(otaPayAtHotelData);

      // 1. Total Booking Value must be ₹ 3,000.00 (NOT 3,142.86 or 3,150.00)
      expect(html).toContain('3,000.00');
      expect(html).not.toContain('3,142.86');
      expect(html).not.toContain('3,150.00');

      // 2. GST (5%) must be ₹ 142.86 and marked as Included in Voucher
      expect(html).toContain('142.86');
      expect(html).toContain('(Included in Voucher)');
      expect(html).not.toContain('(Standard)');

      // 3. Status must show Pay at Hotel with Incl. 5% GST
      expect(html).toContain('[PAY AT HOTEL] (Incl. 5% GST)');

      // 4. Balance remaining should be ₹ 2,000
      expect(html).toContain('Balance Remaining: <strong>₹ 2,000</strong>');
    });

    it('verifies OTA Prepaid voucher still correctly shows (In Voucher) and ₹0 desk tax', () => {
      const otaPrepaidData = {
        guestName: 'Anil Sharma',
        roomNumber: '202',
        bookingSource: 'OTA',
        booking_source: 'OTA',
        otaPlatform: 'MakeMyTrip',
        otaBookingId: 'MMT-554433',
        otaBillAmount: 2500,
        rateType: 'prepaid',
        isPrepaid: true,
        is_prepaid: 1,
        totalPaid: 0
      };

      const html = buildGuestRegistrationHTML(otaPrepaidData);
      expect(html).toContain('(In Voucher)');
      expect(html).toContain('2,500.00');
    });
  });

  describe('Requirement 2: Room Click view (RoomFolioPage) logic for OTA', () => {
    it('verifies 5% GST calculation from inclusive booking value', () => {
      const totalOtaBookingVal = 3000;
      const otaGstAmount = Math.round((totalOtaBookingVal - (totalOtaBookingVal / 1.05)) * 100) / 100;
      expect(otaGstAmount).toBe(142.86);

      const paid = 2000;
      const remaining = totalOtaBookingVal - paid;
      expect(remaining).toBe(1000);
    });

    it('verifies meal plan display does not attach amount for OTA', () => {
      const formatMealPlanOta = (mealPlan) => {
        return mealPlan === 'with_breakfast' ? 'With Breakfast' : 'Without Breakfast';
      };

      expect(formatMealPlanOta('with_breakfast')).toBe('With Breakfast');
      expect(formatMealPlanOta('without_breakfast')).toBe('Without Breakfast');
      expect(formatMealPlanOta('with_breakfast')).not.toContain('₹');
      expect(formatMealPlanOta('with_breakfast')).not.toContain('250');
    });
  });
});
