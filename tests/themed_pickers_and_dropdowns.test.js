import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Themed Pickers and Dropdowns In-Theme Verification', () => {
  const rootSrc = path.resolve(__dirname, '../src');

  const checkFileForNativePickers = (relativePath, checkDate = true, checkSelect = false) => {
    const fullPath = path.join(rootSrc, relativePath);
    const content = fs.readFileSync(fullPath, 'utf-8');

    if (checkDate) {
      const dateMatches = content.match(/type=["']date["']/g);
      expect(dateMatches, `${relativePath} should not have native type="date" inputs`).toBeNull();
    }

    if (checkSelect) {
      const selectMatches = content.match(/<select[\s>]/g);
      expect(selectMatches, `${relativePath} should not have native <select> elements`).toBeNull();
    }

    return content;
  };

  it('Step6Stay.jsx uses ThemedDatePicker and has no native date inputs', () => {
    const content = checkFileForNativePickers('components/hospitality/CheckinWizard/Step6Stay.jsx', true, false);
    expect(content).toContain('ThemedDatePicker');
    expect(content).toContain('UnifiedTimeInput');
  });

  it('Step4Details.jsx uses ThemedDatePicker and ThemedSelect, with zero native date or select elements', () => {
    const content = checkFileForNativePickers('components/hospitality/CheckinWizard/Step4Details.jsx', true, true);
    expect(content).toContain('ThemedDatePicker');
    expect(content).toContain('ThemedSelect');
  });

  it('Step1Source.jsx uses ThemedDatePicker and has no native date inputs', () => {
    const content = checkFileForNativePickers('components/hospitality/CheckinWizard/Step1Source.jsx', true, false);
    expect(content).toContain('ThemedDatePicker');
  });

  it('Step7Payment.jsx uses ThemedDatePicker and has no native date inputs', () => {
    const content = checkFileForNativePickers('components/hospitality/CheckinWizard/Step7Payment.jsx', true, false);
    expect(content).toContain('ThemedDatePicker');
  });

  it('RoomFolioPage.jsx uses ThemedDatePicker and has no native date inputs', () => {
    const content = checkFileForNativePickers('pages/RoomFolioPage.jsx', true, false);
    expect(content).toContain('ThemedDatePicker');
  });

  it('SettledBillsView.jsx uses ThemedDatePicker and has no native date inputs', () => {
    const content = checkFileForNativePickers('components/restaurant/SettledBillsView.jsx', true, false);
    expect(content).toContain('ThemedDatePicker');
  });

  it('PosManagerPanel.jsx uses ThemedDatePicker and ThemedSelect, with zero native date or select elements', () => {
    const content = checkFileForNativePickers('components/restaurant/PosManagerPanel.jsx', true, true);
    expect(content).toContain('ThemedDatePicker');
    expect(content).toContain('ThemedSelect');
  });

  it('ExpensesPage.jsx uses ThemedDatePicker and ThemedSelect, with zero native date or select elements', () => {
    const content = checkFileForNativePickers('pages/ExpensesPage.jsx', true, true);
    expect(content).toContain('ThemedDatePicker');
    expect(content).toContain('ThemedSelect');
  });

  it('ManagePage.jsx uses ThemedDatePicker and has no native date inputs', () => {
    const content = checkFileForNativePickers('pages/ManagePage.jsx', true, false);
    expect(content).toContain('ThemedDatePicker');
  });

  it('ManagerLockModal.jsx uses ThemedSelect and has no native select elements', () => {
    const content = checkFileForNativePickers('components/common/ManagerLockModal.jsx', false, true);
    expect(content).toContain('ThemedSelect');
  });

  it('TableSettleModal.jsx uses ThemedSelect and has no native select elements', () => {
    const content = checkFileForNativePickers('components/restaurant/TableSettleModal.jsx', false, true);
    expect(content).toContain('ThemedSelect');
  });

  it('BillEditModal.jsx uses ThemedSelect and has no native select elements', () => {
    const content = checkFileForNativePickers('components/restaurant/BillEditModal.jsx', false, true);
    expect(content).toContain('ThemedSelect');
  });
});
