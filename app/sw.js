const CACHE = "matripuntos-shell-v4";

const SHELL = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/app.js",
  "/js/errors.js",
  "/js/constants.js",
  "/js/bytes.js",
  "/js/crypto.js",
  "/js/argon2.js",
  "/js/pinned-file.js",
  "/js/passphrase.js",
  "/js/clipboard.js",
  "/vendor/argon2id/setup.js",
  "/vendor/argon2id/argon2id.js",
  "/vendor/argon2id/blake2b.js",
  "/vendor/argon2id/simd.wasm",
  "/vendor/argon2id/no-simd.wasm",
  "/vendor/diceware/eff-large-wordlist.txt",
  "/js/scoring.js",
  "/js/lock.js",
  "/js/delete-all.js",
  "/js/invite.js",
  "/js/export.js",
  "/js/sync.js",
  "/js/idb.js",
  "/js/vault.js",
  "/js/speech.js",
  "/js/audio.js",
  "/js/dom.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
