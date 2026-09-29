import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Check-In Print Verification (Print Check-In Form / Reg Card, Not Receipt)', () => {
  it('verifies CheckinWizardModal imports and calls printGuestRegistrationA4 upon check-in completion, and does NOT call printCashReceipt', () => {
    const filePath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Must import printGuestRegistrationA4
    expect(content).toContain('printGuestRegistrationA4');

    // 2. Must NOT import or call printCashReceipt
    expect(content).not.toContain('printCashReceipt');

    // 3. Must call printGuestRegistrationA4 in handleSubmit
    expect(content).toContain('printGuestRegistrationA4(regData, { includePhotos: false });');
  });
});
