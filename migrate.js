#!/usr/bin/env node
// ============================================================
//  migrate.js — Migra da v9 monolite a v10 modulare
//  Uso: node migrate.js [path/to/old/index.html]
//  Estrae CSS e JS, aggiunge nuove feature (dark mode, desktop blocker)
// ============================================================
const fs = require('fs');
const path = require('path');

const oldFile = process.argv[2] || path.join(__dirname, '..', 'GiadaCourses-work', 'index.html');
if (!fs.existsSync(oldFile)) {
  console.error('File non trovato:', oldFile);
  console.error('Uso: node migrate.js /path/to/old/index.html');
  process.exit(1);
}

const html = fs.readFileSync(oldFile, 'utf8');
const publicDir = path.join(__dirname, 'public');

// 1. Estrai CSS (tutto tra <style> e </style>)
const cssMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
let css = cssMatch ? cssMatch[1] : '';

// Aggiungi dark mode CSS
css += `
/* ============================================================
   DARK MODE
============================================================ */
[data-theme="dark"] {
  --bg: #0a0a1a;
  --card-bg: #161630;
  --text: #e8e8f0;
  --dark: #f0f0ff;
  --muted: #8888aa;
  --shadow: 0 2px 12px rgba(0,0,0,.3);
}
[data-theme="dark"] .feed-post { border-color: rgba(255,255,255,.06); }
[data-theme="dark"] .comment-input { background: rgba(255,255,255,.06); color: #fff; border-color: rgba(255,255,255,.1); }
[data-theme="dark"] .comment-bubble { background: rgba(255,255,255,.06); }
[data-theme="dark"] .game-card { background: #161630; border-color: rgba(255,255,255,.06); }
[data-theme="dark"] .game-input { background: rgba(255,255,255,.06); color: #fff; border-color: rgba(255,255,255,.1); }
[data-theme="dark"] .game-play-card { background: #161630; }
[data-theme="dark"] .game-result-card { background: #161630; }
[data-theme="dark"] .fill-option { background: #161630; color: #e8e8f0; border-color: rgba(255,255,255,.1); }
[data-theme="dark"] .match-item { background: #161630; color: #e8e8f0; border-color: rgba(255,255,255,.1); }
[data-theme="dark"] .changelog-card { background: #161630; }
[data-theme="dark"] .btn-secondary { background: rgba(255,255,255,.08); color: #e8e8f0; }
[data-theme="dark"] #bottomnav { background: rgba(10,10,26,.97); border-color: rgba(255,255,255,.06); }
[data-theme="dark"] .bnav-item { color: #8888aa; }
[data-theme="dark"] .auth-modal { background: #161630; }
[data-theme="dark"] .nav-top { background: rgba(10,10,26,.97); }
[data-theme="dark"] select { background: #161630; color: #e8e8f0; }

/* ============================================================
   DESKTOP BLOCKER
============================================================ */
#desktop-blocker {
  position: fixed; inset: 0; z-index: 99999;
  background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 50%, #0a0a1a 100%);
  display: none; align-items: center; justify-content: center;
  color: #fff; text-align: center; padding: 40px;
}
#desktop-blocker .db-content {
  max-width: 420px;
}
#desktop-blocker .db-icon { font-size: 4rem; margin-bottom: 20px; }
#desktop-blocker .db-title { font-family: var(--fh); font-size: 2rem; margin-bottom: 12px; }
#desktop-blocker .db-text { font-size: 1rem; opacity: .7; line-height: 1.6; margin-bottom: 24px; }
#desktop-blocker .db-badge {
  display: inline-block; background: linear-gradient(135deg, var(--coral), var(--orange));
  padding: 8px 20px; border-radius: 12px; font-weight: 700; font-size: .85rem;
}
@media (max-width: 1024px) { #desktop-blocker { display: none !important; } }
@media (min-width: 1025px) { #desktop-blocker { display: flex !important; } }
/* Override: se standalone (PWA), mostra sempre anche su desktop */
@media (display-mode: standalone) { #desktop-blocker { display: none !important; } }

/* ============================================================
   VERIFIED BADGE + TEACHER TAG
============================================================ */
.verified-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; background: #007AFF; border-radius: 50%;
  margin-left: 4px; vertical-align: middle; flex-shrink: 0;
}
.verified-badge::after { content: ''; display: block; width: 6px; height: 3px; border-left: 2px solid #fff; border-bottom: 2px solid #fff; transform: rotate(-45deg) translateY(-1px); }
.teacher-tag {
  background: linear-gradient(135deg, #9C7CFF, #6c63ff); color: #fff;
  border-radius: 8px; padding: 2px 8px; font-size: .65rem; font-weight: 800;
  margin-left: 4px; vertical-align: middle; letter-spacing: .5px;
}

/* ============================================================
   RINGTONE CALL OVERLAY (incoming call UI)  
============================================================ */
.incoming-call-overlay {
  position: fixed; inset: 0; z-index: 9900;
  background: linear-gradient(180deg, #1a1a3a, #0a0a1a);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: #fff; gap: 16px; animation: callFadeIn .3s ease;
}
@keyframes callFadeIn { from { opacity: 0; } to { opacity: 1; } }
.call-avatar-ring {
  width: 120px; height: 120px; border-radius: 50%;
  border: 3px solid rgba(52,199,89,.5);
  display: flex; align-items: center; justify-content: center;
  font-size: 3rem; overflow: hidden;
  animation: callPulse 2s ease-in-out infinite;
}
.call-avatar-ring img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
@keyframes callPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(52,199,89,.4); } 50% { box-shadow: 0 0 0 20px rgba(52,199,89,0); } }
.call-actions { display: flex; gap: 40px; margin-top: 30px; }
.call-btn-accept, .call-btn-reject {
  width: 64px; height: 64px; border-radius: 50%; border: none;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; cursor: pointer; transition: transform .15s;
}
.call-btn-accept { background: #34C759; color: #fff; }
.call-btn-reject { background: #FF3B30; color: #fff; }
.call-btn-accept:active, .call-btn-reject:active { transform: scale(.9); }
`;

// 2. Estrai JS (tutto tra <script> e </script> - l'ultimo blocco)
const jsMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
let js = jsMatches.length ? jsMatches[jsMatches.length - 1][1] : '';

// Aggiungi desktop blocker + dark mode + story duration fix al JS
const newFeatures = `
// ============================================================
//  v10 NEW FEATURES
// ============================================================

// ── Desktop Blocker ──
(function(){
  if(window.innerWidth > 1024 && !window.matchMedia('(display-mode: standalone)').matches) {
    document.getElementById('desktop-blocker').style.display = 'flex';
  }
})();

// ── Dark Mode Toggle ──
function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('gc_theme', newTheme);
  if(ME) POST('/api/users/me', { theme: newTheme }).catch(()=>{});
}
// Applica tema salvato all'avvio
(function(){
  const saved = localStorage.getItem('gc_theme');
  if(saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ── Incoming Call Full-Screen UI ──
function showIncomingCallUI(callId, fromName, fromAvatar, fromAvatarUrl, videoEnabled) {
  // Rimuovi UI precedente
  document.getElementById('incoming-call-ui')?.remove();
  
  // Push notification browser
  showPushNotif(fromName + ' ti sta chiamando', videoEnabled ? 'Videochiamata in arrivo' : 'Chiamata audio in arrivo');
  
  // Vibrazione
  try { navigator.vibrate([200,100,200,100,200]); } catch {}
  
  const overlay = document.createElement('div');
  overlay.id = 'incoming-call-ui';
  overlay.className = 'incoming-call-overlay';
  
  const avatarContent = fromAvatarUrl 
    ? '<img src="' + fromAvatarUrl + '" alt="">'
    : (fromAvatar || fromName?.charAt(0) || '?');
  
  overlay.innerHTML = 
    '<div class="call-avatar-ring">' + avatarContent + '</div>' +
    '<div style="font-family:var(--fh);font-size:1.5rem;font-weight:800">' + escHTML(fromName) + '</div>' +
    '<div style="font-size:.9rem;opacity:.6">' + (videoEnabled ? 'Videochiamata in arrivo...' : 'Chiamata in arrivo...') + '</div>' +
    '<div class="call-actions">' +
      '<button class="call-btn-reject" id="call-reject-btn" title="Rifiuta">&#x260E;</button>' +
      '<button class="call-btn-accept" id="call-accept-btn" title="Rispondi">&#x260E;</button>' +
    '</div>';
  
  document.body.appendChild(overlay);
  
  // Ringtone audio
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    function ring() {
      if (!document.getElementById('incoming-call-ui')) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 440;
      gain.gain.value = 0.15;
      osc.start(); osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => {
        if (!document.getElementById('incoming-call-ui')) return;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.frequency.value = 554;
        gain2.gain.value = 0.15;
        osc2.start(); osc2.stop(ctx.currentTime + 0.3);
      }, 350);
    }
    ring();
    const ringInterval = setInterval(() => {
      if (!document.getElementById('incoming-call-ui')) { clearInterval(ringInterval); return; }
      ring();
    }, 2000);
    overlay._ringInterval = ringInterval;
    overlay._audioCtx = ctx;
  } catch {}
  
  return { overlay, callId };
}

function dismissIncomingCallUI() {
  const ui = document.getElementById('incoming-call-ui');
  if (ui) {
    if (ui._ringInterval) clearInterval(ui._ringInterval);
    try { navigator.vibrate(0); } catch {}
    ui.remove();
  }
}
`;

js += newFeatures;

// 3. Crea HTML shell
let htmlBody = html.match(/<body[^>]*>([\s\S]*?)<script/i);
let bodyContent = htmlBody ? htmlBody[1] : '';

// Rimuovi il vecchio <style> dal body se inline
bodyContent = bodyContent.replace(/<style[\s\S]*?<\/style>/gi, '');

// Aggiungi desktop blocker div
const desktopBlocker = `
<div id="desktop-blocker">
  <div class="db-content">
    <div class="db-icon">&#x1F4F1;</div>
    <div class="db-title">GiadaCourses</div>
    <div class="db-text">Questa app e progettata per dispositivi mobili.<br>Per la migliore esperienza, apri GiadaCourses dal tuo smartphone.</div>
    <div class="db-badge">Modalita Desktop in costruzione</div>
  </div>
</div>
`;

// Costruisci il nuovo HTML
const newHTML = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#9C7CFF">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>GiadaCourses</title>
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="stylesheet" href="/css/main.css">
</head>
<body>
${desktopBlocker}
${bodyContent}
<script src="/js/app.js"><\/script>
</body>
</html>`;

// 4. Scrivi i file
const cssDir = path.join(publicDir, 'css');
const jsDir = path.join(publicDir, 'js');
if (!fs.existsSync(cssDir)) fs.mkdirSync(cssDir, { recursive: true });
if (!fs.existsSync(jsDir)) fs.mkdirSync(jsDir, { recursive: true });

fs.writeFileSync(path.join(cssDir, 'main.css'), css.trim());
fs.writeFileSync(path.join(jsDir, 'app.js'), js.trim());
fs.writeFileSync(path.join(publicDir, 'index.html'), newHTML.trim());

console.log('='.repeat(50));
console.log('  Migrazione completata!');
console.log('='.repeat(50));
console.log('  public/index.html  - HTML shell');
console.log('  public/css/main.css - ' + Math.round(css.length/1024) + 'KB CSS');
console.log('  public/js/app.js   - ' + Math.round(js.length/1024) + 'KB JS');
console.log('='.repeat(50));
console.log('  Nuove feature aggiunte:');
console.log('  - Dark mode (toggle + persistenza)');
console.log('  - Desktop blocker');
console.log('  - Incoming call full-screen UI con ringtone');
console.log('  - Verified badge + Teacher tag CSS');
console.log('='.repeat(50));
