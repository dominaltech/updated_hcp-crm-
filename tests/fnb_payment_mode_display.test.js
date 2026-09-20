import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/printService', () => ({
  printCashReceipt: vi.fn(),
  printGuestRegistrationA4: vi.fn(),
  downloadGuestRegistrationPDF: vi.fn(),
  printGuestPaymentSummary: vi.fn()
}));

import { getFnbPaymentModeInfo } from '../src/pages/RoomFolioPage.jsx';

describe('RoomFolioPage - getFnbPaymentModeInfo Helper', () => {
  it('returns Unknown fallback for null or undefined order', () => {
    const res = getFnbPaymentModeInfo(null);
    expect(res.shortLabel).toBe('Unknown');
    expect(res.icon).toBe('💰');
  });

  it('identifies Cash payment mode correctly', () => {
    const ord = {
      id: 101,
      total: 525,
      is_paid: 1,
      payment_mode: 'cash'
    };
    const res = getFnbPaymentModeInfo(ord);
    expect(res.shortLabel).toBe('Cash');
    expect(res.label).toBe('Cash');
    expect(res.icon).toBe('💵');
    expect(res.color).toBe('#15803d');
  });

  it('identifies Online / UPI payment mode with UTR', () => {
    const ord = {
      id: 102,
      total: 750,
      is_paid: 1,
      payment_mode: 'online',
      utr_number: 'UPI9876543210'
    };
    const res = getFnbPaymentModeInfo(ord);
    expect(res.shortLabel).toBe('UPI / Online');
    expect(res.label).toContain('UPI9876543210');
    expect(res.icon).toBe('📱');
    expect(res.utr).toBe('UPI9876543210');
  });

  it('identifies Card POS payment mode', () => {
    const ord = {
      id: 103,
      total: 1200,
      is_paid: 1,
      payment_mode: 'card'
    };
    const res = getFnbPaymentModeInfo(ord);
    expect(res.shortLabel).toBe('Card POS');
    expect(res.icon).toBe('💳');
  });

  it('identifies Split payment mode with breakdown amounts', () => {
    const ord = {
      id: 104,
      total: 1500,
      is_paid: 1,
      payment_mode: 'split',
      split_cash: 500,
      split_online: 1000,
      split_card: 0,
      utr_number: 'SPLIT-UPI-001'
    };
    const res = getFnbPaymentModeInfo(ord);
    expect(res.shortLabel).toContain('Cash ₹500');
    expect(res.shortLabel).toContain('UPI ₹1000');
    expect(res.icon).toBe('🔀');
    expect(res.utr).toBe('SPLIT-UPI-001');
  });

  it('handles Room Folio pending settlement when unpaid', () => {
    const ord = {
      id: 105,
      total: 450,
      is_paid: 0,
      payment_mode: 'room_folio'
    };
    const res = getFnbPaymentModeInfo(ord);
    expect(res.shortLabel).toBe('Room Folio');
    expect(res.label).toContain('Pending Checkout');
    expect(res.icon).toBe('🏨');
  });
});
