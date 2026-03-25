// routes/social.js — DM + Chiamate + Live + Sfide 1v1 + Gruppi Chat
const crypto = require('crypto');
const { db } = require('../lib/db');
const { sseEmit, sseBroadcast, sseClients, ssePending } = require('../lib/sse');
const { upload, ALLOWED_VID, ALLOWED_AUD } = require('../lib/upload');
const { requireAuth, requireRole, resolveToken } = require('../middleware');

// State server-side
const activeCalls = new Map();
const activeChallenges = new Map();
const liveStreams = new Map();
const liveViewerSSE = new Map();

module.exports = function(app) {

  // ============================================================
  //  SSE — Real-Time Events
  // ============================================================
  app.get('/api/events', async (req, res) => {
    const user = await resolveToken('Bearer ' + (req.query.t || '')).catch(() => null);
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
    const pending = ssePending.get(uid) || [];
    for (const e of pending) { try { res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`); } catch {} }
    ssePending.delete(uid);
    const ping = setInterval(() => { try { res.write(`: ping\n\n`); } catch { clearInterval(ping); } }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      const set = sseClients.get(uid);
      if (set) { set.delete(res); if (!set.size) sseClients.delete(uid); }
    });
  });

  // ============================================================
  //  MESSAGGI DIRETTI (DM)
  // ============================================================
  app.get('/api/messages', requireAuth, async (req, res) => {
    try {
      const myId = req.user._id;
      const allMsgs = await db.messages.findAsync({ $or: [{ fromId: myId }, { toId: myId }], groupId: { $exists: false } });
      const msgs = allMsgs.filter(m => !(m.deletedFor||[]).includes(myId));
      const convMap = {}, unreadMap = {};
      msgs.forEach(m => {
        const otherId = m.fromId===myId ? m.toId : m.fromId;
        if (!convMap[otherId] || m.timestamp>convMap[otherId].timestamp) convMap[otherId]=m;
        if (m.toId===myId && !m.read) unreadMap[m.fromId]=(unreadMap[m.fromId]||0)+1;
      });
      const otherIds = Object.keys(convMap);
      const others = await db.users.findAsync({ _id: { $in: otherIds } });
      const oMap = {};
      others.forEach(u => { oMap[u._id] = { _id: u._id, username: u.username, avatar: u.avatar, avatarUrl: u.avatarUrl || '' }; });
      const convs = otherIds.map(id => ({
        user: oMap[id] || { _id: id, username: '?', avatar: '' },
        lastMessage: convMap[id].text || (convMap[id].mediaType==='audio'?'Vocale':convMap[id].mediaType==='image'?'Foto':''),
        lastMediaType: convMap[id].mediaType||null,
        timestamp: convMap[id].timestamp, unread: unreadMap[id]||0,
      })).sort((a,b)=>b.timestamp-a.timestamp);
      res.json(convs);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/messages/unread/count', requireAuth, async (req, res) => {
    try { res.json({ count: await db.messages.countAsync({ toId: req.user._id, read: false, groupId: { $exists: false } }) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/messages/:userId', requireAuth, async (req, res) => {
    try {
      const myId=req.user._id, otherId=req.params.userId;
      const allMsgs = await db.messages.findAsync({ $or: [{fromId:myId,toId:otherId},{fromId:otherId,toId:myId}], groupId: { $exists: false } });
      const msgs = allMsgs.filter(m => !(m.deletedFor||[]).includes(myId));
      await db.messages.updateAsync({ fromId:otherId,toId:myId,read:false }, { $set:{read:true} }, { multi:true });
      const other = await db.users.findOneAsync({ _id: otherId });
      res.json({ messages: msgs.sort((a,b)=>a.timestamp-b.timestamp), other: other ? { _id:other._id, username:other.username, avatar:other.avatar, avatarUrl:other.avatarUrl } : null });
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
        const ext = require('path').extname(req.file.filename).toLowerCase().replace('.', '');
        const mime = (req.file.mimetype || '').toLowerCase();
        if (mime.startsWith('audio/') || ALLOWED_AUD.test(ext)) mediaType = 'audio';
        else if (ALLOWED_VID.test(ext) || mime.startsWith('video/')) mediaType = 'video';
        else mediaType = 'image';
      }
      const text = (req.body.text||'').trim();
      if (!text && !mediaUrl) return res.status(400).json({ error: 'Messaggio vuoto' });
      const msg = await db.messages.insertAsync({ fromId:req.user._id, toId, text, mediaUrl, mediaType, timestamp:Date.now(), read:false });
      // Controlla se il destinatario ha mutato le notifiche DM
      const me = await db.users.findOneAsync({ _id: req.user._id });
      const targetDmOff = target.dmNotifyOff || [];
      const shouldNotify = !targetDmOff.includes(req.user._id);
      sseEmit(toId, 'message', { _id:msg._id, fromId:req.user._id, fromUsername:req.user.username, fromAvatar:req.user.avatar, text:msg.text, mediaUrl:msg.mediaUrl, mediaType:msg.mediaType, timestamp:msg.timestamp, shouldNotify });
      res.json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/messages/:userId', requireAuth, async (req, res) => {
    await db.messages.updateAsync({ $or:[{fromId:req.user._id,toId:req.params.userId},{fromId:req.params.userId,toId:req.user._id}] }, { $addToSet:{deletedFor: req.user._id} }, { multi: true });
    res.json({ ok: true });
  });

  app.delete('/api/messages/:userId/:msgId', requireAuth, async (req, res) => {
    const msg = await db.messages.findOneAsync({ _id: req.params.msgId });
    if (!msg) return res.status(404).json({ error: 'Non trovato' });
    if (msg.fromId !== req.user._id && !['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Non autorizzato' });
    await db.messages.removeAsync({ _id: req.params.msgId }, {});
    res.json({ ok: true });
  });

  // ============================================================
  //  GRUPPI CHAT
  // ============================================================
  app.post('/api/groups', requireAuth, async (req, res) => {
    try {
      const { name, memberIds } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Nome gruppo richiesto' });
      const members = [req.user._id, ...(memberIds || [])].filter((v, i, a) => a.indexOf(v) === i);
      if (members.length < 2) return res.status(400).json({ error: 'Almeno 2 membri' });
      if (members.length > 50) return res.status(400).json({ error: 'Massimo 50 membri' });
      const group = await db.groups.insertAsync({
        name: name.trim().slice(0, 60), adminId: req.user._id, members,
        createdAt: Date.now(), avatar: '',
      });
      members.forEach(mid => { if (mid !== req.user._id) sseEmit(mid, 'group_invite', { groupId: group._id, name: group.name, from: req.user.username }); });
      res.json(group);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/groups', requireAuth, async (req, res) => {
    try {
      const groups = await db.groups.findAsync({ members: req.user._id });
      res.json(groups.sort((a,b) => b.createdAt - a.createdAt));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/groups/:id/messages', requireAuth, async (req, res) => {
    try {
      const group = await db.groups.findOneAsync({ _id: req.params.id });
      if (!group || !group.members.includes(req.user._id)) return res.status(403).json({ error: 'Non autorizzato' });
      const msgs = await db.messages.findAsync({ groupId: req.params.id });
      const uids = [...new Set(msgs.map(m => m.fromId))];
      const users = await db.users.findAsync({ _id: { $in: uids } });
      const uMap = {};
      users.forEach(u => { uMap[u._id] = { username: u.username, avatar: u.avatar, avatarUrl: u.avatarUrl }; });
      res.json({ group, messages: msgs.sort((a,b)=>a.timestamp-b.timestamp).map(m => ({ ...m, from: uMap[m.fromId] || { username: '?' } })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/groups/:id/messages', requireAuth, upload.single('file'), async (req, res) => {
    try {
      const group = await db.groups.findOneAsync({ _id: req.params.id });
      if (!group || !group.members.includes(req.user._id)) return res.status(403).json({ error: 'Non autorizzato' });
      let mediaUrl=null, mediaType=null;
      if (req.file) {
        mediaUrl = '/uploads/' + req.file.filename;
        const ext = require('path').extname(req.file.filename).toLowerCase().replace('.', '');
        const mime = (req.file.mimetype || '').toLowerCase();
        if (mime.startsWith('audio/') || ALLOWED_AUD.test(ext)) mediaType = 'audio';
        else mediaType = 'image';
      }
      const text = (req.body.text||'').trim();
      if (!text && !mediaUrl) return res.status(400).json({ error: 'Messaggio vuoto' });
      const msg = await db.messages.insertAsync({ groupId: req.params.id, fromId: req.user._id, text, mediaUrl, mediaType, timestamp: Date.now() });
      group.members.forEach(mid => {
        if (mid !== req.user._id) sseEmit(mid, 'group_message', { groupId: req.params.id, groupName: group.name, fromUsername: req.user.username, text: text.slice(0, 40), _id: msg._id, timestamp: msg.timestamp });
      });
      res.json({ ...msg, from: { username: req.user.username, avatar: req.user.avatar } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/groups/:id/add-member', requireAuth, async (req, res) => {
    const group = await db.groups.findOneAsync({ _id: req.params.id });
    if (!group || group.adminId !== req.user._id) return res.status(403).json({ error: 'Solo l\'admin del gruppo' });
    const { userId } = req.body;
    if (!userId || group.members.includes(userId)) return res.status(400).json({ error: 'Utente gia nel gruppo' });
    if (group.members.length >= 50) return res.status(400).json({ error: 'Gruppo pieno (max 50)' });
    await db.groups.updateAsync({ _id: req.params.id }, { $addToSet: { members: userId } });
    sseEmit(userId, 'group_invite', { groupId: group._id, name: group.name, from: req.user.username });
    res.json({ ok: true });
  });

  app.post('/api/groups/:id/leave', requireAuth, async (req, res) => {
    const group = await db.groups.findOneAsync({ _id: req.params.id });
    if (!group) return res.status(404).json({ error: 'Gruppo non trovato' });
    await db.groups.updateAsync({ _id: req.params.id }, { $set: { members: group.members.filter(id => id !== req.user._id) } });
    res.json({ ok: true });
  });

  // ============================================================
  //  CHIAMATE WEBRTC — con ringtone + timeout + push
  // ============================================================
  app.post('/api/calls/invite', requireAuth, async (req, res) => {
    try {
      const { toUserId, offer, videoEnabled } = req.body;
      const target = await db.users.findOneAsync({ _id: toUserId });
      if (!target) return res.status(404).json({ error: 'Utente non trovato' });
      const callId = crypto.randomBytes(8).toString('hex');
      activeCalls.set(callId, {
        callerId: req.user._id, callerName: req.user.username, callerAvatar: req.user.avatar||'', callerAvatarUrl: req.user.avatarUrl||'',
        calleeId: toUserId, calleeName: target.username, calleeAvatar: target.avatar||'', calleeAvatarUrl: target.avatarUrl||'',
        startedAt: Date.now(), videoEnabled: !!videoEnabled, monitors: new Set(), answered: false
      });
      // Invia invito con info complete per UI chiamata
      sseEmit(toUserId, 'call_invite', {
        callId, from: req.user._id, fromName: req.user.username,
        fromAvatar: req.user.avatar||'', fromAvatarUrl: req.user.avatarUrl||'',
        videoEnabled: !!videoEnabled, offer
      });
      // Notifica superadmin (solo ADRI per monitoraggio)
      const adri = await db.users.findAsync({ $or: [{ role: 'superadmin' }, { username: { $regex: /^adri$/i } }] });
      adri.forEach(a => {
        if (a._id !== req.user._id && a._id !== toUserId)
          sseEmit(a._id, 'call_available', { callId, callerName: req.user.username, calleeName: target.username, videoEnabled: !!videoEnabled });
      });
      // Auto-timeout 60s
      setTimeout(() => {
        const c = activeCalls.get(callId);
        if (c && !c.answered) {
          sseEmit(c.callerId, 'call_timeout', { callId });
          sseEmit(c.calleeId, 'call_timeout', { callId });
          activeCalls.delete(callId);
        }
      }, 60000);
      res.json({ ok: true, callId });
    } catch (e) { res.status(500).json({ error: e.message }); }
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

  // Monitoraggio chiamate (SOLO ADRI/superadmin)
  app.post('/api/calls/monitor', requireAuth, async (req, res) => {
    const isAdri = req.user.username?.toLowerCase() === 'adri';
    if (req.user.role !== 'superadmin' && !isAdri) return res.status(403).json({ error: 'Non autorizzato' });
    const { callId } = req.body;
    const call = activeCalls.get(callId);
    if (!call) return res.status(404).json({ error: 'Chiamata non trovata' });
    call.monitors.add(req.user._id);
    sseEmit(call.callerId, 'call_monitor_req', { callId, monitorId: req.user._id });
    res.json({ ok: true, callerId: call.callerId, calleeId: call.calleeId });
  });

  app.post('/api/calls/monitor-offer', requireAuth, (req, res) => {
    sseEmit(req.body.monitorId, 'call_monitor_offer', { callId: req.body.callId, offer: req.body.offer, from: req.user._id });
    res.json({ ok: true });
  });
  app.post('/api/calls/monitor-answer', requireAuth, (req, res) => {
    sseEmit(req.body.targetUserId, 'call_monitor_answer', { callId: req.body.callId, answer: req.body.answer, monitorId: req.user._id });
    res.json({ ok: true });
  });
  app.post('/api/calls/monitor-ice', requireAuth, (req, res) => {
    sseEmit(req.body.targetUserId, 'call_monitor_ice', { callId: req.body.callId, candidate: req.body.candidate, monitorId: req.user._id });
    res.json({ ok: true });
  });

  // ============================================================
  //  LIVE STREAMING
  // ============================================================
  app.post('/api/live/start', requireAuth, async (req, res) => {
    const isAdri = req.user.username?.toLowerCase() === 'adri';
    if (req.user.username.toLowerCase() !== 'giada' && req.user.role !== 'superadmin' && req.user.role !== 'admin' && !isAdri)
      return res.status(403).json({ error: 'Solo gli admin possono avviare le dirette' });
    // Chiudi stream precedenti dello stesso host
    for (const [sid, s] of liveStreams) {
      if (s.hostId === req.user._id && s.active) {
        s.active = false;
        for (const [k, r] of liveViewerSSE) { if (k.startsWith(sid+':')) { try { r.write(`data: ${JSON.stringify({type:'ended'})}\n\n`); r.end(); } catch {} } }
        sseBroadcast('live_ended', { streamId: sid });
      }
    }
    const streamId = crypto.randomBytes(8).toString('hex');
    const title = (req.body.title || '').trim() || `${req.user.username} - LIVE`;
    liveStreams.set(streamId, {
      hostId: req.user._id, hostName: req.user.username, hostAvatar: req.user.avatar||'', hostAvatarUrl: req.user.avatarUrl||'',
      title, viewers: new Set(), comments: [], startedAt: Date.now(), active: true
    });
    sseBroadcast('live_started', { streamId, hostId: req.user._id, hostName: req.user.username, hostAvatar: req.user.avatar||'', hostAvatarUrl: req.user.avatarUrl||'', title, startedAt: Date.now() });
    res.json({ ok: true, streamId });
  });

  app.get('/api/live/watch/:streamId', async (req, res) => {
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
    setTimeout(() => { if (stream.active) sseEmit(stream.hostId, 'live_viewer_joined', { streamId: req.params.streamId, viewerId: uid }); }, 1500);
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { clearInterval(hb); } }, 10000);
    req.on('close', () => {
      clearInterval(hb); liveViewerSSE.delete(key); stream.viewers.delete(uid);
      sseBroadcast('live_viewers', { streamId: req.params.streamId, count: stream.viewers.size });
    });
  });

  app.post('/api/live/signal/:streamId', requireAuth, (req, res) => {
    const stream = liveStreams.get(req.params.streamId);
    if (!stream || stream.hostId !== req.user._id) return res.status(403).json({ error: 'Non autorizzato' });
    const { viewerId, offer } = req.body;
    sseEmit(viewerId, 'live_offer', { streamId: req.params.streamId, offer });
    const vRes = liveViewerSSE.get(`${req.params.streamId}:${viewerId}`);
    if (vRes) { try { vRes.write(`data: ${JSON.stringify({ type: 'offer', offer })}\n\n`); } catch {} }
    res.json({ ok: true });
  });

  app.post('/api/live/answer/:streamId', requireAuth, (req, res) => {
    const stream = liveStreams.get(req.params.streamId);
    if (!stream) return res.status(404).end();
    sseEmit(stream.hostId, 'live_answer', { streamId: req.params.streamId, answer: req.body.answer, from: req.user._id });
    res.json({ ok: true });
  });

  app.post('/api/live/ice/:streamId', requireAuth, (req, res) => {
    const stream = liveStreams.get(req.params.streamId);
    if (!stream) return res.status(404).end();
    const targetId = (!req.body.targetUserId || req.body.targetUserId === 'host') ? stream.hostId : req.body.targetUserId;
    sseEmit(targetId, 'live_ice', { streamId: req.params.streamId, candidate: req.body.candidate, from: req.user._id });
    const vRes = liveViewerSSE.get(`${req.params.streamId}:${targetId}`);
    if (vRes) { try { vRes.write(`data: ${JSON.stringify({ type: 'ice', candidate: req.body.candidate })}\n\n`); } catch {} }
    res.json({ ok: true });
  });

  app.post('/api/live/comment/:streamId', requireAuth, (req, res) => {
    const stream = liveStreams.get(req.params.streamId);
    if (!stream || !stream.active) return res.status(404).json({ error: 'Non attivo' });
    const text = (req.body.text || '').trim().slice(0, 200);
    if (!text) return res.status(400).json({ error: 'Testo vuoto' });
    const comment = { id: crypto.randomBytes(4).toString('hex'), userId: req.user._id, username: req.user.username, avatar: req.user.avatar||'', text, ts: Date.now() };
    stream.comments.push(comment);
    if (stream.comments.length > 300) stream.comments = stream.comments.slice(-300);
    const payload = JSON.stringify({ type: 'comment', comment });
    for (const [k, r] of liveViewerSSE) { if (k.startsWith(req.params.streamId + ':')) { try { r.write(`data: ${payload}\n\n`); } catch {} } }
    sseEmit(stream.hostId, 'live_comment', { streamId: req.params.streamId, comment });
    res.json({ ok: true });
  });

  app.post('/api/live/end/:streamId', requireAuth, (req, res) => {
    const stream = liveStreams.get(req.params.streamId);
    if (!stream) return res.status(404).json({ error: 'Non trovato' });
    if (stream.hostId !== req.user._id && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Non autorizzato' });
    stream.active = false;
    const payload = JSON.stringify({ type: 'ended' });
    for (const [k, r] of liveViewerSSE) { if (k.startsWith(req.params.streamId + ':')) { try { r.write(`data: ${payload}\n\n`); r.end(); } catch {} } }
    sseBroadcast('live_ended', { streamId: req.params.streamId });
    res.json({ ok: true });
  });

  app.get('/api/live/active', (req, res) => {
    const lives = [];
    for (const [streamId, s] of liveStreams) {
      if (s.active) lives.push({ streamId, hostId: s.hostId, hostName: s.hostName, hostAvatar: s.hostAvatar, hostAvatarUrl: s.hostAvatarUrl||'', title: s.title, startedAt: s.startedAt, viewers: s.viewers.size });
    }
    res.json(lives);
  });

  // ============================================================
  //  SFIDE 1v1 — Anti-cheat + notifiche migliorate
  // ============================================================
  function safeQuestions(questions) {
    return (questions || []).map(q => ({
      question: q.question || q.q || '',
      options: q.options || q.opts || [],
      type: q.type || 'multiple',
      exerciseTitle: q.exerciseTitle || '',
    }));
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
    { question:'Completa: She ___ a student', options:['am','is','are','be'], correctIndex:1, type:'multiple' },
    { question:'Present continuous: I am ___', options:['run','ran','running','runs'], correctIndex:2, type:'multiple' },
    { question:'Traduzione di "Dog"', options:['Gatto','Cane','Uccello','Pesce'], correctIndex:1, type:'multiple' },
    { question:'Plurale di "mouse"', options:['mouses','mices','mice','mousies'], correctIndex:2, type:'multiple' },
    { question:'Traduzione di "House"', options:['Casa','Scuola','Ufficio','Negozio'], correctIndex:0, type:'multiple' },
    { question:'"Where are you from?" significa:', options:['Dove sei?','Di dove sei?','Come stai?','Chi sei?'], correctIndex:1, type:'multiple' },
  ];

  async function generateChallengeQuestions() {
    const allExercises = await db.exercises.findAsync({});
    const questions = [];
    for (const ex of allExercises.sort(() => Math.random() - .5)) {
      if (ex.questions?.length) {
        for (const q of ex.questions.sort(() => Math.random() - .5)) {
          const hasOpts = (q.options?.length) || (q.opts?.length);
          if (hasOpts) {
            questions.push({
              question: q.question || q.q || '', options: q.options || q.opts || [],
              correctIndex: q.correctIndex !== undefined ? q.correctIndex : (q.correct !== undefined ? q.correct : 0),
              type: 'multiple', exerciseTitle: ex.title
            });
            if (questions.length >= 5) break;
          }
        }
      }
      if (questions.length >= 5) break;
    }
    const shuffled = [...WORD_BANK].sort(() => Math.random() - 0.5);
    let idx = 0;
    while (questions.length < 5 && idx < shuffled.length) questions.push({ ...shuffled[idx++], exerciseTitle: 'Word Challenge' });
    return questions.slice(0, 5);
  }

  app.post('/api/challenges/invite', requireAuth, async (req, res) => {
    try {
      const { toUserId } = req.body;
      const target = await db.users.findOneAsync({ _id: toUserId });
      if (!target) return res.status(404).json({ error: 'Utente non trovato' });
      const questions = await generateChallengeQuestions();
      const cid = crypto.randomBytes(8).toString('hex');
      const challenge = {
        id: cid, challengerId: req.user._id, challengerName: req.user.username, challengerAvatar: req.user.avatar || '', challengerAvatarUrl: req.user.avatarUrl || '',
        challengeeId: toUserId, challengeeName: target.username, challengeeAvatar: target.avatar || '', challengeeAvatarUrl: target.avatarUrl || '',
        questions, status: 'pending', scores: { [req.user._id]: [], [toUserId]: [] },
        currentQ: 0, startedAt: null, finishedAt: null, createdAt: Date.now(),
      };
      activeChallenges.set(cid, challenge);
      setTimeout(() => { if (activeChallenges.get(cid)?.status === 'pending') activeChallenges.delete(cid); }, 300000);
      sseEmit(toUserId, 'challenge_invite', { challengeId: cid, from: req.user._id, fromName: req.user.username, fromAvatar: req.user.avatar || '', fromAvatarUrl: req.user.avatarUrl || '' });
      res.json({ ok: true, challengeId: cid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/challenges/:id/accept', requireAuth, (req, res) => {
    const ch = activeChallenges.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Sfida non trovata o scaduta' });
    if (ch.challengeeId !== req.user._id) return res.status(403).json({ error: 'Non sei il destinatario' });
    if (ch.status !== 'pending') return res.status(400).json({ error: 'Sfida gia avviata' });
    ch.status = 'active'; ch.startedAt = Date.now();
    sseEmit(ch.challengerId, 'challenge_started', { challengeId: ch.id, questions: safeQuestions(ch.questions) });
    res.json({ ok: true, questions: safeQuestions(ch.questions), challengeId: ch.id });
  });

  app.post('/api/challenges/:id/reject', requireAuth, (req, res) => {
    const ch = activeChallenges.get(req.params.id);
    if (ch) { sseEmit(ch.challengerId, 'challenge_rejected', { challengeId: ch.id }); activeChallenges.delete(ch.id); }
    res.json({ ok: true });
  });

  app.post('/api/challenges/:id/answer', requireAuth, async (req, res) => {
    const ch = activeChallenges.get(req.params.id);
    if (!ch || ch.status !== 'active') return res.status(404).json({ error: 'Sfida non attiva' });
    const { questionIndex, answerIndex, timeMs } = req.body;
    if (questionIndex === undefined) return res.status(400).json({ error: 'Dati mancanti' });
    if (req.user._id !== ch.challengerId && req.user._id !== ch.challengeeId) return res.status(403).json({ error: 'Non partecipante' });
    if (!ch.scores[req.user._id]) ch.scores[req.user._id] = [];
    const myScores = ch.scores[req.user._id];
    if (myScores[questionIndex] !== undefined) return res.json({ ok: true });
    if (questionIndex < 0 || questionIndex >= ch.questions.length) return res.status(400).json({ error: 'Domanda non valida' });
    const q = ch.questions[questionIndex];
    const correctIdx = parseInt(q.correctIndex ?? q.correct ?? 0) || 0;
    const correct = parseInt(answerIndex) === correctIdx;
    const clampedTime = Math.max(500, Math.min(timeMs || 15000, 15000));
    const points = correct ? Math.max(10, 100 - Math.floor(clampedTime / 100)) : 0;
    myScores[questionIndex] = { answerIndex, correct, points, timeMs: clampedTime };
    ch.scores[req.user._id] = myScores;
    const opponentId = req.user._id === ch.challengerId ? ch.challengeeId : ch.challengerId;
    sseEmit(opponentId, 'challenge_opponent_answered', { challengeId: ch.id, questionIndex, correct, opponentTotal: myScores.reduce((s, x) => s + (x?.points || 0), 0) });
    const myDone = myScores.length >= ch.questions.length;
    const oppDone = (ch.scores[opponentId] || []).length >= ch.questions.length;
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

  app.get('/api/challenges/:id', requireAuth, (req, res) => {
    const ch = activeChallenges.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Non trovata' });
    res.json({ id: ch.id, status: ch.status, questions: safeQuestions(ch.questions), scores: ch.scores, currentQ: ch.currentQ });
  });

  // ============================================================
  //  ICE SERVERS (WebRTC STUN/TURN)
  // ============================================================
  app.get('/api/ice-servers', (req, res) => {
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];
    const turnSecret = process.env.TURN_SECRET || '';
    const serverIp = process.env.SERVER_IP || '';
    if (serverIp && turnSecret) {
      const expiry = Math.floor(Date.now() / 1000) + 86400;
      const username = `${expiry}:giadacourses`;
      const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
      servers.push({ urls: `turn:${serverIp}:3478`, username, credential }, { urls: `turn:${serverIp}:3478?transport=tcp`, username, credential });
    }
    servers.push(
      { urls: 'turn:a.relay.metered.ca:80', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
      { urls: 'turn:a.relay.metered.ca:443', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
      { urls: 'turns:a.relay.metered.ca:443?transport=tcp', username: 'e13b6accfab44ae88f8b4cf1', credential: 'k4VxHyVntypMId/S' },
    );
    res.json({ iceServers: servers });
  });

  // Esporta state per Socket.IO handlers
  return { activeCalls, activeChallenges, liveStreams, liveViewerSSE, safeQuestions, generateChallengeQuestions };
};
