/**
 * scripts/tunnel.js
 * 
 * Cloudflare Worldwide Secure Tunnel for Hotel City Park
 * Exposes port 3000 (CRM, Admin, F&B, Store) securely to the internet.
 * Enables live access for Admin Laptop and Mobile Apps from anywhere in the world.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

const rootDir = path.resolve(__dirname, '..');
const cloudflaredPath = path.join(rootDir, 'tools', 'cloudflared.exe');
const publicDir = path.join(rootDir, 'public');

if (!fs.existsSync(cloudflaredPath)) {
  console.error('❌ cloudflared.exe not found at:', cloudflaredPath);
  process.exit(1);
}

let activeUrl = null;

function saveRemoteUrl(url) {
  activeUrl = url;
  const payload = {
    url,
    adminUrl: `${url}/admin/`,
    crmUrl: `${url}/hospitality`,
    restaurantUrl: `${url}/restaurant`,
    barUrl: `${url}/bar`,
    storeUrl: `${url}/storeman`,
    downloadUrl: `${url}/download.html`,
    updatedAt: new Date().toISOString()
  };

  try {
    fs.writeFileSync(path.join(rootDir, 'remote_url.txt'), url, 'utf8');
    fs.writeFileSync(path.join(publicDir, 'remote_url.json'), JSON.stringify(payload, null, 2), 'utf8');
    
    // Also auto-sync waiter panel client.js with the active tunnel URL
    const waiterClientPath = path.join(rootDir, 'release-electron', 'Hotel City Park CRM-win32-x64', 'waiter-pannel', 'src', 'api', 'client.js');
    if (fs.existsSync(waiterClientPath)) {
      let clientContent = fs.readFileSync(waiterClientPath, 'utf8');
      clientContent = clientContent.replace(/export const CLOUD_TUNNEL_URL = '[^']*';/, `export const CLOUD_TUNNEL_URL = '${url}';`);
      fs.writeFileSync(waiterClientPath, clientContent, 'utf8');
    }
  } catch (err) {
    console.warn('Could not save remote_url.txt or update waiter client:', err.message);
  }

  // Sync active tunnel URL to Firebase Firestore so remote clients (Netlify, Mobile APK, Waiter) stay connected
  try {
    const fbBody = JSON.stringify({
      fields: {
        items_summary: { stringValue: url },
        department: { stringValue: 'cloud_tunnel_url' },
        status: { stringValue: 'active' },
        updated_at: { stringValue: new Date().toISOString() }
      }
    });
    const fbUrl = new URL('https://firestore.googleapis.com/v1/projects/hotelcitypark-crm/databases/(default)/documents/room_charges_inbox/cloud_tunnel_url?key=AIzaSyCtZnkdk1_q8rWrISnD8P2Rhi-jcPn1QTI');
    const fbReq = https.request(fbUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(fbBody)
      }
    }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('🔥 [Firebase Cloud Sync] Active Tunnel URL registered to Firestore.');
      } else {
        console.warn('[Firebase Sync Warning]: Status', res.statusCode);
      }
    });
    fbReq.on('error', (err) => console.warn('[Firebase Sync Error]:', err.message));
    fbReq.write(fbBody);
    fbReq.end();
  } catch (e) {
    console.warn('[Firebase Tunnel Sync Notice]:', e.message);
  }

  console.log('\n==================================================================');
  console.log('       HOTEL CITY PARK - WORLDWIDE CLOUD ACCESS IS LIVE!         ');
  console.log('==================================================================');
  console.log('  🌐 Global Tunnel URL:    ' + url);
  console.log('  ----------------------------------------------------------------');
  console.log('  👑 Admin / Owner:        ' + url + '/admin/');
  console.log('  🏨 Front Desk CRM:       ' + url + '/hospitality');
  console.log('  🍽️ Restaurant POS:       ' + url + '/restaurant');
  console.log('  🍸 Bar POS:              ' + url + '/bar');
  console.log('  📦 Storeman Panel:       ' + url + '/storeman');
  console.log('  ⬇️ Download Apps & EXE:  ' + url + '/download.html');
  console.log('==================================================================\n');
}

function startTunnel() {
  console.log('🌐 Starting Cloudflare Worldwide Tunnel on port 3000...');
  const proc = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:3000'], {
    cwd: rootDir,
    windowsHide: true
  });

  const onData = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && (!activeUrl || activeUrl !== match[0])) {
      saveRemoteUrl(match[0]);
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    console.warn(`Tunnel process exited with code ${code}. Restarting in 5 seconds...`);
    activeUrl = null;
    setTimeout(startTunnel, 5000);
  });

  proc.on('error', (err) => {
    console.error('Tunnel error:', err.message);
  });

  return proc;
}

if (require.main === module) {
  startTunnel();
}

module.exports = { startTunnel, saveRemoteUrl };
