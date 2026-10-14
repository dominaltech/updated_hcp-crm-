import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('Storeman & Store Bills API Suite', () => {
  let createdVendorId;
  let createdBillId;

  it('1. Creates new vendor', async () => {
    const res = await request(app)
      .post('/api/store/vendors')
      .send({ name: 'Test Supermarket', mobile: '9876543210', address: 'Market Road' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.vendor).toBeDefined();
    expect(res.body.vendor.name).toBe('Test Supermarket');
    createdVendorId = res.body.vendor.id;
  });

  it('2. Edits vendor', async () => {
    const res = await request(app)
      .put(`/api/store/vendors/${createdVendorId}`)
      .send({ name: 'Test Supermarket & Provisions', mobile: '9876543211', address: 'Main Bazar' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.vendor.name).toBe('Test Supermarket & Provisions');
    expect(res.body.vendor.mobile).toBe('9876543211');
  });

  it('3. Creates store bill with GST, remark, payment mode, and deep link', async () => {
    const res = await request(app)
      .post('/api/store/bills')
      .send({
        vendor_id: createdVendorId,
        bill_number: 'BILL-1001',
        bill_date: '2026-10-09',
        total_amount: 15450,
        payment_mode: 'Bank Transfer',
        has_gst: true,
        gst_remark: '18% GST Paid',
        created_by: 'Store Boy'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bill).toBeDefined();
    expect(res.body.bill.payment_mode).toBe('Bank Transfer');
    expect(res.body.bill.has_gst).toBe(1);
    expect(res.body.bill.gst_remark).toBe('18% GST Paid');
    expect(res.body.deepLink).toContain(`hcpowner://store?billId=${res.body.bill.id}`);
    createdBillId = res.body.bill.id;
  });

  it('4. Admin can edit store bill (payment mode, date, amount)', async () => {
    const res = await request(app)
      .put(`/api/store/bills/${createdBillId}`)
      .send({
        payment_mode: 'UPI',
        total_amount: 16000,
        notes: 'Admin revised amount with extra delivery'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bill.payment_mode).toBe('UPI');
    expect(res.body.bill.total_amount).toBe(16000);
  });

  it('5. Owner notifications endpoint returns the deep-linked notification', async () => {
    const res = await request(app).get('/api/owner/notifications');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    const storeNotif = res.body.notifications.find(n => n.type === 'store_bill' && n.deep_link.includes(`billId=${createdBillId}`));
    expect(storeNotif).toBeDefined();
    expect(storeNotif.title).toContain('Test Supermarket');
    expect(storeNotif.deep_link).toBe(`hcpowner://store?billId=${createdBillId}`);
  });
});
