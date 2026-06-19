// store.js
// Minimal file-backed data store. Good enough for a single-admin tool at
// modest scale. For heavier use, swap this module for a real database
// (Postgres works well on Render) -- the rest of the app only calls the
// functions exported here, so the storage layer is fully swappable.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ sessions: {}, adminSubscriptions: [] }, null, 2));
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse db.json, starting fresh:', err);
    return { sessions: {}, adminSubscriptions: [] };
  }
}

let writeQueue = Promise.resolve();
function writeDb(db) {
  // Serialize writes so concurrent requests don't clobber each other.
  writeQueue = writeQueue.then(() =>
    fs.promises.writeFile(DB_FILE, JSON.stringify(db, null, 2))
  );
  return writeQueue;
}

// ---- Sessions ----

function createSession(label) {
  const db = readDb();
  const id = cryptoRandomId();
  db.sessions[id] = {
    id,
    label: label || 'Untitled link',
    createdAt: new Date().toISOString(),
    active: false,
    startedAt: null,
    stoppedAt: null,
    lastSeenAt: null,
    locations: [], // full history: { lat, lng, accuracy, timestamp }
  };
  writeDb(db);
  return db.sessions[id];
}

function getSession(id) {
  const db = readDb();
  return db.sessions[id] || null;
}

function listSessions() {
  const db = readDb();
  return Object.values(db.sessions).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

function deleteSession(id) {
  const db = readDb();
  delete db.sessions[id];
  writeDb(db);
}

function startSharing(id) {
  const db = readDb();
  const session = db.sessions[id];
  if (!session) return null;
  session.active = true;
  session.startedAt = new Date().toISOString();
  session.stoppedAt = null;
  writeDb(db);
  return session;
}

function stopSharing(id) {
  const db = readDb();
  const session = db.sessions[id];
  if (!session) return null;
  session.active = false;
  session.stoppedAt = new Date().toISOString();
  writeDb(db);
  return session;
}

function appendLocation(id, point) {
  const db = readDb();
  const session = db.sessions[id];
  if (!session) return null;
  session.locations.push(point);
  session.lastSeenAt = point.timestamp;
  writeDb(db);
  return session;
}

// ---- Admin push subscriptions ----

function addAdminSubscription(subscription) {
  const db = readDb();
  const exists = db.adminSubscriptions.some(
    (s) => s.endpoint === subscription.endpoint
  );
  if (!exists) {
    db.adminSubscriptions.push(subscription);
    writeDb(db);
  }
  return db.adminSubscriptions;
}

function removeAdminSubscription(endpoint) {
  const db = readDb();
  db.adminSubscriptions = db.adminSubscriptions.filter(
    (s) => s.endpoint !== endpoint
  );
  writeDb(db);
}

function listAdminSubscriptions() {
  const db = readDb();
  return db.adminSubscriptions;
}

function cryptoRandomId() {
  // URL-safe, unguessable id for share links.
  return require('crypto').randomBytes(16).toString('base64url');
}

module.exports = {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  startSharing,
  stopSharing,
  appendLocation,
  addAdminSubscription,
  removeAdminSubscription,
  listAdminSubscriptions,
};
