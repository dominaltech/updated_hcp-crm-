import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';

describe('Section Startup Passwords & Verification API', () => {
  beforeEach(() => {
    // Reset test passwords in system_settings
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('section_password_hospitality', 'hosp123')").run();
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('section_password_restaurant', 'rest456')").run();
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('section_password_bar', 'bar789')").run();
  });

  it('rejects incorrect password for hospitality section', async () => {
    const res = await request(app)
      .post('/api/sections/verify-password')
      .send({ section: 'hospitality', password: 'wrongpassword' });
    
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('accepts correct password for hospitality section', async () => {
    const res = await request(app)
      .post('/api/sections/verify-password')
      .send({ section: 'hospitality', password: 'hosp123' });
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.section).toBe('hospitality');
  });

  it('accepts correct password for restaurant and bar sections', async () => {
    const resRest = await request(app)
      .post('/api/sections/verify-password')
      .send({ section: 'restaurant', password: 'rest456' });
    expect(resRest.status).toBe(200);
    expect(resRest.body.success).toBe(true);

    const resBar = await request(app)
      .post('/api/sections/verify-password')
      .send({ section: 'bar', password: 'bar789' });
    expect(resBar.status).toBe(200);
    expect(resBar.body.success).toBe(true);
  });

  it('accepts master admin password for any section', async () => {
    const res = await request(app)
      .post('/api/sections/verify-password')
      .send({ section: 'restaurant', password: 'admin123' });
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('reads and updates section passwords via settings endpoints', async () => {
    // Get
    const getRes = await request(app).get('/api/settings/section-passwords');
    expect(getRes.status).toBe(200);
    expect(getRes.body.passwords.hospitality).toBe('hosp123');
    expect(getRes.body.passwords.restaurant).toBe('rest456');
    expect(getRes.body.passwords.bar).toBe('bar789');

    // Update
    const postRes = await request(app)
      .post('/api/settings/section-passwords')
      .send({ hospitality: 'newHosp999', restaurant: 'newRest888', bar: 'newBar777' });
    expect(postRes.status).toBe(200);
    expect(postRes.body.success).toBe(true);

    // Verify updated
    const verifyRes = await request(app)
      .post('/api/sections/verify-password')
      .send({ section: 'hospitality', password: 'newHosp999' });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
  });
});
