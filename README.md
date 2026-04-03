# ⚡ Helpy — Tips & Tricks per l'Informatica

Sito statico con landing page, live chat bot e random tip generator.  
Self-hosted su Ubuntu 24.04 con Nginx.

## 🚀 Deploy

```bash
# Sul tuo VPS (Ubuntu 24.04)
sudo bash DEPLOY.sh
```

Il deploy script:
- Clona da GitHub e aggiorna i file in `/var/www/helpy`
- Configura Nginx come virtual host separato
- Configura SSL con Let's Encrypt
- **NON tocca GiadaCourses** — completamente indipendente

## 📁 Struttura

```
helpy-site/
├── index.html    ← Sito completo (landing + chat + tips)
├── DEPLOY.sh     ← Script di deploy automatico
└── README.md     ← Questo file
```

## ✨ Features

- **42+ Best Practices** — Security, Performance, DevOps, Clean Code, UX, Git
- **Live Chat Bot** — Risposte istantanee su topic tech
- **Random Tip Generator** — Un tip casuale ogni volta
- **Mobile-first** — Design responsive
- **Roadmap** — Blog, Code Playground, Dashboard, AI Assistant

## ⚙️ Configurazione

Nel `DEPLOY.sh`, modifica queste variabili se necessario:

```bash
DOMAIN="helpy.duckdns.org"
REPO_URL="https://github.com/koala32/helpy-site.git"  # ← Il tuo repo
REPO_BRANCH="main"
```

## 🔒 Coesistenza con GiadaCourses

Il sito gira su **Nginx virtual host separato**:
- `helpy.duckdns.org` → `/var/www/helpy` (file statici)
- `giadacourses.duckdns.org` → `localhost:3000` (Node.js proxy)

Nessuna porta condivisa, nessun conflitto. Nginx smista il traffico in base al `server_name`.
