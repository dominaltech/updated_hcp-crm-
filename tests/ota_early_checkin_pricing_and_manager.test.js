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

  it('verifies database migration adds ota early check-in slabs to rooms and early_checkin_charge to bookings', () => {
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_checkin_price REAL DEFAULT 900');
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_6h_rate REAL DEFAULT 900');
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_9h_rate REAL DEFAULT 1200');
    expect(databaseContent).toContain('ALTER TABLE rooms ADD COLUMN ota_early_12h_rate REAL DEFAULT 1500');
    expect(databaseContent).toContain('ALTER TABLE bookings ADD COLUMN early_checkin_charge REAL DEFAULT 0');
    expect(databaseContent).toContain('ALTER TABLE bookings ADD COLUMN early_checkin_gst REAL DEFAULT 0');
  });

  it('verifies Manager Panel ManagePage includes OTA early check-in policy slabs in Room Modal', () => {
    expect(managePageContent).toContain('ota_early_6h_rate: 900');
    expect(managePageContent).toContain('ota_early_9h_rate: 1200');
    expect(managePageContent).toContain('ota_early_12h_rate: 1500');
    expect(managePageContent).toContain('OTA EARLY CHECK-IN POLICY');
    expect(managePageContent).toContain('6hour Early');
    expect(managePageContent).toContain('9hour Early');
    expect(managePageContent).toContain('12hour Early');
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
    expect(folioContent).toContain('Early Check-In:');
    expect(folioContent).not.toContain('POS Tax: ₹0 (Free for OTA)');
  });

  it('verifies Step6Stay includes otaEarlyCheckinCharge in totalHotelExtras and displays Early Check-In Surcharge in Extra Bookings at Hotel', () => {
    const freshStep6 = fs.readFileSync(step6Path, 'utf-8');
    expect(freshStep6).toContain('const otaEarlyCheckinCharge = (isOta && draft.isEarlyCheckin) ? otaEarlyPrice : 0;');
    expect(freshStep6).toContain('totalHotelExtras = isOta ? (extraBedCharge + extraRoomsCharge + extraBreakfastCharge + extensionCharge + otaEarlyCheckinCharge) : 0;');
    expect(freshStep6).toContain('🌅 Early Check-In Surcharge:');
    expect(freshStep6).toContain('+ {formatCurrency(otaEarlyCheckinCharge)}');
  });
});

