# Architecture note

## Shape

One Node.js process serves both the API and the static frontend.

```
Browser (vanilla JS + Quill 2)  ──JSON/fetch──▶  Express 5  ──▶  SQLite (node:sqlite)
                                                    │
                                                    └─ mammoth (.docx) / marked (.md) for uploads
```

- **Frontend:** one HTML page, about 300 lines of plain JavaScript, hash routing (`#/`, `#/doc/:id`). Quill provides the editor. No build step.
- **Backend:** `src/app.js` holds all routes. One `access(req, minRole)` helper does the permission check for every document route, so the rules live in one place.
- **Storage:** three tables: `users`, `documents`, `shares(document_id, user_id, role)`.

## What I prioritised and why

1. **An editor that feels solid.** Quill gives reliable formatting, keyboard shortcuts and undo out of the box. Autosave with a visible status ("Saving…" / "All changes saved") removes the need for a Save button, and pending edits are flushed when you leave a document.
2. **Sharing with real enforcement.** Owner / editor / viewer roles are checked on the server, not just hidden in the UI. A document you can't access returns 404 rather than 403, so its existence doesn't leak. Viewers get a read-only editor without a toolbar.
3. **Not losing work.** Each save carries the version the client last saw. The `UPDATE … WHERE version = ?` makes the check atomic. A stale save gets a 409, and the UI says so plainly instead of overwriting someone else's edits.
4. **An upload that produces something useful.** Uploading creates a new document. Markdown and Word headings, lists and emphasis carry over, so the result is editable, not a dump of plain text.

## Key decisions

- **Store Quill Deltas, not HTML.** A Delta is structured JSON that round-trips formatting exactly and can't carry scripts, so content shared between users is safe to render. Uploaded files are converted to HTML on the server, then turned into a Delta by Quill in the browser on first open (Quill keeps only formats it knows), and saved back as a Delta.
- **SQLite via `node:sqlite`.** Zero setup for reviewers, no native module to compile, and real SQL constraints (foreign keys, cascade delete, role `CHECK`). The cost is one writer process, which is fine at this scale.
- **Seeded users with password login and a signed cookie.** Enough to demonstrate sharing between distinct identities without building sign-up or an identity provider. Passwords are hashed with scrypt, and the session cookie is HMAC-signed and `httpOnly`.
- **No frontend framework or bundler.** The UI is three views and a dialog. A framework would add build tooling without making the product better at this size.

## Stretch items included

- **Role-based sharing beyond basic access:** owner / editor / viewer, enforced on the server.
- **Export to PDF:** the browser's print dialog plus a print stylesheet, so no PDF library or server-side rendering is needed. Trade-off: the user picks "Save as PDF" in the dialog.

## Deliberately left out

- **Real-time co-editing** (live cursors, merging concurrent edits). It needs operational transforms or CRDTs (e.g. Yjs) plus WebSockets. I chose conflict *detection* instead of a half-working merge.
- **Sign-up, password reset, organisations.** Seeded accounts cover the review.
- **Comments, version history, images, tables, Markdown/Word export.** Valuable, but each is its own feature.
- **Attachments stored alongside documents.** Upload-to-new-document was the more useful single flow.

## What I'd build next (2–4 hours)

1. Real-time collaboration with Yjs + `y-quill` over a WebSocket, keeping the version check as a fallback.
2. Version history: store a snapshot per save (or every N minutes) and allow restoring.
3. Import into an existing document and export to `.docx` / `.md`.
4. A browser-level smoke test with Playwright covering the main flow.
