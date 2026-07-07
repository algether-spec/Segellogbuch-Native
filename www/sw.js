/* Service Worker – Segellogbuch Native
   In der Capacitor-App werden Assets aus dem APK geladen,
   daher nur minimales Caching für den PWA-Kompatibilitätsmodus. */

/* Cache-Name wird automatisch aus der Registrierungs-URL gelesen (?v=APP_VERSION).
   Kein manueller Bump nötig – reicht APP_VERSION in config.js zu erhöhen. */
const CACHE = "segellogbuch-" + (new URL(self.location.href).searchParams.get("v") || "v2");
const ASSETS = ["/", "/index.html", "/app.js", "/style.css", "/storage.js",
                "/config.js", "/track.js", "/karte.js", "/statistik.js",
                "/modals.js", "/leaflet.js", "/leaflet.css",
                "/html2canvas.min.js", "/jspdf.umd.min.js"];

self.addEventListener("install", e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener("activate", e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", e => {
    if (e.request.method !== "GET") return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
    );
});
