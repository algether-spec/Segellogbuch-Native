/* ======================
   STORAGE.JS
   localStorage-Verwaltung – zentrale Datenhaltung
====================== */

const KEY_TOERNS          = "segel_logbuch_toerns";
const KEY_AUTOBACKUP      = "segel_logbuch_autobackup";
const KEY_PERMANENT_BACKUP = "segel_logbuch_backup_permanent";
const KEY_LETZTE_WERTE    = "last_values";
const KEY_AKTIVER_TOERN   = "segel_logbuch_aktiver_toern";
const KEY_STOPP           = "segel_logbuch_stopp";
const KEY_SONNENMODUS     = "segel_sonnenmodus";
const KEY_PWA_MIGRATION   = "pwa_migration_done";


/* --- Hilfsfunktion ---------------------------------------------- */

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}


/* --- Törns ------------------------------------------------------ */

function ladeToerns() {
    try {
        const raw = localStorage.getItem(KEY_TOERNS);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function speichereToerns(toerns) {
    localStorage.setItem(KEY_TOERNS, JSON.stringify(toerns));
}

/* Wrapper – bestehende Aufrufe in app.js bleiben kompatibel */
function alleToernsLaden() { return ladeToerns(); }

function toernSpeichern(toern) {
    if (!toern) return;
    const alle = ladeToerns();
    const idx = alle.findIndex(t => t.tripId === toern.tripId);
    idx >= 0 ? alle[idx] = toern : alle.push(toern);
    speichereToerns(alle);
}

function toernLoeschen(tripId) {
    const verbleibend = ladeToerns().filter(t => t.tripId !== tripId);
    speichereToerns(verbleibend);
}

function neuerToern() {
    return {
        tripId: generateId(),
        tripName: "",
        startDate: "",
        startTime: "",
        endDate: "",
        endTime: "",
        skipper: "",
        crew: [],
        shipData: {
            name: "",
            type: "",
            registration: "",
            engine: ""
        },
        generalWeather: {
            windForce: "",
            windDirection: "",
            seaState: "",
            visibility: "",
            clouds: ""
        },
        notes: "",
        stoppZustand: "hafen",
        events: [],
        track: {
            enabled: false,
            intervalSeconds: 60,
            startedAt: "",
            stoppedAt: "",
            source: "device_gps",
            points: []
        }
    };
}


/* --- Export / Import -------------------------------------------- */

async function exportJSON() {
    /* Auswahl-Dialog: Alle Törns oder nur aktueller */
    const wahl = await new Promise(resolve => {
        const ov = document.createElement("div");
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center";
        const hatAktuell = !!(typeof aktuellerToern !== "undefined" ? aktuellerToern : null);
        ov.innerHTML = `
            <div style="background:#fff;border-radius:18px;padding:28px 24px;max-width:340px;width:92%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.25)">
                <h3 style="margin:0 0 6px;color:#1a3a5c;font-size:18px">💾 Backup JSON</h3>
                <p style="margin:0 0 20px;color:#64748b;font-size:14px">Was soll gesichert werden?</p>
                <button id="bk-all" style="width:100%;padding:13px;border:none;border-radius:12px;background:#1a3a5c;color:#fff;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer">🗂 Alle Törns sichern</button>
                ${hatAktuell ? `<button id="bk-cur" style="width:100%;padding:13px;border:none;border-radius:12px;background:#dbeafe;color:#1d4ed8;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer">⛵ Aktueller Törn: ${(typeof aktuellerToern !== "undefined" ? aktuellerToern : null).tripName || '(ohne Name)'}</button>` : ""}
                <button id="bk-cancel" style="width:100%;padding:10px;border:none;background:none;color:#94a3b8;font-size:14px;cursor:pointer">Abbrechen</button>
            </div>`;
        document.body.appendChild(ov);
        ov.querySelector("#bk-all").onclick    = () => { document.body.removeChild(ov); resolve("alle"); };
        if (hatAktuell) ov.querySelector("#bk-cur").onclick = () => { document.body.removeChild(ov); resolve("aktuell"); };
        ov.querySelector("#bk-cancel").onclick = () => { document.body.removeChild(ov); resolve(null); };
    });

    if (!wahl) return;

    let toerns, filename;
    if (wahl === "aktuell") {
        if (!(typeof aktuellerToern !== "undefined" ? aktuellerToern : null)) { if (window.statusSetzen) statusSetzen("Kein aktiver Törn.", "error", 3000); return; }
        toerns = [(typeof aktuellerToern !== "undefined" ? aktuellerToern : null)];
        const name = ((typeof aktuellerToern !== "undefined" ? aktuellerToern : null).tripName || "toern")
            .replace(/[^a-z0-9äöüÄÖÜß_\- ]/gi, "").trim().replace(/\s+/g, "_").slice(0, 30);
        filename = `segellogbuch_toern_${name}_${new Date().toISOString().slice(0, 10)}.json`;
    } else {
        toerns   = ladeToerns();
        filename = `segellogbuch_backup_${new Date().toISOString().slice(0, 10)}.json`;
    }

    const json = JSON.stringify({ toerns }, null, 2);

    if (window.saveFileNative && await saveFileNative(filename, json)) {
        if (typeof _shareFileNative === "function") {
            await _shareFileNative(filename);
            if (window.statusSetzen) statusSetzen("Backup gespeichert – Teilen gestartet.", "ok", 5000);
        } else {
            if (window.statusSetzen) statusSetzen(`Gespeichert: ${filename}`, "ok", 6000);
        }
        return;
    }

    /* Browser-Fallback */
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    if (window.statusSetzen) statusSetzen(`Heruntergeladen: ${filename}`, "ok", 5000);
}

function importJSON(data) {
    const toerns = data && Array.isArray(data.toerns) ? data.toerns
        : Array.isArray(data) ? data
        : null;
    if (!toerns) throw new Error("Ungültiges Format");

    /* Doppelte tripIds erkennen – innerhalb der Datei UND gegen vorhandene Törns */
    const vorhandeneIds = new Set(ladeToerns().map(t => t.tripId));
    const gesehenIds = new Set();
    toerns.forEach(t => {
        if (!t.tripId || gesehenIds.has(t.tripId) || vorhandeneIds.has(t.tripId)) {
            t.tripId = generateId();
        }
        gesehenIds.add(t.tripId);
    });

    speichereToerns(toerns);
    return toerns.length;
}


/* --- Letzte Werte ----------------------------------------------- */

function ladeLetzteWerte() {
    try {
        const raw = localStorage.getItem(KEY_LETZTE_WERTE);
        return raw ? JSON.parse(raw) : { wind: "", rudergaenger: "" };
    } catch { return { wind: "", rudergaenger: "" }; }
}

function speichereLetzteWerte(wind, rudergaenger) {
    const windTs = wind ? Date.now() : 0;
    localStorage.setItem(KEY_LETZTE_WERTE, JSON.stringify({ wind, rudergaenger, windTs }));
}


/* --- Aktiver Törn ----------------------------------------------- */

function speichereAktivenToern(tripId) {
    if (tripId) localStorage.setItem(KEY_AKTIVER_TOERN, tripId);
    else        localStorage.removeItem(KEY_AKTIVER_TOERN);
}

function ladeAktivenToernId() {
    return localStorage.getItem(KEY_AKTIVER_TOERN) || null;
}


/* --- Auto-Backup ------------------------------------------------ */

function autoBackupSpeichern() {
    const toerns = ladeToerns();
    if (toerns.length === 0) return;
    const backup = {
        timestamp: new Date().toISOString(),
        toerns
    };
    try {
        const json = JSON.stringify(backup);
        localStorage.setItem(KEY_AUTOBACKUP, json);
        localStorage.setItem(KEY_PERMANENT_BACKUP, json); /* immer beide aktuell halten */
    } catch { /* Storage voll – ignorieren */ }
}

function backupLaden() {
    try {
        const raw = localStorage.getItem(KEY_AUTOBACKUP);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function backupWiederherstellen(backup) {
    speichereToerns(backup.toerns);
}


/* --- Permanentes Backup (überlebt normale Updates) -------------- */

function permanentBackupSpeichern() {
    const toerns = ladeToerns();
    if (toerns.length === 0) return;
    try {
        localStorage.setItem(KEY_PERMANENT_BACKUP, JSON.stringify({
            timestamp: new Date().toISOString(),
            toerns
        }));
    } catch { /* Storage voll */ }
}

function permanentBackupLaden() {
    try {
        const raw = localStorage.getItem(KEY_PERMANENT_BACKUP);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/* Prüft beim Start ob Daten fehlen aber Backup vorhanden.
   Wenn ja: automatisch wiederherstellen.
   Wenn nein: Backup aktualisieren.
   Gibt true zurück wenn Wiederherstellung stattfand. */
function permanentBackupPruefen() {
    const toerns = ladeToerns();
    if (toerns.length > 0) {
        permanentBackupSpeichern(); /* Backup immer aktuell halten */
        return false;
    }
    const backup = permanentBackupLaden();
    if (backup && Array.isArray(backup.toerns) && backup.toerns.length > 0) {
        speichereToerns(backup.toerns);
        return true;
    }
    return false;
}


/* --- Migration (einmalig beim Start) ---------------------------- */

(function migrieren() {
    /* Alten Backup-Key übernehmen */
    const altBackupKey = "segel_logbuch_backup";
    if (!localStorage.getItem(KEY_AUTOBACKUP) && localStorage.getItem(altBackupKey)) {
        localStorage.setItem(KEY_AUTOBACKUP, localStorage.getItem(altBackupKey));
    }
    const altKey = "segel_logbuch_trips";
    const alt = localStorage.getItem(altKey);
    if (alt && !localStorage.getItem(KEY_TOERNS)) {
        localStorage.setItem(KEY_TOERNS, alt);
        localStorage.removeItem(altKey);
    }
    /* Veralteten separaten Crew-Key entfernen */
    localStorage.removeItem("segel_logbuch_crew");
})();


/* --- Fahrt-Zustand ---------------------------------------------- */

function ladeStoppZustand() {
    /* Rückwärtskompatibel: altes im_hafen-Flag migrieren */
    if (localStorage.getItem("segel_logbuch_im_hafen") === "true") {
        localStorage.setItem(KEY_STOPP, "hafen");
        localStorage.removeItem("segel_logbuch_im_hafen");
    }
    return localStorage.getItem(KEY_STOPP) || "hafen";
}

function speichereStoppZustand(val) {
    localStorage.setItem(KEY_STOPP, val);
}


/* --- Sonnenmodus ------------------------------------------------ */

function ladeSonnenmodus() {
    return localStorage.getItem(KEY_SONNENMODUS) === "1";
}

function speichereSonnenmodus(aktiv) {
    localStorage.setItem(KEY_SONNENMODUS, aktiv ? "1" : "0");
}


/* --- PWA-Migration ---------------------------------------------- */

function ladeMigrationFlag() {
    return !!localStorage.getItem(KEY_PWA_MIGRATION);
}

function speichereMigrationFlag() {
    localStorage.setItem(KEY_PWA_MIGRATION, "1");
}
