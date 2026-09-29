import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Accounting & Analysis: GST No of Customer Column Added After Invoice Number', () => {
  const printServicePath = path.resolve(__dirname, '../src/services/printService.js');
  const printServiceCode = fs.readFileSync(printServicePath, 'utf-8');

  const managePagePath = path.resolve(__dirname, '../src/pages/ManagePage.jsx');
  const managePageCode = fs.readFileSync(managePagePath, 'utf-8');

  it('1. Verifies exportAccountingAnalysisToExcel has "GST No of Customer" right after "Invoice number"', () => {
    // Header check
    expect(printServiceCode).toMatch(
      /<Cell ss:StyleID="Header"><Data ss:Type="String">Invoice number<\/Data><\/Cell>\s*<Cell ss:StyleID="Header"><Data ss:Type="String">GST No of Customer<\/Data><\/Cell>/
    );

    // Data row check
    expect(printServiceCode).toMatch(
      /\$\{escapeHtml\(r\.invoice_number \|\| '-'\)\}<\/Data><\/Cell>\s*<Cell ss:StyleID="DataCenter"><Data ss:Type="String">\$\{escapeHtml\(r\.gst_no_of_customer \|\| '-'\)\}/
    );
  });

  it('2. Verifies exportAccountingAnalysisToCsv has "GST No of Customer" right after "Invoice number"', () => {
    // CSV headers check
    expect(printServiceCode).toMatch(
      /'Invoice number',\s*'GST No of Customer',\s*'Name of customer'/
    );

    // CSV data row check
    expect(printServiceCode).toMatch(
      /escapeCsv\(r\.invoice_number \|\| '-'\),\s*escapeCsv\(r\.gst_no_of_customer \|\| '-'\),\s*escapeCsv\(r\.name_of_customer \|\| '-'\)/
    );
  });

  it('3. Verifies ManagePage Accounting table has "GST No of Customer" column right after "Invoice number"', () => {
    expect(managePageCode).toMatch(
      /<th[^>]*>Invoice number<\/th>\s*<th[^>]*>GST No of Customer<\/th>\s*<th[^>]*>Name of customer<\/th>/
    );
  });
});
