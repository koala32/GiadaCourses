const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/init');
const { authenticateToken, SECRET } = require('../middleware/auth');
const { logActivity } = require('../middleware/security');

function setTokenCookie(res, req, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

router.post('/register', (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;
    if (!username || !email || !password || !displayName)
      return res.status(400).json({ error: 'Tutti i campi sono obbligatori' });
    if (username.length < 3 || username.length > 30)
      return res.status(400).json({ error: 'Lo username deve avere tra 3 e 30 caratteri' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Lo username può contenere solo lettere, numeri e underscore' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Inserisci un indirizzo email valido' });
    if (password.length < 8)
      return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password))
      return res.status(400).json({ error: 'La password deve contenere almeno una maiuscola, una minuscola e un numero' });

    const existing = db.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?')
      .get(username.toLowerCase(), email.toLowerCase());
    if (existing) {
      if (existing.username === username.toLowerCase())
        return res.status(409).json({ error: 'Questo username è già in uso. Provane un altro.' });
      return res.status(409).json({ error: 'Questa email è già registrata. Prova ad accedere.' });
    }

    const id = uuidv4();
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
      .run(id, username.toLowerCase(), email.toLowerCase(), hash, displayName.trim());

    const token = jwt.sign({ userId: id }, SECRET, { expiresIn: '7d' });
    setTokenCookie(res, req, token);
    logActivity(db, id, 'register', `Nuovo utente: ${username}`, req.ip);
    res.json({ success: true, user: { id, username: username.toLowerCase(), displayName: displayName.trim(), role: 'user' } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Errore durante la registrazione. Riprova.' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Inserisci username/email e password' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get(username.toLowerCase(), username.toLowerCase());

    if (!user) {
      logActivity(db, null, 'login_failed', `Utente non trovato: ${username}`, req.ip);
      return res.status(401).json({ error: 'Nessun account trovato. Controlla i dati o registrati.', notFound: true });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      logActivity(db, user.id, 'login_failed', `Password sbagliata per: ${username}`, req.ip);
      return res.status(401).json({ error: 'Password non corretta. Riprova.', wrongPassword: true });
    }
    if (user.is_banned)
      return res.status(403).json({ error: `Account sospeso: ${user.ban_reason || 'contatta l\'amministratore'}` });
    if (!user.is_active)
      return res.status(403).json({ error: 'Account disattivato.' });

    db.prepare('UPDATE users SET last_login = datetime("now"), login_count = login_count + 1 WHERE id = ?').run(user.id);
    const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '7d' });
    setTokenCookie(res, req, token);
    logActivity(db, user.id, 'login', 'Login effettuato', req.ip);

    res.json({ success: true, user: { id: user.id, username: user.username, displayName: user.display_name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Errore durante il login. Riprova.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});

router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id,username,email,display_name,role,avatar_url,created_at,last_login,login_count FROM users WHERE id=?').get(req.user.id);
  const ticketCount = db.prepare('SELECT COUNT(*) as n FROM tickets WHERE user_id=?').get(req.user.id).n;
  const completedLessons = db.prepare('SELECT COUNT(*) as n FROM user_progress WHERE user_id=? AND completed=1').get(req.user.id).n;
  res.json({ ...user, stats: { tickets: ticketCount, lessonsCompleted: completedLessons } });
});

router.put('/me', authenticateToken, (req, res) => {
  const { displayName, email } = req.body;
  if (displayName) db.prepare('UPDATE users SET display_name=?,updated_at=datetime("now") WHERE id=?').run(displayName.trim(), req.user.id);
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const existing = db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email.toLowerCase(), req.user.id);
    if (existing) return res.status(409).json({ error: 'Email già in uso' });
    db.prepare('UPDATE users SET email=?,updated_at=datetime("now") WHERE id=?').run(email.toLowerCase(), req.user.id);
  }
  res.json({ success: true });
});

router.put('/password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(400).json({ error: 'Password attuale non corretta' });
  if (newPassword.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword))
    return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri con maiuscola, minuscola e numero' });

  db.prepare('UPDATE users SET password_hash=?,updated_at=datetime("now") WHERE id=?').run(bcrypt.hashSync(newPassword, 12), req.user.id);
  logActivity(db, req.user.id, 'password_change', 'Password modificata', req.ip);
  res.json({ success: true });
});

module.exports = router;
