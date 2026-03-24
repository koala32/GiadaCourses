# GiadaCourses 🌈

Social English Learning Platform — Piattaforma social per imparare l'inglese

## 🚀 Deploy su VPS (Ubuntu 24.04)

### Primo deploy (installazione da zero)
```bash
# Sul server come root o con sudo
cd /tmp
git clone https://github.com/koala32/GiadaCourses.git
cd GiadaCourses
sudo bash DEPLOY.sh
```

### Aggiornamento (preserva database e uploads)
```bash
# Sul server
cd /tmp
rm -rf GiadaCourses
git clone https://github.com/koala32/GiadaCourses.git
cd GiadaCourses
sudo bash DEPLOY.sh
```

Il deploy script:
- ✅ Clona da GitHub (sempre codice fresco)
- ✅ **Preserva uploads e database** durante l'aggiornamento
- ✅ Rimuove solo i vecchi file di codice
- ✅ Configura Nginx con supporto WebSocket (Socket.IO)
- ✅ Configura systemd service con auto-restart
- ✅ SSL automatico con Let's Encrypt

## 🔧 Comandi utili

```bash
# Log in tempo reale
sudo journalctl -u giadacourses -f

# Stato servizio
sudo systemctl status giadacourses

# Riavvia
sudo systemctl restart giadacourses

# Backup manuale
sudo /usr/local/bin/gc-backup.sh
```

## 📋 Fix inclusi nella v7.0

### Schermo bloccato (splash fisso)
- `init()` ora ha try/catch con safety timeout
- Lo splash si nasconde SEMPRE dopo max 3 secondi, anche in caso di errori

### Upload 404
- Logging migliorato per debug file mancanti
- CORS headers aggiunti sugli uploads
- DEPLOY.sh preserva la cartella uploads durante gli aggiornamenti

### Foto profilo
- Verifica che il file esista dopo l'upload
- Pulizia corretta della vecchia foto
- Errori specifici per l'utente

### Storie con musica
- Download musica con gestione redirect (Deezer usa redirect)
- Verifica dimensione file dopo download
- File musicali salvati permanentemente nel server

### Chiamate e Sfide
- Socket.IO + SSE dual channel per affidabilità
- Accept/Reject con vibrazione e notifica push
- Timeout automatico dopo 30 secondi
- ICE candidate buffering per connessioni lente

### Registrazione
- Validazione campi più robusta
- Errori specifici (email duplicata vs username duplicato)
- Sanitizzazione input

## 🏗️ Architettura

```
/opt/giadacourses/
├── server.js          # Backend Node.js (Express + Socket.IO)
├── index.html         # Frontend SPA (tutto in un file)
├── sw.js              # Service Worker PWA
├── package.json       # Dipendenze npm
├── manifest.json      # PWA manifest
├── DEPLOY.sh          # Script deploy
├── database/          # NeDB database (preservato nei deploy)
│   ├── users.db
│   ├── posts.db
│   ├── exercises.db
│   ├── messages.db
│   ├── stories.db
│   └── ...
├── uploads/           # Media caricati (preservati nei deploy)
└── icons/             # Icone PWA
```

## 📱 Funzionalità

- **Social Feed**: Post con foto/video, like, commenti
- **Storie 24h**: Con musica Deezer, filtri, template colorati
- **Messaggi DM**: Chat private con audio, foto, video
- **Chiamate WebRTC**: Audio/video con TURN server
- **Sfide 1v1**: Quiz inglese in tempo reale
- **Live Streaming**: Dirette WebRTC per lezioni
- **Esercizi**: Quiz con livelli A1-C2
- **Classifica**: XP, streak, badge
- **PWA**: Installabile come app nativa
