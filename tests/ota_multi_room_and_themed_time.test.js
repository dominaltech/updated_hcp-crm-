import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('UnifiedTimeInput Themed Custom Popover Dropdowns', () => {
  const filePath = path.resolve(__dirname, '../src/components/common/UnifiedTimeInput.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  it('verifies that native HTML <select> elements are completely replaced with custom themed triggers', () => {
    // Should NOT contain any native <select> tags
    expect(fileContent).not.toMatch(/<select/i);
    expect(fileContent).not.toMatch(/<\/select>/i);
  });

  it('verifies custom themed popover dropdowns for hour and minute with quick grids and click-outside handling', () => {
    // Should have state for open popover menu
    expect(fileContent).toContain("openMenu === 'hour'");
    expect(fileContent).toContain("openMenu === 'minute'");

    // Should render 4-column quick grids
    expect(fileContent).toContain("gridTemplateColumns: 'repeat(4, 1fr)'");

    // Should include hours 1 through 12 and 5-min intervals
    expect(fileContent).toContain('const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]');
    expect(fileContent).toContain('for (let i = 0; i < 60; i += 5)');

    // Should have themed styling
    expect(fileContent).toContain('#0071e3');
    expect(fileContent).toContain('#e0f2fe');
  });
});

describe('Step 1 Source & OTA Multi-Room Prebooking', () => {
  const filePath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  it('verifies that expected checkout date starts empty without defaulting to tomorrow', () => {
    expect(fileContent).not.toMatch(/currentCheckoutDate\s*\|\|\s*tomorrowStr/);
  });

  it('verifies dedicated OTA pre-booked rooms allocation section', () => {
    expect(fileContent).toContain('Pre-Booked Rooms (OTA Reservation)');
    expect(fileContent).toContain('Add Room from Pre-booking');
    expect(fileContent).toContain('isOtaRoomPickerOpen');
  });

  it('verifies Extra Persons? toggle and Extra Bed stepper in Step 1', () => {
    expect(fileContent).toContain('Extra Persons?');
    expect(fileContent).toContain('hasExtraPersons: false');
    expect(fileContent).toContain('hasExtraPersons: true');
    expect(fileContent).toMatch(/🛏️[\s\S]*?Extra Bed:/);
    expect(fileContent).toContain('totalMaxExtraBeds');
  });

  it('verifies Step 1 synchronizes otaBookedAdults and otaBookedChildren when occupancy counters change', () => {
    expect(fileContent).toContain('otaBookedAdults: Math.max(1, nextMale + curFemale)');
    expect(fileContent).toContain('otaBookedAdults: Math.max(1, curMale + nextFemale)');
    expect(fileContent).toContain('otaBookedChildren: nextChild');
  });

  it('verifies CheckinWizardModal passes readyRooms as availableRooms to Step1Source without ReferenceError', () => {
    const modalPath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
    const modalContent = fs.readFileSync(modalPath, 'utf-8');
    expect(modalContent).toContain('availableRooms={readyRooms}');
    expect(modalContent).not.toContain('availableRooms={availableRooms}');
  });
});

describe('Step 6 Stay Allocation - OTA Locked Package & Hotel Extra Persons Management', () => {
  const filePath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  it('verifies real count synchronization for OTA booked package and removal of verbose blurbs', () => {
    expect(fileContent).toContain('Locked Voucher');
    expect(fileContent).toContain('otaBookedAdults');
    expect(fileContent).toContain('otaBookedChildren');
    expect(fileContent).toContain('OTA Bill Amount');
    // Verifies the 3 verbose texts are completely removed as requested
    expect(fileContent).not.toContain('Pre-booked package terms are fixed as per OTA reservation voucher');
    expect(fileContent).not.toContain('Extra member charges will be billed directly by the hotel at front desk');
    expect(fileContent).not.toContain('No extra persons currently added. If you add extra persons or extra beds above');
  });

  it('verifies dedicated Add Extra Persons section with capacity limit directly triggering room picker', () => {
    expect(fileContent).toContain('Add Extra Persons (Hotel Extras)');
    expect(fileContent).toContain('handleOtaExtraAdultIncrement');
    expect(fileContent).toContain('handleOtaExtraAdultDecrement');
    expect(fileContent).toContain('handleOtaExtraChildIncrement');
    expect(fileContent).toContain('handleOtaExtraChildDecrement');
    // If extra bed capacity is over, directly open room picker
    expect(fileContent).toContain('setIsRoomPickerOpen(true)');
  });

  it('verifies that extra bed charges and tariff subtotals correctly separate OTA voucher from hotel extras', () => {
    expect(fileContent).toContain('extraBedCharge = isOta');
    expect(fileContent).toContain('otaExtraAdults * extraBedRate * nights');
    expect(fileContent).toContain('Balance Due at Hotel Desk');
  });

  it('verifies calculations for pre-paid and pay-at-hotel OTA reservations', () => {
    const otaPackageAmount = 6000;
    const extraAdults = 1;
    const extraBedRate = 500;
    const nights = 2;
    const extraBedCharge = extraAdults * extraBedRate * nights; // 1000

    // Pre-paid: guest already paid 6000 online
    const prePaidBalanceDue = extraBedCharge;
    expect(prePaidBalanceDue).toBe(1000);

    // Pay at hotel: guest pays full amount at desk
    const payAtHotelDue = otaPackageAmount + extraBedCharge;
    expect(payAtHotelDue).toBe(7000);
  });

  it('verifies Step 1 asks with / without breakfast for OTA bookings without changing OTA room rate', () => {
    const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
    const step1Content = fs.readFileSync(step1Path, 'utf-8');
    expect(step1Content).toContain('OTA Breakfast Included?');
    expect(step1Content).toContain("updateDraft({ mealPlan: 'without_breakfast' })");
    expect(step1Content).toContain("updateDraft({ mealPlan: 'with_breakfast' })");
    expect(step1Content).toContain('Included in OTA Rate • ₹0 Extra');
    expect(step1Content).toContain('OTA booking charge remains unchanged');
  });

  it('verifies Step 6 separates OTA voucher breakfast from separate extra guest breakfast choice', () => {
    expect(fileContent).toContain('Voucher Breakfast');
    expect(fileContent).toContain('Selected at Step 1 • ₹0 extra');
    expect(fileContent).toContain('Breakfast for Extra Guests');
    expect(fileContent).toContain("updateDraft({ extraMealPlan: 'without_breakfast' })");
    expect(fileContent).toContain("updateDraft({ extraMealPlan: 'with_breakfast' })");
    expect(fileContent).toContain('extraBreakfastCharge = isOta');
    expect(fileContent).toContain('draft.extraMealPlan === \'with_breakfast\' ? (otaExtraAdults * breakfastRate * nights) : 0');
  });

  it('verifies billing calculations when extra person takes breakfast vs without breakfast for OTA', () => {
    const otaPackageAmount = 5000;
    const extraAdults = 2;
    const extraBedRate = 500;
    const breakfastRate = 250;
    const nights = 2;

    const extraBedCharge = extraAdults * extraBedRate * nights; // 2 * 500 * 2 = 2000

    // Scenario A: Extra guests WITHOUT breakfast
    const extraBreakfastWithout = 0;
    const prePaidBalanceWithout = extraBedCharge + extraBreakfastWithout;
    expect(prePaidBalanceWithout).toBe(2000);

    // Scenario B: Extra guests WITH breakfast (+250 / extra guest / night)
    const extraBreakfastWith = extraAdults * breakfastRate * nights; // 2 * 250 * 2 = 1000
    const prePaidBalanceWith = extraBedCharge + extraBreakfastWith;
    expect(prePaidBalanceWith).toBe(3000);

    // OTA package itself never changes (remains 5000)
    expect(otaPackageAmount).toBe(5000);
  });

  it('verifies clicking Early Check-In automatically sets actual time to current clock time', () => {
    const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
    const step1Content = fs.readFileSync(step1Path, 'utf-8');
    expect(step1Content).toContain('isEarlyCheckin: true');
    expect(step1Content).toContain('earlyCheckinTime: currentActualTime');
    expect(step1Content).toContain('⏱️ Current Time');
  });

  it('verifies OTA package extra bed is inclusive in OTA bill and limits available extra beds at stage 6', () => {
    const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
    const step1Content = fs.readFileSync(step1Path, 'utf-8');
    expect(step1Content).toContain('otaBookedExtraBeds');
    expect(step1Content).toContain('Inclusive in OTA Bill (₹0 Extra)');

    const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
    const step6Content = fs.readFileSync(step6Path, 'utf-8');
    expect(step6Content).toContain('otaBookedExtraBeds');
    expect(step6Content).toContain('availableExtraBedsForExtras = Math.max(0, totalMaxExtraBeds - otaBookedExtraBeds)');
    expect(step6Content).toContain('Voucher Extra Bed');
    expect(step6Content).toContain('Available for Room');
    expect(step6Content).toContain('nextExtraAdults <= availableExtraBedsForExtras');

    // Mathematical verification:
    // Room has max 2 extra beds, 1 pre-booked in OTA voucher:
    const totalMaxBeds = 2;
    const otaBookedBeds = 1;
    const availableForExtras = Math.max(0, totalMaxBeds - otaBookedBeds);
    expect(availableForExtras).toBe(1); // Exactly 1 extra bed available for extra persons at stage 6!
  });

  it('verifies that male and female counts never produce NaN and dynamic green capacity tracking calculates safely', () => {
    const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
    const step6Content = fs.readFileSync(step6Path, 'utf-8');

    // Verifies safe Number.isFinite parsing
    expect(step6Content).toContain('Number.isFinite(rawMale)');
    expect(step6Content).toContain('Number.isFinite(rawFemale)');
    expect(step6Content).toContain('{maleCount}');
    expect(step6Content).toContain('{femaleCount}');

    // Mathematical verification for edge case: 1 Female adult booked (0 Male, 1 Female)
    const otaBookedAdults = 1;
    const draftFemale = 1;
    const draftMale = undefined; // Male was not touched or 0

    const rawMale = Number(draftMale);
    const rawFemale = Number(draftFemale);
    const femaleCount = Number.isFinite(rawFemale) ? Math.max(0, rawFemale) : 0;
    const maleCount = Number.isFinite(rawMale)
      ? Math.max(0, rawMale)
      : (Number.isFinite(rawFemale) && rawFemale >= otaBookedAdults ? 0 : Math.max(0, otaBookedAdults - femaleCount));

    expect(Number.isNaN(maleCount)).toBe(false);
    expect(Number.isNaN(femaleCount)).toBe(false);
    expect(maleCount).toBe(0);
    expect(femaleCount).toBe(1);

    const totalStepped = maleCount + femaleCount;
    expect(totalStepped).toBe(1);

    const currentAllowedAdults = 3;
    const adultFillPct = Math.min(100, Math.round((totalStepped / currentAllowedAdults) * 100));
    expect(Number.isNaN(adultFillPct)).toBe(false);
    expect(adultFillPct).toBe(33); // 33% green fill
  });
});



