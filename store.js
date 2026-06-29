// store.js
// MongoDB-backed store for live-location sessions, full history, and admin push subscriptions.
// Location histories are kept permanently until the admin deletes them.

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'pulse_location_share';

if (!MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Set it on Render/local .env or the app cannot save sessions/history.');
}

let client;
let db;
let sessions;
let adminSubscriptions;

async function init() {
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  sessions = db.collection('sessions');
  adminSubscriptions = db.collection('adminSubscriptions');

  await Promise.all([
    sessions.createIndex({ id: 1 }, { unique: true }),
    sessions.createIndex({ createdAt: -1 }),
    sessions.createIndex({ active: 1 }),
    adminSubscriptions.createIndex({ endpoint: 1 }, { unique: true }),
  ]);
}

function sessionPublic(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function cryptoRandomId() {
  return crypto.randomBytes(16).toString('base64url');
}

async function createSession(label) {
  const now = new Date().toISOString();
  const doc = {
    id: cryptoRandomId(),
    label: label || 'Untitled link',
    createdAt: now,
    active: false,
    startedAt: null,
    stoppedAt: null,
    lastSeenAt: null,
    lastLocation: null,
    locations: [],
  };
  await sessions.insertOne(doc);
  return sessionPublic(doc);
}

async function getSession(id) {
  return sessionPublic(await sessions.findOne({ id }));
}

async function listSessions() {
  const docs = await sessions.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(sessionPublic);
}

async function deleteSession(id) {
  await sessions.deleteOne({ id });
}

async function clearSessionHistory(id) {
  const doc = await sessions.findOneAndUpdate(
    { id },
    {
      $set: {
        locations: [],
        lastLocation: null,
        lastSeenAt: null,
      },
    },
    { returnDocument: 'after' }
  );
  return sessionPublic(doc);
}

async function startSharing(id) {
  const now = new Date().toISOString();
  const doc = await sessions.findOneAndUpdate(
    { id },
    { $set: { active: true, startedAt: now, stoppedAt: null } },
    { returnDocument: 'after' }
  );
  return sessionPublic(doc);
}

async function stopSharing(id) {
  const now = new Date().toISOString();
  const doc = await sessions.findOneAndUpdate(
    { id },
    { $set: { active: false, stoppedAt: now } },
    { returnDocument: 'after' }
  );
  return sessionPublic(doc);
}

async function appendLocation(id, point) {
  const doc = await sessions.findOneAndUpdate(
    { id },
    {
      $set: {
        active: true,
        lastSeenAt: point.timestamp,
        lastLocation: point,
      },
      $push: { locations: point },
    },
    { returnDocument: 'after' }
  );
  return sessionPublic(doc);
}

async function addAdminSubscription(subscription) {
  await adminSubscriptions.updateOne(
    { endpoint: subscription.endpoint },
    { $set: { ...subscription, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function removeAdminSubscription(endpoint) {
  await adminSubscriptions.deleteOne({ endpoint });
}

async function listAdminSubscriptions() {
  const docs = await adminSubscriptions.find({}).toArray();
  return docs.map(({ _id, updatedAt, ...sub }) => sub);
}

module.exports = {
  init,
  createSession,
  getSession,
  listSessions,
  deleteSession,
  clearSessionHistory,
  startSharing,
  stopSharing,
  appendLocation,
  addAdminSubscription,
  removeAdminSubscription,
  listAdminSubscriptions,
};
