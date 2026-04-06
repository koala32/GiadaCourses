#!/bin/bash
# ============================================================
#  GiadaCourses — BUILD APK Android (Universal)
#  Genera APK compatibile con TUTTE le architetture Android
#  Uso: bash BUILD_APK.sh (dalla root del progetto)
# ============================================================
set -e

echo ""
echo "============================================"
echo "  GiadaCourses — Build APK Universal"
echo "============================================"
echo ""

command -v node >/dev/null 2>&1 || { echo "ERRORE: Node.js non installato"; exit 1; }
command -v java >/dev/null 2>&1 || { echo "ERRORE: Java non installato (serve 21+)"; exit 1; }
export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}
echo "[OK] Java $(java -version 2>&1 | head -1)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "node_modules/@capacitor" ]; then
  echo "[..] Installo Capacitor..."
  npm install @capacitor/core @capacitor/cli @capacitor/android 2>&1 | tail -3
fi

if [ ! -d "android" ]; then
  echo "[..] Aggiungo piattaforma Android..."
  npx cap add android
fi

echo "[..] Sincronizzazione web assets..."
npx cap sync android 2>&1 | tail -3

# ── Genera icone Android con il logo GC ──
echo "[..] Generazione icone app..."
python3 << 'ICONEOF' 2>/dev/null || echo "[WARN] Pillow non installato, icone default"
from PIL import Image, ImageDraw, ImageFont
import os
sizes = {'mipmap-mdpi':48,'mipmap-hdpi':72,'mipmap-xhdpi':96,'mipmap-xxhdpi':144,'mipmap-xxxhdpi':192}
for folder, size in sizes.items():
    out = f'android/app/src/main/res/{folder}'
    os.makedirs(out, exist_ok=True)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    corner = size // 5
    for y in range(size):
        r = int(156 + (201 - 156) * y / size)
        g = int(124 + (123 - 124) * y / size)
        b = 255
        for x in range(size):
            pr = int(r + (255 - r) * x / size * 0.4)
            pg = int(g + (158 - g) * x / size * 0.4)
            in_rect = True
            if x < corner and y < corner: in_rect = ((x-corner)**2+(y-corner)**2) <= corner**2
            elif x > size-corner and y < corner: in_rect = ((x-(size-corner))**2+(y-corner)**2) <= corner**2
            elif x < corner and y > size-corner: in_rect = ((x-corner)**2+(y-(size-corner))**2) <= corner**2
            elif x > size-corner and y > size-corner: in_rect = ((x-(size-corner))**2+(y-(size-corner))**2) <= corner**2
            if in_rect: img.putpixel((x, y), (pr, pg, int(b + (205 - b) * x / size * 0.4), 255))
    try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size // 3)
    except: font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "GC", font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    draw.text(((size-tw)//2, (size-th)//2 - size//20), "GC", fill=(255,255,255,255), font=font)
    img.save(f'{out}/ic_launcher.png')
    img.save(f'{out}/ic_launcher_round.png')
    img.save(f'{out}/ic_launcher_foreground.png')
print("[OK] Icone generate")
ICONEOF

echo "[..] Configurazione build universale..."
if ! grep -q "GiadaCourses Universal" android/app/build.gradle 2>/dev/null; then
  cat >> android/app/build.gradle << 'GRADLEFIX'

// ── GiadaCourses Universal Build Config ──
android.defaultConfig.ndk {
    abiFilters 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'
}
configurations.all {
    resolutionStrategy {
        force 'org.jetbrains.kotlin:kotlin-stdlib:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22'
        force 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22'
    }
}
GRADLEFIX
  echo "[OK] Config universale applicata"
else
  echo "[OK] Config gia presente"
fi

MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q "ACCESS_NETWORK_STATE" "$MANIFEST" 2>/dev/null; then
  sed -i '/<uses-permission android:name="android.permission.INTERNET"/a\    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />' "$MANIFEST" 2>/dev/null || true
  echo "[OK] Permesso network aggiunto"
fi

cd android
echo "[..] Pulizia..."
./gradlew clean 2>&1 | tail -2
echo "[..] Build APK (1-2 minuti)..."
./gradlew assembleDebug 2>&1 | tail -5

APK="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then
  echo ""
  echo "============================================"
  echo "  BUILD COMPLETATA!"
  echo "  APK: $APK ($(du -h "$APK" | cut -f1))"
  echo "============================================"
  if [ -d "/opt/GiadaCoursess/uploads" ]; then
    sudo cp "$APK" /opt/GiadaCoursess/uploads/GiadaCourses-beta.apk 2>/dev/null
    sudo chmod 644 /opt/GiadaCoursess/uploads/GiadaCourses-beta.apk 2>/dev/null
    echo "  Download: https://giadacourses.duckdns.org/uploads/GiadaCourses-beta.apk"
  fi
else
  echo "ERRORE: Build fallita"; exit 1
fi
