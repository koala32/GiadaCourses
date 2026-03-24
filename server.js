// ============================================================
//  GiadaCourses v7.0 — Linux Production Build
//  Socket.IO + WebRTC + LIVE + Storie + Sfide 1v1 + Media
//  FIX: Upload 404, profilo, storie, chiamate, deploy pulito
// ============================================================

const express  = require('express');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const Datastore= require('@seald-io/nedb');
const multer   = require('multer');
const { Server: SocketIO } = require('socket.io');

const app  = express();
const httpServer = http.createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingInterval: 15000,
  pingTimeout: 30000,
  maxHttpBufferSize: 5e6,
  transports: ['websocket', 'polling'],
});
const PORT = process.env.PORT || 3000;

// -- Server logging con timestamp --
function serverLog(level, ...args) {
  const ts = new Date().toISOString();
  const prefix = { info: '[INFO]', warn: '[WARN]', error: '[ERROR]', ok: '[OK]' }[level] || '[LOG]';
  console.log(`${ts} ${prefix}`, ...args);
}
process.on('uncaughtException', err => {
  serverLog('error', 'Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  serverLog('warn', 'Unhandled Rejection:', reason);
});

// ── Cartelle ──────────────────────────────────────────────
const DB_DIR      = path.join(__dirname, 'database');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
[DB_DIR, UPLOADS_DIR].forEach(d => { 
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); 
  // Verifica permessi di scrittura
  try { fs.accessSync(d, fs.constants.W_OK); }
  catch { serverLog('error', 'DIRECTORY NON SCRIVIBILE:', d); }
});

// ── Database ───────────────────────────────────────────────
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
};
Object.values(db).forEach(d => d.setAutocompactionInterval(60000));

// ── Multer: upload file ───────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, Date.now() + '_' + crypto.randomBytes(6).toString('hex') + ext);
  },
});
const ALLOWED_VID   = /mp4|mov|avi|webm|3gp|mkv/;
const ALLOWED_AUD   = /webm|ogg|wav|opus|aac|m4a|mp4/;
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { cb(null, true); },
});

// ── SSE (Multi-client) + Socket.IO (bidirezionale) ─────────
const sseClients = new Map();
// Socket.IO: userId -> Set<socket>
const ioClients = new Map();

// Pending events buffer: userId -> [{event, data, ts}] (max 30 events, max 120s old)
const ssePending = new Map();
function ssePendingAdd(userId, event, data) {
  const uid = String(userId);
  if (!ssePending.has(uid)) ssePending.set(uid, []);
  const buf = ssePending.get(uid);
  buf.push({ event, data, ts: Date.now() });
  const cutoff = Date.now() - 120000;
  ssePending.set(uid, buf.filter(e => e.ts > cutoff).slice(-30));
}

// Emette su ENTRAMBI i canali: Socket.IO (prioritario) + SSE (fallback)
function sseEmit(userId, event, data) {
  const uid = String(userId);

  // Buffer eventi importanti
  if (['call_invite','challenge_invite','live_started','call_answer','call_ice','challenge_started'].includes(event)) {
    ssePendingAdd(userId, event, data);
  }

  // 1. Socket.IO (piu veloce e affidabile)
  const ioSet = ioClients.get(uid);
  if (ioSet && ioSet.size) {
    for (const sock of ioSet) {
      try { sock.emit(event, data); } catch { ioSet.delete(sock); }
    }
  }

  // 2. SSE (fallback per client che non supportano WebSocket)
  const sseSet = sseClients.get(uid);
  if (sseSet && sseSet.size) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseSet) {
      try { res.write(payload); } catch { sseSet.delete(res); }
    }
  }
}
function sseBroadcast(event, data) {
  // Socket.IO broadcast
  io.emit(event, data);
  // SSE broadcast (fallback)
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [uid, set] of sseClients) {
    for (const res of set) {
      try { res.write(payload); } catch { set.delete(res); }
    }
  }
}

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// -- CORS per accesso HTTPS (deve essere PRIMA di static e route) --
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Serve static files — uploads first for range support
const MIME_MAP={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.3gp':'video/3gpp','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.aac':'audio/aac','.pdf':'application/pdf'};

app.get('/uploads/:fn', (req, res) => {
  const fn = path.basename(req.params.fn).replace(/\.\./g, '');
  const fp = path.join(UPLOADS_DIR, fn);
  if (!fs.existsSync(fp)) {
    serverLog('warn', `Upload 404: ${fn} (path: ${fp})`);
    return res.status(404).json({ error: 'File non trovato' });
  }
  const stat = fs.statSync(fp);
  const size = stat.size;
  if (size === 0) {
    serverLog('warn', `Upload vuoto: ${fn}`);
    return res.status(404).json({ error: 'File vuoto' });
  }
  const ct = MIME_MAP[path.extname(fn).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const rng = req.headers.range;
  if (rng) {
    const [s, e] = rng.replace(/bytes=/, '').split('-');
    let start = Math.max(0, parseInt(s) || 0);
    let end   = e ? Math.min(size - 1, parseInt(e)) : size - 1;
    if (start > end || start >= size) { start = 0; end = size - 1; }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', size);
    fs.createReadStream(fp).pipe(res);
  }
});

app.use(express.static(path.join(__dirname)));

// ============================================================
//  AUTH MIDDLEWARE
// ============================================================
async function resolveToken(raw) {
  const token = (raw || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const session = await db.sessions.findOneAsync({ token });
  if (!session) return null;
  return await db.users.findOneAsync({ _id: session.userId });
}
async function authMiddleware(req, res, next) {
  req.user = await resolveToken(req.headers.authorization || '').catch(() => null);
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Devi essere loggato' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accesso negato' });
    next();
  };
}
app.use(authMiddleware);

// Log azioni
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') && req.method !== 'GET') {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'sconosciuto';
    const ip = rawIp.split(',')[0].trim().replace('::ffff:', '').replace('::1', '127.0.0.1');
    db.logs.insertAsync({ ip, userId: req.user?._id || null, username: req.user?.username || 'Ospite', action: `${req.method} ${req.path}`, timestamp: Date.now(), device: req.headers['user-agent'] || '' }).catch(() => {});
  }
  next();
});

// ============================================================
//  SSE — Real-Time
// ============================================================
app.get('/api/events', async (req, res) => {
  const token = req.query.t || '';
  const user = await resolveToken('Bearer ' + token).catch(() => null);
  if (!user) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const uid = String(user._id);
  if (!sseClients.has(uid)) sseClients.set(uid, new Set());
  sseClients.get(uid).add(res);
  res.write(`event: connected\ndata: {"ok":true}\n\n`);

  // Replay pending events (calls/challenges missed during disconnect)
  const pending = ssePending.get(uid) || [];
  for (const e of pending) {
    try { res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`); } catch {}
  }
  // Clear after replay
  ssePending.delete(uid);

  const ping = setInterval(() => { try { res.write(`: ping\n\n`); } catch { clearInterval(ping); } }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    const set = sseClients.get(uid);
    if (set) { set.delete(res); if (!set.size) sseClients.delete(uid); }
  });
});

// ============================================================
//  UPLOAD MEDIA
// ============================================================
app.post('/api/media/upload-pdf', requireAuth, requireRole('admin','superadmin'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.post('/api/media/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
  const ext = path.extname(req.file.filename).toLowerCase().replace('.','');
  const type = ALLOWED_VID.test(ext) ? 'video' : 'image';
  res.json({ url: '/uploads/' + req.file.filename, type });
});

// Upload multiplo per post (fino a 5 foto)
app.post('/api/media/upload-multi', requireAuth, upload.array('files', 5), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
  const results = req.files.map(f => {
    const ext = path.extname(f.filename).toLowerCase().replace('.','');
    return { url: '/uploads/' + f.filename, type: ALLOWED_VID.test(ext) ? 'video' : 'image' };
  });
  res.json({ files: results });
});

// ============================================================
//  AUTH
// ============================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, level, nativeLang, goal, city, bio } = req.body || {};
    if (!username?.trim()) return res.status(400).json({ error: 'Username obbligatorio' });
    if (!email?.trim()) return res.status(400).json({ error: 'Email obbligatoria' });
    if (!password) return res.status(400).json({ error: 'Password obbligatoria' });
    if (password.length < 6) return res.status(400).json({ error: 'Password troppo corta (minimo 6 caratteri)' });
    // Sanitize
    const cleanUsername = username.trim().slice(0, 30);
    const cleanEmail = email.toLowerCase().trim().slice(0, 100);
    // Check duplicati
    const existing = await db.users.findOneAsync({ $or: [{ email: cleanEmail }, { username: cleanUsername }] });
    if (existing) {
      const reason = existing.email === cleanEmail ? 'Email gia registrata' : 'Username gia in uso';
      return res.status(400).json({ error: reason });
    }
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ip = rawIp.split(',')[0].trim().replace('::ffff:', '').replace('::1', '127.0.0.1');
    const hash = await bcrypt.hash(password, 10);
    const user = await db.users.insertAsync({
      username: cleanUsername, email: cleanEmail, passwordHash: hash, role: 'user',
      avatar: '😊', avatarUrl: '', xp: 0, level: level || 'A1', streak: 0, badges: [],
      bio: (bio || '').slice(0, 200), city: (city || '').slice(0, 50), 
      nativeLang: nativeLang || '', goal: (goal || '').slice(0, 100),
      following: [], followers: [], progress: {},
      joinDate: Date.now(), lastSeen: Date.now(), banned: false, ip,
    });
    const token = crypto.randomBytes(32).toString('hex');
    await db.sessions.insertAsync({ token, userId: user._id, createdAt: Date.now() });
    const { passwordHash, ...safe } = user;
    serverLog('ok', `Nuovo utente registrato: ${cleanUsername} (${cleanEmail})`);
    res.json({ user: safe, token });
  } catch (e) { 
    serverLog('error', 'Errore registrazione:', e.message);
    res.status(500).json({ error: 'Errore del server durante la registrazione' }); 
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e password richieste' });
    const user = await db.users.findOneAsync({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Email o password errata' });
    if (user.banned) return res.status(403).json({ error: "Account sospeso. Contatta l'amministratore." });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Email o password errata' });
    await db.users.updateAsync({ _id: user._id }, { $set: { lastSeen: Date.now() } });
    const token = crypto.randomBytes(32).toString('hex');
    await db.sessions.insertAsync({ token, userId: user._id, createdAt: Date.now() });
    const { passwordHash, ...safe } = user;
    res.json({ user: safe, token });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Errore del server' }); }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await db.sessions.removeAsync({ token }, {});
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { passwordHash, ...safe } = req.user;
  res.json(safe);
});

// ============================================================
//  UTENTI
// ============================================================
app.get('/api/leaderboard', async (req, res) => {
  const users = await db.users.findAsync({ banned: false });
  const sorted = users
    .sort((a, b) => (b.xp||0) - (a.xp||0)).slice(0, 50).map(({ passwordHash, ip, ...u }) => u);
  res.json(sorted);
});

app.get('/api/users/suggestions', requireAuth, async (req, res) => {
  try {
    const me = await db.users.findOneAsync({ _id: req.user._id });
    const myFollowing = me.following || [];
    const allUsers = await db.users.findAsync({ banned: false, _id: { $ne: me._id } });
    const suggestions = allUsers
      .filter(u => !myFollowing.includes(u._id))
      .sort(() => Math.random() - 0.5)
      .slice(0, 10)
      .map(({ passwordHash, ip, email, ...u }) => u);
    res.json(suggestions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/followers', async (req, res) => {
  try {
    const user = await db.users.findOneAsync({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    const ids = user.followers || [];
    if (!ids.length) return res.json([]);
    const users = await db.users.findAsync({ _id: { $in: ids } });
    res.json(users.map(({ passwordHash, ip, email, ...u }) => u));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/following', async (req, res) => {
  try {
    const user = await db.users.findOneAsync({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    const ids = user.following || [];
    if (!ids.length) return res.json([]);
    const users = await db.users.findAsync({ _id: { $in: ids } });
    res.json(users.map(({ passwordHash, ip, email, ...u }) => u));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  const user = await db.users.findOneAsync({ _id: req.params.id });
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  const { passwordHash, ip, email, ...safe } = user;
  res.json(safe);
});

app.put('/api/users/me', requireAuth, async (req, res) => {
  const allowed = ['username','bio','city','level','avatar','nativeLang','goal'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  await db.users.updateAsync({ _id: req.user._id }, { $set: update });
  const updated = await db.users.findOneAsync({ _id: req.user._id });
  const { passwordHash, ...safe } = updated;
  res.json(safe);
});

app.put('/api/users/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Campi mancanti' });
  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Password attuale errata' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Nuova password troppo corta' });
  const hash = await bcrypt.hash(newPassword, 10);
  await db.users.updateAsync({ _id: req.user._id }, { $set: { passwordHash: hash } });
  res.json({ ok: true });
});

app.delete('/api/users/me', requireAuth, async (req, res) => {
  await db.users.removeAsync({ _id: req.user._id }, {});
  await db.posts.removeAsync({ userId: req.user._id }, { multi: true });
  await db.comments.removeAsync({ userId: req.user._id }, { multi: true });
  await db.messages.removeAsync({ $or: [{ fromId: req.user._id }, { toId: req.user._id }] }, { multi: true });
  await db.stories.removeAsync({ userId: req.user._id }, { multi: true });
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await db.sessions.removeAsync({ token }, {});
  res.json({ ok: true });
});

app.post('/api/users/:id/follow', requireAuth, async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user._id) return res.status(400).json({ error: 'Non puoi seguire te stesso' });
  const me = await db.users.findOneAsync({ _id: req.user._id });
  const target = await db.users.findOneAsync({ _id: targetId });
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });
  const myFollowing = me.following || [], targetFollowers = target.followers || [];
  const already = myFollowing.includes(targetId);
  await db.users.updateAsync({ _id: me._id }, { $set: { following: already ? myFollowing.filter(id=>id!==targetId) : [...myFollowing, targetId] } });
  await db.users.updateAsync({ _id: targetId }, { $set: { followers: already ? targetFollowers.filter(id=>id!==me._id) : [...targetFollowers, me._id] } });
  res.json({ following: !already });
});

// ============================================================
//  FOTO PROFILO
// ============================================================
app.post('/api/users/me/avatar', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const ext = path.extname(req.file.filename).toLowerCase();
    if (!/\.(jpg|jpeg|png|gif|webp)$/.test(ext)) {
      // Rimuovi file non valido
      try { fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename)); } catch {}
      return res.status(400).json({ error: 'Solo immagini consentite (jpg, png, gif, webp)' });
    }
    // Verifica che il file esiste davvero
    const newFilePath = path.join(UPLOADS_DIR, req.file.filename);
    if (!fs.existsSync(newFilePath)) {
      return res.status(500).json({ error: 'Upload fallito - file non salvato' });
    }
    const oldUser = await db.users.findOneAsync({ _id: req.user._id });
    // Rimuovi vecchia foto profilo (se era un file uploaded)
    if (oldUser?.avatarUrl && oldUser.avatarUrl.startsWith('/uploads/')) {
      const oldFile = path.join(__dirname, oldUser.avatarUrl);
      try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch {}
    }
    const avatarUrl = '/uploads/' + req.file.filename;
    await db.users.updateAsync({ _id: req.user._id }, { $set: { avatarUrl, avatar: '' } });
    const updated = await db.users.findOneAsync({ _id: req.user._id });
    const { passwordHash, ...safe } = updated;
    serverLog('ok', `Avatar aggiornato: ${req.user.username} -> ${avatarUrl}`);
    res.json(safe);
  } catch (e) { 
    serverLog('error', 'Errore avatar upload:', e.message);
    res.status(500).json({ error: 'Errore durante il caricamento della foto' }); 
  }
});

// ============================================================
//  STORIE (24h)
// ============================================================
function cleanExpiredStories() {
  const cutoff = Date.now() - 86400000;
  db.stories.findAsync({ timestamp: { $lt: cutoff } }).then(expired => {
    expired.forEach(s => { if (s.mediaUrl) { try { fs.unlinkSync(path.join(__dirname, s.mediaUrl)); } catch {} } });
    db.stories.removeAsync({ timestamp: { $lt: cutoff } }, { multi: true });
  });
}
setInterval(cleanExpiredStories, 10 * 60 * 1000);

app.get('/api/stories', async (req, res) => {
  try {
    cleanExpiredStories();
    const cutoff = Date.now() - 86400000;
    const stories = await db.stories.findAsync({ timestamp: { $gt: cutoff } });
    const userIds = [...new Set(stories.map(s => s.userId))];
    const users = await db.users.findAsync({ _id: { $in: userIds } });
    const uMap = {};
    users.forEach(u => { uMap[u._id] = { _id: u._id, username: u.username, avatar: u.avatar, avatarUrl: u.avatarUrl || '' }; });
    const grouped = {};
    stories.sort((a,b)=>b.timestamp-a.timestamp).forEach(s => {
      if (!grouped[s.userId]) grouped[s.userId] = { user: uMap[s.userId]||{_id:s.userId,username:'?',avatar:'👤'}, items: [] };
      grouped[s.userId].items.push(s);
    });
    res.json(Object.values(grouped));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stories', requireAuth, upload.single('file'), async (req, res) => {
  try {
    let mediaUrl = null, mediaType = 'image';

    // Supporto storie senza foto (template colorato)
    const bgTemplate = req.body.bgTemplate || null;

    if (req.file) {
      mediaUrl = '/uploads/' + req.file.filename;
      const ext = path.extname(req.file.filename).toLowerCase().replace('.','');
      mediaType = ALLOWED_VID.test(ext) ? 'video' : 'image';
    } else if (req.body.mediaUrl) {
      mediaUrl = req.body.mediaUrl; mediaType = req.body.mediaType || 'image';
    } else if (bgTemplate) {
      // Storia solo testo con sfondo template
      mediaType = 'template';
    }

    if (!mediaUrl && !bgTemplate) return res.status(400).json({ error: 'Nessun media o template fornito' });

    let textOverlays = [];
    try { textOverlays = JSON.parse(req.body.textOverlays || '[]'); } catch {}

    const story = await db.stories.insertAsync({
      userId: req.user._id, mediaUrl, mediaType, bgTemplate,
      caption: (req.body.caption || '').trim().slice(0, 200),
      filter: req.body.filter || 'none',
      music: (req.body.music && req.body.music !== 'none') ? req.body.music : null,
      musicTitle: (req.body.music && req.body.music !== 'none') ? (req.body.musicTitle || '') : '',
      textOverlays,
      timestamp: Date.now(), views: [],
    });
    sseBroadcast('new_story', { storyId: story._id, userId: req.user._id, username: req.user.username, avatar: req.user.avatar });
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Ricerca musica via Deezer (gratuito, no API key) ──
app.get('/api/music/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  try {
    const data = await new Promise((resolve, reject) => {
      require('https').get('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=12', r => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject('parse error'); } });
      }).on('error', reject);
    });
    if (!data.data) return res.json([]);
    res.json(data.data.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist?.name || '',
      cover: t.album?.cover_small || '',
      preview: t.preview,
    })));
  } catch (e) { res.json([]); }
});

app.post('/api/music/download', requireAuth, async (req, res) => {
  const { url, title } = req.body;
  if (!url || !url.startsWith('https://')) return res.status(400).json({ error: 'URL non valido' });
  try {
    const fname = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.mp3';
    const fp = path.join(UPLOADS_DIR, fname);
    const file = fs.createWriteStream(fp);
    // Segui redirect (Deezer preview usa redirect)
    const downloadWithRedirect = (downloadUrl, maxRedirects = 5) => {
      return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Troppi redirect'));
        const mod = downloadUrl.startsWith('https') ? require('https') : require('http');
        mod.get(downloadUrl, { headers: { 'User-Agent': 'GiadaCourses/7.0' } }, r => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
            return downloadWithRedirect(r.headers.location, maxRedirects - 1).then(resolve).catch(reject);
          }
          if (r.statusCode !== 200) {
            try { fs.unlinkSync(fp); } catch {}
            return reject(new Error(`HTTP ${r.statusCode}`));
          }
          r.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', e => { try { fs.unlinkSync(fp); } catch {} reject(e); });
        }).on('error', e => { try { fs.unlinkSync(fp); } catch {} reject(e); });
      });
    };
    await downloadWithRedirect(url);
    // Verifica che il file sia stato scaricato
    if (!fs.existsSync(fp) || fs.statSync(fp).size < 1000) {
      try { fs.unlinkSync(fp); } catch {}
      return res.status(500).json({ error: 'Download fallito - file troppo piccolo o non valido' });
    }
    serverLog('ok', `Musica scaricata: ${title || 'senza titolo'} -> ${fname}`);
    res.json({ localUrl: '/uploads/' + fname });
  } catch (e) { 
    serverLog('error', 'Download musica fallito:', e.message);
    res.status(500).json({ error: 'Download fallito: ' + e.message }); 
  }
});

app.post('/api/stories/:id/view', requireAuth, async (req, res) => {
  const story = await db.stories.findOneAsync({ _id: req.params.id });
  if (!story) return res.status(404).json({ error: 'Non trovata' });
  const views = story.views || [];
  if (!views.includes(req.user._id)) await db.stories.updateAsync({ _id: req.params.id }, { $set: { views: [...views, req.user._id] } });
  res.json({ ok: true });
});

app.delete('/api/stories/:id', requireAuth, async (req, res) => {
  const story = await db.stories.findOneAsync({ _id: req.params.id });
  if (!story) return res.status(404).json({ error: 'Non trovata' });
  if (story.userId !== req.user._id && !['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Non autorizzato' });
  if (story.mediaUrl) { try { fs.unlinkSync(path.join(__dirname, story.mediaUrl)); } catch {} }
  await db.stories.removeAsync({ _id: req.params.id }, {});
  res.json({ ok: true });
});

// ── Bug Report ──
app.post('/api/bug-report', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Descrizione richiesta' });
    let screenshotUrl = null;
    if (req.file) screenshotUrl = '/uploads/' + req.file.filename;
    const report = await db.logs.insertAsync({
      type: 'bug_report', userId: req.user._id, username: req.user.username,
      text, screenshotUrl, device: req.headers['user-agent'] || '',
      page: req.body.page || '', timestamp: Date.now(),
    });
    const admins = await db.users.findAsync({ $or: [{ role: 'superadmin' }, { username: { $regex: /^adri$/i } }] });
    admins.forEach(a => sseEmit(a._id, 'bug_report', { id: report._id, from: req.user.username, text: text.slice(0, 80), ts: report.timestamp }));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bug-reports', requireAuth, async (req, res) => {
  const isAdri = req.user.username?.toLowerCase() === 'adri';
  if (req.user.role !== 'superadmin' && !isAdri) return res.status(403).json({ error: 'Non autorizzato' });
  const reports = await db.logs.findAsync({ type: 'bug_report' });
  res.json(reports.sort((a, b) => b.timestamp - a.timestamp));
});

// ============================================================
//  POSTS
// ============================================================
app.get('/api/posts', async (req, res) => {
  try {
    const raw = await db.posts.findAsync({});
    const posts = raw.sort((a,b) => b.timestamp - a.timestamp);
    const uids = [...new Set(posts.map(p => p.userId).filter(Boolean))];
    const users = await db.users.findAsync({ _id: { $in: uids } });
    const userMap = {};
    users.forEach(u => { userMap[u._id] = { _id: u._id, username: u.username, avatar: u.avatar || '👤', avatarUrl: u.avatarUrl || '', role: u.role }; });
    const enriched = posts.map(p => ({
      ...p,
      author: userMap[p.userId] || { _id: p.userId || '', username: 'Utente', avatar: '👤', avatarUrl: '', role: 'user' }
    }));
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', requireAuth, async (req, res) => {
  const { text, exerciseId, score, visibility, mediaUrl, mediaType, mediaUrls } = req.body;
  if (!text?.trim() && !mediaUrl && !mediaUrls?.length) return res.status(400).json({ error: 'Testo o media richiesto' });
  const post = await db.posts.insertAsync({
    userId: req.user._id, text: (text||'').trim(), exerciseId: exerciseId||null, score: score||null,
    timestamp: Date.now(), visibility: visibility||'public', likes: [],
    mediaUrl: mediaUrl||null, mediaType: mediaType||null,
    mediaUrls: mediaUrls||null, // array per multi-foto
  });
  const { passwordHash, ...auth } = req.user;
  const result = {...post, author:{_id:auth._id,username:auth.username,avatar:auth.avatar||'👤',avatarUrl:auth.avatarUrl||'',role:auth.role}};
  sseBroadcast('new_post', result);
  res.json(result);
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  const post = await db.posts.findOneAsync({ _id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post non trovato' });
  if (post.userId !== req.user._id && !['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Non autorizzato' });
  if (post.mediaUrl) { try { fs.unlinkSync(path.join(__dirname, post.mediaUrl)); } catch {} }
  await db.posts.removeAsync({ _id: req.params.id }, {});
  await db.comments.removeAsync({ postId: req.params.id }, { multi: true });
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
  const post = await db.posts.findOneAsync({ _id: req.params.id });
  if (!post) return res.status(404).json({ error: 'Post non trovato' });
  const likes = post.likes||[], liked = likes.includes(req.user._id);
  const newLikes = liked ? likes.filter(id=>id!==req.user._id) : [...likes, req.user._id];
  await db.posts.updateAsync({ _id: req.params.id }, { $set: { likes: newLikes } });
  sseBroadcast('like', { postId: req.params.id, likes: newLikes.length, userId: req.user._id });
  res.json({ likes: newLikes.length, liked: !liked });
});

app.get('/api/posts/:id/comments', async (req, res) => {
  const comments = await db.comments.findAsync({ postId: req.params.id });
  const sorted = comments.sort((a,b)=>a.timestamp-b.timestamp);
  const userIds = [...new Set(sorted.map(c=>c.userId))];
  const users = await db.users.findAsync({ _id: { $in: userIds } });
  const uMap = {};
  users.forEach(u=>{uMap[u._id]={_id:u._id,username:u.username,avatar:u.avatar};});
  res.json(sorted.map(c=>({...c,author:uMap[c.userId]||{username:'?',avatar:'👤'}})));
});

app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Testo mancante' });
  const comment = await db.comments.insertAsync({ postId: req.params.id, userId: req.user._id, text: text.trim(), timestamp: Date.now() });
  const { passwordHash, ...auth } = req.user;
  res.json({...comment, author:{_id:auth._id,username:auth.username,avatar:auth.avatar}});
});

// ============================================================
//  MESSAGGI DIRETTI (DM)
// ============================================================
app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const myId = req.user._id;
    const allMsgs = await db.messages.findAsync({ $or: [{ fromId: myId }, { toId: myId }] });
    const msgs = allMsgs.filter(m => !(m.deletedFor||[]).includes(myId));
    const convMap = {}, unreadMap = {};
    msgs.forEach(m => {
      const otherId = m.fromId===myId ? m.toId : m.fromId;
      if (!convMap[otherId] || m.timestamp>convMap[otherId].timestamp) convMap[otherId]=m;
      if (m.toId===myId && !m.read) unreadMap[m.fromId]=(unreadMap[m.fromId]||0)+1;
    });
    const otherIds = Object.keys(convMap);
    if (!otherIds.length) return res.json([]);
    const others = await db.users.findAsync({ _id: { $in: otherIds } });
    const uMap = {};
    others.forEach(u=>{uMap[u._id]={_id:u._id,username:u.username,avatar:u.avatar,avatarUrl:u.avatarUrl||''};});
    const convs = otherIds.map(id=>({
      user: uMap[id]||{_id:id,username:'Utente',avatar:'👤'},
      lastMessage: convMap[id].text||(convMap[id].mediaType==='image'?'Foto':convMap[id].mediaType==='video'?'Video':convMap[id].mediaType==='audio'?'Vocale':''),
      lastMediaType: convMap[id].mediaType||null,
      timestamp: convMap[id].timestamp,
      unread: unreadMap[id]||0,
    })).sort((a,b)=>b.timestamp-a.timestamp);
    res.json(convs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/unread/count', requireAuth, async (req, res) => {
  try { res.json({ count: await db.messages.countAsync({ toId: req.user._id, read: false }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId', requireAuth, async (req, res) => {
  try {
    const myId=req.user._id, otherId=req.params.userId;
    const allMsgs2 = await db.messages.findAsync({ $or: [{fromId:myId,toId:otherId},{fromId:otherId,toId:myId}] });
    const msgs = allMsgs2.filter(m => !(m.deletedFor||[]).includes(myId));
    await db.messages.updateAsync({ fromId:otherId,toId:myId,read:false }, { $set:{read:true} }, { multi:true });
    const other = await db.users.findOneAsync({ _id: otherId });
    const otherInfo = other ? {_id:other._id,username:other.username,avatar:other.avatar,avatarUrl:other.avatarUrl} : null;
    res.json({ messages: msgs.sort((a,b)=>a.timestamp-b.timestamp), other: otherInfo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages/:userId', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const toId = req.params.userId;
    const target = await db.users.findOneAsync({ _id: toId });
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    let mediaUrl=null, mediaType=null;
    if (req.file) {
      mediaUrl = '/uploads/' + req.file.filename;
      const ext  = path.extname(req.file.filename).toLowerCase().replace('.', '');
      const mime = (req.file.mimetype || '').toLowerCase();
      if (mime.startsWith('audio/') || ALLOWED_AUD.test(ext)) mediaType = 'audio';
      else if (ALLOWED_VID.test(ext) || mime.startsWith('video/')) mediaType = 'video';
      else mediaType = 'image';
    }
    const text = (req.body.text||'').trim();
    if (!text && !mediaUrl) return res.status(400).json({ error: 'Messaggio vuoto' });
    const msg = await db.messages.insertAsync({ fromId:req.user._id, toId, text, mediaUrl, mediaType, timestamp:Date.now(), read:false });
    sseEmit(toId, 'message', { _id:msg._id, fromId:req.user._id, fromUsername:req.user.username, fromAvatar:req.user.avatar, text:msg.text, mediaUrl:msg.mediaUrl, mediaType:msg.mediaType, timestamp:msg.timestamp });
    res.json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:userId', requireAuth, async (req, res) => {
  const myId = req.user._id;
  const otherId = req.params.userId;
  await db.messages.updateAsync(
    { $or:[{fromId:myId,toId:otherId},{fromId:otherId,toId:myId}] },
    { $addToSet:{deletedFor: myId} },
    { multi: true }
  );
  res.json({ ok: true });
});

app.delete('/api/messages/:userId/:msgId', requireAuth, async (req, res) => {
  try {
    const msg = await db.messages.findOneAsync({ _id: req.params.msgId });
    if (!msg) return res.status(404).json({ error: 'Non trovato' });
    if (msg.fromId !== req.user._id && !['admin','superadmin'].includes(req.user.role))
      return res.status(403).json({ error: 'Non autorizzato' });
    await db.messages.removeAsync({ _id: req.params.msgId }, {});
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
//  ESERCIZI
// ============================================================
app.get('/api/exercises', async (req, res) => {
  const exercises = await db.exercises.findAsync({});
  res.json(exercises.sort((a,b)=>a.createdAt-b.createdAt));
});

app.post('/api/exercises', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { title, type, level, category, desc, points, questions, pdfUrl } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
  const ex = await db.exercises.insertAsync({ title:title.trim(), type:type||'quiz', level:level||'A1', category:category||'Grammatica', desc:desc||'', points:points||50, questions:questions||[], pdfUrl:pdfUrl||null, createdBy:req.user._id, createdAt:Date.now() });
  sseBroadcast('new_exercise', { exerciseId:ex._id, title:ex.title, level:ex.level });
  res.json(ex);
});

app.put('/api/exercises/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { title, type, level, category, desc, points, questions, pdfUrl } = req.body;
  await db.exercises.updateAsync({ _id:req.params.id }, { $set:{title,type,level,category,desc,points,questions,pdfUrl:pdfUrl||null} });
  res.json(await db.exercises.findOneAsync({ _id:req.params.id }));
});

app.delete('/api/exercises/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  await db.exercises.removeAsync({ _id:req.params.id }, {});
  res.json({ ok:true });
});

app.post('/api/exercises/:id/complete', requireAuth, async (req, res) => {
  try {
    const score = parseInt(req.body.score) || 0;
    const { shareToFeed, shareText } = req.body;
    const ex = await db.exercises.findOneAsync({ _id:req.params.id });
    if (!ex) return res.status(404).json({ error:'Esercizio non trovato' });
    const user = await db.users.findOneAsync({ _id:req.user._id });
    const progress = {...(user.progress||{})};
    const xpEarned = Math.round((ex.points||50)*(score/100));
    const prev = progress[ex._id];
    let xpDelta = 0;
    if (!prev||score>prev.score) {
      xpDelta = !prev ? xpEarned : Math.max(0, xpEarned-Math.round((ex.points||50)*(prev.score/100)));
      progress[ex._id] = { score, completedAt:Date.now() };
    }
    const today = new Date().toDateString();
    const lastDay = user.lastActiveDate ? new Date(user.lastActiveDate).toDateString() : '';
    let streak = user.streak || 0;
    if (lastDay !== today) {
      const yesterday = new Date(Date.now()-86400000).toDateString();
      streak = (lastDay === yesterday) ? streak + 1 : 1;
    }
    const newXp = (user.xp||0) + xpDelta;
    const LVL = ['A1','A2','B1','B2','C1','C2'];
    const XPT = [0, 200, 500, 1000, 2000, 4000];
    let newLevel = user.level || 'A1';
    for (let i = LVL.length - 1; i >= 0; i--) { if (newXp >= XPT[i]) { newLevel = LVL[i]; break; } }
    const badges=[...(user.badges||[])], count=Object.keys(progress).length;
    if (score===100&&!badges.includes('')) badges.push('');
    if (count>=3&&!badges.includes('')) badges.push('');
    if (count>=10&&!badges.includes('')) badges.push('');
    if (streak>=7&&!badges.includes('')) badges.push('');
    if (newXp>=1000&&!badges.includes('')) badges.push('');
    if (newXp>=2000&&!badges.includes('')) badges.push('');
    const leveledUp = newLevel !== (user.level||'A1') ? newLevel : null;
    await db.users.updateAsync({ _id:user._id }, { $set:{progress, xp:newXp, level:newLevel, badges, streak, lastActiveDate:today, lastSeen:Date.now()} });
    if (shareToFeed) {
      const post = await db.posts.insertAsync({ userId:user._id, text:shareText?.trim()||`Ho completato "${ex.title}"! ${score>=90?'[TROFEO]':score>=70?'[STELLA]':'[FORZA]'}`, exerciseId:ex._id, score, timestamp:Date.now(), visibility:'public', likes:[] });
      sseBroadcast('new_post', {...post, author:{_id:user._id,username:user.username,avatar:user.avatar,role:user.role}});
    }
    const updated = await db.users.findOneAsync({ _id:user._id });
    const { passwordHash, ...safe } = updated;
    res.json({ user:safe, xpEarned:xpDelta, leveledUp });
  } catch (e) { console.error(e); res.status(500).json({ error:e.message }); }
});

// ============================================================
//  BLOG
// ============================================================
app.get('/api/blog', async (req, res) => { res.json((await db.blog.findAsync({published:true})).sort((a,b)=>b.date-a.date)); });
app.get('/api/blog/all', requireAuth, requireRole('admin','superadmin'), async (req, res) => { res.json((await db.blog.findAsync({})).sort((a,b)=>b.date-a.date)); });
app.post('/api/blog', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { title, content, published } = req.body;
  if (!title?.trim()||!content?.trim()) return res.status(400).json({ error:'Titolo e contenuto richiesti' });
  res.json(await db.blog.insertAsync({ title:title.trim(), content:content.trim(), date:Date.now(), published:!!published, authorId:req.user._id }));
});
app.put('/api/blog/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  const { title, content, published } = req.body;
  await db.blog.updateAsync({ _id:req.params.id }, { $set:{title,content,published} });
  res.json(await db.blog.findOneAsync({ _id:req.params.id }));
});
app.delete('/api/blog/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
  await db.blog.removeAsync({ _id:req.params.id }, {});
  res.json({ ok:true });
});

// ============================================================
//  ADMIN
// ============================================================
app.get('/api/admin/users', requireAuth, requireRole('superadmin'), async (req, res) => {
  res.json((await db.users.findAsync({})).map(({passwordHash,...u})=>u));
});
app.post('/api/admin/users/:id/ban', requireAuth, requireRole('superadmin'), async (req, res) => {
  const user = await db.users.findOneAsync({ _id:req.params.id });
  if (!user||user.role==='superadmin') return res.status(400).json({ error:'Non puoi bannare questo utente' });
  const newBanned = !user.banned;
  await db.users.updateAsync({ _id:req.params.id }, { $set:{banned:newBanned} });
  if (newBanned) await db.sessions.removeAsync({ userId:req.params.id }, { multi:true });
  res.json({ banned:newBanned, username:user.username });
});
app.put('/api/admin/users/:id/role', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { role } = req.body;
  if (!['user','admin'].includes(role)) return res.status(400).json({ error:'Ruolo non valido' });
  await db.users.updateAsync({ _id:req.params.id }, { $set:{role} });
  res.json({ ok:true });
});

// ── Reset password utente (solo superadmin) ──
app.post('/api/admin/users/:id/reset-password', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const user = await db.users.findOneAsync({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Non puoi reimpostare la password di un superadmin' });
    const DEFAULT_PASSWORD = 'Utente2026!';
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await db.users.updateAsync({ _id: req.params.id }, { $set: { passwordHash: hash } });
    // Invalida tutte le sessioni dell'utente così deve rifare il login
    await db.sessions.removeAsync({ userId: req.params.id }, { multi: true });
    serverLog('info', `Password reset: ${req.user.username} ha reimpostato la password di ${user.username}`);
    res.json({ ok: true, username: user.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/stats', requireAuth, requireRole('superadmin'), async (req, res) => {
  const since24h = Date.now()-86400000;
  const logs = await db.logs.findAsync({});
  const allSessions = await db.sessions.findAsync({});
  res.json({
    totalUsers:    await db.users.countAsync({ role:'user' }),
    totalAdmins:   await db.users.countAsync({ role:'admin' }),
    totalPosts:    await db.posts.countAsync({}),
    totalExer:     await db.exercises.countAsync({}),
    totalComments: await db.comments.countAsync({}),
    totalMessages: await db.messages.countAsync({}),
    totalStories:  await db.stories.countAsync({}),
    recentUsers:   await db.users.countAsync({ joinDate:{$gt:since24h} }),
    recentPosts:   await db.posts.countAsync({ timestamp:{$gt:since24h} }),
    activeSessions: allSessions.filter(s=>s.createdAt>since24h).length,
    recentLogs:    logs.sort((a,b)=>b.timestamp-a.timestamp).slice(0,100),
  });
});
app.get('/api/admin/messages', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const msgs = await db.messages.findAsync({});
    const uids = [...new Set([...msgs.map(m=>m.fromId),...msgs.map(m=>m.toId)])];
    const users = await db.users.findAsync({ _id:{$in:uids} });
    const uMap = {};
    users.forEach(u=>{uMap[u._id]={username:u.username,avatar:u.avatar};});
    res.json(msgs.sort((a,b)=>b.timestamp-a.timestamp).map(m=>({...m,fromUser:uMap[m.fromId]||{username:'?',avatar:''},toUser:uMap[m.toId]||{username:'?',avatar:''}})));
  } catch (e) { res.status(500).json({ error:e.message }); }
});
app.get('/api/admin/stories', requireAuth, requireRole('superadmin'), async (req, res) => {
  try {
    const stories = await db.stories.findAsync({});
    const uids = [...new Set(stories.map(s=>s.userId))];
    const users = await db.users.findAsync({ _id:{$in:uids} });
    const uMap = {};
    users.forEach(u=>{uMap[u._id]={username:u.username,avatar:u.avatar};});
    res.json(stories.sort((a,b)=>b.timestamp-a.timestamp).map(s=>({...s,user:uMap[s.userId]||{username:'?',avatar:''}})));
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// ============================================================
//  CHIAMATE WEBRTC — Signaling via SSE
// ============================================================
const activeCalls = new Map();

app.post('/api/calls/invite', requireAuth, async (req, res) => {
  try {
    const { toUserId, offer, videoEnabled } = req.body;
    const target = await db.users.findOneAsync({ _id: toUserId });
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    const callId = crypto.randomBytes(8).toString('hex');
    activeCalls.set(callId, {
      callerId: req.user._id, callerName: req.user.username, callerAvatar: req.user.avatar||'',
      calleeId: toUserId, calleeName: target.username,
      startedAt: Date.now(), videoEnabled: !!videoEnabled, monitors: new Set()
    });
    sseEmit(toUserId, 'call_invite', { callId, from: req.user._id, fromName: req.user.username, fromAvatar: req.user.avatar||'', videoEnabled: !!videoEnabled, offer });
    const superadmins = await db.users.findAsync({ role: 'superadmin' });
    superadmins.forEach(a => {
      if (a._id !== req.user._id && a._id !== toUserId)
        sseEmit(a._id, 'call_available', { callId, callerName: req.user.username, calleeName: target.username, videoEnabled: !!videoEnabled });
    });
    res.json({ ok: true, callId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/calls/answer', requireAuth, async (req, res) => {
  const { callId, answer } = req.body;
  const call = activeCalls.get(callId);
  if (!call) return res.status(404).json({ error: 'Chiamata non trovata' });
  sseEmit(call.callerId, 'call_answer', { callId, answer, from: req.user._id });
  call.monitors.forEach(mid => sseEmit(mid, 'call_answered_notify', { callId }));
  res.json({ ok: true });
});

app.post('/api/calls/ice', requireAuth, async (req, res) => {
  const { callId, candidate, targetUserId } = req.body;
  sseEmit(targetUserId, 'call_ice', { callId, candidate, from: req.user._id });
  res.json({ ok: true });
});

app.post('/api/calls/reject', requireAuth, async (req, res) => {
  const { callId } = req.body;
  const call = activeCalls.get(callId);
  if (call) { sseEmit(call.callerId, 'call_rejected', { callId }); activeCalls.delete(callId); }
  res.json({ ok: true });
});

app.post('/api/calls/end', requireAuth, async (req, res) => {
  const { callId } = req.body;
  const call = activeCalls.get(callId);
  if (call) {
    sseEmit(call.callerId, 'call_ended', { callId });
    sseEmit(call.calleeId, 'call_ended', { callId });
    call.monitors.forEach(mid => sseEmit(mid, 'call_ended', { callId }));
    activeCalls.delete(callId);
  }
  res.json({ ok: true });
});

app.post('/api/calls/monitor', requireAuth, async (req, res) => {
  const isAdri = req.user.username?.toLowerCase() === 'adri';
  if (req.user.role !== 'superadmin' && !isAdri) return res.status(403).json({ error: 'Non autorizzato' });
  const { callId } = req.body;
  const call = activeCalls.get(callId);
  if (!call) return res.status(404).json({ error: 'Chiamata non trovata o terminata' });
  call.monitors.add(req.user._id);
  sseEmit(call.callerId, 'call_monitor_req', { callId, monitorId: req.user._id });
  res.json({ ok: true, callerId: call.callerId, calleeId: call.calleeId });
});

app.post('/api/calls/monitor-offer', requireAuth, async (req, res) => {
  const { callId, monitorId, offer } = req.body;
  sseEmit(monitorId, 'call_monitor_offer', { callId, offer, from: req.user._id });
  res.json({ ok: true });
});

app.post('/api/calls/monitor-answer', requireAuth, async (req, res) => {
  const { callId, targetUserId, answer } = req.body;
  sseEmit(targetUserId, 'call_monitor_answer', { callId, answer, monitorId: req.user._id });
  res.json({ ok: true });
});

app.post('/api/calls/monitor-ice', requireAuth, async (req, res) => {
  const { callId, candidate, targetUserId } = req.body;
  sseEmit(targetUserId, 'call_monitor_ice', { callId, candidate, monitorId: req.user._id });
  res.json({ ok: true });
});

// ============================================================
//  LIVE STREAMING (solo Giada/admin)
// ============================================================
const liveStreams = new Map();
const liveViewerSSE = new Map();

app.post('/api/live/start', requireAuth, async (req, res) => {
  const isAdri = req.user.username?.toLowerCase() === 'adri';
  if (req.user.username.toLowerCase() !== 'giada' && req.user.role !== 'superadmin' && req.user.role !== 'admin' && !isAdri)
    return res.status(403).json({ error: 'Solo gli admin possono avviare le dirette' });
  for (const [sid, s] of liveStreams) {
    if (s.hostId === req.user._id && s.active) {
      s.active = false;
      for (const [k, r] of liveViewerSSE) {
        if (k.startsWith(sid+':')) { try { r.write(`data: ${JSON.stringify({type:'ended'})}\n\n`); r.end(); } catch {} }
      }
      sseBroadcast('live_ended', { streamId: sid });
    }
  }
  const streamId = crypto.randomBytes(8).toString('hex');
  const title = (req.body.title || '').trim() || `${req.user.username} - LIVE`;
  liveStreams.set(streamId, {
    hostId: req.user._id, hostName: req.user.username, hostAvatar: req.user.avatar||'',
    title, viewers: new Set(), comments: [], startedAt: Date.now(), active: true
  });
  sseBroadcast('live_started', { streamId, hostId: req.user._id, hostName: req.user.username, hostAvatar: req.user.avatar||'', title, startedAt: Date.now() });
  serverLog('info', `LIVE: ${req.user.username} ha iniziato: ${streamId}`);
  res.json({ ok: true, streamId });
});

app.get('/api/live/watch/:streamId', authMiddleware, (req, res) => {
  const stream = liveStreams.get(req.params.streamId);
  if (!stream || !stream.active) return res.status(404).json({ error: 'Stream non attivo' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const uid = req.user?._id || ('g_' + crypto.randomBytes(4).toString('hex'));
  const key = `${req.params.streamId}:${uid}`;
  liveViewerSSE.set(key, res);
  stream.viewers.add(uid);
  res.write(`data: ${JSON.stringify({ type:'info', title:stream.title, hostId:stream.hostId, hostName:stream.hostName, comments:stream.comments.slice(-80) })}\n\n`);
  sseBroadcast('live_viewers', { streamId: req.params.streamId, count: stream.viewers.size });
  setTimeout(() => {
    if (liveStreams.has(req.params.streamId) && stream.active) {
      sseEmit(stream.hostId, 'live_viewer_joined', { streamId: req.params.streamId, viewerId: uid });
    }
  }, 1500);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { clearInterval(hb); } }, 10000);
  req.on('close', () => {
    clearInterval(hb);
    liveViewerSSE.delete(key);
    stream.viewers.delete(uid);
    sseBroadcast('live_viewers', { streamId: req.params.streamId, count: stream.viewers.size });
  });
});

app.post('/api/live/signal/:streamId', requireAuth, async (req, res) => {
  const stream = liveStreams.get(req.params.streamId);
  if (!stream || stream.hostId !== req.user._id) return res.status(403).json({ error: 'Non autorizzato' });
  const { viewerId, offer } = req.body;
  const emitOffer = () => {
    sseEmit(viewerId, 'live_offer', { streamId: req.params.streamId, offer });
    const viewerKey = `${req.params.streamId}:${viewerId}`;
    const viewerRes = liveViewerSSE.get(viewerKey);
    if (viewerRes) {
      try { viewerRes.write(`data: ${JSON.stringify({ type: 'offer', offer })}\n\n`); } catch {}
    }
  };
  emitOffer();
  res.json({ ok: true });
});

app.post('/api/live/answer/:streamId', requireAuth, async (req, res) => {
  const stream = liveStreams.get(req.params.streamId);
  if (!stream) return res.status(404).end();
  const { answer } = req.body;
  sseEmit(stream.hostId, 'live_answer', { streamId: req.params.streamId, answer, from: req.user._id });
  res.json({ ok: true });
});

app.post('/api/live/ice/:streamId', requireAuth, async (req, res) => {
  const stream = liveStreams.get(req.params.streamId);
  if (!stream) return res.status(404).end();
  const { candidate, targetUserId } = req.body;
  const targetId = (!targetUserId || targetUserId === 'host') ? stream.hostId : targetUserId;
  sseEmit(targetId, 'live_ice', { streamId: req.params.streamId, candidate, from: req.user._id });
  const vKey = `${req.params.streamId}:${targetId}`;
  const vRes = liveViewerSSE.get(vKey);
  if (vRes) { try { vRes.write(`data: ${JSON.stringify({ type: 'ice', candidate })}\n\n`); } catch {} }
  res.json({ ok: true });
});

app.post('/api/live/comment/:streamId', requireAuth, async (req, res) => {
  const stream = liveStreams.get(req.params.streamId);
  if (!stream || !stream.active) return res.status(404).json({ error: 'Non attivo' });
  const text = (req.body.text || '').trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  const comment = { id: crypto.randomBytes(4).toString('hex'), userId: req.user._id, username: req.user.username, avatar: req.user.avatar||'', text, ts: Date.now() };
  stream.comments.push(comment);
  if (stream.comments.length > 300) stream.comments = stream.comments.slice(-300);
  const payload = JSON.stringify({ type: 'comment', comment });
  for (const [k, r] of liveViewerSSE) {
    if (k.startsWith(req.params.streamId + ':')) { try { r.write(`data: ${payload}\n\n`); } catch {} }
  }
  sseEmit(stream.hostId, 'live_comment', { streamId: req.params.streamId, comment });
  res.json({ ok: true });
});

app.post('/api/live/end/:streamId', requireAuth, async (req, res) => {
  const stream = liveStreams.get(req.params.streamId);
  if (!stream) return res.status(404).json({ error: 'Non trovato' });
  if (stream.hostId !== req.user._id && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Non autorizzato' });
  stream.active = false;
  const payload = JSON.stringify({ type: 'ended' });
  for (const [k, r] of liveViewerSSE) {
    if (k.startsWith(req.params.streamId + ':')) { try { r.write(`data: ${payload}\n\n`); r.end(); } catch {} }
  }
  sseBroadcast('live_ended', { streamId: req.params.streamId });
  res.json({ ok: true });
});

app.get('/api/live/active', async (req, res) => {
  const lives = [];
  for (const [streamId, s] of liveStreams) {
    if (s.active) lives.push({ streamId, hostId: s.hostId, hostName: s.hostName, hostAvatar: s.hostAvatar, title: s.title, startedAt: s.startedAt, viewers: s.viewers.size });
  }
  res.json(lives);
});

// ============================================================
//  SFIDE 1v1 IN TEMPO REALE
// ============================================================
const activeChallenges = new Map();

app.post('/api/challenges/invite', requireAuth, async (req, res) => {
  try {
    const { toUserId } = req.body;
    const target = await db.users.findOneAsync({ _id: toUserId });
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    const allExercises = await db.exercises.findAsync({});
    const questions = [];
    for (const ex of allExercises.sort(() => Math.random() - .5)) {
      if (ex.questions && ex.questions.length) {
        for (const q of ex.questions.sort(() => Math.random() - .5)) {
          // Accept both formats: {question,options,correctIndex} AND {q,opts,correct}
          const hasOpts = (q.options && q.options.length) || (q.opts && q.opts.length);
          if (hasOpts) {
            // Normalize to standard format for the challenge
            questions.push({
              question: q.question || q.q || '',
              options: q.options || q.opts || [],
              correctIndex: q.correctIndex !== undefined ? q.correctIndex : (q.correct !== undefined ? q.correct : 0),
              type: 'multiple',
              expl: q.expl || q.explanation || '',
              exerciseTitle: ex.title
            });
            if (questions.length >= 5) break;
          }
        }
      }
      if (questions.length >= 5) break;
    }
    const WORD_BANK = [
      { question:'Traduzione di "Hello"', options:['Ciao','Addio','Grazie','Prego'], correctIndex:0, type:'multiple' },
      { question:'Traduzione di "Thank you"', options:['Ciao','Grazie','Scusa','Per favore'], correctIndex:1, type:'multiple' },
      { question:'What is the past of "go"?', options:['goed','went','gone','going'], correctIndex:1, type:'multiple' },
      { question:'Plurale di "child"', options:['childs','childen','children','childes'], correctIndex:2, type:'multiple' },
      { question:'"I am happy" in italiano', options:['Sono stanco','Sono felice','Sono arrabbiato','Sono triste'], correctIndex:1, type:'multiple' },
      { question:'Articolo corretto: ___ apple', options:['a','an','the','some'], correctIndex:1, type:'multiple' },
      { question:'Past tense di "have"', options:['haved','had','has','having'], correctIndex:1, type:'multiple' },
      { question:'Traduzione di "Beautiful"', options:['Brutto','Piccolo','Bello','Grande'], correctIndex:2, type:'multiple' },
      { question:'Contrario di "Hot"', options:['Warm','Cool','Cold','Freezing'], correctIndex:2, type:'multiple' },
      { question:'"Where are you from?" significa:', options:['Dove sei?','Di dove sei?','Come stai?','Chi sei?'], correctIndex:1, type:'multiple' },
      { question:'Completa: She ___ a student', options:['am','is','are','be'], correctIndex:1, type:'multiple' },
      { question:'Traduzione di "Dog"', options:['Gatto','Cane','Uccello','Pesce'], correctIndex:1, type:'multiple' },
      { question:'Present continuous: I am ___', options:['run','ran','running','runs'], correctIndex:2, type:'multiple' },
      { question:'Traduzione di "House"', options:['Casa','Scuola','Ufficio','Negozio'], correctIndex:0, type:'multiple' },
      { question:'Plurale di "mouse"', options:['mouses','mices','mice','mousies'], correctIndex:2, type:'multiple' },
    ];
    // Shuffle word bank and fill up to 5 questions
    const shuffledBank = [...WORD_BANK].sort(() => Math.random() - 0.5);
    let bankIdx = 0;
    while (questions.length < 5 && bankIdx < shuffledBank.length) {
      const wb = shuffledBank[bankIdx++];
      questions.push({ question: wb.question, options: wb.options, correctIndex: wb.correctIndex, type: 'multiple', exerciseTitle: 'Word Challenge' });
    }
    const cid = crypto.randomBytes(8).toString('hex');
    const challenge = {
      id: cid,
      challengerId: req.user._id, challengerName: req.user.username, challengerAvatar: req.user.avatar || '',
      challengeeId: toUserId, challengeeName: target.username, challengeeAvatar: target.avatar || '',
      questions: questions.slice(0, 5),
      status: 'pending',
      scores: { [req.user._id]: [], [toUserId]: [] },
      currentQ: 0,
      startedAt: null, finishedAt: null, createdAt: Date.now(),
    };
    activeChallenges.set(cid, challenge);
    setTimeout(() => { if (activeChallenges.get(cid)?.status === 'pending') activeChallenges.delete(cid); }, 300000);
    sseEmit(toUserId, 'challenge_invite', { challengeId: cid, from: req.user._id, fromName: req.user.username, fromAvatar: req.user.avatar || '' });
    res.json({ ok: true, challengeId: cid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/challenges/:id/accept', requireAuth, async (req, res) => {
  const ch = activeChallenges.get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Sfida non trovata o scaduta' });
  if (ch.challengeeId !== req.user._id) return res.status(403).json({ error: 'Non sei il destinatario' });
  if (ch.status !== 'pending') return res.status(400).json({ error: 'Sfida gia avviata' });
  ch.status = 'active';
  ch.startedAt = Date.now();
  sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: ch.questions });
  res.json({ ok: true, questions: ch.questions, challengeId: ch.id });
});

app.post('/api/challenges/:id/reject', requireAuth, async (req, res) => {
  const ch = activeChallenges.get(req.params.id);
  if (ch) { sseEmit(ch.challengerId, 'challenge_rejected', { challengeId: ch.id }); activeChallenges.delete(ch.id); }
  res.json({ ok: true });
});

app.post('/api/challenges/:id/answer', requireAuth, async (req, res) => {
  const ch = activeChallenges.get(req.params.id);
  if (!ch || ch.status !== 'active') return res.status(404).json({ error: 'Sfida non attiva' });
  const { questionIndex, answerIndex, timeMs } = req.body;
  if (questionIndex === undefined) return res.status(400).json({ error: 'Dati mancanti' });
  if (!ch.scores[req.user._id]) ch.scores[req.user._id] = [];
  const myScores = ch.scores[req.user._id];
  if (myScores[questionIndex] !== undefined) return res.json({ ok: true });
  const q = ch.questions[questionIndex];
  const correctIdx = parseInt(q.correctIndex ?? q.correct ?? 0) || 0;
  const correct = parseInt(answerIndex) === correctIdx;
  const points = correct ? Math.max(10, 100 - Math.floor((timeMs || 0) / 100)) : 0;
  myScores[questionIndex] = { answerIndex, correct, points, timeMs: timeMs || 0 };
  ch.scores[req.user._id] = myScores;
  const opponentId = req.user._id === ch.challengerId ? ch.challengeeId : ch.challengerId;
  sseEmit(opponentId, 'challenge_opponent_answered', { challengeId: ch.id, questionIndex, correct, opponentTotal: myScores.reduce((s, x) => s + (x?.points || 0), 0) });
  const myDone = ch.scores[req.user._id].length >= ch.questions.length;
  const oppScores = ch.scores[opponentId] || [];
  const oppDone = oppScores.length >= ch.questions.length;
  let result = null;
  if (myDone && oppDone) {
    ch.status = 'finished'; ch.finishedAt = Date.now();
    result = {
      [ch.challengerId]: ch.scores[ch.challengerId].reduce((s, x) => s + (x?.points || 0), 0),
      [ch.challengeeId]: ch.scores[ch.challengeeId].reduce((s, x) => s + (x?.points || 0), 0),
      challengerName: ch.challengerName, challengeeName: ch.challengeeName,
    };
    const winnerId = result[ch.challengerId] >= result[ch.challengeeId] ? ch.challengerId : ch.challengeeId;
    result.winnerId = winnerId;
    await db.users.updateAsync({ _id: winnerId }, { $inc: { xp: 50 } });
    await db.users.updateAsync({ _id: (winnerId===ch.challengerId?ch.challengeeId:ch.challengerId) }, { $inc: { xp: 20 } });
    sseEmit(ch.challengerId, 'challenge_finished', { challengeId: ch.id, result });
    sseEmit(ch.challengeeId, 'challenge_finished', { challengeId: ch.id, result });
    setTimeout(() => activeChallenges.delete(ch.id), 60000);
  }
  res.json({ ok: true, correct, points, result });
});

app.get('/api/challenges/:id', requireAuth, async (req, res) => {
  const ch = activeChallenges.get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Non trovata' });
  res.json({ id: ch.id, status: ch.status, questions: ch.questions, scores: ch.scores, currentQ: ch.currentQ });
});

// ============================================================
//  ICE SERVERS (WebRTC STUN/TURN config)
// ============================================================
app.get('/api/ice-servers', async (req, res) => {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  // ── PRIORITA' 1: coturn locale (installato dallo script INSTALLA.sh) ──
  const turnSecret = process.env.TURN_SECRET || 'giadacourses_turn_2024';
  const serverIp = process.env.SERVER_IP || '';
  if (serverIp && turnSecret) {
    // Genera credenziali HMAC temporanee (valide 24h) per coturn
    const crypto = require('crypto');
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const username = `${expiry}:giadacourses`;
    const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
    servers.push(
      { urls: `turn:${serverIp}:3478`, username, credential },
      { urls: `turn:${serverIp}:3478?transport=tcp`, username, credential },
    );
  }

  // ── PRIORITA' 2: TURN Metered come fallback ──
  servers.push(
    { urls: 'turn:a.relay.metered.ca:80', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
    { urls: 'turn:a.relay.metered.ca:80?transport=tcp', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
    { urls: 'turns:a.relay.metered.ca:443?transport=tcp', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
  );

  // ── OPZIONALE: METERED_API_KEY per TURN dedicato ──
  const meteredKey = process.env.METERED_API_KEY;
  if (meteredKey) {
    try {
      const meteredApp = process.env.METERED_APP || 'giadacourses';
      const url = `https://${meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${meteredKey}`;
      const data = await new Promise((resolve, reject) => {
        require('https').get(url, r => {
          let body = ''; r.on('data', c => body += c);
          r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(); } });
        }).on('error', reject);
      });
      if (Array.isArray(data) && data.length) servers.push(...data);
    } catch {}
  }

  res.json({ iceServers: servers });
});

// ============================================================
//  CLIENT LOG — raccoglie errori JS dal browser (punto 8)
// ============================================================
app.post('/api/client-log', async (req, res) => {
  try {
    const { level, msg, ua, url, ts } = req.body;
    if (!msg) return res.status(400).json({ error: 'msg mancante' });
    const entry = {
      type: 'client_log',
      level: level || 'error',
      msg: String(msg).slice(0, 1000),
      ua: (ua || '').slice(0, 200),
      url: (url || '').slice(0, 200),
      userId: req.user?._id || null,
      username: req.user?.username || 'anonimo',
      timestamp: ts || Date.now(),
    };
    await db.logs.insertAsync(entry);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Visualizza client-log (solo superadmin)
app.get('/api/client-logs', requireAuth, requireRole('superadmin'), async (req, res) => {
  const logs = await db.logs.findAsync({ type: 'client_log' });
  res.json(logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 200));
});

// ============================================================
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), version: '7.0-fix', env: 'linux', uploadsDir: UPLOADS_DIR });
});

// Server status (solo superadmin) - per debug
app.get('/api/server-status', requireAuth, requireRole('superadmin'), (req, res) => {
  const activeLives = [];
  for (const [sid, s] of liveStreams) {
    if (s.active) activeLives.push({ streamId: sid, host: s.hostName, viewers: s.viewers.size, comments: s.comments.length });
  }
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sseClients: sseClients.size,
    ioClients: ioClients.size,
    ioSocketsTotal: Array.from(ioClients.values()).reduce((s, set) => s + set.size, 0),
    activeCalls: activeCalls.size,
    activeChallenges: activeChallenges.size,
    activeLives,
    ssePendingQueues: ssePending.size,
    nodeVersion: process.version,
    platform: process.platform,
  });
});

// Fallback SPA
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(__dirname, 'index.html'));
  else res.status(404).json({ error: 'Endpoint non trovato' });
});

// Global error handler
app.use((err, req, res, next) => {
  const s = err.status || err.statusCode || 500;
  if (s === 416) return res.status(200).set('Accept-Ranges','bytes').end();
  serverLog('error', `${req.method} ${req.path}:`, err.message || err);
  if (err.stack) serverLog('error', err.stack.split('\n').slice(0,3).join(' | '));
  res.status(s).json({ error: err.message || 'Errore server' });
});

// ============================================================
//  SOCKET.IO — Comunicazione bidirezionale in tempo reale
//  Gestisce: Chiamate, Sfide 1v1, LIVE, DM notifications
// ============================================================
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.t || '';
  if (!token) return next(new Error('Token mancante'));
  try {
    const session = await db.sessions.findOneAsync({ token });
    if (!session) return next(new Error('Sessione non valida'));
    const user = await db.users.findOneAsync({ _id: session.userId });
    if (!user || user.banned) return next(new Error('Utente non trovato o bannato'));
    socket.userId = user._id;
    socket.username = user.username;
    socket.userRole = user.role;
    socket.userAvatar = user.avatar || '';
    socket.userAvatarUrl = user.avatarUrl || '';
    next();
  } catch(e) { next(new Error('Errore autenticazione')); }
});

io.on('connection', (socket) => {
  const uid = String(socket.userId);
  if (!ioClients.has(uid)) ioClients.set(uid, new Set());
  ioClients.get(uid).add(socket);
  serverLog('info', `Socket.IO: ${socket.username} connesso (${uid}) [${ioClients.get(uid).size} sock]`);

  // Replay pending events
  const pending = ssePending.get(uid) || [];
  for (const e of pending) {
    try { socket.emit(e.event, e.data); } catch {}
  }
  ssePending.delete(uid);

  // Join personal room
  socket.join('user:' + uid);

  // ── CHIAMATE via Socket.IO (bidirezionale!) ──
  socket.on('call:invite', async (data) => {
    try {
      const { toUserId, offer, videoEnabled } = data;
      const target = await db.users.findOneAsync({ _id: toUserId });
      if (!target) return socket.emit('call:error', { error: 'Utente non trovato' });
      const callId = crypto.randomBytes(8).toString('hex');
      activeCalls.set(callId, {
        callerId: uid, callerName: socket.username, callerAvatar: socket.userAvatar,
        calleeId: toUserId, calleeName: target.username,
        startedAt: Date.now(), videoEnabled: !!videoEnabled, monitors: new Set()
      });
      socket.emit('call:id', { callId });
      sseEmit(toUserId, 'call_invite', {
        callId, from: uid, fromName: socket.username,
        fromAvatar: socket.userAvatar, videoEnabled: !!videoEnabled, offer
      });
      serverLog('info', `Chiamata ${callId}: ${socket.username} -> ${target.username}`);
    } catch(e) { socket.emit('call:error', { error: e.message }); }
  });

  socket.on('call:answer', (data) => {
    const { callId, answer } = data;
    const call = activeCalls.get(callId);
    if (!call) return;
    sseEmit(call.callerId, 'call_answer', { callId, answer, from: uid });
    serverLog('info', `Chiamata ${callId}: risposta da ${socket.username}`);
  });

  socket.on('call:ice', (data) => {
    const { callId, candidate, targetUserId } = data;
    if (targetUserId) sseEmit(targetUserId, 'call_ice', { callId, candidate, from: uid });
  });

  socket.on('call:reject', (data) => {
    const { callId } = data;
    const call = activeCalls.get(callId);
    if (call) {
      sseEmit(call.callerId, 'call_rejected', { callId });
      activeCalls.delete(callId);
      serverLog('info', `Chiamata ${callId}: rifiutata da ${socket.username}`);
    }
  });

  socket.on('call:end', (data) => {
    const { callId } = data;
    const call = activeCalls.get(callId);
    if (call) {
      sseEmit(call.callerId, 'call_ended', { callId });
      sseEmit(call.calleeId, 'call_ended', { callId });
      call.monitors.forEach(mid => sseEmit(mid, 'call_ended', { callId }));
      activeCalls.delete(callId);
    }
  });

  // ── SFIDE 1v1 via Socket.IO ──
  socket.on('challenge:invite', async (data) => {
    try {
      const { toUserId } = data;
      const target = await db.users.findOneAsync({ _id: toUserId });
      if (!target) return socket.emit('challenge:error', { error: 'Utente non trovato' });
      const allExercises = await db.exercises.findAsync({});
      const questions = [];
      for (const ex of allExercises.sort(() => Math.random() - .5)) {
        if (ex.questions && ex.questions.length) {
          for (const q of ex.questions.sort(() => Math.random() - .5)) {
            const hasOpts = (q.options && q.options.length) || (q.opts && q.opts.length);
            if (hasOpts) {
              questions.push({
                question: q.question || q.q || '',
                options: q.options || q.opts || [],
                correctIndex: q.correctIndex !== undefined ? q.correctIndex : (q.correct !== undefined ? q.correct : 0),
                type: 'multiple',
                expl: q.expl || q.explanation || '',
                exerciseTitle: ex.title
              });
              if (questions.length >= 5) break;
            }
          }
        }
        if (questions.length >= 5) break;
      }
      // Fallback questions
      const WORD_BANK = [
        { question:'Traduzione di "Hello"', options:['Ciao','Addio','Grazie','Prego'], correctIndex:0, type:'multiple' },
        { question:'Traduzione di "Thank you"', options:['Ciao','Grazie','Scusa','Per favore'], correctIndex:1, type:'multiple' },
        { question:'What is the past of "go"?', options:['goed','went','gone','going'], correctIndex:1, type:'multiple' },
        { question:'Plurale di "child"', options:['childs','childen','children','childes'], correctIndex:2, type:'multiple' },
        { question:'"I am happy" in italiano', options:['Sono stanco','Sono felice','Sono arrabbiato','Sono triste'], correctIndex:1, type:'multiple' },
        { question:'Articolo corretto: ___ apple', options:['a','an','the','some'], correctIndex:1, type:'multiple' },
        { question:'Past tense di "have"', options:['haved','had','has','having'], correctIndex:1, type:'multiple' },
        { question:'Traduzione di "Beautiful"', options:['Brutto','Piccolo','Bello','Grande'], correctIndex:2, type:'multiple' },
        { question:'Contrario di "Hot"', options:['Warm','Cool','Cold','Freezing'], correctIndex:2, type:'multiple' },
        { question:'"Where are you from?" significa:', options:['Dove sei?','Di dove sei?','Come stai?','Chi sei?'], correctIndex:1, type:'multiple' },
        { question:'Completa: She ___ a student', options:['am','is','are','be'], correctIndex:1, type:'multiple' },
        { question:'Present continuous: I am ___', options:['run','ran','running','runs'], correctIndex:2, type:'multiple' },
      ];
      const shuffledBank = [...WORD_BANK].sort(() => Math.random() - 0.5);
      let bankIdx = 0;
      while (questions.length < 5 && bankIdx < shuffledBank.length) {
        questions.push({ ...shuffledBank[bankIdx++], exerciseTitle: 'Word Challenge' });
      }
      const cid = crypto.randomBytes(8).toString('hex');
      const challenge = {
        id: cid,
        challengerId: uid, challengerName: socket.username, challengerAvatar: socket.userAvatar,
        challengeeId: toUserId, challengeeName: target.username, challengeeAvatar: target.avatar || '',
        questions: questions.slice(0, 5), status: 'pending',
        scores: { [uid]: [], [toUserId]: [] }, currentQ: 0,
        startedAt: null, finishedAt: null, createdAt: Date.now(),
      };
      activeChallenges.set(cid, challenge);
      setTimeout(() => { if (activeChallenges.get(cid)?.status === 'pending') activeChallenges.delete(cid); }, 300000);
      socket.emit('challenge:id', { challengeId: cid });
      sseEmit(toUserId, 'challenge_invite', { challengeId: cid, from: uid, fromName: socket.username, fromAvatar: socket.userAvatar });
      serverLog('info', `Sfida ${cid}: ${socket.username} -> ${target.username}`);
    } catch(e) { socket.emit('challenge:error', { error: e.message }); }
  });

  socket.on('challenge:accept', (data) => {
    const { challengeId } = data;
    const ch = activeChallenges.get(challengeId);
    if (!ch || ch.challengeeId !== uid || ch.status !== 'pending') return;
    ch.status = 'active';
    ch.startedAt = Date.now();
    sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: ch.questions });
    socket.emit('challenge:started', { challengeId: ch.id, questions: ch.questions });
    serverLog('info', `Sfida ${challengeId}: accettata da ${socket.username}`);
  });

  socket.on('challenge:reject', (data) => {
    const { challengeId } = data;
    const ch = activeChallenges.get(challengeId);
    if (ch) {
      sseEmit(ch.challengerId, 'challenge_rejected', { challengeId: ch.id });
      activeChallenges.delete(ch.id);
    }
  });

  // ── LIVE via Socket.IO ──
  socket.on('live:ice', (data) => {
    const { streamId, candidate, targetUserId } = data;
    const stream = liveStreams.get(streamId);
    if (!stream) return;
    const targetId = (!targetUserId || targetUserId === 'host') ? stream.hostId : targetUserId;
    sseEmit(targetId, 'live_ice', { streamId, candidate, from: uid });
    // Also send via live viewer SSE
    const vKey = `${streamId}:${targetId}`;
    const vRes = liveViewerSSE.get(vKey);
    if (vRes) { try { vRes.write(`data: ${JSON.stringify({ type: 'ice', candidate })}\n\n`); } catch {} }
  });

  socket.on('live:answer', (data) => {
    const { streamId, answer } = data;
    const stream = liveStreams.get(streamId);
    if (!stream) return;
    sseEmit(stream.hostId, 'live_answer', { streamId, answer, from: uid });
  });

  socket.on('live:comment', (data) => {
    const { streamId, text } = data;
    const stream = liveStreams.get(streamId);
    if (!stream || !stream.active) return;
    const comment = { id: crypto.randomBytes(4).toString('hex'), userId: uid, username: socket.username, avatar: socket.userAvatar, text: (text || '').slice(0, 200), ts: Date.now() };
    stream.comments.push(comment);
    if (stream.comments.length > 300) stream.comments = stream.comments.slice(-300);
    // Broadcast to all live viewers via live SSE
    const payload = JSON.stringify({ type: 'comment', comment });
    for (const [k, r] of liveViewerSSE) {
      if (k.startsWith(streamId + ':')) { try { r.write(`data: ${payload}\n\n`); } catch {} }
    }
    sseEmit(stream.hostId, 'live_comment', { streamId, comment });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const set = ioClients.get(uid);
    if (set) { set.delete(socket); if (!set.size) ioClients.delete(uid); }
  });
});

// ============================================================
//  SETUP INIZIALE + AVVIO
// ============================================================
async function setupFirstRun() {
  const userCount = await db.users.countAsync({});
  if (userCount === 0) {
    serverLog('info', 'Prima installazione...');
    const superHash = await bcrypt.hash('Super2024!', 10);
    await db.users.insertAsync({ username:'SuperAdmin', email:'super@giadacourses.it', passwordHash:superHash, role:'superadmin', avatar:'', xp:0, level:'A1', streak:0, badges:[], bio:'Proprietario della piattaforma', city:'', nativeLang:'it', goal:'', following:[], followers:[], progress:{}, joinDate:Date.now(), lastSeen:Date.now(), banned:false, ip:'127.0.0.1' });
    const giadaHash = await bcrypt.hash('Giada2024!', 10);
    await db.users.insertAsync({ username:'Giada', email:'giada@giadacourses.it', passwordHash:giadaHash, role:'admin', avatar:'', xp:0, level:'A1', streak:0, badges:[], bio:'Insegnante di inglese', city:'', nativeLang:'it', goal:'', following:[], followers:[], progress:{}, joinDate:Date.now(), lastSeen:Date.now(), banned:false, ip:'127.0.0.1' });
    serverLog('ok', 'Account SuperAdmin e Giada creati!');
    serverLog('info', 'SuperAdmin: super@giadacourses.it / Super2024!');
    serverLog('info', 'Giada:      giada@giadacourses.it / Giada2024!');
  }
}

setupFirstRun().then(() => {
  // Verifica uploads directory
  try {
    const testFile = path.join(UPLOADS_DIR, '.write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    serverLog('ok', 'Uploads directory scrivibile:', UPLOADS_DIR);
  } catch(e) {
    serverLog('error', 'UPLOADS DIR NON SCRIVIBILE!', UPLOADS_DIR, e.message);
  }

  httpServer.listen(PORT, '127.0.0.1', () => {
    serverLog('ok', '=============================================');
    serverLog('ok', 'GiadaCourses v7.0 ONLINE su Linux!');
    serverLog('ok', 'Socket.IO + WebRTC + SSE + Fix Upload/Profilo');
    serverLog('ok', '=============================================');
    serverLog('info', 'Porta:   ' + PORT + ' (solo localhost, Nginx espone HTTPS)');
    serverLog('info', 'DB:      ' + DB_DIR);
    serverLog('info', 'Media:   ' + UPLOADS_DIR);
    serverLog('info', 'Socket:  Socket.IO attivo (WebSocket + polling)');
    serverLog('info', 'Stop:    CTRL+C o systemctl stop giadacourses');
    serverLog('ok', '=============================================');
  });
}).catch(err => { serverLog('error', 'ERRORE AVVIO:', err); process.exit(1); });
