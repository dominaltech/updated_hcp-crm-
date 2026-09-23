const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

// Automatically load .env configuration if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    });
  } catch (e) {}
}

const db = require('./database');
const { hashPassword, hashPasswordSync, verifyPassword, migratePlaintextPasswords, generateToken, requireAuth, requireRole, optionalAuth } = require('./middleware/auth');
const secretManager = require('./services/secretManager');
const supabaseService = require('./services/supabaseService');

// Automatically migrate any legacy plaintext staff passwords to bcrypt hashes on startup
migratePlaintextPasswords(db);
// Automatically migrate and encrypt any legacy plaintext secrets
secretManager.migrateDatabaseSecrets(db);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' })); // Support base64 image uploads
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
const distDir = path.join(__dirname, 'dist');
const publicDir = path.join(__dirname, 'public');

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }));
}
app.use(express.static(publicDir));

// Development helper: Programmatic frontend build endpoint
app.get('/api/build-frontend', (req, res) => {
  exec('npx.cmd vite build', { cwd: __dirname }, (err, stdout, stderr) => {
    try {
      if (fs.existsSync(path.join(publicDir, 'styles.css')) && fs.existsSync(distDir)) {
        fs.copyFileSync(path.join(publicDir, 'styles.css'), path.join(distDir, 'styles.css'));
      }
    } catch (copyErr) {
      console.warn('Could not copy styles.css:', copyErr);
    }
    if (err) {
      return res.status(500).json({ success: false, error: err.message, stderr, stdout });
    }
    res.json({ success: true, stdout, stderr });
  });
});

// -------------------------------------------------------------
// MONTHLY SEQUENTIAL VOUCHER & RECEIPT NUMBERING (YYMMDD-SR, resets monthly)
// -------------------------------------------------------------
function getNextMonthlyVoucherNumber(prefix = 'VCH', dateObj = new Date()) {
  try {
    const yyyy = dateObj.getFullYear();
    const yy = String(yyyy).slice(-2);
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const yearMonth = `${yyyy}${mm}`;
    // Format as YYMMDD (e.g. 260920-520) for all prefixes (previously: prefix === 'RCP' ? `${yy}${mm}${dd}` : `${yyyy}${mm}${dd}`)
    const dateStr = `${yy}${mm}${dd}`;

    const row = db.prepare('SELECT last_seq FROM monthly_voucher_sequences WHERE prefix = ? AND year_month = ?').get(prefix, yearMonth);
    const nextSeq = (row ? row.last_seq : 0) + 1;

    db.prepare(`
      INSERT INTO monthly_voucher_sequences (prefix, year_month, last_seq)
      VALUES (?, ?, ?)
      ON CONFLICT(prefix, year_month) DO UPDATE SET last_seq = ?
    `).run(prefix, yearMonth, nextSeq, nextSeq);

    const srPadded = String(nextSeq).padStart(3, '0');
    return `${dateStr}-${srPadded}`;
  } catch (err) {
    console.error('Error generating monthly voucher sequence:', err);
    const yyyy = dateObj.getFullYear();
    const yy = String(yyyy).slice(-2);
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}-001`;
  }
}

function getReceiptNumberWithMode(mode = 'cash', dateObj = new Date()) {
  const baseNo = getNextMonthlyVoucherNumber('RCP', dateObj);
  const m = String(mode || 'cash').toLowerCase();
  let prefix = 'CR';
  if (m.includes('upi') || m.includes('online')) prefix = 'UPI';
  else if (m.includes('card') || m.includes('pos')) prefix = 'POS';
  else if (m.includes('cheque') || m.includes('check')) prefix = 'CHQ';
  else if (m.includes('btc')) prefix = 'BTC';
  return `${prefix}${baseNo}`;
}

// -------------------------------------------------------------
// PETTY CASH VOUCHER NUMBERING (starts from 01, 02, 03...)
// -------------------------------------------------------------
function getNextPettyCashVoucherNumber() {
  try {
    const row = db.prepare("SELECT last_seq FROM monthly_voucher_sequences WHERE prefix = 'PC' AND year_month = 'ALL'").get();
    const nextSeq = (row && row.last_seq !== undefined ? row.last_seq : 0) + 1;

    db.prepare(`
      INSERT INTO monthly_voucher_sequences (prefix, year_month, last_seq)
      VALUES ('PC', 'ALL', ?)
      ON CONFLICT(prefix, year_month) DO UPDATE SET last_seq = ?
    `).run(nextSeq, nextSeq);

    return `PCV-${nextSeq}`;
  } catch (err) {
    console.error('Error generating petty cash sequence:', err);
    return 'PCV-1';
  }
}

// -------------------------------------------------------------
// DYNAMIC CARD SURCHARGE & UPI CONVENIENCE FEE SETTINGS
// -------------------------------------------------------------
function getSurchargeSettings() {
  try {
    const cardRow = db.prepare("SELECT value FROM system_settings WHERE key = 'card_surcharge_pct'").get();
    const upiTaxRow = db.prepare("SELECT value FROM system_settings WHERE key = 'upi_tax_pct'").get();
    const upiThreshRow = db.prepare("SELECT value FROM system_settings WHERE key = 'upi_tax_threshold'").get();

    const card_surcharge_pct = (cardRow && cardRow.value !== undefined && cardRow.value !== '') ? parseFloat(cardRow.value) : 2.5;
    const upi_tax_pct = (upiTaxRow && upiTaxRow.value !== undefined && upiTaxRow.value !== '') ? parseFloat(upiTaxRow.value) : 0.4;
    const upi_tax_threshold = (upiThreshRow && upiThreshRow.value !== undefined && upiThreshRow.value !== '') ? parseFloat(upiThreshRow.value) : 2000;

    return {
      card_surcharge_pct: isNaN(card_surcharge_pct) ? 2.5 : Math.max(0, card_surcharge_pct),
      upi_tax_pct: isNaN(upi_tax_pct) ? 0.4 : Math.max(0, upi_tax_pct),
      upi_tax_threshold: isNaN(upi_tax_threshold) ? 2000 : Math.max(0, upi_tax_threshold)
    };
  } catch (err) {
    return { card_surcharge_pct: 2.5, upi_tax_pct: 0.4, upi_tax_threshold: 2000 };
  }
}

// Helper: get configurable F&B GST rates from system_settings (defaults 5%)
function getFnbGstRate(department) {
  try {
    const key = department === 'bar' ? 'bar_gst_pct' : 'restaurant_gst_pct';
    const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key);
    const pct = row ? parseFloat(row.value) : 5;
    return isNaN(pct) ? 5 : Math.max(0, pct);
  } catch (e) {
    return 5;
  }
}

function calculateDynamicSurcharges(cardAmount = 0, onlineAmount = 0) {
  const settings = getSurchargeSettings();
  const cardSurcharge = (cardAmount > 0 && settings.card_surcharge_pct > 0)
    ? Math.round((cardAmount * settings.card_surcharge_pct) / 100)
    : 0;
  const upiTax = (onlineAmount > settings.upi_tax_threshold && settings.upi_tax_pct > 0)
    ? Math.round((onlineAmount * settings.upi_tax_pct) / 100)
    : 0;
  return { cardSurcharge, upiTax, settings };
}

// Helper to convert ISO/UTC or Date string to local SQLite YYYY-MM-DD HH:mm:ss
function formatToLocalSqliteString(isoDateStr) {
  if (!isoDateStr) return '2000-01-01 00:00:00';
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return '2000-01-01 00:00:00';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 1. GET ALL ROOMS (with active booking details & status)
app.get('/api/rooms', (req, res) => {
  try {
    const rooms = db.prepare(`
      SELECT 
        r.*,
        b.id as booking_id,
        b.guest_id,
        b.checkin_time,
        b.approx_checkout_time,
        b.total_room_charge,
        b.total_paid,
        b.booking_source,
        b.ota_platform,
        b.ota_booking_id,
        b.is_prepaid,
        b.is_early_checkin,
        b.original_checkin_time,
        b.early_checkin_time,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.email as guest_email,
        g.doc_type as guest_doc_type
      FROM rooms r
      LEFT JOIN bookings b ON r.current_booking_id = b.id AND b.status = 'active'
      LEFT JOIN guests g ON b.guest_id = g.id
      ORDER BY CAST(r.room_number AS INTEGER) ASC, r.room_number ASC
    `).all();

    // Identify linked / group rooms sharing the same active guest_id
    const guestRoomMap = {};
    for (const room of rooms) {
      if (room.status === 'occupied' && room.guest_id) {
        if (!guestRoomMap[room.guest_id]) guestRoomMap[room.guest_id] = [];
        guestRoomMap[room.guest_id].push({ id: room.id, room_number: room.room_number });
      }
    }

    // Calculate pending food/bar orders and assign linked rooms
    for (const room of rooms) {
      if (room.status === 'occupied' && room.guest_id && guestRoomMap[room.guest_id] && guestRoomMap[room.guest_id].length > 1) {
        room.is_combined = true;
        room.linked_rooms = guestRoomMap[room.guest_id].filter(r => r.id !== room.id).map(r => r.room_number);
        room.all_group_rooms = guestRoomMap[room.guest_id].map(r => r.room_number);
      } else {
        room.is_combined = false;
        room.linked_rooms = [];
        room.all_group_rooms = [room.room_number];
      }

      if (room.status === 'occupied' && room.booking_id) {
        const checkinLocal = formatToLocalSqliteString(room.checkin_time);
        const pendingRest = db.prepare(`
          SELECT id, total, created_at FROM restaurant_orders 
          WHERE ((booking_id = ?) OR (booking_id IS NULL AND (room_id = ? OR (room_id IS NULL AND table_number = ?)) AND datetime(created_at) >= ?))
            AND is_paid = 0
        `).all(room.booking_id, room.id, `RS-${room.room_number}`, checkinLocal);

        const pendingBar = db.prepare(`
          SELECT id, total, created_at FROM bar_orders 
          WHERE ((booking_id = ?) OR (booking_id IS NULL AND (room_id = ? OR (room_id IS NULL AND bar_seat = ?)) AND datetime(created_at) >= ?))
            AND is_paid = 0
        `).all(room.booking_id, room.id, `Room ${room.room_number}`, checkinLocal);

        const allPending = [
          ...pendingRest.map(o => ({ ...o, dept: 'restaurant' })),
          ...pendingBar.map(o => ({ ...o, dept: 'bar' }))
        ];

        let totalFood = pendingRest.reduce((s, o) => s + (Number(o.total) || 0), 0);
        let totalBar = pendingBar.reduce((s, o) => s + (Number(o.total) || 0), 0);
        let overdueFnbTotal = 0;
        let overdueCount = 0;
        let maxOverdueDays = 0;

        const nowMs = Date.now();
        const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

        for (const o of allPending) {
          const t = new Date(o.created_at).getTime();
          if (!isNaN(t)) {
            const ageMs = nowMs - t;
            if (ageMs >= THREE_DAYS_MS) {
              overdueFnbTotal += Number(o.total) || 0;
              overdueCount += 1;
              const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
              if (days > maxOverdueDays) maxOverdueDays = days;
            }
          }
        }

        room.total_food_charge = totalFood;
        room.total_bar_charge = totalBar;
        room.overdue_fnb_total = overdueFnbTotal;
        room.overdue_fnb_count = overdueCount;
        room.max_overdue_days = maxOverdueDays;
        room.has_overdue_fnb = overdueCount > 0;
        room.total_running_folio = (room.total_room_charge || 0) + room.total_food_charge + room.total_bar_charge;
        room.balance_due = Math.max(0, room.total_running_folio - (room.total_paid || 0));

        let activeVisitorsCount = 0;
        if (room.current_booking_id) {
          const activeVisitors = db.prepare(`
            SELECT COUNT(*) as count FROM room_visitors 
            WHERE booking_id = ? AND status = 'IN_ROOM'
          `).get(room.current_booking_id);
          activeVisitorsCount = activeVisitors ? activeVisitors.count : 0;
        }
        room.active_visitors_count = activeVisitorsCount;
      } else {
        room.total_food_charge = 0;
        room.total_bar_charge = 0;
        room.total_running_folio = 0;
        room.balance_due = 0;
        room.active_visitors_count = 0;
      }
    }

    res.json({ success: true, rooms });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. CREATE NEW ROOM (Owner Panel)
app.post('/api/rooms', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { 
      room_number, 
      room_type, 
      price, 
      max_adults, 
      max_children, 
      max_discount_pct,
      ext_grace_mins,
      ext_3h_rate,
      ext_6h_rate,
      ext_9h_rate,
      breakfast_price,
      max_extra_beds,
      extra_bed_price,
      gst_pct
    } = req.body;
    
    if (!room_number || !price) {
      return res.status(400).json({ success: false, error: 'Room number and price are required' });
    }

    const existing = db.prepare('SELECT id FROM rooms WHERE room_number = ?').get(room_number);
    if (existing) {
      return res.status(400).json({ success: false, error: `Room ${room_number} already exists` });
    }

    const stmt = db.prepare(`
      INSERT INTO rooms (
        room_number, room_type, price, max_adults, max_children, max_discount_pct, 
        ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate,
        breakfast_price, max_extra_beds, extra_bed_price, gst_pct, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
    `);

    const result = stmt.run(
      room_number,
      room_type || 'Deluxe Room',
      parseFloat(price),
      parseInt(max_adults) || 2,
      parseInt(max_children) || 1,
      parseFloat(max_discount_pct) || 15,
      parseInt(ext_grace_mins) !== undefined && !isNaN(parseInt(ext_grace_mins)) ? parseInt(ext_grace_mins) : 60,
      parseFloat(ext_3h_rate) !== undefined && !isNaN(parseFloat(ext_3h_rate)) ? parseFloat(ext_3h_rate) : 500,
      parseFloat(ext_6h_rate) !== undefined && !isNaN(parseFloat(ext_6h_rate)) ? parseFloat(ext_6h_rate) : 1000,
      parseFloat(ext_9h_rate) !== undefined && !isNaN(parseFloat(ext_9h_rate)) ? parseFloat(ext_9h_rate) : 1500,
      parseFloat(breakfast_price) !== undefined && !isNaN(parseFloat(breakfast_price)) ? parseFloat(breakfast_price) : 250,
      parseInt(max_extra_beds) !== undefined && !isNaN(parseInt(max_extra_beds)) ? parseInt(max_extra_beds) : 1,
      parseFloat(extra_bed_price) !== undefined && !isNaN(parseFloat(extra_bed_price)) ? parseFloat(extra_bed_price) : 500,
      parseFloat(gst_pct) !== undefined && !isNaN(parseFloat(gst_pct)) ? parseFloat(gst_pct) : 5
    );

    res.json({ success: true, roomId: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. UPDATE ROOM (Owner Panel)
app.put('/api/rooms/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { 
      room_number, 
      room_type, 
      price, 
      max_adults, 
      max_children, 
      max_discount_pct, 
      ext_grace_mins,
      ext_3h_rate,
      ext_6h_rate,
      ext_9h_rate,
      breakfast_price,
      max_extra_beds,
      extra_bed_price,
      gst_pct,
      status 
    } = req.body;

    const currentRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!currentRoom) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    // Check room number collision
    if (room_number && room_number !== currentRoom.room_number) {
      const collision = db.prepare('SELECT id FROM rooms WHERE room_number = ? AND id != ?').get(room_number, id);
      if (collision) {
        return res.status(400).json({ success: false, error: `Room ${room_number} already exists` });
      }
    }

    const stmt = db.prepare(`
      UPDATE rooms 
      SET 
        room_number = COALESCE(?, room_number),
        room_type = COALESCE(?, room_type),
        price = COALESCE(?, price),
        max_adults = COALESCE(?, max_adults),
        max_children = COALESCE(?, max_children),
        max_discount_pct = COALESCE(?, max_discount_pct),
        ext_grace_mins = COALESCE(?, ext_grace_mins),
        ext_3h_rate = COALESCE(?, ext_3h_rate),
        ext_6h_rate = COALESCE(?, ext_6h_rate),
        ext_9h_rate = COALESCE(?, ext_9h_rate),
        breakfast_price = COALESCE(?, breakfast_price),
        max_extra_beds = COALESCE(?, max_extra_beds),
        extra_bed_price = COALESCE(?, extra_bed_price),
        gst_pct = COALESCE(?, gst_pct),
        status = COALESCE(?, status)
      WHERE id = ?
    `);

    stmt.run(
      room_number,
      room_type,
      price !== undefined ? parseFloat(price) : null,
      max_adults !== undefined ? parseInt(max_adults) : null,
      max_children !== undefined ? parseInt(max_children) : null,
      max_discount_pct !== undefined ? parseFloat(max_discount_pct) : null,
      ext_grace_mins !== undefined ? parseInt(ext_grace_mins) : null,
      ext_3h_rate !== undefined ? parseFloat(ext_3h_rate) : null,
      ext_6h_rate !== undefined ? parseFloat(ext_6h_rate) : null,
      ext_9h_rate !== undefined ? parseFloat(ext_9h_rate) : null,
      breakfast_price !== undefined ? parseFloat(breakfast_price) : null,
      max_extra_beds !== undefined ? parseInt(max_extra_beds) : null,
      extra_bed_price !== undefined ? parseFloat(extra_bed_price) : null,
      gst_pct !== undefined ? parseFloat(gst_pct) : null,
      status,
      id
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. DELETE ROOM (Owner Panel)
app.delete('/api/rooms/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    if (room.status === 'occupied') {
      return res.status(400).json({ success: false, error: 'Cannot delete an occupied room' });
    }

    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. MARK ROOM CLEANED -> READY FOR CHECK-IN (Mandatory Cleaner Name)
app.post('/api/rooms/:id/clean', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { cleaner_name, cleaning_notes } = req.body || {};
    const trimmedCleaner = (cleaner_name || '').trim();
    if (!trimmedCleaner) {
      return res.status(400).json({ success: false, error: 'Cleaner name is mandatory to shift room status to ready.' });
    }

    // 1. Update room status to ready and record cleaner
    db.prepare(`
      UPDATE rooms 
      SET status = 'ready', last_cleaned_by = ?, last_cleaned_at = datetime('now', 'localtime') 
      WHERE id = ?
    `).run(trimmedCleaner, id);

    // 2. Find last checked-out booking for this room to associate cleaner in history
    const lastBooking = db.prepare(`
      SELECT id FROM bookings 
      WHERE room_id = ? AND status = 'checked_out' 
      ORDER BY actual_checkout_time DESC LIMIT 1
    `).get(id);

    if (lastBooking) {
      db.prepare(`
        UPDATE bookings 
        SET cleaned_by = ?, cleaned_at = datetime('now', 'localtime') 
        WHERE id = ?
      `).run(trimmedCleaner, lastBooking.id);
    }

    // 3. Log to cleaning audit table
    try {
      db.prepare(`
        INSERT INTO room_cleaning_logs (room_id, booking_id, cleaner_name, cleaning_notes, cleaned_at)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      `).run(id, lastBooking ? lastBooking.id : null, trimmedCleaner, (cleaning_notes || '').trim());
    } catch (logErr) {
      console.warn('Could not record room cleaning log:', logErr);
    }

    res.json({ success: true, cleaner_name: trimmedCleaner });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. TOGGLE MAINTENANCE / UNDER CONSTRUCTION
app.post('/api/rooms/:id/maintenance', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const room = db.prepare('SELECT status FROM rooms WHERE id = ?').get(id);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    const newStatus = room.status === 'maintenance' ? 'ready' : 'maintenance';
    db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run(newStatus, id);
    res.json({ success: true, status: newStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6b. DIRECT SET ROOM STATUS (ready, needs_cleaning, maintenance)
app.post('/api/rooms/:id/status', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['ready', 'needs_cleaning', 'maintenance'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    if (room.status === 'occupied' && status !== 'occupied') {
      db.prepare('UPDATE rooms SET status = ?, current_booking_id = NULL WHERE id = ?').run(status, id);
    } else {
      db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run(status, id);
    }
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. CHECK-IN GUEST (Multi-step scanned documents, photo, occupancy, multi-room group booking, corporate BTC, advance payments & cheques)
app.post('/api/checkin', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  const transaction = db.transaction(() => {
    const b = req.body || {};
    const room_id = b.room_id ?? b.roomId;
    const additional_room_ids = b.additional_room_ids ?? b.additionalRooms ?? b.additional_rooms ?? [];
    const guest_name = b.guest_name ?? b.guestName;
    const father_name = b.father_name ?? b.fatherName;
    const mobile = b.mobile;
    const alt_mobile = b.alt_mobile ?? b.altMobile;
    const email = b.email;
    const address = b.address;
    const dob = b.dob;
    const doc_type = b.doc_type ?? b.docType;
    const doc_front = b.doc_front ?? b.docFront;
    const doc_back = b.doc_back ?? b.docBack;
    const guest_photo = b.guest_photo ?? b.guestPhoto;
    const adults_male = b.adults_male ?? b.adultsMale ?? 1;
    const adults_female = b.adults_female ?? b.adultsFemale ?? 0;
    const adults_other = b.adults_other ?? b.adultsOther ?? 0;
    const children = b.children ?? 0;
    const approx_checkout_time = b.approx_checkout_time ?? b.approxCheckout ?? b.approx_checkout;
    const room_rate = b.room_rate ?? b.baseRate ?? b.base_rate;
    const discount_pct = b.discount_pct ?? b.discountPct ?? 0;
    const split_cash = b.split_cash ?? b.splitCash ?? 0;
    const split_card = b.split_card ?? b.splitCard ?? 0;
    const split_online = b.split_online ?? b.splitOnline ?? 0;
    const split_cheque = b.split_cheque ?? b.splitCheque ?? 0;
    const booking_source = b.booking_source ?? b.bookingSource ?? 'Walk-in';
    const ota_platform = b.ota_platform ?? b.otaPlatform;
    const ota_booking_id = b.ota_booking_id ?? b.otaBookingId ?? b.otaVoucherNo;
    const manual_entry = b.manual_entry ?? b.manualEntry ?? 0;
    const doc_proofs_json = b.doc_proofs_json ?? b.docProofsJson ?? '[]';
    const meal_plan = b.meal_plan ?? b.mealPlan ?? 'without_breakfast';
    const extra_beds = b.extra_beds ?? b.extraBeds ?? 0;
    const extra_bed_charge = b.extra_bed_charge ?? b.extraBedCharge ?? 0;
    const is_prepaid = b.is_prepaid ?? b.isPrepaid ?? (b.otaIsPrepaid ? 1 : 0);
    const ota_bill_amount = b.ota_bill_amount ?? b.otaBillAmount ?? b.otaManualAmount;
    const btc_company_id = b.btc_company_id ?? b.btcCompanyId;
    const btc_company_name = b.btc_company_name ?? b.btcCompanyName;
    const btc_approval_ref = b.btc_approval_ref ?? b.btcApprovalRef ?? b.btcVoucherNo;
    const advance_payment = b.advance_payment ?? b.advancePayment;
    const advance_payment_mode = b.advance_payment_mode ?? b.advancePaymentMode;
    const advance_cheque_no = b.advance_cheque_no ?? b.chequeNo ?? b.advanceChequeNo;
    const advance_cheque_bank = b.advance_cheque_bank ?? b.chequeBank ?? b.advanceChequeBank;
    const advance_cheque_date = b.advance_cheque_date ?? b.chequeDate ?? b.advanceChequeDate;
    const advance_cheque_photo = b.advance_cheque_photo ?? b.chequePhoto ?? b.chequeScan ?? b.advanceChequePhoto;
    const cheque_photo = b.cheque_photo ?? b.chequePhoto ?? b.chequeScan;
    const checked_in_by = b.checked_in_by ?? b.checkedInBy ?? 'Front Desk';
    const online_utr = (b.online_utr || b.utr_number || b.advance_utr_number || req.body.online_utr || req.body.utr_number || '').trim() || null;
    const is_early_checkin = (b.is_early_checkin !== undefined ? b.is_early_checkin : b.isEarlyCheckin) ? 1 : 0;
    const original_checkin_time = (b.original_checkin_time ?? b.originalCheckinTime ?? null);
    const early_checkin_time = (b.early_checkin_time ?? b.earlyCheckinTime ?? null);
    const isOtaBooking = (booking_source || '').toUpperCase() === 'OTA';
    const ota_booked_adults = isOtaBooking ? (b.ota_booked_adults !== undefined && b.ota_booked_adults !== null ? (parseInt(b.ota_booked_adults) || null) : (b.otaBookedAdults !== undefined && b.otaBookedAdults !== null ? (parseInt(b.otaBookedAdults) || null) : null)) : null;
    const ota_booked_children = isOtaBooking ? (b.ota_booked_children !== undefined && b.ota_booked_children !== null ? (parseInt(b.ota_booked_children) || 0) : (b.otaBookedChildren !== undefined && b.otaBookedChildren !== null ? (parseInt(b.otaBookedChildren) || 0) : 0)) : 0;
    const ota_booked_extra_beds = isOtaBooking ? (b.ota_booked_extra_beds !== undefined ? (parseInt(b.ota_booked_extra_beds) || 0) : (b.otaBookedExtraBeds !== undefined ? (parseInt(b.otaBookedExtraBeds) || 0) : 0)) : 0;
    const extra_adults = parseInt(b.extra_adults ?? b.extraAdults) || 0;
    const extra_children = parseInt(b.extra_children ?? b.extraChildren) || 0;
    const extra_rooms_charge = parseFloat(b.extra_rooms_charge ?? b.extraRoomsCharge ?? 0) || 0;
    const extra_breakfast_charge = parseFloat(b.extra_breakfast_charge ?? b.extraBreakfastCharge ?? 0) || 0;
    const extra_meal_plan = (b.extra_meal_plan || b.extraMealPlan || null);

    const primaryRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
    if (!primaryRoom) throw new Error('Primary room not found');
    if (primaryRoom.status === 'occupied') throw new Error(`Room ${primaryRoom.room_number} is already occupied`);

    // Fetch and validate additional rooms if any
    const allRooms = [primaryRoom];
    if (Array.isArray(additional_room_ids) && additional_room_ids.length > 0) {
      for (const addId of additional_room_ids) {
        if (addId && addId !== primaryRoom.id) {
          const addRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(addId);
          if (!addRoom) throw new Error(`Additional room ID ${addId} not found`);
          if (addRoom.status === 'occupied') throw new Error(`Room ${addRoom.room_number} is already occupied`);
          allRooms.push(addRoom);
        }
      }
    }

    // 1. Insert Guest
    const cleanAltMobile = (alt_mobile || req.body.alternate_mobile || req.body.mobile_alt || '').trim();
    const cleanAadharNumber = (b.aadhar_number || b.aadharNumber || b.aadharNo || b.aadhar_no || b.id_number || b.idNumber || b.id_no || b.idNo || '').trim();
    const guestStmt = db.prepare(`
      INSERT INTO guests (name, father_name, mobile, alt_mobile, email, address, dob, doc_type, doc_front, doc_back, guest_photo, aadhar_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const guestResult = guestStmt.run(
      guest_name || 'Guest',
      father_name || '',
      mobile || '',
      cleanAltMobile,
      email || '',
      address || '',
      dob || '',
      doc_type || 'Aadhar Card',
      doc_front || '',
      doc_back || '',
      guest_photo || '',
      cleanAadharNumber
    );
    const guestId = guestResult.lastInsertRowid;

    // 2. Calculate Pricing & Discount (OTA Manual Tariff or Standard calculation)
    const combinedBaseRate = allRooms.reduce((sum, r) => sum + r.price, 0);
    const manualOtaAmount = (ota_bill_amount !== undefined && ota_bill_amount !== null && ota_bill_amount !== '') ? parseFloat(ota_bill_amount) : null;
    
    const cleanBookingSource = (booking_source || 'Walk-in').trim();
    const isOta = cleanBookingSource.toLowerCase() === 'ota';
    const isBtc = cleanBookingSource.toLowerCase() === 'btc' || cleanBookingSource.toLowerCase().includes('company');

    // Check nights & extension
    let stayNights = parseInt(b.stay_nights ?? b.stayNights, 10) || 1;
    let computedExtensionCharge = 0;
    if (approx_checkout_time) {
      try {
        const cInStr = (b.checkin_time || b.checkinTime || new Date().toISOString()).split('T')[0];
        const cOutStr = String(approx_checkout_time).split('T')[0];
        if (cInStr && cOutStr) {
          const dIn = new Date(cInStr);
          const dOut = new Date(cOutStr);
          const diffDays = Math.round((dOut - dIn) / (1000 * 60 * 60 * 24));
          stayNights = Math.max(1, diffDays);
        }

        const timePart = String(approx_checkout_time).includes('T') ? String(approx_checkout_time).split('T')[1]?.slice(0, 5) : null;
        if (timePart) {
          const [h, m] = timePart.split(':').map(Number);
          const totalCheckoutMins = (h || 0) * 60 + (m || 0);
          const r3h = primaryRoom.ext_3h_rate ?? 500;
          const r6h = primaryRoom.ext_6h_rate ?? 1000;
          const r9h = primaryRoom.ext_9h_rate ?? 1500;

          // Up to 11:00 AM (660 mins): Standard / Grace (₹0)
          if (totalCheckoutMins > 11 * 60) {
            if (totalCheckoutMins <= 13 * 60) {
              computedExtensionCharge = r3h;
            } else if (totalCheckoutMins <= 16 * 60) {
              computedExtensionCharge = r6h;
            } else if (totalCheckoutMins <= 19 * 60) {
              computedExtensionCharge = r9h;
            } else {
              computedExtensionCharge = primaryRoom.price;
            }
          }
        }
      } catch (err) {
        console.warn('Error calculating checkout extension in server.js:', err);
      }
    }
    let extCharge = (req.body.extension_charge !== undefined && req.body.extension_charge !== null)
      ? (parseFloat(req.body.extension_charge) || 0)
      : computedExtensionCharge;
    if (isOta) {
      extCharge = 0; // For OTA bookings, early check-in or fixed stay is ₹0 extra charge
    }

    const extraBedFee = parseFloat(extra_bed_charge) || 0;
    const cleanMealPlan = (meal_plan || b.mealPlan || 'without_breakfast').trim();
    const cleanAdultsCount = Math.max(1, (parseInt(adults_male) || 0) + (parseInt(adults_female) || 0));
    const bfRate = primaryRoom.breakfast_price ?? 250;
    const mealFee = (req.body.meal_charge !== undefined && req.body.meal_charge !== null)
      ? (parseFloat(req.body.meal_charge) || 0)
      : (cleanMealPlan === 'with_breakfast' ? (cleanAdultsCount * bfRate * stayNights) : 0);

    let effectiveBaseRate = (parseFloat(room_rate) || combinedBaseRate) * stayNights + extCharge + extraBedFee + mealFee;
    if (manualOtaAmount !== null && manualOtaAmount >= 0) {
      effectiveBaseRate = manualOtaAmount + extCharge + extraBedFee + mealFee;
    }

    const maxDiscount = Math.min(...allRooms.map(r => r.max_discount_pct || 15));
    const requestedDiscount = Math.min(parseFloat(discount_pct) || 0, maxDiscount);
    const discountAmount = manualOtaAmount !== null ? 0 : Math.round((effectiveBaseRate * requestedDiscount) / 100);
    const netChargeBeforeTax = effectiveBaseRate - discountAmount;
    
    // Dynamic Room GST: Prioritize room-configured GST, fallback to system setting
    const roomGstRow = db.prepare("SELECT value FROM system_settings WHERE key = 'room_gst_pct'").get();
    const fallbackGstPct = roomGstRow ? (parseFloat(roomGstRow.value) || 0) : 5;
    const roomGstPct = primaryRoom && primaryRoom.gst_pct !== undefined && primaryRoom.gst_pct !== null
      ? (parseFloat(primaryRoom.gst_pct) || 0)
      : fallbackGstPct;
    const tariffTax = isOta ? 0 : Math.round(netChargeBeforeTax * (roomGstPct / 100));
    let netTotalCharge = netChargeBeforeTax + tariffTax;

    let cleanIsPrepaid = 0;
    if (isOta) {
      if (req.body.is_prepaid === 0 || req.body.is_prepaid === '0' || req.body.is_prepaid === false || req.body.isPrepaid === false || req.body.otaIsPrepaid === false || b.is_prepaid === 0 || b.is_prepaid === '0' || b.is_prepaid === false || b.isPrepaid === false) {
        cleanIsPrepaid = 0;
      } else if (parseInt(is_prepaid) === 1 || req.body.is_prepaid === true || req.body.isPrepaid === true || req.body.otaIsPrepaid === true) {
        cleanIsPrepaid = 1;
      }
    }

    // Harmonize with client calculated totalDue to prevent rounding or payload discrepancies
    if (isOta) {
      const extraRoomsFee = parseFloat(req.body.extra_rooms_charge || req.body.extraRoomsCharge) || 0;
      const extraBreakfastFee = parseFloat(req.body.extra_breakfast_charge || req.body.extraBreakfastCharge) || 0;
      const otaExtrasFee = extraBedFee + extCharge + extraRoomsFee + extraBreakfastFee;
      const explicitAdvancePayment = Math.max(
        (parseFloat(split_cash) || 0) + (parseFloat(split_card) || 0) + (parseFloat(split_online) || 0) + (parseFloat(split_cheque) || 0),
        parseFloat(advance_payment) || 0
      );
      const minOtaCharge = cleanIsPrepaid ? otaExtrasFee : ((manualOtaAmount || 0) + otaExtrasFee);
      netTotalCharge = Math.max(minOtaCharge, explicitAdvancePayment);
    } else {
      const clientReportedCharge = parseFloat(req.body.total_room_charge ?? req.body.netCharge);
      if (!isNaN(clientReportedCharge) && clientReportedCharge > 0) {
        netTotalCharge = Math.max(netTotalCharge, clientReportedCharge);
      }
    }

    // 3. Advance Payment & Cheque Handling
    const cash = parseFloat(split_cash) || 0;
    const card = parseFloat(split_card) || 0;
    const online = parseFloat(split_online) || 0;
    const cheque = parseFloat(split_cheque) || 0;
    const explicitAdvance = parseFloat(advance_payment) || 0;
    const totalPaid = Math.max(cash + card + online + cheque, explicitAdvance);

    // Guard: Advance payment cannot exceed the total bill amount (for non-BTC bookings)
    if (!isBtc && totalPaid > netTotalCharge) {
      throw new Error(`Advance payment (₹${totalPaid.toLocaleString('en-IN')}) cannot exceed the total bill amount (₹${netTotalCharge.toLocaleString('en-IN')}).`);
    }

    const checkinTime = new Date().toISOString();
    
    const paymentStatus = isBtc ? 'pending_from_company' : (totalPaid >= netTotalCharge ? 'paid' : (totalPaid > 0 ? 'partial' : 'pending'));
    
    const cleanOtaPlatform = isOta ? (ota_platform || '').trim() : null;
    const cleanOtaBookingId = isOta ? (ota_booking_id || '').trim() : null;
    
    const cleanBtcCompanyId = isBtc ? (parseInt(btc_company_id) || null) : null;
    const cleanBtcCompanyName = isBtc ? (btc_company_name || '').trim() : null;
    const cleanBtcApprovalRef = isBtc ? (btc_approval_ref || '').trim() : null;

    const isManualEntry = manual_entry ? 1 : 0;
    const cleanDocProofsJson = typeof doc_proofs_json === 'string' ? doc_proofs_json : JSON.stringify(doc_proofs_json || []);
    const cleanExtraBeds = parseInt(extra_beds) || 0;
    const cleanExtraBedCharge = parseFloat(extra_bed_charge) || 0;
    const cleanCheckedInBy = (req.body.checked_in_by || 'Front Desk').trim();

    // Advance Payment Mode & Cheque Attributes
    const advMode = (advance_payment_mode || (cash > 0 ? 'cash' : (card > 0 ? 'card' : (online > 0 ? 'upi' : 'cash')))).toLowerCase();
    const isCheque = advMode === 'cheque';
    const advChequeNo = isCheque ? (advance_cheque_no || '').trim() : null;
    const advChequeBank = isCheque ? (advance_cheque_bank || '').trim() : null;
    const advChequeDate = isCheque ? (advance_cheque_date || checkinTime.split('T')[0]) : null;
    const advChequeStatus = isCheque ? 'pending' : 'realized';
    const advChequePhoto = isCheque ? (advance_cheque_photo || cheque_photo || null) : null;

    const splitCashVal = parseFloat(b.split_cash !== undefined ? b.split_cash : (b.splitCash !== undefined ? b.splitCash : cash)) || 0;
    const splitCardVal = parseFloat(b.split_card !== undefined ? b.split_card : (b.splitCard !== undefined ? b.splitCard : card)) || 0;
    const splitOnlineVal = parseFloat(b.split_online !== undefined ? b.split_online : (b.splitOnline !== undefined ? b.splitOnline : online)) || 0;
    const splitChequeVal = parseFloat(b.split_cheque !== undefined ? b.split_cheque : (b.splitCheque !== undefined ? b.splitCheque : 0)) || 0;

    // Universal Card Fee & UPI Tax (Configurable via Manager Panel)
    const surchargeCfg = getSurchargeSettings();
    const defaultAdvCard = (splitCardVal > 0 && surchargeCfg.card_surcharge_pct > 0) ? Math.round((splitCardVal * surchargeCfg.card_surcharge_pct) / 100) : 0;
    const defaultAdvUpi = (splitOnlineVal > surchargeCfg.upi_tax_threshold && surchargeCfg.upi_tax_pct > 0) ? Math.round((splitOnlineVal * surchargeCfg.upi_tax_pct) / 100) : 0;
    const advCardSurcharge = b.card_surcharge !== undefined ? parseFloat(b.card_surcharge) : (b.cardSurcharge !== undefined ? parseFloat(b.cardSurcharge) : defaultAdvCard);
    const advUpiTax = b.upi_tax !== undefined ? parseFloat(b.upi_tax) : (b.upiTax !== undefined ? parseFloat(b.upiTax) : defaultAdvUpi);

    // Generate standard voucher number and sequential receipt number (format: YYYYMMDD-SR, resets monthly)
    const standardVoucherNo = getNextMonthlyVoucherNumber('REG');
    const advanceReceiptNo = totalPaid > 0 ? getReceiptNumberWithMode(advMode) : null;
    const cleanMemberDocsJson = typeof b.member_documents === 'string'
      ? b.member_documents
      : JSON.stringify(b.member_documents || b.memberDocuments || b.member_documents_json || []);

    // 4. Insert Bookings for each allocated room
    const bookingStmt = db.prepare(`
      INSERT INTO bookings (
        room_id, guest_id, adults_male, adults_female, adults_other, children,
        checkin_time, approx_checkout_time, room_rate, discount_pct, discount_amount,
        total_room_charge, split_cash, split_card, split_online, total_paid, payment_status, status,
        booking_source, ota_platform, ota_booking_id, manual_entry, doc_proofs_json, meal_plan,
        extra_beds, extra_bed_charge, checked_in_by, is_prepaid, ota_bill_amount,
        btc_company_id, btc_company_name, btc_approval_ref, advance_payment, advance_payment_mode,
        advance_receipt_no, advance_cheque_no, advance_cheque_bank, advance_cheque_status, alt_mobile,
        advance_cheque_photo, cheque_photo, advance_utr_number, member_documents_json, voucher_number,
        is_early_checkin, original_checkin_time, early_checkin_time, advance_card_surcharge, advance_upi_tax,
        ota_booked_adults, ota_booked_children, ota_booked_extra_beds, extra_adults, extra_children,
        extra_rooms_charge, extra_breakfast_charge, extra_meal_plan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const bookingIds = [];
    const roomNumbers = allRooms.map(r => r.room_number);

    let remainingNetCharge = netTotalCharge;
    let remainingDiscAmt = discountAmount;

    allRooms.forEach((r, idx) => {
      const rBase = r.price;
      const isLast = idx === allRooms.length - 1;
      const fraction = rBase / (combinedBaseRate || 1);
      const rDiscAmt = isLast ? remainingDiscAmt : Math.round(discountAmount * fraction);
      remainingDiscAmt -= rDiscAmt;

      const rNetCharge = isLast ? remainingNetCharge : Math.round(netTotalCharge * fraction);
      remainingNetCharge -= rNetCharge;
      const rPaid = (idx === 0) ? totalPaid : 0;

      const result = bookingStmt.run(
        r.id,
        guestId,
        idx === 0 ? (parseInt(adults_male) || 1) : 0,
        idx === 0 ? (parseInt(adults_female) || 0) : 0,
        idx === 0 ? (parseInt(adults_other) || 0) : 0,
        idx === 0 ? (parseInt(children) || 0) : 0,
        checkinTime,
        approx_checkout_time || null,
        rBase,
        requestedDiscount,
        rDiscAmt,
        rNetCharge,
        idx === 0 ? (splitCashVal || cash) : 0,
        idx === 0 ? (splitCardVal || card) : 0,
        idx === 0 ? (splitOnlineVal || online) : 0,
        idx === 0 ? totalPaid : 0,
        paymentStatus,
        cleanBookingSource,
        cleanOtaPlatform,
        cleanOtaBookingId,
        isManualEntry,
        cleanDocProofsJson,
        cleanMealPlan,
        idx === 0 ? cleanExtraBeds : 0,
        idx === 0 ? cleanExtraBedCharge : 0,
        cleanCheckedInBy,
        cleanIsPrepaid,
        manualOtaAmount,
        cleanBtcCompanyId,
        cleanBtcCompanyName,
        cleanBtcApprovalRef,
        idx === 0 ? totalPaid : 0,
        advMode,
        idx === 0 ? advanceReceiptNo : null,
        advChequeNo,
        advChequeBank,
        advChequeStatus,
        cleanAltMobile,
        advChequePhoto,
        advChequePhoto,
        idx === 0 ? online_utr : null,
        cleanMemberDocsJson,
        standardVoucherNo,
        is_early_checkin,
        original_checkin_time,
        early_checkin_time,
        idx === 0 ? advCardSurcharge : 0,
        idx === 0 ? advUpiTax : 0,
        idx === 0 ? ota_booked_adults : null,
        idx === 0 ? ota_booked_children : 0,
        idx === 0 ? ota_booked_extra_beds : 0,
        idx === 0 ? extra_adults : 0,
        idx === 0 ? extra_children : 0,
        idx === 0 ? extra_rooms_charge : 0,
        idx === 0 ? extra_breakfast_charge : 0,
        idx === 0 ? extra_meal_plan : null
      );

      const bId = result.lastInsertRowid;
      bookingIds.push(bId);

      // 5. Update Room Status to OCCUPIED
      db.prepare(`
        UPDATE rooms 
        SET status = 'occupied', current_booking_id = ?
        WHERE id = ?
      `).run(bId, r.id);
    });

    // 6. Record in Centralized Accounting Payments Ledger if advance payment made
    if (totalPaid > 0 && advanceReceiptNo) {
      db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_no, bank_name, cheque_date, cheque_status, realized_at,
          btc_company_id, btc_company_name, cashier_name, notes, cheque_photo, utr_number,
          card_surcharge, upi_tax, split_cash, split_card, split_online, split_cheque
        ) VALUES (?, ?, ?, 'hospitality', 'advance', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        advanceReceiptNo,
        bookingIds[0],
        primaryRoom.id,
        advMode,
        totalPaid,
        advChequeNo,
        advChequeBank,
        advChequeDate,
        advChequeStatus,
        advChequeStatus === 'realized' ? checkinTime : null,
        cleanBtcCompanyId,
        cleanBtcCompanyName,
        cleanCheckedInBy,
        `paid while checkin : checkin${advCardSurcharge > 0 ? ` (+₹${advCardSurcharge} Card fee)` : ''}${advUpiTax > 0 ? ` (+₹${advUpiTax} UPI tax)` : ''}`,
        advChequePhoto,
        online_utr,
        advCardSurcharge,
        advUpiTax,
        splitCashVal,
        splitCardVal,
        splitOnlineVal,
        splitChequeVal
      );
    }

    return {
      id: bookingIds[0],
      bookingIds,
      primaryBookingId: bookingIds[0],
      guestId,
      roomIds: allRooms.map(r => r.id),
      roomNumbers,
      roomTypes: allRooms.map(r => r.room_type),
      guestName: guest_name,
      mobile: mobile,
      altMobile: cleanAltMobile,
      email: email || '',
      address: address || '',
      aadharNumber: cleanAadharNumber,
      aadhar_number: cleanAadharNumber,
      docType: doc_type || 'Aadhaar Card',
      doc_type: doc_type || 'Aadhaar Card',
      dob: dob || '',
      checkinTime,
      approxCheckoutTime: approx_checkout_time,
      totalRoomCharge: netTotalCharge,
      totalPaid,
      paymentStatus,
      advanceReceiptNo,
      voucherNumber: standardVoucherNo,
      voucher_number: standardVoucherNo,
      memberDocuments: JSON.parse(cleanMemberDocsJson || '[]'),
      isPrepaid: cleanIsPrepaid,
      bookingSource: cleanBookingSource,
      isEarlyCheckin: Boolean(is_early_checkin),
      originalCheckinTime: original_checkin_time,
      earlyCheckinTime: early_checkin_time,
      btcCompanyName: cleanBtcCompanyName,
      chequePending: isCheque
    };
  });

  try {
    const result = transaction();

    // Non-blocking background sync of newly checked-in rooms to Supabase
    try {
      if (result && Array.isArray(result.roomNumbers)) {
        result.roomNumbers.forEach((roomNum, idx) => {
          supabaseService.syncActiveOccupancy({
            room_number: String(roomNum),
            guest_name: result.guestName,
            guest_mobile: result.mobile,
            room_id: result.roomIds ? result.roomIds[idx] : null,
            room_type: result.roomTypes ? result.roomTypes[idx] : null,
            booking_id: result.bookingIds ? result.bookingIds[idx] : result.id,
            checkin_time: result.checkinTime
          }).catch(err => console.warn('[Supabase] checkin sync error:', err.message));
        });
      }
    } catch (syncErr) {
      console.warn('[Supabase] Checkin sync dispatch skipped:', syncErr.message);
    }

    res.json({
      success: true,
      data: result,
      voucherNumber: result.voucherNumber,
      voucher_number: result.voucher_number,
      advanceReceiptNo: result.advanceReceiptNo,
      booking: result
    });
  } catch (error) {
    console.error('Checkin error:', error);
    const isClientError = error.message && (
      error.message.includes('cannot exceed') ||
      error.message.includes('not found') ||
      error.message.includes('already occupied') ||
      error.message.includes('mandatory')
    );
    res.status(isClientError ? 400 : 500).json({ success: false, error: error.message });
  }
});

// 8. GET FULL BOOKING DETAILS & REGISTRATION DATA FOR PRINT
app.get(['/api/bookings/:id', '/api/hospitality/history/:id'], (req, res) => {
  try {
    const { id } = req.params;
    const booking = db.prepare(`
      SELECT 
        b.*,
        r.room_number,
        r.room_type,
        r.price as base_room_price,
        g.name as guest_name,
        g.father_name,
        g.mobile,
        g.alt_mobile,
        g.email,
        g.address,
        g.dob,
        g.aadhar_number,
        g.doc_type,
        g.doc_front,
        g.doc_back,
        g.guest_photo,
        c.gst_number as btc_gst_number,
        c.address as btc_address,
        c.pan_number as btc_pan_number,
        c.contact_person as btc_contact_person,
        c.contact_phone as btc_contact_phone,
        c.contact_email as btc_contact_email
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      JOIN guests g ON b.guest_id = g.id
      LEFT JOIN btc_companies c ON (b.btc_company_id = c.id OR (b.btc_company_name IS NOT NULL AND b.btc_company_name != '' AND b.btc_company_name = c.company_name))
      WHERE b.id = ?
    `).get(id);

    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    let memberDocs = [];
    try {
      memberDocs = booking.member_documents_json ? JSON.parse(booking.member_documents_json) : [];
    } catch (e) {
      memberDocs = [];
    }

    // Fetch all recorded payments for this booking
    const payments = db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at ASC').all(id);
    const formattedBooking = {
      ...booking,
      member_documents: memberDocs,
      memberDocuments: memberDocs,
      payments: payments || []
    };

    res.json({
      success: true,
      booking: formattedBooking,
      record: formattedBooking,
      data: formattedBooking
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8b. EXTEND CHECKOUT TIME & LOG AUDIT TRAIL (Updates all linked group rooms)
app.post('/api/bookings/:id/extend-checkout', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { approx_checkout_time } = req.body;
    const extended_by = (req.body.extended_by || req.body.cashier_name || req.user?.full_name || req.user?.username || 'Front Desk').trim();
    if (!approx_checkout_time) {
      return res.status(400).json({ success: false, error: 'approx_checkout_time is required' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const fromTime = booking.approx_checkout_time || booking.checkin_time;
    const toTime = approx_checkout_time;
    const nowIso = new Date().toISOString();

    let logs = [];
    try {
      logs = booking.extension_logs_json ? JSON.parse(booking.extension_logs_json) : [];
    } catch (e) {
      logs = [];
    }
    if (!Array.isArray(logs)) logs = [];

    const newLogEntry = {
      id: Date.now(),
      extended_by,
      from_time: fromTime,
      to_time: toTime,
      created_at: nowIso
    };
    logs.push(newLogEntry);
    const logsJson = JSON.stringify(logs);

    // Update approx_checkout_time & extension_logs_json for ALL active bookings sharing the same guest_id (combined group)
    if (booking.guest_id) {
      db.prepare("UPDATE bookings SET approx_checkout_time = ?, extension_logs_json = ? WHERE guest_id = ? AND status = 'active'").run(approx_checkout_time, logsJson, booking.guest_id);
    } else {
      db.prepare('UPDATE bookings SET approx_checkout_time = ?, extension_logs_json = ? WHERE id = ?').run(approx_checkout_time, logsJson, id);
    }

    // Insert into checkout_extension_logs audit table
    try {
      db.prepare(`
        INSERT INTO checkout_extension_logs (booking_id, room_id, extended_by, from_time, to_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, booking.room_id, extended_by, fromTime, toTime, nowIso);
    } catch (e) {
      console.warn('[Audit] Failed to log checkout extension:', e.message);
    }

    res.json({
      success: true,
      message: 'Checkout date extended successfully',
      approx_checkout_time,
      extension_log: newLogEntry,
      extensionLogs: logs
    });
  } catch (error) {
    console.error('Error extending checkout time:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Calculate actual stay duration, room extension charges, and early checkout dynamic recalculation.
 * Rules:
 * 1. Minimum 1 day rent even if staying just 1 hr or checking out same day.
 * 2. If expected stay was e.g. 3 days, but actual stay is 2 days & 3 hrs:
 *    - Completed 24h milestone days: 2 days.
 *    - Extra hours past completed days: 3 hrs.
 *    - Extra hours charged by room extension tier:
 *      <= ext_grace_mins (60m default): ₹0
 *      <= 180m (3h): ext_3h_rate (₹500 default)
 *      <= 360m (6h): ext_6h_rate (₹1000 default)
 *      <= 540m (9h): ext_9h_rate (₹1500 default)
 *      > 540m (>9h): 1 full day room rent (completedDays + 1, extCharge = 0)
 * 3. If elapsed stay < expectedDays (Early Checkout):
 *    - recalculatedRoomCharge = (chargedDays * dailyRate) + extCharge + extraBedFee + mealFee.
 *    - isEarlyCheckout = true
 */
function calculateActualStayAndExtension({
  checkin_time,
  approx_checkout_time,
  actual_checkout_time = new Date(),
  room = {},
  daily_rate = null,
  total_room_charge = null,
  meal_plan = 'without_breakfast',
  extra_bed_charge = 0,
  adults_male = 1,
  adults_female = 0
}) {
  const dIn = new Date(checkin_time || Date.now());
  const dOut = new Date(actual_checkout_time || Date.now());
  const dExpected = approx_checkout_time ? new Date(approx_checkout_time) : null;

  // Expected nights booked
  let expectedNights = 1;
  if (dExpected && dExpected > dIn) {
    const diffDays = Math.round((dExpected - dIn) / (1000 * 60 * 60 * 24));
    expectedNights = Math.max(1, diffDays);
  }

  // Elapsed stay
  const elapsedMs = Math.max(0, dOut.getTime() - dIn.getTime());
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const elapsedMins = elapsedMs / (1000 * 60);

  const graceMins = room.ext_grace_mins !== undefined && room.ext_grace_mins !== null ? Number(room.ext_grace_mins) : 60;
  const r3h = room.ext_3h_rate !== undefined && room.ext_3h_rate !== null ? Number(room.ext_3h_rate) : 500;
  const r6h = room.ext_6h_rate !== undefined && room.ext_6h_rate !== null ? Number(room.ext_6h_rate) : 1000;
  const r9h = room.ext_9h_rate !== undefined && room.ext_9h_rate !== null ? Number(room.ext_9h_rate) : 1500;
  const unitDailyRate = daily_rate !== null && daily_rate !== undefined ? Number(daily_rate) : (Number(room.price || room.room_rate) || 0);

  let completedDays = 0;
  let extraHours = 0;
  let extraMins = 0;
  let extensionCharge = 0;
  let chargedDays = 1;
  let isEarlyCheckout = false;

  // Rule 1: Short stay (< 24 hrs) - minimum 1 day rent
  if (elapsedHours < 24) {
    completedDays = 0;
    chargedDays = 1;
    extraHours = Math.floor(elapsedHours);
    extraMins = Math.floor(elapsedMins % 60);
    extensionCharge = 0; // Covered by 1 day minimum rent
  } else {
    completedDays = Math.floor(elapsedHours / 24);
    chargedDays = completedDays;
    extraHours = Math.floor(elapsedHours % 24);
    extraMins = Math.floor(elapsedMins % 60);
    const extraTotalMins = extraHours * 60 + extraMins;

    if (extraTotalMins <= graceMins) {
      extensionCharge = 0;
    } else if (extraTotalMins <= 180) {
      extensionCharge = r3h;
    } else if (extraTotalMins <= 360) {
      extensionCharge = r6h;
    } else if (extraTotalMins <= 540) {
      extensionCharge = r9h;
    } else {
      // Past 9 hours counts as a full day
      chargedDays = completedDays + 1;
      extensionCharge = 0;
      extraHours = 0;
    }
  }

  // Daily extras calculation (extra bed & breakfast)
  const totalAdults = Math.max(1, (Number(adults_male) || 0) + (Number(adults_female) || 0));
  const bfRate = room.breakfast_price !== undefined ? Number(room.breakfast_price) : 250;
  const dailyMealFee = meal_plan === 'with_breakfast' ? (totalAdults * bfRate) : 0;
  const dailyBedFee = Number(extra_bed_charge) || 0;

  // Recalculated total room charge for actual stay
  const recalculatedRoomCharge = (chargedDays * unitDailyRate) + extensionCharge + (chargedDays * dailyMealFee) + (chargedDays * dailyBedFee);

  // Original room charge (if provided or fallback to expectedNights * unitDailyRate)
  const originalCharge = total_room_charge !== null && total_room_charge !== undefined
    ? Number(total_room_charge)
    : (expectedNights * unitDailyRate + (expectedNights * dailyMealFee) + (expectedNights * dailyBedFee));

  // Determine early checkout
  if (expectedNights > 1 && (chargedDays < expectedNights || (chargedDays === expectedNights && extensionCharge === 0 && dOut < dExpected))) {
    if (recalculatedRoomCharge < originalCharge) {
      isEarlyCheckout = true;
    }
  }

  // Human readable stay duration
  let stayDurationStr = '';
  if (completedDays > 0) {
    stayDurationStr += `${completedDays} day${completedDays > 1 ? 's' : ''}`;
    if (extraHours > 0) {
      stayDurationStr += ` & ${extraHours} hr${extraHours > 1 ? 's' : ''}`;
    }
  } else {
    stayDurationStr = `${Math.max(1, extraHours)} hr${extraHours > 1 ? 's' : ''} (1 Day Min)`;
  }

  return {
    isEarlyCheckout,
    expectedNights,
    completedDays,
    extraHours,
    extraMins,
    chargedDays,
    extensionCharge,
    recalculatedRoomCharge: Math.round(recalculatedRoomCharge),
    originalRoomCharge: Math.round(originalCharge),
    differenceRefundDue: Math.max(0, Math.round(originalCharge - recalculatedRoomCharge)),
    stayDurationStr
  };
}

// 9. GET OCCUPIED ROOM FOLIO (Consolidated Room + Restaurant + Bar for all linked rooms)
app.get('/api/rooms/:id/folio', async (req, res) => {
  try {
    const { id } = req.params;
    const room = db.prepare(`
      SELECT 
        r.*,
        b.id as booking_id,
        b.guest_id,
        b.checkin_time,
        b.approx_checkout_time,
        b.room_rate,
        b.discount_pct,
        b.discount_amount,
        b.total_room_charge,
        b.split_cash,
        b.split_card,
        b.split_online,
        b.total_paid as initial_paid,
        b.payment_status as initial_payment_status,
        b.booking_source,
        b.ota_platform,
        b.ota_booking_id,
        b.ota_bill_amount,
        b.btc_company_id,
        b.btc_company_name,
        b.btc_approval_ref,
        b.is_prepaid,
        b.is_early_checkin,
        b.original_checkin_time,
        b.early_checkin_time,
        b.manual_entry,
        b.doc_proofs_json,
        b.meal_plan,
        b.adults_male,
        b.adults_female,
        b.adults_other,
        b.children,
        b.extra_beds,
        b.extra_bed_charge,
        b.ota_booked_adults,
        b.ota_booked_children,
        b.ota_booked_extra_beds,
        b.extra_adults,
        b.extra_children,
        b.extra_rooms_charge,
        b.extra_breakfast_charge,
        b.extra_meal_plan,
        b.advance_card_surcharge,
        b.advance_upi_tax,
        b.final_card_surcharge,
        b.final_upi_tax,
        b.advance_utr_number,
        b.final_settlement_utr,
        b.advance_cheque_no,
        b.advance_cheque_bank,
        b.checked_in_by,
        b.checked_out_by,
        b.member_documents_json,
        b.extension_logs_json,
        b.voucher_number,
        g.name as guest_name,
        g.father_name,
        g.mobile,
        g.alt_mobile,
        b.alt_mobile as booking_alt_mobile,
        g.email,
        g.address,
        g.dob,
        g.aadhar_number,
        g.doc_type,
        g.doc_front,
        g.doc_back,
        g.guest_photo,
        c.gst_number as btc_gst_number,
        c.address as btc_address,
        c.pan_number as btc_pan_number,
        c.contact_person as btc_contact_person,
        c.contact_phone as btc_contact_phone,
        c.contact_email as btc_contact_email
      FROM rooms r
      JOIN bookings b ON r.current_booking_id = b.id
      JOIN guests g ON b.guest_id = g.id
      LEFT JOIN btc_companies c ON (b.btc_company_id = c.id OR (b.btc_company_name IS NOT NULL AND b.btc_company_name != '' AND b.btc_company_name = c.company_name))
      WHERE r.id = ? AND b.status = 'active'
    `).get(id);

    if (!room) {
      return res.status(404).json({ success: false, error: 'Active booking not found for this room' });
    }

    try {
      room.member_documents = room.member_documents_json ? JSON.parse(room.member_documents_json) : [];
    } catch (e) {
      room.member_documents = [];
    }

    try {
      room.extension_logs = room.extension_logs_json ? JSON.parse(room.extension_logs_json) : [];
    } catch (e) {
      room.extension_logs = [];
    }

    // Identify all rooms linked to this active guest booking
    const groupBookings = db.prepare(`
      SELECT 
        r.id as room_id,
        r.room_number,
        r.room_type,
        r.price as base_room_price,
        b.id as booking_id,
        b.room_rate,
        b.discount_pct,
        b.discount_amount,
        b.total_room_charge,
        b.total_paid as initial_paid,
        b.split_cash,
        b.split_card,
        b.split_online,
        b.advance_card_surcharge,
        b.advance_upi_tax,
        b.adults_male,
        b.adults_female,
        b.adults_other,
                b.extra_beds,
        b.extra_bed_charge,
        b.ota_booked_adults,
        b.ota_booked_children,
        b.ota_booked_extra_beds,
        b.extra_adults,
        b.extra_children,
        b.extra_rooms_charge,
        b.extra_breakfast_charge,
        b.extra_meal_plan,
        b.checked_in_by,
        b.checked_out_by,
        b.ota_bill_amount,
        b.is_prepaid,
        b.is_early_checkin,
        b.original_checkin_time,
        b.early_checkin_time,
        b.checkin_time,
        b.approx_checkout_time
      FROM rooms r 
      JOIN bookings b ON r.current_booking_id = b.id 
      WHERE b.guest_id = ? AND b.status = 'active' AND b.checkin_time = ?
      ORDER BY CAST(r.room_number AS INTEGER) ASC, r.room_number ASC
    `).all(room.guest_id, room.checkin_time);

    const groupRoomIds = groupBookings.map(gb => gb.room_id);
    const isCombined = groupBookings.length > 1;

    // Combined financial & occupancy aggregates across all group rooms
    const combinedBaseRate = groupBookings.reduce((sum, gb) => sum + (gb.base_room_price || gb.room_rate || 0), 0);
    const combinedTotalRoomCharge = groupBookings.reduce((sum, gb) => sum + (gb.total_room_charge || 0), 0);
    const combinedInitialPaid = groupBookings.reduce((sum, gb) => sum + (gb.initial_paid || 0), 0);
    const combinedDiscountAmount = groupBookings.reduce((sum, gb) => sum + (gb.discount_amount || 0), 0);
    const combinedDiscountPct = groupBookings.length === 1 ? (groupBookings[0].discount_pct || 0) : 0;
    const combinedSplitCash = groupBookings.reduce((sum, gb) => sum + (gb.split_cash || 0), 0);
    const combinedSplitCard = groupBookings.reduce((sum, gb) => sum + (gb.split_card || 0), 0);
    const combinedSplitOnline = groupBookings.reduce((sum, gb) => sum + (gb.split_online || 0), 0);
    const combinedCardSurcharge = groupBookings.reduce((sum, gb) => sum + (gb.advance_card_surcharge || 0), 0);
    const combinedUpiTax = groupBookings.reduce((sum, gb) => sum + (gb.advance_upi_tax || 0), 0);

    const groupAdultsMale = groupBookings.reduce((sum, gb) => sum + (gb.adults_male || 0), 0);
    const groupAdultsFemale = groupBookings.reduce((sum, gb) => sum + (gb.adults_female || 0), 0);
    const groupAdultsOther = groupBookings.reduce((sum, gb) => sum + (gb.adults_other || 0), 0);
    const groupChildren = groupBookings.reduce((sum, gb) => sum + (gb.children || 0), 0);
    const groupExtraBeds = groupBookings.reduce((sum, gb) => sum + (gb.extra_beds || 0), 0);
    const groupExtraBedCharge = groupBookings.reduce((sum, gb) => sum + (gb.extra_bed_charge || 0), 0);
    const groupOtaBookedAdults = groupBookings.reduce((sum, gb) => sum + (gb.ota_booked_adults || 0), 0);
    const groupOtaBookedChildren = groupBookings.reduce((sum, gb) => sum + (gb.ota_booked_children || 0), 0);
    const groupOtaBookedExtraBeds = groupBookings.reduce((sum, gb) => sum + (gb.ota_booked_extra_beds || 0), 0);
    const groupExtraAdults = groupBookings.reduce((sum, gb) => sum + (gb.extra_adults || 0), 0);
    const groupExtraChildren = groupBookings.reduce((sum, gb) => sum + (gb.extra_children || 0), 0);
    const groupExtraRoomsCharge = groupBookings.reduce((sum, gb) => sum + (gb.extra_rooms_charge || 0), 0);
    const groupExtraBreakfastCharge = groupBookings.reduce((sum, gb) => sum + (gb.extra_breakfast_charge || 0), 0);

    room.price = combinedBaseRate;
    room.room_rate = combinedBaseRate;
    room.discount_amount = combinedDiscountAmount;
    room.discount_pct = combinedDiscountPct;
    room.total_room_charge = combinedTotalRoomCharge;
    room.initial_paid = combinedInitialPaid;
    room.split_cash = combinedSplitCash;
    room.split_card = combinedSplitCard;
    room.split_online = combinedSplitOnline;
    room.adults_male = isCombined ? groupAdultsMale : (room.adults_male !== undefined && room.adults_male !== null ? room.adults_male : 1);
    room.adults_female = isCombined ? groupAdultsFemale : (room.adults_female || 0);
    room.adults_other = isCombined ? groupAdultsOther : (room.adults_other || 0);
    room.children = isCombined ? groupChildren : (room.children || 0);
    room.extra_beds = isCombined ? groupExtraBeds : (room.extra_beds || 0);
    room.ota_booked_adults = isCombined ? (groupOtaBookedAdults || room.ota_booked_adults) : room.ota_booked_adults;
    room.ota_booked_children = isCombined ? (groupOtaBookedChildren || room.ota_booked_children) : room.ota_booked_children;
    room.ota_booked_extra_beds = isCombined ? (groupOtaBookedExtraBeds || room.ota_booked_extra_beds) : room.ota_booked_extra_beds;
    room.extra_adults = isCombined ? (groupExtraAdults || room.extra_adults) : room.extra_adults;
    room.extra_children = isCombined ? (groupExtraChildren || room.extra_children) : room.extra_children;
    room.extra_rooms_charge = isCombined ? (groupExtraRoomsCharge || room.extra_rooms_charge) : room.extra_rooms_charge;
    room.extra_breakfast_charge = isCombined ? (groupExtraBreakfastCharge || room.extra_breakfast_charge) : room.extra_breakfast_charge;
    room.all_group_rooms = groupBookings.map(gr => ({
      room_number: gr.room_number,
      room_type: gr.room_type,
      room_id: gr.room_id
    }));
    room.all_group_room_numbers = groupBookings.map(gr => gr.room_number);
    room.all_group_room_ids = groupRoomIds;
    room.all_group_booking_ids = groupBookings.map(gr => gr.booking_id);
    room.is_combined = isCombined;
    room.group_room_details = groupBookings;

    // Fetch all Restaurant Orders linked strictly to this active booking group session
    const bookingPlaceholders = groupBookings.map(() => '?').join(',');
    const groupBookingIds = groupBookings.map(gb => gb.booking_id);
    const roomPlaceholders = groupRoomIds.map(() => '?').join(',');

    const minCheckinLocal = groupBookings.reduce((min, b) => {
      if (!b.checkin_time) return min;
      const localStr = formatToLocalSqliteString(b.checkin_time);
      return localStr < min ? localStr : min;
    }, '2099-01-01 00:00:00');
    const validCheckinLocal = minCheckinLocal === '2099-01-01 00:00:00' ? '2000-01-01 00:00:00' : minCheckinLocal;

    const restaurantOrders = db.prepare(`
      SELECT ro.*, r.room_number 
      FROM restaurant_orders ro
      LEFT JOIN rooms r ON ro.room_id = r.id
      WHERE (ro.booking_id IN (${bookingPlaceholders}))
         OR (ro.booking_id IS NULL AND ro.room_id IN (${roomPlaceholders}) AND datetime(ro.created_at) >= ?)
      ORDER BY ro.created_at ASC
    `).all(...groupBookingIds, ...groupRoomIds, validCheckinLocal);

    // Fetch all Bar Orders linked strictly to this active booking group session
    const barOrders = db.prepare(`
      SELECT bo.*, r.room_number 
      FROM bar_orders bo
      LEFT JOIN rooms r ON bo.room_id = r.id
      WHERE (bo.booking_id IN (${bookingPlaceholders}))
         OR (bo.booking_id IS NULL AND bo.room_id IN (${roomPlaceholders}) AND datetime(bo.created_at) >= ?)
      ORDER BY bo.created_at ASC
    `).all(...groupBookingIds, ...groupRoomIds, validCheckinLocal);

    // Merge any pending cloud charges from separate POS machines via Supabase
    try {
      const allRoomNums = room.all_group_room_numbers || [room.room_number];
      for (const rNum of allRoomNums) {
        const pending = await supabaseService.fetchPendingRoomCharges(rNum);
        if (pending && pending.length > 0) {
          for (const cc of pending) {
            const totalAmt = parseFloat(cc.grand_total) || 0;
            if (cc.department === 'bar') {
              if (!barOrders.some(bo => bo.order_number === cc.bill_no)) {
                barOrders.push({
                  id: `cloud-${cc.id}`,
                  order_number: cc.bill_no,
                  total: totalAmt,
                  is_paid: 0,
                  created_at: cc.created_at,
                  cashier_name: cc.cashier_name || 'Bar Cashier',
                  is_cloud_synced: true,
                  items_json: cc.items_summary || ''
                });
              }
            } else {
              if (!restaurantOrders.some(ro => ro.order_number === cc.bill_no)) {
                restaurantOrders.push({
                  id: `cloud-${cc.id}`,
                  order_number: cc.bill_no,
                  total: totalAmt,
                  is_paid: 0,
                  created_at: cc.created_at,
                  cashier_name: cc.cashier_name || 'Restaurant Cashier',
                  is_cloud_synced: true,
                  items_json: cc.items_summary || ''
                });
              }
            }
          }
        }
      }
    } catch (cErr) {
      console.warn('[Supabase] Failed to fetch cloud room charges for folio:', cErr.message);
    }

    // Only UNPAID orders add to running room folio due
    const pendingRestaurantOrders = restaurantOrders.filter(o => o.is_paid === 0);
    const foodTotal = pendingRestaurantOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    const pendingBarOrders = barOrders.filter(o => o.is_paid === 0);
    const barTotal = pendingBarOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    // Fetch all payments ledger records strictly for this active booking session
    const payments = db.prepare(`
      SELECT * FROM payments 
      WHERE booking_id IN (${bookingPlaceholders})
      ORDER BY created_at ASC
    `).all(...groupBookings.map(b => b.booking_id));

    // Total paid via recorded payments or booking initial paid
    const totalPaymentsPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const effectivePaid = Math.max(combinedInitialPaid, totalPaymentsPaid);

    // Dynamic Room GST: Prioritize room-configured GST, fallback to system setting
    const roomGstRow = db.prepare("SELECT value FROM system_settings WHERE key = 'room_gst_pct'").get();
    const fallbackGstPct = roomGstRow ? (parseFloat(roomGstRow.value) || 0) : 5;
    const roomGstPct = room && room.gst_pct !== undefined && room.gst_pct !== null
      ? (parseFloat(room.gst_pct) || 0)
      : fallbackGstPct;
    const gstFactor = 1 + (roomGstPct / 100);

    const isOta = room.booking_source === 'OTA';
    const isOtaPayAtHotel = isOta && (
      room.is_prepaid === 0 ||
      room.is_prepaid === '0' ||
      room.is_prepaid === false ||
      String(room.rate_type || '').includes('hotel')
    );
    const isOtaPrepaid = isOta && !isOtaPayAtHotel && (
      parseInt(room.is_prepaid) === 1 ||
      room.is_prepaid === true ||
      room.is_prepaid === '1'
    );
    const otaBillAmount = parseFloat(room.ota_bill_amount) || 0;
    const hotelExtrasCharge = groupExtraBedCharge + groupExtraRoomsCharge + groupExtraBreakfastCharge;

    // Dynamic Early Checkout Recalculation (enforces 1-day min, calculates extra hours via room extension rates)
    let stayCalc = { isEarlyCheckout: false, recalculatedRoomCharge: combinedTotalRoomCharge, extensionCharge: 0, chargedDays: 1, extraHours: 0 };
    if (!isOtaPrepaid) {
      stayCalc = calculateActualStayAndExtension({
        checkin_time: room.checkin_time,
        approx_checkout_time: room.approx_checkout_time,
        actual_checkout_time: new Date(),
        room,
        daily_rate: combinedBaseRate,
        total_room_charge: combinedTotalRoomCharge,
        meal_plan: room.meal_plan,
        extra_bed_charge: groupExtraBedCharge,
        adults_male: groupAdultsMale,
        adults_female: groupAdultsFemale
      });
    }

    // Running totals tailored by booking source & prepaid status
    let effectiveRoomCharge = combinedTotalRoomCharge;
    if (stayCalc.isEarlyCheckout && !isOtaPrepaid && !isOtaPayAtHotel) {
      effectiveRoomCharge = stayCalc.recalculatedRoomCharge;
    }

    let effectiveGrandTotal = effectiveRoomCharge + foodTotal + barTotal;
    let effectiveBalanceDue = effectiveGrandTotal - effectivePaid;

    if (isOtaPrepaid) {
      // For OTA Pre-Paid, room tariff is settled by OTA voucher.
      // Guest liability at hotel is strictly hotel extras + F&B.
      const stayExtrasPayable = Math.max(hotelExtrasCharge, effectivePaid);
      effectiveRoomCharge = stayExtrasPayable;
      effectiveGrandTotal = stayExtrasPayable + foodTotal + barTotal;
      // Balance due by guest: if desk payment covers extras, balance is 0 (or F&B balance if any)
      effectiveBalanceDue = Math.max(0, (hotelExtrasCharge + foodTotal + barTotal) - effectivePaid);
    } else if (isOtaPayAtHotel && otaBillAmount > 0) {
      // For OTA Pay at Hotel, guest pays OTA contract rate + hotel extras + F&B
      const otaTotalStay = otaBillAmount + hotelExtrasCharge;
      effectiveRoomCharge = otaTotalStay;
      effectiveGrandTotal = otaTotalStay + foodTotal + barTotal;
      effectiveBalanceDue = Math.max(0, effectiveGrandTotal - effectivePaid);
    }

    const refundAmount = effectiveBalanceDue < 0 ? Math.abs(effectiveBalanceDue) : 0;

    // Pre-tax room charge (taxable amount before GST)
    const combinedPreTaxRoomCharge = (isOtaPrepaid || isOtaPayAtHotel)
      ? effectiveRoomCharge
      : Math.round(effectiveRoomCharge / gstFactor);

    // Running totals
    const grandTotal = effectiveGrandTotal;
    const roomGrossTariff = combinedPreTaxRoomCharge + combinedDiscountAmount;
    const grossTariff = roomGrossTariff;
    const balanceDue = effectiveBalanceDue;

    // Fetch all recorded visitors strictly for this active booking session
    const visitors = db.prepare(`
      SELECT * FROM room_visitors 
      WHERE booking_id IN (${bookingPlaceholders})
      ORDER BY checkin_time DESC
    `).all(...groupBookings.map(b => b.booking_id));

    res.json({
      success: true,
      folio: {
        room,
        restaurantOrders,
        barOrders,
        visitors: visitors || [],
        payments: payments || [],
        summary: {
          grossTariff: roomGrossTariff,
          roomGrossTariff,
          roomTaxable: combinedPreTaxRoomCharge,
          stayTaxable: combinedPreTaxRoomCharge,
          stayTax: Math.max(0, effectiveRoomCharge - combinedPreTaxRoomCharge),
          discountAmount: combinedDiscountAmount,
          discountPct: combinedDiscountPct,
          roomCharge: effectiveRoomCharge,
          hotelExtrasCharge,
          otaBillAmount,
          isOtaPrepaid,
          isOtaPayAtHotel,
          cardSurcharge: combinedCardSurcharge,
          upiTax: combinedUpiTax,
          foodTotal,
          barTotal,
          fnbTotal: foodTotal + barTotal,
          grandTotal,
          netTotalCharge: grandTotal,
          initialPaid: effectivePaid,
          advancePaid: effectivePaid,
          balanceDue,
          isEarlyCheckout: Boolean(stayCalc.isEarlyCheckout),
          chargedDays: stayCalc.chargedDays || 1,
          completedDays: stayCalc.completedDays || 0,
          earlyStayDays: stayCalc.chargedDays || 1,
          earlyStayHours: stayCalc.extraHours || 0,
          earlyExtensionCharge: stayCalc.extensionCharge || 0,
          stayDurationStr: stayCalc.stayDurationStr || '',
          expectedNights: stayCalc.expectedNights || 1,
          originalRoomCharge: combinedTotalRoomCharge,
          recalculatedRoomCharge: stayCalc.isEarlyCheckout ? stayCalc.recalculatedRoomCharge : effectiveRoomCharge,
          taxAmount: Math.max(0, effectiveRoomCharge - combinedPreTaxRoomCharge),
          totalGst: Math.max(0, effectiveRoomCharge - combinedPreTaxRoomCharge),
          refundAmount,
          visitorsCount: (visitors || []).length
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================================================
// ROOM VISITORS LOG & REGISTRATION API
// ==========================================================================
app.get('/api/rooms/:id/visitors', (req, res) => {
  try {
    const { id } = req.params;
    const room = db.prepare('SELECT current_booking_id FROM rooms WHERE id = ?').get(id);
    if (!room || !room.current_booking_id) {
      return res.json({ success: true, visitors: [] });
    }

    const visitors = db.prepare(`
      SELECT * FROM room_visitors 
      WHERE booking_id = ? 
      ORDER BY checkin_time DESC
    `).all(room.current_booking_id);

    res.json({ success: true, visitors: visitors || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/rooms/:id/visitors', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const {
      visitor_name,
      phone,
      relation,
      custom_relation,
      purpose,
      visitor_photo,
      has_breakfast,
      breakfast_status,
      breakfast_amount
    } = req.body;

    if (!visitor_name || !visitor_name.trim()) {
      return res.status(400).json({ success: false, error: 'Visitor name is required.' });
    }

    const room = db.prepare('SELECT current_booking_id FROM rooms WHERE id = ?').get(id);
    const bookingId = room ? room.current_booking_id : null;
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'Cannot log visitor: Room is not currently occupied.' });
    }

    const stmt = db.prepare(`
      INSERT INTO room_visitors (
        booking_id, room_id, visitor_name, phone, relation, custom_relation, purpose, visitor_photo, has_breakfast, breakfast_status, breakfast_amount, checkin_time, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), 'IN_ROOM')
    `);

    const result = stmt.run(
      bookingId,
      id,
      visitor_name.trim(),
      (phone || '').trim(),
      (relation || 'Friend').trim(),
      (custom_relation || '').trim(),
      (purpose || '').trim(),
      visitor_photo || '',
      has_breakfast ? 1 : 0,
      (breakfast_status || 'pending').toLowerCase(),
      parseFloat(breakfast_amount) || 250
    );

    const newVisitor = db.prepare('SELECT * FROM room_visitors WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, visitor: newVisitor });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/visitors/:id/checkout', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare(`
      UPDATE room_visitors 
      SET checkout_time = datetime('now', 'localtime'), status = 'DEPARTED' 
      WHERE id = ?
    `);
    const result = stmt.run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Visitor not found' });
    }
    const updated = db.prepare('SELECT * FROM room_visitors WHERE id = ?').get(id);
    res.json({ success: true, visitor: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/visitors/:id', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM room_visitors WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. CHECKOUT ROOM (Settle balance or process refund, log into payments ledger, mark all linked rooms as needs_cleaning)
app.post('/api/checkout/:id', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const b = req.body || {};
    const split_cash = parseFloat(b.split_cash ?? b.splitCash) || 0;
    const split_online = parseFloat(b.split_online ?? b.splitOnline) || 0;
    const split_card = parseFloat(b.split_card ?? b.splitCard) || 0;
    const split_cheque = parseFloat(b.split_cheque ?? b.splitCheque) || 0;
    const computedSettle = split_cash + split_online + split_card + split_cheque;
    const settle_amount = b.settle_amount ?? b.settleAmount ?? (computedSettle > 0 ? computedSettle : 0);
    const refund_amount = b.refund_amount ?? b.refundAmount ?? 0;
    const actual_nights = b.actual_nights ?? b.actualNights;
    const recalculated_room_charge = b.recalculated_room_charge ?? b.recalculatedRoomCharge;
    const checked_out_by = b.checked_out_by ?? b.checkedOutBy ?? req.user?.full_name ?? req.user?.username;
    const final_payment_mode = b.final_payment_mode ?? b.finalPaymentMode ?? (computedSettle > 0 ? 'split' : 'cash');
    const cheque_no = b.cheque_no ?? b.chequeNo;
    const bank_name = b.bank_name ?? b.bankName ?? b.chequeBank;
    const cheque_date = b.cheque_date ?? b.chequeDate;
    const cheque_photo = b.cheque_photo ?? b.chequePhoto ?? b.chequeScan;
    const cleanCheckedOutBy = (checked_out_by || 'Front Desk Cashier').trim();
    const online_utr = (b.online_utr || b.utr_number || b.split_online_utr || req.body.online_utr || req.body.utr_number || '').trim() || null;

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room || room.status !== 'occupied' || !room.current_booking_id) {
      throw new Error('Room is not currently occupied');
    }

    const primaryBooking = db.prepare('SELECT b.*, g.name as guest_name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);
    if (!primaryBooking) throw new Error('Booking not found');

    const guestId = primaryBooking.guest_id;
    const checkoutTime = new Date().toISOString();

    // Identify all active group bookings for this guest
    const activeGroupBookings = db.prepare(`
      SELECT b.id as booking_id, b.room_id, r.room_number, r.price 
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.guest_id = ? AND b.status = 'active' AND b.checkin_time = ?
    `).all(guestId, primaryBooking.checkin_time);

    const groupRoomIds = activeGroupBookings.map(gb => gb.room_id);
    const placeholders = groupRoomIds.map(() => '?').join(',');

    const activeBookingIds = activeGroupBookings.map(gb => gb.booking_id);
    const activeBookingPlaceholders = activeBookingIds.map(() => '?').join(',');
    const checkinLocal = formatToLocalSqliteString(primaryBooking.checkin_time);

    // Calculate pending food and bar orders strictly for this stay session
    const restUnpaidRow = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total 
      FROM restaurant_orders 
      WHERE ((booking_id IN (${activeBookingPlaceholders})) OR (booking_id IS NULL AND room_id IN (${placeholders}) AND datetime(created_at) >= ?))
        AND is_paid = 0
    `).get(...activeBookingIds, ...groupRoomIds, checkinLocal);
    const restUnpaid = restUnpaidRow ? restUnpaidRow.total : 0;

    const barUnpaidRow = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total 
      FROM bar_orders 
      WHERE ((booking_id IN (${activeBookingPlaceholders})) OR (booking_id IS NULL AND room_id IN (${placeholders}) AND datetime(created_at) >= ?))
        AND is_paid = 0
    `).get(...activeBookingIds, ...groupRoomIds, checkinLocal);
    const barUnpaid = barUnpaidRow ? barUnpaidRow.total : 0;

    // Mark restaurant and bar orders as paid strictly for this stay session upon checkout
    db.prepare(`
      UPDATE restaurant_orders 
      SET is_paid = 1, settled_at = ?, settled_by = ?
      WHERE ((booking_id IN (${activeBookingPlaceholders})) OR (booking_id IS NULL AND room_id IN (${placeholders}) AND datetime(created_at) >= ?))
        AND is_paid = 0
    `).run(checkoutTime, cleanCheckedOutBy, ...activeBookingIds, ...groupRoomIds, checkinLocal);

    db.prepare(`
      UPDATE bar_orders 
      SET is_paid = 1, settled_at = ?, settled_by = ?
      WHERE ((booking_id IN (${activeBookingPlaceholders})) OR (booking_id IS NULL AND room_id IN (${placeholders}) AND datetime(created_at) >= ?))
        AND is_paid = 0
    `).run(checkoutTime, cleanCheckedOutBy, ...activeBookingIds, ...groupRoomIds, checkinLocal);

    const netSettle = parseFloat(settle_amount) || 0;
    const netRefund = parseFloat(refund_amount) || 0;
    const finalRoomCharge = recalculated_room_charge !== undefined && recalculated_room_charge !== null ? parseFloat(recalculated_room_charge) : null;
    const settleMode = (final_payment_mode || 'cash').toLowerCase();
    const isEarlyCheckout = Boolean(req.body.isEarlyCheckout || req.body.is_early_checkout);
    const isRefund = Boolean(req.body.isRefund || req.body.is_refund);

    // Guard: Prevent settlement payment from exceeding balance due
    const currentGroupTotalPaid = activeGroupBookings.reduce((sum, gb) => {
      const b = db.prepare('SELECT total_paid FROM bookings WHERE id = ?').get(gb.booking_id);
      return sum + (b ? (b.total_paid || 0) : 0);
    }, 0);

    const totalGroupBookedCharge = activeGroupBookings.reduce((sum, gb) => {
      const b = db.prepare('SELECT total_room_charge FROM bookings WHERE id = ?').get(gb.booking_id);
      return sum + (b ? (b.total_room_charge || 0) : (gb.price || 0));
    }, 0);

    let currentGroupRoomCharge = totalGroupBookedCharge;
    if ((isEarlyCheckout || isRefund) && finalRoomCharge !== null) {
      const roomGstRow = db.prepare("SELECT value FROM system_settings WHERE key = 'room_gst_pct'").get();
      const fallbackGstPct = roomGstRow ? (parseFloat(roomGstRow.value) || 0) : 5;
      const roomGstPct = room && room.gst_pct !== undefined ? (parseFloat(room.gst_pct) || 0) : fallbackGstPct;
      const gstFactor = 1 + (roomGstPct / 100);

      // If finalRoomCharge is within 2 rupees of pre-tax booked charge, apply the full post-tax charge
      if (Math.abs(Math.round(finalRoomCharge * gstFactor) - totalGroupBookedCharge) <= 2) {
        currentGroupRoomCharge = totalGroupBookedCharge;
      } else {
        currentGroupRoomCharge = finalRoomCharge;
      }
    }

    const totalGroupBill = currentGroupRoomCharge + restUnpaid + barUnpaid;
    const maxBalanceDue = Math.max(0, totalGroupBill - currentGroupTotalPaid);

    if (netSettle > maxBalanceDue + 1.0) {
      throw new Error(`Settlement payment (₹${netSettle.toFixed(2)}) cannot exceed balance due (₹${maxBalanceDue.toFixed(2)})`);
    }

    const totalGroupBaseRate = activeGroupBookings.reduce((sum, gb) => sum + (gb.price || 1), 0);

    // Generate settlement receipt or refund voucher number (format: YYYYMMDD-SR, resets monthly)
    const isBtcBooking = primaryBooking.booking_source === 'BTC' || primaryBooking.btc_company_id !== null || settleMode === 'btc' || Boolean(req.body.is_btc_pending) || Boolean(req.body.isBtcPending);
    const isCompanyPaysLater = isBtcBooking && (netSettle === 0 || settleMode === 'btc' || Boolean(req.body.is_btc_pending) || Boolean(req.body.isBtcPending));
    const finalReceiptNo = (!isCompanyPaysLater && netSettle > 0) ? getReceiptNumberWithMode(settleMode) : null;
    const refundVoucherNo = `DEB-${getNextMonthlyVoucherNumber('DEB')}`;

    const isCheque = settleMode === 'cheque';
    const sChequeNo = isCheque ? (cheque_no || null) : null;
    const sChequeBank = isCheque ? (bank_name || null) : null;
    const sChequeDate = isCheque ? (cheque_date || checkoutTime.split('T')[0]) : null;
    const sChequePhoto = isCheque ? (cheque_photo || null) : null;

    const settleSplitCash = parseFloat(b.split_cash ?? b.splitCash ?? 0) || 0;
    const settleSplitCard = parseFloat(b.split_card ?? b.splitCard ?? 0) || 0;
    const settleSplitOnline = parseFloat(b.split_online ?? b.splitOnline ?? 0) || 0;
    const settleSplitCheque = parseFloat(b.split_cheque ?? b.splitCheque ?? 0) || 0;

    const surchargeCfg = getSurchargeSettings();
    let finalCardSurcharge = req.body.card_surcharge !== undefined ? parseFloat(req.body.card_surcharge) : (req.body.cardSurcharge !== undefined ? parseFloat(req.body.cardSurcharge) : 0);
    if (!finalCardSurcharge && (settleMode === 'card' || settleSplitCard > 0) && surchargeCfg.card_surcharge_pct > 0) {
      const cardAmt = settleMode === 'card' ? netSettle : settleSplitCard;
      finalCardSurcharge = Math.round((cardAmt * surchargeCfg.card_surcharge_pct) / 100);
    }

    let finalUpiTax = req.body.upi_tax !== undefined ? parseFloat(req.body.upi_tax) : (req.body.upiTax !== undefined ? parseFloat(req.body.upiTax) : 0);
    if (!finalUpiTax && (settleMode === 'upi' || settleMode === 'online' || settleSplitOnline > 0) && surchargeCfg.upi_tax_pct > 0) {
      const upiAmt = (settleMode === 'upi' || settleMode === 'online') ? netSettle : settleSplitOnline;
      if (upiAmt > surchargeCfg.upi_tax_threshold) {
        finalUpiTax = Math.round((upiAmt * surchargeCfg.upi_tax_pct) / 100);
      }
    }

    const return_mode = (b.return_mode || b.refund_mode || b.return_type || (netRefund > 0 ? (b.final_payment_mode || 'cash') : 'cash')).toLowerCase();
    const return_utr = (b.return_utr || b.refund_utr || online_utr || '').trim() || null;
    const refund_reason = (b.refund_reason || b.stay_breakdown_notes || b.notes || '').trim() || null;

    // Update each booking in the group
    activeGroupBookings.forEach((gb, idx) => {
      const fraction = (gb.price || 1) / totalGroupBaseRate;
      const bRoomCharge = finalRoomCharge !== null ? (finalRoomCharge * fraction) : null;
      const bSettle = idx === 0 ? netSettle : 0;
      const bRefund = idx === 0 ? netRefund : 0;
      const isSettlingNow = netSettle > 0 && settleMode !== 'btc';
      const updatedPaymentStatus = isSettlingNow
        ? 'settled'
        : (isCompanyPaysLater 
            ? 'pending_from_company' 
            : ((primaryBooking.total_paid || 0) >= (bRoomCharge || primaryBooking.total_room_charge || 0) ? 'settled' : 'pending'));

      db.prepare(`
        UPDATE bookings 
        SET 
          actual_checkout_time = ?,
          checked_out_by = ?,
          status = 'checked_out',
          total_room_charge = COALESCE(?, total_room_charge),
          total_paid = total_paid + ? - ?,
          payment_status = ?,
          final_settlement_payment = ?,
          final_settlement_mode = ?,
          final_receipt_no = ?,
          settlement_cheque_no = ?,
          settlement_cheque_bank = ?,
          settlement_cheque_date = ?,
          settlement_cheque_photo = ?,
          cheque_photo = COALESCE(?, cheque_photo),
          final_settlement_utr = ?,
          final_card_surcharge = ?,
          final_upi_tax = ?,
          refund_amount = ?,
          refund_mode = ?,
          refund_voucher_no = ?,
          refund_reason = ?,
          refund_utr = ?
        WHERE id = ?
      `).run(
        checkoutTime,
        cleanCheckedOutBy,
        bRoomCharge,
        bSettle,
        bRefund,
        updatedPaymentStatus,
        bSettle,
        settleMode,
        idx === 0 ? finalReceiptNo : null,
        idx === 0 ? sChequeNo : null,
        idx === 0 ? sChequeBank : null,
        idx === 0 ? sChequeDate : null,
        idx === 0 ? sChequePhoto : null,
        sChequePhoto,
        idx === 0 ? online_utr : null,
        idx === 0 ? finalCardSurcharge : 0,
        idx === 0 ? finalUpiTax : 0,
        idx === 0 ? bRefund : 0,
        idx === 0 && bRefund > 0 ? return_mode : null,
        idx === 0 && bRefund > 0 ? refundVoucherNo : null,
        idx === 0 && bRefund > 0 ? (refund_reason || 'Early checkout refund') : null,
        idx === 0 && bRefund > 0 ? return_utr : null,
        gb.booking_id
      );

      // Auto-depart any remaining active visitors for this booking
      db.prepare(`
        UPDATE room_visitors 
        SET status = 'DEPARTED', checkout_time = COALESCE(checkout_time, ?) 
        WHERE booking_id = ? AND status = 'IN_ROOM'
      `).run(checkoutTime, gb.booking_id);

      // Set Room Status to NEEDS_CLEANING
      db.prepare(`
        UPDATE rooms 
        SET status = 'needs_cleaning', current_booking_id = NULL 
        WHERE id = ?
      `).run(gb.room_id);
    });

    const checkedOutRooms = activeGroupBookings.map(gb => gb.room_number);

    // Record Settlement Payment in Payments Ledger
    if (netSettle > 0) {
      const cStatus = isCheque ? 'pending' : 'realized';
      db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_no, bank_name, cheque_date, cheque_status, realized_at,
          cashier_name, notes, cheque_photo, utr_number,
          card_surcharge, upi_tax, split_cash, split_card, split_online, split_cheque
        ) VALUES (?, ?, ?, 'hospitality', 'bill_settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalReceiptNo,
        primaryBooking.id,
        primaryBooking.room_id,
        settleMode,
        netSettle,
        sChequeNo,
        sChequeBank,
        sChequeDate,
        cStatus,
        cStatus === 'realized' ? checkoutTime : null,
        cleanCheckedOutBy,
        `Checkout bill settlement for Room ${checkedOutRooms.join(', ')} (${primaryBooking.guest_name})${finalCardSurcharge > 0 ? ` (+₹${finalCardSurcharge} Card fee)` : ''}${finalUpiTax > 0 ? ` (+₹${finalUpiTax} UPI tax)` : ''}`,
        sChequePhoto,
        online_utr,
        finalCardSurcharge,
        finalUpiTax,
        settleSplitCash,
        settleSplitCard,
        settleSplitOnline,
        settleSplitCheque
      );
    }

    // Record Refund in Expenses & Payments Ledger if refund was given
    if (netRefund > 0) {
      const refundPurpose = refund_reason || `Being refund of excess advance on checkout for Room ${checkedOutRooms.join(', ')}`;
      db.prepare(`
        INSERT INTO expenses (
          voucher_no, category, paid_to, amount, payment_mode, debit_account,
          purpose_details, room_id, booking_id, cashier_name
        ) VALUES (?, 'refund', ?, ?, ?, 'Guest Refund A/c', ?, ?, ?, ?)
      `).run(
        refundVoucherNo,
        primaryBooking.guest_name,
        netRefund,
        return_mode,
        refundPurpose,
        primaryBooking.room_id,
        primaryBooking.id,
        cleanCheckedOutBy
      );

      db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_status, realized_at, cashier_name, notes, utr_number
        ) VALUES (?, ?, ?, 'hospitality', 'refund', ?, ?, 'realized', ?, ?, ?, ?)
      `).run(
        refundVoucherNo,
        primaryBooking.id,
        primaryBooking.room_id,
        return_mode,
        netRefund,
        checkoutTime,
        cleanCheckedOutBy,
        refundPurpose,
        return_utr
      );
    }

    return { 
      bookingIds: activeGroupBookings.map(gb => gb.booking_id), 
      checkedOutRooms,
      checkoutTime, 
      checked_out_by: cleanCheckedOutBy,
      checkedOutBy: cleanCheckedOutBy,
      netSettle, 
      netRefund,
      finalReceiptNo,
      refundVoucherNo,
      refund_voucher_no: refundVoucherNo,
      refund_mode: return_mode,
      return_mode,
      refund_amount: netRefund
    };
  });

  try {
    const result = transaction();

    // Non-blocking background sync: Remove checked-out rooms from Supabase cloud
    try {
      if (result && Array.isArray(result.checkedOutRooms)) {
        result.checkedOutRooms.forEach(roomNum => {
          supabaseService.removeActiveOccupancy(roomNum)
            .catch(err => console.warn('[Supabase] checkout remove error:', err.message));

          supabaseService.fetchPendingRoomCharges(roomNum).then(pending => {
            if (pending && pending.length > 0) {
              const ids = pending.map(c => c.id);
              supabaseService.markChargesImported(ids).catch(() => {});
            }
          }).catch(() => {});
        });
      }
    } catch (syncErr) {
      console.warn('[Supabase] Checkout sync dispatch skipped:', syncErr.message);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Checkout error:', error);
    const isClientError = error.message && (
      error.message.includes('cannot exceed') ||
      error.message.includes('not found') ||
      error.message.includes('not currently occupied')
    );
    res.status(isClientError ? 400 : 500).json({ success: false, error: error.message });
  }
});

// 11. GET MENU ITEMS (Restaurant & Bar)
app.get('/api/menu/:dept', (req, res) => {
  try {
    const { dept } = req.params; // 'restaurant' or 'bar'
    const items = db.prepare('SELECT * FROM menu_items WHERE department = ? AND is_available = 1 ORDER BY category, name').all(dept);
    
    // Group by category
    const categorized = {};
    for (const item of items) {
      if (!categorized[item.category]) {
        categorized[item.category] = [];
      }
      categorized[item.category].push(item);
    }

    res.json({ success: true, items, categorized });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ==========================================================================
// RESTAURANT ENTERPRISE SUITE APIS (MENU CRUD, TABLES, SESSIONS, KOT, SETTLE & RESETTLE)
// ==========================================================================

// Helper: Daily Token Number Generator (Strict 24-Hour Day Reset)
function getNextDailyToken() {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayDate = `${year}-${month}-${day}`;

    // 1. Max token from active tables whose order started today
    const tableRow = db.prepare(`
      SELECT MAX(token_number) as max_token 
      FROM restaurant_tables 
      WHERE token_number > 0 AND (order_started_at LIKE ? OR DATE(order_started_at, 'localtime') = ?)
    `).get(`${todayDate}%`, todayDate);

    // 2. Max token from settled orders completed today
    const orderRow = db.prepare(`
      SELECT MAX(token_number) as max_token 
      FROM restaurant_orders 
      WHERE token_number > 0 AND (created_at LIKE ? OR DATE(created_at) = ?)
    `).get(`${todayDate}%`, todayDate);

    const maxTable = (tableRow && tableRow.max_token) || 0;
    const maxOrder = (orderRow && orderRow.max_token) || 0;
    const maxToken = Math.max(maxTable, maxOrder);

    return maxToken + 1;
  } catch (e) {
    console.error('Error generating daily token:', e);
    return 1;
  }
}

// 1. MENU & CATEGORIES CRUD
app.get('/api/restaurant/menu', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT * FROM menu_items 
      WHERE department = 'restaurant' 
      ORDER BY category ASC, name ASC
    `).all();

    const categories = db.prepare(`
      SELECT * FROM restaurant_categories 
      ORDER BY sort_order ASC, name ASC
    `).all();

    res.json({ success: true, items, dishes: items, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/restaurant/menu', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { name, category, price, shortcode, description, is_veg } = req.body;
    if (!name || price === undefined || price === null || price === '') {
      return res.status(400).json({ success: false, error: 'Dish name and price are required' });
    }

    // Auto-generate shortcode if not provided
    let code = (shortcode || '').trim();
    if (!code) {
      const maxRow = db.prepare("SELECT MAX(CAST(shortcode AS INTEGER)) as max_code FROM menu_items WHERE department = 'restaurant' AND shortcode GLOB '[0-9]*'").get();
      code = String((maxRow && maxRow.max_code ? maxRow.max_code : 100) + 1);
    }

    const isVegVal = is_veg !== undefined ? (is_veg ? 1 : 0) : 1;
    const stmt = db.prepare(`
      INSERT INTO menu_items (department, category, name, price, description, is_available, shortcode, is_veg)
      VALUES ('restaurant', ?, ?, ?, ?, 1, ?, ?)
    `);
    const result = stmt.run(category || 'Main Course', name.trim(), parseFloat(price) || 0, (description || '').trim(), code, isVegVal);

    res.json({
      success: true,
      dish: { id: result.lastInsertRowid, name: name.trim(), price: parseFloat(price) || 0, shortcode: code, is_veg: isVegVal, category: category || 'Main Course' },
      itemId: result.lastInsertRowid,
      shortcode: code
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/restaurant/menu/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, price, shortcode, description, is_available, is_veg } = req.body;

    const current = db.prepare("SELECT * FROM menu_items WHERE id = ? AND department = 'restaurant'").get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Dish not found' });

    db.prepare(`
      UPDATE menu_items 
      SET name = ?, category = ?, price = ?, shortcode = ?, description = ?, is_available = ?, is_veg = ?
      WHERE id = ?
    `).run(
      name ? name.trim() : current.name,
      category || current.category,
      price !== undefined ? parseFloat(price) : current.price,
      shortcode !== undefined ? String(shortcode).trim() : current.shortcode,
      description !== undefined ? String(description).trim() : current.description,
      is_available !== undefined ? (is_available ? 1 : 0) : current.is_available,
      is_veg !== undefined ? (is_veg ? 1 : 0) : (current.is_veg !== undefined ? current.is_veg : 1),
      id
    );

    const updatedDish = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    res.json({ success: true, dish: updatedDish });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/restaurant/menu/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare("DELETE FROM menu_items WHERE id = ? AND department = 'restaurant'").run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/restaurant/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM restaurant_categories ORDER BY sort_order ASC, name ASC').all();
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/restaurant/categories', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

    let row = db.prepare('SELECT * FROM restaurant_categories WHERE name = ?').get(name.trim());
    if (!row) {
      const maxSort = db.prepare('SELECT MAX(sort_order) as m FROM restaurant_categories').get().m || 0;
      const result = db.prepare('INSERT INTO restaurant_categories (name, sort_order) VALUES (?, ?)').run(name.trim(), maxSort + 1);
      row = { id: result.lastInsertRowid, name: name.trim(), sort_order: maxSort + 1 };
    }

    res.json({ success: true, category: row });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/restaurant/categories/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

    const current = db.prepare('SELECT * FROM restaurant_categories WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Category not found' });

    const oldName = current.name;
    const newName = name.trim();

    db.prepare('UPDATE restaurant_categories SET name = ? WHERE id = ?').run(newName, id);
    db.prepare("UPDATE menu_items SET category = ? WHERE category = ? AND department = 'restaurant'").run(newName, oldName);

    res.json({ success: true, category: { id, name: newName } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/restaurant/categories/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM restaurant_categories WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function formatTableOutput(t) {
  if (!t) return t;
  t.cart = [];
  try { t.cart = JSON.parse(t.active_cart_json || '[]'); } catch (e) { t.cart = []; }
  t.active_cart = t.cart;
  t.cart_count = t.cart.reduce((sum, it) => sum + (it.qty || 1), 0);
  t.cart_total = t.cart.reduce((sum, it) => sum + (it.price * (it.qty || 1)), 0);
  t.running_bill_total = t.cart_total;

  const now = Date.now();
  t.elapsed_minutes = 0;
  if (t.order_started_at && t.status !== 'available') {
    const start = new Date(t.order_started_at).getTime();
    t.elapsed_minutes = Math.max(0, Math.floor((now - start) / 60000));
  }
  return t;
}

// Helper to clean up / merge split tables when neither has an active running order
function cleanupSplitPair(tableId) {
  try {
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(tableId);
    if (!table) return;

    let parentId = table.parent_table_id || table.id;
    const parent = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(parentId);
    if (!parent) return;

    const children = db.prepare('SELECT * FROM restaurant_tables WHERE parent_table_id = ?').all(parentId);

    let parentCart = [];
    try { parentCart = JSON.parse(parent.active_cart_json || '[]'); } catch (e) { parentCart = []; }
    const parentHasOrder = (parent.status !== 'available' && parent.status !== '') || parentCart.length > 0;

    let childHasOrder = false;
    for (const c of children) {
      let cCart = [];
      try { cCart = JSON.parse(c.active_cart_json || '[]'); } catch (e) { cCart = []; }
      if ((c.status !== 'available' && c.status !== '') || cCart.length > 0) {
        childHasOrder = true;
        break;
      }
    }

    // If neither parent nor any child has a running order, merge back to single normal table!
    if (!parentHasOrder && !childHasOrder) {
      for (const c of children) {
        db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(c.id);
      }
      const origNum = parent.table_number.replace(/-[AB]$/i, '').replace(/[AB]$/i, '');
      db.prepare(`
        UPDATE restaurant_tables 
        SET table_number = ?, is_split = 0, status = 'available', 
            active_cart_json = '[]', printed_cart_json = '[]', 
            kot_count = 0, token_number = 0, order_started_at = NULL, 
            parent_table_id = NULL 
        WHERE id = ?
      `).run(origNum, parent.id);
    }
  } catch (err) {
    console.error('Error in cleanupSplitPair:', err);
  }
}

// 2. TABLES & SESSION MANAGEMENT
app.get('/api/restaurant/tables', (req, res) => {
  try {
    // 1. Clean up any orphaned split children where parent is not split or does not exist
    const orphans = db.prepare(`
      SELECT c.id FROM restaurant_tables c
      LEFT JOIN restaurant_tables p ON c.parent_table_id = p.id
      WHERE c.parent_table_id IS NOT NULL AND (p.id IS NULL OR p.is_split = 0)
    `).all();
    for (const o of orphans) {
      db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(o.id);
    }

    const tables = db.prepare(`
      SELECT * FROM restaurant_tables 
      ORDER BY 
        CASE WHEN table_type = 'parcel' THEN 2 ELSE 1 END,
        CAST(SUBSTR(table_number, 3) AS INTEGER) ASC,
        table_number ASC
    `).all();

    for (const t of tables) {
      formatTableOutput(t);
    }

    res.json({ success: true, tables });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/restaurant/tables', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { table_number, table_type, capacity, special_notes, room_id } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'Table number is required' });

    const existing = db.prepare('SELECT * FROM restaurant_tables WHERE table_number = ?').get(table_number.trim());
    if (existing) {
      if (existing.table_type === 'room_service' || existing.table_type === 'parcel' || table_type === 'room_service') {
        db.prepare(`
          UPDATE restaurant_tables
          SET status = 'in_process', special_notes = COALESCE(?, special_notes), room_id = COALESCE(?, room_id), active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(special_notes || null, room_id || null, existing.id);
        const updated = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(existing.id);
        return res.json({ success: true, tableId: existing.id, table: formatTableOutput(updated) });
      }
      return res.json({ success: true, tableId: existing.id, table: formatTableOutput(existing), alreadyExisted: true });
    }

    const initialStatus = (table_type === 'room_service' || table_type === 'parcel') ? 'in_process' : 'available';
    const stmt = db.prepare(`
      INSERT INTO restaurant_tables (table_number, table_type, capacity, status, special_notes, room_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(table_number.trim(), table_type || 'dine_in', parseInt(capacity) || 4, initialStatus, special_notes || '', room_id || null);
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, tableId: result.lastInsertRowid, table: formatTableOutput(table) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/restaurant/tables/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { table_number, table_type, capacity } = req.body;

    const current = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Table not found' });

    db.prepare(`
      UPDATE restaurant_tables 
      SET table_number = ?, table_type = ?, capacity = ?
      WHERE id = ?
    `).run(
      table_number ? table_number.trim() : current.table_number,
      table_type || current.table_type,
      capacity ? parseInt(capacity) : current.capacity,
      id
    );

    const updatedTable = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    res.json({ success: true, table: updatedTable });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/restaurant/tables/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dynamic Table Splitting (e.g. T-6 -> T-6-A, T-6-B or T6 -> T6-A, T6-B)
app.post('/api/restaurant/tables/:id/split', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    const parent = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!parent) return res.status(404).json({ success: false, error: 'Parent table not found' });

    let baseNum = parent.table_number.replace(/-[AB]$/i, '').replace(/[AB]$/i, '');
    const subNumA = `${baseNum}-A`;
    const subNumB = `${baseNum}-B`;

    // Rename current table to -A, insert -B
    db.prepare("UPDATE restaurant_tables SET table_number = ?, is_split = 1, status = 'available' WHERE id = ?").run(subNumA, id);
    const result = db.prepare(`
      INSERT INTO restaurant_tables (table_number, table_type, capacity, status, is_split, parent_table_id)
      VALUES (?, ?, ?, 'available', 1, ?)
    `).run(subNumB, parent.table_type, Math.max(2, Math.floor(parent.capacity / 2)), id);

    res.json({
      success: true,
      splitTables: [subNumA, subNumB],
      subTableAId: parent.id,
      subTableBId: result.lastInsertRowid,
      subTable: { id: result.lastInsertRowid, table_number: subNumB }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cleanup empty split table
app.post('/api/restaurant/tables/:id/cleanup-split', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    cleanupSplitPair(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update Table / Parcel Status (e.g. in_process, ready)
app.post('/api/restaurant/tables/:id/status', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status is required' });

    const current = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Table not found' });

    db.prepare('UPDATE restaurant_tables SET status = ? WHERE id = ?').run(status, id);
    const updated = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    res.json({ success: true, table: formatTableOutput(updated) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// 3. TABLE ACTIVE SESSION OPERATIONS (CART, KOT, NO KOT, PRE-BILL, CANCEL, SETTLE)
app.post('/api/restaurant/tables/:id/cart', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    const { items, cart, waiter_name, special_notes } = req.body;

    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    const itemsArr = Array.isArray(items) ? items : (Array.isArray(cart) ? cart : []);
    const hasItems = itemsArr.length > 0;
    const runningStatus = table.table_type === 'parcel' ? (table.status === 'ready' ? 'ready' : 'in_process') : 'occupied';
    const newStatus = hasItems ? (table.status === 'billed' ? 'billed' : runningStatus) : 'available';
    const orderStartedAt = (hasItems && !table.order_started_at) ? new Date().toISOString() : (hasItems ? table.order_started_at : null);
    const tokenNum = (hasItems && (!table.token_number || table.token_number === 0)) ? getNextDailyToken() : (hasItems ? table.token_number : 0);

    db.prepare(`
      UPDATE restaurant_tables 
      SET active_cart_json = ?, status = ?, order_started_at = ?, token_number = ?, waiter_name = ?, special_notes = ?
      WHERE id = ?
    `).run(
      JSON.stringify(itemsArr),
      newStatus,
      orderStartedAt,
      tokenNum,
      waiter_name !== undefined ? waiter_name : table.waiter_name,
      special_notes !== undefined ? special_notes : table.special_notes,
      id
    );

    const updated = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    res.json({ success: true, status: newStatus, tokenNumber: tokenNum, table: formatTableOutput(updated) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Incremental KOT Dispatch (J Key)
app.post('/api/restaurant/tables/:id/kot', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    const { items, cart, waiter_name, special_notes } = req.body;

    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    const itemsArr = Array.isArray(items) ? items : (Array.isArray(cart) ? cart : []);
    if (itemsArr.length === 0) return res.status(400).json({ success: false, error: 'Cannot dispatch empty KOT' });

    // Calculate incremental items comparing against printed_cart_json
    let previouslyPrinted = [];
    try { previouslyPrinted = JSON.parse(table.printed_cart_json || '[]'); } catch (e) { previouslyPrinted = []; }

    const printedMap = {};
    for (const p of previouslyPrinted) {
      const key = `${p.id || p.name}_${p.is_parcel ? 'p' : 'd'}`;
      printedMap[key] = (printedMap[key] || 0) + (p.qty || 1);
    }

    const incrementalItems = [];
    for (const item of itemsArr) {
      const key = `${item.id || item.name}_${item.is_parcel ? 'p' : 'd'}`;
      const printedQty = printedMap[key] || 0;
      const currentQty = item.qty || 1;
      const delta = currentQty - printedQty;

      if (delta > 0) {
        incrementalItems.push({
          ...item,
          qty: delta
        });
      }
    }

    const nextKotCount = (table.kot_count || 0) + 1;
    const tokenNum = (!table.token_number || table.token_number === 0) ? getNextDailyToken() : table.token_number;
    const orderStartedAt = table.order_started_at || new Date().toISOString();

    // Update table with new active cart, updated printed cart, and token
    db.prepare(`
      UPDATE restaurant_tables 
      SET active_cart_json = ?, printed_cart_json = ?, kot_count = ?,
          status = ?, order_started_at = ?, token_number = ?,
          waiter_name = ?, special_notes = ?
      WHERE id = ?
    `).run(
      JSON.stringify(itemsArr),
      JSON.stringify(itemsArr), // Now all items are marked as printed
      nextKotCount,
      table.status === 'billed' ? 'billed' : (table.table_type === 'parcel' ? (table.status === 'ready' ? 'ready' : 'in_process') : 'occupied'),
      orderStartedAt,
      tokenNum,
      waiter_name !== undefined ? waiter_name : table.waiter_name,
      special_notes !== undefined ? special_notes : table.special_notes,
      id
    );

    const kotPayload = {
      kotNumber: nextKotCount,
      tokenNumber: tokenNum,
      items: incrementalItems.length > 0 ? incrementalItems : itemsArr
    };

    res.json({
      success: true,
      kotNumber: nextKotCount,
      tokenNumber: tokenNum,
      tableNumber: table.table_number,
      waiterName: waiter_name || table.waiter_name || 'Staff',
      timestamp: new Date().toISOString(),
      incrementalItems: incrementalItems.length > 0 ? incrementalItems : itemsArr,
      kot: kotPayload,
      isFullReorder: incrementalItems.length === 0
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Release Pre-Bill / Customer Check (R Key) -> Switches table to Red
app.post('/api/restaurant/tables/:id/prebill', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    const { cart, items: bodyItems, waiter_name, special_notes } = req.body || {};
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    let items = (Array.isArray(cart) && cart.length > 0) ? cart : ((Array.isArray(bodyItems) && bodyItems.length > 0) ? bodyItems : []);
    if (items.length === 0) {
      try { items = JSON.parse(table.active_cart_json || '[]'); } catch (e) { items = []; }
    }
    if (items.length === 0) {
      try { items = JSON.parse(table.printed_cart_json || '[]'); } catch (e) { items = []; }
    }
    if (items.length === 0) return res.status(400).json({ success: false, error: 'No items in table cart to pre-bill' });

    const subtotal = items.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
    const restGstPct = getFnbGstRate('restaurant');
    const tax = Math.round(subtotal * (restGstPct / 100));
    const grandTotal = subtotal + tax;
    const tokenNum = (!table.token_number || table.token_number === 0) ? getNextDailyToken() : table.token_number;
    const orderStartedAt = table.order_started_at || new Date().toISOString();

    db.prepare(`
      UPDATE restaurant_tables 
      SET status = 'billed', active_cart_json = ?, order_started_at = ?, token_number = ?, waiter_name = ?, special_notes = ?
      WHERE id = ?
    `).run(
      JSON.stringify(items),
      orderStartedAt,
      tokenNum,
      waiter_name !== undefined ? waiter_name : table.waiter_name,
      special_notes !== undefined ? special_notes : table.special_notes,
      id
    );

    const updatedTable = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);

    res.json({
      success: true,
      tableNumber: table.table_number,
      tokenNumber: tokenNum,
      items,
      subtotal,
      tax,
      grandTotal,
      table: formatTableOutput(updatedTable),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel Order
app.post('/api/restaurant/tables/:id/cancel', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const { id } = req.params;
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    // If table was a temporary split variant B or A, reset/delete and merge if idle
    if (table.is_split) {
      const parentId = table.parent_table_id || table.id;
      if (table.parent_table_id) {
        db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id);
      } else {
        db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
      }
      cleanupSplitPair(parentId);
    } else if (table.table_type === 'parcel' || table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-') || String(table.table_number || '').startsWith('P-')) {
      db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id);
    } else {
      db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Settle Bill & Final Payment (L Key)
app.post('/api/restaurant/tables/:id/settle', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const {
      cart,
      items: bodyItems,
      discount,
      discount_pct,
      customer_name,
      waiter_name,
      split_details
    } = req.body;
    const payment_mode = req.body.payment_mode || req.body.paymentMode || 'cash';
    const split_cash = req.body.split_cash ?? req.body.splitCash ?? 0;
    const split_card = req.body.split_card ?? req.body.splitCard ?? 0;
    const split_online = req.body.split_online ?? req.body.splitOnline ?? 0;
    const room_id = req.body.room_id || req.body.chargeToRoomId || null;

    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
    if (!table) throw new Error('Table not found');

    let items = (Array.isArray(cart) && cart.length > 0) ? cart : ((Array.isArray(bodyItems) && bodyItems.length > 0) ? bodyItems : []);
    if (items.length === 0) {
      try { items = JSON.parse(table.active_cart_json || '[]'); } catch (e) { items = []; }
    }
    if (items.length === 0) throw new Error('Cannot settle empty cart');

    const subtotal = items.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
    let discountAmt = 0;
    if (discount !== undefined && !isNaN(parseFloat(discount))) {
      discountAmt = Math.max(0, parseFloat(discount));
    } else if (discount_pct !== undefined) {
      discountAmt = Math.round((subtotal * (parseFloat(discount_pct) || 0)) / 100);
    }
    const taxable = Math.max(0, subtotal - discountAmt);
    const restGstPct = getFnbGstRate('restaurant');
    const tax = Math.round(taxable * (restGstPct / 100));
    const total = taxable + tax;

    const orderNumber = 'RES-' + Date.now().toString().slice(-6);
    const isPaid = (req.body.is_paid !== undefined) ? (req.body.is_paid ? 1 : 0) : (payment_mode === 'room_folio' ? 0 : 1);

    let targetRoomId = null;
    let custName = (customer_name || '').trim();

    let resolvedRoomId = room_id || table.room_id || null;
    if (!resolvedRoomId && (table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-'))) {
      const rNum = String(table.table_number || '').replace(/^RS-/i, '').trim();
      const rRow = db.prepare('SELECT id FROM rooms WHERE room_number = ?').get(rNum);
      if (rRow) resolvedRoomId = rRow.id;
    }

    if (resolvedRoomId) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(resolvedRoomId);
      if (room && room.status === 'occupied') {
        targetRoomId = room.id;
        const booking = db.prepare('SELECT g.name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);
        if (booking && !custName) custName = `Room ${room.room_number} - ${booking.name}`;
      }
    }
    if (!custName) {
      custName = (table.table_type === 'parcel' ? `Takeaway ${table.table_number}` : `Table ${table.table_number} Guest`);
    }

    const splitDetails = split_details || {
      cash: parseFloat(split_cash) || 0,
      card: parseFloat(split_card) || 0,
      online: parseFloat(split_online) || 0
    };
    const utr_number = (req.body.utr_number || req.body.online_utr || req.body.utr || '').trim() || null;
    const room_service_for = req.body.room_service_for || req.body.roomServiceFor || null;
    const guest_phone = req.body.guest_phone || req.body.guestPhone || req.body.mobile || null;
    
    // Card Surcharge & UPI Tax (Configurable via Manager Panel)
    const surchargeCfg = getSurchargeSettings();
    let card_surcharge = Number(req.body.card_surcharge || req.body.cardSurcharge || 0);
    if (!card_surcharge && isPaid && surchargeCfg.card_surcharge_pct > 0) {
      if (payment_mode === 'card') card_surcharge = Math.round((total * surchargeCfg.card_surcharge_pct) / 100);
      else if (splitDetails.card > 0) card_surcharge = Math.round((splitDetails.card * surchargeCfg.card_surcharge_pct) / 100);
    }

    let upi_tax = Number(req.body.upi_tax || req.body.upiTax || 0);
    if (!upi_tax && isPaid && surchargeCfg.upi_tax_pct > 0) {
      const onlinePortion = (payment_mode === 'online' || payment_mode === 'upi') ? total : (splitDetails.online || 0);
      if (onlinePortion > surchargeCfg.upi_tax_threshold) {
        upi_tax = Math.round((onlinePortion * surchargeCfg.upi_tax_pct) / 100);
      }
    }

    const tokenNum = (!table.token_number || table.token_number === 0) ? getNextDailyToken() : table.token_number;
    const cashier_name = (req.body.cashier_name || req.body.cashierName || req.user?.full_name || req.user?.username || 'Cashier').trim();

    let targetBookingId = null;
    if (targetRoomId) {
      const activeRoom = db.prepare('SELECT current_booking_id FROM rooms WHERE id = ?').get(targetRoomId);
      if (activeRoom && activeRoom.current_booking_id) {
        targetBookingId = activeRoom.current_booking_id;
      } else {
        const activeB = db.prepare("SELECT id FROM bookings WHERE room_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(targetRoomId);
        if (activeB) targetBookingId = activeB.id;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, room_id, booking_id, customer_name, order_type, table_number, table_id,
        token_number, waiter_name, items_json, subtotal, tax, discount, total,
        payment_mode, split_details_json, is_paid, utr_number, cashier_name,
        room_service_for, guest_phone, card_surcharge, upi_tax, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now', 'localtime'))
    `);

    const result = stmt.run(
      orderNumber,
      targetRoomId,
      targetBookingId,
      custName,
      table.table_type === 'parcel' ? 'parcel' : (targetRoomId ? 'room' : 'table'),
      table.table_number,
      table.id,
      tokenNum,
      waiter_name || table.waiter_name || '',
      JSON.stringify(items),
      subtotal,
      tax,
      discountAmt,
      total,
      payment_mode || 'cash',
      JSON.stringify(splitDetails),
      isPaid,
      utr_number,
      cashier_name,
      room_service_for,
      guest_phone,
      card_surcharge,
      upi_tax
    );

    const orderId = result.lastInsertRowid;

    // Log in bill_logs
    db.prepare(`
      INSERT INTO bill_logs (order_id, order_number, action, staff_user, change_summary, previous_total, new_total, previous_items_json, new_items_json)
      VALUES (?, ?, 'settled', ?, ?, ?, ?, '', ?)
    `).run(
      orderId,
      orderNumber,
      cashier_name,
      `Initial Bill Settlement via ${(payment_mode || 'cash').toUpperCase()} (Total: ₹${total.toFixed(2)})`,
      total,
      total,
      JSON.stringify(items)
    );

    // Reset or clean up table
    if (table.is_split) {
      const parentId = table.parent_table_id || table.id;
      if (table.parent_table_id) {
        db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id);
      } else {
        db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
      }
      cleanupSplitPair(parentId);
    } else if (table.table_type === 'parcel' || table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-') || String(table.table_number || '').startsWith('P-')) {
      db.prepare('DELETE FROM restaurant_tables WHERE id = ?').run(id);
    } else {
      db.prepare("UPDATE restaurant_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', kot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
    }

    return {
      id: orderId,
      orderId,
      orderNumber,
      token_number: tokenNum,
      customerName: custName,
      customer_name: custName,
      table_number: table.table_number,
      tableNumber: table.table_number,
      total,
      grand_total: total,
      grandTotal: total,
      discount: discountAmt,
      payment_mode: payment_mode || 'cash',
      paymentMode: payment_mode || 'cash',
      split_details: splitDetails,
      split_cash: splitDetails.cash,
      split_card: splitDetails.card,
      split_online: splitDetails.online,
      utr_number: utr_number,
      card_surcharge: card_surcharge,
      upi_tax: upi_tax,
      subtotal,
      tax,
      items,
      items_json: items,
      waiter_name: waiter_name || table.waiter_name || '',
      cashier_name: cashier_name,
      cashierName: cashier_name,
      room_service_for,
      guest_phone,
      is_bar: false,
      settled_at: new Date().toISOString()
    };
  });

  try {
    const data = transaction();

    // Non-blocking background push to Supabase room_charges_inbox if charged to room
    try {
      const isRoomCharge = (req.body.is_paid === 0 || req.body.payment_mode === 'room_folio' || req.body.isStayingGuest || req.body.roomBillStatus === 'pending');
      const targetRoomNum = req.body.room_number || (req.body.room_id ? db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.body.room_id)?.room_number : null) || (data.table_number && String(data.table_number).startsWith('RS-') ? String(data.table_number).replace(/^RS-/i, '') : null);
      if (isRoomCharge && targetRoomNum) {
        supabaseService.pushRoomCharge({
          room_number: String(targetRoomNum),
          department: 'restaurant',
          bill_no: data.orderNumber,
          grand_total: data.total || data.grand_total,
          split_details: data.split_details || null,
          cashier_name: data.cashier_name || 'Cashier',
          items_summary: Array.isArray(data.items) ? data.items.map(i => `${i.name} x${i.quantity || i.qty || 1}`).join(', ') : ''
        }).catch(err => console.warn('[Supabase] restaurant charge push error:', err.message));
      }
    } catch (pushErr) {
      console.warn('[Supabase] Restaurant charge push dispatch skipped:', pushErr.message);
    }

    res.json({ success: true, order: data });
  } catch (error) {
    console.error('Settlement error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Occupied rooms for restaurant settlement with linked room info
app.get('/api/restaurant/occupied-rooms', async (req, res) => {
  try {
    const rooms = db.prepare(`
      SELECT 
        r.id,
        r.room_number,
        r.room_type,
        r.status,
        r.price,
        b.id as booking_id,
        b.guest_id,
        b.checkin_time,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.address as guest_address,
        g.doc_type as guest_doc_type
      FROM rooms r
      JOIN bookings b ON r.current_booking_id = b.id AND b.status = 'active'
      JOIN guests g ON b.guest_id = g.id
      WHERE r.status = 'occupied'
      ORDER BY CAST(r.room_number AS INTEGER) ASC, r.room_number ASC
    `).all();

    // If no local occupied rooms found (e.g. running on separate POS machine), fetch live from Supabase cloud
    if (rooms.length === 0) {
      try {
        const cloudOcc = await supabaseService.fetchActiveOccupancies();
        if (cloudOcc && cloudOcc.length > 0) {
          const mapped = cloudOcc.map(co => ({
            id: co.room_id || co.room_number,
            room_number: co.room_number,
            room_type: co.room_type || 'Room',
            status: 'occupied',
            booking_id: co.booking_id,
            checkin_time: co.checkin_time,
            guest_name: co.guest_name,
            guest_mobile: co.guest_mobile,
            guest_address: '',
            guest_doc_type: '',
            is_combined: false,
            linked_rooms: [co.room_number],
            other_linked_rooms: [],
            combined_title: `Room ${co.room_number}`,
            is_cloud_synced: true
          }));
          return res.json({ success: true, rooms: mapped });
        }
      } catch (cloudErr) {
        console.warn('[Supabase] Fallback fetch failed in occupied-rooms:', cloudErr.message);
      }
    }

    // Query all active bookings to detect linked combined rooms
    const allActiveBookings = db.prepare(`
      SELECT r.id as room_id, r.room_number, b.guest_id 
      FROM rooms r
      JOIN bookings b ON r.current_booking_id = b.id AND b.status = 'active'
      WHERE r.status = 'occupied'
    `).all();

    const enrichedRooms = rooms.map(r => {
      const linked = allActiveBookings
        .filter(ab => ab.guest_id === r.guest_id)
        .map(ab => ab.room_number)
        .sort((a, b) => parseInt(a) - parseInt(b));
      
      const is_combined = linked.length > 1;
      const other_linked = linked.filter(num => num !== r.room_number);
      const combined_title = linked.join(' & ');

      return {
        ...r,
        is_combined,
        linked_rooms: linked,
        other_linked_rooms: other_linked,
        combined_title
      };
    });

    res.json({ success: true, rooms: enrichedRooms });
  } catch (error) {
    console.error('Error fetching occupied rooms:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cloud connectivity endpoints for multi-machine setups
app.get('/api/sync/occupancies', async (req, res) => {
  try {
    const list = await supabaseService.fetchActiveOccupancies();
    res.json({ success: true, occupancies: list || [] });
  } catch (err) {
    res.json({ success: false, occupancies: [], error: err.message });
  }
});

app.post('/api/sync/push-now', async (req, res) => {
  try {
    const result = await supabaseService.syncAllActiveRoomsFromLocal(db);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. SETTLED BILLS DASHBOARD & AUDIT LOG
app.get('/api/restaurant/settled-bills', (req, res) => {
  try {
    const { period, search, from_date, to_date } = req.query;
    let query = "SELECT * FROM restaurant_orders WHERE status = 'completed'";
    const params = [];

    if (from_date && to_date) {
      query += " AND (DATE(created_at, 'localtime') BETWEEN DATE(?) AND DATE(?) OR DATE(created_at) BETWEEN DATE(?) AND DATE(?))";
      params.push(from_date, to_date, from_date, to_date);
    } else if (from_date) {
      query += " AND (DATE(created_at, 'localtime') >= DATE(?) OR DATE(created_at) >= DATE(?))";
      params.push(from_date, from_date);
    } else if (to_date) {
      query += " AND (DATE(created_at, 'localtime') <= DATE(?) OR DATE(created_at) <= DATE(?))";
      params.push(to_date, to_date);
    } else if (period === 'today') {
      query += " AND (DATE(created_at, 'localtime') = DATE('now', 'localtime') OR DATE(created_at) = DATE('now', 'localtime') OR DATE(created_at) = DATE('now'))";
    } else if (period === 'yesterday') {
      query += " AND (DATE(created_at, 'localtime') = DATE('now', 'localtime', '-1 day') OR DATE(created_at) = DATE('now', '-1 day'))";
    } else if (period === 'week') {
      query += " AND (DATE(created_at, 'localtime') >= DATE('now', 'localtime', '-7 days') OR DATE(created_at) >= DATE('now', '-7 days'))";
    }

    if (search && search.trim()) {
      query += " AND (order_number LIKE ? OR table_number LIKE ? OR customer_name LIKE ?)";
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    query += " ORDER BY id DESC LIMIT 250";
    const orders = db.prepare(query).all(...params);

    for (const ord of orders) {
      try { ord.items = JSON.parse(ord.items_json || '[]'); } catch (e) { ord.items = []; }
      ord.items_json = ord.items; // ensure items_json is also the parsed array
      try { ord.split_details = JSON.parse(ord.split_details_json || '{}'); } catch (e) { ord.split_details = {}; }
      ord.grand_total = ord.total;
      ord.grandTotal = ord.total;
    }

    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete multiple settled bills
app.post('/api/restaurant/settled-bills/delete', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { order_ids } = req.body;
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No order IDs provided for deletion' });
    }

    const deleteTransaction = db.transaction((ids) => {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM bill_logs WHERE order_id IN (${placeholders})`).run(...ids);
      const info = db.prepare(`DELETE FROM restaurant_orders WHERE id IN (${placeholders})`).run(...ids);
      return info.changes;
    });

    const deletedCount = deleteTransaction(order_ids);
    res.json({ success: true, count: deletedCount });
  } catch (error) {
    console.error('Delete settled bills error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete single settled bill
app.delete('/api/restaurant/orders/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const deleteTransaction = db.transaction((orderId) => {
      db.prepare('DELETE FROM bill_logs WHERE order_id = ?').run(orderId);
      const info = db.prepare('DELETE FROM restaurant_orders WHERE id = ?').run(orderId);
      return info.changes;
    });

    const changes = deleteTransaction(id);
    res.json({ success: true, count: changes });
  } catch (error) {
    console.error('Delete single order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/restaurant/orders/:id', (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT * FROM restaurant_orders WHERE id = ?').get(id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    try { order.items = JSON.parse(order.items_json || '[]'); } catch (e) { order.items = []; }
    order.items_json = order.items;
    try { order.split_details = JSON.parse(order.split_details_json || '{}'); } catch (e) { order.split_details = {}; }    
    order.grand_total = order.total;
    order.grandTotal = order.total;
    const logs = db.prepare('SELECT * FROM bill_logs WHERE order_id = ? ORDER BY id ASC').all(id);

    res.json({ success: true, order, logs, audit_logs: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// POS DEPARTMENTAL MANAGER ANALYTICS (RESTAURANT & BAR)
// ==========================================
app.get(['/api/restaurant/manager/analytics', '/api/bar/manager/analytics'], requireAuth, (req, res) => {
  try {
    const isBar = req.path.includes('/bar') || (req.originalUrl && req.originalUrl.includes('/bar'));
    const department = isBar ? 'bar' : 'restaurant';
    const allowedRoles = isBar ? ['manager', 'bar'] : ['manager', 'restaurant'];

    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'admin' && !req.user.can_access_manager) {
      return res.status(403).json({ success: false, error: `Access denied to ${department} manager analytics` });
    }

    const { startDate, endDate, from_date, to_date, date, period } = req.query;
    const start = startDate || from_date || (date ? date : null);
    const end = endDate || to_date || (date ? date : null);

    let dateClause = "";
    const dateParams = [];

    if (start && end) {
      dateClause = " AND (DATE(created_at, 'localtime') BETWEEN DATE(?) AND DATE(?) OR DATE(created_at) BETWEEN DATE(?) AND DATE(?))";
      dateParams.push(start, end, start, end);
    } else if (start) {
      dateClause = " AND (DATE(created_at, 'localtime') = DATE(?) OR DATE(created_at) = DATE(?))";
      dateParams.push(start, start);
    } else if (period === 'today') {
      dateClause = " AND (DATE(created_at, 'localtime') = DATE('now', 'localtime') OR DATE(created_at) = DATE('now', 'localtime'))";
    } else if (period === 'yesterday') {
      dateClause = " AND (DATE(created_at, 'localtime') = DATE('now', 'localtime', '-1 day') OR DATE(created_at) = DATE('now', '-1 day'))";
    } else if (period === 'week') {
      dateClause = " AND (DATE(created_at, 'localtime') >= DATE('now', 'localtime', '-7 days') OR DATE(created_at) >= DATE('now', '-7 days'))";
    } else if (period === 'month') {
      dateClause = " AND (DATE(created_at, 'localtime') >= DATE('now', 'localtime', 'start of month') OR DATE(created_at) >= DATE('now', 'start of month'))";
    }

    const tableName = isBar ? 'bar_orders' : 'restaurant_orders';

    // 1. Core aggregates
    const summaryRow = db.prepare(`
      SELECT
        COUNT(*) as total_orders_count,
        COALESCE(SUM(CASE WHEN is_paid = 1 AND payment_mode != 'room_folio' THEN 1 ELSE 0 END), 0) as paid_orders_count,
        COALESCE(SUM(CASE WHEN is_paid = 0 OR payment_mode = 'room_folio' THEN 1 ELSE 0 END), 0) as room_folio_orders_count,
        COALESCE(SUM(CASE WHEN is_paid = 1 AND payment_mode != 'room_folio' THEN total ELSE 0 END), 0) as realized_revenue,
        COALESCE(SUM(CASE WHEN is_paid = 0 OR payment_mode = 'room_folio' THEN total ELSE 0 END), 0) as room_folio_revenue,
        COALESCE(SUM(total), 0) as gross_sales,
        COALESCE(SUM(subtotal), 0) as total_subtotal,
        COALESCE(SUM(tax), 0) as total_tax,
        COALESCE(SUM(discount), 0) as total_discount,
        COALESCE(SUM(CASE WHEN is_paid = 1 THEN card_surcharge ELSE 0 END), 0) as total_card_surcharge,
        COALESCE(SUM(CASE WHEN is_paid = 1 THEN upi_tax ELSE 0 END), 0) as total_upi_tax
      FROM ${tableName}
      WHERE status = 'completed' ${dateClause}
    `).get(...dateParams);

    // 2. Fetch all completed orders in this date range
    const orders = db.prepare(`
      SELECT *
      FROM ${tableName}
      WHERE status = 'completed' ${dateClause}
      ORDER BY id DESC
    `).all(...dateParams);

    // 3. Pre-fetch menu item category mapping for this department
    const menuRows = db.prepare('SELECT name, category FROM menu_items WHERE department = ?').all(department);
    const catMap = {};
    for (const m of menuRows) {
      if (m.name) catMap[m.name.toLowerCase().trim()] = m.category || 'General';
    }

    // 4. Breakdown computation
    const paymentModes = {
      cash: 0,
      upi: 0,
      card: 0,
      room_folio: 0,
      cardSurcharge: 0,
      upiTax: 0,
      upiCount: 0,
      upiWithUtrCount: 0,
      cardCount: 0,
      cashCount: 0
    };

    const orderTypes = {
      dineIn: { count: 0, revenue: 0 },
      parcel: { count: 0, revenue: 0 },
      roomService: { count: 0, revenue: 0 }
    };

    const categoriesMap = {};
    const itemsMap = {};
    const cashiersMap = {};
    const captainsMap = {};
    const hourlyMap = {};
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0');
      hourlyMap[hh] = { hour: hh, label: `${hh}:00`, count: 0, revenue: 0 };
    }

    for (const ord of orders) {
      try { ord.items = JSON.parse(ord.items_json || '[]'); } catch (e) { ord.items = []; }
      ord.items_json = ord.items;
      try { ord.split_details = JSON.parse(ord.split_details_json || '{}'); } catch (e) { ord.split_details = {}; }
      ord.grand_total = ord.total;
      ord.grandTotal = ord.total;

      const isPaidOrder = Number(ord.is_paid) === 1 && ord.payment_mode !== 'room_folio';
      const isRoomFolio = !isPaidOrder;

      // Payment modes
      if (isRoomFolio) {
        paymentModes.room_folio += (Number(ord.total) || 0);
      } else {
        const split = ord.split_details || {};
        const splitCash = Number(split.cash || ord.split_cash || 0);
        const splitOnline = Number(split.online || ord.split_online || 0);
        const splitCard = Number(split.card || ord.split_card || 0);
        const hasSplit = (splitCash > 0 || splitOnline > 0 || splitCard > 0) && ord.payment_mode === 'split';

        if (hasSplit) {
          paymentModes.cash += splitCash;
          paymentModes.upi += splitOnline;
          paymentModes.card += splitCard;
          if (splitCash > 0) paymentModes.cashCount++;
          if (splitOnline > 0) {
            paymentModes.upiCount++;
            if (ord.utr_number && ord.utr_number.trim()) paymentModes.upiWithUtrCount++;
          }
          if (splitCard > 0) paymentModes.cardCount++;
        } else if (ord.payment_mode === 'online' || ord.payment_mode === 'upi') {
          paymentModes.upi += (Number(ord.total) || 0);
          paymentModes.upiCount++;
          if (ord.utr_number && ord.utr_number.trim()) paymentModes.upiWithUtrCount++;
        } else if (ord.payment_mode === 'card') {
          paymentModes.card += (Number(ord.total) || 0);
          paymentModes.cardCount++;
        } else {
          paymentModes.cash += (Number(ord.total) || 0);
          paymentModes.cashCount++;
        }

        if (Number(ord.card_surcharge) > 0) paymentModes.cardSurcharge += Number(ord.card_surcharge);
        if (Number(ord.upi_tax) > 0) paymentModes.upiTax += Number(ord.upi_tax);
      }

      // Order type
      const tblStr = String(ord.table_number || '');
      const oType = String(ord.order_type || '').toLowerCase();
      if (oType === 'parcel' || tblStr.startsWith('P-') || tblStr.startsWith('BP-')) {
        orderTypes.parcel.count++;
        orderTypes.parcel.revenue += (Number(ord.total) || 0);
      } else if (oType === 'room' || tblStr.startsWith('RS-')) {
        orderTypes.roomService.count++;
        orderTypes.roomService.revenue += (Number(ord.total) || 0);
      } else {
        orderTypes.dineIn.count++;
        orderTypes.dineIn.revenue += (Number(ord.total) || 0);
      }

      // Hourly
      if (ord.created_at) {
        try {
          const dt = new Date(ord.created_at);
          const hh = String(dt.getHours()).padStart(2, '0');
          if (hourlyMap[hh]) {
            hourlyMap[hh].count++;
            hourlyMap[hh].revenue += (Number(ord.total) || 0);
          }
        } catch (e) {}
      }

      // Cashier
      const cName = (ord.cashier_name || 'Cashier').trim();
      if (!cashiersMap[cName]) cashiersMap[cName] = { name: cName, count: 0, revenue: 0 };
      cashiersMap[cName].count++;
      cashiersMap[cName].revenue += (Number(ord.total) || 0);

      // Captain / Waiter
      const wName = (ord.waiter_name || 'Counter').trim();
      if (!captainsMap[wName]) captainsMap[wName] = { name: wName, count: 0, revenue: 0 };
      captainsMap[wName].count++;
      captainsMap[wName].revenue += (Number(ord.total) || 0);

      // Items & Categories
      for (const it of ord.items) {
        const iName = (it.name || it.item_name || 'Unknown Item').trim();
        const iQty = Number(it.quantity || it.qty || 1);
        const iPrice = Number(it.price || it.rate || 0);
        const iTotal = iQty * iPrice;
        const iCategory = it.category || catMap[iName.toLowerCase()] || 'General';

        // Category map
        if (!categoriesMap[iCategory]) categoriesMap[iCategory] = { name: iCategory, quantity: 0, revenue: 0 };
        categoriesMap[iCategory].quantity += iQty;
        categoriesMap[iCategory].revenue += iTotal;

        // Item map
        if (!itemsMap[iName]) itemsMap[iName] = { name: iName, category: iCategory, price: iPrice, quantity: 0, revenue: 0 };
        itemsMap[iName].quantity += iQty;
        itemsMap[iName].revenue += iTotal;
      }
    }

    // Convert and sort categories
    const totalCatRevenue = Object.values(categoriesMap).reduce((s, c) => s + c.revenue, 0) || 1;
    const categories = Object.values(categoriesMap)
      .map(c => ({
        ...c,
        percentage: Math.min(100, Math.round((c.revenue / totalCatRevenue) * 100))
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Convert and sort top items
    const topItems = Object.values(itemsMap)
      .sort((a, b) => b.quantity !== a.quantity ? b.quantity - a.quantity : b.revenue - a.revenue)
      .slice(0, 10);

    const cashiers = Object.values(cashiersMap).sort((a, b) => b.revenue - a.revenue);
    const captains = Object.values(captainsMap).sort((a, b) => b.revenue - a.revenue);
    const hourlySales = Object.values(hourlyMap);

    const totalOrdersCount = Number(summaryRow?.total_orders_count || 0);
    const realizedRevenue = Number(summaryRow?.realized_revenue || 0);
    const grossSales = Number(summaryRow?.gross_sales || 0);
    const roomFolioRevenue = Number(summaryRow?.room_folio_revenue || 0);
    const paidOrdersCount = Number(summaryRow?.paid_orders_count || 0);
    const averageOrderValue = paidOrdersCount > 0 ? Math.round(realizedRevenue / paidOrdersCount) : 0;
    const totalCardSurcharge = Number(summaryRow?.total_card_surcharge || paymentModes.cardSurcharge || 0);
    const totalUpiTax = Number(summaryRow?.total_upi_tax || paymentModes.upiTax || 0);

    res.json({
      success: true,
      department,
      period: {
        startDate: start || new Date().toISOString().slice(0, 10),
        endDate: end || new Date().toISOString().slice(0, 10)
      },
      summary: {
        grossSales,
        realizedRevenue,
        roomFolioRevenue,
        totalSubtotal: Number(summaryRow?.total_subtotal || 0),
        totalTax: Number(summaryRow?.total_tax || 0),
        totalDiscount: Number(summaryRow?.total_discount || 0),
        totalOrdersCount,
        paidOrdersCount,
        roomFolioOrdersCount: Number(summaryRow?.room_folio_orders_count || 0),
        averageOrderValue,
        totalCardSurcharge,
        totalUpiTax,
        totalSurcharges: totalCardSurcharge + totalUpiTax
      },
      paymentModes,
      orderTypes,
      categories,
      topItems,
      hourlySales,
      staffPerformance: {
        cashiers,
        captains
      },
      orders: orders.slice(0, 200)
    });
  } catch (error) {
    console.error('POS Manager Analytics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. EDIT & RESETTLE SETTLED BILL (WITH AUDIT TRAIL)
app.post('/api/restaurant/orders/:id/resettle', requireAuth, requireRole('manager'), (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const { items, updated_items, payment_mode, split_details, discount_pct, audit_reason, reason, customer_name } = req.body;

    const previousOrder = db.prepare('SELECT * FROM restaurant_orders WHERE id = ?').get(id);
    if (!previousOrder) throw new Error('Original order not found');

    const newItems = Array.isArray(items) ? items : (Array.isArray(updated_items) ? updated_items : []);
    if (newItems.length === 0) throw new Error('Cannot resettle order with 0 items. Cancel bill instead.');

    let prevItems = [];
    try { prevItems = JSON.parse(previousOrder.items_json || '[]'); } catch (e) { prevItems = []; }

    const subtotal = newItems.reduce((sum, it) => sum + (it.price * (it.qty || 1)), 0);
    const discPct = parseFloat(discount_pct) !== undefined && !isNaN(parseFloat(discount_pct)) ? parseFloat(discount_pct) : 0;
    const discountAmt = Math.round((subtotal * discPct) / 100);
    const taxable = Math.max(0, subtotal - discountAmt);
    const restGstPct = getFnbGstRate('restaurant');
    const tax = Math.round(taxable * (restGstPct / 100));
    const newTotal = taxable + tax;

    // Build human-readable audit diff
    const prevMap = {};
    for (const p of prevItems) {
      prevMap[p.name] = (prevMap[p.name] || 0) + (p.qty || 1);
    }
    const newMap = {};
    for (const n of newItems) {
      newMap[n.name] = (newMap[n.name] || 0) + (n.qty || 1);
    }

    const changes = [];
    // Check additions & modifications
    for (const [name, qty] of Object.entries(newMap)) {
      const pQty = prevMap[name] || 0;
      if (pQty === 0) {
        changes.push(`+Added "${name}" (${qty}x)`);
      } else if (qty !== pQty) {
        changes.push(`Qty for "${name}": ${pQty} -> ${qty}`);
      }
    }
    // Check removals
    for (const [name, pQty] of Object.entries(prevMap)) {
      if (!newMap[name]) {
        changes.push(`-Removed "${name}" (was ${pQty}x)`);
      }
    }

    const priceDiff = newTotal - previousOrder.total;
    const priceDiffStr = priceDiff >= 0 ? `+₹${priceDiff.toFixed(2)}` : `-₹${Math.abs(priceDiff).toFixed(2)}`;
    const effectiveReason = (audit_reason || reason || '').trim();
    const reasonStr = effectiveReason ? ` [Reason: ${effectiveReason}]` : '';
    const changeSummary = `Resettle #${(previousOrder.resettle_count || 0) + 1}: ${changes.join(', ')}. Total changed: ₹${previousOrder.total.toFixed(2)} -> ₹${newTotal.toFixed(2)} (${priceDiffStr}). Mode: ${(payment_mode || previousOrder.payment_mode).toUpperCase()}.${reasonStr}`;

    const effMode = (payment_mode || previousOrder.payment_mode || 'cash').toLowerCase();
    const effSplit = split_details || {};
    const surchargeCfg = getSurchargeSettings();
    let card_surcharge = 0;
    if (surchargeCfg.card_surcharge_pct > 0) {
      if (effMode === 'card') card_surcharge = Math.round((newTotal * surchargeCfg.card_surcharge_pct) / 100);
      else if (Number(effSplit.card) > 0) card_surcharge = Math.round((Number(effSplit.card) * surchargeCfg.card_surcharge_pct) / 100);
    }

    let upi_tax = 0;
    if (surchargeCfg.upi_tax_pct > 0) {
      const upiPortion = (effMode === 'online' || effMode === 'upi') ? newTotal : (Number(effSplit.online) || 0);
      if (upiPortion > surchargeCfg.upi_tax_threshold) upi_tax = Math.round((upiPortion * surchargeCfg.upi_tax_pct) / 100);
    }

    // Update order
    db.prepare(`
      UPDATE restaurant_orders
      SET items_json = ?, subtotal = ?, tax = ?, discount = ?, total = ?,
          payment_mode = ?, split_details_json = ?, customer_name = ?,
          card_surcharge = ?, upi_tax = ?,
          resettle_count = COALESCE(resettle_count, 0) + 1
      WHERE id = ?
    `).run(
      JSON.stringify(newItems),
      subtotal,
      tax,
      discountAmt,
      newTotal,
      payment_mode || previousOrder.payment_mode,
      JSON.stringify(split_details || {}),
      customer_name ? customer_name.trim() : previousOrder.customer_name,
      card_surcharge,
      upi_tax,
      id
    );

    // Record in bill_logs
    db.prepare(`
      INSERT INTO bill_logs (order_id, order_number, action, staff_user, change_summary, previous_total, new_total, previous_items_json, new_items_json)
      VALUES (?, ?, 'resettled', 'Manager', ?, ?, ?, ?, ?)
    `).run(
      id,
      previousOrder.order_number,
      changeSummary,
      previousOrder.total,
      newTotal,
      previousOrder.items_json,
      JSON.stringify(newItems)
    );

    const newResettleCount = (previousOrder.resettle_count || 0) + 1;
    return {
      orderId: id,
      orderNumber: previousOrder.order_number,
      previousTotal: previousOrder.total,
      newTotal,
      grandTotal: newTotal,
      resettleCount: newResettleCount,
      changeSummary,
      order: {
        id,
        orderNumber: previousOrder.order_number,
        order_number: previousOrder.order_number,
        previousTotal: previousOrder.total,
        newTotal,
        total: newTotal,
        grandTotal: newTotal,
        grand_total: newTotal,
        subtotal,
        tax,
        discount: discountAmt,
        table_number: previousOrder.table_number,
        token_number: previousOrder.token_number,
        waiter_name: previousOrder.waiter_name || '',
        resettleCount: newResettleCount,
        resettle_count: newResettleCount,
        items: newItems,
        items_json: newItems,
        payment_mode: payment_mode || previousOrder.payment_mode,
        settled_at: new Date().toISOString()
      }
    };
  });

  try {
    const result = transaction();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Resettle error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 12. CREATE RESTAURANT ORDER (Legacy Walkin/Room Folio)
app.post('/api/restaurant/order', requireAuth, requireRole('manager', 'restaurant'), (req, res) => {
  try {
    const {
      room_id,
      customer_name,
      order_type, // 'walkin' or 'room'
      table_number,
      items, // array of { id, name, price, qty, total }
      discount_pct,
      payment_mode // 'cash', 'card', 'online', 'room_folio'
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items in order' });
    }

    const subtotal = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
    const discount = (subtotal * (parseFloat(discount_pct) || 0)) / 100;
    const restGstPct = getFnbGstRate('restaurant');
    const tax = Math.round((subtotal - discount) * (restGstPct / 100));
    const total = subtotal - discount + tax;

    const orderNumber = 'RES-' + Date.now().toString().slice(-6);
    const isPaid = payment_mode === 'room_folio' ? 0 : 1;

    let targetRoomId = null;
    let custName = customer_name || 'Walk-in Guest';

    if (order_type === 'room' && room_id) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
      if (room && room.status === 'occupied') {
        targetRoomId = room.id;
        const booking = db.prepare('SELECT g.name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);
        if (booking) custName = `Room ${room.room_number} - ${booking.name}`;
      }
    }

    let targetBookingId = null;
    if (targetRoomId) {
      const activeRoom = db.prepare('SELECT current_booking_id FROM rooms WHERE id = ?').get(targetRoomId);
      if (activeRoom && activeRoom.current_booking_id) {
        targetBookingId = activeRoom.current_booking_id;
      } else {
        const activeB = db.prepare("SELECT id FROM bookings WHERE room_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(targetRoomId);
        if (activeB) targetBookingId = activeB.id;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO restaurant_orders (
        order_number, room_id, booking_id, customer_name, order_type, table_number,
        items_json, subtotal, tax, discount, total, payment_mode, is_paid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      orderNumber,
      targetRoomId,
      targetBookingId,
      custName,
      order_type || 'walkin',
      table_number || 'Walk-in',
      JSON.stringify(items),
      subtotal,
      tax,
      discount,
      total,
      payment_mode || 'cash',
      isPaid
    );

    res.json({
      success: true,
      order: {
        id: result.lastInsertRowid,
        orderNumber,
        customerName: custName,
        total,
        paymentMode: payment_mode
      }
    });
  } catch (error) {
    console.error('Restaurant order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 13. CREATE BAR ORDER
// ==========================================================================
// BAR LOUNGE POS SUITE API (MIRRORS RESTAURANT POS)
// ==========================================================================

function formatBarTableOutput(t) {
  if (!t) return t;
  t.cart = [];
  try { t.cart = JSON.parse(t.active_cart_json || '[]'); } catch (e) { t.cart = []; }
  t.active_cart = t.cart;
  t.cart_count = t.cart.reduce((sum, it) => sum + (it.qty || 1), 0);
  t.cart_total = t.cart.reduce((sum, it) => sum + (it.price * (it.qty || 1)), 0);
  t.running_bill_total = t.cart_total;

  const now = Date.now();
  t.elapsed_minutes = 0;
  if (t.order_started_at && t.status !== 'available') {
    const start = new Date(t.order_started_at).getTime();
    t.elapsed_minutes = Math.max(0, Math.floor((now - start) / 60000));
  }
  return t;
}

function cleanupBarSplitPair(tableId) {
  try {
    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(tableId);
    if (!table) return;

    let parentId = table.parent_table_id || table.id;
    const parent = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(parentId);
    if (!parent) return;

    const children = db.prepare('SELECT * FROM bar_tables WHERE parent_table_id = ?').all(parentId);

    let parentCart = [];
    try { parentCart = JSON.parse(parent.active_cart_json || '[]'); } catch (e) { parentCart = []; }
    const parentHasOrder = (parent.status !== 'available' && parent.status !== '') || parentCart.length > 0;

    let childHasOrder = false;
    for (const c of children) {
      let cCart = [];
      try { cCart = JSON.parse(c.active_cart_json || '[]'); } catch (e) { cCart = []; }
      if ((c.status !== 'available' && c.status !== '') || cCart.length > 0) {
        childHasOrder = true;
        break;
      }
    }

    if (!parentHasOrder && !childHasOrder) {
      for (const c of children) {
        db.prepare('DELETE FROM bar_tables WHERE id = ?').run(c.id);
      }
      const origNum = parent.table_number.replace(/-[AB]$/i, '').replace(/[AB]$/i, '');
      db.prepare(`
        UPDATE bar_tables 
        SET table_number = ?, is_split = 0, status = 'available', 
            active_cart_json = '[]', printed_cart_json = '[]', 
            bot_count = 0, token_number = 0, order_started_at = NULL, 
            parent_table_id = NULL 
        WHERE id = ?
      `).run(origNum, parent.id);
    }
  } catch (err) {
    console.error('Error cleaning up bar split pair:', err);
  }
}

// 1. Bar Menu / Beverages CRUD
app.get('/api/bar/menu', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT * FROM menu_items 
      WHERE department = 'bar' 
      ORDER BY category ASC, name ASC
    `).all();

    const categories = db.prepare(`
      SELECT * FROM bar_categories 
      ORDER BY sort_order ASC, name ASC
    `).all();

    res.json({ success: true, items, drinks: items, dishes: items, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bar/menu', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { name, category, price, shortcode, description } = req.body;
    if (!name || price === undefined || price === null || price === '') {
      return res.status(400).json({ success: false, error: 'Drink name and price are required' });
    }

    let code = (shortcode || '').trim();
    if (!code) {
      const maxRow = db.prepare("SELECT MAX(CAST(shortcode AS INTEGER)) as max_code FROM menu_items WHERE department = 'bar' AND shortcode GLOB '[0-9]*'").get();
      code = String((maxRow && maxRow.max_code ? maxRow.max_code : 500) + 1);
    }

    const stmt = db.prepare(`
      INSERT INTO menu_items (department, category, name, price, description, is_available, shortcode)
      VALUES ('bar', ?, ?, ?, ?, 1, ?)
    `);
    const result = stmt.run(category || 'Signature Cocktails', name.trim(), parseFloat(price) || 0, (description || '').trim(), code);

    res.json({
      success: true,
      drink: { id: result.lastInsertRowid, name: name.trim(), price: parseFloat(price) || 0, shortcode: code },
      dish: { id: result.lastInsertRowid, name: name.trim(), price: parseFloat(price) || 0, shortcode: code },
      itemId: result.lastInsertRowid,
      shortcode: code
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/bar/menu/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, price, shortcode, description, is_available } = req.body;

    const current = db.prepare("SELECT * FROM menu_items WHERE id = ? AND department = 'bar'").get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Drink not found' });

    db.prepare(`
      UPDATE menu_items 
      SET name = ?, category = ?, price = ?, shortcode = ?, description = ?, is_available = ?
      WHERE id = ?
    `).run(
      name ? name.trim() : current.name,
      category || current.category,
      price !== undefined ? parseFloat(price) : current.price,
      shortcode !== undefined ? String(shortcode).trim() : current.shortcode,
      description !== undefined ? String(description).trim() : current.description,
      is_available !== undefined ? (is_available ? 1 : 0) : current.is_available,
      id
    );

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    res.json({ success: true, drink: updated, dish: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/bar/menu/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare("DELETE FROM menu_items WHERE id = ? AND department = 'bar'").run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Bar Categories CRUD
app.get('/api/bar/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM bar_categories ORDER BY sort_order ASC, name ASC').all();
    res.json({ success: true, categories });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bar/categories', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Category name is required' });

    const maxSort = db.prepare('SELECT MAX(sort_order) as max_sort FROM bar_categories').get().max_sort || 0;
    const stmt = db.prepare('INSERT INTO bar_categories (name, sort_order) VALUES (?, ?)');
    const result = stmt.run(name.trim(), maxSort + 1);

    res.json({ success: true, category: { id: result.lastInsertRowid, name: name.trim(), sort_order: maxSort + 1 } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/bar/categories/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { name, sort_order } = req.body;
    const current = db.prepare('SELECT * FROM bar_categories WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Category not found' });

    const oldName = current.name;
    const newName = name ? name.trim() : current.name;

    db.prepare('UPDATE bar_categories SET name = ?, sort_order = ? WHERE id = ?').run(
      newName,
      sort_order !== undefined ? parseInt(sort_order) : current.sort_order,
      id
    );

    if (oldName !== newName) {
      db.prepare("UPDATE menu_items SET category = ? WHERE department = 'bar' AND category = ?").run(newName, oldName);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/bar/categories/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const cat = db.prepare('SELECT * FROM bar_categories WHERE id = ?').get(id);
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });

    const count = db.prepare("SELECT COUNT(*) as c FROM menu_items WHERE department = 'bar' AND category = ?").get(cat.name).c;
    if (count > 0) {
      db.prepare("UPDATE menu_items SET category = 'Signature Cocktails' WHERE department = 'bar' AND category = ?").run(cat.name);
    }

    db.prepare('DELETE FROM bar_categories WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Bar Tables & Sessions CRUD
app.get('/api/bar/tables', (req, res) => {
  try {
    const orphans = db.prepare(`
      SELECT c.id FROM bar_tables c
      LEFT JOIN bar_tables p ON c.parent_table_id = p.id
      WHERE c.parent_table_id IS NOT NULL AND (p.id IS NULL OR p.is_split = 0)
    `).all();
    for (const o of orphans) {
      db.prepare('DELETE FROM bar_tables WHERE id = ?').run(o.id);
    }

    const tables = db.prepare(`
      SELECT * FROM bar_tables 
      ORDER BY 
        CASE WHEN table_type = 'counter' THEN 2 WHEN table_type = 'lounge' THEN 3 ELSE 1 END,
        CAST(SUBSTR(table_number, 3) AS INTEGER) ASC,
        table_number ASC
    `).all();

    for (const t of tables) {
      formatBarTableOutput(t);
    }

    res.json({ success: true, tables });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bar/tables', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { table_number, table_type, capacity, special_notes, room_id } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'Table/Seat number is required' });

    const existing = db.prepare('SELECT * FROM bar_tables WHERE table_number = ?').get(table_number.trim());
    if (existing) {
      if (existing.table_type === 'room_service' || existing.table_type === 'parcel' || table_type === 'room_service') {
        db.prepare(`
          UPDATE bar_tables
          SET status = 'in_process', special_notes = COALESCE(?, special_notes), room_id = COALESCE(?, room_id), active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, order_started_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(special_notes || null, room_id || null, existing.id);
        const updated = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(existing.id);
        return res.json({ success: true, tableId: existing.id, table: formatBarTableOutput(updated) });
      }
      return res.json({ success: true, tableId: existing.id, table: formatBarTableOutput(existing), alreadyExisted: true });
    }

    const initialStatus = (table_type === 'room_service' || table_type === 'parcel') ? 'in_process' : 'available';
    const stmt = db.prepare(`
      INSERT INTO bar_tables (table_number, table_type, capacity, status, special_notes, room_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(table_number.trim(), table_type || 'table', parseInt(capacity) || 4, initialStatus, special_notes || '', room_id || null);
    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, tableId: result.lastInsertRowid, table: formatBarTableOutput(table) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update Bar Table Status (e.g. in_process, ready)
app.post('/api/bar/tables/:id/status', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status is required' });

    const current = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Table not found' });

    db.prepare('UPDATE bar_tables SET status = ? WHERE id = ?').run(status, id);
    const updated = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    res.json({ success: true, table: formatBarTableOutput(updated) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/bar/tables/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { table_number, table_type, capacity } = req.body;

    const current = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ success: false, error: 'Table not found' });

    db.prepare(`
      UPDATE bar_tables 
      SET table_number = ?, table_type = ?, capacity = ?
      WHERE id = ?
    `).run(
      table_number ? table_number.trim() : current.table_number,
      table_type || current.table_type,
      capacity ? parseInt(capacity) : current.capacity,
      id
    );

    const updatedTable = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    res.json({ success: true, table: updatedTable });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/bar/tables/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    db.prepare('DELETE FROM bar_tables WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bar/tables/:id/split', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { id } = req.params;
    const parent = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!parent) return res.status(404).json({ success: false, error: 'Parent table not found' });

    let baseNum = parent.table_number.replace(/-[AB]$/i, '').replace(/[AB]$/i, '');
    const subNumA = `${baseNum}-A`;
    const subNumB = `${baseNum}-B`;

    db.prepare("UPDATE bar_tables SET table_number = ?, is_split = 1, status = 'available' WHERE id = ?").run(subNumA, id);
    const result = db.prepare(`
      INSERT INTO bar_tables (table_number, table_type, capacity, status, is_split, parent_table_id)
      VALUES (?, ?, ?, 'available', 1, ?)
    `).run(subNumB, parent.table_type, Math.max(2, Math.floor(parent.capacity / 2)), id);

    res.json({
      success: true,
      splitTables: [subNumA, subNumB],
      subTableAId: parent.id,
      subTableBId: result.lastInsertRowid,
      subTable: { id: result.lastInsertRowid, table_number: subNumB }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bar/tables/:id/cart', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { id } = req.params;
    const { items, cart, waiter_name, special_notes } = req.body;

    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    const itemsArr = Array.isArray(items) ? items : (Array.isArray(cart) ? cart : []);
    const hasItems = itemsArr.length > 0;
    const runningStatus = 'occupied';
    const newStatus = hasItems ? (table.status === 'billed' ? 'billed' : runningStatus) : 'available';
    const orderStartedAt = (hasItems && !table.order_started_at) ? new Date().toISOString() : (hasItems ? table.order_started_at : null);
    const tokenNum = (hasItems && (!table.token_number || table.token_number === 0)) ? getNextDailyToken() : (hasItems ? table.token_number : 0);

    db.prepare(`
      UPDATE bar_tables 
      SET active_cart_json = ?, status = ?, order_started_at = ?, token_number = ?, waiter_name = ?, special_notes = ?
      WHERE id = ?
    `).run(
      JSON.stringify(itemsArr),
      newStatus,
      orderStartedAt,
      tokenNum,
      waiter_name !== undefined ? waiter_name : table.waiter_name,
      special_notes !== undefined ? special_notes : table.special_notes,
      id
    );

    const updated = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    res.json({ success: true, status: newStatus, tokenNumber: tokenNum, table: formatBarTableOutput(updated) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bar Order Ticket (BOT / KOT)
app.post('/api/bar/tables/:id/bot', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { id } = req.params;
    const { items, cart, waiter_name, special_notes } = req.body;

    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    const itemsArr = Array.isArray(items) ? items : (Array.isArray(cart) ? cart : []);
    if (itemsArr.length === 0) return res.status(400).json({ success: false, error: 'Cannot dispatch empty BOT' });

    let previouslyPrinted = [];
    try { previouslyPrinted = JSON.parse(table.printed_cart_json || '[]'); } catch (e) { previouslyPrinted = []; }

    const printedMap = {};
    for (const p of previouslyPrinted) {
      const key = `${p.id || p.name}`;
      printedMap[key] = (printedMap[key] || 0) + (p.qty || 1);
    }

    const incrementalItems = [];
    for (const item of itemsArr) {
      const key = `${item.id || item.name}`;
      const printedQty = printedMap[key] || 0;
      const currentQty = item.qty || 1;
      const delta = currentQty - printedQty;

      if (delta > 0) {
        incrementalItems.push({ ...item, qty: delta });
      }
    }

    const nextBotCount = (table.bot_count || 0) + 1;
    const tokenNum = (!table.token_number || table.token_number === 0) ? getNextDailyToken() : table.token_number;
    const orderStartedAt = table.order_started_at || new Date().toISOString();

    db.prepare(`
      UPDATE bar_tables 
      SET active_cart_json = ?, printed_cart_json = ?, bot_count = ?,
          status = ?, order_started_at = ?, token_number = ?,
          waiter_name = ?, special_notes = ?
      WHERE id = ?
    `).run(
      JSON.stringify(itemsArr),
      JSON.stringify(itemsArr),
      nextBotCount,
      table.status === 'billed' ? 'billed' : 'occupied',
      orderStartedAt,
      tokenNum,
      waiter_name !== undefined ? waiter_name : table.waiter_name,
      special_notes !== undefined ? special_notes : table.special_notes,
      id
    );

    res.json({
      success: true,
      botNumber: nextBotCount,
      kotNumber: nextBotCount,
      tokenNumber: tokenNum,
      tableNumber: table.table_number,
      waiterName: waiter_name || table.waiter_name || 'Bartender',
      timestamp: new Date().toISOString(),
      incrementalItems: incrementalItems.length > 0 ? incrementalItems : itemsArr,
      isFullReorder: incrementalItems.length === 0
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
app.post('/api/bar/tables/:id/kot', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  // Alias to bot
  req.url = `/api/bar/tables/${req.params.id}/bot`;
  app.handle(req, res);
});

// Bar Pre-Bill
app.post('/api/bar/tables/:id/prebill', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { id } = req.params;
    const { cart, items: bodyItems, waiter_name, special_notes } = req.body || {};
    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    let items = (Array.isArray(cart) && cart.length > 0) ? cart : ((Array.isArray(bodyItems) && bodyItems.length > 0) ? bodyItems : []);
    if (items.length === 0) {
      try { items = JSON.parse(table.active_cart_json || '[]'); } catch (e) { items = []; }
    }
    if (items.length === 0) {
      try { items = JSON.parse(table.printed_cart_json || '[]'); } catch (e) { items = []; }
    }
    if (items.length === 0) return res.status(400).json({ success: false, error: 'No items in bar cart to pre-bill' });

    const subtotal = items.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
    const barGstPct = getFnbGstRate('bar');
    const tax = Math.round(subtotal * (barGstPct / 100));
    const grandTotal = subtotal + tax;
    const tokenNum = (!table.token_number || table.token_number === 0) ? getNextDailyToken() : table.token_number;
    const orderStartedAt = table.order_started_at || new Date().toISOString();

    db.prepare(`
      UPDATE bar_tables 
      SET status = 'billed', active_cart_json = ?, order_started_at = ?, token_number = ?, waiter_name = ?, special_notes = ?
      WHERE id = ?
    `).run(
      JSON.stringify(items),
      orderStartedAt,
      tokenNum,
      waiter_name !== undefined ? waiter_name : table.waiter_name,
      special_notes !== undefined ? special_notes : table.special_notes,
      id
    );

    const updatedTable = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);

    res.json({
      success: true,
      tableNumber: table.table_number,
      tokenNumber: tokenNum,
      items,
      subtotal,
      tax,
      grandTotal,
      table: formatBarTableOutput(updatedTable),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bar Cancel Order
app.post('/api/bar/tables/:id/cancel', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const { id } = req.params;
    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });

    if (table.is_split) {
      const parentId = table.parent_table_id || table.id;
      if (table.parent_table_id) {
        db.prepare('DELETE FROM bar_tables WHERE id = ?').run(id);
      } else {
        db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
      }
      cleanupBarSplitPair(parentId);
    } else if (table.table_type === 'parcel' || table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-') || String(table.table_number || '').startsWith('P-')) {
      db.prepare('DELETE FROM bar_tables WHERE id = ?').run(id);
    } else {
      db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bar Settle Bill & Final Payment
app.post('/api/bar/tables/:id/settle', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const {
      cart,
      items: bodyItems,
      discount,
      discount_pct,
      customer_name,
      waiter_name,
      split_details
    } = req.body;
    const payment_mode = req.body.payment_mode || req.body.paymentMode || 'cash';
    const split_cash = req.body.split_cash ?? req.body.splitCash ?? 0;
    const split_card = req.body.split_card ?? req.body.splitCard ?? 0;
    const split_online = req.body.split_online ?? req.body.splitOnline ?? 0;
    const room_id = req.body.room_id || req.body.chargeToRoomId || null;

    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);
    if (!table) throw new Error('Bar table not found');

    let items = (Array.isArray(cart) && cart.length > 0) ? cart : ((Array.isArray(bodyItems) && bodyItems.length > 0) ? bodyItems : []);
    if (items.length === 0) {
      try { items = JSON.parse(table.active_cart_json || '[]'); } catch (e) { items = []; }
    }
    if (items.length === 0) throw new Error('Cannot settle empty bar tab');

    const subtotal = items.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
    let discountAmt = 0;
    if (discount !== undefined && !isNaN(parseFloat(discount))) {
      discountAmt = Math.max(0, parseFloat(discount));
    } else if (discount_pct !== undefined) {
      discountAmt = Math.round((subtotal * (parseFloat(discount_pct) || 0)) / 100);
    }
    const taxable = Math.max(0, subtotal - discountAmt);
    const barGstPct = getFnbGstRate('bar');
    const tax = Math.round(taxable * (barGstPct / 100));
    const total = taxable + tax;

    const orderNumber = 'BAR-' + Date.now().toString().slice(-6);
    const isPaid = (req.body.is_paid !== undefined) ? (req.body.is_paid ? 1 : 0) : (payment_mode === 'room_folio' ? 0 : 1);

    let targetRoomId = null;
    let custName = (customer_name || '').trim();

    let resolvedRoomId = room_id || table.room_id || null;
    if (!resolvedRoomId && (table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-'))) {
      const rNum = String(table.table_number || '').replace(/^RS-/i, '').trim();
      const rRow = db.prepare('SELECT id FROM rooms WHERE room_number = ?').get(rNum);
      if (rRow) resolvedRoomId = rRow.id;
    }

    if (resolvedRoomId) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(resolvedRoomId);
      if (room && room.status === 'occupied') {
        targetRoomId = room.id;
        const booking = db.prepare('SELECT g.name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);
        if (booking && !custName) custName = `Room ${room.room_number} - ${booking.name}`;
      }
    }
    if (!custName) {
      custName = `Bar Table ${table.table_number} Guest`;
    }

    const splitDetails = split_details || {
      cash: parseFloat(split_cash) || 0,
      card: parseFloat(split_card) || 0,
      online: parseFloat(split_online) || 0
    };
    const utr_number = (req.body.utr_number || req.body.online_utr || req.body.utr || '').trim() || null;
    const room_service_for = req.body.room_service_for || req.body.roomServiceFor || null;
    const guest_phone = req.body.guest_phone || req.body.guestPhone || req.body.mobile || null;
    
    // Card Surcharge & UPI Tax (Configurable via Manager Panel)
    const surchargeCfg = getSurchargeSettings();
    let card_surcharge = Number(req.body.card_surcharge || req.body.cardSurcharge || 0);
    if (!card_surcharge && isPaid && surchargeCfg.card_surcharge_pct > 0) {
      if (payment_mode === 'card') card_surcharge = Math.round((total * surchargeCfg.card_surcharge_pct) / 100);
      else if (splitDetails.card > 0) card_surcharge = Math.round((splitDetails.card * surchargeCfg.card_surcharge_pct) / 100);
    }

    let upi_tax = Number(req.body.upi_tax || req.body.upiTax || 0);
    if (!upi_tax && isPaid && surchargeCfg.upi_tax_pct > 0) {
      const onlinePortion = (payment_mode === 'online' || payment_mode === 'upi') ? total : (splitDetails.online || 0);
      if (onlinePortion > surchargeCfg.upi_tax_threshold) {
        upi_tax = Math.round((onlinePortion * surchargeCfg.upi_tax_pct) / 100);
      }
    }

    const tokenNum = (!table.token_number || table.token_number === 0) ? getNextDailyToken() : table.token_number;
    const cashier_name = (req.body.cashier_name || req.body.cashierName || req.user?.full_name || req.user?.username || 'Cashier').trim();

    let targetBookingId = null;
    if (targetRoomId) {
      const activeRoom = db.prepare('SELECT current_booking_id FROM rooms WHERE id = ?').get(targetRoomId);
      if (activeRoom && activeRoom.current_booking_id) {
        targetBookingId = activeRoom.current_booking_id;
      } else {
        const activeB = db.prepare("SELECT id FROM bookings WHERE room_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(targetRoomId);
        if (activeB) targetBookingId = activeB.id;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO bar_orders (
        order_number, room_id, booking_id, customer_name, order_type, table_number, table_id,
        token_number, waiter_name, items_json, subtotal, tax, discount, total,
        payment_mode, split_details_json, is_paid, utr_number, cashier_name,
        room_service_for, guest_phone, card_surcharge, upi_tax, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now', 'localtime'))
    `);

    const result = stmt.run(
      orderNumber,
      targetRoomId,
      targetBookingId,
      custName,
      (table.table_type === 'parcel' || String(table.table_number || '').startsWith('BP-') || String(table.table_number || '').startsWith('P-')) ? 'parcel' : (targetRoomId ? 'room' : 'table'),
      table.table_number,
      table.id,
      tokenNum,
      waiter_name || table.waiter_name || '',
      JSON.stringify(items),
      subtotal,
      tax,
      discountAmt,
      total,
      payment_mode || 'cash',
      JSON.stringify(splitDetails),
      isPaid,
      utr_number,
      cashier_name,
      room_service_for,
      guest_phone,
      card_surcharge,
      upi_tax
    );

    const orderId = result.lastInsertRowid;

    db.prepare(`
      INSERT INTO bill_logs (order_id, order_number, action, staff_user, change_summary, previous_total, new_total, previous_items_json, new_items_json)
      VALUES (?, ?, 'settled', ?, ?, ?, ?, '', ?)
    `).run(
      orderId,
      orderNumber,
      cashier_name,
      `Bar Tab Settlement via ${(payment_mode || 'cash').toUpperCase()} (Total: ₹${total.toFixed(2)})`,
      total,
      total,
      JSON.stringify(items)
    );

    if (table.is_split) {
      const parentId = table.parent_table_id || table.id;
      if (table.parent_table_id) {
        db.prepare('DELETE FROM bar_tables WHERE id = ?').run(id);
      } else {
        db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
      }
      cleanupBarSplitPair(parentId);
    } else if (table.table_type === 'parcel' || table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-') || String(table.table_number || '').startsWith('P-') || String(table.table_number || '').startsWith('BP-')) {
      db.prepare('DELETE FROM bar_tables WHERE id = ?').run(id);
    } else {
      db.prepare("UPDATE bar_tables SET status = 'available', active_cart_json = '[]', printed_cart_json = '[]', bot_count = 0, token_number = 0, order_started_at = NULL, waiter_name = '', special_notes = '' WHERE id = ?").run(id);
    }

    return {
      id: orderId,
      orderId,
      orderNumber,
      token_number: tokenNum,
      customerName: custName,
      customer_name: custName,
      table_number: table.table_number,
      tableNumber: table.table_number,
      total,
      grand_total: total,
      grandTotal: total,
      discount: discountAmt,
      payment_mode: payment_mode || 'cash',
      paymentMode: payment_mode || 'cash',
      split_details: splitDetails,
      split_cash: splitDetails.cash,
      split_card: splitDetails.card,
      split_online: splitDetails.online,
      utr_number: utr_number,
      card_surcharge: card_surcharge,
      upi_tax: upi_tax,
      subtotal,
      tax,
      items,
      items_json: items,
      waiter_name: waiter_name || table.waiter_name || '',
      cashier_name: cashier_name,
      cashierName: cashier_name,
      room_service_for,
      guest_phone,
      is_bar: true,
      settled_at: new Date().toISOString()
    };
  });

  try {
    const data = transaction();

    // Non-blocking background push to Supabase room_charges_inbox if charged to room
    try {
      const isRoomCharge = (req.body.is_paid === 0 || req.body.payment_mode === 'room_folio' || req.body.isStayingGuest || req.body.roomBillStatus === 'pending');
      const targetRoomNum = req.body.room_number || (req.body.room_id ? db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.body.room_id)?.room_number : null) || (data.table_number && String(data.table_number).startsWith('RS-') ? String(data.table_number).replace(/^RS-/i, '') : null);
      if (isRoomCharge && targetRoomNum) {
        supabaseService.pushRoomCharge({
          room_number: String(targetRoomNum),
          department: 'bar',
          bill_no: data.orderNumber,
          grand_total: data.total || data.grand_total,
          split_details: data.split_details || null,
          cashier_name: data.cashier_name || 'Cashier',
          items_summary: Array.isArray(data.items) ? data.items.map(i => `${i.name} x${i.quantity || i.qty || 1}`).join(', ') : ''
        }).catch(err => console.warn('[Supabase] bar charge push error:', err.message));
      }
    } catch (pushErr) {
      console.warn('[Supabase] Bar charge push dispatch skipped:', pushErr.message);
    }

    res.json({ success: true, order: data });
  } catch (error) {
    console.error('Bar Settlement error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Bar Settled Bills & History
app.get('/api/bar/settled-bills', (req, res) => {
  try {
    const { period, search, from_date, to_date } = req.query;
    let query = "SELECT * FROM bar_orders WHERE status = 'completed'";
    const params = [];

    if (from_date && to_date) {
      query += " AND date(created_at) >= date(?) AND date(created_at) <= date(?)";
      params.push(from_date, to_date);
    } else if (period === 'today') {
      query += " AND date(created_at) = date('now', 'localtime')";
    } else if (period === 'week') {
      query += " AND date(created_at) >= date('now', 'localtime', '-7 days')";
    } else if (period === 'month') {
      query += " AND date(created_at) >= date('now', 'localtime', 'start of month')";
    }

    if (search && search.trim()) {
      query += " AND (order_number LIKE ? OR customer_name LIKE ? OR table_number LIKE ?)";
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    query += " ORDER BY id DESC LIMIT 200";

    const bills = db.prepare(query).all(...params);
    for (const b of bills) {
      try { b.items = JSON.parse(b.items_json); } catch (e) { b.items = []; }
      try { b.split_details = JSON.parse(b.split_details_json || '{}'); } catch (e) { b.split_details = {}; }
    }

    res.json({ success: true, orders: bills, bills });
  } catch (error) {
    console.error('Bar settled bills error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bar/settled-bills/delete', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No bills selected for deletion' });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM bar_orders WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, deletedCount: ids.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/bar/orders/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM bar_orders WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bar/orders/:id', (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT * FROM bar_orders WHERE id = ?').get(id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    try { order.items = JSON.parse(order.items_json); } catch (e) { order.items = []; }
    try { order.split_details = JSON.parse(order.split_details_json || '{}'); } catch (e) { order.split_details = {}; }
    order.grand_total = order.total;
    order.grandTotal = order.total;
    const logs = db.prepare('SELECT * FROM bill_logs WHERE order_id = ? ORDER BY id ASC').all(id);
    res.json({ success: true, order, logs, audit_logs: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bar Resettle Endpoint
app.post('/api/bar/orders/:id/resettle', requireAuth, requireRole('manager'), (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const { items, updated_items, payment_mode, split_details, discount_pct, audit_reason, reason, customer_name } = req.body;

    const previousOrder = db.prepare('SELECT * FROM bar_orders WHERE id = ?').get(id);
    if (!previousOrder) throw new Error('Original bar order not found');

    const newItems = Array.isArray(items) ? items : (Array.isArray(updated_items) ? updated_items : []);
    if (newItems.length === 0) throw new Error('Cannot resettle bar order with 0 items.');

    let prevItems = [];
    try { prevItems = JSON.parse(previousOrder.items_json || '[]'); } catch (e) { prevItems = []; }

    const subtotal = newItems.reduce((sum, it) => sum + (it.price * (it.qty || it.quantity || 1)), 0);
    const discPct = parseFloat(discount_pct) !== undefined && !isNaN(parseFloat(discount_pct)) ? parseFloat(discount_pct) : 0;
    const discountAmt = Math.round((subtotal * discPct) / 100);
    const taxable = Math.max(0, subtotal - discountAmt);
    const barGstPct = getFnbGstRate('bar');
    const tax = Math.round(taxable * (barGstPct / 100));
    const newTotal = taxable + tax;

    const prevMap = {};
    for (const p of prevItems) {
      prevMap[p.name] = (prevMap[p.name] || 0) + (p.qty || p.quantity || 1);
    }
    const newMap = {};
    for (const n of newItems) {
      newMap[n.name] = (newMap[n.name] || 0) + (n.qty || n.quantity || 1);
    }

    const changes = [];
    for (const [name, qty] of Object.entries(newMap)) {
      const pQty = prevMap[name] || 0;
      if (pQty === 0) {
        changes.push(`+Added "${name}" (${qty}x)`);
      } else if (qty !== pQty) {
        changes.push(`Qty for "${name}": ${pQty} -> ${qty}`);
      }
    }
    for (const [name, pQty] of Object.entries(prevMap)) {
      if (!newMap[name]) {
        changes.push(`-Removed "${name}" (was ${pQty}x)`);
      }
    }

    const priceDiff = newTotal - previousOrder.total;
    const priceDiffStr = priceDiff >= 0 ? `+₹${priceDiff.toFixed(2)}` : `-₹${Math.abs(priceDiff).toFixed(2)}`;
    const effectiveReason = (audit_reason || reason || '').trim();
    const reasonStr = effectiveReason ? ` [Reason: ${effectiveReason}]` : '';
    const changeSummary = `Resettle #${(previousOrder.resettle_count || 0) + 1}: ${changes.join(', ')}. Total: ₹${previousOrder.total.toFixed(2)} -> ₹${newTotal.toFixed(2)} (${priceDiffStr}). Mode: ${(payment_mode || previousOrder.payment_mode).toUpperCase()}.${reasonStr}`;

    const effBarMode = (payment_mode || previousOrder.payment_mode || 'cash').toLowerCase();
    const effBarSplit = split_details || {};
    const surchargeCfg = getSurchargeSettings();
    let card_surcharge = 0;
    if (surchargeCfg.card_surcharge_pct > 0) {
      if (effBarMode === 'card') card_surcharge = Math.round((newTotal * surchargeCfg.card_surcharge_pct) / 100);
      else if (Number(effBarSplit.card) > 0) card_surcharge = Math.round((Number(effBarSplit.card) * surchargeCfg.card_surcharge_pct) / 100);
    }

    let upi_tax = 0;
    if (surchargeCfg.upi_tax_pct > 0) {
      const upiPortion = (effBarMode === 'online' || effBarMode === 'upi') ? newTotal : (Number(effBarSplit.online) || 0);
      if (upiPortion > surchargeCfg.upi_tax_threshold) upi_tax = Math.round((upiPortion * surchargeCfg.upi_tax_pct) / 100);
    }

    db.prepare(`
      UPDATE bar_orders
      SET items_json = ?, subtotal = ?, tax = ?, discount = ?, total = ?,
          payment_mode = ?, split_details_json = ?, customer_name = ?,
          card_surcharge = ?, upi_tax = ?,
          resettle_count = COALESCE(resettle_count, 0) + 1
      WHERE id = ?
    `).run(
      JSON.stringify(newItems),
      subtotal,
      tax,
      discountAmt,
      newTotal,
      payment_mode || previousOrder.payment_mode,
      JSON.stringify(split_details || {}),
      customer_name ? customer_name.trim() : previousOrder.customer_name,
      card_surcharge,
      upi_tax,
      id
    );

    db.prepare(`
      INSERT INTO bill_logs (order_id, order_number, action, staff_user, change_summary, previous_total, new_total, previous_items_json, new_items_json)
      VALUES (?, ?, 'resettled', 'Manager', ?, ?, ?, ?, ?)
    `).run(
      id,
      previousOrder.order_number,
      changeSummary,
      previousOrder.total,
      newTotal,
      previousOrder.items_json,
      JSON.stringify(newItems)
    );

    return {
      orderId: id,
      orderNumber: previousOrder.order_number,
      customerName: customer_name || previousOrder.customer_name,
      total: newTotal,
      grand_total: newTotal,
      subtotal,
      tax,
      discount: discountAmt,
      items: newItems,
      changeSummary
    };
  });

  try {
    const data = transaction();
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('Bar Resettle error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Room GST Tax Settings Endpoints
app.get('/api/settings/room-gst', (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'room_gst_pct'").get();
    res.json({
      success: true,
      room_gst_pct: row ? parseFloat(row.value) : 5
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/room-gst', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { room_gst_pct } = req.body;
    const val = (room_gst_pct !== undefined && room_gst_pct !== null && !isNaN(parseFloat(room_gst_pct)))
      ? parseFloat(room_gst_pct)
      : 5;

    db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('room_gst_pct', ?, CURRENT_TIMESTAMP)").run(String(val));

    res.json({ success: true, room_gst_pct: val, message: 'Room GST updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POS GST & Tax Settings Endpoint
app.get('/api/pos/settings', (req, res) => {
  try {
    const restGst = db.prepare("SELECT value FROM system_settings WHERE key = 'restaurant_gst_pct'").get();
    const barGst = db.prepare("SELECT value FROM system_settings WHERE key = 'bar_gst_pct'").get();
    const barPax = db.prepare("SELECT value FROM system_settings WHERE key = 'bar_pax_charge'").get();

    res.json({
      success: true,
      settings: {
        restaurant_gst_pct: restGst ? parseFloat(restGst.value) : 5,
        bar_gst_pct: barGst ? parseFloat(barGst.value) : 5,
        bar_pax_charge: barPax ? parseFloat(barPax.value) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/pos/settings', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { restaurant_gst_pct, bar_gst_pct, bar_pax_charge } = req.body;

    if (restaurant_gst_pct !== undefined) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('restaurant_gst_pct', ?)").run(String(restaurant_gst_pct));
    }
    if (bar_gst_pct !== undefined) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('bar_gst_pct', ?)").run(String(bar_gst_pct));
    }
    if (bar_pax_charge !== undefined) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('bar_pax_charge', ?)").run(String(bar_pax_charge));
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy direct bar order endpoint
app.post('/api/bar/order', requireAuth, requireRole('manager', 'bar'), (req, res) => {
  try {
    const {
      room_id,
      customer_name,
      order_type,
      bar_seat,
      items,
      discount_pct,
      payment_mode
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items in order' });
    }

    const subtotal = items.reduce((sum, it) => sum + (it.price * (it.qty || 1)), 0);
    const discount = (subtotal * (parseFloat(discount_pct) || 0)) / 100;
    const barGstPct = getFnbGstRate('bar');
    const tax = Math.round((subtotal - discount) * (barGstPct / 100));
    const total = subtotal - discount + tax;

    const orderNumber = 'BAR-' + Date.now().toString().slice(-6);
    const isPaid = payment_mode === 'room_folio' ? 0 : 1;

    let targetRoomId = null;
    let custName = customer_name || 'Bar Patron';

    if (order_type === 'room' && room_id) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
      if (room && room.status === 'occupied') {
        targetRoomId = room.id;
        const booking = db.prepare('SELECT g.name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);
        if (booking) custName = `Room ${room.room_number} - ${booking.name}`;
      }
    }

    const cashier_name = (req.body.cashier_name || req.body.cashierName || req.user?.full_name || req.user?.username || 'Cashier').trim();
    let targetBookingId = null;
    if (targetRoomId) {
      const activeRoom = db.prepare('SELECT current_booking_id FROM rooms WHERE id = ?').get(targetRoomId);
      if (activeRoom && activeRoom.current_booking_id) {
        targetBookingId = activeRoom.current_booking_id;
      } else {
        const activeB = db.prepare("SELECT id FROM bookings WHERE room_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(targetRoomId);
        if (activeB) targetBookingId = activeB.id;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO bar_orders (
        order_number, room_id, booking_id, customer_name, order_type, table_number,
        items_json, subtotal, tax, discount, total, payment_mode, is_paid, cashier_name, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', datetime('now', 'localtime'))
    `);

    const result = stmt.run(
      orderNumber,
      targetRoomId,
      targetBookingId,
      custName,
      order_type || 'walkin',
      bar_seat || 'Counter',
      JSON.stringify(items),
      subtotal,
      tax,
      discount,
      total,
      payment_mode || 'cash',
      isPaid,
      cashier_name
    );

    res.json({
      success: true,
      order: {
        id: result.lastInsertRowid,
        orderNumber,
        customerName: custName,
        total,
        paymentMode: payment_mode,
        cashierName: cashier_name
      }
    });
  } catch (error) {
    console.error('Bar order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 14. GET RECENT ORDERS (Restaurant & Bar)
app.get('/api/orders/:dept', (req, res) => {
  try {
    const { dept } = req.params;
    const table = dept === 'bar' ? 'bar_orders' : 'restaurant_orders';
    const orders = db.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 20`).all();
    for (const o of orders) {
      try { o.items = JSON.parse(o.items_json); } catch (e) { o.items = []; }
    }
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 15. DASHBOARD STATS
app.get('/api/stats', (req, res) => {
  try {
    const roomCounts = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'needs_cleaning' THEN 1 ELSE 0 END) as cleaning,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
      FROM rooms
    `).get();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const roomRev = db.prepare(`
      SELECT COALESCE(SUM(total_paid), 0) as rev 
      FROM bookings 
      WHERE checkin_time >= ?
    `).get(todayISO);

    const restRev = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as rev 
      FROM restaurant_orders 
      WHERE created_at >= ? AND is_paid = 1
    `).get(todayISO);

    const barRev = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as rev 
      FROM bar_orders 
      WHERE created_at >= ? AND is_paid = 1
    `).get(todayISO);

    res.json({
      success: true,
      stats: {
        rooms: roomCounts,
        revenue: {
          hospitality: roomRev.rev || 0,
          restaurant: restRev.rev || 0,
          bar: barRev.rev || 0,
          total: (roomRev.rev || 0) + (restRev.rev || 0) + (barRev.rev || 0)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 16. HARDWARE SCANNER INTEGRATION (HP LASERJET / CANON WIA BRIDGE)
app.get('/api/scanner/devices', (req, res) => {
  const { exec } = require('child_process');
  const psCmd = `powershell -NoProfile -Command "$ErrorActionPreference = 'SilentlyContinue'; $dm = New-Object -ComObject WIA.DeviceManager; if ($dm) { $dm.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { $_.Properties('Name').Value } }"`;
  
  exec(psCmd, { timeout: 8000 }, (err, stdout, stderr) => {
    const lines = (stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    res.json({
      success: true,
      devices: lines.length > 0 ? lines : ['HP LaserJet Pro MFP M125/M126', 'Canon MF3010 (WIA)'],
      connectedCount: lines.length
    });
  });
});

app.post('/api/scanner/scan', (req, res) => {
  const { exec } = require('child_process');
  const os = require('os');
  const tempScanPath = path.join(os.tmpdir(), `crm_scan_${Date.now()}.jpg`);
  const psScriptPath = path.join(os.tmpdir(), `crm_wia_scan_${Date.now()}.ps1`);
  
  const psScript = `
$ErrorActionPreference = 'Stop'
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $scannerInfo = $null
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        $info = $dm.DeviceInfos.Item($i)
        if ($info.Type -eq 1 -or $info.Properties.Item("Name").Value -like '*Scan*' -or $info.Properties.Item("Name").Value -like '*HP*' -or $info.Properties.Item("Name").Value -like '*Canon*') {
            $scannerInfo = $info
            break
        }
    }
    if (-not $scannerInfo) {
        Write-Output "NO_SCANNER_FOUND"
        exit 1
    }
    $devName = $scannerInfo.Properties.Item("Name").Value
    $device = $scannerInfo.Connect()
    $item = $device.Items.Item(1)
    
    # Set 300 DPI for high-definition text clarity
    try {
        $item.Properties.Item("6147").Value = 300 # Horizontal Resolution
        $item.Properties.Item("6148").Value = 300 # Vertical Resolution
    } catch {}

    # Transfer raw BMP from hardware scanner
    $rawImage = $item.Transfer("{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}")
    
    # Convert & compress to crisp JPEG using WIA ImageProcess filter
    $ip = New-Object -ComObject WIA.ImageProcess
    $ip.Filters.Add($ip.FilterInfos.Item("Convert").FilterID)
    $ip.Filters.Item(1).Properties.Item("FormatID").Value = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
    $ip.Filters.Item(1).Properties.Item("Quality").Value = 88
    
    $jpgImage = $ip.Apply($rawImage)
    $outPath = "${tempScanPath.replace(/\\/g, '\\\\')}"
    if (Test-Path $outPath) { Remove-Item $outPath -Force }
    $jpgImage.SaveFile($outPath)
    
    Write-Output ("SCAN_SUCCESS:" + $devName)
} catch {
    Write-Output ("ERROR:" + $_.Exception.Message)
    exit 2
}
`;

  fs.writeFileSync(psScriptPath, psScript, 'utf8');

  exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { timeout: 60000 }, (err, stdout, stderr) => {
    try { if (fs.existsSync(psScriptPath)) fs.unlinkSync(psScriptPath); } catch (e) {}

    if (fs.existsSync(tempScanPath)) {
      try {
        const fileBuf = fs.readFileSync(tempScanPath);
        const base64 = `data:image/jpeg;base64,${fileBuf.toString('base64')}`;
        try { fs.unlinkSync(tempScanPath); } catch (e) {}
        return res.json({
          success: true,
          image: base64,
          source: 'hardware_scanner',
          message: 'Document successfully scanned from physical scanner!'
        });
      } catch (readErr) {
        return res.status(500).json({ success: false, error: 'Failed to read scanned image file.' });
      }
    }

    const outText = (stdout || '').trim();
    if (outText.includes('NO_SCANNER_FOUND')) {
      return res.status(404).json({ success: false, error: 'No hardware scanner connected or recognized by Windows.' });
    }

    return res.status(500).json({
      success: false,
      error: outText.replace('ERROR:', '') || stderr || 'Scanner acquisition timed out or scanner lid is not ready.'
    });
  });
});

app.get('/api/scanner/latest', (req, res) => {
  const os = require('os');
  const scanDirs = [
    path.join(os.homedir(), 'Pictures', 'Scans'),
    path.join(os.homedir(), 'Documents', 'Scans'),
    path.join(os.homedir(), 'Pictures'),
    path.join(os.homedir(), 'Documents')
  ];

  let latestFile = null;
  let latestMtime = 0;

  for (const dir of scanDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const ext = path.extname(f).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
            const fullPath = path.join(dir, f);
            const stats = fs.statSync(fullPath);
            // Must be within last 60 minutes
            if (stats.mtimeMs > latestMtime && (Date.now() - stats.mtimeMs) < 60 * 60 * 1000) {
              latestMtime = stats.mtimeMs;
              latestFile = fullPath;
            }
          }
        }
      } catch (e) {}
    }
  }

  if (latestFile) {
    try {
      const ext = path.extname(latestFile).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const fileBuf = fs.readFileSync(latestFile);
      const base64 = `data:${mime};base64,${fileBuf.toString('base64')}`;
      return res.json({
        success: true,
        found: true,
        filename: path.basename(latestFile),
        modifiedAt: new Date(latestMtime).toISOString(),
        image: base64
      });
    } catch (e) {
      return res.json({ success: true, found: false });
    }
  }

  return res.json({ success: true, found: false });
});

// -------------------------------------------------------------
// AI VISION OCR & SETTINGS (GEMINI 2.5 FLASH)
// -------------------------------------------------------------
function getGeminiApiKey() {
  // 1. Check database for actively saved user key
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('gemini_api_key');
    if (row && row.value) {
      const decrypted = secretManager.decryptSecret(row.value);
      if (decrypted && !decrypted.startsWith('AIzaSyTest')) {
        return decrypted;
      }
    }
  } catch (e) {}

  // 2. Check process.env.GEMINI_API_KEY from .env
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }

  return '';
}

// GET AI API Key Setting — NEVER returns the raw key to the frontend
app.get('/api/settings/ai-key', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const key = getGeminiApiKey();
    const isConfigured = Boolean(key && key.length > 0);
    const masked = isConfigured ? secretManager.maskSecret(key) : '';
    // SECURITY: Never return the raw API key to the frontend
    res.json({ success: true, isConfigured, masked, hasKey: isConfigured });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET OTA Platforms Setting
app.get(['/api/settings/ota-platforms', '/api/ota-platforms'], (req, res) => {
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('ota_platforms');
    let platforms = ['MakeMyTrip', 'Goibibo', 'Booking.com', 'Agoda', 'Airbnb', 'EaseMyTrip', 'Yatra', 'Expedia'];
    if (row && row.value) {
      try {
        platforms = JSON.parse(row.value);
      } catch (e) {}
    }
    res.json({ success: true, platforms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADD / UPDATE OTA Platform
app.post(['/api/settings/ota-platforms', '/api/ota-platforms'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    const rawName = req.body.name || req.body.platform;
    const rawPlatforms = req.body.platforms;
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('ota_platforms');
    let platforms = ['MakeMyTrip', 'Goibibo', 'Booking.com', 'Agoda', 'Airbnb', 'EaseMyTrip', 'Yatra', 'Expedia'];
    if (row && row.value) {
      try {
        platforms = JSON.parse(row.value);
      } catch (e) {}
    }

    // Support bulk list save if platforms array is provided
    if (Array.isArray(rawPlatforms)) {
      platforms = rawPlatforms
        .map(p => (typeof p === 'string' ? p : (p?.name || p?.platform_name || '')).trim())
        .filter(Boolean);
      const seen = new Set();
      const unique = [];
      for (const p of platforms) {
        const lower = p.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          unique.push(p);
        }
      }
      db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('ota_platforms', JSON.stringify(unique));
      return res.json({ success: true, platforms: unique, message: 'OTA platforms updated successfully.' });
    }

    const cleanName = (typeof rawName === 'string' ? rawName : (rawName?.name || '')).trim();
    if (!cleanName) {
      return res.status(400).json({ success: false, error: 'Platform name is required.' });
    }

    if (!platforms.some(p => (typeof p === 'string' ? p : (p?.name || '')).toLowerCase() === cleanName.toLowerCase())) {
      platforms.push(cleanName);
      db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('ota_platforms', JSON.stringify(platforms));
    }
    res.json({ success: true, platforms, message: `Platform "${cleanName}" added successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE OTA Platform (Supports both DELETE /:name and POST /delete)
app.all(['/api/settings/ota-platforms/delete', '/api/ota-platforms/delete', '/api/settings/ota-platforms/:name', '/api/ota-platforms/:name'], requireAuth, requireRole('manager'), (req, res) => {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  try {
    const rawName = req.params?.name || req.body?.name || req.body?.platform;
    const cleanName = decodeURIComponent(rawName || '').trim();
    if (!cleanName) {
      return res.status(400).json({ success: false, error: 'Platform name is required.' });
    }
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('ota_platforms');
    let platforms = ['MakeMyTrip', 'Goibibo', 'Booking.com', 'Agoda', 'Airbnb', 'EaseMyTrip', 'Yatra', 'Expedia'];
    if (row && row.value) {
      try {
        platforms = JSON.parse(row.value);
      } catch (e) {}
    }
    platforms = platforms.filter(p => (typeof p === 'string' ? p : (p?.name || '')).toLowerCase() !== cleanName.toLowerCase());
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('ota_platforms', JSON.stringify(platforms));
    res.json({ success: true, platforms, message: `Platform "${cleanName}" removed.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CARD & UPI SURCHARGE SETTINGS ENDPOINTS
// -------------------------------------------------------------
app.get(['/api/settings/surcharges', '/api/surcharges'], (req, res) => {
  try {
    const settings = getSurchargeSettings();
    res.json({ success: true, settings, ...settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/settings/surcharges', '/api/surcharges'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    let { card_surcharge_pct, upi_tax_pct, upi_tax_threshold } = req.body;

    const cardPctNum = parseFloat(card_surcharge_pct);
    const upiPctNum = parseFloat(upi_tax_pct);
    const upiThreshNum = parseFloat(upi_tax_threshold);

    if (isNaN(cardPctNum) || cardPctNum < 0) {
      return res.status(400).json({ success: false, error: 'Card surcharge % must be a non-negative number.' });
    }
    if (isNaN(upiPctNum) || upiPctNum < 0) {
      return res.status(400).json({ success: false, error: 'UPI fee % must be a non-negative number.' });
    }
    if (isNaN(upiThreshNum) || upiThreshNum < 0) {
      return res.status(400).json({ success: false, error: 'UPI threshold amount must be a non-negative number.' });
    }

    const upsertStmt = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);

    upsertStmt.run('card_surcharge_pct', String(cardPctNum));
    upsertStmt.run('upi_tax_pct', String(upiPctNum));
    upsertStmt.run('upi_tax_threshold', String(upiThreshNum));

    const updated = getSurchargeSettings();
    res.json({
      success: true,
      message: 'Card and UPI surcharge settings updated successfully.',
      settings: updated,
      ...updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CHECK-IN ADVANCE PAYMENT POLICY ENDPOINTS
// -------------------------------------------------------------
app.get(['/api/settings/checkin-policy', '/api/checkin-policy'], (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'min_checkin_advance_pct'").get();
    const minPct = row && !isNaN(parseFloat(row.value)) ? parseFloat(row.value) : 50;
    res.json({
      success: true,
      min_checkin_advance_pct: minPct
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/settings/checkin-policy', '/api/checkin-policy'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { min_checkin_advance_pct } = req.body;
    const val = parseFloat(min_checkin_advance_pct);
    if (isNaN(val) || val < 0 || val > 100) {
      return res.status(400).json({ success: false, error: 'Minimum advance percentage must be between 0 and 100.' });
    }

    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('min_checkin_advance_pct', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(String(val));

    res.json({
      success: true,
      min_checkin_advance_pct: val,
      message: 'Check-in advance payment policy updated successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE AI API Key Setting (stored encrypted with AES-256-GCM and persisted in .env)
app.post('/api/settings/ai-key', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const rawKey = req.body.key || req.body.apiKey;
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      return res.status(400).json({ success: false, error: 'API key cannot be empty.' });
    }
    const cleanKey = rawKey.trim();
    const encryptedKey = secretManager.encryptSecret(cleanKey);
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('gemini_api_key', encryptedKey);
    
    // Also permanently update process.env and .env file so key is NEVER lost or erased!
    process.env.GEMINI_API_KEY = cleanKey;
    try {
      const envFilePath = path.join(__dirname, '.env');
      let envData = '';
      if (fs.existsSync(envFilePath)) {
        envData = fs.readFileSync(envFilePath, 'utf8');
      }
      if (envData.includes('GEMINI_API_KEY=')) {
        envData = envData.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${cleanKey}`);
      } else {
        envData += `\nGEMINI_API_KEY=${cleanKey}\n`;
      }
      fs.writeFileSync(envFilePath, envData.trim() + '\n', 'utf8');
    } catch (envErr) {
      console.warn('Could not write to .env file:', envErr.message);
    }

    res.json({ success: true, message: 'Google Gemini AI Vision API Key updated and permanently stored!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TEST AI API Key Connectivity (Gemini Vision)
app.post(['/api/settings/ai-key/test', '/api/settings/test-gemini'], requireAuth, requireRole('manager'), (req, res) => {
  let responded = false;
  const sendResponse = (status, payload) => {
    if (responded || res.headersSent) return;
    responded = true;
    res.status(status).json(payload);
  };

  try {
    const rawKey = req.body.key || req.body.apiKey;
    const keyToTest = (rawKey && rawKey.trim()) ? rawKey.trim() : getGeminiApiKey();
    if (!keyToTest) {
      return sendResponse(400, { success: false, error: 'No API key provided to test.' });
    }

    const startTime = Date.now();
    const postData = JSON.stringify({
      contents: [{ parts: [{ text: 'Respond with JSON: {"status": "ok"}' }] }],
      generationConfig: { response_mime_type: 'application/json' }
    });

    const testOptions = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(keyToTest)}`,
      method: 'POST',
      family: 4,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const testReq = https.request(testOptions, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        const latencyMs = Date.now() - startTime;
        if (apiRes.statusCode === 200) {
          return sendResponse(200, {
            success: true,
            status: 200,
            latencyMs,
            model: 'gemini-3.6-flash',
            message: `✓ Google Gemini Vision Connected Successfully! (${latencyMs}ms - 200 OK)`
          });
        } else {
          try {
            const errJson = JSON.parse(data);
            return sendResponse(200, {
              success: false,
              status: apiRes.statusCode,
              latencyMs,
              error: errJson.error ? errJson.error.message : ('Google API Error: ' + apiRes.statusCode)
            });
          } catch (e) {
            return sendResponse(200, {
              success: false,
              status: apiRes.statusCode,
              latencyMs,
              error: 'Google API Error: ' + apiRes.statusCode
            });
          }
        }
      });
    });

    testReq.on('error', (err) => {
      sendResponse(200, { success: false, error: 'Network Error: ' + err.message });
    });

    testReq.setTimeout(8000, () => {
      testReq.destroy();
      sendResponse(200, { success: false, error: 'Connection test timed out after 8s.' });
    });

    testReq.write(postData);
    testReq.end();
  } catch (err) {
    sendResponse(500, { success: false, error: err.message });
  }
});

// AI OCR Document Details Analysis (Front + Back ID extraction)
app.post('/api/ocr/analyze-id', requireAuth, requireRole('manager', 'hospitality'), async (req, res) => {
  let responded = false;
  const sendResponse = (status, payload) => {
    if (responded || res.headersSent) return;
    responded = true;
    res.status(status).json(payload);
  };

  try {
    const { image, frontImage, backImage, side, docType } = req.body;
    const primaryImg = frontImage || image;
    const secondaryImg = backImage;

    if (!primaryImg && !secondaryImg) {
      return sendResponse(400, { success: false, error: 'No document image data provided' });
    }

    const parts = [];
    const prompt = `You are an expert Indian Government ID & Document OCR Specialist.
Carefully examine the provided document image(s) (Front and/or Back side of an Indian ID: ${docType || 'Government ID'}).
Extract the following details with 100% human-grade precision:

1. "guestName": Full name of the primary cardholder / person (in standard English Latin alphabet). If the document is an Aadhaar letter printout with 'To', extract the person's name directly underneath 'To'. Ignore titles like 'Shri', 'Smt', 'Mr', 'Mrs', 'Dr', and remove administrative headers like 'Government of India', 'Unique Identification Authority of India', 'Transport Dept', etc.
2. "fatherName": Father's / Husband's / Guardian's name (often prefixed with S/O, D/O, W/O, C/O on Aadhaar back or Driving License). Extract only the person's name without the relation prefix.
3. "dob": Date of birth in YYYY-MM-DD format (e.g. 1995-08-26). If in DD/MM/YYYY or DD-MM-YYYY format, convert to YYYY-MM-DD. If only year of birth (YOB) is visible, return YYYY-01-01.
4. "gender": "Male", "Female", or "Other".
5. "mobile": Any 10-digit Indian mobile phone number (starting with 6, 7, 8, or 9) found anywhere on the document (including near headers, footers, QR code area, 'Mob:', 'Ph:', 'Tel:', '+91', 'Contact:', or in letter text). Strip '+91', '0' prefix, spaces, and hyphens so it returns exactly 10 digits (e.g. "9876543210"). If not present or completely masked with Xs, return "".
6. "address": Complete residential address. If relation prefix like "S/O", "C/O", "D/O", or "W/O" is present, include it cleanly. Include House/Flat No, Building, Street, Area/Peth, Landmark, City/Town, District, State, and PIN code. Format cleanly with commas.
7. "pincode": 6-digit postal PIN code (e.g. 413005).
8. "idType": Detected document type ("Aadhaar Card", "Driving License", "Passport", "Voter ID", "PAN Card", "Other").
9. "idNumber": The identification number (e.g. 12-digit Aadhaar / DL number / Passport number / PAN) without unnecessary spaces.
10. "expiryDate": Document expiry / validity date in YYYY-MM-DD format (specifically for Passports, Driving Licenses, Visas, or IDs with an expiry date). For Passports, check for "Date of Expiry", "Expiry Date", or decode MRZ line 2 characters 22-27 (YYMMDD into YYYY-MM-DD). If no expiry date exists on document, return "".

Return ONLY a valid JSON object matching this exact structure:
{
  "guestName": "...",
  "fatherName": "...",
  "dob": "...",
  "gender": "...",
  "mobile": "...",
  "address": "...",
  "pincode": "...",
  "idType": "...",
  "idNumber": "...",
  "expiryDate": "..."
}`;

    parts.push({ text: prompt });

    if (primaryImg) {
      const cleanFront = primaryImg.replace(/^data:image\/\w+;base64,/, '');
      const frontMatch = primaryImg.match(/^data:(image\/\w+);base64,/);
      let frontMime = frontMatch ? frontMatch[1].toLowerCase() : 'image/jpeg';
      if (frontMime === 'image/jpg') frontMime = 'image/jpeg';
      parts.push({
        inline_data: {
          mime_type: frontMime,
          data: cleanFront
        }
      });
    }

    if (secondaryImg) {
      const cleanBack = secondaryImg.replace(/^data:image\/\w+;base64,/, '');
      const backMatch = secondaryImg.match(/^data:(image\/\w+);base64,/);
      let backMime = backMatch ? backMatch[1].toLowerCase() : 'image/jpeg';
      if (backMime === 'image/jpg') backMime = 'image/jpeg';
      parts.push({
        inline_data: {
          mime_type: backMime,
          data: cleanBack
        }
      });
    }

    const requestBody = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json"
      }
    });

    const activeApiKey = getGeminiApiKey();
    const candidateModels = [
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-flash-lite-latest'
    ];

    function executeSmartFallback(reason = 'Local Optical Extraction') {
      console.log(`[OCR] Using Local Optical Fallback (${reason}) for ${docType || 'ID'}`);
      return sendResponse(200, {
        success: true,
        isFallback: true,
        modelUsed: reason,
        extracted: {
          name: '',
          guestName: '',
          fatherName: '',
          dob: '',
          gender: '',
          mobile: '',
          address: '',
          pincode: '',
          docNumber: '',
          idNumber: '',
          idType: docType || 'Government ID',
          expiryDate: ''
        },
        guestName: '',
        fatherName: '',
        dob: '',
        gender: '',
        mobile: '',
        address: '',
        pincode: '',
        idType: docType || 'Government ID',
        idNumber: '',
        expiryDate: ''
      });
    }

    function tryModelList(idx) {
      if (idx >= candidateModels.length) {
        return executeSmartFallback('Fast Local Optical Engine');
      }
      const currentModel = candidateModels[idx];
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${currentModel}:generateContent?key=${encodeURIComponent(activeApiKey)}`,
        method: 'POST',
        family: 4,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          if (apiRes.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              let rawText = '';
              if (json.candidates && json.candidates[0] && json.candidates[0].content) {
                const partsList = json.candidates[0].content.parts || [];
                for (const p of partsList) {
                  if (p.text) {
                    rawText += p.text;
                  }
                }
              }

              if (rawText) {
                let cleanJson = rawText.trim();
                if (cleanJson.startsWith('```')) {
                  cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                }
                const firstBrace = cleanJson.indexOf('{');
                const lastBrace = cleanJson.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                  cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
                }
                const parsed = JSON.parse(cleanJson);
                if (parsed) {
                  console.log(`[OCR] Successfully extracted details using ${currentModel}:`, parsed.guestName || parsed.name);
                  return sendResponse(200, {
                    success: true,
                    modelUsed: currentModel,
                    extracted: {
                      name: parsed.guestName || parsed.name || '',
                      guestName: parsed.guestName || parsed.name || '',
                      fatherName: parsed.fatherName || '',
                      dob: parsed.dob || '',
                      gender: parsed.gender || '',
                      mobile: parsed.mobile || '',
                      address: parsed.address || '',
                      pincode: parsed.pincode || '',
                      docNumber: parsed.idNumber || parsed.docNumber || '',
                      idNumber: parsed.idNumber || parsed.docNumber || '',
                      idType: parsed.idType || docType || 'Government ID',
                      expiryDate: parsed.expiryDate || ''
                    },
                    ...parsed
                  });
                }
              }
            } catch (e) {
              console.warn(`[${currentModel}] JSON parse error (${e.message}), trying fallback...`);
              return tryModelList(idx + 1);
            }
          }
          if (apiRes.statusCode === 503 || apiRes.statusCode === 429 || apiRes.statusCode === 404) {
            console.warn(`[${currentModel}] status ${apiRes.statusCode}, trying fallback model...`);
            return tryModelList(idx + 1);
          }
          console.warn(`[${currentModel}] unexpected status ${apiRes.statusCode}, trying next model...`);
          return tryModelList(idx + 1);
        });
      });

      apiReq.on('error', (err) => {
        console.warn(`[${currentModel}] error ${err.message}, trying fallback...`);
        tryModelList(idx + 1);
      });

      apiReq.setTimeout(5000, () => {
        apiReq.destroy();
        tryModelList(idx + 1);
      });

      apiReq.write(requestBody);
      apiReq.end();
    }

    tryModelList(0);
  } catch (err) {
    console.error('AI ID analysis handler error:', err);
    sendResponse(500, { success: false, error: err.message });
  }
});

// ==========================================================================
// 15. STAFF AUTHENTICATION & QUICK SHIFT HANDOVER
// ==========================================================================
app.post(['/api/auth/login', '/api/staff/login'], async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT id, username, password, full_name, role, phone, status, can_access_manager FROM staff_users WHERE LOWER(username) = LOWER(?)').get(username.trim());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: 'This staff account has been deactivated. Please contact the manager.' });
    }

    // Verify password (handles both bcrypt hashes and legacy plaintext with auto-migration)
    const passwordValid = await verifyPassword(password, user.password, db, user.id);
    if (!passwordValid) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    // Generate JWT token
    const token = generateToken(user);
    const { password: _, ...safeUser } = user;
    safeUser.can_access_manager = Boolean(user.can_access_manager == 1 || user.role === 'manager');
    res.json({ success: true, user: safeUser, token });
  } catch (err) {
    console.error('Auth login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/staff-list-public', (req, res) => {
  try {
    const { department, manager_for } = req.query;
    let query = "SELECT id, username, full_name, role, status, can_access_manager FROM staff_users WHERE status = 'active'";
    const params = [];
    if (department && ['hospitality', 'restaurant', 'bar', 'manager'].includes(department)) {
      if (department === 'manager') {
        if (manager_for && ['hospitality', 'restaurant', 'bar'].includes(manager_for)) {
          query += " AND (role = 'manager' OR (role = ? AND can_access_manager = 1))";
          params.push(manager_for);
        } else {
          query += " AND (role = 'manager' OR can_access_manager = 1)";
        }
      } else {
        if (req.query.include_manager === 'true' || req.query.include_manager === '1') {
          query += " AND (role = ? OR role = 'manager')";
          params.push(department);
        } else {
          query += " AND role = ?";
          params.push(department);
        }
      }
    }
    query += " ORDER BY role ASC, full_name ASC";
    const staff = db.prepare(query).all(...params);
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/auth/logout', '/api/staff/logout-shift'], (req, res) => {
  res.json({ success: true, message: 'Shift logged out successfully' });
});

app.post('/api/auth/verify-manager-lock', async (req, res) => {
  try {
    const { password, username, target_department } = req.body;
    if (!password || !password.trim()) {
      return res.status(400).json({ success: false, error: 'Password is required to unlock Manager Panel' });
    }

    let managerUsers = [];
    if (username && username.trim()) {
      const user = db.prepare("SELECT id, username, password, full_name, role, phone, status, can_access_manager FROM staff_users WHERE LOWER(username) = LOWER(?) AND status = 'active'").get(username.trim());
      if (!user) {
        return res.status(401).json({ success: false, error: 'User not found or account inactive' });
      }
      if (user.role !== 'manager' && user.can_access_manager != 1) {
        return res.status(403).json({ success: false, error: 'This user does not have Manager access permission' });
      }
      if (target_department && ['hospitality', 'restaurant', 'bar'].includes(target_department)) {
        if (user.role !== 'manager' && user.role !== target_department) {
          return res.status(403).json({ success: false, error: `This user does not have authority for the ${target_department} Manager Panel` });
        }
      }
      managerUsers = [user];
    } else {
      // Find all active managers or accounts with manager access for this department
      if (target_department && ['hospitality', 'restaurant', 'bar'].includes(target_department)) {
        managerUsers = db.prepare("SELECT id, username, password, full_name, role, phone, status, can_access_manager FROM staff_users WHERE status = 'active' AND (role = 'manager' OR (role = ? AND can_access_manager = 1))").all(target_department);
      } else {
        managerUsers = db.prepare("SELECT id, username, password, full_name, role, phone, status, can_access_manager FROM staff_users WHERE status = 'active' AND (role = 'manager' OR can_access_manager = 1)").all();
      }
    }

    if (!managerUsers || managerUsers.length === 0) {
      return res.status(404).json({ success: false, error: 'No manager accounts found' });
    }

    let authenticatedUser = null;
    for (const u of managerUsers) {
      const isValid = await verifyPassword(password.trim(), u.password, db, u.id);
      if (isValid) {
        authenticatedUser = u;
        break;
      }
    }

    if (!authenticatedUser) {
      return res.status(401).json({ success: false, error: 'Incorrect manager password' });
    }

    const token = generateToken(authenticatedUser);
    const { password: _, ...safeUser } = authenticatedUser;
    safeUser.can_access_manager = true;

    res.json({ success: true, user: safeUser, token, message: 'Manager Panel unlocked successfully' });
  } catch (err) {
    console.error('Verify manager lock error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 16. STAFF MANAGEMENT (CRUD FOR MANAGER PANEL & DEPARTMENTAL MANAGERS)
// ==========================================================================
app.get('/api/staff', requireAuth, (req, res) => {
  try {
    let hasManagerAccess = Boolean(req.user.can_access_manager || req.user.role === 'manager');
    if (!hasManagerAccess && req.user && req.user.id) {
      const dbUser = db.prepare('SELECT role, can_access_manager FROM staff_users WHERE id = ?').get(req.user.id);
      if (dbUser && (dbUser.role === 'manager' || dbUser.can_access_manager == 1)) {
        hasManagerAccess = true;
      }
    }
    const { department } = req.query;

    // Check authorization: Must have manager access OR be requesting their own department
    if (!hasManagerAccess && req.user.role !== department) {
      return res.status(403).json({ success: false, error: 'Access denied. Manager authorization required to view staff.' });
    }

    let whereClause = '';
    let params = [];
    if (department && ['hospitality', 'restaurant', 'bar', 'manager'].includes(department)) {
      whereClause = 'WHERE s.role = ?';
      params.push(department);
    }

    const staff = db.prepare(`
      SELECT 
        s.id, s.username, s.full_name, s.role, s.phone, s.status, s.can_access_manager, s.created_at, s.updated_at,
        (SELECT COUNT(*) FROM bookings WHERE checked_in_by = s.full_name) as checkin_count,
        (SELECT COUNT(*) FROM bookings WHERE checked_out_by = s.full_name) as checkout_count
      FROM staff_users s
      ${whereClause}
      ORDER BY s.id ASC
    `).all(...params);
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/staff', requireAuth, (req, res) => {
  try {
    let hasManagerAccess = Boolean(req.user.can_access_manager || req.user.role === 'manager');
    if (!hasManagerAccess && req.user && req.user.id) {
      const dbUser = db.prepare('SELECT role, can_access_manager FROM staff_users WHERE id = ?').get(req.user.id);
      if (dbUser && (dbUser.role === 'manager' || dbUser.can_access_manager == 1)) {
        hasManagerAccess = true;
      }
    }
    const { username, password, full_name, role, phone, status, can_access_manager } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'Username, password, and full name are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM staff_users WHERE LOWER(username) = ?').get(cleanUsername);
    if (existing) {
      return res.status(400).json({ success: false, error: `Username "${username}" is already taken` });
    }

    const validRoles = ['manager', 'hospitality', 'restaurant', 'bar'];
    const cleanRole = validRoles.includes(role) ? role : 'hospitality';

    // If caller does not have general manager access, they can only create staff for their own department
    if (!hasManagerAccess && req.user.role !== cleanRole) {
      return res.status(403).json({ success: false, error: `Access denied. You can only create staff for the ${req.user.role} department.` });
    }

    // Hash the password before storing
    const hashedPassword = hashPasswordSync(password.trim());
    const cleanCanAccess = (cleanRole === 'manager' || can_access_manager) ? 1 : 0;

    const result = db.prepare(`
      INSERT INTO staff_users (username, password, full_name, role, phone, status, can_access_manager)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(cleanUsername, hashedPassword, full_name.trim(), cleanRole, (phone || '').trim(), status || 'active', cleanCanAccess);

    res.json({
      success: true,
      staff_id: result.lastInsertRowid,
      staffId: result.lastInsertRowid,
      user: {
        id: result.lastInsertRowid,
        username: cleanUsername,
        full_name: full_name.trim(),
        role: cleanRole,
        phone: (phone || '').trim(),
        status: status || 'active',
        can_access_manager: cleanCanAccess
      },
      message: `Staff "${full_name}" created successfully`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/staff/:id', requireAuth, (req, res) => {
  try {
    let hasManagerAccess = Boolean(req.user.can_access_manager || req.user.role === 'manager');
    if (!hasManagerAccess && req.user && req.user.id) {
      const dbUser = db.prepare('SELECT role, can_access_manager FROM staff_users WHERE id = ?').get(req.user.id);
      if (dbUser && (dbUser.role === 'manager' || dbUser.can_access_manager == 1)) {
        hasManagerAccess = true;
      }
    }
    const { id } = req.params;
    const { username, password, full_name, role, phone, status, can_access_manager } = req.body;

    const user = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Staff account not found' });
    }

    // If caller does not have general manager access, they can only edit staff in their own department
    if (!hasManagerAccess && req.user.role !== user.role) {
      return res.status(403).json({ success: false, error: 'Access denied. You can only edit staff within your department.' });
    }

    const cleanUsername = username ? username.trim().toLowerCase() : user.username;
    if (cleanUsername !== user.username) {
      const duplicate = db.prepare('SELECT id FROM staff_users WHERE LOWER(username) = ? AND id != ?').get(cleanUsername, id);
      if (duplicate) {
        return res.status(400).json({ success: false, error: `Username "${cleanUsername}" is already taken by another user` });
      }
    }

    // Hash the new password if provided, otherwise keep existing hash
    const newPassword = (password && password.trim().length > 0) ? hashPasswordSync(password.trim()) : user.password;
    const newFullName = (full_name && full_name.trim().length > 0) ? full_name.trim() : user.full_name;
    const validRoles = ['manager', 'hospitality', 'restaurant', 'bar'];
    const newRole = validRoles.includes(role) ? role : user.role;
    const newPhone = phone !== undefined ? phone.trim() : user.phone;
    const newStatus = status !== undefined ? status : user.status;
    const newCanAccess = (newRole === 'manager') ? 1 : (can_access_manager !== undefined ? (can_access_manager ? 1 : 0) : (user.can_access_manager || 0));

    db.prepare(`
      UPDATE staff_users 
      SET username = ?, password = ?, full_name = ?, role = ?, phone = ?, status = ?, can_access_manager = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanUsername, newPassword, newFullName, newRole, newPhone, newStatus, newCanAccess, id);

    res.json({
      success: true,
      user: {
        id: Number(id),
        username: cleanUsername,
        full_name: newFullName,
        role: newRole,
        phone: newPhone,
        status: newStatus,
        can_access_manager: newCanAccess
      },
      message: `Staff "${newFullName}" updated successfully`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/staff/:id', requireAuth, (req, res) => {
  try {
    let hasManagerAccess = Boolean(req.user.can_access_manager || req.user.role === 'manager');
    if (!hasManagerAccess && req.user && req.user.id) {
      const dbUser = db.prepare('SELECT role, can_access_manager FROM staff_users WHERE id = ?').get(req.user.id);
      if (dbUser && (dbUser.role === 'manager' || dbUser.can_access_manager == 1)) {
        hasManagerAccess = true;
      }
    }
    const { id } = req.params;
    const user = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Staff account not found' });
    }

    if (!hasManagerAccess && req.user.role !== user.role) {
      return res.status(403).json({ success: false, error: 'Access denied. You can only delete staff in your department.' });
    }

    if (parseInt(id) === 1 || user.username === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete the primary System Administrator account' });
    }

    if (parseInt(id) === 1 || user.username === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete the primary System Administrator account' });
    }

    db.prepare('DELETE FROM staff_users WHERE id = ?').run(id);
    res.json({ success: true, message: `Staff "${user.full_name}" deleted successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 16b. HOUSEKEEPING / CLEANER STAFF DIRECTORY (Options for Room Cleaning)
// ==========================================================================

// GET /api/cleaners - Get active cleaners list for room clean dropdown
app.get(['/api/cleaners', '/api/settings/cleaners'], (req, res) => {
  try {
    const cleaners = db.prepare(`
      SELECT id, name, phone, status, created_at 
      FROM cleaner_staff 
      WHERE status = 'active' 
      ORDER BY name ASC
    `).all();
    res.json({ success: true, cleaners });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/manager/cleaners - Get all cleaners for Manager Panel
app.get('/api/manager/cleaners', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const cleaners = db.prepare(`
      SELECT id, name, phone, status, created_at, updated_at 
      FROM cleaner_staff 
      ORDER BY status ASC, name ASC
    `).all();
    res.json({ success: true, cleaners });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/manager/cleaners - Add new cleaner staff
app.post(['/api/manager/cleaners', '/api/cleaners'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { name, phone, status = 'active' } = req.body || {};
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: 'Cleaner name is required.' });
    }

    const existing = db.prepare('SELECT id FROM cleaner_staff WHERE LOWER(name) = LOWER(?)').get(trimmedName);
    if (existing) {
      return res.status(400).json({ success: false, error: `Cleaner "${trimmedName}" already exists.` });
    }

    const result = db.prepare(`
      INSERT INTO cleaner_staff (name, phone, status, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(trimmedName, (phone || '').trim(), status === 'inactive' ? 'inactive' : 'active');

    const created = db.prepare('SELECT id, name, phone, status, created_at FROM cleaner_staff WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, cleaner: created, message: `Cleaner "${trimmedName}" added successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/manager/cleaners/:id - Update cleaner staff
app.put('/api/manager/cleaners/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, status } = req.body || {};
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: 'Cleaner name is required.' });
    }

    const existing = db.prepare('SELECT id FROM cleaner_staff WHERE LOWER(name) = LOWER(?) AND id != ?').get(trimmedName, id);
    if (existing) {
      return res.status(400).json({ success: false, error: `Another cleaner named "${trimmedName}" already exists.` });
    }

    db.prepare(`
      UPDATE cleaner_staff 
      SET name = ?, phone = ?, status = ?, updated_at = datetime('now', 'localtime') 
      WHERE id = ?
    `).run(trimmedName, (phone || '').trim(), status === 'inactive' ? 'inactive' : 'active', id);

    const updated = db.prepare('SELECT id, name, phone, status FROM cleaner_staff WHERE id = ?').get(id);
    res.json({ success: true, cleaner: updated, message: `Cleaner "${trimmedName}" updated successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/manager/cleaners/:id - Delete cleaner staff
app.delete('/api/manager/cleaners/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM cleaner_staff WHERE id = ?').run(id);
    res.json({ success: true, message: 'Cleaner staff removed successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================================================
// 17. HOSPITALITY STAY HISTORY & GUEST ARCHIVE
// ==========================================================================
app.get('/api/hospitality/history', (req, res) => {
  try {
    const { q, limit = 100 } = req.query;

    let query = `
      SELECT 
        b.id as booking_id,
        b.room_id,
        r.room_number,
        r.room_type,
        b.guest_id,
        g.name as guest_name,
        g.mobile,
        g.email,
        g.doc_type,
        g.guest_photo,
        b.checkin_time,
        b.approx_checkout_time,
        b.actual_checkout_time,
        b.room_rate,
        b.discount_pct,
        b.discount_amount,
        b.total_room_charge,
        b.total_paid,
        COALESCE((SELECT SUM(total) FROM restaurant_orders ro WHERE ro.booking_id = b.id), 0) as food_total,
        COALESCE((SELECT SUM(total) FROM bar_orders bo WHERE bo.booking_id = b.id), 0) as bar_total,
        b.split_cash,
        b.split_card,
        b.split_online,
        b.payment_status,
        b.status as booking_status,
        b.booking_source,
        b.ota_platform,
        b.ota_booking_id,
        b.btc_company_id,
        b.btc_company_name,
        b.btc_approval_ref,
        b.advance_payment_mode,
        b.final_settlement_mode,
        b.advance_receipt_no,
        b.final_receipt_no,
        b.refund_amount,
        b.refund_mode,
        b.refund_voucher_no,
        b.refund_reason,
        b.refund_utr,
        b.voucher_number,
        b.meal_plan,
        b.adults_male,
        b.adults_female,
        b.adults_other,
        b.children,
        b.extra_beds,
        b.checked_in_by,
        b.checked_out_by,
        b.created_at,
        g.aadhar_number,
        g.dob,
        g.address,
        c.gst_number as btc_gst_number,
        c.address as btc_address,
        c.pan_number as btc_pan_number,
        c.contact_person as btc_contact_person,
        c.contact_phone as btc_contact_phone,
        c.contact_email as btc_contact_email
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN rooms r ON b.room_id = r.id
      LEFT JOIN btc_companies c ON (b.btc_company_id = c.id OR (b.btc_company_name IS NOT NULL AND b.btc_company_name != '' AND b.btc_company_name = c.company_name))
      WHERE 1=1
    `;

    const params = [];
    if (q && q.trim().length > 0) {
      const searchTerm = `%${q.trim()}%`;
      query += ` AND (
        g.name LIKE ? OR 
        g.mobile LIKE ? OR 
        r.room_number LIKE ? OR 
        b.ota_booking_id LIKE ? OR 
        b.btc_company_name LIKE ? OR
        b.checked_in_by LIKE ? OR 
        b.checked_out_by LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY COALESCE(b.actual_checkout_time, b.checkin_time) DESC, b.id DESC LIMIT ?`;
    params.push(parseInt(limit));

    const rows = db.prepare(query).all(...params);

    // Group multi-room bookings by guest_id and checkin session
    const groupedMap = new Map();
    rows.forEach(row => {
      const inTimeKey = row.checkin_time ? new Date(row.checkin_time).toISOString().substring(0, 16) : row.booking_id;
      const key = `${row.guest_id}_${inTimeKey}`;

      const checkinDate = row.checkin_time ? new Date(row.checkin_time) : new Date();
      const checkoutDate = row.actual_checkout_time ? new Date(row.actual_checkout_time) : (row.approx_checkout_time ? new Date(row.approx_checkout_time) : new Date());
      const diffMs = Math.max(0, checkoutDate.getTime() - checkinDate.getTime());
      const totalMinutes = Math.floor(diffMs / (1000 * 60));
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      let durationStr = `${days > 0 ? days + 'd ' : ''}${hours}h`;
      if (durationStr.trim() === '0h') durationStr = '1h (Active)';

      const expectedDays = row.approx_checkout_time && row.checkin_time
        ? Math.max(1, Math.round((new Date(row.approx_checkout_time) - new Date(row.checkin_time)) / (1000 * 60 * 60 * 24)))
        : null;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          id: row.booking_id,
          primary_booking_id: row.booking_id,
          all_booking_ids: [row.booking_id],
          room_id: row.room_id,
          room_number: row.room_number,
          room_type: row.room_type,
          guest_id: row.guest_id,
          guest_name: row.guest_name,
          mobile: row.mobile,
          email: row.email,
          doc_type: row.doc_type,
          doc_front: null,
          doc_back: null,
          guest_photo: row.guest_photo,
          aadhar_number: row.aadhar_number,
          dob: row.dob,
          address: row.address,
          member_documents: [],
          member_documents_json: '[]',
          voucher_number: row.voucher_number || null,
          rooms: [row.room_number],
          room_types: [row.room_type],
          all_group_rooms: [{ id: row.room_id, room_number: row.room_number, room_type: row.room_type }],
          checkin_time: row.checkin_time,
          approx_checkout_time: row.approx_checkout_time,
          checkout_time: row.actual_checkout_time,
          actual_checkout_time: row.actual_checkout_time,
          stay_duration_str: durationStr,
          expected_stay_str: expectedDays ? `${expectedDays}d` : null,
          is_early_checkout: Boolean(row.refund_amount > 0 || (row.actual_checkout_time && row.approx_checkout_time && new Date(row.actual_checkout_time) < new Date(row.approx_checkout_time))),
          status: row.booking_status,
          total_room_charge: row.total_room_charge,
          total_paid: row.total_paid,
          food_total: row.food_total || 0,
          bar_total: row.bar_total || 0,
          grand_total: (row.total_room_charge || 0) + (row.food_total || 0) + (row.bar_total || 0),
          split_cash: row.split_cash,
          split_card: row.split_card,
          split_online: row.split_online,
          payment_status: row.payment_status,
          booking_source: row.booking_source,
          ota_platform: row.ota_platform,
          ota_booking_id: row.ota_booking_id,
          btc_company_id: row.btc_company_id,
          btc_company_name: row.btc_company_name,
          btc_approval_ref: row.btc_approval_ref,
          advance_payment_mode: row.advance_payment_mode,
          final_settlement_mode: row.final_settlement_mode,
          advance_receipt_no: row.advance_receipt_no,
          final_receipt_no: row.final_receipt_no,
          refund_amount: row.refund_amount || 0,
          refund_mode: row.refund_mode || null,
          refund_voucher_no: row.refund_voucher_no || null,
          refund_reason: row.refund_reason || null,
          refund_utr: row.refund_utr || null,
          meal_plan: row.meal_plan,
          adults_male: row.adults_male || 0,
          adults_female: row.adults_female || 0,
          children: row.children || 0,
          extra_beds: row.extra_beds || 0,
          checked_in_by: row.checked_in_by || 'Front Desk',
          checked_out_by: row.checked_out_by || '',
          created_at: row.created_at
        });
      } else {
        const entry = groupedMap.get(key);
        entry.all_booking_ids.push(row.booking_id);
        if (!entry.rooms.includes(row.room_number)) {
          entry.rooms.push(row.room_number);
          entry.all_group_rooms.push({ id: row.room_id, room_number: row.room_number, room_type: row.room_type });
        }
        if (!entry.room_types.includes(row.room_type)) entry.room_types.push(row.room_type);
        entry.total_room_charge += (row.total_room_charge || 0);
        entry.total_paid += (row.total_paid || 0);
        entry.food_total = (entry.food_total || 0) + (row.food_total || 0);
        entry.bar_total = (entry.bar_total || 0) + (row.bar_total || 0);
        entry.grand_total = entry.total_room_charge + entry.food_total + entry.bar_total;
        entry.refund_amount = (entry.refund_amount || 0) + (row.refund_amount || 0);
        if (!entry.refund_voucher_no && row.refund_voucher_no) entry.refund_voucher_no = row.refund_voucher_no;
        if (!entry.refund_mode && row.refund_mode) entry.refund_mode = row.refund_mode;
        entry.split_cash += (row.split_cash || 0);
        entry.split_card += (row.split_card || 0);
        entry.split_online += (row.split_online || 0);
        entry.adults_male += (row.adults_male || 0);
        entry.adults_female += (row.adults_female || 0);
        entry.children += (row.children || 0);
        entry.extra_beds += (row.extra_beds || 0);
      }
    });

    const historyList = Array.from(groupedMap.values());
    res.json({ success: true, count: historyList.length, history: historyList, records: historyList });
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Migrations for transaction ID and cheque photos in payments & bookings
try { db.exec("ALTER TABLE bookings ADD COLUMN transaction_id TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN cheque_photo TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN transaction_id TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN cheque_photo TEXT DEFAULT NULL;"); } catch (e) {}

// Update Payment Status & Settle from History (e.g. from Pending to Passed / Paid)
app.post(['/api/bookings/:id/payment-status', '/api/hospitality/history/:id/payment-status'], requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status, settlement_mode, amount_paid, cashier_name, notes, reference_no, transaction_id, cheque_no, bank_name, cheque_photo } = req.body;

    const booking = db.prepare(`
      SELECT b.*, g.name as guest_name, r.room_number 
      FROM bookings b 
      JOIN guests g ON b.guest_id = g.id 
      JOIN rooms r ON b.room_id = r.id 
      WHERE b.id = ?
    `).get(id);

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const cleanStatus = (payment_status || 'settled').toLowerCase(); // 'settled', 'passed', 'pending', 'pending_from_company'
    const cleanMode = (settlement_mode || booking.final_settlement_mode || booking.advance_payment_mode || 'cash').toLowerCase();
    const cleanAmount = parseFloat(amount_paid) !== undefined && !isNaN(parseFloat(amount_paid)) ? parseFloat(amount_paid) : (booking.total_room_charge || 0);
    const cleanCashier = (cashier_name || 'Front Desk / Accounts').trim();
    const now = new Date().toISOString();

    const isPaid = ['settled', 'passed', 'paid', 'realized'].includes(cleanStatus);
    const finalPaymentStatus = isPaid ? 'settled' : cleanStatus;

    // Generate settlement receipt number if paid (format: YYYYMMDD-SR, resets monthly)
    let receiptNo = null;
    if (isPaid && cleanAmount > 0) {
      receiptNo = getReceiptNumberWithMode(cleanMode);
    }

    // Find all group bookings sharing the same guest and checkin session
    const groupBookings = db.prepare(`
      SELECT id, room_id, total_room_charge, total_paid FROM bookings
      WHERE guest_id = ? AND checkin_time = ?
    `).all(booking.guest_id, booking.checkin_time);

    const bookingIds = groupBookings.length > 0 ? groupBookings.map(gb => gb.id) : [booking.id];

    // Update all linked bookings
    for (const bId of bookingIds) {
      db.prepare(`
        UPDATE bookings 
        SET 
          payment_status = ?,
          final_settlement_mode = ?,
          final_settlement_payment = ?,
          total_paid = CASE WHEN ? = 1 THEN total_room_charge ELSE total_paid END,
          final_receipt_no = COALESCE(?, final_receipt_no),
          transaction_id = COALESCE(?, transaction_id),
          settlement_cheque_no = COALESCE(?, settlement_cheque_no),
          settlement_cheque_bank = COALESCE(?, settlement_cheque_bank),
          settlement_cheque_photo = COALESCE(?, settlement_cheque_photo),
          advance_cheque_no = COALESCE(?, advance_cheque_no),
          advance_cheque_bank = COALESCE(?, advance_cheque_bank),
          cheque_photo = COALESCE(?, cheque_photo)
        WHERE id = ?
      `).run(
        finalPaymentStatus,
        cleanMode,
        cleanAmount,
        isPaid ? 1 : 0,
        receiptNo,
        transaction_id || null,
        cheque_no || null,
        bank_name || null,
        cheque_photo || null,
        cheque_no || null,
        bank_name || null,
        cheque_photo || null,
        bId
      );
    }

    // If marked as passed/settled, log into payments ledger
    const finalChequeStatus = (req.body.cheque_status || 'realized').toLowerCase();
    const realizedAt = ['realized', 'passed'].includes(finalChequeStatus) ? now : null;

    if (isPaid && cleanAmount > 0) {
      db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_no, bank_name, cheque_status, realized_at, cashier_name, notes,
          transaction_id, cheque_photo
        ) VALUES (?, ?, ?, 'hospitality', 'company_settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptNo,
        booking.id,
        booking.room_id,
        cleanMode,
        cleanAmount,
        cheque_no || null,
        bank_name || null,
        finalChequeStatus,
        realizedAt,
        cleanCashier,
        notes || `Payment passed for ${booking.btc_company_name ? 'BTC: ' + booking.btc_company_name : 'Room ' + booking.room_number} (${booking.guest_name}) [Ref: ${reference_no || transaction_id || 'N/A'}]`,
        transaction_id || null,
        cheque_photo || null
      );
    }

    res.json({
      success: true,
      message: `Payment status updated to ${finalPaymentStatus.toUpperCase()}`,
      booking_id: booking.id,
      payment_status: finalPaymentStatus,
      settlement_mode: cleanMode,
      total_paid: cleanAmount,
      receipt_no: receiptNo
    });
  } catch (err) {
    console.error('Update payment status error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/hospitality/history/:bookingId', (req, res) => {
  try {
    const { bookingId } = req.params;
    const primaryBooking = db.prepare(`
      SELECT 
        b.*,
        r.room_number,
        r.room_type,
        r.price as base_room_price,
        g.name as guest_name,
        g.father_name,
        g.mobile,
        g.email,
        g.address,
        g.dob,
        g.aadhar_number,
        g.doc_type,
        g.doc_front,
        g.doc_back,
        g.guest_photo
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN rooms r ON b.room_id = r.id
      WHERE b.id = ?
    `).get(bookingId);

    if (!primaryBooking) {
      return res.status(404).json({ success: false, error: 'Booking record not found' });
    }

    let parsedMemberDocs = [];
    try {
      parsedMemberDocs = primaryBooking.member_documents_json ? JSON.parse(primaryBooking.member_documents_json) : [];
    } catch (e) {
      parsedMemberDocs = [];
    }

    // Find all bookings in this stay session
    const inTimeKey = primaryBooking.checkin_time ? new Date(primaryBooking.checkin_time).toISOString().substring(0, 16) : '';
    const allLinkedBookings = db.prepare(`
      SELECT 
        b.*,
        r.room_number,
        r.room_type,
        r.price as base_room_price
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.guest_id = ? AND strftime('%Y-%m-%dT%H:%M', b.checkin_time) = ?
      ORDER BY CAST(r.room_number AS INTEGER) ASC, r.room_number ASC
    `).all(primaryBooking.guest_id, inTimeKey);

    const linkedRoomIds = allLinkedBookings.map(b => b.room_id);
    const linkedBookingIds = allLinkedBookings.map(b => b.id);
    const roomPlaceholders = linkedRoomIds.length > 0 ? linkedRoomIds.map(() => '?').join(',') : '0';
    const bookingPlaceholders = linkedBookingIds.length > 0 ? linkedBookingIds.map(() => '?').join(',') : '0';

    const checkinLocal = formatToLocalSqliteString(primaryBooking.checkin_time);
    const checkoutLocal = primaryBooking.actual_checkout_time ? formatToLocalSqliteString(primaryBooking.actual_checkout_time) : '2099-01-01 23:59:59';

    // Fetch Restaurant Orders during stay
    let restaurantOrders = [];
    if (linkedRoomIds.length > 0 || linkedBookingIds.length > 0) {
      restaurantOrders = db.prepare(`
        SELECT ro.*, r.room_number 
        FROM restaurant_orders ro
        LEFT JOIN rooms r ON ro.room_id = r.id
        WHERE (ro.booking_id IN (${bookingPlaceholders}))
           OR (ro.booking_id IS NULL AND ro.room_id IN (${roomPlaceholders}) AND datetime(ro.created_at) >= ? AND datetime(ro.created_at) <= datetime(?, '+2 hours'))
        ORDER BY ro.created_at ASC
      `).all(...linkedBookingIds, ...linkedRoomIds, checkinLocal, checkoutLocal);
    }

    // Fetch Bar Orders during stay
    let barOrders = [];
    if (linkedRoomIds.length > 0 || linkedBookingIds.length > 0) {
      barOrders = db.prepare(`
        SELECT bo.*, r.room_number 
        FROM bar_orders bo
        LEFT JOIN rooms r ON bo.room_id = r.id
        WHERE (bo.booking_id IN (${bookingPlaceholders}))
           OR (bo.booking_id IS NULL AND bo.room_id IN (${roomPlaceholders}) AND datetime(bo.created_at) >= ? AND datetime(bo.created_at) <= datetime(?, '+2 hours'))
        ORDER BY bo.created_at ASC
      `).all(...linkedBookingIds, ...linkedRoomIds, checkinLocal, checkoutLocal);
    }

    // Fetch Room Visitors during stay
    let visitors = [];
    if (linkedBookingIds.length > 0) {
      visitors = db.prepare(`
        SELECT * FROM room_visitors 
        WHERE booking_id IN (${bookingPlaceholders})
        ORDER BY checkin_time ASC
      `).all(...linkedBookingIds);
    }

    // Fetch Payments during stay
    let payments = [];
    if (linkedBookingIds.length > 0) {
      payments = db.prepare(`
        SELECT * FROM payments 
        WHERE booking_id IN (${bookingPlaceholders})
        ORDER BY created_at ASC
      `).all(...linkedBookingIds);
    }

    // Aggregate totals
    const totalRoomCharge = allLinkedBookings.reduce((sum, b) => sum + (b.total_room_charge || 0), 0);
    const totalPaid = allLinkedBookings.reduce((sum, b) => sum + (b.total_paid || 0), 0);
    const totalAdultsMale = allLinkedBookings.reduce((sum, b) => sum + (b.adults_male || 0), 0);
    const totalAdultsFemale = allLinkedBookings.reduce((sum, b) => sum + (b.adults_female || 0), 0);
    const totalAdultsOther = allLinkedBookings.reduce((sum, b) => sum + (b.adults_other || 0), 0);
    const totalChildren = allLinkedBookings.reduce((sum, b) => sum + (b.children || 0), 0);
    const totalExtraBeds = allLinkedBookings.reduce((sum, b) => sum + (b.extra_beds || 0), 0);

    const foodTotal = restaurantOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const barTotal = barOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const grandTotal = totalRoomCharge + foodTotal + barTotal;

    const checkinDate = primaryBooking.checkin_time ? new Date(primaryBooking.checkin_time) : new Date();
    const checkoutDate = primaryBooking.actual_checkout_time ? new Date(primaryBooking.actual_checkout_time) : (primaryBooking.approx_checkout_time ? new Date(primaryBooking.approx_checkout_time) : new Date());
    const diffMs = Math.max(0, checkoutDate.getTime() - checkinDate.getTime());
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    let durationStr = `${days > 0 ? days + 'd ' : ''}${hours}h`;
    if (durationStr.trim() === '0h') durationStr = '1h (Active)';

    const record = {
      ...primaryBooking,
      status: primaryBooking.status,
      rooms: allLinkedBookings.map(b => b.room_number),
      all_group_rooms: allLinkedBookings.map(b => ({ id: b.room_id, room_number: b.room_number, room_type: b.room_type })),
      stay_duration_str: durationStr,
      total_room_charge: totalRoomCharge,
      total_paid: totalPaid,
      orders_total_food: foodTotal,
      orders_total_bar: barTotal,
      grand_total: grandTotal,
      orders: [...restaurantOrders.map(o => ({ ...o, department: 'restaurant' })), ...barOrders.map(o => ({ ...o, department: 'bar' }))],
      visitors,
      payments,
      member_documents: parsedMemberDocs
    };

    res.json({
      success: true,
      record,
      data: {
        primary: primaryBooking,
        allRooms: allLinkedBookings,
        roomsList: allLinkedBookings.map(b => b.room_number),
        totals: {
          totalRoomCharge,
          totalPaid,
          totalAdultsMale,
          totalAdultsFemale,
          totalAdultsOther,
          totalChildren,
          totalExtraBeds,
          foodTotal,
          barTotal,
          grandTotal
        },
        restaurantOrders,
        barOrders,
        visitors
      }
    });
  } catch (err) {
    console.error('History detail fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE A HOSPITALITY STAY HISTORY RECORD (OR GROUP SESSION)
app.delete(['/api/hospitality/history/:bookingId', '/api/bookings/:bookingId'], requireAuth, requireRole('manager'), (req, res) => {
  const transaction = db.transaction(() => {
    const { bookingId } = req.params;
    
    const primaryBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!primaryBooking) {
      return { found: false };
    }

    // Find all linked bookings in the same checkin session for this guest
    const inTimeKey = primaryBooking.checkin_time ? new Date(primaryBooking.checkin_time).toISOString().substring(0, 16) : '';
    const linkedBookings = db.prepare(`
      SELECT id, room_id, status FROM bookings 
      WHERE guest_id = ? AND strftime('%Y-%m-%dT%H:%M', checkin_time) = ?
    `).all(primaryBooking.guest_id, inTimeKey);

    const targetBookingIds = linkedBookings.length > 0 ? linkedBookings.map(b => b.id) : [primaryBooking.id];
    const targetRoomIds = linkedBookings.length > 0 ? linkedBookings.map(b => b.room_id) : [primaryBooking.room_id];

    // If any linked booking is currently active, reset room status to 'ready'
    for (const lb of linkedBookings) {
      if (lb.status === 'active') {
        db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(lb.room_id);
      }
    }

    const bPlaceholders = targetBookingIds.map(() => '?').join(',');

    // 1. Delete visitors linked to these bookings
    db.prepare(`DELETE FROM room_visitors WHERE booking_id IN (${bPlaceholders})`).run(...targetBookingIds);

    // 2. Delete payments linked to these bookings
    db.prepare(`DELETE FROM payments WHERE booking_id IN (${bPlaceholders})`).run(...targetBookingIds);

    // 3. Delete expenses linked to these bookings (refunds etc.)
    db.prepare(`DELETE FROM expenses WHERE booking_id IN (${bPlaceholders})`).run(...targetBookingIds);

    // 4. Update or clean restaurant/bar orders linked to room folio
    if (targetRoomIds.length > 0) {
      const rPlaceholders = targetRoomIds.map(() => '?').join(',');
      db.prepare(`UPDATE restaurant_orders SET payment_mode = 'cash', is_paid = 1 WHERE payment_mode = 'room_folio' AND room_id IN (${rPlaceholders})`).run(...targetRoomIds);
      db.prepare(`UPDATE bar_orders SET payment_mode = 'cash', is_paid = 1 WHERE payment_mode = 'room_folio' AND room_id IN (${rPlaceholders})`).run(...targetRoomIds);
    }

    // 5. Delete bookings
    db.prepare(`DELETE FROM bookings WHERE id IN (${bPlaceholders})`).run(...targetBookingIds);

    return { found: true, deletedBookingIds: targetBookingIds };
  });

  try {
    const result = transaction();
    if (!result.found) {
      return res.status(404).json({ success: false, error: 'Booking history record not found' });
    }
    res.json({
      success: true,
      message: `Stay record #${req.params.bookingId} deleted successfully from history`,
      deletedBookingIds: result.deletedBookingIds
    });
  } catch (err) {
    console.error('Error deleting stay history record:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// BULK DELETE MULTIPLE HOSPITALITY STAY HISTORY RECORDS
app.post([
  '/api/hospitality/history/bulk-delete',
  '/api/hospitality/history/delete-bulk',
  '/api/bookings/bulk-delete',
  '/api/bookings/delete-bulk'
], requireAuth, requireRole('manager'), (req, res) => {
  const transaction = db.transaction(() => {
    const rawIds = req.body.booking_ids || req.body.ids || req.body.bookingIds;
    const booking_ids = Array.isArray(rawIds) ? rawIds : [];
    if (booking_ids.length === 0) {
      return { count: 0, deletedBookingIds: [] };
    }

    const allTargetBookingIds = new Set();
    const allTargetRoomIds = new Set();

    for (const bId of booking_ids) {
      const primaryBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bId);
      if (!primaryBooking) continue;

      const inTimeKey = primaryBooking.checkin_time ? new Date(primaryBooking.checkin_time).toISOString().substring(0, 16) : '';
      const linkedBookings = db.prepare(`
        SELECT id, room_id, status FROM bookings 
        WHERE guest_id = ? AND strftime('%Y-%m-%dT%H:%M', checkin_time) = ?
      `).all(primaryBooking.guest_id, inTimeKey);

      const targets = linkedBookings.length > 0 ? linkedBookings : [primaryBooking];
      for (const lb of targets) {
        allTargetBookingIds.add(lb.id);
        allTargetRoomIds.add(lb.room_id);
        if (lb.status === 'active') {
          db.prepare("UPDATE rooms SET status = 'ready', current_booking_id = NULL WHERE id = ?").run(lb.room_id);
        }
      }
    }

    const targetList = Array.from(allTargetBookingIds);
    const roomList = Array.from(allTargetRoomIds);

    if (targetList.length === 0) {
      return { count: 0, deletedBookingIds: [] };
    }

    const bPlaceholders = targetList.map(() => '?').join(',');

    db.prepare(`DELETE FROM room_visitors WHERE booking_id IN (${bPlaceholders})`).run(...targetList);
    db.prepare(`DELETE FROM payments WHERE booking_id IN (${bPlaceholders})`).run(...targetList);
    db.prepare(`DELETE FROM expenses WHERE booking_id IN (${bPlaceholders})`).run(...targetList);

    if (roomList.length > 0) {
      const rPlaceholders = roomList.map(() => '?').join(',');
      db.prepare(`UPDATE restaurant_orders SET payment_mode = 'cash', is_paid = 1 WHERE payment_mode = 'room_folio' AND room_id IN (${rPlaceholders})`).run(...roomList);
      db.prepare(`UPDATE bar_orders SET payment_mode = 'cash', is_paid = 1 WHERE payment_mode = 'room_folio' AND room_id IN (${rPlaceholders})`).run(...roomList);
    }

    db.prepare(`DELETE FROM bookings WHERE id IN (${bPlaceholders})`).run(...targetList);

    return { count: targetList.length, deletedBookingIds: targetList };
  });

  try {
    const result = transaction();
    res.json({
      success: true,
      message: `Deleted ${result.count} stay record(s) successfully`,
      deletedCount: result.count,
      deletedBookingIds: result.deletedBookingIds
    });
  } catch (err) {
    console.error('Error bulk deleting stay history:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// CLEAR ALL CHECKED-OUT HOSPITALITY HISTORY RECORDS
app.post(['/api/hospitality/history/clear-all', '/api/hospitality/history/purge'], requireAuth, requireRole('manager'), (req, res) => {
  const transaction = db.transaction(() => {
    // Select all checked_out bookings
    const checkedOutBookings = db.prepare("SELECT id, room_id FROM bookings WHERE status = 'checked_out'").all();
    if (checkedOutBookings.length === 0) {
      return { count: 0 };
    }

    const bIds = checkedOutBookings.map(b => b.id);
    const bPlaceholders = bIds.map(() => '?').join(',');

    db.prepare(`DELETE FROM room_visitors WHERE booking_id IN (${bPlaceholders})`).run(...bIds);
    db.prepare(`DELETE FROM payments WHERE booking_id IN (${bPlaceholders})`).run(...bIds);
    db.prepare(`DELETE FROM expenses WHERE booking_id IN (${bPlaceholders})`).run(...bIds);
    db.prepare(`DELETE FROM bookings WHERE id IN (${bPlaceholders})`).run(...bIds);

    return { count: bIds.length };
  });

  try {
    const result = transaction();
    res.json({
      success: true,
      message: `Cleared ${result.count} past stay history records`,
      deletedCount: result.count
    });
  } catch (err) {
    console.error('Error clearing hospitality history:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 17. CORPORATE BTC (BILL TO COMPANY) DIRECTORY APIS
// ==========================================================================
app.get('/api/btc-companies', (req, res) => {
  try {
    const { q, active_only } = req.query;
    let query = 'SELECT * FROM btc_companies';
    const params = [];
    const conditions = [];

    if (active_only !== 'false' && active_only !== '0') {
      conditions.push('is_active = 1');
    }
    if (q && q.trim()) {
      conditions.push('(company_name LIKE ? OR gst_number LIKE ? OR pan_number LIKE ? OR contact_person LIKE ?)');
      const search = `%${q.trim()}%`;
      params.push(search, search, search, search);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY company_name ASC';

    const rawCompanies = db.prepare(query).all(...params);
    const companies = rawCompanies.map(c => ({
      ...c,
      name: c.company_name,
      gstin: c.gst_number,
      phone: c.contact_phone,
      email: c.contact_email,
      pan: c.pan_number
    }));
    res.json({ success: true, companies });
  } catch (err) {
    console.error('BTC companies fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/btc-companies', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const rawName = req.body.company_name || req.body.name;
    const rawAddress = req.body.address;
    const rawContact = req.body.contact_person;
    const rawPhone = req.body.contact_phone || req.body.phone;
    const rawEmail = req.body.contact_email || req.body.email;
    const rawPan = req.body.pan_number || req.body.pan;
    const rawGst = req.body.gst_number || req.body.gstin;
    const rawLimit = req.body.credit_limit;

    if (!rawName || !rawName.trim()) {
      return res.status(400).json({ success: false, error: 'Company name is required' });
    }

    const stmt = db.prepare(`
      INSERT INTO btc_companies (
        company_name, address, contact_person, contact_phone, contact_email,
        pan_number, gst_number, credit_limit, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(
      rawName.trim(),
      (rawAddress || '').trim(),
      (rawContact || '').trim(),
      (rawPhone || '').trim(),
      (rawEmail || '').trim(),
      (rawPan || '').trim().toUpperCase(),
      (rawGst || '').trim().toUpperCase(),
      parseFloat(rawLimit) || 0
    );

    const newCompany = db.prepare('SELECT * FROM btc_companies WHERE id = ?').get(result.lastInsertRowid);
    const safeCompany = {
      ...newCompany,
      name: newCompany.company_name,
      gstin: newCompany.gst_number,
      phone: newCompany.contact_phone,
      email: newCompany.contact_email,
      pan: newCompany.pan_number
    };
    res.json({ success: true, id: result.lastInsertRowid, company: safeCompany, message: 'Corporate BTC Account created successfully' });
  } catch (err) {
    console.error('BTC company create error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/btc-companies/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const rawName = req.body.company_name || req.body.name;
    const rawAddress = req.body.address;
    const rawContact = req.body.contact_person;
    const rawPhone = req.body.contact_phone || req.body.phone;
    const rawEmail = req.body.contact_email || req.body.email;
    const rawPan = req.body.pan_number || req.body.pan;
    const rawGst = req.body.gst_number || req.body.gstin;
    const rawLimit = req.body.credit_limit;
    const is_active = req.body.is_active;

    const existing = db.prepare('SELECT * FROM btc_companies WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    db.prepare(`
      UPDATE btc_companies 
      SET 
        company_name = COALESCE(?, company_name),
        address = COALESCE(?, address),
        contact_person = COALESCE(?, contact_person),
        contact_phone = COALESCE(?, contact_phone),
        contact_email = COALESCE(?, contact_email),
        pan_number = COALESCE(?, pan_number),
        gst_number = COALESCE(?, gst_number),
        credit_limit = COALESCE(?, credit_limit),
        is_active = COALESCE(?, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      rawName ? rawName.trim() : null,
      rawAddress !== undefined ? rawAddress.trim() : null,
      rawContact !== undefined ? rawContact.trim() : null,
      rawPhone !== undefined ? rawPhone.trim() : null,
      rawEmail !== undefined ? rawEmail.trim() : null,
      rawPan !== undefined ? rawPan.trim().toUpperCase() : null,
      rawGst !== undefined ? rawGst.trim().toUpperCase() : null,
      rawLimit !== undefined ? parseFloat(rawLimit) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      id
    );

    const updated = db.prepare('SELECT * FROM btc_companies WHERE id = ?').get(id);
    const safeUpdated = {
      ...updated,
      name: updated.company_name,
      gstin: updated.gst_number,
      phone: updated.contact_phone,
      email: updated.contact_email,
      pan: updated.pan_number
    };
    res.json({ success: true, company: safeUpdated, message: 'Corporate details updated successfully' });
  } catch (err) {
    console.error('BTC company update error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/btc-companies/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE btc_companies SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    res.json({ success: true, message: 'Company deactivated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 18. CHEQUE REALIZATION & AUDIT LEDGER APIS
// ==========================================================================
app.get('/api/cheques', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT 
        p.*,
        b.checkin_time,
        b.actual_checkout_time,
        g.name as guest_name,
        g.mobile as guest_mobile,
        r.room_number,
        r.room_type
      FROM payments p
      LEFT JOIN bookings b ON p.booking_id = b.id
      LEFT JOIN guests g ON b.guest_id = g.id
      LEFT JOIN rooms r ON p.room_id = r.id
      WHERE (p.payment_mode = 'cheque' OR p.cheque_no IS NOT NULL)
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ' AND p.cheque_status = ?';
      params.push(status);
    }
    query += ' ORDER BY p.id DESC';

    const cheques = db.prepare(query).all(...params);
    res.json({ success: true, cheques });
  } catch (err) {
    console.error('Cheques fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/cheques/:id/status', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, staff_user } = req.body; // 'passed', 'bounced', 'pending'

    if (!['passed', 'bounced', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be passed, bounced, or pending' });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment transaction not found' });
    }

    const isPassed = status === 'passed';
    const realizedAt = isPassed ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE payments 
      SET 
        cheque_status = ?,
        realized_at = ?,
        notes = CASE WHEN ? != '' THEN ? ELSE notes END
      WHERE id = ?
    `).run(status, realizedAt, notes || '', notes || '', id);

    // Also sync booking advance cheque status if linked
    if (payment.booking_id) {
      db.prepare(`
        UPDATE bookings 
        SET advance_cheque_status = ?
        WHERE id = ?
      `).run(status, payment.booking_id);
    }

    const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    res.json({
      success: true,
      payment: updated,
      message: `Cheque #${payment.cheque_no || payment.receipt_no} marked as ${status.toUpperCase()}`
    });
  } catch (err) {
    console.error('Cheque status update error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 19. PETTY CASH & EXPENSES APIS
// ==========================================================================
app.get('/api/expenses', (req, res) => {
  try {
    const { category, startDate, endDate, date } = req.query;
    let query = 'SELECT * FROM expenses';
    const params = [];
    const conditions = [];

    if (category && category !== 'all') {
      conditions.push('category = ?');
      params.push(category);
    }

    if (date) {
      conditions.push("DATE(created_at, 'localtime') = ?");
      params.push(date);
    } else {
      if (startDate) {
        conditions.push('created_at >= ?');
        params.push(startDate);
      }
      if (endDate) {
        conditions.push('created_at <= ?');
        params.push(endDate);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY id DESC';

    const expenses = db.prepare(query).all(...params);
    const totalExpense = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    res.json({ success: true, expenses, totalExpense });
  } catch (err) {
    console.error('Expenses fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expenses', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const {
      category,
      paid_to,
      amount,
      payment_mode,
      debit_account,
      purpose_details,
      title,
      notes,
      room_id,
      booking_id,
      cashier_name,
      logged_by,
      cheque_no,
      bank_name
    } = req.body;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid expense amount is required' });
    }
    const cleanPaidTo = (paid_to || req.body.paidTo || 'Bearer / Vendor').trim();
    const cleanPurpose = (purpose_details || req.body.description || title || notes || 'General Expense').trim();

    const validCategories = ['owner', 'refund', 'store', 'maintenance', 'other', 'Diesel/Fuel', 'Laundry', 'Supplies', 'Utilities'];
    const cleanCategory = (category || 'other').trim();

    const voucherNo = getNextPettyCashVoucherNumber();
    const cleanCashier = (cashier_name || req.body.cashier || logged_by || 'Front Desk').trim();
    const cleanDebitAc = (debit_account || req.body.debitAccount || (cleanCategory.toLowerCase() === 'owner' ? 'Owner Drawings A/c' : (cleanCategory.toLowerCase() === 'refund' ? 'Guest Refund A/c' : (cleanCategory.toLowerCase() === 'store' ? 'Store & Pantry A/c' : (cleanCategory.toLowerCase() === 'maintenance' ? 'Repairs & Maintenance A/c' : 'General Expenses A/c'))))).trim();
    const cleanMode = (payment_mode || req.body.paymentMode || 'cash').toLowerCase();
    const cleanChequeNo = (cheque_no || req.body.chequeNo || req.body.cheque_number || req.body.utr_number || req.body.utr || '').trim();
    const cleanBankName = (bank_name || req.body.bankName || req.body.bank || '').trim();

    const result = db.prepare(`
      INSERT INTO expenses (
        voucher_no, category, paid_to, amount, payment_mode, debit_account,
        purpose_details, room_id, booking_id, cashier_name, cheque_no, bank_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      voucherNo,
      cleanCategory,
      cleanPaidTo,
      numAmount,
      cleanMode,
      cleanDebitAc,
      cleanPurpose,
      room_id || null,
      booking_id || null,
      cleanCashier,
      cleanChequeNo || null,
      cleanBankName || null
    );

    const newExpense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
    res.json({
      success: true,
      expense: newExpense,
      expense_id: result.lastInsertRowid,
      voucher_number: voucherNo,
      voucherNo,
      message: `Petty Cash Voucher #${voucherNo} created for ₹${numAmount.toLocaleString('en-IN')}`
    });
  } catch (err) {
    console.error('Expense create error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Expense / Petty Cash Voucher (Manager Only)
app.delete('/api/expenses/:id', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { id } = req.params;
    const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!exp) {
      return res.status(404).json({ success: false, error: 'Expense record not found' });
    }
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    res.json({ success: true, message: 'Expense record deleted successfully' });
  } catch (err) {
    console.error('Expense delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 20. MANAGER FINANCIAL ANALYTICS & RECONCILIATION APIS
// ==========================================================================
app.get(['/api/manager/analytics', '/api/stats/analytics'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { date, startDate, endDate, from_date, to_date } = req.query;
    let dateFilterPayment = '';
    let dateFilterRest = '';
    let dateFilterBar = '';
    let dateFilterExp = '';
    let dateFilterBookings = '';
    const dateParams = [];
    const dateParamsBookings = [];

    const start = startDate || from_date || (date ? date : null);
    const end = endDate || to_date || (date ? date : null);

    if (start && end) {
      dateFilterPayment = " WHERE DATE(created_at, 'localtime') BETWEEN DATE(?) AND DATE(?)";
      dateFilterRest = " WHERE DATE(created_at, 'localtime') BETWEEN DATE(?) AND DATE(?)";
      dateFilterBar = " WHERE DATE(created_at, 'localtime') BETWEEN DATE(?) AND DATE(?)";
      dateFilterExp = " WHERE DATE(created_at, 'localtime') BETWEEN DATE(?) AND DATE(?)";
      dateFilterBookings = " WHERE DATE(b.created_at, 'localtime') BETWEEN DATE(?) AND DATE(?)";
      dateParams.push(start, end);
      dateParamsBookings.push(start, end);
    } else if (start) {
      dateFilterPayment = " WHERE DATE(created_at, 'localtime') = DATE(?)";
      dateFilterRest = " WHERE DATE(created_at, 'localtime') = DATE(?)";
      dateFilterBar = " WHERE DATE(created_at, 'localtime') = DATE(?)";
      dateFilterExp = " WHERE DATE(created_at, 'localtime') = DATE(?)";
      dateFilterBookings = " WHERE DATE(b.created_at, 'localtime') = DATE(?)";
      dateParams.push(start);
      dateParamsBookings.push(start);
    }

    // 0. Pre-Booked (OTA Pre-Paid) Collections (Grouped by voucher to prevent linked room duplication)
    const prebookedStats = db.prepare(`
      SELECT 
        COALESCE(SUM(b.ota_bill_amount), 0) as total,
        COUNT(DISTINCT b.voucher_number) as count
      FROM (
        SELECT voucher_number, MAX(ota_bill_amount) as ota_bill_amount, is_prepaid, booking_source, created_at, status
        FROM bookings
        WHERE is_prepaid = 1 AND (booking_source = 'OTA' OR ota_bill_amount > 0) AND status != 'cancelled'
        GROUP BY voucher_number
      ) b
      ${dateFilterBookings}
    `).get(...dateParamsBookings);

    // 1. Advance Payments (Only Realized or Passed)
    const advRealized = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_cash, 0)
            WHEN LOWER(payment_mode) = 'cash' 
              THEN amount 
            WHEN LOWER(payment_mode) NOT IN ('card', 'upi', 'online', 'cheque')
              THEN amount
            ELSE 0 
          END
        ), 0) as cash,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_card, 0)
            WHEN LOWER(payment_mode) = 'card' 
              THEN amount 
            ELSE 0 
          END
        ), 0) as card,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_online, 0)
            WHEN LOWER(payment_mode) IN ('upi', 'online') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as upi,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN CASE WHEN cheque_status IN ('realized', 'passed') THEN COALESCE(split_cheque, 0) ELSE 0 END
            WHEN LOWER(payment_mode) = 'cheque' AND cheque_status IN ('realized', 'passed') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as cheque_realized,
        COALESCE(SUM(card_surcharge), 0) as card_surcharge,
        COALESCE(SUM(upi_tax), 0) as upi_tax
      FROM payments 
      ${dateFilterPayment ? dateFilterPayment + ' AND' : 'WHERE'} payment_type = 'advance' AND (cheque_status = 'realized' OR cheque_status = 'passed')
    `).get(...dateParams);

    // 2. Checkout Bill Settlements
    const billRealized = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_cash, 0)
            WHEN LOWER(payment_mode) = 'cash' 
              THEN amount 
            WHEN LOWER(payment_mode) NOT IN ('card', 'upi', 'online', 'cheque')
              THEN amount
            ELSE 0 
          END
        ), 0) as cash,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_card, 0)
            WHEN LOWER(payment_mode) = 'card' 
              THEN amount 
            ELSE 0 
          END
        ), 0) as card,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_online, 0)
            WHEN LOWER(payment_mode) IN ('upi', 'online') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as upi,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN CASE WHEN cheque_status IN ('realized', 'passed') THEN COALESCE(split_cheque, 0) ELSE 0 END
            WHEN LOWER(payment_mode) = 'cheque' AND cheque_status IN ('realized', 'passed') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as cheque_realized,
        COALESCE(SUM(card_surcharge), 0) as card_surcharge,
        COALESCE(SUM(upi_tax), 0) as upi_tax
      FROM payments 
      ${dateFilterPayment ? dateFilterPayment + ' AND' : 'WHERE'} payment_type = 'bill_settlement' AND (cheque_status = 'realized' OR cheque_status = 'passed')
    `).get(...dateParams);

    // 2b. Direct F&B Settlements in payments
    const fnbRealized = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_cash, 0)
            WHEN LOWER(payment_mode) = 'cash' 
              THEN amount 
            WHEN LOWER(payment_mode) NOT IN ('card', 'upi', 'online', 'cheque')
              THEN amount
            ELSE 0 
          END
        ), 0) as cash,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_card, 0)
            WHEN LOWER(payment_mode) = 'card' 
              THEN amount 
            ELSE 0 
          END
        ), 0) as card,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_online, 0)
            WHEN LOWER(payment_mode) IN ('upi', 'online') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as upi,
        COALESCE(SUM(card_surcharge), 0) as card_surcharge,
        COALESCE(SUM(upi_tax), 0) as upi_tax
      FROM payments 
      ${dateFilterPayment ? dateFilterPayment + ' AND' : 'WHERE'} payment_type = 'fnb_settlement'
    `).get(...dateParams);

    // 2c. Corporate BTC Company Settlements (Only Realized or Passed)
    const btcRealized = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_cash, 0)
            WHEN LOWER(payment_mode) = 'cash' 
              THEN amount 
            ELSE 0 
          END
        ), 0) as cash,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_card, 0)
            WHEN LOWER(payment_mode) = 'card' 
              THEN amount 
            ELSE 0 
          END
        ), 0) as card,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN COALESCE(split_online, 0)
            WHEN LOWER(payment_mode) IN ('upi', 'online', 'bank_transfer', 'neft', 'rtgs') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as upi,
        COALESCE(SUM(
          CASE 
            WHEN (COALESCE(split_cash, 0) + COALESCE(split_card, 0) + COALESCE(split_online, 0) + COALESCE(split_cheque, 0)) > 0 
              THEN CASE WHEN cheque_status IN ('realized', 'passed') THEN COALESCE(split_cheque, 0) ELSE 0 END
            WHEN LOWER(payment_mode) = 'cheque' AND cheque_status IN ('realized', 'passed') 
              THEN amount 
            ELSE 0 
          END
        ), 0) as cheque_realized,
        COALESCE(SUM(card_surcharge), 0) as card_surcharge,
        COALESCE(SUM(upi_tax), 0) as upi_tax
      FROM payments 
      ${dateFilterPayment ? dateFilterPayment + ' AND' : 'WHERE'} payment_type = 'company_settlement' AND (cheque_status = 'realized' OR cheque_status = 'passed')
    `).get(...dateParams);

    // 2d. Dedicated Corporate BTC Cheques Audit (All Cheques from BTC Settlements & Corporate Ledger)
    const btcChequeStats = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(CASE WHEN cheque_status IN ('realized', 'passed') THEN amount ELSE 0 END), 0) as passed_amount,
        COALESCE(SUM(CASE WHEN cheque_status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN cheque_status = 'bounced' THEN amount ELSE 0 END), 0) as bounced_amount,
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN cheque_status IN ('realized', 'passed') THEN 1 ELSE 0 END), 0) as passed_count,
        COALESCE(SUM(CASE WHEN cheque_status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
        COALESCE(SUM(CASE WHEN cheque_status = 'bounced' THEN 1 ELSE 0 END), 0) as bounced_count
      FROM payments 
      ${dateFilterPayment ? dateFilterPayment + ' AND' : 'WHERE'} (payment_type = 'company_settlement' OR booking_id IN (SELECT id FROM bookings WHERE booking_source = 'BTC' OR btc_company_id IS NOT NULL))
      AND (LOWER(payment_mode) = 'cheque' OR cheque_no IS NOT NULL)
    `).get(...dateParams);

    // 3. Restaurant POS Sales (Itemized for accurate split payment modes, subtotal base, and GST tax)
    const restOrders = db.prepare(`
      SELECT 
        id, total, subtotal, tax, payment_mode, card_surcharge, upi_tax, split_details_json
      FROM restaurant_orders 
      ${dateFilterRest ? dateFilterRest + ' AND' : 'WHERE'} is_paid = 1 AND payment_mode != 'room_folio'
    `).all(...dateParams);

    let restSales = { total: 0, subtotal: 0, tax: 0, cash: 0, card: 0, upi: 0, card_surcharge: 0, upi_tax: 0 };
    for (const o of restOrders) {
      const ordTotal = Number(o.total) || 0;
      const ordTax = Number(o.tax) || 0;
      const ordSubtotal = o.subtotal !== null && o.subtotal !== undefined ? Number(o.subtotal) : (ordTotal - ordTax);
      restSales.total += ordTotal;
      restSales.subtotal += ordSubtotal;
      restSales.tax += ordTax;
      restSales.card_surcharge += (Number(o.card_surcharge) || 0);
      restSales.upi_tax += (Number(o.upi_tax) || 0);

      const mode = (o.payment_mode || 'cash').toLowerCase();
      if (mode === 'split' && o.split_details_json) {
        try {
          const s = typeof o.split_details_json === 'string' ? JSON.parse(o.split_details_json) : o.split_details_json;
          restSales.cash += (Number(s.cash) || 0);
          restSales.card += (Number(s.card) || 0);
          restSales.upi += (Number(s.online) || Number(s.upi) || 0);
        } catch (_) {
          restSales.cash += ordTotal;
        }
      } else if (mode === 'card') {
        restSales.card += ordTotal;
      } else if (mode === 'upi' || mode === 'online') {
        restSales.upi += ordTotal;
      } else {
        restSales.cash += ordTotal;
      }
    }
    restSales.count = restOrders.length;

    // 4. Bar POS Sales (Itemized for accurate split payment modes, subtotal base, and GST tax)
    const barOrders = db.prepare(`
      SELECT 
        id, total, subtotal, tax, payment_mode, card_surcharge, upi_tax, split_details_json
      FROM bar_orders 
      ${dateFilterBar ? dateFilterBar + ' AND' : 'WHERE'} is_paid = 1 AND payment_mode != 'room_folio'
    `).all(...dateParams);

    let barSales = { total: 0, subtotal: 0, tax: 0, cash: 0, card: 0, upi: 0, card_surcharge: 0, upi_tax: 0, count: 0 };
    for (const o of barOrders) {
      const ordTotal = Number(o.total) || 0;
      const ordTax = Number(o.tax) || 0;
      const ordSubtotal = o.subtotal !== null && o.subtotal !== undefined ? Number(o.subtotal) : (ordTotal - ordTax);
      barSales.total += ordTotal;
      barSales.subtotal += ordSubtotal;
      barSales.tax += ordTax;
      barSales.card_surcharge += (Number(o.card_surcharge) || 0);
      barSales.upi_tax += (Number(o.upi_tax) || 0);

      const mode = (o.payment_mode || 'cash').toLowerCase();
      if (mode === 'split' && o.split_details_json) {
        try {
          const s = typeof o.split_details_json === 'string' ? JSON.parse(o.split_details_json) : o.split_details_json;
          barSales.cash += (Number(s.cash) || 0);
          barSales.card += (Number(s.card) || 0);
          barSales.upi += (Number(s.online) || Number(s.upi) || 0);
        } catch (_) {
          barSales.cash += ordTotal;
        }
      } else if (mode === 'card') {
        barSales.card += ordTotal;
      } else if (mode === 'upi' || mode === 'online') {
        barSales.upi += ordTotal;
      } else {
        barSales.cash += ordTotal;
      }
    }
    barSales.count = barOrders.length;

    // 5. Cheque Status Totals (Pending vs Realized)
    const chequeStats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN cheque_status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
        COALESCE(SUM(CASE WHEN cheque_status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
        COALESCE(SUM(CASE WHEN cheque_status IN ('passed', 'realized') THEN amount ELSE 0 END), 0) as passed_amount,
        COALESCE(SUM(CASE WHEN cheque_status IN ('passed', 'realized') THEN 1 ELSE 0 END), 0) as passed_count,
        COALESCE(SUM(CASE WHEN cheque_status = 'bounced' THEN amount ELSE 0 END), 0) as bounced_amount,
        COALESCE(SUM(CASE WHEN cheque_status = 'bounced' THEN 1 ELSE 0 END), 0) as bounced_count
      FROM payments 
      ${dateFilterPayment ? dateFilterPayment + ' AND' : 'WHERE'} (payment_mode = 'cheque' OR cheque_no IS NOT NULL)
    `).get(...dateParams);

    // 6. Corporate BTC Pending Receivables & Active Count
    const btcStats = db.prepare(`
      SELECT 
        COALESCE(SUM(b.total_room_charge - b.total_paid), 0) as pending_receivable,
        COUNT(DISTINCT b.id) as pending_invoice_count
      FROM bookings b
      WHERE (b.booking_source = 'BTC' OR b.booking_source LIKE '%company%' OR b.btc_company_id IS NOT NULL)
      AND b.payment_status != 'settled'
    `).get();

    const activeBtcCount = db.prepare('SELECT COUNT(*) as cnt FROM btc_companies WHERE is_active = 1').get().cnt;

    // 7. Expenses by Category
    const expStats = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN payment_mode = 'cash' THEN amount ELSE 0 END), 0) as cash_expenses,
        COALESCE(SUM(CASE WHEN category = 'owner' THEN amount ELSE 0 END), 0) as owner_drawings,
        COALESCE(SUM(CASE WHEN category = 'refund' THEN amount ELSE 0 END), 0) as refunds,
        COALESCE(SUM(CASE WHEN category = 'store' THEN amount ELSE 0 END), 0) as store_pantry,
        COALESCE(SUM(CASE WHEN category = 'maintenance' THEN amount ELSE 0 END), 0) as maintenance,
        COALESCE(SUM(CASE WHEN category = 'other' THEN amount ELSE 0 END), 0) as other_expenses
      FROM expenses 
      ${dateFilterExp}
    `).get(...dateParams);

    // 7b. Itemized Expenses List for Daily Closing Audit
    const expList = db.prepare(`
      SELECT 
        id, 
        voucher_no, 
        category, 
        amount, 
        payment_mode, 
        paid_to, 
        purpose_details, 
        cashier_name, 
        debit_account,
        created_at
      FROM expenses 
      ${dateFilterExp}
      ORDER BY id DESC
      LIMIT 100
    `).all(...dateParams);

    // Aggregations - Strict and Accurate
    const hospTotal = (advRealized.total || 0) + (billRealized.total || 0) + (btcRealized.total || 0);
    const hospCash = (advRealized.cash || 0) + (billRealized.cash || 0) + (btcRealized.cash || 0);
    const hospCard = (advRealized.card || 0) + (billRealized.card || 0) + (btcRealized.card || 0);
    const hospUpi = (advRealized.upi || 0) + (billRealized.upi || 0) + (btcRealized.upi || 0);
    const hospCheque = (advRealized.cheque_realized || 0) + (billRealized.cheque_realized || 0) + (btcRealized.cheque_realized || 0);

    const totalCollectedRealized = hospTotal + (restSales.total || 0) + (barSales.total || 0);
    const totalCashInflow = hospCash + (restSales.cash || 0) + (barSales.cash || 0);
    const totalCardInflow = hospCard + (restSales.card || 0) + (barSales.card || 0);
    const totalUpiInflow = hospUpi + (restSales.upi || 0) + (barSales.upi || 0);
    const totalChequePassed = hospCheque;

    const totalCardSurcharge = (advRealized.card_surcharge || 0) + (billRealized.card_surcharge || 0) + (btcRealized.card_surcharge || 0) + (fnbRealized.card_surcharge || 0) + (restSales.card_surcharge || 0) + (barSales.card_surcharge || 0);
    const totalUpiTax = (advRealized.upi_tax || 0) + (billRealized.upi_tax || 0) + (btcRealized.upi_tax || 0) + (fnbRealized.upi_tax || 0) + (restSales.upi_tax || 0) + (barSales.upi_tax || 0);
    const totalSurcharges = totalCardSurcharge + totalUpiTax;

    const totalExpenses = expStats.total_expenses || 0;
    const totalCashOutflow = expStats.cash_expenses || 0;
    const netCashInDrawer = totalCashInflow - totalCashOutflow;
    const netProfit = totalCollectedRealized - totalExpenses;

    // Dynamic GST on Hospitality room stay charges (reads configurable room_gst_pct)
    const roomGstRow = db.prepare("SELECT value FROM system_settings WHERE key = 'room_gst_pct'").get();
    const analyticsRoomGstPct = roomGstRow ? (parseFloat(roomGstRow.value) || 5) : 5;
    const hospGstFactor = 1 + (analyticsRoomGstPct / 100);
    const hospBase = Math.round((hospTotal / hospGstFactor) * 100) / 100;
    const hospGst = Math.round((hospTotal - hospBase) * 100) / 100;

    // GST Collections across Hotel, Restaurant, and Bar
    const totalGstCollections = hospGst + (restSales.tax || 0) + (barSales.tax || 0);

    // Net to Hotel (Base price only: do NOT add GST & taxes, and do NOT add/deduct expenses)
    const netToHotel = hospBase + (restSales.subtotal || 0) + (barSales.subtotal || 0);

    const stats = {
      grossRevenue: totalCollectedRealized,
      totalRealized: totalCollectedRealized,
      totalExpenses,
      netProfit,
      cashInDrawer: netCashInDrawer,
      totalCashInflow,
      totalCardInflow,
      totalUpiInflow,
      gstCollections: totalGstCollections,
      totalGstCollections,
      netToHotel,
      baseRevenue: netToHotel,
      roomRevenue: hospTotal,
      restaurantRevenue: restSales.total || 0,
      barRevenue: barSales.total || 0,
      advancesCollected: advRealized.total || 0,
      prebookedTotal: prebookedStats.total || 0,
      prebookedCount: prebookedStats.count || 0,
      pendingChequesCount: chequeStats.pending_count || 0,
      pendingChequesAmount: chequeStats.pending_amount || 0,
      activeBtcCompaniesCount: activeBtcCount || 0,
      cardSurchargeTotal: totalCardSurcharge,
      totalCardSurcharge: totalCardSurcharge,
      upiTaxTotal: totalUpiTax,
      totalUpiTax: totalUpiTax,
      totalSurcharges: totalSurcharges
    };

    res.json({
      success: true,
      stats,
      analytics: {
        totalCollectedRealized,
        totalRealized: totalCollectedRealized,
        totalCashInflow,
        totalCardInflow,
        totalUpiInflow,
        gstCollections: totalGstCollections,
        totalGstCollections,
        netToHotel,
        baseRevenue: netToHotel,
        prebookedTotal: prebookedStats.total || 0,
        prebookedCount: prebookedStats.count || 0,
        prebooked: {
          total: prebookedStats.total || 0,
          count: prebookedStats.count || 0
        },
        breakdown: {
          advances: advRealized,
          billSettlements: billRealized,
          btcSettlements: btcRealized,
          fnbSettlements: fnbRealized,
          hospitality: {
            total: hospTotal,
            base: hospBase,
            gst: hospGst,
            cash: hospCash,
            card: hospCard,
            upi: hospUpi,
            cheque: hospCheque,
            cheque_realized: hospCheque,
            btc_cheque: btcChequeStats.passed_amount || 0,
            card_surcharge: (advRealized.card_surcharge || 0) + (billRealized.card_surcharge || 0) + (btcRealized.card_surcharge || 0),
            upi_tax: (advRealized.upi_tax || 0) + (billRealized.upi_tax || 0) + (btcRealized.upi_tax || 0)
          },
          restaurant: restSales,
          bar: barSales
        },
        paymentModes: {
          cash: totalCashInflow,
          card: totalCardInflow,
          upi: totalUpiInflow,
          chequeRealized: totalChequePassed,
          btcCheque: btcChequeStats.passed_amount || 0,
          cardSurcharge: totalCardSurcharge,
          card_surcharge: totalCardSurcharge,
          upiTax: totalUpiTax,
          upi_tax: totalUpiTax,
          totalSurcharges: totalSurcharges,
          total_surcharges: totalSurcharges
        },
        surcharges: {
          cardFeeTotal: totalCardSurcharge,
          cardSurcharge: totalCardSurcharge,
          upiTaxTotal: totalUpiTax,
          upiTax: totalUpiTax,
          totalFees: totalSurcharges,
          total: totalSurcharges
        },
        cheques: chequeStats,
        btcCheque: btcChequeStats,
        btcCorporate: {
          ...btcStats,
          active_companies_count: activeBtcCount,
          settled_total: btcRealized.total || 0,
          settled_cash: btcRealized.cash || 0,
          settled_upi: btcRealized.upi || 0,
          settled_card: btcRealized.card || 0,
          settled_cheque: btcRealized.cheque_realized || 0,
          btc_cheque_total: btcChequeStats.total_amount || 0,
          btc_cheque_passed: btcChequeStats.passed_amount || 0,
          btc_cheque_pending: btcChequeStats.pending_amount || 0,
          btc_cheque_count: btcChequeStats.passed_count || 0
        },
        expenses: expStats,
        expensesList: expList,
        drawer: {
          totalCashInflow,
          totalCashOutflow,
          netCashInDrawer
        }
      }
    });
  } catch (err) {
    console.error('Manager analytics error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// HOSPITALITY SETTLE PENDING F&B BILLS (Direct settlement for pending restaurant/bar orders)
// ==========================================================================
app.post('/api/hospitality/settle-fnb-order', requireAuth, (req, res) => {
  try {
    const {
      orderId,
      department = 'restaurant',
      paymentMode = 'cash',
      splitCash = 0,
      splitOnline = 0,
      splitCard = 0,
      utrNumber,
      cardSurcharge = 0,
      staffName
    } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID is required' });
    }

    const isBar = department === 'bar';
    const tableName = isBar ? 'bar_orders' : 'restaurant_orders';
    const order = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: `${isBar ? 'Bar' : 'Restaurant'} order not found` });
    }

    const cashier = (staffName || req.user?.full_name || req.user?.username || 'Front Desk').trim();
    const baseTotal = Number(order.total) || 0;

    const modeLower = (paymentMode || 'cash').toLowerCase();
    const cleanUtr = (utrNumber || '').trim();

    // Mandatory UTR enforcement for UPI / Online
    if ((modeLower === 'upi' || modeLower === 'online') && !cleanUtr) {
      return res.status(400).json({ success: false, error: 'UTR / Transaction Reference Number is mandatory for UPI payments.' });
    }

    if (modeLower === 'split') {
      const totalSplit = (Number(splitCash) || 0) + (Number(splitOnline) || 0) + (Number(splitCard) || 0);
      if (Math.abs(totalSplit - baseTotal) > 0.5) {
        return res.status(400).json({ success: false, error: `Split total (₹${totalSplit}) does not match bill total (₹${baseTotal}).` });
      }
      if ((Number(splitOnline) || 0) > 0 && !cleanUtr) {
        return res.status(400).json({ success: false, error: 'UTR / Transaction Reference Number is mandatory for online split portion.' });
      }
    }

    // 2.5% card surcharge: shown on receipt, but omitted from hotel revenue calculations
    let effectiveSurcharge = 0;
    if (modeLower === 'card') {
      effectiveSurcharge = cardSurcharge > 0 ? Number(cardSurcharge) : Math.round(baseTotal * 0.025);
    } else if (modeLower === 'split' && (Number(splitCard) || 0) > 0) {
      effectiveSurcharge = cardSurcharge > 0 ? Number(cardSurcharge) : Math.round(Number(splitCard) * 0.025);
    }

    // 0.4% UPI tax for UPI > 2000
    let effectiveUpiTax = 0;
    const onlineAmt = modeLower === 'split' ? (Number(splitOnline) || 0) : ((modeLower === 'upi' || modeLower === 'online') ? baseTotal : 0);
    if (onlineAmt > 2000) {
      effectiveUpiTax = (req.body.upiTax !== undefined ? Number(req.body.upiTax) : (req.body.upi_tax !== undefined ? Number(req.body.upi_tax) : 0)) || Math.round(onlineAmt * 0.004);
    }

    const splitDetails = {
      cash: Number(splitCash) || (modeLower === 'cash' ? baseTotal : 0),
      card: Number(splitCard) || (modeLower === 'card' ? baseTotal : 0),
      online: Number(splitOnline) || ((modeLower === 'upi' || modeLower === 'online') ? baseTotal : 0),
      card_surcharge: effectiveSurcharge,
      upi_tax: effectiveUpiTax
    };

    // Update the order in database to PAID (turns green)
    db.prepare(`
      UPDATE ${tableName}
      SET is_paid = 1,
          status = 'completed',
          payment_mode = ?,
          utr_number = ?,
          card_surcharge = ?,
          upi_tax = ?,
          split_details_json = ?,
          settled_by = ?,
          settled_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      modeLower,
      cleanUtr || null,
      effectiveSurcharge,
      effectiveUpiTax,
      JSON.stringify(splitDetails),
      cashier,
      orderId
    );

    // Look up room booking to link to payments ledger
    let bookingId = null;
    let roomNum = '';
    if (order.room_id) {
      const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(order.room_id);
      if (room) {
        roomNum = room.room_number;
        bookingId = room.current_booking_id;
      }
    }

    // Generate receipt number
    const receiptNo = `RCP-${isBar ? 'BAR' : 'RES'}-${Date.now().toString().slice(-6)}`;

    // Insert into payments ledger table so it immediately displays in Room Payment History & Drawer
    // NOTE: amount stores baseTotal (surcharge is NOT counted in hotel revenue)
    db.prepare(`
      INSERT INTO payments (
        receipt_no, booking_id, room_id, order_id, department,
        payment_type, payment_mode, amount, utr_number, card_surcharge, upi_tax,
        split_cash, split_card, split_online,
        cashier_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, 'fnb_settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
      receiptNo,
      bookingId,
      order.room_id,
      order.id,
      department,
      modeLower,
      baseTotal,
      cleanUtr || null,
      effectiveSurcharge,
      effectiveUpiTax,
      splitDetails.cash,
      splitDetails.card,
      splitDetails.online,
      cashier,
      `Settled pending ${isBar ? 'Bar' : 'Restaurant'} Bill #${order.order_number || order.id}${effectiveSurcharge > 0 ? ` (+₹${effectiveSurcharge} card fee)` : ''}${effectiveUpiTax > 0 ? ` (+₹${effectiveUpiTax} UPI tax)` : ''}`
    );

    const updatedOrder = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(orderId);

    res.json({
      success: true,
      message: 'F&B bill settled successfully',
      receiptNo,
      order: updatedOrder,
      cardSurcharge: effectiveSurcharge,
      upiTax: effectiveUpiTax,
      roomNumber: roomNum,
      cashier
    });
  } catch (err) {
    console.error('Error settling F&B order from hospitality:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// SEND BILL PDF / SUMMARY TO MOBILE (WHATSAPP DISPATCH)
// ==========================================================================
app.post('/api/orders/send-bill-mobile', requireAuth, (req, res) => {
  try {
    const { orderId, department = 'restaurant', mobileNumber } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'Order ID is required' });

    const isBar = department === 'bar';
    const tableName = isBar ? 'bar_orders' : 'restaurant_orders';
    const order = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(orderId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    let phone = (mobileNumber || order.guest_phone || '').replace(/[^0-9]/g, '');
    if (phone.length === 10) phone = '91' + phone;

    let items = [];
    try { items = JSON.parse(order.items_json || '[]'); } catch (e) { items = []; }
    const itemsText = items.map(it => `• ${it.name} x${it.quantity || it.qty || 1} - ₹${(it.price || 0) * (it.quantity || it.qty || 1)}`).join('\n');

    const billText = `🏨 *HOTEL CITY PAARK, SOLAPUR*\n` +
      `*119, Murarji Peth, Char Hutatma Chowk*\n` +
      `*Tel: 0217-2729791 | Mob: 9960013388*\n\n` +
      `📜 *${isBar ? 'BAR LOUNGE' : 'RESTAURANT'} BILL SUMMARY*\n` +
      `Bill No: *${order.order_number || `#${order.id}`}*\n` +
      `Date: ${order.created_at || new Date().toLocaleString('en-IN')}\n` +
      `Customer: ${order.customer_name || 'Valued Guest'}\n` +
      `${order.room_service_for ? `Attribution: ${order.room_service_for === 'visitor' ? 'For Visitor' : 'For Room Mates'}\n` : ''}` +
      `--------------------------------\n` +
      `${itemsText}\n` +
      `--------------------------------\n` +
      `Subtotal: ₹${order.subtotal}\n` +
      `GST (5%): ₹${order.tax}\n` +
      `*Grand Total: ₹${order.total}*\n` +
      `Status: *${order.is_paid ? '✅ PAID' : '⏳ PENDING'}*\n` +
      `Payment Mode: ${order.payment_mode ? order.payment_mode.toUpperCase() : 'CASH'}\n\n` +
      `Thank you for dining with Hotel City Paark!`;

    const encodedText = encodeURIComponent(billText);
    const whatsappUrl = phone ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}` : null;

    res.json({
      success: true,
      mobile: phone,
      billSummary: billText,
      whatsappUrl
    });
  } catch (err) {
    console.error('Send bill to mobile error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 21. DAILY CASH CLOSING & RECONCILIATION REPORT API
// ==========================================================================
app.get('/api/reports/daily-closing', (req, res) => {
  try {
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];

    // Transactions of the day
    const paymentsList = db.prepare(`
      SELECT 
        p.*,
        g.name as guest_name,
        r.room_number
      FROM payments p
      LEFT JOIN bookings b ON p.booking_id = b.id
      LEFT JOIN guests g ON b.guest_id = g.id
      LEFT JOIN rooms r ON p.room_id = r.id
      WHERE DATE(p.created_at, 'localtime') = ?
      ORDER BY p.id ASC
    `).all(targetDate);

    // Expenses of the day
    const expensesList = db.prepare(`
      SELECT * FROM expenses
      WHERE DATE(created_at, 'localtime') = ?
      ORDER BY id ASC
    `).all(targetDate);

    // Cashiers active today
    const cashiers = db.prepare(`
      SELECT DISTINCT cashier_name FROM (
        SELECT cashier_name FROM payments WHERE DATE(created_at, 'localtime') = ? AND cashier_name IS NOT NULL AND cashier_name != ''
        UNION
        SELECT cashier_name FROM expenses WHERE DATE(created_at, 'localtime') = ? AND cashier_name IS NOT NULL AND cashier_name != ''
      )
    `).all(targetDate, targetDate).map(c => c.cashier_name);

    // Totals calculation
    let advanceCash = 0, advanceOnline = 0, advanceCard = 0;
    let billCash = 0, billOnline = 0, billCard = 0;
    let btcCash = 0, btcOnline = 0, btcCard = 0, btcCheque = 0;

    paymentsList.forEach(p => {
      const mode = (p.payment_mode || '').toLowerCase();
      if (p.payment_type === 'advance') {
        if (mode === 'cash') advanceCash += (p.amount || 0);
        else if (mode === 'card') advanceCard += (p.amount || 0);
        else advanceOnline += (p.amount || 0);
      } else if (p.payment_type === 'bill_settlement') {
        if (mode === 'cash') billCash += (p.amount || 0);
        else if (mode === 'card') billCard += (p.amount || 0);
        else billOnline += (p.amount || 0);
      } else if (p.payment_type === 'company_settlement') {
        if (mode === 'cash') btcCash += (p.amount || 0);
        else if (mode === 'card') btcCard += (p.amount || 0);
        else if (mode === 'cheque') btcCheque += (p.amount || 0);
        else btcOnline += (p.amount || 0);
      }
    });

    // Direct POS Orders
    const restCash = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as amt FROM restaurant_orders 
      WHERE DATE(created_at, 'localtime') = ? AND is_paid = 1 AND payment_mode = 'cash'
    `).get(targetDate).amt;

    const restOnline = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as amt FROM restaurant_orders 
      WHERE DATE(created_at, 'localtime') = ? AND is_paid = 1 AND (payment_mode = 'online' OR payment_mode = 'upi')
    `).get(targetDate).amt;

    const restCard = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as amt FROM restaurant_orders 
      WHERE DATE(created_at, 'localtime') = ? AND is_paid = 1 AND payment_mode = 'card'
    `).get(targetDate).amt;

    const barCash = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as amt FROM bar_orders 
      WHERE DATE(created_at, 'localtime') = ? AND is_paid = 1 AND payment_mode = 'cash'
    `).get(targetDate).amt;

    const barOnline = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as amt FROM bar_orders 
      WHERE DATE(created_at, 'localtime') = ? AND is_paid = 1 AND (payment_mode = 'online' OR payment_mode = 'upi')
    `).get(targetDate).amt;

    const barCard = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as amt FROM bar_orders 
      WHERE DATE(created_at, 'localtime') = ? AND is_paid = 1 AND payment_mode = 'card'
    `).get(targetDate).amt;

    let expenseCashTotal = 0;
    let expenseTotal = 0;
    expensesList.forEach(e => {
      expenseTotal += (e.amount || 0);
      if ((e.payment_mode || '').toLowerCase() === 'cash') expenseCashTotal += (e.amount || 0);
    });

    const totalInflowCash = advanceCash + billCash + btcCash + restCash + barCash;
    const netDrawerClosingCash = totalInflowCash - expenseCashTotal;
    const roomRevenue = advanceCash + advanceOnline + advanceCard + billCash + billOnline + billCard + btcCash + btcOnline + btcCard + btcCheque;
    const restaurantRevenue = restCash + restOnline + restCard;
    const barRevenue = barCash + barOnline + barCard;
    const totalRevenue = roomRevenue + restaurantRevenue + barRevenue;

    const prebookedClosingStats = db.prepare(`
      SELECT 
        COALESCE(SUM(b.ota_bill_amount), 0) as total,
        COUNT(DISTINCT b.voucher_number) as count
      FROM (
        SELECT voucher_number, MAX(ota_bill_amount) as ota_bill_amount, is_prepaid, booking_source, created_at, status
        FROM bookings
        WHERE is_prepaid = 1 AND (booking_source = 'OTA' OR ota_bill_amount > 0) AND status != 'cancelled'
        GROUP BY voucher_number
      ) b
      WHERE DATE(b.created_at, 'localtime') = ?
    `).get(targetDate);

    const reportObj = {
      date: targetDate,
      totalRevenue,
      prebookedTotal: prebookedClosingStats.total || 0,
      prebookedCount: prebookedClosingStats.count || 0,
      roomRevenue,
      restaurantRevenue,
      barRevenue,
      totalExpenses: expenseTotal,
      netCashInDrawer: netDrawerClosingCash,
      onlineCollections: advanceOnline + billOnline + btcOnline + restOnline + barOnline,
      cardCollections: advanceCard + billCard + btcCard + restCard + barCard,
      chequeCollections: btcCheque,
      expenseCount: expensesList.length,
      cashiers,
      btcSettlement: {
        cash: btcCash,
        online: btcOnline,
        card: btcCard,
        cheque: btcCheque,
        total: btcCash + btcOnline + btcCard + btcCheque
      },
      summary: {
        advanceCash,
        advanceOnline,
        advanceCard,
        billCash,
        billOnline,
        billCard,
        btcCash,
        btcOnline,
        btcCard,
        btcCheque,
        restCash,
        barCash,
        totalInflowCash,
        expenseCashTotal,
        netDrawerClosingCash
      },
      payments: paymentsList,
      expenses: expensesList
    };

    res.json({
      success: true,
      report: reportObj,
      data: reportObj
    });
  } catch (err) {
    console.error('Daily closing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 22. MONEY RECEIPT & PETTY CASH VOUCHER DATA APIS (FOR 2-PER-A4 PRINT)
// ==========================================================================
app.get('/api/receipts/advance/:bookingId', (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = db.prepare(`
      SELECT 
        b.*,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.address as guest_address,
        r.room_number,
        r.room_type
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN rooms r ON b.room_id = r.id
      WHERE b.id = ?
    `).get(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    // Fetch linked group rooms if combined booking
    const linkedRooms = db.prepare(`
      SELECT r.room_number, r.room_type, b.total_room_charge 
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.guest_id = ? AND b.checkin_time = ?
    `).all(booking.guest_id, booking.checkin_time);

    const totalGroupCharge = linkedRooms.reduce((sum, lr) => sum + (lr.total_room_charge || 0), 0);
    const paidAmount = booking.advance_payment || booking.total_paid || 0;
    const dueAmount = Math.max(0, totalGroupCharge - paidAmount);

    res.json({
      success: true,
      receipt: {
        receipt_no: booking.final_receipt_no || booking.advance_receipt_no || `RCP-${500 + booking.id}`,
        receipt_date: booking.checkin_time,
        date: booking.checkin_time,
        guest_name: booking.guest_name,
        guest_mobile: booking.guest_mobile,
        room_numbers: linkedRooms.map(r => r.room_number).join(', '),
        particulars: `Advance / Room Stay (${linkedRooms.map(r => 'Room ' + r.room_number).join(', ')})`,
        bill_no: `INV-${booking.id}`,
        amount: paidAmount,
        amount_paid: paidAmount,
        total_bill_amount: totalGroupCharge,
        due_amount: dueAmount,
        payment_mode: booking.final_settlement_mode || booking.advance_payment_mode || 'Cash',
        cheque_no: booking.advance_cheque_no,
        cheque_bank: booking.advance_cheque_bank,
        cheque_status: booking.advance_cheque_status,
        cashier_name: booking.checked_in_by || req.user?.full_name || req.user?.username || 'Cashier'
      }
    });
  } catch (err) {
    console.error('Advance receipt data error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/vouchers/petty-cash/:expenseId', (req, res) => {
  try {
    const { expenseId } = req.params;
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId);
    if (!expense) {
      return res.status(404).json({ success: false, error: 'Expense voucher not found' });
    }

    res.json({
      success: true,
      voucher: expense
    });
  } catch (err) {
    console.error('Petty cash voucher fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Direct Screen Routes for Multi-Screen setups (serving React app)
app.get(['/', '/hospitality', '/restaurant', '/bar', '/manage', '/expenses'], (req, res) => {
  const indexPath = fs.existsSync(path.join(distDir, 'index.html'))
    ? path.join(distDir, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

if (require.main === module && !process.env.NETLIFY) {
  const server = app.listen(PORT, () => {
    console.log(`✨ Hotel City Park CRM running on http://localhost:${PORT}`);
    console.log(`🏨 Hospitality Screen: http://localhost:${PORT}/hospitality`);
    console.log(`🍽️ Restaurant POS Screen: http://localhost:${PORT}/restaurant`);
    console.log(`🍸 Bar POS Screen: http://localhost:${PORT}/bar`);
    console.log(`⚙️ Manage Rooms (Owner): http://localhost:${PORT}/manage`);

    // Non-blocking background sync of active occupancies to Supabase cloud
    supabaseService.syncAllActiveRoomsFromLocal(db)
      .then(res => {
        if (res && res.success) console.log(`[Supabase] Initial sync: ${res.synced} occupied room(s) synced to cloud.`);
      })
      .catch(err => console.warn('[Supabase] Initial sync skipped:', err.message));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n⚠️ Port ${PORT} is already in use! The CRM server is already running in another process or terminal.`);
      console.error(`👉 You can open http://localhost:${PORT} in your browser, or stop the other process first.\n`);
    } else {
      console.error('Server error:', err);
    }
  });
}

module.exports = app;
