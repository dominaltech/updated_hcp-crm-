import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

import { buildDailyClosingReportHTML } from '../src/services/printService.js';

describe('Daily Closing & Financial Audit Report Redesign', () => {
  const mockAnalyticsData = {
    fromDate: '2026-09-18',
    toDate: '2026-09-18',
    stats: {
      grossRevenue: 48500,
      totalExpenses: 7200,
      netProfit: 41300,
      cashInDrawer: 21300,
      restaurantRevenue: 12000,
      barRevenue: 8500,
      roomRevenue: 28000,
      totalCardSurcharge: 650,
      totalUpiTax: 120
    },
    analytics: {
      totalCollectedRealized: 48500,
      breakdown: {
        advances: {
          total: 10000,
          cash: 6000,
          card: 2000,
          upi: 2000,
          cheque_realized: 0,
          card_surcharge: 50,
          upi_tax: 8
        },
        billSettlements: {
          total: 18000,
          cash: 8000,
          card: 6000,
          upi: 4000,
          cheque_realized: 0,
          card_surcharge: 150,
          upi_tax: 16
        },
        hospitality: {
          total: 28000,
          cash: 14000,
          card: 8000,
          upi: 6000,
          cheque: 0,
          cheque_realized: 0,
          card_surcharge: 200,
          upi_tax: 24
        },
        restaurant: {
          total: 12000,
          cash: 7000,
          card: 3000,
          upi: 2000,
          card_surcharge: 75,
          upi_tax: 8
        },
        bar: {
          total: 8500,
          cash: 5500,
          card: 2000,
          upi: 1000,
          card_surcharge: 50,
          upi_tax: 4
        }
      },
      expenses: {
        total_expenses: 7200,
        cash_expenses: 5200,
        owner_drawings: 2000,
        store_pantry: 1500,
        maintenance: 1700
      },
      expensesList: [
        {
          id: 101,
          voucher_no: 'DEB-2026-09-001',
          category: 'store',
          purpose_details: 'Vegetables and dairy supply',
          paid_to: 'Local Mandi Vendor',
          payment_mode: 'cash',
          amount: 2500,
          created_at: '2026-09-18T10:30:00'
        },
        {
          id: 102,
          voucher_no: 'DEB-2026-09-002',
          category: 'maintenance',
          purpose_details: 'AC repair capacitor replacement',
          paid_to: 'Cooling Solutions',
          payment_mode: 'cash',
          amount: 2700,
          created_at: '2026-09-18T14:15:00'
        },
        {
          id: 103,
          voucher_no: 'DEB-2026-09-003',
          category: 'owner',
          purpose_details: 'Partner drawings',
          paid_to: 'Aamir Partner',
          payment_mode: 'bank_transfer',
          amount: 2000,
          created_at: '2026-09-18T16:00:00'
        }
      ],
      drawer: {
        totalCashInflow: 26500, // 14000 (Hosp) + 7000 (Rest) + 5500 (Bar)
        totalCashOutflow: 5200, // Cash expenses
        netCashInDrawer: 21300  // 26500 - 5200
      }
    }
  };

  it('1. MUST NOT show "Room Accommodation" anywhere in the closing report', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);
    expect(html).not.toContain('Room Accommodation');
    expect(html).not.toContain('Rooms Accommodation');
  });

  it('2. MUST be Hospitality Only: Excludes Bar Lounge and Restaurant sections and calculations', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);
    expect(html).toContain('Hospitality');
    expect(html).not.toContain('Bar Lounge');
    expect(html).not.toContain('Restaurant');

    // Values in KPI boxes must be Hospitality ONLY, NOT combined with Bar or Restaurant
    expect(html).toContain('₹ 28,000.00'); // Hospitality Total Realization (NOT 48,500)
    expect(html).toContain('₹ 14,000.00'); // Hospitality Cash Flow (NOT 26,500)
    expect(html).toContain('₹ 6,000.00');  // Hospitality UPI (NOT 9,000)
    expect(html).toContain('₹ 8,000.00');  // Hospitality Card (NOT 13,000)
  });

  it('3. MUST NOT display itemized expenses list (vouchers table removed as requested)', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);
    expect(html).not.toContain('Itemized Expenses &amp; Drawer Outflows');
    expect(html).not.toContain('DEB-2026-09-001');
    expect(html).not.toContain('Local Mandi Vendor');
    expect(html).not.toContain('Vegetables and dairy supply');
  });

  it('4. MUST NOT display cash drawer mathematical reconciliation formula box or surcharges ribbon', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);
    expect(html).not.toContain('Cash Drawer Mathematical Reconciliation Formula');
    expect(html).not.toContain('Combined Payment Gateway');
    expect(html).not.toContain('Total Card Surcharges');
  });

  it('5. MUST display unique receipt/audit number and cashier name above signature line', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData, {
      reportNo: 'AUD-260920-596',
      cashierName: 'Aamir Razvi'
    });

    expect(html).toContain('Receipt / Audit No: AUD-260920-596');
    expect(html).toContain('Aamir Razvi');
    expect(html).toContain('Front Desk Cashier / Auditor');
  });

  it('6. MUST render all 9 dedicated KPI summary boxes with Hospitality calculations and GST UPI/Card breakdown', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);

    // 9 KPI Summary Boxes verification
    expect(html).toContain('Total Realization');
    expect(html).toContain('Cash Flow (In-Flow)');
    expect(html).toContain('UPI In-Flow');
    expect(html).toContain('Card In-Flow');
    expect(html).toContain('Total Expenses');
    expect(html).toContain('GST Collections');
    expect(html).toContain('Net Cash in Drawer');
    expect(html).toContain('Net to Hotel (Base Price)');
    expect(html).toContain('Prepaid Account');

    // Values in KPI boxes
    expect(html).toContain('₹ 28,000.00'); // Total Realization (Hospitality only)
    expect(html).toContain('₹ 14,000.00'); // Cash Flow (In-flow)
    expect(html).toContain('₹ 6,000.00');  // UPI In-Flow
    expect(html).toContain('₹ 8,000.00');  // Card In-Flow
    expect(html).toContain('₹ 7,200.00');  // Total Expenses
    expect(html).toContain('₹ 8,800.00');  // Net Cash in Drawer (14000 cash - 5200 paid)
    expect(html).toContain('₹ 26,666.67'); // Net to Hotel (Base Price)
    expect(html).toContain('₹ 1,333.33');  // Room GST (5%)

    // GST Collections must show UPI and Card breakdown
    expect(html).toContain('UPI GST: ₹285.71');
    expect(html).toContain('Card GST: ₹380.95');
  });

  it('7. MUST display updated hotel branding and contact details in header', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);

    expect(html).toContain('0217-2729791, 92, 93');
    expect(html).toContain('hcitypark@rediffmail.com');
    expect(html).toContain('hotelcityparksolapur.com');
    expect(html).toContain('119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)');
  });

  it('8. MUST display Net to Hotel Base Price and GST Collections reconciliation ribbon', () => {
    const html = buildDailyClosingReportHTML(mockAnalyticsData);

    expect(html).toContain('Net to Hotel (Base Price):');
    expect(html).toContain('GST Collections:');
    expect(html).toContain('Total Realization');
  });

  it('9. Generates preview_closing.html for visual browser inspection', async () => {
    const fs = await import('fs');
    const html = buildDailyClosingReportHTML({
      fromDate: '2026-09-20',
      toDate: '2026-09-20',
      prebookedTotal: 7400,
      prebookedCount: 3,
      stats: {
        grossRevenue: 195475,
        totalExpenses: 61663,
        cashInDrawer: 66312,
        hospGst: 9308.33
      },
      analytics: {
        breakdown: {
          advances: { total: 110000, cash: 60000, upi: 50000, card: 0 },
          billSettlements: { total: 85475, cash: 45475, upi: 40000, card: 0 },
          hospitality: { total: 195475, cash: 105475, upi: 90000, card: 0, gst: 9308.33, base: 186166.67 }
        },
        expenses: { total_expenses: 61663, cash_expenses: 39163 }
      }
    }, {
      reportNo: 'AUD-260920-596',
      cashierName: 'Pooja Patel'
    });

    const preview = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Closing Preview</title><style>@page{size:A4;margin:0;}body{margin:0;padding:16px;background:#e2e8f0;display:flex;justify-content:center;font-family:Arial,sans-serif;}.page-container{width:210mm;min-height:297mm;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,0.15);box-sizing:border-box;padding:10px;}</style></head><body><div class="page-container">${html}</div></body></html>`;
    fs.writeFileSync('C:/Users/91937/.gemini/antigravity-ide/brain/32a4d13a-7f4d-4fcb-bb3c-ec63668891cd/scratch/preview_closing.html', preview);
    expect(html).toBeDefined();
  });
});

import request from 'supertest';
import app from '../server';
import { generateToken } from '../middleware/auth';

describe('API: /api/manager/analytics daily closing data', () => {
  const managerToken = generateToken({
    id: 9991,
    username: 'audit_mgr',
    role: 'manager',
    full_name: 'Audit Manager',
    can_access_manager: 1
  });

  it('returns expensesList, pre-aggregated hospitality breakdown, exact drawer math, GST collections, and net to hotel', async () => {
    const res = await request(app)
      .get('/api/manager/analytics')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.analytics).toBeDefined();
    expect(Array.isArray(res.body.analytics.expensesList)).toBe(true);
    expect(res.body.analytics.breakdown.hospitality).toBeDefined();
    expect(res.body.analytics.breakdown.hospitality.base).toBeDefined();
    expect(res.body.analytics.breakdown.hospitality.gst).toBeDefined();
    expect(res.body.stats.gstCollections).toBeDefined();
    expect(res.body.stats.netToHotel).toBeDefined();
    expect(res.body.stats.totalCashInflow).toBeDefined();
    expect(res.body.stats.totalUpiInflow).toBeDefined();
    expect(res.body.stats.totalCardInflow).toBeDefined();
    expect(res.body.analytics.drawer).toBeDefined();
    expect(res.body.analytics.drawer.netCashInDrawer).toBe(
      res.body.analytics.drawer.totalCashInflow - res.body.analytics.drawer.totalCashOutflow
    );
  });
});
