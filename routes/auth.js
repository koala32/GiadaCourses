// routes/auth.js — Auth + Profili + Follow + Password Reset + Push Notifications
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../lib/db');
const { sseEmit } = require('../lib/sse');
const { upload } = require('../lib/upload');
const { requireAuth, requireRole } = require('../middleware');

// Account esenti da verifica email
const EXEMPT_USERS = ['ilaria', 'giada', 'adri'];

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
      const isExempt = EXEMPT_USERS.includes(cleanUsername.toLowerCase());
      const user = await db.users.insertAsync({
        username: cleanUsername, email: cleanEmail, passwordHash: hash, role: 'user',
        avatar: '', avatarUrl: '', xp: 0, level: level || 'A1', streak: 0, badges: [],
        bio: (bio || '').slice(0, 200), city: (city || '').slice(0, 50),
        nativeLang: nativeLang || '', goal: (goal || '').slice(0, 100),
        following: [], followers: [], progress: {},
        notifyUsers: [], dmNotifyOff: [],
        verified: false, emailVerified: isExempt,
        pushSubscription: null, pushPrefs: { likes: true, comments: true, follows: true, dms: true, mentions: true },
        theme: 'light', themeColor: '',
        joinDate: Date.now(), lastSeen: Date.now(), banned: false, ip,
      });
      const token = crypto.randomBytes(32).toString('hex');
      await db.sessions.insertAsync({ token, userId: user._id, createdAt: Date.now() });
      // Send verification email (non-blocking, skip for exempt)
      if (!isExempt && app.locals.sendMail) {
        const verifyToken = crypto.randomBytes(32).toString('hex');
        await db.sessions.insertAsync({ token: verifyToken, userId: user._id, type: 'email-verify', createdAt: Date.now() });
        const link = `https://giadacourses.duckdns.org/api/auth/verify-email?t=${verifyToken}`;
        app.locals.sendMail(cleanEmail, 'Verifica il tuo account GiadaCourses', 
          `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#F5F3FF;border-radius:18px"><div style="text-align:center;margin-bottom:20px"><div style="display:inline-block;width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;font-size:1.5rem;font-weight:800;line-height:60px">GC</div></div><h2 style="text-align:center;color:#1E1B4B;font-size:1.3rem">Benvenuto su GiadaCourses!</h2><p style="color:#6B7280;text-align:center;line-height:1.6">Ciao <strong>${cleanUsername}</strong>, clicca il bottone qui sotto per verificare il tuo account.</p><div style="text-align:center;margin:24px 0"><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:.95rem">Verifica Email</a></div><p style="color:#9CA3AF;font-size:.75rem;text-align:center">Se non hai creato tu questo account, ignora questa email.</p></div>`
        ).catch(() => {});
      }
      const { passwordHash, ...safe } = user;
      res.json({ user: safe, token });
    } catch (e) { res.status(500).json({ error: 'Errore del server' }); }
  });

  // ── VERIFICA EMAIL ──
  app.get('/api/auth/verify-email', async (req, res) => {
    try {
      const { t } = req.query;
      if (!t) return res.status(400).send('Token mancante');
      const session = await db.sessions.findOneAsync({ token: t, type: 'email-verify' });
      if (!session) return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#F5F3FF"><h2 style="color:#EF4444">Link non valido o scaduto</h2><p><a href="https://giadacourses.duckdns.org" style="color:#8B5CF6">Torna a GiadaCourses</a></p></body></html>');
      await db.users.updateAsync({ _id: session.userId }, { $set: { emailVerified: true } });
      await db.sessions.removeAsync({ token: t }, {});
      res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#F5F3FF"><h2 style="color:#22C55E">Email verificata!</h2><p>Il tuo account e ora verificato.</p><p><a href="https://giadacourses.duckdns.org" style="color:#8B5CF6;font-weight:700;font-size:1.1rem">Apri GiadaCourses</a></p></body></html>');
    } catch (e) { res.status(500).send('Errore del server'); }
  });

  // ── PASSWORD DIMENTICATA ──
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email richiesta' });
      const user = await db.users.findOneAsync({ email: email.toLowerCase().trim() });
      // Always return success to prevent email enumeration
      if (!user) return res.json({ ok: true, message: 'Se l\'email esiste, riceverai un link per reimpostare la password.' });
      // Generate reset token (valid 1 hour)
      const resetToken = crypto.randomBytes(32).toString('hex');
      await db.sessions.insertAsync({ token: resetToken, userId: user._id, type: 'password-reset', createdAt: Date.now(), expiresAt: Date.now() + 3600000 });
      if (app.locals.sendMail) {
        const link = `https://giadacourses.duckdns.org/api/auth/reset-password-page?t=${resetToken}`;
        await app.locals.sendMail(user.email, 'Reimposta la tua password — GiadaCourses',
          `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#F5F3FF;border-radius:18px"><div style="text-align:center;margin-bottom:20px"><div style="display:inline-block;width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;font-size:1.5rem;font-weight:800;line-height:60px">GC</div></div><h2 style="text-align:center;color:#1E1B4B;font-size:1.3rem">Reimposta la tua password</h2><p style="color:#6B7280;text-align:center;line-height:1.6">Hai richiesto di reimpostare la password per <strong>${user.username}</strong>.</p><div style="text-align:center;margin:24px 0"><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700">Reimposta Password</a></div><p style="color:#9CA3AF;font-size:.75rem;text-align:center">Il link scade tra 1 ora. Se non hai richiesto tu il reset, ignora questa email.</p></div>`
        ).catch(() => {});
      }
      res.json({ ok: true, message: 'Se l\'email esiste, riceverai un link per reimpostare la password.' });
    } catch (e) { res.status(500).json({ error: 'Errore del server' }); }
  });

  // ── PAGINA RESET PASSWORD ──
  app.get('/api/auth/reset-password-page', async (req, res) => {
    const { t } = req.query;
    if (!t) return res.status(400).send('Token mancante');
    const session = await db.sessions.findOneAsync({ token: t, type: 'password-reset' });
    if (!session || session.expiresAt < Date.now()) return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#F5F3FF"><h2 style="color:#EF4444">Link scaduto o non valido</h2><p><a href="https://giadacourses.duckdns.org" style="color:#8B5CF6">Torna a GiadaCourses</a></p></body></html>');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset Password</title></head><body style="font-family:Inter,sans-serif;background:#F5F3FF;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;margin:0"><div style="max-width:400px;width:100%;background:#fff;border-radius:18px;padding:30px;box-shadow:0 4px 24px rgba(79,70,229,.08)"><div style="text-align:center;margin-bottom:20px"><div style="display:inline-block;width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;font-size:1.5rem;font-weight:800;line-height:60px">GC</div></div><h2 style="text-align:center;color:#1E1B4B;margin-bottom:20px">Nuova Password</h2><div id="msg" style="display:none;padding:10px;border-radius:10px;margin-bottom:14px;font-size:.85rem;font-weight:600"></div><input id="pw1" type="password" placeholder="Nuova password (min 6 caratteri)" style="width:100%;padding:12px;border:1.5px solid rgba(139,92,246,.15);border-radius:12px;margin-bottom:12px;font-size:.9rem;outline:none;box-sizing:border-box"><input id="pw2" type="password" placeholder="Conferma password" style="width:100%;padding:12px;border:1.5px solid rgba(139,92,246,.15);border-radius:12px;margin-bottom:16px;font-size:.9rem;outline:none;box-sizing:border-box"><button onclick="doReset()" style="width:100%;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;border:none;border-radius:12px;padding:14px;font-weight:700;font-size:1rem;cursor:pointer">Reimposta Password</button></div><script>async function doReset(){var p1=document.getElementById('pw1').value,p2=document.getElementById('pw2').value,msg=document.getElementById('msg');if(!p1||p1.length<6){msg.style.display='block';msg.style.background='rgba(239,68,68,.1)';msg.style.color='#EF4444';msg.textContent='Password troppo corta (minimo 6 caratteri)';return}if(p1!==p2){msg.style.display='block';msg.style.background='rgba(239,68,68,.1)';msg.style.color='#EF4444';msg.textContent='Le password non coincidono';return}try{var r=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'${t}',password:p1})});var d=await r.json();if(d.ok){msg.style.display='block';msg.style.background='rgba(34,197,94,.1)';msg.style.color='#22C55E';msg.textContent='Password reimpostata! Puoi accedere ora.';setTimeout(function(){location.href='https://giadacourses.duckdns.org'},2000)}else{msg.style.display='block';msg.style.background='rgba(239,68,68,.1)';msg.style.color='#EF4444';msg.textContent=d.error||'Errore'}}catch(e){msg.style.display='block';msg.style.background='rgba(239,68,68,.1)';msg.style.color='#EF4444';msg.textContent='Errore di connessione'}}</script></body></html>`);
  });

  // ── RESET PASSWORD (API) ──
  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ error: 'Dati mancanti' });
      if (password.length < 6) return res.status(400).json({ error: 'Password troppo corta' });
      const session = await db.sessions.findOneAsync({ token, type: 'password-reset' });
      if (!session || session.expiresAt < Date.now()) return res.status(400).json({ error: 'Link scaduto. Richiedi un nuovo reset.' });
      const hash = await bcrypt.hash(password, 12);
      await db.users.updateAsync({ _id: session.userId }, { $set: { passwordHash: hash, mustChangePassword: false } });
      await db.sessions.removeAsync({ token }, {});
      res.json({ ok: true });
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

  // ── PUSH NOTIFICATION SUBSCRIPTION ──
  app.post('/api/push/subscribe', requireAuth, async (req, res) => {
    try {
      const { subscription } = req.body;
      if (!subscription) return res.status(400).json({ error: 'Subscription mancante' });
      await db.users.updateAsync({ _id: req.user._id }, { $set: { pushSubscription: subscription } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
    try {
      await db.users.updateAsync({ _id: req.user._id }, { $set: { pushSubscription: null } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/push/preferences', requireAuth, async (req, res) => {
    try {
      const { prefs } = req.body;
      if (!prefs) return res.status(400).json({ error: 'Preferenze mancanti' });
      const allowed = ['likes', 'comments', 'follows', 'dms', 'mentions'];
      const clean = {};
      allowed.forEach(k => { clean[k] = !!prefs[k]; });
      await db.users.updateAsync({ _id: req.user._id }, { $set: { pushPrefs: clean } });
      res.json({ ok: true, prefs: clean });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/push/vapid-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC || '';
    res.json({ publicKey: key });
  });

  // ── RESEND VERIFICATION EMAIL ──
  app.post('/api/auth/resend-verification', requireAuth, async (req, res) => {
    try {
      const user = await db.users.findOneAsync({ _id: req.user._id });
      if (!user) return res.status(404).json({ error: 'Utente non trovato' });
      if (user.emailVerified) return res.json({ ok: true, message: 'Email gia verificata' });
      if (EXEMPT_USERS.includes(user.username.toLowerCase())) {
        await db.users.updateAsync({ _id: user._id }, { $set: { emailVerified: true } });
        return res.json({ ok: true });
      }
      // Remove old verify tokens
      await db.sessions.removeAsync({ userId: user._id, type: 'email-verify' }, { multi: true });
      const verifyToken = crypto.randomBytes(32).toString('hex');
      await db.sessions.insertAsync({ token: verifyToken, userId: user._id, type: 'email-verify', createdAt: Date.now() });
      if (app.locals.sendMail) {
        const link = `https://giadacourses.duckdns.org/api/auth/verify-email?t=${verifyToken}`;
        await app.locals.sendMail(user.email, 'Verifica il tuo account GiadaCourses',
          `<div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#F5F3FF;border-radius:18px"><div style="text-align:center;margin-bottom:20px"><div style="display:inline-block;width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;font-size:1.5rem;font-weight:800;line-height:60px">GC</div></div><h2 style="text-align:center;color:#1E1B4B">Verifica il tuo account</h2><p style="color:#6B7280;text-align:center;line-height:1.6">Ciao <strong>${user.username}</strong>, clicca qui sotto per verificare.</p><div style="text-align:center;margin:24px 0"><a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700">Verifica Email</a></div></div>`
        );
      }
      res.json({ ok: true, message: 'Email di verifica inviata' });
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
