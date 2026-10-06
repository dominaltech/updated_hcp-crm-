import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('User Requests: Locked GST & Base Tariff, Custom Cleaner Name on Other, Removed Filter Bar, All Cards in One Frame', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Check-in Step 6 Stay: base tariff and GST cannot be changed by user', () => {
    const step6Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf8');

    // Ensure inputs for modifying base tariff and GST are removed
    expect(step6Code).not.toContain('id="input-base-tariff"');
    expect(step6Code).not.toContain('id="input-gst-rate"');
    expect(step6Code).not.toContain('[0, 5, 12, 18].map');

    // Ensure Base Tariff and GST are displayed as locked / fixed
    expect(step6Code).toContain('Standard Base Tariff');
    expect(step6Code).toContain('🔒 Fixed');
    expect(step6Code).toContain('Room GST');
    expect(step6Code).toContain('🔒 Standard');

    // Ensure calculated base price and effective 5% GST are strictly enforced
    expect(step6Code).toContain('const effectiveGstPct = Number(roomGstPct) || 5;');
    expect(step6Code).toContain('const basePrice = (!isOta && currentAdults === 0)');
    expect(step6Code).not.toContain('_customBaseRate');

    // CheckinWizardModal also strictly enforces fixed basePrice & 5% GST
    const wizardModalCode = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'), 'utf8');
    expect(wizardModalCode).toContain('const basePrice = (!isOta && totalGuests === 0)');
    expect(wizardModalCode).not.toContain('_customBaseRate');
  });

  it('2. Room checked out ("needs_cleaning"): cleaner dropdown has "Other" and allows custom cleaner name', () => {
    const cleaningModalCode = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/RoomCleaningModal.jsx'), 'utf8');

    // State for custom cleaner name
    expect(cleaningModalCode).toContain('customCleanerName');
    expect(cleaningModalCode).toContain('setCustomCleanerName');

    // __OTHER__ option present in dropdown options
    expect(cleaningModalCode).toContain('__OTHER__');
    expect(cleaningModalCode).toContain('➕ Other (Type Custom Name)');

    // Custom input rendered when cleanerName === '__OTHER__'
    expect(cleaningModalCode).toContain('id="input-custom-cleaner-name"');
    expect(cleaningModalCode).toContain('Enter Cleaner / Staff Name');

    // Submits final cleaner name correctly
    expect(cleaningModalCode).toContain('finalCleanerName = cleanerName === \'__OTHER__\' ? customCleanerName.trim() : cleanerName.trim()');
    expect(cleaningModalCode).toContain('cleaner_name: finalCleanerName');
  });

  it('3. Rooms filter toolbar ("Rooms", "All Rooms 26", "Ready 23", etc.) is completely removed from HospitalityPage', () => {
    const hospCode = fs.readFileSync(path.join(rootDir, 'src/pages/HospitalityPage.jsx'), 'utf8');

    // Ensure section-toolbar with filter tabs is removed
    expect(hospCode).not.toContain('className="section-toolbar"');
    expect(hospCode).not.toContain('filter-tabs');
    expect(hospCode).not.toContain('Ready (Check-In)');
    expect(hospCode).not.toContain('Needs Cleaning (Housekeeping)');

    // Ensure all rooms are directly rendered into floors
    expect(hospCode).toContain('const filteredRooms = rooms;');
    expect(hospCode).toContain('floor-sections-container');
  });

  it('4. All cards visible in one frame without scrolling', () => {
    const cssCode = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf8');

    // Container height is locked to 100dvh minus header and overflow hidden
    expect(cssCode).toContain('.app-container:has(#view-hospitality.active)');
    expect(cssCode).toContain('height: calc(100dvh - 66px) !important;');
    expect(cssCode).toContain('overflow: hidden !important;');

    // 7 columns per row for 26 rooms layout
    expect(cssCode).toContain('grid-template-columns: repeat(7, minmax(0, 1fr)) !important;');

    // Compact card height to prevent scrolling without congestion
    expect(cssCode).toContain('height: clamp(');
    expect(cssCode).toContain('min-height:');
    expect(cssCode).toContain('max-height:');

    // Margins from left and right on screen and hover shadow padding
    expect(cssCode).toContain('padding: 2px 18px 2px !important;');
    expect(cssCode).toContain('max-width: 1720px !important;');
    expect(cssCode).toContain('gap: 5px 8px !important;');
    expect(cssCode).toContain('margin-top: 3px !important;');

    // Typography and darker styling
    expect(cssCode).toContain('.ready-big-number {');
    expect(cssCode).toContain('font-size: 2.05rem !important;');
    expect(cssCode).toContain('color: #064e3b !important;');

    // Darker colors for cards
    expect(cssCode).toContain('background: linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%) !important;');
    expect(cssCode).toContain('border: 1.5px solid #059669 !important;');

    const roomCardCode = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/RoomCard.jsx'), 'utf8');
    expect(roomCardCode).toContain('ready-big-number');
  });
});
