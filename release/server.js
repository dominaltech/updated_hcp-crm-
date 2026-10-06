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
function getCurrentFinancialYear(dateObj = new Date()) {
  const m = dateObj.getMonth(); // 0-indexed: 0=Jan, 3=Apr, 4=May
  const y = dateObj.getFullYear();
  // Financial year resets 30 April night 12:00 (1 May start)
  const startYear = m < 4 ? y - 1 : y;
  return `FY${startYear}-${startYear + 1}`;
}

function getNextMonthlyVoucherNumber(prefix = 'VCH', dateObj = new Date()) {
  try {
    const yyyy = dateObj.getFullYear();
    const yy = String(yyyy).slice(-2);
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const yearMonth = `${yyyy}${mm}`;
    const dateStr = `${yy}${mm}${dd}`;

    // For REG (Checkin/Invoice numbering), check if manager configured starting number and financial year sequence
    if (prefix === 'REG') {
      const currentFY = getCurrentFinancialYear(dateObj);
      const startRow = db.prepare("SELECT value FROM system_settings WHERE key = 'invoice_starting_number'").get();
      const seqRow = db.prepare("SELECT value FROM system_settings WHERE key = 'invoice_current_seq'").get();
      const fyRow = db.prepare("SELECT value FROM system_settings WHERE key = 'invoice_fy_year'").get();

      const startNum = startRow && !isNaN(parseInt(startRow.value)) ? parseInt(startRow.value) : 1;
      let nextSeq = seqRow && !isNaN(parseInt(seqRow.value)) ? parseInt(seqRow.value) : startNum;
      const storedFY = fyRow?.value;

      // Auto-reset to starting number at financial year end (30 April night 12:00)
      if (storedFY && storedFY !== currentFY) {
        nextSeq = startNum;
      }

      // Save next sequence for subsequent invoices
      const subsequentSeq = nextSeq + 1;
      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('invoice_current_seq', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(String(subsequentSeq));

      db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('invoice_fy_year', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(currentFY);

      const srPadded = String(nextSeq).padStart(3, '0');
      return `${dateStr}-${srPadded}`;
    }

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

function getReceiptNumberWithMode(mode = 'cash', customDb = null) {
  const activeDb = (customDb && typeof customDb.prepare === 'function') ? customDb : db;
  const m = String(mode || 'cash').toLowerCase();
  let prefix = 'CR';
  if (m.includes('upi') || m.includes('online')) prefix = 'UPI';
  else if (m.includes('card') || m.includes('pos')) prefix = 'POS';
  else if (m.includes('cheque') || m.includes('check')) prefix = 'CHQ';
  else if (m.includes('btc') || m.includes('company')) prefix = 'BTC';

  try {
    const row = activeDb.prepare("SELECT last_seq FROM monthly_voucher_sequences WHERE prefix = ? AND year_month = 'ALL'").get('RECEIPT_' + prefix);
    const nextSeq = (row && row.last_seq !== undefined ? row.last_seq : 0) + 1;

    activeDb.prepare(`
      INSERT INTO monthly_voucher_sequences (prefix, year_month, last_seq)
      VALUES (?, 'ALL', ?)
      ON CONFLICT(prefix, year_month) DO UPDATE SET last_seq = ?
    `).run('RECEIPT_' + prefix, nextSeq, nextSeq);

    const srPadded = String(nextSeq).padStart(2, '0');
    return `${prefix}${srPadded}`;
  } catch (err) {
    console.error('Error generating receipt sequence for ' + prefix + ':', err);
    return `${prefix}01`;
  }
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
      floor,
      room_type, 
      price, 
      price_single,
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
      extra_bed_gst_pct,
      breakfast_gst_pct,
      ext_3h_gst_pct,
      ext_6h_gst_pct,
      ext_9h_gst_pct,
      single_gst_pct,
      ota_early_checkin_price,
      ota_early_checkin_max_hours,
      ota_early_checkin_gst_pct
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
        room_number, floor, room_type, price, price_single, max_adults, max_children, max_discount_pct, 
        ext_grace_mins, ext_3h_rate, ext_6h_rate, ext_9h_rate,
        breakfast_price, max_extra_beds, extra_bed_price, gst_pct,
        extra_bed_gst_pct, breakfast_gst_pct, ext_3h_gst_pct, ext_6h_gst_pct, ext_9h_gst_pct, single_gst_pct,
        ota_early_checkin_price, ota_early_checkin_max_hours, ota_early_checkin_gst_pct,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
    `);

    const result = stmt.run(
      room_number,
      floor || 'First Floor',
      room_type || 'Deluxe Room',
      parseFloat(price),
      price_single !== undefined && price_single !== '' && price_single !== null ? parseFloat(price_single) : null,
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
      parseFloat(gst_pct) !== undefined && !isNaN(parseFloat(gst_pct)) ? parseFloat(gst_pct) : 5,
      parseFloat(extra_bed_gst_pct) !== undefined && !isNaN(parseFloat(extra_bed_gst_pct)) ? parseFloat(extra_bed_gst_pct) : 5,
      parseFloat(breakfast_gst_pct) !== undefined && !isNaN(parseFloat(breakfast_gst_pct)) ? parseFloat(breakfast_gst_pct) : 5,
      parseFloat(ext_3h_gst_pct) !== undefined && !isNaN(parseFloat(ext_3h_gst_pct)) ? parseFloat(ext_3h_gst_pct) : 5,
      parseFloat(ext_6h_gst_pct) !== undefined && !isNaN(parseFloat(ext_6h_gst_pct)) ? parseFloat(ext_6h_gst_pct) : 5,
      parseFloat(ext_9h_gst_pct) !== undefined && !isNaN(parseFloat(ext_9h_gst_pct)) ? parseFloat(ext_9h_gst_pct) : 5,
      parseFloat(single_gst_pct) !== undefined && !isNaN(parseFloat(single_gst_pct)) ? parseFloat(single_gst_pct) : (parseFloat(gst_pct) || 5),
      parseFloat(ota_early_checkin_price) !== undefined && !isNaN(parseFloat(ota_early_checkin_price)) ? parseFloat(ota_early_checkin_price) : 900,
      parseInt(ota_early_checkin_max_hours) !== undefined && !isNaN(parseInt(ota_early_checkin_max_hours)) ? parseInt(ota_early_checkin_max_hours) : 6,
      parseFloat(ota_early_checkin_gst_pct) !== undefined && !isNaN(parseFloat(ota_early_checkin_gst_pct)) ? parseFloat(ota_early_checkin_gst_pct) : 5
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
      floor,
      room_type, 
      price, 
      price_single,
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
      extra_bed_gst_pct,
      breakfast_gst_pct,
      ext_3h_gst_pct,
      ext_6h_gst_pct,
      ext_9h_gst_pct,
      single_gst_pct,
      ota_early_checkin_price,
      ota_early_checkin_max_hours,
      ota_early_checkin_gst_pct,
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

    const resolvedPriceSingle = price_single !== undefined 
      ? (price_single !== '' && price_single !== null ? parseFloat(price_single) : null)
      : currentRoom.price_single;

    const stmt = db.prepare(`
      UPDATE rooms 
      SET 
        room_number = COALESCE(?, room_number),
        floor = COALESCE(?, floor),
        room_type = COALESCE(?, room_type),
        price = COALESCE(?, price),
        price_single = ?,
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
        extra_bed_gst_pct = COALESCE(?, extra_bed_gst_pct),
        breakfast_gst_pct = COALESCE(?, breakfast_gst_pct),
        ext_3h_gst_pct = COALESCE(?, ext_3h_gst_pct),
        ext_6h_gst_pct = COALESCE(?, ext_6h_gst_pct),
        ext_9h_gst_pct = COALESCE(?, ext_9h_gst_pct),
        single_gst_pct = COALESCE(?, single_gst_pct),
        ota_early_checkin_price = COALESCE(?, ota_early_checkin_price),
        ota_early_checkin_max_hours = COALESCE(?, ota_early_checkin_max_hours),
        ota_early_checkin_gst_pct = COALESCE(?, ota_early_checkin_gst_pct),
        status = COALESCE(?, status)
      WHERE id = ?
    `);

    stmt.run(
      room_number,
      floor !== undefined && floor !== '' ? floor : null,
      room_type,
      price !== undefined ? parseFloat(price) : null,
      resolvedPriceSingle,
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
      extra_bed_gst_pct !== undefined ? parseFloat(extra_bed_gst_pct) : null,
      breakfast_gst_pct !== undefined ? parseFloat(breakfast_gst_pct) : null,
      ext_3h_gst_pct !== undefined ? parseFloat(ext_3h_gst_pct) : null,
      ext_6h_gst_pct !== undefined ? parseFloat(ext_6h_gst_pct) : null,
      ext_9h_gst_pct !== undefined ? parseFloat(ext_9h_gst_pct) : null,
      single_gst_pct !== undefined ? parseFloat(single_gst_pct) : null,
      ota_early_checkin_price !== undefined && ota_early_checkin_price !== '' && ota_early_checkin_price !== null ? parseFloat(ota_early_checkin_price) : null,
      ota_early_checkin_max_hours !== undefined && ota_early_checkin_max_hours !== '' && ota_early_checkin_max_hours !== null ? parseInt(ota_early_checkin_max_hours) : null,
      ota_early_checkin_gst_pct !== undefined && ota_early_checkin_gst_pct !== '' && ota_early_checkin_gst_pct !== null ? parseFloat(ota_early_checkin_gst_pct) : null,
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

// 6.5. ROOM TRANSFER (Shift occupied room to an available empty room of the same room type)
app.post('/api/rooms/transfer', optionalAuth, (req, res) => {
  try {
    const { from_room_id, to_room_id, fromRoomId, toRoomId, reason } = req.body || {};
    const srcId = from_room_id || fromRoomId;
    const destId = to_room_id || toRoomId;

    if (!srcId || !destId) {
      return res.status(400).json({ success: false, error: 'Both source room and destination room are required.' });
    }

    if (String(srcId) === String(destId)) {
      return res.status(400).json({ success: false, error: 'Source room and destination room cannot be the same.' });
    }

    const fromRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(srcId);
    if (!fromRoom) {
      return res.status(404).json({ success: false, error: `Source room (ID ${srcId}) not found.` });
    }

    if (fromRoom.status !== 'occupied' || !fromRoom.current_booking_id) {
      return res.status(400).json({ success: false, error: `Source room #${fromRoom.room_number} is not currently occupied.` });
    }

    const toRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(destId);
    if (!toRoom) {
      return res.status(404).json({ success: false, error: `Destination room (ID ${destId}) not found.` });
    }

    if (toRoom.status !== 'ready') {
      return res.status(400).json({ 
        success: false, 
        error: `Destination room #${toRoom.room_number} is not available (Status: ${toRoom.status}). Only empty/ready rooms can be transferred into.` 
      });
    }

    // USER REQUIREMENT: "same room type to same room type (there price will bw same just room number will be changed )"
    const srcType = String(fromRoom.room_type || '').trim().toLowerCase();
    const destType = String(toRoom.room_type || '').trim().toLowerCase();
    if (srcType !== destType) {
      return res.status(400).json({
        success: false,
        error: `Room transfer is only permitted between rooms of the same room type. Source Room #${fromRoom.room_number} is "${fromRoom.room_type}", but Destination Room #${toRoom.room_number} is "${toRoom.room_type}".`
      });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND status = ?').get(fromRoom.current_booking_id, 'active');
    if (!booking) {
      return res.status(404).json({ success: false, error: `Active booking not found for room #${fromRoom.room_number}.` });
    }

    const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(booking.guest_id);
    const transferredBy = req.user?.full_name || req.user?.username || req.body?.transferred_by || 'Front Desk';

    const transferTx = db.transaction(() => {
      // 1. Move active booking to new destination room
      db.prepare(`UPDATE bookings SET room_id = ? WHERE id = ?`).run(toRoom.id, booking.id);

      // 2. Mark destination room as occupied with this booking
      db.prepare(`UPDATE rooms SET status = 'occupied', current_booking_id = ? WHERE id = ?`).run(booking.id, toRoom.id);

      // 3. Mark source room vacated (needs cleaning)
      db.prepare(`UPDATE rooms SET status = 'needs_cleaning', current_booking_id = NULL WHERE id = ?`).run(fromRoom.id);

      // 4. Update payments to reference new room
      db.prepare(`UPDATE payments SET room_id = ? WHERE booking_id = ?`).run(toRoom.id, booking.id);

      // 5. Update room service / unpaid folio restaurant orders to new room
      db.prepare(`
        UPDATE restaurant_orders 
        SET room_id = ?, table_number = ? 
        WHERE booking_id = ? AND payment_mode = 'room_folio'
      `).run(toRoom.id, `Room ${toRoom.room_number}`, booking.id);

      // 6. Update room service / unpaid folio bar orders to new room
      db.prepare(`
        UPDATE bar_orders 
        SET room_id = ? 
        WHERE booking_id = ? AND payment_mode = 'room_folio'
      `).run(toRoom.id, booking.id);

      // 7. Update active room visitors to new room
      db.prepare(`
        UPDATE room_visitors 
        SET room_id = ? 
        WHERE booking_id = ?
      `).run(toRoom.id, booking.id);

      // 8. Record audit log entry in booking extension_logs_json
      let extLogs = [];
      try {
        extLogs = booking.extension_logs_json ? JSON.parse(booking.extension_logs_json) : [];
      } catch (e) {
        extLogs = [];
      }
      extLogs.push({
        type: 'room_transfer',
        from_room_id: fromRoom.id,
        from_room_number: fromRoom.room_number,
        to_room_id: toRoom.id,
        to_room_number: toRoom.room_number,
        room_type: fromRoom.room_type,
        transferred_at: new Date().toISOString(),
        transferred_by: transferredBy,
        reason: reason || 'Room shift (same room type)'
      });
      db.prepare(`UPDATE bookings SET extension_logs_json = ? WHERE id = ?`).run(JSON.stringify(extLogs), booking.id);
    });

    transferTx();

    res.json({
      success: true,
      message: `Room transferred successfully from Room #${fromRoom.room_number} to Room #${toRoom.room_number}`,
      from_room: { id: fromRoom.id, room_number: fromRoom.room_number, room_type: fromRoom.room_type },
      to_room: { id: toRoom.id, room_number: toRoom.room_number, room_type: toRoom.room_type },
      guest_name: guest ? guest.name : 'Guest',
      booking_id: booking.id
    });
  } catch (err) {
    console.error('Room transfer error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. CHECK-IN GUEST (Multi-step scanned documents, photo, occupancy, multi-room group booking, corporate BTC, advance payments & cheques)
app.post('/api/checkin', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  const transaction = db.transaction(() => {
    const b = req.body || {};
    const room_id = b.room_id ?? b.roomId;
    const additional_room_ids = b.additional_room_ids ?? b.additionalRooms ?? b.additional_rooms ?? [];

    const primaryRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
    if (!primaryRoom) throw new Error('Primary room not found');
    if (primaryRoom.status === 'occupied') throw new Error(`Room ${primaryRoom.room_number} is already occupied`);

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
    const guest_photo = b.guest_photo ?? b.guestPhoto ?? b.photo ?? '';
    let adults_male = parseInt(b.adults_male ?? b.adultsMale ?? 1) || 0;
    let adults_female = parseInt(b.adults_female ?? b.adultsFemale ?? 0) || 0;
    let adults_other = parseInt(b.adults_other ?? b.adultsOther ?? 0) || 0;
    const cleanExtraBeds = parseInt(b.extra_beds ?? b.extraBeds ?? 0) || 0;
    // User Requirement: "if 2 bed + 1 Extra mattress = it will be 1pax or 3 pax (we want it should be 3 pax)"
    const roomBaseCapacity = parseInt(primaryRoom.max_adults) || 2;
    if (cleanExtraBeds > 0 && (adults_male + adults_female + adults_other) < (roomBaseCapacity + cleanExtraBeds)) {
      const needed = (roomBaseCapacity + cleanExtraBeds) - (adults_female + adults_other);
      adults_male = Math.max(adults_male, needed);
    }
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
    const cleanCompanyName = (b.company_name || b.companyName || req.body.company_name || req.body.companyName || b.btc_company_name || '').trim() || null;
    const cleanGstNumber = (b.gst_number || b.gstNumber || req.body.gst_number || req.body.gstNumber || b.btc_gst_number || '').trim() || null;
    const guestStmt = db.prepare(`
      INSERT INTO guests (name, father_name, mobile, alt_mobile, email, address, dob, doc_type, doc_front, doc_back, guest_photo, aadhar_number, company_name, gst_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      cleanAadharNumber,
      cleanCompanyName,
      cleanGstNumber
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
        const cInStr = (b.checkin_time || b.checkinTime || new Date().toISOString());
        const dIn = new Date(cInStr);
        const dOut = new Date(approx_checkout_time);
        if (!isNaN(dIn.getTime()) && !isNaN(dOut.getTime()) && dOut > dIn) {
          const cInDate = cInStr.split('T')[0];
          const cOutDate = String(approx_checkout_time).split('T')[0];
          if (cInDate && cOutDate) {
            const diffDays = Math.round((new Date(cOutDate) - new Date(cInDate)) / (1000 * 60 * 60 * 24));
            stayNights = Math.max(1, diffDays);
          }

          if (!isOta) {
            const elapsedHours = (dOut.getTime() - dIn.getTime()) / (1000 * 60 * 60);
            const paidStayHours = stayNights * 24;
            if (elapsedHours > paidStayHours) {
              const extraMinutes = (elapsedHours - paidStayHours) * 60;
              const graceMins = Number(primaryRoom.ext_grace_mins) || 60;
              const r3h = primaryRoom.ext_3h_rate ?? 500;
              const r6h = primaryRoom.ext_6h_rate ?? 1000;
              const r9h = primaryRoom.ext_9h_rate ?? 1500;

              if (extraMinutes > graceMins) {
                if (extraMinutes <= 180) {
                  computedExtensionCharge = r3h;
                } else if (extraMinutes <= 360) {
                  computedExtensionCharge = r6h;
                } else if (extraMinutes <= 540) {
                  computedExtensionCharge = r9h;
                } else {
                  computedExtensionCharge = Number(primaryRoom.price || 2000);
                }
              }
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
      extCharge = 0; // For OTA bookings, extension is handled separately or included
    }

    let otaEarlyCheckinCharge = 0;
    let otaEarlyCheckinGst = 0;
    if (isOta && is_early_checkin) {
      const roomEarlyPrice = (primaryRoom.ota_early_checkin_price !== undefined && primaryRoom.ota_early_checkin_price !== null)
        ? parseFloat(primaryRoom.ota_early_checkin_price)
        : 900;
      const roomEarlyGstPct = (primaryRoom.ota_early_checkin_gst_pct !== undefined && primaryRoom.ota_early_checkin_gst_pct !== null)
        ? parseFloat(primaryRoom.ota_early_checkin_gst_pct)
        : 5;
      otaEarlyCheckinCharge = (b.early_checkin_charge !== undefined && b.early_checkin_charge !== null)
        ? parseFloat(b.early_checkin_charge)
        : roomEarlyPrice;
      otaEarlyCheckinGst = Math.round(otaEarlyCheckinCharge * (roomEarlyGstPct / 100));
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
      effectiveBaseRate = manualOtaAmount + extCharge + extraBedFee + mealFee + otaEarlyCheckinCharge;
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

    // User Requirement: "In ota booking, either prebook / pay at hotel, gst is 5%, right? it will be included or excluded from entered amount (we want included with gst)"
    const otaGstPct = roomGstPct || 5;
    let otaBaseAmount = 0;
    let otaGstAmount = 0;
    if (isOta && manualOtaAmount !== null && manualOtaAmount >= 0) {
      otaBaseAmount = Math.round((manualOtaAmount / (1 + (otaGstPct / 100))) * 100) / 100;
      otaGstAmount = Number((manualOtaAmount - otaBaseAmount).toFixed(2));
    }
    const tariffTax = isOta ? otaGstAmount : Math.round(netChargeBeforeTax * (roomGstPct / 100));
    let netTotalCharge = isOta ? effectiveBaseRate : (netChargeBeforeTax + tariffTax);

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
      const otaExtrasFee = extraBedFee + extCharge + extraRoomsFee + extraBreakfastFee + otaEarlyCheckinCharge;
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

    const checkinTime = (b.checkin_time || b.checkinTime || req.body.checkin_time || req.body.checkinTime || new Date().toISOString()).trim();
    
    const paymentStatus = isBtc ? 'pending_from_company' : (totalPaid >= netTotalCharge ? 'paid' : (totalPaid > 0 ? 'partial' : 'pending'));
    
    const cleanOtaPlatform = isOta ? (ota_platform || '').trim() : null;
    const cleanOtaBookingId = isOta ? (ota_booking_id || '').trim() : null;
    
    const cleanBtcCompanyId = isBtc ? (parseInt(btc_company_id) || null) : null;
    const cleanBtcCompanyName = isBtc ? (btc_company_name || '').trim() : null;
    const cleanBtcApprovalRef = isBtc ? (btc_approval_ref || '').trim() : null;

    const isManualEntry = manual_entry ? 1 : 0;
    const cleanDocProofsJson = typeof doc_proofs_json === 'string' ? doc_proofs_json : JSON.stringify(doc_proofs_json || []);
    const cleanExtraBedCharge = parseFloat(extra_bed_charge) || 0;
    const cleanCheckedInBy = (req.body.checked_in_by || 'Front Desk').trim();

    // Advance Payment Mode & Cheque Attributes
    const checkinRateType = req.body.rate_type || b.rate_type || null;
    const isOtaPrepaidCheckin = (booking_source || '').toUpperCase() === 'OTA' && (Boolean(cleanIsPrepaid) || checkinRateType === 'prepaid');
    const defaultAdvMode = isOtaPrepaidCheckin && (cash + card + online + cheque) === 0 ? 'prepaid' : 'cash';
    const advMode = (advance_payment_mode || (cash > 0 ? 'cash' : (card > 0 ? 'card' : (online > 0 ? 'upi' : defaultAdvMode)))).toLowerCase();
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

    // Generate standard voucher number for check-in registration
    const standardVoucherNo = getNextMonthlyVoucherNumber('REG');

    // Generate separate serial receipt numbers for each payment mode (starts from 01, 02... with prefixes CR, UPI, POS, CHQ)
    const paymentReceipts = [];
    const receiptNumbers = {};
    if (totalPaid > 0) {
      if (splitCashVal > 0) {
        const no = getReceiptNumberWithMode('cash');
        paymentReceipts.push({
          receipt_no: no,
          mode: 'cash',
          amount: splitCashVal,
          base_amount: splitCashVal,
          label: 'Cash'
        });
        receiptNumbers.cash = no;
      }
      if (splitOnlineVal > 0) {
        const no = getReceiptNumberWithMode('upi');
        paymentReceipts.push({
          receipt_no: no,
          mode: 'upi',
          amount: splitOnlineVal + advUpiTax,
          base_amount: splitOnlineVal,
          label: 'Online UPI',
          utr_number: online_utr,
          upi_tax: advUpiTax
        });
        receiptNumbers.upi = no;
      }
      if (splitCardVal > 0) {
        const no = getReceiptNumberWithMode('card');
        paymentReceipts.push({
          receipt_no: no,
          mode: 'card',
          amount: splitCardVal + advCardSurcharge,
          base_amount: splitCardVal,
          label: 'Card POS',
          card_surcharge: advCardSurcharge
        });
        receiptNumbers.card = no;
      }
      if (splitChequeVal > 0) {
        const no = getReceiptNumberWithMode('cheque');
        paymentReceipts.push({
          receipt_no: no,
          mode: 'cheque',
          amount: splitChequeVal,
          base_amount: splitChequeVal,
          label: 'Cheque',
          cheque_no: advChequeNo,
          bank_name: advChequeBank
        });
        receiptNumbers.cheque = no;
      }
      if (paymentReceipts.length === 0) {
        const no = getReceiptNumberWithMode(advMode);
        paymentReceipts.push({
          receipt_no: no,
          mode: advMode,
          amount: totalPaid,
          base_amount: totalPaid,
          label: advMode === 'upi' ? 'Online UPI' : (advMode === 'card' ? 'Card POS' : (advMode === 'cheque' ? 'Cheque' : 'Cash'))
        });
        receiptNumbers[advMode] = no;
      }
    }
    const advanceReceiptNo = paymentReceipts.length > 0 ? paymentReceipts.map(p => p.receipt_no).join(', ') : null;
    const cleanMemberDocsJson = typeof b.member_documents === 'string'
      ? b.member_documents
      : JSON.stringify(b.member_documents || b.memberDocuments || b.member_documents_json || []);

    const cleanTaxType = (b.tax_type || (b.is_igst || b.isIgst ? 'igst' : 'cgst_sgst')).toLowerCase();
    const cleanIsIgst = (cleanTaxType === 'igst' || b.is_igst || b.isIgst) ? 1 : 0;
    let cleanCompanyAddress = (b.company_address || b.companyAddress || b.btcCompanyAddress || b.btc_company_address || '').trim() || null;
    if (!cleanCompanyAddress && cleanBtcCompanyId) {
      const comp = db.prepare('SELECT address FROM btc_companies WHERE id = ?').get(cleanBtcCompanyId);
      if (comp && comp.address) cleanCompanyAddress = comp.address.trim();
    }

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
        is_early_checkin, original_checkin_time, early_checkin_time, early_checkin_charge, early_checkin_gst,
        advance_card_surcharge, advance_upi_tax,
        ota_booked_adults, ota_booked_children, ota_booked_extra_beds, extra_adults, extra_children,
        extra_rooms_charge, extra_breakfast_charge, extra_meal_plan,
        company_name, gst_number, company_address, tax_type, is_igst
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        idx === 0 ? otaEarlyCheckinCharge : 0,
        idx === 0 ? otaEarlyCheckinGst : 0,
        idx === 0 ? advCardSurcharge : 0,
        idx === 0 ? advUpiTax : 0,
        idx === 0 ? ota_booked_adults : null,
        idx === 0 ? ota_booked_children : 0,
        idx === 0 ? ota_booked_extra_beds : 0,
        idx === 0 ? extra_adults : 0,
        idx === 0 ? extra_children : 0,
        idx === 0 ? extra_rooms_charge : 0,
        idx === 0 ? extra_breakfast_charge : 0,
        idx === 0 ? extra_meal_plan : null,
        cleanCompanyName,
        cleanGstNumber,
        cleanCompanyAddress,
        cleanTaxType,
        cleanIsIgst
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
    if (totalPaid > 0 && paymentReceipts.length > 0) {
      const pmtStmt = db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_no, bank_name, cheque_date, cheque_status, realized_at,
          btc_company_id, btc_company_name, cashier_name, notes, cheque_photo, utr_number,
          card_surcharge, upi_tax, split_cash, split_card, split_online, split_cheque
        ) VALUES (?, ?, ?, 'hospitality', 'advance', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      paymentReceipts.forEach(pr => {
        pmtStmt.run(
          pr.receipt_no,
          bookingIds[0],
          primaryRoom.id,
          pr.mode,
          pr.amount,
          pr.mode === 'cheque' ? (pr.cheque_no || advChequeNo) : null,
          pr.mode === 'cheque' ? (pr.bank_name || advChequeBank) : null,
          pr.mode === 'cheque' ? advChequeDate : null,
          pr.mode === 'cheque' ? advChequeStatus : 'realized',
          pr.mode === 'cheque' && advChequeStatus === 'pending' ? null : checkinTime,
          cleanBtcCompanyId,
          cleanBtcCompanyName,
          cleanCheckedInBy,
          `paid while checkin : ${pr.label}${pr.card_surcharge ? ` (+₹${pr.card_surcharge} Card fee)` : ''}${pr.upi_tax ? ` (+₹${pr.upi_tax} UPI tax)` : ''}`,
          pr.mode === 'cheque' ? advChequePhoto : null,
          pr.mode === 'upi' ? online_utr : null,
          pr.card_surcharge || 0,
          pr.upi_tax || 0,
          pr.mode === 'cash' ? pr.amount : 0,
          pr.mode === 'card' ? pr.base_amount : 0,
          pr.mode === 'upi' ? pr.base_amount : 0,
          pr.mode === 'cheque' ? pr.amount : 0
        );
      });
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
      advance_receipt_no: advanceReceiptNo,
      receiptNumbers,
      receipt_numbers: receiptNumbers,
      receipts: paymentReceipts,
      paymentReceipts,
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

    // Fetch Restaurant & Bar orders during stay if any
    let restaurantOrders = [];
    let barOrders = [];
    try {
      restaurantOrders = db.prepare(`
        SELECT ro.*, r.room_number 
        FROM restaurant_orders ro
        LEFT JOIN rooms r ON ro.room_id = r.id
        WHERE ro.booking_id = ?
           OR (ro.booking_id IS NULL AND ro.room_id = ? AND datetime(ro.created_at) >= ? AND datetime(ro.created_at) <= datetime(?, '+2 hours'))
        ORDER BY ro.created_at ASC
      `).all(id, booking.room_id, booking.checkin_time || '2000-01-01', booking.actual_checkout_time || booking.checkout_time || '2099-01-01');
    } catch (_) {}

    try {
      barOrders = db.prepare(`
        SELECT bo.*, r.room_number 
        FROM bar_orders bo
        LEFT JOIN rooms r ON bo.room_id = r.id
        WHERE bo.booking_id = ?
           OR (bo.booking_id IS NULL AND bo.room_id = ? AND datetime(bo.created_at) >= ? AND datetime(bo.created_at) <= datetime(?, '+2 hours'))
        ORDER BY bo.created_at ASC
      `).all(id, booking.room_id, booking.checkin_time || '2000-01-01', booking.actual_checkout_time || booking.checkout_time || '2099-01-01');
    } catch (_) {}

    const formattedBooking = {
      ...booking,
      member_documents: memberDocs,
      memberDocuments: memberDocs,
      payments: payments || [],
      restaurantOrders: restaurantOrders || [],
      barOrders: barOrders || [],
      orders: [...restaurantOrders.map(o => ({ ...o, dept: 'Restaurant' })), ...barOrders.map(o => ({ ...o, dept: 'Bar Lounge' }))]
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

// 8b. EXTEND CHECKOUT TIME & LOG AUDIT TRAIL (Updates all linked group rooms, charges extended amount & records split payments)
app.post('/api/bookings/:id/extend-checkout', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { approx_checkout_time, payments } = req.body;
    const extended_amount = parseFloat(req.body.extended_amount) || 0;
    const paid_amount = parseFloat(req.body.paid_amount) || 0;
    const extended_by = (req.body.extended_by || req.body.cashier_name || req.user?.full_name || req.user?.username || 'Front Desk').trim();
    if (!approx_checkout_time) {
      return res.status(400).json({ success: false, error: 'approx_checkout_time is required' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(booking.room_id) || {};
    const roomNumber = room.room_number || String(booking.room_id || '');

    // User requirement: If extended amount > 0, min 50% must be paid to confirm extension
    const paymentItems = Array.isArray(payments) ? payments : [];
    const sumPaymentItems = paymentItems.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
    const effectivePaid = Math.max(paid_amount, sumPaymentItems);

    if (extended_amount > 0) {
      const minRequired = Math.ceil(extended_amount * 0.5);
      if (effectivePaid < minRequired) {
        return res.status(400).json({
          success: false,
          error: `Minimum 50% advance payment required to confirm extension. (Required: ₹${minRequired}, Received: ₹${effectivePaid})`
        });
      }
    }

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
      extended_amount,
      paid_amount: effectivePaid,
      created_at: nowIso
    };
    logs.push(newLogEntry);
    const logsJson = JSON.stringify(logs);

    // Record individual payment transactions (Cash, UPI, Card POS) with official serial numbers
    const createdReceipts = [];
    let addedCash = 0;
    let addedCard = 0;
    let addedOnline = 0;

    if (paymentItems.length > 0) {
      const insertPaymentStmt = db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, realized_at, cashier_name, notes, particulars, utr_number,
          card_digits, split_cash, split_card, split_online, voucher_number
        ) VALUES (?, ?, ?, 'hospitality', 'advance', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const p of paymentItems) {
        const pAmt = parseFloat(p.amount) || 0;
        if (pAmt <= 0) continue;

        const rawMode = String(p.mode || p.payment_mode || 'cash').toLowerCase();
        let modeKey = 'cash';
        let label = 'Cash';
        if (rawMode.includes('upi') || rawMode.includes('online')) {
          modeKey = 'upi';
          label = 'Online UPI';
        } else if (rawMode.includes('card') || rawMode.includes('pos')) {
          modeKey = 'card';
          label = 'Card POS';
        }

        const receiptNo = getReceiptNumberWithMode(modeKey);
        const sCash = modeKey === 'cash' ? pAmt : 0;
        const sCard = modeKey === 'card' ? pAmt : 0;
        const sOnline = modeKey === 'upi' ? pAmt : 0;

        addedCash += sCash;
        addedCard += sCard;
        addedOnline += sOnline;

        const particulars = `Room #${roomNumber} - Stay Extension Advance Payment (${label})`;
        const note = `Stay Extension Payment (${label})`;

        insertPaymentStmt.run(
          receiptNo,
          booking.id,
          booking.room_id,
          modeKey,
          pAmt,
          nowIso,
          extended_by,
          note,
          particulars,
          p.utr_number || null,
          p.card_digits || null,
          sCash,
          sCard,
          sOnline,
          booking.voucher_number || null
        );

        createdReceipts.push({
          receipt_no: receiptNo,
          mode: modeKey,
          label,
          amount: pAmt,
          base_amount: pAmt,
          voucher_number: booking.voucher_number || `V-${booking.id}`,
          guest_name: booking.guest_name || 'Guest',
          room_number: roomNumber,
          particulars,
          utr_number: p.utr_number || null,
          card_digits: p.card_digits || null,
          cashier_name: extended_by,
          checkin_time: nowIso
        });
      }
    }

    // Calculate updated booking financial totals
    const totalPaymentsRecorded = addedCash + addedCard + addedOnline;
    const newTotalPaid = (Number(booking.total_paid) || 0) + totalPaymentsRecorded;
    const newSplitCash = (Number(booking.split_cash) || 0) + addedCash;
    const newSplitCard = (Number(booking.split_card) || 0) + addedCard;
    const newSplitOnline = (Number(booking.split_online) || 0) + addedOnline;
    const newRoomCharge = (Number(booking.total_room_charge) || 0) + extended_amount;

    // Update approx_checkout_time & extension_logs_json for ALL active bookings sharing the same guest_id (combined group)
    if (booking.guest_id) {
      db.prepare("UPDATE bookings SET approx_checkout_time = ?, extension_logs_json = ? WHERE guest_id = ? AND status = 'active'").run(approx_checkout_time, logsJson, booking.guest_id);
    } else {
      db.prepare('UPDATE bookings SET approx_checkout_time = ?, extension_logs_json = ? WHERE id = ?').run(approx_checkout_time, logsJson, id);
    }

    // Update financial fields on the specific booking
    db.prepare(`
      UPDATE bookings
      SET total_room_charge = ?,
          total_paid = ?,
          split_cash = ?,
          split_card = ?,
          split_online = ?
      WHERE id = ?
    `).run(newRoomCharge, newTotalPaid, newSplitCash, newSplitCard, newSplitOnline, id);

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
      extended_amount,
      paid_amount: effectivePaid,
      receipts: createdReceipts,
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
  adults_female = 0,
  booking_source = null,
  is_ota = false
}) {
  const dIn = new Date(checkin_time || Date.now());
  const dOut = new Date(actual_checkout_time || Date.now());
  const dExpected = approx_checkout_time ? new Date(approx_checkout_time) : null;
  const isOtaBooking = is_ota || (room && (room.booking_source === 'OTA' || room.source === 'OTA')) || (booking_source === 'OTA');

  // Expected nights booked
  let expectedNights = 1;
  if (dExpected && dExpected > dIn) {
    const diffDays = Math.round((dExpected - dIn) / (1000 * 60 * 60 * 24));
    expectedNights = Math.max(1, diffDays);
  }

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

  if (isOtaBooking) {
    // Point 10: All OTA bookings complete their day at 10:00 AM of the departure date regardless of check-in time
    const otaCutoff = dExpected ? new Date(dExpected) : new Date(dIn);
    otaCutoff.setHours(10, 0, 0, 0);

    const diffToExpectedMs = dOut.getTime() - otaCutoff.getTime();
    if (diffToExpectedMs <= 0) {
      // Checked out at or before expected 10:00 AM
      const calendarDays = Math.max(1, Math.round((dOut - dIn) / (1000 * 60 * 60 * 24)));
      completedDays = calendarDays;
      chargedDays = Math.min(expectedNights, calendarDays);
      extraHours = 0;
      extraMins = 0;
      extensionCharge = 0;
    } else {
      // Past 10:00 AM on departure date
      completedDays = expectedNights;
      chargedDays = expectedNights;
      const extraTotalMins = Math.floor(diffToExpectedMs / (1000 * 60));
      extraHours = Math.floor(extraTotalMins / 60);
      extraMins = extraTotalMins % 60;

      if (extraTotalMins <= graceMins) {
        extensionCharge = 0;
      } else if (extraTotalMins <= 180) {
        extensionCharge = r3h;
      } else if (extraTotalMins <= 360) {
        extensionCharge = r6h;
      } else if (extraTotalMins <= 540) {
        extensionCharge = r9h;
      } else {
        chargedDays = expectedNights + 1;
        extensionCharge = 0;
        extraHours = 0;
      }
    }
  } else {
    // Point 10: Standard bookings: 1 day is strictly 24 hours from checkin_time
    const elapsedMs = Math.max(0, dOut.getTime() - dIn.getTime());
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    const elapsedMins = elapsedMs / (1000 * 60);

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
  }

  // Daily extras calculation (extra bed & breakfast)
  const totalAdults = Math.max(1, (Number(adults_male) || 0) + (Number(adults_female) || 0));
  const bfRate = room.breakfast_price !== undefined ? Number(room.breakfast_price) : 250;
  const dailyMealFee = meal_plan === 'with_breakfast' ? (totalAdults * bfRate) : 0;
  const dailyBedFee = Number(extra_bed_charge) || 0;

  // Recalculated total room charge for actual stay
  let recalculatedRoomCharge = (chargedDays * unitDailyRate) + extensionCharge + (chargedDays * dailyMealFee) + (chargedDays * dailyBedFee);

  // Original room charge (if provided or fallback to expectedNights * unitDailyRate)
  const declaredNightsCharge = (expectedNights * unitDailyRate) + (expectedNights * dailyMealFee) + (expectedNights * dailyBedFee);
  const originalCharge = Math.max(Number(total_room_charge) || 0, declaredNightsCharge);

  // Determine early checkout
  if (expectedNights > 1 && (chargedDays < expectedNights || (chargedDays === expectedNights && extensionCharge === 0 && dOut < dExpected))) {
    if (recalculatedRoomCharge < originalCharge) {
      isEarlyCheckout = true;
    }
  }

  // If not early checkout and stay is within expected checkout (not overstaying), do not add extra hours penalty
  if (!isEarlyCheckout && dExpected && dOut <= dExpected && chargedDays >= expectedNights) {
    extensionCharge = 0;
    extraHours = 0;
    extraMins = 0;
    recalculatedRoomCharge = (chargedDays * unitDailyRate) + (chargedDays * dailyMealFee) + (chargedDays * dailyBedFee);
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

/**
 * Synchronizes pending F&B room charges from Supabase room_charges_inbox into local SQLite.
 * Ensures orders are stored with booking_id so folio calculations and checkout reconciliation are 100% accurate.
 */
async function importCloudRoomChargesToSqlite(dbInstance, roomNumber, roomId, bookingId, guestName) {
  if (!supabaseService || !roomNumber) return [];
  try {
    const pending = await supabaseService.fetchPendingRoomCharges(roomNumber);
    if (!pending || pending.length === 0) return [];
    
    const importedIds = [];
    for (const cc of pending) {
      const totalAmt = parseFloat(cc.grand_total) || 0;
      if (totalAmt <= 0) continue;
      const orderNum = cc.bill_no || `CLD-${cc.id}`;
      const itemsJson = cc.items_summary ? JSON.stringify([{ name: cc.items_summary, quantity: 1, qty: 1, price: totalAmt, total: totalAmt }]) : '[]';
      const subtotalAmt = parseFloat(cc.subtotal) || Math.round(totalAmt / 1.05);
      const taxAmt = parseFloat(cc.gst) || (totalAmt - subtotalAmt);
      const cashierName = cc.cashier_name || (cc.department === 'bar' ? 'Bar Cashier' : 'Restaurant Cashier');
      const createdAt = cc.created_at ? cc.created_at.replace('T', ' ').substring(0, 19) : new Date().toISOString().replace('T', ' ').substring(0, 19);

      if (cc.department === 'bar') {
        const existing = dbInstance.prepare('SELECT id FROM bar_orders WHERE order_number = ?').get(orderNum);
        if (!existing) {
          dbInstance.prepare(`
            INSERT INTO bar_orders (
              order_number, room_id, customer_name, order_type,
              items_json, subtotal, tax, discount, total,
              payment_mode, is_paid, status, cashier_name,
              booking_id, created_at
            ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, 'room_folio', 0, 'completed', ?, ?, ?)
          `).run(orderNum, roomId, guestName || 'In-House Guest', itemsJson, subtotalAmt, taxAmt, totalAmt, cashierName, bookingId, createdAt);
          importedIds.push(cc.id);
        }
      } else {
        const existing = dbInstance.prepare('SELECT id FROM restaurant_orders WHERE order_number = ?').get(orderNum);
        if (!existing) {
          dbInstance.prepare(`
            INSERT INTO restaurant_orders (
              order_number, room_id, customer_name, order_type,
              items_json, subtotal, tax, discount, total,
              payment_mode, is_paid, status, cashier_name,
              booking_id, created_at
            ) VALUES (?, ?, ?, 'room', ?, ?, ?, 0, ?, 'room_folio', 0, 'completed', ?, ?, ?)
          `).run(orderNum, roomId, guestName || 'In-House Guest', itemsJson, subtotalAmt, taxAmt, totalAmt, cashierName, bookingId, createdAt);
          importedIds.push(cc.id);
        }
      }
    }
    return importedIds;
  } catch (err) {
    console.warn(`[Supabase] importCloudRoomChargesToSqlite notice for Room ${roomNumber}:`, err.message);
    return [];
  }
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
        b.early_checkin_charge,
        b.early_checkin_gst,
        r.ota_early_checkin_price,
        r.ota_early_checkin_max_hours,
        r.ota_early_checkin_gst_pct,
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
        b.company_name,
        b.gst_number,
        b.company_address,
        b.tax_type,
        b.is_igst,
        g.company_name as guest_company_name,
        g.gst_number as guest_gst_number,
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
        b.early_checkin_charge,
        b.early_checkin_gst,
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
    const groupEarlyCheckinCharge = groupBookings.reduce((sum, gb) => sum + (gb.early_checkin_charge || 0), 0);
    const groupEarlyCheckinGst = groupBookings.reduce((sum, gb) => sum + (gb.early_checkin_gst || 0), 0);
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
    room.early_checkin_charge = groupEarlyCheckinCharge;
    room.early_checkin_gst = groupEarlyCheckinGst;
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

    // Non-blocking background sync of any cloud room charges (never blocks local folio delivery)
    setImmediate(() => {
      try {
        const allRoomNums = room.all_group_room_numbers || [room.room_number];
        for (const rNum of allRoomNums) {
          const gb = groupBookings.find(g => g.room_number === rNum) || { booking_id: room.booking_id, room_id: room.id };
          importCloudRoomChargesToSqlite(db, rNum, gb.room_id, gb.booking_id, room.guest_name).catch(() => {});
        }
      } catch (_) {}
    });

    // Auto-sync any visitor breakfast records into restaurant_orders if not yet created
    try {
      const visitorsWithBreakfast = db.prepare(`
        SELECT * FROM room_visitors 
        WHERE booking_id IN (${bookingPlaceholders}) AND has_breakfast = 1
      `).all(...groupBookingIds);

      for (const v of visitorsWithBreakfast) {
        let orderExists = false;
        if (v.fnb_order_id) {
          const existing = db.prepare('SELECT id FROM restaurant_orders WHERE id = ?').get(v.fnb_order_id);
          if (existing) orderExists = true;
        }
        if (!orderExists) {
          const vRoom = groupBookings.find(gb => gb.booking_id === v.booking_id) || room;
          const vPrice = parseFloat(v.breakfast_amount) || 250;
          const vGstPct = getFnbGstRate('restaurant');
          const vTax = Math.round(vPrice * (vGstPct / 100));
          const vTotal = vPrice + vTax;
          const vIsPaid = (String(v.breakfast_status || '').toLowerCase() === 'paid') ? 1 : 0;
          const vMode = vIsPaid ? 'cash' : 'room_folio';
          const vOrderNum = 'RES-V' + Date.now().toString().slice(-5) + Math.floor(Math.random() * 90 + 10);
          const vItems = [
            {
              id: 'visitor-breakfast',
              name: `Visitor Breakfast Plan (${(v.visitor_name || 'Visitor').trim()})`,
              price: vPrice,
              quantity: 1,
              total: vPrice
            }
          ];

          const inserted = db.prepare(`
            INSERT INTO restaurant_orders (
              order_number, room_id, booking_id, customer_name, order_type, table_number,
              waiter_name, items_json, subtotal, tax, discount, total,
              payment_mode, is_paid, cashier_name, status, created_at
            ) VALUES (?, ?, ?, ?, 'room', ?, 'Visitor Breakfast', ?, ?, ?, 0, ?, ?, ?, 'Front Desk', 'completed', ?)
          `).run(
            vOrderNum,
            v.room_id || room.id,
            v.booking_id,
            `Room ${vRoom.room_number || room.room_number} - Visitor: ${(v.visitor_name || '').trim()}`,
            `Room ${vRoom.room_number || room.room_number}`,
            JSON.stringify(vItems),
            vPrice,
            vTax,
            vTotal,
            vMode,
            vIsPaid,
            v.checkin_time || new Date().toISOString()
          );

          db.prepare('UPDATE room_visitors SET fnb_order_id = ? WHERE id = ?').run(inserted.lastInsertRowid, v.id);
        }
      }
    } catch (e) {
      console.warn('Visitor breakfast auto-sync error:', e.message);
    }

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

    const isOta = String(room.booking_source || '').toUpperCase() === 'OTA';
    const isOtaPayAtHotel = isOta && (
      room.rate_type === 'pay_at_hotel' ||
      String(room.rate_type || '').toLowerCase().includes('hotel')
    );
    const isOtaPrepaid = isOta && !isOtaPayAtHotel && (
      parseInt(room.is_prepaid) === 1 ||
      room.is_prepaid === true ||
      room.is_prepaid === '1' ||
      room.rate_type === 'prepaid' ||
      Boolean(room.ota_platform) ||
      Number(room.total_paid || 0) === 0
    );
    const otaBillAmount = parseFloat(room.ota_bill_amount) || 0;
    const hotelExtrasCharge = groupExtraBedCharge + groupExtraRoomsCharge + groupExtraBreakfastCharge + (isOta ? groupEarlyCheckinCharge : 0);

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

    const nowDays = stayCalc.chargedDays || 1;
    const nowExtraHours = stayCalc.extraHours || 0;
    const nowExtensionCharge = stayCalc.extensionCharge || 0;
    const effectiveGstPct = roomGstPct !== undefined && roomGstPct !== null ? roomGstPct : 5;

    const hasBreakfast = room.meal_plan === 'with_breakfast' || room.meal_plan === 'breakfast';
    const breakfastPax = hasBreakfast ? Math.max(1, (groupAdultsMale || 0) + (groupAdultsFemale || 0)) : 0;
    const breakfastDailyRate = hasBreakfast ? (room.breakfast_price || 250) : 0;

    // Itemized Now
    const nowBaseRoomTariff = nowDays * combinedBaseRate;
    const nowBaseRoomTariffGst = Math.round((nowBaseRoomTariff * effectiveGstPct) / 100);
    const nowExtraMattressCost = nowDays * groupExtraBedCharge;
    const nowExtraMattressGst = Math.round((nowExtraMattressCost * effectiveGstPct) / 100);
    const nowBreakfastCost = nowDays * breakfastPax * breakfastDailyRate;
    const nowBreakfastGst = Math.round((nowBreakfastCost * effectiveGstPct) / 100);
    const nowExtensionGst = Math.round((nowExtensionCharge * effectiveGstPct) / 100);

    const nowPreTaxGross = nowBaseRoomTariff + nowExtraMattressCost + nowBreakfastCost + nowExtensionCharge;
    const nowDiscountAmount = combinedDiscountPct > 0
      ? Math.round((nowPreTaxGross * combinedDiscountPct) / 100)
      : (combinedDiscountAmount || 0);
    const nowGrossGst = Math.round((nowPreTaxGross * effectiveGstPct) / 100);
    const nowGrossTotal = nowPreTaxGross + nowGrossGst;

    const nowRoomPreTax = nowPreTaxGross - nowDiscountAmount;
    const nowRoomGst = Math.round((nowRoomPreTax * effectiveGstPct) / 100);
    const nowRoomChargeCalc = nowRoomPreTax + nowRoomGst;
    const nowDiscountTotal = Math.max(0, nowGrossTotal - nowRoomChargeCalc);
    const nowDiscountGst = Math.max(0, nowDiscountTotal - nowDiscountAmount);

    let nowRoomCharge = nowRoomChargeCalc;
    let finalNowRoomPreTax = nowRoomPreTax;
    let finalNowRoomGst = nowRoomGst;
    let finalNowBaseRoomTariff = nowBaseRoomTariff;
    let finalNowBaseRoomTariffGst = nowBaseRoomTariffGst;
    let finalNowExtraMattressCost = nowExtraMattressCost;
    let finalNowExtraMattressGst = nowExtraMattressGst;

    if (isOtaPrepaid || isOtaPayAtHotel) {
      nowRoomCharge = isOtaPrepaid
        ? Math.max(hotelExtrasCharge, effectivePaid)
        : (otaBillAmount + hotelExtrasCharge);
      finalNowRoomPreTax = Math.round((nowRoomCharge * 0.95) * 100) / 100;
      finalNowRoomGst = Math.max(0, Number((nowRoomCharge - finalNowRoomPreTax).toFixed(2)));
      const otaBase = isOtaPayAtHotel ? otaBillAmount : 0;
      finalNowBaseRoomTariff = Math.round((otaBase * 0.95) * 100) / 100;
      finalNowBaseRoomTariffGst = Math.max(0, Number((otaBase - finalNowBaseRoomTariff).toFixed(2)));
      finalNowExtraMattressCost = Math.round((groupExtraBedCharge * 0.95) * 100) / 100;
      finalNowExtraMattressGst = Math.max(0, Number((groupExtraBedCharge - finalNowExtraMattressCost).toFixed(2)));
    }

    // Running totals tailored by booking source & prepaid status
    let effectiveRoomCharge = combinedTotalRoomCharge;
    let effectiveDiscountAmount = combinedDiscountAmount;
    let effectivePreTaxRoomCharge = Math.round(combinedTotalRoomCharge / gstFactor);

    const hasDiscount = Boolean(combinedDiscountPct > 0 || (combinedDiscountAmount > 0 && Math.abs(nowRoomCharge - stayCalc.recalculatedRoomCharge) > 5));
    if (stayCalc.isEarlyCheckout && !isOtaPrepaid && !isOtaPayAtHotel) {
      if (hasDiscount && nowRoomCharge !== undefined && nowRoomCharge !== null) {
        effectiveRoomCharge = nowRoomCharge;
        effectiveDiscountAmount = nowDiscountAmount;
        effectivePreTaxRoomCharge = nowRoomPreTax;
      } else {
        effectiveRoomCharge = stayCalc.recalculatedRoomCharge;
        effectiveDiscountAmount = combinedDiscountAmount;
        effectivePreTaxRoomCharge = Math.round(stayCalc.recalculatedRoomCharge / gstFactor);
      }
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

    // Pre-tax room charge (taxable amount before GST - Option B for OTA: 95% base, 5% flat GST)
    const combinedPreTaxRoomCharge = (isOtaPrepaid || isOtaPayAtHotel)
      ? Math.round((effectiveRoomCharge * 0.95) * 100) / 100
      : (stayCalc.isEarlyCheckout ? effectivePreTaxRoomCharge : Math.round(effectiveRoomCharge / gstFactor));

    // Running totals
    const grandTotal = effectiveGrandTotal;
    const roomGrossTariff = (stayCalc.isEarlyCheckout && !isOtaPrepaid && !isOtaPayAtHotel)
      ? nowPreTaxGross
      : (combinedPreTaxRoomCharge + effectiveDiscountAmount);
    const grossTariff = roomGrossTariff;
    const balanceDue = effectiveBalanceDue;

    // Fetch all recorded visitors strictly for this active booking session
    const visitors = db.prepare(`
      SELECT * FROM room_visitors 
      WHERE booking_id IN (${bookingPlaceholders})
      ORDER BY checkin_time DESC
    `).all(...groupBookings.map(b => b.booking_id));

          // Itemized Declared
          const decDays = stayCalc.expectedNights || 1;
          const decBaseRoomTariff = decDays * combinedBaseRate;
          const decBaseRoomTariffGst = Math.round((decBaseRoomTariff * effectiveGstPct) / 100);
          const decExtraMattressCost = decDays * groupExtraBedCharge;
          const decExtraMattressGst = Math.round((decExtraMattressCost * effectiveGstPct) / 100);
          const decBreakfastCost = decDays * breakfastPax * breakfastDailyRate;
          const decBreakfastGst = Math.round((decBreakfastCost * effectiveGstPct) / 100);
          const decPreTaxGross = decBaseRoomTariff + decExtraMattressCost + decBreakfastCost;
          const decGrossGst = Math.round((decPreTaxGross * effectiveGstPct) / 100);
          const decGrossTotal = decPreTaxGross + decGrossGst;

          const decDiscountAmount = combinedDiscountPct > 0
            ? Math.round((decPreTaxGross * combinedDiscountPct) / 100)
            : (nowDays > 0 ? Math.round(((combinedDiscountAmount || 0) / nowDays) * decDays) : (combinedDiscountAmount || 0));

          const decRoomPreTax = decPreTaxGross - decDiscountAmount;
          const decRoomGst = Math.round((decRoomPreTax * effectiveGstPct) / 100);
          const decRoomChargeCalc = decRoomPreTax + decRoomGst;
          const decDiscountTotal = Math.max(0, decGrossTotal - decRoomChargeCalc);
          const decDiscountGst = Math.max(0, decDiscountTotal - decDiscountAmount);

          const decRoomCharge = isOtaPrepaid
            ? Math.max(hotelExtrasCharge, effectivePaid)
            : (isOtaPayAtHotel
                ? otaBillAmount + hotelExtrasCharge
                : decRoomChargeCalc);

          // F&B
          const fnbCombinedTotal = foodTotal + barTotal;
          const fnbTaxable = Math.round(fnbCombinedTotal / 1.05);
          const fnbGst = fnbCombinedTotal - fnbTaxable;

          const nowGrandTotal = nowRoomCharge + fnbCombinedTotal;
          const decGrandTotal = decRoomCharge + fnbCombinedTotal;

          return res.json({
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
                discountAmount: effectiveDiscountAmount,
                discountPct: combinedDiscountPct,
                roomCharge: effectiveRoomCharge,
                hotelExtrasCharge,
                earlyCheckinCharge: groupEarlyCheckinCharge,
                earlyCheckinGst: groupEarlyCheckinGst,
                otaBillAmount,
                isOtaPrepaid,
                isOtaPayAtHotel,
                cardSurcharge: combinedCardSurcharge,
                upiTax: combinedUpiTax,
                foodTotal,
                barTotal,
                fnbTotal: fnbCombinedTotal,
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
                recalculatedRoomCharge: stayCalc.isEarlyCheckout
                  ? (hasDiscount ? (nowRoomCharge ?? stayCalc.recalculatedRoomCharge) : stayCalc.recalculatedRoomCharge)
                  : effectiveRoomCharge,
                taxAmount: Math.max(0, effectiveRoomCharge - combinedPreTaxRoomCharge),
                totalGst: Math.max(0, effectiveRoomCharge - combinedPreTaxRoomCharge),
                refundAmount,
                visitorsCount: (visitors || []).length,
                stayCalcNow: {
                  isEarlyCheckout: Boolean(stayCalc.isEarlyCheckout),
                  roomCharge: nowRoomCharge,
                  baseRoomTariff: finalNowBaseRoomTariff,
                  baseRoomTariffGst: finalNowBaseRoomTariffGst,
                  baseRoomTotal: finalNowBaseRoomTariff + finalNowBaseRoomTariffGst,
                  dailyBaseRate: isOtaPayAtHotel ? finalNowBaseRoomTariff : combinedBaseRate,
                  extraMattressCost: finalNowExtraMattressCost,
                  extraMattressGst: finalNowExtraMattressGst,
                  extraMattressTotal: finalNowExtraMattressCost + finalNowExtraMattressGst,
                  extraMattressBeds: groupExtraBeds,
                  extraMattressDaily: groupExtraBedCharge,
                  breakfastCost: nowBreakfastCost,
                  breakfastGst: nowBreakfastGst,
                  breakfastTotal: nowBreakfastCost + nowBreakfastGst,
                  breakfastPax,
                  breakfastDailyRate,
                  extensionCharge: nowExtensionCharge,
                  extensionGst: nowExtensionGst,
                  extensionTotal: nowExtensionCharge + nowExtensionGst,
                  extensionHours: nowExtraHours,
                  discountAmount: (isOtaPrepaid || isOtaPayAtHotel) ? 0 : nowDiscountAmount,
                  discountGst: (isOtaPrepaid || isOtaPayAtHotel) ? 0 : nowDiscountGst,
                  discountTotal: (isOtaPrepaid || isOtaPayAtHotel) ? 0 : nowDiscountTotal,
                  roomSubtotalPreTax: finalNowRoomPreTax,
                  roomGst: finalNowRoomGst,
                  gstPct: effectiveGstPct,
                  fnbTaxable,
                  fnbGst,
                  fnbTotal: fnbCombinedTotal,
                  grandTotal: nowGrandTotal,
                  paid: effectivePaid,
                  balanceDue: Math.max(0, nowGrandTotal - effectivePaid),
                  refundDue: Math.max(0, effectivePaid - nowGrandTotal),
                  stayDurationStr: stayCalc.stayDurationStr || '',
                  chargedDays: nowDays,
                  extraHours: nowExtraHours
                },
                stayCalcDeclared: {
                  roomCharge: decRoomCharge,
                  baseRoomTariff: decBaseRoomTariff,
                  baseRoomTariffGst: decBaseRoomTariffGst,
                  baseRoomTotal: decBaseRoomTariff + decBaseRoomTariffGst,
                  dailyBaseRate: combinedBaseRate,
                  extraMattressCost: decExtraMattressCost,
                  extraMattressGst: decExtraMattressGst,
                  extraMattressTotal: decExtraMattressCost + decExtraMattressGst,
                  extraMattressBeds: groupExtraBeds,
                  extraMattressDaily: groupExtraBedCharge,
                  breakfastCost: decBreakfastCost,
                  breakfastGst: decBreakfastGst,
                  breakfastTotal: decBreakfastCost + decBreakfastGst,
                  breakfastPax,
                  breakfastDailyRate,
                  extensionCharge: 0,
                  extensionGst: 0,
                  extensionTotal: 0,
                  discountAmount: decDiscountAmount,
                  discountGst: decDiscountGst,
                  discountTotal: decDiscountTotal,
                  roomSubtotalPreTax: decRoomPreTax,
                  roomGst: decRoomGst,
                  gstPct: effectiveGstPct,
                  fnbTaxable,
                  fnbGst,
                  fnbTotal: fnbCombinedTotal,
                  grandTotal: decGrandTotal,
                  paid: effectivePaid,
                  balanceDue: Math.max(0, decGrandTotal - effectivePaid),
                  refundDue: Math.max(0, effectivePaid - decGrandTotal),
                  expectedNights: decDays
                }
              }
            }
          });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================================================
// IN-STAY ADVANCE PAYMENT API (Points 4 & 17)
// Allows cashiers to record advance payments for active bookings anytime
// ==========================================================================
app.post('/api/rooms/:id/payments', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const room = db.prepare('SELECT current_booking_id, room_number FROM rooms WHERE id = ?').get(id);
    if (!room || !room.current_booking_id) {
      return res.status(404).json({ success: false, error: 'No active booking found for this room' });
    }
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(room.current_booking_id);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const {
      amount,
      payment_mode = 'cash',
      utr_number = null,
      cheque_no = null,
      bank_name = null,
      cheque_photo = null,
      split_cash = 0,
      split_card = 0,
      split_online = 0,
      split_cheque = 0,
      card_surcharge = 0,
      upi_tax = 0,
      notes = 'In-stay advance payment',
      cashier_name = null
    } = req.body;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid payment amount is required' });
    }

    const cleanMode = String(payment_mode || 'cash').toLowerCase();
    const isBtcBooking = String(booking.booking_source || '').toUpperCase() === 'BTC' || Boolean(booking.btc_company_id) || Boolean(booking.btc_company_name);
    if (!isBtcBooking && (parseFloat(split_cheque) > 0 || cleanMode === 'cheque')) {
      return res.status(400).json({ success: false, error: 'Cheque payment option is only allowed for corporate BTC bookings.' });
    }

    const sCash = parseFloat(split_cash) || 0;
    const sCard = parseFloat(split_card) || 0;
    const sOnline = parseFloat(split_online) || 0;
    const sCheque = isBtcBooking ? (parseFloat(split_cheque) || 0) : 0;

    const activeSplits = [];
    const receiptNumbers = {};

    if (sCash > 0) {
      const no = getReceiptNumberWithMode('cash');
      activeSplits.push({
        mode: 'cash',
        amount: sCash,
        base_amount: sCash,
        label: 'Cash',
        receipt_no: no,
        utr: null,
        cheque_no: null,
        bank_name: null,
        cheque_photo: null,
        card_surcharge: 0,
        upi_tax: 0,
        split_cash: sCash,
        split_card: 0,
        split_online: 0,
        split_cheque: 0
      });
      receiptNumbers.cash = no;
    }
    if (sOnline > 0) {
      const no = getReceiptNumberWithMode('upi');
      const curUpiTax = parseFloat(upi_tax) || 0;
      activeSplits.push({
        mode: 'upi',
        amount: sOnline + curUpiTax,
        base_amount: sOnline,
        label: 'Online UPI',
        receipt_no: no,
        utr: utr_number || null,
        cheque_no: null,
        bank_name: null,
        cheque_photo: null,
        card_surcharge: 0,
        upi_tax: curUpiTax,
        split_cash: 0,
        split_card: 0,
        split_online: sOnline,
        split_cheque: 0
      });
      receiptNumbers.upi = no;
    }
    if (sCard > 0) {
      const no = getReceiptNumberWithMode('card');
      const curCardSurcharge = parseFloat(card_surcharge) || 0;
      activeSplits.push({
        mode: 'card',
        amount: sCard + curCardSurcharge,
        base_amount: sCard,
        label: 'Card POS',
        receipt_no: no,
        utr: null,
        cheque_no: null,
        bank_name: null,
        cheque_photo: null,
        card_surcharge: curCardSurcharge,
        upi_tax: 0,
        split_cash: 0,
        split_card: sCard,
        split_online: 0,
        split_cheque: 0
      });
      receiptNumbers.card = no;
    }
    if (sCheque > 0 && isBtcBooking) {
      const no = getReceiptNumberWithMode('cheque');
      activeSplits.push({
        mode: 'cheque',
        amount: sCheque,
        base_amount: sCheque,
        label: 'Cheque',
        receipt_no: no,
        utr: null,
        cheque_no: cheque_no || null,
        bank_name: bank_name || null,
        cheque_photo: cheque_photo || null,
        card_surcharge: 0,
        upi_tax: 0,
        split_cash: 0,
        split_card: 0,
        split_online: 0,
        split_cheque: sCheque
      });
      receiptNumbers.cheque = no;
    }

    if (activeSplits.length === 0) {
      const no = getReceiptNumberWithMode(cleanMode);
      activeSplits.push({
        mode: cleanMode,
        amount: numAmount,
        base_amount: numAmount,
        label: cleanMode.toUpperCase(),
        receipt_no: no,
        utr: utr_number || null,
        cheque_no: cheque_no || null,
        bank_name: bank_name || null,
        cheque_photo: cheque_photo || null,
        card_surcharge: parseFloat(card_surcharge) || 0,
        upi_tax: parseFloat(upi_tax) || 0,
        split_cash: cleanMode === 'cash' ? numAmount : 0,
        split_card: cleanMode === 'card' ? numAmount : 0,
        split_online: (cleanMode === 'upi' || cleanMode === 'online') ? numAmount : 0,
        split_cheque: cleanMode === 'cheque' ? numAmount : 0
      });
      receiptNumbers[cleanMode] = no;
    }

    const cleanCashier = (cashier_name || req.user?.username || req.user?.name || 'Front Desk Cashier').trim();
    const isMultiMethod = activeSplits.length > 1;
    const insertedPaymentRows = [];

    const insertStmt = db.prepare(`
      INSERT INTO payments (
        receipt_no, booking_id, room_id, department, payment_type, payment_mode,
        amount, cheque_no, bank_name, cheque_date, cheque_status, realized_at,
        cashier_name, notes, utr_number, card_surcharge, upi_tax,
        split_cash, split_card, split_online, split_cheque, cheque_photo
      ) VALUES (?, ?, ?, 'hospitality', 'advance', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const splitItem of activeSplits) {
      const splitNote = isMultiMethod
        ? `${notes} (${splitItem.label})`
        : notes;
      const resInsert = insertStmt.run(
        splitItem.receipt_no,
        booking.id,
        id,
        splitItem.mode,
        splitItem.amount,
        splitItem.cheque_no,
        splitItem.bank_name,
        new Date().toISOString().split('T')[0],
        splitItem.mode === 'cheque' ? 'pending' : 'realized',
        splitItem.mode === 'cheque' ? null : new Date().toISOString(),
        cleanCashier,
        splitNote,
        splitItem.utr,
        splitItem.card_surcharge,
        splitItem.upi_tax,
        splitItem.split_cash,
        splitItem.split_card,
        splitItem.split_online,
        splitItem.split_cheque,
        splitItem.cheque_photo
      );
      const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(resInsert.lastInsertRowid);
      insertedPaymentRows.push(row);
    }

    // Update booking paid aggregates
    const newTotalPaid = (Number(booking.total_paid) || 0) + numAmount;
    const newSplitCash = (Number(booking.split_cash) || 0) + (sCash || (cleanMode === 'cash' ? numAmount : 0));
    const newSplitCard = (Number(booking.split_card) || 0) + (sCard || (cleanMode === 'card' ? numAmount : 0));
    const newSplitOnline = (Number(booking.split_online) || 0) + (sOnline || (cleanMode === 'upi' || cleanMode === 'online' ? numAmount : 0));

    db.prepare(`
      UPDATE bookings
      SET total_paid = ?,
          split_cash = ?,
          split_card = ?,
          split_online = ?
      WHERE id = ?
    `).run(newTotalPaid, newSplitCash, newSplitCard, newSplitOnline, booking.id);

    const primaryReceiptNo = insertedPaymentRows.map(p => p.receipt_no).join(', ');

    res.json({
      success: true,
      payment: insertedPaymentRows[0],
      payments: insertedPaymentRows,
      receipt_no: primaryReceiptNo,
      receiptNumbers,
      receipt_numbers: receiptNumbers,
      total_paid: newTotalPaid,
      message: `Advance payment of ₹${numAmount.toLocaleString('en-IN')} recorded successfully with Receipt #${primaryReceiptNo}`
    });
  } catch (err) {
    console.error('In-stay payment error:', err);
    res.status(500).json({ success: false, error: err.message });
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

    const room = db.prepare('SELECT id, room_number, current_booking_id FROM rooms WHERE id = ?').get(id);
    const bookingId = room ? room.current_booking_id : null;
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'Cannot log visitor: Room is not currently occupied.' });
    }

    const isBreakfast = Boolean(has_breakfast && has_breakfast !== '0' && has_breakfast !== 'false');
    const vStatus = (breakfast_status || 'pending').toLowerCase();
    const vPrice = parseFloat(breakfast_amount) || 250;
    let fnbOrderId = null;

    if (isBreakfast) {
      const vGstPct = getFnbGstRate('restaurant');
      const vTax = Math.round(vPrice * (vGstPct / 100));
      const vTotal = vPrice + vTax;
      const vIsPaid = (vStatus === 'paid') ? 1 : 0;
      const vMode = vIsPaid ? 'cash' : 'room_folio';
      const vOrderNum = 'RES-V' + Date.now().toString().slice(-5) + Math.floor(Math.random() * 90 + 10);
      const vItems = [
        {
          id: 'visitor-breakfast',
          name: `Visitor Breakfast Plan (${visitor_name.trim()})`,
          price: vPrice,
          quantity: 1,
          total: vPrice
        }
      ];

      const inserted = db.prepare(`
        INSERT INTO restaurant_orders (
          order_number, room_id, booking_id, customer_name, order_type, table_number,
          waiter_name, items_json, subtotal, tax, discount, total,
          payment_mode, is_paid, cashier_name, status, created_at
        ) VALUES (?, ?, ?, ?, 'room', ?, 'Visitor Breakfast', ?, ?, ?, 0, ?, ?, ?, 'Front Desk', 'completed', datetime('now', 'localtime'))
      `).run(
        vOrderNum,
        room.id,
        bookingId,
        `Room ${room.room_number} - Visitor: ${visitor_name.trim()}`,
        `Room ${room.room_number}`,
        JSON.stringify(vItems),
        vPrice,
        vTax,
        vTotal,
        vMode,
        vIsPaid
      );
      fnbOrderId = inserted.lastInsertRowid;
    }

    const stmt = db.prepare(`
      INSERT INTO room_visitors (
        booking_id, room_id, visitor_name, phone, relation, custom_relation, purpose, visitor_photo, has_breakfast, breakfast_status, breakfast_amount, fnb_order_id, checkin_time, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), 'IN_ROOM')
    `);

    const result = stmt.run(
      bookingId,
      room.id,
      visitor_name.trim(),
      (phone || '').trim(),
      (relation || 'Friend').trim(),
      (custom_relation || '').trim(),
      (purpose || '').trim(),
      visitor_photo || '',
      isBreakfast ? 1 : 0,
      vStatus,
      vPrice,
      fnbOrderId
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
    const visitor = db.prepare('SELECT * FROM room_visitors WHERE id = ?').get(id);
    if (visitor && visitor.fnb_order_id) {
      const order = db.prepare('SELECT is_paid FROM restaurant_orders WHERE id = ?').get(visitor.fnb_order_id);
      if (order && !order.is_paid) {
        db.prepare('DELETE FROM restaurant_orders WHERE id = ?').run(visitor.fnb_order_id);
      }
    }
    db.prepare('DELETE FROM room_visitors WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. CHECKOUT ROOM (Settle balance or process refund, log into payments ledger, mark all linked rooms as needs_cleaning)
app.post('/api/checkout/:id', requireAuth, requireRole('manager', 'hospitality'), async (req, res) => {
  try {
    const { id } = req.params;
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room || room.status !== 'occupied' || !room.current_booking_id) {
      return res.status(400).json({ success: false, error: 'Room is not currently occupied' });
    }

    const primaryBooking = db.prepare('SELECT b.*, g.name as guest_name FROM bookings b JOIN guests g ON b.guest_id = g.id WHERE b.id = ?').get(room.current_booking_id);
    if (!primaryBooking) return res.status(404).json({ success: false, error: 'Booking not found' });

    // Sync any pending cloud room charges from Supabase into SQLite before checkout transaction
    try {
      const activeGroupBookings = db.prepare(`
        SELECT b.id as booking_id, b.room_id, r.room_number, r.price 
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.guest_id = ? AND b.status = 'active' AND b.checkin_time = ?
      `).all(primaryBooking.guest_id, primaryBooking.checkin_time);

      for (const gb of activeGroupBookings) {
        await importCloudRoomChargesToSqlite(db, gb.room_number, gb.room_id, gb.booking_id, primaryBooking.guest_name);
      }
    } catch (syncErr) {
      console.warn('[Supabase] Pre-checkout cloud charge sync notice:', syncErr.message);
    }

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

    const isOtaPrepaidInitial = (primaryBooking.booking_source || '').toUpperCase() === 'OTA' && (primaryBooking.is_prepaid === 1 || primaryBooking.is_prepaid === '1' || primaryBooking.rate_type === 'prepaid');
    const defaultCheckoutMode = isOtaPrepaidInitial && computedSettle === 0 ? 'prepaid' : (computedSettle > 0 ? 'split' : 'cash');
    const final_payment_mode = b.final_payment_mode ?? b.finalPaymentMode ?? defaultCheckoutMode;

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

    try {
      db.prepare(`
        UPDATE room_visitors 
        SET breakfast_status = 'paid' 
        WHERE booking_id IN (${activeBookingPlaceholders}) AND has_breakfast = 1
      `).run(...activeBookingIds);
    } catch (_) {}

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

    const clientFood = parseFloat(b.food_total ?? b.foodTotal ?? b.food);
    const clientBar = parseFloat(b.bar_total ?? b.barTotal ?? b.bar);
    const clientFnb = parseFloat(b.fnb_total ?? b.fnbTotal ?? b.fnb);
    let effectiveRestUnpaid = restUnpaid;
    let effectiveBarUnpaid = barUnpaid;
    if (!isNaN(clientFood) && clientFood > effectiveRestUnpaid) {
      effectiveRestUnpaid = clientFood;
    }
    if (!isNaN(clientBar) && clientBar > effectiveBarUnpaid) {
      effectiveBarUnpaid = clientBar;
    }
    if (!isNaN(clientFnb) && (effectiveRestUnpaid + effectiveBarUnpaid) < clientFnb) {
      effectiveRestUnpaid = clientFnb - effectiveBarUnpaid;
    }

    const totalGroupBill = currentGroupRoomCharge + effectiveRestUnpaid + effectiveBarUnpaid;
    const computedMaxBalanceDue = Math.max(0, totalGroupBill - currentGroupTotalPaid);
    const clientBalanceDue = parseFloat(b.balance_due ?? b.balanceDue ?? b.remaining_balance ?? b.remainingBalance);
    const maxBalanceDue = Math.max(computedMaxBalanceDue, !isNaN(clientBalanceDue) ? clientBalanceDue : 0);

    if (netSettle > maxBalanceDue + 1.0) {
      throw new Error(`Settlement payment (₹${netSettle.toFixed(2)}) cannot exceed balance due (₹${maxBalanceDue.toFixed(2)})`);
    }

    const totalGroupBaseRate = activeGroupBookings.reduce((sum, gb) => sum + (gb.price || 1), 0);

    // Generate settlement receipt or refund voucher number (format: YYYYMMDD-SR, resets monthly)
    const isBtcBooking = primaryBooking.booking_source === 'BTC' || primaryBooking.btc_company_id !== null || settleMode === 'btc' || Boolean(req.body.is_btc_pending) || Boolean(req.body.isBtcPending);
    const isCompanyPaysLater = isBtcBooking && (netSettle === 0 || settleMode === 'btc' || Boolean(req.body.is_btc_pending) || Boolean(req.body.isBtcPending));
    // User requirement: on receipt, refund, should be voucher no same as in checkin form (e.g. 260924-002)
    const refundVoucherNo = primaryBooking.voucher_number ? String(primaryBooking.voucher_number).trim().replace(/\b20(\d{6}-\d+)\b/g, '$1') : `DEB-${getNextMonthlyVoucherNumber('DEB')}`;
    const baseVoucher = primaryBooking.voucher_number ? String(primaryBooking.voucher_number).trim().replace(/\b20(\d{6}-\d+)\b/g, '$1') : `RCP-${500 + primaryBooking.id}`;
    let finalReceiptNo = baseVoucher;
    const existingPmt = db.prepare('SELECT id FROM payments WHERE receipt_no = ?').get(finalReceiptNo);
    if (existingPmt) {
      finalReceiptNo = `${baseVoucher}-1`;
    }

    const settleSplitCash = parseFloat(b.split_cash ?? b.splitCash ?? 0) || 0;
    const settleSplitCard = parseFloat(b.split_card ?? b.splitCard ?? 0) || 0;
    const settleSplitOnline = parseFloat(b.split_online ?? b.splitOnline ?? 0) || 0;
    const settleSplitCheque = parseFloat(b.split_cheque ?? b.splitCheque ?? 0) || 0;

    const isCheque = settleMode === 'cheque' || settleSplitCheque > 0;
    const sChequeNo = isCheque ? (cheque_no || null) : null;
    const sChequeBank = isCheque ? (bank_name || null) : null;
    const sChequeDate = isCheque ? (cheque_date || checkoutTime.split('T')[0]) : null;
    const sChequePhoto = isCheque ? (cheque_photo || null) : null;

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
      const isSettlingNow = netSettle > 0 && settleMode !== 'btc' && !isCheque;
      const isOtaPrepaidBooking = (primaryBooking.booking_source || '').toUpperCase() === 'OTA' && (primaryBooking.is_prepaid === 1 || primaryBooking.is_prepaid === '1' || primaryBooking.rate_type === 'prepaid');
      const isPrepaidSettled = isOtaPrepaidBooking && (netSettle >= maxBalanceDue || maxBalanceDue <= 0.5);
      const updatedPaymentStatus = isSettlingNow || isPrepaidSettled
        ? 'settled'
        : (isCheque
            ? 'pending'
            : (isCompanyPaysLater 
                ? 'pending_from_company' 
                : ((primaryBooking.total_paid || 0) >= (bRoomCharge || primaryBooking.total_room_charge || 0) ? 'settled' : 'pending')));

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
    const settleReceipts = [];
    const settleReceiptNumbers = {};
    if (netSettle > 0) {
      if (settleSplitCash > 0) {
        const no = getReceiptNumberWithMode('cash');
        settleReceipts.push({ receipt_no: no, mode: 'cash', amount: settleSplitCash, base_amount: settleSplitCash, label: 'Cash' });
        settleReceiptNumbers.cash = no;
      }
      if (settleSplitOnline > 0) {
        const no = getReceiptNumberWithMode('upi');
        settleReceipts.push({ receipt_no: no, mode: 'upi', amount: settleSplitOnline + finalUpiTax, base_amount: settleSplitOnline, label: 'Online UPI', utr_number: online_utr, upi_tax: finalUpiTax });
        settleReceiptNumbers.upi = no;
      }
      if (settleSplitCard > 0) {
        const no = getReceiptNumberWithMode('card');
        settleReceipts.push({ receipt_no: no, mode: 'card', amount: settleSplitCard + finalCardSurcharge, base_amount: settleSplitCard, label: 'Card POS', card_surcharge: finalCardSurcharge });
        settleReceiptNumbers.card = no;
      }
      if (settleSplitCheque > 0) {
        const no = getReceiptNumberWithMode('cheque');
        settleReceipts.push({ receipt_no: no, mode: 'cheque', amount: settleSplitCheque, base_amount: settleSplitCheque, label: 'Cheque', cheque_no: sChequeNo, bank_name: sChequeBank });
        settleReceiptNumbers.cheque = no;
      }
      if (settleReceipts.length === 0) {
        const no = getReceiptNumberWithMode(settleMode);
        settleReceipts.push({ receipt_no: no, mode: settleMode, amount: netSettle, base_amount: netSettle, label: settleMode === 'upi' ? 'Online UPI' : (settleMode === 'card' ? 'Card POS' : (settleMode === 'cheque' ? 'Cheque' : 'Cash')) });
        settleReceiptNumbers[settleMode] = no;
      }

      const cStatus = isCheque ? 'pending' : 'realized';
      const settleStmt = db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_no, bank_name, cheque_date, cheque_status, realized_at,
          cashier_name, notes, cheque_photo, utr_number,
          card_surcharge, upi_tax, split_cash, split_card, split_online, split_cheque
        ) VALUES (?, ?, ?, 'hospitality', 'bill_settlement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      settleReceipts.forEach(sr => {
        settleStmt.run(
          sr.receipt_no,
          primaryBooking.id,
          primaryBooking.room_id,
          sr.mode,
          sr.amount,
          sr.mode === 'cheque' ? sChequeNo : null,
          sr.mode === 'cheque' ? sChequeBank : null,
          sr.mode === 'cheque' ? sChequeDate : null,
          cStatus,
          cStatus === 'realized' ? checkoutTime : null,
          cleanCheckedOutBy,
          `Checkout bill settlement for Room ${checkedOutRooms.join(', ')} (${primaryBooking.guest_name}): ${sr.label}${sr.card_surcharge ? ` (+₹${sr.card_surcharge} Card fee)` : ''}${sr.upi_tax ? ` (+₹${sr.upi_tax} UPI tax)` : ''}`,
          sr.mode === 'cheque' ? sChequePhoto : null,
          sr.mode === 'upi' ? online_utr : null,
          sr.card_surcharge || 0,
          sr.upi_tax || 0,
          sr.mode === 'cash' ? sr.amount : 0,
          sr.mode === 'card' ? sr.base_amount : 0,
          sr.mode === 'upi' ? sr.base_amount : 0,
          sr.mode === 'cheque' ? sr.amount : 0
        );
      });
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
      finalReceiptNo: settleReceipts.map(r => r.receipt_no).join(', ') || finalReceiptNo,
      receiptNumbers: settleReceiptNumbers,
      receipt_numbers: settleReceiptNumbers,
      receipts: settleReceipts,
      refundVoucherNo,
      refund_voucher_no: refundVoucherNo,
      refund_mode: return_mode,
      return_mode,
      refund_amount: netRefund
    };
  });

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
let cachedScannerResult = null;
let lastScannerCheckTime = 0;
const SCANNER_CACHE_TTL = 60000; // 60 seconds

app.get('/api/scanner/devices', (req, res) => {
  const now = Date.now();
  if (cachedScannerResult && (now - lastScannerCheckTime < SCANNER_CACHE_TTL)) {
    return res.json(cachedScannerResult);
  }
  const { exec } = require('child_process');
  const psCmd = `powershell -NoProfile -Command "$ErrorActionPreference = 'SilentlyContinue'; $dm = New-Object -ComObject WIA.DeviceManager; if ($dm) { $dm.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { $_.Properties('Name').Value } }"`;
  
  exec(psCmd, { timeout: 3000 }, (err, stdout, stderr) => {
    const lines = (stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    cachedScannerResult = {
      success: true,
      devices: lines.length > 0 ? lines : ['HP LaserJet Pro MFP M125/M126', 'Canon MF3010 (WIA)'],
      connectedCount: lines.length
    };
    lastScannerCheckTime = Date.now();
    res.json(cachedScannerResult);
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
function getGeminiApiKeys() {
  const keys = ['', '', '', ''];

  // 1. Try to read multiple keys from system_settings (key: 'gemini_api_keys')
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('gemini_api_keys');
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        for (let i = 0; i < 4; i++) {
          if (parsed[i]) {
            const dec = secretManager.decryptSecret(parsed[i]);
            if (dec && !dec.startsWith('AIzaSyTest')) {
              keys[i] = dec.trim();
            }
          }
        }
      }
    }
  } catch (e) {}

  // 2. Check individual system_settings keys: 'gemini_api_key_1', 'gemini_api_key_2', etc.
  for (let i = 0; i < 4; i++) {
    if (!keys[i]) {
      try {
        const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(`gemini_api_key_${i + 1}`);
        if (row && row.value) {
          const dec = secretManager.decryptSecret(row.value);
          if (dec && !dec.startsWith('AIzaSyTest')) {
            keys[i] = dec.trim();
          }
        }
      } catch (e) {}
    }
  }

  // 3. Fallback for Slot 0 (Key 1): legacy 'gemini_api_key'
  if (!keys[0]) {
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('gemini_api_key');
      if (row && row.value) {
        const dec = secretManager.decryptSecret(row.value);
        if (dec && !dec.startsWith('AIzaSyTest')) {
          keys[0] = dec.trim();
        }
      }
    } catch (e) {}
  }

  // 4. Fallback to process.env and .env:
  const envVars = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ];
  for (let i = 0; i < 4; i++) {
    if (!keys[i] && envVars[i] && envVars[i].trim() && !envVars[i].startsWith('AIzaSyTest')) {
      keys[i] = envVars[i].trim();
    }
  }

  return keys;
}

function getGeminiApiKey() {
  const all = getGeminiApiKeys();
  return all.find(k => k && k.length > 0) || '';
}

// GET AI API Key Setting — Supports up to 4 configured keys with failover metadata
app.get('/api/settings/ai-key', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const keys = getGeminiApiKeys();
    const keysInfo = keys.map((k, idx) => ({
      slot: idx + 1,
      isConfigured: Boolean(k && k.length > 0),
      masked: k ? secretManager.maskSecret(k) : ''
    }));
    const isConfigured = keysInfo.some(k => k.isConfigured);
    const primaryMasked = keysInfo[0].masked || (keysInfo.find(k => k.isConfigured)?.masked || '');

    // SECURITY: Never return the raw API key to the frontend
    res.json({
      success: true,
      isConfigured,
      hasKey: isConfigured,
      masked: primaryMasked,
      keys: keysInfo,
      activeCount: keysInfo.filter(k => k.isConfigured).length
    });
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

// -------------------------------------------------------------
// INVOICE NUMBERING & FINANCIAL YEAR SEQUENCE SETTINGS
// -------------------------------------------------------------
app.get(['/api/settings/invoice-sequence', '/api/invoice-settings'], (req, res) => {
  try {
    const currentFY = getCurrentFinancialYear();
    const startRow = db.prepare("SELECT value FROM system_settings WHERE key = 'invoice_starting_number'").get();
    const seqRow = db.prepare("SELECT value FROM system_settings WHERE key = 'invoice_current_seq'").get();
    const fyRow = db.prepare("SELECT value FROM system_settings WHERE key = 'invoice_fy_year'").get();

    const startNum = startRow && !isNaN(parseInt(startRow.value)) ? parseInt(startRow.value) : 1;
    let currentSeq = seqRow && !isNaN(parseInt(seqRow.value)) ? parseInt(seqRow.value) : startNum;
    const storedFY = fyRow?.value || currentFY;

    res.json({
      success: true,
      invoice_starting_number: startNum,
      invoice_current_seq: currentSeq,
      invoice_fy_year: storedFY,
      current_fy: currentFY
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/settings/invoice-sequence', '/api/invoice-settings'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { invoice_starting_number, invoice_current_seq } = req.body;
    const startNum = parseInt(invoice_starting_number);
    const seqNum = parseInt(invoice_current_seq);

    if (isNaN(startNum) || startNum < 1) {
      return res.status(400).json({ success: false, error: 'Invoice starting number must be at least 1.' });
    }

    const upsertStmt = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);

    upsertStmt.run('invoice_starting_number', String(startNum));
    const finalSeq = !isNaN(seqNum) && seqNum >= 1 ? seqNum : startNum;
    upsertStmt.run('invoice_current_seq', String(finalSeq));
    const currentFY = getCurrentFinancialYear();
    upsertStmt.run('invoice_fy_year', currentFY);

    res.json({
      success: true,
      message: 'Invoice sequence settings updated successfully.',
      invoice_starting_number: startNum,
      invoice_current_seq: finalSeq,
      invoice_fy_year: currentFY
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// RECEIPT NUMBER SEQUENCING ENDPOINTS (CR01, UPI01, POS01...)
// -------------------------------------------------------------
app.post(['/api/receipts/next-numbers', '/api/receipt-numbers'], requireAuth, (req, res) => {
  try {
    const modes = Array.isArray(req.body.modes) ? req.body.modes : [req.body.mode || 'cash'];
    const numbers = {};
    modes.forEach(m => {
      numbers[m] = getReceiptNumberWithMode(m);
    });
    res.json({ success: true, receiptNumbers: numbers, receipt_numbers: numbers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// AUTO-SAVE FOLDER SETTING & SILENT PDF DISK SAVE ENDPOINTS
// -------------------------------------------------------------
app.get(['/api/settings/auto-save-dir', '/api/auto-save-dir'], (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_save_directory'").get();
    const defaultDir = path.join(os.homedir(), 'HotelCityPark_Saved_Receipts');
    const autoSaveDir = row && row.value && row.value.trim() ? row.value.trim() : defaultDir;
    res.json({
      success: true,
      auto_save_directory: autoSaveDir,
      is_custom: Boolean(row && row.value && row.value.trim())
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/settings/auto-save-dir', '/api/auto-save-dir'], requireAuth, requireRole('manager'), (req, res) => {
  try {
    const { auto_save_directory } = req.body;
    const cleanDir = (auto_save_directory || '').trim();
    if (!cleanDir) {
      return res.status(400).json({ success: false, error: 'Directory path cannot be empty.' });
    }

    // Attempt to ensure directory exists / create if needed
    try {
      if (!fs.existsSync(cleanDir)) {
        fs.mkdirSync(cleanDir, { recursive: true });
      }
      // Test write permission
      const testFile = path.join(cleanDir, '.test_write_hcp.tmp');
      fs.writeFileSync(testFile, 'write_test');
      fs.unlinkSync(testFile);
    } catch (fsErr) {
      return res.status(400).json({ success: false, error: `Cannot write to folder "${cleanDir}": ${fsErr.message}` });
    }

    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('auto_save_directory', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(cleanDir);

    res.json({
      success: true,
      auto_save_directory: cleanDir,
      message: `Auto-save directory successfully set to "${cleanDir}"`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/save-invoice-pdf', '/api/auto-save-receipt'], async (req, res) => {
  try {
    const { filename, pdfBase64, htmlContent, folder } = req.body;
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Filename is required' });
    }

    // Determine target directory
    let targetDir = folder;
    if (!targetDir) {
      const row = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_save_directory'").get();
      targetDir = row && row.value && row.value.trim() ? row.value.trim() : path.join(os.homedir(), 'HotelCityPark_Saved_Receipts');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const baseName = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = `${baseName}.pdf`;
    const targetPath = path.join(targetDir, safeFilename);

    if (pdfBase64) {
      const cleanBase64 = pdfBase64.includes(';base64,')
        ? pdfBase64.split(';base64,').pop()
        : pdfBase64.replace(/^data:[^,]+,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      fs.writeFileSync(targetPath, buffer);
    } else if (htmlContent) {
      const htmlPath = path.join(targetDir, `${baseName}.html`);
      fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    } else {
      return res.status(400).json({ success: false, error: 'No pdfBase64 or htmlContent provided to save' });
    }

    res.json({
      success: true,
      filePath: targetPath,
      filename: safeFilename,
      directory: targetDir,
      message: `File saved automatically to ${targetPath}`
    });
  } catch (err) {
    console.error('Auto-save invoice error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE AI API Key Setting — Supports up to 4 configured keys with failover support
app.post('/api/settings/ai-key', requireAuth, requireRole('manager'), (req, res) => {
  try {
    const currentKeys = getGeminiApiKeys(); // array of 4 strings [key0, key1, key2, key3]
    let updated = false;

    // Option A: Clear a specific slot
    if (req.body.slot && (req.body.clear || req.body.action === 'clear')) {
      const s = parseInt(req.body.slot, 10);
      if (s >= 1 && s <= 4) {
        currentKeys[s - 1] = '';
        updated = true;
      }
    } 
    // Option B: Update a single specific slot
    else if (req.body.slot && typeof req.body.key === 'string') {
      const s = parseInt(req.body.slot, 10);
      if (s >= 1 && s <= 4) {
        currentKeys[s - 1] = req.body.key.trim();
        updated = true;
      }
    } 
    // Option C: Bulk update array of 4 keys [k1, k2, k3, k4]
    else if (Array.isArray(req.body.keys)) {
      for (let i = 0; i < 4; i++) {
        if (req.body.keys[i] !== undefined && req.body.keys[i] !== '__KEEP__') {
          currentKeys[i] = typeof req.body.keys[i] === 'string' ? req.body.keys[i].trim() : '';
          updated = true;
        }
      }
    } 
    // Option D: Legacy single key payload { key: '...' } or { apiKey: '...' } -> Updates Slot 1
    else {
      const rawKey = req.body.key || req.body.apiKey;
      if (rawKey && typeof rawKey === 'string' && rawKey.trim()) {
        currentKeys[0] = rawKey.trim();
        updated = true;
      }
    }

    if (!updated) {
      return res.status(400).json({ success: false, error: 'No valid API key or slot provided.' });
    }

    // Encrypt all 4 keys and store in database
    const encryptedArray = currentKeys.map(k => k ? secretManager.encryptSecret(k) : '');
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('gemini_api_keys', JSON.stringify(encryptedArray));

    // Save each slot in system_settings for convenience
    for (let i = 0; i < 4; i++) {
      db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run(`gemini_api_key_${i + 1}`, encryptedArray[i]);
    }

    // Also update legacy 'gemini_api_key' with Key 1 (or first active key)
    const firstActive = currentKeys.find(k => k && k.length > 0) || currentKeys[0] || '';
    const encryptedPrimary = firstActive ? secretManager.encryptSecret(firstActive) : '';
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('gemini_api_key', encryptedPrimary);

    // Update process.env for all 4 slots
    process.env.GEMINI_API_KEY = currentKeys[0] || '';
    process.env.GEMINI_API_KEY_2 = currentKeys[1] || '';
    process.env.GEMINI_API_KEY_3 = currentKeys[2] || '';
    process.env.GEMINI_API_KEY_4 = currentKeys[3] || '';

    // Persist all 4 keys to .env file so keys are NEVER lost
    try {
      const envFilePath = path.join(__dirname, '.env');
      let envData = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
      
      const setEnvVar = (varName, val) => {
        if (envData.includes(`${varName}=`)) {
          envData = envData.replace(new RegExp(`${varName}=.*`, 'g'), `${varName}=${val}`);
        } else {
          envData += `\n${varName}=${val}\n`;
        }
      };

      setEnvVar('GEMINI_API_KEY', currentKeys[0] || '');
      setEnvVar('GEMINI_API_KEY_2', currentKeys[1] || '');
      setEnvVar('GEMINI_API_KEY_3', currentKeys[2] || '');
      setEnvVar('GEMINI_API_KEY_4', currentKeys[3] || '');

      fs.writeFileSync(envFilePath, envData.trim() + '\n', 'utf8');
    } catch (envErr) {
      console.warn('Could not write to .env file:', envErr.message);
    }

    // Return sanitized status (never raw secrets)
    const keysInfo = currentKeys.map((k, idx) => ({
      slot: idx + 1,
      isConfigured: Boolean(k && k.length > 0),
      masked: k ? secretManager.maskSecret(k) : ''
    }));

    res.json({
      success: true,
      message: '✓ Google Gemini AI Vision API Keys saved with automatic failover!',
      keys: keysInfo,
      isConfigured: keysInfo.some(k => k.isConfigured),
      hasKey: keysInfo.some(k => k.isConfigured),
      masked: keysInfo[0].masked || (keysInfo.find(k => k.isConfigured)?.masked || ''),
      activeCount: keysInfo.filter(k => k.isConfigured).length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clean Slate / Purge Demo Transactions Endpoint
app.post('/api/settings/clean-demo-data', requireAuth, requireRole('manager'), async (req, res) => {
  try {
    delete require.cache[require.resolve('./services/dbCleanService')];
    const { cleanDemoData } = require('./services/dbCleanService');
    const stats = cleanDemoData(db);
    // Clear Supabase cloud occupancies as well
    try {
      const occs = await supabaseService.fetchActiveOccupancies();
      for (const o of occs) {
        await supabaseService.removeActiveOccupancy(o.room_number);
      }
    } catch (sErr) {
      console.warn('[Supabase] Notice clearing cloud occupancies:', sErr.message);
    }
    res.json({
      success: true,
      message: '✓ All demo transactions and test rooms have been permanently purged! Database is now 100% clean and ready.',
      stats
    });
  } catch (err) {
    console.error('Error cleaning demo data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper: Test single key connectivity and quota against Google Gemini API with smart model fallback
async function testSingleGeminiKey(keyToTest, requestedModel = null) {
  if (!keyToTest || !keyToTest.trim()) {
    return { success: false, status: 400, error: 'No API key provided.' };
  }

  const cleanKey = keyToTest.trim();
  const modelsToTry = requestedModel
    ? [requestedModel]
    : ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash'];

  let lastResult = null;

  for (const model of modelsToTry) {
    const res = await new Promise((resolve) => {
      const startTime = Date.now();
      const postData = JSON.stringify({
        contents: [{ parts: [{ text: 'Respond with JSON: {"status": "ok"}' }] }],
        generationConfig: { response_mime_type: 'application/json' }
      });

      const testOptions = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`,
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
            resolve({
              success: true,
              status: 200,
              latencyMs,
              model,
              message: `✓ Connected Successfully (${latencyMs}ms - 200 OK)`
            });
          } else {
            let errSnippet = `Google API Error: ${apiRes.statusCode}`;
            try {
              const errJson = JSON.parse(data);
              if (errJson.error && errJson.error.message) {
                errSnippet = errJson.error.message;
              }
            } catch (e) {}

            const isQuota = apiRes.statusCode === 429;
            resolve({
              success: false,
              status: apiRes.statusCode,
              latencyMs,
              model,
              quotaExceeded: isQuota,
              error: isQuota
                ? `⚠️ Quota Exceeded (HTTP 429): Rate limit reached for ${model}.`
                : errSnippet
            });
          }
        });
      });

      testReq.on('error', (err) => {
        resolve({
          success: false,
          status: 500,
          latencyMs: Date.now() - startTime,
          error: 'Network Error: ' + err.message
        });
      });

      testReq.setTimeout(8000, () => {
        testReq.destroy();
        resolve({
          success: false,
          status: 504,
          latencyMs: 8000,
          error: 'Connection test timed out after 8s.'
        });
      });

      testReq.write(postData);
      testReq.end();
    });

    if (res.success) {
      return res;
    }

    lastResult = res;

    // If the key itself is invalid (HTTP 400 API_KEY_INVALID), stop early
    if (res.status === 400 && res.error && (res.error.includes('API_KEY_INVALID') || res.error.includes('API key not valid'))) {
      return res;
    }
  }

  return lastResult || { success: false, status: 500, error: 'Connection test failed across all candidate models.' };
}

// TEST AI API Key Connectivity — Supports testing single key or all configured keys
app.post(['/api/settings/ai-key/test', '/api/settings/test-gemini'], requireAuth, requireRole('manager'), async (req, res) => {
  try {
    const rawKey = req.body.key || req.body.apiKey;
    const requestedSlot = req.body.slot ? parseInt(req.body.slot, 10) : null;
    const testAll = Boolean(req.body.testAll || (!rawKey && !requestedSlot));

    const allKeys = getGeminiApiKeys();

    // Case 1: Test a typed key directly (not yet saved)
    if (rawKey && rawKey.trim()) {
      const result = await testSingleGeminiKey(rawKey.trim());
      return res.json({
        ...result,
        slot: requestedSlot || 1,
        masked: secretManager.maskSecret(rawKey.trim())
      });
    }

    // Case 2: Test a specific saved slot
    if (requestedSlot && requestedSlot >= 1 && requestedSlot <= 4) {
      const slotKey = allKeys[requestedSlot - 1];
      if (!slotKey) {
        return res.status(400).json({ success: false, error: `Key Slot #${requestedSlot} is not configured yet.` });
      }
      const result = await testSingleGeminiKey(slotKey);
      return res.json({
        ...result,
        slot: requestedSlot,
        masked: secretManager.maskSecret(slotKey)
      });
    }

    // Case 3: Test all configured slots simultaneously
    const results = [];
    for (let i = 0; i < 4; i++) {
      const k = allKeys[i];
      if (k && k.trim()) {
        const testRes = await testSingleGeminiKey(k.trim());
        results.push({
          slot: i + 1,
          isConfigured: true,
          masked: secretManager.maskSecret(k),
          ...testRes
        });
      } else {
        results.push({
          slot: i + 1,
          isConfigured: false,
          masked: '',
          success: false,
          status: null,
          message: 'Not Configured'
        });
      }
    }

    const operationalCount = results.filter(r => r.isConfigured && r.success).length;
    const configuredCount = results.filter(r => r.isConfigured).length;
    const atLeastOneOperational = operationalCount > 0;

    res.json({
      success: atLeastOneOperational,
      results,
      keys: results,
      configuredCount,
      operationalCount,
      activeFailoverReady: operationalCount > 1,
      message: atLeastOneOperational
        ? `✓ ${operationalCount} of ${configuredCount} API keys operational! Auto-failover active.`
        : (configuredCount === 0 ? 'No API keys configured yet.' : 'All configured API keys returned errors.')
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI OCR Document Details Analysis with Automatic Multi-Key Failover
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

    // Gather all configured API keys with their slot numbers
    const configuredKeys = getGeminiApiKeys();
    const activeKeySlots = [];
    configuredKeys.forEach((k, idx) => {
      if (k && k.trim() && !k.startsWith('AIzaSyTest')) {
        activeKeySlots.push({ slot: idx + 1, key: k.trim() });
      }
    });

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
        expiryDate: '',
        failoverHistory
      });
    }

    if (activeKeySlots.length === 0) {
      console.warn('[OCR] No Gemini API Key configured. Using Local Optical Fallback engine...');
      return executeSmartFallback('Local Optical Fallback (Offline Mode)');
    }

    const candidateModels = [
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-flash-latest',
      'gemini-3.8-flash',
      'gemini-3.5-flash'
    ];

    let lastErrorStatus = 500;
    let lastErrorMessage = 'AI OCR document parsing failed.';
    let lastErrorCode = 'AI_EXTRACTION_FAILED';
    const failoverHistory = [];

    // Multi-Key Failover Executor: Tries keys in sequence (Slot 1 -> Slot 2 -> Slot 3 -> Slot 4)
    function executeWithKeyFailover(keyIndex) {
      if (keyIndex >= activeKeySlots.length) {
        console.warn(`[OCR Failover] All ${activeKeySlots.length} configured Gemini API keys failed (${lastErrorMessage}). Seamlessly switching to Local Optical Fallback...`);
        return executeSmartFallback(lastErrorStatus === 429 ? 'Fast Local Optical Engine (Quota Limit Fallback)' : 'Fast Local Optical Engine');
      }

      const { slot: currentSlot, key: currentKey } = activeKeySlots[keyIndex];
      console.log(`[OCR Failover] Attempting extraction with Key Slot #${currentSlot} (${keyIndex + 1}/${activeKeySlots.length})...`);

      function tryModel(modelIdx) {
        if (modelIdx >= candidateModels.length) {
          console.warn(`[OCR Failover] Key Slot #${currentSlot}: all models exhausted (${lastErrorMessage}). Automatically shifting to next key...`);
          failoverHistory.push(`Slot #${currentSlot}: all models exhausted -> shifting to next key.`);
          return executeWithKeyFailover(keyIndex + 1);
        }

        const currentModel = candidateModels[modelIdx];
        const options = {
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${currentModel}:generateContent?key=${encodeURIComponent(currentKey)}`,
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
                    if (keyIndex > 0) {
                      console.log(`[OCR Failover] SUCCESS! Document extracted after auto-shift to Key Slot #${currentSlot}!`);
                    } else {
                      console.log(`[OCR] Successfully extracted details using Key Slot #${currentSlot} (${currentModel}):`, parsed.guestName || parsed.name);
                    }
                    return sendResponse(200, {
                      success: true,
                      modelUsed: currentModel,
                      keySlotUsed: currentSlot,
                      failoverOccurred: keyIndex > 0,
                      failoverNote: keyIndex > 0 ? `Automatically shifted from previous key to Backup Key Slot #${currentSlot}` : null,
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
                console.warn(`[OCR Slot #${currentSlot} / ${currentModel}] JSON parse error (${e.message}), trying next model...`);
                lastErrorStatus = 500;
                lastErrorCode = 'PARSE_ERROR';
                lastErrorMessage = `AI returned malformed JSON (${e.message}).`;
                return tryModel(modelIdx + 1);
              }
            }

            // Extract Google error message if present
            let errSnippet = '';
            try {
              const errJson = JSON.parse(data);
              errSnippet = errJson?.error?.message || '';
            } catch (_) {}

            // RATE LIMIT / QUOTA EXCEEDED (HTTP 429) -> Try next candidate model on this key first
            if (apiRes.statusCode === 429) {
              console.warn(`[OCR Failover] Key Slot #${currentSlot} / ${currentModel} hit HTTP 429 (Quota Exceeded). Trying next model on this key...`);
              lastErrorStatus = 429;
              lastErrorCode = 'RATE_LIMIT_EXCEEDED';
              lastErrorMessage = errSnippet || 'Google Gemini API Quota Exceeded (HTTP 429)';
              failoverHistory.push(`Slot #${currentSlot} (${currentModel}): Quota Exceeded (HTTP 429).`);
              return tryModel(modelIdx + 1);
            }

            // UNAUTHORIZED / FORBIDDEN (HTTP 401 / 403) -> INSTANT FAILOVER TO NEXT KEY!
            if (apiRes.statusCode === 401 || apiRes.statusCode === 403) {
              console.warn(`[OCR Failover] Key Slot #${currentSlot} returned HTTP ${apiRes.statusCode} (Invalid/Unauthorized). Instantly shifting to next API key...`);
              lastErrorStatus = apiRes.statusCode;
              lastErrorCode = 'UNAUTHORIZED';
              lastErrorMessage = errSnippet || `Gemini API Key in Slot #${currentSlot} is invalid or expired (HTTP ${apiRes.statusCode})`;
              failoverHistory.push(`Slot #${currentSlot}: Unauthorized (HTTP ${apiRes.statusCode}) -> shifted.`);
              return executeWithKeyFailover(keyIndex + 1);
            }

            if (apiRes.statusCode === 503) {
              console.warn(`[OCR Failover] Key Slot #${currentSlot} returned HTTP 503 (Overloaded). Trying next model/key...`);
              lastErrorStatus = 503;
              lastErrorCode = 'SERVICE_UNAVAILABLE';
              lastErrorMessage = 'AI Vision Service Temporarily Overloaded (HTTP 503)';
              return tryModel(modelIdx + 1);
            }

            console.warn(`[OCR Slot #${currentSlot} / ${currentModel}] status ${apiRes.statusCode} (${errSnippet}), trying next model...`);
            lastErrorStatus = apiRes.statusCode || 500;
            lastErrorCode = 'UPSTREAM_ERROR';
            lastErrorMessage = errSnippet || `Google Gemini API returned status ${apiRes.statusCode}.`;
            return tryModel(modelIdx + 1);
          });
        });

        apiReq.on('error', (err) => {
          console.warn(`[OCR Failover] Key Slot #${currentSlot} network error (${err.message}), shifting to next key...`);
          lastErrorStatus = 504;
          lastErrorCode = 'NETWORK_ERROR';
          lastErrorMessage = `Network connection error: ${err.message}`;
          failoverHistory.push(`Slot #${currentSlot}: Network error (${err.message}) -> shifted.`);
          return executeWithKeyFailover(keyIndex + 1);
        });

        apiReq.setTimeout(8000, () => {
          apiReq.destroy();
          console.warn(`[OCR Failover] Key Slot #${currentSlot} timed out after 8s, shifting to next key...`);
          lastErrorStatus = 504;
          lastErrorCode = 'TIMEOUT';
          lastErrorMessage = 'AI OCR request timed out after 8 seconds.';
          failoverHistory.push(`Slot #${currentSlot}: Timeout -> shifted.`);
          return executeWithKeyFailover(keyIndex + 1);
        });

        apiReq.write(requestBody);
        apiReq.end();
      }

      tryModel(0);
    }

    executeWithKeyFailover(0);
  } catch (err) {
    console.error('AI ID analysis handler error:', err);
    sendResponse(500, { success: false, error: err.message, statusCode: 500 });
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
        CASE WHEN g.guest_photo IS NOT NULL AND length(g.guest_photo) > 0 THEN 1 ELSE 0 END as has_guest_photo,
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
        b.split_cheque,
        b.settlement_cheque_no,
        b.settlement_cheque_bank,
        b.settlement_cheque_date,
        b.advance_cheque_no,
        b.advance_cheque_bank,
        b.advance_cheque_status,
        COALESCE((SELECT p.cheque_status FROM payments p WHERE p.booking_id = b.id AND (p.payment_mode = 'cheque' OR p.split_cheque > 0) ORDER BY p.id DESC LIMIT 1), b.advance_cheque_status, 'pending') as cheque_status,
        CASE WHEN b.settlement_cheque_photo IS NOT NULL OR b.cheque_photo IS NOT NULL OR EXISTS(SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.cheque_photo IS NOT NULL) THEN 1 ELSE 0 END as has_cheque_photo,
        b.payment_status,
        b.status as booking_status,
        b.is_prepaid,
        b.ota_bill_amount,
        b.rate_type,
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
        b.extension_logs_json,
        COALESCE(
          (SELECT MAX(created_at) FROM payments p WHERE p.booking_id = b.id),
          (SELECT MAX(COALESCE(settled_at, created_at)) FROM restaurant_orders ro WHERE ro.booking_id = b.id),
          (SELECT MAX(COALESCE(settled_at, created_at)) FROM bar_orders bo WHERE bo.booking_id = b.id),
          b.actual_checkout_time,
          b.checkin_time,
          b.created_at
        ) as last_activity_time,
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

    query += ` ORDER BY last_activity_time DESC, b.id DESC LIMIT ?`;
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
          guest_photo: null,
          has_guest_photo: Boolean(row.has_guest_photo),
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
          split_cheque: row.split_cheque || 0,
          settlement_cheque_no: row.settlement_cheque_no || row.advance_cheque_no || null,
          settlement_cheque_bank: row.settlement_cheque_bank || row.advance_cheque_bank || null,
          settlement_cheque_date: row.settlement_cheque_date || null,
          settlement_cheque_photo: row.has_cheque_photo ? 'present' : null,
          advance_cheque_no: row.advance_cheque_no || null,
          advance_cheque_bank: row.advance_cheque_bank || null,
          advance_cheque_status: row.advance_cheque_status || null,
          cheque_photo: row.has_cheque_photo ? 'present' : null,
          has_cheque_photo: Boolean(row.has_cheque_photo),
          cheque_status: row.cheque_status || 'pending',
          payment_status: row.payment_status,
          booking_source: row.booking_source,
          ota_platform: row.ota_platform,
          ota_booking_id: row.ota_booking_id,
          is_prepaid: row.is_prepaid,
          ota_bill_amount: row.ota_bill_amount || 0,
          rate_type: row.rate_type || null,
          btc_company_id: row.btc_company_id,
          btc_company_name: row.btc_company_name,
          btc_approval_ref: row.btc_approval_ref,
          advance_payment_mode: row.advance_payment_mode,
          final_settlement_mode: row.final_settlement_mode,
          final_payment_mode: row.final_settlement_mode || row.advance_payment_mode || (row.is_prepaid ? 'prepaid' : 'cash'),
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
          created_at: row.created_at,
          last_activity_time: row.last_activity_time || row.actual_checkout_time || row.checkin_time || row.created_at,
          extension_logs_json: row.extension_logs_json
        });
      } else {
        const entry = groupedMap.get(key);
        entry.all_booking_ids.push(row.booking_id);
        if (row.last_activity_time && (!entry.last_activity_time || new Date(row.last_activity_time) > new Date(entry.last_activity_time))) {
          entry.last_activity_time = row.last_activity_time;
        }
        if (!entry.rooms.includes(row.room_number)) {
          entry.rooms.push(row.room_number);
          entry.all_group_rooms.push({ id: row.room_id, room_number: row.room_number, room_type: row.room_type });
        }
        if (row.is_prepaid) entry.is_prepaid = row.is_prepaid;
        if (row.ota_bill_amount) entry.ota_bill_amount = (entry.ota_bill_amount || 0) + (row.ota_bill_amount || 0);
        if (row.rate_type) entry.rate_type = row.rate_type;
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
        entry.split_cheque = (entry.split_cheque || 0) + (row.split_cheque || 0);
        if (!entry.cheque_photo && (row.effective_cheque_photo || row.cheque_photo)) {
          entry.cheque_photo = row.effective_cheque_photo || row.cheque_photo;
          entry.settlement_cheque_photo = row.effective_cheque_photo || row.cheque_photo;
        }
        if (!entry.settlement_cheque_no && (row.settlement_cheque_no || row.advance_cheque_no)) {
          entry.settlement_cheque_no = row.settlement_cheque_no || row.advance_cheque_no;
        }
        if (!entry.settlement_cheque_bank && (row.settlement_cheque_bank || row.advance_cheque_bank)) {
          entry.settlement_cheque_bank = row.settlement_cheque_bank || row.advance_cheque_bank;
        }
        if (row.cheque_status && entry.cheque_status === 'pending') {
          entry.cheque_status = row.cheque_status;
        }
        entry.adults_male += (row.adults_male || 0);
        entry.adults_female += (row.adults_female || 0);
        entry.children += (row.children || 0);
        entry.extra_beds += (row.extra_beds || 0);
      }
    });

    const historyList = Array.from(groupedMap.values());
    historyList.sort((a, b) => {
      const tA = a.last_activity_time ? new Date(a.last_activity_time).getTime() : (a.id || 0);
      const tB = b.last_activity_time ? new Date(b.last_activity_time).getTime() : (b.id || 0);
      return tB - tA;
    });
    res.json({ success: true, count: historyList.length, history: historyList, records: historyList });
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================================
// 17B. MANAGER ACCOUNTING & ANALYSIS REPORT
// ==========================================================================
app.get('/api/manager/accounting-analysis', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const {
      fromDate,
      from_date,
      toDate,
      to_date,
      fromBillNo,
      from_bill_no,
      toBillNo,
      to_bill_no,
      fromVoucherNo,
      from_voucher_no,
      toVoucherNo,
      to_voucher_no,
      q,
      search,
      limit = 500
    } = req.query;

    const startDate = fromDate || from_date;
    const endDate = toDate || to_date;
    const startBill = fromBillNo || from_bill_no;
    const endBill = toBillNo || to_bill_no;
    const startVoucher = fromVoucherNo || from_voucher_no;
    const endVoucher = toVoucherNo || to_voucher_no;
    const searchQuery = (q || search || '').trim();

    let sql = `
      SELECT 
        b.id as booking_id,
        b.room_id,
        r.room_number,
        r.room_type,
        b.guest_id,
        g.name as guest_name,
        g.mobile as guest_mobile,
        g.company_name as guest_company_name,
        g.gst_number as guest_gst_number,
        b.checkin_time,
        b.approx_checkout_time,
        b.actual_checkout_time,
        b.room_rate,
        b.discount_pct,
        b.discount_amount,
        b.total_room_charge,
        b.total_paid,
        b.booking_source,
        b.ota_platform,
        b.ota_booking_id,
        b.company_name as booking_company_name,
        b.gst_number as booking_gst_number,
        b.btc_company_id,
        b.btc_company_name,
        c.company_name as btc_ref_company_name,
        c.gst_number as btc_gst_number,
        b.voucher_number,
        b.advance_receipt_no,
        b.final_receipt_no,
        b.extra_beds,
        b.extra_bed_charge,
        b.adults_male,
        b.adults_female,
        b.children,
        b.status as booking_status,
        b.is_igst,
        b.tax_type,
        b.created_at,
        b.is_early_checkin,
        b.early_checkin_charge,
        b.extension_logs_json
      FROM bookings b
      JOIN guests g ON b.guest_id = g.id
      JOIN rooms r ON b.room_id = r.id
      LEFT JOIN btc_companies c ON (b.btc_company_id = c.id OR (b.btc_company_name IS NOT NULL AND b.btc_company_name != '' AND b.btc_company_name = c.company_name))
      WHERE (b.status = 'checked_out' OR (b.actual_checkout_time IS NOT NULL AND b.status != 'cancelled'))
    `;

    const params = [];

    // Filter strictly by checkout date
    if (startDate) {
      sql += ` AND (DATE(COALESCE(b.actual_checkout_time, b.approx_checkout_time), 'localtime') >= DATE(?) OR DATE(COALESCE(b.actual_checkout_time, b.approx_checkout_time)) >= DATE(?))`;
      params.push(startDate, startDate);
    }
    if (endDate) {
      sql += ` AND (DATE(COALESCE(b.actual_checkout_time, b.approx_checkout_time), 'localtime') <= DATE(?) OR DATE(COALESCE(b.actual_checkout_time, b.approx_checkout_time)) <= DATE(?))`;
      params.push(endDate, endDate);
    }

    if (searchQuery) {
      const s = `%${searchQuery}%`;
      sql += ` AND (
        g.name LIKE ? OR 
        g.mobile LIKE ? OR 
        r.room_number LIKE ? OR 
        b.voucher_number LIKE ? OR 
        b.final_receipt_no LIKE ? OR 
        b.advance_receipt_no LIKE ? OR 
        b.company_name LIKE ? OR 
        b.gst_number LIKE ? OR 
        g.company_name LIKE ? OR 
        g.gst_number LIKE ? OR 
        b.ota_platform LIKE ? OR 
        b.btc_company_name LIKE ? OR
        c.company_name LIKE ? OR
        c.gst_number LIKE ?
      )`;
      for (let i = 0; i < 14; i++) params.push(s);
    }

    sql += ` ORDER BY COALESCE(b.actual_checkout_time, b.approx_checkout_time) DESC, b.id DESC`;
    if (limit && parseInt(limit) > 0) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit));
    }

    const rows = db.prepare(sql).all(...params);

    // Helper to format Tax Invoice Number (e.g. 261002-618 -> HCP618)
    const formatTaxInvoiceNumberLocal = (val) => {
      if (!val) return 'HCP1';
      const str = String(val).trim();
      if (/^HCP\d+$/i.test(str)) {
        return str.toUpperCase();
      }
      if (/^L\d+$/i.test(str)) {
        return `HCP${str.slice(1)}`;
      }
      const match = str.match(/-(\d+)$/);
      if (match) {
        return `HCP${match[1]}`;
      }
      if (/^\d{1,4}$/.test(str)) {
        return `HCP${str}`;
      }
      return str;
    };

    // Pre-fetch visitors breakfast amounts grouped by booking_id
    const visitorsBreakfastRows = db.prepare(`
      SELECT booking_id, SUM(breakfast_amount) as total_visitor_breakfast 
      FROM room_visitors 
      WHERE has_breakfast = 1 
      GROUP BY booking_id
    `).all();
    const visitorBreakfastMap = new Map();
    visitorsBreakfastRows.forEach(v => {
      visitorBreakfastMap.set(v.booking_id, Number(v.total_visitor_breakfast || 0));
    });

    // Group multi-room bookings by voucher number / stay session so each Bill = 1 row
    const billMap = new Map();

    rows.forEach(row => {
      const cleanVoucher = row.voucher_number ? String(row.voucher_number).trim().replace(/\b20(\d{6}-\d+)\b/g, '$1') : `BK-${row.booking_id}`;
      const groupKey = row.voucher_number ? `v_${cleanVoucher}` : `b_${row.booking_id}`;

      // Calculate stay days
      const checkinDate = row.checkin_time ? new Date(row.checkin_time) : new Date();
      const checkoutDate = row.actual_checkout_time ? new Date(row.actual_checkout_time) : (row.approx_checkout_time ? new Date(row.approx_checkout_time) : new Date());
      const stayDays = Math.max(1, Math.round(Math.max(0, checkoutDate.getTime() - checkinDate.getTime()) / (1000 * 60 * 60 * 24)));

      const isOta = (row.booking_source || '').toUpperCase() === 'OTA' || Boolean(row.ota_platform);

      // Pre-checkin fees (early checkin charge) pre-tax base:
      const earlyCheckinAmt = Number(row.early_checkin_charge || 0);
      const earlyCheckinBase = earlyCheckinAmt > 0
        ? (isOta ? Math.round(earlyCheckinAmt * 0.95 * 100) / 100 : Math.round((earlyCheckinAmt / 1.05) * 100) / 100)
        : 0;

      // Extra hours / stay extension pre-tax base:
      let extensionBase = 0;
      if (row.extension_logs_json) {
        try {
          const extLogs = typeof row.extension_logs_json === 'string' ? JSON.parse(row.extension_logs_json) : row.extension_logs_json;
          if (Array.isArray(extLogs)) {
            extLogs.forEach(ext => {
              const extAmt = Number(ext.amount || ext.charge || ext.cost || ext.extension_charge || 0);
              if (extAmt > 0) {
                extensionBase += isOta ? (extAmt * 0.95) : (extAmt / 1.05);
              }
            });
            extensionBase = Math.round(extensionBase * 100) / 100;
          }
        } catch (_) {}
      }

      // Base room rent calculation
      const extraMattressRow = Number(row.extra_bed_charge > 0 ? row.extra_bed_charge : ((row.extra_beds || 0) * 500));
      const visitorBreakfastRow = (visitorBreakfastMap.get(row.booking_id) || 0) + Number(row.extra_breakfast_charge || 0);
      const discountRow = Number(row.discount_amount || 0);
      
      let baseRentRow = 0;
      if (row.room_rate && row.room_rate > 0) {
        baseRentRow = (Number(row.room_rate) * stayDays) + earlyCheckinBase + extensionBase;
      } else if (row.total_room_charge > 0) {
        const taxablePortion = Math.round((row.total_room_charge / 1.05) * 100) / 100;
        baseRentRow = Math.max(0, taxablePortion - extraMattressRow - visitorBreakfastRow + discountRow);
      }

      // Name Of Company resolution:
      let nameOfCompany = '';
      if (isOta) {
        nameOfCompany = row.ota_platform ? row.ota_platform.trim() : 'OTA';
      } else if (row.booking_company_name && row.booking_company_name.trim()) {
        nameOfCompany = row.booking_company_name.trim();
      } else if (row.btc_company_name && row.btc_company_name.trim()) {
        nameOfCompany = row.btc_company_name.trim();
      } else if (row.btc_ref_company_name && row.btc_ref_company_name.trim()) {
        nameOfCompany = row.btc_ref_company_name.trim();
      } else if (row.guest_company_name && row.guest_company_name.trim()) {
        nameOfCompany = row.guest_company_name.trim();
      } else {
        nameOfCompany = '-';
      }

      // GST No of Company resolution:
      let gstNoOfCompany = '';
      if (isOta) {
        gstNoOfCompany = (row.booking_gst_number || row.guest_gst_number || '').trim();
        if (!gstNoOfCompany) {
          if (/makemytrip|mmt|goibibo/i.test(row.ota_platform || '')) {
            gstNoOfCompany = '27AABCM6906E1ZW';
          } else if (/booking\.?com/i.test(row.ota_platform || '')) {
            gstNoOfCompany = '27AAGCB6887F1Z8';
          } else if (/agoda/i.test(row.ota_platform || '')) {
            gstNoOfCompany = '9919SGP29004OS2';
          }
        }
      } else {
        gstNoOfCompany = (row.booking_gst_number || row.btc_gst_number || row.guest_gst_number || '').trim();
      }
      gstNoOfCompany = gstNoOfCompany || '-';

      if (!billMap.has(groupKey)) {
        // Voucher No & Invoice No (HCP..) resolution:
        const voucherNo = cleanVoucher;
        const rawReceipt = row.final_receipt_no || cleanVoucher;
        const invoiceNo = formatTaxInvoiceNumberLocal(rawReceipt);

        // Date of checkout
        const rawCheckout = row.actual_checkout_time || row.approx_checkout_time || row.checkin_time;
        const checkoutDt = rawCheckout ? new Date(rawCheckout) : new Date();
        const d = String(checkoutDt.getDate()).padStart(2, '0');
        const m = String(checkoutDt.getMonth() + 1).padStart(2, '0');
        const y = checkoutDt.getFullYear();
        const formattedDate = `${d}-${m}-${y}`;

        billMap.set(groupKey, {
          id: row.booking_id,
          booking_ids: [row.booking_id],
          checkout_date_raw: rawCheckout,
          date_of_checkout: formattedDate,
          is_checked_out: true,
          bill_no: voucherNo,
          voucher_no: voucherNo,
          invoice_number: invoiceNo,
          name_of_customer: row.guest_name || 'Guest',
          room_rent_base: baseRentRow,
          extra_mattress_pax: extraMattressRow,
          visitor_breakfast_base: visitorBreakfastRow,
          discount: discountRow,
          name_of_customer_gst: nameOfCompany,
          name_of_company: nameOfCompany,
          gst_no_of_customer: gstNoOfCompany,
          gst_no_of_company: gstNoOfCompany,
          rooms: [row.room_number],
          room_type: row.room_type,
          booking_source: row.booking_source,
          ota_platform: row.ota_platform,
          total_room_charge: row.total_room_charge || 0,
          total_paid: row.total_paid || 0,
          payment_status: row.booking_status
        });
      } else {
        const item = billMap.get(groupKey);
        item.booking_ids.push(row.booking_id);
        if (!item.rooms.includes(row.room_number)) {
          item.rooms.push(row.room_number);
        }
        item.room_rent_base += baseRentRow;
        item.extra_mattress_pax += extraMattressRow;
        item.visitor_breakfast_base += visitorBreakfastRow;
        item.discount += discountRow;
        item.total_room_charge += (row.total_room_charge || 0);
        item.total_paid += (row.total_paid || 0);

        if (item.name_of_company === '-' && nameOfCompany !== '-') {
          item.name_of_company = nameOfCompany;
          item.name_of_customer_gst = nameOfCompany;
        }
        if (item.gst_no_of_company === '-' && gstNoOfCompany !== '-') {
          item.gst_no_of_company = gstNoOfCompany;
          item.gst_no_of_customer = gstNoOfCompany;
        }
      }
    });

    let records = Array.from(billMap.values());

    // Calculate CGST & SGST for each bill item
    records.forEach(item => {
      const taxable = Math.max(0, item.room_rent_base + item.extra_mattress_pax + (item.visitor_breakfast_base || 0) - item.discount);
      const totalGst = Number((taxable * 0.05).toFixed(2));
      const cgst = Number((totalGst / 2).toFixed(2));
      const sgst = Number((totalGst - cgst).toFixed(2));
      
      item.taxable_amount = taxable;
      item.cgst = cgst;
      item.sgst = sgst;
      item.cgst_sgst_total = totalGst;
      item.grand_total = Number((taxable + totalGst).toFixed(2));
      item.rooms_str = item.rooms.join(', ');
    });

    // Helper to match number / voucher range
    const filterByNumberRange = (val, from, to) => {
      if (!from && !to) return true;
      if (!val) return false;
      const strVal = String(val).trim();
      
      const valDigits = strVal.match(/(\d+)$/);
      const valNum = valDigits ? parseInt(valDigits[1], 10) : null;
      
      const fromStr = from ? String(from).trim() : null;
      const toStr = to ? String(to).trim() : null;
      
      const fromNum = fromStr && /^\d+$/.test(fromStr) ? parseInt(fromStr, 10) : null;
      const toNum = toStr && /^\d+$/.test(toStr) ? parseInt(toStr, 10) : null;
      
      if (valNum !== null && (fromNum !== null || toNum !== null)) {
        if (fromNum !== null && valNum < fromNum) return false;
        if (toNum !== null && valNum > toNum) return false;
        return true;
      }
      
      if (fromStr && strVal.localeCompare(fromStr) < 0) return false;
      if (toStr && strVal.localeCompare(toStr) > 0) return false;
      return true;
    };

    // Apply Bill No / Voucher No range filter if provided
    if (startBill || endBill) {
      records = records.filter(item => filterByNumberRange(item.voucher_no || item.bill_no, startBill, endBill));
    }

    // Apply Voucher / Invoice No range filter if provided
    if (startVoucher || endVoucher) {
      records = records.filter(item => filterByNumberRange(item.invoice_number, startVoucher, endVoucher) || filterByNumberRange(item.voucher_no || item.bill_no, startVoucher, endVoucher));
    }

    // Calculate Summary Totals
    const summary = records.reduce((acc, it) => {
      acc.total_records += 1;
      acc.total_room_rent_base += it.room_rent_base;
      acc.total_extra_mattress += it.extra_mattress_pax;
      acc.total_visitor_breakfast += (it.visitor_breakfast_base || 0);
      acc.total_discount += it.discount;
      acc.total_cgst += it.cgst;
      acc.total_sgst += it.sgst;
      acc.total_cgst_sgst += it.cgst_sgst_total;
      acc.total_grand += it.grand_total;
      return acc;
    }, {
      total_records: 0,
      total_room_rent_base: 0,
      total_extra_mattress: 0,
      total_visitor_breakfast: 0,
      total_discount: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_cgst_sgst: 0,
      total_grand: 0
    });

    summary.total_room_rent_base = Number(summary.total_room_rent_base.toFixed(2));
    summary.total_extra_mattress = Number(summary.total_extra_mattress.toFixed(2));
    summary.total_visitor_breakfast = Number(summary.total_visitor_breakfast.toFixed(2));
    summary.total_discount = Number(summary.total_discount.toFixed(2));
    summary.total_cgst = Number(summary.total_cgst.toFixed(2));
    summary.total_sgst = Number(summary.total_sgst.toFixed(2));
    summary.total_cgst_sgst = Number(summary.total_cgst_sgst.toFixed(2));
    summary.total_grand = Number(summary.total_grand.toFixed(2));

    res.json({
      success: true,
      count: records.length,
      records,
      summary
    });
  } catch (err) {
    console.error('Accounting analysis fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 17C. MANAGER ACCOUNTING EMAIL DISPATCH & RECIPIENT SETTINGS
// -------------------------------------------------------------
function escapeHtmlAccountingEmail(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.get('/api/manager/accounting-email', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (_) {}
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'accounting_recipient_email'").get();
    res.json({ success: true, email: row?.value || '' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manager/accounting-email', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (_) {}
    const { email } = req.body;
    const cleanEmail = (email || '').trim();
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('accounting_recipient_email', ?, CURRENT_TIMESTAMP)").run(cleanEmail);
    res.json({ success: true, email: cleanEmail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/manager/smtp-settings', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const getVal = (k) => db.prepare("SELECT value FROM system_settings WHERE key = ?").get(k)?.value;
    const smtpHost = getVal('smtp_host') || process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = getVal('smtp_port') || process.env.SMTP_PORT || '587';
    const smtpUser = getVal('smtp_user') || process.env.SMTP_USER || process.env.EMAIL_USER || '';
    const smtpPass = getVal('smtp_pass') || process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
    const smtpFrom = getVal('smtp_from') || process.env.SMTP_FROM || '';

    res.json({
      success: true,
      configured: Boolean(smtpUser && smtpPass),
      smtpHost,
      smtpPort,
      smtpUser,
      hasPassword: Boolean(smtpPass),
      smtpFrom
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manager/smtp-settings', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom } = req.body;

    const setSetting = (k, v) => {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(k, String(v));
    };

    if (smtpHost !== undefined && smtpHost !== '') {
      setSetting('smtp_host', smtpHost.trim());
      process.env.SMTP_HOST = smtpHost.trim();
    }
    if (smtpPort !== undefined && smtpPort !== '') {
      setSetting('smtp_port', String(smtpPort).trim());
      process.env.SMTP_PORT = String(smtpPort).trim();
    }
    if (smtpUser !== undefined) {
      setSetting('smtp_user', smtpUser.trim());
      process.env.SMTP_USER = smtpUser.trim();
    }
    if (smtpPass !== undefined && smtpPass.trim() !== '') {
      setSetting('smtp_pass', smtpPass.trim());
      process.env.SMTP_PASS = smtpPass.trim();
    }
    if (smtpFrom !== undefined) {
      setSetting('smtp_from', smtpFrom.trim());
      process.env.SMTP_FROM = smtpFrom.trim();
    }

    // Persist to .env file
    try {
      const envPath = path.join(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        const updateOrAppend = (key, val) => {
          if (!val) return;
          const regex = new RegExp(`^${key}=.*$`, 'm');
          if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${val}`);
          } else {
            envContent += `\n${key}=${val}`;
          }
        };
        if (smtpHost) updateOrAppend('SMTP_HOST', smtpHost.trim());
        if (smtpPort) updateOrAppend('SMTP_PORT', String(smtpPort).trim());
        if (smtpUser) updateOrAppend('SMTP_USER', smtpUser.trim());
        if (smtpPass && smtpPass.trim()) updateOrAppend('SMTP_PASS', smtpPass.trim());
        if (smtpFrom) updateOrAppend('SMTP_FROM', smtpFrom.trim());
        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
      }
    } catch (_) {}

    res.json({ success: true, message: 'SMTP settings updated successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/manager/send-accounting-email', requireAuth, requireRole('manager', 'hospitality'), async (req, res) => {
  try {
    const { email, filename, excelXml, summary = {}, filters = {}, recordsCount } = req.body;
    const recipientEmail = (email || '').trim();
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ success: false, error: 'Valid recipient email address is required' });
    }

    if (!excelXml || typeof excelXml !== 'string') {
      return res.status(400).json({ success: false, error: 'Excel file data is required' });
    }

    // Save as current recipient email in system_settings
    try {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('accounting_recipient_email', ?, CURRENT_TIMESTAMP)").run(recipientEmail);
    } catch (_) {}

    // Check system_settings or process.env for SMTP config
    let smtpHost = process.env.SMTP_HOST;
    let smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : null;
    let smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
    let smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    let smtpFrom = process.env.SMTP_FROM;

    try {
      const getVal = (k) => db.prepare("SELECT value FROM system_settings WHERE key = ?").get(k)?.value;
      if (!smtpHost) smtpHost = getVal('smtp_host') || 'smtp.gmail.com';
      if (!smtpPort) smtpPort = parseInt(getVal('smtp_port') || '587', 10);
      if (!smtpUser) smtpUser = getVal('smtp_user');
      if (!smtpPass) smtpPass = getVal('smtp_pass');
      if (!smtpFrom) smtpFrom = getVal('smtp_from');
    } catch (_) {}

    if (!smtpHost) smtpHost = 'smtp.gmail.com';
    if (!smtpPort) smtpPort = 587;
    if (!smtpFrom) {
      smtpFrom = smtpUser ? `"Hotel City Park" <${smtpUser}>` : '"Hotel City Park" <hcitypark@rediffmail.com>';
    }

    const fromDt = filters.fromDate || filters.from_date || 'Start';
    const toDt = filters.toDate || filters.to_date || 'Present';
    const totalBills = recordsCount || summary.total_records || '0';
    const netTotal = summary.net_payable_total || summary.total_grand || summary.total_room_rent_base || '0.00';
    const roomRentBase = summary.total_room_rent_base || '0.00';
    const extraMattress = summary.total_extra_mattress || '0.00';
    const extraBreakfast = summary.total_visitor_breakfast || '0.00';
    const totalDiscount = summary.total_discount || '0.00';
    const totalCgst = summary.total_cgst || '0.00';
    const totalSgst = summary.total_sgst || '0.00';

    const safeFilename = filename || `Accounting_Analysis_${new Date().toISOString().slice(0, 10)}.xls`;

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; border: 1.5px solid #e2e8f0; border-radius: 14px; background-color: #ffffff; color: #1e293b;">
        <div style="border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px;">
          <h2 style="margin: 0; color: #1e3a8a; font-size: 22px; font-weight: 850;">HOTEL CITY PARK - SOLAPUR</h2>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">Hospitality &amp; POS Suite • Accounting &amp; Analysis Audit</p>
        </div>

        <p style="font-size: 14px; line-height: 1.5; color: #334155;">
          Hello,<br/><br/>
          Attached is the requested <strong>Accounting &amp; Analysis Audit Excel spreadsheet</strong> for the period <strong>${escapeHtmlAccountingEmail(fromDt)} to ${escapeHtmlAccountingEmail(toDt)}</strong>.
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; font-weight: 800;">Filtered Financial Summary</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Total Invoices / Bills:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700; color: #0f172a;">${escapeHtmlAccountingEmail(String(totalBills))}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Room Rent (Base):</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #0f172a;">₹${Number(roomRentBase).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Extra Mattress (PAX):</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #0f172a;">₹${Number(extraMattress).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Visitors Extra Breakfast:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #0f172a;">₹${Number(extraBreakfast).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Discounts Applied:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #dc2626;">-₹${Number(totalDiscount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">CGST &amp; SGST:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #16a34a;">₹${(Number(totalCgst) + Number(totalSgst)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr style="border-top: 1.5px solid #cbd5e1;">
              <td style="padding: 10px 0 4px; font-weight: 850; font-size: 15px; color: #1e3a8a;">Net Payable Total:</td>
              <td style="padding: 10px 0 4px; text-align: right; font-weight: 850; font-size: 15px; color: #1e3a8a;">₹${Number(netTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 13px; color: #64748b; line-height: 1.4;">
          The full spreadsheet with customer tax IDs, voucher numbers, and tariff breakdowns is attached as <strong>${escapeHtmlAccountingEmail(safeFilename)}</strong>.
        </p>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center;">
          Sent automatically from Hotel City Park Management Suite • Solapur
        </div>
      </div>
    `;

    // Ensure audit log table exists
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS email_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient_email TEXT NOT NULL,
          subject TEXT,
          filename TEXT,
          status TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (_) {}

    if (!smtpUser || !smtpPass) {
      try {
        db.prepare(`
          INSERT INTO email_audit_logs (recipient_email, subject, filename, status, error_message)
          VALUES (?, ?, ?, 'PENDING_CONFIG', 'SMTP credentials (SMTP_USER / SMTP_PASS) not configured in .env')
        `).run(recipientEmail, `Hotel City Park - Accounting & Analysis Audit (${fromDt} to ${toDt})`, safeFilename);
      } catch (_) {}

      return res.status(400).json({
        success: false,
        smtpConfigRequired: true,
        error: 'SMTP credentials not configured. Please add SMTP_USER and SMTP_PASS to your .env file or system settings to dispatch live emails directly from the server.'
      });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser.trim(),
        pass: String(smtpPass || '').replace(/\s+/g, '').trim()
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: smtpFrom,
      to: recipientEmail,
      subject: `Hotel City Park - Accounting & Analysis Report (${fromDt} to ${toDt})`,
      html: htmlBody,
      attachments: [
        {
          filename: safeFilename,
          content: Buffer.from(excelXml, 'utf-8'),
          contentType: 'application/vnd.ms-excel'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);

    try {
      db.prepare(`
        INSERT INTO email_audit_logs (recipient_email, subject, filename, status, error_message)
        VALUES (?, ?, ?, 'SENT', ?)
      `).run(recipientEmail, mailOptions.subject, safeFilename, info.messageId || 'OK');
    } catch (_) {}

    return res.json({
      success: true,
      message: `Accounting analysis report successfully sent to ${recipientEmail}`,
      messageId: info.messageId
    });
  } catch (err) {
    console.error('Error sending accounting email:', err);
    try {
      db.prepare(`
        INSERT INTO email_audit_logs (recipient_email, subject, filename, status, error_message)
        VALUES (?, ?, ?, 'ERROR', ?)
      `).run(req.body?.email || 'unknown', 'Accounting & Analysis Report', req.body?.filename || 'report.xls', err.message || 'Error');
    } catch (_) {}

    return res.status(500).json({
      success: false,
      error: 'Failed to send email: ' + (err.message || 'SMTP transmission error')
    });
  }
});

// Migrations for transaction ID and cheque photos in payments & bookings
try { db.exec("ALTER TABLE bookings ADD COLUMN split_cheque REAL DEFAULT 0;"); } catch (e) {}
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

// Endpoint to Pass / Realize Cheque and immediately credit amount into hotel accounts ledger
app.post(['/api/bookings/:id/pass-cheque', '/api/hospitality/history/:id/pass-cheque'], requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { cashier_name, notes, cheque_no, bank_name } = req.body;
    const cleanCashier = (cashier_name || req.user?.full_name || req.user?.username || 'Accounts Staff').trim();
    const now = new Date().toISOString();

    const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    // Find all linked group bookings sharing the guest and checkin time
    const inTimeKey = booking.checkin_time ? new Date(booking.checkin_time).toISOString().substring(0, 16) : '';
    const groupBookings = db.prepare(`
      SELECT id, room_id, total_room_charge, total_paid FROM bookings
      WHERE guest_id = ? AND strftime('%Y-%m-%dT%H:%M', checkin_time) = ?
    `).all(booking.guest_id, inTimeKey);
    const bookingIds = groupBookings.length > 0 ? groupBookings.map(gb => gb.id) : [booking.id];

    // Find any existing cheque payment for this booking
    const existingChequePayment = db.prepare(`
      SELECT * FROM payments 
      WHERE booking_id = ? AND (payment_mode = 'cheque' OR split_cheque > 0 OR cheque_no IS NOT NULL)
      ORDER BY id DESC LIMIT 1
    `).get(id);

    const totalGroupCharge = groupBookings.reduce((sum, gb) => sum + (gb.total_room_charge || 0), 0) || booking.total_room_charge || 0;
    const totalGroupPaid = groupBookings.reduce((sum, gb) => sum + (gb.total_paid || 0), 0);
    const dueAmount = Math.max(0, totalGroupCharge - totalGroupPaid) || totalGroupCharge;

    const chequeAmt = existingChequePayment 
      ? (parseFloat(existingChequePayment.split_cheque || 0) > 0 ? parseFloat(existingChequePayment.split_cheque) : parseFloat(existingChequePayment.amount || 0))
      : (parseFloat(booking.split_cheque || 0) > 0 ? parseFloat(booking.split_cheque) : dueAmount);

    let receiptNo = existingChequePayment?.receipt_no;

    if (existingChequePayment) {
      // Mark existing payment as realized / passed
      db.prepare(`
        UPDATE payments 
        SET 
          cheque_status = 'realized',
          realized_at = ?,
          cashier_name = COALESCE(?, cashier_name),
          cheque_no = COALESCE(?, cheque_no),
          bank_name = COALESCE(?, bank_name),
          notes = CASE WHEN ? != '' THEN notes || ' | ' || ? ELSE notes END
        WHERE id = ?
      `).run(
        now,
        cleanCashier,
        cheque_no || null,
        bank_name || null,
        notes || '',
        notes || '',
        existingChequePayment.id
      );
    } else {
      // Create new realized payment in ledger so accounts reflect it immediately
      receiptNo = getReceiptNumberWithMode('cheque');
      db.prepare(`
        INSERT INTO payments (
          receipt_no, booking_id, room_id, department, payment_type, payment_mode,
          amount, cheque_no, bank_name, cheque_status, realized_at, cashier_name, notes,
          cheque_photo, split_cheque
        ) VALUES (?, ?, ?, 'hospitality', 'company_settlement', 'cheque', ?, ?, ?, 'realized', ?, ?, ?, ?, ?)
      `).run(
        receiptNo,
        booking.id,
        booking.room_id,
        chequeAmt,
        cheque_no || booking.settlement_cheque_no || booking.advance_cheque_no || null,
        bank_name || booking.settlement_cheque_bank || booking.advance_cheque_bank || null,
        now,
        cleanCashier,
        notes || `Cheque passed and realized for ${booking.btc_company_name ? 'Company: ' + booking.btc_company_name : 'Room ' + booking.room_id} (${booking.guest_name || 'Guest'})`,
        booking.settlement_cheque_photo || booking.cheque_photo || null,
        chequeAmt
      );
    }

    // Update all linked bookings: mark payment_status = 'settled', advance_cheque_status = 'realized', final_settlement_mode = 'cheque'
    for (const bId of bookingIds) {
      db.prepare(`
        UPDATE bookings 
        SET 
          payment_status = 'settled',
          advance_cheque_status = 'realized',
          final_settlement_mode = 'cheque',
          settlement_cheque_no = COALESCE(?, settlement_cheque_no),
          settlement_cheque_bank = COALESCE(?, settlement_cheque_bank),
          total_paid = CASE WHEN total_paid < total_room_charge THEN total_room_charge ELSE total_paid END,
          final_receipt_no = COALESCE(final_receipt_no, ?)
        WHERE id = ?
      `).run(
        cheque_no || null,
        bank_name || null,
        receiptNo || null,
        bId
      );
    }

    res.json({
      success: true,
      message: `Cheque passed successfully! ₹${chequeAmt.toLocaleString('en-IN')} added to hotel accounts.`,
      booking_id: booking.id,
      amount: chequeAmt,
      cheque_status: 'realized',
      payment_status: 'settled',
      receipt_no: receiptNo
    });
  } catch (err) {
    console.error('Pass cheque error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to Upload / Scan Cheque Photo
app.post(['/api/bookings/:id/cheque-photo', '/api/hospitality/history/:id/cheque-photo'], requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { cheque_photo, cheque_no, bank_name } = req.body;
    if (!cheque_photo) {
      return res.status(400).json({ success: false, error: 'Cheque photo is required' });
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    db.prepare(`
      UPDATE bookings 
      SET 
        cheque_photo = ?,
        settlement_cheque_photo = ?,
        settlement_cheque_no = COALESCE(?, settlement_cheque_no),
        settlement_cheque_bank = COALESCE(?, settlement_cheque_bank),
        advance_cheque_no = COALESCE(?, advance_cheque_no),
        advance_cheque_bank = COALESCE(?, advance_cheque_bank)
      WHERE id = ?
    `).run(
      cheque_photo,
      cheque_photo,
      cheque_no || null,
      bank_name || null,
      cheque_no || null,
      bank_name || null,
      id
    );

    // Also update any payments for this booking
    db.prepare(`
      UPDATE payments 
      SET 
        cheque_photo = ?,
        cheque_no = COALESCE(?, cheque_no),
        bank_name = COALESCE(?, bank_name)
      WHERE booking_id = ? AND (payment_mode = 'cheque' OR split_cheque > 0 OR cheque_no IS NOT NULL)
    `).run(cheque_photo, cheque_no || null, bank_name || null, id);

    res.json({
      success: true,
      message: 'Cheque scanned and attached successfully',
      cheque_photo
    });
  } catch (err) {
    console.error('Update cheque photo error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to mark Cheque as Bounced and log audit trail
app.post(['/api/bookings/:id/bounce-cheque', '/api/hospitality/history/:id/bounce-cheque'], requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { cashier_name, reason } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const cleanCashier = (cashier_name || req.user?.full_name || req.user?.username || 'Accounts Staff').trim();
    const now = new Date().toISOString();
    const oldCheque = booking.settlement_cheque_no || booking.advance_cheque_no || 'Cheque';

    // Mark previous cheque payments as bounced in ledger
    db.prepare(`
      UPDATE payments 
      SET cheque_status = 'bounced', notes = notes || ' [BOUNCED]'
      WHERE booking_id = ? AND (payment_mode = 'cheque' OR split_cheque > 0 OR cheque_no IS NOT NULL)
    `).run(id);

    let logs = [];
    try {
      logs = booking.extension_logs_json ? JSON.parse(booking.extension_logs_json) : [];
    } catch (_) { logs = []; }
    if (!Array.isArray(logs)) logs = [];

    const logEntry = {
      id: Date.now(),
      type: 'cheque_bounced',
      action: 'Cheque Bounced',
      cheque_no: oldCheque,
      bank_name: booking.settlement_cheque_bank || booking.advance_cheque_bank || '',
      amount: booking.total_room_charge || 0,
      changed_by: cleanCashier,
      timestamp: now,
      note: reason || `Cheque #${oldCheque} bounced / dishonored.`
    };
    logs.push(logEntry);

    db.prepare(`
      UPDATE bookings 
      SET 
        payment_status = 'pending_from_company',
        advance_cheque_status = 'bounced',
        extension_logs_json = ?
      WHERE id = ?
    `).run(JSON.stringify(logs), id);

    res.json({
      success: true,
      message: `Cheque #${oldCheque} marked as bounced`,
      log: logEntry
    });
  } catch (err) {
    console.error('Bounce cheque error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to change payment method after bounced cheque or resettle
app.post(['/api/bookings/:id/change-payment-method', '/api/hospitality/history/:id/change-payment-method'], requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const { new_mode, amount, reference_no, cashier_name, reason, cheque_no, bank_name } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const cleanMode = (new_mode || 'cash').toLowerCase();
    const cleanAmount = parseFloat(amount) || booking.total_room_charge || 0;
    const cleanCashier = (cashier_name || req.user?.full_name || req.user?.username || 'Accounts Staff').trim();
    const now = new Date().toISOString();

    // Mark previous cheque payments as bounced if not yet marked
    db.prepare(`
      UPDATE payments 
      SET cheque_status = 'bounced' 
      WHERE booking_id = ? AND (payment_mode = 'cheque' OR cheque_no IS NOT NULL) AND cheque_status != 'realized'
    `).run(id);

    const receiptNo = getReceiptNumberWithMode(cleanMode);

    // Insert new payment transaction in ledger
    db.prepare(`
      INSERT INTO payments (
        receipt_no, booking_id, room_id, department, payment_type, payment_mode,
        amount, cheque_no, bank_name, cheque_status, realized_at, cashier_name, notes,
        transaction_id
      ) VALUES (?, ?, ?, 'hospitality', 'resettle_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receiptNo,
      booking.id,
      booking.room_id,
      cleanMode,
      cleanAmount,
      cheque_no || null,
      bank_name || null,
      cleanMode === 'cheque' ? 'pending' : 'realized',
      cleanMode === 'cheque' ? null : now,
      cleanCashier,
      reason || `Payment method changed to ${cleanMode.toUpperCase()} (prev cheque bounced)`,
      reference_no || null
    );

    let logs = [];
    try {
      logs = booking.extension_logs_json ? JSON.parse(booking.extension_logs_json) : [];
    } catch (_) { logs = []; }
    if (!Array.isArray(logs)) logs = [];

    const oldCheque = booking.settlement_cheque_no || booking.advance_cheque_no || 'Cheque';
    const logEntry = {
      id: Date.now(),
      type: 'payment_method_changed',
      action: 'Payment Method Changed',
      from_mode: 'cheque',
      to_mode: cleanMode,
      old_cheque_no: oldCheque,
      reference_no: reference_no || null,
      amount: cleanAmount,
      receipt_no: receiptNo,
      changed_by: cleanCashier,
      timestamp: now,
      note: reason || `Cheque #${oldCheque} bounced. Payment method changed to ${cleanMode.toUpperCase()} (${reference_no || 'Receipt: ' + receiptNo})`
    };
    logs.push(logEntry);

    db.prepare(`
      UPDATE bookings 
      SET 
        payment_status = ?,
        final_settlement_mode = ?,
        final_receipt_no = ?,
        transaction_id = ?,
        advance_cheque_status = ?,
        settlement_cheque_no = CASE WHEN ? = 'cheque' THEN ? ELSE settlement_cheque_no END,
        settlement_cheque_bank = CASE WHEN ? = 'cheque' THEN ? ELSE settlement_cheque_bank END,
        total_paid = total_room_charge,
        extension_logs_json = ?
      WHERE id = ?
    `).run(
      cleanMode === 'cheque' ? 'pending_from_company' : 'settled',
      cleanMode,
      receiptNo,
      reference_no || null,
      cleanMode === 'cheque' ? 'pending' : 'bounced',
      cleanMode,
      cheque_no || null,
      cleanMode,
      bank_name || null,
      JSON.stringify(logs),
      id
    );

    res.json({
      success: true,
      message: `Payment method changed to ${cleanMode.toUpperCase()}`,
      log: logEntry,
      receipt_no: receiptNo
    });
  } catch (err) {
    console.error('Change payment method error:', err);
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
    const { category, purpose, startDate, endDate, date } = req.query;
    let query = 'SELECT * FROM expenses';
    const params = [];
    const conditions = [];

    if (category && category !== 'all') {
      conditions.push('category = ?');
      params.push(category);
    }

    if (purpose && purpose !== 'all') {
      conditions.push('(purpose_child = ? OR purpose_category = ? OR purpose_details LIKE ?)');
      params.push(purpose, purpose, `%${purpose}%`);
    }

    if (date) {
      conditions.push("DATE(created_at, 'localtime') = ?");
      params.push(date);
    } else {
      if (startDate) {
        conditions.push("DATE(created_at, 'localtime') >= ?");
        params.push(startDate);
      }
      if (endDate) {
        conditions.push("DATE(created_at, 'localtime') <= ?");
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

// Point 12: Get & Update Debit / Expense Categories & Owners Config
app.get('/api/expense-categories-config', (req, res) => {
  try {
    const catRow = db.prepare("SELECT value FROM system_settings WHERE key = 'expense_categories_config'").get();
    const ownerRow = db.prepare("SELECT value FROM system_settings WHERE key = 'expense_owners_config'").get();

    const fallbackCategories = [
      {
        id: 'owner',
        name: 'Owner Expenses',
        purposes: ['Travel', 'Fuel Vehical', 'Personal', 'Medince', 'Other']
      },
      {
        id: 'store',
        name: 'Store Expenses',
        purposes: ['Market', 'Milk', 'Fuel Hotel', 'Transport Expensess Store', 'Home', 'Fuel DG', 'Other']
      },
      {
        id: 'maintenance',
        name: 'Maintainance Expenses',
        purposes: ['Purchase or material', 'AMC', 'Carpenter', 'Plumber', 'Water Heater', 'AC', 'DG', 'colouring painter', 'POP', 'Civil Work', 'Other']
      },
      {
        id: 'other',
        name: 'Other',
        purposes: ['Other']
      }
    ];

    const fallbackOwners = [
      { id: '1', name: 'Jaijeet Gadekar', phone: '' },
      { id: '2', name: 'Respected Mahesh Sir', phone: '' }
    ];

    let categories = fallbackCategories;
    if (catRow && catRow.value) {
      try { categories = JSON.parse(catRow.value); } catch (e) {}
    }

    let owners = fallbackOwners;
    if (ownerRow && ownerRow.value) {
      try { owners = JSON.parse(ownerRow.value); } catch (e) {}
    }

    res.json({ success: true, categories, owners });
  } catch (err) {
    console.error('Error fetching expense categories config:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expense-categories-config', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { categories, owners } = req.body;
    if (Array.isArray(categories)) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('expense_categories_config', ?, CURRENT_TIMESTAMP)").run(
        JSON.stringify(categories)
      );
    }
    if (Array.isArray(owners)) {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('expense_owners_config', ?, CURRENT_TIMESTAMP)").run(
        JSON.stringify(owners)
      );
    }
    res.json({ success: true, message: 'Debit categories and owners updated successfully' });
  } catch (err) {
    console.error('Error updating expense categories config:', err);
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
      purpose_category,
      purpose_child,
      owner_name,
      owner_phone,
      title,
      notes,
      room_id,
      booking_id,
      cashier_name,
      logged_by,
      cheque_no,
      bank_name,
      cheque_photo,
      bill_scan_photo
    } = req.body;

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid expense amount is required' });
    }
    const cleanPaidTo = (paid_to || req.body.paidTo || (owner_name ? owner_name : 'Bearer / Vendor')).trim();
    const cleanPurpose = (purpose_details || req.body.description || purpose_child || title || notes || 'General Expense').trim();

    const cleanCategory = (category || purpose_category || 'other').trim();

    const voucherNo = getNextPettyCashVoucherNumber();
    const cleanCashier = (cashier_name || req.body.cashier || logged_by || req.user?.username || 'Front Desk').trim();
    const cleanDebitAc = (debit_account || req.body.debitAccount || (cleanCategory.toLowerCase() === 'owner' ? `Owner: ${owner_name || cleanPaidTo}` : (cleanCategory.toLowerCase() === 'refund' ? 'Guest Refund' : (cleanCategory.toLowerCase() === 'store' ? 'Store Expenses' : (cleanCategory.toLowerCase() === 'maintenance' ? 'Maintainance Expenses' : 'General Expenses A/c'))))).trim();
    
    // Point 13: Only cash in expenses (refunds can also be cheque)
    const cleanMode = cleanCategory === 'refund'
      ? (payment_mode || 'cash').toLowerCase()
      : 'cash';
    const cleanChequeNo = (cheque_no || req.body.chequeNo || req.body.cheque_number || req.body.utr_number || req.body.utr || '').trim();
    const cleanBankName = (bank_name || req.body.bankName || req.body.bank || '').trim();
    const cleanChequePhoto = cheque_photo || req.body.chequePhoto || null;
    const cleanBillPhoto = bill_scan_photo || req.body.billScanPhoto || null;
    const cleanOwner = owner_name || (cleanCategory === 'owner' ? cleanPaidTo : null);
    const cleanOwnerPhone = (owner_phone || req.body.ownerPhone || '').trim();

    const result = db.prepare(`
      INSERT INTO expenses (
        voucher_no, category, paid_to, amount, payment_mode, debit_account,
        purpose_details, purpose_category, purpose_child, owner_name, owner_phone,
        original_amount, actual_used_amount, returned_amount, bill_scan_photo,
        cheque_photo, room_id, booking_id, cashier_name, cheque_no, bank_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      voucherNo,
      cleanCategory,
      cleanPaidTo,
      numAmount,
      cleanMode,
      cleanDebitAc,
      cleanPurpose,
      purpose_category || cleanCategory,
      purpose_child || null,
      cleanOwner,
      cleanOwnerPhone || null,
      numAmount,
      numAmount,
      0,
      cleanBillPhoto,
      cleanChequePhoto,
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

// Point 13: Adjust Expense with actual used amount, remainder returned amount & scanned bill copy
app.post('/api/expenses/:id/adjust', requireAuth, requireRole('manager', 'hospitality'), (req, res) => {
  try {
    const { id } = req.params;
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!expense) {
      return res.status(404).json({ success: false, error: 'Expense voucher not found' });
    }

    const { actual_used_amount, returned_amount, bill_scan_photo, notes } = req.body;
    const actualUsed = parseFloat(actual_used_amount);
    const returned = parseFloat(returned_amount) || 0;

    if (isNaN(actualUsed) || actualUsed < 0) {
      return res.status(400).json({ success: false, error: 'Valid actual used amount is required' });
    }

    const originalAmount = expense.original_amount !== null && expense.original_amount !== undefined
      ? expense.original_amount
      : expense.amount;

    db.prepare(`
      UPDATE expenses
      SET original_amount = ?,
          amount = ?,
          actual_used_amount = ?,
          returned_amount = ?,
          bill_scan_photo = COALESCE(?, bill_scan_photo),
          purpose_details = CASE WHEN ? THEN purpose_details || ' [Adj: ' || ? || ']' ELSE purpose_details END
      WHERE id = ?
    `).run(
      originalAmount,
      actualUsed,
      actualUsed,
      returned,
      bill_scan_photo || null,
      notes ? 1 : 0,
      notes || '',
      id
    );

    const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    res.json({
      success: true,
      expense: updated,
      message: `Expense adjusted: Original ₹${originalAmount}, Used ₹${actualUsed}, Returned ₹${returned}`
    });
  } catch (err) {
    console.error('Expense adjustment error:', err);
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

    // 7. Expenses by Category (100% accurate: uses COALESCE(actual_used_amount, amount) for adjusted vouchers)
    const expStats = db.prepare(`
      SELECT 
        COALESCE(SUM(COALESCE(actual_used_amount, amount)), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN LOWER(payment_mode) = 'cash' THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as cash_expenses,
        COALESCE(SUM(CASE WHEN LOWER(category) IN ('owner', 'owner expenses', 'owner drawings', 'owner withdrawal') THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as owner_drawings,
        COALESCE(SUM(CASE WHEN LOWER(category) IN ('refund', 'guest refund', 'refunds') THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as refunds,
        COALESCE(SUM(CASE WHEN LOWER(category) IN ('store', 'store expenses', 'store / pantry', 'store_pantry') THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as store_pantry,
        COALESCE(SUM(CASE WHEN LOWER(category) IN ('maintenance', 'maintainance expenses', 'maintenance expenses', 'repairs & maintenance', 'repairs') THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as maintenance,
        COALESCE(SUM(CASE WHEN LOWER(category) NOT IN ('owner', 'owner expenses', 'owner drawings', 'owner withdrawal', 'refund', 'guest refund', 'refunds', 'store', 'store expenses', 'store / pantry', 'store_pantry', 'maintenance', 'maintainance expenses', 'maintenance expenses', 'repairs & maintenance', 'repairs') THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as other_expenses,
        COALESCE(SUM(CASE WHEN LOWER(payment_mode) IN ('online', 'upi', 'bank_transfer', 'card') THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as online_expenses,
        COALESCE(SUM(CASE WHEN LOWER(payment_mode) = 'cheque' THEN COALESCE(actual_used_amount, amount) ELSE 0 END), 0) as cheque_expenses
      FROM expenses 
      ${dateFilterExp}
    `).get(...dateParams);

    // 7b. Itemized Expenses List for Daily Closing Audit
    const expList = db.prepare(`
      SELECT 
        id, 
        voucher_no, 
        category, 
        COALESCE(actual_used_amount, amount) as amount,
        original_amount,
        actual_used_amount,
        returned_amount,
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

    if (!isBar) {
      try {
        db.prepare("UPDATE room_visitors SET breakfast_status = 'paid' WHERE fnb_order_id = ?").run(orderId);
      } catch (_) {}
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

function mountStaticDist() {
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, {
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    }));
  }
  // Direct Screen Routes for Multi-Screen setups (serving React app)
  app.get(['/', '/hospitality', '/restaurant', '/bar', '/manage', '/expenses', '/accounting'], (req, res) => {
    const indexPath = fs.existsSync(path.join(distDir, 'index.html'))
      ? path.join(distDir, 'index.html')
      : path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
  });
}


async function startServer() {
  const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
  const isDev = process.env.VITE_DEV === '1' || (process.env.NODE_ENV === 'development' && !hasDist);

  if (isDev && fs.existsSync(path.join(__dirname, 'src'))) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
        root: __dirname
      });
      app.use(vite.middlewares);
      console.log(`⚡ Vite Live Dev Server active: Serving directly from /src with instant HMR`);
    } catch (viteErr) {
      console.warn('⚠️ Could not start Vite dev middleware, serving dist folder:', viteErr.message);
      mountStaticDist();
    }
  } else {
    mountStaticDist();
  }

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

if (require.main === module && !process.env.NETLIFY) {
  startServer();
}

module.exports = app;
