// ═══════════════════════════════════════════════════════════
//  HELPY Guard — Anti-DevTools & Security Layer
// ═══════════════════════════════════════════════════════════
(function() {
  'use strict';

  // 1. Blocca tasto destro
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
  });

  // 2. Blocca shortcut DevTools
  document.addEventListener('keydown', function(e) {
    // F12
    if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); return false; }
    // Ctrl+Shift+I (Ispeziona)
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73)) { e.preventDefault(); return false; }
    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74)) { e.preventDefault(); return false; }
    // Ctrl+Shift+C (Selector)
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67)) { e.preventDefault(); return false; }
    // Ctrl+U (View Source)
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) { e.preventDefault(); return false; }
    // Ctrl+Shift+K (Firefox console)
    if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) { e.preventDefault(); return false; }
    // Cmd+Option+I (Mac)
    if (e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); return false; }
    // Cmd+Option+J (Mac)
    if (e.metaKey && e.altKey && (e.key === 'J' || e.key === 'j')) { e.preventDefault(); return false; }
    // Cmd+Option+U (Mac)
    if (e.metaKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); return false; }
  });

  // 3. Blocca drag & drop di immagini
  document.addEventListener('dragstart', function(e) { e.preventDefault(); });

  // 4. Blocca selezione testo su elementi sensibili
  document.addEventListener('selectstart', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return true;
    // Permetti selezione nei contenuti delle lezioni
    if (e.target.closest('.lesson-content')) return true;
    if (e.target.closest('.chat-body')) return true;
  });

  // 5. Detect DevTools via debugger timing
  var devtoolsOpen = false;
  function checkDevTools() {
    var threshold = 160;
    var widthDiff = window.outerWidth - window.innerWidth > threshold;
    var heightDiff = window.outerHeight - window.innerHeight > threshold;
    if (widthDiff || heightDiff) {
      if (!devtoolsOpen) {
        devtoolsOpen = true;
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;text-align:center;padding:40px;font-family:Inter,sans-serif;"><div><h1 style="font-size:2rem;color:#0f172a;margin-bottom:12px;">⚠️ Accesso non consentito</h1><p style="color:#64748b;font-size:1.1rem;">Gli strumenti per sviluppatori non sono consentiti su questa piattaforma.<br>Chiudi gli strumenti e ricarica la pagina.</p><br><a href="/" style="color:#2563eb;font-weight:600;">Torna alla home</a></div></div>';
      }
    } else {
      devtoolsOpen = false;
    }
  }
  setInterval(checkDevTools, 1000);

  // 6. Console cleaner & warning
  function clearConsole() {
    try {
      console.clear();
      console.log('%c⚠️ ATTENZIONE', 'color:red;font-size:2rem;font-weight:bold;');
      console.log('%cQuesta console è riservata agli sviluppatori.\nNon incollare qui codice fornito da sconosciuti: potrebbe rubare i tuoi dati.', 'color:#333;font-size:1rem;');
    } catch(e) {}
  }
  clearConsole();
  setInterval(clearConsole, 3000);

  // 7. Anti-debugger trap
  (function antiDebug() {
    try {
      (function() { return false; }
      ['constructor']('debugger')
      ['call']());
    } catch(e) {}
    setTimeout(antiDebug, 2000);
  })();

})();
