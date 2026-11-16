const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { openDb, verifyPassword } = require('./db');
const { fileToHtml } = require('./importer');

const MAX_TITLE = 200;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function createApp({ dbFile = ':memory:', secret = crypto.randomBytes(32).toString('hex') } = {}) {
  const db = openDb(dbFile);
  const app = express();

  // --- Session: signed cookie "<userId>.<hmac>" (stateless, no session table needed) ---
  const sign = (id) => `${id}.${crypto.createHmac('sha256', secret).update(String(id)).digest('hex')}`;
  const readSession = (req) => {
    const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
    if (!raw) return null;
    const value = decodeURIComponent(raw.slice(4));
    const id = Number(value.split('.')[0]);
    const expected = sign(id);
    if (!Number.isInteger(id) || value.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected)) ? id : null;
  };

  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/vendor/quill', express.static(path.join(__dirname, '..', 'node_modules', 'quill', 'dist')));

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') throw httpError(400, 'Email and password are required.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) throw httpError(401, 'Invalid email or password.');
    res.cookie('sid', sign(user.id), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 864e5 });
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie('sid');
    res.status(204).end();
  });

  // Everything below requires a signed-in user.
  app.use('/api', (req, res, next) => {
    const id = readSession(req);
    req.user = id && db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id);
    if (!req.user) return next(httpError(401, 'Please sign in.'));
    next();
  });

  app.get('/api/me', (req, res) => res.json(req.user));

  app.get('/api/users', (req, res) => {
    res.json(db.prepare('SELECT id, email, name FROM users WHERE id != ? ORDER BY name').all(req.user.id));
  });

  // Returns { doc, role } where role is owner | editor | viewer; 404 if no access (don't leak existence).
  function access(req, minRole) {
    const id = Number(req.params.id);
    const doc = Number.isInteger(id) && db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!doc) throw httpError(404, 'Document not found.');
    let role = doc.owner_id === req.user.id ? 'owner'
      : db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?').get(id, req.user.id)?.role;
    if (!role) throw httpError(404, 'Document not found.');
    const rank = { viewer: 0, editor: 1, owner: 2 };
    if (rank[role] < rank[minRole]) throw httpError(403, `This action needs ${minRole} access.`);
    return { doc, role };
  }

  function cleanTitle(title) {
    if (typeof title !== 'string' || !title.trim()) throw httpError(400, 'Title cannot be empty.');
    if (title.trim().length > MAX_TITLE) throw httpError(400, `Title must be ${MAX_TITLE} characters or fewer.`);
    return title.trim();
  }

  function createDoc(ownerId, title, content) {
    const { lastInsertRowid } = db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)')
      .run(ownerId, title, JSON.stringify(content));
    return db.prepare('SELECT id, title, version FROM documents WHERE id = ?').get(lastInsertRowid);
  }

  app.get('/api/documents', (req, res) => {
    const owned = db.prepare(`
      SELECT d.id, d.title, d.updated_at, (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id) AS share_count
      FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`).all(req.user.id);
    const shared = db.prepare(`
      SELECT d.id, d.title, d.updated_at, s.role, u.name AS owner_name
      FROM shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
      WHERE s.user_id = ? ORDER BY d.updated_at DESC`).all(req.user.id);
    res.json({ owned, shared });
  });

  app.post('/api/documents', (req, res) => {
    const title = req.body?.title === undefined ? 'Untitled document' : cleanTitle(req.body.title);
    res.status(201).json(createDoc(req.user.id, title, { ops: [{ insert: '\n' }] }));
  });

  // Upload: raw file body + ?name=<filename>. Creates a new document from .txt / .md / .docx.
  app.post('/api/documents/import', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    const name = String(req.query.name || '');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'The uploaded file is empty.');
    const html = await fileToHtml(name, req.body);
    const title = cleanTitle(path.basename(name, path.extname(name)).slice(0, MAX_TITLE) || 'Imported document');
    res.status(201).json(createDoc(req.user.id, title, { html }));
  });

  app.get('/api/documents/:id', (req, res) => {
    const { doc, role } = access(req, 'viewer');
    const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(doc.owner_id);
    const shares = role === 'owner'
      ? db.prepare(`SELECT u.id, u.name, u.email, s.role FROM shares s JOIN users u ON u.id = s.user_id
                    WHERE s.document_id = ? ORDER BY u.name`).all(doc.id)
      : undefined;
    res.json({ id: doc.id, title: doc.title, content: JSON.parse(doc.content), version: doc.version,
      updated_at: doc.updated_at, role, owner, shares });
  });

  // Save. Optimistic concurrency: client sends the version it last saw; a mismatch means someone else saved.
  app.put('/api/documents/:id', (req, res) => {
    const { doc } = access(req, 'editor');
    const { title, content, version } = req.body || {};
    if (!Number.isInteger(version)) throw httpError(400, 'version is required.');
    if (content !== undefined && !Array.isArray(content?.ops)) throw httpError(400, 'content must be a Quill Delta ({ ops: [...] }).');
    if (title === undefined && content === undefined) throw httpError(400, 'Nothing to update.');
    const result = db.prepare(`
      UPDATE documents SET title = ?, content = ?, version = version + 1, updated_at = datetime('now')
      WHERE id = ? AND version = ?`).run(
      title === undefined ? doc.title : cleanTitle(title),
      content === undefined ? doc.content : JSON.stringify(content),
      doc.id, version);
    if (!result.changes) throw httpError(409, 'This document was changed by someone else. Reload to get the latest version.');
    res.json(db.prepare('SELECT id, title, version, updated_at FROM documents WHERE id = ?').get(doc.id));
  });

  app.delete('/api/documents/:id', (req, res) => {
    const { doc } = access(req, 'owner');
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    res.status(204).end();
  });

  app.post('/api/documents/:id/shares', (req, res) => {
    const { doc } = access(req, 'owner');
    const { email, role } = req.body || {};
    if (!['viewer', 'editor'].includes(role)) throw httpError(400, 'Role must be "viewer" or "editor".');
    const target = typeof email === 'string' && db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!target) throw httpError(404, 'No user with that email.');
    if (target.id === doc.owner_id) throw httpError(400, 'The owner already has full access.');
    db.prepare(`INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)
                ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`).run(doc.id, target.id, role);
    res.status(201).json({ ...target, role });
  });

  app.delete('/api/documents/:id/shares/:userId', (req, res) => {
    const { doc } = access(req, 'owner');
    db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?').run(doc.id, Number(req.params.userId));
    res.status(204).end();
  });

  app.use('/api', (req, res, next) => next(httpError(404, 'Not found.')));

  // Express 5 forwards both thrown errors and async rejections here.
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side.' : err.message });
  });

  return app;
}

module.exports = { createApp };
