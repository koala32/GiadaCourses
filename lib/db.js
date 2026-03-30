// lib/db.js — Database centralizzato
const path = require('path');
const fs = require('fs');
const Datastore = require('@seald-io/nedb');

const DB_DIR = path.join(__dirname, '..', 'database');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
try { fs.accessSync(DB_DIR, fs.constants.W_OK); }
catch { console.error('[ERROR] DATABASE DIR NON SCRIVIBILE:', DB_DIR); }

const db = {
  users:     new Datastore({ filename: path.join(DB_DIR, 'users.db'),     autoload: true }),
  posts:     new Datastore({ filename: path.join(DB_DIR, 'posts.db'),     autoload: true }),
  comments:  new Datastore({ filename: path.join(DB_DIR, 'comments.db'),  autoload: true }),
  exercises: new Datastore({ filename: path.join(DB_DIR, 'exercises.db'), autoload: true }),
  sessions:  new Datastore({ filename: path.join(DB_DIR, 'sessions.db'),  autoload: true }),
  blog:      new Datastore({ filename: path.join(DB_DIR, 'blog.db'),      autoload: true }),
  logs:      new Datastore({ filename: path.join(DB_DIR, 'logs.db'),      autoload: true }),
  messages:  new Datastore({ filename: path.join(DB_DIR, 'messages.db'),  autoload: true }),
  stories:   new Datastore({ filename: path.join(DB_DIR, 'stories.db'),   autoload: true }),
  groups:    new Datastore({ filename: path.join(DB_DIR, 'groups.db'),    autoload: true }),
  polls:     new Datastore({ filename: path.join(DB_DIR, 'polls.db'),     autoload: true }),
  highlights:new Datastore({ filename: path.join(DB_DIR, 'highlights.db'),autoload: true }),
};
Object.values(db).forEach(d => d.setAutocompactionInterval(60000));

module.exports = { db, DB_DIR };
