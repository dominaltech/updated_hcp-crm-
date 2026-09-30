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

import { buildGuestRegistrationHTML } from '../src/services/printService.js';

describe('Guest Registration Form Tariff & GST calculation', () => {
  it('correctly calculates Room Tariff Net as ₹2,500.00 and GST as ₹125.00 for ₹2,625.00 grand total even when roomTariffNet is passed as 0', () => {
    const html = buildGuestRegistrationHTML({
      guestName: 'Amir Raza Irfan Rangrez',
      room_number: '105',
      bookingSource: 'BTC',
      btcCompanyName: 'Infosys BPM Technologies',
      roomTariffNet: 0,
      taxAmount: 125,
      grandTotal: 2625,
      totalPaid: 0
    });

    // Net Tariff must be 2,500.00 (not 0.00!)
    expect(html).toContain('₹ 2,500.00');
    // GST 5% must be 125.00
    expect(html).toContain('₹ 125.00');
    // Grand Total must be 2,625.00
    expect(html).toContain('₹ 2,625.00');
  });

  it('correctly derives 5% GST and Net Tariff when only total_room_charge of ₹2,625 is provided', () => {
    const html = buildGuestRegistrationHTML({
      guestName: 'Amir Raza',
      room_number: '105',
      total_room_charge: 2625
    });

    expect(html).toContain('₹ 2,500.00');
    expect(html).toContain('₹ 125.00');
    expect(html).toContain('₹ 2,625.00');
  });
});
