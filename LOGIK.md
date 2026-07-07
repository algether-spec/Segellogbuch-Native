# Segellogbuch – Logik & Anforderungen

## 📋 Projektüberblick

**Segellogbuch** ist eine native Android-App zur digitalen Erfassung und Verwaltung von Segelgetörns mit automatischer GPS- und Wetter-Integration.

- **Plattform:** Android (via Capacitor)
- **Version:** 2.5.151
- **Sprache:** Deutsch
- **Daten:** LocalStorage + IndexedDB
- **APIs:** Open-Meteo (Wetter), Geolocation API (GPS)

---

## 🎯 Core-Features

### 1. **Törn-Verwaltung**
- Erstellen, Bearbeiten, Löschen von Segelgetörns
- Speicherung: Schiffsdaten, Skipper, Crew, Start-/Endzeiten
- Standardwerte für neue Törnse (letzter Eintrag wird geladen)
- Mehrere Törnse parallel verwaltbar

```
Datensatz: {
  id, name, startDate, startTime, endDate, endTime,
  skipper, ship (name, type, reg, engine),
  crew: [{name, role, joined}],
  logEntries: [],
  status: "aktiv" | "abgeschlossen"
}
```

### 2. **Logbuch-Einträge**
- GPS-Position, Windstärke (Knoten + Beaufort), Windrichtung
- Ereignistypen: Motor an, Segeln, Wende, Halse, Ankern, Anlegen, MOB, etc.
- WMO-Wettercodes (Open-Meteo API)
- Freie Textnotizen und Rudergänger-Auswahl

```
Eintrag: {
  zeit, typ, pos: {lat, lon},
  weather: {windKnots, windForce, windDirection, description},
  rudergaenger, text
}
```

**MOB (Mann über Bord) – Spezialbehandlung:**
- Ereignistyp `MOB` wird als kritisches Ereignis behandelt
- Automatischer GPS-Fix beim Auslösen (aktuelle Position wird sofort erfasst)
- Status-Anzeige: "🆘 MOB aktiv" im Header
- Hinweis: Zukünftig könnte Alarm/Sound-Warnung ingebaut werden
- GPS-Position wird als Referenzpunkt für Such-Radius gespeichert

### 3. **GPS & Wetter**
- **GPS-Abfrage:** On-Demand per Button + automatisch beim Eintrag
  - Timeout: 8 Sekunden, High Accuracy: nein
  - Fallback: Manuelle Wind-Eingabe
- **Wetter-API:** Open-Meteo
  - Aktuelle Daten: Windgeschwindigkeit (kn), Windrichtung (°), WMO-Code
  - Conversion: m/s → Beaufort, Grad → Himmelsrichtung (N, NE, E, ...)
  - Cache: Kein Cache (no-store)

### 4. **Statistik & Übersicht**
- Motor-Laufzeit, Segelzeit, Fahrt-Zustände
- Crew-Leistung nach Stunden/Rollen
- KPI: Durchschnittswind, Max-Windstärke, Eventanzahl

### 5. **Kartendarstellung**
- Leaflet.js mit OpenStreetMap
- Live-Track: Positionen der Log-Einträge
- Marker nach Ereignistyp farbcodiert
- Mausrad-Zoom, Fullscreen-Option

### 6. **Datenspeicherung**
- **LocalStorage:** Törnse, Crew, Einstellungen
- **Versioning:** Manuelle Backups als JSON-Export
- **Version-Check:** Auto-Update-Prüfung (version.json)

**Crew-Rollen (vordeffinierte Liste):**
- Skipper – Leitung, Navigation
- Co-Skipper – Stellvertreter Skipper
- Rudergänger – Steuermann/Helmsmann
- Wache – allgemeine Crew
- Maschinist – Motor/Technik
- Segel – Segelmanoever
- Logführer – Dokumentation
- Wachführer – Wach-Koordination
- Navigator – Kartenwerk/GPS
- (Custom-Rollen möglich)

---

## 🔧 Technische Anforderungen

### Berechtigungen (Android)
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

### Dependencies
- `@capacitor/core` – Native Android Bridge
- `@capacitor/cli` – Build-Tools
- Leaflet.js (lokale Version) – Kartendarstellung
- Open-Meteo API – Wetterdaten

### Umgebung
- Java 21 (OpenJDK)
- Android SDK 34+ (API Level 34-36)
- Gradle 8.x
- Node.js 18+

---

## 📊 Logik-Flows

### Flow 1: Neuer Logbuch-Eintrag
1. Benutzer wählt Ereignistyp
2. Zeit wird automatisch mit Systemzeit vorbelegt
3. **GPS-Abfrage** (auf Basis von zuletzt gespeicherten Koordinaten oder On-Demand)
4. **Wetter-API-Abfrage** wenn GPS erfolgreich:
   - Konvertierung m/s → Beaufort
   - Konvertierung Grad → Himmelsrichtung
5. Wind-Felder werden vorbelegt
6. Benutzer kann manuell überschreiben
7. Speichern → LocalStorage

### Flow 2: Fahrt-Zustand
Der Fahrt-Zustand leitet sich ab aus:
- Letztes Ereignis vom Typ: "Motor an" → **Motorfahrt**
- Letztes Ereignis vom Typ: "Segeln" → **Segelfahrt**
- Kein Ereignis in der Fahrt → **unbek. Antrieb**

**Einschränkungen pro Zustand:**
- Nur im Hafen: "Ablegen" erlaubt
- Nur vor Anker: "Anker lichten" erlaubt
- Nur während der Fahrt: "Anlegen", "Ankern", "Wende", "Halse", "Reffen" erlaubt

### Flow 3: Wetter-Daten
```
GPS (geolocation API)
  ↓
Open-Meteo API (lat, lon)
  ↓
Rohdaten: {windspeed_10m (m/s), winddirection_10m (°), weathercode (WMO)}
  ↓
Transformation:
  - m/s → Beaufort (Tabelle BFT_MS)
  - m/s → Knoten (* 1.94384)
  - ° → Windrichtung (N, NE, E, ...)
  - WMO → Wetterbeschreibung (Klar, Regen, Gewitter, ...)
  ↓
Anzeige im Log-Formular
```

---

## 🛡️ Fehlerbehandlung

| Fehler | Verhalten |
|--------|-----------|
| GPS nicht verfügbar | Disabling Input, Benutzer kann manuell eingeben |
| API-Fehler (Wetter) | `null`-Rückgabe, Felder bleiben leer |
| Netzwerk offline | `fetch()` wirft Exception, wird caught |
| Ungültige Koordinaten | Logs mit `NaN` oder fehlender Position |

---

## 🎨 UI-Komponenten

### Hauptseiten
1. **📋 Törn** – Aktives Törn bearbeiten
2. **🗂 Alle Törnse** – Übersicht + Auswahl
3. **👥 Crew** – Crew-Verwaltung
4. **⚓ Bord** – Live-Logbuch
5. **🗺 Karte** – Track-Visualisierung
6. **📊 Statistik** – Auswertungen
7. **⚙️ Einstellungen** – App-Konfiguration

### Interaktive Elemente
- **Tab-Navigation:** Seitenumschaltung via `seitenWechseln(tabId)`
- **Sidebar:** Akkordeon-Struktur, Mobile-freundlich
- **Modals:** Bestätigungsdialoge für kritische Aktionen
- **Lade-Indikatoren:** GPS/API-Abfragen

---

## 💾 Datenschema (LocalStorage)

```javascript
// Beispiel Schlüssel
"toerne"              // Array von Törn-Objekten
"aktuellerToernId"    // String: ID des gerade bearbeiteten Törns
"letzteWerte"         // {wind, rudergaenger, windTs}
"userSettings"        // {nachtmodus, ...}
"versionInfo"         // {version}
```

---

## 📦 Export-Format (JSON-Backup)

**Dateiname:** `segellogbuch-backup-YYYY-MM-DD.json`

```json
{
  "exportVersion": "2.5.151",
  "exportDate": "2026-06-30T15:45:30Z",
  "toerne": [
    {
      "id": "toern-001",
      "name": "Urlaubstörn Mallorca",
      "started": "2026-06-15T08:00:00Z",
      "ended": "2026-06-20T18:30:00Z",
      "skipper": "Max Mustermann",
      "ship": {
        "name": "Santa Maria",
        "type": "Segelyacht",
        "registry": "DE-1234",
        "engine": "Diesel 30kW"
      },
      "crew": [
        { "name": "Anna Schmidt", "role": "Co-Skipper", "joined": "2026-06-15T08:00:00Z" },
        { "name": "Bob Fischer", "role": "Rudergänger", "joined": "2026-06-15T08:00:00Z" }
      ],
      "logEntries": [
        {
          "zeit": "2026-06-15T10:30:00Z",
          "typ": "Ablegen",
          "pos": { "lat": 39.5432, "lon": 2.7654 },
          "weather": { "windKnots": 12.5, "windForce": 4, "windDirection": "NW", "description": "Bewölkt" },
          "rudergaenger": "Bob Fischer",
          "text": "Lichtung vom Anleger, Wind NW 12 kn"
        }
      ],
      "notes": "Großartig gelaufen!"
    }
  ]
}
```

---

## ✔️ Eingabe-Validierung

| Feld | Regel | Fehler-Verhalten |
|------|-------|------------------|
| **Windstärke (Knoten)** | `≥ 0 und ≤ 40` | Feld blinkt rot, Speichern deaktiviert |
| **Beaufort** | `0-12` | Auto-berechnet, ungültig bei Fehler |
| **GPS-Koordinaten** | Lat: `-90 to 90`, Lon: `-180 to 180` | Warnung, aber Speichern möglich (Fallback) |
| **Datum/Zeit** | ISO-Format oder Input-Feld-Fehler | Browser-Validation + Fallback auf Systemzeit |
| **Crew-Name** | `min. 2 Zeichen, max. 50` | Input-Begrenzung |
| **Ereignistyp** | Aus vordefinierter Liste | Dropdown erzwingt Auswahl |

**Fehlerbehandlung:**
- Negative Windstärken: Abgelehnt (Input `type="number" min="0"`)
- Leere Pflichtfelder: Speichern blockiert
- Ungültige GPS-Daten: Lokal gespeichert, aber Karte zeigt Warnung
- Korrupte JSON beim Import: Rollback zu Last-Known-Good-State

---

## 🔄 Update-Mechanismus

1. **Version-Check:** `fetch("version.json?t=" + Date.now())`
   - Cache-Busting via Query-String
   - Vergleich mit `APP_VERSION` in `config.js`
2. **Verfügbar-Hinweis:** Button "🔄 Update" in der UI
3. **Force-Update:** Neuladen mit `window.location.replace()`

---

## 🚀 Deployment

### Build-Schritte
```bash
# 1. Web-Assets synchronisieren
npx cap sync android

# 2. Java/Android Setup
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"

# 3. Build Debug-APK
cd android
./gradlew assembleDebug

# 4. Installiere auf Gerät
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 5. (Optional) Release Build
./gradlew assembleRelease
# → signieren (Play Store)
```

### Capacitor-Konfiguration
```json
{
  "appId": "at.algether.segellogbuch",
  "appName": "Segellogbuch",
  "webDir": "www",
  "plugins": {
    "Geolocation": {
      "timeout": 8000
    }
  }
}
```

---

## ✅ Implementierungs-Checkliste

| Feature | Status | Datei(en) |
|---------|--------|-----------|
| Törn-CRUD | ✅ | app.js, storage.js |
| Log-Einträge | ✅ | app.js, storage.js |
| GPS-Integration | ✅ | app.js (formWetterVorbelegen, gpsAbfragen) |
| Wetter-API | ✅ | app.js (wetterVonApi) |
| Beaufort-Conversion | ✅ | app.js (msToBft) |
| Kartendarstellung | ✅ | karte.js |
| Statistik | ✅ | statistik.js |
| LocalStorage | ✅ | storage.js |
| Version-Check | ✅ | config.js |
| Android-Permissions | ✅ | AndroidManifest.xml |
| Capacitor-Setup | ✅ | capacitor.config.json |

---

## 📝 Notizen für Entwicklung

1. **GPS Timeout:** 8 Sekunden kann zu kurz sein bei schlechtem Empfang → ggf. erhöhen
2. **Wind-Einheiten:** App nutzt Knoten und Beaufort – konsistent halten
3. **WMO-Codes:** Mapping in `wettercodeZuText()` könnte erweitert werden
4. **Offline-Mode:** Keine Synchronisierung mit einer Remote-DB (rein lokal)
5. **Multisprachigkeit:** Aktuell nur Deutsch, englische Versionen denkbar

---

## 🎨 App-Icon & Branding

**Icon-Anforderungen für Play Store:**
- **App Icon:** 512×512 px, PNG, quadratisch
- **Feature Graphic:** 1024×500 px, PNG
- **Screenshots:** Mind. 2 pro Gerät-Kategorie (Phone, Tablet)

**Aktuell installiert:**
- Launcher-Icon: in `android/app/src/main/res/mipmap-*/ic_launcher.png` (verschiedene Dpi-Versionen)
- Round Icon: `ic_launcher_round.xml` (Material Design)

**Branding-Elemente:**
- Haupt-Farbe: `#0f4c81` (Navy-Blau, nautisch)
- Akzent: Segelschiff-Emoji ⛵
- App-Name: "Segellogbuch" (ohne Leerzeichen)

---

## 🔒 Datenschutz & Sicherheit

**GPS-Daten:**
- ✅ Nur lokal auf dem Gerät gespeichert (LocalStorage)
- ✅ Keine Telemetrie oder Cloud-Sync
- ✅ Benutzer hat volle Kontrolle über Daten (Export/Löschen möglich)
- ⚠️ **Hinweis:** Bei Play Store Publikation: Datenschutzerklärung erforderlich (auch für lokale Daten)
  - GPS wird nur bei **explizitem Benutzer-Aufruf** abgerufen
  - Keine Hintergrund-Tracking
  - Keine Weitergabe an Dritte

**DSGVO-Konformität:**
- Recht auf Löschung: Export + Manuelles Löschen möglich
- Recht auf Auskunft: Export als JSON (alle Pers. Daten)
- Recht auf Datenportabilität: JSON-Export als Backup

---

## ⚡ Performance & Skalierbarkeit

**LocalStorage-Limits:**
- Typischer Limit: ~5-10 MB pro App (Android)
- Segellogbuch bei ~1000 Log-Einträgen: ~0.5-1 MB
- **Skalierung:** Kein Problem bis ~50 Törnse à 100 Einträge

**Optimierungen bei vielen Einträgen:**
- Lazy-Loading bei Statistik-Berechnung vermeiden
- Karte: Nur sichtbare Marker rendern (Leaflet-Clustering bei 500+ Einträgen)
- LocalStorage-Archivierung: Alte Törnse in separaten Dateien (manuell per Export/Import)

**Bekannte Limits:**
- Kartendarstellung verlangsamt sich bei >1000 gleichzeitigen Markern
- CSV-Export großer Törnse braucht ~1-2 Sekunden
- Statistik-Berechnung über alle Törnse: O(n) Komplexität

---

## 🔗 Quellen & APIs

- **Geolocation API:** [MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- **Open-Meteo:** [Forecast API](https://open-meteo.com/en/docs/forecast-api)
- **WMO Codes:** [Wikipedia List](https://en.wikipedia.org/wiki/Weather_code)
- **Beaufort-Skala:** [Wikipedia](https://de.wikipedia.org/wiki/Beaufortskala)
- **Leaflet.js:** [Documentation](https://leafletjs.com/)
- **Capacitor:** [Android Guide](https://capacitorjs.com/docs/android)

---

**Zuletzt aktualisiert:** 30. Juni 2026  
**App-Version:** 2.5.151
