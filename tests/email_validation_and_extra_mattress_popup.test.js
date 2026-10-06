import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Email Validation and Extra Mattress Room No Popup Suite', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Email format regex strictly validates standard email domains and extensions', () => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    // Invalid emails must fail
    expect(emailRegex.test('')).toBe(false);
    expect(emailRegex.test('ss')).toBe(false);
    expect(emailRegex.test('ss@')).toBe(false);
    expect(emailRegex.test('ss@gmail')).toBe(false);
    expect(emailRegex.test('ss.com')).toBe(false);
    expect(emailRegex.test('@gmail.com')).toBe(false);
    expect(emailRegex.test('ss@.com')).toBe(false);
    expect(emailRegex.test('ss@gmail.c')).toBe(false);
    expect(emailRegex.test('ss gmail.com')).toBe(false);

    // Valid emails must pass
    expect(emailRegex.test('ss@gmail.com')).toBe(true);
    expect(emailRegex.test('guest@yahoo.com')).toBe(true);
    expect(emailRegex.test('john.doe@outlook.com')).toBe(true);
    expect(emailRegex.test('hotel.stay@citypark.in')).toBe(true);
    expect(emailRegex.test('corporate_booking@corp.co.in')).toBe(true);
  });

  it('2. CheckinWizardModal enforces mandatory and valid email format before advancing and at submit', () => {
    const modalCode = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx'), 'utf-8');

    // validateStep(4) validation
    expect(modalCode).toContain("const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;");
    expect(modalCode).toContain("showToast('Please enter a valid email address (e.g. name@gmail.com).', 'red');");
    expect(modalCode).toContain("showToast('Email address is mandatory.', 'red');");

    // Room No: label check in toast
    expect(modalCode).toContain('Room No: ${room.room_number}!');
    expect(modalCode).not.toContain('Room #${room.room_number}!');
  });

  it('3. Step4Details contains real-time email validation indicator', () => {
    const step4Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step4Details.jsx'), 'utf-8');

    expect(step4Code).toContain('id="input-guest-email"');
    expect(step4Code).toContain('Invalid email (e.g. name@gmail.com)');
    expect(step4Code).toContain('✓ Valid');
    expect(step4Code).toContain('#ef4444');
  });

  it('4. Room Capacity Limit Reached popup renders "Add Extra Mattress to Room No: [room]" without rate and without custom rate button', () => {
    const step6Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf-8');

    // Popup button text uses Room No:
    expect(step6Code).toContain('Add Extra Mattress to Room No: ${room.room_number}');
    expect(step6Code).not.toContain('Add Extra Mattress to Room #${room.room_number} (+₹');

    // Multi-room uses Room No:
    expect(step6Code).toContain('Add Extra Mattress to Room No: ${r.room_number}');
    expect(step6Code).not.toContain('Add Extra Mattress to Room #${r.room_number} (+₹');

    // "Set Custom Rate" option is removed
    expect(step6Code).not.toContain('Set Custom Rate for Extra Mattress');
    expect(step6Code).not.toContain('Set Custom Rate for Room');

    // Room list extra mattress charge span does not allow clicking to edit custom rate
    expect(step6Code).not.toContain("handleOpenExtraBedModal(r.id, 'edit')");
  });
});
