#!/bin/bash
# =============================================================
#  Helpy v1.0 - DEPLOY.sh
#  Deploy PULITO da GitHub — Sito statico su Nginx
#  ⚠️  NON tocca GiadaCourses — completamente indipendente
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
SITE_DIR="/var/www/helpy"
BACKUP_DIR="/var/www/helpy-backups"
DOMAIN="helpy.duckdns.org"
SERVER_IP=$(curl -s --max-time 8 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPO_URL="https://github.com/koala32/helpy-site.git"   # ← CAMBIA con il tuo repo
REPO_BRANCH="main"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║    Helpy v1.0 - Deploy Statico da GitHub        ║${NC}"
echo -e "${BOLD}${CYAN}║    Server: $SERVER_IP                      ║${NC}"
echo -e "${BOLD}${CYAN}║    ⚠️  GiadaCourses NON verrà toccato            ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── STEP 1: Prerequisiti ─────────────────────────────────────
info "1/7 Verifica prerequisiti..."
for cmd in git nginx; do
  if ! command -v $cmd &>/dev/null; then
    warn "$cmd non trovato, installo..."
    apt-get install -y -q $cmd > /dev/null 2>&1
  fi
done

# Certbot per SSL
if ! command -v certbot &>/dev/null; then
  info "Installo Certbot per HTTPS..."
  apt-get install -y -q certbot python3-certbot-nginx > /dev/null 2>&1
fi
log "Prerequisiti OK"

# ── STEP 2: Verifica che GiadaCourses sia intatto ────────────
info "2/7 Verifica GiadaCourses..."
if systemctl is-active --quiet giadacourses 2>/dev/null; then
  log "GiadaCourses è ATTIVO e non verrà toccato ✓"
else
  warn "GiadaCourses non sembra attivo (non è un problema per questo deploy)"
fi

# ── STEP 3: Backup se esiste già ─────────────────────────────
info "3/7 Backup..."
mkdir -p "$BACKUP_DIR"
if [ -d "$SITE_DIR" ] && [ "$(ls -A $SITE_DIR 2>/dev/null)" ]; then
  tar -czf "$BACKUP_DIR/helpy_${TIMESTAMP}.tar.gz" \
    -C "$SITE_DIR" . 2>/dev/null && \
    log "Backup: $BACKUP_DIR/helpy_${TIMESTAMP}.tar.gz" || \
    warn "Backup parziale"
else
  warn "Nessuna installazione precedente (primo deploy)"
fi

# Pulizia vecchi backup (mantieni ultimi 10)
ls -t "$BACKUP_DIR"/helpy_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
log "Backup completato"

# ── STEP 4: Clone da GitHub ──────────────────────────────────
info "4/7 Scarico codice da GitHub..."
TEMP_DIR=$(mktemp -d)
if git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null; then
  log "Repository clonato con successo"
else
  rm -rf "$TEMP_DIR"
  err "Clone fallito! Verifica che il repo $REPO_URL sia accessibile"
fi

# ── STEP 5: Deploy dei file ──────────────────────────────────
info "5/7 Deploy file statici..."
mkdir -p "$SITE_DIR"

# Copia tutti i file dal repo (escludi .git)
rsync -a --delete --exclude='.git' --exclude='DEPLOY.sh' \
  "$TEMP_DIR/repo/" "$SITE_DIR/" 2>/dev/null || \
  { cp -r "$TEMP_DIR/repo/"* "$SITE_DIR/" 2>/dev/null; }

# Copia anche il DEPLOY.sh nella directory per futuri re-deploy
cp "$TEMP_DIR/repo/DEPLOY.sh" "$SITE_DIR/DEPLOY.sh" 2>/dev/null || true

# Permessi
chown -R www-data:www-data "$SITE_DIR"
chmod -R 755 "$SITE_DIR"
find "$SITE_DIR" -type f -exec chmod 644 {} \;

# Cleanup
rm -rf "$TEMP_DIR"
log "File deployati in $SITE_DIR"
log "File totali: $(find $SITE_DIR -type f | wc -l)"

# ── STEP 6: Nginx Virtual Host ───────────────────────────────
info "6/7 Configurazione Nginx..."

NGINX_CONF="/etc/nginx/sites-available/helpy"

# Controlla se esiste già con SSL
HAS_SSL=false
if [ -f "$NGINX_CONF" ] && grep -q 'ssl_certificate' "$NGINX_CONF" 2>/dev/null; then
  HAS_SSL=true
  log "SSL esistente rilevato — verrà preservato"
  cp "$NGINX_CONF" "${NGINX_CONF}.ssl_backup" 2>/dev/null || true
fi

cat > /etc/nginx/sites-available/helpy << 'NGINXEOF'
# Helpy v1.0 - Nginx Configuration (Static Site)
# ⚠️ Completamente indipendente da GiadaCourses

server {
    listen 80;
    listen [::]:80;
    server_name helpy.duckdns.org;

    root /var/www/helpy;
    index index.html;

    # ACME challenge per SSL
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Cache per asset statici
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Pagina principale
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Blocca accesso a file nascosti
    location ~ /\. {
        deny all;
    }

    # Custom 404
    error_page 404 /index.html;
}
NGINXEOF

# Attiva il sito (senza toccare gli altri!)
ln -sf /etc/nginx/sites-available/helpy /etc/nginx/sites-enabled/helpy

# Verifica che la config di GiadaCourses sia ancora attiva
if [ -f "/etc/nginx/sites-enabled/giadacourses" ]; then
  log "GiadaCourses Nginx config ancora attiva ✓"
elif [ -f "/etc/nginx/sites-available/giadacourses" ]; then
  # Riattiva se per qualche motivo era disattivata
  ln -sf /etc/nginx/sites-available/giadacourses /etc/nginx/sites-enabled/giadacourses
  warn "GiadaCourses Nginx config ri-attivata per sicurezza"
fi

# Test e reload
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log "Nginx configurato e ricaricato"
  log "→ helpy.duckdns.org     → /var/www/helpy (statico)"
  log "→ giadacourses.duckdns.org → porta 3000 (Node.js) [INTATTO]"
else
  warn "Errore config Nginx! Dettagli:"
  nginx -t 2>&1
  if [ "$HAS_SSL" = true ] && [ -f "${NGINX_CONF}.ssl_backup" ]; then
    cp "${NGINX_CONF}.ssl_backup" "$NGINX_CONF"
    systemctl reload nginx 2>/dev/null
    warn "Ripristinata config Nginx precedente con SSL"
  fi
fi

# ── STEP 7: SSL con Let's Encrypt ────────────────────────────
info "7/7 Configurazione SSL..."

if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  # SSL già presente, ri-applica
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos \
    --email "admin@helpy.dev" --no-eff-email 2>&1 \
    | grep -E "Congratulations|deployed|error|certificate|redirect" || true
  systemctl reload nginx 2>/dev/null || true
  log "SSL ri-applicato"
else
  # Primo setup SSL
  DNS_IP=$(getent hosts $DOMAIN 2>/dev/null | awk '{print $1}' | head -1)
  if [ "$DNS_IP" = "$SERVER_IP" ] && [ -n "$DNS_IP" ]; then
    certbot --nginx -d "$DOMAIN" \
      --non-interactive --agree-tos --email "admin@helpy.dev" \
      --redirect --no-eff-email 2>&1 \
      | grep -E "Congratulations|error|certificate" || true
    log "SSL configurato con Let's Encrypt"
  else
    warn "DNS non ancora propagato (atteso: $SERVER_IP, trovato: ${DNS_IP:-nessuno})"
    warn "Quando pronto esegui: sudo certbot --nginx -d $DOMAIN --agree-tos --email admin@helpy.dev --redirect"
  fi
fi

# ── Verifica finale ──────────────────────────────────────────
echo ""

# Test HTTP
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1" -H "Host: $DOMAIN" 2>/dev/null || echo "000")

# Verifica GiadaCourses intatto
GC_STATUS="❌ Non attivo"
if systemctl is-active --quiet giadacourses 2>/dev/null; then
  GC_STATUS="✅ Attivo e intatto"
fi

echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║       HELPY v1.0 — DEPLOY COMPLETATO!           ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Sito:           ${CYAN}https://$DOMAIN${NC}"
echo -e "  Directory:      ${CYAN}$SITE_DIR${NC}"
echo -e "  File deployati: ${CYAN}$(find $SITE_DIR -type f | wc -l) file${NC}"
echo -e "  HTTP Status:    ${CYAN}$HTTP_CODE${NC}"
echo -e "  GiadaCourses:   ${CYAN}$GC_STATUS${NC}"
echo ""
echo -e "  ${BOLD}Comandi utili:${NC}"
echo -e "  ${CYAN}sudo bash $SITE_DIR/DEPLOY.sh${NC}      # ri-deploy da GitHub"
echo -e "  ${CYAN}sudo systemctl status nginx${NC}        # stato Nginx"
echo -e "  ${CYAN}sudo nginx -t && sudo systemctl reload nginx${NC}  # reload config"
echo -e "  ${CYAN}curl -I https://$DOMAIN${NC}            # test HTTPS"
echo ""
echo -e "  ${BOLD}GiadaCourses:${NC}"
echo -e "  ${CYAN}sudo systemctl status giadacourses${NC} # verifica social OK"
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
