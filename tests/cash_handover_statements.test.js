import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server';
import fs from 'fs';
import path from 'path';
import { numberToWordsINR } from '../src/utils/numberToWords';

describe('Shift Cash Handover Statements (Front Office & F&B)', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Verifies numberToWordsINR correctly converts currency values into Indian words', () => {
    expect(numberToWordsINR(7950)).toBe('Rupees Seven Thousand Nine Hundred Fifty Only');
    expect(numberToWordsINR(0)).toBe('Rupees Zero Only');
    expect(numberToWordsINR(12500)).toBe('Rupees Twelve Thousand Five Hundred Only');
    expect(numberToWordsINR(100000)).toBe('Rupees One Lakh Only');
    expect(numberToWordsINR(10500.50)).toBe('Rupees Ten Thousand Five Hundred and Fifty Paise Only');
  });

  it('2. Verifies GET /api/hospitality/cash-handover-data endpoint returns proper calculations', async () => {
    const res = await request(app).get('/api/hospitality/cash-handover-data?date=2026-10-26&shift=all');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.department).toBe('hospitality');
    expect(res.body).toHaveProperty('foCashSales');
    expect(res.body).toHaveProperty('foDeposits');
    expect(res.body).toHaveProperty('otherIncome');
    expect(res.body).toHaveProperty('toHandoverA');
    expect(res.body).toHaveProperty('fbCashCollected');
    expect(res.body).toHaveProperty('totalReceiptsCR');
    expect(res.body).toHaveProperty('totalRefund');
    expect(res.body).toHaveProperty('netHandover');

    // User requirement: Total (A + B) must NOT be added into net handover!
    // Net Handover must equal toHandoverA - totalRefund
    expect(res.body.totalReceiptsCR).toBe(res.body.toHandoverA);
    expect(res.body.netHandover).toBe(Math.max(0, res.body.toHandoverA - res.body.totalRefund));
  });

  it('3. Verifies GET /api/restaurant/cash-handover-data endpoint returns proper calculations', async () => {
    const res = await request(app).get('/api/restaurant/cash-handover-data?date=2026-10-26&shift=all');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.department).toBe('restaurant');
    expect(res.body).toHaveProperty('fnbCashSales');
    expect(res.body).toHaveProperty('fnbDeposits');
    expect(res.body).toHaveProperty('toHandoverA');
    expect(res.body).toHaveProperty('fbFromReception');
    expect(res.body).toHaveProperty('totalReceiptsCR');
    expect(res.body).toHaveProperty('totalRefund');
    expect(res.body).toHaveProperty('netHandover');

    expect(res.body.totalReceiptsCR).toBe(res.body.toHandoverA);
    expect(res.body.netHandover).toBe(Math.max(0, res.body.toHandoverA - res.body.totalRefund));
  });

  it('4. Verifies HospitalityPage.jsx has Cash Handover button and modal integration', () => {
    const hospContent = fs.readFileSync(path.join(rootDir, 'src/pages/HospitalityPage.jsx'), 'utf-8');
    expect(hospContent).toContain('id="btn-cash-handover"');
    expect(hospContent).toContain('Cash Handover');
    expect(hospContent).toContain("import CashHandoverModal from '../components/hospitality/CashHandoverModal';");
    expect(hospContent).toContain('<CashHandoverModal');
  });

  it('5. Verifies SettledBillsView.jsx has F&B Cash Handover button and modal integration', () => {
    const settledContent = fs.readFileSync(path.join(rootDir, 'src/components/restaurant/SettledBillsView.jsx'), 'utf-8');
    expect(settledContent).toContain('id="btn-fnb-cash-handover"');
    expect(settledContent).toContain('F&B Cash Handover');
  });

  it('6. Verifies Header.jsx has top nav Cash Handover button for restaurant & bar', () => {
    const headerContent = fs.readFileSync(path.join(rootDir, 'src/layouts/Header.jsx'), 'utf-8');
    expect(headerContent).toContain('tab-fnb-cash-handover');
    expect(headerContent).toContain('tab-bar-cash-handover');
    expect(headerContent).toContain('Cash Handover');
  });

  it('7. Verifies single Cash Handover button is kept in Header.jsx and floor view duplicates removed', () => {
    const restContent = fs.readFileSync(path.join(rootDir, 'src/pages/RestaurantPage.jsx'), 'utf-8');
    expect(restContent).not.toContain('id="btn-rest-floor-cash-handover"');

    const barContent = fs.readFileSync(path.join(rootDir, 'src/pages/BarPage.jsx'), 'utf-8');
    expect(barContent).not.toContain('id="btn-bar-floor-cash-handover"');

    const headerContent = fs.readFileSync(path.join(rootDir, 'src/layouts/Header.jsx'), 'utf-8');
    expect(headerContent).toContain('tab-fnb-cash-handover');
  });

  it('8. Verifies printService.js contains both 2-copy A4 middle cut print functions', () => {
    const printContent = fs.readFileSync(path.join(rootDir, 'src/services/printService.js'), 'utf-8');
    expect(printContent).toContain('export function printFrontOfficeCashHandover');
    expect(printContent).toContain('export function printFnBCashHandover');
    expect(printContent).toContain('✂ CUT HERE (FRONT COPY / ACCOUNTS COPY) ✂');
    expect(printContent).toContain('✂ CUT HERE (F&B COPY / ACCOUNTS COPY) ✂');
    expect(printContent).toContain('Signature of Paying Cashier');
    expect(printContent).toContain('Signature of Receiving Cashier');
  });
});
