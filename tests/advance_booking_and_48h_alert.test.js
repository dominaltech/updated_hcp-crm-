import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import fs from 'fs';
import path from 'path';

describe('Advance Booking & 48-Hour Blinking Alert Feature', () => {
  beforeEach(() => {
    // Clear test advance bookings
    db.prepare('DELETE FROM advance_bookings').run();
  });

  it('1. Successfully inserts advance booking with customer name, age, address, room, adults, children, checkin/out date & time', async () => {
    const payload = {
      customer_name: 'Anjali Verma',
      age: 29,
      address: 'Indore, Madhya Pradesh',
      phone: '9876543210',
      room_number: '101',
      adults: 2,
      children: 1,
      checkin_date: '2026-10-25',
      checkin_time: '13:00',
      checkout_date: '2026-10-27',
      checkout_time: '11:00',
      advance_amount: 2000,
      payment_mode: 'online',
      notes: 'Need ground floor room if possible'
    };

    const res = await request(app)
      .post('/api/advance-bookings')
      .send(payload)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.customer_name).toBe('Anjali Verma');
    expect(res.body.booking.age).toBe(29);
    expect(res.body.booking.address).toBe('Indore, Madhya Pradesh');
    expect(res.body.booking.room_number).toBe('101');
    expect(res.body.booking.adults).toBe(2);
    expect(res.body.booking.children).toBe(1);
    expect(res.body.booking.status).toBe('pending');
    expect(res.body.booking.booking_number).toMatch(/^ADV-\d+-\d+$/);
  });

  it('2. Correctly flags bookings within 48 hours for red blinking alert', async () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    
    // Booking 1: Tomorrow (within 24 hours -> definitely <= 48h)
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
    const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

    // Booking 2: Next week (7 days away -> > 48h)
    const nextWeek = new Date(today.getTime() + 7 * 24 * 3600 * 1000);
    const nextWeekStr = `${nextWeek.getFullYear()}-${pad(nextWeek.getMonth() + 1)}-${pad(nextWeek.getDate())}`;

    // Insert Booking 1 (Urgent < 48h)
    await request(app).post('/api/advance-bookings').send({
      customer_name: 'Vikram Singh',
      room_number: '102',
      adults: 2,
      children: 0,
      checkin_date: tomorrowStr,
      checkin_time: '14:00',
      checkout_date: '2026-10-25',
      checkout_time: '11:00'
    }).expect(200);

    // Insert Booking 2 (Not urgent > 48h)
    await request(app).post('/api/advance-bookings').send({
      customer_name: 'Meera Patel',
      room_number: '103',
      adults: 1,
      children: 0,
      checkin_date: nextWeekStr,
      checkin_time: '12:00',
      checkout_date: '2026-10-30',
      checkout_time: '11:00'
    }).expect(200);

    const res = await request(app).get('/api/advance-bookings').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.totalPending).toBe(2);
    expect(res.body.urgentCount).toBe(1);
    expect(res.body.urgent48h.length).toBe(1);
    expect(res.body.urgent48h[0].customer_name).toBe('Vikram Singh');
    expect(res.body.urgent48h[0].is_within_48h).toBe(true);
  });

  it('3. Successfully updates status to completed and removes from urgent list', async () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const tomorrow = new Date(today.getTime() + 20 * 3600 * 1000);
    const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

    const createRes = await request(app).post('/api/advance-bookings').send({
      customer_name: 'Deepak Kumar',
      room_number: '104',
      adults: 3,
      children: 1,
      checkin_date: tomorrowStr,
      checkin_time: '12:00',
      checkout_date: '2026-10-25',
      checkout_time: '11:00'
    });

    const bookingId = createRes.body.booking.id;

    // Verify it is in urgent48h
    let listRes = await request(app).get('/api/advance-bookings');
    expect(listRes.body.urgentCount).toBe(1);

    // Mark as completed
    await request(app)
      .patch(`/api/advance-bookings/${bookingId}/status`)
      .send({ status: 'completed' })
      .expect(200);

    // Verify it moved from pending to completed and urgentCount is now 0
    listRes = await request(app).get('/api/advance-bookings');
    expect(listRes.body.urgentCount).toBe(0);
    expect(listRes.body.totalPending).toBe(0);
    expect(listRes.body.totalCompleted).toBe(1);
    expect(listRes.body.completed[0].customer_name).toBe('Deepak Kumar');
  });

  it('4. Verifies HospitalityPage and styles.css contain required Advance Booking and 48h blinking popup elements', () => {
    const hospFile = path.join(__dirname, '..', 'src', 'pages', 'HospitalityPage.jsx');
    const hospContent = fs.readFileSync(hospFile, 'utf8');

    // Button left side of room transfer
    expect(hospContent).toContain('id="btn-advance-booking"');
    expect(hospContent).toContain('Advance Booking');

    // 48-hour blinking alert popup
    expect(hospContent).toContain('id="adv-urgent-blinking-popup"');
    expect(hospContent).toContain('c/n :');
    expect(hospContent).toContain('c/o :');
    expect(hospContent).toContain('Room :');
    expect(hospContent).toContain('Adults :');

    // Modal tabs and fields in AdvanceBookingModal.jsx
    const modalFile = path.join(__dirname, '..', 'src', 'components', 'hospitality', 'AdvanceBookingModal.jsx');
    const modalContent = fs.readFileSync(modalFile, 'utf8');
    expect(modalContent).toContain('Pendings');
    expect(modalContent).toContain('Completed');
    expect(modalContent).toContain('customer_name');
    expect(modalContent).toContain('age');
    expect(modalContent).toContain('address');
    expect(modalContent).toContain('room_number');
    expect(modalContent).toContain('adults');
    expect(modalContent).toContain('children');
    expect(modalContent).toContain('checkin_date');
    expect(modalContent).toContain('checkout_date');

    // CSS animations in public/styles.css
    const cssFile = path.join(__dirname, '..', 'public', 'styles.css');
    const cssContent = fs.readFileSync(cssFile, 'utf8');
    expect(cssContent).toContain('@keyframes redBlinkPulse');
    expect(cssContent).toContain('.adv-urgent-blinking-popup');
    expect(cssContent).toContain('.btn-advance-booking');
  });
});
