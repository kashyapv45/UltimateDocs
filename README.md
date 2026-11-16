# Ultimate Docs

A lightweight collaborative document editor: create, format, upload, share and reopen documents in the browser. It runs locally with two commands; see [Run locally](#run-locally).

## Demo accounts

All seeded accounts use the password **`demo1234`**. The login page has one-click buttons that fill them in.

| Email | What to try |
|---|---|
| `alice@ultimate.test` | Owns "Welcome to Ultimate Docs", which is shared with Bob as an editor |
| `bob@ultimate.test` | Sees the welcome doc under **Shared with me** and can edit it |
| `carol@ultimate.test` | Starts with nothing shared. Share a doc with her as a viewer to see read-only mode |

**Suggested sharing check:** sign in as Alice → open a doc → **Share** → add `carol@ultimate.test` as *Can view* → sign out → sign in as Carol → the doc is under *Shared with me* and opens read-only.

## Features

- **Documents:** create, rename (click the title), edit, delete; autosaves about a second after you stop typing.
- **Rich text:** headings (H1–H3), bold, italic, underline, strikethrough, numbered and bulleted lists, quotes, links.
- **File upload:** upload a **`.txt`, `.md` or `.docx`** file (max 5 MB) to turn it into a new editable document. Headings, lists and bold/italic come across from Markdown and Word. Other file types are rejected with a clear message.
- **Sharing:** the owner shares by email as *Can edit* or *Can view*, and can remove access. The document list separates **My documents** from **Shared with me**, and each doc shows your role.
- **Persistence:** SQLite. Content is stored as a Quill Delta (JSON), so formatting survives reloads exactly.
- **Export to PDF:** the *Export PDF* button opens the print dialog with print-only styles, so *Save as PDF* gives a clean copy of just the document.
- **Conflict safety:** if two people save the same doc, the stale save is rejected (HTTP 409) and the editor shows a "Reload latest" banner instead of silently overwriting.

## Run locally

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`; no native build step).

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000. The database is created and seeded at `data/ultimate-docs.db` on first run. Delete that file to reset.

Use `npm run dev` to restart on file changes.

### Tests

```bash
npm test
```

Runs API tests (Node's built-in test runner) against a fresh in-memory database: auth, create/rename/save/reopen with formatting, the sharing permission matrix (owner / editor / viewer / no access), stale-save rejection, and file import including unsupported and corrupt files.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/ultimate-docs.db` | SQLite file location |
| `SESSION_SECRET` | random per process | Signs the session cookie. Set it so sign-ins survive a server restart |

## Project layout

```
server.js            entry point (env config, listen)
src/app.js           Express routes, auth, access control, validation
src/db.js            SQLite schema and seed data
src/importer.js      .txt / .md / .docx → HTML
public/              single-page frontend (vanilla JS + Quill editor)
test/api.test.js     API tests
samples/             files to try the upload with
```

See `ARCHITECTURE.md` for design decisions and trade-offs.
