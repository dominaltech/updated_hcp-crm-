/**
 * Firestore CLI Query & Management Tool for Hotel City Park CRM
 * Run directly via Terminal: node scripts/firestore_cli.js <command> [args...]
 */

const path = require('path');
const fs = require('fs');
const { getFirestore } = require('firebase-admin/firestore');
const { cert, initializeApp, getApps, getApp } = require('firebase-admin/app');

// Locate service account key
const saPaths = [
  path.resolve(__dirname, '..', 'firebase-service-account.json'),
  path.resolve(__dirname, '..', 'hotelcitypark-crm-firebase-adminsdk-fbsvc-cb2c37b86c.json')
];

let serviceAccount = null;
for (const p of saPaths) {
  if (fs.existsSync(p)) {
    try {
      serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
      break;
    } catch (_) {}
  }
}

if (!serviceAccount || !serviceAccount.private_key) {
  console.error('❌ Error: firebase-service-account.json not found or invalid.');
  process.exit(1);
}

const app = getApps().length > 0 ? getApp() : initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'collections':
    case 'list': {
      console.log('🔍 Fetching collections in Firestore Database...');
      const collections = await db.listCollections();
      if (!collections.length) {
        console.log('No collections found in Firestore.');
        return;
      }
      console.log(`\nFound ${collections.length} collections:`);
      for (const col of collections) {
        const snap = await col.limit(1).get();
        console.log(`  📂 ${col.id} (active: ${snap.empty ? 'empty' : 'contains data'})`);
      }
      break;
    }

    case 'get': {
      const colName = args[0];
      const limit = parseInt(args[1] || '10', 10);
      if (!colName) {
        console.error('Usage: node scripts/firestore_cli.js get <collection_name> [limit]');
        return;
      }
      const snap = await db.collection(colName).limit(limit).get();
      console.log(`\n📂 Collection [${colName}] - Showing up to ${limit} documents (Found: ${snap.size}):\n`);
      snap.forEach(doc => {
        console.log(`Document ID: [${doc.id}]`);
        console.log(JSON.stringify(doc.data(), null, 2));
        console.log('--------------------------------------------------');
      });
      break;
    }

    case 'doc': {
      const [colName, docId] = args;
      if (!colName || !docId) {
        console.error('Usage: node scripts/firestore_cli.js doc <collection_name> <doc_id>');
        return;
      }
      const doc = await db.collection(colName).doc(docId).get();
      if (!doc.exists) {
        console.log(`Document [${docId}] does not exist in collection [${colName}].`);
      } else {
        console.log(`Document [${docId}] in [${colName}]:`);
        console.log(JSON.stringify(doc.data(), null, 2));
      }
      break;
    }

    case 'set': {
      const [colName, docId, rawJson] = args;
      if (!colName || !docId || !rawJson) {
        console.error('Usage: node scripts/firestore_cli.js set <collection_name> <doc_id> \'<json_data>\'');
        return;
      }
      try {
        const data = JSON.parse(rawJson);
        data.updated_at = new Date().toISOString();
        await db.collection(colName).doc(docId).set(data, { merge: true });
        console.log(`✅ Successfully saved document [${docId}] into collection [${colName}]!`);
      } catch (e) {
        console.error('❌ Failed to parse JSON or save document:', e.message);
      }
      break;
    }

    case 'delete': {
      const [colName, docId] = args;
      if (!colName || !docId) {
        console.error('Usage: node scripts/firestore_cli.js delete <collection_name> <doc_id>');
        return;
      }
      await db.collection(colName).doc(docId).delete();
      console.log(`🗑️ Successfully deleted document [${docId}] from collection [${colName}].`);
      break;
    }

    case 'where': {
      const [colName, field, op, val] = args;
      if (!colName || !field || !op || val === undefined) {
        console.error('Usage: node scripts/firestore_cli.js where <collection> <field> <== | >= | <= | != | in> <value>');
        return;
      }
      let parsedVal = val;
      if (val === 'true') parsedVal = true;
      else if (val === 'false') parsedVal = false;

      let snap = await db.collection(colName).where(field, op, parsedVal).get();
      if (snap.empty && !isNaN(val)) {
        // Try as number
        snap = await db.collection(colName).where(field, op, Number(val)).get();
      }
      console.log(`\n🔍 Query [${colName} where ${field} ${op} ${val}] -> Found ${snap.size} documents:\n`);
      snap.forEach(doc => {
        console.log(`Document ID: [${doc.id}]`);
        console.log(JSON.stringify(doc.data(), null, 2));
        console.log('--------------------------------------------------');
      });
      break;
    }

    case 'wipe':
    case 'empty':
    case 'clear-all': {
      console.log('🚀 Connecting to Firebase Firestore...');
      const collections = await db.listCollections();
      if (!collections.length) {
        console.log('✅ Firestore is already completely empty! (0 collections, 0 documents)');
        return;
      }
      console.log(`Found ${collections.length} collections. Creating safety backup...`);
      const backupData = {};
      let totalDocs = 0;
      for (const col of collections) {
        const snap = await col.get();
        backupData[col.id] = [];
        snap.forEach(doc => {
          backupData[col.id].push({ id: doc.id, data: doc.data() });
          totalDocs++;
        });
        console.log(`  📦 Backed up [${col.id}]: ${snap.size} documents`);
      }
      const backupDir = path.resolve(__dirname, '..', 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const backupFilePath = path.join(backupDir, `firebase_backup_${Date.now()}.json`);
      fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2));
      console.log(`\n💾 Safety backup created at: ${backupFilePath}\n`);

      console.log('🗑️ Deleting all collections recursively from Firestore...');
      for (const col of collections) {
        process.stdout.write(`  Deleting collection [${col.id}]... `);
        await db.recursiveDelete(col);
        console.log('Done.');
      }

      console.log('\n🔍 Verifying all collections are wiped...');
      const remaining = await db.listCollections();
      if (remaining.length === 0) {
        console.log('\n✨ ALL COLLECTIONS ARE COMPLETELY EMPTY IN FIREBASE FIRESTORE! ✨\n');
      } else {
        console.log(`⚠️ Warning: ${remaining.length} collections still visible.`);
      }
      break;
    }

    default:
      console.log(`
Hotel City Park - Firestore Query & Management CLI
===================================================
Usage:
  node scripts/firestore_cli.js wipe              (Safely backup and delete all data from all collections)
  node scripts/firestore_cli.js collections       (List all collections)
  node scripts/firestore_cli.js get <collection> [limit]
  node scripts/firestore_cli.js doc <collection> <doc_id>
  node scripts/firestore_cli.js where <collection> <field> <== | > | < | <= | >=> <value>
  node scripts/firestore_cli.js set <collection> <doc_id> '<json_data>'
  node scripts/firestore_cli.js delete <collection> <doc_id>
      `);
      break;
  }
}

main().catch(err => {
  console.error('Firestore CLI Error:', err);
  process.exit(1);
});
