/* =========================================================================
   Ludora — persist.js
   Hardened local persistence.

   Design
   ──────
   · Every object is stored as a versioned envelope:
       { __ludora: 1, k, v: <schema>, t: <savedAt ms>, c: <checksum>, d }
     The checksum detects torn/corrupted writes; `v` drives migrations.
   · Dual durability: IndexedDB is the primary store for structured
     game/profile data; localStorage keeps an identical mirror so the app
     boots synchronously and survives environments without IDB
     (private mode, sandboxed frames, jsdom, file://).
   · Atomicity: writes go to `<key>~bak` first (last known good), then to
     the live key. A corrupt live value is recovered from the backup;
     a corrupt backup is discarded. IDB writes run in transactions.
   · Legacy support: raw v1 objects (pre-envelope) are detected, validated,
     migrated and re-enveloped with zero data loss.
   · Nothing here is tamper-proof — this is corruption resilience, not
     a security boundary. Players with device access can always edit
     local data; that is inherent to offline-first apps.
   ========================================================================= */
(function (global) {
  'use strict';

  var PREFIX = 'ludora:';
  var SCHEMAS = {};          // key → current schema version
  var MIGRATIONS = {};       // key → { fromV: fn(data) → data }
  var VALIDATORS = {};       // key → fn(data) → bool (throw allowed)

  var mem = {};              // sync cache: key → envelope (or null)
  var lsOK = true, idbOK = true, db = null;
  var hydrated = { fromIdb: false, replaced: [] };

  function safeLS() {
    try {
      var k = '__ludora_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return global.localStorage;
    } catch (e) { lsOK = false; return null; }
  }
  var LS = safeLS();

  /* ---------- checksum (FNV-1a, 32-bit) — corruption detection only ---------- */
  function checksum(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function payload(key, data) { return key + '|' + JSON.stringify(data); }

  /* ---------- envelopes ---------- */
  function deepCopy(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch (e) { return undefined; }
  }
  /* Envelopes always snapshot their data: a stored object must never alias
     live game state that keeps mutating after the save. */
  function envelope(key, data, version) {
    var copy = deepCopy(data);
    if (copy === undefined && data !== undefined) return null;
    return {
      __ludora: 1, k: key, v: version, t: Date.now(),
      c: checksum(payload(key, copy)), d: copy
    };
  }
  function verify(key, env) {
    if (!env || env.__ludora !== 1 || env.k !== key) return false;
    if (typeof env.d !== 'object' || env.d === null) return false;
    try { return checksum(payload(key, env.d)) === env.c; }
    catch (e) { return false; }
  }

  /* ---------- migrations + schema registry ---------- */
  function register(key, currentV, migrations, validator) {
    SCHEMAS[key] = currentV;
    MIGRATIONS[key] = migrations || {};
    VALIDATORS[key] = validator || null;
  }

  /* bring data up to the current schema for `key`; returns null if invalid */
  function normalize(key, env) {
    var cur = SCHEMAS[key];
    if (!cur) return env && env.d ? env : null;   // unversioned key: pass through
    var data, v;
    if (env && env.__ludora === 1) {              // envelope
      if (!verify(key, env)) return null;
      data = env.d; v = env.v;
    } else if (env !== undefined && env !== null && typeof env === 'object') {
      data = env; v = 1;                           // legacy raw object
    } else return null;
    var steps = 0;
    while (v < cur) {
      var mig = MIGRATIONS[key] && MIGRATIONS[key][v];
      if (!mig) return null;                       // cannot migrate → reject
      try { data = mig(data); } catch (e) { return null; }
      v++; if (++steps > 32) return null;
    }
    if (v > cur) return null;                      // from the future → reject
    if (VALIDATORS[key]) {
      try { if (!VALIDATORS[key](data)) return null; } catch (e) { return null; }
    }
    return envelope(key, data, cur);
  }

  /* ---------- localStorage mirror with backup rotation ---------- */
  function lsWrite(key, env) {
    if (!lsOK) return;
    var raw = JSON.stringify(env);
    try {
      var live = LS.getItem(PREFIX + key);
      if (live) LS.setItem(PREFIX + key + '~bak', live);
      LS.setItem(PREFIX + key, raw);
    } catch (e) { /* quota/unavailable: IDB remains authoritative */ }
  }
  function lsRead(key) {
    if (!lsOK) return null;
    var raw;
    try { raw = LS.getItem(PREFIX + key); } catch (e) { return null; }
    if (!raw) return null;
    var parsed = tryParse(raw);
    if (parsed !== undefined) return parsed;
    /* corrupt live value → attempt backup, quarantine the bad value */
    try {
      var bak = LS.getItem(PREFIX + key + '~bak');
      var bakParsed = bak ? tryParse(bak) : undefined;
      if (bakParsed !== undefined) {
        LS.setItem(PREFIX + key, bak);
        LS.removeItem(PREFIX + key + '~bak');
        return bakParsed;
      }
      LS.removeItem(PREFIX + key);
    } catch (e) {}
    return null;
  }
  function lsRemove(key) {
    if (!lsOK) return;
    try { LS.removeItem(PREFIX + key); LS.removeItem(PREFIX + key + '~bak'); } catch (e) {}
  }
  function tryParse(raw) { try { return JSON.parse(raw); } catch (e) { return undefined; } }

  /* ---------- IndexedDB ---------- */
  function idbOpen() {
    if (db || !idbOK) return Promise.resolve(db);
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      idbOK = false; return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('ludora', 1);
        req.onupgradeneeded = function () {
          try { req.result.createObjectStore('kv', { keyPath: 'k' }); } catch (e) {}
        };
        req.onsuccess = function () { db = req.result; resolve(db); };
        req.onerror = function () { idbOK = false; resolve(null); };
        req.onblocked = function () { idbOK = false; resolve(null); };
        setTimeout(function () { if (!db) { idbOK = false; resolve(null); } }, 2500);
      } catch (e) { idbOK = false; resolve(null); }
    });
  }
  function idbRun(mode, fn) {
    return idbOpen().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction('kv', mode);
          var st = tx.objectStore('kv');
          var out = fn(st);
          tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : true); };
          tx.onerror = function () { resolve(null); };
          tx.onabort = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }
  function idbPut(key, env) {
    return idbRun('readwrite', function (st) { st.put({ k: key, env: env }); });
  }
  function idbGet(key) {
    return new Promise(function (resolve) {
      idbRun('readonly', function (st) {
        var r = st.get(key);
        r.onsuccess = function () { resolve(r.result ? r.result.env : null); };
        r.onerror = function () { resolve(null); };
      }).then(function (fin) { if (fin === null) resolve(null); });
    });
  }
  function idbDelete(key) {
    return idbRun('readwrite', function (st) { st.delete(key); });
  }

  /* ---------- public API ---------- */
  function get(key) {
    if (!(key in mem)) mem[key] = normalize(key, lsRead(key));
    return mem[key] ? deepCopy(mem[key].d) : null;   // callers may mutate — never hand out the cached object
  }
  function put(key, data) {
    var env = envelope(key, data, SCHEMAS[key] || 1);
    if (!env) return false;                       // unserializable data is refused, not stored
    mem[key] = env;
    lsWrite(key, env);
    idbPut(key, env);
    return true;
  }
  function remove(key) {
    delete mem[key];
    lsRemove(key);
    idbDelete(key);
  }
  /* raw write bypassing envelopes — corruption test hook / last-resort */
  function putRaw(key, raw) {
    delete mem[key];
    if (lsOK) { try { LS.setItem(PREFIX + key, raw); } catch (e) {} }
  }

  /* boot: reconcile the IDB copy with the LS mirror (fresher t wins) */
  function hydrate() {
    var keys = Object.keys(SCHEMAS).concat(Object.keys(mem));
    return idbOpen().then(function (d) {
      if (!d) return hydrated;
      return Promise.all(keys.map(function (key) {
        return idbGet(key).then(function (env) {
          var cur = mem[key] || normalize(key, lsRead(key));
          if (env && (!cur || (env.t || 0) > (cur.t || 0))) {
            var norm = normalize(key, env);
            if (norm) {
              mem[key] = norm;
              lsWrite(key, norm);
              hydrated.fromIdb = true;
              hydrated.replaced.push(key);
            }
          } else if (!env && cur) {
            idbPut(key, cur);          // IDB lost/cleared → repopulate
          }
        });
      })).then(function () { return hydrated; });
    });
  }

  /* ---------- export / import (explicit, user-initiated) ---------- */
  function exportAll() {
    var out = { app: 'ludora', format: 1, exportedAt: new Date().toISOString(), data: {} };
    Object.keys(SCHEMAS).forEach(function (k) {
      var d = get(k);
      if (d !== null) out.data[k] = d;
    });
    return JSON.stringify(out, null, 2);
  }
  function importAll(json) {
    var obj = tryParse(json);
    if (!obj || obj.app !== 'ludora' || obj.format !== 1 || typeof obj.data !== 'object') {
      return { ok: false, error: 'Not a Ludora backup file' };
    }
    var applied = [], rejected = [];
    Object.keys(obj.data).forEach(function (k) {
      if (!SCHEMAS[k]) { rejected.push(k); return; }
      var env = envelope(k, obj.data[k], SCHEMAS[k]);
      if (!normalize(k, env)) { rejected.push(k); return; }
      put(k, obj.data[k]);
      applied.push(k);
    });
    return { ok: rejected.length === 0, applied: applied, rejected: rejected,
             error: rejected.length ? 'Rejected invalid entries: ' + rejected.join(', ') : null };
  }

  global.LudoraPersist = {
    register: register, get: get, put: put, remove: remove, putRaw: putRaw,
    hydrate: hydrate, exportAll: exportAll, importAll: importAll,
    _checksum: checksum, _envelope: envelope, _verify: verify, _normalize: normalize,
    stats: function () { return { ls: lsOK, idb: idbOK, hydrated: hydrated }; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraPersist;
})(typeof window !== 'undefined' ? window : globalThis);
