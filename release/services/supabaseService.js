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

/**
 * Upserts a live occupied room into Supabase active_occupancies.
 */
async function syncActiveOccupancy(data) {
  if (!supabase || !data || !data.room_number) return null;
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

    const { data: result, error } = await supabase
      .from('active_occupancies')
      .upsert(payload, { onConflict: 'room_number' })
      .select();

    if (error) {
      console.warn(`[Supabase] syncActiveOccupancy notice for Room ${data.room_number}:`, error.message);
      return null;
    }
    return result;
  } catch (err) {
    console.warn(`[Supabase] syncActiveOccupancy network notice:`, err.message);
    return null;
  }
}

/**
 * Removes a checked-out room from Supabase active_occupancies.
 */
async function removeActiveOccupancy(roomNumber) {
  if (!supabase || !roomNumber) return false;
  try {
    const { error } = await supabase
      .from('active_occupancies')
      .delete()
      .eq('room_number', String(roomNumber));

    if (error) {
      console.warn(`[Supabase] removeActiveOccupancy notice for Room ${roomNumber}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[Supabase] removeActiveOccupancy network notice:`, err.message);
    return false;
  }
}

/**
 * Pushes an F&B bill settled to room folio into Supabase room_charges_inbox.
 */
async function pushRoomCharge(charge) {
  if (!supabase || !charge || !charge.room_number) return null;
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

    const { data: result, error } = await supabase
      .from('room_charges_inbox')
      .insert(payload)
      .select();

    if (error) {
      console.warn(`[Supabase] pushRoomCharge notice for Room ${charge.room_number}:`, error.message);
      return null;
    }
    return result;
  } catch (err) {
    console.warn(`[Supabase] pushRoomCharge network notice:`, err.message);
    return null;
  }
}

/**
 * Fetches all currently occupied rooms from Supabase active_occupancies.
 * Used by Restaurant and Bar POS running on separate PCs to populate room dropdowns.
 */
async function fetchActiveOccupancies() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('active_occupancies')
      .select('*')
      .order('room_number', { ascending: true });

    if (error) {
      console.warn('[Supabase] fetchActiveOccupancies notice:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[Supabase] fetchActiveOccupancies network notice:', err.message);
    return [];
  }
}

/**
 * Fetches pending F&B charges for a specific room from Supabase room_charges_inbox.
 * Used by Front Desk checkout folio to absorb charges from separate POS PCs.
 */
async function fetchPendingRoomCharges(roomNumber) {
  if (!supabase || !roomNumber) return [];
  try {
    const { data, error } = await supabase
      .from('room_charges_inbox')
      .select('*')
      .eq('room_number', String(roomNumber))
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.warn(`[Supabase] fetchPendingRoomCharges notice for Room ${roomNumber}:`, error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`[Supabase] fetchPendingRoomCharges network notice:`, err.message);
    return [];
  }
}

/**
 * Marks imported room charges as completed in Supabase.
 */
async function markChargesImported(chargeIds) {
  if (!supabase || !Array.isArray(chargeIds) || chargeIds.length === 0) return false;
  try {
    const { error } = await supabase
      .from('room_charges_inbox')
      .update({ status: 'imported' })
      .in('id', chargeIds);

    if (error) {
      console.warn('[Supabase] markChargesImported notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] markChargesImported network notice:', err.message);
    return false;
  }
}

/**
 * Synchronizes all currently occupied rooms from local SQLite database to Supabase.
 * Runs non-blocking on server startup or on demand.
 */
async function syncAllActiveRoomsFromLocal(localDb) {
  if (!supabase || !localDb) return;
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
  isConfigured: () => Boolean(supabase)
};
