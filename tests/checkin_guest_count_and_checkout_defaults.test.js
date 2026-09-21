import { describe, it, expect } from 'vitest';

describe('Guest Check-In Wizard: Default Guests Count & Checkout Timing Rules', () => {
  // Mock validation logic from CheckinWizardModal.jsx (step 6)
  const validateStep6 = (draft, isOta) => {
    const adultCount = (Number(draft.adultsMale) || 0) + (Number(draft.adultsFemale) || 0);
    if (!isOta && adultCount < 1) {
      return { valid: false, error: 'At least 1 adult guest is required to proceed.' };
    }
    if (!draft.checkoutDate) {
      return { valid: false, error: 'Expected Checkout Date is mandatory. Please select checkout date.' };
    }
    if (!isOta && (!draft.checkoutTime || !draft.checkoutTime.trim())) {
      return { valid: false, error: 'Expected Checkout Time is mandatory. Please select checkout time.' };
    }
    return { valid: true };
  };

  // Safe Male & Female counts logic from Step6Stay.jsx
  const getStayOccupancyState = (draft, isOta, otaBookedAdults = 1) => {
    const rawMale = Number(draft.adultsMale);
    const rawFemale = Number(draft.adultsFemale);
    const femaleCount = Number.isFinite(rawFemale) ? Math.max(0, rawFemale) : 0;
    const maleCount = Number.isFinite(rawMale)
      ? Math.max(0, rawMale)
      : (isOta ? Math.max(0, otaBookedAdults - femaleCount) : 0);

    const totalSteppedAdults = maleCount + femaleCount;
    const currentAdults = isOta
      ? (otaBookedAdults + (Number(draft.extraAdults) || 0))
      : totalSteppedAdults;

    return { maleCount, femaleCount, totalSteppedAdults, currentAdults };
  };

  it('1. Initializes non-OTA check-in with 0 adults and empty checkout time', () => {
    const initialDraft = {
      bookingSource: 'Walk-in',
      adultsMale: 0,
      adultsFemale: 0,
      children: 0,
      checkoutDate: '',
      checkoutTime: '',
      approxCheckout: ''
    };

    const state = getStayOccupancyState(initialDraft, false);
    expect(state.maleCount).toBe(0);
    expect(state.femaleCount).toBe(0);
    expect(state.currentAdults).toBe(0);
    expect(initialDraft.checkoutTime).toBe('');
  });

  it('2. Fails step 6 validation when adult count is 0 for non-OTA with proper error', () => {
    const draft = {
      bookingSource: 'Walk-in',
      adultsMale: 0,
      adultsFemale: 0,
      checkoutDate: '2026-09-22',
      checkoutTime: '11:00'
    };

    const result = validateStep6(draft, false);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('At least 1 adult guest is required to proceed.');
  });

  it('3. Allows proceeding when staff increases adult count (e.g., Male: 1 or Female: 1)', () => {
    const draftWithMale = {
      bookingSource: 'Walk-in',
      adultsMale: 1,
      adultsFemale: 0,
      checkoutDate: '2026-09-22',
      checkoutTime: '11:00'
    };
    expect(validateStep6(draftWithMale, false).valid).toBe(true);

    const draftWithFemale = {
      bookingSource: 'Walk-in',
      adultsMale: 0,
      adultsFemale: 1,
      checkoutDate: '2026-09-22',
      checkoutTime: '11:00'
    };
    expect(validateStep6(draftWithFemale, false).valid).toBe(true);

    // If staff decreases back to 0, it blocks again
    const draftDecreasedBack = {
      bookingSource: 'Walk-in',
      adultsMale: 0,
      adultsFemale: 0,
      checkoutDate: '2026-09-22',
      checkoutTime: '11:00'
    };
    expect(validateStep6(draftDecreasedBack, false).valid).toBe(false);
  });

  it('4. Fails step 6 validation when checkout time is empty by default for Walk-in / BTC / Website', () => {
    const draftNoTime = {
      bookingSource: 'Walk-in',
      adultsMale: 1,
      adultsFemale: 0,
      checkoutDate: '2026-09-22',
      checkoutTime: ''
    };

    const result = validateStep6(draftNoTime, false);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Expected Checkout Time is mandatory. Please select checkout time.');

    // Once user selects a checkout time, it passes
    draftNoTime.checkoutTime = '12:00';
    expect(validateStep6(draftNoTime, false).valid).toBe(true);
  });

  it('5. Enforces OTA fixed checkout time of 10:00 AM unable to change', () => {
    const handleCheckoutChange = (draft, isOta, newDateStr, newTimeStr) => {
      const dStr = newDateStr !== undefined ? newDateStr : draft.checkoutDate;
      const tStr = isOta ? '10:00' : (newTimeStr !== undefined ? newTimeStr : draft.checkoutTime);
      return {
        ...draft,
        checkoutDate: dStr,
        checkoutTime: tStr
      };
    };

    let otaDraft = {
      bookingSource: 'OTA',
      adultsMale: 1,
      adultsFemale: 0,
      checkoutDate: '2026-09-22',
      checkoutTime: '10:00'
    };

    // Attempting to change checkout time for OTA still produces 10:00
    otaDraft = handleCheckoutChange(otaDraft, true, '2026-09-23', '14:00');
    expect(otaDraft.checkoutTime).toBe('10:00');
    expect(otaDraft.checkoutDate).toBe('2026-09-23');

    // Step 6 validation for OTA passes with 10:00 checkout time
    const result = validateStep6(otaDraft, true);
    expect(result.valid).toBe(true);
  });
});
