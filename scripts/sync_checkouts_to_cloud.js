const db = require('../database.js');
const firebaseService = require('../services/firebaseService.js');
const supabaseService = require('../services/supabaseService.js');

async function syncCheckouts() {
  console.log('=== SYNCING ALL RECENT CHECKOUTS TO FIREBASE & SUPABASE ===\n');

  const checkouts = db.prepare(`
    SELECT b.id, b.room_id, r.room_number, g.name as guest_name, g.mobile,
           b.checkin_time, b.actual_checkout_time, b.status, b.meal_plan,
           b.adults_male, b.adults_female, b.adults_other, b.children,
           b.total_room_charge, b.room_rate, b.checked_in_by, b.checked_out_by,
           b.voucher_number
    FROM bookings b
    JOIN rooms r ON b.room_id = r.id
    JOIN guests g ON b.guest_id = g.id
    WHERE b.status = 'checked_out'
    ORDER BY b.id DESC
    LIMIT 20
  `).all();

  console.log(`Found ${checkouts.length} checked-out bookings to sync.\n`);

  for (const b of checkouts) {
    const payments = db.prepare(`
      SELECT *
      FROM payments
      WHERE booking_id = ?
      ORDER BY created_at ASC
    `).all(b.id);

    const totalAdults = (b.adults_male || 0) + (b.adults_female || 0) + (b.adults_other || 0) || 1;
    const totalChildren = b.children || 0;
    const rTotal = Number(b.total_room_charge || b.room_rate || 0);

    const formattedPayments = payments.map(p => ({
      id: p.id,
      receiptNo: p.receipt_no,
      receipt_no: p.receipt_no,
      mode: p.payment_mode,
      payment_mode: p.payment_mode,
      amount: Number(p.amount || 0),
      cashier: p.cashier_name || 'Staff',
      cashier_name: p.cashier_name || 'Staff',
      date: p.created_at || p.realized_at,
      created_at: p.created_at,
      realized_at: p.realized_at,
      notes: p.notes,
      type: p.payment_type,
      payment_type: p.payment_type,
      cheque_no: p.cheque_no,
      bank_name: p.bank_name,
      cheque_date: p.cheque_date,
      cheque_status: p.cheque_status,
      utr_number: p.utr_number,
      card_surcharge: p.card_surcharge || 0,
      upi_tax: p.upi_tax || 0,
      split_cash: p.split_cash || 0,
      split_card: p.split_card || 0,
      split_online: p.split_online || 0,
      split_cheque: p.split_cheque || 0
    }));

    const totalPaid = formattedPayments
      .filter(p => !String(p.type || '').toLowerCase().includes('refund'))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    const payload = {
      bookingId: b.id,
      billNo: b.voucher_number || `CO-${b.id}`,
      guestName: b.guest_name,
      mobile: b.mobile || '',
      adults: totalAdults,
      children: totalChildren,
      mealPlan: b.meal_plan || 'without_breakfast',
      roomCount: 1,
      roomNumber: b.room_number,
      roomNumbers: [b.room_number],
      checkinTime: b.checkin_time,
      checkoutTime: b.actual_checkout_time || new Date().toISOString(),
      checkedInBy: b.checked_in_by || 'Front Desk',
      checkedOutBy: b.checked_out_by || 'Staff',
      netSettle: totalPaid,
      refundAmount: 0,
      total: totalPaid || rTotal,
      grandTotal: totalPaid || rTotal,
      roomCharge: rTotal,
      payments: formattedPayments
    };

    console.log(`Syncing Room ${b.room_number} (${b.guest_name}) - Payments: ${formattedPayments.length}...`);
    try {
      await firebaseService.syncCheckoutToCloud(payload);
      await supabaseService.syncCheckoutToCloud(payload);
    } catch (e) {
      console.warn(`Error syncing Room ${b.room_number}:`, e.message);
    }
  }

  console.log('\n=== ALL CHECKOUTS SUCCESSFULLY SYNCED TO CLOUD ===');
  process.exit(0);
}

syncCheckouts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
