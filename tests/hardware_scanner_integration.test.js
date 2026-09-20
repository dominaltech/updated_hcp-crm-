import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

describe('Hardware Scanner Integration & Optical Document Acquisition', () => {
  it('1. verifies that Step2FrontScan uses real hardware scanner and does NOT call simulateOpticalScan', () => {
    const filePath = path.join(__dirname, '../src/components/hospitality/CheckinWizard/Step2FrontScan.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).not.toContain('simulateOpticalScan');
    expect(content).toContain('handleHardwareScan');
    expect(content).toContain('api.scanHardwareDocument');
    expect(content).toContain('api.getScannerDevices');
    expect(content).toContain('compressBase64Image');
  });

  it('2. verifies that Step3BackScan uses real hardware scanner and does NOT call simulateOpticalScan', () => {
    const filePath = path.join(__dirname, '../src/components/hospitality/CheckinWizard/Step3BackScan.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).not.toContain('simulateOpticalScan');
    expect(content).toContain('handleHardwareScan');
    expect(content).toContain('api.scanHardwareDocument');
    expect(content).toContain('api.getScannerDevices');
    expect(content).toContain('compressBase64Image');
  });

  it('3. verifies that Step6Stay companion modal includes hardware scan triggers', () => {
    const filePath = path.join(__dirname, '../src/components/hospitality/CheckinWizard/Step6Stay.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toContain('handleMemberHardwareScan');
    expect(content).toContain('api.scanHardwareDocument');
  });

  it('4. verifies api.js exposes scanner methods with local bridge fallback', () => {
    const filePath = path.join(__dirname, '../src/services/api.js');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toContain('getScannerDevices');
    expect(content).toContain('scanHardwareDocument');
    expect(content).toContain('getLatestScannedDocument');
  });

  it('5. verifies compressBase64Image export exists in imageCompressor.js', () => {
    const filePath = path.join(__dirname, '../src/utils/imageCompressor.js');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toContain('export function compressBase64Image');
  });
});
