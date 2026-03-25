// middleware/index.js — Auth + Security middleware
const { db } = require('../lib/db');

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

async function resolveToken(raw) {
  const token = (raw || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const session = await db.sessions.findOneAsync({ token });
  if (!session) return null;
  if (session.createdAt && (Date.now() - session.createdAt > SESSION_MAX_AGE_MS)) {
    await db.sessions.removeAsync({ token }, {});
    return null;
  }
  return await db.users.findOneAsync({ _id: session.userId });
}

async function authMiddleware(req, res, next) {
  req.user = await resolveToken(req.headers.authorization || '').catch(() => null);
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

// Security middleware setup
function setupSecurity(app) {
  let helmet, rateLimit;
  try { helmet = require('helmet'); } catch { helmet = null; }
  try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://giadacourses.duckdns.org,http://localhost:3000').split(',').map(s => s.trim());

  // Helmet
  if (helmet) {
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  }

  // Security headers manuali
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
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

  // Rate Limiting
  if (rateLimit) {
    app.use('/api/auth/login', rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Troppi tentativi. Riprova tra 15 minuti.' } }));
    app.use('/api/auth/register', rateLimit({ windowMs: 60*60*1000, max: 5, message: { error: 'Troppe registrazioni. Riprova tra un\'ora.' } }));
    app.use('/api/', rateLimit({ windowMs: 60*1000, max: 200, message: { error: 'Troppe richieste.' } }));
    app.use('/api/media/', rateLimit({ windowMs: 60*1000, max: 30, message: { error: 'Troppi upload.' } }));
    console.log('[OK] Rate limiting attivo');
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
    db.logs.insertAsync({ ip, userId: req.user?._id || null, username: req.user?.username || 'Ospite', action: `${req.method} ${req.path}`, timestamp: Date.now(), device: req.headers['user-agent'] || '' }).catch(() => {});
  }
  next();
}

module.exports = { resolveToken, authMiddleware, requireAuth, requireRole, setupSecurity, logMiddleware };
