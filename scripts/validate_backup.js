#!/usr/bin/env node
/* ==========================================================================
   validate_backup.js – Segellogbuch Datenkonsistenz-Prüfung
   Verwendung: node scripts/validate_backup.js <backup.json>
   ========================================================================== */

const fs   = require("fs");
const path = require("path");

const RED   = "\x1b[31m";
const YEL   = "\x1b[33m";
const GRN   = "\x1b[32m";
const BOLD  = "\x1b[1m";
const RESET = "\x1b[0m";

/* ---------- Hilfsfunktionen -------------------------------------------- */

function parseZeit(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
}

function evZeit(ev) {
    return ev.zeit || ((ev.date || "") + "T" + (ev.time || "00:00"));
}

const STOPP_EV = new Set(["Anlegen", "Ankern", "An Boje"]);
const MOTOR_AN = new Set(["Motor an", "Motorsegeln"]);

/* ---------- Prüf-Logik (geteilt mit App-Funktion) ---------------------- */

function validateToern(toern) {
    const probleme = [];

    function add(schwere, typ, beschreibung, eventId) {
        probleme.push({ schwere, typ, beschreibung, eventId });
    }

    const events = (toern.events || []).slice().sort((a, b) => {
        const ta = parseZeit(evZeit(a)), tb = parseZeit(evZeit(b));
        return (ta || 0) - (tb || 0);
    });

    /* 1) Doppelte IDs */
    const idSet = new Set();
    for (const ev of toern.events || []) {
        if (ev.id && idSet.has(ev.id)) add("ERROR", "DUPLIKAT_ID", `Doppelte Event-ID: ${ev.id}`, ev.id);
        if (ev.id) idSet.add(ev.id);
    }

    /* 2) Chronologische Reihenfolge */
    const rawEvents = toern.events || [];
    for (let i = 1; i < rawEvents.length; i++) {
        const ta = parseZeit(evZeit(rawEvents[i - 1]));
        const tb = parseZeit(evZeit(rawEvents[i]));
        if (ta && tb && tb < ta - 1000) {
            add("WARN", "CHRONO",
                `Event ${rawEvents[i].type} (${evZeit(rawEvents[i])}) liegt vor ${rawEvents[i-1].type} (${evZeit(rawEvents[i-1])})`,
                rawEvents[i].id);
        }
    }

    /* 3) Zeitzone-Konsistenz: Motor-aus "beim"-Events */
    for (const ev of events) {
        if (ev.type !== "Motor aus" || !ev.note || !ev.note.includes("beim")) continue;
        const tMotorAus = parseZeit(evZeit(ev));
        if (!tMotorAus) continue;
        const keyword = ev.note.replace("Motor gestoppt beim ", "").trim();
        // Suche nächstes Event gleichen Typs (zeitlich benachbart)
        const kandidaten = events.filter(e => e.id !== ev.id && e.type === keyword);
        // Unmittelbar auslösendes Event (max. 3 min danach)
        const sofort = kandidaten.find(e => {
            const t = parseZeit(evZeit(e));
            return t && t > tMotorAus && t - tMotorAus < 3 * 60000;
        });
        if (!sofort) {
            // UTC-Bug-Fenster: 90–150 min Abstand (CEST = 120 min)
            const fern = kandidaten.find(e => {
                const t = parseZeit(evZeit(e));
                return t && Math.abs(t - tMotorAus) >= 90 * 60000 && Math.abs(t - tMotorAus) <= 150 * 60000;
            });
            if (fern) {
                const diff = Math.round(Math.abs(parseZeit(evZeit(fern)) - tMotorAus) / 60000);
                add("ERROR", "ZEITZONE",
                    `Motor aus (${evZeit(ev)}) weicht ${diff} min von "${keyword}" (${evZeit(fern)}) ab – UTC-Bug`,
                    ev.id);
            }
        }
    }

    /* 4) Motor-Paarungen – auto-generierte "beim"-Events ausgenommen */
    let motorLaeuft = false;
    let motorAnId   = null;
    for (const ev of events) {
        if (ev.storniert) continue;
        if (MOTOR_AN.has(ev.type)) {
            motorLaeuft = true; motorAnId = ev.id;
        } else if (ev.type === "Motor aus") {
            const istAuto = ev.note && ev.note.includes("beim");
            if (!motorLaeuft && !istAuto)
                add("WARN", "MOTOR_PAAR", `"Motor aus" ohne vorheriges "Motor an" (${evZeit(ev)})`, ev.id);
            motorLaeuft = false; motorAnId = null;
        } else if (STOPP_EV.has(ev.type)) {
            motorLaeuft = false; motorAnId = null;
        }
    }
    if (motorLaeuft)
        add("WARN", "MOTOR_PAAR", `"Motor an" (${motorAnId}) ohne abschliessendes "Motor aus"`, motorAnId);

    /* 5) Events außerhalb Törn-Zeitraum */
    const t0 = toern.startDate ? parseZeit(toern.startDate + "T00:00:00") : null;
    const t1 = toern.endDate   ? parseZeit(toern.endDate   + "T23:59:59") : null;
    for (const ev of events) {
        if (ev.storniert) continue;
        const t = parseZeit(evZeit(ev));
        if (!t) continue;
        const tagesDiff = 24 * 3600 * 1000;
        if (t0 && t < t0 - tagesDiff) {
            add("WARN", "ZEITRAUM",
                `Event "${ev.type}" (${evZeit(ev)}) liegt vor Törnstart (${toern.startDate})`,
                ev.id);
        }
        if (t1 && t > t1 + tagesDiff) {
            add("WARN", "ZEITRAUM",
                `Event "${ev.type}" (${evZeit(ev)}) liegt nach Törnende (${toern.endDate})`,
                ev.id);
        }
    }

    /* 6) Fehlende Pflichtfelder */
    for (const ev of events) {
        if (!ev.type) add("ERROR", "PFLICHTFELD", `Event ohne Typ`, ev.id);
        if (!evZeit(ev)) add("ERROR", "PFLICHTFELD", `Event "${ev.type}" ohne Zeitstempel`, ev.id);
    }

    return probleme;
}

/* ---------- CLI-Ausgabe -------------------------------------------------- */

function printBericht(toernName, probleme) {
    const errors = probleme.filter(p => p.schwere === "ERROR");
    const warns  = probleme.filter(p => p.schwere === "WARN");

    console.log(`\n${BOLD}─── Törn: ${toernName} ───${RESET}`);
    if (probleme.length === 0) {
        console.log(`  ${GRN}✓ Keine Probleme gefunden${RESET}`);
        return;
    }
    for (const p of probleme) {
        const icon  = p.schwere === "ERROR" ? `${RED}✕ ERROR${RESET}` : `${YEL}⚠ WARN ${RESET}`;
        const idStr = p.eventId ? ` [${p.eventId}]` : "";
        console.log(`  ${icon}  [${p.typ}]${idStr}  ${p.beschreibung}`);
    }
    console.log(`  → ${errors.length} Fehler, ${warns.length} Warnungen`);
}

/* ---------- Haupt -------------------------------------------------------- */

const datei = process.argv[2];
if (!datei) {
    console.error("Verwendung: node validate_backup.js <backup.json>");
    process.exit(1);
}

let raw;
try { raw = JSON.parse(fs.readFileSync(datei, "utf8")); }
catch (e) { console.error(`Fehler beim Lesen/Parsen: ${e.message}`); process.exit(1); }

const toerns = raw.toerns || [];
if (!toerns.length) { console.log("Keine Törns in der Datei gefunden."); process.exit(0); }

console.log(`${BOLD}Segellogbuch Datenvalidierung${RESET}`);
console.log(`Datei: ${path.basename(datei)} (${toerns.length} Törn/s)\n`);

let gesamtErrors = 0, gesamtWarns = 0;
for (const t of toerns) {
    const probleme = validateToern(t);
    printBericht(t.tripName || "(ohne Name)", probleme);
    gesamtErrors += probleme.filter(p => p.schwere === "ERROR").length;
    gesamtWarns  += probleme.filter(p => p.schwere === "WARN").length;
}

console.log(`\n${BOLD}Gesamt: ${gesamtErrors} Fehler, ${gesamtWarns} Warnungen${RESET}`);
process.exit(gesamtErrors > 0 ? 1 : 0);
