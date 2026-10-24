const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const APKS_DIR = path.join(ROOT_DIR, 'apks');

if (!fs.existsSync(APKS_DIR)) {
  fs.mkdirSync(APKS_DIR, { recursive: true });
}

function getNewestFile(candidates) {
  let newest = null;
  let newestMtime = 0;

  for (const c of candidates) {
    const fullPath = path.isAbsolute(c) ? c : path.join(ROOT_DIR, c);
    if (fs.existsSync(fullPath)) {
      try {
        const stats = fs.statSync(fullPath);
        if (stats.size > 0 && stats.mtimeMs > newestMtime) {
          newest = fullPath;
          newestMtime = stats.mtimeMs;
        }
      } catch (err) {
        // ignore read error
      }
    }
  }
  return newest;
}

function syncApk(name, targetFilename, candidates) {
  const newestSrc = getNewestFile(candidates);
  const targetPath = path.join(APKS_DIR, targetFilename);

  if (!newestSrc) {
    console.warn(`[!] No source APK found for ${name}`);
    return;
  }

  const srcStat = fs.statSync(newestSrc);
  let needsCopy = true;

  if (fs.existsSync(targetPath)) {
    const targetStat = fs.statSync(targetPath);
    if (targetStat.mtimeMs >= srcStat.mtimeMs && targetStat.size === srcStat.size) {
      needsCopy = false;
    }
  }

  if (needsCopy) {
    fs.copyFileSync(newestSrc, targetPath);
    console.log(`[+] Updated ${name} -> apks/${targetFilename} (${(srcStat.size / (1024 * 1024)).toFixed(2)} MB)`);
  } else {
    console.log(`[=] ${name} is already up to date in apks/${targetFilename} (${(srcStat.size / (1024 * 1024)).toFixed(2)} MB)`);
  }
}

console.log('=== Hotel City Park - APK Sync ===');
console.log(`Destination Folder: ${APKS_DIR}\n`);

// 1. Waiter APK
syncApk('Waiter', 'HotelCityPark-Waiter.apk', [
  'release-electron/Hotel City Park CRM-win32-x64/waiter-pannel/android/app/build/outputs/apk/debug/app-debug.apk',
  'release-electron/Hotel City Park CRM-win32-x64/waiter-pannel/android/app/build/outputs/apk/release/app-release.apk',
  'Hotel-City-Park-Waiter.apk',
  'HotelCityPark-Waiter.apk'
]);

// 2. Admin / Owner APK
syncApk('Admin', 'HotelCityPark-Admin.apk', [
  'admin/android/app/build/outputs/apk/release/app-release.apk',
  'admin/android/app/build/outputs/apk/debug/app-debug.apk',
  'admin/HotelCityPark-Owner.apk',
  'HotelCityPark-Owner.apk'
]);
syncApk('Owner', 'HotelCityPark-Owner.apk', [
  'admin/android/app/build/outputs/apk/release/app-release.apk',
  'admin/android/app/build/outputs/apk/debug/app-debug.apk',
  'admin/HotelCityPark-Owner.apk',
  'HotelCityPark-Owner.apk'
]);

// 3. Storeman APK
syncApk('Storeman', 'HotelCityPark-Storeman.apk', [
  'Storeman.apk',
  'dist/Storeman.apk',
  'public/Storeman.apk'
]);

console.log('\nAll APKs in apks folder:');
fs.readdirSync(APKS_DIR).forEach(file => {
  const p = path.join(APKS_DIR, file);
  const s = fs.statSync(p);
  console.log(` - ${file.padEnd(30)} ${(s.size / (1024 * 1024)).toFixed(2)} MB   (Modified: ${s.mtime.toLocaleString()})`);
});
