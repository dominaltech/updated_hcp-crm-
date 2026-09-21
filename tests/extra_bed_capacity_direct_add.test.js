import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Extra Bed Capacity & Direct Add Verification', () => {
  const step6Path = path.join(process.cwd(), 'src', 'components', 'hospitality', 'CheckinWizard', 'Step6Stay.jsx');
  const content = fs.readFileSync(step6Path, 'utf8');

  it('1. handleAddExtraBedAndGuest must directly add extra bed with declared charges and NOT call handleOpenExtraBedModal', () => {
    // Verify handleAddExtraBedAndGuest does NOT call handleOpenExtraBedModal
    const fnStart = content.indexOf('const handleAddExtraBedAndGuest =');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = content.slice(fnStart, fnStart + 2500);
    
    expect(fnBody).not.toContain("handleOpenExtraBedModal(targetRoomId, 'add'");
    expect(fnBody).not.toContain("handleOpenExtraBedModal");
    expect(fnBody).toContain('getRoomExtraBedRate(targetRoom)');
    expect(fnBody).toContain('setCapacityPrompt({ isOpen: false');
    expect(fnBody).toContain('updateDraft(updates)');
  });

  it('2. handleDirectAddExtraBed must exist and directly increment room extra beds with declared rate', () => {
    expect(content).toContain('const handleDirectAddExtraBed = (targetRoomId) => {');
    const fnStart = content.indexOf('const handleDirectAddExtraBed =');
    const fnBody = content.slice(fnStart, fnStart + 1200);
    expect(fnBody).toContain('getRoomExtraBedRate(targetRoom)');
    expect(fnBody).toContain('roomExtraBeds: updatedRoomExtraBeds');
    expect(fnBody).toContain('roomExtraBedRates: updatedRoomExtraBedRates');
  });

  it('3. handleOtaExtraAdultIncrement must open capacityPrompt with same UI when extra beds are needed or capacity reached', () => {
    const fnStart = content.indexOf('const handleOtaExtraAdultIncrement =');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = content.slice(fnStart, fnStart + 1800);

    expect(fnBody).not.toContain("handleOpenExtraBedModal(targetRoom?.id, 'add'");
    expect(fnBody).toContain('setCapacityPrompt({');
    expect(fnBody).toContain("mode: 'options'");
    expect(fnBody).toContain("mode: 'only_room'");
  });

  it('4. Room card + button for extra beds must directly add without opening modal', () => {
    // Verify room card button invokes handleDirectAddExtraBed
    expect(content).toContain('onClick={() => handleDirectAddExtraBed(r.id)}');
  });

  it('5. handleRoomExtraBedChange must directly add when delta > 0', () => {
    const fnStart = content.indexOf('const handleRoomExtraBedChange =');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = content.slice(fnStart, fnStart + 500);
    expect(fnBody).toContain('handleDirectAddExtraBed(roomId)');
    expect(fnBody).not.toContain("handleOpenExtraBedModal(roomId, 'add')");
  });
});
