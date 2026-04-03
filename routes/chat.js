// ═══════════════════════════════════════════════════════════
//  Chat/Ticket Routes — Sistema di assistenza
// ═══════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database/init');
const { authenticateToken } = require('../middleware/auth');
const { rateLimiters } = require('../middleware/security');

// Tutti i routes richiedono auth
router.use(authenticateToken);

// ── Crea nuovo ticket ───────────────────────────────────────
router.post('/tickets', rateLimiters.chat, (req, res) => {
  try {
    const { subject, category, message } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ error: 'Oggetto e messaggio sono obbligatori' });
    }
    if (subject.length > 200) return res.status(400).json({ error: 'Oggetto troppo lungo (max 200 caratteri)' });
    if (message.length > 5000) return res.status(400).json({ error: 'Messaggio troppo lungo (max 5000 caratteri)' });

    const validCategories = ['generale', 'hardware', 'software', 'rete', 'sicurezza', 'altro'];
    const cat = validCategories.includes(category) ? category : 'generale';

    const ticketId = uuidv4();
    db.prepare(`INSERT INTO tickets (id, user_id, subject, category) VALUES (?, ?, ?, ?)`)
      .run(ticketId, req.user.id, subject.trim(), cat);

    db.prepare(`INSERT INTO ticket_messages (ticket_id, sender_id, message, is_admin) VALUES (?, ?, ?, 0)`)
      .run(ticketId, req.user.id, message.trim());

    res.json({ success: true, ticketId });
  } catch (err) {
    console.error('Create ticket error:', err);
    res.status(500).json({ error: 'Errore nella creazione del ticket' });
  }
});

// ── Lista ticket utente ─────────────────────────────────────
router.get('/tickets', (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*, 
      (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count,
      (SELECT message FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT is_admin FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_sender_is_admin
    FROM tickets t
    WHERE t.user_id = ?
    ORDER BY t.updated_at DESC
  `).all(req.user.id);

  res.json(tickets);
});

// ── Dettaglio ticket con messaggi ───────────────────────────
router.get('/tickets/:id', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (!ticket) {
    // Check admin
    if (req.user.role === 'superadmin' || req.user.role === 'admin') {
      const adminTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
      if (!adminTicket) return res.status(404).json({ error: 'Ticket non trovato' });
      const messages = db.prepare(`
        SELECT tm.*, u.display_name, u.username, u.role 
        FROM ticket_messages tm JOIN users u ON tm.sender_id = u.id
        WHERE tm.ticket_id = ? ORDER BY tm.created_at ASC
      `).all(req.params.id);
      const user = db.prepare('SELECT display_name, username, email FROM users WHERE id = ?').get(adminTicket.user_id);
      return res.json({ ...adminTicket, messages, user });
    }
    return res.status(404).json({ error: 'Ticket non trovato' });
  }

  const messages = db.prepare(`
    SELECT tm.*, u.display_name, u.username, u.role 
    FROM ticket_messages tm JOIN users u ON tm.sender_id = u.id
    WHERE tm.ticket_id = ? ORDER BY tm.created_at ASC
  `).all(req.params.id);

  res.json({ ...ticket, messages });
});

// ── Invia messaggio in un ticket ────────────────────────────
router.post('/tickets/:id/messages', rateLimiters.chat, (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.length > 5000) {
      return res.status(400).json({ error: 'Messaggio non valido (max 5000 caratteri)' });
    }

    // Verifica proprietà o admin
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
    if (ticket.user_id !== req.user.id && req.user.role !== 'superadmin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorizzato' });
    }

    const isAdmin = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 1 : 0;

    db.prepare(`INSERT INTO ticket_messages (ticket_id, sender_id, message, is_admin) VALUES (?, ?, ?, ?)`)
      .run(req.params.id, req.user.id, message.trim(), isAdmin);

    // Aggiorna timestamp ticket
    let newStatus = ticket.status;
    if (isAdmin && ticket.status === 'aperto') newStatus = 'in_lavorazione';
    db.prepare('UPDATE tickets SET updated_at = datetime("now"), status = ? WHERE id = ?').run(newStatus, req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Errore nell\'invio del messaggio' });
  }
});

// ── Chiudi ticket (utente o admin) ──────────────────────────
router.put('/tickets/:id/close', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket non trovato' });
  if (ticket.user_id !== req.user.id && req.user.role !== 'superadmin' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  db.prepare('UPDATE tickets SET status = "chiuso", closed_at = datetime("now"), closed_by = ?, updated_at = datetime("now") WHERE id = ?')
    .run(req.user.id, req.params.id);

  res.json({ success: true });
});

module.exports = router;
