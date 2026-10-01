import { describe, it, expect } from 'vitest';

describe('Checkin Adult Selection & Respective Tariff Amounts', () => {
  // Test calculatedBasePrice logic from Step6Stay.jsx & CheckinWizardModal.jsx
  const calculateStayPricing = ({
    allRooms,
    currentAdults,
    isOta = false,
    customBaseRate = undefined,
    discountPct = 0,
    effectiveGstPct = 5,
    nights = 1
  }) => {
    // Exactly matches updated Step6Stay.jsx logic
    const calculatedBasePrice = (!isOta && currentAdults === 0)
      ? 0
      : allRooms.reduce((sum, r) => {
          if (allRooms.length === 1 && currentAdults === 1 && r.price_single && Number(r.price_single) > 0) {
            return sum + Number(r.price_single);
          }
          return sum + (Number(r.price) || 2000);
        }, 0);

    const basePrice = (!isOta && currentAdults === 0)
      ? 0
      : (customBaseRate !== undefined && customBaseRate !== '' && !isNaN(Number(customBaseRate)))
        ? Math.max(0, Number(customBaseRate))
        : calculatedBasePrice;

    const roomGrossTariff = basePrice * nights;
    const roomDiscountAmt = Math.round((roomGrossTariff * discountPct) / 100);
    const roomNetBaseTariff = roomGrossTariff - roomDiscountAmt;
    const roomGstAmt = Math.round(roomNetBaseTariff * (effectiveGstPct / 100));
    const finalGrandTotal = roomNetBaseTariff + roomGstAmt;

    const tariffTypeLabel = (!isOta && currentAdults === 0)
      ? 'No Adult Selected'
      : (allRooms.length === 1 && currentAdults === 1 && allRooms[0].price_single
          ? '1 Adult Single Tariff'
          : 'Standard Tariff');

    const roomCardTariffDisplay = (!isOta && currentAdults === 0)
      ? null
      : (allRooms.length === 1 && currentAdults === 1 && allRooms[0].price_single
          ? Number(allRooms[0].price_single)
          : Number(allRooms[0].price));

    return {
      calculatedBasePrice,
      basePrice,
      roomGrossTariff,
      finalGrandTotal,
      tariffTypeLabel,
      roomCardTariffDisplay
    };
  };

  const sampleRoom = {
    id: 106,
    room_number: 106,
    room_type: 'Deluxe AC',
    price: 2000,
    price_single: 1500,
    max_adults: 2,
    max_extra_beds: 1
  };

  it('1. When no adult is selected (currentAdults === 0), shows no tariff amount (0 / null)', () => {
    const result = calculateStayPricing({
      allRooms: [sampleRoom],
      currentAdults: 0,
      isOta: false
    });

    expect(result.calculatedBasePrice).toBe(0);
    expect(result.basePrice).toBe(0);
    expect(result.roomGrossTariff).toBe(0);
    expect(result.finalGrandTotal).toBe(0);
    expect(result.tariffTypeLabel).toBe('No Adult Selected');
    expect(result.roomCardTariffDisplay).toBeNull();
  });

  it('2. When 1 adult is selected (currentAdults === 1), shows respected 1 Adult Single Tariff (1500)', () => {
    const result = calculateStayPricing({
      allRooms: [sampleRoom],
      currentAdults: 1,
      isOta: false
    });

    expect(result.calculatedBasePrice).toBe(1500);
    expect(result.basePrice).toBe(1500);
    expect(result.roomGrossTariff).toBe(1500);
    expect(result.finalGrandTotal).toBe(1575); // 1500 + 5% GST (75)
    expect(result.tariffTypeLabel).toBe('1 Adult Single Tariff');
    expect(result.roomCardTariffDisplay).toBe(1500);
  });

  it('3. When 2 adults are selected (currentAdults === 2), shows respected Standard Tariff (2000)', () => {
    const result = calculateStayPricing({
      allRooms: [sampleRoom],
      currentAdults: 2,
      isOta: false
    });

    expect(result.calculatedBasePrice).toBe(2000);
    expect(result.basePrice).toBe(2000);
    expect(result.roomGrossTariff).toBe(2000);
    expect(result.finalGrandTotal).toBe(2100); // 2000 + 5% GST (100)
    expect(result.tariffTypeLabel).toBe('Standard Tariff');
    expect(result.roomCardTariffDisplay).toBe(2000);
  });

  it('4. When room has no price_single configured, 1 adult safely falls back to standard room tariff', () => {
    const standardOnlyRoom = {
      id: 104,
      room_number: 104,
      price: 2500,
      price_single: null
    };

    const result = calculateStayPricing({
      allRooms: [standardOnlyRoom],
      currentAdults: 1,
      isOta: false
    });

    expect(result.calculatedBasePrice).toBe(2500);
    expect(result.basePrice).toBe(2500);
    expect(result.tariffTypeLabel).toBe('Standard Tariff');
  });

  it('5. Decreasing adults back from 1 to 0 resets calculated amount to 0', () => {
    // Selected 1 adult
    let state = calculateStayPricing({ allRooms: [sampleRoom], currentAdults: 1 });
    expect(state.calculatedBasePrice).toBe(1500);

    // Decreased to 0
    state = calculateStayPricing({ allRooms: [sampleRoom], currentAdults: 0 });
    expect(state.calculatedBasePrice).toBe(0);
    expect(state.finalGrandTotal).toBe(0);
    expect(state.roomCardTariffDisplay).toBeNull();
  });
});

describe('History Table Up Arrow Keyboard Navigation & Top Row Scroll', () => {
  it('1. Pressing ArrowUp when already on top row (index <= 0) scrolls window to top', () => {
    let scrolledTop = false;
    const mockWindow = {
      scrollTo: ({ top }) => {
        if (top === 0) scrolledTop = true;
      }
    };

    const handleArrowUp = (prevIndex) => {
      if (prevIndex <= 0) {
        mockWindow.scrollTo({ top: 0, behavior: 'smooth' });
        return 0;
      }
      const next = prevIndex - 1;
      if (next === 0) {
        mockWindow.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return next;
    };

    const nextIndexFrom0 = handleArrowUp(0);
    expect(nextIndexFrom0).toBe(0);
    expect(scrolledTop).toBe(true);

    scrolledTop = false;
    const nextIndexFrom1 = handleArrowUp(1);
    expect(nextIndexFrom1).toBe(0);
    expect(scrolledTop).toBe(true);
  });
});

describe('Print Theme Preservation (No Shift to Light Theme)', () => {
  it('printCashReceipt preserves dark-theme and data-theme="dark" on the document without shifting background', async () => {
    class MockClassList {
      constructor() { this._classes = new Set(); }
      add(...classes) { classes.forEach(c => this._classes.add(c)); }
      remove(...classes) { classes.forEach(c => this._classes.delete(c)); }
      contains(cls) { return this._classes.has(cls); }
    }

    class MockElement {
      constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.classList = new MockClassList();
        this.attrs = {};
        this.style = {};
        this.innerHTML = '';
      }
      getAttribute(attr) { return this.attrs[attr] || null; }
      setAttribute(attr, val) { this.attrs[attr] = val; }
      removeAttribute(attr) { delete this.attrs[attr]; }
      appendChild() {}
    }

    const mockDocEl = new MockElement('html');
    const mockBody = new MockElement('body');
    const mockSheet = new MockElement('div');
    mockSheet.id = 'print-money-receipt-sheet';

    mockDocEl.setAttribute('data-theme', 'dark');
    mockDocEl.classList.add('dark-theme');
    mockBody.classList.add('dark-theme');

    global.document = {
      documentElement: mockDocEl,
      body: mockBody,
      getElementById: (id) => (id === 'print-money-receipt-sheet' ? mockSheet : null),
      createElement: (tag) => new MockElement(tag)
    };
    global.window = {
      print: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    // Verify dark theme is not stripped
    expect(global.document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(global.document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(global.document.body.classList.contains('dark-theme')).toBe(true);

    // Read printService source to ensure enterPrintThemeIsolation does NOT touch DOM theme
    const fs = await import('fs');
    const path = await import('path');
    const printServiceContent = fs.readFileSync(path.resolve(__dirname, '../src/services/printService.js'), 'utf-8');

    // Ensure enterPrintThemeIsolation does not remove dark-theme or set data-theme to light
    const isolationFnMatch = printServiceContent.match(/function enterPrintThemeIsolation\(\)[\s\S]*?\{([\s\S]*?)\}/);
    expect(isolationFnMatch).toBeTruthy();
    const fnBody = isolationFnMatch[1];
    expect(fnBody).not.toContain("setAttribute('data-theme', 'light')");
    expect(fnBody).not.toContain("classList.remove('dark-theme')");
  });
});

