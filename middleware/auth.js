// ═══════════════════════════════════════════════════════════
//  Auth Middleware — JWT verification
// ═══════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const db = require('../database/init');
const SECRET = process.env.JWT_SECRET || 'helpy_jwt_secret_change_me_2026';

function authenticateToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accesso non autorizzato' });

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, username, email, display_name, role, is_active, is_banned FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Utente non trovato' });
    if (user.is_banned) return res.status(403).json({ error: 'Account sospeso' });
    if (!user.is_active) return res.status(403).json({ error: 'Account disattivato' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessione scaduta, effettua di nuovo il login' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Accesso riservato agli amministratori' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Accesso riservato al super amministratore' });
  }
  next();
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET);
      const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ? AND is_active = 1 AND is_banned = 0').get(decoded.userId);
      if (user) req.user = user;
    } catch (e) { /* ignore */ }
  }
  next();
}

module.exports = { authenticateToken, requireAdmin, requireSuperAdmin, optionalAuth, SECRET };
