#!/bin/bash
# ============================================================
#  GiadaCourses v8.0 — ROLLBACK DI EMERGENZA
#  Ripristina l'ultimo backup stabile
#  Uso: sudo bash /opt/giadacourses/ROLLBACK.sh
# ============================================================

DEST_DIR="/opt/giadacourses"
BACKUP_ROOT="/opt/giadacourses-backups"
SERVICE_NAME="giadacourses"

echo ""
echo "============================================"
echo "  ROLLBACK DI EMERGENZA - GiadaCourses"
echo "  $(date +'%d/%m/%Y %H:%M:%S')"
echo "============================================"
echo ""

# 1. Trova backups disponibili
BACKUPS=($(ls -dt "${BACKUP_ROOT}"/backup_* 2>/dev/null))

if [ ${#BACKUPS[@]} -eq 0 ]; then
    echo "[ERRORE] Nessun backup trovato in $BACKUP_ROOT"
    echo "[ERRORE] Impossibile fare rollback."
    exit 1
fi

echo "Backup disponibili:"
echo ""
for i in "${!BACKUPS[@]}"; do
    BK="${BACKUPS[$i]}"
    INFO_FILE="$BK/.backup-info"
    if [ -f "$INFO_FILE" ]; then
        DATE=$(grep 'backup_date_human' "$INFO_FILE" | cut -d= -f2)
        VER=$(grep 'version' "$INFO_FILE" | cut -d= -f2)
        SIZE=$(grep 'size' "$INFO_FILE" | cut -d= -f2)
        echo "  [$i] $(basename $BK) - $DATE - v$VER ($SIZE)"
    else
        echo "  [$i] $(basename $BK)"
    fi
done

echo ""

# 2. Seleziona backup (default: il piu recente)
if [ -n "$1" ]; then
    SEL=$1
else
    echo "Quale backup vuoi ripristinare? [0 = piu recente]"
    read -r SEL
    SEL=${SEL:-0}
fi

if [ "$SEL" -ge "${#BACKUPS[@]}" ] 2>/dev/null; then
    echo "[ERRORE] Indice non valido"
    exit 1
fi

SELECTED="${BACKUPS[$SEL]}"
echo ""
echo "Selezionato: $(basename $SELECTED)"
echo ""

# 3. Conferma
echo "ATTENZIONE: Questa operazione sostituira TUTTO il codice attuale"
echo "            con il backup selezionato."
echo "            Il database e gli uploads saranno RIPRISTINATI dal backup."
echo ""
echo "Continuare? (s/N)"
read -r CONFIRM
if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ] && [ "$CONFIRM" != "si" ]; then
    echo "Rollback annullato."
    exit 0
fi

# 4. Stop servizio
echo ""
echo "[1/4] Arresto servizio..."
sudo systemctl stop $SERVICE_NAME 2>/dev/null
sleep 2

# 5. Backup della versione corrente (pre-rollback)
PRE_ROLLBACK="${BACKUP_ROOT}/pre-rollback_$(date +'%Y%m%d_%H%M%S')"
echo "[2/4] Salvataggio stato corrente in: $(basename $PRE_ROLLBACK)"
rsync -a --exclude='node_modules' --exclude='.git' "$DEST_DIR/" "$PRE_ROLLBACK/"

# 6. Ripristina dal backup
echo "[3/4] Ripristino da backup..."
rsync -av --delete \
    --exclude='node_modules' \
    --exclude='.git' \
    "$SELECTED/" "$DEST_DIR/"

if [ $? -ne 0 ]; then
    echo "[ERRORE] rsync fallito! Provo a riavviare con i file attuali..."
    sudo systemctl start $SERVICE_NAME
    exit 1
fi

# 7. Fix permessi e riavvio
echo "[4/4] Fix permessi e riavvio..."
sudo chown -R giadacourses:giadacourses "$DEST_DIR"
sudo chmod -R 755 "$DEST_DIR"
cd "$DEST_DIR" && sudo -u giadacourses npm install --production 2>/dev/null
sudo systemctl start $SERVICE_NAME
sleep 2

# 8. Verifica
STATUS=$(sudo systemctl is-active $SERVICE_NAME 2>/dev/null)
CURL_CHECK=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 2>/dev/null)

echo ""
echo "============================================"
if [ "$STATUS" = "active" ] && [ "$CURL_CHECK" = "200" ]; then
    echo "  ROLLBACK COMPLETATO CON SUCCESSO!"
    echo "  Servizio: ATTIVO"
    echo "  HTTP: 200 OK"
else
    echo "  ROLLBACK COMPLETATO MA VERIFICARE:"
    echo "  Servizio: $STATUS"
    echo "  HTTP: $CURL_CHECK"
fi
echo "  Backup pre-rollback: $(basename $PRE_ROLLBACK)"
echo "============================================"
echo ""
