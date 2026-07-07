/* ======================
   TRACK.JS – GPS-Track-Aufzeichnung + Wake Lock
   BackgroundGeolocation-Plugin (Android-Hintergrund-Tracking),
   Fallback auf watchPosition außerhalb der nativen App
====================== */

/* --- Zustands-Variablen ------------------------------------------ */

let _watchId     = null;   /* watchPosition-Handle ODER true bei aktivem Plugin (null = nicht aktiv) */
let _usingPlugin = false;  /* true = BackgroundGeolocation-Plugin steuert _watchId statt navigator.geolocation */
let _letzterPkt  = null;   /* letzter gespeicherter Track-Punkt         */
let _wakeLock    = null;   /* WakeLock-Sentinel (null = nicht aktiv)    */
let _speicherTimer = null; /* Debounce-Timer für toernSpeichern()       */
let _sogSchwelle   = 0.1; /* SOG-Jitter-Filter-Schwelle in Knoten      */
let _startBoost    = false;   /* true = erste 60s nach Fahrtstart       */
let _startBoostTimer = null;

/* --- BackgroundGeolocation-Plugin-Zugriff ------------------------- */

function _bgGeo() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundGeolocation;
}

/* Wandelt das flache Location-Objekt des Plugins in die von
   _trackWatchCallback erwartete { coords: {...} }-Form (wie navigator.geolocation) */
function _pluginLocationToPos(location) {
    return {
        coords: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            speed: location.speed
        },
        timestamp: location.time
    };
}

/* --- Haversine-Distanz (km) -------------------------------------- */

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* --- Track-Distanz (konfigurierbar) ------------------------------ */

function trackDistanzLaden() {
    const v = parseFloat(localStorage.getItem("segel_track_distanz"));
    return [0.05, 0.1, 0.2, 0.3, 0.4, 0.5].includes(v) ? v : 0.1;
}

function trackDistanzSpeichern(nm) {
    localStorage.setItem("segel_track_distanz", String(nm));
    _letzterPkt = null;
    trackDistanzSelectAktualisieren();
}

function trackDistanzSelectAktualisieren() {
    const sel = document.getElementById("track-distanz-select");
    if (sel) sel.value = String(trackDistanzLaden());
}

function sogSchwelleLaden() {
    const v = parseFloat(localStorage.getItem("segel_sog_schwelle"));
    return [0.05, 0.1, 0.2, 0.3, 0.4, 0.5].includes(v) ? v : 0.1;
}

function sogSchwelleSpeichern(kn) {
    localStorage.setItem("segel_sog_schwelle", String(kn));
    sogSchwelleSelectAktualisieren();
}

function sogSchwelleSelectAktualisieren() {
    const sel = document.getElementById("sog-schwelle-select");
    if (sel) sel.value = String(sogSchwelleLaden());
}

function trackIntervallLaden() {
    const v = parseFloat(localStorage.getItem("segel_track_intervall"));
    return [30, 60, 90, 120, 150, 180].includes(v) ? v : 120;
}

function trackAccuracyLaden() {
    const v = parseFloat(localStorage.getItem("segel_track_accuracy"));
    return [25, 50, 100, 200].includes(v) ? v : 100;
}

function trackAccuracySpeichern(m) {
    localStorage.setItem("segel_track_accuracy", String(m));
    trackAccuracySelectAktualisieren();
}

function trackAccuracySelectAktualisieren() {
    const sel = document.getElementById("track-accuracy-select");
    if (sel) sel.value = String(trackAccuracyLaden());
}

function trackIntervallSpeichern(sek) {
    localStorage.setItem("segel_track_intervall", String(sek));
    trackIntervallSelectAktualisieren();
}

function trackIntervallSelectAktualisieren() {
    const sel = document.getElementById("track-intervall-select");
    if (sel) sel.value = String(trackIntervallLaden());
}

/* --- Track-Status anzeigen --------------------------------------- */

function trackStatusAnzeigen(aktiv) {
    const el = document.getElementById("ls-track");
    if (!el) return;
    if (!aktiv) { el.textContent = "🔴 Track aus"; return; }
    el.textContent = _wakeLock !== null ? "🟢 Track · 🔆" : "🟢 Track · ⚠️";
}

/* --- Internen Punkt speichern ------------------------------------ */

function _trackPunktSpeichern(lat, lon, sog, zeitIso, accuracy = null) {
    if (!aktuellerToern) return;
    if (!aktuellerToern.track)        aktuellerToern.track = {};
    if (!aktuellerToern.track.points) aktuellerToern.track.points = [];
    const pkt = { lat, lon, sog, zeit: zeitIso };
    if (accuracy != null) pkt.accuracy = Math.round(accuracy);
    aktuellerToern.track.points.push(pkt);
    aktuellerToern.track.points.sort((a, b) => a.zeit < b.zeit ? -1 : a.zeit > b.zeit ? 1 : 0);
    _letzterPkt = pkt;
    if (_speicherTimer) clearTimeout(_speicherTimer);
    _speicherTimer = setTimeout(() => {
        toernSpeichern(aktuellerToern);
        _speicherTimer = null;
    }, 5000);
}

/* --- trackManöverPunkt: immer speichern (kein Distanz-Check) ----- */
/* Wird von schnellEintragSpeichern() aufgerufen                     */

function trackManöverPunkt(lat, lon, sog, zeitIso) {
    if (!aktuellerToern) return;
    _trackPunktSpeichern(
        parseFloat(lat.toFixed(5)),
        parseFloat(lon.toFixed(5)),
        sog,
        zeitIso
    );
}

/* --- watchPosition-Callback -------------------------------------- */

function _trackWatchCallback(pos) {
    if (!aktuellerToern || stoppZustandLaden() !== "fahrt") {
        trackStoppen();
        return;
    }

    /* GPS-Accuracy-Filter: Position zu ungenau → ignorieren */
    if (pos.coords.accuracy > trackAccuracyLaden()) return;

    const sogMs = pos.coords.speed;
    const sogKn = sogMs != null ? parseFloat((sogMs * 1.94384).toFixed(1)) : null;
    const sogVerfuegbar = sogMs != null;

    const newLat   = parseFloat(pos.coords.latitude.toFixed(5));
    const newLon   = parseFloat(pos.coords.longitude.toFixed(5));
    const intervall = _startBoost ? 10 : trackIntervallLaden();
    const minDistM  = _startBoost ? 0 : trackDistanzLaden() * 1852;
    const distM    = _letzterPkt
        ? haversineKm(_letzterPkt.lat, _letzterPkt.lon, newLat, newLon) * 1000
        : Infinity;
    const alterSek = _letzterPkt
        ? (Date.now() - new Date(_letzterPkt.zeit + "Z").getTime()) / 1000
        : Infinity;

    /* Bewegungslos: SOG bekannt+niedrig UND kaum Distanz UND innerhalb Intervall */
    const steht = sogVerfuegbar && sogKn <= sogSchwelleLaden()
                  && distM < 20 && alterSek < intervall;
    if (steht) {
        trackStatusAnzeigen(true);
        if (typeof livePositionAktualisieren === "function") {
            livePositionAktualisieren(newLat, newLon, sogKn);
        }
        return;
    }

    if (distM >= minDistM || alterSek >= intervall) {
        _trackPunktSpeichern(newLat, newLon, sogKn, lokalZeitIso(), pos.coords.accuracy ?? null);
    }
    trackStatusAnzeigen(true);
    if (typeof livePositionAktualisieren === "function") {
        livePositionAktualisieren(newLat, newLon, sogKn);
    }
}

/* --- trackStarten ----------------------------------------------- */

function trackStarten() {
    if (_watchId !== null) return;  /* Idempotent */
    if (!aktuellerToern || stoppZustandLaden() !== "fahrt") return;

    /* _letzterPkt aus vorhandenen Punkten initialisieren */
    const pts = aktuellerToern?.track?.points || [];
    if (!_letzterPkt && pts.length) _letzterPkt = pts[pts.length - 1];

    _startBoost = true;
    if (_startBoostTimer) clearTimeout(_startBoostTimer);
    _startBoostTimer = setTimeout(() => {
        _startBoost = false;
        _startBoostTimer = null;
    }, 60000);  /* 60 Sekunden Boost */

    const bgGeo = _bgGeo();
    if (bgGeo) {
        /* Natives Plugin: liefert Positionen auch bei gesperrtem Bildschirm
           oder Hintergrund-App (Android-Foreground-Service mit Notification) */
        _usingPlugin = true;
        bgGeo.start(
            {
                backgroundTitle: "Segellogbuch – Track aktiv",
                backgroundMessage: "GPS-Aufzeichnung läuft im Hintergrund",
                requestPermissions: true,
                stale: false
            },
            (location, error) => {
                if (error) { _trackWatchError(error); return; }
                _trackWatchCallback(_pluginLocationToPos(location));
            }
        );
        _watchId = true;
        _wakeLockAnfordern();
        trackStatusAnzeigen(false);  /* initial bis erste Position */
        return;
    }

    /* Fallback außerhalb der nativen App (z.B. Browser-Vorschau) */
    _usingPlugin = false;
    if (!navigator.geolocation) {
        if (typeof statusSetzen === "function") {
            statusSetzen("GPS wird auf diesem Gerät nicht unterstützt.", "error", 5000);
        }
        return;
    }
    _watchId = navigator.geolocation.watchPosition(
        _trackWatchCallback,
        _trackWatchError,
        { maximumAge: 0, timeout: 15000, enableHighAccuracy: true }
    );
    _wakeLockAnfordern();
    trackStatusAnzeigen(false);  /* initial bis erste Position */
}

function _trackWatchError(error) {
    trackStatusAnzeigen(false);
    let msg = "GPS-Trackfehler.";
    if (error && typeof error.code === "number") {
        msg = error.code === 1 ? "GPS-Berechtigung verweigert." :
              error.code === 2 ? "GPS-Position nicht verfügbar." :
              error.code === 3 ? "GPS-Timeout." :
              "GPS-Fehler: " + (error.message || "Unbekannt");
    } else if (error && typeof error.code === "string") {
        msg = error.code === "NOT_AUTHORIZED" ? "GPS-Berechtigung verweigert." :
              error.code === "NOT_SUPPORTED"  ? "GPS wird auf diesem Gerät nicht unterstützt." :
              "GPS-Fehler: " + (error.message || error.code);
    }
    if (typeof statusSetzen === "function") {
        statusSetzen(msg, "error", 6000);
    }
    if (_watchId !== null) {
        if (_usingPlugin) {
            const bgGeo = _bgGeo();
            if (bgGeo) bgGeo.stop().catch(() => {});
        } else if (navigator.geolocation) {
            navigator.geolocation.clearWatch(_watchId);
        }
        _watchId = null;
        _usingPlugin = false;
    }
}

/* --- Wake Lock --------------------------------------------------- */

async function _wakeLockAnfordern() {
    if (!("wakeLock" in navigator)) {
        trackStatusAnzeigen(_watchId !== null);
        return;
    }
    try {
        _wakeLock = await navigator.wakeLock.request("screen");
        _wakeLock.addEventListener("release", () => {
            _wakeLock = null;
            trackStatusAnzeigen(_watchId !== null);
            /* Sofort neu anfordern falls Fahrt noch aktiv */
            if (_watchId !== null && document.visibilityState === "visible" && stoppZustandLaden() === "fahrt") {
                _wakeLockAnfordern();
            }
        });
    } catch (_) {
        _wakeLock = null;
    }
    trackStatusAnzeigen(_watchId !== null);
}

function _wakeLockFreigeben() {
    if (_wakeLock !== null) {
        _wakeLock.release().catch(() => {});
        _wakeLock = null;
    }
}

/* visibilitychange: Wake Lock bei App-Rückkehr neu anfordern */
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && _watchId !== null && _wakeLock === null && stoppZustandLaden() === "fahrt") {
        _wakeLockAnfordern();
    }
});

/* Periodischer Check: Wake Lock alle 3 min erneuern falls verloren */
setInterval(() => {
    if (_watchId !== null && _wakeLock === null && document.visibilityState === "visible" && stoppZustandLaden() === "fahrt") {
        _wakeLockAnfordern();
    }
}, 180000);

/* --- trackStoppen ----------------------------------------------- */

function trackStoppen() {
    if (_watchId !== null) {
        if (_usingPlugin) {
            const bgGeo = _bgGeo();
            if (bgGeo) bgGeo.stop().catch(() => {});
        } else if (navigator.geolocation) {
            navigator.geolocation.clearWatch(_watchId);
        }
        _watchId = null;
        _usingPlugin = false;
    }
    _letzterPkt = null;
    if (_startBoostTimer) { clearTimeout(_startBoostTimer); _startBoostTimer = null; }
    _startBoost = false;
    _wakeLockFreigeben();
    if (_speicherTimer) {
        clearTimeout(_speicherTimer);
        _speicherTimer = null;
        toernSpeichern(aktuellerToern);
    }
    trackStatusAnzeigen(false);
}
