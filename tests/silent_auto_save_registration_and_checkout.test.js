import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Silent Direct Background PDF Auto-Save (No Windows Save-As Popup)', () => {
  it('verifies CheckinWizardModal imports and calls autoSaveGuestRegistrationPDF instead of downloadGuestRegistrationPDF', () => {
    const wizardPath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
    const wizardContent = fs.readFileSync(wizardPath, 'utf8');

    // Must import autoSaveGuestRegistrationPDF
    expect(wizardContent).toContain('autoSaveGuestRegistrationPDF');

    // Must NOT call downloadGuestRegistrationPDF automatically on check-in
    expect(wizardContent).not.toContain('downloadGuestRegistrationPDF(regData)');

    // Must call autoSaveGuestRegistrationPDF with regData in timeout
    expect(wizardContent).toContain('autoSaveGuestRegistrationPDF(regData, { includePhotos: true })');
  });

  it('verifies printService exports autoSaveGuestRegistrationPDF, autoSaveFinalBillPDF, and autoSaveGuestPaymentSummaryPDF', () => {
    const printServicePath = path.resolve(__dirname, '../src/services/printService.js');
    const printContent = fs.readFileSync(printServicePath, 'utf8');

    expect(printContent).toContain('export async function autoSaveGuestRegistrationPDF(');
    expect(printContent).toContain('export async function autoSaveFinalBillPDF(');
    expect(printContent).toContain('export async function autoSaveGuestPaymentSummaryPDF(');
    expect(printContent).toContain('export async function autoSavePdfDocument(');

    // autoSavePdfDocument should configure page breaks and html2pdf outputPdf
    expect(printContent).toContain('.html2pdf__page-break');
    expect(printContent).toContain("outputPdf('datauristring')");
    expect(printContent).toContain('api.saveInvoicePdf');
  });

  it('verifies FolioSettlementModal uses autoSavePdfDocument for checkout receipts and does not call any download functions', () => {
    const folioPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');
    const folioContent = fs.readFileSync(folioPath, 'utf8');

    // Checkout receipts auto-saved silently
    expect(folioContent).toContain('autoSavePdfDocument(receiptFilename, receiptHtml)');

    // Must not call downloadFinalBillPDF or downloadGuestRegistrationPDF on checkout
    expect(folioContent).not.toContain('downloadFinalBillPDF(');
    expect(folioContent).not.toContain('downloadGuestRegistrationPDF(');
  });

  it('verifies server.js properly cleans data URI headers and normalizes filename', () => {
    const serverPath = path.resolve(__dirname, '../server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    expect(serverContent).toContain("pdfBase64.includes(';base64,')");
    expect(serverContent).toContain("filename.replace(/\\.pdf$/i, '')");
  });
});
