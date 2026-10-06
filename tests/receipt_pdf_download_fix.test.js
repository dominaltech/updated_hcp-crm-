import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        toPdf: () => ({
          get: () => ({
            then: (cb) => {
              cb({
                internal: {
                  getNumberOfPages: () => 2
                },
                deletePage: vi.fn()
              });
              return {
                save: vi.fn().mockResolvedValue(true)
              };
            }
          })
        }),
        save: vi.fn().mockResolvedValue(true)
      })
    })
  })
}));

// Mock minimal DOM for Node test
if (typeof document === 'undefined') {
  global.document = {
    createElement: () => ({
      style: {},
      querySelectorAll: () => [],
      appendChild: () => {},
      classList: { add: () => {}, remove: () => {} }
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
      contains: () => true
    }
  };
}

import { buildMoneyReceiptHTML, downloadReceiptPDF } from '../src/services/printService.js';
import fs from 'fs';
import path from 'path';

describe('Receipt PDF Download & Single Page Enforcement Fix', () => {
  const sampleReceipt = {
    receipt_no: 'RCP-101',
    voucher_number: 'VCH-999',
    guest_name: 'Rahul Sharma',
    amount: 2500,
    base_amount: 2500,
    payment_mode: 'UPI',
    created_at: '2026-10-03T10:00:00Z',
    room_numbers: '310',
    particulars: 'Room Advance / Stay Charges',
    cashier_name: 'Admin'
  };

  it('buildMoneyReceiptHTML contains embedded styles with 132mm card height and 8mm perforation', () => {
    const html = buildMoneyReceiptHTML(sampleReceipt);
    expect(html).toContain('<style>');
    expect(html).toContain('.half-a4-receipt-card');
    expect(html).toContain('height: 132mm !important;');
    expect(html).toContain('height: 8mm !important;');
    expect(html).toContain('Rahul Sharma');
    expect(html).toContain('310');
  });

  it('downloadReceiptPDF uses tight margin [2, 4, 2, 4], maxHeight 1040px, and single-page deletePage protection', async () => {
    const printServiceCode = fs.readFileSync(
      path.resolve(__dirname, '../src/services/printService.js'),
      'utf8'
    );

    const fnMatch = printServiceCode.match(/export async function downloadReceiptPDF[\s\S]*?finally \{/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];

    // Verify it doesn't set targetEl.id to 'print-money-receipt-sheet'
    expect(fnBody).not.toMatch(/targetEl\.id\s*=\s*['"]print-money-receipt-sheet['"]/);
    expect(fnBody).toMatch(/targetEl\.id\s*=\s*['"]temp-receipt-pdf-target['"]/);

    // Verify height clamping and tight margins
    expect(fnBody).toMatch(/targetEl\.style\.maxHeight\s*=\s*['"]1040px['"]/);
    expect(fnBody).toMatch(/margin:\s*\[2,\s*4,\s*2,\s*4\]/);

    // Verify deletePage logic to strip any accidental second page
    expect(fnBody).toContain('pdf.deletePage(p)');
  });

  it('downloadReceiptPDF successfully executes without error and exports receipt on single page', async () => {
    const result = await downloadReceiptPDF(sampleReceipt);
    expect(result).toBe(true);
  });
});
