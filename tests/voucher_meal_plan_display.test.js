import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: () => Promise.resolve(),
        outputPdf: () => Promise.resolve()
      })
    })
  })
}));

import { buildGuestRegistrationHTML } from '../src/services/printService';

describe('Voucher Meal Plan Display Test Suite', () => {
  const baseData = {
    guestName: 'Md Yahya Ab Wahid Mundewadi',
    mobile: '9028850715',
    roomNumber: '310',
    roomType: 'Suit Room',
    checkinTime: new Date().toISOString(),
    approxCheckout: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    stayNights: 1,
    bookingSource: 'Walk-in',
    voucher_number: '261005-625',
    total_room_charge: 3780,
    roomTariffNet: 3600,
    taxAmount: 180,
    totalPaid: 2000,
    splitCash: 2000
  };

  it('1. Displays "Without Breakfast" when mealPlan is "without_breakfast"', () => {
    const html = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'without_breakfast'
    });

    expect(html).toContain('Without Breakfast');
    expect(html).not.toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*With Breakfast/i);
    expect(html).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*Without Breakfast/i);
  });

  it('2. Displays "Without Breakfast" when mealPlan is "room_only" or "ep"', () => {
    const htmlRoomOnly = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'room_only'
    });
    expect(htmlRoomOnly).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*Without Breakfast/i);

    const htmlEp = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'ep'
    });
    expect(htmlEp).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*Without Breakfast/i);
  });

  it('3. Displays "With Breakfast" when mealPlan is "with_breakfast" or "cp"', () => {
    const htmlWith = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'with_breakfast'
    });
    expect(htmlWith).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*With Breakfast/i);

    const htmlCp = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'cp'
    });
    expect(htmlCp).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*With Breakfast/i);
  });

  it('4. Displays "Breakfast & Dinner" when mealPlan is "map"', () => {
    const html = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'map'
    });
    expect(html).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*Breakfast &amp; Dinner/i);
  });

  it('5. Displays "All Meals Included" when mealPlan is "ap"', () => {
    const html = buildGuestRegistrationHTML({
      ...baseData,
      mealPlan: 'ap'
    });
    expect(html).toMatch(/Meal Plan \/ Package:<\/td>\s*<td[^>]*>\s*All Meals Included/i);
  });
});
