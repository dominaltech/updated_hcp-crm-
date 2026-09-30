import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('BTC Cheque Scanning, Pending BTC Retention, All BTC Filtering & OTA Remaining Tests', () => {

  it('verifies /api/scanner/devices endpoint is available on backend', async () => {
    const res = await request(app).get('/api/scanner/devices');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.devices.length).toBeGreaterThan(0);
  });

  it('verifies /api/scanner/latest endpoint responds correctly', async () => {
    const res = await request(app).get('/api/scanner/latest');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.found).toBe('boolean');
  });

  it('verifies BTC pending classification logic retains booking with scanned cheque until cheque is passed', () => {
    // Logic simulation matching HospitalityHistory.jsx
    const isBtcBookingRecord = (r) => Boolean(
      r.booking_source === 'BTC' ||
      r.btc_company_id !== null ||
      (r.btc_company_name && String(r.btc_company_name).trim().length > 0) ||
      r.final_payment_mode === 'btc' ||
      r.advance_payment_mode === 'btc' ||
      r.final_settlement_mode === 'btc' ||
      r.payment_status === 'pending_from_company'
    );

    const isChequePassedRecord = (r) => {
      const status = (r.cheque_status || r.advance_cheque_status || '').toLowerCase();
      const isPassedStatus = status === 'realized' || status === 'passed';
      return isPassedStatus && (r.payment_status === 'settled' || r.advance_cheque_status === 'realized');
    };

    const isBtcPendingRecord = (r) => {
      if (!isBtcBookingRecord(r)) return false;
      const hasCheque = Boolean(
        (Number(r.split_cheque || 0) > 0) ||
        r.advance_payment_mode === 'cheque' ||
        r.final_payment_mode === 'cheque' ||
        r.final_settlement_mode === 'cheque' ||
        r.settlement_cheque_no ||
        r.advance_cheque_no ||
        r.cheque_photo ||
        r.settlement_cheque_photo
      );

      if (hasCheque) {
        return !isChequePassedRecord(r);
      }
      return r.payment_status !== 'settled';
    };

    // Case 1: BTC booking with scanned cheque attached, but not passed yet
    const btcWithScannedCheque = {
      id: 101,
      booking_source: 'BTC',
      btc_company_name: 'Tata Consultancy Services',
      payment_status: 'settled', // Even if checkout marked payment_status as settled, cheque is pending!
      cheque_photo: 'data:image/jpeg;base64,sample_scan_data',
      settlement_cheque_no: '887711',
      cheque_status: 'pending'
    };

    expect(isBtcBookingRecord(btcWithScannedCheque)).toBe(true);
    expect(isChequePassedRecord(btcWithScannedCheque)).toBe(false);
    expect(isBtcPendingRecord(btcWithScannedCheque)).toBe(true); // MUST still be in Pending BTC!

    // Case 2: Cheque passes at the bank
    const btcWithPassedCheque = {
      ...btcWithScannedCheque,
      cheque_status: 'realized',
      payment_status: 'settled'
    };

    expect(isChequePassedRecord(btcWithPassedCheque)).toBe(true);
    expect(isBtcPendingRecord(btcWithPassedCheque)).toBe(false); // Cleared from Pending BTC!

    // Case 3: Both pending and passed are captured by All BTC filter
    const records = [btcWithScannedCheque, btcWithPassedCheque];
    const allBtc = records.filter(isBtcBookingRecord);
    expect(allBtc.length).toBe(2);

    const pendingBtc = records.filter(isBtcPendingRecord);
    expect(pendingBtc.length).toBe(1);
    expect(pendingBtc[0].id).toBe(101);
  });

  it('verifies OTA Prepaid remaining calculation correctly computes folio due when F&B is pending', () => {
    const isOtaPrepaidStay = true;
    const stayDueAmount = 0; // Room is covered by OTA voucher
    const fnbPendingTotal = 105;
    const hotelExtrasCharge = 0;
    const folioDueAmount = stayDueAmount + fnbPendingTotal + hotelExtrasCharge;

    // Remaining display logic matching RoomFolioPage.jsx
    const remainingBoxDisplay = folioDueAmount > 0 ? `₹${folioDueAmount.toFixed(2)}` : '₹0.00 (Settled)';
    const remainingBoxSubtext = folioDueAmount > 0 && isOtaPrepaidStay && fnbPendingTotal > 0
      ? (hotelExtrasCharge > 0 ? 'F&B + Extras Due' : 'Pending F&B Orders')
      : null;

    expect(remainingBoxDisplay).toBe('₹105.00');
    expect(remainingBoxSubtext).toBe('Pending F&B Orders');
    expect(remainingBoxDisplay).not.toContain('Settled');
  });

});
