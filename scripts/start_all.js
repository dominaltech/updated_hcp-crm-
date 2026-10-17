/**
 * scripts/start_all.js
 * 
 * Master launcher to run Hotel City Park CRM, Admin Panel, and Storeman Panel locally.
 * - Starts CRM on http://localhost:3000
 * - Starts Admin Panel on http://localhost:8081
 * - Direct Storeman Panel on http://localhost:3000/storeman
 * - Automatically opens browsers
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const http = require('http');

const rootDir = path.resolve(__dirname, '..');
const adminDir = path.join(rootDir, 'admin');

let crmProcess = null;
let adminProcess = null;

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openUrl(url) {
  const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${startCmd} "" "${url}"`, (err) => {
    if (err) console.warn(`Could not auto-open ${url}:`, err.message);
  });
}

async function waitForPort(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const active = await checkPort(port);
    if (active) return true;
    await new Promise(r => setTimeout(r, 600));
  }
  return false;
}

async function main() {
  console.log('\n==================================================================');
  console.log('       HOTEL CITY PARK - ALL LOCAL SERVICES LAUNCHER             ');
  console.log('==================================================================\n');

  // 1. Check or start CRM
  const crmActive = await checkPort(3000);
  if (crmActive) {
    console.log('🟢 [CRM Server] Port 3000 is already active and running.');
  } else {
    console.log('🚀 [CRM Server] Starting server.js on http://localhost:3000 ...');
    crmProcess = spawn('node', ['server.js'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env
    });
    crmProcess.on('error', (err) => console.error('❌ CRM Server failed to start:', err.message));
  }

  // 2. Check or start Admin
  const adminActive = await checkPort(8081);
  if (adminActive) {
    console.log('🟢 [Admin Panel] Port 8081 is already active and running.');
  } else {
    console.log('🚀 [Admin Panel] Starting admin/serve.js on http://localhost:8081 ...');
    adminProcess = spawn('node', ['serve.js'], {
      cwd: adminDir,
      stdio: 'inherit',
      env: process.env
    });
    adminProcess.on('error', (err) => console.error('❌ Admin Panel failed to start:', err.message));
  }

  // 3. Wait for readiness
  console.log('\n⏳ Waiting for all panels to become ready...');
  const crmReady = crmActive || await waitForPort(3000);
  const adminReady = adminActive || await waitForPort(8081);

  console.log('\n------------------------------------------------------------------');
  console.log('  ALL LOCAL PANELS ARE ONLINE AND ACCESSIBLE:');
  console.log('------------------------------------------------------------------');
  console.log('  🏨 CRM (Hospitality):    http://localhost:3000/hospitality');
  console.log('  🍽️ Restaurant POS:       http://localhost:3000/restaurant');
  console.log('  🍸 Bar POS:              http://localhost:3000/bar');
  console.log('  ⚙️ Manage Rooms:         http://localhost:3000/manage');
  console.log('  ----------------------------------------------------------------');
  console.log('  📱 Admin / Owner Panel:  http://localhost:8081');
  console.log('  ----------------------------------------------------------------');
  console.log('  📦 Storeman Panel:       http://localhost:3000/storeman');
  console.log('  📋 Store Admin Panel:    http://localhost:3000/store-admin');
  console.log('------------------------------------------------------------------');
  console.log('  Press Ctrl+C to stop all servers when finished.\n');

  // Auto open browser screens
  if (process.argv.includes('--open') || process.argv.includes('-o') || !process.argv.includes('--no-open')) {
    setTimeout(() => {
      console.log('🌐 Opening browser windows...');
      openUrl('http://localhost:3000/hospitality');
      setTimeout(() => openUrl('http://localhost:8081'), 800);
      setTimeout(() => openUrl('http://localhost:3000/storeman'), 1600);
    }, 1000);
  }
}

// Clean termination
function cleanup() {
  console.log('\n🛑 Shutting down local services...');
  if (crmProcess) {
    try { crmProcess.kill(); } catch (_) {}
  }
  if (adminProcess) {
    try { adminProcess.kill(); } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

main().catch((err) => {
  console.error('Fatal startup error:', err);
  cleanup();
});
