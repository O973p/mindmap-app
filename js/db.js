/* Speicherschicht mit zwei Backends:
   - ApiStore: REST-API des Mini-Servers (server/server.py) — Maps liegen als
     Dateien auf dem Server, alle Geräte sehen dieselben Daten.
   - IDBStore: IndexedDB im Browser — Fallback, wenn kein Server erreichbar ist
     (z. B. beim Öffnen per file:// oder python -m http.server).
   initStore() erkennt beim Start automatisch, welcher Modus verfügbar ist. */

const IDBStore = (() => {
  const DB_NAME = 'mindmap-app';
  const DB_VERSION = 1;
  const STORE = 'maps';
  let dbPromise = null;

  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async all() {
      const db = await openDB();
      return wrap(db.transaction(STORE).objectStore(STORE).getAll());
    },
    async get(id) {
      const db = await openDB();
      return wrap(db.transaction(STORE).objectStore(STORE).get(id));
    },
    async put(map) {
      const db = await openDB();
      return wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).put(map));
    },
    async remove(id) {
      const db = await openDB();
      return wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    },
  };
})();

const ApiStore = {
  headers(extra) {
    return Object.assign({ 'X-Access-Key': localStorage.getItem('mm-key') || '' }, extra || {});
  },
  async all() {
    const r = await fetch('/api/maps', { headers: this.headers() });
    if (!r.ok) throw new Error('api ' + r.status);
    return r.json();
  },
  async get(id) {
    const r = await fetch('/api/maps/' + encodeURIComponent(id), { headers: this.headers() });
    if (!r.ok) return null;
    return r.json();
  },
  async put(map) {
    const r = await fetch('/api/maps/' + encodeURIComponent(map.id), {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(map),
    });
    if (!r.ok) throw new Error('api ' + r.status);
  },
  async remove(id) {
    await fetch('/api/maps/' + encodeURIComponent(id), { method: 'DELETE', headers: this.headers() });
  },
};

/* Ergebnis: {mode: 'remote'|'unauthorized'|'local', store} */
async function initStore() {
  try {
    const r = await fetch('/api/ping', { headers: ApiStore.headers() });
    if (r.status === 401) return { mode: 'unauthorized', store: null };
    if (r.ok) {
      const j = await r.json();
      if (j.ok) return { mode: 'remote', store: ApiStore };
    }
  } catch (_) { /* kein Server — lokaler Modus */ }
  return { mode: 'local', store: IDBStore };
}

let Store = IDBStore; // wird in main.js nach initStore() gesetzt

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    'id-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}
