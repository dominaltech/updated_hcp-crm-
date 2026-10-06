/**
 * scripts/update_release.js
 * 
 * Synchronizes and updates the standalone Windows release bundle in the /release directory.
 * 1. Builds latest React frontend bundle with Vite.
 * 2. Syncs compiled assets & CSS into release/dist and release/public.
 * 3. Syncs updated server.js, database.js, services, and middleware into release/.
 * 4. Verifies syntax and bundle integrity.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');

console.log('🚀 Starting Hotel City Park CRM Release Update...\n');

// 1. Build frontend with Vite
console.log('📦 [1/5] Building React client bundle with Vite...');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  console.log('✅ Vite client build completed.\n');
} catch (err) {
  console.error('❌ Vite build failed:', err.message);
  process.exit(1);
}

// Helper for copying directory contents
function copyDirSync(src, dest, filterFn = null) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filterFn && !filterFn(srcPath, entry.name, entry.isDirectory())) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, filterFn);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 2. Sync CSS & Static Assets
console.log('🎨 [2/5] Synchronizing latest CSS and static assets...');
const rootCssPath = path.join(publicDir, 'styles.css');
if (fs.existsSync(rootCssPath)) {
  fs.copyFileSync(rootCssPath, path.join(distDir, 'styles.css'));
  fs.copyFileSync(rootCssPath, path.join(releaseDir, 'public', 'styles.css'));
  fs.copyFileSync(rootCssPath, path.join(releaseDir, 'dist', 'styles.css'));
  console.log('  ✓ styles.css synchronized across public, dist, and release.');
}

// Copy public assets (images, icons, worker scripts) to release/public and release/dist
const assetFilter = (_, name, isDir) => isDir || /\.(png|ico|jpg|jpeg|svg|webp|gif|css|html|txt|js)$/i.test(name);
copyDirSync(publicDir, path.join(releaseDir, 'public'), assetFilter);
copyDirSync(publicDir, path.join(releaseDir, 'dist'), assetFilter);
console.log('✅ Static assets synchronized.\n');

// 3. Sync Dist Bundle to release/dist
console.log('⚡ [3/5] Updating release/dist bundle...');
const releaseAssetsDir = path.join(releaseDir, 'dist', 'assets');
if (fs.existsSync(releaseAssetsDir)) {
  // Remove old JS chunks to avoid stale file accumulation
  const oldFiles = fs.readdirSync(releaseAssetsDir);
  for (const f of oldFiles) {
    if ((f.startsWith('index-') || f.startsWith('pdf-')) && f.endsWith('.js')) {
      fs.unlinkSync(path.join(releaseAssetsDir, f));
      console.log(`  - Removed stale asset: ${f}`);
    }
  }
} else {
  fs.mkdirSync(releaseAssetsDir, { recursive: true });
}

// Copy new dist bundle assets
copyDirSync(path.join(distDir, 'assets'), releaseAssetsDir);
fs.copyFileSync(path.join(distDir, 'index.html'), path.join(releaseDir, 'dist', 'index.html'));
console.log('✅ Dist bundle updated in release/dist.\n');

// 4. Sync Server, Database, Services, Middleware
console.log('⚙️ [4/5] Synchronizing server, database, services, and middleware...');
fs.copyFileSync(path.join(rootDir, 'server.js'), path.join(releaseDir, 'server.js'));
console.log('  ✓ release/server.js updated');

fs.copyFileSync(path.join(rootDir, 'database.js'), path.join(releaseDir, 'database.js'));
console.log('  ✓ release/database.js updated');

fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(releaseDir, 'package.json'));
console.log('  ✓ release/package.json updated');

copyDirSync(path.join(rootDir, 'services'), path.join(releaseDir, 'services'));
console.log('  ✓ release/services updated');

copyDirSync(path.join(rootDir, 'middleware'), path.join(releaseDir, 'middleware'));
console.log('  ✓ release/middleware updated');

copyDirSync(path.join(rootDir, 'electron'), path.join(releaseDir, 'electron'));
console.log('  ✓ release/electron updated');

if (fs.existsSync(path.join(rootDir, '.env'))) {
  fs.copyFileSync(path.join(rootDir, '.env'), path.join(releaseDir, '.env'));
  console.log('  ✓ release/.env updated');
}

// Compile latest HotelCityPark.exe launcher if csc is available
const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];
const cscExe = cscCandidates.find(p => fs.existsSync(p));
const launcherSource = path.join(rootDir, 'Launcher.cs');
const targetExe = path.join(releaseDir, 'HotelCityPark.exe');
const iconFile = path.join(releaseDir, 'app_icon.ico');

if (cscExe && fs.existsSync(launcherSource)) {
  try {
    const iconArg = fs.existsSync(iconFile) ? ` /win32icon:"${iconFile}"` : '';
    execSync(`"${cscExe}" /nologo /target:exe /out:"${targetExe}"${iconArg} "${launcherSource}"`, { stdio: 'pipe' });
    console.log('  ✓ release/HotelCityPark.exe launcher re-compiled successfully.');
  } catch (err) {
    console.warn('  ⚠️ Note: Could not recompile Launcher.cs with csc:', err.message);
  }
}
// Also sync to standalone Electron package if present
const electronAppDir = path.join(rootDir, 'release-electron', 'Hotel City Park CRM-win32-x64', 'resources', 'app');
if (fs.existsSync(electronAppDir)) {
  console.log('⚡ Synchronizing Electron desktop application bundle (release-electron)...');
  copyDirSync(publicDir, path.join(electronAppDir, 'public'), assetFilter);
  copyDirSync(publicDir, path.join(electronAppDir, 'dist'), assetFilter);
  
  const electronAssetsDir = path.join(electronAppDir, 'dist', 'assets');
  if (fs.existsSync(electronAssetsDir)) {
    const oldFiles = fs.readdirSync(electronAssetsDir);
    for (const f of oldFiles) {
      if (f.startsWith('index-') && f.endsWith('.js')) {
        fs.unlinkSync(path.join(electronAssetsDir, f));
      }
    }
  } else {
    fs.mkdirSync(electronAssetsDir, { recursive: true });
  }
  copyDirSync(path.join(distDir, 'assets'), electronAssetsDir);
  fs.copyFileSync(path.join(distDir, 'index.html'), path.join(electronAppDir, 'dist', 'index.html'));

  fs.copyFileSync(path.join(rootDir, 'server.js'), path.join(electronAppDir, 'server.js'));
  fs.copyFileSync(path.join(rootDir, 'database.js'), path.join(electronAppDir, 'database.js'));
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(electronAppDir, 'package.json'));
  copyDirSync(path.join(rootDir, 'services'), path.join(electronAppDir, 'services'));
  copyDirSync(path.join(rootDir, 'middleware'), path.join(electronAppDir, 'middleware'));
  copyDirSync(path.join(rootDir, 'electron'), path.join(electronAppDir, 'electron'));
  if (fs.existsSync(path.join(rootDir, '.env'))) {
    fs.copyFileSync(path.join(rootDir, '.env'), path.join(electronAppDir, '.env'));
  }
  // Remove src folder in packaged app so it runs pure compiled production code
  const electronSrcDir = path.join(electronAppDir, 'src');
  if (fs.existsSync(electronSrcDir)) {
    try {
      fs.rmSync(electronSrcDir, { recursive: true, force: true });
      console.log('  ✓ Cleaned src directory from release-electron package for ultra-fast startup');
    } catch (e) {}
  }
  console.log('  ✓ release-electron desktop bundle updated.');
}

console.log('✅ Backend code and configurations synchronized.\n');

// 5. Verification & Integrity Check
console.log('🔍 [5/5] Running release verification and integrity checks...');

// Check syntax of release/server.js
try {
  execSync('node -c release/server.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('  ✓ release/server.js syntax OK');
} catch (e) {
  console.error('❌ Syntax error in release/server.js:', e.message);
  process.exit(1);
}

// Check syntax of release/database.js
try {
  execSync('node -c release/database.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('  ✓ release/database.js syntax OK');
} catch (e) {
  console.error('❌ Syntax error in release/database.js:', e.message);
  process.exit(1);
}

// Verify index.html points to an existing asset
const indexHtmlContent = fs.readFileSync(path.join(releaseDir, 'dist', 'index.html'), 'utf8');
const assetMatch = indexHtmlContent.match(/assets\/index-[^"']+\.js/);
if (assetMatch) {
  const referencedAsset = assetMatch[0];
  const fullAssetPath = path.join(releaseDir, 'dist', referencedAsset);
  if (fs.existsSync(fullAssetPath)) {
    console.log(`  ✓ HTML asset reference verified: ${referencedAsset}`);
  } else {
    console.error(`❌ HTML references missing asset: ${referencedAsset}`);
    process.exit(1);
  }
} else {
  console.warn('⚠️ Could not extract asset reference from release/dist/index.html');
}

// Verify launcher and startup scripts exist
const requiredReleaseFiles = [
  'HotelCityPark.exe',
  'START_CRM.bat',
  'Stop_HotelCityPark.bat',
  'README_RELEASE.txt',
  'server.js',
  'database.js'
];

for (const reqFile of requiredReleaseFiles) {
  if (fs.existsSync(path.join(releaseDir, reqFile))) {
    console.log(`  ✓ Required release file present: ${reqFile}`);
  } else {
    console.error(`❌ Missing required release file: ${reqFile}`);
    process.exit(1);
  }
}

console.log('\n========================================================================');
console.log('🎉 HOTEL CITY PARK CRM RELEASE SUCCESSFULLY UPDATED!');
console.log('   All frontend, backend, database schema, and assets are in sync.');
console.log('   Users can launch the updated CRM via release/HotelCityPark.exe');
console.log('========================================================================\n');
