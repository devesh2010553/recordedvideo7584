// store.js — MongoDB-backed data store via Mongoose
// All data survives redeploys. Set MONGODB_URI in env.

const mongoose = require('mongoose');
const crypto = require('crypto');

// ---- Connection ----

let connected = false;

async function connect() {
  if (connected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to your environment variables.');
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  connected = true;
  console.log('MongoDB connected');
}

// ---- Schemas ----

const locationPointSchema = new mongoose.Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracy: { type: Number, default: null },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  label: { type: String, default: 'Untitled link' },
  createdAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: false },
  startedAt: { type: Date, default: null },
  stoppedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },
  locations: [locationPointSchema],
});

const adminSubSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    auth: String,
    p256dh: String,
  },
  expirationTime: { type: Number, default: null },
});

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
const AdminSub = mongoose.models.AdminSub || mongoose.model('AdminSub', adminSubSchema);

// ---- Helper: plain JS object matching old API shape ----

function toPlain(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : doc;
  // Normalize dates to ISO strings and expose locations with ISO timestamps
  return {
    id: obj.id,
    label: obj.label,
    createdAt: obj.createdAt instanceof Date ? obj.createdAt.toISOString() : obj.createdAt,
    active: obj.active,
    startedAt: obj.startedAt instanceof Date ? obj.startedAt.toISOString() : obj.startedAt,
    stoppedAt: obj.stoppedAt instanceof Date ? obj.stoppedAt.toISOString() : obj.stoppedAt,
    lastSeenAt: obj.lastSeenAt instanceof Date ? obj.lastSeenAt.toISOString() : obj.lastSeenAt,
    locations: (obj.locations || []).map(p => ({
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
    })),
  };
}

// ---- Sessions ----

async function createSession(label) {
  await connect();
  const id = crypto.randomBytes(16).toString('base64url');
  const session = await Session.create({ id, label: label || 'Untitled link' });
  return toPlain(session);
}

async function getSession(id) {
  await connect();
  const session = await Session.findOne({ id });
  return toPlain(session);
}

async function listSessions() {
  await connect();
  const sessions = await Session.find().sort({ createdAt: -1 });
  return sessions.map(toPlain);
}

async function deleteSession(id) {
  await connect();
  await Session.deleteOne({ id });
}

async function startSharing(id) {
  await connect();
  const session = await Session.findOneAndUpdate(
    { id },
    { active: true, startedAt: new Date(), stoppedAt: null },
    { new: true }
  );
  return toPlain(session);
}

async function stopSharing(id) {
  await connect();
  const session = await Session.findOneAndUpdate(
    { id },
    { active: false, stoppedAt: new Date() },
    { new: true }
  );
  return toPlain(session);
}

async function appendLocation(id, point) {
  await connect();
  const session = await Session.findOneAndUpdate(
    { id },
    {
      $push: { locations: point },
      $set: { lastSeenAt: point.timestamp },
    },
    { new: true }
  );
  return toPlain(session);
}

// ---- Admin push subscriptions ----

async function addAdminSubscription(subscription) {
  await connect();
  await AdminSub.updateOne(
    { endpoint: subscription.endpoint },
    { $set: subscription },
    { upsert: true }
  );
}

async function removeAdminSubscription(endpoint) {
  await connect();
  await AdminSub.deleteOne({ endpoint });
}

async function listAdminSubscriptions() {
  await connect();
  const subs = await AdminSub.find();
  return subs.map(s => ({
    endpoint: s.endpoint,
    keys: s.keys,
    expirationTime: s.expirationTime,
  }));
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
