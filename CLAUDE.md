# CLAUDE.md – Entwickler-Anweisungen für GitHub Copilot / Claude

Dieses Dokument dient als Schnellreferenz für die Zusammenarbeit mit Claude/GitHub Copilot bei der Entwicklung und Wartung der Segellogbuch-App.

---

## 🎯 Projektkontext (kurz)

**App:** Segellogbuch (Native Android via Capacitor)  
**Zustand:** Beta (Debug-APK läuft auf Android-Gerät)  
**Kern-Funktionalität:** GPS-basierte Logbuch-Erfassung mit Wetter-API-Integration

---

## 🔑 Kritische Anforderungen

### Android Environment
```bash
# IMMER erforderlich vor Build:
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
cd /Users/aloisgether/Segellogbuch-Native/android
./gradlew clean assembleDebug --no-daemon
```

### Berechtigungen
Prüfe immer in [AndroidManifest.xml](android/app/src/main/AndroidManifest.xml):
- `android.permission.INTERNET` ✅
- `android.permission.ACCESS_FINE_LOCATION` ✅
- `android.permission.ACCESS_COARSE_LOCATION` ✅

Neue Permissions → neuer Build erforderlich!

### Capacitor-Integration
- Web-Assets liegen in `www/` → werden in Android unter `app/src/main/assets/public/` kopiert
- Sync-Befehl: `npx cap sync android`
- Öffne in IDE: `npx cap open android`

---

## 🛠️ Standard-Workflows

### Workflow 1: Web-Code ändern (JS/HTML/CSS)
```bash
# 1. Edit files in www/ (app.js, index.html, style.css, etc.)
# 2. Sync zu Android:
npx cap sync android

# 3. Rebuild:
cd android
./gradlew assembleDebug --no-daemon

# 4. Install + Test:
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Workflow 2: Android-Manifest ändern (Permissions, etc.)
```bash
# 1. Edit android/app/src/main/AndroidManifest.xml
# 2. Rebuild (!) – kein Sync nötig:
cd android
./gradlew clean assembleDebug --no-daemon

# 3. Install + Test
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Workflow 3: Feature-Bug-Behebung
```bash
# 1. Identifiziere fehlende Logik in app.js / storage.js / karte.js
# 2. Edit www/*.js (kein UI-Change nötig)
# 3. Sync + Build + Test
# 4. Wenn vollständig → kein neuer Commit nötig (nur APK)
```

---

## 🔍 Debugging

### adb commands
```bash
# Logs auslesen
adb logcat | grep "E\|W"  # Errors & Warnings only

# App stoppen/starten
adb shell am force-stop at.algether.segellogbuch
adb shell am start -n at.algether.segellogbuch/.MainActivity

# Storage durchsehen
adb shell run-as at.algether.segellogbuch cat /data/data/.../shared_prefs/*
```

### Häufige Fehler

| Error | Lösung |
|-------|--------|
| `Unable to locate a Java Runtime` | `export JAVA_HOME=...` + `export PATH=...` |
| `error: invalid source release: 21` | Java 21 ist nicht aktiv – siehe Java Setup oben |
| `ERROR: INSTALL_FAILED_INVALID_APK` | APK ist korrekt gebaut? → `./gradlew clean assembleDebug` |
| GPS-Daten nicht geladen | Permissions prüfen + App neu starten → manuell Berechtigung erteilen |
| Wetter-API antwortet nicht | Netzwerk online? → `adb shell ping 8.8.8.8` |

---

## 📁 Projektstruktur (essentiell)

```
Segellogbuch-Native/
├── www/                      ← WEB-CODE (Quelle)
│   ├── app.js              ← Hauptlogik (2160 Zeilen)
│   ├── storage.js          ← LocalStorage-Abstraction
│   ├── karte.js            ← Leaflet-Integration
│   ├── statistik.js        ← Auswertungen
│   ├── modals.js           ← Dialog-Komponenten
│   ├── track.js            ← GPS-Track-Anzeige
│   ├── index.html          ← HTML-Struktur
│   ├── style.css           ← Styling
│   ├── leaflet.js/.css     ← Kartenbib. (lokal)
│   └── config.js           ← Version + Auto-Update
│
├── android/                  ← NATIVE ANDROID
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml  ← PERMISSIONS HIER!
│   │   │   ├── assets/public/       ← www/ wird HIER kopiert
│   │   │   │   └── *.html/*.js
│   │   │   └── java/.../MainActivity.java
│   │   └── build.gradle
│   ├── gradlew            ← Build-Tool
│   ├── local.properties   ← SDK-Pfad
│   └── build/
│       └── outputs/apk/debug/app-debug.apk  ← FINAL APK
│
├── capacitor.config.json   ← Capacitor-Config (webDir: www)
├── package.json           ← Node dependencies
├── LOGIK.md              ← Feature-Dokumentation (DIESES FILE)
└── CLAUDE.md             ← Diese Anweisungen
```

---

## ✅ Pre-Commit Checkliste

Vor jedem **Build**:
- [ ] `www/` Files korrekt gespeichert? (keine Syntax-Fehler in app.js?)
- [ ] AndroidManifest aktuell? (Permissions?)
- [ ] Java 21 aktiv? → `java -version`
- [ ] Gradle Daemon sauber? → `pkill -f GradleDaemon`

Vor jedem **Install**:
- [ ] Build erfolgreich? (`BUILD SUCCESSFUL`)
- [ ] APK existiert? → `ls -l android/app/build/outputs/apk/debug/app-debug.apk`
- [ ] Gerät verbunden? → `adb devices`
- [ ] Alte App zuerst gelöscht? → `adb uninstall at.algether.segellogbuch`

---

## 🚀 Nächste Schritte (Priorität)

### P0 (Kritisch – App funktioniert)
- ✅ Capacitor-Setup
- ✅ GPS + Wetter-API-Integration
- ✅ Android-Build erfolgreich
- ✅ APK auf Gerät lauffähig

### P1 (Wichtig – Production-Ready)
- [ ] **Release-Build** mit Code-Signing für Play Store
- [ ] **Version-Bump** (aktuell: 2.5.151)
- [ ] **ProGuard/R8** Obfuscation aktivieren
- [ ] **Testing.md** schreiben (Test-Cases)

### P2 (Nice-to-Have)
- [ ] iOS-Version (Capacitor → `cap add ios`)
- [ ] Dark-Mode Optimierung
- [ ] Offline-Synchronisierung
- [ ] Cloud-Backup integr.
- [ ] Mehrsprachigkeit (EN, FR, ...)

---

## 🚀 Schnellstart für neue Claude-Session

**Wenn ein neuer Claude-Chat startet, führe diese Befehle aus:**

```bash
# 1. Zur App navigieren
cd /Users/aloisgether/Segellogbuch-Native

# 2. Java 21 aktivieren (KRITISCH!)
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"

# 3. Gradle Daemon clean (falls nötig)
pkill -f GradleDaemon 2>/dev/null || true

# 4. Aktuelle Gerät-Info
/opt/homebrew/share/android-commandlinetools/platform-tools/adb devices
```

**Nach diesen Befehlen ist die Session ready für Build/Test!** Dann in deinem Chat mit Claude:
- `npx cap sync android` falls Web-Code geändert
- `./gradlew assembleDebug --no-daemon` für Build
- `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` zum Installieren

---

## 📚 Wichtige Code-Locations

| Feature | File(s) | Beispiel-Funktion |
|---------|---------|-------------------|
| GPS abrufen | app.js | `formWetterVorbelegen()` (Zeile 666) |
| Wetter-API | app.js | `wetterVonApi()` (Zeile 147) |
| Beaufort ↔ m/s | app.js | `msToBft()` (Zeile 110) |
| Speichern → Storage | storage.js | `speichereToern()` |
| Laden ← Storage | storage.js | `ladeToerne()` |
| Karte anzeigen | karte.js | `karteInitialisieren()` |
| Statistika-Calc | statistik.js | `berechneTornStatistik()` |
| Version | config.js | `APP_VERSION = "2.5.151"` |

---

## 🔄 Git-Workflow

**Branch-Strategie:**
- `main` – Stable, Production-Ready (nur via merge)
- `develop` – Integration Branch für Features
- `feature/xyz` – Feature Branches aus `develop`

**Standard-Ablauf:**
```bash
# 1. Feature Branch erstellen
git checkout develop
git pull origin develop
git checkout -b feature/gps-timeout-fix

# 2. Änderungen machen, testen, committen
git add www/app.js
git commit -m "[android] GPS: Increase timeout from 8s to 15s"

# 3. Push + PR erstellen
git push origin feature/gps-timeout-fix
# → GitHub: Create Pull Request gegen develop

# 4. Nach Review + Test: Merge via GitHub UI oder:
git checkout develop
git pull origin develop
git merge feature/gps-timeout-fix
git push origin develop

# 5. Release: develop → main
git checkout main
git pull origin main
git merge develop --no-ff -m "Release v2.5.152"
git tag -a v2.5.152 -m "Version 2.5.152"
git push origin main --tags
```

**Commit-Message-Format:**
```
[scope] type: short description

- detailed point 1
- detailed point 2

Fixes #issue-id (if applicable)
```

**Beispiele:**
```
[android] feature: Add MOB quick-launch button
[www] fix: Correct wind unit conversion 
[gradle] build: Update Android SDK target to API 36
```

---

## 📦 Versions-Bump-Prozess

**Version-Dateien die aktualisiert werden müssen:**

| Datei | Ort | Beispiel |
|-------|-----|---------|
| `www/config.js` | Zeile 5 | `const APP_VERSION = "2.5.152";` |
| `www/version.json` | Zeile 1 | `{ "version": "2.5.152" }` |
| `android/app/build.gradle` | `versionCode` & `versionName` | `versionCode 2515`, `versionName "2.5.152"` |
| `package.json` | `version` | `"version": "2.5.152"` |
| `CLAUDE.md` | Footer | `**Version:** 2.5.152` |
| Git Tag | Bei Release | `git tag -a v2.5.152` |

**Version-Bump Workflow (Minor):**
```bash
# 1. Alle Dateien aktualisieren
# www/config.js
APP_VERSION = "2.5.152"

# android/app/build.gradle (bei 2.5.151: Code=2515, Name="2.5.151")
versionCode 2516
versionName "2.5.152"

# package.json
"version": "2.5.152"

# 2. Commit & Tag
git add www/config.js android/app/build.gradle package.json
git commit -m "[release] Bump version to 2.5.152"
git tag -a v2.5.152 -m "Version 2.5.152 - GPS timeout fix"
git push origin main --tags

# 3. Build + Release-APK
cd android
./gradlew clean assembleRelease
# → APK under android/app/build/outputs/apk/release/app-release.apk
```

**Version-Code Schema:**
```
Format: MMMPBBB
M = Major (1-9)
P = Minor/Patch (0-99) 
B = Build/Revision (0-999)

Beispiel: 2.5.151 → versionCode 2051151
```

---

## 🔙 Rollback-Strategie

**Bei fehlerhaftem Build/APK:**

```bash
# 1. Alte APK aufheben (vor neuentwicklung)
mkdir -p ~/Segellogbuch-APK-Backups
cp android/app/build/outputs/apk/debug/app-debug.apk \
   ~/Segellogbuch-APK-Backups/app-debug-v$(date +%Y%m%d-%H%M%S).apk

# 2. Letzte funktionierende APK zurückinstallieren
adb uninstall at.algether.segellogbuch
adb install -r ~/Segellogbuch-APK-Backups/app-debug-v20260615-143022.apk

# 3. Code-Fehler finden & beheben
git log --oneline -5  # Letzte Commits ansehen
git diff HEAD~1       # Was hat sich geändert?
git revert HEAD       # Falls nötig: letzten Commit rückgängig machen

# 4. Clean rebuild
cd android
./gradlew clean
./gradlew assembleDebug --no-daemon
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**APK-Backup-Struktur:**
```
~/Segellogbuch-APK-Backups/
├── app-debug-v20260615-143022.apk  (✅ Funktioniert)
├── app-debug-v20260615-145633.apk  (❌ Crash bei GPS)
├── app-release-v2.5.151.apk        (Release-Kandidat)
└── README.txt                       (Notizen zu bekannten Issues)
```

**Git Rollback bei Code-Fehler:**
```bash
# Letzte 3 Commits ansehen
git log --oneline -3

# Einzelnen Commit reverten (ohne History zu ändern)
git revert abc123def  # commit hash

# Oder: Zu spezifischem Commit zurück (für lokales Testen)
git checkout v2.5.151

# Oder: Komplettes Repo auf letzten Tag zurücksetzen (VORSICHT!)
git reset --hard v2.5.151
```

---

## 🤝 Collaboration Guidelines

### Wenn du den Quelltext ändern sollst:
1. **Kopieren:** Der ganze Kontext dieser Logik-Dateien (LOGIK.md + diese Datei)
2. **Ändern:** Zielfile (z.B. `www/app.js`, `AndroidManifest.xml`)
3. **Verifizieren:** Build läuft, APK wird erstellt, Gerät aktualisiert
4. **Reportieren:** Was funktioniert ✅, was nicht ❌

### Wenn du Fragen hast:
- "Wo sind die GPS-Funktionen?" → `app.js` Zeile 666 ff. (`formWetterVorbelegen`)
- "Wie speichere ich Daten?" → `storage.js` Funktionen (`speichereToern`, `ladeToerne`)
- "Beaufort-Umrechnung?" → `app.js` Zeile 110-125 (`msToBft`, `bftZuKnoten`)

### Wenn ein neues Feature kommt:
1. Sketch die Anforderung (1-2 Sätze)
2. Identifiziere Datei(en) zum Ändern
3. Schreibe Code & Test lokal
4. Build + Install + Überprüftheit bestätigen
5. (Optional) → Dokumentation updaten (LOGIK.md)

---

## 🔗 Externe Tools & Quellen

- **Android Emulator:** `emulator -list-avds` / `emulator -avd <name>`
- **adb:** `adb devices`, `adb logcat`, `adb shell`
- **Gradle:** `./gradlew tasks` (alle verfügbaren Tasks)
- **Capacitor CLI:** `npx cap` (help)
- **Open-Meteo API:** https://api.open-meteo.com/v1/forecast?latitude=X&longitude=Y&current=...

---

## 📞 Troubleshooting für häufige Probleme

### Problem: "App crasht beim Start"
```bash
# 1. Logs ansehen:
adb logcat | tail -50

# 2. JavaScript-Fehler in Chrome DevTools? 
#    → Gehe zu chrome://inspect → connected device → inspect

# 3. Permissions fehlend?
#    → AndroidManifest.xml überprüfen

# 4. Capacitor nicht initialisiert?
#    → index.html head check: <script src="capacitor.js"></script>?
```

### Problem: "GPS funktioniert nicht"
```bash
# 1. Permissions aktiv?
adb shell pm grant at.algether.segellogbuch android.permission.ACCESS_FINE_LOCATION
adb shell pm grant at.algether.segellogbuch android.permission.ACCESS_COARSE_LOCATION

# 2. Geolocation API unterstützt?
adb logcat | grep "Geolocation"

# 3. GPS-Timeout erhöhen?
#    → app.js Zeile 693, timeout: 8000 → 15000 ms
```

### Problem: "Wetter-Daten kommen nicht"
```bash
# 1. Internet erreichbar?
adb shell ping api.open-meteo.com

# 2. Proxy/Firewall?
adb logcat | grep "fetch\|API"

# 3. Koordinaten ungültig?
#    → GPS erst erfolgreich? Check log in app.js `wetterVonApi`
```

---

## 📋 Commit-Message Vorlage

```
[android] <feature>: <beschreibung>

- <detail 1>
- <detail 2>

APK: v<version>
Build: gradle assembleDebug ✅
Test: adb install -r ✅
Devices: [Gerät-Name]

Closes #<issue-id> (falls zutreffend)
```

**Beispiel:**
```
[android] GPS: Add permission check on app start

- Added ACCESS_FINE_LOCATION + ACCESS_COARSE_LOCATION to AndroidManifest.xml
- Graceful fallback for manual wind input when GPS unavailable
- Rebuild + re-installed on device

APK: v2.5.151
Build: gradle assembleDebug ✅
Test: adb install -r ✅
```

---

## 🎓 Learning Path für neue Entwickler

1. **Lese zuerst:** [LOGIK.md](./LOGIK.md) (Feature-Übersicht)
2. **Dann:** `www/app.js` Struktur scannen (Funktionen nach Kategorie)
3. **Probiere:** Ein simples Feature ändern (z.B. Farbe, Text)
4. **Build & Test:** Siehe Workflow 1 oben
5. **Frag nach:** Wenn unklar, ask Claude/Copilot mit LOGIK.md als Context

---

**Zuletzt aktualisiert:** 3. August 2026  
**Für Claude/GitHub-Copilot optimiert**  
**Version:** 2.5.185
