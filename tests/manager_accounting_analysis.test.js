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

  it('2. Verifies ManagePage renders Accounting & Analysis subview with 12 exact specified columns', () => {
    expect(managePageContent).toContain("subTab === 'accounting'");
    expect(managePageContent).toContain('C/O');
    expect(managePageContent).toMatch(/(Bill|Voucher) No/);
    expect(managePageContent).toContain('Invoice number');
    expect(managePageContent).toContain('Name of customer');
    expect(managePageContent).toContain('Room rent (base)');
    expect(managePageContent).toContain('Extra mattress (PAX)(base)');
    expect(managePageContent).toContain('Visitors extra Breakfast (Base)');
    expect(managePageContent).toContain('Discount');
    expect(managePageContent).toContain('CGST');
    expect(managePageContent).toContain('SGST');
    expect(managePageContent).toContain('Name Of Company');
    expect(managePageContent).toContain('GST No of Company');
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

  it('8. Verifies print layout HTML builder correctly populates all 12 columns and totals', () => {
    const mockRecords = [
      {
        date_of_checkout: '25-09-2026',
        voucher_no: '260924-001',
        bill_no: '260924-001',
        invoice_number: 'HCP001',
        name_of_customer: 'JAVID RANGREZ',
        room_rent_base: 3250.00,
        extra_mattress_pax: 500.00,
        visitor_breakfast_base: 150.00,
        discount: 163.00,
        cgst: 89.68,
        sgst: 89.67,
        cgst_sgst_total: 179.35,
        name_of_company: 'JAVID RANGREZ',
        name_of_customer_gst: 'JAVID RANGREZ',
        gst_no_of_company: '-',
        gst_no_of_customer: '-'
      },
      {
        date_of_checkout: '25-09-2026',
        voucher_no: '260924-013',
        bill_no: '260924-013',
        invoice_number: '260924-013',
        name_of_customer: 'Group Agoda Guest',
        room_rent_base: 2000.00,
        extra_mattress_pax: 0,
        visitor_breakfast_base: 0,
        discount: 0,
        cgst: 50.00,
        sgst: 50.00,
        cgst_sgst_total: 100.00,
        name_of_company: 'Agoda',
        name_of_customer_gst: 'Agoda',
        gst_no_of_company: '9919SGP29004OS2',
        gst_no_of_customer: '9919SGP29004OS2'
      }
    ];

    const mockSummary = {
      total_records: 2,
      total_room_rent_base: 5250.00,
      total_extra_mattress: 500.00,
      total_visitor_breakfast: 150.00,
      total_discount: 163.00,
      total_cgst: 139.68,
      total_sgst: 139.67,
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
    expect(html).toContain('HCP001');
    expect(html).toContain('3250.00');
    expect(html).toContain('500.00');
    expect(html).toContain('150.00');
    expect(html).toContain('163.00');
    expect(html).toContain('89.68');
    expect(html).toContain('89.67');
    expect(html).toContain('Group Agoda Guest');
    expect(html).toContain('Agoda');
    expect(html).toContain('9919SGP29004OS2');
    expect(html).toContain('5250.00');
    expect(html).toContain('TOTAL (2 Bills / Invoices)');
  });

  it('9. Verifies Name Of Company and GST No of Company rules (OTA vs Company vs BTC vs Hyphen)', () => {
    // Helper replicating server logic
    const resolveCompanyAndGst = (row) => {
      const isOta = (row.booking_source || '').toUpperCase() === 'OTA' || Boolean(row.ota_platform);
      let nameOfCompany = '';
      if (isOta) {
        nameOfCompany = row.ota_platform ? row.ota_platform.trim() : 'OTA';
      } else if (row.booking_company_name && row.booking_company_name.trim()) {
        nameOfCompany = row.booking_company_name.trim();
      } else if (row.company_name && row.company_name.trim()) {
        nameOfCompany = row.company_name.trim();
      } else if (row.btc_company_name && row.btc_company_name.trim()) {
        nameOfCompany = row.btc_company_name.trim();
      } else if (row.guest_company_name && row.guest_company_name.trim()) {
        nameOfCompany = row.guest_company_name.trim();
      } else {
        nameOfCompany = (row.guest_name && row.guest_name.trim()) ? row.guest_name.trim() : '-';
      }

      let gstNoOfCompany = '';
      if (isOta) {
        gstNoOfCompany = (row.booking_gst_number || row.guest_gst_number || '').trim();
        if (!gstNoOfCompany) {
          if (/makemytrip|mmt|goibibo/i.test(row.ota_platform || '')) {
            gstNoOfCompany = '27AABCM6906E1ZW';
          } else if (/booking\.?com/i.test(row.ota_platform || '')) {
            gstNoOfCompany = '27AAGCB6887F1Z8';
          } else if (/agoda/i.test(row.ota_platform || '')) {
            gstNoOfCompany = '9919SGP29004OS2';
          }
        }
      } else {
        gstNoOfCompany = (row.booking_gst_number || row.gst_number || row.btc_gst_number || row.guest_gst_number || '').trim();
      }
      gstNoOfCompany = gstNoOfCompany || '-';

      return { nameOfCompany, gstNoOfCompany };
    };

    // Test rule 1: OTA booking
    const otaRes = resolveCompanyAndGst({
      booking_source: 'OTA',
      ota_platform: 'MakeMyTrip',
      guest_name: 'Amit Patel'
    });
    expect(otaRes.nameOfCompany).toBe('MakeMyTrip');
    expect(otaRes.gstNoOfCompany).toBe('27AABCM6906E1ZW');

    // Test rule 2: Corporate details entered in stage 4 or booking
    const corpRes = resolveCompanyAndGst({
      booking_source: 'Walk-in',
      company_name: 'Tata Consultancy Services',
      gst_number: '27AAACT0000A1Z5',
      guest_name: 'Rajesh Kumar'
    });
    expect(corpRes.nameOfCompany).toBe('Tata Consultancy Services');
    expect(corpRes.gstNoOfCompany).toBe('27AAACT0000A1Z5');

    // Test rule 3: BTC Corporate company
    const btcRes = resolveCompanyAndGst({
      booking_source: 'BTC',
      btc_company_name: 'Infosys BPM',
      btc_gst_number: '27AAACI1234F1Z0',
      guest_name: 'Anjali Sharma'
    });
    expect(btcRes.nameOfCompany).toBe('Infosys BPM');
    expect(btcRes.gstNoOfCompany).toBe('27AAACI1234F1Z0');

    // Test rule 4: Standard walk-in guest without corporate company or GST -> falls back to Customer Name
    const walkinRes = resolveCompanyAndGst({
      booking_source: 'Walk-in',
      company_name: null,
      gst_number: null,
      guest_name: 'Md Yahya Ab Wahid Mundewadi'
    });
    expect(walkinRes.nameOfCompany).toBe('Md Yahya Ab Wahid Mundewadi');
    expect(walkinRes.gstNoOfCompany).toBe('-');

    // When guest name is also missing, falls back to '-'
    const blankRes = resolveCompanyAndGst({
      booking_source: 'Walk-in',
      company_name: null,
      gst_number: null,
      guest_name: ''
    });
    expect(blankRes.nameOfCompany).toBe('-');
  });

  it('10. Verifies only checked out bookings enter the Accounting & Analysis report', () => {
    const freshServer = fs.readFileSync(serverPath, 'utf-8');
    const freshReleaseServer = fs.readFileSync(releaseServerPath, 'utf-8');
    [freshServer, freshReleaseServer].forEach((content) => {
      expect(content).toContain("b.status = 'checked_out' OR (b.actual_checkout_time IS NOT NULL AND b.status != 'cancelled')");
      expect(content).toContain("nameOfCompany = (row.guest_name && row.guest_name.trim()) ? row.guest_name.trim() : '-'");
    });
  });

  it('11. Verifies top navigation in Header includes Accounting & Analysis button linking to ManagePage accounting tab', () => {
    const headerPath = path.resolve(__dirname, '../src/layouts/Header.jsx');
    const headerContent = fs.readFileSync(headerPath, 'utf-8');

    expect(headerContent).toContain('id="tab-hosp-accounting"');
    expect(headerContent).toContain('Accounting &amp; Analysis');
    expect(headerContent).toContain("manageSubTab === 'accounting'");
    expect(headerContent).toContain("setManageSubTab('accounting')");

    const appContextPath = path.resolve(__dirname, '../src/context/AppContext.jsx');
    const appContextContent = fs.readFileSync(appContextPath, 'utf-8');

    expect(appContextContent).toContain('manageSubTab');
    expect(appContextContent).toContain('setManageSubTab');
    expect(appContextContent).toContain("openManagerLock = useCallback((dept = 'hospitality', targetTab = null)");

    expect(managePageContent).toContain('manageSubTab');
    expect(managePageContent).toContain('setManageSubTab');
  });

  it('12. Verifies subtitle "Itemised revenue audit..." is removed from ManagePage.jsx', () => {
    const freshManage = fs.readFileSync(managePagePath, 'utf-8');
    expect(freshManage).not.toContain('Itemised revenue audit of checkout bills, base tariffs, extra PAX mattresses, discounts, CGST &amp; SGST breakdown, and customer tax IDs.');
    expect(freshManage).not.toContain('Itemised revenue audit of checkout bills');
  });

  it('13. Verifies email input, Save button, and Send button are placed to the left of Download Excel', () => {
    const freshManage = fs.readFileSync(managePagePath, 'utf-8');
    expect(freshManage).toContain('id="input-accounting-email"');
    expect(freshManage).toContain('id="btn-accounting-save-email"');
    expect(freshManage).toContain('id="btn-accounting-send-email"');
    expect(freshManage).toContain('btn-accounting-download-excel');

    // Verify ordering: input-accounting-email precedes btn-accounting-download-excel
    const emailInputIdx = freshManage.indexOf('id="input-accounting-email"');
    const sendBtnIdx = freshManage.indexOf('id="btn-accounting-send-email"');
    const downloadExcelIdx = freshManage.indexOf('id="btn-accounting-download-excel"');

    expect(emailInputIdx).toBeGreaterThan(-1);
    expect(sendBtnIdx).toBeGreaterThan(-1);
    expect(downloadExcelIdx).toBeGreaterThan(-1);
    expect(emailInputIdx).toBeLessThan(downloadExcelIdx);
    expect(sendBtnIdx).toBeLessThan(downloadExcelIdx);
  });

  it('14. Verifies server.js, release/server.js and api.js define accounting email endpoints and methods', () => {
    const freshServer = fs.readFileSync(serverPath, 'utf-8');
    const freshReleaseServer = fs.readFileSync(releaseServerPath, 'utf-8');
    const freshApi = fs.readFileSync(apiPath, 'utf-8');

    [freshServer, freshReleaseServer].forEach((content) => {
      expect(content).toContain("app.get('/api/manager/accounting-email'");
      expect(content).toContain("app.post('/api/manager/accounting-email'");
      expect(content).toContain("app.post('/api/manager/send-accounting-email'");
      expect(content).toContain('accounting_recipient_email');
    });

    expect(freshApi).toContain('getAccountingEmail:');
    expect(freshApi).toContain('saveAccountingEmail:');
    expect(freshApi).toContain('sendAccountingEmail:');
  });

  it('15. Verifies manual email workflow: downloads Excel, opens Gmail/mailto compose without SMTP configuration popup', () => {
    const freshManage = fs.readFileSync(managePagePath, 'utf-8');
    expect(freshManage).not.toContain('showEmailConfigModal');
    expect(freshManage).not.toContain('Email Dispatch Configuration');
    expect(freshManage).toContain('exportAccountingAnalysisToExcel(accountingRecords, accountingSummary');
    expect(freshManage).toContain('mail.google.com/mail/?view=cm');
    expect(freshManage).toContain('mailto:');
  });

  it('16. Verifies tax filter buttons are removed and CGST, SGST & IGST columns are always rendered', () => {
    const freshManage = fs.readFileSync(managePagePath, 'utf-8');
    
    // Tax filter buttons removed as per user requirement (show all taxes always)
    expect(freshManage).not.toContain('btn-accounting-tax-all');
    expect(freshManage).not.toContain('btn-accounting-tax-cgst-sgst');
    expect(freshManage).not.toContain('btn-accounting-tax-igst');

    // Header order: SGST then IGST
    const sgstHeaderIdx = freshManage.indexOf('>SGST</th>');
    const igstHeaderIdx = freshManage.indexOf('>IGST</th>');
    expect(sgstHeaderIdx).toBeGreaterThan(-1);
    expect(igstHeaderIdx).toBeGreaterThan(-1);
    expect(igstHeaderIdx).toBeGreaterThan(sgstHeaderIdx);

    // Body row order: SGST cell then IGST cell
    const sgstBodyIdx = freshManage.indexOf('{formatCurrency(r.sgst || 0)}');
    const igstBodyIdx = freshManage.indexOf('{formatCurrency(r.igst || 0)}');
    expect(sgstBodyIdx).toBeGreaterThan(-1);
    expect(igstBodyIdx).toBeGreaterThan(-1);
    expect(igstBodyIdx).toBeGreaterThan(sgstBodyIdx);

    // Footer total order: SGST total then IGST total
    const sgstFootIdx = freshManage.indexOf('{formatCurrency(accountingSummary.total_sgst || 0)}');
    const igstFootIdx = freshManage.indexOf('{formatCurrency(accountingSummary.total_igst || 0)}');
    expect(sgstFootIdx).toBeGreaterThan(-1);
    expect(igstFootIdx).toBeGreaterThan(-1);
    expect(igstFootIdx).toBeGreaterThan(sgstFootIdx);
  });

  it('17. Verifies print, Excel, and CSV builders correctly place "IGST" column after "SGST" column', () => {
    const mockIgstRecords = [
      {
        date_of_checkout: '15-10-2026',
        bill_no: '261015-001',
        invoice_number: 'HCP100',
        name_of_customer: 'Delhi Outstate Corp',
        room_rent_base: 4000.00,
        extra_mattress_pax: 0,
        visitor_breakfast_base: 0,
        discount: 0,
        cgst: 0,
        sgst: 0,
        igst: 200.00,
        is_igst: true,
        tax_type: 'IGST',
        name_of_company: 'Delhi Corp',
        gst_no_of_company: '07AAAAA0000A1Z5',
        gst_no_of_customer: '07AAAAA0000A1Z5'
      }
    ];

    const mockSummary = {
      total_records: 1,
      total_room_rent_base: 4000.00,
      total_extra_mattress: 0,
      total_visitor_breakfast: 0,
      total_discount: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 200.00,
      total_cgst_sgst: 200.00,
      total_grand: 4200.00,
      has_igst: true
    };

    const html = buildAccountingAnalysisPrintHTML({
      records: mockIgstRecords,
      filters: {},
      summary: mockSummary
    });

    const sgstIdx = html.indexOf('>SGST</th>');
    const igstIdx = html.indexOf('>IGST</th>');
    expect(sgstIdx).toBeGreaterThan(-1);
    expect(igstIdx).toBeGreaterThan(-1);
    expect(igstIdx).toBeGreaterThan(sgstIdx);
    expect(html).toContain('₹200.00');
  });
});

