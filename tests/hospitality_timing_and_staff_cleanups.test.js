import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Hospitality Timing, Payment Defaults & Staff Cleanups', () => {
  let managerToken;

  beforeAll(() => {
    managerToken = generateToken({
      id: 9991,
      username: 'test_manager',
      role: 'manager',
      full_name: 'Hotel Manager',
      can_access_manager: 1
    });
  });

  it('1. should verify demo staff accounts desk1 and desk2 are permanently removed from the database', () => {
    const demoUsers = db.prepare("SELECT id, username FROM staff_users WHERE LOWER(username) IN ('desk1', 'desk2')").all();
    expect(demoUsers.length).toBe(0);
  });

  it('2. should verify public front desk staff list does not contain desk1 or desk2', async () => {
    const res = await request(app)
      .get('/api/auth/staff-list-public');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const usernames = (res.body.staff || []).map((s) => s.username?.toLowerCase());
    expect(usernames).not.toContain('desk1');
    expect(usernames).not.toContain('desk2');
  });

  it('3. should verify GET /api/staff does not list desk1 or desk2', async () => {
    const res = await request(app)
      .get('/api/staff')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const usernames = (res.body.staff || []).map((s) => s.username?.toLowerCase());
    expect(usernames).not.toContain('desk1');
    expect(usernames).not.toContain('desk2');
  });
});
