// ═══════════════════════════════════════════════════════════
//  Database SQLite — Schema completo
// ═══════════════════════════════════════════════════════════
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'helpy.db');
const db = new Database(DB_PATH, { verbose: process.env.NODE_ENV === 'development' ? console.log : null });

// WAL mode per performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Tabelle ─────────────────────────────────────────────────
db.exec(`
  -- Utenti
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('user','admin','superadmin')),
    avatar_url TEXT DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    is_banned INTEGER DEFAULT 0,
    ban_reason TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    last_login DATETIME DEFAULT NULL,
    login_count INTEGER DEFAULT 0
  );

  -- Sessioni (per tracciamento)
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    expires_at DATETIME NOT NULL
  );

  -- Ticket di assistenza (chat)
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    category TEXT DEFAULT 'generale' CHECK(category IN ('generale','hardware','software','rete','sicurezza','altro')),
    status TEXT DEFAULT 'aperto' CHECK(status IN ('aperto','in_lavorazione','risolto','chiuso')),
    priority TEXT DEFAULT 'normale' CHECK(priority IN ('bassa','normale','alta','urgente')),
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    closed_at DATETIME DEFAULT NULL,
    closed_by TEXT DEFAULT NULL
  );

  -- Messaggi dei ticket
  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  -- Percorsi di apprendimento
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    difficulty TEXT DEFAULT 'base' CHECK(difficulty IN ('base','intermedio','avanzato')),
    icon TEXT DEFAULT '📚',
    sort_order INTEGER DEFAULT 0,
    is_published INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  -- Lezioni nei corsi
  CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    type TEXT DEFAULT 'guida' CHECK(type IN ('guida','quiz','minigioco')),
    quiz_data TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  -- Progresso utente
  CREATE TABLE IF NOT EXISTS user_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed INTEGER DEFAULT 0,
    score INTEGER DEFAULT NULL,
    completed_at DATETIME DEFAULT NULL,
    UNIQUE(user_id, lesson_id)
  );

  -- Log attività (audit trail)
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  -- Indici
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ── Crea superadmin se non esiste ───────────────────────────
const superadmin = db.prepare('SELECT id FROM users WHERE role = ?').get('superadmin');
if (!superadmin) {
  const adminId = uuidv4();
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'HelpyAdmin2026!', 12);
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, display_name, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(adminId, 'superadmin', 'admin@helpy.dev', hash, 'Super Admin', 'superadmin');
  console.log('✅ Superadmin creato (username: superadmin)');
}

// ── Inserisci corsi di esempio se vuoti ─────────────────────
const courseCount = db.prepare('SELECT COUNT(*) as n FROM courses').get().n;
if (courseCount === 0) {
  const coursesData = [
    { id: uuidv4(), title: 'Basi del Computer', description: 'Impara ad usare il computer partendo da zero: mouse, tastiera, desktop e cartelle.', category: 'base', difficulty: 'base', icon: '🖥️', sort_order: 1 },
    { id: uuidv4(), title: 'Navigare in Sicurezza', description: 'Come usare internet senza rischi: password, phishing, siti sicuri e privacy.', category: 'sicurezza', difficulty: 'base', icon: '🛡️', sort_order: 2 },
    { id: uuidv4(), title: 'Email e Comunicazione', description: 'Gestire email, allegati, spam e comunicare in modo professionale online.', category: 'comunicazione', difficulty: 'base', icon: '📧', sort_order: 3 },
    { id: uuidv4(), title: 'Il tuo primo Smartphone', description: 'Guida completa per configurare e usare al meglio il tuo telefono.', category: 'mobile', difficulty: 'base', icon: '📱', sort_order: 4 },
    { id: uuidv4(), title: 'Risoluzione Problemi Comuni', description: 'Il PC è lento? Internet non funziona? Impara a risolvere i problemi da solo.', category: 'troubleshooting', difficulty: 'intermedio', icon: '🔧', sort_order: 5 },
    { id: uuidv4(), title: 'Produttività Digitale', description: 'Word, Excel, Google Drive e gli strumenti per lavorare meglio ogni giorno.', category: 'produttivita', difficulty: 'intermedio', icon: '📊', sort_order: 6 },
  ];

  const insertCourse = db.prepare(`
    INSERT INTO courses (id, title, description, category, difficulty, icon, sort_order)
    VALUES (@id, @title, @description, @category, @difficulty, @icon, @sort_order)
  `);

  const insertLesson = db.prepare(`
    INSERT INTO lessons (id, course_id, title, content, sort_order, type, quiz_data)
    VALUES (@id, @course_id, @title, @content, @sort_order, @type, @quiz_data)
  `);

  const transaction = db.transaction(() => {
    for (const course of coursesData) {
      insertCourse.run(course);

      // Lezioni di esempio per il primo corso
      if (course.sort_order === 1) {
        const lessons = [
          { id: uuidv4(), course_id: course.id, title: 'Accendere e spegnere il PC', content: `<h2>Il tuo primo passo</h2><p>Accendere un computer è semplice! Cerca il <strong>pulsante di accensione</strong> — di solito ha il simbolo ⏻ ed è sul case (il "cassettone") del computer o sul lato del portatile.</p><p><strong>Per spegnere:</strong> non premere il pulsante! Usa sempre il menu Start → Arresta. Spegnere forzatamente può danneggiare i file.</p><h3>Ricorda</h3><ul><li>Aspetta che il computer si avvii completamente prima di usarlo</li><li>Chiudi tutti i programmi prima di spegnere</li><li>Il portatile si può anche "sospendere" chiudendo il coperchio</li></ul>`, sort_order: 1, type: 'guida', quiz_data: null },
          { id: uuidv4(), course_id: course.id, title: 'Mouse e tastiera', content: `<h2>I tuoi strumenti principali</h2><p>Il <strong>mouse</strong> muove la freccia sullo schermo. Ha due pulsanti:</p><ul><li><strong>Tasto sinistro</strong>: seleziona, apre (click e doppio click)</li><li><strong>Tasto destro</strong>: apre un menu con opzioni extra</li><li><strong>Rotellina</strong>: scorri le pagine su e giù</li></ul><p>La <strong>tastiera</strong> serve per scrivere. Tasti importanti:</p><ul><li><strong>Invio</strong>: conferma / vai a capo</li><li><strong>Backspace ←</strong>: cancella l'ultimo carattere</li><li><strong>Maiusc (Shift)</strong>: tieni premuto per le lettere MAIUSCOLE</li><li><strong>Ctrl + C</strong>: copia | <strong>Ctrl + V</strong>: incolla</li></ul>`, sort_order: 2, type: 'guida', quiz_data: null },
          { id: uuidv4(), course_id: course.id, title: 'Quiz: Basi del PC', content: 'Verifica quello che hai imparato!', sort_order: 3, type: 'quiz', quiz_data: JSON.stringify({
            questions: [
              { q: 'Come si spegne correttamente un computer?', options: ['Staccando la spina', 'Premendo il pulsante di accensione', 'Da Start → Arresta', 'Chiudendo il coperchio'], correct: 2 },
              { q: 'Cosa fa il tasto destro del mouse?', options: ['Apre un programma', 'Cancella un file', 'Apre un menu con opzioni', 'Spegne lo schermo'], correct: 2 },
              { q: 'Qual è la scorciatoia per copiare?', options: ['Ctrl + V', 'Ctrl + C', 'Ctrl + X', 'Ctrl + Z'], correct: 1 },
            ]
          })}
        ];
        for (const lesson of lessons) {
          insertLesson.run(lesson);
        }
      }
    }
  });
  transaction();
  console.log('✅ Corsi di esempio inseriti');
}

module.exports = db;
