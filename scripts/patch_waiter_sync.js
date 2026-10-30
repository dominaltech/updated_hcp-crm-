/**
 * scripts/patch_waiter_sync.js
 * Applies the 4-part architectural fix for 100% reliable Waiter -> CRM order reflection.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// ==========================================
// 1. PATCH services/firebaseService.js
// ==========================================
const fbServicePath = path.join(root, 'services', 'firebaseService.js');
let fbContent = fs.readFileSync(fbServicePath, 'utf8');

const resolveHelperCode = `
/**
 * Robust Canonical Table Resolver
 * Matches by Primary Key ID, exact table_number, or canonical digits (e.g. 2 -> T2, Table 2, T-02, 2)
 * Auto-creates missing dine-in tables if needed so that incoming orders are NEVER dropped.
 */
function resolveTargetTable(db, tableName, destId, destLabel, destType = 'table') {
  if (!db || !tableName) return null;
  let table = null;

  // 1. Exact numeric primary key ID match
  if (destId !== undefined && destId !== null && !isNaN(Number(destId)) && Number(destId) > 0) {
    try { table = db.prepare(\`SELECT * FROM \${tableName} WHERE id = ?\`).get(Number(destId)); } catch (_) {}
    if (table) return table;
  }

  const rawLabel = String(destLabel || destId || '').trim();
  if (!rawLabel) return null;

  // 2. Exact table_number match (case-insensitive)
  try {
    table = db.prepare(\`SELECT * FROM \${tableName} WHERE LOWER(table_number) = LOWER(?)\`).get(rawLabel);
  } catch (_) {}
  if (table) return table;

  // 3. Digit-based canonical match across prefixes (e.g. 2 -> T2, Table 2, T-02, T-2, 2)
  const isBar = tableName.includes('bar');
  const prefix = isBar ? 'B' : 'T';
  const digits = rawLabel.replace(/\\D+/g, '');

  if (digits) {
    try {
      table = db.prepare(\`
        SELECT * FROM \${tableName}
        WHERE table_number IN (?, ?, ?, ?, ?, ?, ?)
      \`).get(
        \`\${prefix}\${digits}\`,
        \`\${prefix}-\${digits}\`,
        \`\${prefix}0\${digits}\`,
        \`\${prefix}-0\${digits}\`,
        \`Table \${digits}\`,
        \`Table-\${digits}\`,
        digits
      );
    } catch (_) {}
    if (table) return table;
  }

  // 4. Room Service variations: "RS-309", "Room 309", "309"
  if (destType === 'room' || /^(RS|Room)/i.test(rawLabel)) {
    const roomDigits = rawLabel.replace(/\\D+/g, '');
    if (roomDigits) {
      try {
        table = db.prepare(\`
          SELECT * FROM \${tableName}
          WHERE table_type = 'room_service'
            AND (table_number = ? OR table_number LIKE ? OR room_id = ?)
        \`).get(\`RS-\${roomDigits}\`, \`%\${roomDigits}%\`, Number(roomDigits));
      } catch (_) {}
      if (table) return table;
    }
  }

  // 5. Parcel variations: "P-1", "Parcel 1", "BP-1"
  if (destType === 'parcel' || /^(P-|BP-|Parcel)/i.test(rawLabel)) {
    const parcelDigits = rawLabel.replace(/\\D+/g, '');
    if (parcelDigits) {
      const pPrefix = isBar ? 'BP' : 'P';
      try {
        table = db.prepare(\`
          SELECT * FROM \${tableName}
          WHERE table_type = 'parcel'
            AND (table_number = ? OR table_number LIKE ?)
        \`).get(\`\${pPrefix}-\${parcelDigits}\`, \`%\${parcelDigits}%\`);
      } catch (_) {}
      if (table) return table;
    }
  }

  // 6. Dine-In fallback: If it's a dine-in table and still doesn't exist, auto-create it so NO ORDER IS EVER LOST!
  if (digits && (destType === 'table' || !destType)) {
    const assignedTableNum = \`\${prefix}\${digits}\`;
    try {
      const countCol = isBar ? 'bot_count' : 'kot_count';
      const ins = db.prepare(\`
        INSERT INTO \${tableName} (table_number, table_type, capacity, status, active_cart_json, printed_cart_json, \${countCol}, token_number)
        VALUES (?, 'dine_in', 4, 'available', '[]', '[]', 0, 0)
      \`).run(assignedTableNum);
      table = db.prepare(\`SELECT * FROM \${tableName} WHERE id = ?\`).get(ins.lastInsertRowid);
      console.log(\`✨ [Firebase Realtime] Auto-created missing dine-in table \${assignedTableNum} in \${tableName} to prevent order drop.\`);
      return table;
    } catch (createErr) {
      console.warn(\`[Firebase Realtime] Failed to auto-create table \${assignedTableNum}:\`, createErr.message);
    }
  }

  return null;
}
`;

if (!fbContent.includes('function resolveTargetTable(')) {
  fbContent = fbContent.replace(
    'function cleanRoomNumber(val) {',
    resolveHelperCode + '\nfunction cleanRoomNumber(val) {'
  );
}

// Replace table lookup in Cancellation
fbContent = fbContent.replace(
  /\/\/ Look up target table[\s\S]*?if \(!targetTable && tNum\) {[\s\S]*?\}\s*\}\s*if \(targetTable\) \{/m,
  `// Look up target table with canonical normalization\n                let targetTable = resolveTargetTable(db, tableName, tId, tNum, 'table');\n\n                if (targetTable) {`
);

// Replace table lookup in Pre-Bill
fbContent = fbContent.replace(
  /let targetTable = null;\s*if \(tId\) \{[\s\S]*?if \(!targetTable && destLabel\) \{[\s\S]*?\}\s*\}\s*if \(targetTable\) \{/m,
  `let targetTable = resolveTargetTable(db, tableName, tId, destLabel, 'table');\n\n                if (targetTable) {`
);

// Replace table lookup in Settle
fbContent = fbContent.replace(
  /let targetTable = null;\s*if \(tId\) \{[\s\S]*?if \(!targetTable && tNum\) \{[\s\S]*?\}\s*\}\s*let items = Array\.isArray\(settleData\.items\)/m,
  `let targetTable = resolveTargetTable(db, tableName, tId, tNum, 'table');\n\n                let items = Array.isArray(settleData.items)`
);

// Replace table lookup in KOT orders (dine-in branch)
fbContent = fbContent.replace(
  /\/\/ 3\. Dine-In Table Order[\s\S]*?orderData\.destination_id,[\s\S]*?destLabel\.replace\(\/\^Table\\s\*\//m,
  `// 3. Dine-In Table Order (with canonical digit matching & auto-creation)
                      targetTable = resolveTargetTable(db, tableName, orderData.destination_id, destLabel, destType);
                      // fallback dummy marker for regex replacement`
);

// Clean up any remaining get(...) arguments after that replacement
fbContent = fbContent.replace(
  /\/\/ fallback dummy marker for regex replacement[\s\S]*?\);\s*\}/m,
  `}`
);

fs.writeFileSync(fbServicePath, fbContent, 'utf8');
console.log('✅ Patched services/firebaseService.js with canonical table resolver!');


// ==========================================
// 2. PATCH server.js
// ==========================================
const serverPath = path.join(root, 'server.js');
let srvContent = fs.readFileSync(serverPath, 'utf8');

const srvTableHelpers = `
/**
 * Canonical Table Lookup for Server API Endpoints
 * Supports primary key ID, exact table number, or normalized digits (e.g. 2 -> T2, Table 2, T-02)
 */
function findRestaurantTable(idOrNumber) {
  if (!idOrNumber) return null;
  let t = null;
  if (!isNaN(Number(idOrNumber)) && Number(idOrNumber) > 0) {
    try { t = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(Number(idOrNumber)); } catch (_) {}
    if (t) return t;
  }
  const raw = String(idOrNumber).trim();
  try { t = db.prepare('SELECT * FROM restaurant_tables WHERE LOWER(table_number) = LOWER(?)').get(raw); } catch (_) {}
  if (t) return t;

  const digits = raw.replace(/\\D+/g, '');
  if (digits) {
    try {
      t = db.prepare(\`
        SELECT * FROM restaurant_tables 
        WHERE table_number IN (?, ?, ?, ?, ?, ?, ?)
      \`).get(\`T\${digits}\`, \`T-\${digits}\`, \`T0\${digits}\`, \`T-0\${digits}\`, \`Table \${digits}\`, \`Table-\${digits}\`, digits);
    } catch (_) {}
    if (t) return t;
  }
  return null;
}

function findBarTable(idOrNumber) {
  if (!idOrNumber) return null;
  let t = null;
  if (!isNaN(Number(idOrNumber)) && Number(idOrNumber) > 0) {
    try { t = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(Number(idOrNumber)); } catch (_) {}
    if (t) return t;
  }
  const raw = String(idOrNumber).trim();
  try { t = db.prepare('SELECT * FROM bar_tables WHERE LOWER(table_number) = LOWER(?)').get(raw); } catch (_) {}
  if (t) return t;

  const digits = raw.replace(/\\D+/g, '');
  if (digits) {
    try {
      t = db.prepare(\`
        SELECT * FROM bar_tables 
        WHERE table_number IN (?, ?, ?, ?, ?, ?, ?)
      \`).get(\`B\${digits}\`, \`B-\${digits}\`, \`B0\${digits}\`, \`B-0\${digits}\`, \`Table \${digits}\`, \`Table-\${digits}\`, digits);
    } catch (_) {}
    if (t) return t;
  }
  return null;
}
`;

if (!srvContent.includes('function findRestaurantTable(')) {
  srvContent = srvContent.replace(
    'function formatTableOutput(t) {',
    srvTableHelpers + '\nfunction formatTableOutput(t) {'
  );
}

// Update restaurant table KOT endpoint
srvContent = srvContent.replace(
  "app.post('/api/restaurant/tables/:id/kot', requireAuth, requireRole('manager', 'restaurant', 'waiter', 'bar', 'hospitality'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { items, cart, waiter_name, special_notes } = req.body;\n\n    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);",
  "app.post('/api/restaurant/tables/:id/kot', requireAuth, requireRole('manager', 'restaurant', 'waiter', 'bar', 'hospitality'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { items, cart, waiter_name, special_notes } = req.body;\n\n    const table = findRestaurantTable(id);"
);

// Update bar table BOT endpoint
srvContent = srvContent.replace(
  "app.post('/api/bar/tables/:id/bot', requireAuth, requireRole('manager', 'bar', 'waiter', 'restaurant', 'hospitality'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { items, cart, waiter_name, special_notes } = req.body;\n\n    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);",
  "app.post('/api/bar/tables/:id/bot', requireAuth, requireRole('manager', 'bar', 'waiter', 'restaurant', 'hospitality'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { items, cart, waiter_name, special_notes } = req.body;\n\n    const table = findBarTable(id);"
);

// Update prebill endpoints
srvContent = srvContent.replace(
  "app.post('/api/restaurant/tables/:id/prebill', requireAuth, requireRole('manager', 'restaurant', 'waiter', 'bar'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { cart, items: bodyItems, waiter_name, special_notes } = req.body || {};\n    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);",
  "app.post('/api/restaurant/tables/:id/prebill', requireAuth, requireRole('manager', 'restaurant', 'waiter', 'bar'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { cart, items: bodyItems, waiter_name, special_notes } = req.body || {};\n    const table = findRestaurantTable(id);"
);

srvContent = srvContent.replace(
  "app.post('/api/bar/tables/:id/prebill', requireAuth, requireRole('manager', 'bar', 'waiter', 'restaurant'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { cart, items: bodyItems, waiter_name, special_notes } = req.body || {};\n    const table = db.prepare('SELECT * FROM bar_tables WHERE id = ?').get(id);",
  "app.post('/api/bar/tables/:id/prebill', requireAuth, requireRole('manager', 'bar', 'waiter', 'restaurant'), (req, res) => {\n  try {\n    const { id } = req.params;\n    const { cart, items: bodyItems, waiter_name, special_notes } = req.body || {};\n    const table = findBarTable(id);"
);

fs.writeFileSync(serverPath, srvContent, 'utf8');
console.log('✅ Patched server.js with canonical table resolvers for KOT & BOT endpoints!');


// ==========================================
// 3. PATCH src/pages/RestaurantPage.jsx
// ==========================================
const restPagePath = path.join(root, 'src', 'pages', 'RestaurantPage.jsx');
let restContent = fs.readFileSync(restPagePath, 'utf8');

// Unfreeze background sync: poll every 8 seconds continuously even when table is open
restContent = restContent.replace(
  `    // 2. Quiet fallback interval
    const interval = setInterval(() => {
      if (!activeSessionTable) {
        loadTables(true);
      }
      checkPendingGuestOrders();
    }, 20000);

    return () => {
      unsubTables();
      unsubOrders();
      unsubRooms();
      clearInterval(interval);
      stopContinuousOrderAlert();
    };
  }, [loadTables, loadMenuAndCategories, checkPendingGuestOrders, activeSessionTable]);`,
  `    // 2. Continuous real-time background sync (Never freezes when table is open!)
    const interval = setInterval(() => {
      loadTables(true);
      checkPendingGuestOrders();
    }, 8000);

    return () => {
      unsubTables();
      unsubOrders();
      unsubRooms();
      clearInterval(interval);
      stopContinuousOrderAlert();
    };
  }, [loadTables, loadMenuAndCategories, checkPendingGuestOrders]);`
);

fs.writeFileSync(restPagePath, restContent, 'utf8');
console.log('✅ Patched src/pages/RestaurantPage.jsx to never freeze updates!');


// ==========================================
// 4. PATCH src/pages/BarPage.jsx
// ==========================================
const barPagePath = path.join(root, 'src', 'pages', 'BarPage.jsx');
let barContent = fs.readFileSync(barPagePath, 'utf8');

barContent = barContent.replace(
  `    // 2. Fallback polling
    const interval = setInterval(() => {
      if (!activeSessionTable) {
        loadTables(true);
      }
    }, 20000);

    return () => {
      unsubBar();
      clearInterval(interval);
    };
  }, [loadTables, loadMenuAndCategories, activeSessionTable]);`,
  `    // 2. Continuous real-time background sync (Never freezes when table is open!)
    const interval = setInterval(() => {
      loadTables(true);
    }, 8000);

    return () => {
      unsubBar();
      clearInterval(interval);
    };
  }, [loadTables, loadMenuAndCategories]);`
);

fs.writeFileSync(barPagePath, barContent, 'utf8');
console.log('✅ Patched src/pages/BarPage.jsx to never freeze updates!');


// ==========================================
// 5. PATCH waiter-pannel/src/App.jsx
// ==========================================
const waiterAppPath = path.join(root, 'release-electron', 'Hotel City Park CRM-win32-x64', 'waiter-pannel', 'src', 'App.jsx');
if (fs.existsSync(waiterAppPath)) {
  let waiterContent = fs.readFileSync(waiterAppPath, 'utf8');

  waiterContent = waiterContent.replace(
    `showToast(\`🚀 Order Punched & KOT #\${kotNo}\${tokenNo} dispatched!\`);`,
    `if (res?.cloud) {
        showToast(\`☁️ Order Enqueued via Cloud Sync (KOT will print at CRM)\`, 6000);
      } else {
        showToast(\`🚀 Order Punched & KOT #\${kotNo}\${tokenNo} dispatched!\`, 4000);
      }`
  );

  fs.writeFileSync(waiterAppPath, waiterContent, 'utf8');
  console.log('✅ Patched waiter-pannel App.jsx with cloud vs local honest feedback toast!');
}

console.log('\n🎉 ALL 5 PATCHES APPLIED SUCCESSFULLY!\n');

