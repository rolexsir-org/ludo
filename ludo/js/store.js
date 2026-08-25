/* =========================================================================
   Ludora — store.js
   Compatibility surface over the hardened persistence layer
   (persist.js). Same synchronous API the game has always used:
     save(key, obj) · load(key, validator) · remove(key)
   plus saveRaw() as a corruption-test hook. All writes flow into the
   versioned, checksummed, dual-stored persistence layer.
   ========================================================================= */
(function (global) {
  'use strict';
  var P = global.LudoraPersist;
  if (!P) throw new Error('persist.js must load before store.js');

  var KEYS = { profile: 'profile.v1', match: 'match.v1' };
  var registered = false;

  /* Schemas are registered lazily so engine/profile (loaded after store.js
     in script order) are available without circular imports. */
  function ensureRegistered() {
    if (registered) return;
    registered = true;
    var E = global.LudoraEngine, Profile = global.LudoraProfile;

    P.register(KEYS.profile, 2, {
      1: function (d) {
        /* v1 → v2: online-play stats (all older fields preserved as-is) */
        d.stats = d.stats || {};
        d.stats.onlineMatches = d.stats.onlineMatches || 0;
        d.stats.onlineWins = d.stats.onlineWins || 0;
        d.v = 2;
        return d;
      }
    }, function (d) {
      return Profile ? !!Profile.validateProfile(d) : typeof d === 'object';
    });

    P.register(KEYS.match, 2, {
      1: function (d) {
        /* v2 of the storage envelope adds online-match support (cfg.net).
           The packet's internal format (d.v) is unchanged. */
        return d;
      }
    }, function (d) {
      return E ? !!E.validateState(d && d.st) : typeof d === 'object';
    });
  }

  function save(key, obj) { ensureRegistered(); return P.put(key, obj); }
  function load(key, validator) {
    ensureRegistered();
    var d = P.get(key);
    if (d === null) return null;
    if (validator) {
      var ok = false;
      try { ok = validator(d); } catch (e) { ok = false; }
      if (!ok) { P.remove(key); return null; }   // corrupted → discard
    }
    return d;
  }
  function remove(key) { ensureRegistered(); P.remove(key); }
  function saveRaw(key, raw) { ensureRegistered(); P.putRaw(key, raw); }

  global.LudoraStore = {
    save: save, load: load, remove: remove, saveRaw: saveRaw,
    keys: KEYS, _persist: P
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraStore;
})(typeof window !== 'undefined' ? window : globalThis);
