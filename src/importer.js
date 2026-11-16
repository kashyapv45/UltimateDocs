const path = require('node:path');
const mammoth = require('mammoth');
const { marked } = require('marked');

const SUPPORTED = ['.txt', '.md', '.docx'];

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Converts an uploaded file to HTML. The editor turns that HTML into a Quill Delta,
// which keeps only whitelisted formats, so scripts/styles never reach the stored doc.
async function fileToHtml(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    throw Object.assign(new Error(`Unsupported file type "${ext || 'none'}". Use .txt, .md or .docx.`), { status: 415 });
  }
  if (ext === '.docx') {
    try {
      return (await mammoth.convertToHtml({ buffer }, { styleMap: ['u => u'] })).value; // mammoth drops underline by default
    } catch {
      throw Object.assign(new Error('Could not read this .docx file.'), { status: 422 });
    }
  }
  const text = buffer.toString('utf8');
  if (ext === '.md') return marked.parse(text);
  return text.split(/\r?\n/).map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`).join('');
}

module.exports = { fileToHtml, SUPPORTED };
