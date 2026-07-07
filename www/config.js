/* ======================
   CONFIG.JS
   App-Version und Auto-Update-Logik
====================== */

const APP_VERSION = "2.5.175";
let _updateIntervalId = null;

function updateButtonInit() {
    const lbl = document.getElementById("version-label");
    if (lbl) lbl.textContent = "v" + APP_VERSION;
}

async function autoUpdatePruefen() {
    try {
        /* Cache-Busting via Query-String + no-store */
        const res = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const lbl = document.getElementById("version-label");
        if (!lbl) return;
        if (data.version && data.version !== APP_VERSION) {
            if (typeof _updateIntervalId !== "undefined" && _updateIntervalId) {
                clearInterval(_updateIntervalId);
                _updateIntervalId = null;
            }
            lbl.textContent = "🔄 Update " + data.version;
            lbl.classList.add("update-verfuegbar");
            updateHinweisZeigen(data.version);
        } else {
            lbl.classList.remove("update-verfuegbar");
        }
    } catch { /* kein Netz – kein Problem */ }
}

function updateHinweisZeigen(neueVersion) {
    if (document.getElementById("update-hinweis")) return;
    const div = document.createElement("div");
    div.id = "update-hinweis";
    div.className = "update-hinweis";
    div.innerHTML =
        "<span>⚠️ Update " + neueVersion + " verfügbar</span>" +
        "<button type=\"button\" onclick=\"exportJSON()\">💾 Backup</button>" +
        "<button type=\"button\" onclick=\"updateErzwingen()\">🔄 Installieren</button>" +
        "<button type=\"button\" onclick=\"document.getElementById('update-hinweis').remove()\" " +
        "style=\"background:none;border:none;color:inherit;font-size:18px;cursor:pointer;padding:0 4px\">✕</button>";
    const versionBar = document.querySelector(".version-bar");
    if (versionBar) versionBar.insertAdjacentElement("beforebegin", div);
}

async function updateErzwingen() {
    const zeitlimit = new Promise(resolve => setTimeout(resolve, 5000));
    try {
        await Promise.race([
            (async () => {
                /* 1. Alle SW-Caches löschen – localStorage bleibt unangetastet */
                if ("caches" in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
                /* 2. Service Worker deregistrieren */
                if ("serviceWorker" in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                }
            })(),
            zeitlimit  /* Timeout nach 5s – auch bei schlechtem Netz */
        ]);
    } catch (e) {
        console.warn("Update-Vorbereitung Fehler:", e);
    }
    /* 3. Neu laden mit Cache-Busting-URL – erzwingt Netzwerk-Fetch auf iOS/Android */
    window.location.replace(window.location.pathname + "?v=" + Date.now());
}
