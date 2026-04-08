// ============================================================
//  GiadaCourses v11.0 — Architettura Modulare
//  Entry point: collega tutti i moduli
// ============================================================
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server: SocketIO } = require('socket.io');

// ── Load .env file if exists ──
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && key.trim() && !key.startsWith('#')) process.env[key.trim()] = val.join('=').trim();
    });
    console.log('[ENV] Loaded .env file');
  }
} catch (e) { console.warn('[ENV] Could not load .env:', e.message); }

// ── Email setup (nodemailer) ──
let sendMail = null;
try {
  const nodemailer = require('nodemailer');
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: smtpUser, pass: smtpPass }
    });
    sendMail = async (to, subject, html) => {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"GiadaCourses" <noreply@giadacourses.app>',
        to, subject, html
      });
    };
    console.log('[EMAIL] SMTP configured:', smtpHost);
  } else {
    console.log('[EMAIL] SMTP not configured — email features disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
  }
} catch (e) { console.warn('[EMAIL] nodemailer not available:', e.message); }

// ── Push notifications (web-push) ──
let webPush = null;
try {
  webPush = require('web-push');
  const vapidPublic = process.env.VAPID_PUBLIC;
  const vapidPrivate = process.env.VAPID_PRIVATE;
  if (vapidPublic && vapidPrivate) {
    webPush.setVapidDetails('https://giadacourses.duckdns.org', vapidPublic, vapidPrivate);
    console.log('[PUSH] VAPID configured');
  } else {
    console.log('[PUSH] VAPID keys not set — push disabled. Run: npm run generate-vapid and add to .env');
    webPush = null;
  }
} catch (e) { console.warn('[PUSH] web-push not available:', e.message); webPush = null; }

// ── Moduli interni ──
const { db, DB_DIR } = require('./lib/db');
const { sseClients, ioClients, ssePending, sseEmit, sseBroadcast, setIO } = require('./lib/sse');
const { UPLOADS_DIR } = require('./lib/upload');
const { authMiddleware, setupSecurity, logMiddleware, resolveToken } = require('./middleware');

const app = express();
app.locals.sendMail = sendMail;
app.locals.webPush = webPush;
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── Logging ──
function serverLog(level, ...args) {
  const ts = new Date().toISOString();
  const prefix = { info: '[INFO]', warn: '[WARN]', error: '[ERROR]', ok: '[OK]' }[level] || '[LOG]';
  console.log(`${ts} ${prefix}`, ...args);
}
process.on('uncaughtException', err => serverLog('error', 'Uncaught:', err.message));
process.on('unhandledRejection', reason => serverLog('warn', 'Unhandled:', reason));

// ── GZIP Compression (riduce traffico ~70%) ──
let compression;
try { compression = require('compression'); } catch { compression = null; }
if (compression) {
  app.use(compression({ level: 6, threshold: 1024, filter: (req) => !req.path.startsWith('/api/events') }));
  console.log('[PERF] GZIP compression attiva');
} else {
  console.log('[WARN] compression non installato. Esegui: npm install compression');
}

// ── Security + CORS ──
const ALLOWED_ORIGINS = setupSecurity(app);

// ── Body parsers ──
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Auth middleware globale ──
app.use(authMiddleware);
app.use(logMiddleware);

// ── Static files (sicuro) ──
app.use((req, res, next) => {
  const blocked = /\.(db|log|env|git)$/i;
  const reqPath = req.path.toLowerCase();
  if (blocked.test(reqPath) && !reqPath.startsWith('/uploads/')) return res.status(403).json({ error: 'Accesso negato' });
  // Blocca accesso diretto a file APK
  if (reqPath.endsWith('.apk')) return res.status(403).json({ error: 'Accesso negato. Vai su giadacourses.duckdns.org' });
  // Blocca accesso a file server
  if (reqPath === '/server.js' || reqPath === '/package.json' || reqPath.startsWith('/routes/') || reqPath.startsWith('/lib/') || reqPath.startsWith('/middleware/')) return res.status(403).json({ error: 'Accesso negato' });
  next();
});
// Static files con cache intelligente
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: 'index.html',
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) { res.setHeader('Cache-Control', 'no-cache'); }
    else if (filePath.endsWith('.css') || filePath.endsWith('.js')) { res.setHeader('Cache-Control', 'public, max-age=3600'); }
    else if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(filePath)) { res.setHeader('Cache-Control', 'public, max-age=86400'); }
  }
}));

// ── Download APK protetto — solo dal sito ──
app.get('/api/download-apk', (req, res) => {
  const referer = req.headers.referer || req.headers.origin || '';
  const validReferer = referer.includes('giadacourses.duckdns.org') || referer.includes('localhost');
  if (!validReferer) {
    return res.status(403).send('<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#1E1E3F;color:#fff"><h1>Accesso negato</h1><p>Per scaricare l\'app vai su:</p><a href="https://giadacourses.duckdns.org" style="color:#9C7CFF;font-size:1.2rem">giadacourses.duckdns.org</a></body></html>');
  }
  const apkPath = path.join(__dirname, 'uploads', 'GiadaCourses-beta.apk');
  if (!fs.existsSync(apkPath)) return res.status(404).json({ error: 'APK non trovata' });
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="GiadaCourses.apk"');
  res.sendFile(apkPath);
});

// ── Socket.IO setup ──
const io = new SocketIO(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET','POST'], credentials: true },
  pingInterval: 15000, pingTimeout: 30000,
  maxHttpBufferSize: 5e6, transports: ['websocket', 'polling'],
});
setIO(io);

// ============================================================
//  ROUTES — Ogni modulo registra le sue route
// ============================================================
require('./routes/auth')(app);
require('./routes/content')(app);
const socialState = require('./routes/social')(app);
require('./routes/learning')(app, socialState);

// ── Ping ──
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), version: '11.1', env: 'linux' });
});

// ── Health check (pubblico) ──
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
    connections: { sse: sseClients.size, io: ioClients.size },
  });
});

// ── Pulizia automatica periodica ──
setInterval(async () => {
  try {
    // Pulisci sessioni scadute (>7 giorni)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const removed = await db.sessions.removeAsync({ createdAt: { $lt: cutoff } }, { multi: true });
    if (removed > 0) serverLog('info', `Pulizia: ${removed} sessioni scadute rimosse`);
    // Pulisci log vecchi (>30 giorni)
    const logCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const logsRemoved = await db.logs.removeAsync({ timestamp: { $lt: logCutoff } }, { multi: true });
    if (logsRemoved > 0) serverLog('info', `Pulizia: ${logsRemoved} log vecchi rimossi`);
    // Pulisci daily missions vecchie (>7 giorni)
    const dailyCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await db.daily.removeAsync({ createdAt: { $lt: dailyCutoff } }, { multi: true });
    // Pulisci chiamate orfane (>5 minuti senza risposta)
    if (socialState?.activeCalls) {
      const callCutoff = Date.now() - 300000;
      for (const [id, call] of socialState.activeCalls) {
        if (!call.answered && call.startedAt < callCutoff) { socialState.activeCalls.delete(id); }
      }
    }
    // Pulisci sfide orfane (>10 minuti se pending, >30 minuti se active)
    if (socialState?.activeChallenges) {
      const pendCutoff = Date.now() - 600000;
      const actCutoff = Date.now() - 1800000;
      for (const [id, ch] of socialState.activeChallenges) {
        if (ch.status === 'pending' && ch.createdAt < pendCutoff) socialState.activeChallenges.delete(id);
        else if (ch.status === 'active' && ch.startedAt < actCutoff) socialState.activeChallenges.delete(id);
      }
    }
    // Pulisci SSE connections morte
    for (const [uid, set] of sseClients) {
      for (const res of set) { try { if (res.writableEnded || res.destroyed) set.delete(res); } catch { set.delete(res); } }
      if (!set.size) sseClients.delete(uid);
    }
    // Pulisci Socket.IO connections morte
    for (const [uid, set] of ioClients) {
      for (const s of set) { if (s.disconnected) set.delete(s); }
      if (!set.size) ioClients.delete(uid);
    }
    // Compatta database
    for (const [name, store] of Object.entries(db)) {
      if (store?.persistence?.compactDatafile) store.persistence.compactDatafile();
    }
  } catch (e) { serverLog('warn', 'Pulizia periodica errore:', e.message); }
}, 6 * 60 * 60 * 1000); // Ogni 6 ore

// ── SSE Heartbeat — mantiene vive le connessioni mobili ──
setInterval(() => {
  const payload = `event: heartbeat\ndata: ${JSON.stringify({ts:Date.now()})}\n\n`;
  for (const [uid, set] of sseClients) {
    for (const res of set) {
      try { res.write(payload); } catch { set.delete(res); }
    }
  }
}, 25000); // Ogni 25 secondi

// ── Database index hints (NeDB) — velocizza le query frequenti ──
try {
  db.users.ensureIndexAsync({ fieldName: 'email', unique: true, sparse: true }).catch(()=>{});
  db.users.ensureIndexAsync({ fieldName: 'username', unique: true, sparse: true }).catch(()=>{});
  db.sessions.ensureIndexAsync({ fieldName: 'token', unique: true }).catch(()=>{});
  db.sessions.ensureIndexAsync({ fieldName: 'userId' }).catch(()=>{});
  db.posts.ensureIndexAsync({ fieldName: 'userId' }).catch(()=>{});
  db.posts.ensureIndexAsync({ fieldName: 'timestamp' }).catch(()=>{});
  db.messages.ensureIndexAsync({ fieldName: 'toId' }).catch(()=>{});
  db.messages.ensureIndexAsync({ fieldName: 'fromId' }).catch(()=>{});
  db.stories.ensureIndexAsync({ fieldName: 'userId' }).catch(()=>{});
  db.stories.ensureIndexAsync({ fieldName: 'timestamp' }).catch(()=>{});
  db.daily.ensureIndexAsync({ fieldName: 'userId' }).catch(()=>{});
  serverLog('ok', 'Database indexes configurati');
} catch(e) { serverLog('warn', 'DB index error:', e.message); }

// ── Server status ──
app.get('/api/server-status', (req, res) => {
  if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'Non autorizzato' });
  const activeLives = [];
  if (socialState?.liveStreams) {
    for (const [sid, s] of socialState.liveStreams) {
      if (s.active) activeLives.push({ streamId: sid, host: s.hostName, viewers: s.viewers.size });
    }
  }
  res.json({
    uptime: process.uptime(), memory: process.memoryUsage(),
    sseClients: sseClients.size, ioClients: ioClients.size,
    activeCalls: socialState?.activeCalls?.size || 0,
    activeChallenges: socialState?.activeChallenges?.size || 0,
    activeLives, nodeVersion: process.version,
  });
});

// ── SPA Fallback ──
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(__dirname, 'public', 'index.html'));
  else res.status(404).json({ error: 'Endpoint non trovato' });
});

// ── Global error handler ──
app.use((err, req, res, next) => {
  const s = err.status || 500;
  if (s === 416) return res.status(200).set('Accept-Ranges','bytes').end();
  serverLog('error', `${req.method} ${req.path}:`, err.message);
  res.status(s).json({ error: err.message || 'Errore server' });
});

// ============================================================
//  SOCKET.IO — Comunicazione bidirezionale
// ============================================================
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.t || '';
  if (!token) return next(new Error('Token mancante'));
  try {
    const session = await db.sessions.findOneAsync({ token });
    if (!session) return next(new Error('Sessione non valida'));
    const user = await db.users.findOneAsync({ _id: session.userId });
    if (!user || user.banned) return next(new Error('Utente non trovato'));
    socket.userId = user._id; socket.username = user.username;
    socket.userRole = user.role; socket.userAvatar = user.avatar || '';
    socket.userAvatarUrl = user.avatarUrl || '';
    next();
  } catch { next(new Error('Errore autenticazione')); }
});

io.on('connection', (socket) => {
  const uid = String(socket.userId);
  if (!ioClients.has(uid)) ioClients.set(uid, new Set());
  ioClients.get(uid).add(socket);
  serverLog('info', `Socket.IO: ${socket.username} connesso (${uid})`);

  // Replay pending
  const pending = ssePending.get(uid) || [];
  for (const e of pending) { try { socket.emit(e.event, e.data); } catch {} }
  ssePending.delete(uid);
  socket.join('user:' + uid);


  // ── Chiamate: Socket.IO relay per ICE (bassa latenza, NO doppio invio) ──
  socket.on('call:ice', (data) => {
    if (!data.targetUserId || !data.candidate) return;
    const targetUid = String(data.targetUserId);
    // Invia SOLO via Socket.IO al target (evita doppia consegna)
    const targetSockets = ioClients.get(targetUid);
    if (targetSockets && targetSockets.size) {
      for (const s of targetSockets) {
        try { s.emit('call_ice', { callId: data.callId, candidate: data.candidate, from: uid }); } catch {}
      }
    } else {
      // Fallback SSE se target non ha Socket.IO
      const sseSet = sseClients.get(targetUid);
      if (sseSet && sseSet.size) {
        const payload = `event: call_ice\ndata: ${JSON.stringify({ callId: data.callId, candidate: data.candidate, from: uid })}\n\n`;
        for (const res of sseSet) { try { res.write(payload); } catch {} }
      }
    }
  });
  socket.on('call:answer', (data) => {
    const call = socialState.activeCalls?.get(data.callId);
    if (call) {
      call.answered = true;
      sseEmit(call.callerId, 'call_answer', { callId: data.callId, answer: data.answer, from: uid });
    }
  });
  socket.on('call:reject', (data) => {
    const call = socialState.activeCalls?.get(data.callId);
    if (call) {
      sseEmit(call.callerId, 'call_rejected', { callId: data.callId });
      socialState.activeCalls.delete(data.callId);
    }
  });
  socket.on('call:end', (data) => {
    const call = socialState.activeCalls?.get(data.callId);
    if (call) {
      sseEmit(call.callerId, 'call_ended', { callId: data.callId });
      sseEmit(call.calleeId, 'call_ended', { callId: data.callId });
      socialState.activeCalls.delete(data.callId);
    }
  });
  socket.on('call:ice_flush', (data) => {
    // Trigger immediate ICE delivery via Socket.IO
    if (data.targetUserId && data.callId) {
      const targetSockets = ioClients.get(String(data.targetUserId));
      if (targetSockets) targetSockets.forEach(s => { try { s.emit('call_ice_flush', { callId: data.callId }); } catch {} });
    }
  });

  // ── Sfide: Socket.IO relay per accettazione/rifiuto rapido ──
  socket.on('challenge:accept', (data) => {
    const ch = socialState.activeChallenges?.get(data.challengeId);
    if (ch && ch.challengeeId === uid && ch.status === 'pending') {
      ch.status = 'active'; ch.startedAt = Date.now();
      sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: socialState.safeQuestions(ch.questions) });
      socket.emit('challenge:started', { challengeId: ch.id, questions: socialState.safeQuestions(ch.questions) });
    }
  });
  socket.on('challenge:reject', (data) => {
    const ch = socialState.activeChallenges?.get(data.challengeId);
    if (ch) {
      sseEmit(ch.challengerId, 'challenge_rejected', { challengeId: ch.id });
      socialState.activeChallenges.delete(ch.id);
    }
  });

  // ── LIVE via Socket.IO ──
  socket.on('live:ice', (data) => {
    const stream = socialState.liveStreams.get(data.streamId);
    if (!stream) return;
    const targetId = (!data.targetUserId || data.targetUserId === 'host') ? stream.hostId : data.targetUserId;
    sseEmit(targetId, 'live_ice', { streamId: data.streamId, candidate: data.candidate, from: uid });
    const vRes = socialState.liveViewerSSE.get(`${data.streamId}:${targetId}`);
    if (vRes) { try { vRes.write(`data: ${JSON.stringify({ type: 'ice', candidate: data.candidate })}\n\n`); } catch {} }
  });

  socket.on('live:signal', (data) => {
    const stream = socialState.liveStreams.get(data.streamId);
    if (!stream || stream.hostId !== uid) return;
    sseEmit(data.viewerId, 'live_offer', { streamId: data.streamId, offer: data.offer });
    const vRes = socialState.liveViewerSSE.get(`${data.streamId}:${data.viewerId}`);
    if (vRes) { try { vRes.write(`data: ${JSON.stringify({ type: 'offer', offer: data.offer })}\n\n`); } catch {} }
  });

  socket.on('live:answer', (data) => {
    const stream = socialState.liveStreams.get(data.streamId);
    if (!stream) return;
    sseEmit(stream.hostId, 'live_answer', { streamId: data.streamId, answer: data.answer, from: uid });
  });

  socket.on('live:comment', (data) => {
    const stream = socialState.liveStreams.get(data.streamId);
    if (!stream || !stream.active) return;
    const comment = { id: crypto.randomBytes(4).toString('hex'), userId: uid, username: socket.username, avatar: socket.userAvatar, text: (data.text || '').slice(0, 200), ts: Date.now() };
    stream.comments.push(comment);
    if (stream.comments.length > 300) stream.comments = stream.comments.slice(-300);
    const payload = JSON.stringify({ type: 'comment', comment });
    for (const [k, r] of socialState.liveViewerSSE) { if (k.startsWith(data.streamId + ':')) { try { r.write(`data: ${payload}\n\n`); } catch {} } }
    sseEmit(stream.hostId, 'live_comment', { streamId: data.streamId, comment });
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
    const superHash = await bcrypt.hash('Super2024!', 12);
    await db.users.insertAsync({ username:'SuperAdmin', email:'super@giadacourses.it', passwordHash:superHash, role:'superadmin', avatar:'', avatarUrl:'', xp:0, level:'A1', streak:0, badges:[], bio:'Proprietario della piattaforma', following:[], followers:[], progress:{}, notifyUsers:[], dmNotifyOff:[], verified:false, theme:'light', themeColor:'', joinDate:Date.now(), lastSeen:Date.now(), banned:false, ip:'127.0.0.1' });
    const giadaHash = await bcrypt.hash('Giada2024!', 12);
    await db.users.insertAsync({ username:'Giada', email:'giada@giadacourses.it', passwordHash:giadaHash, role:'admin', avatar:'', avatarUrl:'', xp:0, level:'A1', streak:0, badges:[], bio:'Insegnante di inglese', following:[], followers:[], progress:{}, notifyUsers:[], dmNotifyOff:[], verified:false, theme:'light', themeColor:'', joinDate:Date.now(), lastSeen:Date.now(), banned:false, ip:'127.0.0.1' });
    serverLog('ok', 'Account SuperAdmin e Giada creati!');
  }
}

setupFirstRun().then(() => {
  try { const t = path.join(UPLOADS_DIR, '.write-test'); fs.writeFileSync(t, 'ok'); fs.unlinkSync(t); serverLog('ok', 'Uploads OK'); } catch(e) { serverLog('error', 'UPLOADS NON SCRIVIBILE!', e.message); }
  httpServer.listen(PORT, '127.0.0.1', () => {
    serverLog('ok', '='.repeat(50));
    serverLog('ok', 'GiadaCourses v10.0 ONLINE (ARCHITETTURA MODULARE)');
    serverLog('ok', 'Routes: auth + content + social + learning');
    serverLog('ok', '='.repeat(50));
    serverLog('info', 'Porta: ' + PORT);
    serverLog('info', 'DB: ' + DB_DIR);
    serverLog('info', 'Media: ' + UPLOADS_DIR);
    serverLog('ok', '='.repeat(50));
  });
}).catch(err => { serverLog('error', 'ERRORE AVVIO:', err); process.exit(1); });
