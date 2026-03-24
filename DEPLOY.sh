#!/bin/bash
# =============================================================
#  GiadaCourses v7.0 - DEPLOY.sh
#  Deploy PULITO da GitHub con preservazione dati
#  Uso: sudo bash DEPLOY.sh
# =============================================================
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${CYAN}[..]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

[ "$EUID" -ne 0 ] && err "Esegui come root: sudo bash DEPLOY.sh"

APP_DIR="/opt/giadacourses"
BACKUP_DIR="/opt/giadacourses-backups"
DOMAIN="giadacourses.duckdns.org"
PORT="3000"
TURN_SECRET="giadacourses_turn_secret_2024"
SERVER_IP=$(curl -s --max-time 8 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPO_URL="https://github.com/koala32/GiadaCourses.git"
REPO_BRANCH="main"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  GiadaCourses v7.0 - Deploy Completo da GitHub  ║${NC}"
echo -e "${BOLD}${CYAN}║  Server: $SERVER_IP                       ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── STEP 1: Prerequisiti ──────────────────────────────────
info "1/10 Verifica prerequisiti..."
for cmd in node npm git nginx; do
  if ! command -v $cmd &>/dev/null; then
    warn "$cmd non trovato, installo..."
    if [ "$cmd" = "node" ] || [ "$cmd" = "npm" ]; then
      if ! command -v node &>/dev/null || [[ $(node -v 2>/dev/null | cut -d. -f1 | tr -d v) -lt 20 ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -q nodejs > /dev/null 2>&1
      fi
    else
      apt-get install -y -q $cmd > /dev/null 2>&1
    fi
  fi
done
log "Prerequisiti OK (Node $(node -v), npm $(npm -v))"

# ── STEP 2: Crea utente di sistema ──────────────────────
info "2/10 Utente di sistema..."
id giadacourses &>/dev/null || useradd -r -s /bin/false giadacourses 2>/dev/null || true
usermod -aG giadacourses www-data 2>/dev/null || true
log "Utente giadacourses OK"

# ── STEP 3: Backup completo ──────────────────────────────
info "3/10 Backup completo..."
mkdir -p "$BACKUP_DIR"
if [ -d "$APP_DIR" ]; then
  # Backup TUTTO: database, uploads, config
  tar -czf "$BACKUP_DIR/gc_full_${TIMESTAMP}.tar.gz" \
    -C "$APP_DIR" . 2>/dev/null && \
    log "Backup completo: $BACKUP_DIR/gc_full_${TIMESTAMP}.tar.gz" || \
    warn "Backup parziale (directory potrebbe essere vuota)"
  
  # Backup separato per uploads e database (sicurezza extra)
  if [ -d "$APP_DIR/uploads" ] && [ "$(ls -A $APP_DIR/uploads 2>/dev/null)" ]; then
    cp -a "$APP_DIR/uploads" "$BACKUP_DIR/uploads_${TIMESTAMP}" 2>/dev/null || true
    log "Backup uploads: $(find $APP_DIR/uploads -type f 2>/dev/null | wc -l) file preservati"
  fi
  if [ -d "$APP_DIR/database" ]; then
    cp -a "$APP_DIR/database" "$BACKUP_DIR/database_${TIMESTAMP}" 2>/dev/null || true
    log "Backup database separato"
  fi
else
  warn "Nessuna installazione precedente trovata"
fi

# ── STEP 4: Stop servizio ──────────────────────────────
info "4/10 Stop servizio..."
systemctl stop giadacourses 2>/dev/null && log "Servizio fermato" || warn "Servizio non attivo"
sleep 1

# ── STEP 5: Clone/Pull da GitHub ──────────────────────
info "5/10 Scarico codice da GitHub..."
TEMP_DIR=$(mktemp -d)
if git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null; then
  log "Repository clonato con successo"
else
  err "Clone fallito! Verifica che il repo $REPO_URL sia accessibile"
fi

# ── STEP 6: Deploy pulito (preserva dati) ──────────────
info "6/10 Deploy pulito con preservazione dati..."
mkdir -p "$APP_DIR"

# Salva temporaneamente uploads e database
SAVE_DIR=$(mktemp -d)
if [ -d "$APP_DIR/uploads" ]; then
  mv "$APP_DIR/uploads" "$SAVE_DIR/uploads" 2>/dev/null || true
fi
if [ -d "$APP_DIR/database" ]; then
  mv "$APP_DIR/database" "$SAVE_DIR/database" 2>/dev/null || true
fi

# RIMUOVI tutti i vecchi file di codice (non dati)
find "$APP_DIR" -maxdepth 1 -type f -delete 2>/dev/null || true
rm -rf "$APP_DIR/node_modules" "$APP_DIR/icons" 2>/dev/null || true

# Copia nuovi file dal repo
cp "$TEMP_DIR/repo/server.js" "$APP_DIR/"
cp "$TEMP_DIR/repo/index.html" "$APP_DIR/"
cp "$TEMP_DIR/repo/package.json" "$APP_DIR/"
cp "$TEMP_DIR/repo/manifest.json" "$APP_DIR/"
cp "$TEMP_DIR/repo/sw.js" "$APP_DIR/"
cp "$TEMP_DIR/repo/DEPLOY.sh" "$APP_DIR/" 2>/dev/null || true

# Copia icone
mkdir -p "$APP_DIR/icons"
cp -r "$TEMP_DIR/repo/icons/"* "$APP_DIR/icons/" 2>/dev/null || true

log "File di codice aggiornati"

# Ripristina uploads e database
mkdir -p "$APP_DIR/uploads" "$APP_DIR/database"
if [ -d "$SAVE_DIR/uploads" ]; then
  mv "$SAVE_DIR/uploads/"* "$APP_DIR/uploads/" 2>/dev/null || true
  log "Uploads ripristinati: $(find $APP_DIR/uploads -type f 2>/dev/null | wc -l) file"
fi
if [ -d "$SAVE_DIR/database" ]; then
  mv "$SAVE_DIR/database/"* "$APP_DIR/database/" 2>/dev/null || true
  log "Database ripristinato"
fi

# Cleanup
rm -rf "$TEMP_DIR" "$SAVE_DIR"
log "Deploy pulito completato"

# ── STEP 7: npm install ──────────────────────────────────
info "7/10 Installo dipendenze..."
cd "$APP_DIR"
npm install --production 2>&1 | tail -3
log "Dipendenze installate"

# ── STEP 8: Permessi ──────────────────────────────────────
info "8/10 Fix permessi..."
chown -R giadacourses:giadacourses "$APP_DIR"
chmod 755 "$APP_DIR"
chmod 755 "$APP_DIR/uploads"
chmod 750 "$APP_DIR/database"
find "$APP_DIR/uploads" -type f -exec chmod 644 {} \; 2>/dev/null || true
# Assicura che www-data possa leggere uploads (Nginx serve direttamente)
chmod o+rx "$APP_DIR"
chmod o+rx "$APP_DIR/uploads"
log "Permessi OK"

# ── STEP 9: Systemd service ──────────────────────────────
info "9/10 Configurazione servizio..."
cat > /etc/systemd/system/giadacourses.service << SVCEOF
[Unit]
Description=GiadaCourses v7.0 - Social English Learning Platform
After=network.target

[Service]
Type=simple
User=giadacourses
Group=giadacourses
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=TURN_SECRET=$TURN_SECRET
Environment=SERVER_IP=$SERVER_IP
StandardOutput=journal
StandardError=journal
SyslogIdentifier=giadacourses
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$APP_DIR/database $APP_DIR/uploads
ProtectHome=yes
# Limiti risorse
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
SVCEOF
systemctl daemon-reload
log "Servizio systemd configurato"

# ── STEP 10: Nginx (completa con Socket.IO) ──────────────
info "10/10 Configurazione Nginx..."

# ── Controlla se Certbot ha già configurato SSL ──
NGINX_CONF="/etc/nginx/sites-available/giadacourses"
HAS_SSL=false
if [ -f "$NGINX_CONF" ] && grep -q 'ssl_certificate' "$NGINX_CONF" 2>/dev/null; then
  HAS_SSL=true
  log "SSL esistente rilevato — verrà preservato"
  # Backup config SSL attuale
  cp "$NGINX_CONF" "${NGINX_CONF}.ssl_backup" 2>/dev/null || true
fi

# Scrivi config base (solo HTTP — Certbot aggiungerà SSL dopo)
cat > /etc/nginx/sites-available/giadacourses << 'NGINXEOF'
# GiadaCourses v7.0 Nginx Configuration
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=upload:10m rate=10r/m;

map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    listen [::]:80;
    server_name giadacourses.duckdns.org;
    client_max_body_size 200M;

    # ACME challenge for SSL
    location /.well-known/acme-challenge/ { root /var/www/html; }

    # Socket.IO WebSocket — DEVE ESSERE PRIMA di location /
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }

    # Uploads serviti DIRETTAMENTE da Nginx (più veloce)
    location /uploads/ {
        alias /opt/giadacourses/uploads/;
        add_header Cache-Control "public, max-age=86400";
        add_header Accept-Ranges bytes;
        add_header Access-Control-Allow-Origin *;
        try_files $uri =404;
    }

    # SSE Real-time (no buffering)
    location /api/events {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        add_header X-Accel-Buffering no;
    }

    # SSE Live stream
    location ~ ^/api/live/watch/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        add_header X-Accel-Buffering no;
    }

    # Upload media (rate limiting separato)
    location ~ ^/api/(media/upload|stories|users/me/avatar|bug-report) {
        limit_req zone=upload burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 200M;
    }

    # API generiche
    location /api/ {
        limit_req zone=api burst=60 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Service Worker (no cache)
    location = /sw.js {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # SPA fallback
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # NO WebSocket upgrade qui — Socket.IO ha il suo blocco sopra
    }
}
NGINXEOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/giadacourses /etc/nginx/sites-enabled/giadacourses

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "Nginx configurato e ricaricato"
else
  warn "Errore config Nginx! Tentativo di ripristino..."
  nginx -t 2>&1
fi

# ── AUTO-RIPRISTINO SSL: se SSL era presente prima, ri-applica Certbot ──
if [ "$HAS_SSL" = true ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  info "Ri-applico certificato SSL con Certbot..."
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --email "admin@giadacourses.it" --no-eff-email 2>&1 | grep -E "Congratulations|deployed|error|certificate|redirect" || true
  systemctl reload nginx 2>/dev/null || true
  log "SSL ri-applicato automaticamente"
fi

# ── Avvio servizio ──────────────────────────────────
info "Avvio servizio..."
systemctl start giadacourses
sleep 3

if systemctl is-active --quiet giadacourses; then
  log "Servizio avviato con successo!"
else
  err "Errore avvio servizio! Controlla i log:"
  journalctl -u giadacourses -n 30 --no-pager
  exit 1
fi

# ── SSL (se non già configurato) ──────────────────────
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  info "Configurazione SSL..."
  DNS_IP=$(getent hosts $DOMAIN 2>/dev/null | awk '{print $1}' | head -1)
  if [ "$DNS_IP" = "$SERVER_IP" ] && [ -n "$DNS_IP" ]; then
    certbot --nginx -d "$DOMAIN" \
      --non-interactive --agree-tos --email "admin@giadacourses.it" \
      --redirect --no-eff-email 2>&1 | grep -E "Congratulations|error|certificate" || true
    log "SSL configurato"
  else
    warn "DNS non propagato (atteso: $SERVER_IP, trovato: ${DNS_IP:-nessuno})"
    warn "Quando pronto: sudo certbot --nginx -d $DOMAIN --agree-tos --email admin@giadacourses.it --redirect"
  fi
else
  log "SSL già configurato"
fi

# ── Verifica ──────────────────────────────────────────
sleep 1
VERSION=$(curl -s http://127.0.0.1:$PORT/api/ping 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
UPLOAD_COUNT=$(find "$APP_DIR/uploads" -type f 2>/dev/null | wc -l)
DB_SIZE=$(du -sh "$APP_DIR/database" 2>/dev/null | awk '{print $1}')

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      DEPLOY v7.0 COMPLETATO!                    ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Versione:     ${CYAN}${VERSION:-in avvio...}${NC}"
echo -e "  Socket.IO:    ${CYAN}Attivo (Nginx WebSocket proxy)${NC}"
echo -e "  Uploads:      ${CYAN}$UPLOAD_COUNT file preservati${NC}"
echo -e "  Database:     ${CYAN}${DB_SIZE:-vuoto}${NC}"
echo -e "  Server IP:    ${CYAN}$SERVER_IP${NC}"
echo ""
echo -e "  ${BOLD}Comandi utili:${NC}"
echo -e "  ${CYAN}journalctl -u giadacourses -f${NC}    # log in tempo reale"
echo -e "  ${CYAN}systemctl restart giadacourses${NC}   # riavvia"
echo -e "  ${CYAN}sudo bash DEPLOY.sh${NC}              # ri-deploy da GitHub"
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
