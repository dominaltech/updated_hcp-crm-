import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getLocalIsoDateTime } from '../src/utils/formatters';
import { buildGuestRegistrationHTML, buildFinalBillA4HTML } from '../src/services/printService';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn(),
        outputPdf: vi.fn().mockResolvedValue('data:application/pdf;base64,JVBERi0xLjQK...')
      })
    })
  })
}));

describe('Resumed Enhancements Verification', () => {
  describe('1. Local Iso Date & Time Auto-Correction (No UTC Shift)', () => {
    it('formats a date to local wall-clock YYYY-MM-DDTHH:mm format without converting to UTC', () => {
      const fixedDate = new Date(2026, 8, 24, 16, 22); // 24 Sept 2026, 16:22 local
      const result = getLocalIsoDateTime(fixedDate);
      expect(result).toBe('2026-09-24T16:22');
      // Must NOT contain 'Z'
      expect(result).not.toContain('Z');
    });

    it('CheckinWizardModal initializes checkinTime with getLocalIsoDateTime', () => {
      const modalCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'),
        'utf-8'
      );
      expect(modalCode).toContain('import { getLocalIsoDateTime } from');
      expect(modalCode).toContain('checkinTime: getLocalIsoDateTime(new Date())');
      expect(modalCode).not.toContain('checkinTime: new Date().toISOString()');
    });
  });

  describe('2. Rename Extra Bed to Extra Mattress in UI & Prints', () => {
    it('Registration card uses Extra Mattress terminology', () => {
      const sampleBooking = {
        voucherNo: '20260924-101',
        checkinFormatted: '24 Sept 2026 04:22 pm',
        guestName: 'John Doe',
        mobile: '9876543210',
        docType: 'Aadhar Card',
        idNumber: '123456789012',
        roomNumber: '101',
        roomExtraBeds: { 1: 1 },
        extraBeds: 1,
        stayStatus: 'Walk-in',
        tariffNet: 2500,
        advanceAmount: 2500,
        grandTotal: 2500,
        payments: []
      };

      const html = buildGuestRegistrationHTML(sampleBooking, { includePhotos: false });
      expect(html).toContain('Stay &amp; Extra Mattresses:');
      expect(html).toContain('Extra Mattress');
      expect(html).not.toContain('Extra Bed(s)');
    });

    it('Tax Invoice / Final Bill uses Extra Mattress Base Tariff and Extra Mattress Charges', () => {
      const sampleFolio = {
        voucher_no: '20260924-101',
        booking_id: 'BK-101',
        room_number: '101',
        guest_name: 'John Doe',
        mobile: '9876543210',
        check_in: '2026-09-24T16:22',
        check_out: '2026-09-25T11:00',
        booking_source: 'Walk-in',
        extra_beds: 1,
        extra_bed_charge: 500,
        payments: []
      };

      const html = buildFinalBillA4HTML(sampleFolio, {
        roomCharges: 2000,
        extraBedCharges: 500,
        roomTax: 240,
        extraBedTax: 60,
        grandTotal: 2800,
        totalPaid: 2800,
        balanceDue: 0
      });

      expect(html).toContain('Extra Mattress Base Tariff');
      expect(html).not.toContain('Extra Bed Base Tariff');
    });

    it('Step6Stay UI displays Extra Mattress across badges, stepper labels, and modal titles', () => {
      const step6Code = fs.readFileSync(
        path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx'),
        'utf-8'
      );

      expect(step6Code).toContain('🛏️ Extra Mattress:');
      expect(step6Code).toContain('Extra Mattress Charges');
      expect(step6Code).toContain('Edit Extra Mattress Charges');
      expect(step6Code).toContain('Specific Extra Mattress Charge');
      expect(step6Code).toContain('Total Extra Mattress Fee:');
      expect(step6Code).toContain('Add Extra Mattress');
      expect(step6Code).not.toContain('Edit Extra Bed Charges');
      expect(step6Code).not.toContain('Specific Extra Bed Charge');
    });
  });

  describe('3. Room Tariff Base Tariff Editing (No Snapping to 0)', () => {
    it('Step6Stay allows backspacing and string values without forcing 0', () => {
      const step6Code = fs.readFileSync(
        path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx'),
        'utf-8'
      );

      // Value binding supports custom value or fallback
      expect(step6Code).toContain('value={draft._customBaseRate && draft.baseRate !== undefined ? draft.baseRate : (calculatedBasePrice || \'\')}');
      // OnChange preserves the typed string
      expect(step6Code).toContain('baseRate: val');
      expect(step6Code).toContain('_customBaseRate: true');
      // OnBlur handles fallback gracefully
      expect(step6Code).toContain('if (draft.baseRate === \'\' || isNaN(num) || num < 0)');
    });
  });

  describe('4. Silent Auto-Save of Invoices & Receipts on Disk', () => {
    it('printService provides autoSavePdfDocument which uses outputPdf silently', () => {
      const printCode = fs.readFileSync(
        path.resolve(__dirname, '../src/services/printService.js'),
        'utf-8'
      );

      expect(printCode).toContain('export async function autoSavePdfDocument');
      expect(printCode).toContain("outputPdf('datauristring')");
      expect(printCode).toContain('api.saveInvoicePdf');
    });

    it('server.js has endpoints for auto-save directory setting and PDF disk save', () => {
      const serverCode = fs.readFileSync(
        path.resolve(__dirname, '../server.js'),
        'utf-8'
      );

      expect(serverCode).toContain('/api/settings/auto-save-dir');
      expect(serverCode).toContain('/api/save-invoice-pdf');
      expect(serverCode).toContain('fs.writeFileSync');
    });
  });

  describe('5. Stage 1 to 7 Keyboard Navigation', () => {
    it('CheckinWizardModal has capture-phase listener for ESC (step back / close) and Shift+Enter', () => {
      const modalCode = fs.readFileSync(
        path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'),
        'utf-8'
      );

      expect(modalCode).toContain("if (e.key === 'Escape')");
      expect(modalCode).toContain('if (currentStep > 1)');
      expect(modalCode).toContain('handlePrev()');
      expect(modalCode).toContain('onClose()');
      expect(modalCode).toContain("if (e.key === 'Enter' && e.shiftKey)");
    });

    it('Step1Source supports Arrow navigation and Enter selection on channel cards', () => {
      const step1Code = fs.readFileSync(
        path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx'),
        'utf-8'
      );

      expect(step1Code).toContain("handleStep1KeyDown");
      expect(step1Code).toContain("e.key === 'ArrowRight'");
      expect(step1Code).toContain("e.key === 'ArrowLeft'");
      expect(step1Code).toContain("handleSourceSelect(CHANNELS[nextIdx].id)");
      expect(step1Code).toContain("onProceedToScan(draft.docType || 'Aadhar Card')");
    });
  });

  describe('6. Stay Duration & Tariff Billing per 24 Hours Terminology', () => {
    it('ManagePage.jsx uses for 24 hours instead of /nt or / Night', () => {
      const manageCode = fs.readFileSync(
        path.resolve(__dirname, '../src/pages/ManagePage.jsx'),
        'utf-8'
      );

      expect(manageCode).toContain('for 24 hours');
      expect(manageCode).toContain('BASE (₹ for 24 hours)');
      expect(manageCode).not.toContain('/nt');
      expect(manageCode).not.toContain('BASE (₹ / Night)');
    });

    it('Step6Stay.jsx displays 24 hours subtotal, base rate, and extra mattress charges', () => {
      const step6Code = fs.readFileSync(
        path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx'),
        'utf-8'
      );

      expect(step6Code).toContain('Room Tariff Subtotal');
      expect(step6Code).toContain("nights === 1 ? '24 Hours' : `${nights * 24} Hours (${nights} × 24 hrs)`");
      expect(step6Code).toContain("for 24 hours × {nights}");
      expect(step6Code).toContain('Specific Extra Mattress Charge (₹ for 24 hours)');
      expect(step6Code).toContain('Per Mattress / 24 Hours');
      expect(step6Code).not.toContain('/nt');
      expect(step6Code).not.toContain('/guest/nt');
      expect(step6Code).not.toContain('₹/night');
    });

    it('HospitalityPage, RoomFolioPage, and printService format stay duration as 24 hours', () => {
      const hospCode = fs.readFileSync(
        path.resolve(__dirname, '../src/pages/HospitalityPage.jsx'),
        'utf-8'
      );
      const folioCode = fs.readFileSync(
        path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx'),
        'utf-8'
      );
      const printCode = fs.readFileSync(
        path.resolve(__dirname, '../src/services/printService.js'),
        'utf-8'
      );

      expect(hospCode).toContain('{formatCurrency(totalTariff)} / 24 hrs');
      expect(folioCode).toContain("Base Room Tariff ({stayNights === 1 ? '24 Hours' :");
      expect(folioCode).toContain('const decRefund = decRawBal < 0 ? Math.abs(decRawBal) : 0;');
      expect(printCode).toContain("stayNights === 1 ? '24 Hours' : `${stayNights * 24} Hours (${stayNights} × 24 hrs)`");
    });
  });
});

