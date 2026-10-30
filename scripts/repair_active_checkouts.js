const db = require('../database.js');
const supabaseService = require('../services/supabaseService.js');
const firebaseService = require('../services/firebaseService.js');

async function repair() {
  console.log('=== REPAIRING ACTIVE BOOKING CHECKOUT TIMES ===\n');

  const activeBookings = db.prepare(`
    SELECT b.id, b.room_id, r.room_number, b.checkin_time, b.approx_checkout_time, b.room_rate, b.total_room_charge
    FROM bookings b
    JOIN rooms r ON b.room_id = r.id
    WHERE b.status = 'active'
    ORDER BY CAST(r.room_number AS INTEGER) ASC
  `).all();

  console.log(`Found ${activeBookings.length} active bookings.\n`);

  const updateStmt = db.prepare(`
    UPDATE bookings
    SET approx_checkout_time = ?
    WHERE id = ?
  `);

  const results = [];

  const runRepair = db.transaction(() => {
    for (const b of activeBookings) {
      const cInStr = b.checkin_time;
      const dIn = new Date(cInStr.includes('T') ? cInStr : cInStr.replace(' ', 'T') + '+05:30');
      
      const rate = Number(b.room_rate) || 2000;
      const charge = Number(b.total_room_charge) || rate;
      
      // Calculate nights (with or without 5% GST)
      let nights = 1;
      if (charge > rate) {
        if (charge % rate === 0) {
          nights = Math.round(charge / rate);
        } else {
          nights = Math.max(1, Math.round(charge / (rate * 1.05)));
        }
      }

      // Checkin date parts
      const inYear = dIn.getFullYear();
      const inMonth = dIn.getMonth();
      const inDay = dIn.getDate();

      // For standard checkouts, default checkout time is 11:00:00 standard hotel checkout
      const dOut = new Date(inYear, inMonth, inDay + nights, 11, 0, 0);

      const y = dOut.getFullYear();
      const m = String(dOut.getMonth() + 1).padStart(2, '0');
      const d = String(dOut.getDate()).padStart(2, '0');
      const newCheckout = `${y}-${m}-${d} 11:00:00`;

      // Update in database
      updateStmt.run(newCheckout, b.id);

      results.push({
        room: b.room_number,
        checkin: b.checkin_time,
        oldCheckout: b.approx_checkout_time,
        nights,
        newCheckout
      });
    }
  });

  runRepair();

  console.table(results);
  console.log('\n[Database] Repaired active bookings in SQLite successfully.');

  // Push to Supabase
  try {
    console.log('[Supabase] Syncing repaired active rooms to Supabase...');
    const supRes = await supabaseService.syncAllActiveRoomsFromLocal(db);
    console.log('[Supabase] Sync result:', supRes ? supRes.count || 'ok' : 'ok');
  } catch (err) {
    console.warn('[Supabase] Sync error:', err.message);
  }

  // Push to Firebase
  try {
    console.log('[Firebase] Syncing repaired active rooms to Firestore...');
    const fbRes = await firebaseService.syncAllActiveRoomsFromLocal(db);
    console.log('[Firebase] Sync result:', fbRes || 'ok');
  } catch (err) {
    console.warn('[Firebase] Sync error:', err.message);
  }

  console.log('\n=== REPAIR & CLOUD SYNC COMPLETE ===');
  process.exit(0);
}

repair().catch(err => {
  console.error('Fatal error during repair:', err);
  process.exit(1);
});
