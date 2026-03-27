// routes/auth.js — Autenticazione + Profili utente + Follow + Campanellina
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../lib/db');
const { sseEmit } = require('../lib/sse');
const { upload } = require('../lib/upload');
const { requireAuth, requireRole } = require('../middleware');

module.exports = function(app) {

  // ── REGISTRAZIONE ──
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, email, password, level, nativeLang, goal, city, bio } = req.body || {};
      if (!username?.trim()) return res.status(400).json({ error: 'Username obbligatorio' });
      if (!email?.trim()) return res.status(400).json({ error: 'Email obbligatoria' });
      if (!password) return res.status(400).json({ error: 'Password obbligatoria' });
      if (password.length < 6) return res.status(400).json({ error: 'Password troppo corta (minimo 6 caratteri)' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Email non valida' });
      if (!/^[a-zA-Z0-9_\-]+$/.test(username.trim())) return res.status(400).json({ error: 'Username: solo lettere, numeri, _ e -' });
      const cleanUsername = username.trim().slice(0, 30);
      const cleanEmail = email.toLowerCase().trim().slice(0, 100);
      const existing = await db.users.findOneAsync({ $or: [{ email: cleanEmail }, { username: cleanUsername }] });
      if (existing) return res.status(400).json({ error: existing.email === cleanEmail ? 'Email gia registrata' : 'Username gia in uso' });
      const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const ip = rawIp.split(',')[0].trim().replace('::ffff:', '').replace('::1', '127.0.0.1');
      const hash = await bcrypt.hash(password, 12);
      const user = await db.users.insertAsync({
        username: cleanUsername, email: cleanEmail, passwordHash: hash, role: 'user',
        avatar: '', avatarUrl: '', xp: 0, level: level || 'A1', streak: 0, badges: [],
        bio: (bio || '').slice(0, 200), city: (city || '').slice(0, 50),
        nativeLang: nativeLang || '', goal: (goal || '').slice(0, 100),
        following: [], followers: [], progress: {},
        notifyUsers: [], dmNotifyOff: [], verified: false,
        theme: 'light', themeColor: '',
        joinDate: Date.now(), lastSeen: Date.now(), banned: false, ip,
      });
      const token = crypto.randomBytes(32).toString('hex');
      await db.sessions.insertAsync({ token, userId: user._id, createdAt: Date.now() });
      const { passwordHash, ...safe } = user;
      res.json({ user: safe, token });
    } catch (e) { res.status(500).json({ error: 'Errore del server' }); }
  });

  // ── LOGIN ──
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
      res.json({ user: safe, token, mustChangePassword: !!user.mustChangePassword });
    } catch (e) { res.status(500).json({ error: 'Errore del server' }); }
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

  // ── UTENTI ──
  app.get('/api/leaderboard', async (req, res) => {
    const users = await db.users.findAsync({ banned: false });
    res.json(users.sort((a, b) => (b.xp||0) - (a.xp||0)).slice(0, 50).map(({ passwordHash, ip, ...u }) => u));
  });

  app.get('/api/users/suggestions', requireAuth, async (req, res) => {
    try {
      const me = await db.users.findOneAsync({ _id: req.user._id });
      const myFollowing = me.following || [];
      const all = await db.users.findAsync({ banned: false, _id: { $ne: me._id } });
      res.json(all.filter(u => !myFollowing.includes(u._id)).sort(() => Math.random() - 0.5).slice(0, 10).map(({ passwordHash, ip, email, ...u }) => u));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/users/:id/followers', async (req, res) => {
    try {
      const user = await db.users.findOneAsync({ _id: req.params.id });
      if (!user) return res.status(404).json({ error: 'Utente non trovato' });
      const users = await db.users.findAsync({ _id: { $in: user.followers || [] } });
      res.json(users.map(({ passwordHash, ip, email, ...u }) => u));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/users/:id/following', async (req, res) => {
    try {
      const user = await db.users.findOneAsync({ _id: req.params.id });
      if (!user) return res.status(404).json({ error: 'Utente non trovato' });
      const users = await db.users.findAsync({ _id: { $in: user.following || [] } });
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
    const allowed = ['username','bio','city','level','avatar','nativeLang','goal','theme','themeColor'];
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
    const hash = await bcrypt.hash(newPassword, 12);
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

  // ── FOLLOW ──
  app.post('/api/users/:id/follow', requireAuth, async (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.user._id) return res.status(400).json({ error: 'Non puoi seguire te stesso' });
    const me = await db.users.findOneAsync({ _id: req.user._id });
    const target = await db.users.findOneAsync({ _id: targetId });
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    const already = (me.following || []).includes(targetId);
    await db.users.updateAsync({ _id: me._id }, { $set: { following: already ? (me.following||[]).filter(id=>id!==targetId) : [...(me.following||[]), targetId] } });
    await db.users.updateAsync({ _id: targetId }, { $set: { followers: already ? (target.followers||[]).filter(id=>id!==me._id) : [...(target.followers||[]), me._id] } });
    if (already) {
      const myNotify = me.notifyUsers || [];
      if (myNotify.includes(targetId)) await db.users.updateAsync({ _id: me._id }, { $set: { notifyUsers: myNotify.filter(id=>id!==targetId) } });
    }
    res.json({ following: !already });
  });

  // ── CAMPANELLINA ──
  app.post('/api/users/:id/notify-toggle', requireAuth, async (req, res) => {
    try {
      const targetId = req.params.id;
      if (targetId === req.user._id) return res.status(400).json({ error: 'Non puoi attivare notifiche per te stesso' });
      const me = await db.users.findOneAsync({ _id: req.user._id });
      if (!(me.following || []).includes(targetId)) return res.status(400).json({ error: 'Devi seguire questo utente' });
      const notifyUsers = me.notifyUsers || [];
      const active = notifyUsers.includes(targetId);
      await db.users.updateAsync({ _id: me._id }, { $set: { notifyUsers: active ? notifyUsers.filter(id => id !== targetId) : [...notifyUsers, targetId] } });
      res.json({ notify: !active });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/users/:id/notify-status', requireAuth, async (req, res) => {
    const me = await db.users.findOneAsync({ _id: req.user._id });
    res.json({ notify: (me.notifyUsers || []).includes(req.params.id) });
  });

  // ── DM NOTIFICHE TOGGLE ──
  app.post('/api/users/:id/dm-notify-toggle', requireAuth, async (req, res) => {
    try {
      const me = await db.users.findOneAsync({ _id: req.user._id });
      const off = me.dmNotifyOff || [];
      const isMuted = off.includes(req.params.id);
      await db.users.updateAsync({ _id: me._id }, { $set: { dmNotifyOff: isMuted ? off.filter(id => id !== req.params.id) : [...off, req.params.id] } });
      res.json({ muted: !isMuted });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/users/:id/dm-notify-status', requireAuth, async (req, res) => {
    const me = await db.users.findOneAsync({ _id: req.user._id });
    res.json({ muted: (me.dmNotifyOff || []).includes(req.params.id) });
  });

  // ── FOTO PROFILO ──
  app.post('/api/users/me/avatar', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
      const ext = require('path').extname(req.file.filename).toLowerCase();
      if (!/\.(jpg|jpeg|png|gif|webp)$/.test(ext)) {
        try { require('fs').unlinkSync(require('path').join(require('../lib/upload').UPLOADS_DIR, req.file.filename)); } catch {}
        return res.status(400).json({ error: 'Solo immagini consentite' });
      }
      const oldUser = await db.users.findOneAsync({ _id: req.user._id });
      if (oldUser?.avatarUrl?.startsWith('/uploads/')) {
        try { require('fs').unlinkSync(require('path').join(__dirname, '..', oldUser.avatarUrl)); } catch {}
      }
      const avatarUrl = '/uploads/' + req.file.filename;
      await db.users.updateAsync({ _id: req.user._id }, { $set: { avatarUrl, avatar: '' } });
      const updated = await db.users.findOneAsync({ _id: req.user._id });
      const { passwordHash, ...safe } = updated;
      res.json(safe);
    } catch (e) { res.status(500).json({ error: 'Errore durante il caricamento' }); }
  });

  // ── VERIFICA UTENTE (solo Giada) ──
  app.post('/api/users/:id/verify', requireAuth, async (req, res) => {
    const isGiada = req.user.username?.toLowerCase() === 'giada' || req.user.role === 'superadmin';
    if (!isGiada) return res.status(403).json({ error: 'Solo Giada puo verificare gli utenti' });
    const user = await db.users.findOneAsync({ _id: req.params.id });
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    const newVerified = !user.verified;
    await db.users.updateAsync({ _id: req.params.id }, { $set: { verified: newVerified } });
    res.json({ verified: newVerified, username: user.username });
  });
};
