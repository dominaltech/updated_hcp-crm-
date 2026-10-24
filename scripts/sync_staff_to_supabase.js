/**
 * scripts/sync_staff_to_supabase.js
 * 
 * Synchronizes all staff accounts and credentials from local SQLite `staff_users`
 * to the dedicated `staff_users` table in Supabase Cloud.
 */

const { createClient } = require('@supabase/supabase-js');
const db = require('../database');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
let supabaseUrl = process.env.SUPABASE_URL || 'https://hlwmsllmqfdxfmqulrat.supabase.co';
let supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MzgsImV4cCI6MjEwNTMxMzgzOH0.r7Nb8rEJTrZvprpf4G023nMY0suq2OqVGetG0I8esjk';

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (k === 'SUPABASE_URL') supabaseUrl = v;
        if (k === 'SUPABASE_ANON_KEY') supabaseAnonKey = v;
      }
    }
  });
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function syncStaff() {
  console.log('\n=============================================================');
  console.log('   SYNC LOCAL STAFF USERS TO SUPABASE DEDICATED TABLE        ');
  console.log('=============================================================\n');

  // 1. Fetch all local staff
  const staff = db.prepare(`
    SELECT id, username, password, full_name, role, phone, status, can_access_manager 
    FROM staff_users
  `).all();

  console.log(`📋 Found ${staff.length} staff accounts in local SQLite:`);
  console.table(staff.map(s => ({
    id: s.id,
    username: s.username,
    name: s.full_name,
    role: s.role,
    status: s.status,
    hasPassword: Boolean(s.password)
  })));

  // 2. Check if staff_users table exists in Supabase
  const { data: testCheck, error: checkErr } = await supabase.from('staff_users').select('id').limit(1);
  if (checkErr && checkErr.message.includes('schema cache')) {
    console.error('\n⚠️ Supabase table "staff_users" does not exist yet!');
    console.log('\nPlease run the following SQL query in your Supabase Dashboard SQL Editor:');
    console.log('-------------------------------------------------------------');
    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261023104500_create_staff_users.sql');
    if (fs.existsSync(sqlPath)) {
      console.log(fs.readFileSync(sqlPath, 'utf8'));
    }
    console.log('-------------------------------------------------------------\n');
    return false;
  }

  // 3. Upsert each staff record
  console.log('🚀 Upserting staff records to Supabase staff_users table...');
  let successCount = 0;
  for (const s of staff) {
    const payload = {
      id: s.id,
      username: s.username,
      password: s.password,
      full_name: s.full_name,
      role: s.role,
      phone: s.phone || '',
      status: s.status || 'active',
      can_access_manager: s.can_access_manager || 0,
      updated_at: new Date().toISOString()
    };

    const { error: upsertErr } = await supabase
      .from('staff_users')
      .upsert(payload, { onConflict: 'username' });

    if (upsertErr) {
      console.error(`❌ Failed to sync ${s.username}:`, upsertErr.message);
    } else {
      console.log(`✅ Synced ${s.username} (${s.role})`);
      successCount++;
    }
  }

  console.log(`\n🎉 Successfully synced ${successCount}/${staff.length} staff users to Supabase!`);
  return true;
}

if (require.main === module) {
  syncStaff().catch(err => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  });
}

module.exports = { syncStaff };
