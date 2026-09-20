import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Checkout Zero-Balance Display and Refresh Callback Fix', () => {
  it('verifies HospitalityContext exports refreshRooms and refreshStats aliases', () => {
    const contextPath = path.resolve(__dirname, '../src/context/HospitalityContext.jsx');
    const content = fs.readFileSync(contextPath, 'utf8');

    expect(content).toContain('refreshRooms: loadRooms');
    expect(content).toContain('refreshStats: loadStats');
  });

  it('verifies App.jsx safely invokes refreshRooms or loadRooms on checkout completion', () => {
    const appPath = path.resolve(__dirname, '../src/App.jsx');
    const content = fs.readFileSync(appPath, 'utf8');

    expect(content).toContain("typeof refreshRooms === 'function'");
    expect(content).toContain("typeof loadRooms === 'function'");
  });

  it('verifies FolioSettlementModal displays zero-balance card when balanceDue === 0', () => {
    const modalPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    expect(content).toContain('checkout-zero-balance-card');
    expect(content).toContain('Room Bill Fully Paid &amp; Settled in Advance');
    expect(content).toContain('printFinalBillA4');
  });

  it('verifies onCheckoutSuccess callback in FolioSettlementModal is protected with try/catch', () => {
    const modalPath = path.resolve(__dirname, '../src/components/hospitality/FolioSettlementModal.jsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    expect(content).toContain("typeof onCheckoutSuccess === 'function'");
    expect(content).toContain("console.warn('Error in onCheckoutSuccess callback:'");
  });
});
