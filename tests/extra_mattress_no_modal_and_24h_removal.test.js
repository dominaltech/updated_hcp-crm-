import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Extra Mattress: No Unwanted Popup & 24 Hours Removal Suite', () => {
  const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
  const content = fs.readFileSync(step6Path, 'utf-8');

  it('1. Hotel Extra Mattress itemized breakdown renders Mattress(es) without "24 Hours"', () => {
    // Hotel Extra Mattress subtext should NOT have "x 24 Hours"
    expect(content).toContain(
      "${currentExtraBeds > otaBookedExtraBeds ? (currentExtraBeds - otaBookedExtraBeds) : currentExtraBeds} Mattress(es)${nights > 1 ? ` (${nights} Nights)` : ''}"
    );
    // Should NOT have the old pattern containing '24 Hours' in Hotel Extra Mattress line
    expect(content).not.toContain(
      "${currentExtraBeds > otaBookedExtraBeds ? (currentExtraBeds - otaBookedExtraBeds) : currentExtraBeds} Mattress(es) × ${nights === 1 ? '24 Hours'"
    );
  });

  it('2. OTA room card extra mattress stepper does not show (+₹... / 24 hrs)', () => {
    // Verify room card button invokes handleDirectAddExtraBed
    expect(content).toContain('onClick={() => handleDirectAddExtraBed(r.id)}');
    // Verify OTA stepper does not display rate badge
    expect(content).not.toContain('(+₹{getRoomExtraBedRate(r)} / 24 hrs)');
  });

  it('3. Walk-in room card extra mattress stepper does not show (+₹... / 24 hrs)', () => {
    const walkinSection = content.slice(content.indexOf('Walk-in Room Card'), content.indexOf('Walk-in Room Card') + 3000);
    expect(walkinSection).not.toContain('/ 24 hrs');
  });

  it('4. Guest capacity tracker status does not show (+₹... / 24 hrs)', () => {
    expect(content).toContain("`✓ ${maxExtraAdultsForRooms} extra guest spot${maxExtraAdultsForRooms > 1 ? 's' : ''} available in room`");
    expect(content).not.toContain("`✓ ${maxExtraAdultsForRooms} extra guest spot${maxExtraAdultsForRooms > 1 ? 's' : ''} available in room (+₹${extraBedRate} / 24 hrs)`");
  });

  it('5. handleRoomExtraBedChange directly calls handleDirectAddExtraBed on positive delta', () => {
    const fnStart = content.indexOf('const handleRoomExtraBedChange =');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = content.slice(fnStart, fnStart + 500);
    expect(fnBody).toContain('handleDirectAddExtraBed(roomId)');
    expect(fnBody).not.toContain("handleOpenExtraBedModal(roomId, 'add')");
  });

  it('6. extraBedModal popup modal is completely disabled from rendering', () => {
    expect(content).toContain('{false && extraBedModal.isOpen && (() => {');
  });
});
