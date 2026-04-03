const rateLimit = require('express-rate-limit');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

const rateLimiters = {
  auth: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Troppi tentativi, riprova tra 15 minuti' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  }),
  api: rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Troppe richieste, riprova tra poco' },
    validate: { xForwardedForHeader: false },
  }),
  chat: rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Messaggi troppo frequenti' },
    validate: { xForwardedForHeader: false },
  }),
};

function logActivity(db, userId, action, details, ip) {
  try {
    db.prepare("INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)")
      .run(userId, action, details, ip);
  } catch (e) {}
}

module.exports = { securityHeaders, rateLimiters, logActivity };
