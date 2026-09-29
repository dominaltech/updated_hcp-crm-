import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Expenses & Refund Modals: Increased Height & Width, No Scroll', () => {
  const expensesPagePath = path.resolve(__dirname, '../src/pages/ExpensesPage.jsx');
  const expensesCode = fs.readFileSync(expensesPagePath, 'utf-8');

  it('1) Modal container is enlarged to 820px max-width and spacious min-height and 92vh max-height', () => {
    // 820px maxWidth
    expect(expensesCode).toContain("maxWidth: '820px'");
    // minHeight based on category
    expect(expensesCode).toContain("minHeight: formCategory === 'refund' ? '460px' : '540px'");
    // maxHeight 92vh
    expect(expensesCode).toContain("maxHeight: '92vh'");
  });

  it('2) Operational Expense modal arranges Category and Purpose side-by-side in a 2-column grid', () => {
    // Category & Purpose side-by-side
    expect(expensesCode).toMatch(/gridTemplateColumns:\s*'1fr 1fr'[\s\S]*?Category \*[\s\S]*?Purpose \(Child of Category\) \*/);
  });

  it('3) Amount, Payment Mode and UPI UTR fit side-by-side in a 3-column grid when online mode is active', () => {
    expect(expensesCode).toContain("formMode === 'online' ? '1fr 1fr 1.3fr' : '1fr 1fr'");
    expect(expensesCode).toContain('Online / UPI UTR Reference Number *');
  });

  it('4) Modal body has generous padding and maxHeight calc(92vh - 135px)', () => {
    expect(expensesCode).toContain("padding: '20px 26px'");
    expect(expensesCode).toContain("maxHeight: 'calc(92vh - 135px)'");
  });

  it('5) Input fields have comfortable 42px height for clear usability', () => {
    expect(expensesCode).toContain("height: '42px'");
  });
});
