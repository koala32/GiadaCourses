// routes/learning.js — Esercizi + Giochi + Tips + Changelog + Admin
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { sseEmit, sseBroadcast } = require('../lib/sse');
const { requireAuth, requireRole } = require('../middleware');

// ── Tips randomici (mai ripetitivi per sessione) ──
const ENGLISH_TIPS = [
  { cat: 'Grammar', tip: 'Use "fewer" for countable nouns and "less" for uncountable. Fewer apples, less water.', level: 'A2' },
  { cat: 'Grammar', tip: 'Present Perfect: use "have/has + past participle" for experiences. "I have visited Rome."', level: 'A2' },
  { cat: 'Grammar', tip: '"Since" refers to a point in time, "for" to a duration. "Since 2020" vs "for 3 years."', level: 'B1' },
  { cat: 'Grammar', tip: 'Third conditional: If + past perfect, would + have + past participle.', level: 'B2' },
  { cat: 'Vocabulary', tip: 'Instead of "very tired", try "exhausted". Instead of "very happy", try "thrilled".', level: 'B1' },
  { cat: 'Vocabulary', tip: 'False friend: "actually" means "in realta", NOT "attualmente" (which is "currently").', level: 'A2' },
  { cat: 'Vocabulary', tip: '"Eventually" means "alla fine", NOT "eventualmente" (which is "possibly").', level: 'B1' },
  { cat: 'Vocabulary', tip: 'Collocations: we "make" a decision but "do" homework. We "take" a photo but "make" a mistake.', level: 'B1' },
  { cat: 'Vocabulary', tip: '"Break a leg!" means "In bocca al lupo!" - used to wish good luck before a performance.', level: 'A2' },
  { cat: 'Pronunciation', tip: 'The "th" sound: put your tongue between your teeth. "Think" and "this" have different th sounds.', level: 'A1' },
  { cat: 'Pronunciation', tip: '"Comfortable" is pronounced COM-fter-bul (3 syllables, not 4).', level: 'B1' },
  { cat: 'Pronunciation', tip: 'Silent letters: "knife" (k silent), "psychology" (p silent), "Wednesday" (d silent).', level: 'A2' },
  { cat: 'Pronunciation', tip: 'Word stress changes meaning: "REcord" (noun) vs "reCORD" (verb).', level: 'B1' },
  { cat: 'Culture', tip: 'In English-speaking cultures, small talk about weather is a polite way to start conversations.', level: 'A1' },
  { cat: 'Culture', tip: 'British vs American: "flat" vs "apartment", "lift" vs "elevator", "boot" vs "trunk".', level: 'A2' },
  { cat: 'Study Tips', tip: 'Watch English shows with English subtitles. Your brain learns spelling AND pronunciation together.', level: 'A1' },
  { cat: 'Study Tips', tip: 'Change your phone language to English. You will learn tech vocabulary naturally every day.', level: 'A1' },
  { cat: 'Study Tips', tip: 'Read song lyrics while listening. Music helps memorize phrases and pronunciation patterns.', level: 'A1' },
  { cat: 'Study Tips', tip: 'The "shadowing" technique: listen to a native speaker and repeat immediately, mimicking rhythm.', level: 'B1' },
  { cat: 'Common Mistakes', tip: '"I am agree" is WRONG. Say "I agree". No "am/is/are" needed with agree.', level: 'A1' },
  { cat: 'Common Mistakes', tip: '"It depends ON" (not "from"). "It depends on the weather."', level: 'A2' },
  { cat: 'Common Mistakes', tip: 'Don\'t say "I have 20 years". Say "I am 20 years old". English uses "to be" for age.', level: 'A1' },
  { cat: 'Common Mistakes', tip: '"Fun" vs "Funny": "The party was fun" vs "The joke was funny" (makes you laugh).', level: 'A2' },
  { cat: 'Idioms', tip: '"It\'s raining cats and dogs" = sta piovendo a dirotto.', level: 'B1' },
  { cat: 'Idioms', tip: '"Piece of cake" = facilissimo. "The exam was a piece of cake!"', level: 'A2' },
  { cat: 'Idioms', tip: '"Once in a blue moon" = molto raramente.', level: 'B1' },
  { cat: 'Idioms', tip: '"The ball is in your court" = tocca a te decidere.', level: 'B2' },
  { cat: 'Idioms', tip: '"To kill two birds with one stone" = prendere due piccioni con una fava.', level: 'B1' },
];
const _tipsSeen = new Map();

// ── Giochi word bank ──
const WORD_SCRAMBLE = {
  A1: [{w:'APPLE',h:'A red fruit',it:'Mela'},{w:'HOUSE',h:'Where you live',it:'Casa'},{w:'WATER',h:'You drink it',it:'Acqua'},{w:'HAPPY',h:'Feeling good',it:'Felice'},{w:'GREEN',h:'Color of grass',it:'Verde'},{w:'BREAD',h:'Breakfast food',it:'Pane'},{w:'SCHOOL',h:'Where you study',it:'Scuola'},{w:'FRIEND',h:'A person you like',it:'Amico'},{w:'MUSIC',h:'You listen to it',it:'Musica'},{w:'CHAIR',h:'You sit on it',it:'Sedia'}],
  A2: [{w:'KITCHEN',h:'Room where you cook',it:'Cucina'},{w:'WEATHER',h:'Rain, sun, snow',it:'Tempo'},{w:'JOURNEY',h:'A long trip',it:'Viaggio'},{w:'LIBRARY',h:'Place with books',it:'Biblioteca'},{w:'MORNING',h:'Before afternoon',it:'Mattina'},{w:'CHICKEN',h:'A farm bird',it:'Pollo'},{w:'HOLIDAY',h:'Vacation time',it:'Vacanza'},{w:'COUNTRY',h:'Italy is one',it:'Paese'},{w:'BEDROOM',h:'Where you sleep',it:'Camera'},{w:'HUSBAND',h:'Married man',it:'Marito'}],
  B1: [{w:'KNOWLEDGE',h:'What you gain learning',it:'Conoscenza'},{w:'CHALLENGE',h:'Something difficult',it:'Sfida'},{w:'BEAUTIFUL',h:'Very pretty',it:'Bellissimo'},{w:'DANGEROUS',h:'Not safe',it:'Pericoloso'},{w:'EDUCATION',h:'School and learning',it:'Istruzione'},{w:'EXPENSIVE',h:'Costs a lot',it:'Costoso'},{w:'SURPRISED',h:'Feeling of shock',it:'Sorpreso'},{w:'EXCELLENT',h:'Very very good',it:'Eccellente'},{w:'DIFFERENT',h:'Not the same',it:'Diverso'},{w:'POLLUTION',h:'Makes air dirty',it:'Inquinamento'}],
  B2: [{w:'ACHIEVEMENT',h:'Something accomplished',it:'Risultato'},{w:'ENVIRONMENT',h:'Nature around us',it:'Ambiente'},{w:'OPPORTUNITY',h:'A chance',it:'Opportunita'},{w:'RESPONSIBLE',h:'In charge of',it:'Responsabile'},{w:'COMFORTABLE',h:'Feeling at ease',it:'Comodo'},{w:'INDEPENDENT',h:'Not needing help',it:'Indipendente'},{w:'COMMUNICATE',h:'Share information',it:'Comunicare'},{w:'TEMPERATURE',h:'How hot or cold',it:'Temperatura'}],
};

const SPEED_MATCH = {
  A1: [{en:'Dog',it:'Cane'},{en:'Cat',it:'Gatto'},{en:'House',it:'Casa'},{en:'Book',it:'Libro'},{en:'Car',it:'Macchina'},{en:'Sun',it:'Sole'},{en:'Moon',it:'Luna'},{en:'Tree',it:'Albero'},{en:'Food',it:'Cibo'},{en:'Hand',it:'Mano'},{en:'Eye',it:'Occhio'},{en:'Door',it:'Porta'}],
  A2: [{en:'Knowledge',it:'Conoscenza'},{en:'Freedom',it:'Liberta'},{en:'Dream',it:'Sogno'},{en:'Strength',it:'Forza'},{en:'Journey',it:'Viaggio'},{en:'Island',it:'Isola'},{en:'Bridge',it:'Ponte'},{en:'Cloud',it:'Nuvola'},{en:'Forest',it:'Foresta'},{en:'Storm',it:'Tempesta'},{en:'River',it:'Fiume'},{en:'Mountain',it:'Montagna'}],
  B1: [{en:'Achievement',it:'Traguardo'},{en:'Behaviour',it:'Comportamento'},{en:'Challenge',it:'Sfida'},{en:'Development',it:'Sviluppo'},{en:'Environment',it:'Ambiente'},{en:'Government',it:'Governo'},{en:'Improvement',it:'Miglioramento'},{en:'Opportunity',it:'Opportunita'},{en:'Society',it:'Societa'},{en:'Research',it:'Ricerca'},{en:'Experience',it:'Esperienza'},{en:'Relationship',it:'Relazione'}],
};

const FILL_GAP = {
  A1: [{s:'I ___ a student.',a:'am',o:['am','is','are','be']},{s:'She ___ to school every day.',a:'goes',o:['go','goes','going','gone']},{s:'They ___ playing football.',a:'are',o:['is','am','are','be']},{s:'He ___ a big house.',a:'has',o:['have','has','having','had']},{s:'We ___ from Italy.',a:'are',o:['is','am','are','be']}],
  A2: [{s:'I have ___ been to London.',a:'never',o:['never','ever','already','yet']},{s:'She is ___ than her sister.',a:'taller',o:['tall','taller','tallest','more tall']},{s:'If it rains, I ___ stay home.',a:'will',o:['will','would','am','can']},{s:'He asked me ___ I was from.',a:'where',o:['what','where','when','who']},{s:'We ___ dinner when the phone rang.',a:'were having',o:['had','were having','have','having']}],
  B1: [{s:'I wish I ___ more free time.',a:'had',o:['have','had','would have','having']},{s:'She suggested ___ to the cinema.',a:'going',o:['to go','going','go','went']},{s:'Not only ___ he smart, but also kind.',a:'is',o:['is','was','does','has']},{s:'I\'m not used ___ up early.',a:'to getting',o:['to get','to getting','getting','get']},{s:'The report ___ by the time I arrived.',a:'had been finished',o:['was finished','had been finished','has finished','finished']}],
};

// Listening Quiz data
const LISTENING_QUIZ = {
  A1: [
    { text: 'Hello, my name is Sarah. I am from London. I like cats and pizza.', questions: [
      { q: 'What is her name?', o: ['Maria', 'Sarah', 'Lisa', 'Anna'], a: 1 },
      { q: 'Where is she from?', o: ['Paris', 'Rome', 'London', 'Berlin'], a: 2 },
      { q: 'What does she like?', o: ['Dogs and pasta', 'Cats and pizza', 'Birds and cake', 'Fish and rice'], a: 1 },
    ]},
    { text: 'Today is Monday. The weather is sunny. I want to go to the park with my friend Tom.', questions: [
      { q: 'What day is it?', o: ['Sunday', 'Monday', 'Friday', 'Tuesday'], a: 1 },
      { q: 'How is the weather?', o: ['Rainy', 'Cloudy', 'Sunny', 'Snowy'], a: 2 },
      { q: 'Who does the speaker want to meet?', o: ['Sara', 'Tom', 'John', 'Nobody'], a: 1 },
    ]},
  ],
  A2: [
    { text: 'Last weekend I visited my grandmother. She lives in a small village near the mountains. We cooked together and she taught me how to make pasta from scratch. It was a wonderful day.', questions: [
      { q: 'Who did the speaker visit?', o: ['A friend', 'A teacher', 'A grandmother', 'A cousin'], a: 2 },
      { q: 'Where does she live?', o: ['In a city', 'Near the sea', 'Near the mountains', 'Abroad'], a: 2 },
      { q: 'What did they do together?', o: ['Studied', 'Cooked', 'Played', 'Watched TV'], a: 1 },
    ]},
  ],
};

// Games state (reuse activeChallenges from social.js - passed via server.js)
let _gameState = new Map();

module.exports = function(app, sharedState) {
  _gameState = sharedState?.activeChallenges || new Map();

  // ============================================================
  //  ESERCIZI
  // ============================================================
  app.get('/api/exercises', async (req, res) => { res.json((await db.exercises.findAsync({})).sort((a,b)=>a.createdAt-b.createdAt)); });

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
    await db.exercises.removeAsync({ _id:req.params.id }, {}); res.json({ ok:true });
  });

  app.post('/api/exercises/:id/complete', requireAuth, async (req, res) => {
    try {
      const score = parseInt(req.body.score) || 0;
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
      if (lastDay !== today) { streak = (lastDay === new Date(Date.now()-86400000).toDateString()) ? streak + 1 : 1; }
      const newXp = (user.xp||0) + xpDelta;
      const LVL = ['A1','A2','B1','B2','C1','C2'];
      const XPT = [0, 200, 500, 1000, 2000, 4000];
      let newLevel = user.level || 'A1';
      for (let i = LVL.length - 1; i >= 0; i--) { if (newXp >= XPT[i]) { newLevel = LVL[i]; break; } }
      const badges=[...(user.badges||[])], count=Object.keys(progress).length;
      if(score===100&&!badges.includes('perfect'))badges.push('perfect');
      if(count>=3&&!badges.includes('starter'))badges.push('starter');
      if(count>=10&&!badges.includes('dedicated'))badges.push('dedicated');
      if(streak>=7&&!badges.includes('streak7'))badges.push('streak7');
      if(newXp>=1000&&!badges.includes('xp1000'))badges.push('xp1000');
      const leveledUp = newLevel !== (user.level||'A1') ? newLevel : null;
      await db.users.updateAsync({ _id:user._id }, { $set:{progress, xp:newXp, level:newLevel, badges, streak, lastActiveDate:today, lastSeen:Date.now()} });
      if (req.body.shareToFeed) {
        const post = await db.posts.insertAsync({ userId:user._id, text:req.body.shareText||`Ho completato "${ex.title}"!`, exerciseId:ex._id, score, timestamp:Date.now(), visibility:'public', likes:[] });
        sseBroadcast('new_post', {...post, author:{_id:user._id,username:user.username,avatar:user.avatar,role:user.role,verified:user.verified}});
      }
      const updated = await db.users.findOneAsync({ _id:user._id });
      const { passwordHash, ...safe } = updated;
      res.json({ user:safe, xpEarned:xpDelta, leveledUp });
    } catch (e) { res.status(500).json({ error:e.message }); }
  });

  // ============================================================
  //  GIOCHI
  // ============================================================
  app.get('/api/games/word-scramble', (req, res) => {
    const level = req.query.level || 'A1';
    const pool = WORD_SCRAMBLE[level] || WORD_SCRAMBLE['A1'];
    const selected = [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
    const words = selected.map(w => {
      let scrambled; do { scrambled = w.w.split('').sort(() => Math.random() - 0.5).join(''); } while (scrambled === w.w && w.w.length > 2);
      return { scrambled, hint: w.h, it: w.it, length: w.w.length };
    });
    const gameId = crypto.randomBytes(6).toString('hex');
    _gameState.set('ws_' + gameId, { answers: selected.map(w => w.w), createdAt: Date.now() });
    setTimeout(() => _gameState.delete('ws_' + gameId), 600000);
    res.json({ gameId, words, level });
  });

  app.post('/api/games/word-scramble/check', requireAuth, async (req, res) => {
    const game = _gameState.get('ws_' + req.body.gameId);
    if (!game) return res.status(404).json({ error: 'Partita scaduta' });
    let score = 0;
    const results = req.body.answers.map((a, i) => {
      const correct = (a || '').toUpperCase().trim() === game.answers[i];
      if (correct) score++;
      return { correct, answer: game.answers[i] };
    });
    const xpEarned = score * 10;
    if (xpEarned > 0) await db.users.updateAsync({ _id: req.user._id }, { $inc: { xp: xpEarned } });
    _gameState.delete('ws_' + req.body.gameId);
    res.json({ score, total: game.answers.length, results, xpEarned });
  });

  app.get('/api/games/speed-match', (req, res) => {
    const pool = SPEED_MATCH[req.query.level] || SPEED_MATCH['A1'];
    res.json({ pairs: [...pool].sort(() => Math.random() - 0.5).slice(0, 8), level: req.query.level || 'A1' });
  });

  app.get('/api/games/fill-gap', (req, res) => {
    const pool = FILL_GAP[req.query.level] || FILL_GAP['A1'];
    const selected = [...pool].sort(() => Math.random() - 0.5).slice(0, 5);
    const gameId = crypto.randomBytes(6).toString('hex');
    _gameState.set('fg_' + gameId, { answers: selected.map(q => q.a), createdAt: Date.now() });
    setTimeout(() => _gameState.delete('fg_' + gameId), 600000);
    res.json({ gameId, questions: selected.map(q => ({ sentence: q.s, options: [...q.o].sort(() => Math.random() - 0.5) })), level: req.query.level || 'A1' });
  });

  app.post('/api/games/fill-gap/check', requireAuth, async (req, res) => {
    const game = _gameState.get('fg_' + req.body.gameId);
    if (!game) return res.status(404).json({ error: 'Partita scaduta' });
    let score = 0;
    const results = req.body.answers.map((a, i) => {
      const correct = (a || '').toLowerCase().trim() === game.answers[i].toLowerCase();
      if (correct) score++;
      return { correct, answer: game.answers[i] };
    });
    const xpEarned = score * 15;
    if (xpEarned > 0) await db.users.updateAsync({ _id: req.user._id }, { $inc: { xp: xpEarned } });
    _gameState.delete('fg_' + req.body.gameId);
    res.json({ score, total: game.answers.length, results, xpEarned });
  });

  // ── Listening Quiz ──
  app.get('/api/games/listening-quiz', (req, res) => {
    const pool = LISTENING_QUIZ[req.query.level] || LISTENING_QUIZ['A1'];
    const selected = pool[Math.floor(Math.random() * pool.length)];
    const gameId = crypto.randomBytes(6).toString('hex');
    _gameState.set('lq_' + gameId, { answers: selected.questions.map(q => q.a), createdAt: Date.now() });
    setTimeout(() => _gameState.delete('lq_' + gameId), 600000);
    res.json({
      gameId, level: req.query.level || 'A1',
      text: selected.text,
      questions: selected.questions.map(q => ({ question: q.q, options: q.o })),
    });
  });

  app.post('/api/games/listening-quiz/check', requireAuth, async (req, res) => {
    const game = _gameState.get('lq_' + req.body.gameId);
    if (!game) return res.status(404).json({ error: 'Partita scaduta' });
    let score = 0;
    const results = req.body.answers.map((a, i) => {
      const correct = parseInt(a) === game.answers[i];
      if (correct) score++;
      return { correct, correctIndex: game.answers[i] };
    });
    const xpEarned = score * 20;
    if (xpEarned > 0) await db.users.updateAsync({ _id: req.user._id }, { $inc: { xp: xpEarned } });
    _gameState.delete('lq_' + req.body.gameId);
    res.json({ score, total: game.answers.length, results, xpEarned });
  });

  // ============================================================
  //  TIPS + CHANGELOG + SUGGERIMENTI GIADA
  // ============================================================
  app.get('/api/tips/random', (req, res) => {
    const uid = req.user?._id || req.ip || 'anon';
    let pool = [...ENGLISH_TIPS];
    if (!_tipsSeen.has(uid)) _tipsSeen.set(uid, new Set());
    const seen = _tipsSeen.get(uid);
    let unseen = pool.filter((_, i) => !seen.has(i));
    if (unseen.length === 0) { seen.clear(); unseen = pool; }
    const idx = pool.indexOf(unseen[Math.floor(Math.random() * unseen.length)]);
    seen.add(idx);
    if (_tipsSeen.size > 500) { [..._tipsSeen.entries()].slice(0, 250).forEach(([k]) => _tipsSeen.delete(k)); }
    res.json(pool[idx]);
  });

  app.get('/api/changelog', (req, res) => {
    res.json([
      { version: '10.9', date: '2026-04-06', title: 'App Android e Sicurezza', changes: ['App Android nativa APK disponibile','Chiamate e sfide esclusive per app Android','Rilevamento offline automatico','Foto storie ridimensionamento migliorato','Protezione avanzata contro bot'] },
      { version: '10.8', date: '2026-04-06', title: 'Sicurezza e Dirette', changes: ['Protezione avanzata contro bot e scanner','Dirette LIVE migliorate per host e spettatori','Layout corretto su tutte le pagine','Chiamate e sfide in tempo reale potenziate','Storie con foto ridimensionabili'] },
      { version: '10.7', date: '2026-04-01', title: 'Stabilita e Correzioni', changes: ['Dirette LIVE: annullamento corretto','Storie: una sola canzone alla volta','Guida installazione migliorata per iPhone e Android','Navigazione piu fluida e stabile'] },
      { version: '10.6', date: '2026-03-31', title: 'Nuove Funzionalita', changes: ['Storie in evidenza sul profilo','Menzioni @utente nei commenti','Connessione in tempo reale migliorata','Riconnessione automatica quando torni nell\'app'] },
      { version: '10.4', date: '2026-03-27', title: 'Nuova Esperienza Social', changes: ['Feed diviso in Thread, Reels ed Esercizi','Reels con foto e video multipli','Recensioni esercizi con stelle e commenti','Storie completamente ridisegnate'] },
    ]);
  });

  app.get('/api/giada/suggestions', requireAuth, async (req, res) => {
    const isGiada = req.user.username?.toLowerCase() === 'giada' || req.user.role === 'admin' || req.user.role === 'superadmin';
    if (!isGiada) return res.status(403).json({ error: 'Solo Giada e admin' });
    try {
      const allEx = await db.exercises.findAsync({});
      const users = await db.users.findAsync({ banned: false, role: 'user' });
      const userLevels = {};
      users.forEach(u => { userLevels[u.level] = (userLevels[u.level] || 0) + 1; });
      const CATEGORIES = ['Grammatica','Vocabolario','Ascolto','Lettura','Scrittura','Pronuncia','Conversazione','Idiomi','Business English','Phrasal Verbs'];
      const TYPES = [{type:'quiz',name:'Quiz risposta multipla'},{type:'fill',name:'Riempi gli spazi'},{type:'match',name:'Abbina'},{type:'order',name:'Riordina la frase'},{type:'listen',name:'Ascolto'},{type:'translate',name:'Traduci'}];
      const suggestions = [];
      const popular = Object.entries(userLevels).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
      for (const lv of popular) for (const cat of CATEGORIES) {
        if (!allEx.some(e => e.level === lv && e.category === cat)) suggestions.push({ priority: 'alta', level: lv, category: cat, reason: `${userLevels[lv]} utenti ${lv}, nessun "${cat}"` });
      }
      const existingTypes = new Set(allEx.map(e => e.type));
      for (const t of TYPES) { if (!existingTypes.has(t.type)) suggestions.push({ priority: 'media', typeName: t.name, reason: `Tipo non presente` }); }
      res.json({ suggestions: suggestions.slice(0, 15), stats: { totalExercises: allEx.length, totalUsers: users.length, usersByLevel: userLevels, exerciseTypes: TYPES } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  //  ADMIN + SUPERADMIN
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
    if (!['user','admin'].includes(req.body.role)) return res.status(400).json({ error:'Ruolo non valido' });
    await db.users.updateAsync({ _id:req.params.id }, { $set:{role:req.body.role} });
    res.json({ ok:true });
  });
  app.put('/api/admin/users/:id/edit', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
      const { username, email } = req.body;
      const updates = {};
      if (username && username.trim()) updates.username = username.trim();
      if (email && email.trim()) updates.email = email.trim().toLowerCase();
      if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nessuna modifica' });
      await db.users.updateAsync({ _id: req.params.id }, { $set: updates });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/users/:id/reset-password', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
      const user = await db.users.findOneAsync({ _id: req.params.id });
      if (!user) return res.status(404).json({ error: 'Non trovato' });
      if (user.role === 'superadmin') return res.status(403).json({ error: 'Non puoi reimpostare superadmin' });
      const tempPwd = 'cambia26';
      const hash = await bcrypt.hash(tempPwd, 12);
      await db.users.updateAsync({ _id: req.params.id }, { $set: { passwordHash: hash, mustChangePassword: true } });
      await db.sessions.removeAsync({ userId: req.params.id }, { multi: true });
      res.json({ ok: true, username: user.username, tempPassword: tempPwd });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Endpoint per cambio password obbligatorio ──
  app.post('/api/auth/force-change-password', requireAuth, async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password minimo 6 caratteri' });
      const hash = await bcrypt.hash(newPassword, 12);
      await db.users.updateAsync({ _id: req.user._id }, { $set: { passwordHash: hash, mustChangePassword: false } });
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/admin/stats', requireAuth, requireRole('superadmin'), async (req, res) => {
    const since24h = Date.now()-86400000;
    // recentLogs: ultime azioni loggati (IP log)
    const recentLogs = (await db.logs.findAsync({ type: { $ne: 'client_log' } }))
      .sort((a,b) => b.timestamp - a.timestamp).slice(0, 50);
    // activeSessions nelle ultime 24h
    const activeSessions = await db.sessions.countAsync({ createdAt: { $gt: since24h } });
    res.json({
      totalUsers: await db.users.countAsync({ role:'user' }), totalAdmins: await db.users.countAsync({ role:'admin' }),
      totalPosts: await db.posts.countAsync({}), totalExer: await db.exercises.countAsync({}),
      totalComments: await db.comments.countAsync({}), totalMessages: await db.messages.countAsync({}),
      totalStories: await db.stories.countAsync({}), totalGroups: await db.groups.countAsync({}),
      recentUsers: await db.users.countAsync({ joinDate:{$gt:since24h} }), recentPosts: await db.posts.countAsync({ timestamp:{$gt:since24h} }),
      recentLogs, activeSessions,
    });
  });
  app.get('/api/admin/messages', requireAuth, requireRole('superadmin'), async (req, res) => {
    const msgs = await db.messages.findAsync({});
    const uids = [...new Set([...msgs.map(m=>m.fromId),...msgs.map(m=>m.toId)].filter(Boolean))];
    const users = await db.users.findAsync({ _id:{$in:uids} });
    const uMap = {}; users.forEach(u=>{uMap[u._id]={username:u.username,avatar:u.avatar};});
    res.json(msgs.sort((a,b)=>b.timestamp-a.timestamp).slice(0,200).map(m=>({...m,fromUser:uMap[m.fromId]||{username:'?'},toUser:uMap[m.toId]||{username:'?'}})));
  });
  app.get('/api/admin/stories', requireAuth, requireRole('superadmin'), async (req, res) => {
    const stories = await db.stories.findAsync({});
    const uids = [...new Set(stories.map(s=>s.userId))];
    const users = await db.users.findAsync({ _id:{$in:uids} });
    const uMap = {}; users.forEach(u=>{uMap[u._id]={username:u.username,avatar:u.avatar};});
    res.json(stories.sort((a,b)=>b.timestamp-a.timestamp).map(s=>({...s,user:uMap[s.userId]||{username:'?'}})));
  });

  // Client log
  app.post('/api/client-log', async (req, res) => {
    if (!req.body.msg) return res.status(400).json({ error: 'msg mancante' });
    await db.logs.insertAsync({ type:'client_log', level:req.body.level||'error', msg:String(req.body.msg).slice(0,1000), userId:req.user?._id||null, timestamp:Date.now() });
    res.json({ ok: true });
  });
  app.get('/api/client-logs', requireAuth, requireRole('superadmin'), async (req, res) => {
    res.json((await db.logs.findAsync({ type: 'client_log' })).sort((a, b) => b.timestamp - a.timestamp).slice(0, 200));
  });

  // ============================================================
  //  POLL / SONDAGGI
  // ============================================================
  app.get('/api/polls', async (req, res) => {
    try {
      const now = Date.now();
      const polls = await db.polls.findAsync({});
      const enriched = [];
      for (const p of polls) {
        const author = await db.users.findOneAsync({ _id: p.authorId });
        enriched.push({ ...p, author: { username: author?.username || 'Admin', avatar: author?.avatar || '', avatarUrl: author?.avatarUrl || '' } });
      }
      res.json(enriched.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/polls', requireAuth, async (req, res) => {
    try {
      const { question, options, duration, category } = req.body;
      if (!question || !options || options.length < 2) return res.status(400).json({ error: 'Serve una domanda e almeno 2 opzioni' });
      const poll = await db.polls.insertAsync({
        question: String(question).slice(0, 300),
        options: options.slice(0, 6).map(o => ({ text: String(o).slice(0, 100), votes: [] })),
        authorId: req.user._id,
        category: category || 'general',
        duration: Math.min(168, Math.max(1, parseInt(duration) || 24)),
        createdAt: Date.now(),
        totalVotes: 0
      });
      res.json(poll);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/polls/:id/vote', requireAuth, async (req, res) => {
    try {
      const poll = await db.polls.findOneAsync({ _id: req.params.id });
      if (!poll) return res.status(404).json({ error: 'Sondaggio non trovato' });
      const { optionIndex } = req.body;
      if (optionIndex === undefined || optionIndex < 0 || optionIndex >= poll.options.length) return res.status(400).json({ error: 'Opzione non valida' });
      // Check if already voted
      const already = poll.options.some(o => o.votes.includes(req.user._id));
      if (already) return res.status(400).json({ error: 'Hai gia votato' });
      // Add vote
      const opts = poll.options.map((o, i) => {
        if (i === optionIndex) return { ...o, votes: [...o.votes, req.user._id] };
        return o;
      });
      await db.polls.updateAsync({ _id: req.params.id }, { $set: { options: opts, totalVotes: (poll.totalVotes || 0) + 1 } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/polls/:id', requireAuth, async (req, res) => {
    try {
      const poll = await db.polls.findOneAsync({ _id: req.params.id });
      if (!poll) return res.status(404).json({ error: 'Non trovato' });
      if (poll.authorId !== req.user._id && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Non autorizzato' });
      await db.polls.removeAsync({ _id: req.params.id });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  //  HIGHLIGHTS (storie in evidenza)
  // ============================================================
  app.get('/api/highlights/:userId', async (req, res) => {
    try {
      const highlights = await db.highlights.findAsync({ userId: req.params.userId });
      res.json(highlights.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/highlights', requireAuth, async (req, res) => {
    try {
      const { name, storyIds, coverUrl } = req.body;
      if (!name || !storyIds || !storyIds.length) return res.status(400).json({ error: 'Nome e storie richiesti' });
      const stories = await db.stories.findAsync({ _id: { $in: storyIds }, userId: req.user._id });
      const storyData = stories.map(s => ({ _id: s._id, mediaUrl: s.mediaUrl, mediaType: s.mediaType, bgTemplate: s.bgTemplate, caption: s.caption }));
      const hl = await db.highlights.insertAsync({
        userId: req.user._id,
        name: String(name).slice(0, 50),
        coverUrl: coverUrl || storyData[0]?.mediaUrl || '',
        stories: storyData,
        createdAt: Date.now()
      });
      res.json(hl);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/highlights/:id', requireAuth, async (req, res) => {
    try {
      const hl = await db.highlights.findOneAsync({ _id: req.params.id, userId: req.user._id });
      if (!hl) return res.status(404).json({ error: 'Non trovato' });
      await db.highlights.removeAsync({ _id: req.params.id });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
