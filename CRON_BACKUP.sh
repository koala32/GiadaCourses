#!/bin/bash
# GiadaCourses — Backup automatico giornaliero
# Installa con: sudo cp /opt/GiadaCoursess/CRON_BACKUP.sh /etc/cron.daily/giadacourses-backup && sudo chmod +x /etc/cron.daily/giadacourses-backup

APP_DIR="/opt/GiadaCoursess"
BACKUP_DIR="/opt/GiadaCoursess-backups/daily"
MAX_BACKUPS=7  # Mantieni solo gli ultimi 7 giorni

mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d_%H%M)

# Backup database
if [ -d "$APP_DIR/database" ]; then
  tar -czf "$BACKUP_DIR/db_${DATE}.tar.gz" -C "$APP_DIR" database/ 2>/dev/null
fi

# Backup .env
if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$BACKUP_DIR/env_${DATE}.bak" 2>/dev/null
fi

# Pulizia vecchi backup (mantieni solo ultimi MAX_BACKUPS)
cd "$BACKUP_DIR" && ls -1t db_*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS+1)) | xargs -r rm -f
cd "$BACKUP_DIR" && ls -1t env_*.bak 2>/dev/null | tail -n +$((MAX_BACKUPS+1)) | xargs -r rm -f

echo "[$(date)] Backup giornaliero completato: $BACKUP_DIR/db_${DATE}.tar.gz"
