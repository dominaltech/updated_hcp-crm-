import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('User Requests Validation: Floors, PDF AutoCrop, 25% Discount, Mobile on Invoice, UPI MDR Fee, Daily Closing IGST', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. database.js and dbCleanService have floor column and default rooms floors', () => {
    const dbCode = fs.readFileSync(path.join(rootDir, 'database.js'), 'utf8');
    expect(dbCode).toContain("floor TEXT DEFAULT 'First Floor'");
    expect(dbCode).toContain("ALTER TABLE rooms ADD COLUMN floor TEXT DEFAULT 'First Floor'");
    expect(dbCode).toContain("floor: 'First Floor'");
    expect(dbCode).toContain("floor: 'Second Floor'");
    expect(dbCode).toContain("floor: 'Third Floor'");
    expect(dbCode).toContain("floor: 'Fourth Floor'");

    const dbCleanCode = fs.readFileSync(path.join(rootDir, 'services/dbCleanService.js'), 'utf8');
    expect(dbCleanCode).toContain("floor: 'First Floor'");
    expect(dbCleanCode).toContain("floor: 'Second Floor'");
    expect(dbCleanCode).toContain("floor: 'Third Floor'");
    expect(dbCleanCode).toContain("floor: 'Fourth Floor'");
  });

  it('1b. HospitalityPage renders floor groupings and centered section headers', () => {
    const hospCode = fs.readFileSync(path.join(rootDir, 'src/pages/HospitalityPage.jsx'), 'utf8');
    expect(hospCode).toContain('floor-sections-container');
    expect(hospCode).toContain('floor-section-header');
    expect(hospCode).toContain('floorGroups');

    const cssCode = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf8');
    expect(cssCode).toContain('grid-template-columns: repeat(7, minmax(0, 1fr))');
    expect(cssCode).toContain('clamp(90px, 11.5vh, 102px)');
  });

  it('1c. ManagePage allows selecting from Basement, First Floor, Second Floor, Third Floor, Fourth Floor, Fifth Floor', () => {
    const manageCode = fs.readFileSync(path.join(rootDir, 'src/pages/ManagePage.jsx'), 'utf8');
    expect(manageCode).toContain('Basement');
    expect(manageCode).toContain('First Floor');
    expect(manageCode).toContain('Second Floor');
    expect(manageCode).toContain('Third Floor');
    expect(manageCode).toContain('Fourth Floor');
    expect(manageCode).toContain('Fifth Floor');
  });

  it('2. imageCompressor supports PDF extraction and autoCropDocument, and checkin wizard steps support PDF and Auto Crop Doc', () => {
    const compressorCode = fs.readFileSync(path.join(rootDir, 'src/utils/imageCompressor.js'), 'utf8');
    expect(compressorCode).toContain('convertPdfToDataUrl');
    expect(compressorCode).toContain('autoCropWhiteBorders');
    expect(compressorCode).toContain('autoCropDocument');

    const step2Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step2FrontScan.jsx'), 'utf8');
    expect(step2Code).toContain('autoCropDocument');
    expect(step2Code).toContain('Auto Crop Doc');
    expect(step2Code).toContain('accept="image/*,application/pdf,.pdf"');

    const step3Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step3BackScan.jsx'), 'utf8');
    expect(step3Code).toContain('autoCropDocument');
    expect(step3Code).toContain('Auto Crop Doc');
    expect(step3Code).toContain('accept="image/*,application/pdf,.pdf"');
  });

  it('3. 25% discount option is available in CheckinWizard and ManagePage', () => {
    const step6Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf8');
    expect(step6Code).toContain('[0, 5, 10, 15, 20, 25]');

    const manageCode = fs.readFileSync(path.join(rootDir, 'src/pages/ManagePage.jsx'), 'utf8');
    expect(manageCode).toContain('[0, 5, 10, 15, 20, 25]');
  });

  it('4. Tax Invoice prints Mobile Number', () => {
    const printCode = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf8');
    expect(printCode).toContain('Mobile No.');
  });

  it('5. Tax Invoice and POS use "UPI MDR Fee"', () => {
    const printCode = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf8');
    expect(printCode).toContain('UPI MDR Fee (0.4%)');
    expect(printCode).not.toContain('UPI Convenience Tax');

    const folioCode = fs.readFileSync(path.join(rootDir, 'src/pages/RoomFolioPage.jsx'), 'utf8');
    expect(folioCode).toContain('UPI MDR Fee (0.4%)');
    expect(folioCode).not.toContain('UPI Convenience Tax');

    const settleCode = fs.readFileSync(path.join(rootDir, 'src/components/restaurant/TableSettleModal.jsx'), 'utf8');
    expect(settleCode).toContain('UPI MDR Fee');
    expect(settleCode).not.toContain('UPI Convenience Tax');
  });

  it('6. Daily Closing provides IGST (5%) calculation option', () => {
    const manageCode = fs.readFileSync(path.join(rootDir, 'src/pages/ManagePage.jsx'), 'utf8');
    expect(manageCode).toContain('isDailyClosingIgst');
    expect(manageCode).toContain('IGST (5%)');

    const printCode = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf8');
    expect(printCode).toContain('isIgst');
    expect(printCode).toContain('IGST Collections (5%)');
  });
});
