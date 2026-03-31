// routes/content.js — Posts + Stories + Media Upload + Blog
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../lib/db');
const { sseEmit, sseBroadcast } = require('../lib/sse');
const { upload, UPLOADS_DIR, ALLOWED_VID, ALLOWED_AUD, MIME_MAP } = require('../lib/upload');
const { requireAuth, requireRole } = require('../middleware');

// Helper: notifica bell users
async function notifyBellUsers(authorId, event, data) {
  const subs = await db.users.findAsync({ notifyUsers: authorId });
  for (const s of subs) { if (s._id !== authorId) sseEmit(s._id, event, data); }
}

module.exports = function(app) {

  // ── UPLOAD MEDIA ──
  app.post('/api/media/upload-pdf', requireAuth, requireRole('admin','superadmin'), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nessun file' });
    res.json({ url: '/uploads/' + req.file.filename });
  });

  app.post('/api/media/upload', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const ext = path.extname(req.file.filename).toLowerCase().replace('.','');
    res.json({ url: '/uploads/' + req.file.filename, type: ALLOWED_VID.test(ext) ? 'video' : 'image' });
  });

  app.post('/api/media/upload-multi', requireAuth, upload.array('files', 5), (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'Nessun file ricevuto' });
    res.json({ files: req.files.map(f => {
      const ext = path.extname(f.filename).toLowerCase().replace('.','');
      return { url: '/uploads/' + f.filename, type: ALLOWED_VID.test(ext) ? 'video' : 'image' };
    })});
  });

  // ── Upload file serving con Range support ──
  app.get('/uploads/:fn', (req, res) => {
    const fn = path.basename(req.params.fn).replace(/\.\./g, '');
    const fp = path.join(UPLOADS_DIR, fn);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File non trovato' });
    const stat = fs.statSync(fp);
    if (stat.size === 0) return res.status(404).json({ error: 'File vuoto' });
    const ct = MIME_MAP[path.extname(fn).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const rng = req.headers.range;
    if (rng) {
      const [s, e] = rng.replace(/bytes=/, '').split('-');
      let start = Math.max(0, parseInt(s) || 0), end = e ? Math.min(stat.size - 1, parseInt(e)) : stat.size - 1;
      if (start > end || start >= stat.size) { start = 0; end = stat.size - 1; }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(fp).pipe(res);
    }
  });

  // ── STORIE (24h) ──
  function cleanExpiredStories() {
    const cutoff = Date.now() - 86400000;
    db.stories.findAsync({ timestamp: { $lt: cutoff } }).then(expired => {
      expired.forEach(s => { if (s.mediaUrl) { try { fs.unlinkSync(path.join(__dirname, '..', s.mediaUrl)); } catch {} } });
      db.stories.removeAsync({ timestamp: { $lt: cutoff } }, { multi: true });
    });
  }
  setInterval(cleanExpiredStories, 10 * 60 * 1000);

  app.get('/api/stories', async (req, res) => {
    try {
      cleanExpiredStories();
      const stories = await db.stories.findAsync({ timestamp: { $gt: Date.now() - 86400000 } });
      const uids = [...new Set(stories.map(s => s.userId))];
      const users = await db.users.findAsync({ _id: { $in: uids } });
      const uMap = {};
      users.forEach(u => { uMap[u._id] = { _id: u._id, username: u.username, avatar: u.avatar, avatarUrl: u.avatarUrl || '', role: u.role, verified: u.verified }; });
      const grouped = {};
      stories.sort((a,b) => b.timestamp - a.timestamp).forEach(s => {
        if (!grouped[s.userId]) grouped[s.userId] = { user: uMap[s.userId] || { _id: s.userId, username: '?' }, items: [] };
        grouped[s.userId].items.push(s);
      });
      res.json(Object.values(grouped));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/stories', requireAuth, upload.single('file'), async (req, res) => {
    try {
      let mediaUrl = null, mediaType = 'image';
      const bgTemplate = req.body.bgTemplate || null;
      if (req.file) {
        mediaUrl = '/uploads/' + req.file.filename;
        const ext = path.extname(req.file.filename).toLowerCase().replace('.','');
        mediaType = ALLOWED_VID.test(ext) ? 'video' : 'image';
      } else if (req.body.mediaUrl) { mediaUrl = req.body.mediaUrl; mediaType = req.body.mediaType || 'image'; }
      else if (bgTemplate) { mediaType = 'template'; }
      if (!mediaUrl && !bgTemplate) return res.status(400).json({ error: 'Nessun media o template' });

      let textOverlays = [];
      try { textOverlays = JSON.parse(req.body.textOverlays || '[]'); } catch {}

      const story = await db.stories.insertAsync({
        userId: req.user._id, mediaUrl, mediaType, bgTemplate,
        caption: (req.body.caption || '').trim().slice(0, 200),
        filter: req.body.filter || 'none',
        duration: Math.min(15, Math.max(3, parseInt(req.body.duration) || 15)),
        music: (req.body.music && req.body.music !== 'none') ? req.body.music : null,
        musicTitle: (req.body.music && req.body.music !== 'none') ? (req.body.musicTitle || '') : '',
        textOverlays, timestamp: Date.now(), views: [],
      });
      sseBroadcast('new_story', { storyId: story._id, userId: req.user._id, username: req.user.username, avatar: req.user.avatar });
      notifyBellUsers(req.user._id, 'bell_story', { userId: req.user._id, username: req.user.username, storyId: story._id }).catch(() => {});
      res.json(story);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/stories/:id/view', requireAuth, async (req, res) => {
    const story = await db.stories.findOneAsync({ _id: req.params.id });
    if (!story) return res.status(404).json({ error: 'Non trovata' });
    if (!(story.views || []).includes(req.user._id)) await db.stories.updateAsync({ _id: req.params.id }, { $set: { views: [...(story.views||[]), req.user._id] } });
    res.json({ ok: true });
  });

  app.delete('/api/stories/:id', requireAuth, async (req, res) => {
    const story = await db.stories.findOneAsync({ _id: req.params.id });
    if (!story) return res.status(404).json({ error: 'Non trovata' });
    if (story.userId !== req.user._id && !['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Non autorizzato' });
    if (story.mediaUrl) { try { fs.unlinkSync(path.join(__dirname, '..', story.mediaUrl)); } catch {} }
    await db.stories.removeAsync({ _id: req.params.id }, {});
    res.json({ ok: true });
  });

  // ── MUSICA (Deezer search) ──
  app.get('/api/music/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);
    try {
      const data = await new Promise((resolve, reject) => {
        require('https').get('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=12', r => {
          let body = ''; r.on('data', c => body += c);
          r.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject('parse error'); } });
        }).on('error', reject);
      });
      if (!data.data) return res.json([]);
      res.json(data.data.map(t => ({ id: t.id, title: t.title, artist: t.artist?.name || '', cover: t.album?.cover_small || '', preview: t.preview })));
    } catch { res.json([]); }
  });

  app.post('/api/music/download', requireAuth, async (req, res) => {
    const { url, title } = req.body;
    if (!url || !url.startsWith('https://')) return res.status(400).json({ error: 'URL non valido' });
    try {
      const fname = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.mp3';
      const fp = path.join(UPLOADS_DIR, fname);
      const file = fs.createWriteStream(fp);
      const downloadWithRedirect = (downloadUrl, maxRedirects = 5) => {
        return new Promise((resolve, reject) => {
          if (maxRedirects <= 0) return reject(new Error('Troppi redirect'));
          const mod = downloadUrl.startsWith('https') ? require('https') : require('http');
          mod.get(downloadUrl, { headers: { 'User-Agent': 'GiadaCourses/10.0' } }, r => {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return downloadWithRedirect(r.headers.location, maxRedirects - 1).then(resolve).catch(reject);
            if (r.statusCode !== 200) { try { fs.unlinkSync(fp); } catch {} return reject(new Error(`HTTP ${r.statusCode}`)); }
            r.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
            file.on('error', e => { try { fs.unlinkSync(fp); } catch {} reject(e); });
          }).on('error', e => { try { fs.unlinkSync(fp); } catch {} reject(e); });
        });
      };
      await downloadWithRedirect(url);
      if (!fs.existsSync(fp) || fs.statSync(fp).size < 1000) { try { fs.unlinkSync(fp); } catch {} return res.status(500).json({ error: 'Download fallito' }); }
      res.json({ localUrl: '/uploads/' + fname });
    } catch (e) { res.status(500).json({ error: 'Download fallito: ' + e.message }); }
  });

  // ── POSTS ──
  app.get('/api/posts', async (req, res) => {
    try {
      const { type } = req.query; // thread | reel | exercise
      let posts = (await db.posts.findAsync({})).sort((a,b) => b.timestamp - a.timestamp);
      // Filtra per tipo se richiesto
      if (type === 'thread') posts = posts.filter(p => !p.mediaUrl && !p.exerciseId);
      else if (type === 'reel') posts = posts.filter(p => p.mediaUrl && !p.exerciseId);
      else if (type === 'exercise') posts = posts.filter(p => !!p.exerciseId);
      const uids = [...new Set(posts.map(p => p.userId).filter(Boolean))];
      const users = await db.users.findAsync({ _id: { $in: uids } });
      const uMap = {};
      users.forEach(u => { uMap[u._id] = { _id: u._id, username: u.username, avatar: u.avatar || '', avatarUrl: u.avatarUrl || '', role: u.role, verified: u.verified }; });
      res.json(posts.map(p => ({ ...p, author: uMap[p.userId] || { _id: p.userId || '', username: 'Utente', role: 'user' } })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/posts', requireAuth, async (req, res) => {
    const { text, exerciseId, score, exerciseTitle, exerciseLevel, visibility, mediaUrl, mediaType, mediaUrls, postType, review, rating } = req.body;
    if (!text?.trim() && !mediaUrl && !mediaUrls?.length) return res.status(400).json({ error: 'Testo o media richiesto' });
    const post = await db.posts.insertAsync({
      userId: req.user._id, text: (text||'').trim(), exerciseId: exerciseId||null, score: score||null,
      exerciseTitle: exerciseTitle||null, exerciseLevel: exerciseLevel||null,
      timestamp: Date.now(), visibility: visibility||'public', likes: [],
      mediaUrl: mediaUrl||null, mediaType: mediaType||null, mediaUrls: mediaUrls||null,
      postType: postType || (exerciseId ? 'exercise' : mediaUrl ? 'reel' : 'thread'),
      review: review||null, rating: rating||null,
    });
    const { passwordHash, ...auth } = req.user;
    const result = { ...post, author: { _id: auth._id, username: auth.username, avatar: auth.avatar||'', avatarUrl: auth.avatarUrl||'', role: auth.role, verified: auth.verified } };
    sseBroadcast('new_post', result);
    notifyBellUsers(req.user._id, 'bell_post', { userId: req.user._id, username: req.user.username, postId: post._id, text: (post.text||'').slice(0,50) }).catch(() => {});
    res.json(result);
  });

  // ── Recensione esercizio (stelle + breve commento) ──
  app.post('/api/posts/:id/review', requireAuth, async (req, res) => {
    const { rating, review } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Valutazione 1-5 richiesta' });
    await db.posts.updateAsync({ _id: req.params.id }, { $set: { rating: parseInt(rating), review: (review||'').trim().slice(0, 200) } });
    res.json({ ok: true });
  });

  app.delete('/api/posts/:id', requireAuth, async (req, res) => {
    const post = await db.posts.findOneAsync({ _id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Post non trovato' });
    if (post.userId !== req.user._id && !['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Non autorizzato' });
    if (post.mediaUrl) { try { fs.unlinkSync(path.join(__dirname, '..', post.mediaUrl)); } catch {} }
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
    const comments = (await db.comments.findAsync({ postId: req.params.id })).sort((a,b)=>a.timestamp-b.timestamp);
    const uids = [...new Set(comments.map(c=>c.userId))];
    const users = await db.users.findAsync({ _id: { $in: uids } });
    const uMap = {};
    users.forEach(u => { uMap[u._id] = { _id: u._id, username: u.username, avatar: u.avatar }; });
    res.json(comments.map(c => ({ ...c, author: uMap[c.userId]||{ username: '?', avatar: '' } })));
  });

  app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Testo mancante' });
    const comment = await db.comments.insertAsync({ postId: req.params.id, userId: req.user._id, text: text.trim(), timestamp: Date.now() });
    const { passwordHash, ...auth } = req.user;
    // Parse @mentions and notify
    const mentions = (text.match(/@(\w+)/g) || []).map(m => m.slice(1).toLowerCase());
    if (mentions.length) {
      const users = await db.users.findAsync({});
      for (const m of mentions) {
        const target = users.find(u => u.username.toLowerCase() === m);
        if (target && target._id !== req.user._id) {
          sseEmit(target._id, 'mention', { from: auth.username, postId: req.params.id, text: text.trim().slice(0, 80) });
        }
      }
    }
    res.json({ ...comment, author: { _id: auth._id, username: auth.username, avatar: auth.avatar } });
  });

  // ── User search for @mention autocomplete ──
  app.get('/api/users/search', requireAuth, async (req, res) => {
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 1) return res.json([]);
    const users = await db.users.findAsync({ banned: false });
    const results = users.filter(u => u.username.toLowerCase().includes(q) && u._id !== req.user._id)
      .slice(0, 8).map(({ passwordHash, ip, email, ...u }) => ({ _id: u._id, username: u.username, avatar: u.avatar, avatarUrl: u.avatarUrl }));
    res.json(results);
  });

  // ── BLOG ──
  app.get('/api/blog', async (req, res) => { res.json((await db.blog.findAsync({ published: true })).sort((a,b)=>b.date-a.date)); });
  app.get('/api/blog/all', requireAuth, requireRole('admin','superadmin'), async (req, res) => { res.json((await db.blog.findAsync({})).sort((a,b)=>b.date-a.date)); });
  app.post('/api/blog', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
    const { title, content, published } = req.body;
    if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Titolo e contenuto richiesti' });
    res.json(await db.blog.insertAsync({ title: title.trim(), content: content.trim(), date: Date.now(), published: !!published, authorId: req.user._id }));
  });
  app.put('/api/blog/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
    await db.blog.updateAsync({ _id: req.params.id }, { $set: { title: req.body.title, content: req.body.content, published: req.body.published } });
    res.json(await db.blog.findOneAsync({ _id: req.params.id }));
  });
  app.delete('/api/blog/:id', requireAuth, requireRole('admin','superadmin'), async (req, res) => {
    await db.blog.removeAsync({ _id: req.params.id }, {});
    res.json({ ok: true });
  });

  // ── BUG REPORT ──
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
    res.json((await db.logs.findAsync({ type: 'bug_report' })).sort((a, b) => b.timestamp - a.timestamp));
  });
};
