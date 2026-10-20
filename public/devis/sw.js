/* Service worker : rend l'outil installable et garde l'interface disponible si le réseau coupe.
   Les données (/api) ne sont jamais mises en cache : elles viennent toujours du serveur. */
const CACHE = "atelier-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "ui.js", "pricing.js", "icons/icon-192.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/devis/")) return;
  // Réseau d'abord (toujours la dernière version), cache en secours hors connexion
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
