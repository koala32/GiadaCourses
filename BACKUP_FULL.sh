#!/bin/bash
# =============================================================
#  GiadaCourses — BACKUP_FULL.sh
#  Backup COMPLETO: database + uploads → VPS locale + GitHub
#  Uso: sudo bash BACKUP_FULL.sh
# =============================================================
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${CYAN}[..]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

[ "$EUID" -ne 0 ] && err "Esegui come root: sudo bash BACKUP_FULL.sh"

APP_DIR="/opt/GiadaCoursess"
BCK_DIR="/BCKGIADA"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BCK_CURRENT="$BCK_DIR/backup_$TIMESTAMP"
REPO_DIR="$APP_DIR"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  GiadaCourses — Backup Completo              ║${NC}"
echo -e "${BOLD}${CYAN}║  VPS (/BCKGIADA) + GitHub                    ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── STEP 1: Crea directory backup ──
info "1/5 Creazione directory backup..."
mkdir -p "$BCK_DIR"
mkdir -p "$BCK_CURRENT/database"
mkdir -p "$BCK_CURRENT/uploads"
log "Directory: $BCK_CURRENT"

# ── STEP 2: Copia database ──
info "2/5 Backup database (tutti i .db)..."
if [ -d "$APP_DIR/database" ]; then
  cp -r "$APP_DIR/database/"*.db "$BCK_CURRENT/database/" 2>/dev/null || true
  DB_COUNT=$(ls "$BCK_CURRENT/database/"*.db 2>/dev/null | wc -l)
  DB_SIZE=$(du -sh "$BCK_CURRENT/database" | cut -f1)
  log "Database: $DB_COUNT file ($DB_SIZE)"
else
  warn "Cartella database non trovata in $APP_DIR/database"
fi

# ── STEP 3: Copia uploads (foto profilo, media, PDF) ──
info "3/5 Backup uploads (media utenti)..."
if [ -d "$APP_DIR/uploads" ]; then
  cp -r "$APP_DIR/uploads/"* "$BCK_CURRENT/uploads/" 2>/dev/null || true
  UPLOAD_COUNT=$(find "$BCK_CURRENT/uploads" -type f 2>/dev/null | wc -l)
  UPLOAD_SIZE=$(du -sh "$BCK_CURRENT/uploads" | cut -f1)
  log "Uploads: $UPLOAD_COUNT file ($UPLOAD_SIZE)"
else
  warn "Cartella uploads non trovata"
fi

# ── STEP 4: Crea archivio compresso ──
info "4/5 Compressione backup..."
ARCHIVE="$BCK_DIR/giadacourses_backup_$TIMESTAMP.tar.gz"
cd "$BCK_CURRENT"
tar -czf "$ARCHIVE" . 2>/dev/null
ARCHIVE_SIZE=$(du -sh "$ARCHIVE" | cut -f1)
log "Archivio: $ARCHIVE ($ARCHIVE_SIZE)"

# ── STEP 5: Push backup su GitHub ──
info "5/5 Push backup su GitHub..."
cd "$REPO_DIR"

# Crea cartella backups nel repo se non esiste
mkdir -p "$REPO_DIR/backups"

# Copia solo il database nel repo (uploads troppo pesanti per GitHub)
cp -r "$BCK_CURRENT/database" "$REPO_DIR/backups/database_$TIMESTAMP" 2>/dev/null || true

# Aggiungi a .gitignore per non pushare uploads e node_modules
if [ ! -f "$REPO_DIR/.gitignore" ] || ! grep -q "uploads/" "$REPO_DIR/.gitignore"; then
  cat >> "$REPO_DIR/.gitignore" << 'GITEOF'
node_modules/
uploads/
database/
*.tar.gz
GITEOF
fi

# Git commit & push
if command -v git &>/dev/null && [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  git add backups/ .gitignore 2>/dev/null || true
  git commit -m "Backup database $TIMESTAMP" 2>/dev/null || warn "Nessuna modifica da committare"
  git push origin main 2>/dev/null && log "Push GitHub completato!" || warn "Push GitHub fallito (controlla credenziali)"
else
  warn "Git non configurato in $REPO_DIR — skip push GitHub"
  echo -e "  ${YELLOW}Per abilitare: cd $REPO_DIR && git init && git remote add origin https://github.com/koala32/GiadaCourses.git${NC}"
fi

# ── Pulizia vecchi backup (mantieni ultimi 10) ──
info "Pulizia vecchi backup (mantiene ultimi 10)..."
cd "$BCK_DIR"
ls -dt backup_* 2>/dev/null | tail -n +11 | xargs rm -rf 2>/dev/null || true
ls -t *.tar.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

# ── Riepilogo ──
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✅ BACKUP COMPLETATO                        ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  📁 VPS:    $BCK_CURRENT${NC}"
echo -e "${GREEN}║  📦 Archiv: $ARCHIVE${NC}"
echo -e "${GREEN}║  🗄️  DB:     $DB_COUNT file ${NC}"
echo -e "${GREEN}║  📸 Upload: $UPLOAD_COUNT file ${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Per scaricare il backup sul tuo PC:"
echo -e "  ${CYAN}scp root@45.38.190.133:$ARCHIVE ./${NC}"
echo ""
