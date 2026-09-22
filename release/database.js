const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

let dbPath = path.join(__dirname, 'hotel_city_park.db');

// In Netlify / Lambda serverless environment:
// 1. Root filesystem is read-only -> Copy initial DB to /tmp
// 2. /tmp does NOT support POSIX shared memory (mmap) -> WAL mode fails with segmentation fault / disk I/O error
//    Must ALWAYS use DELETE or TRUNCATE journal mode!
const isServerless = !!(
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.NETLIFY_LOCAL ||
  (typeof globalThis !== 'undefined' && globalThis.Netlify) ||
  (process.cwd && process.cwd().startsWith('/var/task')) ||
  __dirname.startsWith('/var/task')
);

if (isServerless) {
  const possiblePaths = [
    path.join(__dirname, 'hotel_city_park.db'),
    path.join(process.cwd(), 'hotel_city_park.db'),
    path.join(__dirname, '..', 'hotel_city_park.db'),
    path.join(__dirname, '..', '..', 'hotel_city_park.db'),
    '/var/task/hotel_city_park.db',
    '/var/task/netlify/functions/hotel_city_park.db'
  ];
  const foundSrc = possiblePaths.find(p => fs.existsSync(p));
  const tmpDbPath = '/tmp/hotel_city_park.db';

  if (foundSrc) {
    try {
      const needCopy = !fs.existsSync(tmpDbPath) || (fs.statSync(tmpDbPath).size === 0);
      if (needCopy) {
        fs.copyFileSync(foundSrc, tmpDbPath);
        try { fs.chmodSync(tmpDbPath, 0o666); } catch (e) {}
      }
    } catch (err) {
      console.warn('Could not copy db to /tmp:', err);
    }
  }

  dbPath = tmpDbPath;
}

const db = new Database(dbPath);

// Always enforce DELETE journal mode to avoid POSIX shared memory (mmap) segfaults on serverless
try {
  db.pragma('journal_mode = DELETE');
} catch (e) {
  try { db.pragma('journal_mode = TRUNCATE'); } catch (e2) {}
}

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT UNIQUE NOT NULL,
    room_type TEXT NOT NULL,
    price REAL NOT NULL,
    max_adults INTEGER NOT NULL DEFAULT 2,
    max_children INTEGER NOT NULL DEFAULT 1,
    max_discount_pct REAL NOT NULL DEFAULT 15,
    ext_grace_mins INTEGER NOT NULL DEFAULT 60,
    ext_3h_rate REAL NOT NULL DEFAULT 500,
    ext_6h_rate REAL NOT NULL DEFAULT 1000,
    ext_9h_rate REAL NOT NULL DEFAULT 1500,
    status TEXT NOT NULL DEFAULT 'ready', -- ready, occupied, needs_cleaning, maintenance
    gst_pct REAL NOT NULL DEFAULT 5,
    current_booking_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    father_name TEXT,
    mobile TEXT NOT NULL,
    email TEXT,
    address TEXT,
    dob TEXT,
    doc_type TEXT NOT NULL, -- Aadhar Card, Driving License, Passport
    doc_front TEXT, -- base64 image (compressed < 50KB)
    doc_back TEXT, -- base64 image (compressed < 50KB)
    guest_photo TEXT, -- base64 image (compressed < 50KB)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    guest_id INTEGER NOT NULL,
    adults_male INTEGER DEFAULT 1,
    adults_female INTEGER DEFAULT 0,
    adults_other INTEGER DEFAULT 0,
    children INTEGER DEFAULT 0,
    checkin_time DATETIME NOT NULL,
    approx_checkout_time DATETIME,
    actual_checkout_time DATETIME,
    room_rate REAL NOT NULL,
    discount_pct REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    total_room_charge REAL NOT NULL,
    split_cash REAL DEFAULT 0,
    split_card REAL DEFAULT 0,
    split_online REAL DEFAULT 0,
    total_paid REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'paid', -- paid, partial, pending
    status TEXT DEFAULT 'active', -- active, checked_out
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(room_id) REFERENCES rooms(id),
    FOREIGN KEY(guest_id) REFERENCES guests(id)
  );

  CREATE TABLE IF NOT EXISTS restaurant_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    room_id INTEGER DEFAULT NULL, -- NULL for walk-in, Room ID if charged to room
    customer_name TEXT,
    order_type TEXT NOT NULL DEFAULT 'walkin', -- walkin or room
    table_number TEXT,
    items_json TEXT NOT NULL,
    subtotal REAL NOT NULL,
    tax REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    payment_mode TEXT DEFAULT 'cash', -- cash, card, online, room_folio
    is_paid INTEGER DEFAULT 0,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bar_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    room_id INTEGER DEFAULT NULL, -- NULL for walk-in, Room ID if charged to room
    customer_name TEXT,
    order_type TEXT NOT NULL DEFAULT 'walkin', -- walkin or room
    bar_seat TEXT,
    items_json TEXT NOT NULL,
    subtotal REAL NOT NULL,
    tax REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    payment_mode TEXT DEFAULT 'cash', -- cash, card, online, room_folio
    is_paid INTEGER DEFAULT 0,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department TEXT NOT NULL, -- 'restaurant' or 'bar'
    category TEXT NOT NULL, -- e.g. Starters, Main Course, Cocktails, Beers, etc.
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    is_available INTEGER DEFAULT 1,
    shortcode TEXT
  );

  CREATE TABLE IF NOT EXISTS restaurant_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number TEXT UNIQUE NOT NULL,
    table_type TEXT NOT NULL DEFAULT 'dine_in', -- 'dine_in' or 'parcel'
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'available', -- 'available', 'occupied', 'billed'
    active_cart_json TEXT DEFAULT '[]',
    printed_cart_json TEXT DEFAULT '[]',
    kot_count INTEGER DEFAULT 0,
    token_number INTEGER DEFAULT 0,
    waiter_name TEXT DEFAULT '',
    special_notes TEXT DEFAULT '',
    order_started_at DATETIME DEFAULT NULL,
    is_split INTEGER DEFAULT 0,
    parent_table_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS restaurant_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bar_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number TEXT UNIQUE NOT NULL,
    table_type TEXT NOT NULL DEFAULT 'table', -- 'table', 'lounge', 'counter'
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'available', -- 'available', 'occupied', 'billed'
    active_cart_json TEXT DEFAULT '[]',
    printed_cart_json TEXT DEFAULT '[]',
    bot_count INTEGER DEFAULT 0,
    token_number INTEGER DEFAULT 0,
    waiter_name TEXT DEFAULT '',
    special_notes TEXT DEFAULT '',
    order_started_at DATETIME DEFAULT NULL,
    is_split INTEGER DEFAULT 0,
    parent_table_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bar_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bill_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    order_number TEXT NOT NULL,
    action TEXT NOT NULL, -- 'settled', 'pre_billed', 'resettled', 'cancelled'
    staff_user TEXT DEFAULT 'Manager',
    change_summary TEXT NOT NULL,
    previous_total REAL,
    new_total REAL,
    previous_items_json TEXT,
    new_items_json TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations
try { db.exec("ALTER TABLE guests ADD COLUMN email TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE menu_items ADD COLUMN shortcode TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE menu_items ADD COLUMN is_veg INTEGER DEFAULT 1;"); } catch (e) {}
try {
  db.exec(`
    UPDATE menu_items 
    SET is_veg = 0 
    WHERE LOWER(name) LIKE '%murg%' 
       OR LOWER(name) LIKE '%chicken%' 
       OR LOWER(name) LIKE '%mutton%' 
       OR LOWER(name) LIKE '%fish%' 
       OR LOWER(name) LIKE '%prawn%' 
       OR LOWER(name) LIKE '%egg%';
  `);
} catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN resettle_count INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN split_details_json TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN table_id INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN token_number INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN waiter_name TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN resettle_count INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN split_details_json TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN table_id INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN table_number TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN token_number INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN waiter_name TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN booking_id INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN booking_id INTEGER DEFAULT NULL;"); } catch (e) {}
try {
  // Backfill booking_id for orders charged to rooms that don't have booking_id set
  const unlinkedRestOrders = db.prepare(`
    SELECT id, room_id, created_at 
    FROM restaurant_orders 
    WHERE room_id IS NOT NULL AND (booking_id IS NULL OR booking_id = 0)
  `).all();
  for (const ord of unlinkedRestOrders) {
    const matchingBooking = db.prepare(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
        AND datetime(?) >= datetime(checkin_time, 'localtime')
        AND (actual_checkout_time IS NULL OR datetime(?) <= datetime(actual_checkout_time, 'localtime'))
      ORDER BY id DESC LIMIT 1
    `).get(ord.room_id, ord.created_at, ord.created_at);
    if (matchingBooking) {
      db.prepare('UPDATE restaurant_orders SET booking_id = ? WHERE id = ?').run(matchingBooking.id, ord.id);
    }
  }

  const unlinkedBarOrders = db.prepare(`
    SELECT id, room_id, created_at 
    FROM bar_orders 
    WHERE room_id IS NOT NULL AND (booking_id IS NULL OR booking_id = 0)
  `).all();
  for (const ord of unlinkedBarOrders) {
    const matchingBooking = db.prepare(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
        AND datetime(?) >= datetime(checkin_time, 'localtime')
        AND (actual_checkout_time IS NULL OR datetime(?) <= datetime(actual_checkout_time, 'localtime'))
      ORDER BY id DESC LIMIT 1
    `).get(ord.room_id, ord.created_at, ord.created_at);
    if (matchingBooking) {
      db.prepare('UPDATE bar_orders SET booking_id = ? WHERE id = ?').run(matchingBooking.id, ord.id);
    }
  }
} catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN ext_grace_mins INTEGER NOT NULL DEFAULT 60;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN ext_3h_rate REAL NOT NULL DEFAULT 500;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN ext_6h_rate REAL NOT NULL DEFAULT 1000;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN ext_9h_rate REAL NOT NULL DEFAULT 1500;"); } catch (e) {}

// Seed default categories & menu items for Restaurant and Bar if missing
const seedDefaultMenus = () => {
  try {
    // Restaurant categories
    const restCats = [
      { name: 'Starters & Tandoor', sort_order: 2 },
      { name: 'Main Course - Veg', sort_order: 3 },
      { name: 'Main Course - Non-Veg', sort_order: 4 },
      { name: 'Biryani & Rice', sort_order: 5 },
      { name: 'Roti & Breads', sort_order: 6 },
      { name: 'Desserts & Beverages', sort_order: 7 }
    ];
    for (const cat of restCats) {
      db.prepare(`
        INSERT OR IGNORE INTO restaurant_categories (name, sort_order)
        VALUES (?, ?)
      `).run(cat.name, cat.sort_order);
    }

    // Bar categories
    const barCats = [
      { name: 'Beers', sort_order: 1 },
      { name: 'Whisky', sort_order: 2 },
      { name: 'Vodka & Rum', sort_order: 3 },
      { name: 'Cocktails & Mocktails', sort_order: 4 },
      { name: 'Bar Bites & Chasers', sort_order: 5 }
    ];
    for (const cat of barCats) {
      db.prepare(`
        INSERT OR IGNORE INTO bar_categories (name, sort_order)
        VALUES (?, ?)
      `).run(cat.name, cat.sort_order);
    }

    // Restaurant menu items
    const restDishes = [
      { category: 'Starters & Tandoor', name: 'Paneer Tikka', price: 240, shortcode: '102', is_veg: 1, desc: 'Cottage cheese marinated in spices and grilled in tandoor' },
      { category: 'Starters & Tandoor', name: 'Veg Crispy', price: 180, shortcode: '103', is_veg: 1, desc: 'Crispy fried vegetables tossed in spicy sweet sauce' },
      { category: 'Starters & Tandoor', name: 'Crispy Corn', price: 190, shortcode: '104', is_veg: 1, desc: 'Golden fried sweet corn with onions and chili' },
      { category: 'Starters & Tandoor', name: 'Hara Bhara Kebab', price: 200, shortcode: '105', is_veg: 1, desc: 'Spiced spinach and green pea patties' },
      { category: 'Starters & Tandoor', name: 'Chicken Tikka', price: 280, shortcode: '106', is_veg: 0, desc: 'Boneless chicken cubes grilled with tandoori spices' },
      { category: 'Starters & Tandoor', name: 'Chicken Tandoori (Half)', price: 290, shortcode: '107', is_veg: 0, desc: 'Traditional bone-in chicken roasted in clay oven' },
      { category: 'Starters & Tandoor', name: 'Chicken 65', price: 250, shortcode: '108', is_veg: 0, desc: 'Deep-fried spicy chicken with curry leaves' },
      { category: 'Starters & Tandoor', name: 'Mutton Seekh Kebab', price: 340, shortcode: '109', is_veg: 0, desc: 'Minced mutton skewers seasoned with Indian spices' },

      { category: 'Main Course - Veg', name: 'Paneer Butter Masala', price: 260, shortcode: '110', is_veg: 1, desc: 'Rich tomato gravy with soft paneer cubes and butter' },
      { category: 'Main Course - Veg', name: 'Kaju Curry', price: 290, shortcode: '111', is_veg: 1, desc: 'Roasted cashews simmered in luscious makhani gravy' },
      { category: 'Main Course - Veg', name: 'Veg Kolhapuri', price: 220, shortcode: '112', is_veg: 1, desc: 'Spicy mixed vegetables cooked in Kolhapuri masala' },
      { category: 'Main Course - Veg', name: 'Dal Tadka', price: 170, shortcode: '113', is_veg: 1, desc: 'Yellow lentils tempered with cumin, garlic and ghee' },
      { category: 'Main Course - Veg', name: 'Dal Makhani', price: 210, shortcode: '114', is_veg: 1, desc: 'Slow-cooked black lentils with cream and butter' },
      { category: 'Main Course - Veg', name: 'Mix Veg Handi', price: 230, shortcode: '115', is_veg: 1, desc: 'Seasonal vegetables in mild fragrant curry' },

      { category: 'Main Course - Non-Veg', name: 'Butter Chicken', price: 320, shortcode: '116', is_veg: 0, desc: 'Tender chicken pieces in rich creamy tomato butter sauce' },
      { category: 'Main Course - Non-Veg', name: 'Chicken Kolhapuri', price: 290, shortcode: '117', is_veg: 0, desc: 'Fiery chicken curry infused with roasted spices' },
      { category: 'Main Course - Non-Veg', name: 'Chicken Handi', price: 310, shortcode: '118', is_veg: 0, desc: 'Chicken cooked in clay handi with rich onion gravy' },
      { category: 'Main Course - Non-Veg', name: 'Mutton Rogan Josh', price: 380, shortcode: '119', is_veg: 0, desc: 'Traditional aromatic mutton stew with Kashmiri chilies' },
      { category: 'Main Course - Non-Veg', name: 'Mutton Sukka', price: 360, shortcode: '120', is_veg: 0, desc: 'Dry spiced mutton roasted with grated coconut' },
      { category: 'Main Course - Non-Veg', name: 'Egg Curry', price: 190, shortcode: '121', is_veg: 0, desc: 'Hard-boiled eggs cooked in flavorful onion gravy' },

      { category: 'Biryani & Rice', name: 'Chicken Dum Biryani', price: 280, shortcode: '122', is_veg: 0, desc: 'Layered basmati rice and marinated chicken cooked on dum' },
      { category: 'Biryani & Rice', name: 'Mutton Dum Biryani', price: 360, shortcode: '123', is_veg: 0, desc: 'Tender mutton layered with aromatic basmati rice' },
      { category: 'Biryani & Rice', name: 'Veg Hyderabadi Biryani', price: 220, shortcode: '124', is_veg: 1, desc: 'Fragrant rice with fresh vegetables and fried onions' },
      { category: 'Biryani & Rice', name: 'Jeera Rice', price: 150, shortcode: '125', is_veg: 1, desc: 'Basmati rice tempered with roasted cumin seeds' },
      { category: 'Biryani & Rice', name: 'Steamed Basmati Rice', price: 120, shortcode: '126', is_veg: 1, desc: 'Long grain fluffy steamed rice' },
      { category: 'Biryani & Rice', name: 'Dal Khichdi', price: 180, shortcode: '127', is_veg: 1, desc: 'Comforting rice and lentil pot tempered with ghee' },

      { category: 'Roti & Breads', name: 'Butter Naan', price: 50, shortcode: '128', is_veg: 1, desc: 'Soft leavened flatbread brushed with butter' },
      { category: 'Roti & Breads', name: 'Garlic Naan', price: 65, shortcode: '129', is_veg: 1, desc: 'Tandoori naan topped with minced roasted garlic' },
      { category: 'Roti & Breads', name: 'Tandoori Roti', price: 25, shortcode: '130', is_veg: 1, desc: 'Crisp whole wheat flatbread from tandoor' },
      { category: 'Roti & Breads', name: 'Butter Roti', price: 30, shortcode: '131', is_veg: 1, desc: 'Tandoori roti with generous butter spread' },
      { category: 'Roti & Breads', name: 'Laccha Paratha', price: 55, shortcode: '132', is_veg: 1, desc: 'Multi-layered flaky whole wheat paratha' },

      { category: 'Desserts & Beverages', name: 'Gulab Jamun (2 pcs)', price: 80, shortcode: '133', is_veg: 1, desc: 'Warm milk dumplings soaked in cardamom sugar syrup' },
      { category: 'Desserts & Beverages', name: 'Masala Chaas', price: 50, shortcode: '134', is_veg: 1, desc: 'Spiced churned buttermilk with roasted cumin' },
      { category: 'Desserts & Beverages', name: 'Fresh Lime Soda', price: 60, shortcode: '135', is_veg: 1, desc: 'Sweet, salted or mixed chilled soda with lemon' },
      { category: 'Desserts & Beverages', name: 'Mineral Water (1L)', price: 20, shortcode: '136', is_veg: 1, desc: 'Packaged drinking water bottle' }
    ];

    const insertRestDish = db.prepare(`
      INSERT INTO menu_items (department, category, name, price, description, is_available, shortcode, is_veg)
      SELECT 'restaurant', ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM menu_items WHERE department = 'restaurant' AND LOWER(name) = LOWER(?)
      )
    `);

    for (const d of restDishes) {
      insertRestDish.run(d.category, d.name, d.price, d.desc, d.shortcode, d.is_veg, d.name);
    }

    // Bar drinks
    const barDrinks = [
      { category: 'Beers', name: 'Kingfisher Premium (650ml)', price: 220, shortcode: '501', is_veg: 1, desc: 'Crisp lager beer' },
      { category: 'Beers', name: 'Kingfisher Ultra (650ml)', price: 260, shortcode: '502', is_veg: 1, desc: 'Smooth malt premium beer' },
      { category: 'Beers', name: 'Bira 91 Blonde (330ml)', price: 180, shortcode: '503', is_veg: 1, desc: 'Craft lager beer' },
      { category: 'Beers', name: 'Heineken Lager (650ml)', price: 290, shortcode: '504', is_veg: 1, desc: 'World renowned imported Dutch beer' },
      { category: 'Beers', name: 'Budweiser Magnum (650ml)', price: 270, shortcode: '505', is_veg: 1, desc: 'Strong smooth brewed beer' },
      { category: 'Beers', name: 'Corona Extra (355ml)', price: 330, shortcode: '506', is_veg: 1, desc: 'Mexican pale lager served with lime' },

      { category: 'Whisky', name: 'Royal Challenge (60ml)', price: 140, shortcode: '507', is_veg: 1, desc: 'Selected grain spirit whisky' },
      { category: 'Whisky', name: 'Blenders Pride (60ml)', price: 180, shortcode: '508', is_veg: 1, desc: 'Fine blended Indian and scotch grain whisky' },
      { category: 'Whisky', name: 'Antiquity Blue (60ml)', price: 220, shortcode: '509', is_veg: 1, desc: 'Ultra-premium blended Indian whisky' },
      { category: 'Whisky', name: '100 Pipers 12 Yrs (60ml)', price: 290, shortcode: '510', is_veg: 1, desc: 'Smooth blended Scotch whisky' },
      { category: 'Whisky', name: 'Black Dog Triple Gold (60ml)', price: 320, shortcode: '511', is_veg: 1, desc: 'Deluxe reserve blended scotch whisky' },
      { category: 'Whisky', name: 'Johnnie Walker Red Label (60ml)', price: 360, shortcode: '512', is_veg: 1, desc: 'Iconic pioneer blend Scotch whisky' },
      { category: 'Whisky', name: 'Johnnie Walker Black Label (60ml)', price: 480, shortcode: '513', is_veg: 1, desc: '12 year aged rich blended Scotch whisky' },

      { category: 'Vodka & Rum', name: 'Magic Moments Vodka (60ml)', price: 140, shortcode: '514', is_veg: 1, desc: 'Grain neutral spirit vodka' },
      { category: 'Vodka & Rum', name: 'Smirnoff Triple Distilled (60ml)', price: 190, shortcode: '515', is_veg: 1, desc: 'Triple distilled classic vodka' },
      { category: 'Vodka & Rum', name: 'Absolut Vodka (60ml)', price: 310, shortcode: '516', is_veg: 1, desc: 'Pure Swedish winter wheat vodka' },
      { category: 'Vodka & Rum', name: 'Old Monk Dark Rum (60ml)', price: 120, shortcode: '517', is_veg: 1, desc: 'Legendary Indian vatted dark rum' },
      { category: 'Vodka & Rum', name: 'Bacardi Carta Blanca (60ml)', price: 180, shortcode: '518', is_veg: 1, desc: 'Superior white rum' },

      { category: 'Cocktails & Mocktails', name: 'Long Island Iced Tea (LIIT)', price: 390, shortcode: '519', is_veg: 1, desc: 'Vodka, rum, gin, tequila, triple sec, cola' },
      { category: 'Cocktails & Mocktails', name: 'Classic Mint Mojito', price: 250, shortcode: '520', is_veg: 1, desc: 'White rum, fresh mint, lime juice, club soda' },
      { category: 'Cocktails & Mocktails', name: 'Cosmopolitan', price: 280, shortcode: '521', is_veg: 1, desc: 'Vodka, triple sec, cranberry juice, lime' },
      { category: 'Cocktails & Mocktails', name: 'Blue Lagoon', price: 220, shortcode: '522', is_veg: 1, desc: 'Vodka, blue curacao, lemonade' },
      { category: 'Cocktails & Mocktails', name: 'Virgin Mojito (Mocktail)', price: 180, shortcode: '523', is_veg: 1, desc: 'Refreshing non-alcoholic lime and mint cooler' },

      { category: 'Bar Bites & Chasers', name: 'Roasted Masala Peanuts', price: 110, shortcode: '524', is_veg: 1, desc: 'Crunchy spiced peanuts with onion and coriander' },
      { category: 'Bar Bites & Chasers', name: 'Crispy Chana Koliwada', price: 130, shortcode: '525', is_veg: 1, desc: 'Batter fried chickpeas with garlic and spices' },
      { category: 'Bar Bites & Chasers', name: 'Chicken Crispy', price: 260, shortcode: '526', is_veg: 0, desc: 'Tender chicken strips tossed in spicy oriental sauce' },
      { category: 'Bar Bites & Chasers', name: 'Red Bull Energy Drink', price: 160, shortcode: '527', is_veg: 1, desc: '250ml can' },
      { category: 'Bar Bites & Chasers', name: 'Premium Soda Water', price: 30, shortcode: '528', is_veg: 1, desc: 'Carbonated soda water bottle' }
    ];

    const insertBarDrink = db.prepare(`
      INSERT INTO menu_items (department, category, name, price, description, is_available, shortcode, is_veg)
      SELECT 'bar', ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM menu_items WHERE department = 'bar' AND LOWER(name) = LOWER(?)
      )
    `);

    for (const b of barDrinks) {
      insertBarDrink.run(b.category, b.name, b.price, b.desc, b.shortcode, b.is_veg, b.name);
    }
  } catch (err) {
    console.warn('Notice seeding menus:', err.message);
  }
};

seedDefaultMenus();
// Ensure default shortcodes for restaurant items if missing
const unassignedShortcodes = db.prepare("SELECT id FROM menu_items WHERE department = 'restaurant' AND (shortcode IS NULL OR shortcode = '') ORDER BY id ASC").all();
if (unassignedShortcodes.length > 0) {
  const updateShortcode = db.prepare('UPDATE menu_items SET shortcode = ? WHERE id = ?');
  unassignedShortcodes.forEach((item, index) => {
    updateShortcode.run(String(101 + index), item.id);
  });
}

// System Settings Table (for API keys, hotel configurations, etc.)
db.exec(`
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations for Bookings Booking Source & Manual Document Proofs
try { db.exec("ALTER TABLE bookings ADD COLUMN booking_source TEXT DEFAULT 'Walk-in';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN ota_platform TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN ota_booking_id TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN manual_entry INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN doc_proofs_json TEXT DEFAULT '[]';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN meal_plan TEXT DEFAULT 'without_breakfast';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_beds INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_bed_charge REAL DEFAULT 0;"); } catch (e) {}

// Migrations for Rooms Configurable Breakfast & Extra Beds
try { db.exec("ALTER TABLE rooms ADD COLUMN breakfast_price REAL DEFAULT 250;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN max_extra_beds INTEGER DEFAULT 1;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN extra_bed_price REAL DEFAULT 500;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_tables ADD COLUMN room_id INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_tables ADD COLUMN room_id INTEGER DEFAULT NULL;"); } catch (e) {}

// Room Visitors Table for Guest Visitor Logging & Photo Verification
db.exec(`
  CREATE TABLE IF NOT EXISTS room_visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    visitor_name TEXT NOT NULL,
    phone TEXT,
    relation TEXT NOT NULL,
    custom_relation TEXT,
    purpose TEXT,
    visitor_photo TEXT,
    checkin_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    checkout_time DATETIME,
    status TEXT DEFAULT 'IN_ROOM',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Staff Accounts Table for Role-Based Access & Cashier Auditing
db.exec(`
  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'hospitality', -- 'manager', 'hospitality', 'restaurant', 'bar'
    phone TEXT,
    status TEXT DEFAULT 'active', -- 'active', 'inactive'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations for Cashier Tracking & Manager Access Permissions
try { db.exec("ALTER TABLE bookings ADD COLUMN checked_in_by TEXT DEFAULT 'Front Desk';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN checked_out_by TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN cashier_name TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN cashier_name TEXT DEFAULT '';"); } catch (e) {}
try { db.exec("ALTER TABLE staff_users ADD COLUMN can_access_manager INTEGER DEFAULT 0;"); } catch (e) {}
try { db.prepare("UPDATE staff_users SET can_access_manager = 1 WHERE role = 'manager';").run(); } catch (e) {}
try { db.prepare("UPDATE staff_users SET full_name = 'Jaijeet sir' WHERE username = 'admin' OR (role = 'manager' AND full_name = 'General Manager');").run(); } catch (e) {}

// Seed Starter Accounts for Each Hotel Section (Front Desk, Restaurant, Bar, Management) if missing
const bcrypt = require('bcryptjs');
const ensureStaffAccount = (username, defaultPassword, fullName, role, phone, canAccessManager = null) => {
  const existing = db.prepare('SELECT id FROM staff_users WHERE username = ?').get(username);
  const managerAccess = canAccessManager !== null ? canAccessManager : (role === 'manager' ? 1 : 0);
  if (!existing) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO staff_users (username, password, full_name, role, phone, status, can_access_manager)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
      `).run(username, bcrypt.hashSync(defaultPassword, 10), fullName, role, phone, managerAccess);
    } catch (e) {}
  }
};

ensureStaffAccount('admin', 'admin123', 'Jaijeet sir', 'manager', '9876543210', 1);
// Remove demo hospitality accounts (desk1 & desk2)
try {
  db.prepare("DELETE FROM staff_users WHERE LOWER(username) IN ('desk1', 'desk2')").run();
} catch (e) {}

ensureStaffAccount('rest1', 'rest123', 'Ramesh Kumar (Restaurant POS)', 'restaurant', '9876543213');
ensureStaffAccount('rest2', 'rest123', 'Amit Patel (Restaurant Captain)', 'restaurant', '9876543214');
ensureStaffAccount('bar1', 'bar123', 'Ajay Singh (Bar Lounge)', 'bar', '9876543215');
ensureStaffAccount('bar2', 'bar123', 'Vikram Rawat (Bartender)', 'bar', '9876543216');

// Corporate BTC Companies Directory
db.exec(`
  CREATE TABLE IF NOT EXISTS btc_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    address TEXT,
    contact_person TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    pan_number TEXT,
    gst_number TEXT,
    credit_limit REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Petty Cash & Expenses Table
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_no TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL, -- 'owner', 'refund', 'store', 'maintenance', 'other'
    paid_to TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_mode TEXT DEFAULT 'cash', -- 'cash', 'cheque', 'upi', 'card', 'bank_transfer'
    debit_account TEXT DEFAULT 'Cash A/c',
    purpose_details TEXT NOT NULL,
    room_id INTEGER DEFAULT NULL,
    booking_id INTEGER DEFAULT NULL,
    cashier_name TEXT NOT NULL,
    cheque_no TEXT,
    bank_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Centralized Financial & Cheque Payments Ledger Table
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE NOT NULL,
    booking_id INTEGER DEFAULT NULL,
    room_id INTEGER DEFAULT NULL,
    order_id INTEGER DEFAULT NULL,
    department TEXT NOT NULL DEFAULT 'hospitality', -- 'hospitality', 'restaurant', 'bar', 'expense_refund'
    payment_type TEXT NOT NULL DEFAULT 'advance', -- 'advance', 'bill_settlement', 'pos_order', 'refund'
    payment_mode TEXT NOT NULL DEFAULT 'cash', -- 'cash', 'cheque', 'card', 'upi', 'btc'
    amount REAL NOT NULL,
    cheque_no TEXT,
    bank_name TEXT,
    cheque_date DATE,
    cheque_status TEXT DEFAULT 'realized', -- 'realized', 'pending', 'passed', 'bounced'
    realized_at DATETIME,
    btc_company_id INTEGER DEFAULT NULL,
    btc_company_name TEXT DEFAULT NULL,
    cashier_name TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations for Bookings (OTA Pre/Post-Paid, Manual Bill Override, Corporate BTC, Advance & Cheques)
try { db.exec("ALTER TABLE bookings ADD COLUMN is_prepaid INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN ota_bill_amount REAL DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN btc_company_id INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN btc_company_name TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN btc_approval_ref TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_payment REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_payment_mode TEXT DEFAULT 'cash';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_receipt_no TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_cheque_no TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_cheque_bank TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN final_settlement_payment REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN final_settlement_mode TEXT DEFAULT 'cash';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN final_receipt_no TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE guests ADD COLUMN alt_mobile TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN alt_mobile TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN cheque_photo TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_cheque_photo TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN settlement_cheque_no TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN settlement_cheque_bank TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN settlement_cheque_date DATE DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN settlement_cheque_photo TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN cheque_photo TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN utr_number TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN card_surcharge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_utr_number TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN final_settlement_utr TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN utr_number TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN room_service_for TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN guest_phone TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN card_surcharge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN settled_by TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN settled_at DATETIME DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN utr_number TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN room_service_for TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN guest_phone TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN card_surcharge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN settled_by TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN settled_at DATETIME DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN member_documents_json TEXT DEFAULT '[]';"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN voucher_number TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE guests ADD COLUMN aadhar_number TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN is_early_checkin INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN original_checkin_time TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN early_checkin_time TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN ota_booked_adults INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN ota_booked_children INTEGER DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN ota_booked_extra_beds INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_adults INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_children INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_rooms_charge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_breakfast_charge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN extra_meal_plan TEXT DEFAULT NULL;"); } catch (e) {}

// Card Surcharge (2.5%) and UPI Tax (0.4% > ₹2000) Tracking Columns
try { db.exec("ALTER TABLE payments ADD COLUMN upi_tax REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN split_cash REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN split_card REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN split_online REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE payments ADD COLUMN split_cheque REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_card_surcharge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN advance_upi_tax REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN final_card_surcharge REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN final_upi_tax REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE restaurant_orders ADD COLUMN upi_tax REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bar_orders ADD COLUMN upi_tax REAL DEFAULT 0;"); } catch (e) {}

// Monthly Serial Voucher Sequencing (resets every month, format: YYYYMMDD-SR)
db.exec(`
  CREATE TABLE IF NOT EXISTS monthly_voucher_sequences (
    prefix TEXT NOT NULL,
    year_month TEXT NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(prefix, year_month)
  );
`);

// Room Cleaning Logs Table & Cleaner Attribution
db.exec(`
  CREATE TABLE IF NOT EXISTS room_cleaning_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    booking_id INTEGER DEFAULT NULL,
    cleaner_name TEXT NOT NULL,
    cleaning_notes TEXT,
    cleaned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
try { db.exec("ALTER TABLE bookings ADD COLUMN cleaned_by TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN cleaned_at DATETIME DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN last_cleaned_by TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE rooms ADD COLUMN last_cleaned_at DATETIME DEFAULT NULL;"); } catch (e) {}

// Room Visitors Breakfast Additions
try { db.exec("ALTER TABLE room_visitors ADD COLUMN has_breakfast INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE room_visitors ADD COLUMN breakfast_status TEXT DEFAULT 'pending';"); } catch (e) {}
try { db.exec("ALTER TABLE room_visitors ADD COLUMN breakfast_amount REAL DEFAULT 250;"); } catch (e) {}

// Housekeeping / Cleaner Staff Table (Options managed via Manager Panel)
db.exec(`
  CREATE TABLE IF NOT EXISTS cleaner_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    phone TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  const cleanerCount = db.prepare('SELECT COUNT(*) as count FROM cleaner_staff').get();
  if (!cleanerCount || cleanerCount.count === 0) {
    const seedCleaners = [
      { name: 'Sunita Shinde', phone: '9876543220' },
      { name: 'Ramesh Kumar', phone: '9876543221' },
      { name: 'Suresh Jadhav', phone: '9876543222' },
      { name: 'Anita Patil', phone: '9876543223' }
    ];
    const insertCleaner = db.prepare('INSERT OR IGNORE INTO cleaner_staff (name, phone, status) VALUES (?, ?, ?)');
    seedCleaners.forEach(c => insertCleaner.run(c.name, c.phone, 'active'));
  }
} catch (e) {}

// Checkout Extension Audit Logs
try { db.exec("ALTER TABLE bookings ADD COLUMN extension_logs_json TEXT DEFAULT '[]';"); } catch (e) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkout_extension_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      room_id INTEGER,
      room_number TEXT,
      extended_by TEXT NOT NULL,
      from_time TEXT,
      to_time TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
} catch (e) {}

try {
  db.exec("ALTER TABLE rooms ADD COLUMN gst_pct REAL NOT NULL DEFAULT 5;");
} catch (e) {}

// Early Checkout & Refund Settlement columns
try { db.exec("ALTER TABLE bookings ADD COLUMN refund_amount REAL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN refund_mode TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN refund_voucher_no TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN refund_reason TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE bookings ADD COLUMN refund_utr TEXT DEFAULT NULL;"); } catch (e) {}

// Sample BTC companies seeder removed: Users add corporate BTC accounts manually.

// Secret Manager & Encryption for sensitive settings
const secretManager = require('./services/secretManager');
secretManager.migrateDatabaseSecrets(db);

const defaultKey = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('gemini_api_key');
const currentDecrypted = defaultKey && defaultKey.value ? secretManager.decryptSecret(defaultKey.value) : '';
if ((!currentDecrypted || currentDecrypted.startsWith('AIzaSyTest')) && process.env.GEMINI_API_KEY) {
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
    'gemini_api_key',
    secretManager.encryptSecret(process.env.GEMINI_API_KEY)
  );
}

const defaultOta = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('ota_platforms');
if (!defaultOta) {
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(
    'ota_platforms',
    JSON.stringify(['MakeMyTrip', 'Goibibo', 'Booking.com', 'Agoda', 'Airbnb', 'EaseMyTrip', 'Yatra', 'Expedia'])
  );
}

const defaultMinAdvance = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('min_checkin_advance_pct');
if (!defaultMinAdvance) {
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run('min_checkin_advance_pct', '50');
}

module.exports = db;

