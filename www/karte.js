/* ======================
   KARTE.JS – Leaflet Track-Karte + Logbuch-Karte
====================== */

/* --- Track-Karte (Leaflet) --------------------------------------- */

let _trackMap  = null;
let _hauptKarte = null;
let _liveMarker = null;
let _liveCircle = null;
let _karteKlickModus = false;
let _trackpunktPendingLatLng = null;
let _logbuchKarte = null;
let _logbuchLiveMarker = null;
let _logbuchLiveCircle = null;
let _logbuchAnsicht = "daten";
let _logbuchSeaLayer      = null;
let _logbuchTiefenLayer   = null;
let _logbuchTiefenAbort   = null;
let _logbuchEmodnetAktiv  = false;
let _logbuchSeeModus      = "aus"; /* "aus" | "see" | "tiefen" */

/* haversineKm() → track.js */

function trackDistanzNm(pts) {
    let km = 0;
    for (let i = 1; i < pts.length; i++)
        km += haversineKm(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
    return (km * 0.539957).toFixed(1);
}

function liveMarkerEntfernen() {
    if (_liveMarker) { _liveMarker.remove(); _liveMarker = null; }
    if (_liveCircle) { _liveCircle.remove(); _liveCircle = null; }
}

function livePositionAktualisieren(lat, lon, sogKn) {
    logbuchKarteLiveAktualisieren(lat, lon);
    if (!_hauptKarte) return;

    if (!_liveMarker) {
        _liveMarker = L.circleMarker([lat, lon], {
            radius: 10,
            color: "#0ea5e9",
            fillColor: "#0ea5e9",
            fillOpacity: 0.9,
            weight: 3
        }).addTo(_hauptKarte);
        _liveCircle = L.circleMarker([lat, lon], {
            radius: 20,
            color: "#0ea5e9",
            fillColor: "#0ea5e9",
            fillOpacity: 0.15,
            weight: 1
        }).addTo(_hauptKarte);
    } else {
        _liveMarker.setLatLng([lat, lon]);
        _liveCircle.setLatLng([lat, lon]);
    }

    _liveMarker.bindTooltip((sogKn != null ? sogKn : "—") + " kn", {
        permanent: true,
        direction: "top",
        offset: [0, -12],
        className: "live-sog-tooltip"
    }).openTooltip();

    const karteTab = document.getElementById("tab-karte");
    const karteAktiv = karteTab && !karteTab.classList.contains("tab-hidden");
    if (karteAktiv) {
        _hauptKarte.panTo([lat, lon], { animate: true, duration: 0.5 });
        if (aktuellerToern) trackKarteRendern(aktuellerToern);
    }

}

function trackKarteRendern(toern) {
    const section = document.getElementById("track-section");
    if (!section) return;
    const pts = (toern?.track?.points) || [];
    if (pts.length < 2) { section.hidden = true; return; }
    section.hidden = false;

    /* Mini-Statistik */
    const distNm = trackDistanzNm(pts);
    const sogSum = pts.reduce((s, p) => s + (p.sog || 0), 0);
    const avgSog = pts.length ? (sogSum / pts.length).toFixed(1) : "—";
    document.getElementById("track-stat-mini").innerHTML =
        `<div class="track-stat-item"><span class="track-stat-label">Punkte</span><span class="track-stat-wert">${pts.length}</span></div>` +
        `<div class="track-stat-item"><span class="track-stat-label">Distanz</span><span class="track-stat-wert">${distNm} nm</span></div>` +
        `<div class="track-stat-item"><span class="track-stat-label">Ø SOG</span><span class="track-stat-wert">${avgSog} kn</span></div>`;

    /* Leaflet Karte */
    const mapDiv = document.getElementById("track-karte");
    if (_trackMap) { _trackMap.remove(); _trackMap = null; }
    _trackMap = L.map(mapDiv);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
        maxZoom: 18
    }).addTo(_trackMap);

    /* Route als Linie */
    const latlngs = pts.map(p => [p.lat, p.lon]);
    L.polyline(latlngs, { color: "#0ea5e9", weight: 3, opacity: 0.85 }).addTo(_trackMap);

    /* Start-Marker (grün) */
    const startIcon = L.divIcon({ className: "", html: "<div style='background:#16a34a;border:2px solid #fff;border-radius:50%;width:12px;height:12px;box-shadow:0 1px 4px rgba(0,0,0,.4)'></div>", iconSize: [12, 12], iconAnchor: [6, 6] });
    L.marker(latlngs[0], { icon: startIcon }).addTo(_trackMap)
        .bindPopup("▶ Start · " + pts[0].zeit.slice(11, 16));

    /* Ende-Marker (rot) */
    const endeIcon = L.divIcon({ className: "", html: "<div style='background:#dc2626;border:2px solid #fff;border-radius:50%;width:12px;height:12px;box-shadow:0 1px 4px rgba(0,0,0,.4)'></div>", iconSize: [12, 12], iconAnchor: [6, 6] });
    L.marker(latlngs[latlngs.length - 1], { icon: endeIcon }).addTo(_trackMap)
        .bindPopup("⏹ Ende · " + pts[pts.length - 1].zeit.slice(11, 16));

    /* Logbuch-Ereignisse als Punkte */
    const evIcon = L.divIcon({ className: "", html: "<div style='background:#f59e0b;border:2px solid #fff;border-radius:50%;width:9px;height:9px;box-shadow:0 1px 3px rgba(0,0,0,.3)'></div>", iconSize: [9, 9], iconAnchor: [4, 4] });
    (toern.events || []).forEach(ev => {
        if (ev.pos?.lat && ev.pos?.lon) {
            L.marker([ev.pos.lat, ev.pos.lon], { icon: evIcon }).addTo(_trackMap)
                .bindPopup(ev.type + " · " + (ev.zeit || "").slice(11, 16));
        }
    });

    /* Karte auf Route zentrieren */
    _trackMap.fitBounds(L.latLngBounds(latlngs).pad(0.15));

    /* Tabelle */
    trackTabelleRendern(pts);
}

function trackTabelleRendern(pts) {
    const wrap = document.getElementById("track-tabelle-wrap");
    if (!wrap) return;
    const zeilen = pts.map((p, i) => {
        let intervall = "—";
        if (i > 0) {
            const diffMs = new Date(pts[i].zeit) - new Date(pts[i-1].zeit);
            if (!isNaN(diffMs) && diffMs > 0) {
                const min = Math.round(diffMs / 60000);
                intervall = min + " min";
            }
        }
        return `<tr>
            <td>${p.zeit.slice(11, 16)}</td>
            <td>${p.lat.toFixed(4)}</td>
            <td>${p.lon.toFixed(4)}</td>
            <td>${p.sog ?? "—"}</td>
            <td>${intervall}</td>
        </tr>`;
    }).join("");
    wrap.innerHTML = `<table class="track-tabelle">
        <thead><tr><th>Zeit</th><th>Lat</th><th>Lon</th><th>SOG (kn)</th><th>Intervall</th></tr></thead>
        <tbody>${zeilen}</tbody>
    </table>`;
}

function karteTabRendern(toern) {
    const mapDiv = document.getElementById("haupt-karte");
    if (!mapDiv) return;
    let pts  = (toern?.track?.points) || [];
    let evts = (toern?.events) || [];
    if (_karteFilter === "heute") {
        const heute = heuteIso();
        pts  = pts.filter(p  => (p.zeit  || "").slice(0, 10) === heute);
        evts = evts.filter(ev => (ev.zeit || "").slice(0, 10) === heute);
    }
    /* Sortieren + Duplikate nach zeit entfernen (Timer & Event-GPS können gleiche Minute haben) */
    pts = pts.slice().sort((a, b) => a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : 0);
    const _seenZeit = new Set();
    pts = pts.filter(p => { if (_seenZeit.has(p.zeit)) return false; _seenZeit.add(p.zeit); return true; });
    /* Bearbeiten-Button synchronisieren */
    const _btnBearbeiten = document.getElementById("btn-karte-bearbeiten");
    if (_btnBearbeiten) {
        _btnBearbeiten.textContent = _karteBearbeitenModus ? "✅ Fertig" : "✏️ Bearbeiten";
        _btnBearbeiten.classList.toggle("btn-karte-bearbeiten-aktiv", _karteBearbeitenModus);
    }

    if (pts.length < 2) {
        mapDiv.innerHTML = "<p style='padding:16px;color:#64748b'>Keine Track-Daten vorhanden.</p>";
        return;
    }
    let _savedCenter = null;
    let _savedZoom   = null;
    if (_hauptKarte) {
        _savedCenter = _hauptKarte.getCenter();
        _savedZoom   = _hauptKarte.getZoom();
        _hauptKarte.remove();
        _hauptKarte = null;
    }
    _hauptKarte = L.map(mapDiv);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
        maxZoom: 18
    }).addTo(_hauptKarte);

    const latlngs = pts.map(p => [p.lat, p.lon]);
    L.polyline(latlngs, { color: "#0ea5e9", weight: 3, opacity: 0.85 }).addTo(_hauptKarte);

    /* Track-Punkt-Marker: im Bearbeitungs-Modus rote X, sonst grau mit langem Druck */
    if (_karteBearbeitenModus) {
        const delIcon = L.divIcon({ className: "", html: "<div style='background:#dc2626;color:#fff;border:2px solid #fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3)'>✕</div>", iconSize: [20, 20], iconAnchor: [10, 10] });
        pts.forEach(pt => {
            L.marker([pt.lat, pt.lon], { icon: delIcon }).addTo(_hauptKarte)
                .on("click", () => trackPunktLoeschen(pt.zeit));
        });
    } else {
        const tpIcon = L.divIcon({ className: "", html: "<div style='background:#94a3b8;border:2px solid #fff;border-radius:50%;width:8px;height:8px;box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:pointer'></div>", iconSize: [8, 8], iconAnchor: [4, 4] });
        pts.forEach(pt => {
            let _t = null;
            const m = L.marker([pt.lat, pt.lon], { icon: tpIcon }).addTo(_hauptKarte);
            m.bindPopup(
                `<div style="text-align:center;min-width:120px">` +
                `<div style="font-size:12px;margin-bottom:6px">${pt.zeit.slice(11, 16)} · ${pt.sog ?? 0} kn</div>` +
                `<button type="button" onclick="trackPunktLoeschen('${pt.zeit.replace(/'/g, "\\'")}')" ` +
                `style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px">` +
                `🗑 Löschen</button></div>`
            );
            m.on("mousedown touchstart", () => { _t = setTimeout(() => m.openPopup(), 600); });
            m.on("mouseup mouseout touchend touchcancel", () => { clearTimeout(_t); _t = null; });
        });
    }

    const startIcon = L.divIcon({ className: "", html: "<div style='background:#16a34a;border:2px solid #fff;border-radius:50%;width:12px;height:12px;box-shadow:0 1px 4px rgba(0,0,0,.4)'></div>", iconSize: [12, 12], iconAnchor: [6, 6] });
    L.marker(latlngs[0], { icon: startIcon }).addTo(_hauptKarte)
        .bindPopup("▶ Start · " + pts[0].zeit.slice(11, 16));

    const endeIcon = L.divIcon({ className: "", html: "<div style='background:#dc2626;border:2px solid #fff;border-radius:50%;width:12px;height:12px;box-shadow:0 1px 4px rgba(0,0,0,.4)'></div>", iconSize: [12, 12], iconAnchor: [6, 6] });
    L.marker(latlngs[latlngs.length - 1], { icon: endeIcon }).addTo(_hauptKarte)
        .bindPopup("⏹ Ende · " + pts[pts.length - 1].zeit.slice(11, 16));

    const evIcon = L.divIcon({ className: "", html: "<div style='background:#f59e0b;border:2px solid #fff;border-radius:50%;width:9px;height:9px;box-shadow:0 1px 3px rgba(0,0,0,.3)'></div>", iconSize: [9, 9], iconAnchor: [4, 4] });
    evts.forEach(ev => {
        if (ev.pos?.lat && ev.pos?.lon) {
            L.marker([ev.pos.lat, ev.pos.lon], { icon: evIcon }).addTo(_hauptKarte)
                .bindPopup(ev.type + " · " + (ev.zeit || "").slice(11, 16));
        }
    });

    if (_savedCenter && _savedZoom !== null) {
        _hauptKarte.setView(_savedCenter, _savedZoom);
    } else {
        _hauptKarte.fitBounds(L.latLngBounds(latlngs).pad(0.15));
    }
}

/* --- Track-Bearbeitung ------------------------------------------ */

function trackPunktLoeschen(zeit) {
    if (!aktuellerToern?.track?.points) return;
    aktuellerToern.track.points = aktuellerToern.track.points.filter(p => p.zeit !== zeit);
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    karteTabRendern(aktuellerToern);
    statusSetzen("🗑 Track-Punkt gelöscht.", "ok", 2000);
}

function trackLoeschen() {
    if (!aktuellerToern) return;
    if (!confirm("Track wirklich löschen?")) return;
    if (!aktuellerToern.track) aktuellerToern.track = {};
    aktuellerToern.track.points = [];
    toernSpeichern(aktuellerToern);
    karteTabRendern(aktuellerToern);
    letzteTrackPunkteZeigen();
    statusSetzen("🗑 Track gelöscht.", "ok", 2000);
}

function trackPunktHinzufuegen() {
    if (!aktuellerToern) { statusSetzen("Bitte zuerst einen Törn auswählen.", "error"); return; }

    if (_karteKlickModus) {
        // Klick-Modus beenden
        _karteKlickModus = false;
        _hauptKarte.off("click", _karteKlickHandler);
        _hauptKarte.getContainer().style.cursor = "";
        const statusEl = document.getElementById("karte-aktion-status");
        if (statusEl) statusEl.hidden = true;
        document.getElementById("btn-track-punkt").textContent = "📍 Track-Punkt hinzufügen";
        return;
    }

    // Klick-Modus starten
    _karteKlickModus = true;
    _hauptKarte.getContainer().style.cursor = "crosshair";
    const statusEl = document.getElementById("karte-aktion-status");
    if (statusEl) { statusEl.textContent = "👆 Auf Karte tippen um Punkt zu setzen"; statusEl.hidden = false; }
    document.getElementById("btn-track-punkt").textContent = "✕ Abbrechen";
    _hauptKarte.on("click", _karteKlickHandler);
}

function _karteKlickHandler(e) {
    // Klick-Modus sofort beenden
    _karteKlickModus = false;
    _hauptKarte.off("click", _karteKlickHandler);
    _hauptKarte.getContainer().style.cursor = "";
    document.getElementById("btn-track-punkt").textContent = "📍 Track-Punkt hinzufügen";
    const statusEl = document.getElementById("karte-aktion-status");
    if (statusEl) statusEl.hidden = true;

    // Zeit-Modal öffnen
    _trackpunktPendingLatLng = e.latlng;
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const datumText = now.toLocaleDateString("de-AT");
    document.getElementById("trackpunkt-zeit-input").value = hhmm;
    const datumIso = now.toISOString().slice(0, 10);
    document.getElementById("trackpunkt-datum-input").value = datumIso;
    document.getElementById("trackpunkt-zeit-overlay").style.display = "flex";
}

function trackpunktZeitBestaetigen() {
    const zeitVal = document.getElementById("trackpunkt-zeit-input").value;
    document.getElementById("trackpunkt-zeit-overlay").style.display = "none";
    if (!_trackpunktPendingLatLng) return;

    const now = new Date();
    const datumIso = document.getElementById("trackpunkt-datum-input").value
        || now.toISOString().slice(0, 10);
    const zeitIso = datumIso + "T" + (zeitVal || now.toTimeString().slice(0, 5)) + ":00";

    const pt = {
        lat:  parseFloat(_trackpunktPendingLatLng.lat.toFixed(5)),
        lon:  parseFloat(_trackpunktPendingLatLng.lng.toFixed(5)),
        sog:  0,
        zeit: zeitIso
    };
    _trackpunktPendingLatLng = null;

    if (!aktuellerToern.track)        aktuellerToern.track = {};
    if (!aktuellerToern.track.points) aktuellerToern.track.points = [];
    aktuellerToern.track.points.push(pt);
    aktuellerToern.track.points.sort((a, b) => a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : 0);
    toernSpeichern(aktuellerToern);
    autoBackupSpeichern();
    backupStatusAktualisieren();
    karteTabRendern(aktuellerToern);
    statusSetzen("📍 Track-Punkt gesetzt: " + zeitVal, "ok", 2000);
}

function trackpunktZeitAbbrechen() {
    document.getElementById("trackpunkt-zeit-overlay").style.display = "none";
    _trackpunktPendingLatLng = null;
}

// ── Logbuch-Karte ────────────────────────────────────────────────────────────

function logbuchAnsichtWechseln(ansicht) {
    _logbuchAnsicht = ansicht;

    const datenScroll    = document.getElementById("logbuch-daten-scroll");
    const karteContainer = document.getElementById("logbuch-karte-container");
    const btnDaten       = document.getElementById("btn-logbuch-daten");
    const btnSee         = document.getElementById("btn-logbuch-opensea");

    if (btnDaten) btnDaten.classList.toggle("aktiv", ansicht === "daten");

    if (ansicht === "opensea") {
        /* Zyklus: see → tiefen → see → ... */
        _logbuchSeeModus = (_logbuchSeeModus === "see") ? "tiefen" : "see";
        if (btnSee) { btnSee.classList.add("aktiv"); btnSee.textContent = _logbuchSeeModus === "tiefen" ? "⚓ See 📊" : "⚓ See"; }
        logbuchTiefenToggeln(_logbuchSeeModus === "tiefen");
    } else {
        _logbuchSeeModus = "aus";
        if (btnSee) { btnSee.classList.remove("aktiv"); btnSee.textContent = "⚓ See"; }
        logbuchTiefenToggeln(false);
        if (_logbuchKarte) _logbuchKarte.off("moveend", _logbuchTiefenOnMove);
    }

    if (ansicht === "daten") {
        if (datenScroll)    datenScroll.style.display    = "";
        if (karteContainer) karteContainer.style.display = "none";
        logbuchSeaLayerAnpassen();
    } else {
        if (datenScroll)    datenScroll.style.display    = "none";
        if (karteContainer) karteContainer.style.display = "block";
        logbuchKarteRendern();
        logbuchSeaLayerAnpassen();
        requestAnimationFrame(logbuchKarteHoeheAnpassen);
    }
}

function logbuchTiefenToggeln(aktiv) {
    _logbuchEmodnetAktiv = aktiv;
    if (!aktiv) {
        if (_logbuchTiefenAbort) { _logbuchTiefenAbort.abort(); _logbuchTiefenAbort = null; }
        if (_logbuchTiefenLayer && _logbuchKarte) { _logbuchKarte.removeLayer(_logbuchTiefenLayer); _logbuchTiefenLayer = null; }
        return;
    }
    if (!_logbuchKarte) return;
    logbuchTiefenLaden();
    _logbuchKarte.on("moveend", _logbuchTiefenOnMove);
}

function _logbuchTiefenOnMove() {
    if (_logbuchEmodnetAktiv) logbuchTiefenLaden();
}

async function logbuchTiefenLaden() {
    if (!_logbuchKarte || !_logbuchEmodnetAktiv) return;
    if (_logbuchTiefenAbort) _logbuchTiefenAbort.abort();
    _logbuchTiefenAbort = new AbortController();
    if (_logbuchTiefenLayer) { _logbuchKarte.removeLayer(_logbuchTiefenLayer); _logbuchTiefenLayer = null; }

    const b = _logbuchKarte.getBounds();
    const url = "https://ows.emodnet-bathymetry.eu/wfs?SERVICE=WFS&VERSION=2.0.0" +
        "&REQUEST=GetFeature&TYPENAMES=emodnet:contours&OUTPUTFORMAT=application/json" +
        "&BBOX=" + b.getWest() + "," + b.getSouth() + "," + b.getEast() + "," + b.getNorth() + ",EPSG:4326" +
        "&count=300";
    try {
        const res  = await fetch(url, { signal: _logbuchTiefenAbort.signal });
        const data = await res.json();
        _logbuchTiefenLayer = L.geoJSON(data, {
            style: f => {
                const d = Math.abs(f.properties.elevation || 0);
                return {
                    color:   d < 20 ? "#93c5fd" : d < 50 ? "#60a5fa" : d < 100 ? "#2563eb" : d < 200 ? "#1d4ed8" : "#1e3a8a",
                    weight:  d % 100 === 0 ? 2.5 : 1,
                    opacity: 0.75
                };
            },
            onEachFeature: (f, layer) => {
                layer.bindTooltip(Math.abs(f.properties.elevation || 0) + " m",
                    { sticky: true, direction: "top" });
            }
        }).addTo(_logbuchKarte);
    } catch (e) {
        if (e.name !== "AbortError") console.warn("Tiefenlinien:", e);
    }
}

function logbuchSeaLayerAnpassen() {
    if (!_logbuchKarte) return;
    if (_logbuchAnsicht === "opensea") {
        if (!_logbuchSeaLayer) {
            _logbuchSeaLayer = L.tileLayer(
                "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
                { attribution: "© OpenSeaMap", maxZoom: 18, opacity: 0.85 }
            ).addTo(_logbuchKarte);
        }
    } else {
        if (_logbuchSeaLayer) {
            _logbuchKarte.removeLayer(_logbuchSeaLayer);
            _logbuchSeaLayer = null;
        }
    }
}

function logbuchKarteHoeheAnpassen() {
    const sticky  = document.getElementById("logbuch-sticky");
    const karte   = document.getElementById("logbuch-karte");
    if (!sticky || !karte) return;
    const bottomBar    = document.querySelector(".bottom-bar");
    const stickyBottom = sticky.getBoundingClientRect().bottom;
    const bottomH      = bottomBar ? bottomBar.offsetHeight : 70;
    const hoehe        = Math.max(200, window.innerHeight - stickyBottom - bottomH - 16);
    karte.style.height = hoehe + "px";
    if (_logbuchKarte) _logbuchKarte.invalidateSize();
}

function logbuchKarteRendern() {
    const toern = aktuellerToern;
    const container = document.getElementById("logbuch-karte");
    if (!container) return;

    if (!_logbuchKarte) {
        _logbuchKarte = L.map(container, { zoomControl: true, attributionControl: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 18
        }).addTo(_logbuchKarte);
    } else {
        _logbuchKarte.eachLayer(layer => {
            if (!(layer instanceof L.TileLayer)) _logbuchKarte.removeLayer(layer);
        });
        _logbuchLiveMarker = null;
        _logbuchLiveCircle = null;
    }

    const pts = toern?.track?.points || [];
    if (pts.length > 1) {
        const latlngs = pts.map(p => [p.lat, p.lon]);
        L.polyline(latlngs, { color: "#0ea5e9", weight: 3, opacity: 0.85 }).addTo(_logbuchKarte);
        L.circleMarker(latlngs[0], { radius: 6, color: "#22c55e", fillOpacity: 1 }).addTo(_logbuchKarte);
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: "#ef4444", fillOpacity: 1 }).addTo(_logbuchKarte);
        _logbuchKarte.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
    } else if (pts.length === 1) {
        _logbuchKarte.setView([pts[0].lat, pts[0].lon], 14);
    } else {
        _logbuchKarte.setView([47.5, 14.0], 7);
    }

    setTimeout(() => _logbuchKarte.invalidateSize(), 100);
}

function logbuchKarteLiveAktualisieren(lat, lon) {
    if ((_logbuchAnsicht !== "karte" && _logbuchAnsicht !== "opensea") || !_logbuchKarte) return;

    if (!_logbuchLiveMarker) {
        _logbuchLiveMarker = L.circleMarker([lat, lon], {
            radius: 10, color: "#0ea5e9", fillColor: "#0ea5e9", fillOpacity: 0.9
        }).addTo(_logbuchKarte);
        _logbuchLiveCircle = L.circleMarker([lat, lon], {
            radius: 20, color: "#0ea5e9", fillOpacity: 0.15
        }).addTo(_logbuchKarte);
    } else {
        _logbuchLiveMarker.setLatLng([lat, lon]);
        _logbuchLiveCircle.setLatLng([lat, lon]);
    }
}
