#!/bin/bash
# ============================================================
#  GiadaCourses — BUILD APK Android (Beta)
#  Esegui sul tuo PC locale, NON sul server VPS!
#  Requisiti: Node.js 20+, Android Studio, Java 17+
# ============================================================

echo "============================================"
echo "  GiadaCourses — Preparazione APK Android"
echo "============================================"
echo ""

# 1. Verifica prerequisiti
echo "[1/6] Verifica prerequisiti..."
command -v node >/dev/null 2>&1 || { echo "Errore: Node.js non installato"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Errore: npm non installato"; exit 1; }
echo "  Node $(node -v), npm $(npm -v)"

# 2. Clona il repo
echo "[2/6] Clone repository..."
if [ ! -d "GiadaCourses" ]; then
  git clone https://github.com/koala32/GiadaCourses.git
  cd GiadaCourses
else
  cd GiadaCourses
  git pull
fi

# 3. Installa Capacitor
echo "[3/6] Installo Capacitor..."
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/splash-screen @capacitor/status-bar

# 4. Inizializza Capacitor (se non già fatto)
if [ ! -d "android" ]; then
  echo "[4/6] Inizializzo progetto Android..."
  npx cap add android
else
  echo "[4/6] Progetto Android già presente, sincronizzo..."
fi

# 5. Sincronizza web assets
echo "[5/6] Sincronizzazione..."
npx cap sync android

# 6. Apri Android Studio OPPURE build da CLI
echo ""
echo "============================================"
echo "  PRONTO! Scegli come costruire l'APK:"
echo "============================================"
echo ""
echo "  OPZIONE A — Android Studio (consigliato):"
echo "    npx cap open android"
echo "    Poi: Build → Build Bundle(s) / APK(s) → Build APK(s)"
echo "    L'APK sara in: android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "  OPZIONE B — Riga di comando (serve Android SDK):"
echo "    cd android && ./gradlew assembleDebug"
echo "    L'APK sara in: android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "  Dopo aver generato l'APK:"
echo "    1. Invia il file .apk su WhatsApp ai beta tester"
echo "    2. I tester aprono il file e installano"
echo "    3. Potrebbe servire abilitare 'Origini sconosciute' nelle impostazioni"
echo ""
echo "============================================"
