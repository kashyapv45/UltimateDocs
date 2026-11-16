const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  server = createApp().listen(0); // in-memory SQLite, freshly seeded
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(email) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (path, { method = 'GET', body, raw } = {}) => fetch(`${base}${path}`, {
    method,
    headers: { cookie, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: raw ?? (body && JSON.stringify(body)),
  }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
}

test('rejects unauthenticated requests and bad passwords', async () => {
  assert.equal((await fetch(`${base}/api/documents`)).status, 401);
  const bad = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alice@ultimate.test', password: 'nope' }),
  });
  assert.equal(bad.status, 401);
});

test('owner creates, renames, edits and reopens a document with formatting intact', async () => {
  const alice = await login('alice@ultimate.test');
  const created = await alice('/api/documents', { method: 'POST', body: {} });
  assert.equal(created.status, 201);
  const { id, version } = created.body;

  const content = { ops: [{ insert: 'Plan' }, { insert: '\n', attributes: { header: 1 } }, { insert: 'bold', attributes: { bold: true } }, { insert: '\n' }] };
  const saved = await alice(`/api/documents/${id}`, { method: 'PUT', body: { title: 'Q3 plan', content, version } });
  assert.equal(saved.status, 200);

  const reopened = await alice(`/api/documents/${id}`);
  assert.equal(reopened.body.title, 'Q3 plan');
  assert.deepEqual(reopened.body.content, content);
  assert.equal(reopened.body.role, 'owner');

  assert.equal((await alice(`/api/documents/${id}`, { method: 'PUT', body: { title: '   ', version: reopened.body.version } })).status, 400);
});

test('sharing grants the right access and nothing more', async () => {
  const alice = await login('alice@ultimate.test');
  const bob = await login('bob@ultimate.test');
  const carol = await login('carol@ultimate.test');
  const { id, version } = (await alice('/api/documents', { method: 'POST', body: { title: 'Private' } })).body;

  // Not shared yet: Carol can't see it, and it doesn't leak that it exists.
  assert.equal((await carol(`/api/documents/${id}`)).status, 404);

  // Viewer can read but not write; only the owner can share.
  assert.equal((await alice(`/api/documents/${id}/shares`, { method: 'POST', body: { email: 'carol@ultimate.test', role: 'viewer' } })).status, 201);
  assert.equal((await carol(`/api/documents/${id}`)).body.role, 'viewer');
  assert.equal((await carol(`/api/documents/${id}`, { method: 'PUT', body: { title: 'hacked', version } })).status, 403);
  assert.equal((await carol(`/api/documents/${id}/shares`, { method: 'POST', body: { email: 'bob@ultimate.test', role: 'editor' } })).status, 403);

  // Owned vs shared lists are distinct.
  const carolList = (await carol('/api/documents')).body;
  assert.ok(carolList.shared.some((d) => d.id === id && d.owner_name === 'Alice Chen'));
  assert.ok(!carolList.owned.some((d) => d.id === id));

  // Editor can write; revoking removes access.
  await alice(`/api/documents/${id}/shares`, { method: 'POST', body: { email: 'bob@ultimate.test', role: 'editor' } });
  assert.equal((await bob(`/api/documents/${id}`, { method: 'PUT', body: { title: 'Edited by Bob', version } })).status, 200);
  const bobId = (await alice(`/api/documents/${id}`)).body.shares.find((s) => s.email === 'bob@ultimate.test').id;
  await alice(`/api/documents/${id}/shares/${bobId}`, { method: 'DELETE' });
  assert.equal((await bob(`/api/documents/${id}`)).status, 404);
});

test('stale saves are rejected instead of silently overwriting', async () => {
  const alice = await login('alice@ultimate.test');
  const { id, version } = (await alice('/api/documents', { method: 'POST', body: {} })).body;
  const ops = { ops: [{ insert: 'first\n' }] };
  assert.equal((await alice(`/api/documents/${id}`, { method: 'PUT', body: { content: ops, version } })).status, 200);
  const stale = await alice(`/api/documents/${id}`, { method: 'PUT', body: { content: { ops: [{ insert: 'second\n' }] }, version } });
  assert.equal(stale.status, 409);
  assert.deepEqual((await alice(`/api/documents/${id}`)).body.content, ops);
});

test('uploading a markdown file creates an editable document; unsupported types are refused', async () => {
  const alice = await login('alice@ultimate.test');
  const md = await alice('/api/documents/import?name=notes.md', { method: 'POST', raw: '# Notes\n\n- **one**\n- two' });
  assert.equal(md.status, 201);
  assert.equal(md.body.title, 'notes');
  const html = (await alice(`/api/documents/${md.body.id}`)).body.content.html;
  assert.match(html, /<h1>Notes<\/h1>/);
  assert.match(html, /<strong>one<\/strong>/);

  const txt = await alice('/api/documents/import?name=a.txt', { method: 'POST', raw: '<script>x</script>' });
  assert.match((await alice(`/api/documents/${txt.body.id}`)).body.content.html, /&lt;script&gt;/);

  assert.equal((await alice('/api/documents/import?name=evil.exe', { method: 'POST', raw: 'MZ' })).status, 415);
  assert.equal((await alice('/api/documents/import?name=bad.docx', { method: 'POST', raw: 'not a zip' })).status, 422);
});
