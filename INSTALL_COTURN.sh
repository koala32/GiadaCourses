#!/bin/bash
# ============================================================
#  INSTALLA COTURN SUL VPS — GiadaCourses
#  Esegui come root: sudo bash INSTALL_COTURN.sh
# ============================================================

set -e
SERVER_IP="45.38.190.133"
TURN_SECRET="GiadaCourses2026SecretKey$(openssl rand -hex 8)"
REALM="giadacourses.duckdns.org"

echo "=============================="
echo " Installazione Coturn per GiadaCourses"
echo "=============================="

# 1. Installa Coturn
apt-get update
apt-get install -y coturn

# 2. Abilita il servizio
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

# 3. Configurazione
cat > /etc/turnserver.conf << CONF
# GiadaCourses TURN Server
listening-port=3478
tls-listening-port=5349

# IP del server
listening-ip=0.0.0.0
relay-ip=$SERVER_IP
external-ip=$SERVER_IP

# Realm
realm=$REALM
server-name=$REALM

# Autenticazione con shared secret (credenziali temporanee)
use-auth-secret
static-auth-secret=$TURN_SECRET

# Sicurezza
fingerprint
lt-cred-mech
no-cli
no-tlsv1
no-tlsv1_1

# Limiti
total-quota=100
stale-nonce=600
max-bps=0
bps-capacity=0

# Log
log-file=/var/log/turnserver.log
verbose

# Porte relay
min-port=49152
max-port=65535
CONF

# 4. Apri porte firewall
ufw allow 3478/tcp 2>/dev/null || true
ufw allow 3478/udp 2>/dev/null || true
ufw allow 5349/tcp 2>/dev/null || true
ufw allow 5349/udp 2>/dev/null || true
ufw allow 49152:65535/udp 2>/dev/null || true

# 5. Avvia e abilita il servizio
systemctl restart coturn
systemctl enable coturn

# 6. Salva il secret per Node.js
echo ""
echo "=============================="
echo " COTURN INSTALLATO CON SUCCESSO!"
echo "=============================="
echo ""
echo "Aggiungi queste variabili d'ambiente al tuo server Node.js:"
echo ""
echo "  export SERVER_IP=$SERVER_IP"
echo "  export TURN_SECRET=$TURN_SECRET"
echo ""
echo "Per renderle permanenti, aggiungi al file /opt/GiadaCoursess/.env:"
echo "  SERVER_IP=$SERVER_IP" >> /opt/GiadaCoursess/.env 2>/dev/null || true
echo "  TURN_SECRET=$TURN_SECRET" >> /opt/GiadaCoursess/.env 2>/dev/null || true
echo ""
echo "Poi riavvia GiadaCourses:"
echo "  cd /opt/GiadaCoursess && sudo bash DEPLOY.sh"
echo ""
echo "Test TURN:"
echo "  turnutils_uclient -v -u test -w test $SERVER_IP"
echo ""
