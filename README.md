# 💙 Helpy — Assistenza informatica per tutti

Piattaforma web completa per assistenza informatica di primo e secondo livello.  
Pensata per utenti alle prime armi, con percorsi guidati, quiz, sistema di ticket e pannello admin.

## 🚀 Deploy

```bash
sudo bash DEPLOY.sh
```

## 🔑 Primo accesso admin

- **URL**: `https://helpy.duckdns.org/admin`
- **Username**: `superadmin`
- **Password**: `HelpyAdmin2026!` (cambia subito in `.env`)

## 📁 Struttura

```
helpy/
├── server.js          # Express server (porta 4000)
├── package.json
├── .env.example       # Template configurazione
├── DEPLOY.sh          # Deploy automatico
├── database/
│   └── init.js        # Schema SQLite + seed data
├── middleware/
│   ├── auth.js        # JWT authentication
│   └── security.js    # Rate limiting, headers
├── routes/
│   ├── auth.js        # Register, login, profilo
│   ├── chat.js        # Sistema ticket/assistenza
│   ├── admin.js       # API pannello admin
│   └── learn.js       # Corsi, lezioni, quiz
└── public/
    ├── index.html      # Landing page (visitatori)
    ├── login.html      # Login
    ├── register.html   # Registrazione
    ├── app.html        # Dashboard utente (SPA)
    ├── admin.html      # Pannello admin (SPA)
    └── css/style.css   # Stili globali
```

## ✨ Features

- **Landing page** per visitatori non registrati
- **Registrazione/Login** con JWT e bcrypt
- **Dashboard utente** con percorsi, quiz e richieste assistenza
- **Sistema ticket** — ogni richiesta arriva nel pannello admin
- **Pannello SuperAdmin** — gestione utenti, ticket, log attività
- **6 percorsi di apprendimento** con lezioni e quiz
- **Rate limiting** e security headers
- **Coesistenza con GiadaCourses** (porta 4000 vs 3000)

## 🔒 Sicurezza

- Password hashate con bcrypt (12 round)
- JWT httpOnly + SameSite strict
- Helmet + CSP headers
- Rate limiting su auth e API
- Input sanitization
- Audit log di tutte le azioni
