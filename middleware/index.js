// middleware/index.js — Auth + Security middleware (HARDENED v10.1)
const { db } = require('../lib/db');

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

async function resolveToken(raw) {
  const token = (raw || '').replace('Bearer ', '').trim();
  if (!token || token.length < 10 || token.length > 256) return null;
  const session = await db.sessions.findOneAsync({ token });
  if (!session) return null;
  if (session.createdAt && (Date.now() - session.createdAt > SESSION_MAX_AGE_MS)) {
    await db.sessions.removeAsync({ token }, {});
    return null;
  }
  const user = await db.users.findOneAsync({ _id: session.userId });
  if (!user || user.banned) return null;
  return user;
}

async function authMiddleware(req, res, next) {
  req.user = await resolveToken(req.headers.authorization || req.query?.t || '').catch(() => null);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Devi essere loggato' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accesso negato' });
    next();
  };
}

// Input sanitizer — previene XSS injection nei body JSON
function sanitizeInput(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;').slice(0, 10000);
  }
  if (Array.isArray(obj)) return obj.map(sanitizeInput);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'passwordHash' || k === 'password' || k === 'currentPassword' || k === 'newPassword') { out[k] = v; continue; }
      out[k] = sanitizeInput(v);
    }
    return out;
  }
  return obj;
}

// Security middleware setup
function setupSecurity(app) {
  let helmet, rateLimit;
  try { helmet = require('helmet'); } catch { helmet = null; }
  try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://giadacourses.duckdns.org,http://localhost:3000').split(',').map(s => s.trim());

  // ── SCANNER/EXPLOIT BLOCKER — blocca bot e scanner automatici ──
  const _blockedPaths = /\/(vendor|\.env|\.git|wp-admin|wp-login|wp-content|xmlrpc|phpmyadmin|admin\.php|eval-stdin|shell|backdoor|cgi-bin|\.aws|\.config|actuator|graphql|gql|debug|console|telescope|elfinder)/i;
  const _blockedIPs = new Set();
  const _scanAttempts = new Map(); // ip -> {count, firstSeen}

  app.use((req, res, next) => {
    const rawIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().replace('::ffff:', '');
    
    // IP gia bannato
    if (_blockedIPs.has(rawIp)) return res.status(403).end();

    // Path exploit
    if (_blockedPaths.test(req.path)) {
      // Registra tentativo
      const attempts = _scanAttempts.get(rawIp) || { count: 0, firstSeen: Date.now() };
      attempts.count++;
      _scanAttempts.set(rawIp, attempts);
      
      // 3+ tentativi = ban IP per 24h
      if (attempts.count >= 3) {
        _blockedIPs.add(rawIp);
        setTimeout(() => _blockedIPs.delete(rawIp), 86400000);
        console.warn('[SECURITY] IP BANNATO per scanning:', rawIp, 'path:', req.path);
      }
      
      // Log tentativo di attacco
      db.logs.insertAsync({
        type: 'security_scan', ip: rawIp, path: req.path, method: req.method,
        userAgent: (req.headers['user-agent'] || '').slice(0, 300),
        timestamp: Date.now(), severity: 'high'
      }).catch(() => {});
      
      console.warn('[SECURITY] Scan bloccato:', rawIp, req.method, req.path);
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });

  // Pulizia periodica scan attempts (ogni ora)
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of _scanAttempts) {
      if (now - data.firstSeen > 3600000) _scanAttempts.delete(ip);
    }
  }, 3600000);

  // ── SECURITY LOGS endpoint per admin ──
  app.get('/api/security/logs', async (req, res) => {
    if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'Non autorizzato' });
    const logs = await db.logs.findAsync({ type: 'security_scan' });
    res.json({
      logs: logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100),
      blockedIPs: [..._blockedIPs],
      scanAttempts: Object.fromEntries(_scanAttempts)
    });
  });

  // Helmet
  if (helmet) {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", "wss:", "ws:"],
          mediaSrc: ["'self'", "blob:"],
          workerSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }));
  }

  // Security headers aggiuntivi
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
  });

  // CORS sicuro
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Input sanitization per tutti i POST/PUT
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      req.body = sanitizeInput(req.body);
    }
    // Sanitize URL params (previene path traversal)
    if (req.params) {
      for (const [k, v] of Object.entries(req.params)) {
        if (typeof v === 'string' && (v.includes('..') || v.includes('%2e') || v.includes('%00'))) {
          return res.status(400).json({ error: 'Parametro non valido' });
        }
      }
    }
    // Sanitize query params
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (typeof v === 'string' && v.length > 500) {
          req.query[k] = v.slice(0, 500);
        }
      }
    }
    next();
  });

  // Rate Limiting
  if (rateLimit) {
    app.use('/api/auth/login', rateLimit({ windowMs: 15*60*1000, max: 8, message: { error: 'Troppi tentativi. Riprova tra 15 minuti.' }, standardHeaders: true, legacyHeaders: false }));
    app.use('/api/auth/register', rateLimit({ windowMs: 60*60*1000, max: 4, message: { error: 'Troppe registrazioni. Riprova tra un\'ora.' }, standardHeaders: true, legacyHeaders: false }));
    app.use('/api/auth/forgot-password', rateLimit({ windowMs: 15*60*1000, max: 3, message: { error: 'Troppe richieste reset password.' } }));
    app.use('/api/media/', rateLimit({ windowMs: 60*1000, max: 20, message: { error: 'Troppi upload.' } }));
    app.use('/api/calls/', rateLimit({ windowMs: 60*1000, max: 30, message: { error: 'Troppe richieste chiamata.' } }));
    app.use('/api/challenges/', rateLimit({ windowMs: 60*1000, max: 20, message: { error: 'Troppe richieste sfida.' } }));
    app.use('/api/bug-report', rateLimit({ windowMs: 60*60*1000, max: 5, message: { error: 'Troppe segnalazioni. Riprova piu tardi.' } }));
    app.use('/api/', rateLimit({ windowMs: 60*1000, max: 200, message: { error: 'Troppe richieste.' } }));
    console.log('[OK] Rate limiting attivo (hardened v2)');
  } else {
    console.log('[WARN] express-rate-limit non installato. Esegui: npm install express-rate-limit helmet');
  }

  // No-cache per API
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  return ALLOWED_ORIGINS;
}

// Log azioni
function logMiddleware(req, res, next) {
  if (req.path.startsWith('/api/') && req.method !== 'GET') {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ip = rawIp.split(',')[0].trim().replace('::ffff:', '').replace('::1', '127.0.0.1');
    db.logs.insertAsync({ ip, userId: req.user?._id || null, username: req.user?.username || 'Ospite', action: `${req.method} ${req.path}`, timestamp: Date.now(), device: (req.headers['user-agent'] || '').slice(0, 300) }).catch(() => {});
  }
  next();
}

module.exports = { resolveToken, authMiddleware, requireAuth, requireRole, setupSecurity, logMiddleware };
