// ============================================================
//  GiadaCourses v9.0 — Linux Production Build (REDESIGN + GAMES)
//  Socket.IO + WebRTC + LIVE + Storie + Sfide 1v1 + Media
//  + Campanellina + Rate Limiting + Security Headers
//  + Anti-cheat + Session expiry + Mini-games + Tips + Changelog
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

// Security dependencies
let helmet, rateLimit;
try { helmet = require('helmet'); } catch { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

const app  = express();
const httpServer = http.createServer(app);

// CORS sicuro: solo il tuo dominio (aggiorna con il tuo dominio reale)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://giadacourses.it,https://www.giadacourses.it,http://localhost:3000').split(',').map(s => s.trim());

const io = new SocketIO(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET','POST'], credentials: true },
  pingInterval: 15000,
  pingTimeout: 30000,
  maxHttpBufferSize: 5e6,
  transports: ['websocket', 'polling'],
});
const PORT = process.env.PORT || 3000;

// Session expiry: 7 giorni
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
const ALLOWED_IMG   = /jpg|jpeg|png|gif|webp|svg/;
const ALLOWED_DOC   = /pdf/;
const ALLOWED_ALL   = new RegExp(`(${ALLOWED_VID.source}|${ALLOWED_AUD.source}|${ALLOWED_IMG.source}|${ALLOWED_DOC.source})`);

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = (file.mimetype || '').toLowerCase();
    // Blocca estensioni pericolose
    const BLOCKED = /exe|bat|cmd|sh|ps1|php|jsp|asp|cgi|py|rb|pl|com|scr|msi|dll|vbs|js$/;
    if (BLOCKED.test(ext)) {
      return cb(new Error('Tipo di file non consentito: .' + ext), false);
    }
    // Verifica che il MIME type sia coerente
    const validMime = mime.startsWith('image/') || mime.startsWith('video/') || 
                      mime.startsWith('audio/') || mime === 'application/pdf' ||
                      mime === 'application/octet-stream';
    if (!validMime) {
      return cb(new Error('MIME type non consentito: ' + mime), false);
    }
    cb(null, true);
  },
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

// -- Security Headers (helmet) --
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // gestita manualmente per SPA
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
}
// Headers di sicurezza manuali (anche senza helmet)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// -- CORS sicuro (solo origini autorizzate) --
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// -- Rate Limiting --
if (rateLimit) {
  // Login: max 10 tentativi / 15 min per IP
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.' }, standardHeaders: true, legacyHeaders: false });
  app.use('/api/auth/login', loginLimiter);
  // Registrazione: max 5 / ora per IP
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: 'Troppe registrazioni. Riprova tra un\'ora.' }, standardHeaders: true, legacyHeaders: false });
  app.use('/api/auth/register', registerLimiter);
  // API generiche: max 200 richieste / minuto per IP
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Troppe richieste. Rallenta.' }, standardHeaders: true, legacyHeaders: false });
  app.use('/api/', apiLimiter);
  // Upload: max 30 / minuto per IP
  const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Troppi upload. Riprova tra poco.' } });
  app.use('/api/media/', uploadLimiter);
  serverLog('ok', 'Rate limiting attivo');
} else {
  serverLog('warn', 'express-rate-limit non installato. Esegui: npm install express-rate-limit helmet');
}

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

// Serve static files - SICURO: blocca accesso a file sensibili
app.use((req, res, next) => {
  const blocked = /\.(js|sh|json|db|log|env|git)$/i;
  const reqPath = req.path.toLowerCase();
  // Permetti solo sw.js e manifest.json tra i file JS/JSON
  if (blocked.test(reqPath) && reqPath !== '/sw.js' && reqPath !== '/manifest.json' && !reqPath.startsWith('/uploads/')) {
    return res.status(403).json({ error: 'Accesso negato' });
  }
  next();
});
app.use(express.static(path.join(__dirname), {
  dotfiles: 'deny',
  index: false,
}));

// ============================================================
//  AUTH MIDDLEWARE
// ============================================================
async function resolveToken(raw) {
  const token = (raw || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const session = await db.sessions.findOneAsync({ token });
  if (!session) return null;
  // Sessione scaduta? Elimina e rifiuta
  if (session.createdAt && (Date.now() - session.createdAt > SESSION_MAX_AGE_MS)) {
    await db.sessions.removeAsync({ token }, {});
    return null;
  }
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
    // Validazione email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) return res.status(400).json({ error: 'Email non valida' });
    // Validazione username (solo alfanumerici, _, -)
    const usernameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!usernameRegex.test(username.trim())) return res.status(400).json({ error: 'Username: solo lettere, numeri, _ e -' });
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
    const hash = await bcrypt.hash(password, 12);
    const user = await db.users.insertAsync({
      username: cleanUsername, email: cleanEmail, passwordHash: hash, role: 'user',
      avatar: '', avatarUrl: '', xp: 0, level: level || 'A1', streak: 0, badges: [],
      bio: (bio || '').slice(0, 200), city: (city || '').slice(0, 50), 
      nativeLang: nativeLang || '', goal: (goal || '').slice(0, 100),
      following: [], followers: [], progress: {},
      notifyUsers: [], // Campanellina: lista di userId di cui ricevere notifiche
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
  // Se unfollow, rimuovi anche la campanellina
  if (already) {
    const myNotify = me.notifyUsers || [];
    if (myNotify.includes(targetId)) {
      await db.users.updateAsync({ _id: me._id }, { $set: { notifyUsers: myNotify.filter(id=>id!==targetId) } });
    }
  }
  res.json({ following: !already });
});

// ============================================================
//  CAMPANELLINA — Notifiche per profili specifici
// ============================================================
// Toggle campanellina per un utente (ricevi notifiche quando pubblica storie, post, ecc.)
app.post('/api/users/:id/notify-toggle', requireAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user._id) return res.status(400).json({ error: 'Non puoi attivare notifiche per te stesso' });
    const target = await db.users.findOneAsync({ _id: targetId });
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    const me = await db.users.findOneAsync({ _id: req.user._id });
    // Devi seguire l'utente per attivare la campanellina
    if (!(me.following || []).includes(targetId)) {
      return res.status(400).json({ error: 'Devi seguire questo utente per attivare le notifiche' });
    }
    const notifyUsers = me.notifyUsers || [];
    const active = notifyUsers.includes(targetId);
    const updated = active ? notifyUsers.filter(id => id !== targetId) : [...notifyUsers, targetId];
    await db.users.updateAsync({ _id: me._id }, { $set: { notifyUsers: updated } });
    res.json({ notify: !active, targetId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ottieni stato campanellina per un utente
app.get('/api/users/:id/notify-status', requireAuth, async (req, res) => {
  try {
    const me = await db.users.findOneAsync({ _id: req.user._id });
    const active = (me.notifyUsers || []).includes(req.params.id);
    res.json({ notify: active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Helper: notifica solo gli utenti con campanellina attiva per un dato autore
async function notifyBellUsers(authorId, event, data) {
  const subscribers = await db.users.findAsync({ notifyUsers: authorId });
  for (const sub of subscribers) {
    if (sub._id !== authorId) {
      sseEmit(sub._id, event, data);
    }
  }
}

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
      duration: Math.min(15, Math.max(3, parseInt(req.body.duration) || 15)),
      music: (req.body.music && req.body.music !== 'none') ? req.body.music : null,
      musicTitle: (req.body.music && req.body.music !== 'none') ? (req.body.musicTitle || '') : '',
      textOverlays,
      timestamp: Date.now(), views: [],
    });
    sseBroadcast('new_story', { storyId: story._id, userId: req.user._id, username: req.user.username, avatar: req.user.avatar });
    // Campanellina: notifica utenti con bell attiva per questo autore
    notifyBellUsers(req.user._id, 'bell_story', { userId: req.user._id, username: req.user.username, avatar: req.user.avatar, storyId: story._id }).catch(() => {});
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
  // Campanellina: notifica utenti con bell attiva per questo autore
  notifyBellUsers(req.user._id, 'bell_post', { userId: req.user._id, username: req.user.username, postId: post._id, text: (post.text||'').slice(0,50) }).catch(() => {});
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
    // Genera password temporanea random (8 char alfanumerici)
    const DEFAULT_PASSWORD = process.env.RESET_PASSWORD || crypto.randomBytes(4).toString('hex') + 'A1!';
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    await db.users.updateAsync({ _id: req.params.id }, { $set: { passwordHash: hash } });
    // Invalida tutte le sessioni dell'utente così deve rifare il login
    await db.sessions.removeAsync({ userId: req.params.id }, { multi: true });
    serverLog('info', `Password reset: ${req.user.username} ha reimpostato la password di ${user.username} -> ${DEFAULT_PASSWORD}`);
    res.json({ ok: true, username: user.username, tempPassword: DEFAULT_PASSWORD });
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
    // Auto-timeout: se nessuno risponde entro 60s, pulisci la chiamata
    setTimeout(() => {
      const c = activeCalls.get(callId);
      if (c && !c.answered) {
        sseEmit(c.callerId, 'call_timeout', { callId });
        sseEmit(c.calleeId, 'call_timeout', { callId });
        activeCalls.delete(callId);
        serverLog('info', `Chiamata ${callId}: timeout (nessuna risposta)`);
      }
    }, 60000);
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
  call.answered = true;
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

// Helper: rimuovi risposte corrette prima di inviare al client (ANTI-CHEAT)
function safeQuestions(questions) {
  return (questions || []).map(q => ({
    question: q.question || q.q || '',
    options: q.options || q.opts || [],
    type: q.type || 'multiple',
    exerciseTitle: q.exerciseTitle || '',
    // NON inviare correctIndex/correct/expl al client!
  }));
}

app.post('/api/challenges/:id/accept', requireAuth, async (req, res) => {
  const ch = activeChallenges.get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Sfida non trovata o scaduta' });
  if (ch.challengeeId !== req.user._id) return res.status(403).json({ error: 'Non sei il destinatario' });
  if (ch.status !== 'pending') return res.status(400).json({ error: 'Sfida gia avviata' });
  ch.status = 'active';
  ch.startedAt = Date.now();
  sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: safeQuestions(ch.questions) });
  res.json({ ok: true, questions: safeQuestions(ch.questions), challengeId: ch.id });
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
  // Verifica che l'utente sia un partecipante
  if (req.user._id !== ch.challengerId && req.user._id !== ch.challengeeId) {
    return res.status(403).json({ error: 'Non sei un partecipante di questa sfida' });
  }
  if (!ch.scores[req.user._id]) ch.scores[req.user._id] = [];
  const myScores = ch.scores[req.user._id];
  if (myScores[questionIndex] !== undefined) return res.json({ ok: true });
  // Validazione questionIndex
  if (questionIndex < 0 || questionIndex >= ch.questions.length) return res.status(400).json({ error: 'Domanda non valida' });
  const q = ch.questions[questionIndex];
  const correctIdx = parseInt(q.correctIndex ?? q.correct ?? 0) || 0;
  const correct = parseInt(answerIndex) === correctIdx;
  // Anti-cheat: limita timeMs minimo a 500ms (impossibile rispondere prima)
  const clampedTime = Math.max(500, Math.min(timeMs || 15000, 15000));
  const points = correct ? Math.max(10, 100 - Math.floor(clampedTime / 100)) : 0;
  myScores[questionIndex] = { answerIndex, correct, points, timeMs: clampedTime };
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
  // Non inviare correctIndex nella risposta - solo correct/points
  res.json({ ok: true, correct, points, result });
});

app.get('/api/challenges/:id', requireAuth, async (req, res) => {
  const ch = activeChallenges.get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Non trovata' });
  // Anti-cheat: non inviare correctIndex
  res.json({ id: ch.id, status: ch.status, questions: safeQuestions(ch.questions), scores: ch.scores, currentQ: ch.currentQ });
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
  res.json({ ok: true, ts: Date.now(), version: '9.0-redesign', env: 'linux', uploadsDir: UPLOADS_DIR });
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

// ============================================================
//  CONSIGLI INGLESE — Tips randomici per gli utenti
// ============================================================
const ENGLISH_TIPS = [
  { cat: 'Grammar', tip: 'Use "fewer" for countable nouns and "less" for uncountable. Fewer apples, less water.', level: 'A2' },
  { cat: 'Grammar', tip: 'Present Perfect: use "have/has + past participle" for experiences. "I have visited Rome."', level: 'A2' },
  { cat: 'Grammar', tip: '"Since" refers to a point in time, "for" to a duration. "Since 2020" vs "for 3 years."', level: 'B1' },
  { cat: 'Grammar', tip: 'Third conditional: If + past perfect, would + have + past participle. "If I had studied, I would have passed."', level: 'B2' },
  { cat: 'Grammar', tip: 'Inversion after negative adverbs: "Never have I seen such beauty." (formal/literary)', level: 'C1' },
  { cat: 'Vocabulary', tip: 'Instead of "very tired", try "exhausted". Instead of "very happy", try "thrilled" or "ecstatic".', level: 'B1' },
  { cat: 'Vocabulary', tip: 'Phrasal verb: "look up" = search for information. "Let me look that up for you."', level: 'A2' },
  { cat: 'Vocabulary', tip: 'False friend: "actually" in English means "in realta", NOT "attualmente" (which is "currently").', level: 'A2' },
  { cat: 'Vocabulary', tip: '"Eventually" means "alla fine/prima o poi", NOT "eventualmente" (which is "possibly").', level: 'B1' },
  { cat: 'Vocabulary', tip: 'Collocations matter: we "make" a decision but "do" homework. We "take" a photo but "make" a mistake.', level: 'B1' },
  { cat: 'Vocabulary', tip: '"To be on the same page" = essere d\'accordo. "Let\'s make sure we\'re on the same page."', level: 'B2' },
  { cat: 'Vocabulary', tip: '"Break a leg!" means "In bocca al lupo!" - used to wish someone good luck, especially before a performance.', level: 'A2' },
  { cat: 'Pronunciation', tip: 'The "th" sound: put your tongue between your teeth. "Think" and "this" have different th sounds.', level: 'A1' },
  { cat: 'Pronunciation', tip: '"Comfortable" is pronounced COM-fter-bul (3 syllables, not 4). Many learners add an extra syllable.', level: 'B1' },
  { cat: 'Pronunciation', tip: 'Silent letters: "knife" (k silent), "psychology" (p silent), "Wednesday" (d silent).', level: 'A2' },
  { cat: 'Pronunciation', tip: 'Word stress changes meaning: "REcord" (noun) vs "reCORD" (verb), "PREsent" (noun) vs "preSENT" (verb).', level: 'B1' },
  { cat: 'Culture', tip: 'In English-speaking cultures, small talk about weather is very common and a polite way to start conversations.', level: 'A1' },
  { cat: 'Culture', tip: 'British vs American: "flat" vs "apartment", "lift" vs "elevator", "boot" vs "trunk" (of a car).', level: 'A2' },
  { cat: 'Culture', tip: '"How do you do?" is a formal greeting, NOT a question about health. The answer is "How do you do?" back.', level: 'B1' },
  { cat: 'Culture', tip: 'In business English, emails often end with "Kind regards" (formal) or "Best" (semi-formal), not "Bye".', level: 'B1' },
  { cat: 'Study Tips', tip: 'Watch English shows with English subtitles (not Italian). Your brain learns spelling AND pronunciation together.', level: 'A1' },
  { cat: 'Study Tips', tip: 'The "shadowing" technique: listen to a native speaker and repeat immediately after them, mimicking their rhythm.', level: 'B1' },
  { cat: 'Study Tips', tip: 'Keep a vocabulary journal. Write new words with: definition, example sentence, and Italian translation.', level: 'A1' },
  { cat: 'Study Tips', tip: 'Change your phone language to English. You\'ll learn tech vocabulary naturally every day.', level: 'A1' },
  { cat: 'Study Tips', tip: 'Read song lyrics while listening. Music helps your brain memorize phrases and pronunciation patterns.', level: 'A1' },
  { cat: 'Common Mistakes', tip: '"I am agree" is WRONG. Say "I agree". No "am/is/are" needed with agree.', level: 'A1' },
  { cat: 'Common Mistakes', tip: '"It depends ON" (not "from"). "It depends on the weather."', level: 'A2' },
  { cat: 'Common Mistakes', tip: '"I\'m used to doing" (abituato a fare) vs "I used to do" (facevo/ero solito fare). Different meanings!', level: 'B1' },
  { cat: 'Common Mistakes', tip: 'Don\'t say "I have 20 years". Say "I am 20 years old". English uses "to be" for age, not "to have".', level: 'A1' },
  { cat: 'Common Mistakes', tip: '"Fun" is an adjective/noun. "Funny" means it makes you laugh. "The party was fun" vs "The joke was funny."', level: 'A2' },
  { cat: 'Idioms', tip: '"It\'s raining cats and dogs" = sta piovendo a dirotto. Nothing to do with animals!', level: 'B1' },
  { cat: 'Idioms', tip: '"Piece of cake" = facilissimo. "The exam was a piece of cake!"', level: 'A2' },
  { cat: 'Idioms', tip: '"To kill two birds with one stone" = prendere due piccioni con una fava.', level: 'B1' },
  { cat: 'Idioms', tip: '"Once in a blue moon" = molto raramente. "I eat fast food once in a blue moon."', level: 'B1' },
  { cat: 'Idioms', tip: '"The ball is in your court" = tocca a te decidere. Used in business and everyday English.', level: 'B2' },
];
// Track seen tips per user session to avoid repeats
const _tipsSeen = new Map();

app.get('/api/tips/random', (req, res) => {
  const uid = req.user?._id || req.ip || 'anon';
  const level = req.query.level || '';
  let pool = [...ENGLISH_TIPS];
  if (level) pool = pool.filter(t => t.level === level || t.level <= level);
  if (!_tipsSeen.has(uid)) _tipsSeen.set(uid, new Set());
  const seen = _tipsSeen.get(uid);
  let unseen = pool.filter((_, i) => !seen.has(i));
  if (unseen.length === 0) { seen.clear(); unseen = pool; }
  const idx = pool.indexOf(unseen[Math.floor(Math.random() * unseen.length)]);
  seen.add(idx);
  // Cleanup old sessions periodically
  if (_tipsSeen.size > 500) { const entries = [..._tipsSeen.entries()]; entries.slice(0, 250).forEach(([k]) => _tipsSeen.delete(k)); }
  res.json(pool[idx]);
});

// ============================================================
//  CHANGELOG — Novita del social
// ============================================================
app.get('/api/changelog', (req, res) => {
  res.json([
    { version: '9.0', date: '2026-03-25', title: 'Mega Update: Redesign + Giochi + Sicurezza',
      changes: ['Redesign completo dell\'interfaccia', 'Nuova sezione Giochi con minigiochi', 'Campanellina notifiche per profili', 'Anti-cheat sfide 1v1', 'Sezione Novita con changelog e consigli', 'Nuovi tipi di esercizi', 'Rate limiting e security headers', 'Backup e rollback di emergenza'] },
    { version: '8.0', date: '2026-03-24', title: 'Security Hardened',
      changes: ['CORS sicuro', 'Rate limiting su login/API', 'Validazione upload MIME', 'Sessioni con scadenza', 'XSS fix completo', 'Campanellina notifiche'] },
    { version: '7.0', date: '2026-03-20', title: 'Lancio Piattaforma',
      changes: ['Socket.IO + WebRTC', 'Chiamate audio/video', 'Sfide 1v1', 'Dirette LIVE', 'Storie 24h', 'Messaggi diretti', 'Sistema XP e livelli'] },
  ]);
});

// ============================================================
//  SUGGERIMENTI ESERCIZI PER GIADA (solo admin)
// ============================================================
app.get('/api/giada/suggestions', requireAuth, async (req, res) => {
  const isGiada = req.user.username?.toLowerCase() === 'giada' || req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isGiada) return res.status(403).json({ error: 'Solo Giada e admin' });
  try {
    const allEx = await db.exercises.findAsync({});
    const users = await db.users.findAsync({ banned: false, role: 'user' });
    // Analisi: quali livelli/categorie mancano
    const existingLevels = new Set(allEx.map(e => e.level));
    const existingCats = new Set(allEx.map(e => e.category));
    const userLevels = {};
    users.forEach(u => { userLevels[u.level] = (userLevels[u.level] || 0) + 1; });
    const CATEGORIES = ['Grammatica', 'Vocabolario', 'Ascolto', 'Lettura', 'Scrittura', 'Pronuncia', 'Conversazione', 'Idiomi', 'Business English', 'Phrasal Verbs'];
    const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const TYPES = [
      { type: 'quiz', name: 'Quiz a risposta multipla', desc: 'Classico quiz con 4 opzioni' },
      { type: 'fill', name: 'Riempi gli spazi', desc: 'Completa le frasi con la parola mancante' },
      { type: 'match', name: 'Abbina', desc: 'Collega parole/frasi al significato corretto' },
      { type: 'order', name: 'Riordina la frase', desc: 'Metti le parole nell\'ordine giusto' },
      { type: 'listen', name: 'Ascolto', desc: 'Ascolta e rispondi alle domande' },
      { type: 'translate', name: 'Traduci', desc: 'Traduci dall\'italiano all\'inglese o viceversa' },
    ];
    const suggestions = [];
    // Suggerisci categorie mancanti per livelli popolari
    const popularLevels = Object.entries(userLevels).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    for (const lv of popularLevels) {
      for (const cat of CATEGORIES) {
        const exists = allEx.some(e => e.level === lv && e.category === cat);
        if (!exists) {
          suggestions.push({ priority: 'alta', level: lv, category: cat, reason: `${userLevels[lv]} utenti al livello ${lv} ma nessun esercizio di "${cat}"` });
        }
      }
    }
    // Suggerisci tipi di esercizio non ancora usati
    const existingTypes = new Set(allEx.map(e => e.type));
    for (const t of TYPES) {
      if (!existingTypes.has(t.type)) {
        suggestions.push({ priority: 'media', type: t.type, typeName: t.name, typeDesc: t.desc, reason: `Tipo "${t.name}" non ancora presente` });
      }
    }
    res.json({ suggestions: suggestions.slice(0, 15), stats: { totalExercises: allEx.length, totalUsers: users.length, usersByLevel: userLevels, exerciseTypes: TYPES } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
//  GIOCHI — Dati per minigiochi client-side
// ============================================================
const WORD_SCRAMBLE_BANK = {
  A1: [
    { word: 'APPLE', hint: 'A red fruit', it: 'Mela' },
    { word: 'HOUSE', hint: 'Where you live', it: 'Casa' },
    { word: 'WATER', hint: 'You drink it', it: 'Acqua' },
    { word: 'HAPPY', hint: 'Feeling good', it: 'Felice' },
    { word: 'GREEN', hint: 'A color of grass', it: 'Verde' },
    { word: 'BREAD', hint: 'You eat it for breakfast', it: 'Pane' },
    { word: 'SCHOOL', hint: 'Where you study', it: 'Scuola' },
    { word: 'FRIEND', hint: 'A person you like', it: 'Amico' },
    { word: 'MUSIC', hint: 'You listen to it', it: 'Musica' },
    { word: 'CHAIR', hint: 'You sit on it', it: 'Sedia' },
  ],
  A2: [
    { word: 'KITCHEN', hint: 'Room where you cook', it: 'Cucina' },
    { word: 'WEATHER', hint: 'Rain, sun, snow...', it: 'Tempo' },
    { word: 'JOURNEY', hint: 'A long trip', it: 'Viaggio' },
    { word: 'LIBRARY', hint: 'Place with many books', it: 'Biblioteca' },
    { word: 'MORNING', hint: 'Before afternoon', it: 'Mattina' },
    { word: 'CHICKEN', hint: 'A farm bird', it: 'Pollo' },
    { word: 'HOLIDAY', hint: 'Vacation time', it: 'Vacanza' },
    { word: 'HUSBAND', hint: 'Married man', it: 'Marito' },
    { word: 'COUNTRY', hint: 'Italy is one', it: 'Paese' },
    { word: 'BEDROOM', hint: 'Where you sleep', it: 'Camera' },
  ],
  B1: [
    { word: 'KNOWLEDGE', hint: 'What you gain from learning', it: 'Conoscenza' },
    { word: 'CHALLENGE', hint: 'Something difficult to do', it: 'Sfida' },
    { word: 'BEAUTIFUL', hint: 'Very pretty', it: 'Bellissimo' },
    { word: 'DANGEROUS', hint: 'Not safe', it: 'Pericoloso' },
    { word: 'EDUCATION', hint: 'School and learning', it: 'Istruzione' },
    { word: 'POLLUTION', hint: 'Makes air dirty', it: 'Inquinamento' },
    { word: 'EXPENSIVE', hint: 'Costs a lot', it: 'Costoso' },
    { word: 'SURPRISED', hint: 'Feeling of shock', it: 'Sorpreso' },
    { word: 'EXCELLENT', hint: 'Very very good', it: 'Eccellente' },
    { word: 'DIFFERENT', hint: 'Not the same', it: 'Diverso' },
  ],
  B2: [
    { word: 'ACHIEVEMENT', hint: 'Something you accomplished', it: 'Risultato' },
    { word: 'ENVIRONMENT', hint: 'Nature around us', it: 'Ambiente' },
    { word: 'OPPORTUNITY', hint: 'A chance to do something', it: 'Opportunita' },
    { word: 'RESPONSIBLE', hint: 'In charge of something', it: 'Responsabile' },
    { word: 'COMFORTABLE', hint: 'Feeling at ease', it: 'Comodo' },
    { word: 'INDEPENDENT', hint: 'Not needing help', it: 'Indipendente' },
    { word: 'COMMUNICATE', hint: 'To share information', it: 'Comunicare' },
    { word: 'TEMPERATURE', hint: 'How hot or cold', it: 'Temperatura' },
  ],
};

app.get('/api/games/word-scramble', (req, res) => {
  const level = req.query.level || 'A1';
  const pool = WORD_SCRAMBLE_BANK[level] || WORD_SCRAMBLE_BANK['A1'];
  // Pick 5 random words
  const selected = [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
  const words = selected.map(w => {
    const letters = w.word.split('');
    // Scramble letters (ensure it's different from original)
    let scrambled;
    do { scrambled = [...letters].sort(() => Math.random() - 0.5).join(''); } while (scrambled === w.word && w.word.length > 2);
    return { scrambled, hint: w.hint, it: w.it, length: w.word.length };
  });
  // Keep answers server-side for verification
  const gameId = crypto.randomBytes(6).toString('hex');
  const answers = selected.map(w => w.word);
  activeChallenges.set('ws_' + gameId, { answers, createdAt: Date.now() });
  setTimeout(() => activeChallenges.delete('ws_' + gameId), 600000);
  res.json({ gameId, words, level });
});

app.post('/api/games/word-scramble/check', requireAuth, async (req, res) => {
  const { gameId, answers: userAnswers } = req.body;
  const game = activeChallenges.get('ws_' + gameId);
  if (!game) return res.status(404).json({ error: 'Partita scaduta' });
  const correctAnswers = game.answers;
  let score = 0;
  const results = userAnswers.map((a, i) => {
    const correct = (a || '').toUpperCase().trim() === correctAnswers[i];
    if (correct) score++;
    return { correct, answer: correctAnswers[i] };
  });
  // Award XP
  const xpEarned = score * 10;
  if (xpEarned > 0 && req.user) {
    await db.users.updateAsync({ _id: req.user._id }, { $inc: { xp: xpEarned } });
  }
  activeChallenges.delete('ws_' + gameId);
  res.json({ score, total: correctAnswers.length, results, xpEarned });
});

// Speed Match game data
const SPEED_MATCH_BANK = {
  A1: [
    { en: 'Dog', it: 'Cane' }, { en: 'Cat', it: 'Gatto' }, { en: 'House', it: 'Casa' },
    { en: 'Book', it: 'Libro' }, { en: 'Car', it: 'Macchina' }, { en: 'Sun', it: 'Sole' },
    { en: 'Moon', it: 'Luna' }, { en: 'Tree', it: 'Albero' }, { en: 'Food', it: 'Cibo' },
    { en: 'Hand', it: 'Mano' }, { en: 'Eye', it: 'Occhio' }, { en: 'Door', it: 'Porta' },
  ],
  A2: [
    { en: 'Knowledge', it: 'Conoscenza' }, { en: 'Freedom', it: 'Liberta' }, { en: 'Dream', it: 'Sogno' },
    { en: 'Strength', it: 'Forza' }, { en: 'Journey', it: 'Viaggio' }, { en: 'Island', it: 'Isola' },
    { en: 'Bridge', it: 'Ponte' }, { en: 'Cloud', it: 'Nuvola' }, { en: 'Forest', it: 'Foresta' },
    { en: 'Storm', it: 'Tempesta' }, { en: 'River', it: 'Fiume' }, { en: 'Mountain', it: 'Montagna' },
  ],
  B1: [
    { en: 'Achievement', it: 'Traguardo' }, { en: 'Behaviour', it: 'Comportamento' }, { en: 'Challenge', it: 'Sfida' },
    { en: 'Development', it: 'Sviluppo' }, { en: 'Environment', it: 'Ambiente' }, { en: 'Government', it: 'Governo' },
    { en: 'Improvement', it: 'Miglioramento' }, { en: 'Opportunity', it: 'Opportunita' }, { en: 'Society', it: 'Societa' },
    { en: 'Research', it: 'Ricerca' }, { en: 'Experience', it: 'Esperienza' }, { en: 'Relationship', it: 'Relazione' },
  ],
};

app.get('/api/games/speed-match', (req, res) => {
  const level = req.query.level || 'A1';
  const pool = SPEED_MATCH_BANK[level] || SPEED_MATCH_BANK['A1'];
  const selected = [...pool].sort(() => Math.random() - 0.5).slice(0, 8);
  res.json({ pairs: selected, level });
});

// Fill the Gap game
const FILL_GAP_BANK = {
  A1: [
    { sentence: 'I ___ a student.', answer: 'am', options: ['am', 'is', 'are', 'be'] },
    { sentence: 'She ___ to school every day.', answer: 'goes', options: ['go', 'goes', 'going', 'gone'] },
    { sentence: 'They ___ playing football.', answer: 'are', options: ['is', 'am', 'are', 'be'] },
    { sentence: 'He ___ a big house.', answer: 'has', options: ['have', 'has', 'having', 'had'] },
    { sentence: 'We ___ from Italy.', answer: 'are', options: ['is', 'am', 'are', 'be'] },
  ],
  A2: [
    { sentence: 'I have ___ been to London.', answer: 'never', options: ['never', 'ever', 'already', 'yet'] },
    { sentence: 'She is ___ than her sister.', answer: 'taller', options: ['tall', 'taller', 'tallest', 'more tall'] },
    { sentence: 'We ___ dinner when the phone rang.', answer: 'were having', options: ['had', 'were having', 'have', 'having'] },
    { sentence: 'If it rains, I ___ stay home.', answer: 'will', options: ['will', 'would', 'am', 'can'] },
    { sentence: 'He asked me ___ I was from.', answer: 'where', options: ['what', 'where', 'when', 'who'] },
  ],
  B1: [
    { sentence: 'I wish I ___ more free time.', answer: 'had', options: ['have', 'had', 'would have', 'having'] },
    { sentence: 'The report ___ by the time I arrived.', answer: 'had been finished', options: ['was finished', 'had been finished', 'has finished', 'finished'] },
    { sentence: 'She suggested ___ to the cinema.', answer: 'going', options: ['to go', 'going', 'go', 'went'] },
    { sentence: 'Not only ___ he smart, but also kind.', answer: 'is', options: ['is', 'was', 'does', 'has'] },
    { sentence: 'I\'m not used ___ up early.', answer: 'to getting', options: ['to get', 'to getting', 'getting', 'get'] },
  ],
};

app.get('/api/games/fill-gap', (req, res) => {
  const level = req.query.level || 'A1';
  const pool = FILL_GAP_BANK[level] || FILL_GAP_BANK['A1'];
  const selected = [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
  // Shuffle options for each question
  const questions = selected.map(q => ({
    sentence: q.sentence,
    options: [...q.options].sort(() => Math.random() - 0.5),
    // Don't send answer to client (anti-cheat)
  }));
  const gameId = crypto.randomBytes(6).toString('hex');
  activeChallenges.set('fg_' + gameId, { answers: selected.map(q => q.answer), createdAt: Date.now() });
  setTimeout(() => activeChallenges.delete('fg_' + gameId), 600000);
  res.json({ gameId, questions, level });
});

app.post('/api/games/fill-gap/check', requireAuth, async (req, res) => {
  const { gameId, answers: userAnswers } = req.body;
  const game = activeChallenges.get('fg_' + gameId);
  if (!game) return res.status(404).json({ error: 'Partita scaduta' });
  let score = 0;
  const results = userAnswers.map((a, i) => {
    const correct = (a || '').toLowerCase().trim() === game.answers[i].toLowerCase();
    if (correct) score++;
    return { correct, answer: game.answers[i] };
  });
  const xpEarned = score * 15;
  if (xpEarned > 0 && req.user) {
    await db.users.updateAsync({ _id: req.user._id }, { $inc: { xp: xpEarned } });
  }
  activeChallenges.delete('fg_' + gameId);
  res.json({ score, total: game.answers.length, results, xpEarned });
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
      // Auto-timeout chiamata dopo 60s
      setTimeout(() => {
        const c = activeCalls.get(callId);
        if (c && !c.answered) {
          sseEmit(c.callerId, 'call_timeout', { callId });
          sseEmit(c.calleeId, 'call_timeout', { callId });
          activeCalls.delete(callId);
        }
      }, 60000);
      serverLog('info', `Chiamata ${callId}: ${socket.username} -> ${target.username}`);
    } catch(e) { socket.emit('call:error', { error: e.message }); }
  });

  socket.on('call:answer', (data) => {
    const { callId, answer } = data;
    const call = activeCalls.get(callId);
    if (!call) return;
    call.answered = true;
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
    sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: safeQuestions(ch.questions) });
    socket.emit('challenge:started', { challengeId: ch.id, questions: safeQuestions(ch.questions) });
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
    serverLog('ok', 'GiadaCourses v9.0 ONLINE su Linux! (REDESIGN + GAMES)');
    serverLog('ok', 'Socket.IO + WebRTC + SSE + Anti-Cheat + Bell + Games + Tips');
    serverLog('ok', '=============================================');
    serverLog('info', 'Porta:   ' + PORT + ' (solo localhost, Nginx espone HTTPS)');
    serverLog('info', 'DB:      ' + DB_DIR);
    serverLog('info', 'Media:   ' + UPLOADS_DIR);
    serverLog('info', 'Socket:  Socket.IO attivo (WebSocket + polling)');
    serverLog('info', 'Stop:    CTRL+C o systemctl stop giadacourses');
    serverLog('ok', '=============================================');
  });
}).catch(err => { serverLog('error', 'ERRORE AVVIO:', err); process.exit(1); });
