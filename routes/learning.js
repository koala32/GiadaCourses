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
      { version: '11.3', date: '2026-04-08', title: 'Storie Interattive', changes: ['Riquadro "Chiedimi" nelle storie: i tuoi amici possono risponderti in DM','Trascina il riquadro dove vuoi nella storia','Nuova barra adesivi per personalizzare le storie','Testo, tag, musica, filtri e durata sempre a portata di mano','Risposte alle storie arrivano direttamente nei messaggi'] },
      { version: '11.2', date: '2026-04-08', title: 'Velocita e Sicurezza', changes: ['L\'app si carica molto piu velocemente','Le immagini si caricano solo quando le vedi','Protezione avanzata contro accessi indesiderati','Pulizia automatica dei dati vecchi per mantenere tutto veloce','Migliore protezione della tua privacy e dei tuoi dati'] },
      { version: '11.1', date: '2026-04-08', title: 'Miglioramenti Chiamate', changes: ['Le chiamate audio ora funzionano in modo stabile','Connessione piu affidabile durante le chiamate','Le sfide 1v1 sono piu reattive','Backup automatico giornaliero dei tuoi dati','Migliorata la stabilita generale dell\'app'] },
      { version: '11.0', date: '2026-04-07', title: 'Nuovo Look e Tante Novita', changes: ['Grafica completamente rinnovata e moderna','27 lezioni di inglese per tutti i livelli (A1-C2)','Missioni giornaliere sempre diverse con premi XP','Trova un compagno di studio con Language Partner','Sezione Supporto per donazioni e segnalazioni','Medaglie speciali per chi supporta il progetto','Tour di benvenuto per i nuovi utenti','Recupero password via email','Foto e video si caricano piu velocemente','Notifiche per l\'app Android'] },
      { version: '10.9', date: '2026-04-06', title: 'App Android', changes: ['App Android disponibile per il download','Chiamate e sfide esclusive per l\'app Android','L\'app rileva quando sei offline','Foto nelle storie migliorate','Maggiore protezione del tuo account'] },
      { version: '10.8', date: '2026-04-06', title: 'Sicurezza e Dirette', changes: ['Protezione avanzata del tuo account','Dirette LIVE migliorate','Pagine piu ordinate e pulite','Chiamate e sfide piu veloci','Storie con foto migliorato'] },
      { version: '10.7', date: '2026-04-01', title: 'Stabilita', changes: ['Dirette LIVE piu stabili','Una sola canzone alla volta nelle storie','Guida installazione migliorata','Navigazione piu fluida'] },
      { version: '10.6', date: '2026-03-31', title: 'Novita Social', changes: ['Storie in evidenza sul profilo','Menzioni @utente nei commenti','Connessione piu stabile','Riconnessione automatica quando torni nell\'app'] },
      { version: '10.4', date: '2026-03-27', title: 'Nuova Esperienza', changes: ['Feed diviso in Thread, Reels ed Esercizi','Reels con foto e video multipli','Recensioni esercizi con stelle e commenti','Storie completamente ridisegnate'] },
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

  // ── DAILY REWARDS + MISSIONS ──
  const DAILY_MISSIONS = [
    // Social
    { id: 'post', title: 'Scrivi un post nella community', icon: '💬', xp: 10, check: 'post' },
    { id: 'comment', title: 'Commenta un post di qualcuno', icon: '🗨️', xp: 10, check: 'comment' },
    { id: 'like3', title: 'Metti like a 3 post', icon: '❤️', xp: 10, check: 'likes', target: 3 },
    { id: 'like5', title: 'Metti like a 5 post', icon: '💕', xp: 15, check: 'likes', target: 5 },
    { id: 'follow', title: 'Segui un nuovo utente', icon: '👥', xp: 10, check: 'follow' },
    { id: 'story', title: 'Pubblica una storia', icon: '📸', xp: 15, check: 'story' },
    { id: 'reel', title: 'Pubblica un reel', icon: '🎬', xp: 20, check: 'reel' },
    // Messaggi
    { id: 'dm', title: 'Invia un messaggio a qualcuno', icon: '✉️', xp: 5, check: 'dm' },
    { id: 'dm3', title: 'Invia 3 messaggi in chat', icon: '💌', xp: 10, check: 'dm3', target: 3 },
    { id: 'voice', title: 'Invia un messaggio vocale', icon: '🎤', xp: 15, check: 'voice' },
    // Esercizi
    { id: 'exercise', title: 'Completa un esercizio', icon: '📚', xp: 15, check: 'exercise' },
    { id: 'exercise2', title: 'Completa 2 esercizi', icon: '📖', xp: 25, check: 'exercise2', target: 2 },
    { id: 'quiz80', title: 'Ottieni 80%+ in un quiz', icon: '🎯', xp: 20, check: 'quiz80' },
    { id: 'perfect', title: 'Ottieni 100% in un quiz', icon: '💯', xp: 30, check: 'perfect' },
    // Apprendimento
    { id: 'tip', title: 'Leggi un consiglio del giorno', icon: '💡', xp: 5, check: 'tip' },
    { id: 'explore', title: 'Visita la sezione Esercizi', icon: '🔍', xp: 5, check: 'explore' },
    { id: 'games', title: 'Gioca a un gioco educativo', icon: '🎮', xp: 15, check: 'games' },
    { id: 'leaderboard', title: 'Controlla la classifica', icon: '🏆', xp: 5, check: 'leaderboard' },
    // Creativita
    { id: 'photo', title: 'Condividi una foto con la community', icon: '📷', xp: 15, check: 'photo' },
    { id: 'bio', title: 'Aggiorna la tua bio del profilo', icon: '✏️', xp: 10, check: 'bio' },
    { id: 'avatar', title: 'Cambia il tuo avatar', icon: '🎨', xp: 10, check: 'avatar' },
    // Streak e costanza
    { id: 'login3', title: 'Mantieni lo streak per 3 giorni', icon: '🔥', xp: 20, check: 'streak3' },
    { id: 'login7', title: 'Mantieni lo streak per 7 giorni', icon: '🔥', xp: 35, check: 'streak7' },
    // Supporto
    { id: 'support', title: 'Visita la sezione Supporto', icon: '❤️', xp: 5, check: 'support' },
    { id: 'bug', title: 'Segnala un problema o suggerimento', icon: '🐛', xp: 15, check: 'bug' },
  ];

  function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function getYesterdayKey() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function getStreakXP(streak) {
    if (streak >= 30) return 50;
    if (streak >= 14) return 35;
    if (streak >= 7) return 25;
    if (streak >= 3) return 15;
    return 10;
  }

  app.get('/api/daily/status', requireAuth, async (req, res) => {
    try {
      const today = getTodayKey();
      const userId = req.user._id;
      let record = await db.daily.findOneAsync({ userId, date: today });
      if (!record) {
        // Avoid yesterday's missions for variety
        const yesterdayKey = getYesterdayKey();
        const yesterdayRecord = await db.daily.findOneAsync({ userId, date: yesterdayKey });
        const yesterdayIds = (yesterdayRecord?.missions || []).map(m => m.id);
        // Filter out yesterday's missions, then shuffle
        let pool = DAILY_MISSIONS.filter(m => !yesterdayIds.includes(m.id));
        if (pool.length < 3) pool = DAILY_MISSIONS.slice(); // fallback if pool too small
        const shuffled = pool.sort(() => Math.random() - 0.5);
        const todayMissions = shuffled.slice(0, 3).map(m => ({ ...m, completed: false }));
        record = await db.daily.insertAsync({ userId, date: today, loginClaimed: false, missions: todayMissions, createdAt: Date.now() });
      }
      const user = await db.users.findOneAsync({ _id: userId });
      res.json({
        date: today,
        loginClaimed: record.loginClaimed,
        loginXP: getStreakXP(user?.streak || 0),
        streak: user?.streak || 0,
        missions: record.missions,
        allCompleted: record.missions.every(m => m.completed),
        bonusXP: record.missions.every(m => m.completed) ? 25 : 0,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/daily/claim-login', requireAuth, async (req, res) => {
    try {
      const today = getTodayKey();
      const userId = req.user._id;
      let record = await db.daily.findOneAsync({ userId, date: today });
      if (!record) {
        const yk = getYesterdayKey();
        const yr = await db.daily.findOneAsync({ userId, date: yk });
        const yids = (yr?.missions || []).map(m => m.id);
        let pool = DAILY_MISSIONS.filter(m => !yids.includes(m.id));
        if (pool.length < 3) pool = DAILY_MISSIONS.slice();
        const shuffled = pool.sort(() => Math.random() - 0.5);
        const todayMissions = shuffled.slice(0, 3).map(m => ({ ...m, completed: false }));
        record = await db.daily.insertAsync({ userId, date: today, loginClaimed: false, missions: todayMissions, createdAt: Date.now() });
      }
      if (record.loginClaimed) return res.json({ ok: true, alreadyClaimed: true, xp: 0 });
      const user = await db.users.findOneAsync({ _id: userId });
      const xp = getStreakXP(user?.streak || 0);
      // Update streak
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
      const hadYesterday = await db.daily.findOneAsync({ userId, date: yesterdayKey, loginClaimed: true });
      const newStreak = hadYesterday ? (user?.streak || 0) + 1 : 1;
      await db.users.updateAsync({ _id: userId }, { $set: { xp: (user?.xp || 0) + xp, streak: newStreak, lastSeen: Date.now() } });
      await db.daily.updateAsync({ _id: record._id }, { $set: { loginClaimed: true } });
      res.json({ ok: true, xp, streak: newStreak, alreadyClaimed: false });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/daily/mission/:missionId/complete', requireAuth, async (req, res) => {
    try {
      const today = getTodayKey();
      const record = await db.daily.findOneAsync({ userId: req.user._id, date: today });
      if (!record) return res.status(404).json({ error: 'Nessuna missione per oggi' });
      const mission = record.missions.find(m => m.id === req.params.missionId);
      if (!mission) return res.status(404).json({ error: 'Missione non trovata' });
      if (mission.completed) return res.json({ ok: true, alreadyCompleted: true });
      mission.completed = true;
      await db.daily.updateAsync({ _id: record._id }, { $set: { missions: record.missions } });
      // Award XP
      const user = await db.users.findOneAsync({ _id: req.user._id });
      await db.users.updateAsync({ _id: req.user._id }, { $set: { xp: (user?.xp || 0) + mission.xp } });
      // Check if all missions completed — bonus
      const allDone = record.missions.every(m => m.completed);
      if (allDone) {
        await db.users.updateAsync({ _id: req.user._id }, { $set: { xp: (user?.xp || 0) + mission.xp + 25 } });
      }
      res.json({ ok: true, xp: mission.xp, allCompleted: allDone, bonusXP: allDone ? 25 : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── LEZIONI STRUTTURATE ──
  const LESSON_PATHS = {
    A1: [
      { id: 'a1-01', title: 'Greetings & Introductions', desc: 'Hello, goodbye, how are you', xp: 20, content: 'Learn basic greetings: Hello, Hi, Good morning, Good afternoon, Good evening, Goodbye, See you later. Practice: "Hi, my name is ___. Nice to meet you!"', quiz: [
        { q: 'How do you say "Ciao" in English?', opts: ['Hello','Goodbye','Thanks','Sorry'], correct: 0 },
        { q: '"Good morning" means:', opts: ['Buona sera','Buon pomeriggio','Buongiorno','Buona notte'], correct: 2 },
        { q: 'Complete: "Nice to ___ you!"', opts: ['see','meet','know','have'], correct: 1 },
      ]},
      { id: 'a1-02', title: 'Numbers 1-20', desc: 'Count from one to twenty', xp: 20, content: 'One, Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten, Eleven, Twelve, Thirteen, Fourteen, Fifteen, Sixteen, Seventeen, Eighteen, Nineteen, Twenty.', quiz: [
        { q: 'What number is "thirteen"?', opts: ['3','13','30','31'], correct: 1 },
        { q: '"Seven" in italiano:', opts: ['Sei','Sette','Cinque','Otto'], correct: 1 },
        { q: 'How do you say "15" in English?', opts: ['Fifty','Five','Fifteen','Fiveteen'], correct: 2 },
      ]},
      { id: 'a1-03', title: 'Colors', desc: 'Red, blue, green and more', xp: 20, content: 'Red (rosso), Blue (blu), Green (verde), Yellow (giallo), Black (nero), White (bianco), Orange (arancione), Pink (rosa), Purple (viola), Brown (marrone).', quiz: [
        { q: '"Verde" in English:', opts: ['Blue','Red','Green','Yellow'], correct: 2 },
        { q: 'What color is the sky?', opts: ['Red','Green','Blue','Black'], correct: 2 },
        { q: '"Purple" means:', opts: ['Rosa','Viola','Marrone','Arancione'], correct: 1 },
      ]},
      { id: 'a1-04', title: 'Family Members', desc: 'Mother, father, sister, brother', xp: 25, content: 'Mother/Mom, Father/Dad, Sister, Brother, Grandmother/Grandma, Grandfather/Grandpa, Uncle, Aunt, Cousin, Son, Daughter.', quiz: [
        { q: '"Fratello" in English:', opts: ['Sister','Father','Brother','Uncle'], correct: 2 },
        { q: '"Grandmother" means:', opts: ['Zia','Nonna','Madre','Cugina'], correct: 1 },
        { q: 'Your mother\'s sister is your:', opts: ['Cousin','Uncle','Aunt','Sister'], correct: 2 },
      ]},
      { id: 'a1-05', title: 'Days of the Week', desc: 'Monday through Sunday', xp: 20, content: 'Monday (lunedi), Tuesday (martedi), Wednesday (mercoledi), Thursday (giovedi), Friday (venerdi), Saturday (sabato), Sunday (domenica). "What day is it today?"', quiz: [
        { q: '"Mercoledi" in English:', opts: ['Monday','Wednesday','Thursday','Tuesday'], correct: 1 },
        { q: 'The weekend days are:', opts: ['Monday-Tuesday','Friday-Saturday','Saturday-Sunday','Thursday-Friday'], correct: 2 },
        { q: 'Which day comes after Thursday?', opts: ['Wednesday','Friday','Saturday','Tuesday'], correct: 1 },
      ]},
    ],
    A2: [
      { id: 'a2-01', title: 'Present Simple', desc: 'I work, she plays, they study', xp: 25, content: 'Use Present Simple for habits and routines. Add -s/-es for he/she/it. "I work every day. She plays tennis. They study English."', quiz: [
        { q: 'She ___ to school every day.', opts: ['go','goes','going','gone'], correct: 1 },
        { q: 'They ___ English on Monday.', opts: ['studies','study','studying','studied'], correct: 1 },
        { q: 'Complete: "He ___ coffee every morning."', opts: ['drink','drinks','drinking','drank'], correct: 1 },
      ]},
      { id: 'a2-02', title: 'Past Simple Regular', desc: 'I walked, she played, they studied', xp: 25, content: 'Add -ed for regular past tense. "I walked to school. She played tennis. They studied hard." Exceptions: study→studied, stop→stopped.', quiz: [
        { q: 'Past of "play":', opts: ['played','plaied','plaid','playing'], correct: 0 },
        { q: 'She ___ the piano yesterday.', opts: ['play','plays','played','playing'], correct: 2 },
        { q: 'Past of "study":', opts: ['studyed','studied','studed','studying'], correct: 1 },
      ]},
      { id: 'a2-03', title: 'Food & Drinks', desc: 'Ordering at a restaurant', xp: 25, content: '"Can I have a coffee, please?" "I\'d like a pizza." "The bill, please." Menu items: starter, main course, dessert, drink.', quiz: [
        { q: '"Il conto, per favore" in English:', opts: ['The menu, please','The bill, please','The food, please','The table, please'], correct: 1 },
        { q: '"I\'d like" means:', opts: ['Io sono','Io vorrei','Io ho','Io faccio'], correct: 1 },
        { q: 'A "starter" is:', opts: ['Un dessert','Un antipasto','Una bevanda','Un contorno'], correct: 1 },
      ]},
      { id: 'a2-04', title: 'Prepositions of Place', desc: 'In, on, at, under, next to', xp: 25, content: 'IN: inside (in the box). ON: surface (on the table). AT: point (at school). UNDER: below (under the bed). NEXT TO: beside (next to the park).', quiz: [
        { q: 'The book is ___ the table.', opts: ['in','at','on','under'], correct: 2 },
        { q: 'She is ___ school.', opts: ['in','on','at','next'], correct: 2 },
        { q: 'The cat is ___ the bed.', opts: ['on','in','at','under'], correct: 3 },
      ]},
    ],
    B1: [
      { id: 'b1-01', title: 'Present Perfect', desc: 'I have been, she has done', xp: 30, content: 'have/has + past participle. Use for experiences and recent actions. "I have visited Paris." "She has finished her homework." "Have you ever been to London?"', quiz: [
        { q: 'I ___ never ___ sushi.', opts: ['have/eat','have/ate','have/eaten','has/eaten'], correct: 2 },
        { q: 'She ___ just ___ home.', opts: ['have/arrived','has/arrived','has/arrive','have/arrive'], correct: 1 },
        { q: '___ you ever ___ to Japan?', opts: ['Have/been','Has/been','Have/be','Did/been'], correct: 0 },
      ]},
      { id: 'b1-02', title: 'Conditionals (First)', desc: 'If it rains, I will stay home', xp: 30, content: 'If + present simple, will + infinitive. For real possibilities. "If it rains, I will take an umbrella." "If you study, you will pass the exam."', quiz: [
        { q: 'If she ___, I will call her.', opts: ['will come','comes','come','coming'], correct: 1 },
        { q: 'If it ___ sunny, we ___ go to the beach.', opts: ['is/will','will be/will','is/are','was/will'], correct: 0 },
        { q: 'Complete: "If you ___ hard, you ___ succeed."', opts: ['work/will','will work/will','works/will','work/would'], correct: 0 },
      ]},
      { id: 'b1-03', title: 'Phrasal Verbs Common', desc: 'Look up, give up, turn on', xp: 30, content: 'look up = cercare, give up = arrendersi, turn on = accendere, turn off = spegnere, put on = indossare, take off = togliere, get up = alzarsi, sit down = sedersi.', quiz: [
        { q: '"Give up" means:', opts: ['Dare','Arrendersi','Regalare','Alzarsi'], correct: 1 },
        { q: 'Please ___ the light.', opts: ['turn on','turn up','turn in','turn at'], correct: 0 },
        { q: '"Look up" a word means:', opts: ['Guardare su','Cercare','Guardare giu','Alzarsi'], correct: 1 },
      ]},
      { id: 'b1-04', title: 'Comparatives & Superlatives', desc: 'Bigger, the biggest, more interesting', xp: 30, content: 'Short adjectives: add -er/-est (big→bigger→biggest). Long adjectives: more/most (interesting→more interesting→most interesting). Irregular: good→better→best, bad→worse→worst.', quiz: [
        { q: 'She is ___ than her sister.', opts: ['tall','taller','tallest','more tall'], correct: 1 },
        { q: 'This is the ___ movie I have ever seen.', opts: ['good','better','best','most good'], correct: 2 },
        { q: 'English is ___ than maths for me.', opts: ['more easy','easier','easiest','most easy'], correct: 1 },
      ]},
      { id: 'b1-05', title: 'Modal Verbs', desc: 'Should, must, might, could', xp: 30, content: 'Should = dovresti (advice). Must = devi (obligation). Might = potrebbe (possibility). Could = potrei (ability/possibility). "You should study. You must wear a seatbelt. It might rain."', quiz: [
        { q: 'You ___ see a doctor. (advice)', opts: ['must','should','might','will'], correct: 1 },
        { q: 'It ___ rain tomorrow. (possibility)', opts: ['should','must','might','will'], correct: 2 },
        { q: 'You ___ not park here. (prohibition)', opts: ['should','might','must','could'], correct: 2 },
      ]},
    ],
    B2: [
      { id: 'b2-01', title: 'Reported Speech', desc: 'She said that she was tired', xp: 35, content: 'Direct: "I am tired." Reported: She said (that) she was tired. Tense shifts: am→was, will→would, can→could, have→had.', quiz: [
        { q: '"I will come" → He said he ___ come.', opts: ['will','would','can','shall'], correct: 1 },
        { q: '"I am happy" → She said she ___ happy.', opts: ['is','was','were','be'], correct: 1 },
        { q: '"I can swim" → He said he ___ swim.', opts: ['can','could','would','should'], correct: 1 },
      ]},
      { id: 'b2-02', title: 'Passive Voice', desc: 'The book was written by...', xp: 35, content: 'Subject + be + past participle. "The letter was written by John." "English is spoken worldwide." "The cake has been eaten."', quiz: [
        { q: 'The window ___ by the children.', opts: ['broke','was broken','broken','breaking'], correct: 1 },
        { q: 'English ___ in many countries.', opts: ['speaks','is spoken','is speaking','spoke'], correct: 1 },
        { q: 'The homework ___ already ___.', opts: ['has/done','has/been done','is/doing','was/do'], correct: 1 },
      ]},
      { id: 'b2-03', title: 'Relative Clauses', desc: 'Who, which, that, where, whose', xp: 35, content: 'WHO for people: "The man who called you." WHICH for things: "The book which I read." THAT for both: "The car that I bought." WHERE for places: "The city where I live." WHOSE for possession: "The girl whose bag was stolen."', quiz: [
        { q: 'The woman ___ lives next door is a doctor.', opts: ['which','who','where','whose'], correct: 1 },
        { q: 'This is the restaurant ___ we had dinner.', opts: ['who','which','where','whose'], correct: 2 },
        { q: 'The boy ___ father is a pilot speaks 3 languages.', opts: ['who','which','that','whose'], correct: 3 },
      ]},
      { id: 'b2-04', title: 'Wish & If Only', desc: 'Expressing regrets and desires', xp: 35, content: 'I wish + past simple = present desire. "I wish I had a car." I wish + past perfect = past regret. "I wish I had studied more." If only works the same way with stronger emotion.', quiz: [
        { q: 'I wish I ___ taller. (I am short)', opts: ['am','was','were','would be'], correct: 2 },
        { q: 'She wishes she ___ to the party yesterday.', opts: ['goes','went','had gone','would go'], correct: 2 },
        { q: 'If only I ___ the answer!', opts: ['know','knew','had known','will know'], correct: 1 },
      ]},
      { id: 'b2-05', title: 'Linking Words', desc: 'However, although, despite, whereas', xp: 35, content: 'HOWEVER = tuttavia (contrasto). ALTHOUGH/EVEN THOUGH + clause = sebbene. DESPITE/IN SPITE OF + noun = nonostante. WHEREAS = mentre (contrasto). THEREFORE = quindi (risultato).', quiz: [
        { q: '___ it was raining, we went for a walk.', opts: ['Despite','Although','However','Therefore'], correct: 1 },
        { q: 'He is rich. ___, he is not happy.', opts: ['Although','Despite','However','Because'], correct: 2 },
        { q: '___ the bad weather, we enjoyed the trip.', opts: ['Although','However','Despite','Whereas'], correct: 2 },
      ]},
    ],
    C1: [
      { id: 'c1-01', title: 'Advanced Conditionals', desc: 'Mixed conditionals and wishes', xp: 40, content: 'Mixed: "If I had studied harder, I would be a doctor now." Wishes: "I wish I had more time." "If only I could fly."', quiz: [
        { q: 'If I ___ you, I would apologize.', opts: ['am','was','were','be'], correct: 2 },
        { q: 'I wish I ___ speak French.', opts: ['can','could','will','would'], correct: 1 },
        { q: 'If she ___ harder, she would have passed.', opts: ['studied','had studied','studies','would study'], correct: 1 },
      ]},
      { id: 'c1-02', title: 'Inversion for Emphasis', desc: 'Never have I, rarely does she', xp: 40, content: 'Inversion after negative adverbs: "Never have I seen such beauty." "Rarely does she complain." "Not only did he pass, but he got top marks." "Hardly had I arrived when it started raining."', quiz: [
        { q: 'Never ___ I seen such a beautiful sunset.', opts: ['did','have','was','had'], correct: 1 },
        { q: 'Not only ___ he smart, but also kind.', opts: ['is','does','was','did'], correct: 0 },
        { q: 'Hardly ___ we arrived when it started to rain.', opts: ['have','did','had','were'], correct: 2 },
      ]},
      { id: 'c1-03', title: 'Collocations', desc: 'Make a decision, do homework', xp: 40, content: 'MAKE: a decision, a mistake, progress, money, an effort, a suggestion. DO: homework, research, business, your best, a favour, the dishes. HAVE: a look, a rest, fun, a meeting, a chat.', quiz: [
        { q: 'She needs to ___ a decision soon.', opts: ['do','make','take','get'], correct: 1 },
        { q: 'Can you ___ me a favour?', opts: ['make','have','do','give'], correct: 2 },
        { q: 'Let me ___ a look at your work.', opts: ['do','make','have','take'], correct: 2 },
      ]},
      { id: 'c1-04', title: 'Discourse Markers', desc: 'As a matter of fact, on the whole', xp: 40, content: '"As a matter of fact" = in realta. "On the whole" = nel complesso. "To be honest" = ad essere onesti. "As far as I am concerned" = per quanto mi riguarda. "Having said that" = detto questo.', quiz: [
        { q: '"On the whole" means:', opts: ['In parte','Nel complesso','In realta','Comunque'], correct: 1 },
        { q: '"As a matter of fact" is similar to:', opts: ['Maybe','Actually','However','Although'], correct: 1 },
        { q: '"Having said that" introduces:', opts: ['Agreement','A contrast','A question','A conclusion'], correct: 1 },
      ]},
    ],
    C2: [
      { id: 'c2-01', title: 'Nuances & Idioms', desc: 'Break a leg, piece of cake', xp: 45, content: '"Break a leg" = good luck. "Piece of cake" = very easy. "Hit the nail on the head" = exactly right. "Under the weather" = feeling sick.', quiz: [
        { q: '"Piece of cake" means:', opts: ['A dessert','Very easy','Very hard','A recipe'], correct: 1 },
        { q: '"Under the weather" means:', opts: ['Outside','Cold','Feeling sick','Raining'], correct: 2 },
        { q: '"Break a leg" is said to wish someone:', opts: ['Bad luck','Good luck','A broken leg','To run'], correct: 1 },
      ]},
      { id: 'c2-02', title: 'Formal vs Informal Register', desc: 'Appropriate language for context', xp: 45, content: 'Formal: "I would be grateful if you could..." Informal: "Can you...?" Formal: "Furthermore" / Informal: "Also". Formal: "I regret to inform you" / Informal: "Sorry but". Use formal for emails, reports, interviews.', quiz: [
        { q: 'Which is MORE formal?', opts: ['Can you help?','Could you help?','Would you be so kind as to help?','Help me'], correct: 2 },
        { q: 'Formal equivalent of "Also":', opts: ['Plus','Furthermore','And','Too'], correct: 1 },
        { q: '"I regret to inform you" is used in:', opts: ['Text messages','Formal letters','Casual chat','Social media'], correct: 1 },
      ]},
      { id: 'c2-03', title: 'Advanced Phrasal Verbs', desc: 'Come across, put up with, get away with', xp: 45, content: '"Come across" = imbattersi in. "Put up with" = tollerare. "Get away with" = farla franca. "Bring up" = tirare su (figli) o menzionare. "Look into" = investigare. "Run out of" = finire, esaurire.', quiz: [
        { q: '"Put up with" means:', opts: ['Alzare','Tollerare','Costruire','Salire'], correct: 1 },
        { q: 'We need to ___ this matter immediately.', opts: ['look into','look up','look out','look after'], correct: 0 },
        { q: 'She was ___ by her grandparents.', opts: ['put up','brought up','come across','run out'], correct: 1 },
      ]},
      { id: 'c2-04', title: 'Cleft Sentences', desc: 'It was John who, What I need is', xp: 45, content: 'Cleft sentences add emphasis. "It was JOHN who broke the window." (not someone else) "What I NEED is a holiday." "The reason WHY I called is..." "It is NOT money that makes you happy."', quiz: [
        { q: 'It ___ Maria who won the prize.', opts: ['is','was','were','has'], correct: 1 },
        { q: 'What I really ___ is some peace and quiet.', opts: ['want','wants','wanted','wanting'], correct: 0 },
        { q: 'Cleft sentences are used to:', opts: ['Ask questions','Add emphasis','Express doubt','Show agreement'], correct: 1 },
      ]},
    ],
  };

  app.get('/api/lessons', requireAuth, async (req, res) => {
    const level = req.query.level || req.user.level || 'A1';
    const lessons = LESSON_PATHS[level] || [];
    const progress = req.user.progress || {};
    const lessonsWithProgress = lessons.map(l => ({
      id: l.id, title: l.title, desc: l.desc, xp: l.xp,
      completed: !!progress[l.id], score: progress[l.id]?.score || 0,
      quizLength: l.quiz.length,
    }));
    res.json({ level, lessons: lessonsWithProgress, totalLessons: lessons.length, completedCount: lessonsWithProgress.filter(l => l.completed).length });
  });

  app.get('/api/lessons/:lessonId', requireAuth, (req, res) => {
    for (const [level, lessons] of Object.entries(LESSON_PATHS)) {
      const lesson = lessons.find(l => l.id === req.params.lessonId);
      if (lesson) {
        const progress = req.user.progress || {};
        return res.json({
          ...lesson,
          level,
          completed: !!progress[lesson.id],
          prevScore: progress[lesson.id]?.score || 0,
          quiz: lesson.quiz.map(q => ({ q: q.q, opts: q.opts })), // Hide correct answers
        });
      }
    }
    res.status(404).json({ error: 'Lezione non trovata' });
  });

  app.post('/api/lessons/:lessonId/submit', requireAuth, async (req, res) => {
    try {
      const { answers } = req.body;
      if (!answers || !Array.isArray(answers)) return res.status(400).json({ error: 'Risposte mancanti' });
      let lesson = null, lessonLevel = null;
      for (const [level, lessons] of Object.entries(LESSON_PATHS)) {
        const found = lessons.find(l => l.id === req.params.lessonId);
        if (found) { lesson = found; lessonLevel = level; break; }
      }
      if (!lesson) return res.status(404).json({ error: 'Lezione non trovata' });
      // Score quiz
      let correct = 0;
      const results = lesson.quiz.map((q, i) => {
        const isCorrect = answers[i] === q.correct;
        if (isCorrect) correct++;
        return { correct: isCorrect, correctAnswer: q.correct, userAnswer: answers[i] };
      });
      const score = Math.round((correct / lesson.quiz.length) * 100);
      const passed = score >= 60;
      // Update progress
      const user = await db.users.findOneAsync({ _id: req.user._id });
      const progress = user.progress || {};
      const prevCompleted = !!progress[lesson.id];
      if (passed) {
        progress[lesson.id] = { score, completedAt: Date.now() };
        const xpGain = prevCompleted ? 0 : lesson.xp; // XP solo prima volta
        await db.users.updateAsync({ _id: req.user._id }, { $set: { progress, xp: (user.xp || 0) + xpGain } });
      }
      res.json({ score, passed, correct, total: lesson.quiz.length, results, xpGained: passed && !prevCompleted ? lesson.xp : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
