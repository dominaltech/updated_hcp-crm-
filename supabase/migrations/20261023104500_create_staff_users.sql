-- ============================================================================
-- HOTEL CITY PARK CRM - DEDICATED STAFF & CREDENTIALS TABLE IN SUPABASE
-- ============================================================================

-- 1. Create dedicated staff_users table
CREATE TABLE IF NOT EXISTS staff_users (
  id BIGINT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'hospitality', -- 'manager', 'restaurant', 'waiter', 'bar', 'hospitality'
  pin TEXT,                                 -- Quick-tap 4-digit PIN for tablet login
  phone TEXT,
  status TEXT DEFAULT 'active',             -- 'active', 'inactive'
  can_access_manager INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes for high-speed login lookups
CREATE INDEX IF NOT EXISTS idx_staff_users_username ON staff_users(username);
CREATE INDEX IF NOT EXISTS idx_staff_users_role ON staff_users(role);
CREATE INDEX IF NOT EXISTS idx_staff_users_status ON staff_users(status);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;

-- 4. Open policies for staff login / sync using anon key
DROP POLICY IF EXISTS "Allow select staff_users" ON staff_users;
CREATE POLICY "Allow select staff_users" ON staff_users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert staff_users" ON staff_users;
CREATE POLICY "Allow insert staff_users" ON staff_users FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update staff_users" ON staff_users;
CREATE POLICY "Allow update staff_users" ON staff_users FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow delete staff_users" ON staff_users;
CREATE POLICY "Allow delete staff_users" ON staff_users FOR DELETE USING (true);
