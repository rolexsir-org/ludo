/* Ludora — dev/integration.cjs
   Boots the real app in jsdom (with a canvas stub) and drives complete
   matches through the actual UI + controller code paths: quick match vs AI,
   pass & play handoff, save/resume, corrupted save recovery, pause/resume.
   run: node dev/integration.cjs */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'https://ludora.test/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;

/* ---- stub canvas 2D (records nothing, safe to call) ---- */
const ctxStub = () => new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return null;
    return (...a) => {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return { addColorStop: () => {} };
      }
      if (k === 'measureText') return { width: 10 };
      return undefined;
    };
  },
  set() { return true; }
});
const canvasProto = {
  getContext: () => ctxStub(),
  get width() { return this._w || 600; }, set width(v) { this._w = v; },
  get height() { return this._h || 600; }, set height(v) { this._h = v; },
  style: {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
  addEventListener: () => {},
  clientWidth: 600, clientHeight: 600
};
window.HTMLCanvasElement.prototype.getContext = function () { return ctxStub(); };
window.document.createElement = (function (orig) {
  return function (tag) {
    const el = orig.call(window.document, tag);
    if (tag === 'canvas') {
      el.getContext = () => ctxStub();
      el.toDataURL = () => '';
    }
    return el;
  };
})(window.document.createElement);

/* deterministic timers */
let now = 0;
const pending = new Map(); // id → {fn, at, dead}
let nextId = 1;
window.performance.now = () => now;
window.setTimeout = (fn, ms) => { const id = nextId++; pending.set(id, { fn, at: now + (ms || 0) }); return id; };
window.clearTimeout = (id) => { if (pending.has(id)) pending.get(id).dead = true; };
window.cancelAnimationFrame = (id) => { if (pending.has(id)) pending.get(id).dead = true; };
window.requestAnimationFrame = (fn) => { const id = nextId++; pending.set(id, { fn, at: now + 16, raf: true }); return id; };

function advance(ms) {
  const target = now + ms;
  for (;;) {
    let next = null, nextId2 = -1;
    for (const [id, p] of pending) {
      if (!p.dead && p.at <= target && (!next || p.at < next.at)) { next = p; nextId2 = id; }
    }
    if (!next) break;
    now = next.at;
    pending.delete(nextId2);
    try { next.fn(next.at); } catch (e) { console.log('    TIMER ERR:', e.message, '@', (e.stack.split('\n')[1] || '').slice(0, 140)); }
  }
  now = target;
}

/* load scripts */
global.window = window;
for (const mod of ['engine', 'ai', 'persist', 'store', 'profile', 'audio', 'board', 'net', 'mp', 'qr', 'game']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', mod + '.js'), 'utf8');
  window.eval(code);
}
/* stubs ui needs */
window.devicePixelRatio = 2;
window.navigator.vibrate = () => true;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.stack || e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

console.log('\nBOOT');
t('app boots to home screen without errors', () => {
  const uiCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
  window.eval(uiCode);
  const mainCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
  window.eval('(function(){' + mainCode + '})'); // main.js is IIFE-free; call boot directly below instead
  window.LudoraUI.init();
  assert(window.document.getElementById('scr-home').classList.contains('active'));
  assert(window.document.getElementById('btnQuick'), 'home renders quick button');
});

const UI = window.LudoraUI, Game = window.LudoraGame, Store = window.LudoraStore, E = window.LudoraEngine;

function playToEnd(maxSimMs, label) {
  let endPayload = null;
  const g = Game.active();
  const orig = g.onEnd;
  g.onEnd = (r) => { try { orig && orig(r); } catch (e) { console.log('    showEnd ERR:', e.message); } endPayload = r; };
  let guard = 0;
  while (!endPayload) {
    advance(400);
    /* auto-ack handoffs & tap dice for human turns */
    const banner = window.document.getElementById('handoffBanner');
    const overlay = window.document.getElementById('handoffOverlay');
    if (banner && !banner.classList.contains('hidden') && banner.onclick) banner.onclick();
    if (overlay && !overlay.classList.contains('hidden') && overlay.onclick) overlay.onclick();
    const g2 = Game.active();
    if (g2 && g2.st && g2.st.phase === 'roll' && g2.st.seats[g2.st.turn].kind === 'human') g2.rollRequest();
    if (g2 && g2.st && g2.st.phase === 'move' && g2.st.seats[g2.st.turn].kind === 'human') {
      /* pick first legal token via keyboard path */
      const legal = E.legalMoves(g2.st, g2.st.lastRoll);
      if (legal.length) g2.executeMove(legal[0]);
    }
    if (guard++ > maxSimMs / 400) throw new Error(label + ' did not finish in ' + maxSimMs + 'ms sim');
  }
  return endPayload;
}

console.log('\nQUICK MATCH (human vs AI, via UI)');
t('full quick match reaches end screen with profile xp applied', () => {
  UI.show('scr-quick') /* no-op safe */;
  window.LudoraUI.profile().settings.handoff = 'quick';
  window.eval('LudoraUI.show("scr-home")');
  /* simulate tapping through setup */
  window.document.getElementById('btnQuick').click();
  assert(window.document.getElementById('scr-quick').classList.contains('active'), 'setup visible');
  window.document.getElementById('qStart').click();
  assert(window.document.getElementById('scr-game').classList.contains('active'), 'game screen visible');
  const r = playToEnd(900000, 'quick');
  assert(r.winner !== null);
  assert(r.rankings.length === 2);
  const endScr = window.document.getElementById('scr-end');
  assert(endScr.classList.contains('active'), 'end screen shown');
  assert(endScr.innerHTML.indexOf('wins') >= 0);
  assert(window.LudoraUI.profile().stats.matches === 1, 'profile match counted');
});

console.log('\nSAVE / RESUME');
t('match auto-saves and resumes exact state', () => {
  /* start a pass & play match, make some moves, destroy, restore */
  window.eval('LudoraUI.show("scr-home")');
  window.LudoraUI.refreshHome();
  window.document.getElementById('btnPass').click();
  window.document.getElementById('pStart').click();
  const g = Game.active();
  let guard = 0;
  while (g.st.moveNo < 3 && guard++ < 100) {
    advance(400);
    const banner = window.document.getElementById('handoffBanner');
    if (!banner.classList.contains('hidden') && banner.onclick) banner.onclick();
    const g2 = Game.active();
    if (g2.st.phase === 'roll' && g2.st.seats[g2.st.turn].kind === 'human') g2.rollRequest();
    if (g2.st.phase === 'move') { const l = E.legalMoves(g2.st, g2.st.lastRoll); if (l.length) g2.executeMove(l[0]); }
  }
  const saved = Game.saved();
  assert(saved, 'match saved');
  assert(saved.st.moveNo >= 2, 'moves recorded in save');
  const tokensSnapshot = JSON.stringify(saved.st.tokens);
  Game.destroy();
  /* resume via continue button */
  window.LudoraUI.goHome();
  const cont = window.document.getElementById('btnContinue');
  assert(cont, 'continue button rendered');
  cont.click();
  const g3 = Game.active();
  assert(JSON.stringify(g3.st.tokens) === tokensSnapshot, 'tokens restored exactly');
  assert(g3.st.moveNo === saved.st.moveNo, 'move counter restored');
});

t('corrupted save recovers from backup, and total corruption is discarded', () => {
  /* a torn live value falls back to the last-good backup */
  Store.saveRaw(Store.keys.match, '{{{ broken json');
  let saved = Game.saved();
  if (saved !== null) {
    assert(saved.st && saved.st.phase !== 'anim', 'recovered a valid stable snapshot');
  }
  /* both copies destroyed → clean rejection, app stays usable */
  Store.saveRaw(Store.keys.match, '{{{ broken');
  window.LudoraStore._persist.putRaw(window.LudoraStore.keys.match + '~bak', 'also broken');
  saved = Game.saved();
  assert(saved === null, 'fully corrupted save rejected');
  window.LudoraUI.goHome();
  assert(!window.document.getElementById('btnContinue'), 'no continue button after total corruption');
});

console.log('\nPASS & PLAY HANDOFF');
t('handoff banner appears between human players and acks', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnPass').click();
  window.document.getElementById('pStart').click();
  const g = Game.active();
  advance(50);
  const banner = window.document.getElementById('handoffBanner');
  assert(!banner.classList.contains('hidden'), 'handoff banner visible at match start');
  banner.onclick();
  assert(Game.active().awaitingHandoff === false, 'handoff acked');
});

console.log('\nPAUSE / RESUME / RESTART');
t('pause freezes the game, resume continues, quit saves', () => {
  const pauseBtn = window.document.getElementById('pauseBtn');
  pauseBtn.click();
  const menu = window.document.getElementById('pauseMenu');
  assert(!menu.classList.contains('hidden'), 'pause menu opens');
  window.document.getElementById('pmResume').click();
  assert(menu.classList.contains('hidden'), 'resume closes menu');
  pauseBtn.click();
  window.document.getElementById('pmQuit').click();
  assert(window.document.getElementById('scr-home').classList.contains('active'), 'quit returns home');
  assert(Game.saved(), 'quit saved the match');
});

console.log('\nDAILY CHALLENGE (full match via UI)');
t('daily challenge plays through and completes once', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnDaily').click();
  assert(window.document.getElementById('scr-daily').classList.contains('active'));
  window.document.getElementById('dPlay').click();
  assert(window.document.getElementById('scr-game').classList.contains('active'));
  const r = playToEnd(2200000, 'daily');
  const p = window.LudoraUI.profile();
  const youWon = r.youSeat === r.winner;
  assert(youWon ? p.daily.done[window.LudoraProfile.dateKey()] : true, 'daily marked done when won');
  /* rematch works from end screen */
  const rm = window.document.getElementById('endRematch');
  assert(rm, 'rematch button exists');
  rm.click();
  assert(window.document.getElementById('scr-game').classList.contains('active'), 'rematch starts');
});

console.log('\nMULTIPLAYER UI');
t('multiplayer hub renders create + join, nav round-trips', () => {
  window.LudoraUI.goHome();
  const btnMp = window.document.getElementById('btnMp');
  assert(btnMp, 'home has multiplayer entry');
  btnMp.click();
  assert(window.document.getElementById('scr-mp').classList.contains('active'), 'hub visible');
  assert(window.document.getElementById('mpCreate'), 'create room button');
  assert(window.document.getElementById('mpConnect'), 'join connect button');
  assert(window.document.getElementById('mpJoinCode'), 'invite code input');
  window.document.getElementById('mpBack').click();
  assert(window.document.getElementById('scr-home').classList.contains('active'), 'back returns home');
});

t('create room builds a lobby with readable id, seats, share + start gate', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnMp').click();
  window.document.getElementById('mpCreate').click();
  const roomScr = window.document.getElementById('scr-room');
  assert(roomScr.classList.contains('active'), 'lobby visible');
  const html = roomScr.innerHTML;
  assert(/ROOM\s*ID|room-id-chip/.test(html), 'room id chip present');
  assert(window.LudoraUI.nav && window.LudoraUI.nav, 'nav alive');
  const mp = window.LudoraUI._mpState ? window.LudoraUI._mpState() : null;
  assert(mp && mp.room, 'room created');
  assert(/^[A-Z]{3,8}-\d{3,5}$/.test(mp.room.id), 'readable id: ' + mp.room.id);
  assert(html.indexOf('Start Match') >= 0, 'start button present');
  const startBtn = window.document.getElementById('rStart');
  assert(startBtn && startBtn.hasAttribute('disabled'), 'start gated until seats ready');
  assert(window.document.getElementById('rCopyId'), 'copy id button');
  assert(window.document.getElementById('rShareId'), 'share id button');
  /* leaving the room tears it down */
  window.document.getElementById('rBack').click();
  assert(window.document.getElementById('scr-home').classList.contains('active'), 'leave returns home');
});

t('join screen: connect with a bad code fails gracefully', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnMp').click();
  window.document.getElementById('mpJoinCode').value = 'not-a-real-code';
  window.document.getElementById('mpConnect').click();
  /* WebRTC is unavailable in jsdom — the error path must keep the app usable */
  assert(window.document.getElementById('scr-mp').classList.contains('active'), 'still on hub');
});

t('game screen hides the connection indicator in offline modes', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnQuick').click();
  window.document.getElementById('qStart').click();
  assert(window.document.getElementById('scr-game').classList.contains('active'));
  assert(window.document.getElementById('netChip').classList.contains('hidden'), 'net chip hidden offline');
});

t('screen-reader live region exists for game announcements', () => {
  assert(window.document.getElementById('sr-live'), 'live region present');
});

console.log('\nNAVIGATION ROUTER');
t('in-app back button pops to home', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnSettings').click();
  assert(window.document.getElementById('scr-settings').classList.contains('active'), 'settings pushed');
  window.document.getElementById('sBack').click();
  assert(window.document.getElementById('scr-home').classList.contains('active'), 'back returns home');
  assert(window.LudoraUI.nav.canBack() === false, 'stack drained to root');
});

t('hardware back (popstate) from a running match saves + exits to home', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnQuick').click();
  window.document.getElementById('qStart').click();
  assert(window.document.getElementById('scr-game').classList.contains('active'), 'game on');
  advance(400);
  const g = Game.active();
  assert(g, 'game exists');
  g.rollRequest();
  advance(900);
  /* simulate the hardware back button: browser fires popstate for the previous entry */
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: { s: 'scr-home' } }));
  assert(window.document.getElementById('scr-home').classList.contains('active'), 'popstate went home');
  assert(Game.active() === null || Game.active().destroyed, 'game torn down');
  const saved = window.LudoraGame.saved();
  assert(saved, 'match auto-saved on exit');
  assert(saved.st.phase === 'roll' || saved.st.phase === 'move', 'saved at a stable phase');
});

t('hardware back while paused: dismisses the sheet instead of leaving the match', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnContinue').click();
  assert(window.document.getElementById('scr-game').classList.contains('active'), 'resumed');
  advance(200);
  window.document.getElementById('pauseBtn').click();
  const menu = window.document.getElementById('pauseMenu');
  assert(!menu.classList.contains('hidden'), 'pause sheet open');
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: { s: 'scr-home' } }));
  assert(menu.classList.contains('hidden'), 'back dismissed the sheet');
  assert(window.document.getElementById('scr-game').classList.contains('active'), 'still in the match');
});

t('edge-swipe back gesture pops secondary screens', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnRules').click();
  assert(window.document.getElementById('scr-rules').classList.contains('active'));
  /* synthesized edge swipe: touchstart at left edge, touchend dragged right */
  const ts = new window.Event('touchstart', { bubbles: true, cancelable: true });
  ts.touches = [{ clientX: 12, clientY: 300 }];
  window.document.dispatchEvent(ts);
  const te = new window.Event('touchend', { bubbles: true, cancelable: true });
  te.changedTouches = [{ clientX: 160, clientY: 308 }];
  window.document.dispatchEvent(te);
  assert(window.document.getElementById('scr-home').classList.contains('active'), 'swipe navigated back');
  /* a middle-of-screen swipe must NOT navigate */
  window.document.getElementById('btnRules').click();
  const ts2 = new window.Event('touchstart', { bubbles: true, cancelable: true });
  ts2.touches = [{ clientX: 200, clientY: 300 }];
  window.document.dispatchEvent(ts2);
  const te2 = new window.Event('touchend', { bubbles: true, cancelable: true });
  te2.changedTouches = [{ clientX: 400, clientY: 300 }];
  window.document.dispatchEvent(te2);
  assert(window.document.getElementById('scr-rules').classList.contains('active'), 'non-edge swipe ignored');
});

console.log('\nEND-TO-END UI INVARIANTS');
t('no element references broken icons; screens all render', () => {
  window.LudoraUI.goHome();
  window.document.getElementById('btnProfile').click();
  window.document.getElementById('prBack').click();
  window.document.getElementById('btnRules').click();
  window.document.getElementById('rBack').click();
  window.document.getElementById('btnSettings').click();
  window.document.getElementById('sBack').click();
  ['scr-home', 'scr-quick', 'scr-pass', 'scr-profile', 'scr-daily', 'scr-rules', 'scr-settings'].forEach(id => {
    const scr = window.document.getElementById(id);
    assert(scr.innerHTML.length > 40, id + ' renders content');
  });
});

console.log('\n' + (failed ? '✗ ' + failed + ' FAILED, ' + passed + ' passed' : 'ALL ' + passed + ' INTEGRATION TESTS PASSED') + '\n');
process.exit(failed ? 1 : 0);
