// ============================================================
//  GiadaCourses v10.0 — Architettura Modulare
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

// ── Moduli interni ──
const { db, DB_DIR } = require('./lib/db');
const { sseClients, ioClients, ssePending, sseEmit, sseBroadcast, setIO } = require('./lib/sse');
const { UPLOADS_DIR } = require('./lib/upload');
const { authMiddleware, setupSecurity, logMiddleware, resolveToken } = require('./middleware');

const app = express();
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

// ── Security + CORS ──
const ALLOWED_ORIGINS = setupSecurity(app);

// ── Body parsers ──
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ── Auth middleware globale ──
app.use(authMiddleware);
app.use(logMiddleware);

// ── Static files (sicuro) ──
app.use((req, res, next) => {
  const blocked = /\.(db|log|env|git)$/i;
  const reqPath = req.path.toLowerCase();
  if (blocked.test(reqPath) && !reqPath.startsWith('/uploads/')) return res.status(403).json({ error: 'Accesso negato' });
  // Blocca accesso a file server
  if (reqPath === '/server.js' || reqPath === '/package.json' || reqPath.startsWith('/routes/') || reqPath.startsWith('/lib/') || reqPath.startsWith('/middleware/')) return res.status(403).json({ error: 'Accesso negato' });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: 'index.html' }));

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
  res.json({ ok: true, ts: Date.now(), version: '10.0-modular', env: 'linux' });
});

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

  // ── Chiamate via Socket.IO ──
  socket.on('call:invite', async (data) => {
    try {
      const { toUserId, offer, videoEnabled } = data;
      const target = await db.users.findOneAsync({ _id: toUserId });
      if (!target) return socket.emit('call:error', { error: 'Utente non trovato' });
      const callId = crypto.randomBytes(8).toString('hex');
      socialState.activeCalls.set(callId, {
        callerId: uid, callerName: socket.username, callerAvatar: socket.userAvatar,
        callerAvatarUrl: socket.userAvatarUrl,
        calleeId: toUserId, calleeName: target.username,
        calleeAvatar: target.avatar||'', calleeAvatarUrl: target.avatarUrl||'',
        startedAt: Date.now(), videoEnabled: !!videoEnabled, monitors: new Set(), answered: false
      });
      socket.emit('call:id', { callId });
      sseEmit(toUserId, 'call_invite', {
        callId, from: uid, fromName: socket.username,
        fromAvatar: socket.userAvatar, fromAvatarUrl: socket.userAvatarUrl,
        videoEnabled: !!videoEnabled, offer
      });
      setTimeout(() => {
        const c = socialState.activeCalls.get(callId);
        if (c && !c.answered) {
          sseEmit(c.callerId, 'call_timeout', { callId });
          sseEmit(c.calleeId, 'call_timeout', { callId });
          socialState.activeCalls.delete(callId);
        }
      }, 60000);
    } catch(e) { socket.emit('call:error', { error: e.message }); }
  });

  socket.on('call:answer', (data) => {
    const call = socialState.activeCalls.get(data.callId);
    if (!call) return;
    call.answered = true;
    sseEmit(call.callerId, 'call_answer', { callId: data.callId, answer: data.answer, from: uid });
  });

  socket.on('call:ice', (data) => {
    if (data.targetUserId) sseEmit(data.targetUserId, 'call_ice', { callId: data.callId, candidate: data.candidate, from: uid });
  });

  socket.on('call:reject', (data) => {
    const call = socialState.activeCalls.get(data.callId);
    if (call) { sseEmit(call.callerId, 'call_rejected', { callId: data.callId }); socialState.activeCalls.delete(data.callId); }
  });

  socket.on('call:end', (data) => {
    const call = socialState.activeCalls.get(data.callId);
    if (call) {
      sseEmit(call.callerId, 'call_ended', { callId: data.callId });
      sseEmit(call.calleeId, 'call_ended', { callId: data.callId });
      call.monitors.forEach(mid => sseEmit(mid, 'call_ended', { callId: data.callId }));
      socialState.activeCalls.delete(data.callId);
    }
  });

  // ── Sfide 1v1 via Socket.IO ──
  socket.on('challenge:invite', async (data) => {
    try {
      const target = await db.users.findOneAsync({ _id: data.toUserId });
      if (!target) return socket.emit('challenge:error', { error: 'Utente non trovato' });
      const questions = await socialState.generateChallengeQuestions();
      const cid = crypto.randomBytes(8).toString('hex');
      const challenge = {
        id: cid, challengerId: uid, challengerName: socket.username, challengerAvatar: socket.userAvatar,
        challengeeId: data.toUserId, challengeeName: target.username, challengeeAvatar: target.avatar || '',
        questions, status: 'pending', scores: { [uid]: [], [data.toUserId]: [] },
        startedAt: null, createdAt: Date.now(),
      };
      socialState.activeChallenges.set(cid, challenge);
      setTimeout(() => { if (socialState.activeChallenges.get(cid)?.status === 'pending') socialState.activeChallenges.delete(cid); }, 300000);
      socket.emit('challenge:id', { challengeId: cid });
      sseEmit(data.toUserId, 'challenge_invite', { challengeId: cid, from: uid, fromName: socket.username, fromAvatar: socket.userAvatar });
    } catch(e) { socket.emit('challenge:error', { error: e.message }); }
  });

  socket.on('challenge:accept', (data) => {
    const ch = socialState.activeChallenges.get(data.challengeId);
    if (!ch || ch.challengeeId !== uid || ch.status !== 'pending') return;
    ch.status = 'active'; ch.startedAt = Date.now();
    sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: socialState.safeQuestions(ch.questions) });
    socket.emit('challenge:started', { challengeId: ch.id, questions: socialState.safeQuestions(ch.questions) });
  });

  socket.on('challenge:reject', (data) => {
    const ch = socialState.activeChallenges.get(data.challengeId);
    if (ch) { sseEmit(ch.challengerId, 'challenge_rejected', { challengeId: ch.id }); socialState.activeChallenges.delete(ch.id); }
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
