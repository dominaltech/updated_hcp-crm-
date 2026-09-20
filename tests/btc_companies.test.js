import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken } from '../middleware/auth';

describe('Corporate BTC Companies Management API Test Suite', () => {
  let managerToken;
  let unauthorizedToken;
  let testCompanyId;

  beforeAll(() => {
    managerToken = generateToken({
      id: 9991,
      username: 'test_manager',
      role: 'manager',
      full_name: 'Hotel Manager',
      can_access_manager: 1
    });

    unauthorizedToken = generateToken({
      id: 9993,
      username: 'test_cleaner',
      role: 'housekeeping',
      full_name: 'Room Cleaner',
      can_access_manager: 0
    });
  });

  afterAll(() => {
    if (testCompanyId) {
      db.prepare("DELETE FROM btc_companies WHERE id = ?").run(testCompanyId);
    }
  });

  it('1. should register a new BTC company using frontend field names (name, gstin, phone, credit_limit)', async () => {
    const res = await request(app)
      .post('/api/btc-companies')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: 'Infosys BPM Technologies',
        gstin: '27AABCI1234F1Z5',
        pan: 'AABCI1234F',
        contact_person: 'Rajesh Sharma',
        phone: '9820011223',
        email: 'billing@infosysbpm.test',
        credit_limit: 150000,
        address: 'Hinjewadi Phase 2, Pune'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    testCompanyId = res.body.id;

    // Verify in db
    const row = db.prepare("SELECT * FROM btc_companies WHERE id = ?").get(testCompanyId);
    expect(row).toBeDefined();
    expect(row.company_name).toBe('Infosys BPM Technologies');
    expect(row.gst_number).toBe('27AABCI1234F1Z5');
    expect(row.credit_limit).toBe(150000);
    expect(row.is_active).toBe(1);
  });

  it('2. should list BTC companies with both database columns and frontend aliases', async () => {
    const res = await request(app)
      .get('/api/btc-companies')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body.companies;
    expect(Array.isArray(list)).toBe(true);

    const found = list.find(c => c.id === testCompanyId);
    expect(found).toBeDefined();
    expect(found.company_name).toBe('Infosys BPM Technologies');
    expect(found.name).toBe('Infosys BPM Technologies');
    expect(found.gst_number).toBe('27AABCI1234F1Z5');
    expect(found.gstin).toBe('27AABCI1234F1Z5');
    expect(found.phone).toBe('9820011223');
    expect(found.email).toBe('billing@infosysbpm.test');
    expect(found.credit_limit).toBe(150000);
  });

  it('3. should update BTC company details', async () => {
    const res = await request(app)
      .put(`/api/btc-companies/${testCompanyId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: 'Infosys BPM Technologies Ltd',
        contact_person: 'Pooja Nair',
        phone: '9820099887',
        email: 'pooja.nair@infosysbpm.test',
        credit_limit: 200000,
        address: 'Phase 2 Tech Park, Pune'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = db.prepare("SELECT * FROM btc_companies WHERE id = ?").get(testCompanyId);
    expect(updated.company_name).toBe('Infosys BPM Technologies Ltd');
    expect(updated.contact_person).toBe('Pooja Nair');
    expect(updated.credit_limit).toBe(200000);
  });

  it('4. should deactivate BTC company via DELETE endpoint', async () => {
    const res = await request(app)
      .delete(`/api/btc-companies/${testCompanyId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const deactivated = db.prepare("SELECT is_active FROM btc_companies WHERE id = ?").get(testCompanyId);
    expect(deactivated.is_active).toBe(0);
  });

  it('5. should reject unauthorized roles from managing BTC companies', async () => {
    const res = await request(app)
      .post('/api/btc-companies')
      .set('Authorization', `Bearer ${unauthorizedToken}`)
      .send({
        name: 'Unauthorized Attempt Corp'
      });

    expect(res.status).toBe(403);
  });
});
