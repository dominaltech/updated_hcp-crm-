const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'hotel_city_park.db');
const db = new Database(dbPath);

console.log('--- Cleaning Demo Data from hotel_city_park.db ---');

// 1. Delete all bookings
const delBookings = db.prepare('DELETE FROM bookings').run();
console.log(`Deleted ${delBookings.changes} bookings.`);

// 2. Delete all guests
const delGuests = db.prepare('DELETE FROM guests').run();
console.log(`Deleted ${delGuests.changes} guests.`);

// 3. Delete all payments
const delPayments = db.prepare('DELETE FROM payments').run();
console.log(`Deleted ${delPayments.changes} payments.`);

// 4. Delete all expenses
const delExpenses = db.prepare('DELETE FROM expenses').run();
console.log(`Deleted ${delExpenses.changes} expenses.`);

// 5. Delete all restaurant & bar orders
const delRestOrders = db.prepare('DELETE FROM restaurant_orders').run();
console.log(`Deleted ${delRestOrders.changes} restaurant orders.`);
const delBarOrders = db.prepare('DELETE FROM bar_orders').run();
console.log(`Deleted ${delBarOrders.changes} bar orders.`);

// 6. Delete all logs & visitors
try { db.prepare('DELETE FROM room_visitors').run(); } catch (e) {}
try { db.prepare('DELETE FROM room_cleaning_logs').run(); } catch (e) {}
try { db.prepare('DELETE FROM checkout_extension_logs').run(); } catch (e) {}
try { db.prepare('DELETE FROM bill_logs').run(); } catch (e) {}
try { db.prepare('DELETE FROM monthly_voucher_sequences').run(); } catch (e) {}

// 7. Delete demo rooms (771, 772, 777, 881, 882, 888, 999)
const delDemoRooms = db.prepare(`
  DELETE FROM rooms 
  WHERE room_number IN ('771', '772', '777', '881', '882', '888', '999')
     OR room_number NOT IN ('101', '102', '103', '104', '105', '106')
`).run();
console.log(`Deleted ${delDemoRooms.changes} demo rooms.`);

// 8. Ensure rooms 101-106 exist and are in 'ready' status
const standardRooms = [
  { num: '101', type: 'Deluxe AC', price: 2000 },
  { num: '102', type: 'Deluxe AC', price: 2000 },
  { num: '103', type: 'Deluxe AC', price: 2000 },
  { num: '104', type: 'Deluxe AC', price: 2000 },
  { num: '105', type: 'Deluxe AC', price: 2000 },
  { num: '106', type: 'Deluxe AC', price: 2000 },
];

const checkRoom = db.prepare('SELECT id FROM rooms WHERE room_number = ?');
const insertRoom = db.prepare('INSERT INTO rooms (room_number, room_type, price, status, current_booking_id) VALUES (?, ?, ?, ?, NULL)');
const resetRoom = db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE room_number = ?");

for (const r of standardRooms) {
  const existing = checkRoom.get(r.num);
  if (!existing) {
    insertRoom.run(r.num, r.type, r.price, 'ready');
  } else {
    resetRoom.run(r.num);
  }
}

// 9. Reset restaurant & bar tables active carts
try {
  db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, waiter_name = '', special_notes = '', order_started_at = NULL, is_split = 0, parent_table_id = NULL, room_id = NULL").run();
  db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, waiter_name = '', special_notes = '', order_started_at = NULL, is_split = 0, parent_table_id = NULL, room_id = NULL").run();
} catch (e) {}

// 10. Clean sqlite_sequence so IDs start fresh
try {
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('bookings', 'guests', 'payments', 'expenses', 'restaurant_orders', 'bar_orders', 'room_visitors', 'room_cleaning_logs', 'bill_logs')").run();
} catch (e) {}

// 11. Vacuum database to reclaim space
db.exec('VACUUM;');
db.close();

console.log('Database successfully cleaned and vacuumed!');
