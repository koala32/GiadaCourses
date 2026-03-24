#!/bin/bash
# ============================================================
#  GiadaCourses v8.0 — BACKUP DI EMERGENZA
#  Crea uno snapshot completo prima di ogni aggiornamento
#  Uso: sudo bash /opt/giadacourses/BACKUP.sh
# ============================================================

DEST_DIR="/opt/giadacourses"
BACKUP_ROOT="/opt/giadacourses-backups"
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
BACKUP_DIR="${BACKUP_ROOT}/backup_${TIMESTAMP}"
MAX_BACKUPS=5

echo ""
echo "============================================"
echo "  BACKUP DI EMERGENZA - GiadaCourses v8.0"
echo "  $(date +'%d/%m/%Y %H:%M:%S')"
echo "============================================"
echo ""

# 1. Crea cartella backups se non esiste
if [ ! -d "$BACKUP_ROOT" ]; then
    mkdir -p "$BACKUP_ROOT"
    echo "[OK] Cartella backups creata: $BACKUP_ROOT"
fi

# 2. Verifica che l'app esista
if [ ! -f "$DEST_DIR/server.js" ]; then
    echo "[ERRORE] server.js non trovato in $DEST_DIR"
    echo "[ERRORE] Nulla da backuppare. Uscita."
    exit 1
fi

# 3. Crea backup completo (incluso database e uploads)
echo "[1/5] Creazione backup completo..."
mkdir -p "$BACKUP_DIR"

# Copia tutto: codice + database + uploads
rsync -a --info=progress2 \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    "$DEST_DIR/" "$BACKUP_DIR/"

if [ $? -ne 0 ]; then
    echo "[ERRORE] rsync fallito!"
    exit 1
fi

echo "[OK] Backup creato: $BACKUP_DIR"

# 4. Verifica integrita del backup
echo "[2/5] Verifica integrita..."
CHECKS=0
FAILS=0

if [ -f "$BACKUP_DIR/server.js" ]; then
    echo "  [OK] server.js presente"
    ((CHECKS++))
else
    echo "  [FAIL] server.js MANCANTE"
    ((FAILS++))
fi

if [ -f "$BACKUP_DIR/index.html" ]; then
    if grep -q "</html>" "$BACKUP_DIR/index.html"; then
        echo "  [OK] index.html integro"
        ((CHECKS++))
    else
        echo "  [FAIL] index.html TRONCATO"
        ((FAILS++))
    fi
else
    echo "  [FAIL] index.html MANCANTE"
    ((FAILS++))
fi

if [ -f "$BACKUP_DIR/package.json" ]; then
    echo "  [OK] package.json presente"
    ((CHECKS++))
else
    echo "  [FAIL] package.json MANCANTE"
    ((FAILS++))
fi

if [ -d "$BACKUP_DIR/database" ]; then
    DB_COUNT=$(ls -1 "$BACKUP_DIR/database/"*.db 2>/dev/null | wc -l)
    echo "  [OK] Database: $DB_COUNT file .db"
    ((CHECKS++))
else
    echo "  [WARN] Cartella database non trovata (potrebbe essere primo avvio)"
fi

# 5. Calcola dimensione backup
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "[3/5] Dimensione backup: $BACKUP_SIZE"

# 6. Crea file di metadata
cat > "$BACKUP_DIR/.backup-info" << EOF
backup_date=$TIMESTAMP
backup_date_human=$(date +'%d/%m/%Y %H:%M:%S')
source_dir=$DEST_DIR
checks_passed=$CHECKS
checks_failed=$FAILS
size=$BACKUP_SIZE
version=$(grep '"version"' "$BACKUP_DIR/package.json" 2>/dev/null | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' || echo 'unknown')
EOF

echo "[4/5] Metadata salvata"

# 7. Pulizia vecchi backups (mantieni ultimi MAX_BACKUPS)
EXISTING=$(ls -dt "${BACKUP_ROOT}"/backup_* 2>/dev/null | tail -n +$((MAX_BACKUPS+1)))
if [ -n "$EXISTING" ]; then
    echo "[5/5] Pulizia vecchi backup..."
    echo "$EXISTING" | while read OLD; do
        rm -rf "$OLD"
        echo "  [DEL] $(basename $OLD)"
    done
else
    echo "[5/5] Nessun vecchio backup da pulire"
fi

echo ""
echo "============================================"
if [ $FAILS -eq 0 ]; then
    echo "  BACKUP COMPLETATO CON SUCCESSO"
else
    echo "  BACKUP CON $FAILS ERRORI - VERIFICA!"
fi
echo "  Path: $BACKUP_DIR"
echo "  Dimensione: $BACKUP_SIZE"
echo "============================================"
echo ""
echo "Per ROLLBACK in caso di emergenza:"
echo "  sudo bash /opt/giadacourses/ROLLBACK.sh"
echo ""
