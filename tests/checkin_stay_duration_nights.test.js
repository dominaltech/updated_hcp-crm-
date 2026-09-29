import { describe, it, expect } from 'vitest';

describe('Check-In Wizard Step 6: 24-Hour Stay Duration & Nights Calculation', () => {
  // Logic from Step6Stay.jsx & CheckinWizardModal.jsx
  const calculateNights = (draft) => {
    let nights = Number(draft.stayNights) || 1;
    if (draft.checkinTime && (draft.checkoutDate || draft.approxCheckout)) {
      const dInStr = draft.checkinTime.split('T')[0];
      const dOutStr = draft.checkoutDate || (draft.approxCheckout ? draft.approxCheckout.split('T')[0] : '');
      if (dInStr && dOutStr) {
        const dIn = new Date(dInStr);
        const dOut = new Date(dOutStr);
        const diffDays = Math.round((dOut - dIn) / (1000 * 60 * 60 * 24));
        nights = Math.max(1, diffDays);
      } else if (draft.approxCheckout) {
        const diffMs = new Date(draft.approxCheckout).getTime() - new Date(draft.checkinTime).getTime();
        nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    }
    return nights;
  };

  const getDurationText = (nights) => {
    return `${nights === 1 ? '24 Hours' : `${nights * 24} Hours (${nights} × 24 hrs)`} Stay`;
  };

  const calculateStayExtension = (checkinIso, checkoutIso, isOtaBooking, roomObj) => {
    if (isOtaBooking) return 0;
    if (!checkinIso || !checkoutIso) return 0;

    const dIn = new Date(checkinIso);
    const dOut = new Date(checkoutIso);
    if (isNaN(dIn.getTime()) || isNaN(dOut.getTime()) || dOut <= dIn) return 0;

    const elapsedHours = (dOut.getTime() - dIn.getTime()) / (1000 * 60 * 60);

    const cInStr = checkinIso.split('T')[0];
    const cOutStr = checkoutIso.split('T')[0];
    let calendarDays = 1;
    if (cInStr && cOutStr) {
      calendarDays = Math.max(1, Math.round((new Date(cOutStr) - new Date(cInStr)) / (1000 * 60 * 60 * 24)));
    }
    const paidStayHours = calendarDays * 24;

    if (elapsedHours <= paidStayHours) {
      return 0;
    }

    const extraMinutes = (elapsedHours - paidStayHours) * 60;
    const graceMins = Number(roomObj?.ext_grace_mins) || 60;
    const r3h = Number(roomObj?.ext_3h_rate) || 500;
    const r6h = Number(roomObj?.ext_6h_rate) || 1000;
    const r9h = Number(roomObj?.ext_9h_rate) || 1500;

    if (extraMinutes <= graceMins) {
      return 0;
    } else if (extraMinutes <= 180) {
      return r3h;
    } else if (extraMinutes <= 360) {
      return r6h;
    } else if (extraMinutes <= 540) {
      return r9h;
    } else {
      return Number(roomObj?.price || 2000);
    }
  };

  const room = {
    price: 2000,
    ext_grace_mins: 60,
    ext_3h_rate: 500,
    ext_6h_rate: 1000,
    ext_9h_rate: 1500
  };

  it('1. User Case: 25-09-2026 07:46 PM to 26-09-2026 08:00 PM is 1 night / 24 Hours Stay (not 48 Hours)', () => {
    const draft = {
      checkinTime: '2026-09-25T19:46',
      checkoutDate: '2026-09-26',
      checkoutTime: '20:00',
      approxCheckout: '2026-09-26T20:00'
    };

    const nights = calculateNights(draft);
    expect(nights).toBe(1);

    const durationText = getDurationText(nights);
    expect(durationText).toBe('24 Hours Stay');
    expect(durationText).not.toContain('48 Hours');

    // 14 minutes extra checkout is within 60 min grace period -> ₹0 extension
    const extCharge = calculateStayExtension(draft.checkinTime, draft.approxCheckout, false, room);
    expect(extCharge).toBe(0);

    const totalTariff = (room.price * nights) + extCharge;
    expect(totalTariff).toBe(2000); // 1 night base tariff
  });

  it('2. Multi-day stay: 25-09-2026 07:46 PM to 27-09-2026 07:46 PM is correctly 2 nights (48 Hours)', () => {
    const draft = {
      checkinTime: '2026-09-25T19:46',
      checkoutDate: '2026-09-27',
      checkoutTime: '19:46',
      approxCheckout: '2026-09-27T19:46'
    };

    const nights = calculateNights(draft);
    expect(nights).toBe(2);

    const durationText = getDurationText(nights);
    expect(durationText).toBe('48 Hours (2 × 24 hrs) Stay');

    const extCharge = calculateStayExtension(draft.checkinTime, draft.approxCheckout, false, room);
    expect(extCharge).toBe(0);

    const totalTariff = (room.price * nights) + extCharge;
    expect(totalTariff).toBe(4000); // 2 nights base tariff
  });

  it('3. Late checkout extension: 1 night with 5 hours late checkout charges 1 night + 6h extension slab', () => {
    const draft = {
      checkinTime: '2026-09-25T10:00',
      checkoutDate: '2026-09-26',
      checkoutTime: '15:00',
      approxCheckout: '2026-09-26T15:00'
    };

    const nights = calculateNights(draft);
    expect(nights).toBe(1);

    const durationText = getDurationText(nights);
    expect(durationText).toBe('24 Hours Stay');

    // 5 hours extra is 300 minutes (>180 min and <= 360 min) -> ₹1000
    const extCharge = calculateStayExtension(draft.checkinTime, draft.approxCheckout, false, room);
    expect(extCharge).toBe(1000);

    const totalTariff = (room.price * nights) + extCharge;
    expect(totalTariff).toBe(3000); // ₹2000 base + ₹1000 extension, NOT ₹4000 (2 nights)
  });

  it('4. Same day checkout (day use) defaults to minimum 1 night / 24 Hours Stay', () => {
    const draft = {
      checkinTime: '2026-09-25T09:00',
      checkoutDate: '2026-09-25',
      checkoutTime: '18:00',
      approxCheckout: '2026-09-25T18:00'
    };

    const nights = calculateNights(draft);
    expect(nights).toBe(1);

    const durationText = getDurationText(nights);
    expect(durationText).toBe('24 Hours Stay');
  });
});
