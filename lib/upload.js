// lib/upload.js — Multer configuration per upload sicuri
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
try { fs.accessSync(UPLOADS_DIR, fs.constants.W_OK); }
catch { console.error('[ERROR] UPLOADS DIR NON SCRIVIBILE:', UPLOADS_DIR); }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, Date.now() + '_' + crypto.randomBytes(6).toString('hex') + ext);
  },
});

const BLOCKED_EXT = /exe|bat|cmd|sh|ps1|php|jsp|asp|cgi|py|rb|pl|com|scr|msi|dll|vbs$/;

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (BLOCKED_EXT.test(ext)) return cb(new Error('Tipo di file non consentito'), false);
    const mime = (file.mimetype || '').toLowerCase();
    const validMime = mime.startsWith('image/') || mime.startsWith('video/') ||
                      mime.startsWith('audio/') || mime === 'application/pdf' ||
                      mime === 'application/octet-stream';
    if (!validMime) return cb(new Error('MIME type non consentito'), false);
    cb(null, true);
  },
});

const ALLOWED_VID = /mp4|mov|avi|webm|3gp|mkv/;
const ALLOWED_AUD = /webm|ogg|wav|opus|aac|m4a|mp4/;

const MIME_MAP = {
  '.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.3gp':'video/3gpp',
  '.mkv':'video/x-matroska','.avi':'video/x-msvideo','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.png':'image/png','.gif':'image/gif','.webp':'image/webp','.mp3':'audio/mpeg',
  '.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav','.aac':'audio/aac','.pdf':'application/pdf'
};

module.exports = { upload, UPLOADS_DIR, ALLOWED_VID, ALLOWED_AUD, MIME_MAP };
