// Service worker mínimo: guarda la "cáscara" de la app; los datos siempre se piden en vivo a GitHub.
const CACHE = "jobhunter-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.json", "icon.svg", "icon-192.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
