/**
 * Database Clean / Reset Service
 * Used to purge test & demo transactions, bookings, and demo rooms
 * so that when the software is moved to another computer or handed to clients,
 * it starts with a 100% clean, empty database.
 */
function cleanDemoData(db) {
  const result = {};

  // 1. Delete all bookings
  const delBookings = db.prepare('DELETE FROM bookings').run();
  result.bookingsDeleted = delBookings.changes;

  // 2. Delete all guests
  const delGuests = db.prepare('DELETE FROM guests').run();
  result.guestsDeleted = delGuests.changes;

  // 3. Delete all payments
  const delPayments = db.prepare('DELETE FROM payments').run();
  result.paymentsDeleted = delPayments.changes;

  // 4. Delete all expenses
  const delExpenses = db.prepare('DELETE FROM expenses').run();
  result.expensesDeleted = delExpenses.changes;

  // 5. Delete all restaurant & bar orders
  const delRestOrders = db.prepare('DELETE FROM restaurant_orders').run();
  result.restOrdersDeleted = delRestOrders.changes;
  const delBarOrders = db.prepare('DELETE FROM bar_orders').run();
  result.barOrdersDeleted = delBarOrders.changes;

  // 6. Delete all logs & visitors
  try { db.prepare('DELETE FROM room_visitors').run(); } catch (e) {}
  try { db.prepare('DELETE FROM room_cleaning_logs').run(); } catch (e) {}
  try { db.prepare('DELETE FROM checkout_extension_logs').run(); } catch (e) {}
  try { db.prepare('DELETE FROM bill_logs').run(); } catch (e) {}
  try { db.prepare('DELETE FROM monthly_voucher_sequences').run(); } catch (e) {}

  // 7. Delete demo/unlisted rooms (anything outside our 26 official rooms)
  const OFFICIAL_ROOMS_CATALOG = [
    // Executive Rooms (21 rooms)
    ...['102', '103', '104'].map(num => ({
      room_number: String(num),
      floor: 'First Floor',
      room_type: 'Executive Room',
      price_single: 2200,
      price: 2500,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 1,
      extra_bed_price: 600,
    })),
    ...['202', '203', '204', '205', '206', '207', '208', '209', '210', '211'].map(num => ({
      room_number: String(num),
      floor: 'Second Floor',
      room_type: 'Executive Room',
      price_single: 2200,
      price: 2500,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 1,
      extra_bed_price: 600,
    })),
    ...['302', '303', '304', '305', '306', '307', '308', '309'].map(num => ({
      room_number: String(num),
      floor: 'Third Floor',
      room_type: 'Executive Room',
      price_single: 2200,
      price: 2500,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 1,
      extra_bed_price: 600,
    })),

    // Deluxe Rooms (3 rooms)
    ...['201', '212'].map(num => ({
      room_number: String(num),
      floor: 'Second Floor',
      room_type: 'Deluxe Room',
      price_single: 2500,
      price: 2800,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 2,
      extra_bed_price: 600,
    })),
    {
      room_number: '301',
      floor: 'Third Floor',
      room_type: 'Deluxe Room',
      price_single: 2500,
      price: 2800,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 2,
      extra_bed_price: 600,
    },

    // Suit Room (1 room)
    {
      room_number: '310',
      floor: 'Third Floor',
      room_type: 'Suit Room',
      price_single: 3600,
      price: 4500,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 3,
      extra_bed_price: 600,
    },

    // Pent Hosue (1 room)
    {
      room_number: '401',
      floor: 'Fourth Floor',
      room_type: 'Pent Hosue',
      price_single: 4200,
      price: 4800,
      max_discount_pct: 15,
      max_adults: 2,
      max_children: 2,
      max_extra_beds: 3,
      extra_bed_price: 600,
    }
  ];

  const officialRoomNumbers = OFFICIAL_ROOMS_CATALOG.map(r => r.room_number);
  const placeholders = officialRoomNumbers.map(() => '?').join(',');
  const delDemoRooms = db.prepare(`
    DELETE FROM rooms 
    WHERE room_number IN ('771', '772', '777', '881', '882', '888', '999')
       OR room_number NOT IN (${placeholders})
  `).run(...officialRoomNumbers);
  result.demoRoomsDeleted = delDemoRooms.changes;

  // 8. Ensure all 26 official hotel rooms exist, have correct tariffs, and are 'ready'
  const checkRoom = db.prepare('SELECT id FROM rooms WHERE room_number = ?');
  const insertRoom = db.prepare(`
    INSERT INTO rooms (
      room_number, floor, room_type, price, price_single, max_adults, max_children, max_discount_pct,
      ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate,
      breakfast_price, max_extra_beds, extra_bed_price, gst_pct,
      extra_bed_gst_pct, breakfast_gst_pct, ext_3h_gst_pct, ext_6h_gst_pct, ext_9h_gst_pct, single_gst_pct,
      ota_early_checkin_price, ota_early_checkin_max_hours, ota_early_checkin_gst_pct,
      status, current_booking_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 60, 500, 1000, 1500, 250, ?, ?, 5, 5, 5, 5, 5, 5, 5, 900, 6, 5, 'ready', NULL)
  `);
  const updateRoom = db.prepare(`
    UPDATE rooms 
    SET floor = COALESCE(?, floor), room_type = ?, price = ?, price_single = ?, max_discount_pct = ?, max_adults = ?, max_children = ?, max_extra_beds = ?, extra_bed_price = ?, status = 'ready', current_booking_id = NULL 
    WHERE room_number = ?
  `);

  for (const r of OFFICIAL_ROOMS_CATALOG) {
    const existing = checkRoom.get(r.room_number);
    if (!existing) {
      insertRoom.run(
        r.room_number,
        r.floor || 'First Floor',
        r.room_type,
        r.price,
        r.price_single,
        r.max_adults,
        r.max_children,
        r.max_discount_pct,
        r.max_extra_beds,
        r.extra_bed_price
      );
    } else {
      updateRoom.run(
        r.floor || 'First Floor',
        r.room_type,
        r.price,
        r.price_single,
        r.max_discount_pct,
        r.max_adults,
        r.max_children,
        r.max_extra_beds,
        r.extra_bed_price,
        r.room_number
      );
    }
  }

  // Ensure all current booking references are cleared and status is ready
  db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL").run();
  result.roomsPreserved = OFFICIAL_ROOMS_CATALOG.length;

  // 9. Reset restaurant & bar tables active carts
  try {
    db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, waiter_name = '', special_notes = '', order_started_at = NULL, is_split = 0, parent_table_id = NULL, room_id = NULL").run();
    db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, waiter_name = '', special_notes = '', order_started_at = NULL, is_split = 0, parent_table_id = NULL, room_id = NULL").run();
  } catch (e) {}

  // 10. Clean sqlite_sequence so IDs start fresh
  try {
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'guests', 'payments', 'expenses', 'restaurant_orders', 'bar_orders', 'room_visitors', 'room_cleaning_logs', 'bill_logs')").run();
  } catch (e) {}

  // 11. Vacuum database
  try {
    db.exec('VACUUM;');
  } catch (e) {}

  return result;
}

module.exports = { cleanDemoData };
