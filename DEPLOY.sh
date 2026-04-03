#!/bin/bash
# =============================================================
#  Helpy v1.0 - DEPLOY.sh (Full-Stack)
#  Node.js + Nginx reverse proxy su porta 4000
#  ⚠️  NON tocca GiadaCourses (porta 3000)
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

# ── CONFIGURAZIONE ───────────────────────────────────────────
APP_DIR="/opt/helpy"
BACKUP_DIR="/opt/helpy-backups"
DOMAIN="helpy.duckdns.org"
PORT="4000"
SERVER_IP=$(curl -s --max-time 8 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPO_URL="https://github.com/koala32/helpy-site.git"   # ← CAMBIA con il tuo repo
REPO_BRANCH="main"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║    Helpy v1.0 - Deploy Full-Stack da GitHub     ║${NC}"
echo -e "${BOLD}${CYAN}║    Porta: $PORT | GiadaCourses: INTATTO          ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── STEP 1: Prerequisiti ─────────────────────────────────────
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
if ! command -v certbot &>/dev/null; then
  apt-get install -y -q certbot python3-certbot-nginx > /dev/null 2>&1
fi
log "Prerequisiti OK (Node $(node -v))"

# ── STEP 2: Verifica GiadaCourses ────────────────────────────
info "2/10 Verifica GiadaCourses..."
if systemctl is-active --quiet giadacourses 2>/dev/null; then
  log "GiadaCourses ATTIVO su porta 3000 — non verrà toccato ✓"
else
  warn "GiadaCourses non attivo (non è un problema per Helpy)"
fi

# ── STEP 3: Utente di sistema ────────────────────────────────
info "3/10 Utente di sistema..."
id helpy &>/dev/null || useradd -r -s /bin/false helpy 2>/dev/null || true
log "Utente helpy OK"

# ── STEP 4: Backup ───────────────────────────────────────────
info "4/10 Backup..."
mkdir -p "$BACKUP_DIR"
if [ -d "$APP_DIR" ]; then
  # Preserva database!
  if [ -d "$APP_DIR/database" ]; then
    cp -a "$APP_DIR/database" "$BACKUP_DIR/database_${TIMESTAMP}" 2>/dev/null || true
    log "Backup database separato"
  fi
  tar -czf "$BACKUP_DIR/helpy_${TIMESTAMP}.tar.gz" -C "$APP_DIR" . 2>/dev/null || true
  log "Backup completo"
else
  warn "Primo deploy — nessun backup necessario"
fi
ls -t "$BACKUP_DIR"/helpy_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f

# ── STEP 5: Stop servizio ────────────────────────────────────
info "5/10 Stop servizio..."
systemctl stop helpy 2>/dev/null && log "Servizio Helpy fermato" || warn "Servizio non attivo"
sleep 1

# ── STEP 6: Clone da GitHub ──────────────────────────────────
info "6/10 Scarico codice da GitHub..."
TEMP_DIR=$(mktemp -d)
if git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null; then
  log "Repository clonato"
else
  rm -rf "$TEMP_DIR"
  err "Clone fallito! Verifica $REPO_URL"
fi

# ── STEP 7: Deploy pulito (preserva database) ────────────────
info "7/10 Deploy file..."
mkdir -p "$APP_DIR"

# Salva database
SAVE_DIR=$(mktemp -d)
[ -d "$APP_DIR/database" ] && mv "$APP_DIR/database" "$SAVE_DIR/database" 2>/dev/null || true
[ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" "$SAVE_DIR/.env" 2>/dev/null || true

# Pulizia e copia
rm -rf "$APP_DIR/node_modules" "$APP_DIR/routes" "$APP_DIR/middleware" "$APP_DIR/public" 2>/dev/null || true
find "$APP_DIR" -maxdepth 1 -type f -delete 2>/dev/null || true

cp "$TEMP_DIR/repo/server.js" "$APP_DIR/"
cp "$TEMP_DIR/repo/package.json" "$APP_DIR/"
cp -r "$TEMP_DIR/repo/routes" "$APP_DIR/" 2>/dev/null || true
cp -r "$TEMP_DIR/repo/middleware" "$APP_DIR/" 2>/dev/null || true
cp -r "$TEMP_DIR/repo/public" "$APP_DIR/" 2>/dev/null || true
cp -r "$TEMP_DIR/repo/database" "$APP_DIR/" 2>/dev/null || true
cp "$TEMP_DIR/repo/DEPLOY.sh" "$APP_DIR/" 2>/dev/null || true
cp "$TEMP_DIR/repo/.env.example" "$APP_DIR/" 2>/dev/null || true

# Ripristina database
mkdir -p "$APP_DIR/database"
if [ -d "$SAVE_DIR/database" ]; then
  mv "$SAVE_DIR/database/"* "$APP_DIR/database/" 2>/dev/null || true
  log "Database ripristinato"
fi
# Ripristina .env
if [ -f "$SAVE_DIR/.env" ]; then
  cp "$SAVE_DIR/.env" "$APP_DIR/.env"
  log ".env ripristinato"
elif [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env" 2>/dev/null || true
  # Genera JWT secret random
  JWT_RAND=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '=/+' | head -c 64)
  sed -i "s/cambia_questo_con_una_stringa_casuale_lunga_2026/$JWT_RAND/" "$APP_DIR/.env"
  log ".env creato con secret casuale"
fi

rm -rf "$TEMP_DIR" "$SAVE_DIR"
log "File deployati"

# ── STEP 8: npm install ──────────────────────────────────────
info "8/10 Installo dipendenze..."
cd "$APP_DIR"
npm install --production 2>&1 | tail -3
log "Dipendenze installate"

# ── STEP 9: Permessi e systemd ───────────────────────────────
info "9/10 Permessi e servizio..."
chown -R helpy:helpy "$APP_DIR"
chmod 755 "$APP_DIR"
chmod 750 "$APP_DIR/database"

cat > /etc/systemd/system/helpy.service << SVCEOF
[Unit]
Description=Helpy v1.0 — Assistenza informatica
After=network.target

[Service]
Type=simple
User=helpy
Group=helpy
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
EnvironmentFile=-$APP_DIR/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=helpy
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$APP_DIR/database
ProtectHome=yes
LimitNOFILE=65536
MemoryMax=256M

[Install]
WantedBy=multi-user.target
SVCEOF
systemctl daemon-reload
log "Servizio systemd configurato"

# ── STEP 10: Nginx ───────────────────────────────────────────
info "10/10 Configurazione Nginx..."

cat > /etc/nginx/sites-available/helpy << 'NGINXEOF'
# Helpy v1.0 Nginx — Reverse Proxy porta 4000
server {
    listen 80;
    listen [::]:80;
    server_name helpy.duckdns.org;
    client_max_body_size 10M;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/helpy /etc/nginx/sites-enabled/helpy

# Verifica GiadaCourses nginx intatto
if [ -f "/etc/nginx/sites-available/giadacourses" ]; then
  ln -sf /etc/nginx/sites-available/giadacourses /etc/nginx/sites-enabled/giadacourses 2>/dev/null || true
  log "GiadaCourses Nginx config intatta ✓"
fi

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "Nginx configurato"
else
  warn "Errore Nginx:"
  nginx -t 2>&1
fi

# ── Avvio servizio ────────────────────────────────────────────
info "Avvio servizio..."
systemctl enable helpy 2>/dev/null || true
systemctl start helpy
sleep 3

if systemctl is-active --quiet helpy; then
  log "Servizio Helpy avviato!"
else
  err "Errore avvio! Log:"
  journalctl -u helpy -n 20 --no-pager
  exit 1
fi

# ── SSL ──────────────────────────────────────────────────────
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos \
    --email "admin@helpy.dev" --no-eff-email 2>&1 | grep -E "Congratulations|deployed|error" || true
  systemctl reload nginx 2>/dev/null || true
  log "SSL ri-applicato"
else
  DNS_IP=$(getent hosts $DOMAIN 2>/dev/null | awk '{print $1}' | head -1)
  if [ "$DNS_IP" = "$SERVER_IP" ] && [ -n "$DNS_IP" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
      --email "admin@helpy.dev" --redirect --no-eff-email 2>&1 | grep -E "Congratulations|error" || true
    log "SSL configurato"
  else
    warn "DNS non pronto. Esegui: sudo certbot --nginx -d $DOMAIN --redirect"
  fi
fi

# ── Verifica finale ──────────────────────────────────────────
GC_STATUS="❌ Non attivo"
systemctl is-active --quiet giadacourses 2>/dev/null && GC_STATUS="✅ Attivo (porta 3000)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT" 2>/dev/null || echo "000")

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      HELPY v1.0 — DEPLOY COMPLETATO!            ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Sito:           ${CYAN}https://$DOMAIN${NC}"
echo -e "  Porta:          ${CYAN}$PORT${NC}"
echo -e "  HTTP Status:    ${CYAN}$HTTP_CODE${NC}"
echo -e "  GiadaCourses:   ${CYAN}$GC_STATUS${NC}"
echo ""
echo -e "  ${BOLD}Admin Login:${NC}"
echo -e "  ${CYAN}Username: superadmin${NC}"
echo -e "  ${CYAN}Password: (vedi .env → ADMIN_PASSWORD)${NC}"
echo ""
echo -e "  ${BOLD}Comandi utili:${NC}"
echo -e "  ${CYAN}journalctl -u helpy -f${NC}           # log"
echo -e "  ${CYAN}systemctl restart helpy${NC}           # riavvia"
echo -e "  ${CYAN}sudo bash $APP_DIR/DEPLOY.sh${NC}      # ri-deploy"
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
