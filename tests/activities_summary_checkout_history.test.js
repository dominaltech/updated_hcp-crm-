import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn().mockResolvedValue(true)
      })
    })
  })
}));

import { buildGuestActivitiesSummaryHTML, downloadGuestActivitiesSummaryPDF, printGuestActivitiesSummary } from '../src/services/printService';

describe('Activities Summary for Checked Out Stay and History', () => {
  const sampleHistoryBooking = {
    id: 991,
    guest_name: 'Rahul Sharma',
    room_number: '310',
    room_type: 'Suit Room',
    mobile: '9823456789',
    checkin_time: '2026-10-01T14:30:00',
    checkout_time: '2026-10-03T11:15:00',
    total_room_charge: 10500,
    discount_amount: 500,
    tax_amount: 500,
    extra_bed_charge: 500,
    final_settlement_mode: 'CASH',
    payments: [
      {
        id: 101,
        receipt_no: 'CR15',
        amount: 5000,
        payment_mode: 'Cash',
        created_at: '2026-10-01T14:30:00'
      },
      {
        id: 102,
        receipt_no: 'UPI05',
        amount: 5500,
        payment_mode: 'Online UPI',
        utr_number: '123456789012',
        created_at: '2026-10-03T11:15:00'
      }
    ],
    restaurantOrders: [
      {
        id: 401,
        items: JSON.stringify([{ name: 'Butter Chicken', qty: 2 }, { name: 'Naan', qty: 4 }]),
        total: 800,
        is_paid: 0,
        created_at: '2026-10-01T20:00:00'
      }
    ],
    barOrders: [
      {
        id: 501,
        items: JSON.stringify([{ name: 'Beer', qty: 2 }]),
        total: 600,
        is_paid: 1,
        created_at: '2026-10-02T21:30:00'
      }
    ]
  };

  it('1. Correctly formats and displays check-in and check-out from checkout_time in history', () => {
    const html = buildGuestActivitiesSummaryHTML(sampleHistoryBooking);
    expect(html).toContain('ACTIVITIES SUMMARY');
    expect(html).toContain('Rahul Sharma');
    expect(html).toContain('#310');
    expect(html).toContain('Suit Room');
    // Ensure check-out is not plain '-'
    expect(html).not.toMatch(/Check-out:<\/strong><br>-/);
    expect(html).toContain('2026');
  });

  it('2. Shows itemized payments from checkout history', () => {
    const html = buildGuestActivitiesSummaryHTML(sampleHistoryBooking);
    expect(html).toContain('CR15');
    expect(html).toContain('UPI05');
    expect(html).toContain('123456789012');
  });

  it('3. Reconciles Room Stay, Restaurant Orders, and Bar Orders', () => {
    const html = buildGuestActivitiesSummaryHTML(sampleHistoryBooking);
    expect(html).toContain('Butter Chicken x2, Naan x4');
    expect(html).toContain('Beer x2');
    expect(html).toContain('TOTAL ACTIVITIES FINANCIAL RECONCILIATION');
  });

  it('4. Handles fallback summary totals when individual order items array is absent in history', () => {
    const bookingWithoutItemizedOrders = {
      ...sampleHistoryBooking,
      restaurantOrders: [],
      barOrders: [],
      food_total: 1200,
      bar_total: 450
    };
    const html = buildGuestActivitiesSummaryHTML(bookingWithoutItemizedOrders);
    expect(html).toContain('Restaurant Service');
    expect(html).toContain('Bar &amp; Lounge Service');
    expect(html).toContain('1,200.00');
    expect(html).toContain('450.00');
  });

  it('5. downloadGuestActivitiesSummaryPDF executes cleanly without throwing', async () => {
    const ok = await downloadGuestActivitiesSummaryPDF(sampleHistoryBooking);
    expect(typeof ok).toBe('boolean');
  });

  it('6. Correctly generates full Activities Summary HTML for active staying room folio card', () => {
    const sampleStayingFolioPayload = {
      room_number: '104',
      room_type: 'Executive Room',
      guest_name: 'Anil Kumar',
      mobile: '9123456780',
      checkin_time: '2026-10-04T12:00:00',
      approx_checkout_time: '2026-10-06T11:00:00',
      total_room_charge: 6000,
      discount_amount: 0,
      tax_amount: 300,
      extra_bed_charge: 0,
      advancePaid: 2000,
      payments: [
        {
          id: 'init-upi',
          receipt_no: 'UPI01',
          payment_mode: 'Online UPI',
          amount: 2000,
          utr_number: '987654321098',
          created_at: '2026-10-04T12:00:00'
        }
      ],
      restaurantOrders: [
        {
          id: 701,
          items: JSON.stringify([{ name: 'Paneer Tikka', qty: 1 }]),
          total: 350,
          is_paid: 0,
          created_at: '2026-10-04T19:30:00'
        }
      ],
      barOrders: []
    };

    const html = buildGuestActivitiesSummaryHTML(sampleStayingFolioPayload);
    expect(html).toContain('ACTIVITIES SUMMARY');
    expect(html).toContain('Anil Kumar');
    expect(html).toContain('#104');
    expect(html).toContain('Executive Room');
    expect(html).toContain('Paneer Tikka x1');
    expect(html).toContain('UPI01');
    expect(html).toContain('987654321098');
    expect(html).toContain('TOTAL ACTIVITIES FINANCIAL RECONCILIATION');
  });

  it('7. printGuestActivitiesSummary injects active print sheet into DOM without blank screen', () => {
    const mockSheet = {
      id: 'print-activities-summary-sheet',
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn()
      },
      style: { display: 'none' },
      innerHTML: ''
    };
    const prevDoc = global.document;
    const prevWin = global.window;
    const prevRaf = global.requestAnimationFrame;

    global.document = {
      getElementById: vi.fn().mockReturnValue(mockSheet),
      body: {
        classList: { add: vi.fn(), remove: vi.fn() },
        appendChild: vi.fn(),
        removeChild: vi.fn(),
        contains: vi.fn()
      },
      createElement: vi.fn(),
      title: ''
    };
    global.window = {
      print: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    global.requestAnimationFrame = (cb) => cb();

    vi.useFakeTimers();
    try {
      printGuestActivitiesSummary(sampleHistoryBooking);

      expect(mockSheet.style.display).toBe('block');
      expect(mockSheet.classList.add).toHaveBeenCalledWith('print-active');
      expect(mockSheet.innerHTML.length).toBeGreaterThan(100);
      expect(mockSheet.innerHTML).toContain('ACTIVITIES SUMMARY');
      expect(mockSheet.innerHTML).toContain('Rahul Sharma');

      vi.advanceTimersByTime(3000);
    } finally {
      vi.useRealTimers();
      global.document = prevDoc;
      global.window = prevWin;
      global.requestAnimationFrame = prevRaf;
    }
  });

  it('8. Verifies that public/styles.css and dist/styles.css include print-active display rules for activities summary', () => {
    const fs = require('fs');
    const publicCss = fs.readFileSync('public/styles.css', 'utf-8');
    const distCss = fs.readFileSync('dist/styles.css', 'utf-8');

    expect(publicCss).toContain('#print-activities-summary-sheet.print-active');
    expect(distCss).toContain('#print-activities-summary-sheet.print-active');
    expect(publicCss).toContain('.guest-activities-summary-sheet');
    expect(distCss).toContain('.guest-activities-summary-sheet');
  });
});
