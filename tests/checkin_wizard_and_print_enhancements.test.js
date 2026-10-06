import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Check-in Wizard & Print Slip Enhancements', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. verifies "Grab Recent PC Scan" is placed BEFORE "Choose Image / PDF File" in Step2FrontScan.jsx', () => {
    const code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step2FrontScan.jsx'), 'utf-8');
    const grabIndex = code.indexOf('Grab Recent PC Scan');
    const chooseIndex = code.indexOf('Choose Image / PDF File');
    expect(grabIndex).toBeGreaterThan(-1);
    expect(chooseIndex).toBeGreaterThan(-1);
    expect(grabIndex).toBeLessThan(chooseIndex);
  });

  it('1b. verifies "Grab Recent PC Scan" is placed BEFORE "Choose Image / PDF File" in Step3BackScan.jsx', () => {
    const code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step3BackScan.jsx'), 'utf-8');
    const grabIndex = code.indexOf('Grab Recent PC Scan');
    const chooseIndex = code.indexOf('Choose Image / PDF File');
    expect(grabIndex).toBeGreaterThan(-1);
    expect(chooseIndex).toBeGreaterThan(-1);
    expect(grabIndex).toBeLessThan(chooseIndex);
  });

  it('2. verifies outside floating skip button (btn-side-skip-back) is removed from CheckinWizardModal.jsx', () => {
    const code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'), 'utf-8');
    expect(code).not.toContain('id="btn-side-skip-back"');
    expect(code).not.toContain('nav-skip-back');
  });

  it('3. verifies blinking cursor is suppressed globally and allowed only in editable input fields', () => {
    const css = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf-8');
    expect(css).toContain('caret-color: transparent !important;');
    expect(css).toContain('caret-color: auto !important;');

    const step5 = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step5Photo.jsx'), 'utf-8');
    expect(step5).toContain("caretColor: 'transparent'");
    expect(step5).toContain("userSelect: 'none'");
  });

  it('4. verifies Check-In Date & Time supports manual keyboard input and correct typing handlers', () => {
    const datePicker = fs.readFileSync(path.join(rootDir, 'src/components/common/ThemedDatePicker.jsx'), 'utf-8');
    expect(datePicker).toContain('typedDateText');
    expect(datePicker).toContain('parseAndCommitText');

    const timeInput = fs.readFileSync(path.join(rootDir, 'src/components/common/UnifiedTimeInput.jsx'), 'utf-8');
    // Ensure 10, 11, 12 typing is supported without premature jump when typing '1'
    expect(timeInput).toContain('raw.length === 2 && num >= 1 && num <= 12');
    expect(timeInput).toContain('raw.length === 1 && num >= 2 && num <= 9');

    const step6 = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf-8');
    expect(step6).toContain('handleCheckoutChange(newDateStr);');
  });

  it('5. verifies PRIMARY GUEST PERSONAL INFORMATION, STAY DETAILS, and PAYMENT SUMMARY use light highlights', () => {
    const printService = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf-8');

    // PRIMARY GUEST PERSONAL INFORMATION
    expect(printService).toContain('PRIMARY GUEST PERSONAL INFORMATION');
    expect(printService).toContain('<tr style="background: #f1f5f9;">');

    // STAY DETAILS
    expect(printService).toContain('<div style="background: #f1f5f9; padding: 4px 10px; font-size: 9pt; font-weight: 950; border-bottom: 1.5px solid #94a3b8; text-transform: uppercase; color: #0f172a;');
    expect(printService).toContain('<span>STAY DETAILS</span>');

    // PAYMENT SUMMARY
    expect(printService).toContain('<div style="background: #f1f5f9; padding: 4px 8px; font-size: 9pt; font-weight: 950; border-bottom: 1.5px solid #94a3b8; text-transform: uppercase; color: #0f172a;');
    expect(printService).toContain('<span>PAYMENT SUMMARY</span>');
  });

  it('6. verifies gstAmount and effectiveGstPct are properly defined and computed in Step6Stay.jsx without ReferenceError', () => {
    const step6 = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf-8');
    expect(step6).toContain('const effectiveGstPct = Number(roomGstPct) || 5;');
    expect(step6).toContain('const gstAmount = isOta ? otaGstTariff : Math.round(netChargeBeforeTax * (effectiveGstPct / 100));');
    expect(step6).toContain('(netChargeBeforeTax + gstAmount)');
  });
});

