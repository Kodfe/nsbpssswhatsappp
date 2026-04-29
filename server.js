const crypto = require('crypto');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');

process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '.cache', 'puppeteer');

const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nsb@admin123';
const API_TOKEN = process.env.API_TOKEN || crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 32);
const DEFAULT_TO = normalizeNumber(process.env.DEFAULT_TO || '');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const CHROME_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '';

let client;
let status = 'booting';
let lastQr = '';
let lastQrDataUrl = '';
let connectedNumber = '';
let lastError = '';

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

function sign(value) {
  return crypto.createHmac('sha256', ADMIN_PASSWORD).update(value).digest('hex');
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const idx = part.indexOf('=');
    return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1))];
  }));
}

function isAuthed(req) {
  const token = parseCookies(req).wa_auth || '';
  return token === sign('ok');
}

function requirePageAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.send(loginPage(req.query.error));
}

function requireApiAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const token = bearer || req.headers['x-api-token'] || req.query.token;
  if (token === API_TOKEN) return next();
  res.status(401).json({ ok: false, error: 'Invalid API token' });
}

function normalizeNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function chatIdFor(number) {
  const normalized = normalizeNumber(number);
  return normalized ? `${normalized}@c.us` : '';
}

function publicUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/$/, '');
}

function html(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f4f6f8;color:#111827}
    main{max-width:880px;margin:0 auto;padding:28px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:14px 0;box-shadow:0 8px 24px rgba(15,23,42,.06)}
    h1{font-size:24px;margin:0 0 4px} h2{font-size:16px;margin:0 0 12px}
    p{color:#6b7280;font-size:14px;line-height:1.5}
    label{display:block;font-size:12px;font-weight:700;color:#6b7280;margin:12px 0 6px;text-transform:uppercase}
    input{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:10px;font-size:14px}
    button,.btn{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;padding:10px 14px;font-weight:700;text-decoration:none;cursor:pointer}
    .primary{background:#f59e0b;color:white}.danger{background:#ef4444;color:white}.ghost{background:#f3f4f6;color:#374151}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.mono{font-family:Consolas,monospace}
    .ok{color:#16a34a}.warn{color:#d97706}.bad{color:#dc2626}
    .qr{width:260px;height:260px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;background:white}
    code{background:#f3f4f6;padding:2px 5px;border-radius:5px}
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function loginPage(error) {
  return html('NSB WhatsApp Alerts', `
    <div class="card" style="max-width:420px;margin:80px auto">
      <h1>NSB WhatsApp Alerts</h1>
      <p>Login with the same admin password used in NSB POS.</p>
      ${error ? '<p class="bad">Incorrect password</p>' : ''}
      <form method="post" action="/login">
        <label>Admin Password</label>
        <input type="password" name="password" autofocus />
        <div style="margin-top:14px"><button class="primary">Login</button></div>
      </form>
    </div>
  `);
}

function dashboardPage(req) {
  const baseUrl = publicUrl(req);
  const apiUrl = `${baseUrl}/api/stock-low`;
  const sender = connectedNumber || 'Not connected yet';
  const receiver = DEFAULT_TO || 'Set DEFAULT_TO or send "to" from POS settings';
  const sameNumberWarning = connectedNumber && DEFAULT_TO && normalizeNumber(connectedNumber) === normalizeNumber(DEFAULT_TO);
  return html('NSB WhatsApp Alerts', `
    <h1>NSB WhatsApp Alerts</h1>
    <p>Connect a WhatsApp sender number, copy the API link, then paste it into NSB POS Settings.</p>

    <div class="card">
      <h2>Status</h2>
      <p>Status: <strong class="${status === 'ready' ? 'ok' : status === 'failed' ? 'bad' : 'warn'}">${status}</strong></p>
      <p>Sending number: <strong>${sender}</strong></p>
      <p>Default receiving number: <strong>${receiver}</strong></p>
      ${sameNumberWarning ? '<p class="bad">Sending and receiving numbers must be different.</p>' : ''}
      ${lastError ? `<p class="bad">${lastError}</p>` : ''}
      <div class="row">
        <form method="post" action="/restart"><button class="ghost">Restart WhatsApp</button></form>
        <form method="post" action="/unlink" onsubmit="return confirm('Unlink this WhatsApp session?')"><button class="danger">Delink / Change WhatsApp</button></form>
        <a class="btn ghost" href="/logout">Logout</a>
      </div>
    </div>

    <div class="card">
      <h2>Connect WhatsApp</h2>
      ${lastQrDataUrl && status !== 'ready' ? `<img class="qr" src="${lastQrDataUrl}" alt="WhatsApp QR" /><p>Scan this QR from WhatsApp > Linked devices.</p>` : '<p>No QR right now. If not connected, click Restart WhatsApp.</p>'}
    </div>

    <div class="card">
      <h2>API Link for NSB POS Settings</h2>
      <label>Gateway API Link</label>
      <input readonly value="${baseUrl}" onclick="this.select()" class="mono" />
      <label>API Token</label>
      <input readonly value="${API_TOKEN}" onclick="this.select()" class="mono" />
      <p>In NSB POS Settings, paste the API link, token, and receiving number. The receiving number must not be the same as the WhatsApp number connected above.</p>
      <form method="post" action="/test" class="row">
        <input name="to" placeholder="Test receiving number with country code" value="${DEFAULT_TO}" style="max-width:260px" />
        <button class="primary">Send Test</button>
      </form>
    </div>
  `);
}

async function startClient() {
  status = 'starting';
  lastError = '';
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      ...(CHROME_EXECUTABLE_PATH ? { executablePath: CHROME_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', async qr => {
    status = 'qr';
    lastQr = qr;
    lastQrDataUrl = await qrcode.toDataURL(qr);
  });

  client.on('ready', () => {
    status = 'ready';
    lastQr = '';
    lastQrDataUrl = '';
    connectedNumber = client.info?.wid?.user || '';
  });

  client.on('authenticated', () => { status = 'authenticated'; });
  client.on('auth_failure', msg => { status = 'failed'; lastError = String(msg || 'Authentication failed'); });
  client.on('disconnected', reason => { status = 'disconnected'; lastError = String(reason || 'Disconnected'); });

  await client.initialize();
}

async function stopClient(logout) {
  if (!client) return;
  try {
    if (logout) await client.logout();
  } catch {}
  try { await client.destroy(); } catch {}
  client = null;
  connectedNumber = '';
  lastQr = '';
  lastQrDataUrl = '';
}

app.post('/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.redirect('/?error=1');
  res.setHeader('Set-Cookie', `wa_auth=${encodeURIComponent(sign('ok'))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'wa_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.redirect('/');
});

app.get('/', requirePageAuth, (req, res) => res.send(dashboardPage(req)));

app.post('/restart', requirePageAuth, async (req, res) => {
  await stopClient(false);
  startClient().catch(err => { status = 'failed'; lastError = err.message; });
  res.redirect('/');
});

app.post('/unlink', requirePageAuth, async (req, res) => {
  await stopClient(true);
  startClient().catch(err => { status = 'failed'; lastError = err.message; });
  res.redirect('/');
});

app.post('/test', requirePageAuth, async (req, res) => {
  const to = chatIdFor(req.body.to || DEFAULT_TO);
  if (!client || status !== 'ready') return res.send(html('Test failed', '<p>WhatsApp is not ready.</p><p><a href="/">Back</a></p>'));
  if (!to) return res.send(html('Test failed', '<p>Enter a receiving number.</p><p><a href="/">Back</a></p>'));
  if (connectedNumber && normalizeNumber(connectedNumber) === normalizeNumber(req.body.to || DEFAULT_TO)) {
    return res.send(html('Test failed', '<p>Sending and receiving numbers must be different.</p><p><a href="/">Back</a></p>'));
  }
  await client.sendMessage(to, 'NSB POS WhatsApp alert test message.');
  res.send(html('Test sent', '<p>Test message sent.</p><p><a href="/">Back</a></p>'));
});

app.get('/api/status', requireApiAuth, (req, res) => {
  res.json({ ok: true, status, connectedNumber, apiUrl: `${publicUrl(req)}/api/stock-low` });
});

app.post('/api/stock-low', requireApiAuth, async (req, res) => {
  if (!client || status !== 'ready') return res.status(503).json({ ok: false, error: 'WhatsApp is not ready' });
  const product = req.body.product || {};
  const toNumber = normalizeNumber(req.body.to || DEFAULT_TO);
  if (!toNumber) return res.status(400).json({ ok: false, error: 'Receiving number is required' });
  if (connectedNumber && normalizeNumber(connectedNumber) === toNumber) {
    return res.status(400).json({ ok: false, error: 'Sending and receiving numbers must be different' });
  }
  const stock = Number(product.stock ?? 0);
  const minStock = Number(product.minStock ?? 5);
  const message = [
    'NSB POS LOW STOCK ALERT',
    `Product: ${product.name || 'Unknown product'}`,
    product.barcode ? `Barcode: ${product.barcode}` : '',
    `Current stock: ${stock} ${product.unit || ''}`.trim(),
    `Minimum stock: ${minStock} ${product.unit || ''}`.trim(),
  ].filter(Boolean).join('\n');

  await client.sendMessage(chatIdFor(toNumber), message);
  res.json({ ok: true, sent: true });
});

startClient().catch(err => { status = 'failed'; lastError = err.message; });
app.listen(PORT, () => console.log(`NSB WhatsApp alert gateway running on ${PUBLIC_URL || `http://localhost:${PORT}`}`));
