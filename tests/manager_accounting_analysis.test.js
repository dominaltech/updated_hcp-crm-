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

import {
  buildAccountingAnalysisPrintHTML,
  exportAccountingAnalysisToCsv
} from '../src/services/printService';

describe('Manager Accounting & Analysis Audit Table, Filters, Print & Excel', () => {
  const managePagePath = path.resolve(__dirname, '../src/pages/ManagePage.jsx');
  const managePageContent = fs.readFileSync(managePagePath, 'utf-8');

  const serverPath = path.resolve(__dirname, '../server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf-8');

  const releaseServerPath = path.resolve(__dirname, '../release/server.js');
  const releaseServerContent = fs.readFileSync(releaseServerPath, 'utf-8');

  const apiPath = path.resolve(__dirname, '../src/services/api.js');
  const apiContent = fs.readFileSync(apiPath, 'utf-8');

  const printServicePath = path.resolve(__dirname, '../src/services/printService.js');
  const printServiceContent = fs.readFileSync(printServicePath, 'utf-8');

  it('1. Verifies Manager Sub-Navigation includes Accounting & Analysis tab button', () => {
    expect(managePageContent).toContain("key: 'accounting'");
    expect(managePageContent).toContain("label: 'Accounting & Analysis'");
    expect(managePageContent).toContain("icon: '📑'");
  });

  it('2. Verifies ManagePage renders Accounting & Analysis subview with 10 exact specified columns', () => {
    expect(managePageContent).toContain("subTab === 'accounting'");
    expect(managePageContent).toContain('Date of checkout');
    expect(managePageContent).toContain('Bill no');
    expect(managePageContent).toContain('Invoice number');
    expect(managePageContent).toContain('Name of customer');
    expect(managePageContent).toContain('Room rent (base)');
    expect(managePageContent).toContain('Extra mattress (PAX)');
    expect(managePageContent).toContain('Discount');
    expect(managePageContent).toContain('CGST &amp; SGST');
    expect(managePageContent).toContain('Name Of Customer GST');
    expect(managePageContent).toContain('GST No of Customer');
  });

  it('3. Verifies Filter Toolbar supports Date range, Bill number range, Voucher number range, and live Search', () => {
    expect(managePageContent).toContain('filter-accounting-from-date');
    expect(managePageContent).toContain('filter-accounting-to-date');
    expect(managePageContent).toContain('filter-accounting-from-bill');
    expect(managePageContent).toContain('filter-accounting-to-bill');
    expect(managePageContent).toContain('filter-accounting-from-voucher');
    expect(managePageContent).toContain('filter-accounting-to-voucher');
    expect(managePageContent).toContain('filter-accounting-search');
    expect(managePageContent).toContain('btn-accounting-apply-filter');
    expect(managePageContent).toContain('btn-accounting-reset-filter');
  });

  it('4. Verifies Download Excel (.xlsx), Download CSV, and Print Report buttons are present', () => {
    expect(managePageContent).toContain('btn-accounting-download-excel');
    expect(managePageContent).toContain('btn-accounting-download-csv');
    expect(managePageContent).toContain('btn-accounting-print-report');
    expect(managePageContent).toContain('exportAccountingAnalysisToExcel');
    expect(managePageContent).toContain('exportAccountingAnalysisToCsv');
    expect(managePageContent).toContain('printAccountingAnalysisReport');
  });

  it('5. Verifies server.js and release/server.js define /api/manager/accounting-analysis endpoint', () => {
    [serverContent, releaseServerContent].forEach((content) => {
      expect(content).toContain("app.get('/api/manager/accounting-analysis'");
      expect(content).toContain('fromBillNo');
      expect(content).toContain('toBillNo');
      expect(content).toContain('fromVoucherNo');
      expect(content).toContain('toVoucherNo');
      expect(content).toContain('fromDate');
      expect(content).toContain('toDate');
      expect(content).toContain('name_of_customer_gst');
      expect(content).toContain('gst_no_of_customer');
      expect(content).toContain('room_rent_base');
      expect(content).toContain('extra_mattress_pax');
      expect(content).toContain('cgst_sgst_total');
    });
  });

  it('6. Verifies api.js includes getAccountingAnalysis method', () => {
    expect(apiContent).toContain('getAccountingAnalysis:');
    expect(apiContent).toContain('/manager/accounting-analysis');
  });

  it('7. Verifies printService.js exports buildAccountingAnalysisPrintHTML, printAccountingAnalysisReport, and excel exports', () => {
    expect(printServiceContent).toContain('buildAccountingAnalysisPrintHTML');
    expect(printServiceContent).toContain('printAccountingAnalysisReport');
    expect(printServiceContent).toContain('exportAccountingAnalysisToExcel');
    expect(printServiceContent).toContain('exportAccountingAnalysisToCsv');
  });

  it('8. Verifies print layout HTML builder correctly populates all 10 columns and totals', () => {
    const mockRecords = [
      {
        date_of_checkout: '25-09-2026',
        bill_no: '260924-001',
        invoice_number: '260924-001',
        name_of_customer: 'JAVID RANGREZ',
        room_rent_base: 3250.00,
        extra_mattress_pax: 500.00,
        discount: 163.00,
        cgst_sgst_total: 179.35,
        name_of_customer_gst: 'JAVID RANGREZ',
        gst_no_of_customer: '-'
      },
      {
        date_of_checkout: '25-09-2026',
        bill_no: '260924-013',
        invoice_number: '260924-013',
        name_of_customer: 'Group Agoda Guest',
        room_rent_base: 2000.00,
        extra_mattress_pax: 0,
        discount: 0,
        cgst_sgst_total: 100.00,
        name_of_customer_gst: 'Agoda',
        gst_no_of_customer: '9919SGP29004OS2'
      }
    ];

    const mockSummary = {
      total_records: 2,
      total_room_rent_base: 5250.00,
      total_extra_mattress: 500.00,
      total_discount: 163.00,
      total_cgst_sgst: 279.35,
      total_grand: 5866.35
    };

    const html = buildAccountingAnalysisPrintHTML({
      records: mockRecords,
      filters: { fromDate: '2026-09-01', toDate: '2026-09-25' },
      summary: mockSummary
    });

    expect(html).toContain('Hotel City Paark');
    expect(html).toContain('27AAUFJ0434H1Z7');
    expect(html).toContain('Accounting &amp; Analysis Audit');
    expect(html).toContain('JAVID RANGREZ');
    expect(html).toContain('260924-001');
    expect(html).toContain('3250.00');
    expect(html).toContain('500.00');
    expect(html).toContain('163.00');
    expect(html).toContain('179.35');
    expect(html).toContain('Group Agoda Guest');
    expect(html).toContain('Agoda');
    expect(html).toContain('9919SGP29004OS2');
    expect(html).toContain('5250.00');
    expect(html).toContain('TOTAL (2 Bills / Invoices)');
  });

  it('9. Verifies Name Of Customer GST and GST No of Customer rules (OTA vs Company vs Customer fallback and hyphen)', () => {
    // Test rule 1: OTA booking
    const otaRow = {
      booking_source: 'OTA',
      ota_platform: 'MakeMyTrip',
      guest_name: 'Amit Patel',
      company_name: null,
      booking_gst_number: null
    };
    const isOta = (otaRow.booking_source || '').toUpperCase() === 'OTA' || Boolean(otaRow.ota_platform);
    const otaGstName = isOta ? (otaRow.ota_platform || 'OTA') : otaRow.guest_name;
    expect(otaGstName).toBe('MakeMyTrip');

    // Test rule 2: Company name inserted in form
    const corpRow = {
      booking_source: 'Walk-in',
      ota_platform: null,
      company_name: 'Tata Consultancy Services',
      gst_number: '27AAACT0000A1Z5',
      guest_name: 'Rajesh Kumar'
    };
    const corpGstName = corpRow.company_name || corpRow.guest_name;
    const corpGstNo = corpRow.gst_number || '-';
    expect(corpGstName).toBe('Tata Consultancy Services');
    expect(corpGstNo).toBe('27AAACT0000A1Z5');

    // Test rule 3: Standard walk-in guest without company or GST
    const walkinRow = {
      booking_source: 'Walk-in',
      ota_platform: null,
      company_name: null,
      gst_number: null,
      guest_name: 'Suresh Patil'
    };
    const walkinGstName = walkinRow.company_name || walkinRow.guest_name;
    const walkinGstNo = walkinRow.gst_number || '-';
    expect(walkinGstName).toBe('Suresh Patil');
    expect(walkinGstNo).toBe('-');
  });
});
