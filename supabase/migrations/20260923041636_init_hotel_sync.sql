-- ============================================================================
-- HOTEL CITY PARK CRM - LIGHTWEIGHT CROSS-DEVICE CONNECTIVITY SCHEMA
-- ============================================================================

-- 1. Active Occupancies (Live Room Directory for POS / Bar / Reception)
CREATE TABLE IF NOT EXISTS active_occupancies (
  room_number TEXT PRIMARY KEY,
  room_id INTEGER,
  room_type TEXT,
  guest_name TEXT NOT NULL,
  guest_mobile TEXT,
  booking_id INTEGER,
  checkin_time TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for instant lookup
CREATE INDEX IF NOT EXISTS idx_active_occupancies_room_id ON active_occupancies(room_id);
CREATE INDEX IF NOT EXISTS idx_active_occupancies_booking_id ON active_occupancies(booking_id);

-- Enable Row Level Security (RLS)
ALTER TABLE active_occupancies ENABLE ROW LEVEL SECURITY;

-- Open policies for hotel staff devices using anon key
DROP POLICY IF EXISTS "Allow select active_occupancies" ON active_occupancies;
CREATE POLICY "Allow select active_occupancies" ON active_occupancies FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert active_occupancies" ON active_occupancies;
CREATE POLICY "Allow insert active_occupancies" ON active_occupancies FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update active_occupancies" ON active_occupancies;
CREATE POLICY "Allow update active_occupancies" ON active_occupancies FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow delete active_occupancies" ON active_occupancies;
CREATE POLICY "Allow delete active_occupancies" ON active_occupancies FOR DELETE USING (true);


-- 2. Room Charges Inbox (Inter-department Bill Transfer Queue)
CREATE TABLE IF NOT EXISTS room_charges_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number TEXT NOT NULL,
  room_id INTEGER,
  department TEXT NOT NULL, -- 'restaurant' | 'bar'
  order_id INTEGER,
  bill_no TEXT,
  subtotal NUMERIC DEFAULT 0,
  gst NUMERIC DEFAULT 0,
  grand_total NUMERIC NOT NULL,
  items_summary TEXT,
  settled_by TEXT,
  status TEXT DEFAULT 'pending', -- 'pending' | 'imported'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for instant queue lookup
CREATE INDEX IF NOT EXISTS idx_room_charges_inbox_room_number ON room_charges_inbox(room_number);
CREATE INDEX IF NOT EXISTS idx_room_charges_inbox_status ON room_charges_inbox(status);
CREATE INDEX IF NOT EXISTS idx_room_charges_inbox_created_at ON room_charges_inbox(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE room_charges_inbox ENABLE ROW LEVEL SECURITY;

-- Open policies for hotel staff devices using anon key
DROP POLICY IF EXISTS "Allow select room_charges_inbox" ON room_charges_inbox;
CREATE POLICY "Allow select room_charges_inbox" ON room_charges_inbox FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert room_charges_inbox" ON room_charges_inbox;
CREATE POLICY "Allow insert room_charges_inbox" ON room_charges_inbox FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update room_charges_inbox" ON room_charges_inbox;
CREATE POLICY "Allow update room_charges_inbox" ON room_charges_inbox FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow delete room_charges_inbox" ON room_charges_inbox;
CREATE POLICY "Allow delete room_charges_inbox" ON room_charges_inbox FOR DELETE USING (true);
