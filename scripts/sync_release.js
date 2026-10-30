const fs = require('fs');
const path = require('path');

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  });
}

console.log('Copying dist to release/dist...');
copyFolderSync('dist', 'release/dist');

const electronDist = 'release-electron/resources/app/dist';
if (fs.existsSync('release-electron/resources/app')) {
  console.log('Copying dist to ' + electronDist);
  copyFolderSync('dist', electronDist);
}

const electronAppDir = 'release-electron/Hotel City Park CRM-win32-x64/resources/app/dist';
if (fs.existsSync('release-electron/Hotel City Park CRM-win32-x64/resources/app')) {
  console.log('Copying dist to ' + electronAppDir);
  copyFolderSync('dist', electronAppDir);
}

if (fs.existsSync('release')) {
  fs.copyFileSync('server.js', 'release/server.js');
  console.log('Copied server.js to release/server.js');
}

console.log('Sync complete!');

