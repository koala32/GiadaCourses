const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { logActivity } = require('../middleware/security');

router.use(authenticateToken);
router.use(requireAdmin);

router.get('/stats', (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'user'").get().n;
  const activeToday = db.prepare("SELECT COUNT(*) as n FROM users WHERE last_login >= datetime('now', '-1 day')").get().n;
  const openTickets = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status IN ('aperto', 'in_lavorazione')").get().n;
  const totalTickets = db.prepare('SELECT COUNT(*) as n FROM tickets').get().n;
  const resolvedTickets = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status IN ('risolto', 'chiuso')").get().n;
  const bannedUsers = db.prepare('SELECT COUNT(*) as n FROM users WHERE is_banned = 1').get().n;
  const recentRegistrations = db.prepare("SELECT date(created_at) as day, COUNT(*) as count FROM users WHERE created_at >= datetime('now', '-7 days') GROUP BY date(created_at) ORDER BY day").all();
  const ticketsByCategory = db.prepare('SELECT category, COUNT(*) as count FROM tickets GROUP BY category ORDER BY count DESC').all();
  res.json({ totalUsers, activeToday, openTickets, totalTickets, resolvedTickets, bannedUsers, recentRegistrations, ticketsByCategory });
});

router.get('/users', (req, res) => {
  const { page = 1, search = '', limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  let query = "SELECT id,username,email,display_name,role,is_active,is_banned,ban_reason,created_at,last_login,login_count FROM users WHERE role != 'superadmin'";
  let countQuery = "SELECT COUNT(*) as n FROM users WHERE role != 'superadmin'";
  const params = [];
  if (search) {
    query += ' AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)';
    countQuery += ' AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const total = db.prepare(countQuery).get(...params).n;
  const users = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));
  const enriched = users.map(u => ({
    ...u,
    ticketCount: db.prepare('SELECT COUNT(*) as n FROM tickets WHERE user_id = ?').get(u.id).n,
    lessonsCompleted: db.prepare('SELECT COUNT(*) as n FROM user_progress WHERE user_id = ? AND completed = 1').get(u.id).n,
  }));
  res.json({ users: enriched, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
});

router.get('/users/:id', (req, res) => {
  const user = db.prepare("SELECT id,username,email,display_name,role,is_active,is_banned,ban_reason,created_at,last_login,login_count FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  const tickets = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id);
  const progress = db.prepare("SELECT up.*, l.title as lesson_title, c.title as course_title FROM user_progress up JOIN lessons l ON up.lesson_id = l.id JOIN courses c ON l.course_id = c.id WHERE up.user_id = ? ORDER BY up.completed_at DESC").all(user.id);
  const activity = db.prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(user.id);
  res.json({ user, tickets, progress, activity });
});

router.put('/users/:id/ban', requireSuperAdmin, (req, res) => {
  const { reason } = req.body;
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  if (user.role === 'superadmin') return res.status(403).json({ error: 'Non puoi bannare il superadmin' });
  db.prepare("UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason || 'Violazione regolamento', req.params.id);
  logActivity(db, req.user.id, 'ban_user', 'Bannato: ' + req.params.id, req.ip);
  res.json({ success: true });
});

router.put('/users/:id/unban', requireSuperAdmin, (req, res) => {
  db.prepare("UPDATE users SET is_banned = 0, ban_reason = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logActivity(db, req.user.id, 'unban_user', 'Sbannato: ' + req.params.id, req.ip);
  res.json({ success: true });
});

router.get('/tickets', (req, res) => {
  const { status, page = 1 } = req.query;
  const limit = 30;
  const offset = (page - 1) * limit;
  let query = "SELECT t.*, u.display_name, u.username, u.email, (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count, (SELECT message FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message FROM tickets t JOIN users u ON t.user_id = u.id";
  const params = [];
  if (status && status !== 'tutti') { query += ' WHERE t.status = ?'; params.push(status); }
  query += ' ORDER BY t.updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const tickets = db.prepare(query).all(...params);
  const countParams = (status && status !== 'tutti') ? [status] : [];
  const total = db.prepare('SELECT COUNT(*) as n FROM tickets' + (status && status !== 'tutti' ? ' WHERE status = ?' : '')).get(...countParams).n;
  res.json({ tickets, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
});

router.put('/tickets/:id/status', (req, res) => {
  const { status } = req.body;
  const valid = ['aperto', 'in_lavorazione', 'risolto', 'chiuso'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Stato non valido' });
  if (status === 'chiuso') {
    db.prepare("UPDATE tickets SET status = ?, closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.user.id, req.params.id);
  } else {
    db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  }
  res.json({ success: true });
});

router.get('/activity', requireSuperAdmin, (req, res) => {
  const { page = 1 } = req.query;
  const limit = 100;
  const offset = (page - 1) * limit;
  const logs = db.prepare("SELECT al.*, u.username, u.display_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  res.json(logs);
});

module.exports = router;
