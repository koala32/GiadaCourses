sudo bash /opt/giadacourses/DEPLOY.sh (Dopo aver caricato i nuovi file per update sul github
----------------------------------------------------------------------------------------------------------------
# Esegui questo UNA volta sul VPS (come root o con sudo) (solo in caso di freshinstallation su una nuova vps)
git config --global credential.helper store
git clone https://koala32:IL_TUO_TOKEN@github.com/koala32/GiadaCourses.git /tmp/test-auth
rm -rf /tmp/test-auth
```

Da quel momento Git salva il token e ogni `sudo bash DEPLOY.sh` funziona senza chiedere password.

---

**Flusso completo di ogni aggiornamento:**
```
1. Modifichi il codice in locale
2. git push su GitHub (dal tuo PC)
3. Sul VPS: sudo bash /opt/giadacourses/DEPLOY.sh
-----------------------------------------------------------

📘 MANUALE OPERATIVO GIADACOURSES v7.0
1. DATI DI ACCESSO E CONFIGURAZIONE
IP Server: 45.38.190.133

Utente VPS: pepsifresh

Cartella Applicazione: /opt/giadacourses

GitHub Username: koala32

GitHub Email: banfist00@gmail.com

GitHub Token: colcazzocheloscrivo

Repository: https://github.com/koala32/GiadaCourses.git (Privato)

2. PROCEDURA DI DEPLOY SICURO (AGGIORNAMENTO SOCIAL)
Ogni volta che modifichi il codice e vuoi caricarlo sul server, usa questo script che abbiamo potenziato con controlli di integrità.

File: /opt/giadacourses/DEPLOY.sh
--------------------------------------------------------------
File: /opt/giadacourses/DEPLOY.sh
#!/bin/bash
SOURCE_DIR="/tmp/GiadaCourses"
DEST_DIR="/opt/giadacourses"
SERVICE_NAME="giadacourses"

echo "🚀 Inizio Deploy..."

# 1. Verifica integrità (Evita file troncati)
if ! grep -q "</html>" "$SOURCE_DIR/index.html"; then
    echo "❌ ERRORE: index.html incompleto. Deploy annullato."
    exit 1
fi

# 2. Sincronizzazione atomica
sudo systemctl stop $SERVICE_NAME
sudo rsync -av --delete --exclude='database' --exclude='uploads' --exclude='node_modules' --exclude='.git' "$SOURCE_DIR/" "$DEST_DIR/"

# 3. Permessi e Moduli
sudo chown -R giadacourses:giadacourses "$DEST_DIR"
sudo chmod -R 755 "$DEST_DIR"
cd "$DEST_DIR" && sudo -u giadacourses npm install --production

# 4. Riavvio e Nginx
sudo systemctl start $SERVICE_NAME
sudo nginx -t && sudo systemctl restart nginx

echo "✅ Social Online!"
---------------------------------------------------------

3. CHECKLIST DI VERIFICA (POST-AGGIORNAMENTO)
Dopo ogni update, esegui questi 3 controlli per assicurarti che tutto sia "DOC":

Integrità del file (Il "mai più" senza </html>):

1. tail -n 1 /opt/giadacourses/index.html
# Deve rispondere: </html>

2. Stato del Servizio:
sudo systemctl status giadacourses
# Deve essere "active (running)"

3. Test Connessione Interna:
curl -I http://127.0.0.1:3000
# Deve rispondere: HTTP/1.1 200 OK

------------------------------------------
4. SINCRONIZZAZIONE VPS -> GITHUB (BACKUP CLOUD) (SE NECESSARIO)
cd /opt/giadacourses
sudo git add -A
sudo git commit -m "Backup automatico VPS $(date +'%d/%m/%Y %H:%M')"
sudo git push origin master:main --force
---------------------------------------------

5. RISOLUZIONE PROBLEMI COMUNI
Schermata Viola Fissa o Bianco (Browser)
Se il server è OK ma il sito non carica, è colpa del Service Worker nel tuo browser.

Apri il sito e premi F12.

Vai in Application -> Storage.

Clicca "Clear site data".

Premi CTRL + F5 per ricaricare da zero.

Errore Nginx (WebSockets)
Se le notifiche o le sfide 1v1 non funzionano, controlla che in /etc/nginx/sites-enabled/giadacourses ci siano queste righe dentro location /:
/////
(bash)
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_http_version 1.1;
/////
--------------------------------------------

6. LAVORO "DOC" (CONSIGLI PRO)

1. Uso del .gitignore: Per non caricare moduli pesanti su GitHub, crea il file /opt/giadacourses/.gitignore:

node_modules/
.DS_Store
*.log

2. Backup Database: Oltre a GitHub, ogni tanto scarica la cartella /opt/giadacourses/database sul tuo PC.

3. Alias di Controllo: Aggiungi questo al tuo server (nano ~/.bashrc) per controllare tutto con un solo comando:
alias check='sudo systemctl status giadacourses && tail -n 1 /opt/giadacourses/index.html'
--------------------------------------------

BUON SOCIAL!
