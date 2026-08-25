/* =========================================================================
   Ludora — main.js
   Bootstrap: init UI, register service worker, handle install prompt
   and safe update flow.
   ========================================================================= */
(function () {
  'use strict';

  function boot() {
    try {
      LudoraUI.init();
      /* reconcile the async IndexedDB copy with the localStorage mirror;
         if IDB turned out fresher, reload the profile behind the scenes */
      if (window.LudoraPersist) {
        LudoraPersist.hydrate().then(function (h) {
          if (h && h.fromIdb && h.replaced.length && window.LudoraUI.reloadProfile) {
            LudoraUI.reloadProfile();
          }
        }).catch(function () {});
      }
    } catch (e) {
      /* never leave the user with a blank screen */
      document.body.insertAdjacentHTML('beforeend',
        '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#0B0C10;color:#F4F5F7;font:600 15px -apple-system,Roboto,sans-serif;text-align:center;padding:30px">Something went wrong starting the game.<br/>Reload to try again.</div>');
      return;
    }
    registerSW();
    hookInstall();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    try {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        var handled = false;
        function offerUpdate() {
          if (handled) return;
          handled = true;
          LudoraUI.toast('Update ready — tap to restart', 'good', 'refresh');
          var t = document.getElementById('toasts').lastChild;
          if (t) {
            t.style.pointerEvents = 'auto';
            t.addEventListener('click', function () {
              try { reg.waiting && reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
            });
          }
        }
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate();
          });
        });
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate();
        var reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      }).catch(function () { /* SW is an enhancement; game works regardless */ });
    } catch (e) { /* ignore */ }
  }

  function hookInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      LudoraUI.setInstallEvent(e);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
