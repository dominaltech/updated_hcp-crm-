/**
 * Supabase Cloud Sync Service for Hotel City Park CRM
 * Provides lightweight, non-blocking cross-device synchronization:
 * 1. Live Active Occupancies (Room #, Guest Name, Mobile) for Restaurant & Bar POS
 * 2. Room Charges Queue (F&B bills charged to room folio from separate counter PCs)
 * 
 * FAIL-SAFE GUARANTEE:
 * All cloud calls are completely non-blocking and wrapped in try/catch.
 * If internet drops or Supabase is unreachable, local SQLite operations
 * continue 100% uninterrupted without errors or delays.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hlwmsllmqfdxfmqulrat.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

let supabase = null;

try {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
  }
} catch (err) {
  console.warn('[Supabase] Initialization warning:', err.message);
}

// Resilient Offline Protection & Circuit Breaker
const REQUEST_TIMEOUT_MS = 1000; // 1 second max for any cloud call
const OFFLINE_COOLDOWN_MS = 15000; // 15 seconds cooldown before retrying cloud if network dropped

let isOffline = false;
let lastOfflineTime = 0;

function withTimeout(thenable, ms = REQUEST_TIMEOUT_MS) {
  let timeoutId;
  let isDone = false;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        reject(new Error('Supabase request timeout'));
      }
    }, ms);
  });

  const nativePromise = Promise.resolve(thenable).then(
    res => {
      isDone = true;
      clearTimeout(timeoutId);
      return res;
    },
    err => {
      isDone = true;
      clearTimeout(timeoutId);
      throw err;
    }
  );

  // Prevent unhandled rejection if timeoutPromise triggers first
  nativePromise.catch(() => {});

  return Promise.race([nativePromise, timeoutPromise]);
}

function markNetworkFailure(err) {
  isOffline = true;
  lastOfflineTime = Date.now();
  console.warn(`[Supabase] Offline mode engaged: ${err?.message || err}`);
}

function markNetworkSuccess() {
  isOffline = false;
}

function canAttemptCloud() {
  if (!supabase) return false;
  if (isOffline && (Date.now() - lastOfflineTime < OFFLINE_COOLDOWN_MS)) {
    return false; // Fast return 0ms when offline
  }
  return true;
}

/**
 * Upserts a live occupied room into Supabase active_occupancies.
 */
async function syncActiveOccupancy(data) {
  if (!canAttemptCloud() || !data || !data.room_number) return null;
  try {
    const payload = {
      room_number: String(data.room_number),
      room_id: data.room_id || null,
      room_type: data.room_type || 'Standard',
      guest_name: String(data.guest_name || 'In-House Guest').trim(),
      guest_mobile: data.guest_mobile ? String(data.guest_mobile).trim() : null,
      booking_id: data.booking_id || null,
      checkin_time: data.checkin_time || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: result, error } = await withTimeout(
      supabase
        .from('active_occupancies')
        .upsert(payload, { onConflict: 'room_number' })
        .select(),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] syncActiveOccupancy notice for Room ${data.room_number}:`, error.message);
      return null;
    }
    markNetworkSuccess();
    return result;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

/**
 * Removes a checked-out room from Supabase active_occupancies.
 */
async function removeActiveOccupancy(roomNumber) {
  if (!canAttemptCloud() || !roomNumber) return false;
  try {
    const { error } = await withTimeout(
      supabase
        .from('active_occupancies')
        .delete()
        .eq('room_number', String(roomNumber)),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] removeActiveOccupancy notice for Room ${roomNumber}:`, error.message);
      return false;
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

/**
 * Pushes an F&B bill settled to room folio into Supabase room_charges_inbox.
 */
async function pushRoomCharge(charge) {
  if (!canAttemptCloud() || !charge || !charge.room_number) return null;
  try {
    const payload = {
      room_number: String(charge.room_number),
      room_id: charge.room_id || null,
      department: charge.department || 'restaurant',
      order_id: charge.order_id || null,
      bill_no: charge.bill_no ? String(charge.bill_no) : null,
      subtotal: parseFloat(charge.subtotal) || 0,
      gst: parseFloat(charge.gst) || 0,
      grand_total: parseFloat(charge.grand_total) || 0,
      items_summary: charge.items_summary ? String(charge.items_summary).slice(0, 500) : '',
      settled_by: charge.settled_by || 'Cashier',
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { data: result, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .insert(payload)
        .select(),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] pushRoomCharge notice for Room ${charge.room_number}:`, error.message);
      return null;
    }
    markNetworkSuccess();
    return result;
  } catch (err) {
    markNetworkFailure(err);
    return null;
  }
}

/**
 * Fetches all currently occupied rooms from Supabase active_occupancies.
 * Used by Restaurant and Bar POS running on separate PCs to populate room dropdowns.
 */
async function fetchActiveOccupancies() {
  if (!canAttemptCloud()) return [];
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('active_occupancies')
        .select('*')
        .order('room_number', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn('[Supabase] fetchActiveOccupancies notice:', error.message);
      return [];
    }
    markNetworkSuccess();
    return data || [];
  } catch (err) {
    markNetworkFailure(err);
    return [];
  }
}

/**
 * Fetches pending F&B charges for a specific room from Supabase room_charges_inbox.
 * Used by Front Desk checkout folio to absorb charges from separate POS PCs.
 */
async function fetchPendingRoomCharges(roomNumber) {
  if (!canAttemptCloud() || !roomNumber) return [];
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .select('*')
        .eq('room_number', String(roomNumber))
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn(`[Supabase] fetchPendingRoomCharges notice for Room ${roomNumber}:`, error.message);
      return [];
    }
    markNetworkSuccess();
    return data || [];
  } catch (err) {
    markNetworkFailure(err);
    return [];
  }
}

/**
 * Marks imported room charges as completed in Supabase.
 */
async function markChargesImported(chargeIds) {
  if (!canAttemptCloud() || !Array.isArray(chargeIds) || chargeIds.length === 0) return false;
  try {
    const { error } = await withTimeout(
      supabase
        .from('room_charges_inbox')
        .update({ status: 'imported' })
        .in('id', chargeIds),
      REQUEST_TIMEOUT_MS
    );

    if (error) {
      console.warn('[Supabase] markChargesImported notice:', error.message);
      return false;
    }
    markNetworkSuccess();
    return true;
  } catch (err) {
    markNetworkFailure(err);
    return false;
  }
}

/**
 * Synchronizes all currently occupied rooms from local SQLite database to Supabase.
 * Runs non-blocking on server startup or on demand.
 */
async function syncAllActiveRoomsFromLocal(localDb) {
  if (!canAttemptCloud() || !localDb) return;
  try {
    const activeBookings = localDb.prepare(`
      SELECT 
        b.id as booking_id,
        b.room_id,
        r.room_number,
        r.room_type,
        g.name as guest_name,
        g.mobile as guest_mobile,
        b.checkin_time
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      JOIN guests g ON b.guest_id = g.id
      WHERE b.status = 'active'
    `).all();

    if (!activeBookings || activeBookings.length === 0) return;

    for (const b of activeBookings) {
      if (!canAttemptCloud()) break; // Exit immediately if offline circuit breaker tripped
      await syncActiveOccupancy({
        room_number: b.room_number,
        room_id: b.room_id,
        room_type: b.room_type,
        guest_name: b.guest_name,
        guest_mobile: b.guest_mobile,
        booking_id: b.booking_id,
        checkin_time: b.checkin_time
      });
    }
    console.log(`[Supabase] Synced ${activeBookings.length} active room(s) to cloud directory.`);
  } catch (err) {
    console.warn('[Supabase] Startup sync notice:', err.message);
  }
}

module.exports = {
  syncActiveOccupancy,
  removeActiveOccupancy,
  pushRoomCharge,
  fetchActiveOccupancies,
  fetchPendingRoomCharges,
  markChargesImported,
  syncAllActiveRoomsFromLocal,
  isConfigured: () => Boolean(supabase),
  isOfflineMode: () => isOffline && (Date.now() - lastOfflineTime < OFFLINE_COOLDOWN_MS)
};
