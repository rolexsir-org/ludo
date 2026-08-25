/* =========================================================================
   Ludora — ads.js
   Clean, offline-first monetization abstraction.

   Guarantees:
   - ZERO intrusive advertising: disabled by default, clean no-op provider.
   - Fully decoupled from core game engine.
   - Never interrupts active rolls, moves, captures, or gameplay.
   - Frequency-capped interstitial triggers only on natural post-match moments.
   - Optional rewarded bonus callbacks (e.g., bonus XP, cosmetic preview).
   - Instant graceful fallback when offline or provider unavailable.
   - Supports ad-free premium status.
   ========================================================================= */
(function (global) {
  'use strict';

  var _provider = null;
  var _premium = false;
  var _enabled = false;
  var _lastInterstitial = 0;
  var _minIntervalMs = 180000; // 3 minutes frequency cap
  var _matchesSinceAd = 0;
  var _matchThreshold = 3;     // show at most every 3 completed matches

  var Ads = {
    /**
     * Register an ad provider implementation.
     * provider: {
     *   init: fn() -> Promise,
     *   showInterstitial: fn(context) -> Promise<bool>,
     *   showRewarded: fn(placement) -> Promise<bool>,
     *   isAvailable: fn() -> bool
     * }
     */
    setProvider: function (provider) {
      _provider = provider;
      _enabled = !!provider;
    },

    isEnabled: function () {
      return _enabled && !_premium && !!_provider;
    },

    isPremium: function () {
      return _premium;
    },

    setPremium: function (val) {
      _premium = !!val;
    },

    /**
     * Checks if an interstitial ad is eligible to show.
     * Guaranteed to return false during matches or when cooldown has not elapsed.
     */
    canShowInterstitial: function () {
      if (!this.isEnabled()) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
      var now = Date.now();
      if (now - _lastInterstitial < _minIntervalMs) return false;
      if (_matchesSinceAd < _matchThreshold) return false;
      return _provider && typeof _provider.isAvailable === 'function' ? _provider.isAvailable() : false;
    },

    /**
     * Record a completed match for frequency capping.
     */
    recordMatchComplete: function () {
      _matchesSinceAd++;
    },

    /**
     * Show an interstitial ad if eligible at safe points (e.g. after post-match screen).
     * context: { mode: string, won: bool }
     */
    showInterstitial: function (context) {
      if (!this.canShowInterstitial()) {
        return Promise.resolve({ shown: false, reason: 'not_eligible' });
      }
      _lastInterstitial = Date.now();
      _matchesSinceAd = 0;
      try {
        return Promise.resolve(_provider.showInterstitial(context || {})).then(function (res) {
          return { shown: !!res };
        }).catch(function () {
          return { shown: false, reason: 'error' };
        });
      } catch (e) {
        return Promise.resolve({ shown: false, reason: 'exception' });
      }
    },

    /**
     * Show an optional rewarded ad for bonus rewards (e.g., bonus XP, cosmetics).
     * Never required for standard gameplay.
     */
    showRewarded: function (placement, onReward) {
      if (!this.isEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        // When offline or disabled, optional bonus gracefully resolves false
        return Promise.resolve({ rewarded: false, reason: 'unavailable' });
      }
      try {
        return Promise.resolve(_provider.showRewarded(placement || 'bonus')).then(function (success) {
          if (success && typeof onReward === 'function') {
            try { onReward(); } catch (e) {}
          }
          return { rewarded: !!success };
        }).catch(function () {
          return { rewarded: false, reason: 'error' };
        });
      } catch (e) {
        return Promise.resolve({ rewarded: false, reason: 'exception' });
      }
    },

    /**
     * Reset cooldowns (for test harness)
     */
    _resetCooldowns: function () {
      _lastInterstitial = 0;
      _matchesSinceAd = _matchThreshold;
    }
  };

  global.LudoraAds = Ads;
  if (typeof module !== 'undefined' && module.exports) module.exports = Ads;
})(typeof window !== 'undefined' ? window : globalThis);
