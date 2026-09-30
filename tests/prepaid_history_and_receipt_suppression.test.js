import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Prepaid History Tab & Receipt Suppression Requirements', () => {
  const historyComponentPath = path.resolve(__dirname, '../src/components/hospitality/HospitalityHistory.jsx');
  const serverPath = path.resolve(__dirname, '../server.js');
  const folioSettlementPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');
  const printServicePath = path.resolve(__dirname, '../src/services/printService.js');

  it('1. server.js /api/hospitality/history queries and returns is_prepaid, ota_bill_amount, rate_type', () => {
    const code = fs.readFileSync(serverPath, 'utf8');
    expect(code).toContain('b.is_prepaid,');
    expect(code).toContain('b.ota_bill_amount,');
    expect(code).toContain('b.rate_type,');
    expect(code).toContain('is_prepaid: row.is_prepaid,');
    expect(code).toContain('ota_bill_amount: row.ota_bill_amount || 0,');
  });

  it('2. HospitalityHistory.jsx computes isPrepaid and modeLabel as PREPAID for zero hotel payments', () => {
    const rawCode = fs.readFileSync(historyComponentPath, 'utf8');
    const code = rawCode.replace(/\r\n/g, '\n');
    expect(code).toContain('const isPrepaid = Boolean(');
    expect(code).toContain("if (hotelPaid === 0) {\n                  modeLabel = 'PREPAID';");
    expect(code).toContain('{isPending ? `⏳ Pending (${modeLabel}) ✏️` : `✓ Passed (${modeLabel}) ✏️`}');
    expect(code).toContain("Prepaid via {r.ota_platform || 'OTA'}");
  });

  it('3. HospitalityHistory.jsx styles the Passed badge with purple accent for PREPAID', () => {
    const code = fs.readFileSync(historyComponentPath, 'utf8');
    expect(code).toContain("isPrepaid && hotelPaid === 0 ? '#f3e8ff' : '#dcfce7'");
    expect(code).toContain("isPrepaid && hotelPaid === 0 ? '#6b21a8' : '#166534'");
  });

  it('4. HospitalityHistory.jsx modal suppresses Receipt button and renders Prepaid Online (No Receipt)', () => {
    const rawCode = fs.readFileSync(historyComponentPath, 'utf8');
    const code = rawCode.replace(/\r\n/g, '\n');
    expect(code).toContain('const isDetailPrepaid = Boolean(');
    expect(code).toContain('✓ Prepaid Online (No Receipt)');
    expect(code).toContain("Prepaid Stay ({detailBooking.ota_platform || 'OTA'})");
    expect(code).toContain("if (isDetailPrepaid) {");
    expect(code).toContain("PREPAID");
  });

  it('5. FolioSettlementModal.jsx sets final_payment_mode to prepaid for zero balance OTA prepaid checkout', () => {
    const code = fs.readFileSync(folioSettlementPath, 'utf8');
    expect(code).toContain("(isOtaPrepaid && settleAmt === 0 ? 'prepaid' : 'split')");
  });

  it('6. printService.js includes prepaid summary row when no hotel payments exist', () => {
    const code = fs.readFileSync(printServicePath, 'utf8');
    expect(code).toContain('const isPrepaidSummary = Boolean(');
    expect(code).toContain("receipt_no: 'PREPAID'");
    expect(code).toContain("payment_mode: `PREPAID (${data.ota_platform || 'OTA'})`");
  });
});
