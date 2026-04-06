#!/bin/bash
# =============================================================
#  GiadaCourses — UPDATE.sh
#  Aggiornamento completo: Backup → Pull GitHub → Deploy
#  Uso: sudo bash UPDATE.sh
# =============================================================
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${CYAN}[..]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

[ "$EUID" -ne 0 ] && err "Esegui come root: sudo bash UPDATE.sh"

APP_DIR="/opt/GiadaCoursess"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  GiadaCourses — Aggiornamento Completo        ║${NC}"
echo -e "${BOLD}${CYAN}║  Backup → Pull → Deploy (zero downtime)       ║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ── STEP 1: Backup completo pre-aggiornamento ──
info "1/4 Backup completo pre-aggiornamento..."
if [ -f "$APP_DIR/BACKUP_FULL.sh" ]; then
  bash "$APP_DIR/BACKUP_FULL.sh" 2>&1 | tail -15
  log "Backup completato"
else
  warn "BACKUP_FULL.sh non trovato — skip backup"
fi

# ── STEP 2: Pull da GitHub ──
info "2/4 Pull aggiornamenti da GitHub..."
cd "$APP_DIR"
if [ -d ".git" ]; then
  # Salva file locali modificati
  git stash 2>/dev/null || true
  
  # Pull
  git fetch origin main 2>/dev/null
  git reset --hard origin/main 2>/dev/null
  
  # Ripristina file che NON vanno sovrascritti
  git stash pop 2>/dev/null || true
  
  log "Pull completato"
else
  warn "Git non inizializzato — tentativo con clone temporaneo..."
  TMPDIR=$(mktemp -d)
  git clone --depth 1 https://github.com/koala32/GiadaCourses.git "$TMPDIR" 2>/dev/null || err "Clone fallito"
  
  # Copia solo i file di codice (NON database, uploads, node_modules)
  for f in server.js package.json package-lock.json migrate.js; do
    [ -f "$TMPDIR/$f" ] && cp "$TMPDIR/$f" "$APP_DIR/$f"
  done
  for d in public routes lib middleware; do
    [ -d "$TMPDIR/$d" ] && cp -r "$TMPDIR/$d" "$APP_DIR/"
  done
  for s in DEPLOY.sh BACKUP.sh BACKUP_FULL.sh UPDATE.sh ROLLBACK.sh; do
    [ -f "$TMPDIR/$s" ] && cp "$TMPDIR/$s" "$APP_DIR/$s"
  done
  
  rm -rf "$TMPDIR"
  log "Aggiornamento file completato"
fi

# ── STEP 3: Installa dipendenze se necessario ──
info "3/4 Verifica dipendenze npm..."
cd "$APP_DIR"
if [ -f "package.json" ]; then
  npm install --production --no-audit --no-fund 2>/dev/null
  log "Dipendenze OK"
fi

# ── STEP 4: Restart servizio ──
info "4/4 Riavvio servizio..."
if systemctl is-active --quiet giadacourses 2>/dev/null; then
  systemctl restart giadacourses
  sleep 2
  if systemctl is-active --quiet giadacourses; then
    log "Servizio riavviato con successo!"
  else
    warn "Il servizio non si è avviato — controlla: journalctl -u giadacourses -f"
  fi
elif pm2 pid giadacourses &>/dev/null; then
  pm2 restart giadacourses 2>/dev/null
  log "PM2 restart completato"
else
  warn "Nessun process manager trovato — riavvia manualmente: node $APP_DIR/server.js"
fi

echo ""
echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✅ AGGIORNAMENTO COMPLETATO!                 ║${NC}"
echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Verifica: ${CYAN}curl -s http://localhost:3000/api/ping${NC}"
echo ""
