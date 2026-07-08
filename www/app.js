/* ======================
   APP.JS
   Logik und UI-Steuerung
====================== */

let aktuellerToern      = null;
let _trackAnzeigeTimer  = null;

/* --- DOM-Elemente ----------------------------------------------- */

const toernSelect       = document.getElementById("toern-select");
const btnNeuerToern     = document.getElementById("btn-neuer-toern");
const btnToernLoeschen  = document.getElementById("btn-toern-loeschen");
const btnSpeichern      = document.getElementById("btn-speichern");

const fldTripName   = document.getElementById("fld-tripname");
const fldStartDate  = document.getElementById("fld-start-date");
const fldStartTime  = document.getElementById("fld-start-time");
const fldEndDate    = document.getElementById("fld-end-date");
const fldEndTime    = document.getElementById("fld-end-time");
const fldSkipper    = document.getElementById("fld-skipper");

const fldShipName   = document.getElementById("fld-ship-name");
const fldShipType   = document.getElementById("fld-ship-type");
const fldShipReg    = document.getElementById("fld-ship-reg");
const fldShipEngine = document.getElementById("fld-ship-engine");

const fldNotes      = document.getElementById("fld-notes");

const crewList      = document.getElementById("crew-list");
const crewInput     = document.getElementById("crew-input");
const crewRole      = document.getElementById("crew-role");
const btnCrewAdd    = document.getElementById("btn-crew-add");

const statusMsg       = document.getElementById("status-msg");
const formSection     = document.getElementById("form-section");
const toernUebersicht      = document.getElementById("toern-uebersicht");
const toernStatistik       = document.getElementById("toern-statistik");
const toernAbschlussDiv    = document.getElementById("toern-abschluss");
const abschlussDruckBereich = document.getElementById("abschluss-druck-bereich");

const logZeit         = document.getElementById("log_zeit");
const logTyp          = document.getElementById("log_typ");
const logWind         = document.getElementById("log_wind");
const logWindDir      = document.getElementById("log_wind_dir");
const logRudergaenger = document.getElementById("rudergaenger");
const logText         = document.getElementById("log_text");
const logListe        = document.getElementById("log-liste");
const btnNeuerLog     = document.getElementById("btn-neuer-log");
const btnLogSpeichern = document.getElementById("btn-log-speichern");


/* --- Hilfsfunktionen -------------------------------------------- */

/**
 * ISO-String "2026-03-18T14:35" → "18.03. 14:35" (lokale Formatierung)
 * Leerer String bei fehlendem Wert.
 */
function formatDatum(d) {
    if (!d) return "";
    return d.slice(8) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
}

function formatDatumZeit(iso) {
    if (!iso) return "";
    const d = iso.slice(0, 10);
    const t = iso.slice(11, 16);
    const datum = d && d !== "0000-00-00" ? d.slice(8) + "." + d.slice(5, 7) + "." : "";
    return t ? (datum ? datum + " " + t : t) : datum;
}

/**
 * Liefert den ISO-Zeitstring eines Events.
 * Neue Events haben ev.zeit, alte ev.date + ev.time.
 */
function evZeitIso(ev) {
    const iso = ev.zeit || ((ev.date || "") + "T" + (ev.time || "00:00"));
    /* Sekunden normalisieren: 16-Zeichen-Format ("...T14:35") → 19 Zeichen ("...T14:35:00") */
    return iso.length === 16 ? iso + ":00" : iso;
}

/* ISO-Datum "2026-03-19" → "19.03.2026" */
function isoZuDatum(iso) {
    if (!iso || iso.length < 10) return iso || "";
    return iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
}

/* ev.weather → "7.3 kn" oder Fallback "3 Bft" oder "" */
function windText(w) {
    if (!w) return "";
    if (w.windKnots != null)                              return w.windKnots + " kn";
    if (w.windForce !== null && w.windForce !== undefined) return w.windForce + " Bft";
    return "";
}

/* ev.pos → "52.1234, 9.5678" oder "" */
function posText(ev) {
    if (!ev.pos || ev.pos.lat == null || ev.pos.lon == null) return "";
    return ev.pos.lat.toFixed(4) + ", " + ev.pos.lon.toFixed(4);
}

function isNativeFileSavingAvailable() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
}

function stringToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

async function saveFileNative(filename, content) {
    if (!isNativeFileSavingAvailable()) return false;
    try {
        await Capacitor.Plugins.Filesystem.writeFile({
            path: filename,
            data: stringToBase64(content),
            directory: "DOCUMENTS",
            recursive: true
        });
        return true;
    } catch (error) {
        console.error("Native file save failed:", error);
        return false;
    }
}

/* Zeigt Lade- und Erfolgs-Feedback auf einem Export-Button während einer async Aktion */
async function exportMitFeedback(btn, fn) {
    if (!btn || btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ Läuft…";
    let erfolg = false;
    try {
        await fn();
        erfolg = true;
    } catch (err) {
        console.error("Export-Fehler:", err);
    } finally {
        if (erfolg) {
            btn.textContent = "✅ Fertig";
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = original;
            }, 1800);
        } else {
            btn.textContent = original;
            btn.disabled = false;
        }
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* Beaufort → Knoten (Untergrenze jeder Bft-Stufe in m/s × 1.94384) */
const BFT_MS = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
function bftZuKnoten(bft) {
    const ms = BFT_MS[Math.max(0, Math.min(12, bft))] ?? 0;
    return Math.round(ms * 1.94384 * 10) / 10;
}

/* m/s → Beaufort */
function msToBft(ms) {
    if (ms <  0.3) return 0;
    if (ms <  1.6) return 1;
    if (ms <  3.4) return 2;
    if (ms <  5.5) return 3;
    if (ms <  8.0) return 4;
    if (ms < 10.8) return 5;
    if (ms < 13.9) return 6;
    if (ms < 17.2) return 7;
    if (ms < 20.8) return 8;
    if (ms < 24.5) return 9;
    if (ms < 28.5) return 10;
    if (ms < 32.7) return 11;
    return 12;
}

/* Grad → Himmelsrichtung */
function gradZuRichtung(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/* WMO Wettercode → Kurztext */
function wettercodeZuText(code) {
    if (code === 0)                return "Klar";
    if (code <= 3)                 return "Bewölkt";
    if (code <= 48)                return "Nebel";
    if (code <= 55)                return "Nieselregen";
    if (code <= 65)                return "Regen";
    if (code <= 77)                return "Schnee";
    if (code <= 82)                return "Schauer";
    if (code <= 86)                return "Schneeschauer";
    if (code <= 99)                return "Gewitter";
    return "";
}

/* Open-Meteo API → { windForce, windDirection, description } oder null */
async function wetterVonApi(lat, lon) {
    try {
        const url = "https://api.open-meteo.com/v1/forecast"
            + "?latitude=" + lat + "&longitude=" + lon
            + "&current=windspeed_10m,winddirection_10m,weathercode"
            + "&windspeed_unit=kn";
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        const data = await res.json();
        const c = data.current;
        if (!c) return null;
        const kn = c.windspeed_10m ?? 0;
        return {
            windForce:     msToBft(kn / 1.94384),
            windKnots:     Math.round(kn * 10) / 10,
            windDirection: gradZuRichtung(c.winddirection_10m ?? 0),
            description:   c.weathercode != null ? wettercodeZuText(c.weathercode) : ""
        };
    } catch { return null; }
}

const MODUS_MAP = {
    "Ankern":   "⚓ Vor Anker",
    "Anlegen":  "🏁 Im Hafen",
    "Ankunft":  "🏁 Im Hafen",
    "MOB":      "🆘 MOB aktiv"
};

/* Ereignistypen die den Fahrt-Zustand definieren */
const MOTOR_TYPEN = new Set(["Motor an"]);
const SEGEL_TYPEN = new Set(["Segeln"]); /* "Abfahrt" entfernt – Antrieb wird dynamisch ermittelt */

/* Erlaubte Fahrt-Zustände pro Ereignistyp */
const ERLAUBTE_ZUSTAENDE = {
    "Ablegen":       ["hafen"],
    "Anker lichten": ["anker"],
    "Von Boje":      ["boje"],
    "Anlegen":       ["fahrt"],
    "Ankern":        ["fahrt"],
    "An Boje":       ["fahrt"],
    "Wende":         ["fahrt"],
    "Halse":         ["fahrt"],
    "Reffen":        ["fahrt"],
    "Reffen 1":      ["fahrt"],
    "Reffen 2":      ["fahrt"],
    /* Motor an, Segeln, Ruderwechsel: kein Eintrag → immer erlaubt (LOGIK.md: "immer sichtbar") */
};


/* Kategorie-Mapping */
const KATEGORIE_MAP = {
    "Wende": "Segeln", "Halse": "Segeln", "Reffen": "Segeln", "Reffen 1": "Segeln", "Reffen 2": "Segeln",
    "Segel setzen": "Segeln", "Segel bergen": "Segeln",
    "Aufschießer": "Segeln", "Beidrehen": "Segeln", "Segeln": "Segeln",
    "Ablegen": "Motor", "Anlegen": "Motor", "Motor an": "Motor", "Motor aus": "Motor", "Motorsegeln": "Motor",
    "Drehen Motor": "Motor", "Box-Manöver": "Motor", "Mooring": "Motor",
    "Ankern": "Anker", "Anker lichten": "Anker",
    "An Boje": "Boje", "Von Boje": "Boje",
    "Ruderwechsel": "Allgemein", "Schiffsführerwechsel": "Allgemein", "Sichtung": "Allgemein",
    "MOB": "Allgemein", "Notfall": "Allgemein",
    "Sicherheitseinweisung": "Sicherheit",
    "Tageskontrolle": "Kontrolle",
    "Notiz": "Notiz"
};

function kategorieFuerTyp(typ) {
    return KATEGORIE_MAP[typ] || "Allgemein";
}

function antriebAusUI() {
    const btnS = document.getElementById("btn-zustand-segeln");
    const btnM = document.getElementById("btn-zustand-motor");
    if (btnS?.classList.contains("btn-zustand-aktiv")) return "segeln";
    if (btnM?.classList.contains("btn-zustand-aktiv")) return "motor";
    return null;
}

function antriebFuerTyp(typ) {
    if (typ === "Motorsegeln") return "motorsegeln";
    if (MOTOR_TYPEN.has(typ)) return "motor";
    if (SEGEL_TYPEN.has(typ)) return "segeln";
    /* Ablegen/Abfahrt: Zustand → UI-Buttons → Standardwert motor */
    if (typ === "Ablegen" || typ === "Abfahrt") {
        return zustandErmitteln()?.zustand || antriebAusUI() || "motor";
    }
    return zustandErmitteln()?.zustand || "";
}

function zustandErmitteln() {
    if (!aktuellerToern || !(aktuellerToern.events || []).length) return null;
    const sorted = aktuellerToern.events.slice().sort((a, b) =>
        evZeitIso(a) < evZeitIso(b) ? -1 : 1
    );
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].storniert) continue;
        const typ = sorted[i].type;
        if (typ === "Motorsegeln") return { zustand: "motorsegeln", event: sorted[i] };
        if (typ === "Motor aus")        return null;
        if (STOPP_EREIGNISSE?.[typ])    return null; /* Ankern/Anlegen/An Boje = Antrieb aus */
        if (MOTOR_TYPEN.has(typ))       return { zustand: "motor",        event: sorted[i] };
        if (SEGEL_TYPEN.has(typ))       return { zustand: "segeln",       event: sorted[i] };
    }
    return null;
}

function zustandAktualisieren() {
    const result = zustandErmitteln();
    const btnS = document.getElementById("btn-zustand-segeln");
    const btnM = document.getElementById("btn-zustand-motor");
    if (!btnS || !btnM) return;
    const istMotorsegeln = result?.zustand === "motorsegeln";
    btnS.classList.toggle("btn-zustand-aktiv", result?.zustand === "segeln" || istMotorsegeln);
    btnM.classList.toggle("btn-zustand-aktiv", result?.zustand === "motor"  || istMotorsegeln);

    /* Wende/Halse/Reffen bei Segeln oder Motorsegeln aktiv */
    const istSegeln = result?.zustand === "segeln" || istMotorsegeln;
    const btnWende  = document.getElementById("btn-wende");
    const btnHalse  = document.getElementById("btn-halse");
    const btnReffen = document.getElementById("btn-reffen");
    if (btnWende)  btnWende.disabled  = !istSegeln;
    if (btnHalse)  btnHalse.disabled  = !istSegeln;
    if (btnReffen) btnReffen.disabled = !istSegeln;

    /* Anlegen bei Motor oder Motorsegeln aktiv */
    const istMotor = result?.zustand === "motor" || istMotorsegeln;
    const btnAnlegen = document.getElementById("btn-anlegen");
    if (btnAnlegen) btnAnlegen.disabled = !istMotor;
}

function startButtonsSperren(stopp) {
    const btnAblegen      = document.querySelector(".btn-ablegen");
    const btnAnkerLichten = document.querySelector(".btn-anker-lichten");
    const btnVonBoje      = document.querySelector(".btn-von-boje");
    if (btnAblegen)      btnAblegen.disabled      = stopp !== "hafen";
    if (btnAnkerLichten) btnAnkerLichten.disabled = stopp !== "anker";
    if (btnVonBoje)      btnVonBoje.disabled      = stopp !== "boje";
}

function zustandSetzen(zustand) {
    const aktuell = zustandErmitteln()?.zustand;

    if (zustand === "motor") {
        if (aktuell === "motor") return;                          /* Radio: schon aktiv */
        if (aktuell === "motorsegeln") {
            notizUndSpeichern("Motor an", "Motorsegeln beendet, Motor läuft weiter"); return;
        }
        const note = aktuell === "segeln" ? "Motor gestartet" : "Motor an";
        notizUndSpeichern("Motor an", note);
    } else {
        if (aktuell === "segeln") return;                         /* Radio: schon aktiv */
        if (aktuell === "motorsegeln") {
            notizUndSpeichern("Segeln", "Motorsegeln beendet, Segel aktiv"); return;
        }
        const note = aktuell === "motor" ? "Motor gestoppt, Segel gesetzt" : "Segeln gesetzt";
        notizUndSpeichern("Segeln", note);
    }
}

function _motorsegelnBestaetigen() {
    if (document.getElementById("_ms-overlay")) return;   /* Doppelklick-Guard */
    const aktuell = zustandErmitteln()?.zustand;

    if (aktuell === "motorsegeln") {
        /* Motorsegeln beenden */
        const ov = document.createElement("div");
        ov.id = "_ms-overlay";
        ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-end;justify-content:center";
        ov.innerHTML = `
            <div style="background:#fff;border-radius:20px 20px 0 0;padding:22px 20px 30px;width:100%;max-width:480px">
                <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#1a3a5c;text-align:center">⚓ Motorsegeln beenden?</p>
                <p style="margin:0 0 18px;font-size:13px;color:#64748b;text-align:center">Kegel (▽) einholen · Segelbootstatus gilt wieder</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <button id="_ms-nein" style="padding:14px;border-radius:12px;background:#f1f5f9;color:#475569;border:none;font-size:15px;font-weight:700;cursor:pointer">Abbrechen</button>
                    <button id="_ms-ja"   style="padding:14px;border-radius:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;font-size:15px;font-weight:700;cursor:pointer">⛵ Nur Segeln</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        ov.querySelector("#_ms-ja").onclick   = () => { document.body.removeChild(ov); notizUndSpeichern("Segeln", "Motorsegeln beendet – Kegel eingeholt"); };
        ov.querySelector("#_ms-nein").onclick = () => document.body.removeChild(ov);
        ov.onclick = e => { if (e.target === ov) document.body.removeChild(ov); };
        return;
    }

    /* Motorsegeln starten – Bestätigungsdialog */
    const ov = document.createElement("div");
    ov.id = "_ms-overlay";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-end;justify-content:center";
    ov.innerHTML = `
        <div style="background:#fff;border-radius:20px 20px 0 0;padding:22px 20px 30px;width:100%;max-width:480px">
            <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#dc2626;text-align:center">⚓ Motorsegeln aktivieren?</p>
            <p style="margin:0 0 18px;font-size:13px;color:#64748b;text-align:center">Motor gibt Schub · Kegel (▽) am Mast hissen · kein Vorrecht als Segelboot</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <button id="_ms-nein" style="padding:14px;border-radius:12px;background:#f1f5f9;color:#475569;border:none;font-size:15px;font-weight:700;cursor:pointer">Abbrechen</button>
                <button id="_ms-ja"   style="padding:14px;border-radius:12px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;font-size:15px;font-weight:700;cursor:pointer">⚓ Ja, Kegel hissen</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#_ms-ja").onclick   = () => { document.body.removeChild(ov); notizUndSpeichern("Motorsegeln", "Motorsegeln – Kegel gehisst"); };
    ov.querySelector("#_ms-nein").onclick = () => document.body.removeChild(ov);
    ov.onclick = e => { if (e.target === ov) document.body.removeChild(ov); };
}

function _motorsegelnButtonSync() {
    const btn = document.getElementById("btn-zustand-motorsegeln");
    if (!btn) return;
    btn.classList.toggle("btn-zustand-aktiv", zustandErmitteln()?.zustand === "motorsegeln");
}

function _motorsegelnBeobachten() {
    const obs  = new MutationObserver(_motorsegelnButtonSync);
    const btnS = document.getElementById("btn-zustand-segeln");
    const btnM = document.getElementById("btn-zustand-motor");
    if (btnS) obs.observe(btnS, { attributes: true, attributeFilter: ["class"] });
    if (btnM) obs.observe(btnM, { attributes: true, attributeFilter: ["class"] });
}

function reffenAuswaehlen() {
    const div = document.getElementById("reffen-auswahl");
    if (div) div.hidden = !div.hidden;
}

function reffenKlick(typ) {
    const div = document.getElementById("reffen-auswahl");
    if (div) div.hidden = true;
    notizUndSpeichern(typ);
}

/* --- Stopp-Zustand (hafen / anker / boje / fahrt) --------------- */

const STOPP_TEXTE = { hafen: "🏁 Im Hafen", anker: "⚓ Vor Anker", boje: "🔵 An Boje" };
const STOPP_EREIGNISSE = { "Anlegen": "hafen", "Ankern": "anker", "An Boje": "boje" };
const START_EREIGNISSE = new Set(["Ablegen", "Anker lichten", "Von Boje"]);

function stoppZustandLaden() {
    return ladeStoppZustand();
}

function stoppZustandSpeichern(val) {
    speichereStoppZustand(val);
    if (aktuellerToern) aktuellerToern.stoppZustand = val;
}

function hafenSperrungAktualisieren(stopp) {
    const istStopp = stopp !== "fahrt";

    /* Start-Bar (Ablegen/Anker lichten/Von Boje) ↔ Stopp-Bar */
    const startBar  = document.getElementById("fahrt-start-bar");
    const stoppBar  = document.getElementById("fahrt-stopp-bar");
    if (startBar) startBar.hidden = !istStopp;
    if (stoppBar) stoppBar.hidden = istStopp;

    /* Manöver-Bereich: nur bei FAHRT sichtbar */
    const manoeverGrid = document.getElementById("manoever-grid");
    if (manoeverGrid) manoeverGrid.hidden = istStopp;
    /* Dropdown schließen wenn gestoppt */
    if (istStopp) { const dd = document.getElementById("ruder-dropdown"); if (dd) dd.hidden = true; }

    /* btn-schnell-sm in Weitere-Panel + Formular-Speichern-Button */
    document.querySelectorAll(".btn-schnell-sm").forEach(btn => {
        btn.disabled = istStopp;
    });
    /* btnLogSpeichern bleibt immer aktiv – Modal ermöglicht Nachträge auch bei STOPP */

    /* Wende/Halse/Reffen-Zustand immer aktualisieren, Track je nach Status */
    zustandAktualisieren();
    if (!istStopp) {
        trackStarten();
        clearInterval(_trackAnzeigeTimer);
        _trackAnzeigeTimer = setInterval(letzteTrackPunkteZeigen, 15000);
    } else {
        trackStoppen();
        liveMarkerEntfernen();
        clearInterval(_trackAnzeigeTimer);
        _trackAnzeigeTimer = null;
    }

    /* Statusleiste: Modus-Text überschreiben wenn gestoppt */
    const modus = document.getElementById("ls-modus");
    if (istStopp && modus) modus.textContent = STOPP_TEXTE[stopp] || "—";

    /* Status-Badge oben rechts */
    const badge     = document.getElementById("btn-fahrt-status");
    const badgeText = document.getElementById("btn-fahrt-status-text");
    if (badge && badgeText) {
        badgeText.textContent = istStopp ? "🔴 STOPP" : "🟢 FAHRT";
        badge.classList.toggle("btn-fahrt-stopp", istStopp);
        badge.classList.toggle("btn-fahrt-fahrt", !istStopp);
    }
}

function logbuchStatusAktualisieren() {
    const el = document.getElementById("logbuch-status");
    if (!el) return;
    if (!aktuellerToern || !(aktuellerToern.events || []).length) {
        el.hidden = true;
        hafenSperrungAktualisieren(stoppZustandLaden());
        startButtonsSperren(stoppZustandLaden());
        return;
    }
    const events = aktuellerToern.events.slice().sort((a, b) =>
        evZeitIso(a) < evZeitIso(b) ? -1 : 1
    );

    /* Modus + "seit" aus letztem Zustandsereignis */
    const zustandResult = zustandErmitteln();
    let modusText, seitIso;
    if (zustandResult) {
        modusText = zustandResult.zustand === "motor" ? "🔧 Motor" : "⛵ Segeln";
        seitIso   = evZeitIso(zustandResult.event);
    } else {
        const letztes = events[events.length - 1];
        modusText = MODUS_MAP[letztes.type] || letztes.type;
        seitIso   = evZeitIso(letztes);
    }
    document.getElementById("ls-modus").textContent = modusText;
    document.getElementById("ls-seit").textContent  = "seit " + (seitIso.slice(11, 16) || "—");

    /* Letztes Manöver – nur echte Manöver NACH dem letzten Zustandswechsel */
    const KEIN_MANOEVER = new Set([
        "Motor an", "Segeln", "Abfahrt",
        "Ablegen", "Anlegen", "Ankern", "Anker lichten",
        "An Boje", "Von Boje"
    ]);
    const letzterZustand = zustandResult ? evZeitIso(zustandResult.event) : "";
    const letztesManoever = [...events].reverse().find(e =>
        !KEIN_MANOEVER.has(e.type) &&
        (!letzterZustand || evZeitIso(e) > letzterZustand)
    );
    const manoeverWrap = document.getElementById("ls-manoever-wrap");
    if (manoeverWrap) {
        if (letztesManoever) {
            document.getElementById("ls-manoever").textContent = letztesManoever.type;
            manoeverWrap.hidden = false;
        } else {
            manoeverWrap.hidden = true;
        }
    }

    /* Rudergänger-Button aktualisieren */
    const mitRuder  = [...events].reverse().find(e => e.rudergaenger?.name && e.type !== "Schiffsführerwechsel");
    const aktRuder  = mitRuder ? mitRuder.rudergaenger.name : "";
    const btnRuder  = document.getElementById("btn-rudergaenger");
    if (btnRuder) btnRuder.textContent = aktRuder ? "👤 Rudergänger: " + aktRuder : "👤 Rudergänger: —";

    /* Wind aus letztem Eintrag mit Winddaten – Fallback auf last_values */
    const mitWind   = [...events].reverse().find(e =>
        e.weather?.windKnots != null || (e.weather?.windForce !== undefined && e.weather?.windForce !== null)
    );
    const lv        = ladeLetzteWerte() || {};
    const windWert  = mitWind
        ? (mitWind.weather.windKnots != null
            ? String(mitWind.weather.windKnots)
            : String(bftZuKnoten(mitWind.weather.windForce)))
        : (lv.wind || "");
    const windSelect = document.getElementById("ls-wind-select");
    const windWrap  = document.getElementById("ls-wind-wrap");
    if (windSelect) {
        windSelect.innerHTML = "";
        const emptyOpt = document.createElement("option");
        emptyOpt.value = ""; emptyOpt.textContent = "💨 —";
        windSelect.appendChild(emptyOpt);
        for (let i = 0; i <= 12; i++) {
            const kn = bftZuKnoten(i);
            const opt = document.createElement("option");
            opt.value = String(kn);
            opt.textContent = "💨 " + kn + " kn";
            if (String(kn) === windWert) opt.selected = true;
            windSelect.appendChild(opt);
        }
        if (windWrap) windWrap.hidden = false;
        /* last_values mit aktuellem Wind (kn) synchronisieren */
        if (windWert !== "") {
            speichereLetzteWerte(windWert, lv.rudergaenger || "");
        }
    }

    /* SOG aus letztem Eintrag mit Position und Geschwindigkeit */
    const mitSog   = [...events].reverse().find(e => e.pos != null);
    const sogWrap  = document.getElementById("ls-sog-wrap");
    const sogEl    = document.getElementById("ls-sog");
    if (sogWrap && sogEl) {
        if (mitSog) {
            sogEl.textContent = "🚀 " + (mitSog.pos.sog != null ? mitSog.pos.sog : "—") + " kn SOG";
            sogWrap.hidden = false;
        } else {
            sogWrap.hidden = true;
        }
    }

    /* Seemeilen gesamt und heute aus track.points */
    const trackPts   = aktuellerToern.track?.points || [];
    const nmGesamt   = trackDistanzNm(trackPts);
    const ptsHeute   = trackPts.filter(p => (p.zeit || "").slice(0, 10) === heuteIso());
    const nmHeute    = trackDistanzNm(ptsHeute);
    const nmGesamtWrap = document.getElementById("ls-nm-gesamt-wrap");
    const nmHeuteWrap  = document.getElementById("ls-nm-heute-wrap");
    if (nmGesamtWrap) {
        nmGesamtWrap.hidden = parseFloat(nmGesamt) === 0;
        document.getElementById("ls-nm-gesamt").textContent = "⚓ " + nmGesamt + " nm";
    }
    if (nmHeuteWrap) {
        nmHeuteWrap.hidden = parseFloat(nmHeute) === 0;
        document.getElementById("ls-nm-heute").textContent = "📅 " + nmHeute + " nm heute";
    }

    el.hidden = false;
    hafenSperrungAktualisieren(stoppZustandLaden());
    startButtonsSperren(stoppZustandLaden());
    antriebHinweisAktualisieren();
}

function antriebHinweisAktualisieren() {
    const btnS = document.getElementById("btn-zustand-segeln");
    const btnM = document.getElementById("btn-zustand-motor");
    const fahrtOhneAntrieb = stoppZustandLaden() === "fahrt" && zustandErmitteln() === null;
    [btnS, btnM].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle("antrieb-hinweis", fahrtOhneAntrieb);
    });
}

function statusSetzen(text, typ = "ok", ms = 3000) {
    statusMsg.textContent = text;
    statusMsg.className = "status-msg status-" + typ;
    statusMsg.hidden = !text;
    if (text) setTimeout(() => { statusMsg.hidden = true; }, ms);
}

function logLadeStatusSetzen(text, ms = 3000) {
    const el = document.getElementById("log-lade-status");
    if (!el) return;
    /* "✅ gespeichert" und leerer Text → Spinner ausblenden, kein Toast */
    if (!text || text.startsWith("✅")) {
        el.hidden = true;
        return;
    }
    /* "⏳ GPS…" → Spinner anzeigen (kein Text, nur CSS-Animation) */
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, ms);
}

function validieren() {
    if (!fldTripName.value.trim()) {
        statusSetzen("Törnname darf nicht leer sein.", "error");
        fldTripName.focus();
        return false;
    }
    if (!fldSkipper.value.trim()) {
        statusSetzen("Schiffsführer darf nicht leer sein.", "error");
        fldSkipper.focus();
        return false;
    }
    return true;
}


/* --- Törnauswahl ------------------------------------------------ */

function toernSelectAktualisieren() {
    const alle = alleToernsLaden();
    toernSelect.innerHTML = '<option value="">— Törn auswählen —</option>';
    alle.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.tripId;
        opt.textContent = t.tripName || "(ohne Name)";
        if (t.startDate) opt.textContent += "  · " + formatDatum(t.startDate);
        toernSelect.appendChild(opt);
    });
    if (aktuellerToern) toernSelect.value = aktuellerToern.tripId;
    toernUebersichtRendern();
}


/* --- Formular füllen / lesen ------------------------------------ */

function formularFuellen(toern) {
    fldTripName.value   = toern.tripName   || "";
    fldStartDate.value  = toern.startDate  || "";
    fldStartTime.value  = toern.startTime  || "";
    fldEndDate.value    = toern.endDate    || "";
    fldEndTime.value    = toern.endTime    || "";
    fldSkipper.value    = toern.skipper    || "";
    fldShipName.value   = toern.shipData?.name         || "";
    fldShipType.value   = toern.shipData?.type         || "";
    fldShipReg.value    = toern.shipData?.registration || "";
    fldShipEngine.value = toern.shipData?.engine       || "";
    fldNotes.value      = toern.notes || "";
    crewListeRendern(toern.crew || []);
    rudergaengerSelectFuellen();
    zeigeLogs();
    statistikDatumFilterRendern(toern);
    toernStatistikRendern(toernStatistikBerechnen(toern));
    toernAbschlussRendern(toernAbschlussBerechnen(toern));
    tabInhaltToggeln();
}

function formularLesen() {
    aktuellerToern.tripName  = fldTripName.value.trim();
    aktuellerToern.startDate = fldStartDate.value;
    aktuellerToern.startTime = fldStartTime.value;
    aktuellerToern.endDate   = fldEndDate.value;
    aktuellerToern.endTime   = fldEndTime.value;
    aktuellerToern.skipper   = fldSkipper.value.trim();
    aktuellerToern.shipData  = {
        name:         fldShipName.value.trim(),
        type:         fldShipType.value.trim(),
        registration: fldShipReg.value.trim(),
        engine:       fldShipEngine.value.trim()
    };
    aktuellerToern.notes = fldNotes.value.trim();
}


/* --- Crew ------------------------------------------------------- */

function crewListeRendern(crew) {
    crewList.innerHTML = "";
    if (crew.length === 0) {
        crewList.innerHTML = '<li class="crew-empty">Noch keine Crew eingetragen.</li>';
        return;
    }
    crew.forEach(person => {
        const li = document.createElement("li");
        li.className = "crew-item";

        const info = document.createElement("span");
        info.className = "crew-info";
        info.textContent = person.name + (person.role ? " · " + person.role : "");

        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn-crew-del";
        del.textContent = "✕";
        del.onclick = () => {
            aktuellerToern.crew = aktuellerToern.crew.filter(c => c.id !== person.id);
            toernSpeichern(aktuellerToern);
            autoBackupSpeichern();
            backupStatusAktualisieren();
            crewListeRendern(aktuellerToern.crew);
            rudergaengerSelectFuellen();
        };

        li.appendChild(info);
        li.appendChild(del);
        crewList.appendChild(li);
    });
}

function crewHinzufuegen() {
    const name = crewInput.value.trim();
    if (!name) {
        statusSetzen("Crew-Name darf nicht leer sein.", "error");
        crewInput.focus();
        return;
    }
    const person = {
        id:   generateId(),
        name,
        role: crewRole.value.trim() || "Crew"
    };
    aktuellerToern.crew.push(person);
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    crewListeRendern(aktuellerToern.crew);
    rudergaengerSelectFuellen();
    crewInput.value = "";
    crewRole.value  = "Crew";
    crewInput.focus();
}


/* --- Ereignisse ------------------------------------------------- */

function formWetterVorbelegen() {
    if (!navigator.geolocation || !aktuellerToern) return;
    if (stoppZustandLaden() !== "fahrt") return;
    const ladeEl = document.getElementById("wind-loading");
    /* ⏳ Loading-State */
    if (ladeEl) ladeEl.hidden = false;
    logWind.value = "";
    if (logWindDir) logWindDir.value = "";
    logWind.disabled    = true;
    if (logWindDir) logWindDir.disabled = true;

    navigator.geolocation.getCurrentPosition(
        async pos => {
            /* GPS → API → Felder */
            const w = await wetterVonApi(pos.coords.latitude, pos.coords.longitude);
            if (w) {
                logWind.value = String(w.windKnots);
                if (logWindDir) logWindDir.value = w.windDirection;
            }
            logWind.disabled    = false;
            if (logWindDir) logWindDir.disabled = false;
            if (ladeEl) ladeEl.hidden = true;
        },
        () => {
            /* GPS verweigert – Felder freigeben */
            logWind.disabled    = false;
            if (logWindDir) logWindDir.disabled = false;
            if (ladeEl) ladeEl.hidden = true;
        },
        { maximumAge: 30000, timeout: 8000, enableHighAccuracy: false }
    );
}

function logZeitVorbefuellen() {
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    logZeit.value = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate())
        + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
}

function rudergaengerSelectFuellen() {
    /* Nur Crew des aktiven Törns */
    const alle = aktuellerToern ? (aktuellerToern.crew || []).map(p => p.name).filter(Boolean) : [];

    logRudergaenger.innerHTML = '<option value="">— Rudergänger —</option>';
    if (alle.length === 0) {
        logRudergaenger.disabled = true;
        logRudergaenger.title    = "Bitte zuerst Crew hinzufügen";
        return;
    }
    logRudergaenger.disabled = false;
    logRudergaenger.title    = "";
    alle.forEach(name => {
        const opt = document.createElement("option");
        opt.value       = name;
        opt.textContent = name;
        logRudergaenger.appendChild(opt);
    });
    /* Punkt 3: Bei genau 1 Crew-Mitglied automatisch vorauswählen */
    if (alle.length === 1) logRudergaenger.value = alle[0];
}

function zeigeLogs() {
    const _scrollY = window.scrollY;
    if (!aktuellerToern) { logListe.innerHTML = ""; return; }
    let events = (aktuellerToern.events || []).slice().sort((a, b) =>
        evZeitIso(a) > evZeitIso(b) ? -1 : evZeitIso(a) < evZeitIso(b) ? 1 : 0
    );
    if (_logFilter === "heute") {
        const heute = heuteIso();
        events = events.filter(ev => evZeitIso(ev).slice(0, 10) === heute);
    }
    if (events.length === 0) {
        logListe.innerHTML = '<div class="card"><p class="event-empty">Noch keine Einträge.</p></div>';
    } else {
        const zeilen = events.map(ev => {
            const w     = ev.weather;
            const wind  = windText(w);
            const sogWert = ev.pos?.sog ?? 0;
            const sog   = sogWert > 0 ? sogWert + " kn SOG" : "";
            const ruder = ev.rudergaenger ? ev.rudergaenger.name : "";
            const zeit  = formatDatumZeit(evZeitIso(ev)) || "—";
            const kat = ev.kategorie || kategorieFuerTyp(ev.type);
            const KAT_ICON    = { "Segeln": "⛵", "Motor": "🔧", "Anker": "⚓", "Boje": "🔵" };
            const antriebIcon = ev.antrieb === "segeln" ? "⛵"
                              : ev.antrieb === "motor"  ? "🔧"
                              : ev.antrieb == null      ? KAT_ICON[kat] || ""
                              : ""; /* ev.antrieb === "" → kein Icon */
            const STOPP_ICON  = { "Ankern": "⚓", "An Boje": "🔵", "Anlegen": "🏠" };
            const stoppIcon   = STOPP_ICON[ev.type] || "";
            const info    = [zeit, ev.type, antriebIcon, stoppIcon, wind, sog, ruder].filter(Boolean).join("  ·  ");

            let posHtml = "";
            if (ev.pos && ev.pos.lat != null && ev.pos.lon != null) {
                const mapsUrl  = "https://maps.google.com/?q=" + ev.pos.lat + "," + ev.pos.lon;
                const latDisp  = ev.pos.lat.toFixed(4);
                const lonDisp  = ev.pos.lon.toFixed(4);
                const sog      = ev.pos.sog != null && ev.pos.sog > 0 ? "  ·  " + ev.pos.sog + " kn" : "";
                posHtml = `<a class="event-pos" href="${mapsUrl}" target="_blank" rel="noopener">📍 ${latDisp}, ${lonDisp}${sog}</a>`;
            }

            const istStorniert = !!ev.storniert;
            const itemKlasse   = istStorniert ? "event-item event-item-storniert" : "event-item";
            const btnKlasse    = istStorniert ? "btn-crew-restore" : "btn-crew-del";
            const btnSymbol    = istStorniert ? "↺" : "✕";
            return `<li class="${itemKlasse}">
                <span class="event-info">
                    <span class="event-time-label">${info}</span>
                    ${ev.note ? '<span class="event-note-text">' + ev.note + '</span>' : ''}
                    ${posHtml}
                    ${ev.unterschrift ? '<img src="' + ev.unterschrift + '" style="display:block;max-width:100%;height:60px;margin-top:6px;border-radius:6px;border:1px solid var(--border);background:#fff">' : ''}
                </span>
                <button type="button" class="${btnKlasse}" data-id="${ev.id}">${btnSymbol}</button>
            </li>`;
        }).join("");
        logListe.innerHTML = `<ul class="log-liste-ul" style="list-style:none;display:flex;flex-direction:column;gap:6px;margin-bottom:14px">${zeilen}</ul>`;
        logListe.querySelectorAll("[data-id]").forEach(btn => {
            btn.onclick = () => {
                const _ev = aktuellerToern.events.find(e => e.id === btn.dataset.id);
                if (!_ev) return;
                if (_ev.storniert) delete _ev.storniert; /* Wiederherstellen */
                else _ev.storniert = true;               /* Stornieren */
                toernSpeichern(aktuellerToern);
                autoBackupSpeichern();
                backupStatusAktualisieren();
                zeigeLogs();
            };
        });
    }
    statistikDatumFilterRendern(aktuellerToern);
    toernStatistikRendern(toernStatistikBerechnen(aktuellerToern));
    toernAbschlussRendern(toernAbschlussBerechnen(aktuellerToern));
    logbuchStatusAktualisieren();
    logVorschauAktualisieren();
    letzteTrackPunkteZeigen();
    requestAnimationFrame(() => { window.scrollTo(0, _scrollY); logScrollHoeheAnpassen(); });
}

function letzteTrackPunkteZeigen() {
    const el = document.getElementById("letzte-trackpunkte");
    if (!el) return;
    const alle = (aktuellerToern?.track?.points || [])
        .slice()
        .sort((a, b) => a.zeit < b.zeit ? -1 : 1);
    if (!alle.length) { el.hidden = true; return; }
    el.hidden = false;

    /* Zusammenfassung: letzter Punkt */
    const letzt = alle[alle.length - 1];
    const lZeit = letzt.zeit ? letzt.zeit.slice(11, 16) : "—";
    const lSog  = letzt.sog != null ? letzt.sog + " kn" : "—";
    const lAcc  = letzt.accuracy != null ? "±" + Math.round(letzt.accuracy) + " m" : "";

    /* Detail: letzte 5 Punkte */
    const detail = alle.slice(-5).reverse().map(p => {
        const zeit = p.zeit ? p.zeit.slice(11, 19) : "—";
        const sog  = p.sog != null ? p.sog + " kn" : "— kn";
        const acc  = p.accuracy != null ? "±" + Math.round(p.accuracy) + " m" : "—";
        return `<span class="ltp-zeile">${zeit} · ${sog} · ${acc}</span>`;
    }).join("");

    el.innerHTML = `
        <details class="ltp-details">
            <summary class="ltp-summary">
                📍 ${alle.length} Punkte &nbsp;·&nbsp; zuletzt ${lZeit} &nbsp;·&nbsp; ${lSog}${lAcc ? " &nbsp;·&nbsp; " + lAcc : ""}
            </summary>
            <div class="ltp-detail-liste">${detail}</div>
        </details>`;
}

function logVorschauAktualisieren() {
    const el = document.getElementById("log-vorschau");
    if (!el) return;
    if (!aktuellerToern || !(aktuellerToern.events || []).length) {
        el.hidden = true;
        return;
    }
    const letzten = (aktuellerToern.events || [])
        .slice()
        .sort((a, b) => evZeitIso(a) > evZeitIso(b) ? -1 : evZeitIso(a) < evZeitIso(b) ? 1 : 0)
        .slice(0, 3);
    const KAT_ICON = { "Segeln": "⛵", "Motor": "🔧", "Anker": "⚓", "Boje": "🔵" };
    el.innerHTML = letzten.map(ev => {
        const zeit = evZeitIso(ev).slice(11, 16) || "—";
        const antriebIcon = ev.antrieb === "segeln" ? "⛵"
                          : ev.antrieb === "motor"  ? "🔧"
                          : ev.antrieb == null ? (KAT_ICON[ev.kategorie] || "") : "";
        const ruder = ev.rudergaenger?.name || "";
        const wind  = windText(ev.weather);
        const teile = [ev.type, antriebIcon, ruder, wind].filter(Boolean).join(" · ");
        return `<div class="log-vorschau-zeile">
            <span class="log-vorschau-zeit">${zeit}</span>
            <span class="log-vorschau-info">${teile}</span>
        </div>`;
    }).join("");
    el.hidden = false;
}

function logModalOeffnen() {
    logZeitVorbefuellen();
    rudergaengerSelectFuellen();
    const letzte = ladeLetzteWerte() || {};
    if (letzte.rudergaenger) logRudergaenger.value = letzte.rudergaenger;
    if (stoppZustandLaden() === "fahrt") formWetterVorbelegen();
    const overlay = document.getElementById("log-modal-overlay");
    if (overlay) overlay.style.display = "flex";
}

function logModalSchliessen() {
    const overlay = document.getElementById("log-modal-overlay");
    if (overlay) overlay.style.display = "none";
}

function logEintragSpeichern() {
    if (!aktuellerToern) {
        statusSetzen("Bitte zuerst einen Törn auswählen.", "error");
        return;
    }
    if (!logZeit.value) {
        statusSetzen("Zeit ist ein Pflichtfeld.", "error");
        logZeit.focus();
        return;
    }
    const windKn     = logWind.value !== "" ? parseFloat(logWind.value) : NaN;
    const windDirVal = logWindDir ? logWindDir.value : "";
    const ev = {
        id:           generateId(),
        type:         logTyp.value,
        kategorie:    kategorieFuerTyp(logTyp.value),
        antrieb:      antriebFuerTyp(logTyp.value),
        zeit:         logZeit.value.length === 16 ? logZeit.value + ":00" : logZeit.value,
        ort:          "",
        rudergaenger: logRudergaenger.value ? { name: logRudergaenger.value } : null,
        note:         logText.value.trim(),
        weather:      !isNaN(windKn) ? { windForce: msToBft(windKn / 1.94384), windKnots: windKn, windDirection: windDirVal, description: "" } : null
    };
    if (!aktuellerToern.events) aktuellerToern.events = [];
    aktuellerToern.events.push(ev);
    if (STOPP_EREIGNISSE[ev.type]) stoppZustandSpeichern(STOPP_EREIGNISSE[ev.type]);
    else if (START_EREIGNISSE.has(ev.type)) stoppZustandSpeichern("fahrt");
    gpsAbfragen(ev);
    speichereLetzteWerte(!isNaN(windKn) ? String(windKn) : "", logRudergaenger.value);
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    zeigeLogs();
    logText.value         = "";
    logRudergaenger.value = "";
    logWind.value         = "";
    if (logWindDir) logWindDir.value = "";
    logModalSchliessen();
    statusSetzen("Eintrag gespeichert.", "ok");
}



/* --- Aktionen --------------------------------------------------- */

function toernLaden(tripId) {
    try {
    trackStoppen();
    liveMarkerEntfernen();
    if (_logbuchKarte) { _logbuchKarte.remove(); _logbuchKarte = null; }
    _logbuchLiveMarker = null;
    _logbuchLiveCircle = null;
    _logbuchAnsicht = "daten";
    const _btnD = document.getElementById("btn-logbuch-daten");
    if (_btnD) _btnD.classList.add("aktiv");
    const _kc = document.getElementById("logbuch-karte-container");
    if (_kc) _kc.style.display = "none";
    const _ds = document.getElementById("logbuch-daten-scroll");
    if (_ds) _ds.style.display = "";
    const alle = alleToernsLaden();
    const toern = alle.find(t => t.tripId === tripId);
    if (!toern) return;
    aktuellerToern = toern;
    /* Bestehende Einträge ohne Kategorie/Antrieb nachrüsten */
    const sorted = (aktuellerToern.events || []).slice().sort((a, b) =>
        evZeitIso(a) < evZeitIso(b) ? -1 : 1
    );
    let letzterAntrieb = "";
    sorted.forEach(ev => {
        if (!ev.kategorie) ev.kategorie = kategorieFuerTyp(ev.type);
        if (MOTOR_TYPEN.has(ev.type)) letzterAntrieb = "motor";
        else if (SEGEL_TYPEN.has(ev.type)) letzterAntrieb = "segeln";
        if (!ev.antrieb) ev.antrieb = letzterAntrieb;
    });
    formSection.hidden = false;
    btnToernLoeschen.hidden = false;
    formularFuellen(aktuellerToern);
    toernSelectAktualisieren();
    stoppZustandSpeichern(toern.stoppZustand || "hafen");
    hafenSperrungAktualisieren(toern.stoppZustand || "hafen");
    speichereAktivenToern(tripId);
    /* Rudergänger aus Törn-Events laden, Fallback auf last_values */
    const _lvT = ladeLetzteWerte() || {};
    const _letzterRuderEv = [...(toern.events || [])].reverse().find(e => e.rudergaenger?.name);
    speichereLetzteWerte(_lvT.wind || "", _letzterRuderEv ? _letzterRuderEv.rudergaenger.name : (_lvT.rudergaenger || ""));
    /* Logbuch + Log direkt initialisieren (kein Tab-Wechsel mehr nötig) */
    logZeitVorbefuellen();
    tabInhaltToggeln();
    logbuchStatusAktualisieren();
    zeigeLogs();
    sicherheitSeiteAktualisieren();
    kontrolleSeiteAktualisieren();
    } catch(e) {
        alert("toernLaden Fehler: " + e.message + "\n" + e.stack);
    }
}

function neuerToernAnlegen() {
    trackStoppen();
    aktuellerToern = neuerToern();
    const _lvN = ladeLetzteWerte() || {};
    speichereLetzteWerte(_lvN.wind || "", ""); /* Rudergänger für neuen Törn leeren */
    const _btnR = document.getElementById("btn-rudergaenger");
    if (_btnR) _btnR.textContent = "👤 Rudergänger: —";
    formularFuellen(aktuellerToern);
    formSection.hidden = false;
    btnToernLoeschen.hidden = true;
    toernSelect.value = "";
    stoppZustandSpeichern("hafen");
    hafenSperrungAktualisieren("hafen");
    startButtonsSperren("hafen");
    fldTripName.focus();
    statusSetzen("Neuer Törn angelegt.", "ok");
}

function toernSpeichernAktion() {
    if (!aktuellerToern) return;
    if (!validieren()) return;
    formularLesen();
    /* Schiffsführer automatisch in Crew eintragen falls noch nicht vorhanden */
    const skipperName = aktuellerToern.skipper?.trim();
    if (skipperName) {
        if (!aktuellerToern.crew) aktuellerToern.crew = [];
        const bereitsVorhanden = aktuellerToern.crew.some(c => c.name === skipperName);
        if (!bereitsVorhanden) {
            aktuellerToern.crew.unshift({ id: generateId(), name: skipperName, role: "Schiffsführer" });
            crewListeRendern(aktuellerToern.crew);
        }
    }
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    toernSelectAktualisieren();
    tabInhaltToggeln();
    btnToernLoeschen.hidden = false;
    statusSetzen("Törn gespeichert.", "ok");
}

function toernLoeschenAktion() {
    if (!aktuellerToern) return;
    if (!confirm(`Törn "${aktuellerToern.tripName || "(ohne Name)"}" wirklich löschen?`)) return;
    trackStoppen();
    toernLoeschen(aktuellerToern.tripId);
    aktuellerToern = null;
    speichereAktivenToern(null);
    formSection.hidden = true;
    btnToernLoeschen.hidden = true;
    toernSelect.value = "";
    tabInhaltToggeln();
    toernSelectAktualisieren();
    statusSetzen("Törn gelöscht.", "ok");
}


/* --- Druck / PDF ------------------------------------------------ */

async function druckenVorbereiten() {
    if (!aktuellerToern) return;
    const t = aktuellerToern;

    const sd       = t.shipData || {};
    const zeitraum = [t.startDate, t.endDate].filter(Boolean).map(formatDatum).join(" – ") || "—";
    const crew     = t.crew || [];
    const stat     = typeof toernStatistikBerechnen === "function" ? toernStatistikBerechnen(t) : null;
    const pts      = (t.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
    const routeSvg = typeof _routeAlsKartenSvg === "function" ? await _routeAlsKartenSvg(pts, 760, 320) : "";

    const events = (t.events || []).slice().sort((a, b) =>
        evZeitIso(a) < evZeitIso(b) ? -1 : evZeitIso(a) > evZeitIso(b) ? 1 : 0
    );

    /* Schiffdaten-Block */
    const schiffZeilen = [
        sd.name         ? `<tr><td>Schiff</td><td>${sd.name}</td></tr>` : "",
        sd.type         ? `<tr><td>Bootstyp</td><td>${sd.type}</td></tr>` : "",
        sd.registration ? `<tr><td>Kennzeichen</td><td>${sd.registration}</td></tr>` : "",
        sd.engine       ? `<tr><td>Motor</td><td>${sd.engine}</td></tr>` : ""
    ].filter(Boolean).join("");

    /* Crew-Block */
    const crewZeilen = crew.length
        ? crew.map(p => `<tr><td>${p.name || ""}</td><td>${p.role || ""}</td></tr>`).join("")
        : '<tr><td colspan="2">—</td></tr>';

    /* Statistik-Block */
    const fmt = typeof zeitFormatieren === "function" ? zeitFormatieren : m => m + " min";
    const zeitenZeilen = stat ? [
        ["Unter Segel", stat.unterSegel],
        ["Motorsegeln",  stat.mitMotorsegel],
        ["Mit Motor",   stat.mitMotor],
        ["Im Hafen",    stat.hafen],
        ["Vor Anker",   stat.anker]
    ].filter(([, m]) => m > 0)
     .map(([l, m]) => `<tr><td>${l}</td><td>${fmt(m)}</td></tr>`).join("") : "";

    /* Seemeilen pro Rudergänger */
    const nmRuderZeilen = stat ? Object.entries(stat.nmRuder || {})
        .sort((a, b) => b[1] - a[1])
        .map(([name, nm]) => `<tr><td>${name}</td><td>${nm} nm</td></tr>`).join("") : "";

    /* Ereignisse */
    const eventZeilen = events.map(ev => {
        const w   = ev.weather;
        const iso = evZeitIso(ev);
        const pos = posText(ev);
        const sog = ev.pos?.sog != null ? ev.pos.sog : "";
        return `<tr>
            <td>${ev.type || ""}</td>
            <td>${isoZuDatum(iso.slice(0, 10))}</td>
            <td>${iso.slice(11, 16)}</td>
            <td>${ev.ort || ""}</td>
            <td>${ev.rudergaenger ? ev.rudergaenger.name : ""}</td>
            <td>${windText(w)}</td>
            <td>${w ? w.windDirection || "" : ""}</td>
            <td>${w ? w.description || "" : ""}</td>
            <td>${ev.note || ""}</td>
            <td>${pos}</td>
            <td>${sog}</td>
        </tr>`;
    }).join("") || '<tr><td colspan="11" class="dp-leer">Keine Ereignisse vorhanden.</td></tr>';

    document.getElementById("druck-bereich").innerHTML = `
        <div class="dp-header">
            <h1>${t.tripName || "(ohne Name)"}</h1>
            <div class="dp-meta">
                <span>Zeitraum: ${zeitraum}</span>
                <span>Schiffsführer: ${t.skipper || "—"}</span>
            </div>
        </div>

        <div class="dp-info-grid">
            ${schiffZeilen ? `
            <div class="dp-info-block">
                <div class="dp-info-titel">Schiff</div>
                <table class="dp-info-tabelle">${schiffZeilen}</table>
            </div>` : ""}
            ${crew.length ? `
            <div class="dp-info-block">
                <div class="dp-info-titel">Crew (${crew.length})</div>
                <table class="dp-info-tabelle"><thead><tr><th>Name</th><th>Funktion</th></tr></thead><tbody>${crewZeilen}</tbody></table>
            </div>` : ""}
            ${zeitenZeilen ? `
            <div class="dp-info-block">
                <div class="dp-info-titel">Zeiten</div>
                <table class="dp-info-tabelle">${zeitenZeilen}</table>
            </div>` : ""}
            ${nmRuderZeilen ? `
            <div class="dp-info-block">
                <div class="dp-info-titel">Seemeilen pro Rudergänger</div>
                <table class="dp-info-tabelle">${nmRuderZeilen}</table>
            </div>` : ""}
        </div>

        ${t.notes ? `<div class="dp-notizen"><strong>Notizen:</strong> ${t.notes}</div>` : ""}

        <table class="dp-tabelle">
            <thead>
                <tr>
                    <th>Typ</th><th>Datum</th><th>Zeit</th><th>Ort</th>
                    <th>Rudergänger</th><th>Wind kn</th><th>Richtung</th>
                    <th>Wetter</th><th>Notiz</th><th>GPS</th><th>SOG kn</th>
                </tr>
            </thead>
            <tbody>${eventZeilen}</tbody>
        </table>

        <div class="dp-neue-seite"></div>
        <div class="dp-karte-wrapper">
            <div class="dp-info-titel" style="margin-top:0">Route</div>
            <div style="width:100%;margin-top:2mm">${routeSvg}</div>
        </div>

        <div class="dp-fusszeile">Segellogbuch · Erstellt am ${new Date().toLocaleDateString("de-DE")}</div>
    `;

    const bereich  = document.getElementById("druck-bereich");
    const filename = (`segellogbuch_druck_${(t.tripName || 'toern').replace(/[^a-z0-9\-\_ ]/gi, '')}_${new Date().toISOString().slice(0,10)}.pdf`).replace(/\s+/g, '_');

    bereich.style.position = "fixed";
    bereich.style.left = "-9999px";
    bereich.style.top = "0";
    bereich.style.display = "block";

    try {
        const blob = await _elementToPdfBlob(bereich);
        const saved = await _saveBlobNative(filename, blob);
        if (saved) {
            await _shareFileNative(filename);
            statusSetzen("PDF gespeichert und Teilen gestartet.", "ok", 5000);
        } else {
            downloadBlob(blob, filename);
            statusSetzen("PDF zum Download bereitgestellt.", "ok", 5000);
        }
    } catch (err) {
        console.error("PDF-Generierung fehlgeschlagen", err);
        statusSetzen("PDF-Generierung fehlgeschlagen.", "error", 6000);
    } finally {
        bereich.style.position = "";
        bereich.style.left = "";
        bereich.style.top = "";
        bereich.style.display = "";
        if (dpMap) { dpMap.remove(); dpMap = null; }
        setTimeout(() => { bereich.innerHTML = ""; }, 500);
    }
}


/* --- CSV-Export ------------------------------------------------- */

function csvFeldEscapen(wert) {
    const s = wert === null || wert === undefined ? "" : String(wert);
    return s.includes(";") || s.includes('"') || s.includes("\n")
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
}

async function csvExportieren() {
    if (!aktuellerToern) return;
    const t = aktuellerToern;
    const kopfzeile = "Toernname;Datum;Zeit;Typ;Kategorie;Antrieb;Ort;Rudergänger;Wind kn;Wind Bft;Wind Richtung;Wetter;Notiz;GPS;SOG kn";
    const zeilen = (t.events || [])
        .slice()
        .sort((a, b) =>
            evZeitIso(a) < evZeitIso(b) ? -1 : evZeitIso(a) > evZeitIso(b) ? 1 : 0
        )
        .map(ev => {
            const iso = evZeitIso(ev);
            return [
                t.tripName,
                isoZuDatum(iso.slice(0, 10)),
                iso.slice(11, 16),
                ev.type,
                ev.kategorie || kategorieFuerTyp(ev.type),
                ev.antrieb || "",
                ev.ort,
                ev.rudergaenger ? ev.rudergaenger.name : "",
                ev.weather ? (ev.weather.windKnots != null ? ev.weather.windKnots : "") : "",
                ev.weather ? (ev.weather.windForce !== null && ev.weather.windForce !== undefined ? ev.weather.windForce : "") : "",
                ev.weather ? ev.weather.windDirection : "",
                ev.weather ? ev.weather.description : "",
                ev.note,
                posText(ev),
                ev.pos != null ? (ev.pos.sog ?? 0) : ""
            ].map(csvFeldEscapen).join(";");
        });

    const inhalt = "\uFEFF" + [kopfzeile, ...zeilen].join("\r\n");
    const datum = new Date().toISOString().slice(0, 10);
    const name  = (t.tripName || "Toern").replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, "_");
    const filename = "Toern_" + name + "_" + datum + ".csv";

    if (await saveFileNative(filename, inhalt)) {
        statusSetzen(`CSV gespeichert unter ${filename}`, "ok", 5000);
        return;
    }

    const blob = new Blob([inhalt], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, filename);
}

async function trackCsvExportieren() {
    if (!aktuellerToern) return;
    const pts = (aktuellerToern.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
    if (!pts.length) { statusSetzen("Keine Track-Punkte vorhanden.", "error", 3000); return; }
    const kopfzeile = "zeit,lat,lon,sog_kn,accuracy_m";
    const zeilen = pts.map(p =>
        [p.zeit, p.lat, p.lon, p.sog ?? "", p.accuracy ?? ""].join(",")
    );
    const inhalt = "\uFEFF" + [kopfzeile, ...zeilen].join("\r\n");
    const datum = new Date().toISOString().slice(0, 10);
    const name  = (aktuellerToern.tripName || "Toern").replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, "_");
    const filename = "track_" + name + "_" + datum + ".csv";

    if (await saveFileNative(filename, inhalt)) {
        statusSetzen(`Track CSV gespeichert unter ${filename}`, "ok", 5000);
        return;
    }

    const blob = new Blob([inhalt], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, filename);
}


/* --- Schnellbuttons --------------------------------------------- */

function gpsUndWetterHolen(timeoutMs) {
    return new Promise(resolve => {
        const done = setTimeout(() => resolve(null), timeoutMs);
        if (!navigator.geolocation) { clearTimeout(done); resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            async pos => {
                clearTimeout(done);
                const lat = parseFloat(pos.coords.latitude.toFixed(5));
                const lon = parseFloat(pos.coords.longitude.toFixed(5));
                const sog = pos.coords.speed != null
                    ? parseFloat((pos.coords.speed * 1.94384).toFixed(1)) : null;
                const [weather, ort] = await Promise.all([
                    wetterVonApi(lat, lon),
                    ortBestimmen(lat, lon)
                ]);
                resolve({ lat, lon, sog, weather, ort: ort || "" });
            },
            () => { clearTimeout(done); resolve(null); },
            { maximumAge: 10000, timeout: timeoutMs, enableHighAccuracy: true }
        );
    });
}

const ANTRIEB_PFLICHT_TYPEN = new Set(["Ablegen", "Abfahrt", "Anker lichten", "Von Boje"]);

function antriebAktiv() {
    return zustandErmitteln() !== null || antriebAusUI() !== null;
}

function eventErlaubt(typ, zustand) {
    const erlaubt = ERLAUBTE_ZUSTAENDE[typ];
    if (!erlaubt) return true;
    if (!erlaubt.includes(zustand)) return false;
    if (ANTRIEB_PFLICHT_TYPEN.has(typ) && !antriebAktiv()) return false;
    return true;
}


function antriebKonsistenzPruefen(typ, antrieb) {
    if (["Wende", "Halse", "Reffen", "Reffen 1", "Reffen 2"].includes(typ) && antrieb !== "segeln" && antrieb !== "motorsegeln") {
        return `⚠️ „${typ}" nur bei aktivem Segeln möglich`;
    }
    return null;
}

function validierungsWarnung(meldung) {
    const toast = document.createElement("div");
    toast.className = "validierung-toast";
    toast.textContent = meldung;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function rudergaengerButtonShake() {
    const btn = document.getElementById("btn-rudergaenger");
    if (!btn) return;
    btn.classList.remove("btn-rudergaenger-shake");
    void btn.offsetWidth; /* Reflow – Animation neu starten */
    btn.classList.add("btn-rudergaenger-shake");
    setTimeout(() => btn.classList.remove("btn-rudergaenger-shake"), 500);
}

async function schnellEintragSpeichern(typ) {
    const _zustand = stoppZustandLaden();
    const _antrieb = zustandErmitteln()?.zustand ?? "";

    if (!eventErlaubt(typ, _zustand)) {
        validierungsWarnung(`„${typ}" ist im Zustand „${_zustand}" nicht möglich`);
        return;
    }
    const _antriebHinweis = antriebKonsistenzPruefen(typ, _antrieb);
    if (_antriebHinweis) validierungsWarnung(_antriebHinweis);

    if (!aktuellerToern) {
        statusSetzen("Bitte zuerst einen Törn auswählen.", "error");
        return;
    }
    const letzte  = ladeLetzteWerte() || {};
    const ruder   = letzte.rudergaenger || "";
    const zeitIso = lokalZeitIso();

    if (!ruder) {
        validierungsWarnung("Bitte zuerst Rudergänger auswählen");
        rudergaengerButtonShake();
        return;
    }

    /* _pendingNote vor Schritt 1 sichern; Auto-Notiz für Anlegen/Ablegen */
    let note = _pendingNote;
    _pendingNote = "";
    const _antriebJetzt = zustandErmitteln()?.zustand;
    if (!note) {
        if (["Anlegen", "Ankern", "An Boje"].includes(typ) && (_antriebJetzt === "segeln" || _antriebJetzt === "motorsegeln"))
            note = "Segel geborgen";
        else if (["Ablegen", "Von Boje", "Anker lichten"].includes(typ)) {
            if (_antriebJetzt === "segeln")          note = "Segeln aktiv";
            else if (_antriebJetzt === "motorsegeln") note = "Motorsegeln";
            /* Motor war schon an: keine Note → kein Verwirrungs-Doppelklick */
        }
    }

    /* 1. Event sofort erstellen — ohne GPS/Wetter */
    const ev = {
        id:           generateId(),
        type:         typ,
        kategorie:    kategorieFuerTyp(typ),
        antrieb:      antriebFuerTyp(typ),
        zeit:         zeitIso,
        ort:          "",
        rudergaenger: ruder ? { name: ruder } : null,
        note:         note,
        weather:      null,
        pos:          null
    };

    if (!aktuellerToern.events) aktuellerToern.events = [];
    aktuellerToern.events.push(ev);

    /* Automatisch "Motor aus" wenn Stopp-Event bei aktivem Motor */
    if (STOPP_EREIGNISSE[typ] && (_antriebJetzt === "motor" || _antriebJetzt === "motorsegeln")) {
        aktuellerToern.events.push({
            id: generateId(), type: "Motor aus", kategorie: "Motor", antrieb: "",
            /* +1s für Sortierung; toLocaleString("sv") = Lokalzeit (wie lokalZeitIso) */
            zeit: new Date(new Date(zeitIso).getTime() + 1000).toLocaleString("sv").replace(" ", "T"),
            ort: "", rudergaenger: ruder ? { name: ruder } : null,
            note: "Motor gestoppt beim " + typ, weather: null, pos: null
        });
    }

    /* 2. Stopp-Zustand sofort setzen */
    if (STOPP_EREIGNISSE[typ])          stoppZustandSpeichern(STOPP_EREIGNISSE[typ]);
    else if (START_EREIGNISSE.has(typ)) stoppZustandSpeichern("fahrt");

    /* 3. UI sofort aktualisieren */
    zeigeLogs();

    /* 4. Sofort speichern */
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();

    if (typ === "MOB") {
        statusSetzen("🆘 MOB – Mann über Bord! Zeit: " + ev.zeit.slice(11, 16), "error", 10000);
    } else {
        logLadeStatusSetzen("✅ " + typ + " gespeichert.", 2000);
    }

    /* 5. GPS/Wetter nachträglich (fire-and-forget) */
    gpsUndWetterHolen(3000).then(gps => {
        if (!gps) return;
        ev.pos     = { lat: gps.lat, lon: gps.lon, sog: gps.sog };
        ev.weather = gps.weather || null;
        ev.ort     = gps.ort || "";
        if (ev.pos) trackManöverPunkt(ev.pos.lat, ev.pos.lon, ev.pos.sog, ev.zeit);
        if (gps.weather) speichereLetzteWerte(String(gps.weather.windKnots), ruder);
        toernSpeichern(aktuellerToern);
    }).catch(() => {});
}


/* --- Sidebar ---------------------------------------------------- */

function hamburgerKlick() {
    if (_aktiveSeitenId) {
        seitenWechseln(null);
    } else {
        if (_aktiverHauptTab === "tab-karte") {
            hauptTabWechseln("tab-logbuch");
        }
        sidebarOeffnen();
    }
}

function sidebarOeffnen() {
    document.getElementById("sidebar").classList.add("sidebar-open");
    document.getElementById("sidebar-overlay").classList.add("sidebar-open");
}

function sidebarSchliessen() {
    document.getElementById("sidebar").classList.remove("sidebar-open");
    document.getElementById("sidebar-overlay").classList.remove("sidebar-open");
}

/* Sidebar schließen: Overlay antippen (click + touchend für iOS) */
(function () {
    const overlay = document.getElementById("sidebar-overlay");
    overlay.addEventListener("click",      () => sidebarSchliessen());
    overlay.addEventListener("touchend",   e  => { e.preventDefault(); sidebarSchliessen(); });

    /* Swipe nach links schließt Sidebar */
    let _xStart = null;
    const sidebar = document.getElementById("sidebar");
    sidebar.addEventListener("touchstart", e => {
        _xStart = e.touches[0].clientX;
    }, { passive: true });
    sidebar.addEventListener("touchend", e => {
        if (_xStart === null) return;
        if (_xStart - e.changedTouches[0].clientX > 60) sidebarSchliessen();
        _xStart = null;
    }, { passive: true });

    /* Escape-Taste */
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") sidebarSchliessen();
    });
})();

/* --- Seitennavigation ------------------------------------------- */

let _aktiveSeitenId  = null;
let _aktiverHauptTab = "tab-logbuch";
let _logFilter            = "gesamt";
let _karteFilter          = "gesamt";
let _karteBearbeitenModus = false;

function heuteIso() {
    return new Date().toLocaleString("sv").slice(0, 10);
}

/* Lokale Zeit als ISO-String "YYYY-MM-DDTHH:MM:SS" – nie UTC */
function lokalZeitIso() {
    return new Date().toLocaleString("sv").replace(" ", "T");
}

function logFilterSetzen(filter) {
    _logFilter = filter;
    document.getElementById("log-filter-gesamt")?.classList.toggle("filter-btn-aktiv", filter === "gesamt");
    document.getElementById("log-filter-heute")?.classList.toggle("filter-btn-aktiv", filter === "heute");
    zeigeLogs();
}

function karteFilterSetzen(filter) {
    _karteFilter = filter;
    document.getElementById("karte-filter-gesamt")?.classList.toggle("filter-btn-aktiv", filter === "gesamt");
    document.getElementById("karte-filter-heute")?.classList.toggle("filter-btn-aktiv", filter === "heute");
    if (aktuellerToern) karteTabRendern(aktuellerToern);
}

function karteBearbeitenToggeln() {
    _karteBearbeitenModus = !_karteBearbeitenModus;
    if (aktuellerToern) karteTabRendern(aktuellerToern);
}

function hauptTabWechseln(tabId) {
    const hauptTabs = ["tab-logbuch", "tab-log", "tab-karte"];
    _aktiverHauptTab = tabId;
    hauptTabs.forEach(id => {
        const p = document.getElementById(id);
        if (p) p.classList.toggle("tab-hidden", id !== tabId);
    });
    document.querySelectorAll(".haupt-tab-btn").forEach(b =>
        b.classList.toggle("haupt-tab-aktiv", b.dataset.tab === tabId)
    );
    /* Logbuch-Sticky nur beim Logbuch-Tab anzeigen */
    const sticky = document.getElementById("logbuch-sticky");
    if (sticky) sticky.hidden = !(!!aktuellerToern && !_aktiveSeitenId && tabId === "tab-logbuch");
    requestAnimationFrame(logbuchScrollHoeheAnpassen);
    if (tabId === "tab-log") requestAnimationFrame(logScrollHoeheAnpassen);
    /* Klick-Modus abbrechen wenn Karte verlassen */
    if (tabId !== "tab-karte" && _karteKlickModus) trackPunktHinzufuegen();
    /* Popup und Sidebar schließen wenn Karte verlassen */
    if (tabId !== "tab-karte" && _hauptKarte) {
        _hauptKarte.closePopup();
        sidebarSchliessen();
    }
    /* Karte rendern wenn Tab gewechselt */
    if (tabId === "tab-karte" && aktuellerToern) karteTabRendern(aktuellerToern);
}

function seitenWechseln(seiteId) {
    const seitenPanels = ["tab-toern", "tab-toernuebersicht", "tab-sicherheit", "tab-kontrolle", "tab-statistik", "tab-trackliste", "tab-einstellungen"];
    const hauptBereich = document.getElementById("haupt-bereich");

    _aktiveSeitenId = seiteId || null;

    if (!seiteId) {
        /* Hauptbereich (Logbuch + Log) anzeigen */
        if (hauptBereich) hauptBereich.hidden = false;
        seitenPanels.forEach(id => {
            const p = document.getElementById(id);
            if (p) p.classList.add("tab-hidden");
        });
    } else {
        /* Sidebar-Panel anzeigen */
        if (hauptBereich) hauptBereich.hidden = true;
        seitenPanels.forEach(id => {
            const p = document.getElementById(id);
            if (p) p.classList.toggle("tab-hidden", id !== seiteId);
        });
        if (seiteId === "tab-trackliste" && aktuellerToern) {
            tracklisteRendern(aktuellerToern);
            requestAnimationFrame(tracklisteScrollHoeheAnpassen);
        }
        if (seiteId === "tab-toernuebersicht") {
            toernUebersichtRendern();
            requestAnimationFrame(toernuebersichtScrollHoeheAnpassen);
        }
        if (seiteId === "tab-sicherheit") {
            sicherheitSeiteAktualisieren();
        }
        if (seiteId === "tab-kontrolle") {
            kontrolleSeiteAktualisieren();
        }
    }

    /* Aktiven Sidebar-Button hervorheben */
    document.querySelectorAll(".sidebar-btn").forEach(b =>
        b.classList.toggle("sidebar-aktiv", b.dataset.seite === seiteId)
    );

    /* Logbuch-Sticky: nur sichtbar im Hauptbereich auf Logbuch-Tab mit aktivem Törn */
    const sticky = document.getElementById("logbuch-sticky");
    if (sticky) sticky.hidden = !(!!aktuellerToern && !seiteId && _aktiverHauptTab === "tab-logbuch");

    /* Hamburger-Icon: ☰ normal, ← wenn Panel offen */
    const hamburger = document.getElementById("btn-hamburger");
    if (hamburger) hamburger.textContent = seiteId ? "←" : "☰";

    sidebarSchliessen();
}

/* Rückwärtskompatibilität – wird nicht mehr von HTML aufgerufen */
function tabWechseln(tabId) { seitenWechseln(tabId); }

function tabInhaltToggeln() {
    const aktiv = !!aktuellerToern;
    ["logbuch", "log", "karte", "statistik", "trackliste"].forEach(t => {
        const leer   = document.getElementById("tab-" + t + "-leer");
        const inhalt = document.getElementById("tab-" + t + "-inhalt");
        if (leer)   leer.hidden   = aktiv;
        if (inhalt) inhalt.hidden = !aktiv;
    });
    /* Logbuch-Sticky: sichtbar wenn Törn aktiv, Hauptbereich sichtbar, Logbuch-Tab aktiv */
    const sticky = document.getElementById("logbuch-sticky");
    if (sticky) sticky.hidden = !(aktiv && !_aktiveSeitenId && _aktiverHauptTab === "tab-logbuch");
    requestAnimationFrame(logbuchScrollHoeheAnpassen);
    const subtitle = document.getElementById("header-subtitle");
    if (subtitle) {
        subtitle.textContent = aktiv
            ? (aktuellerToern.tripName || "(ohne Name)") + "  ·  " + (formatDatum(aktuellerToern.startDate) || "kein Datum")
            : "Törns erfassen und verwalten";
    }
}


/* --- Log-Tab + Logbuch Scroll-Höhe ------------------------------ */

function tracklisteScrollHoeheAnpassen() {
    const scroll = document.getElementById("trackliste-scroll");
    if (!scroll) return;
    const header = scroll.closest(".tab-panel")?.querySelector(".seite-header");
    const bottomBar = document.querySelector(".bottom-bar");
    const headerBottom = header ? header.getBoundingClientRect().bottom : 126;
    const bottomH = bottomBar ? bottomBar.offsetHeight : 70;
    const hoehe = Math.max(200, window.innerHeight - headerBottom - bottomH - 8);
    scroll.style.height = hoehe + "px";
}

function toernuebersichtScrollHoeheAnpassen() {
    const scroll = document.getElementById("toernuebersicht-scroll");
    if (!scroll) return;
    const header = scroll.previousElementSibling;
    const bottomBar = document.querySelector(".bottom-bar");
    const headerBottom = header ? header.getBoundingClientRect().bottom : 126;
    const bottomH = bottomBar ? bottomBar.offsetHeight : 70;
    scroll.style.height = Math.max(200, window.innerHeight - headerBottom - bottomH - 8) + "px";
}

function logScrollHoeheAnpassen() {
    const scroll = document.getElementById("log-liste-scroll");
    if (!scroll) return;
    const filterBar = scroll.previousElementSibling;
    const bottomBar = document.querySelector(".bottom-bar");
    const filterBottom = filterBar ? filterBar.getBoundingClientRect().bottom : 126;
    const bottomH = bottomBar ? bottomBar.offsetHeight : 70;
    const hoehe = Math.max(200, window.innerHeight - filterBottom - bottomH - 8);
    scroll.style.height = hoehe + "px";
}

function logbuchScrollHoeheAnpassen() {
    const sticky = document.getElementById("logbuch-sticky");
    const scroll = document.getElementById("logbuch-daten-scroll");
    if (!sticky || !scroll || sticky.hidden) return;
    const bottomBar = document.querySelector(".bottom-bar");
    const stickyBottom = sticky.getBoundingClientRect().bottom;
    const bottomH = bottomBar ? bottomBar.offsetHeight : 70;
    const hoehe = Math.max(150, window.innerHeight - stickyBottom - bottomH - 16);
    scroll.style.height = hoehe + "px";
}

window.addEventListener("resize", () => {
    logbuchScrollHoeheAnpassen();
    logScrollHoeheAnpassen();
    tracklisteScrollHoeheAnpassen();
    toernuebersichtScrollHoeheAnpassen();
    if (typeof _logbuchAnsicht !== "undefined" && _logbuchAnsicht === "opensea")
        logbuchKarteHoeheAnpassen();
});

/* --- Sonnenmodus ------------------------------------------------ */

function sonnenmodusToggle() {
    const aktiv = document.body.classList.toggle("sonnenmodus");
    speichereSonnenmodus(aktiv);
    const btn = document.getElementById("btn-sonnenmodus");
    if (btn) btn.textContent = aktiv ? "🌙" : "☀️";
}

(function () {
    if (ladeSonnenmodus()) {
        document.body.classList.add("sonnenmodus");
        const btn = document.getElementById("btn-sonnenmodus");
        if (btn) btn.textContent = "🌙";
    }
})();

/* --- Event Listener --------------------------------------------- */

btnNeuerToern.onclick    = neuerToernAnlegen;
btnSpeichern.onclick     = toernSpeichernAktion;
btnToernLoeschen.onclick = toernLoeschenAktion;
btnCrewAdd.onclick        = crewHinzufuegen;
btnLogSpeichern.onclick   = logEintragSpeichern;
const _btnAbs = document.getElementById("btn-abschliessen");
if (_btnAbs) _btnAbs.onclick = toernAbschliessenAktion;
const _btnCsv       = document.getElementById("btn-csv-export");
const _btnJson      = document.getElementById("btn-json-export");
const _btnTrackCsv  = document.getElementById("btn-track-csv-export");
const _btnDrucken   = document.getElementById("btn-drucken");
if (_btnCsv)      _btnCsv.onclick      = () => exportMitFeedback(_btnCsv,      csvExportieren);
if (_btnJson)     _btnJson.onclick     = () => exportMitFeedback(_btnJson,     exportJSON);
if (_btnTrackCsv) _btnTrackCsv.onclick = () => exportMitFeedback(_btnTrackCsv, trackCsvExportieren);
if (_btnDrucken)  _btnDrucken.onclick  = () => exportMitFeedback(_btnDrucken,  druckenVorbereiten);
document.getElementById("btn-abschluss-druck").onclick  = abschlussdrucken;
const _btnKurz = document.getElementById("btn-kurzdruck");
if (_btnKurz) _btnKurz.onclick = () => exportMitFeedback(_btnKurz, kurzdruckPdfErstellen);
const _btnPruefen = document.getElementById("btn-daten-pruefen");
if (_btnPruefen) _btnPruefen.onclick = () => toernValidierenAnzeigen();

btnNeuerLog.onclick = () => {
    logZeitVorbefuellen();
    rudergaengerSelectFuellen();
    const letzte = ladeLetzteWerte() || {};
    if (letzte.rudergaenger) logRudergaenger.value = letzte.rudergaenger || "";
    formWetterVorbelegen();
    logZeit.focus();
};

/* --- Modal Event-Listener --------------------------------------- */
const _modalOverlay = document.getElementById("log-modal-overlay");
const _btnModalAbbrechen = document.getElementById("btn-modal-abbrechen");

if (_btnModalAbbrechen) _btnModalAbbrechen.addEventListener("click", logModalSchliessen);

/* Backdrop-Klick (außerhalb modal-box) schließt Modal */
if (_modalOverlay) {
    _modalOverlay.addEventListener("click", e => {
        if (e.target === _modalOverlay) logModalSchliessen();
    });
}

logRudergaenger.addEventListener("mousedown", () => {
    rudergaengerSelectFuellen();
});

crewInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); crewHinzufuegen(); }
});

toernSelect.onchange = () => {
    const val = toernSelect.value;
    if (val) toernLaden(val);
    else { formSection.hidden = true; aktuellerToern = null; speichereAktivenToern(null); tabInhaltToggeln(); }
};

function ruderDropdownToggeln() {
    const dd = document.getElementById("ruder-dropdown");
    if (!dd) return;
    if (!dd.hidden) { dd.hidden = true; return; }
    const alle = aktuellerToern ? (aktuellerToern.crew || []).map(p => p.name).filter(Boolean) : [];
    const mitRuder = [...(aktuellerToern?.events || [])].reverse().find(e => e.rudergaenger?.name);
    const aktRuder = mitRuder?.rudergaenger.name || "";
    dd.innerHTML = alle.length === 0
        ? '<p class="ruder-dd-leer">Keine Crew eingetragen</p>'
        : alle.map(name =>
            `<button type="button" class="ruder-option${name === aktRuder ? " ruder-aktiv" : ""}"
             onclick="rudergaengerWechseln('${name.replace(/'/g, "\\'")}')">👤 ${name}</button>`
          ).join("");
    dd.hidden = false;
}

function rudergaengerWechseln(name, zeitOverride = null, unterschrift = null) {
    const dd = document.getElementById("ruder-dropdown");
    if (dd) dd.hidden = true;
    if (!name || !aktuellerToern) return;
    const letzte  = ladeLetzteWerte() || {};
    speichereLetzteWerte(letzte.wind || "", name);
    const zeitIso = zeitOverride || lokalZeitIso();
    const ev = {
        id:           generateId(),
        type:         "Ruderwechsel",
        kategorie:    "Allgemein",
        antrieb:      antriebFuerTyp("Ruderwechsel"),
        zeit:         zeitIso,
        ort:          "",
        rudergaenger: { name },
        note:         "",
        weather:      letzte.wind
                        ? { windForce: msToBft(parseFloat(letzte.wind) / 1.94384), windKnots: parseFloat(letzte.wind), windDirection: "", description: "" }
                        : null,
        ...(unterschrift ? { unterschrift } : {})
    };
    aktuellerToern.events.push(ev);
    gpsAbfragen(ev);
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    zeigeLogs();
    statusSetzen("👤 " + name + " am Ruder.", "ok", 2000);
}

/* Dropdown schließen bei Klick außerhalb */
document.addEventListener("click", e => {
    const bar = document.getElementById("ruder-bar");
    const dd  = document.getElementById("ruder-dropdown");
    if (dd && !dd.hidden && bar && !bar.contains(e.target)) dd.hidden = true;
});

const _windSelectEl = document.getElementById("ls-wind-select");
if (_windSelectEl) _windSelectEl.addEventListener("change", function () {
    const wind = this.value;
    if (!aktuellerToern) return;
    const zeitIso = lokalZeitIso();
    const letzte  = ladeLetzteWerte() || {};
    const ev = {
        id:           generateId(),
        type:         "Wetterwechsel",
        zeit:         zeitIso,
        ort:          "",
        rudergaenger: null,
        note:         "",
        weather:      wind !== "" ? { windForce: msToBft(parseFloat(wind) / 1.94384), windKnots: parseFloat(wind), windDirection: "", description: "" } : null
    };
    aktuellerToern.events.push(ev);
    gpsAbfragen(ev);
    speichereLetzteWerte(wind, letzte.rudergaenger || "");
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    zeigeLogs();
    if (wind !== "") statusSetzen("💨 Wind: " + wind + " kn.", "ok", 2000);
}); // end ls-wind-select listener


/* --- GPS -------------------------------------------------------- */

async function ortBestimmen(lat, lon) {
    try {
        const res = await fetch(
            "https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lon + "&format=json",
            { headers: { "Accept-Language": "de" } }
        );
        if (!res.ok) return "";
        const data = await res.json();
        const a = data.address || {};
        return a.city || a.town || a.village || a.hamlet || a.municipality || "";
    } catch { return ""; }
}

/* --- MOB-Speicherung (bypass Validierung) ----------------------- */

function mobSpeichern() {
    const zeitIso = lokalZeitIso();
    const letzte  = ladeLetzteWerte() || {};
    const ev = {
        id:           generateId(),
        type:         "MOB",
        kategorie:    "Allgemein",
        antrieb:      "",
        zeit:         zeitIso,
        ort:          "",
        rudergaenger: letzte.rudergaenger ? { name: letzte.rudergaenger } : null,
        note:         "",
        weather:      null,
        pos:          null
    };
    if (aktuellerToern) {
        if (!aktuellerToern.events) aktuellerToern.events = [];
        aktuellerToern.events.push(ev);
        toernSpeichern(aktuellerToern);
        autoBackupSpeichern();
        zeigeLogs();
    }
    statusSetzen("🆘 MOB – Mann über Bord! Zeit: " + zeitIso.slice(11, 16), "error", 30000);
    gpsUndWetterHolen(8000).then(gps => {
        if (!gps) return;
        ev.pos = { lat: gps.lat, lon: gps.lon, sog: gps.sog };
        if (typeof mobOverlayPositionAktualisieren === "function")
            mobOverlayPositionAktualisieren(gps.lat, gps.lon, gps.sog);
        if (aktuellerToern) {
            if (typeof trackManöverPunkt === "function")
                trackManöverPunkt(gps.lat, gps.lon, gps.sog, zeitIso);
            toernSpeichern(aktuellerToern);
        }
    }).catch(() => {});
    return ev;
}

function mobGeborgenSpeichern(notiz, dauerSek, mobTyp) {
    if (!aktuellerToern) return;
    const m = Math.floor(dauerSek / 60), s = dauerSek % 60;
    const dauer = m + "min " + s + "s";
    const beschriftung = {
        mob:    "Mann über Bord geborgen nach " + dauer,
        boje:   "Boje geborgen nach " + dauer,
        uebung: "MOB Übung beendet nach " + dauer
    };
    const eventTyp = {
        mob:    "MOB geborgen",
        boje:   "Boje geborgen",
        uebung: "MOB Übung beendet"
    };
    const note = (beschriftung[mobTyp] || beschriftung.mob) + (notiz ? " – " + notiz : "");
    const ev = {
        id:           generateId(),
        type:         eventTyp[mobTyp] || "MOB geborgen",
        kategorie:    "Allgemein",
        antrieb:      "",
        zeit:         lokalZeitIso(),
        ort:          "",
        rudergaenger: null,
        note,
        weather:      null,
        pos:          null
    };
    aktuellerToern.events.push(ev);
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    zeigeLogs();
    gpsAbfragen(ev);
}

function gpsAbfragen(ev) {
    if (!navigator.geolocation || !aktuellerToern) return;
    if (stoppZustandLaden() !== "fahrt") return;
    navigator.geolocation.getCurrentPosition(
        async pos => {
            const speedMs = pos.coords.speed;
            ev.pos = {
                lat: parseFloat(pos.coords.latitude.toFixed(5)),
                lon: parseFloat(pos.coords.longitude.toFixed(5)),
                sog: speedMs != null ? parseFloat((speedMs * 1.94384).toFixed(1)) : null
            };
            /* Ort per Reverse Geocoding bestimmen */
            if (!ev.ort) ev.ort = await ortBestimmen(ev.pos.lat, ev.pos.lon);
            /* Wetter automatisch laden / ergänzen */
            const w = await wetterVonApi(ev.pos.lat, ev.pos.lon);
            if (w) {
                if (!ev.weather) {
                    ev.weather = w;
                } else {
                    if (!ev.weather.windDirection) ev.weather.windDirection = w.windDirection;
                    if (!ev.weather.description)   ev.weather.description   = w.description;
                }
            }
            if (typeof trackManöverPunkt === "function")
                trackManöverPunkt(ev.pos.lat, ev.pos.lon, ev.pos.sog, ev.zeit);
            toernSpeichern(aktuellerToern);
            zeigeLogs();
        },
        error => {
            /* Fallback: letzte BackgroundGeolocation-Position, max. 90s alt */
            if (_letzteTrackPos && (Date.now() - _letzteTrackPos.ts) < 90000) {
                ev.pos = { lat: _letzteTrackPos.lat, lon: _letzteTrackPos.lon, sog: _letzteTrackPos.sog };
                toernSpeichern(aktuellerToern);
                zeigeLogs();
                return;
            }
            /* pos bleibt null — ursprüngliches Verhalten */
            if (typeof statusSetzen === "function") {
                const msg = error && error.code != null
                    ? (error.code === 1 ? "GPS-Berechtigung verweigert." :
                       error.code === 2 ? "GPS-Position nicht verfügbar." :
                       error.code === 3 ? "GPS-Timeout." :
                       "GPS-Fehler beim Laden der Position.")
                    : "GPS-Fehler beim Laden der Position.";
                statusSetzen(msg, "error", 5000);
            }
        },
        { maximumAge: 30000, timeout: 8000, enableHighAccuracy: true }
    );
}


/* Autotracking → track.js */


/* --- Törn abschließen ------------------------------------------- */

function toernAbschliessenAktion() {
    if (!aktuellerToern) return;
    if (!confirm(`Törn "${aktuellerToern.tripName || "(ohne Name)"}" jetzt abschließen?\nEnddatum und Endzeit werden auf jetzt gesetzt.`)) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    aktuellerToern.endDate = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    aktuellerToern.endTime = pad(now.getHours()) + ":" + pad(now.getMinutes());
    fldEndDate.value = aktuellerToern.endDate;
    fldEndTime.value = aktuellerToern.endTime;
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    toernSelectAktualisieren();
    statusSetzen("🏁 Törn abgeschlossen: " + aktuellerToern.endDate + " " + aktuellerToern.endTime, "ok", 5000);
}


/* --- Auto-Backup ------------------------------------------------ */

function backupStatusAktualisieren() {
    const el = document.getElementById("version-label");
    if (!el) return;
    const backup = backupLaden();
    const pad = n => String(n).padStart(2, "0");
    if (!backup || !backup.timestamp) {
        el.textContent = "v" + APP_VERSION;
        return;
    }
    const d = new Date(backup.timestamp);
    const zeit = pad(d.getHours()) + ":" + pad(d.getMinutes());
    el.textContent = "v" + APP_VERSION + " · 💾 " + zeit;
}

function backupBannerPruefen() {
    const backup = backupLaden();
    /* Nur anzeigen wenn Backup existiert aber aktuelle Daten fehlen */
    if (!backup || !backup.toerns || backup.toerns.length === 0) return;
    if (ladeToerns().length > 0) return;

    const d = new Date(backup.timestamp);
    const pad = n => String(n).padStart(2, "0");
    const datum = pad(d.getDate()) + "." + pad(d.getMonth() + 1) + ". "
        + pad(d.getHours()) + ":" + pad(d.getMinutes());

    const banner = document.createElement("div");
    banner.className = "backup-banner";
    banner.innerHTML =
        '<span>Backup vom ' + datum + ' wiederherstellen?</span>'
        + '<div class="backup-banner-btns">'
        + '<button type="button" id="btn-backup-ja" class="btn-backup-restore">Wiederherstellen</button>'
        + '<button type="button" id="btn-backup-nein" class="btn-backup-ignore">✕</button>'
        + '</div>';

    document.querySelector(".app").insertBefore(banner, statusMsg);

    document.getElementById("btn-backup-ja").onclick = () => {
        backupWiederherstellen(backup);
        banner.remove();
        toernSelectAktualisieren();
        statusSetzen("Backup wiederhergestellt.", "ok");
    };
    document.getElementById("btn-backup-nein").onclick = () => banner.remove();
}


/* --- PWA-Migrations-Modal --------------------------------------- */

function pwaMigrationModalZeigen() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
        <div class="modal-box">
            <h2>📦 Keine Daten gefunden</h2>
            <p>Hast du die App vorher im Browser verwendet?<br>
               Dann importiere deine Daten mit dem Backup.</p>
            <input type="file" id="pwa-file" accept=".json,application/json" style="display:none">
            <div class="modal-btns">
                <button type="button" class="btn-primary modal-btn" id="pwa-btn-import">📂 Backup importieren</button>
                <button type="button" class="btn-secondary modal-btn" id="pwa-btn-skip">Neu starten</button>
            </div>
            <div id="pwa-result"></div>
        </div>`;
    document.body.appendChild(overlay);

    document.getElementById("pwa-btn-import").onclick = () =>
        document.getElementById("pwa-file").click();

    document.getElementById("pwa-file").addEventListener("change", function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data   = JSON.parse(e.target.result);
                const anzahl = importJSON(data);
                speichereMigrationFlag();
                document.getElementById("pwa-result").innerHTML =
                    '<p class="migration-ok">✅ ' + anzahl + " Törn" +
                    (anzahl !== 1 ? "s" : "") + " importiert.</p>";
                setTimeout(() => {
                    overlay.remove();
                    toernSelectAktualisieren();
                    statusSetzen("Daten importiert.", "ok");
                }, 1500);
            } catch {
                document.getElementById("pwa-result").innerHTML =
                    '<p class="migration-err">❌ Ungültige Datei.</p>';
            }
        };
        reader.readAsText(file, "UTF-8");
    });

    document.getElementById("pwa-btn-skip").onclick = () => {
        speichereMigrationFlag();
        overlay.remove();
    };
}

function pwaMigrationPruefen() {
    const istPWA = window.matchMedia("(display-mode: standalone)").matches;
    if (!istPWA) return;
    if (ladeMigrationFlag()) return;
    if (ladeToerns().length > 0) {
        speichereMigrationFlag();
        return;
    }
    pwaMigrationModalZeigen();
}



/* --- Fahrt-Sicherheitsprüfung beim App-Start -------------------- */
/* Wenn stoppZustand = "fahrt" UND letzter Track-Punkt älter als 2h */
/* → Zustand auf "hafen" zurücksetzen, kein trackStarten()           */

function _fahrtSicherheitsPruefen() {
    if (stoppZustandLaden() !== "fahrt") return;
    if (!aktuellerToern) return;
    const pts = (aktuellerToern.track && aktuellerToern.track.points) || [];
    if (!pts.length) return;
    const letzter = pts[pts.length - 1];
    const alterMs = Date.now() - new Date(letzter.zeit).getTime();
    if (alterMs > 2 * 60 * 60 * 1000) {
        stoppZustandSpeichern("hafen");
        hafenSperrungAktualisieren("hafen");
        startButtonsSperren("hafen");
    }
}

/* --- Start ------------------------------------------------------ */

/* Permanentes Backup prüfen – automatisch wiederherstellen wenn Daten fehlen */
const _datenWiederhergestellt = permanentBackupPruefen();

toernSelectAktualisieren();
formSection.hidden = true;
btnToernLoeschen.hidden = true;
statusMsg.hidden = true;

/* Hauptbereich anzeigen, Sidebar-Panels verstecken */
["tab-toern", "tab-statistik", "tab-einstellungen"].forEach(id => {
    const p = document.getElementById(id);
    if (p) p.classList.add("tab-hidden");
});
document.getElementById("haupt-bereich").hidden = false;

/* Letzten aktiven Törn wiederherstellen */
const _letzterToernId = ladeAktivenToernId();
if (_letzterToernId && alleToernsLaden().find(t => t.tripId === _letzterToernId)) {
    toernLaden(_letzterToernId);
    _fahrtSicherheitsPruefen();
    tabInhaltToggeln();
} else {
    tabInhaltToggeln();
    hafenSperrungAktualisieren(stoppZustandLaden());
    startButtonsSperren(stoppZustandLaden());
}
backupBannerPruefen();
backupStatusAktualisieren();
pwaMigrationPruefen();
trackDistanzSelectAktualisieren();
trackAccuracySelectAktualisieren();
kraengungStarten();
_motorsegelnBeobachten();

if (_datenWiederhergestellt) {
    toernSelectAktualisieren();
    statusSetzen("✅ Daten automatisch wiederhergestellt.", "ok", 6000);
}

/* --- Testdaten -------------------------------------------------- */

async function testdatenLaden() {
    try {
        const res = await fetch("testdaten-adria.json?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const anzahl = importJSON(data);
        toernSelectAktualisieren();
        seitenWechseln(null);
        statusSetzen("✅ " + anzahl + " Testtoern(s) geladen.", "ok", 4000);
    } catch (e) {
        statusSetzen("❌ Testdaten konnten nicht geladen werden: " + e.message, "error", 5000);
    }
}

/* --- Daten Export / Import -------------------------------------- */

function datenExportierenDialog() {
    const overlay = document.getElementById("export-dialog-overlay");
    if (overlay) overlay.hidden = false;
}

function exportDialogSchliessen() {
    const overlay = document.getElementById("export-dialog-overlay");
    if (overlay) overlay.hidden = true;
}

function _jsonDownload(data, dateiname) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = dateiname;
    a.click();
    URL.revokeObjectURL(url);
}

function datenExportAktivToern() {
    exportDialogSchliessen();
    if (!aktuellerToern) { statusSetzen("Kein aktiver Törn.", "error", 3000); return; }
    const datum = new Date().toISOString().slice(0, 10);
    const name  = (aktuellerToern.tripName || "Toern").replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, "_");
    _jsonDownload({ toerns: [aktuellerToern] }, "segellogbuch_" + name + "_" + datum + ".json");
}

function datenExportAlle() {
    exportDialogSchliessen();
    const datum = new Date().toISOString().slice(0, 10);
    _jsonDownload({ toerns: alleToernsLaden() }, "segellogbuch_alle_" + datum + ".json");
}

function datenImportieren() {
    const input = document.getElementById("import-file-input");
    if (input) { input.value = ""; input.click(); }
}

function datenImportVerarbeiten(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            const toerns = Array.isArray(data) ? data
                         : Array.isArray(data.toerns) ? data.toerns
                         : null;
            if (!toerns) { statusSetzen("❌ Ungültiges Format.", "error", 4000); return; }

            const vorhandeneIds = new Set(alleToernsLaden().map(t => t.tripId));

            const neu        = toerns.filter(t => !t.tripId || !vorhandeneIds.has(t.tripId));
            const vorhandene  = toerns.filter(t =>  t.tripId &&  vorhandeneIds.has(t.tripId));

            if (neu.length === 0 && vorhandene.length > 0) {
                /* Alle bereits vorhanden → Ersetzen anbieten */
                const namen = vorhandene.map(t => `"${t.tripName || "(ohne Name)"}" (${t.tripId})`).join("\n");
                if (!confirm(`${vorhandene.length} Törn(s) sind bereits vorhanden:\n\n${namen}\n\nMit den importierten Daten ERSETZEN?`)) return;
                const alle = alleToernsLaden();
                vorhandene.forEach(t => {
                    const idx = alle.findIndex(a => a.tripId === t.tripId);
                    if (idx >= 0) alle[idx] = t; else alle.push(t);
                });
                speichereToerns(alle);
                window.location.reload();
            } else {
                /* Normal: neue importieren, Duplikate überspringen */
                if (neu.length === 0) { statusSetzen("⚠️ Nichts zu importieren.", "error", 4000); return; }
                const msg = neu.length + " Törn(s) importieren"
                    + (vorhandene.length > 0 ? ` (${vorhandene.length} bereits vorhanden werden übersprungen)` : "") + "?";
                if (!confirm(msg)) return;
                const alle = alleToernsLaden();
                neu.forEach(t => alle.push(t));
                speichereToerns(alle);
                window.location.reload();
            }
        } catch (err) {
            statusSetzen("❌ Import fehlgeschlagen: " + err.message, "error", 5000);
        }
    };
    reader.readAsText(file);
}

/* --- Krängungsanzeige ------------------------------------------- */

let _kraengungOffset          = 0;
let _kraengungRoh             = 0;
let _kraengungLongPressTimer  = null;

function kraengungAktualisieren(gamma) {
    const el = document.getElementById("ls-kraengung");
    if (!el) return;
    _kraengungRoh = gamma;
    const grad  = Math.round(gamma - _kraengungOffset);
    const seite = grad > 0 ? " BB" : grad < 0 ? " SB" : "";
    el.textContent = `⛵ ${Math.abs(grad)}°${seite}`;
    el.style.cursor = "pointer";
    el.title        = "Tippen: Kalibrieren | Lang: Zurücksetzen";
    el.onclick      = kraengungKalibrieren;

    el.onpointerdown = () => {
        _kraengungLongPressTimer = setTimeout(() => {
            _kraengungOffset = 0;
            try { localStorage.removeItem("segel_kraengung_offset"); } catch (_) {}
            kraengungAktualisieren(_kraengungRoh);
            if (typeof statusSetzen === "function")
                statusSetzen(`Kalibrierung zurückgesetzt (roh: ${_kraengungRoh.toFixed(1)}°)`, "ok", 4000);
        }, 600);
    };
    el.onpointerup    = () => clearTimeout(_kraengungLongPressTimer);
    el.onpointerleave = () => clearTimeout(_kraengungLongPressTimer);
}

function kraengungKalibrieren() {
    _kraengungOffset = _kraengungRoh;
    try { localStorage.setItem("segel_kraengung_offset", String(_kraengungOffset)); } catch (_) {}
    const el = document.getElementById("ls-kraengung");
    if (el) {
        el.textContent = "⛵ 0° ✓";
        setTimeout(() => kraengungAktualisieren(_kraengungRoh), 1200);
    }
    if (typeof statusSetzen === "function")
        statusSetzen(`Krängung kalibriert (Offset: ${_kraengungOffset.toFixed(1)}°)`, "ok", 3000);
}

function _kraengungListener() {
    window.addEventListener("deviceorientation", e => { if (e.gamma != null) kraengungAktualisieren(e.gamma); });
}

function kraengungErlauben() {
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
            .then(state => { if (state === "granted") _kraengungListener(); })
            .catch(() => {});
    }
}

function kraengungStarten() {
    /* Gespeicherten Kalibrier-Offset laden */
    try {
        const saved = parseFloat(localStorage.getItem("segel_kraengung_offset"));
        if (!isNaN(saved)) _kraengungOffset = saved;
    } catch (_) {}

    if (typeof DeviceOrientationEvent === "undefined") return;
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
        // iOS: Tap auf "⛵ ?" löst kraengungErlauben() aus (onclick im HTML)
    } else {
        // Android / Desktop: direkt starten, kein Tap nötig
        _kraengungListener();
    }
}

