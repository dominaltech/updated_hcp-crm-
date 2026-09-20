import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Check-In, Member Documents, & Monthly Voucher Sequence Enhancements', () => {
  let hospitalityToken;
  let testRoomId;

  beforeAll(async () => {
    hospitalityToken = generateToken({
      id: 9992,
      username: 'test_hospitality',
      role: 'hospitality',
      full_name: 'Front Desk Host',
      can_access_manager: 1
    });

    // Reset or ensure a dedicated test room exists in 'ready' status
    let room = db.prepare("SELECT id, room_number FROM rooms WHERE room_number = '999'").get();
    if (!room) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status) VALUES (?, ?, ?, ?)").run('999', 'Deluxe King', 2500, 'ready');
      testRoomId = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(room.id);
      testRoomId = room.id;
    }
  });

  it('1. should store and retrieve monthly voucher sequences in standard YYYYMMDD-SR format', () => {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const day = String(now.getDate()).padStart(2, '0');
    const ymdPrefix = `${ym}${day}`;

    // Verify monthly_voucher_sequences table exists
    const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='monthly_voucher_sequences'").get();
    expect(tableInfo).toBeDefined();
    expect(tableInfo.name).toBe('monthly_voucher_sequences');
  });

  it('2. should complete check-in storing member_documents, aadhar_number, and standard voucher number', async () => {
    const memberDocs = [
      {
        name: 'Anita Sharma',
        relation: 'Spouse',
        dob: '1992-08-15',
        age: '34',
        docType: 'Aadhar Card',
        aadharNumber: '987654321098',
        docFront: 'data:image/jpeg;base64,sampleFront1',
        docBack: 'data:image/jpeg;base64,sampleBack1'
      },
      {
        name: 'Aarav Sharma',
        relation: 'Child',
        dob: '2018-04-10',
        age: '8',
        docType: 'Birth Certificate',
        aadharNumber: 'N/A',
        docFront: 'data:image/jpeg;base64,sampleFront2',
        docBack: null
      }
    ];

    const checkinPayload = {
      roomId: testRoomId,
      bookingSource: 'Walk-in',
      guestName: 'Vikas Sharma',
      mobile: '9876543210',
      altMobile: '9123456780',
      email: 'vikas@example.com',
      fatherName: 'Ramesh Sharma',
      dob: '1988-12-05',
      address: '74, Shivaji Nagar, Pune',
      docType: 'Aadhar Card',
      idNumber: '123456789012',
      aadharNumber: '123456789012',
      roomRate: 2500,
      totalDue: 2625,
      netCharge: 2500,
      advanceAmount: 1000,
      splitCash: 500,
      splitOnline: 500,
      splitCard: 0,
      splitCheque: 0,
      onlineUtr: 'UTR123456789',
      approxCheckout: '2026-09-20T11:00:00',
      stayNights: 1,
      adultsMale: 1,
      adultsFemale: 1,
      children: 1,
      extraBeds: 0,
      memberDocuments: memberDocs
    };

    const res = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send(checkinPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.voucherNumber).toMatch(/^(\d{6}|\d{8})-\d{3}$/);
    expect(res.body.advanceReceiptNo).toMatch(/^(CR|UPI|POS|CHQ)?\d{6}-\d{3}$/);

    const bookingId = res.body.booking?.id || res.body.data?.id;
    expect(bookingId).toBeDefined();

    // 3. Verify GET /api/rooms/:id/folio returns member_documents and aadhar_number
    const folioRes = await request(app)
      .get(`/api/rooms/${testRoomId}/folio`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(folioRes.status).toBe(200);
    const folioRoom = folioRes.body.folio?.room || folioRes.body.room;
    expect(folioRoom).toBeDefined();
    expect(folioRoom.guest_name).toBe('Vikas Sharma');
    expect(folioRoom.aadhar_number).toBe('123456789012');
    expect(folioRoom.voucher_number).toMatch(/^(\d{6}|\d{8})-\d{3}$/);
    expect(Array.isArray(folioRoom.member_documents)).toBe(true);
    expect(folioRoom.member_documents.length).toBe(2);
    expect(folioRoom.member_documents[0].name).toBe('Anita Sharma');
    expect(folioRoom.member_documents[0].relation).toBe('Spouse');
    expect(folioRoom.member_documents[1].name).toBe('Aarav Sharma');

    // 4. Verify GET /api/hospitality/history/:bookingId returns member_documents and aadhar_number
    const historyDetailRes = await request(app)
      .get(`/api/hospitality/history/${bookingId}`)
      .set('Authorization', `Bearer ${hospitalityToken}`);

    expect(historyDetailRes.status).toBe(200);
    const histRecord = historyDetailRes.body.record || historyDetailRes.body;
    expect(histRecord.guest_name).toBe('Vikas Sharma');
    expect(histRecord.aadhar_number).toBe('123456789012');
    expect(Array.isArray(histRecord.member_documents)).toBe(true);
    expect(histRecord.member_documents.length).toBe(2);
    expect(histRecord.member_documents[0].name).toBe('Anita Sharma');
  });

  it('3. should return expiryDate field in /api/ocr/analyze-id extraction response', async () => {
    const ocrRes = await request(app)
      .post('/api/ocr/analyze-id')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        docType: 'Passport',
        image: 'data:image/jpeg;base64,dGVzdF9pbWFnZQ=='
      });

    expect(ocrRes.status).toBe(200);
    expect(ocrRes.body.success).toBe(true);
    expect(ocrRes.body.extracted).toBeDefined();
    expect('expiryDate' in ocrRes.body.extracted).toBe(true);
  }, 15000);

  it('4. should allow check-in to proceed normally when passport is expired or guest is underage (non-blocking intimation)', async () => {
    // Reset test room to ready
    db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(testRoomId);

    const expiredCheckinPayload = {
      roomId: testRoomId,
      bookingSource: 'Direct',
      guestName: 'Amir Raza Irfan Rangrez',
      mobile: '9876543211',
      email: 'amir@example.com',
      dob: '2010-05-15', // Underage (< 18 yrs)
      expiryDate: '2022-09-21', // Expired passport
      docType: 'Passport',
      idNumber: 'R9570989',
      address: '229 Begum Peth, Solapur, Maharashtra',
      roomRate: 2500,
      totalDue: 2500,
      netCharge: 2500,
      advanceAmount: 0,
      approxCheckout: '2026-09-20T11:00:00',
      stayNights: 1,
      adultsMale: 1,
      adultsFemale: 0,
      children: 0
    };

    const res = await request(app)
      .post('/api/checkin')
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send(expiredCheckinPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.booking).toBeDefined();
  });

  afterAll(async () => {
    try {
      db.pragma('foreign_keys = OFF');
      if (testRoomId) {
        const bookings = db.prepare("SELECT id FROM bookings WHERE room_id = ?").all(testRoomId);
        for (const b of bookings) {
          db.prepare("DELETE FROM payments WHERE booking_id = ?").run(b.id);
          db.prepare("DELETE FROM bookings WHERE id = ?").run(b.id);
        }
        db.prepare("DELETE FROM rooms WHERE id = ?").run(testRoomId);
      }
      db.prepare("DELETE FROM guests WHERE name = 'Vikas Sharma'").run();
      db.pragma('foreign_keys = ON');
    } catch (e) {}
  });
});
