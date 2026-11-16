const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('./src/app');

const dbFile = process.env.DB_FILE || path.join(__dirname, 'data', 'ultimate-docs.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const app = createApp({ dbFile, secret: process.env.SESSION_SECRET });

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Ultimate Docs running at http://localhost:${port}`));
