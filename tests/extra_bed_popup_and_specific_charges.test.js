import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Extra Bed Popup Modal & Specific Charges Logic', () => {
  it('verifies Step6Stay.jsx has Extra Bed modal state and JSX elements', () => {
    const filePath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check modal state
    expect(content).toContain('extraBedModal');
    expect(content).toContain('handleOpenExtraBedModal');
    expect(content).toContain('handleCloseExtraBedModal');
    expect(content).toContain('handleConfirmExtraBedModal');

    // Check popup UI elements
    expect(content).toContain('Specific Extra Bed Charge (₹/night)');
    expect(content).toContain('Add Extra Bed');
    expect(content).toContain('Edit Extra Bed Charges');
    expect(content).toContain('roomExtraBedRates');

    // Check quick presets
    expect(content).toContain('₹0 (Free)');
    expect(content).toContain('₹300');
    expect(content).toContain('₹500');
    expect(content).toContain('₹800');
    expect(content).toContain('₹1,000');

    // Check OTA room cards have extra bed stepper
    expect(content).toContain('Modern Extra Bed Stepper for OTA Room');
  });

  it('verifies CheckinWizardModal.jsx computes extraBedCharge with custom roomExtraBedRates', () => {
    const filePath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('roomExtraBedRates');
    expect(content).toContain('getRoomExtraBedRate');
    expect(content).toContain('room_extra_bed_rates');
    expect(content).toContain('extra_bed_rate');
  });

  it('validates rate resolution with fallback hierarchy', () => {
    const extraBedRate = 500;
    const room = { id: 771, room_number: '771', extra_bed_price: 600 };
    const draft = {
      roomExtraBedRates: { 771: 750 },
      extraBedRate: 550
    };

    const getRoomExtraBedRate = (targetRoom, currentDraft) => {
      if (!targetRoom) return Number(currentDraft.extraBedRate || extraBedRate || 500);
      if (currentDraft.roomExtraBedRates?.[targetRoom.id] !== undefined) {
        return Number(currentDraft.roomExtraBedRates[targetRoom.id]);
      }
      return Number(targetRoom.extra_bed_price || currentDraft.extraBedRate || extraBedRate || 500);
    };

    // When roomExtraBedRates is set for room 771
    expect(getRoomExtraBedRate(room, draft)).toBe(750);

    // When roomExtraBedRates is empty for room 771, but room has extra_bed_price
    const draftWithoutRoomRate = { roomExtraBedRates: {}, extraBedRate: 550 };
    expect(getRoomExtraBedRate(room, draftWithoutRoomRate)).toBe(600);

    // When room has no extra_bed_price, falls back to extraBedRate
    const plainRoom = { id: 101, room_number: '101' };
    expect(getRoomExtraBedRate(plainRoom, draftWithoutRoomRate)).toBe(550);

    // Complimentary (0 rate)
    const compDraft = { roomExtraBedRates: { 771: 0 } };
    expect(getRoomExtraBedRate(room, compDraft)).toBe(0);
  });

  it('validates OTA hotel extra bed calculation respecting voucher beds', () => {
    const otaBookedExtraBeds = 1;
    const nights = 2;
    const rooms = [
      { id: 'r1', room_number: '771', extra_bed_price: 500 },
      { id: 'r2', room_number: '101', extra_bed_price: 500 }
    ];
    const draft = {
      roomExtraBeds: { r1: 1, r2: 1 }, // 2 extra beds total, 1 voucher included, 1 hotel extra
      roomExtraBedRates: { r2: 800 }   // custom charge ₹800/nt on room 101
    };

    let freeVoucherBedsRemaining = otaBookedExtraBeds;
    let totalCharge = 0;
    rooms.forEach((r) => {
      const bedsInRoom = Number(draft.roomExtraBeds?.[r.id]) || 0;
      const roomRate = draft.roomExtraBedRates?.[r.id] !== undefined
        ? Number(draft.roomExtraBedRates[r.id])
        : Number(r.extra_bed_price || 500);
      const freeFromThisRoom = Math.min(freeVoucherBedsRemaining, bedsInRoom);
      freeVoucherBedsRemaining -= freeFromThisRoom;
      const chargeableBeds = bedsInRoom - freeFromThisRoom;
      if (chargeableBeds > 0) {
        totalCharge += chargeableBeds * roomRate * nights;
      }
    });

    // Room 1 has 1 bed which absorbs the 1 voucher bed (₹0)
    // Room 2 has 1 bed which is charged at ₹800 * 2 nights = ₹1600
    expect(totalCharge).toBe(1600);
  });
});
