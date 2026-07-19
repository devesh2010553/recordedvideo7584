require('dotenv').config();

const express = require('express');
const http    = require('http');
const crypto  = require('crypto');
const path    = require('path');
const webpush = require('web-push');
const { WebSocketServer } = require('ws');
const store   = require('./store');

const app    = express();
const server = http.createServer(app);

const PORT           = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn('VAPID keys not set — push notifications will not work.');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Limit anonymous APK session creation without requiring a name or code.
const anonymousCreates = new Map();
function allowAnonymousCreate(req) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (anonymousCreates.get(key) || []).filter(t => now - t < 60 * 60 * 1000);
  if (recent.length >= 10) return false;
  recent.push(now);
  anonymousCreates.set(key, recent);
  return true;
}

// ---- Tiny signed-cookie auth ----

function sign(value) {
  return `${value}.${crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex')}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  try {
    const expected = sign(value);
    if (signed.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected)) ? value : null;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function requireAdmin(req, res, next) {
  const value = verify(parseCookies(req).admin_session);
  if (value === 'ok') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/admin-login.html');
}

// ---- Auth routes ----

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie',
      `admin_session=${encodeURIComponent(sign('ok'))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
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

// ---- Admin API ----

app.get('/api/admin/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

app.post('/api/admin/subscribe', requireAdmin, async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  await store.addAdminSubscription(sub);
  res.json({ ok: true });
});

app.post('/api/admin/unsubscribe', requireAdmin, async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await store.removeAdminSubscription(endpoint);
  res.json({ ok: true });
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  const sessions = await store.listSessions();
  // Don't send full location arrays in the list — too large. Send count instead.
  const slim = sessions.map(s => ({ ...s, locationCount: s.locations.length, locations: undefined }));
  res.json(slim);
});

app.get('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  const session = await store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

app.post('/api/admin/sessions', requireAdmin, async (req, res) => {
  const { label } = req.body || {};
  const session = await store.createSession(label);
  res.json(session);
});

app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  await store.deleteSession(req.params.id);
  broadcastToAdmins({ type: 'deleted', sessionId: req.params.id });
  res.json({ ok: true });
});

// ---- Share-link API (public, token-based) ----

app.get('/share/:id', async (req, res) => {
  const session = await store.getSession(req.params.id);
  if (!session) return res.status(404).sendFile(path.join(__dirname, 'public', 'link-not-found.html'));
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// Consent screen used by the Android APK. It does not request location until
// the recipient taps the start button and grants Android permission.
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.post('/api/app/session', async (req, res) => {
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: 'Explicit consent is required' });
  }
  if (!allowAnonymousCreate(req)) {
    return res.status(429).json({ error: 'Too many new sessions. Try again later.' });
  }
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const session = await store.createSession(`Anonymous ${suffix}`);
  res.status(201).json({ id: session.id, label: session.label });
});

app.get('/api/share/:id', async (req, res) => {
  const session = await store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Link not found' });
  res.json({ id: session.id, label: session.label, active: session.active });
});

// Start sharing — push notification to admin
app.post('/api/share/:id/start', async (req, res) => {
  const session = await store.startSharing(req.params.id);
  if (!session) return res.status(404).json({ error: 'Link not found' });
  await notifyAdmins({
    title: '📍 Location sharing started',
    body: `${session.label} started sharing their location.`,
    sessionId: session.id,
  });
  broadcastToAdmins({ type: 'started', session: { ...session, locations: undefined, locationCount: session.locations.length } });
  res.json({ ok: true });
});

// Location update
app.post('/api/share/:id/location', async (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  const point = { lat, lng, accuracy: accuracy ?? null, timestamp: new Date().toISOString() };
  const session = await store.appendLocation(req.params.id, point);
  if (!session) return res.status(404).json({ error: 'Link not found' });
  broadcastToAdmins({ type: 'location', sessionId: session.id, point });
  res.json({ ok: true });
});

// Stop sharing — push notification to admin
app.post('/api/share/:id/stop', async (req, res) => {
  const session = await store.stopSharing(req.params.id);
  if (!session) return res.status(404).json({ error: 'Link not found' });
  await notifyAdmins({
    title: '📍 Sharing stopped',
    body: `${session.label} stopped sharing their location.`,
    sessionId: session.id,
  });
  broadcastToAdmins({ type: 'stopped', session: { ...session, locations: undefined, locationCount: session.locations.length } });
  res.json({ ok: true });
});

// ---- Web Push ----

async function notifyAdmins({ title, body, sessionId }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const subscriptions = await store.listAdminSubscriptions();
  const payload = JSON.stringify({ title, body, sessionId });
  await Promise.all(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await store.removeAdminSubscription(sub.endpoint);
        } else {
          console.error('Push error:', err.statusCode, err.message);
        }
      }
    })
  );
}

// ---- WebSocket: live updates to admin dashboard ----

const wss = new WebSocketServer({ noServer: true });
const adminSockets = new Set();

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws/admin') return socket.destroy();
  const value = verify(parseCookies(req).admin_session);
  if (value !== 'ok') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => {
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

server.listen(PORT, () => console.log(`Pulse running on port ${PORT}`));
