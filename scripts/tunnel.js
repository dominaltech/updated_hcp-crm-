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
  } catch (err) {
    console.warn('Could not save remote_url.txt:', err.message);
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
