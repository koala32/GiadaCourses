Ricordati che ora la directory nuova é /opt/GiadaCoursess


# MANUALE OPERATIVO GIADACOURSES v10.0
# Architettura Modulare — Guida Completa

---

## DATI DI ACCESSO E CONFIGURAZIONE

- **IP Server:** 45.38.190.133
- **Utente VPS:** pepsifresh
- **Cartella Applicazione:** /opt/GiadaCoursess
- **Cartella Backups:** /opt/GiadaCoursess-backups
- **Dominio:** giadacourses.duckdns.org
- **Porta Node:** 3000 (localhost, Nginx espone HTTPS)
- **Repository GitHub:** https://github.com/koala32/GiadaCourses.git (Privato)

---

## STRUTTURA PROGETTO v10

```
/opt/GiadaCoursess/
  server.js              <- Entry point (288 righe)
  package.json           <- Dipendenze
  migrate.js             <- Script migrazione
  DEPLOY.sh              <- Deploy automatico
  BACKUP.sh              <- Backup emergenza
  ROLLBACK.sh            <- Rollback emergenza
  lib/
    db.js                <- Database NeDB
    sse.js               <- Eventi real-time (SSE + Socket.IO)
    upload.js            <- Multer config upload
  middleware/
    index.js             <- Auth + Security + Rate Limiting
  routes/
    auth.js              <- Login, registrazione, utenti, follow, campanellina
    content.js           <- Post, storie, media, blog, bug report
    social.js            <- DM, chiamate, live, sfide 1v1, gruppi chat
    learning.js          <- Esercizi, giochi, tips, changelog, admin
  public/
    index.html           <- Shell HTML
    css/main.css         <- Tutti gli stili + dark mode
    js/app.js            <- Logica client completa
    sw.js                <- Service Worker (PWA)
    manifest.json        <- Manifest PWA
  database/              <- DB NeDB (NON toccare, NON su GitHub)
  uploads/               <- File caricati (NON su GitHub)
```

---

## WORKFLOW AGGIORNAMENTI (DA WINDOWS)

### Primo setup Git su Windows (una volta sola)

1. Scarica **GitHub Desktop** da https://desktop.github.com
2. Apri GitHub Desktop e fai login con il tuo account GitHub
3. Clicca "Clone a repository" e seleziona GiadaCourses
4. Scegli una cartella locale (es. C:\GiadaCourses)

### Aggiornare il social (ogni volta)

1. Sul tuo PC Windows, apri la cartella del progetto
2. Cancella TUTTO il contenuto (tranne la cartella nascosta .git)
3. Estrai il nuovo zip dentro la cartella
4. Apri GitHub Desktop:
   - Vedrai tutti i file modificati sulla sinistra
   - In basso scrivi un messaggio (es. "v10 Fase 2")
   - Clicca "Commit to main"
   - Clicca "Push origin" in alto

### Alternative: Git da terminale Windows (PowerShell o Git Bash)

```powershell
cd C:\GiadaCourses
git add -A
git commit -m "v10 Fase 2 - Fix storie + Font + Anti-bypass"
git push origin main
```

### Sul server (SSH con PuTTY)

```bash
sudo bash /opt/GiadaCoursess/DEPLOY.sh
```

Fatto! Il DEPLOY.sh fa tutto automaticamente:
- Backup pre-deploy
- Scarica da GitHub
- Preserva database e uploads
- Installa dipendenze
- Fix permessi
- Riavvia servizio + Nginx + SSL

---

## COMANDI UTILI SUL SERVER

```bash
# Stato rapido (alias configurato)
check

# Log in tempo reale
journalctl -u giadacourses -f

# Riavvia servizio
sudo systemctl restart giadacourses

# Deploy completo
sudo bash /opt/GiadaCoursess/DEPLOY.sh

# Backup manuale
sudo bash /opt/GiadaCoursess/BACKUP.sh

# Rollback emergenza
sudo bash /opt/GiadaCoursess/ROLLBACK.sh

# Stato Nginx
sudo systemctl status nginx

# Test Nginx config
sudo nginx -t

# Ricarica Nginx
sudo systemctl reload nginx

# Rinnova SSL (se scaduto)
sudo certbot --nginx -d giadacourses.duckdns.org --redirect --non-interactive --agree-tos --email banfist00@gmail.com --no-eff-email
```

---

## RISOLUZIONE PROBLEMI

### Sito non raggiungibile (ERR_CONNECTION_REFUSED)

Causa: Nginx non ascolta sulla porta 443 (SSL perso).

```bash
# Fix immediato:
sudo certbot --nginx -d giadacourses.duckdns.org --redirect --non-interactive --agree-tos --email banfist00@gmail.com --no-eff-email
sudo systemctl reload nginx
```

### Schermata viola/bianca (Service Worker in cache)

Il server funziona ma il browser mostra la vecchia versione.

**Su telefono Android:**
1. Chrome -> Menu (3 puntini) -> Impostazioni -> Privacy -> Cancella dati navigazione
2. Oppure: tocca il lucchetto nella barra URL -> Impostazioni sito -> Cancella dati

**Su iPhone (Safari):**
1. Impostazioni -> Safari -> Cancella dati siti web e cronologia

**Se usi la PWA (app sulla home):**
1. Rimuovi l'app dalla home
2. Cancella dati sito dal browser
3. Riaggiungi alla home

### Servizio non parte

```bash
# Guarda l'errore specifico
journalctl -u giadacourses -n 50 --no-pager

# Controlla che i file esistano
ls /opt/GiadaCoursess/server.js
ls /opt/GiadaCoursess/public/index.html

# Fix permessi
sudo chown -R giadacourses:giadacourses /opt/GiadaCoursess
sudo chmod -R 755 /opt/GiadaCoursess

# Riavvia
sudo systemctl restart giadacourses
```

### Errore Nginx (file duplicati in sites-enabled)

```bash
# Vedi cosa c'e'
ls -la /etc/nginx/sites-enabled/

# Deve esserci SOLO giadacourses. Rimuovi altri:
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null
sudo rm /etc/nginx/sites-enabled/*.backup* 2>/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

### Dopo il deploy il sito e' down

```bash
# 1. Controlla servizio
sudo systemctl status giadacourses

# 2. Se e' morto, guarda il log
journalctl -u giadacourses -n 30 --no-pager

# 3. Prova a riavviare
sudo systemctl restart giadacourses

# 4. Se non parte, rollback
sudo bash /opt/GiadaCoursess/ROLLBACK.sh
```

### WebSocket/chiamate non funzionano

```bash
# Verifica config Nginx
sudo cat /etc/nginx/sites-enabled/giadacourses | grep -A5 "socket.io"

# Deve contenere:
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection $connection_upgrade;
# proxy_http_version 1.1;
```

---

## CHECKLIST POST-AGGIORNAMENTO

Dopo ogni deploy, verifica:

```bash
# 1. Servizio attivo + ping
check

# 2. Nginx OK
sudo nginx -t

# 3. SSL attivo
sudo ss -tlnp | grep 443

# 4. Test da esterno (dal telefono)
# Apri https://giadacourses.duckdns.org
```

---

## BACKUP DATABASE

Oltre ai backup automatici del DEPLOY.sh, ogni tanto scarica il database:

```bash
# Sul server, crea un archivio
cd /opt/GiadaCoursess
tar -czf /tmp/gc_db_backup.tar.gz database/

# Dal tuo PC Windows, scarica con WinSCP o SCP:
# Host: 45.38.190.133
# User: pepsifresh
# File: /tmp/gc_db_backup.tar.gz
```

---

## ACCOUNT DI DEFAULT

- **SuperAdmin:** super@giadacourses.it / Super2024!
- **Giada:** giada@giadacourses.it / Giada2024!

(Cambia queste password dopo il primo accesso!)

