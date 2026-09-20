import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import { buildGuestRegistrationHTML } from '../src/services/printService.js';

describe('Removal of (EP) and (CP) from Breakfast options', () => {
  const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
  const step1Content = fs.readFileSync(step1Path, 'utf-8');

  const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
  const step6Content = fs.readFileSync(step6Path, 'utf-8');

  const printPath = path.resolve(__dirname, '../src/services/printService.js');
  const printContent = fs.readFileSync(printPath, 'utf-8');

  it('verifies Step 1 only displays Without Breakfast and With Breakfast without (EP)/(CP)', () => {
    expect(step1Content).toContain('Without Breakfast');
    expect(step1Content).toContain('With Breakfast');
    expect(step1Content).not.toContain('Without Breakfast (EP)');
    expect(step1Content).not.toContain('With Breakfast (CP)');
  });

  it('verifies Step 6 does not display (EP) or (CP) anywhere in meal plans', () => {
    expect(step6Content).not.toContain('Without Breakfast (EP)');
    expect(step6Content).not.toContain('With Breakfast (CP)');
    expect(step6Content).not.toContain('Breakfast Plan (CP):');
    expect(step6Content).not.toContain('No Breakfast Charge (EP)');
  });

  it('verifies printService default display is Without Breakfast without (EP)', () => {
    expect(printContent).toContain("let mealPlanDisplay = 'Without Breakfast';");
    expect(printContent).not.toContain("let mealPlanDisplay = 'Room Only (EP)';");
  });
});

describe('Optional Corporate Company Details (Hidden for BTC, printed only if filled)', () => {
  const step4Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step4Details.jsx');
  const step4Content = fs.readFileSync(step4Path, 'utf-8');

  it('verifies Step 4 contains optional Corporate Company Details for non-BTC bookings', () => {
    expect(step4Content).toContain("draft.bookingSource !== 'BTC'");
    expect(step4Content).toContain('Corporate Company Details (Optional)');
    expect(step4Content).toContain('Company Name');
    expect(step4Content).toContain('GST Number');
    expect(step4Content).toContain('draft.companyName');
    expect(step4Content).toContain('draft.gstNumber');
  });

  it('verifies registration print template includes Corporate Details ONLY when filled', () => {
    const mockDataWithCompany = {
      voucher_number: '20260920-001',
      guestName: 'John Doe',
      mobile: '9876543210',
      companyName: 'Acme Technologies Pvt Ltd',
      gstNumber: '27AAAAA0000A1Z5',
      bookingSource: 'Walk-in',
      roomNumber: '101',
      roomType: 'Deluxe'
    };

    const htmlWithCompany = buildGuestRegistrationHTML(mockDataWithCompany, { includePhotos: false });
    expect(htmlWithCompany).toContain('Company Name:');
    expect(htmlWithCompany).toContain('Acme Technologies Pvt Ltd');
    expect(htmlWithCompany).toContain('Company GSTIN:');
    expect(htmlWithCompany).toContain('27AAAAA0000A1Z5');

    const mockDataWithoutCompany = {
      voucher_number: '20260920-002',
      guestName: 'Jane Smith',
      mobile: '9876543211',
      bookingSource: 'Walk-in',
      roomNumber: '102',
      roomType: 'Deluxe'
    };

    const htmlWithoutCompany = buildGuestRegistrationHTML(mockDataWithoutCompany, { includePhotos: false });
    expect(htmlWithoutCompany).not.toContain('Company Name:');
    expect(htmlWithoutCompany).not.toContain('Company GSTIN:');
  });
});

describe('Compact Top Progress Bar and Header (Avoid Unnecessary Scrolling)', () => {
  const modalPath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
  const modalContent = fs.readFileSync(modalPath, 'utf-8');

  const cssPath = path.resolve(__dirname, '../public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  it('verifies CheckinWizardModal header and stepper padding are reduced to compact sizes', () => {
    expect(modalContent).toContain("padding: '6px 24px'");
    expect(modalContent).toContain("padding: '3px 24px 2px'");
    expect(modalContent).toContain("top: '11px'");
    expect(modalContent).toContain("height: '3px'");
    expect(modalContent).toContain("width: '22px'");
    expect(modalContent).toContain("height: '22px'");
  });

  it('verifies public/styles.css has compact classes for modal-header, modal-body, step-bubble and step-label', () => {
    expect(cssContent).toContain('padding: 6px 24px;');
    expect(cssContent).toContain('padding: 10px 40px 14px !important;');
    expect(cssContent).toContain('width: 22px;');
    expect(cssContent).toContain('height: 22px;');
    expect(cssContent).toContain('font-size: 0.70rem;');
    expect(cssContent).toContain('font-size: 1.15rem;');
  });
});
