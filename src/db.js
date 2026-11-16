const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const SEED_PASSWORD = 'demo1234';
const SEED_USERS = [
  ['alice@ultimate.test', 'Alice Chen'],
  ['bob@ultimate.test', 'Bob Patel'],
  ['carol@ultimate.test', 'Carol Diaz'],
];

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,           -- JSON: Quill Delta {ops:[...]} or {html:"..."} right after import
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS shares (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      PRIMARY KEY (document_id, user_id)
    );
  `);

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) seed(db);
  return db;
}

function seed(db) {
  const addUser = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)');
  for (const [email, name] of SEED_USERS) addUser.run(email, name, hashPassword(SEED_PASSWORD));

  const welcome = {
    ops: [
      { insert: 'Welcome to Ultimate Docs' }, { insert: '\n', attributes: { header: 1 } },
      { insert: 'This document is owned by ' }, { insert: 'Alice', attributes: { bold: true } },
      { insert: ' and shared with Bob as an editor. Try:\n' },
      { insert: 'Bold, italic and underline formatting' }, { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'Headings and lists' }, { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'Sharing from the Share button' }, { insert: '\n', attributes: { list: 'bullet' } },
    ],
  };
  const doc = db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (1, ?, ?)')
    .run('Welcome to Ultimate Docs', JSON.stringify(welcome));
  db.prepare("INSERT INTO shares (document_id, user_id, role) VALUES (?, 2, 'editor')").run(doc.lastInsertRowid);
}

module.exports = { openDb, verifyPassword, SEED_PASSWORD, SEED_USERS };
