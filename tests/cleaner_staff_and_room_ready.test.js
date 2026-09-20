import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Cleaner Staff Management & Room Clean Modal Workflow', () => {
  let managerToken;
  let hospitalityToken;
  let testRoomId;

  beforeAll(async () => {
    managerToken = generateToken({
      id: 9991,
      username: 'test_manager',
      role: 'manager',
      full_name: 'Jaijeet sir',
      can_access_manager: 1
    });

    hospitalityToken = generateToken({
      id: 9992,
      username: 'test_hospitality',
      role: 'hospitality',
      full_name: 'Front Desk Host',
      can_access_manager: 0
    });

    // Ensure a test room exists
    let room = db.prepare("SELECT id FROM rooms WHERE room_number = '777'").get();
    if (!room) {
      const ins = db.prepare("INSERT INTO rooms (room_number, room_type, price, status) VALUES (?, ?, ?, ?)").run('777', 'Deluxe AC', 2200, 'needs_cleaning');
      testRoomId = ins.lastInsertRowid;
    } else {
      db.prepare("UPDATE rooms SET status = 'needs_cleaning', last_cleaned_by = NULL WHERE id = ?").run(room.id);
      testRoomId = room.id;
    }
  });

  it('1. should fetch active cleaner staff list without requiring manager permissions', async () => {
    const res = await request(app)
      .get('/api/cleaners')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.cleaners)).toBe(true);
    expect(res.body.cleaners.length).toBeGreaterThan(0);

    // Verify properties
    const first = res.body.cleaners[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('status', 'active');
  });

  it('2. should allow manager to add, update, and manage cleaner staff', async () => {
    // 1. Add cleaner
    const addRes = await request(app)
      .post('/api/manager/cleaners')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: 'Pooja Patil Test',
        phone: '9876500001',
        status: 'active'
      })
      .expect(200);

    expect(addRes.body.success).toBe(true);
    expect(addRes.body.cleaner.name).toBe('Pooja Patil Test');
    const createdId = addRes.body.cleaner.id;

    // 2. Update cleaner
    const updateRes = await request(app)
      .put(`/api/manager/cleaners/${createdId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: 'Pooja Patil Renamed',
        phone: '9876500099',
        status: 'active'
      })
      .expect(200);

    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.cleaner.name).toBe('Pooja Patil Renamed');

    // 3. Mark room clean using this cleaner
    const cleanRes = await request(app)
      .post(`/api/rooms/${testRoomId}/clean`)
      .set('Authorization', `Bearer ${hospitalityToken}`)
      .send({
        cleaner_name: 'Pooja Patil Renamed'
      })
      .expect(200);

    expect(cleanRes.body.success).toBe(true);
    expect(cleanRes.body.cleaner_name).toBe('Pooja Patil Renamed');

    // Verify room status is ready and last_cleaned_by is updated in database
    const updatedRoom = db.prepare("SELECT status, last_cleaned_by FROM rooms WHERE id = ?").get(testRoomId);
    expect(updatedRoom.status).toBe('ready');
    expect(updatedRoom.last_cleaned_by).toBe('Pooja Patil Renamed');

    // 4. Delete cleaner
    const delRes = await request(app)
      .delete(`/api/manager/cleaners/${createdId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(delRes.body.success).toBe(true);
  });
});
