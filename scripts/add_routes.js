const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'server.js');
let content = fs.readFileSync(serverFile, 'utf8');

const target1 = 'async function startServer() {';
const insertion1 = `// -------------------------------------------------------------
// STOREMAN PANEL & ADMIN PANEL DIRECT ROUTES
// -------------------------------------------------------------
app.get(['/storeman', '/storeman/index.html', '/storeman.html', '/store', '/store/'], (req, res) => {
  const storePath = fs.existsSync(path.join(__dirname, 'store_index.html'))
    ? path.join(__dirname, 'store_index.html')
    : path.join(publicDir, 'store_index.html');
  res.sendFile(storePath);
});

app.get(['/store-admin', '/store-admin/index.html', '/store_admin_index.html'], (req, res) => {
  const storeAdminPath = fs.existsSync(path.join(__dirname, 'store_admin_index.html'))
    ? path.join(__dirname, 'store_admin_index.html')
    : path.join(publicDir, 'store_admin_index.html');
  res.sendFile(storeAdminPath);
});

app.get('/supabase.js', (req, res) => {
  const spPath = fs.existsSync(path.join(__dirname, 'supabase.js'))
    ? path.join(__dirname, 'supabase.js')
    : path.join(publicDir, 'supabase.js');
  res.sendFile(spPath);
});

// Admin Panel redirection to port 8081 (Admin Server)
app.get(['/admin', '/admin/'], (req, res) => {
  res.redirect('http://localhost:8081');
});

async function startServer() {`;

const target2 = 'console.log(`⚙️ Manage Rooms (Owner): http://localhost:${PORT}/manage`);';
const insertion2 = `console.log(\`⚙️ Manage Rooms (Owner): http://localhost:\${PORT}/manage\`);
    console.log(\`📦 Storeman Panel: http://localhost:\${PORT}/storeman\`);
    console.log(\`📋 Store Admin Panel: http://localhost:\${PORT}/store-admin\`);
    console.log(\`📱 Admin / Owner Panel: http://localhost:8081\`);`;

if (!content.includes('/storeman')) {
  content = content.replace(target1, insertion1);
  content = content.replace(target2, insertion2);
  fs.writeFileSync(serverFile, content, 'utf8');
  console.log('server.js updated successfully!');
} else {
  console.log('server.js already contains /storeman');
}
