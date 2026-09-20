import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server';
import db from '../database';
import { generateToken, hashPasswordSync, migratePlaintextPasswords } from '../middleware/auth';
import { encryptSecret, decryptSecret, isEncrypted, maskSecret } from '../services/secretManager';

describe('SECURITY AUDIT TEST SUITE', () => {
  let managerToken;
  let hospitalityToken;
  let restaurantToken;
  let barToken;
  let testPlaintextUserId;
  let testInactiveUserId;

  beforeAll(() => {
    // 1. Ensure active manager user exists
    const managerUser = db.prepare("SELECT * FROM staff_users WHERE role = 'manager' AND status = 'active' LIMIT 1").get();
    if (managerUser) {
      managerToken = generateToken(managerUser);
    } else {
      const hashed = hashPasswordSync('admin123');
      const res = db.prepare(`
        INSERT INTO staff_users (username, password, full_name, role, status)
        VALUES ('sec_admin', ?, 'Security Admin', 'manager', 'active')
      `).run(hashed);
      const user = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(res.lastInsertRowid);
      managerToken = generateToken(user);
    }

    // 2. Create test hospitality user
    db.prepare("DELETE FROM staff_users WHERE username IN ('test_hosp', 'test_rest', 'test_bar', 'test_inactive', 'test_plain')").run();
    
    const hospRes = db.prepare(`
      INSERT INTO staff_users (username, password, full_name, role, status)
      VALUES ('test_hosp', ?, 'Test FrontDesk', 'hospitality', 'active')
    `).run(hashPasswordSync('hospPass123'));
    hospitalityToken = generateToken(db.prepare('SELECT * FROM staff_users WHERE id = ?').get(hospRes.lastInsertRowid));

    // 3. Create test restaurant user
    const restRes = db.prepare(`
      INSERT INTO staff_users (username, password, full_name, role, status)
      VALUES ('test_rest', ?, 'Test Waiter', 'restaurant', 'active')
    `).run(hashPasswordSync('restPass123'));
    restaurantToken = generateToken(db.prepare('SELECT * FROM staff_users WHERE id = ?').get(restRes.lastInsertRowid));

    // 4. Create test bar user
    const barRes = db.prepare(`
      INSERT INTO staff_users (username, password, full_name, role, status)
      VALUES ('test_bar', ?, 'Test Bartender', 'bar', 'active')
    `).run(hashPasswordSync('barPass123'));
    barToken = generateToken(db.prepare('SELECT * FROM staff_users WHERE id = ?').get(barRes.lastInsertRowid));

    // 5. Create test inactive user
    const inactRes = db.prepare(`
      INSERT INTO staff_users (username, password, full_name, role, status)
      VALUES ('test_inactive', ?, 'Deactivated Staff', 'hospitality', 'inactive')
    `).run(hashPasswordSync('inactPass123'));
    testInactiveUserId = inactRes.lastInsertRowid;

    // 6. Create test user with legacy plaintext password
    const plainRes = db.prepare(`
      INSERT INTO staff_users (username, password, full_name, role, status)
      VALUES ('test_plain', 'legacyPlain123', 'Legacy Plaintext User', 'hospitality', 'active')
    `).run();
    testPlaintextUserId = plainRes.lastInsertRowid;
  });

  afterAll(() => {
    // Clean up temporary test accounts
    db.prepare("DELETE FROM staff_users WHERE username IN ('test_hosp', 'test_rest', 'test_bar', 'test_inactive', 'test_plain', 'sec_admin')").run();
  });

  // =========================================================================
  // REQUIREMENT 1: PASSWORDS & CREDENTIAL SAFETY
  // =========================================================================
  describe('1. Passwords & Credential Safety', () => {
    it('1.1 should store all standard passwords as bcrypt hashes starting with $2', () => {
      const activeUsers = db.prepare("SELECT username, password FROM staff_users WHERE username NOT IN ('test_plain')").all();
      expect(activeUsers.length).toBeGreaterThan(0);
      for (const u of activeUsers) {
        expect(u.password).toMatch(/^\$2[aby]?\$\d+\$/);
        expect(u.password).not.toBe('admin123');
        expect(u.password).not.toBe('hospPass123');
      }
    });

    it('1.2 should NEVER return password or password hash in GET /api/staff', async () => {
      const res = await request(app)
        .get('/api/staff')
        .set('Authorization', `Bearer ${managerToken}`);
      
      expect(res.status).toBe(200);
      const staffList = Array.isArray(res.body) ? res.body : res.body.staff;
      expect(staffList.length).toBeGreaterThan(0);
      for (const s of staffList) {
        expect(s.password).toBeUndefined();
        expect(s.password_hash).toBeUndefined();
      }
    });

    it('1.3 should NEVER return password or hash in GET /api/auth/staff-list-public', async () => {
      const res = await request(app).get('/api/auth/staff-list-public');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      for (const s of res.body.staff) {
        expect(s.password).toBeUndefined();
        expect(s.password_hash).toBeUndefined();
      }
    });

    it('1.4 should NEVER return password in POST /api/auth/login response', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test_hosp', password: 'hospPass123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.password).toBeUndefined();
      expect(res.body.token).toBeDefined();
    });

    it('1.5 should reject invalid username with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'non_existent_user_9999', password: 'anyPassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid username or password/i);
    });

    it('1.6 should reject wrong password with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test_hosp', password: 'WrongPassword999' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid username or password/i);
    });

    it('1.7 should reject deactivated / inactive users with 403', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test_inactive', password: 'inactPass123' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/deactivated/i);
    });

    it('1.8 should transparently migrate legacy plaintext user to bcrypt on valid login', async () => {
      // Ensure test_plain exists with a legacy plaintext password
      db.prepare("DELETE FROM staff_users WHERE username = 'test_plain'").run();
      const plainRes = db.prepare(`
        INSERT INTO staff_users (username, password, full_name, role, status)
        VALUES ('test_plain', 'legacyPlain123', 'Legacy Plaintext User', 'hospitality', 'active')
      `).run();
      const targetId = plainRes.lastInsertRowid;

      // Verify initial state is plaintext
      const before = db.prepare('SELECT password FROM staff_users WHERE id = ?').get(targetId);
      expect(before.password).toBe('legacyPlain123');

      // Login with plaintext password
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test_plain', password: 'legacyPlain123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();

      // Verify database row has now been upgraded to a bcrypt hash
      const after = db.prepare('SELECT password FROM staff_users WHERE id = ?').get(targetId);
      expect(after.password).toMatch(/^\$2[aby]?\$\d+\$/);
      expect(after.password).not.toBe('legacyPlain123');
    });

    it('1.9 should batch migrate plaintext users via migratePlaintextPasswords(db)', () => {
      // Insert another legacy unhashed user
      const id = db.prepare(`
        INSERT INTO staff_users (username, password, full_name, role, status)
        VALUES ('test_batch_migration', 'batchPlaintextSecret', 'Batch User', 'hospitality', 'active')
      `).run().lastInsertRowid;

      const migratedCount = migratePlaintextPasswords(db);
      expect(migratedCount).toBeGreaterThanOrEqual(1);

      const migratedUser = db.prepare('SELECT password FROM staff_users WHERE id = ?').get(id);
      expect(migratedUser.password).toMatch(/^\$2[aby]?\$\d+\$/);
      expect(migratedUser.password).not.toBe('batchPlaintextSecret');

      db.prepare('DELETE FROM staff_users WHERE id = ?').run(id);
    });
  });

  // =========================================================================
  // REQUIREMENT 2: AUTHENTICATION & ROLE-BASED AUTHORIZATION (RBAC)
  // =========================================================================
  describe('2. Authentication & Role-Based Authorization', () => {
    describe('2.1 Unauthenticated requests rejected with 401', () => {
      const protectedEndpoints = [
        { method: 'post', path: '/api/checkin', body: {} },
        { method: 'post', path: '/api/checkout/1', body: {} },
        { method: 'post', path: '/api/rooms', body: { room_number: '999' } },
        { method: 'delete', path: '/api/rooms/999' },
        { method: 'get', path: '/api/staff' },
        { method: 'post', path: '/api/staff', body: {} },
        { method: 'delete', path: '/api/hospitality/history/1' },
        { method: 'post', path: '/api/hospitality/history/purge', body: {} },
        { method: 'post', path: '/api/restaurant/tables/1/settle', body: {} },
        { method: 'post', path: '/api/restaurant/settled-bills/delete', body: {} },
        { method: 'post', path: '/api/bar/tables/1/settle', body: {} },
        { method: 'post', path: '/api/bar/settled-bills/delete', body: {} },
        { method: 'get', path: '/api/settings/ai-key' },
        { method: 'post', path: '/api/settings/ai-key', body: { key: 'test' } },
        { method: 'get', path: '/api/manager/analytics' },
        { method: 'delete', path: '/api/expenses/1' },
        { method: 'post', path: '/api/ocr/analyze-id', body: {} }
      ];

      for (const ep of protectedEndpoints) {
        it(`rejects unauthenticated ${ep.method.toUpperCase()} ${ep.path} with 401`, async () => {
          const req = request(app)[ep.method](ep.path);
          if (ep.body) req.send(ep.body);
          const res = await req;
          expect(res.status).toBe(401);
          expect(res.body.success).toBe(false);
          expect(res.body.error).toMatch(/Authentication required/i);
        });
      }
    });

    describe('2.2 Role-based unauthorized requests rejected with 403', () => {
      it('rejects Hospitality staff from Manager-only Room Deletion', async () => {
        const res = await request(app)
          .delete('/api/rooms/1')
          .set('Authorization', `Bearer ${hospitalityToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Hospitality staff from Manager-only Staff Management', async () => {
        const res = await request(app)
          .get('/api/staff')
          .set('Authorization', `Bearer ${hospitalityToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Hospitality staff from Manager-only History Purge', async () => {
        const res = await request(app)
          .post('/api/hospitality/history/purge')
          .set('Authorization', `Bearer ${hospitalityToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Hospitality staff from Manager-only Expense Deletion', async () => {
        const res = await request(app)
          .delete('/api/expenses/1')
          .set('Authorization', `Bearer ${hospitalityToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Hospitality staff from Manager-only Gemini Key Settings', async () => {
        const res = await request(app)
          .get('/api/settings/ai-key')
          .set('Authorization', `Bearer ${hospitalityToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Restaurant staff from Hospitality Check-in', async () => {
        const res = await request(app)
          .post('/api/checkin')
          .set('Authorization', `Bearer ${restaurantToken}`)
          .send({ room_id: 101, guest_name: 'Unauthorized' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Restaurant staff from Bar order placement', async () => {
        const res = await request(app)
          .post('/api/bar/order')
          .set('Authorization', `Bearer ${restaurantToken}`)
          .send({});
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });

      it('rejects Bar staff from Restaurant order placement', async () => {
        const res = await request(app)
          .post('/api/restaurant/order')
          .set('Authorization', `Bearer ${barToken}`)
          .send({});
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Access denied/i);
      });
    });

    describe('2.3 Authorized operations succeed with appropriate roles', () => {
      it('allows Manager full access to GET /api/staff', async () => {
        const res = await request(app)
          .get('/api/staff')
          .set('Authorization', `Bearer ${managerToken}`);
        expect(res.status).toBe(200);
      });

      it('allows Manager access to GET /api/manager/analytics', async () => {
        const res = await request(app)
          .get('/api/manager/analytics')
          .set('Authorization', `Bearer ${managerToken}`);
        expect(res.status).toBe(200);
      });

      it('allows Hospitality staff access to check-in validation', async () => {
        // Validation failure (400) proves authorization passed (did not get 401 or 403)
        const res = await request(app)
          .post('/api/checkin')
          .set('Authorization', `Bearer ${hospitalityToken}`)
          .send({});
        expect(res.status).toBe(400); // 400 Bad Request indicates auth succeeded and hit handler logic
        expect(res.body.error).not.toMatch(/Authentication required|Access denied/i);
      });
    });
  });

  // =========================================================================
  // REQUIREMENT 3: GEMINI API KEY SECRET SECURITY
  // =========================================================================
  describe('3. Gemini API Key Secret Security', () => {
    it('3.1 should reject public GET requests for Gemini key', async () => {
      const res = await request(app).get('/api/settings/ai-key');
      expect(res.status).toBe(401);
    });

    it('3.2 should NEVER return raw API key to the frontend', async () => {
      const res = await request(app)
        .get('/api/settings/ai-key')
        .set('Authorization', `Bearer ${managerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isConfigured).toBeDefined();
      expect(res.body.masked).toBeDefined();
      // Ensure raw key fields are absent
      expect(res.body.key).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
      expect(res.body.gemini_api_key).toBeUndefined();
      if (res.body.masked) {
        expect(res.body.masked).toContain('****');
      }
    });

    it('3.3 should encrypt Gemini API key with AES-256-GCM in database', async () => {
      // Backup real active key from database so tests never wipe user's live key!
      const originalRow = db.prepare("SELECT value FROM system_settings WHERE key = 'gemini_api_key'").get();
      const testSecretKey = 'AIzaSyTest_SecretKey_9876543210_Secure';
      
      try {
        // Manager saves key
        const saveRes = await request(app)
          .post('/api/settings/ai-key')
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ key: testSecretKey });
        
        expect(saveRes.status).toBe(200);
        expect(saveRes.body.success).toBe(true);

        // Verify the value in SQLite system_settings table is encrypted and NOT plaintext
        const dbRow = db.prepare("SELECT value FROM system_settings WHERE key = 'gemini_api_key'").get();
        expect(dbRow).toBeDefined();
        expect(dbRow.value).not.toBe(testSecretKey);
        expect(isEncrypted(dbRow.value)).toBe(true);
        expect(dbRow.value).toMatch(/^enc:[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);

        // Verify secretManager decrypts it back to original value
        const decrypted = decryptSecret(dbRow.value);
        expect(decrypted).toBe(testSecretKey);
      } finally {
        // Always restore the real live key!
        if (originalRow && originalRow.value) {
          db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('gemini_api_key', ?, CURRENT_TIMESTAMP)").run(originalRow.value);
        }
      }
    });

    it('3.4 should safely test connection on server without exposing key to client', async () => {
      const res = await request(app)
        .post('/api/settings/ai-key/test')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({}); // Tests active key stored on server
      
      // Response status will be 200 or 500 depending on network, but payload MUST NOT contain secret key
      expect(res.body.key).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
      expect(res.body.gemini_api_key).toBeUndefined();
    });
  });

  // =========================================================================
  // REQUIREMENT 4: LOG & DATA LEAKAGE SANITATION
  // =========================================================================
  describe('4. Log & Data Leakage Sanitation', () => {
    it('4.1 should mask secrets properly for UI display', () => {
      expect(maskSecret('AIzaSyMockExampleKeyForTestingOnly_12345')).toBe('AIza****2345');
      expect(maskSecret('short')).toBe('********');
      expect(maskSecret('')).toBe('');
      expect(maskSecret(null)).toBe('');
    });

    it('4.2 should not return sensitive fields in staff creation or update responses', async () => {
      const uname = `test_sec_${Date.now()}`;
      db.prepare('DELETE FROM staff_users WHERE username = ?').run(uname);

      // Create test staff
      const createRes = await request(app)
        .post('/api/staff')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          username: uname,
          password: 'secretPassword123',
          full_name: 'Security Test User',
          role: 'hospitality'
        });

      expect(createRes.status).toBe(200);
      expect(createRes.body.success).toBe(true);
      expect(createRes.body.user).toBeDefined();
      expect(createRes.body.user.password).toBeUndefined();
      expect(createRes.body.user.password_hash).toBeUndefined();

      const createdId = createRes.body.staff_id;

      // Update test staff
      const updateRes = await request(app)
        .put(`/api/staff/${createdId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          full_name: 'Updated Security User',
          password: 'newSecretPassword456'
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.user).toBeDefined();
      expect(updateRes.body.user.password).toBeUndefined();

      // Cleanup
      db.prepare('DELETE FROM staff_users WHERE id = ?').run(createdId);
    });
  });
});
