#!/bin/bash
# =============================================================
#  Helpy v1.0 - DEPLOY.sh (Full-Stack)
#  Funziona sia da locale che da GitHub
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
REPO_URL="https://github.com/koala32/helpy-site.git"   # ← CAMBIA col tuo repo
REPO_BRANCH="main"

# Dove si trova questo script (per deploy locale)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║    Helpy v1.0 - Deploy Full-Stack               ║${NC}"
echo -e "${BOLD}${CYAN}║    Porta: $PORT | GiadaCourses: INTATTO          ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── STEP 1: Prerequisiti ─────────────────────────────────────
info "1/11 Verifica prerequisiti..."
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
info "2/11 Verifica GiadaCourses..."
if systemctl is-active --quiet giadacourses 2>/dev/null; then
  log "GiadaCourses ATTIVO su porta 3000 — non verrà toccato ✓"
else
  warn "GiadaCourses non attivo (non è un problema per Helpy)"
fi

# ── STEP 3: Rimuovi VECCHIO sito statico se presente ────────
info "3/11 Pulizia vecchio sito statico..."
if [ -d "/var/www/helpy" ]; then
  rm -rf /var/www/helpy
  log "Vecchia directory /var/www/helpy rimossa"
else
  log "Nessun vecchio sito statico trovato"
fi

# ── STEP 4: Utente di sistema ────────────────────────────────
info "4/11 Utente di sistema..."
id helpy &>/dev/null || useradd -r -s /bin/false helpy 2>/dev/null || true
log "Utente helpy OK"

# ── STEP 5: Backup ───────────────────────────────────────────
info "5/11 Backup..."
mkdir -p "$BACKUP_DIR"
if [ -d "$APP_DIR" ] && [ -f "$APP_DIR/server.js" ]; then
  if [ -d "$APP_DIR/database" ]; then
    cp -a "$APP_DIR/database" "$BACKUP_DIR/database_${TIMESTAMP}" 2>/dev/null || true
    log "Backup database"
  fi
  tar -czf "$BACKUP_DIR/helpy_${TIMESTAMP}.tar.gz" -C "$APP_DIR" . 2>/dev/null || true
  log "Backup completo"
else
  warn "Primo deploy — nessun backup necessario"
fi
ls -t "$BACKUP_DIR"/helpy_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f

# ── STEP 6: Stop servizio ────────────────────────────────────
info "6/11 Stop servizio..."
systemctl stop helpy 2>/dev/null && log "Servizio Helpy fermato" || warn "Servizio non ancora attivo (primo deploy)"
sleep 1

# ── STEP 7: Ottieni codice sorgente ─────────────────────────
info "7/11 Ottengo codice sorgente..."
SOURCE_DIR=""

# Prova 1: GitHub
TEMP_DIR=$(mktemp -d)
if git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null; then
  SOURCE_DIR="$TEMP_DIR/repo"
  log "Codice scaricato da GitHub ✓"
else
  rm -rf "$TEMP_DIR"
  warn "GitHub non raggiungibile o repo non trovato"

  # Prova 2: Deploy locale (dalla cartella dove si trova questo script)
  if [ -f "$SCRIPT_DIR/server.js" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
    SOURCE_DIR="$SCRIPT_DIR"
    log "Deploy LOCALE dalla directory corrente: $SCRIPT_DIR ✓"
  else
    err "Impossibile ottenere il codice! Né da GitHub né dalla directory locale.\nVerifica che REPO_URL sia corretto oppure esegui DEPLOY.sh dalla cartella del progetto."
  fi
fi

# ── STEP 8: Deploy file (preserva database + .env) ──────────
info "8/11 Deploy file..."
mkdir -p "$APP_DIR"

# Salva database e .env
SAVE_DIR=$(mktemp -d)
[ -d "$APP_DIR/database" ] && [ -f "$APP_DIR/database/helpy.db" ] && cp -a "$APP_DIR/database" "$SAVE_DIR/database" 2>/dev/null || true
[ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" "$SAVE_DIR/.env" 2>/dev/null || true

# Pulizia TOTALE della directory app (tranne quello che abbiamo salvato)
rm -rf "$APP_DIR/node_modules" "$APP_DIR/routes" "$APP_DIR/middleware" "$APP_DIR/public" "$APP_DIR/database" 2>/dev/null || true
find "$APP_DIR" -maxdepth 1 -type f -delete 2>/dev/null || true

# Copia TUTTO dal sorgente
cp "$SOURCE_DIR/server.js"      "$APP_DIR/"
cp "$SOURCE_DIR/package.json"   "$APP_DIR/"
cp -r "$SOURCE_DIR/routes"      "$APP_DIR/" 2>/dev/null || true
cp -r "$SOURCE_DIR/middleware"   "$APP_DIR/" 2>/dev/null || true
cp -r "$SOURCE_DIR/public"      "$APP_DIR/" 2>/dev/null || true
cp -r "$SOURCE_DIR/database"    "$APP_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/DEPLOY.sh"      "$APP_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/.env.example"   "$APP_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/.gitignore"     "$APP_DIR/" 2>/dev/null || true
cp "$SOURCE_DIR/README.md"      "$APP_DIR/" 2>/dev/null || true

log "File copiati"

# Ripristina database (se esisteva)
mkdir -p "$APP_DIR/database"
if [ -d "$SAVE_DIR/database" ] && [ -f "$SAVE_DIR/database/helpy.db" ]; then
  cp -a "$SAVE_DIR/database/"* "$APP_DIR/database/" 2>/dev/null || true
  log "Database precedente ripristinato ✓"
else
  log "Nuovo database verrà creato al primo avvio"
fi

# Ripristina o crea .env
if [ -f "$SAVE_DIR/.env" ]; then
  cp "$SAVE_DIR/.env" "$APP_DIR/.env"
  log ".env ripristinato ✓"
elif [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env" 2>/dev/null || true
  JWT_RAND=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -d '=/+' | head -c 64)
  sed -i "s/cambia_questo_con_una_stringa_casuale_lunga_2026/$JWT_RAND/" "$APP_DIR/.env" 2>/dev/null || true
  log ".env creato con JWT secret casuale ✓"
fi

# Cleanup temporanei
[ -n "$TEMP_DIR" ] && rm -rf "$TEMP_DIR" 2>/dev/null || true
rm -rf "$SAVE_DIR"

# Verifica file deployati
FILE_COUNT=$(find "$APP_DIR" -type f -not -path "*/node_modules/*" -not -path "*/database/*.db*" | wc -l)
log "Deploy completato: $FILE_COUNT file"

# ── STEP 9: npm install ──────────────────────────────────────
info "9/11 Installo dipendenze..."
cd "$APP_DIR"
npm install --production 2>&1 | tail -5
log "Dipendenze installate"

# ── STEP 10: Permessi e systemd ──────────────────────────────
info "10/11 Permessi e servizio systemd..."
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

# ── STEP 11: Nginx ───────────────────────────────────────────
info "11/11 Configurazione Nginx..."

# RIMUOVI qualsiasi vecchia config di helpy (statica o altro)
rm -f /etc/nginx/sites-enabled/helpy 2>/dev/null || true
rm -f /etc/nginx/sites-available/helpy 2>/dev/null || true

# Crea nuova config — reverse proxy verso porta 4000
cat > /etc/nginx/sites-available/helpy << 'NGINXEOF'
# Helpy v1.0 — Nginx Reverse Proxy (porta 4000)
server {
    listen 80;
    listen [::]:80;
    server_name helpy.duckdns.org;
    client_max_body_size 10M;

    # ACME challenge per SSL
    location /.well-known/acme-challenge/ { root /var/www/html; }

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy tutto verso Node.js
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/helpy /etc/nginx/sites-enabled/helpy

# Assicura che GiadaCourses nginx sia ancora attivo
if [ -f "/etc/nginx/sites-available/giadacourses" ]; then
  ln -sf /etc/nginx/sites-available/giadacourses /etc/nginx/sites-enabled/giadacourses 2>/dev/null || true
  log "GiadaCourses Nginx intatto ✓"
fi

# Rimuovi default nginx se presente
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Test e reload
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "Nginx configurato e ricaricato ✓"
else
  warn "Errore config Nginx:"
  nginx -t 2>&1
fi

# ── Avvio servizio ────────────────────────────────────────────
info "Avvio servizio Helpy..."
systemctl enable helpy 2>/dev/null || true
systemctl restart helpy
sleep 3

if systemctl is-active --quiet helpy; then
  log "Servizio Helpy avviato con successo! ✓"
else
  warn "Problema avvio servizio. Log errore:"
  journalctl -u helpy -n 30 --no-pager
  err "Servizio non avviato. Controlla i log sopra."
fi

# ── Test che Node risponda ────────────────────────────────────
info "Test connessione..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  log "Node.js risponde HTTP $HTTP_CODE ✓"
else
  warn "Node.js risponde HTTP $HTTP_CODE (potrebbe essere ancora in avvio)"
fi

API_PING=$(curl -s "http://127.0.0.1:$PORT/api/ping" 2>/dev/null || echo "errore")
log "API ping: $API_PING"

# ── SSL ──────────────────────────────────────────────────────
info "Configurazione SSL..."
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  info "Certificato SSL già esistente, ri-applico..."
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos \
    --email "admin@helpy.dev" --no-eff-email 2>&1 | grep -E "Congratulations|deployed|error|redirect|already" || true
  systemctl reload nginx 2>/dev/null || true
  log "SSL ri-applicato ✓"
else
  DNS_IP=$(getent hosts $DOMAIN 2>/dev/null | awk '{print $1}' | head -1)
  if [ "$DNS_IP" = "$SERVER_IP" ] && [ -n "$DNS_IP" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
      --email "admin@helpy.dev" --redirect --no-eff-email 2>&1 | grep -E "Congratulations|error" || true
    systemctl reload nginx 2>/dev/null || true
    log "SSL configurato ✓"
  else
    warn "DNS non pronto (atteso: $SERVER_IP, trovato: ${DNS_IP:-nessuno})"
    warn "Esegui manualmente: sudo certbot --nginx -d $DOMAIN --redirect"
  fi
fi

# ── Verifica finale ──────────────────────────────────────────
GC_STATUS="❌ Non attivo"
systemctl is-active --quiet giadacourses 2>/dev/null && GC_STATUS="✅ Attivo (porta 3000)"

HELPY_STATUS="❌ Non attivo"
systemctl is-active --quiet helpy 2>/dev/null && HELPY_STATUS="✅ Attivo (porta $PORT)"

FINAL_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/ping" 2>/dev/null || echo "000")

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      HELPY v1.0 — DEPLOY COMPLETATO!            ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Sito:           ${CYAN}https://$DOMAIN${NC}"
echo -e "  Porta:          ${CYAN}$PORT${NC}"
echo -e "  Helpy:          ${CYAN}$HELPY_STATUS${NC}"
echo -e "  API Status:     ${CYAN}HTTP $FINAL_HTTP${NC}"
echo -e "  GiadaCourses:   ${CYAN}$GC_STATUS${NC}"
echo -e "  File deployati: ${CYAN}$(find $APP_DIR -type f -not -path '*/node_modules/*' | wc -l) file${NC}"
echo ""
echo -e "  ${BOLD}Admin Login:${NC}"
echo -e "  ${CYAN}URL:      https://$DOMAIN/admin${NC}"
echo -e "  ${CYAN}Username: superadmin${NC}"
echo -e "  ${CYAN}Password: (vedi $APP_DIR/.env → ADMIN_PASSWORD)${NC}"
echo ""
echo -e "  ${BOLD}Pagine:${NC}"
echo -e "  ${CYAN}Landing:  https://$DOMAIN${NC}"
echo -e "  ${CYAN}Login:    https://$DOMAIN/login${NC}"
echo -e "  ${CYAN}Register: https://$DOMAIN/register${NC}"
echo -e "  ${CYAN}App:      https://$DOMAIN/app${NC}"
echo -e "  ${CYAN}Admin:    https://$DOMAIN/admin${NC}"
echo ""
echo -e "  ${BOLD}Comandi utili:${NC}"
echo -e "  ${CYAN}journalctl -u helpy -f${NC}               # log tempo reale"
echo -e "  ${CYAN}systemctl restart helpy${NC}               # riavvia"
echo -e "  ${CYAN}sudo bash $APP_DIR/DEPLOY.sh${NC}          # ri-deploy"
echo -e "  ${CYAN}systemctl status helpy giadacourses${NC}   # stato servizi"
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
