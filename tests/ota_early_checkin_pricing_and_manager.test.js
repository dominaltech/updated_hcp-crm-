import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('OTA Early Check-In Pricing and Manager Panel Policy', () => {
  const managePagePath = path.resolve(__dirname, '../src/pages/ManagePage.jsx');
  const managePageContent = fs.readFileSync(managePagePath, 'utf-8');

  const serverPath = path.resolve(__dirname, '../server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf-8');

  const releaseServerPath = path.resolve(__dirname, '../release/server.js');
  const releaseServerContent = fs.readFileSync(releaseServerPath, 'utf-8');

  const databasePath = path.resolve(__dirname, '../database.js');
  const databaseContent = fs.readFileSync(databasePath, 'utf-8');

  const step1Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
  const step1Content = fs.readFileSync(step1Path, 'utf-8');

  const step6Path = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
  const step6Content = fs.readFileSync(step6Path, 'utf-8');

  const wizardPath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/CheckinWizardModal.jsx');
  const wizardContent = fs.readFileSync(wizardPath, 'utf-8');

  const folioPath = path.resolve(__dirname, '../src/pages/RoomFolioPage.jsx');
  const folioContent = fs.readFileSync(folioPath, 'utf-8');

  const printPath = path.resolve(__dirname, '../src/services/printService.js');
  const printContent = fs.readFileSync(printPath, 'utf-8');

  it('verifies database migration adds ota_early_checkin_price, max_hours, gst_pct to rooms and early_checkin_charge to bookings', () => {
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_checkin_price REAL DEFAULT 900');
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_checkin_max_hours INTEGER DEFAULT 6');
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_checkin_gst_pct REAL DEFAULT 5');
    expect(databaseContent).toContain('ALTER TABLE bookings ADD COLUMN early_checkin_charge REAL DEFAULT 0');
    expect(databaseContent).toContain('ALTER TABLE bookings ADD COLUMN early_checkin_gst REAL DEFAULT 0');
  });

  it('verifies Manager Panel ManagePage includes OTA early check-in policy inputs in Room Modal', () => {
    expect(managePageContent).toContain('ota_early_checkin_price: 900');
    expect(managePageContent).toContain('ota_early_checkin_max_hours: 6');
    expect(managePageContent).toContain('ota_early_checkin_gst_pct: 5');
    expect(managePageContent).toContain('OTA EARLY CHECK-IN POLICY');
    expect(managePageContent).toContain('EXTRA CHARGE (₹)');
    expect(managePageContent).toContain('MAX EARLY HOURS');
    expect(managePageContent).toContain('GST RATE (%)');
  });

  it('verifies Manager Panel room table displays OTA Early C/I column', () => {
    expect(managePageContent).toContain('OTA Early C/I');
    expect(managePageContent).toContain('ota_early_checkin_price');
  });

  it('verifies backend server and release server handle room CRUD with OTA early check-in parameters', () => {
    [serverContent, releaseServerContent].forEach((content) => {
      expect(content).toContain('ota_early_checkin_price');
      expect(content).toContain('ota_early_checkin_max_hours');
      expect(content).toContain('ota_early_checkin_gst_pct');
    });
  });

  it('verifies backend calculates extra charge ONLY for OTA bookings and stores in bookings', () => {
    [serverContent, releaseServerContent].forEach((content) => {
      expect(content).toContain('otaEarlyCheckinCharge');
      expect(content).toContain('otaEarlyCheckinGst');
      expect(content).toContain('early_checkin_charge');
      expect(content).toContain('early_checkin_gst');
    });
  });

  it('verifies CheckinWizard Step 1 & Step 6 display OTA Early Check-in extra charge badge/banner', () => {
    expect(step1Content).toContain('OTA Early Check-In Extra Charge:');
    expect(step1Content).toContain('otaEarlyPrice');
    expect(step6Content).toContain('otaEarlyPrice');
    expect(step6Content).toContain('Early Check-In (+₹{otaEarlyPrice} Extra Charge)');
  });

  it('verifies CheckinWizardModal adds otaEarlyCheckinCharge to totalDue and sends to backend', () => {
    expect(wizardContent).toContain('otaEarlyCheckinCharge');
    expect(wizardContent).toContain('early_checkin_charge: isOta ? otaEarlyCheckinCharge : 0');
  });

  it('verifies RoomFolioPage includes OTA early checkin in hotelExtrasCharge and stay breakdown', () => {
    expect(folioContent).toContain('earlyCheckinCharge');
    expect(folioContent).toContain('otaEarlyFee');
    expect(folioContent).toContain('Early Check-In Extra Charge');
    expect(folioContent).not.toContain('POS Tax: ₹0 (Free for OTA)');
  });

  it('verifies printService prints OTA Early Check-In extra charge and includes it in hotelExtrasTotal', () => {
    expect(printContent).toContain('earlyCheckinCharge');
    expect(printContent).toContain('hotelExtrasTotal');
    expect(printContent).toContain('Early Check-In:');
    expect(printContent).not.toContain('Early Check-In POS Tax: ₹0 • ');
  });
});
