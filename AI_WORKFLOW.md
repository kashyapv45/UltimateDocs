# AI workflow note

## Tools used

- **Claude Code** as a coding assistant.

## Where AI helped

- **Automated tests:** drafting the API test cases for sign-in, saving and reopening documents, the sharing permissions, stale-save conflicts and file upload.
- **Bug fixes:** tracking down issues I hit while building, for example a failed `.docx` upload that hung the request (fixed by moving to Express 5, which forwards async errors) and unsaved edits being lost when going back to the document list.
- **Documentation:** first drafts of the README and architecture note, which I then edited.

## What I changed or rejected

- Rejected suggestions to store editor HTML; kept Quill Deltas, so shared content can't carry scripts.
- Cut generated docs down to what a reviewer needs.

## How I verified it

- `npm test` passes on a fresh in-memory database.
- Walked through every flow in the browser as Alice, Bob and Carol: formatting, rename, reload, sharing and revoking, read-only mode for viewers, and file upload.
- Read every AI-suggested change before keeping it, especially around access checks and uploaded content.
