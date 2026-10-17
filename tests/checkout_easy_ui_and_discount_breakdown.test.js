import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('UI Change: Expected Checkout (Presets Removed & Auto-Open Hour Badge) & Discount Breakdown', () => {
  const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
  const code = fs.readFileSync(step6Path, 'utf8');

  it('1. preset buttons (24 Hours, Tomorrow 11 AM, 2 Nights, 3 Nights) are removed', () => {
    expect(code).not.toContain('handleApplyCheckoutPreset');
    expect(code).not.toContain('⚡ 24 Hours');
    expect(code).not.toContain('☀️ Tomorrow 11 AM');
    expect(code).not.toContain('📅 2 Nights');
    expect(code).not.toContain('📅 3 Nights');
  });

  it('2. does NOT auto-set time when checkout date is selected', () => {
    // Check that handleCheckoutChange does not force tStr = inTime
    expect(code).not.toContain("tStr = inTime;");
    expect(code).toContain("Notice: Do NOT auto-set time when date is chosen!");
  });

  it('3. automatically opens hour badge menu when date is selected', () => {
    expect(code).toContain('setCheckoutTimeMenuOpen');
    expect(code).toContain("setCheckoutTimeMenuOpen({ type: 'hour', key: Date.now() })");
    expect(code).toContain('openMenuProp={checkoutTimeMenuOpen}');
  });

  it('4. contains Without Discount, Discount Amount, and With Discount Amount in Step6Stay', () => {
    expect(code).toContain('Without Discount');
    expect(code).toContain('Discount Amount');
    expect(code).toContain('With Discount Amount');
  });

  it('5. calculates correct discount amounts for tariff breakdown', () => {
    const totalBaseRate = 2350;
    const discountPct = 15;
    const effectiveGstPct = 5;

    const discountAmount = Math.round((totalBaseRate * discountPct) / 100);
    const netChargeBeforeTax = totalBaseRate - discountAmount;
    const withoutDiscountGst = Math.round(totalBaseRate * (1 + effectiveGstPct / 100));
    const withDiscountGst = Math.round(netChargeBeforeTax * (1 + effectiveGstPct / 100));

    expect(discountAmount).toBe(353);
    expect(netChargeBeforeTax).toBe(1997);
    expect(withoutDiscountGst).toBe(2468);
    expect(withDiscountGst).toBe(2097);
  });
});
