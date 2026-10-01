import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getPaymentModeBadge } from '../src/components/restaurant/SettledBillsView.jsx';

describe('Settled Bills Dark Mode CSS & Room Folio Renaming Test Suite', () => {
  it('verifies dark mode CSS rules for settled bill badges and table styling', () => {
    const cssPath = path.resolve(__dirname, '../public/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Token badge in dark mode
    expect(css).toContain('.settled-token-badge');
    expect(css).toContain('[data-theme="dark"] .settled-token-badge');

    // Items summary & grand total in dark mode
    expect(css).toContain('.settled-items-summary');
    expect(css).toContain('[data-theme="dark"] .settled-items-summary');
    expect(css).toContain('.settled-grand-total');
    expect(css).toContain('[data-theme="dark"] .settled-grand-total');

    // Payment mode badges in dark mode
    expect(css).toContain('.settled-paymode-badge');
    expect(css).toContain('.settled-paymode-badge.badge-room-folio');
    expect(css).toContain('[data-theme="dark"] .settled-paymode-badge.badge-room-folio');
    expect(css).toContain('.settled-paymode-badge.badge-cash');
    expect(css).toContain('[data-theme="dark"] .settled-paymode-badge.badge-cash');
    expect(css).toContain('.settled-paymode-badge.badge-upi');
    expect(css).toContain('[data-theme="dark"] .settled-paymode-badge.badge-upi');
    expect(css).toContain('.settled-paymode-badge.badge-card');
    expect(css).toContain('[data-theme="dark"] .settled-paymode-badge.badge-card');

    // Settle Modal banners in dark mode
    expect(css).toContain('[data-theme="dark"] .settle-room-pending-banner');
    expect(css).toContain('[data-theme="dark"] .settle-card-fee-alert');
    expect(css).toContain('[data-theme="dark"] .settle-upi-tax-alert');
    expect(css).toContain('[data-theme="dark"] #pos-online-utr-panel');
  });

  it('verifies getPaymentModeBadge formats room_folio as "Settled to Room"', () => {
    const roomBadge = getPaymentModeBadge('room_folio');
    expect(roomBadge.label).toBe('Settled to Room');
    expect(roomBadge.cls).toBe('badge-room-folio');
    expect(roomBadge.icon).toBe('🏨');

    const upperRoomBadge = getPaymentModeBadge('ROOM_FOLIO');
    expect(upperRoomBadge.label).toBe('Settled to Room');

    const cashBadge = getPaymentModeBadge('cash');
    expect(cashBadge.label).toBe('Cash');
    expect(cashBadge.cls).toBe('badge-cash');

    const upiBadge = getPaymentModeBadge('online');
    expect(upiBadge.label).toBe('Online / UPI');
    expect(upiBadge.cls).toBe('badge-upi');

    const cardBadge = getPaymentModeBadge('card');
    expect(cardBadge.label).toBe('Card POS');
    expect(cardBadge.cls).toBe('badge-card');
  });

  it('verifies TableSettleModal contains updated banner and footer texts', () => {
    const modalPath = path.resolve(__dirname, '../src/components/restaurant/TableSettleModal.jsx');
    const modalContent = fs.readFileSync(modalPath, 'utf8');

    // Renamed banner
    expect(modalContent).toContain('Bill Added to Room (Pending at Checkout)');
    expect(modalContent).not.toContain('Bill Added to Room Folio (Pending at Checkout)');

    // Renamed footer
    expect(modalContent).toContain('🏨 Settled to Room (Pending at Checkout)');
    expect(modalContent).toContain('🏨 Settled to Room (${formatCurrency(grandTotal)})');
  });

  it('verifies BillEditModal and PosManagerPanel use "Settled to Room"', () => {
    const billEditPath = path.resolve(__dirname, '../src/components/restaurant/BillEditModal.jsx');
    const billEditContent = fs.readFileSync(billEditPath, 'utf8');
    expect(billEditContent).toContain("value: 'room_folio', label: '🏨 Settled to Room'");

    const posMgrPath = path.resolve(__dirname, '../src/components/restaurant/PosManagerPanel.jsx');
    const posMgrContent = fs.readFileSync(posMgrPath, 'utf8');
    expect(posMgrContent).toContain('🏨 Settled to Room');
  });
});
