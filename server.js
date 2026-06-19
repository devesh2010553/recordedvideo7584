require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const webpush = require('web-push');
const { WebSocketServer } = require('ws');
const store = require('./store');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn(
    'VAPID keys are not set. Run "npm run generate-vapid" and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY before deploying, or push notifications will not work.'
  );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Tiny signed-cookie admin auth (no extra session store needed) ----------

function sign(value) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${hmac}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const expected = sign(value);
  return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected)) ? value : null;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const value = verify(cookies.admin_session);
  if (value === 'ok') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/admin-login.html');
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    const signed = sign('ok');
    res.setHeader(
      'Set-Cookie',
      `admin_session=${encodeURIComponent(signed)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
    );
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------- Admin API ----------

app.get('/api/admin/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

app.post('/api/admin/subscribe', requireAdmin, (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  store.addAdminSubscription(subscription);
  res.json({ ok: true });
});

app.post('/api/admin/unsubscribe', requireAdmin, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) store.removeAdminSubscription(endpoint);
  res.json({ ok: true });
});

app.get('/api/admin/sessions', requireAdmin, (req, res) => {
  res.json(store.listSessions());
});

app.get('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

app.post('/api/admin/sessions', requireAdmin, (req, res) => {
  const { label } = req.body || {};
  const session = store.createSession(label);
  res.json(session);
});

app.delete('/api/admin/sessions/:id', requireAdmin, (req, res) => {
  store.deleteSession(req.params.id);
  res.json({ ok: true });
});

// ---------- Public share-link routes (token-based, no login for the recipient) ----------

app.get('/share/:id', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).sendFile(path.join(__dirname, 'public', 'link-not-found.html'));
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

app.get('/api/share/:id', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Link not found or expired' });
  res.json({
    id: session.id,
    label: session.label,
    active: session.active,
  });
});

app.post('/api/share/:id/start', async (req, res) => {
  const session = store.startSharing(req.params.id);
  if (!session) return res.status(404).json({ error: 'Link not found or expired' });
  await notifyAdmins({
    title: 'Location sharing started',
    body: `${session.label} started sharing their live location.`,
    sessionId: session.id,
  });
  broadcastToAdmins({ type: 'started', session });
  res.json({ ok: true });
});

app.post('/api/share/:id/location', async (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng are required numbers' });
  }
  const point = { lat, lng, accuracy: accuracy ?? null, timestamp: new Date().toISOString() };
  const session = store.appendLocation(req.params.id, point);
  if (!session) return res.status(404).json({ error: 'Link not found or expired' });
  broadcastToAdmins({ type: 'location', sessionId: session.id, point });
  res.json({ ok: true });
});

app.post('/api/share/:id/stop', async (req, res) => {
  const session = store.stopSharing(req.params.id);
  if (!session) return res.status(404).json({ error: 'Link not found or expired' });
  await notifyAdmins({
    title: 'Location sharing stopped',
    body: `${session.label} stopped sharing their location.`,
    sessionId: session.id,
  });
  broadcastToAdmins({ type: 'stopped', session });
  res.json({ ok: true });
});

// ---------- Web Push ----------

async function notifyAdmins({ title, body, sessionId }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const subscriptions = store.listAdminSubscriptions();
  const payload = JSON.stringify({ title, body, sessionId });
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          store.removeAdminSubscription(sub.endpoint);
        } else {
          console.error('Push error:', err.message);
        }
      }
    })
  );
}

// ---------- WebSocket: live map updates while the admin dashboard is open ----------

const wss = new WebSocketServer({ noServer: true });
const adminSockets = new Set();

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws/admin') return socket.destroy();
  const cookies = parseCookies(req);
  const value = verify(cookies.admin_session);
  if (value !== 'ok') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    adminSockets.add(ws);
    ws.on('close', () => adminSockets.delete(ws));
  });
});

function broadcastToAdmins(message) {
  const data = JSON.stringify(message);
  for (const ws of adminSockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

server.listen(PORT, () => {
  console.log(`Live location share server running on port ${PORT}`);
});
