'use strict';

const $ = (sel) => document.querySelector(sel);
const views = ['login-view', 'list-view', 'editor-view'];
let me = null;

// ---------- helpers ----------
async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {},
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function show(id) {
  for (const v of views) $('#' + v).hidden = v !== id;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const when = (sqlDate) => new Date(sqlDate.replace(' ', 'T') + 'Z').toLocaleString();

// ---------- auth ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    me = await api('/api/login', { method: 'POST', body: { email: form.get('email'), password: form.get('password') } });
    $('#login-error').hidden = true;
    onSignedIn();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').hidden = false;
  }
});

document.querySelectorAll('.fill').forEach((b) => b.addEventListener('click', () => {
  $('#login-form').email.value = b.dataset.email;
  $('#login-form').password.value = 'demo1234';
}));

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  me = null;
  $('#user-box').hidden = true;
  location.hash = '#/';
  show('login-view');
});

function onSignedIn() {
  $('#user-name').textContent = `${me.name} (${me.email})`;
  $('#user-box').hidden = false;
  route();
}

// ---------- document list ----------
async function renderList() {
  show('list-view');
  const { owned, shared } = await api('/api/documents');

  $('#owned-list').replaceChildren(...(owned.length ? owned.map((d) => el('li', {},
    el('a', { href: `#/doc/${d.id}`, textContent: d.title }),
    el('span', { className: 'muted', textContent: `Edited ${when(d.updated_at)}${d.share_count ? ` · shared with ${d.share_count}` : ''}` }),
    el('button', { className: 'link danger', textContent: 'Delete', onclick: () => deleteDoc(d) }),
  )) : [el('li', { className: 'empty', textContent: 'No documents yet. Create one or upload a file.' })]));

  $('#shared-list').replaceChildren(...(shared.length ? shared.map((d) => el('li', {},
    el('a', { href: `#/doc/${d.id}`, textContent: d.title }),
    el('span', { className: 'badge', textContent: d.role === 'editor' ? 'Can edit' : 'View only' }),
    el('span', { className: 'muted', textContent: `Owner: ${d.owner_name} · edited ${when(d.updated_at)}` }),
  )) : [el('li', { className: 'empty', textContent: 'Nothing has been shared with you yet.' })]));
}

async function deleteDoc(d) {
  if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
  try {
    await api(`/api/documents/${d.id}`, { method: 'DELETE' });
    renderList();
  } catch (err) { toast(err.message); }
}

$('#new-doc').addEventListener('click', async () => {
  try {
    const doc = await api('/api/documents', { method: 'POST', body: {} });
    location.hash = `#/doc/${doc.id}`;
  } catch (err) { toast(err.message); }
});

$('#upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!/\.(txt|md|docx)$/i.test(file.name)) return toast('Only .txt, .md and .docx files are supported.');
  if (file.size > 5 * 1024 * 1024) return toast('File is larger than 5 MB.');
  try {
    const doc = await api(`/api/documents/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file });
    location.hash = `#/doc/${doc.id}`;
  } catch (err) { toast(err.message); }
});

// ---------- editor ----------
// "www.google.com" would otherwise be a relative link to localhost/www.google.com. Add https:// when no
// scheme is given; Quill's own sanitize still runs and blocks javascript: and other unsafe schemes.
const Link = Quill.import('formats/link');
const quillSanitize = Link.sanitize;
Link.sanitize = (url) => quillSanitize.call(Link, /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url) ? url : `https://${url}`);

const quill = new Quill('#editor', {
  theme: 'snow',
  placeholder: 'Start writing…',
  modules: {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['blockquote', 'link'],
      ['clean'],
    ],
  },
});

let current = null;         // { id, version, role }
let dirty = false;          // unsaved local changes
let saving = false;
let saveTimer;

function setStatus(text) { $('#save-status').textContent = text; }

async function openDoc(id) {
  show('editor-view');
  setStatus('Loading…');
  let doc;
  try {
    doc = await api(`/api/documents/${id}`);
  } catch (err) {
    toast(err.message);
    location.hash = '#/';
    return;
  }
  current = { id: doc.id, version: doc.version, role: doc.role, title: doc.title };
  dirty = false;
  $('#conflict').hidden = true;
  $('#doc-title').value = doc.title;
  document.title = `${doc.title} · Ultimate Docs`;

  const canEdit = doc.role !== 'viewer';
  $('#doc-title').readOnly = !canEdit;
  $('#role-badge').textContent = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' }[doc.role];
  $('#share-btn').hidden = doc.role !== 'owner';
  $('#doc-meta').textContent = doc.role === 'owner' ? `Last edited ${when(doc.updated_at)}` : `Owned by ${doc.owner.name} · last edited ${when(doc.updated_at)}`;
  $('#editor-view').classList.toggle('readonly', !canEdit);

  // Freshly imported docs arrive as HTML; Quill converts (and sanitizes) it into a Delta, which we then save.
  const delta = doc.content.html !== undefined ? quill.clipboard.convert({ html: doc.content.html }) : doc.content;
  quill.setContents(delta, 'silent');
  quill.history.clear();
  quill.enable(canEdit);
  setStatus(canEdit ? 'All changes saved' : '');
  if (doc.content.html !== undefined && canEdit) { dirty = true; save(); }
  if (canEdit) quill.focus();
}

quill.on('text-change', (delta, old, source) => {
  if (source !== 'user' || !current) return;
  dirty = true;
  setStatus('Unsaved changes…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
});

async function save(extra = {}) {
  if (!current || current.role === 'viewer' || !$('#conflict').hidden) return;
  if (saving) { saveTimer = setTimeout(() => save(extra), 300); return; } // one request in flight at a time
  saving = true;
  const wasDirty = dirty;
  dirty = false;
  setStatus('Saving…');
  try {
    const body = { version: current.version, ...extra };
    if (wasDirty) body.content = quill.getContents();
    const res = await api(`/api/documents/${current.id}`, { method: 'PUT', body });
    current.version = res.version;
    current.title = res.title;
    setStatus(dirty ? 'Unsaved changes…' : 'All changes saved');
  } catch (err) {
    dirty = dirty || wasDirty;
    if (err.status === 409) {
      $('#conflict').hidden = false;
      setStatus('Not saved');
    } else {
      setStatus('Save failed — will retry');
      saveTimer = setTimeout(save, 3000);
    }
    if (extra.title) $('#doc-title').value = current.title;
    if (err.status !== 409) toast(err.message);
  } finally {
    saving = false;
  }
}

async function rename() {
  const title = $('#doc-title').value.trim();
  if (!current || title === current.title || current.role === 'viewer') return;
  if (!title) { $('#doc-title').value = current.title; return toast('Title cannot be empty.'); }
  await save({ title });
  document.title = `${current.title} · Ultimate Docs`;
}
$('#doc-title').addEventListener('blur', rename);
$('#doc-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
$('#reload-doc').addEventListener('click', () => { dirty = false; openDoc(current.id); });

window.addEventListener('beforeunload', (e) => { if (dirty || saving) e.preventDefault(); });

// ---------- sharing ----------
async function renderShares() {
  const doc = await api(`/api/documents/${current.id}`);
  $('#share-list').replaceChildren(
    el('li', {}, el('span', { textContent: `${me.name} (you)` }), el('span', { className: 'muted', textContent: 'Owner' })),
    ...doc.shares.map((s) => el('li', {},
      el('span', { textContent: `${s.name} · ${s.email}` }),
      el('span', { className: 'muted', textContent: s.role === 'editor' ? 'Can edit' : 'Can view' }),
      el('button', { type: 'button', className: 'link danger', textContent: 'Remove', onclick: async () => {
        try { await api(`/api/documents/${current.id}/shares/${s.id}`, { method: 'DELETE' }); renderShares(); }
        catch (err) { toast(err.message); }
      } }),
    )),
  );
}

$('#share-btn').addEventListener('click', async () => {
  const users = await api('/api/users');
  $('#user-options').replaceChildren(...users.map((u) => el('option', { value: u.email, label: u.name })));
  $('#share-error').hidden = true;
  await renderShares();
  $('#share-dialog').showModal();
});

$('#share-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api(`/api/documents/${current.id}/shares`, { method: 'POST', body: { email: form.email.value, role: form.role.value } });
    form.email.value = '';
    $('#share-error').hidden = true;
    renderShares();
  } catch (err) {
    $('#share-error').textContent = err.message;
    $('#share-error').hidden = false;
  }
});
$('#close-share').addEventListener('click', () => $('#share-dialog').close());

// ---------- routing ----------
async function route() {
  if (!me) return show('login-view');
  const match = location.hash.match(/^#\/doc\/(\d+)$/);
  clearTimeout(saveTimer);
  if (dirty && current) await save(); // flush pending edits before leaving a document
  try {
    if (match) await openDoc(Number(match[1]));
    else { current = null; document.title = 'Ultimate Docs'; await renderList(); }
  } catch (err) { toast(err.message); }
}
window.addEventListener('hashchange', route);

(async () => {
  try {
    me = await api('/api/me');
    onSignedIn();
  } catch {
    show('login-view');
  }
})();

// Export: the browser's print dialog with print styles = clean PDF of just the document.
$('#export-btn').addEventListener('click', () => window.print());
