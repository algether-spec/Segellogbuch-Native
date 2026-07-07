/* ======================
   STATISTIK.JS – Törnstatistik, Trackliste, Törnabschluss, Törnübersicht
====================== */

/* Schiebt 'zielEl' durch Padding-Top auf den nächsten A4-Seitenbeginn
   (muss aufgerufen werden NACHDEM der DOM gerendert ist, VOR html2canvas). */
function _ausrichtenAufSeitenbeginn(container, zielEl) {
    if (!container || !zielEl) return;
    const cRect = container.getBoundingClientRect();
    const zRect = zielEl.getBoundingClientRect();
    const offsetPx = zRect.top - cRect.top;
    const pageHPx  = cRect.width * (297 / 210);   /* A4-Höhe in CSS-Pixeln */
    if (pageHPx <= 0 || offsetPx <= 0) return;
    const nextPageTop = Math.ceil(offsetPx / pageHPx) * pageHPx;
    const padding = nextPageTop - offsetPx;
    if (padding > 0 && padding < pageHPx) {
        zielEl.style.paddingTop = (parseFloat(zielEl.style.paddingTop) || 0) + padding + 'px';
    }
}

/* --- PDF / Native Save Helpers --------------------------------- */

/* Zeichnet die GPS-Route als inline-SVG (kein Leaflet, kein Netz nötig).
   pts = Array von {lat, lon}. Gibt einen SVG-HTML-String zurück. */
function _routeAlsSvg(pts, width, height) {
    if (!pts || pts.length < 2) {
        return `<div style="width:${width}px;height:${height}px;background:#ddeeff;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px">Keine Track-Daten vorhanden</div>`;
    }
    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const pad = 0.12;
    const latSpan = Math.max(maxLat - minLat, 1e-5) * (1 + pad);
    const lonSpan = Math.max(maxLon - minLon, 1e-5) * (1 + pad);
    const latMid  = (minLat + maxLat) / 2;
    const lonMid  = (minLon + maxLon) / 2;
    const toX = lon => ((lon - lonMid) / lonSpan + 0.5) * width;
    const toY = lat => (0.5 - (lat - latMid) / latSpan) * height;
    const polypts = pts.map(p => `${toX(p.lon).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(' ');
    const sx = toX(pts[0].lon).toFixed(1),       sy = toY(pts[0].lat).toFixed(1);
    const ex = toX(pts[pts.length-1].lon).toFixed(1), ey = toY(pts[pts.length-1].lat).toFixed(1);
    return `<svg width="100%" viewBox="0 0 ${width} ${height}"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        style="display:block;width:100%;border:1px solid #b0c8e0;border-radius:4px">
        <rect width="${width}" height="${height}" fill="#ddeeff"/>
        <polyline points="${polypts}" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${sx}" cy="${sy}" r="6" fill="#16a34a" stroke="#fff" stroke-width="2"/>
        <circle cx="${ex}" cy="${ey}" r="6" fill="#dc2626" stroke="#fff" stroke-width="2"/>
    </svg>`;
}

/* Lädt OSM-Kacheln als Data-URIs und bettet sie in ein SVG ein, damit
   html2canvas sie zuverlässig rendern kann (keine externen CORS-URLs mehr).
   Fallback auf _routeAlsSvg wenn kein Netz oder Tiles nicht verfügbar. */
async function _routeAlsKartenSvg(pts, width, height) {
    if (!pts || pts.length < 2) return _routeAlsSvg(pts, width, height);

    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);

    /* Tile-Koordinaten-Hilfen (Mercator-Projektion) */
    const lonToTx = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
    const latToTy = (lat, z) => {
        const r = lat * Math.PI / 180;
        return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
    };
    const latLonToPx = (lat, lon, z, minTx, minTy) => {
        const r = lat * Math.PI / 180;
        return {
            x: (lon + 180) / 360 * Math.pow(2, z) * 256 - minTx * 256,
            y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256 - minTy * 256
        };
    };

    /* Zoom wählen: max. 24 Tiles */
    let zoom = 14, minTx, maxTx, minTy, maxTy;
    for (let z = 14; z >= 1; z--) {
        minTx = lonToTx(minLon, z); maxTx = lonToTx(maxLon, z);
        minTy = latToTy(maxLat, z); maxTy = latToTy(minLat, z);
        if ((maxTx - minTx + 1) * (maxTy - minTy + 1) <= 24) { zoom = z; break; }
    }

    try {
        /* Alle Tiles parallel als Data-URI laden (Timeout 6s) */
        const jobs = [];
        for (let ty = minTy; ty <= maxTy; ty++)
            for (let tx = minTx; tx <= maxTx; tx++)
                jobs.push({ tx, ty });

        const tileData = await Promise.all(jobs.map(async ({ tx, ty }) => {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            try {
                const resp = await fetch(
                    `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`,
                    { signal: ctrl.signal }
                );
                if (!resp.ok) throw new Error('tile ' + resp.status);
                const blob = await resp.blob();
                const dataUri = await new Promise((res, rej) => {
                    const rd = new FileReader();
                    rd.onloadend = () => res(rd.result);
                    rd.onerror   = rej;
                    rd.readAsDataURL(blob);
                });
                return { tx, ty, dataUri };
            } finally { clearTimeout(t); }
        }));

        const rawW = (maxTx - minTx + 1) * 256;
        const rawH = (maxTy - minTy + 1) * 256;
        /* Skalierungsfaktor: Breite des Containers ÷ viewBox-Breite (Höhe ist proportional) */
        const scale = width / rawW;
        const sw = Math.max(3, Math.round(5 / scale));   /* Strichbreite Route */
        const mr = Math.max(6, Math.round(10 / scale));  /* Marker-Radius      */

        const tileImgs = tileData.map(({ tx, ty, dataUri }) =>
            `<image href="${dataUri}" x="${(tx - minTx) * 256}" y="${(ty - minTy) * 256}" width="256" height="256"/>`
        ).join('');

        const routePts = pts.map(p => {
            const { x, y } = latLonToPx(p.lat, p.lon, zoom, minTx, minTy);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        const start = latLonToPx(pts[0].lat, pts[0].lon, zoom, minTx, minTy);
        const end   = latLonToPx(pts[pts.length - 1].lat, pts[pts.length - 1].lon, zoom, minTx, minTy);

        return `<svg width="100%" viewBox="0 0 ${rawW} ${rawH}"
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
            style="display:block;width:100%;border:1px solid #b0c8e0;border-radius:4px">
            ${tileImgs}
            <polyline points="${routePts}" fill="none" stroke="#1d4ed8" stroke-width="${sw}"
                stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>
            <circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="${mr}" fill="#16a34a" stroke="#fff" stroke-width="${Math.round(mr * 0.5)}"/>
            <circle cx="${end.x.toFixed(1)}"   cy="${end.y.toFixed(1)}"   r="${mr}" fill="#dc2626" stroke="#fff" stroke-width="${Math.round(mr * 0.5)}"/>
        </svg>`;

    } catch (err) {
        console.warn('OSM-Tiles nicht verfügbar, Fallback auf SVG-Route:', err.message || err);
        return _routeAlsSvg(pts, width, height);
    }
}

function _loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector('script[src="' + src + '"]')) return resolve();
        const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
}

async function _ensurePdfLibs() {
    if (!window.html2canvas) await _loadScriptOnce('./html2canvas.min.js');
    if (!window.jspdf) await _loadScriptOnce('./jspdf.umd.min.js');
}

async function _elementToPdfBlob(el) {
    await _ensurePdfLibs();
    /* scale:1.5 + JPEG statt PNG → ~85% kleiner, bleibt für Dokument-PDFs scharf genug */
    const canvas = await window.html2canvas(el, { scale: 1.5, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
    const pageWidth = 210; const pageHeight = 297;

    const pageHeightPx = Math.floor(canvas.width * (pageHeight / pageWidth));
    const totalPages = Math.ceil(canvas.height / pageHeightPx);

    for (let page = 0; page < totalPages; page++) {
        const sy = page * pageHeightPx;
        const sh = Math.min(pageHeightPx, canvas.height - sy);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sh;
        const ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        const pageData = pageCanvas.toDataURL('image/jpeg', 0.85);
        const hMm = (sh * pageWidth) / canvas.width;
        if (page > 0) pdf.addPage();
        pdf.addImage(pageData, 'JPEG', 0, 0, pageWidth, hMm);
    }

    return pdf.output('blob');
}

function _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function _saveBlobNative(filename, blob) {
    if (!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem)) return false;
    try {
        const base64 = await _blobToBase64(blob);
        await Capacitor.Plugins.Filesystem.writeFile({ path: filename, data: base64, directory: 'DOCUMENTS', recursive: true });
        return true;
    } catch (err) {
        console.error('saveBlobNative error', err);
        return false;
    }
}

async function _shareFileNative(filename) {
    if (!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share && window.Capacitor.Plugins.Filesystem)) return false;
    try {
        const uri = await Capacitor.Plugins.Filesystem.getUri({ directory: 'DOCUMENTS', path: filename });
        await Capacitor.Plugins.Share.share({ title: filename, url: uri.uri });
        return true;
    } catch (err) {
        /* "sharing already in progress" ist kein echter Fehler – einfach ignorieren */
        const msg = (err && (err.message || err.errorMessage || String(err))).toLowerCase();
        if (!msg.includes('progress') && !msg.includes('already')) {
            console.error('shareFileNative error', err);
        }
        return false;
    }
}


/* ── Datenvalidierung ──────────────────────────────────────────── */

function toernValidieren(toern) {
    const probleme = [];
    function add(schwere, typ, beschreibung, eventId) {
        probleme.push({ schwere, typ, beschreibung, eventId });
    }

    /* Anker lichten + Von Boje beenden die Zeitmessung – danach muss
       explizit "Motor an" oder "Segeln" folgen (verhindert nächtlichen Durchlauf) */
    const STOPP_EV = new Set(["Anlegen", "Ankern", "An Boje", "Anker lichten", "Von Boje"]);
    const MOTOR_AN = new Set(["Motor an", "Motorsegeln"]);
    const ts = ev => evTimestamp(ev);

    const events = (toern.events || []).slice().sort((a, b) => (ts(a) || 0) - (ts(b) || 0));

    /* 1 – Doppelte IDs */
    const ids = new Set();
    for (const ev of toern.events || []) {
        if (ev.id && ids.has(ev.id)) add("ERROR", "DUPLIKAT_ID", `Doppelte ID: ${ev.id}`, ev.id);
        if (ev.id) ids.add(ev.id);
    }

    /* 2 – Chronologie */
    const raw = toern.events || [];
    for (let i = 1; i < raw.length; i++) {
        const ta = ts(raw[i-1]), tb = ts(raw[i]);
        if (ta && tb && tb < ta - 1000)
            add("WARN", "CHRONO",
                `"${raw[i].type}" (${evZeitIso(raw[i]).slice(11,16)}) liegt vor "${raw[i-1].type}" (${evZeitIso(raw[i-1]).slice(11,16)})`,
                raw[i].id);
    }

    /* 3 – Zeitzone: Motor-aus "beim"-Events
       Echter UTC-Bug = Differenz nahe 120 min (CEST-Offset ±10 min) */
    for (const ev of events) {
        if (ev.type !== "Motor aus" || !ev.note || !ev.note.includes("beim")) continue;
        const tAus = ts(ev); if (!tAus) continue;
        const keyword = ev.note.replace("Motor gestoppt beim ", "").trim();
        // Suche das unmittelbar auslösende Event (max. 3 min danach)
        const kand = events.find(e => e.id !== ev.id && e.type === keyword &&
            (ts(e) || 0) > tAus && (ts(e) || 0) - tAus < 3 * 60 * 1000);
        if (!kand) {
            // Keines in 3 min → suche weiter (UTC-Bug-Fenster 90–150 min)
            const fern = events.find(e => e.id !== ev.id && e.type === keyword &&
                Math.abs((ts(e)||0) - tAus) >= 90 * 60000 &&
                Math.abs((ts(e)||0) - tAus) <= 150 * 60000);
            if (fern) {
                const diffMin = Math.round(Math.abs((ts(fern)||0) - tAus) / 60000);
                add("ERROR", "ZEITZONE",
                    `"Motor aus" weicht ${diffMin} min von "${keyword}" ab — UTC-Bug! Bitte korrigieren.`, ev.id);
            }
        }
    }

    /* 4 – Motor-Paarungen
       Auto-generierte "Motor aus" (note enthält "beim") kommen NACH dem STOPP-Event
       → werden aus der Paarungs-Prüfung ausgenommen */
    let motorLaeuft = false, motorAnId = null;
    for (const ev of events) {
        if (ev.storniert) continue;
        if (MOTOR_AN.has(ev.type))  { motorLaeuft = true; motorAnId = ev.id; }
        else if (ev.type === "Motor aus") {
            const istAuto = ev.note && ev.note.includes("beim");
            if (!motorLaeuft && !istAuto)
                add("WARN", "MOTOR_PAAR", `"Motor aus" ohne "Motor an" (${evZeitIso(ev).slice(11,16)})`, ev.id);
            motorLaeuft = false; motorAnId = null;
        } else if (STOPP_EV.has(ev.type)) { motorLaeuft = false; motorAnId = null; }
    }
    if (motorLaeuft) add("WARN", "MOTOR_PAAR", `"Motor an" (${motorAnId}) ohne abschliessendes "Motor aus"`, motorAnId);

    /* 5 – Events außerhalb Törn-Zeitraum */
    const t0 = toern.startDate ? new Date(toern.startDate + "T00:00:00").getTime() : null;
    const t1 = toern.endDate   ? new Date(toern.endDate   + "T23:59:59").getTime() : null;
    const DAY = 24 * 3600000;
    for (const ev of events) {
        if (ev.storniert) continue;
        const t = ts(ev); if (!t) continue;
        if (t0 && t < t0 - DAY) add("WARN", "ZEITRAUM", `"${ev.type}" (${evZeitIso(ev).slice(0,10)}) vor Törnstart`, ev.id);
        if (t1 && t > t1 + DAY) add("WARN", "ZEITRAUM", `"${ev.type}" (${evZeitIso(ev).slice(0,10)}) nach Törnende`, ev.id);
    }

    /* 6 – Pflichtfelder */
    for (const ev of toern.events || []) {
        if (!ev.type) add("ERROR", "PFLICHTFELD", "Event ohne Typ", ev.id);
        if (!evZeitIso(ev)) add("ERROR", "PFLICHTFELD", `"${ev.type || '?'}" ohne Zeitstempel`, ev.id);
    }

    return probleme;
}

function toernValidierenAnzeigen() {
    if (!aktuellerToern) { if (typeof statusSetzen === "function") statusSetzen("Kein Törn ausgewählt.", "error", 3000); return; }
    const probleme = toernValidieren(aktuellerToern);
    const errors   = probleme.filter(p => p.schwere === "ERROR");
    const warns    = probleme.filter(p => p.schwere === "WARN");

    const zeilen = probleme.length === 0
        ? '<li class="val-ok">✅ Keine Probleme gefunden – Daten konsistent.</li>'
        : probleme.map(p => {
            const icon = p.schwere === "ERROR" ? "🔴" : "🟡";
            const id   = p.eventId ? ` <span class="val-id">[${p.eventId.slice(0, 8)}…]</span>` : "";
            return `<li class="val-${p.schwere.toLowerCase()}">
                ${icon} <strong>[${p.typ}]</strong>${id} ${p.beschreibung}
            </li>`;
          }).join("");

    const overlay = document.createElement("div");
    overlay.id = "val-overlay";
    overlay.innerHTML = `
        <div class="val-modal">
            <div class="val-header">
                <h2>🔍 Datenprüfung – ${aktuellerToern.tripName || "(ohne Name)"}</h2>
                <button class="val-close" onclick="document.getElementById('val-overlay').remove()">✕</button>
            </div>
            <div class="val-summary ${errors.length ? "val-has-errors" : warns.length ? "val-has-warns" : "val-clean"}">
                ${errors.length} Fehler &nbsp;·&nbsp; ${warns.length} Warnungen &nbsp;·&nbsp; ${(aktuellerToern.events||[]).length} Events geprüft
            </div>
            <ul class="val-liste">${zeilen}</ul>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

/* --- Törnstatistik ---------------------------------------------- */

function evTimestamp(ev) {
    const iso = ev.zeit || (ev.date ? ev.date + "T" + (ev.time || "00:00") : null);
    if (!iso) return null;
    return new Date(iso).getTime();
}

function motorUndSegelMinuten(events) {
    /* Zustandsmaschine: jeder Zustandswechsel akkumuliert die Zeit im vorherigen Zustand.
       Bisheriger Fehler: "Motor aus" und "Motorsegeln" wurden ignoriert → falsche Zeiten.

       Motor:        "Motor an"
       Segel:        "Segeln"
       Motorsegeln:  "Motorsegeln"  (eigene Kategorie)
       Stopp:        "Motor aus", "Ankern", "An Boje", "Anlegen",
                     "Anker lichten", "Von Boje" */
    const MOTOR      = new Set(["Motor an"]);
    const SEGEL      = new Set(["Segeln"]);
    const MOTORSEGL  = new Set(["Motorsegeln"]);
    const STOPP      = new Set(["Motor aus", "Ankern", "An Boje", "Anlegen",
                                 "Anker lichten", "Von Boje"]);

    const sorted = events
        .filter(e => MOTOR.has(e.type) || SEGEL.has(e.type) || MOTORSEGL.has(e.type) || STOPP.has(e.type))
        .filter(e => evTimestamp(e) !== null)
        .sort((a, b) => evTimestamp(a) - evTimestamp(b));

    let motorMin = 0, segelMin = 0, motsegelMin = 0;
    let zustand   = null;   /* "motor" | "segel" | "motorsegel" | null */
    let zustandTs = null;

    for (const ev of sorted) {
        const ts = evTimestamp(ev);

        /* Zeit im aktuellen Zustand bis zu diesem Event akkumulieren */
        if (zustand !== null && zustandTs !== null) {
            const dt = (ts - zustandTs) / 60000;
            if      (zustand === "motor")     motorMin    += dt;
            else if (zustand === "segel")     segelMin    += dt;
            else if (zustand === "motorsegel") motsegelMin += dt;
        }

        /* Zustand wechseln */
        if      (MOTOR.has(ev.type))    { zustand = "motor";     zustandTs = ts; }
        else if (SEGEL.has(ev.type))    { zustand = "segel";     zustandTs = ts; }
        else if (MOTORSEGL.has(ev.type)){ zustand = "motorsegel";zustandTs = ts; }
        else if (STOPP.has(ev.type))    { zustand = null;        zustandTs = null; }
    }

    return {
        motorMin:    Math.round(motorMin),
        segelMin:    Math.round(segelMin),
        motsegelMin: Math.round(motsegelMin)
    };
}

function minutenAusPaaren(events, startTyp, endTyp) {
    const relevant = events
        .filter(e => e.type === startTyp || e.type === endTyp)
        .filter(e => evTimestamp(e) !== null)
        .sort((a, b) => evTimestamp(a) - evTimestamp(b));
    let minuten = 0, startTs = null;
    for (const ev of relevant) {
        if (ev.type === startTyp && startTs === null) {
            startTs = evTimestamp(ev);
        } else if (ev.type === endTyp && startTs !== null) {
            const ts = evTimestamp(ev);
            if (ts > startTs) minuten += (ts - startTs) / 60000;
            startTs = null;
        }
    }
    return Math.round(minuten);
}

function nmProRudergaenger(toern) {
    const pts = (toern.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
    if (!pts.length) return {};

    const events = (toern.events || [])
        .filter(e => e.rudergaenger?.name && evZeitIso(e))
        .sort((a, b) => evZeitIso(a) < evZeitIso(b) ? -1 : 1);

    /* Kein einziges Event mit Rudergänger → gesamte Strecke dem Skipper zuordnen */
    if (!events.length) {
        const skipper = toern.skipper;
        if (!skipper) return {};
        let totalKm = 0;
        for (let i = 1; i < pts.length; i++)
            totalKm += haversineKm(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
        return { [skipper]: parseFloat((totalKm * 0.539957).toFixed(1)) };
    }

    const kmMap = {};
    const skipperDefault = toern.skipper || null;   /* Fallback vor erstem Rudergänger-Event */
    for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1];
        let aktRuder = skipperDefault;   /* → Skipper wenn kein Event davor */
        for (const ev of events) {
            if (evZeitIso(ev) <= p.zeit) aktRuder = ev.rudergaenger.name;
            else break;
        }
        if (!aktRuder) continue;
        kmMap[aktRuder] = (kmMap[aktRuder] || 0) + haversineKm(p.lat, p.lon, pts[i].lat, pts[i].lon);
    }
    const nmMap = {};
    for (const [name, km] of Object.entries(kmMap)) {
        nmMap[name] = parseFloat((km * 0.539957).toFixed(1));
    }
    return nmMap;
}

function toernStatistikBerechnen(toern) {
    const events = toern.events || [];

    const proTyp = {};
    for (const ev of events) {
        proTyp[ev.type] = (proTyp[ev.type] || 0) + 1;
    }

    const { motorMin, segelMin, motsegelMin } = motorUndSegelMinuten(events);

    const pts = (toern.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
    const nmGesamt = pts.length > 1 && typeof trackDistanzNm === "function"
        ? trackDistanzNm(pts) : null;

    return {
        gesamt:       events.length,
        proTyp,
        unterSegel:   segelMin,
        mitMotor:     motorMin,
        mitMotorsegel: motsegelMin,
        anker:        minutenAusPaaren(events, "Ankersetzen", "Anker auf"),
        hafen:        minutenAusPaaren(events, "Ankunft",    "Abfahrt"),
        nmRuder:      nmProRudergaenger(toern),
        nmGesamt
    };
}

function zeitFormatieren(minuten) {
    if (!minuten) return "—";
    const h = Math.floor(minuten / 60);
    const m = minuten % 60;
    if (h === 0) return m + "min";
    if (m === 0) return h + "h";
    return h + "h " + m + "min";
}

function toernStatistikRendern(stat) {
    if (!stat) { toernStatistik.innerHTML = ""; return; }

    const typZeilen = Object.entries(stat.proTyp)
        .sort((a, b) => b[1] - a[1])
        .map(([typ, anz]) =>
            `<li><span class="stat-typ">${typ}</span><span class="stat-anz">${anz}×</span></li>`)
        .join("");

    const zeiten = [
        { label: "Unter Segel",  wert: stat.unterSegel },
        { label: "Motorsegeln",   wert: stat.mitMotorsegel },
        { label: "Mit Motor",    wert: stat.mitMotor    },
        { label: "Vor Anker",    wert: stat.anker       },
        { label: "Im Hafen",     wert: stat.hafen       }
    ].filter(z => z.wert > 0);

    const zeitZeilen = zeiten.length
        ? zeiten.map(z =>
            `<li><span class="stat-typ">${z.label}</span><span class="stat-anz">${zeitFormatieren(z.wert)}</span></li>`
          ).join("")
        : "";

    const nmRuderEintraege = Object.entries(stat.nmRuder || {})
        .sort((a, b) => b[1] - a[1]);
    const nmRuderZeilen = nmRuderEintraege
        .map(([name, nm]) =>
            `<li><span class="stat-typ">${name}</span><span class="stat-anz">${nm} nm</span></li>`)
        .join("");

    toernStatistik.innerHTML = `
        <div class="card stat-card">
            <h2>📊 Statistik</h2>
            <div class="stat-grid">
                <div class="stat-block">
                    <div class="stat-block-title">Ereignisse gesamt</div>
                    <div class="stat-gesamt">${stat.gesamt}</div>
                    ${stat.gesamt > 0 ? `<ul class="stat-liste">${typZeilen}</ul>` : ""}
                </div>
                ${zeitZeilen ? `
                <div class="stat-block">
                    <div class="stat-block-title">Zeiten</div>
                    <ul class="stat-liste">${zeitZeilen}</ul>
                </div>` : ""}
                ${(nmRuderZeilen || stat.nmGesamt !== null) ? `
                <div class="stat-block">
                    <div class="stat-block-title">Seemeilen</div>
                    <ul class="stat-liste">
                        ${nmRuderZeilen}
                        ${stat.nmGesamt !== null ? `
                        <li class="stat-nm-gesamt">
                            <span class="stat-typ"><strong>Gesamt</strong></span>
                            <span class="stat-anz"><strong>${stat.nmGesamt} nm</strong></span>
                        </li>` : ""}
                    </ul>
                </div>` : ""}
            </div>
        </div>`;
}


/* --- Trackliste ------------------------------------------------- */

function tracklisteRendern(toern) {
    const leer   = document.getElementById("trackliste-leer");
    const inhalt = document.getElementById("trackliste-inhalt");
    const body   = document.getElementById("trackliste-body");
    const info   = document.getElementById("trackliste-info");

    if (!toern) {
        leer.hidden = false; inhalt.hidden = true; return;
    }
    leer.hidden = true; inhalt.hidden = false;

    const pts = (toern.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
    const nmGesamt = trackDistanzNm(pts);

    info.textContent = pts.length + " Punkte · " + nmGesamt + " nm gesamt";

    if (!pts.length) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:1rem">Keine Track-Punkte vorhanden</td></tr>';
        return;
    }

    body.innerHTML = pts.map((p, i) =>
        `<tr>
            <td>${i + 1}</td>
            <td>${p.zeit ? p.zeit.slice(11, 16) : "—"}</td>
            <td>${p.lat != null ? p.lat.toFixed(4) : "—"}</td>
            <td>${p.lon != null ? p.lon.toFixed(4) : "—"}</td>
            <td>${p.sog != null ? p.sog : "—"}</td>
        </tr>`
    ).join("");
}

/* --- Törnabschluss ---------------------------------------------- */

function toernAbschlussBerechnen(toern) {
    const stat = toernStatistikBerechnen(toern);
    return {
        tripName:  toern.tripName  || "(ohne Name)",
        zeitraum:  [toern.startDate, toern.endDate].filter(Boolean).join(" – ") || "—",
        startDate: toern.startDate || null,
        endDate:   toern.endDate   || null,
        skipper:   toern.skipper   || "—",
        shipData:  toern.shipData  || {},
        crew:      toern.crew      || [],
        notes:     toern.notes     || "",
        events:    (toern.events || []).slice().sort((a, b) =>
            evZeitIso(a) < evZeitIso(b) ? -1 : evZeitIso(a) > evZeitIso(b) ? 1 : 0
        ),
        stat
    };
}

/* Datumsfilter ganz oben im Statistik-Tab – filtert Statistik + Törnabschluss */
function statistikDatumFilterRendern(toern) {
    const container = document.getElementById("statistik-datum-filter-container");
    if (!container) return;
    if (!toern) { container.innerHTML = ""; return; }

    /* Eindeutige Tage innerhalb der Törn-Laufzeit */
    const tage = [...new Set(
        (toern.events || []).map(ev => evZeitIso(ev).slice(0, 10)).filter(Boolean)
    )].sort().filter(d =>
        (!toern.startDate || d >= toern.startDate) &&
        (!toern.endDate   || d <= toern.endDate)
    );

    if (tage.length <= 1) { container.innerHTML = ""; return; }

    const optionen = tage.map(d => `<option value="${d}">${isoZuDatum(d)}</option>`).join("");
    container.innerHTML = `
        <div class="statistik-filter-bar">
            <span class="statistik-filter-label">📅 Zeitraum:</span>
            <select id="statistik-datum-sel" class="ab-datum-select">
                <option value="alle">Alle Tage (${tage.length})</option>
                ${optionen}
            </select>
        </div>`;

    document.getElementById("statistik-datum-sel").onchange = function () {
        _statistikMitFilter(toern, this.value);
    };
}

/* Statistik + Törnabschluss mit gefiltertem Ereignis- und Track-Set neu rendern.
   Track-Punkte müssen ebenfalls gefiltert werden, da nmProRudergaenger() und
   trackDistanzNm() auf toern.track.points arbeiten – nicht auf events. */
function _statistikMitFilter(toern, datumFilter) {
    if (datumFilter === "alle") {
        toernStatistikRendern(toernStatistikBerechnen(toern));
        toernAbschlussRendern(toernAbschlussBerechnen(toern));
        return;
    }
    const gefilterteToern = Object.assign({}, toern, {
        events: (toern.events || []).filter(ev =>
            evZeitIso(ev).slice(0, 10) === datumFilter
        ),
        track: Object.assign({}, toern.track || {}, {
            points: (toern.track?.points || []).filter(p =>
                p.zeit && p.zeit.slice(0, 10) === datumFilter
            )
        })
    });
    toernStatistikRendern(toernStatistikBerechnen(gefilterteToern));
    toernAbschlussRendern(toernAbschlussBerechnen(gefilterteToern));
}

/* Hilfsfunktion: rendert die Ereigniszeilen (ohne Datumsfilter – wird jetzt von oben gefiltert) */
function _abEventZeilen(events, datumFilter) {
    const gefiltert = datumFilter === "alle"
        ? events
        : events.filter(ev => evZeitIso(ev).slice(0, 10) === datumFilter);
    if (!gefiltert.length)
        return `<tr><td colspan="11" class="ab-leer">Keine Ereignisse${datumFilter !== "alle" ? " für diesen Tag" : ""}</td></tr>`;
    return gefiltert.map(ev => {
        const w   = ev.weather;
        const iso = evZeitIso(ev);
        const pos = posText(ev);
        return `<tr>
            <td>${ev.type || ""}</td>
            <td>${isoZuDatum(iso.slice(0, 10))}</td>
            <td>${iso.slice(11, 16)}</td>
            <td>${ev.ort  || ""}</td>
            <td>${ev.rudergaenger ? ev.rudergaenger.name : ""}</td>
            <td>${windText(w)}</td>
            <td>${w ? w.windDirection || "" : ""}</td>
            <td>${w ? w.description  || "" : ""}</td>
            <td>${ev.note || ""}</td>
            <td>${pos}</td>
            <td>${ev.pos != null ? (ev.pos.sog ?? 0) : ""}</td>
        </tr>`;
    }).join("");
}

function toernAbschlussRendern(ab) {
    if (!ab) { toernAbschlussDiv.innerHTML = ""; return; }

    const sd = ab.shipData;
    const schiffZeilen = [
        sd.name         ? `<li><span>Schiff</span><span>${sd.name}</span></li>`         : "",
        sd.type         ? `<li><span>Bootstyp</span><span>${sd.type}</span></li>`        : "",
        sd.registration ? `<li><span>Kennzeichen</span><span>${sd.registration}</span></li>` : "",
        sd.engine       ? `<li><span>Motor</span><span>${sd.engine}</span></li>`         : ""
    ].join("");

    const crewZeilen = ab.crew.length
        ? ab.crew.map(p => `<li>${p.name}${p.role ? " · " + p.role : ""}</li>`).join("")
        : "<li>—</li>";

    const zeiten = [
        ["Unter Segel", ab.stat.unterSegel],
        ["Motorsegeln",  ab.stat.mitMotorsegel],
        ["Mit Motor",   ab.stat.mitMotor],
        ["Im Hafen",    ab.stat.hafen],
        ["Vor Anker",   ab.stat.anker]
    ].filter(([, m]) => m > 0)
     .map(([l, m]) => `<li><span>${l}</span><span>${zeitFormatieren(m)}</span></li>`)
     .join("");

    /* Eindeutige Tage aus Events – nur innerhalb der Törn-Laufzeit */
    toernAbschlussDiv.innerHTML = `
        <div class="card">
            <h2>📋 Törnabschluss</h2>

            <div class="ab-grid">
                <div class="ab-block">
                    <div class="ab-block-title">Törn</div>
                    <ul class="ab-liste">
                        <li><span>Name</span><span>${ab.tripName}</span></li>
                        <li><span>Zeitraum</span><span>${ab.zeitraum}</span></li>
                        <li><span>Schiffsführer</span><span>${ab.skipper}</span></li>
                        ${schiffZeilen}
                    </ul>
                </div>
                <div class="ab-block">
                    <div class="ab-block-title">Crew (${ab.crew.length})</div>
                    <ul class="ab-liste">${crewZeilen}</ul>
                </div>
                ${zeiten ? `<div class="ab-block">
                    <div class="ab-block-title">Zeiten</div>
                    <ul class="ab-liste">${zeiten}</ul>
                </div>` : ""}
            </div>

            <div class="ab-ereignis-header">
                <div class="ab-block-title">Ereignisse (${ab.events.length})</div>
            </div>
            <div class="ab-tabelle-wrap">
                <table class="ab-tabelle">
                    <thead><tr>
                        <th>Typ</th><th>Datum</th><th>Zeit</th><th>Ort</th>
                        <th>Rudergänger</th><th>Wind kn</th><th>Richtung</th><th>Wetter</th><th>Notiz</th><th>GPS</th><th>SOG kn</th>
                    </tr></thead>
                    <tbody>${_abEventZeilen(ab.events, "alle")}</tbody>
                </table>
            </div>
        </div>`;

}

function abschlussdrucken() {
    if (!aktuellerToern) return;
    const btnDruck = document.getElementById("btn-abschluss-druck");
    const btnDruckOriginal = btnDruck ? btnDruck.textContent : null;
    if (btnDruck) { btnDruck.disabled = true; btnDruck.textContent = "⏳ PDF wird erstellt…"; }
    const ab = toernAbschlussBerechnen(aktuellerToern);
    const sd = ab.shipData;

    const schiffMeta = [sd.name, sd.type, sd.registration, sd.engine ? "Motor: " + sd.engine : ""].filter(Boolean).join(" · ");
    const crewText   = ab.crew.map(p => p.name + (p.role ? " (" + p.role + ")" : "")).join(", ") || "—";

    const zeiten = [
        ["Unter Segel", ab.stat.unterSegel],
        ["Motorsegeln",  ab.stat.mitMotorsegel],
        ["Mit Motor",   ab.stat.mitMotor],
        ["Im Hafen",    ab.stat.hafen],
        ["Vor Anker",   ab.stat.anker]
    ].filter(([, m]) => m > 0)
     .map(([l, m]) => `<span>${l}: <strong>${zeitFormatieren(m)}</strong></span>`)
     .join("&nbsp;&nbsp;·&nbsp;&nbsp;");

    const nmRuderText = Object.entries(ab.stat.nmRuder || {})
        .sort((a, b) => b[1] - a[1])
        .map(([name, nm]) => `<span>${name}: <strong>${nm} nm</strong></span>`)
        .join("&nbsp;&nbsp;·&nbsp;&nbsp;");

    const eventZeilen = ab.events.map(ev => {
        const w   = ev.weather;
        const iso = evZeitIso(ev);
        const pos = posText(ev);
        return `<tr>
            <td>${ev.type || ""}</td>
            <td>${isoZuDatum(iso.slice(0, 10))}</td>
            <td>${iso.slice(11, 16)}</td>
            <td>${ev.ort  || ""}</td>
            <td>${ev.rudergaenger ? ev.rudergaenger.name : ""}</td>
            <td>${windText(w)}</td>
            <td>${w ? w.windDirection || "" : ""}</td>
            <td>${w ? w.description  || "" : ""}</td>
            <td>${ev.note || ""}</td>
            <td>${pos}</td>
            <td>${ev.pos != null ? (ev.pos.sog ?? "") : ""}</td>
        </tr>`;
    }).join("") || `<tr><td colspan="11" style="text-align:center;color:#666;font-style:italic;padding:6mm">Keine Ereignisse</td></tr>`;

    abschlussDruckBereich.innerHTML = `
        <div class="adp-header">
            <h1>${ab.tripName}</h1>
            <div class="adp-meta-row">
                <span>Zeitraum: <strong>${ab.zeitraum}</strong></span>
                <span>Schiffsführer: <strong>${ab.skipper}</strong></span>
                ${schiffMeta ? `<span>Schiff: <strong>${schiffMeta}</strong></span>` : ""}
            </div>
            <div class="adp-meta-row">Crew: ${crewText}</div>
            ${zeiten ? `<div class="adp-zeiten">${zeiten}</div>` : ""}
            ${nmRuderText ? `<div class="adp-zeiten">Seemeilen pro Rudergänger: ${nmRuderText}</div>` : ""}
            ${ab.notes ? `<div class="adp-notizen"><strong>Notizen:</strong> ${ab.notes}</div>` : ""}
        </div>
        <table class="adp-tabelle">
            <thead><tr>
                <th>Typ</th><th>Datum</th><th>Zeit</th><th>Ort</th>
                <th>Rudergänger</th><th>Wind kn</th><th>Richtung</th><th>Wetter</th><th>Notiz</th><th>GPS</th><th>SOG kn</th>
            </tr></thead>
            <tbody>${eventZeilen}</tbody>
        </table>
        <div class="adp-fusszeile">
            Segellogbuch · Törnabschluss · Erstellt am ${new Date().toLocaleDateString("de-DE")}
        </div>`;

    (async () => {
        const filename = (`segellogbuch_tournabschluss_${(ab.tripName || 'toern').replace(/[^a-z0-9\-\_ ]/gi, '')}_${new Date().toISOString().slice(0,10)}.pdf`).replace(/\s+/g, '_');
        const bereich = document.getElementById("logbuch-pdf-bereich") || abschlussDruckBereich;
        /* Temporär sichtbar off-screen für Rendering */
        bereich.style.position = "fixed";
        bereich.style.left = "-9999px";
        bereich.style.top = "0";
        bereich.style.display = "block";
        try {
            const blob = await _elementToPdfBlob(bereich);
            const saved = await _saveBlobNative(filename, blob);
            if (saved) {
                await _shareFileNative(filename);
                if (typeof statusSetzen === 'function') statusSetzen('PDF gespeichert und Teilen gestartet.', 'ok', 5000);
            } else {
                downloadBlob(blob, filename);
                if (typeof statusSetzen === 'function') statusSetzen('PDF zum Download bereitgestellt.', 'ok', 5000);
            }
        } catch (err) {
            console.error('PDF-Generierung fehlgeschlagen', err);
            if (typeof statusSetzen === 'function') statusSetzen('PDF-Generierung fehlgeschlagen.', 'error', 6000);
        } finally {
            /* Aufräumen */
            bereich.style.position = "";
            bereich.style.left = "";
            bereich.style.top = "";
            bereich.style.display = "";
            setTimeout(() => { abschlussDruckBereich.innerHTML = ""; }, 500);
            if (btnDruck) {
                btnDruck.textContent = "✅ Fertig";
                setTimeout(() => {
                    btnDruck.disabled = false;
                    btnDruck.textContent = btnDruckOriginal;
                }, 1800);
            }
        }
    })();
}


/* --- Törnübersicht ---------------------------------------------- */

function toernUebersichtRendern() {
    const alle = alleToernsLaden();
    if (alle.length === 0) {
        toernUebersicht.innerHTML = '<div class="card"><h2>🗂 Alle Törns</h2><p class="tu-leer">Noch keine Törns vorhanden.</p></div>';
        return;
    }
    const items = alle.map(t => {
        const zeitraum = [t.startDate, t.endDate].filter(Boolean).map(formatDatum).join(" – ") || "—";
        const anzahl   = (t.events || []).length;
        const pts      = (t.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
        const nm       = pts.length > 1 && typeof trackDistanzNm === "function"
            ? trackDistanzNm(pts) : null;

        const li = document.createElement("li");
        li.className = "tu-item" + (aktuellerToern && aktuellerToern.tripId === t.tripId ? " tu-aktiv" : "");

        const main = document.createElement("button");
        main.type = "button";
        main.className = "tu-main";
        main.innerHTML =
            '<span class="tu-name">' + (t.tripName || "(ohne Name)") + '</span>' +
            '<span class="tu-meta" style="font-size:10px;opacity:0.45;font-family:monospace">ID: ' + t.tripId + '</span>' +
            '<span class="tu-meta">' + zeitraum + '</span>' +
            '<span class="tu-meta">' + (t.skipper ? '👤 ' + t.skipper : '') + '</span>' +
            (nm !== null ? '<span class="tu-badge tu-nm-badge">⚓ ' + nm + ' nm</span>' : '') +
            '<span class="tu-badge">' + anzahl + ' Ereignis' + (anzahl !== 1 ? 'se' : '') + '</span>';
        main.onclick = () => { toernLaden(t.tripId); if (typeof seitenWechseln === "function") seitenWechseln(null); };

        const del = document.createElement("button");
        del.type = "button";
        del.className = "tu-del";
        del.textContent = "✕";
        del.title = "Törn löschen";
        del.onclick = (e) => {
            e.stopPropagation();
            if (!confirm(`Törn "${t.tripName || "(ohne Name)"}" wirklich löschen?`)) return;
            toernLoeschen(t.tripId);
            if (aktuellerToern && aktuellerToern.tripId === t.tripId) {
                aktuellerToern = null;
                formSection.hidden = true;
                btnToernLoeschen.hidden = true;
                toernSelect.value = "";
                tabInhaltToggeln();
            }
            toernSelectAktualisieren();
            statusSetzen("Törn gelöscht.", "ok");
        };

        li.appendChild(main);
        li.appendChild(del);
        return li;
    });

    const ul = document.createElement("ul");
    ul.className = "tu-liste";
    items.forEach(li => ul.appendChild(li));

    toernUebersicht.innerHTML = '<div class="card"><h2>🗂 Alle Törns</h2></div>';
    toernUebersicht.querySelector(".card").appendChild(ul);
}


/* ── Hilfsfunktion: Tabelle mit nativem jsPDF zeichnen ─────────── */

/**
 * Zeichnet eine Tabelle direkt mit jsPDF-Primitiven.
 * cols: [{label, w, align?}]  rows: string[][]
 * storniertSet: Set<number> von Row-Indizes die durchgestrichen erscheinen sollen
 * Gibt die neue y-Position (unterhalb der letzten Zeile) zurück.
 */
function _pdfTabelle(pdf, x, cols, rows, startY, opts) {
    const {
        margin    = 15,
        hdrBg     = [26, 58, 92],
        hdrFg     = [255, 255, 255],
        altBg     = [244, 247, 250],
        textSz    = 9,
        hdrSz     = 9,
        cellPad   = 1.5,
        storniertSet = new Set()
    } = (opts || {});

    const PH = 297;
    const mmPt  = pt => pt * 25.4 / 72;   /* pt → mm */
    const lineH = mmPt(textSz) * 1.55;     /* Zeilenhöhe */
    const hdrH  = mmPt(hdrSz)  * 1.55;

    let y = startY;

    /* Header zeichnen, gibt neue y zurück */
    const drawHeader = hy => {
        let cx = x;
        const rh = hdrH + 2 * cellPad;
        cols.forEach(col => {
            pdf.setFillColor(...hdrBg);
            pdf.setDrawColor(26, 58, 92);
            pdf.setLineWidth(0.2);
            pdf.rect(cx, hy, col.w, rh, 'FD');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(hdrSz);
            pdf.setTextColor(...hdrFg);
            pdf.text(col.label, cx + cellPad, hy + cellPad + mmPt(hdrSz) * 0.82);
            cx += col.w;
        });
        return hy + rh;
    };

    y = drawHeader(y);

    rows.forEach((row, ri) => {
        pdf.setFontSize(textSz);
        let maxLines = 1;
        cols.forEach((col, ci) => {
            const raw = String(row[ci] ?? '');
            const lines = raw.split('\n').flatMap(l => pdf.splitTextToSize(l, col.w - 2 * cellPad));
            if (lines.length > maxLines) maxLines = lines.length;
        });
        const rh = Math.max(maxLines * lineH + 2 * cellPad, lineH + 2 * cellPad);

        if (y + rh > PH - margin) {
            pdf.addPage();
            y = margin;
            y = drawHeader(y);
        }

        const isStorniert = storniertSet.has(ri);
        let cx = x;
        cols.forEach((col, ci) => {
            /* Hintergrund */
            pdf.setFillColor(...(ri % 2 === 0 ? altBg : [255, 255, 255]));
            pdf.setDrawColor(200, 200, 200);
            pdf.setLineWidth(0.15);
            pdf.rect(cx, y, col.w, rh, 'FD');

            /* Text */
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(textSz);
            pdf.setTextColor(...(isStorniert ? [180, 180, 180] : [0, 0, 0]));
            const align = col.align || 'left';
            const tx    = align === 'right' ? cx + col.w - cellPad : cx + cellPad;
            const raw2 = String(row[ci] ?? '');
            const lines = raw2.split('\n').flatMap(l => pdf.splitTextToSize(l, col.w - 2 * cellPad));
            pdf.text(lines, tx, y + cellPad + mmPt(textSz) * 0.82,
                { align, lineHeightFactor: 1.55 });
            cx += col.w;
        });
        y += rh;
    });
    return y;
}


/* ── Rechtlich korrektes Logbuch-PDF (nativ jsPDF) ─────────────── */

/* Gemeinsame PDF-Generierung – Logbuch-Format mit wählbaren Journal-Events */
async function _logbuchPdfGenerieren(toern, journalEvents, filename, btnPdf, btnPdfOriginal, modus = 'fortlaufend') {
    const t    = toern;
    const sd   = t.shipData || {};
    const stat = toernStatistikBerechnen(t);                    /* Statistik immer aus vollem Törn */
    const events = journalEvents.slice().sort((a, b) => evZeitIso(a) < evZeitIso(b) ? -1 : 1);

    try {
        await _ensurePdfLibs();
        const { jsPDF } = window.jspdf;
        const pdf  = new jsPDF({ format: 'a4', unit: 'mm' });

        const M   = 15;                  /* Seitenrand mm              */
        const PW  = 210, PH = 297;
        const CW  = PW - 2 * M;         /* Inhaltsbreite 180mm        */
        const navy = [26, 58, 92];
        const mmPt  = pt => pt * 25.4 / 72;

        let y = M;

        const fmt  = iso => iso ? isoZuDatum(iso.slice(0, 10)) : '—';
        const fmtZ = iso => iso ? iso.slice(11, 16) : '—';

        /* Abschnittsüberschrift: fett, marineblau, Linie darunter */
        const heading = (text, hy, sz = 11) => {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(sz);
            pdf.setTextColor(...navy);
            pdf.text(text, M, hy + mmPt(sz) * 0.82);
            const ly = hy + mmPt(sz) * 1.15;
            pdf.setDrawColor(...navy);
            pdf.setLineWidth(0.5);
            pdf.line(M, ly, M + CW, ly);
            return ly + 2;
        };

        /* ══════════════════════════════════════════════════════ */
        /* SEITE 1 – DECKBLATT                                    */
        /* ══════════════════════════════════════════════════════ */

        /* Titel */
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        pdf.setTextColor(...navy);
        pdf.text('SEGELLOGBUCH', PW / 2, y + mmPt(18) * 0.82, { align: 'center' });
        y += mmPt(18) * 1.3 + 1;
        pdf.setDrawColor(...navy);
        pdf.setLineWidth(0.9);
        pdf.line(M, y, M + CW, y);
        y += 6;

        /* 2-Spalten: Links Törn-Info, Rechts Besatzung */
        const leftW  = 84;
        const rightX = M + leftW + 12;
        const rightW = CW - leftW - 12;

        /* — Liens: Törn / Schiff ——————————————————————————————— */
        let leftY = y;
        {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.setTextColor(...navy);
            pdf.text('Törn', M, leftY + mmPt(10) * 0.82);
            leftY += mmPt(10) * 1.15;
            pdf.setDrawColor(...navy);
            pdf.setLineWidth(0.4);
            pdf.line(M, leftY, M + leftW, leftY);
            leftY += 2;

            const kW = 32;
            const vW = leftW - kW - 1;
            const meta = [
                ['Name',          t.tripName || '—'],
                ['Zeitraum',      [t.startDate, t.endDate].filter(Boolean).map(d => isoZuDatum(d)).join(' – ') || '—'],
                ['Schiffsführer', t.skipper || '—'],
                ['Schiff',        [sd.name, sd.type].filter(Boolean).join(', ') || '—'],
            ];
            if (sd.registration) meta.push(['Kennzeichen', sd.registration]);
            if (sd.engine)       meta.push(['Motor',       sd.engine]);

            pdf.setFontSize(10);
            meta.forEach(([k, v]) => {
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(90, 90, 90);
                pdf.text(k + ':', M, leftY + mmPt(10) * 0.82);
                pdf.setFont('helvetica', 'normal');
                pdf.setTextColor(0, 0, 0);
                const lines = pdf.splitTextToSize(String(v), vW);
                pdf.text(lines, M + kW, leftY + mmPt(10) * 0.82, { maxWidth: vW });
                leftY += lines.length * mmPt(10) * 1.5 + 0.8;
            });
        }

        /* — Rechts: Besatzung ————————————————————————————————— */
        let rightY = y;
        const crew = t.crew || [];
        if (crew.length > 0) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.setTextColor(...navy);
            pdf.text(`Besatzung (${crew.length})`, rightX, rightY + mmPt(10) * 0.82);
            rightY += mmPt(10) * 1.15;
            pdf.setDrawColor(...navy);
            pdf.setLineWidth(0.4);
            pdf.line(rightX, rightY, rightX + rightW, rightY);
            rightY += 2;

            const nW = rightW * 0.46, fW = rightW * 0.37, mW = rightW * 0.17;
            const crewCols = [
                { label: 'Name',     w: nW },
                { label: 'Funktion', w: fW },
                { label: 'nm',       w: mW, align: 'right' }
            ];
            const crewRows = crew.map(p => [
                p.name || '',
                p.role || '',
                stat.nmRuder?.[p.name] != null ? String(stat.nmRuder[p.name]) : '—'
            ]);
            rightY = _pdfTabelle(pdf, rightX, crewCols, crewRows, rightY,
                { margin: M, textSz: 9, hdrSz: 9 });
        }

        y = Math.max(leftY, rightY) + 5;

        /* — Statistik ————————————————————————————————————————— */
        y = heading('Statistik', y);
        const nmGesamt = typeof trackDistanzNm === 'function'
            ? trackDistanzNm((t.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1))
            : '—';
        const statRows = [
            ['Unter Segel', stat.unterSegel],
            ['Motorsegeln',  stat.mitMotorsegel],
            ['Mit Motor',   stat.mitMotor],
            ['Im Hafen',    stat.hafen],
            ['Vor Anker',   stat.anker]
        ].filter(([, m]) => m > 0).map(([l, m]) => [l, zeitFormatieren(m)]);
        statRows.push(['Seemeilen gesamt', nmGesamt + ' nm']);

        y = _pdfTabelle(pdf, M,
            [{ label: 'Zeitraum / Distanz', w: 140 }, { label: 'Dauer / Wert', w: 40, align: 'right' }],
            statRows, y, { margin: M, textSz: 9, hdrSz: 9 });
        y += 4;

        /* — Notizen ——————————————————————————————————————————— */
        if (t.notes) {
            y = heading('Notizen', y);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);
            pdf.setTextColor(50, 50, 50);
            pdf.setDrawColor(180, 180, 180);
            pdf.setLineWidth(0.5);
            pdf.line(M, y, M, y + 30);
            const noteLines = pdf.splitTextToSize(t.notes, CW - 5);
            pdf.text(noteLines, M + 3, y + mmPt(9) * 0.82, { lineHeightFactor: 1.5 });
            y += noteLines.length * mmPt(9) * 1.5 + 5;
        }

        /* — Routenkarte (html2canvas nur für SVG) ————————————— */
        const pts = (t.track?.points || []).slice().sort((a, b) => a.zeit < b.zeit ? -1 : 1);
        const routeSvg = await _routeAlsKartenSvg(pts, 760, 420);
        y = heading('Route', y);

        const karteDiv = document.createElement('div');
        karteDiv.style.cssText = 'position:fixed;left:-9999px;top:0;width:760px;background:#fff';
        karteDiv.innerHTML = routeSvg;
        document.body.appendChild(karteDiv);
        try {
            const kC = await window.html2canvas(karteDiv,
                { scale: 1.5, useCORS: true, allowTaint: true, backgroundColor: '#fff' });
            const kUrl = kC.toDataURL('image/jpeg', 0.85);
            const kAspect = kC.height / kC.width;
            const kHFull  = CW * kAspect;          /* Höhe bei voller Breite */
            const kHFree  = PH - M - y - 5;        /* verbleibender Platz Seite 1 */
            const MIN_H   = 50;                    /* mindestens 50mm, sonst neue Seite */
            if (kHFree >= MIN_H) {
                /* Karte auf verfügbaren Platz skalieren, Aspekt beibehalten */
                const kH = Math.min(kHFull, kHFree);
                const kW = kH / kAspect;           /* Breite proportional */
                const kX = M + (CW - kW) / 2;     /* zentrieren */
                pdf.addImage(kUrl, 'JPEG', kX, y, kW, kH);
                y += kH + 4;
            } else {
                /* Neue Seite, volle Breite */
                pdf.addPage();  y = M;
                pdf.addImage(kUrl, 'JPEG', M, y, CW, kHFull);
                y += kHFull + 4;
            }
        } finally {
            document.body.removeChild(karteDiv);
        }

        /* ══════════════════════════════════════════════════════ */
        /* SEITE 2+ – EREIGNISJOURNAL                             */
        /* ══════════════════════════════════════════════════════ */

        /* Hilfsfunktion: Tabellenzeile aus Event aufbauen (ohne Datum-Spalte) */
        const evZuTagRow = ev => {
            const w      = ev.weather;
            const iso    = evZeitIso(ev);
            const sog    = ev.pos?.sog != null && ev.pos.sog > 0 ? String(ev.pos.sog) : '';
            const gpsRaw = posText(ev);
            return [
                fmtZ(iso),
                (ev.type || '') + (ev.storniert ? ' [S]' : ''),
                ev.ort || '',
                ev.rudergaenger?.name || '',
                w ? String(w.windKnots || '') : '',
                w ? (w.windDirection || '') : '',
                sog, ev.note || '',
                gpsRaw ? gpsRaw.replace(', ', '\n') : ''
            ];
        };

        if (modus === 'pro-tag') {
            /* ── Pro-Tag: jeder Tag auf neuer Seite mit Zusammenfassung ── */
            const tageMap = {};
            events.forEach(ev => {
                const d = evZeitIso(ev).slice(0, 10);
                if (!tageMap[d]) tageMap[d] = [];
                tageMap[d].push(ev);
            });
            const allePts = (t.track?.points || []);

            const WOCHENTAGE = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
            const START_ORT  = new Set(['Ablegen', 'Von Boje', 'Anker lichten']);
            const STOPP_ORT  = new Set(['Anlegen', 'An Boje', 'Ankern']);

            /* 9-spaltige Tabelle ohne Datum */
            const dCols = [
                { label: 'Zeit',        w: 14 },
                { label: 'Ereignis',    w: 28 },
                { label: 'Ort',         w: 22 },
                { label: 'Rudergänger', w: 22 },
                { label: 'Wind kn',     w: 13, align: 'right' },
                { label: 'Richtung',    w: 12 },
                { label: 'SOG kn',      w: 12, align: 'right' },
                { label: 'Notiz',       w: 35 },
                { label: 'GPS',         w: 22 }
            ]; /* 14+28+22+22+13+12+12+35+22 = 180 ✓ */

            for (const datum of Object.keys(tageMap).sort()) {
                const tagesEvs = tageMap[datum];
                const tagsPts  = allePts.filter(p => p.zeit && p.zeit.slice(0, 10) === datum)
                                        .sort((a, b) => a.zeit < b.zeit ? -1 : 1);
                const tagStat  = toernStatistikBerechnen({ events: tagesEvs, track: { points: tagsPts } });
                const tagNm    = tagsPts.length > 1 && typeof trackDistanzNm === 'function'
                    ? trackDistanzNm(tagsPts) : null;

                pdf.addPage();  y = M;

                /* Tagesheader */
                const d = new Date(datum + 'T12:00:00');
                const wt = WOCHENTAGE[d.getDay()];
                y = heading(`${wt}, ${fmt(datum)}`, y, 14);
                y += 2;

                /* Tageszusammenfassung */
                const vonEv  = tagesEvs.find(e => START_ORT.has(e.type));
                const nachEv = [...tagesEvs].reverse().find(e => STOPP_ORT.has(e.type));
                const sumTeile = [];
                if (vonEv?.ort)  sumTeile.push(`Von: ${vonEv.ort}`);
                if (nachEv?.ort) sumTeile.push(`Nach: ${nachEv.ort}`);
                if (tagStat.unterSegel > 0)    sumTeile.push(`Segel: ${zeitFormatieren(tagStat.unterSegel)}`);
                if (tagStat.mitMotorsegel > 0)  sumTeile.push(`Motorsegeln: ${zeitFormatieren(tagStat.mitMotorsegel)}`);
                if (tagStat.mitMotor > 0)       sumTeile.push(`Motor: ${zeitFormatieren(tagStat.mitMotor)}`);
                if (tagNm)                       sumTeile.push(`${tagNm} nm`);
                sumTeile.push(`${tagesEvs.length} Ereignisse`);

                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8.5);
                pdf.setTextColor(80, 80, 80);
                const sumText = sumTeile.join('   ·   ');
                const sumLines = pdf.splitTextToSize(sumText, CW);
                pdf.text(sumLines, M, y + mmPt(8.5) * 0.82, { lineHeightFactor: 1.5 });
                y += sumLines.length * mmPt(8.5) * 1.5 + 3;

                /* Trennlinie */
                pdf.setDrawColor(220, 220, 220);
                pdf.setLineWidth(0.3);
                pdf.line(M, y, M + CW, y);
                y += 3;

                /* Events-Tabelle ohne Datum */
                const sSet = new Set(tagesEvs.map((ev, i) => ev.storniert ? i : -1).filter(i => i >= 0));
                const dRows = tagesEvs.map(evZuTagRow);
                y = _pdfTabelle(pdf, M, dCols, dRows, y, { margin: M, textSz: 8, hdrSz: 8, storniertSet: sSet });
            }

        } else {
            /* ── Fortlaufend (bisherige Darstellung) ── */
            pdf.addPage();  y = M;

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            pdf.setTextColor(...navy);
            pdf.text('Ereignisjournal', M, y + mmPt(14) * 0.82);
            y += mmPt(14) * 1.3;
            pdf.setDrawColor(...navy);
            pdf.setLineWidth(0.6);
            pdf.line(M, y, M + CW, y);
            y += 3;

            /* 10 Spalten, Summe 180mm */
            const jCols = [
                { label: 'Datum',        w: 19 },
                { label: 'Zeit',         w: 11 },
                { label: 'Ereignis',     w: 24 },
                { label: 'Ort',          w: 20 },
                { label: 'Rudergänger',  w: 20 },
                { label: 'Wind kn',      w: 13, align: 'right' },
                { label: 'Richtung',     w: 12 },
                { label: 'SOG kn',       w: 12, align: 'right' },
                { label: 'Notiz',        w: 27 },
                { label: 'GPS',          w: 22 }
            ];

            const storniertSet = new Set(
                events.map((ev, i) => ev.storniert ? i : -1).filter(i => i >= 0)
            );
            const jRows = events.map(ev => {
                const w   = ev.weather;
                const iso = evZeitIso(ev);
                const sog = ev.pos?.sog != null && ev.pos.sog > 0 ? String(ev.pos.sog) : '';
                const gpsRaw = posText(ev);
                const gps = gpsRaw ? gpsRaw.replace(', ', '\n') : '';
                return [
                    fmt(iso), fmtZ(iso),
                    (ev.type || '') + (ev.storniert ? ' [S]' : ''),
                    ev.ort || '',
                    ev.rudergaenger?.name || '',
                    w ? String(w.windKnots || '') : '',
                    w ? (w.windDirection || '') : '',
                    sog, ev.note || '', gps
                ];
            });

            y = _pdfTabelle(pdf, M, jCols, jRows, y,
                { margin: M, textSz: 8, hdrSz: 8, storniertSet });
        }

        /* ══════════════════════════════════════════════════════ */
        /* LETZTE SEITE – UNTERSCHRIFTEN                          */
        /* ══════════════════════════════════════════════════════ */
        pdf.addPage();  y = M + 15;

        /* Alle nicht-stornierten Schiffsführerwechsel, chronologisch */
        const sfEvs = events
            .filter(e => e.type === 'Schiffsführerwechsel' && !e.storniert)
            .sort((a, b) => evZeitIso(a).localeCompare(evZeitIso(b)));

        /* Törnende für letzten Abschnitt */
        const toernBisIso = (t.endDate && t.endTime)
            ? `${t.endDate}T${t.endTime}:00`
            : null;

        y = heading('Unterschriften', y);
        y += 8;

        if (sfEvs.length === 0) {
            /* Kein Schiffsführerwechsel – unverändertes Original-Layout */
            const sigLX = M, sigRX = M + CW / 2 + 5;
            let sigY = y;
            pdf.setFont('helvetica', 'bold');   pdf.setFontSize(10); pdf.setTextColor(0, 0, 0);
            pdf.text('Schiffsführer: ' + (t.skipper || '—'), sigLX, sigY);
            pdf.text('Ort, Datum:', sigRX, sigY);
            sigY += 4;
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80, 80, 80);
            pdf.text('Abschluss: ' + fmt(t.endDate || t.startDate), sigLX, sigY);
            sigY += 3;
            pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.4);
            pdf.line(sigLX, sigY + 22, sigLX + 75, sigY + 22);
            pdf.line(sigRX, sigY + 22, sigRX + 75, sigY + 22);
            sigY += 25;
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120);
            pdf.text('Unterschrift Schiffsführer', sigLX, sigY);
            pdf.text('Ort & Datum', sigRX, sigY);
        } else {
            /* Tabelle: alle Schiffsführer-Abschnitte  (52+38+38+52 = 180mm) */
            const sfCols = [
                { label: 'Schiffsführer', w: 52 },
                { label: 'Von',           w: 38 },
                { label: 'Bis',           w: 38 },
                { label: 'Unterschrift',  w: 52 }
            ];
            const _sfHeader = (yh) => {
                pdf.setFillColor(26, 58, 92); pdf.rect(M, yh, CW, 7, 'F');
                pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(255, 255, 255);
                let hx = M;
                for (const col of sfCols) { pdf.text(col.label, hx + 1.5, yh + 5); hx += col.w; }
                return yh + 7;
            };
            y = _sfHeader(y);

            for (let i = 0; i < sfEvs.length; i++) {
                const sf     = sfEvs[i];
                const vonIso = evZeitIso(sf);
                const bisIso = i < sfEvs.length - 1 ? evZeitIso(sfEvs[i + 1]) : toernBisIso;
                const vonTxt = vonIso ? `${fmt(vonIso)} ${fmtZ(vonIso)}` : '—';
                const bisTxt = bisIso ? `${fmt(bisIso)} ${fmtZ(bisIso)}` : 'laufend';
                const rowH   = 22;

                if (y + rowH > PH - M) { pdf.addPage(); y = M; y = _sfHeader(y); }

                pdf.setFillColor(...(i % 2 === 0 ? [255, 255, 255] : [244, 247, 250]));
                pdf.rect(M, y, CW, rowH, 'F');
                pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.2);
                pdf.rect(M, y, CW, rowH, 'S');

                pdf.setFont('helvetica', 'bold');   pdf.setFontSize(9); pdf.setTextColor(26, 58, 92);
                pdf.text(sf.rudergaenger?.name || '—', M + 2, y + 7);
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(50, 50, 50);
                pdf.text(vonTxt, M + 54, y + 7);
                pdf.text(bisTxt, M + 92, y + 7);

                if (sf.unterschrift) {
                    pdf.addImage(sf.unterschrift, 'PNG', M + 130, y + 2, 46, 16);
                } else {
                    pdf.setDrawColor(150, 150, 150); pdf.setLineWidth(0.3);
                    pdf.line(M + 130, y + 14, M + 178, y + 14);
                    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(150, 150, 150);
                    pdf.text('Unterschrift', M + 130, y + 18);
                }
                y += rowH;
            }

            /* Ort/Datum-Feld */
            y += 8;
            if (y + 15 > PH - M) { pdf.addPage(); y = M; }
            pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.4);
            pdf.line(M + CW / 2, y + 10, M + CW - 10, y + 10);
            pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120);
            pdf.text('Ort & Datum', M + CW / 2, y + 14);
        }

        /* Fußzeile */
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(170, 170, 170);
        pdf.text('Segellogbuch · Erstellt am ' + new Date().toLocaleDateString('de-DE'),
            PW - M, PH - M, { align: 'right' });

        /* ─ Blob erzeugen & speichern ─────────────────────────── */
        const blob  = pdf.output('blob');
        const saved = await _saveBlobNative(filename, blob);
        if (saved) {
            await _shareFileNative(filename);
            if (typeof statusSetzen === 'function') statusSetzen('PDF gespeichert und Teilen gestartet.', 'ok', 5000);
        } else {
            downloadBlob(blob, filename);
            if (typeof statusSetzen === 'function') statusSetzen('PDF zum Download bereitgestellt.', 'ok', 5000);
        }

    } catch (err) {
        console.error('PDF-Generierung fehlgeschlagen', err);
        if (typeof statusSetzen === 'function') statusSetzen('PDF-Generierung fehlgeschlagen.', 'error', 6000);
    } finally {
        if (btnPdf) {
            btnPdf.textContent = '✅ Fertig';
            setTimeout(() => { btnPdf.disabled = false; btnPdf.textContent = btnPdfOriginal; }, 1800);
        }
    }
}


async function logbuchPdfErstellen() {
    if (!aktuellerToern) { alert("Bitte zuerst einen Törn auswählen."); return; }

    /* Gliederungs-Dialog (nur bei mehrtägigem Törn) */
    const tage = [...new Set(
        (aktuellerToern.events || []).map(ev => evZeitIso(ev).slice(0, 10)).filter(Boolean)
    )].sort();

    let modus = 'fortlaufend';
    if (tage.length > 1) {
        modus = await new Promise(resolve => {
            const ov = document.createElement("div");
            ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center";
            ov.innerHTML = `
                <div style="background:#fff;border-radius:18px;padding:28px 24px;max-width:340px;width:92%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.25)">
                    <h3 style="margin:0 0 6px;color:#1a3a5c;font-size:18px">📄 Logbuch PDF</h3>
                    <p style="margin:0 0 20px;color:#64748b;font-size:14px">Gliederung wählen:</p>
                    <button id="lm-fort" style="width:100%;padding:13px;border:none;border-radius:12px;background:#e2e8f0;color:#334155;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer">📋 Fortlaufend</button>
                    <button id="lm-tag"  style="width:100%;padding:13px;border:none;border-radius:12px;background:#1a3a5c;color:#fff;font-size:15px;font-weight:700;margin-bottom:8px;cursor:pointer">📅 Pro Tag (mit Zusammenfassung)</button>
                    <button id="lm-cancel" style="width:100%;padding:10px;border:none;background:none;color:#94a3b8;font-size:14px;cursor:pointer">Abbrechen</button>
                </div>`;
            document.body.appendChild(ov);
            ov.querySelector("#lm-fort").onclick   = () => { document.body.removeChild(ov); resolve("fortlaufend"); };
            ov.querySelector("#lm-tag").onclick    = () => { document.body.removeChild(ov); resolve("pro-tag"); };
            ov.querySelector("#lm-cancel").onclick = () => { document.body.removeChild(ov); resolve(null); };
        });
        if (!modus) return;
    }

    const btn  = document.getElementById("btn-logbuch-pdf");
    const orig = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ PDF wird erstellt…"; }
    const filename = (`segellogbuch_logbuch_${(aktuellerToern.tripName || 'toern').replace(/[^a-z0-9\-\_ ]/gi, '')}_${new Date().toISOString().slice(0,10)}.pdf`).replace(/\s+/g, '_');
    await _logbuchPdfGenerieren(aktuellerToern, aktuellerToern.events || [], filename, btn, orig, modus);
}


/* ── Kurzausdruck – Logbuch-Format, nur Manöver ────────────────── */

async function kurzdruckPdfErstellen() {
    if (!aktuellerToern) { alert('Bitte zuerst einen Törn auswählen.'); return; }

    if (!aktuellerToern) { alert('Bitte zuerst einen Törn auswählen.'); return; }
    const MANOEVER = new Set(['Ablegen', 'Anlegen', 'Ankern', 'Anker lichten', 'An Boje', 'Von Boje']);
    const manoeverEvents = (aktuellerToern.events || []).filter(ev => MANOEVER.has(ev.type));
    const filename = (`segellogbuch_manoever_${(aktuellerToern.tripName || 'toern').replace(/[^a-z0-9\-\_ ]/gi, '')}_${new Date().toISOString().slice(0,10)}.pdf`).replace(/\s+/g, '_');
    await _logbuchPdfGenerieren(aktuellerToern, manoeverEvents, filename, null, null);
}

