/* ======================
   MODALS.JS – Notiz-Popup, Sicherheitseinweisung, Tageskontrolle, MOB, Schiffsführer-Wechsel
====================== */

/* --- Notiz-Popup ------------------------------------------------- */

let _pendingNote        = "";
let _notizResolve        = null;
let _notizSpeechRunning  = false;
let _notizSpeechRecog    = null;

function notizUndSpeichern(typ, autoNotiz) {
    if (ANTRIEB_PFLICHT_TYPEN.has(typ) && !antriebAktiv()) {
        validierungsWarnung("Bitte zuerst Motor oder Segeln aktivieren");
        return;
    }
    if (!_pendingNote) _pendingNote = autoNotiz || "";
    schnellEintragSpeichern(typ).then(() => notizButtonBlinken());
}

function notizButtonBlinken() {
    const btn = document.getElementById("btn-notiz-manoever");
    if (!btn) return;
    btn.classList.remove("btn-notiz-blinkt"); /* Reset falls noch aktiv */
    void btn.offsetWidth;                     /* Reflow für Animation-Reset */
    btn.classList.add("btn-notiz-blinkt");
    setTimeout(() => btn.classList.remove("btn-notiz-blinkt"), 5000);
}

function notizZumLetztenManoever(typ) {
    if (typ === "Notiz") {
        if (!aktuellerToern) {
            validierungsWarnung("Bitte zuerst einen Törn auswählen.");
            return;
        }
        notizPopupZeigen("Notiz").then(() => {
            if (!_pendingNote) return;
            schnellEintragSpeichern("Notiz");
        });
        return;
    }

    // Bisherige Logik: letztes Event bearbeiten
    if (!aktuellerToern || !(aktuellerToern.events || []).length) {
        validierungsWarnung("Kein Manöver zum Ergänzen vorhanden.");
        return;
    }
    const sorted = (aktuellerToern.events || []).slice().sort((a, b) =>
        evZeitIso(a) < evZeitIso(b) ? -1 : 1
    );
    const letztes = sorted[sorted.length - 1];
    notizPopupZeigen("Notiz: " + letztes.type).then(() => {
        if (!_pendingNote) { _pendingNote = ""; return; }
        letztes.note = letztes.note ? letztes.note + "\n" + _pendingNote : _pendingNote;
        _pendingNote = "";
        toernSpeichern(aktuellerToern);
        zeigeLogs();
        statusSetzen("💬 Notiz ergänzt.", "ok", 2000);
    });
}

function notizPopupZeigen(typ) {
    return new Promise(resolve => {
        _notizResolve = resolve;
        const overlay  = document.getElementById("notiz-popup-overlay");
        const typLabel = document.getElementById("notiz-popup-typ");
        const textarea = document.getElementById("notiz-text");
        const micBtn   = document.getElementById("btn-notiz-mic");

        const anzeigeTyp = typ === "Notiz" ? "📒 Log-Buch" : typ;
        if (typLabel) typLabel.textContent = anzeigeTyp;
        if (textarea) { textarea.value = ""; textarea.oninput = null; }

        /* Mikrofon nur anzeigen wenn SpeechRecognition verfügbar */
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (micBtn) micBtn.style.display = SpeechRec ? "" : "none";

        if (overlay) overlay.style.display = "flex";
        if (textarea) textarea.focus();
    });
}


function notizPopupSchliessen() {
    _pendingNote = "";
    if (_notizResolve) _notizResolve("");
    _notizResolve = null;
    if (_notizSpeechRunning && _notizSpeechRecog) {
        _notizSpeechRecog.stop();
        _notizSpeechRunning = false;
    }
    document.getElementById("notiz-popup-overlay").style.display = "none";
}

function notizPopupSpeichern() {
    if (_notizSpeechRecog) { try { _notizSpeechRecog.abort(); } catch (_) {} _notizSpeechRecog = null; }
    _notizSpeechRunning = false;
    const micBtn = document.getElementById("btn-notiz-mic");
    if (micBtn) micBtn.textContent = "🎤";
    const textarea = document.getElementById("notiz-text");
    _pendingNote = textarea ? textarea.value.trim() : "";
    const overlay = document.getElementById("notiz-popup-overlay");
    if (overlay) overlay.style.display = "none";
    if (_notizResolve) { _notizResolve(); _notizResolve = null; }
}

function notizTextLeeren() {
    const ta = document.getElementById("notiz-text");
    if (ta) { ta.value = ""; ta.focus(); }
}

function notizMikrofonKlick() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    if (_notizSpeechRunning) {
        if (_notizSpeechRecog) _notizSpeechRecog.stop();
        return;
    }

    /* Countdown pausieren während Aufnahme läuft */
    if (typeof _notizCountdownStoppUiAktualisieren === "function") _notizCountdownStoppUiAktualisieren();

    _notizSpeechRunning = true;
    const micBtn = document.getElementById("btn-notiz-mic");
    if (micBtn) micBtn.textContent = "⏹";

    const recog = new SpeechRec();
    recog.lang             = "de-AT";
    recog.interimResults   = false;
    recog.maxAlternatives  = 1;
    _notizSpeechRecog = recog;

    recog.onresult = e => {
        const text = e.results[0][0].transcript;
        const ta   = document.getElementById("notiz-text");
        if (ta) ta.value = (ta.value ? ta.value + " " : "") + text;
    };

    const _nachAufnahme = () => {
        _notizSpeechRunning = false;
        _notizSpeechRecog   = null;
        if (micBtn) micBtn.textContent = "🎤";
    };

    recog.onend   = _nachAufnahme;
    recog.onerror = _nachAufnahme;
    recog.start();
}


/* --- Sicherheitseinweisung -------------------------------------- */

function sicherheitSeiteAktualisieren() {
    const hatToern = !!aktuellerToern;
    document.getElementById("sicherheit-leer").hidden = hatToern;
    document.getElementById("sicherheit-inhalt").hidden = !hatToern;
    if (!hatToern) return;

    // Datum
    const now = new Date();
    document.getElementById("sicherheit-datum").textContent =
        "Datum: " + now.toLocaleDateString("de-AT") + " · " + now.toLocaleTimeString("de-AT", {hour:"2-digit", minute:"2-digit"});

    // Checkboxen aus Törn-Daten laden (alte Listener entfernen via cloneNode)
    const gespeichert = aktuellerToern.sicherheitseinweisung || {};
    document.querySelectorAll(".sich-check").forEach(cb => {
        const fresh = cb.cloneNode(true);
        cb.parentNode.replaceChild(fresh, cb);
        fresh.checked = !!gespeichert[fresh.dataset.punkt];
        fresh.addEventListener("change", sicherheitCheckSpeichern);
    });
    document.getElementById("sicherheit-notiz").value = gespeichert.notiz || "";

    // Crew-Bestätigung aufbauen
    const crew = aktuellerToern.crew || [];
    const liste = document.getElementById("sicherheit-crew-liste");
    liste.innerHTML = crew.length ? "<h3 style='margin-top:1rem'>Bestätigung Crew</h3>" : "";
    crew.forEach(m => {
        const div = document.createElement("div");
        div.className = "sicherheit-crew-item";
        div.innerHTML = `<label><input type="checkbox" class="sich-crew-check" data-name="${m.name}" ${gespeichert["crew_" + m.name] ? "checked" : ""}> ${m.name} (${m.rolle}) – Einweisung erhalten</label>`;
        div.querySelector("input").addEventListener("change", sicherheitCheckSpeichern);
        liste.appendChild(div);
    });

    // Notiz-Feld bei Änderung speichern
    const notizFeld = document.getElementById("sicherheit-notiz");
    const notizFresh = notizFeld.cloneNode(true);
    notizFeld.parentNode.replaceChild(notizFresh, notizFeld);
    notizFresh.value = gespeichert.notiz || "";
    notizFresh.addEventListener("input", sicherheitCheckSpeichern);
}

function sicherheitCheckSpeichern() {
    if (!aktuellerToern) return;
    if (!aktuellerToern.sicherheitseinweisung) aktuellerToern.sicherheitseinweisung = {};
    document.querySelectorAll(".sich-check").forEach(cb => {
        aktuellerToern.sicherheitseinweisung[cb.dataset.punkt] = cb.checked;
    });
    document.querySelectorAll(".sich-crew-check").forEach(cb => {
        aktuellerToern.sicherheitseinweisung["crew_" + cb.dataset.name] = cb.checked;
    });
    aktuellerToern.sicherheitseinweisung.notiz =
        document.getElementById("sicherheit-notiz").value.trim();
    toernSpeichern(aktuellerToern);
}

function sicherheitAbschliessen() {
    const checks = document.querySelectorAll(".sich-check");
    const alle = Array.from(checks).every(cb => cb.checked);
    if (!alle) {
        statusSetzen("⚠️ Bitte alle Punkte abhaken.", "error");
        return;
    }
    const notiz = document.getElementById("sicherheit-notiz").value.trim();
    const crewChecks = Array.from(document.querySelectorAll(".sich-crew-check"))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.name);
    const crewText = crewChecks.length ? " · Crew: " + crewChecks.join(", ") : "";
    const noteText = (notiz ? notiz + " · " : "") + "Alle 10 Sicherheitspunkte eingewiesen" + crewText;

    _pendingNote = noteText;
    schnellEintragSpeichern("Sicherheitseinweisung");
    statusSetzen("✅ Sicherheitseinweisung ins Logbuch eingetragen.", "ok");
    seitenWechseln(null);
}

/* --- Tageskontrolle --------------------------------------------- */

function kontrolleSeiteAktualisieren() {
    const hatToern = !!aktuellerToern;
    document.getElementById("kontrolle-leer").hidden = hatToern;
    document.getElementById("kontrolle-inhalt").hidden = !hatToern;
    if (!hatToern) return;

    const now = new Date();
    document.getElementById("kontrolle-datum").textContent =
        "Datum: " + now.toLocaleDateString("de-AT") + " · " + now.toLocaleTimeString("de-AT", {hour:"2-digit", minute:"2-digit"});

    document.querySelectorAll(".kontr-check").forEach(cb => cb.checked = false);
    document.getElementById("kontrolle-notiz").value = "";
}

function kontrolleAbschliessen() {
    const checks = document.querySelectorAll(".kontr-check");
    const alle = Array.from(checks).every(cb => cb.checked);
    if (!alle) {
        statusSetzen("⚠️ Bitte alle Punkte abhaken.", "error");
        return;
    }
    const notiz = document.getElementById("kontrolle-notiz").value.trim();
    const noteText = notiz || "Alle 10 Punkte kontrolliert – keine Auffälligkeiten";

    _pendingNote = noteText;
    schnellEintragSpeichern("Tageskontrolle");
    statusSetzen("✅ Tageskontrolle ins Logbuch eingetragen.", "ok");
    seitenWechseln(null);
}

/* --- Floating Buttons ------------------------------------------- */

let _mobTimerInterval = null;
let _mobStartTime     = null;
let _mobTyp           = "mob";   /* "mob" | "boje" | "uebung" */
let _mobEvent         = null;    /* Referenz auf aktives Event */
let _mobPos           = null;    /* letzte GPS-Position */

function mobAusloesen() {
    _mobTyp   = "mob";
    _mobPos   = null;
    const ev  = mobSpeichern();
    _mobEvent = ev;
    mobOverlayZeigen(ev);
}

function mobTypSetzen(typ) {
    _mobTyp = typ;
    ["mob", "boje", "uebung"].forEach(t => {
        const b = document.getElementById("mob-typ-" + t);
        if (b) b.classList.toggle("aktiv", t === typ);
    });
    const titelEl = document.querySelector(".mob-titel");
    const titel = { mob: "🆘 MANN ÜBER BORD", boje: "🔵 BOJE ÜBER BORD", uebung: "🎓 MOB ÜBUNG" };
    if (titelEl) titelEl.textContent = titel[typ] || titel.mob;
    if (_mobEvent && typeof aktuellerToern !== "undefined" && aktuellerToern) {
        const typen = { mob: "MOB", boje: "Boje über Bord", uebung: "MOB Übung" };
        _mobEvent.type = typen[typ] || "MOB";
        if (typeof toernSpeichern === "function") toernSpeichern(aktuellerToern);
        if (typeof zeigeLogs === "function") zeigeLogs();
    }
    mobMaydayTextAktualisieren(_mobPos?.lat, _mobPos?.lon);
}

function mobMaydayTextAktualisieren(lat, lon) {
    const deEl  = document.getElementById("mob-mayday-text-de");
    const enEl  = document.getElementById("mob-mayday-text-en");
    const schiff = (typeof aktuellerToern !== "undefined" && aktuellerToern?.shipData?.name) || "Unbekanntes Schiff";
    const crew   = (typeof aktuellerToern !== "undefined" && aktuellerToern?.crew?.length)   ?? "?";
    const pos    = lat ? lat.toFixed(4) + ", " + lon.toFixed(4) : "wird ermittelt";

    if (_mobTyp === "uebung") {
        if (deEl) deEl.textContent = "⚠️ Dies ist eine Übung – kein echter Notfall.";
        if (enEl) enEl.textContent = "⚠️ This is a drill – not a real emergency.";
        return;
    }
    const geDE = _mobTyp === "boje" ? "Boje über Bord" : "Mann über Bord";
    const geEN = _mobTyp === "boje" ? "Buoy overboard"  : "Man Overboard";
    if (deEl) deEl.textContent = "Mayday Mayday Mayday – " + schiff + " – Position " + pos + " – " + geDE + " – " + crew + " Personen verbleibend – Über.";
    if (enEl) enEl.textContent = "Mayday Mayday Mayday – " + schiff + " – Position " + pos + " – " + geEN + " – " + crew + " persons on board – Over.";
}

function mobOverlayZeigen(ev) {
    _mobStartTime = Date.now();

    const overlay = document.getElementById("mob-overlay");
    if (!overlay) return;
    overlay.style.display = "flex";

    document.getElementById("mob-zeit-wert").textContent  = ev.zeit.slice(11, 16);
    document.getElementById("mob-pos-wert").textContent   = "wird ermittelt…";
    document.getElementById("mob-sog-wert").textContent   = "—";
    document.getElementById("mob-timer-wert").textContent = "00:00";
    document.getElementById("mob-notiz").value            = "";
    /* Typ-Buttons zurücksetzen */
    mobTypSetzen("mob");

    clearInterval(_mobTimerInterval);
    _mobTimerInterval = setInterval(() => {
        const sek = Math.floor((Date.now() - _mobStartTime) / 1000);
        const m   = String(Math.floor(sek / 60)).padStart(2, "0");
        const s   = String(sek % 60).padStart(2, "0");
        document.getElementById("mob-timer-wert").textContent = m + ":" + s;
    }, 1000);
}

function mobOverlayPositionAktualisieren(lat, lon, sog) {
    const posEl = document.getElementById("mob-pos-wert");
    if (posEl) posEl.textContent = lat.toFixed(4) + ", " + lon.toFixed(4);
    const sogEl = document.getElementById("mob-sog-wert");
    if (sogEl) sogEl.textContent = (sog != null ? sog : "—") + " kn";
    _mobPos = { lat, lon };
    mobMaydayTextAktualisieren(lat, lon);
}

function mobGeborgen() {
    clearInterval(_mobTimerInterval);
    _mobTimerInterval = null;

    const dauerSek = _mobStartTime ? Math.floor((Date.now() - _mobStartTime) / 1000) : 0;
    const notiz    = document.getElementById("mob-notiz")?.value.trim() || "";

    if (typeof mobGeborgenSpeichern === "function") {
        mobGeborgenSpeichern(notiz, dauerSek, _mobTyp);
    }

    const overlay = document.getElementById("mob-overlay");
    if (overlay) overlay.style.display = "none";
    _mobStartTime = null;
    _mobEvent     = null;
    _mobPos       = null;
}

function mobButtonInit() {
    const btn = document.getElementById("btn-mob");
    if (!btn) return;
    let _mobTimer = null;
    let _mobInterval = null;
    let _mobCountdown = 1;

    function mobStart() {
        _mobCountdown = 1;
        btn.style.transform = "scale(0.95)";
        _mobInterval = setInterval(() => {
            _mobCountdown--;
            btn.querySelector("span").textContent = _mobCountdown > 0 ? _mobCountdown + "s" : "MOB";
            if (_mobCountdown <= 0) {
                clearInterval(_mobInterval);
                mobAusloesen();
            }
        }, 1000);
        _mobTimer = setTimeout(() => {}, 3000);
    }

    function mobAbbrechen() {
        clearTimeout(_mobTimer);
        clearInterval(_mobInterval);
        _mobTimer = null;
        _mobInterval = null;
        _mobCountdown = 1;
        btn.querySelector("span").textContent = "MOB";
        btn.style.transform = "";
    }

    btn.addEventListener("pointerdown", mobStart);
    btn.addEventListener("pointerup", mobAbbrechen);
    btn.addEventListener("pointerleave", mobAbbrechen);
    btn.addEventListener("pointercancel", mobAbbrechen);
    btn.addEventListener("contextmenu", e => e.preventDefault());
}

mobButtonInit();


// ── Schiffsführer-Wechsel-Dialog ──────────────────────────────────────────
function sidebarAccToggle(id) {
    const body = document.getElementById(id);
    const icon = document.getElementById(id + "-icon");
    const open = body.style.display !== "none";
    body.style.display = open ? "none" : "block";
    icon.textContent = open ? "▶" : "▼";
}

function schiffsfuehrerWechselnDialog() {
    const jetzt = new Date();
    const pad = n => String(n).padStart(2, "0");
    const datum = `${jetzt.getFullYear()}-${pad(jetzt.getMonth()+1)}-${pad(jetzt.getDate())}`;
    const zeit  = `${pad(jetzt.getHours())}:${pad(jetzt.getMinutes())}`;

    document.getElementById("sf-datum").value = datum;
    document.getElementById("sf-zeit").value  = zeit;
    document.getElementById("sf-name").value  = "";

    const canvas = document.getElementById("sf-canvas");
    const rect   = canvas.getBoundingClientRect();
    canvas.width  = rect.width  || canvas.offsetWidth  || 340;
    canvas.height = rect.height || canvas.offsetHeight || 140;
    sfCanvasLeeren();
    sfCanvasSetup(canvas);

    // Crew-Buttons befüllen
    const crew = aktuellerToern ? (aktuellerToern.crew || []).map(p => p.name).filter(Boolean) : [];
    const sfCrewDiv = document.getElementById("sf-crew-buttons");
    sfCrewDiv.innerHTML = "";
    document.getElementById("sf-name").value = "";

    if (crew.length === 0) {
        sfCrewDiv.innerHTML = '<span style="color:var(--text-muted);font-size:0.9rem">Keine Crew eingetragen.</span>';
    } else {
        crew.forEach(name => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = name;
            btn.style.cssText = "padding:8px 14px;border-radius:20px;border:1.5px solid var(--border);background:var(--bg-card);font-size:0.95rem;cursor:pointer";
            btn.onclick = () => {
                document.getElementById("sf-name").value = name;
                sfCrewDiv.querySelectorAll("button").forEach(b => {
                    b.style.background = "var(--bg-card)";
                    b.style.borderColor = "var(--border)";
                    b.style.fontWeight = "normal";
                    b.style.color = "";
                });
                btn.style.background = "var(--primary)";
                btn.style.borderColor = "var(--primary)";
                btn.style.color = "#fff";
                btn.style.fontWeight = "600";
            };
            sfCrewDiv.appendChild(btn);
        });
    }

    document.getElementById("schiffsfuehrer-modal").style.display = "flex";
    setTimeout(() => document.getElementById("sf-name").focus(), 100);
}

function schiffsfuehrerModalSchliessen() {
    document.getElementById("schiffsfuehrer-modal").style.display = "none";
}

function sfCanvasLeeren() {
    const canvas = document.getElementById("sf-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function sfCanvasSetup(canvas) {
    // Alte Listener entfernen (clone-Trick)
    const neu = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(neu, canvas);
    const c  = document.getElementById("sf-canvas");
    const cx = c.getContext("2d");
    cx.strokeStyle = "#1a1a2e";
    cx.lineWidth   = 2.5;
    cx.lineCap     = "round";
    cx.lineJoin    = "round";

    let zeichnen = false;

    function getPos(e) {
        const r   = c.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    c.addEventListener("mousedown",  e => { zeichnen = true; const p = getPos(e); cx.beginPath(); cx.moveTo(p.x, p.y); });
    c.addEventListener("mousemove",  e => { if (!zeichnen) return; const p = getPos(e); cx.lineTo(p.x, p.y); cx.stroke(); });
    c.addEventListener("mouseup",    () => { zeichnen = false; });
    c.addEventListener("mouseleave", () => { zeichnen = false; });

    c.addEventListener("touchstart", e => { e.preventDefault(); zeichnen = true; const p = getPos(e); cx.beginPath(); cx.moveTo(p.x, p.y); }, { passive: false });
    c.addEventListener("touchmove",  e => { e.preventDefault(); if (!zeichnen) return; const p = getPos(e); cx.lineTo(p.x, p.y); cx.stroke(); }, { passive: false });
    c.addEventListener("touchend",   () => { zeichnen = false; });
}

function schiffsfuehrerWechselnSpeichern() {
    const name  = document.getElementById("sf-name").value.trim();
    const datum = document.getElementById("sf-datum").value;
    const zeit  = document.getElementById("sf-zeit").value;

    if (!name) {
        statusSetzen("⚠️ Bitte Schiffsführer auswählen.", "error", 3000);
        return;
    }

    if (!aktuellerToern) {
        statusSetzen("⚠️ Kein aktiver Törn.", "error", 3000);
        schiffsfuehrerModalSchliessen();
        return;
    }

    const zeitIso = datum && zeit ? `${datum}T${zeit}:00` : new Date().toISOString().slice(0, 19);

    const canvas = document.getElementById("sf-canvas");
    const unterschriftDataUrl = canvas.toDataURL("image/png");

    const ev = {
        id:           generateId(),
        type:         "Schiffsführerwechsel",
        kategorie:    "Allgemein",
        antrieb:      "",
        zeit:         zeitIso,
        ort:          "",
        rudergaenger: { name },
        note:         "",
        weather:      null,
        pos:          null,
        unterschrift: unterschriftDataUrl
    };

    aktuellerToern.events.push(ev);
    aktuellerToern.events.sort((a, b) => evZeitIso(a).localeCompare(evZeitIso(b)));

    gpsAbfragen(ev);
    toernSpeichern(aktuellerToern);
    zeigeLogs();
    statusSetzen("🧑‍✈️ " + name + " ist jetzt Schiffsführer.", "ok", 3000);

    schiffsfuehrerModalSchliessen();
}

