/* =========================================================================
   Ludora — ui.js
   All screens & components: home, setup, game HUD/dice/handoff, end match,
   profile/progression, daily challenge, rules, settings.
   ========================================================================= */
(function (global) {
  'use strict';
  var E = global.LudoraEngine, AI = global.LudoraAI, Store = global.LudoraStore,
      Profile = global.LudoraProfile, Audio2 = global.LudoraAudio, Board = global.LudoraBoard,
      Game = global.LudoraGame, Net = global.LudoraNet, Mp = global.LudoraMp,
      QR = global.LudoraQR, Persist = global.LudoraPersist;

  var el = {};
  var UI = {};
  var profile = null;
  var quickSetup = { diff: 1, opponents: 1, color: 0 };
  var passSetup = {
    count: 2,
    seats: [
      { name: 'Player 1', avatar: 3, color: 0, kind: 'human' },
      { name: 'Player 2', avatar: 0, color: 2, kind: 'human' }
    ]
  };
  var lastGameCfg = null;
  var lastEnd = null;
  var installEvt = null;

  var COLOR_VARS = ['var(--red)', 'var(--green)', 'var(--yellow)', 'var(--blue)'];
  var COLOR_NAMES = ['Red', 'Green', 'Yellow', 'Blue'];
  var GLASS = [
    { bg: 'rgba(225,90,82,.15)', bd: 'rgba(225,90,82,.55)' },
    { bg: 'rgba(52,174,108,.13)', bd: 'rgba(52,174,108,.55)' },
    { bg: 'rgba(239,166,47,.13)', bd: 'rgba(239,166,47,.55)' },
    { bg: 'rgba(74,130,238,.16)', bd: 'rgba(74,130,238,.6)' }
  ];

  /* ---------- tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function icon(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function iconLg(name) { return '<svg class="ic ic-lg" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function tile(cls, name) { return '<span class="tile ' + cls + '">' + icon(name) + '</span>'; }
  function avatarHTML(name, avatarId, extra) {
    var av = Profile.AVATARS[avatarId % Profile.AVATARS.length];
    var initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return '<span class="avatar ' + (extra || '') + '" style="background:linear-gradient(145deg,' + av.c1 + ',' + av.c2 + ')" aria-hidden="true">' + esc(initial) + '</span>';
  }
  function toast(text, kind, iconName) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.innerHTML = '<span class="t-tile">' + (iconName ? icon(iconName) : icon('info')) + '</span><span>' + esc(text) + '</span>';
    $('toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 1500);
    setTimeout(function () { t.remove(); }, 1850);
  }
  var currentScreen = null;
  function show(id, dir) {
    var next = $(id);
    if (currentScreen === next) return;
    if (currentScreen) {
      var prev = currentScreen;
      prev.classList.remove('active');
      prev.classList.add('leaving');
      var outDir = dir === 'back' ? 'back' : (dir === 'present' ? 'present' : 'push');
      prev.setAttribute('data-navout', outDir);
      setTimeout(function () {
        prev.classList.remove('leaving');
        prev.removeAttribute('data-navout');
      }, 400);
    }
    next.setAttribute('data-nav', dir || 'fade');
    next.classList.add('active');
    currentScreen = next;
  }
  /* segmented control with sliding pill: n = button count, i = selected index */
  function segAttrs(n, i) { return ' style="--n:' + n + ';--i:' + i + '"'; }

  /* =====================================================================
     Navigation router
     - Owns a screen stack synced with the browser history, so the
       hardware/gesture back button navigates inside the app.
     - push(): drill forward · replace(): terminal transitions
       (rematch, save & exit…) · back(): pop with proper teardown.
     - Back first dismisses overlays (pause sheet / handoff), never the
       game itself, and edge-swipe back works on all secondary screens.
  ===================================================================== */
  var PUSH_SCREENS = { 'scr-quick': 1, 'scr-pass': 1, 'scr-profile': 1, 'scr-daily': 1, 'scr-rules': 1, 'scr-settings': 1, 'scr-mp': 1, 'scr-room': 1 };
  var navStack = ['scr-home'];
  var navLockUntil = 0;
  function navLocked() { return performance.now() < navLockUntil; }

  function teardownScreen(curId) {
    if (curId === 'scr-game') {
      var g = Game.active();
      if (g) {
        if (g.netHost) { g.netHost.close('host-left'); mpReset(); }
        else if (g.netGuest) { g.netGuest.leave(); mpReset(); }
        else { g.save(); }
        Game.destroy();
      }
    } else if (curId === 'scr-end') {
      var g2 = Game.active();
      if (g2) {
        if (g2.netHost) { g2.netHost.close('host-left'); mpReset(); }
        else if (g2.netGuest) { g2.netGuest.leave(); mpReset(); }
        Game.destroy();
      }
    } else if (curId === 'scr-mp' || curId === 'scr-room') {
      mpTearDownIfAbandoned();
    }
  }
  function navigateBackTo(target) {
    if (!$(target)) target = 'scr-home';
    if (target === 'scr-game' && !Game.active()) target = 'scr-home';
    var curId = currentScreen ? currentScreen.id : null;
    if (curId === target) return;
    teardownScreen(curId);
    if (target === 'scr-home') renderHome();
    show(target, 'back');
    if (target === 'scr-game') {
      var g = Game.active();
      if (g && g.paused) openPause(g, g.cfg);   // came back from Rules over pause
    }
  }
  var Nav = {
    push: function (id, dir) {
      if (currentScreen && currentScreen.id === id) return false;
      navStack.push(id);
      try { history.pushState({ s: id }, ''); } catch (e) {}
      show(id, dir || 'push');
      return true;
    },
    replace: function (id, dir) {
      /* terminal transition (rematch, save & exit, wipe): collapse the stack
         so back from here can only lead home — never into a dead screen */
      navStack = id === 'scr-home' ? ['scr-home'] : ['scr-home', id];
      try { history.replaceState({ s: id }, ''); } catch (e) {}
      show(id, dir || 'fade');
      return true;
    },
    back: function () {
      if (navStack.length <= 1) return;
      var target = navStack[navStack.length - 2];
      navStack.pop();
      try { history.back(); } catch (e) {}        // popstate no-ops (already there)
      navigateBackTo(target);
    },
    canBack: function () { return navStack.length > 1; }
  };
  function onPopState(e) {
    var curId = currentScreen ? currentScreen.id : null;
    /* overlays absorb the back gesture */
    if (!$('pauseMenu').classList.contains('hidden')) {
      if (UI._closePause) UI._closePause();
      try { history.pushState({ s: curId }, ''); } catch (err) {}
      return;
    }
    if (!$('handoffOverlay').classList.contains('hidden')) {
      try { history.pushState({ s: curId }, ''); } catch (err) {}
      return;
    }
    var target = (e.state && e.state.s) || 'scr-home';
    if (target === curId) return;                 // our own Nav.back already ran
    if (navLocked()) { try { history.pushState({ s: curId }, ''); } catch (err) {} return; }
    while (navStack.length > 1 && navStack[navStack.length - 1] !== target) navStack.pop();
    if (navStack[navStack.length - 1] !== target) navStack.push(target);
    navigateBackTo(target);
  }
  function fmtDur(s) {
    var m = Math.floor(s / 60);
    return m >= 1 ? m + 'm ' + (s % 60) + 's' : s + 's';
  }

  /* ---------- HOME ---------- */
  var MARK_SVG = '<svg class="mark" viewBox="0 0 96 96" aria-hidden="true">' +
    '<defs><linearGradient id="lgM" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#F3F4F6"/><stop offset="1" stop-color="#9BA3B2"/></linearGradient></defs>' +
    '<rect x="6" y="6" width="84" height="84" rx="26" fill="none" stroke="url(#lgM)" stroke-width="5"/>' +
    '<path d="M25 25 42 42M71 25 54 42M25 71l17-17M71 71 54 54" stroke="url(#lgM)" stroke-width="5" stroke-linecap="round" opacity=".45"/>' +
    '<circle cx="48" cy="38" r="9" fill="url(#lgM)"/>' +
    '<path d="M38 46c-5 3.5-7 8.5-7.5 14h35c-.5-5.5-2.5-10.5-7.5-14" fill="url(#lgM)"/>' +
    '<rect x="28" y="63" width="40" height="8" rx="4" fill="url(#lgM)"/>' +
    '<circle cx="48" cy="20" r="3.4" fill="#E9BE55"/></svg>';

  function renderHome() {
    var saved = Game.saved();
    var daily = Profile.dailyFor();
    var dailyDone = !!profile.daily.done[daily.key];
    var lvl = Profile.levelFromXp(profile.xp);
    var scr = $('scr-home');
    scr.innerHTML =
      '<div class="home-hero">' + MARK_SVG +
        '<h1>Ludora</h1><p>Premium Ludo</p>' +
      '</div>' +
      '<div class="home-actions">' +
        (saved
          ? '<button class="btn btn-tint" id="btnContinue" style="--d:0">' +
              '<span class="avatar" style="width:42px;height:42px;font-size:17px;border-radius:13px;background:linear-gradient(145deg,#6FA3F0,#3D5CD6)">' + icon('play') + '</span>' +
              '<span class="grow"><span class="t">Continue match</span><br/><span class="s">' + esc(continueLabel(saved)) + '</span></span>' +
              '<svg class="ic chev"><use href="#i-chev"/></svg></button>'
          : '') +
        '<button class="btn btn-primary" id="btnQuick" style="--d:1"><span class="grow"><span class="t">Quick Match</span><br/><span class="s">Play vs AI · level ' + lvl.level + '</span></span>' + icon('bolt') + '</button>' +
        '<button class="btn btn-tint" id="btnPass" style="--d:2">' + icon('people') +
          '<span class="grow"><span class="t">Pass &amp; Play</span><br/><span class="s">2–4 players on this device</span></span>' +
          '<svg class="ic chev"><use href="#i-chev"/></svg></button>' +
        '<button class="btn btn-tint" id="btnDaily" style="--d:3">' + icon(dailyDone ? 'check' : 'calendar') +
          '<span class="grow"><span class="t">Daily Challenge</span><br/><span class="s">' + (dailyDone ? 'Completed today · ' + profile.daily.streak + '-day streak' : esc(daily.name) + ' · +' + Profile.dailyReward(profile.daily.streak) + ' XP') + '</span></span>' +
          '<svg class="ic chev"><use href="#i-chev"/></svg></button>' +
        '<button class="btn btn-tint" id="btnMp" style="--d:4">' + icon('people') +
          '<span class="grow"><span class="t">Online Multiplayer</span><br/><span class="s">Peer-to-peer · create or join a room</span></span>' +
          '<svg class="ic chev"><use href="#i-chev"/></svg></button>' +
      '</div>' +
      '<div class="home-foot">' +
        '<button class="btn btn-tint" id="btnProfile" style="--d:0">' + icon('user') + 'Profile</button>' +
        '<button class="btn btn-tint" id="btnRules" style="--d:1">' + icon('info') + 'Rules</button>' +
        '<button class="btn btn-tint" id="btnSettings" style="--d:2">' + icon('shield') + 'Settings</button>' +
      '</div>';

    if (saved) $('btnContinue').addEventListener('click', function () { Audio2.play('tap'); resumeSaved(saved); });
    $('btnQuick').addEventListener('click', function () { Audio2.play('tap'); renderQuick(); Nav.push('scr-quick'); });
    $('btnPass').addEventListener('click', function () { Audio2.play('tap'); renderPass(); Nav.push('scr-pass'); });
    $('btnDaily').addEventListener('click', function () { Audio2.play('tap'); renderDaily(); Nav.push('scr-daily'); });
    $('btnMp').addEventListener('click', function () { Audio2.play('tap'); renderMp(); Nav.push('scr-mp'); });
    $('btnProfile').addEventListener('click', function () { Audio2.play('tap'); renderProfile(); Nav.push('scr-profile'); });
    $('btnRules').addEventListener('click', function () { Audio2.play('tap'); renderRules(); Nav.push('scr-rules'); });
    $('btnSettings').addEventListener('click', function () { Audio2.play('tap'); renderSettings(); Nav.push('scr-settings'); });
  }

  function continueLabel(saved) {
    var st = saved.st, names = st.seats.map(function (s) { return s.kind === 'ai' ? s.name + ' (AI)' : s.name; });
    return ({ quick: 'Quick Match', pass: 'Pass & Play', daily: 'Daily Challenge' })[st.mode] +
      ' · ' + names.join(' vs ') + ' · move ' + st.moveNo;
  }

  function resumeSaved(saved) {
    var st = saved.st, cfg = saved.cfg;
    /* restore live UI pointers (avatars live in cfg.seats) */
    startMatch(cfg, st);
  }

  /* ---------- QUICK SETUP ---------- */
  var DIFF_INFO = [
    { t: 'Relaxed opponent, misses tactics.' },
    { t: 'Solid positional play with some slips.' },
    { t: 'Sharp, punishing, plays the odds.' }
  ];
  function renderQuick() {
    var scr = $('scr-quick');
    scr.innerHTML =
      '<div class="nav"><button class="navbtn" id="qBack">' + icon('back') + '</button><span class="title">Quick Match</span></div>' +
      '<div class="setup-body">' +
        '<div class="label">AI difficulty</div>' +
        '<div class="seg" id="qDiff"' + segAttrs(3, quickSetup.diff) + '>' + AI.levels.map(function (l) {
          return '<button data-l="' + l.id + '"' + (quickSetup.diff === l.id ? ' class="on"' : '') + '>' + l.name + '</button>';
        }).join('') + '</div>' +
        '<div class="diff-desc" id="qDesc">' + DIFF_INFO[quickSetup.diff] + '</div>' +
        '<div class="label">Opponents</div>' +
        '<div class="seg" id="qOpp"' + segAttrs(3, quickSetup.opponents - 1) + '><button data-n="1"' + (quickSetup.opponents === 1 ? ' class="on"' : '') + '>1 AI</button>' +
        '<button data-n="2"' + (quickSetup.opponents === 2 ? ' class="on"' : '') + '>2 AI</button>' +
        '<button data-n="3"' + (quickSetup.opponents === 3 ? ' class="on"' : '') + '>3 AI</button></div>' +
        '<div class="ai-lineup" id="qLineup"></div>' +
        '<div class="label">Your color</div>' +
        '<div class="color-row" id="qColor">' + [0, 1, 2, 3].map(function (c) {
          return '<button class="color-dot' + (quickSetup.color === c ? ' on' : '') + '" data-c="' + c + '" style="background:linear-gradient(145deg,' + lightOf(c) + ',' + baseOf(c) + ')" aria-label="' + COLOR_NAMES[c] + '"></button>';
        }).join('') + '</div>' +
      '</div>' +
      '<button class="btn btn-primary" id="qStart">' + icon('play') + 'Start Match</button>';

    $('qBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
    $('qDiff').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      quickSetup.diff = +b.dataset.l; Audio2.play('tap');
      var idx = Array.prototype.indexOf.call($('qDiff').querySelectorAll('button'), b);
      $('qDiff').style.setProperty('--i', idx);
      $('qDiff').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('qDesc').textContent = DIFF_INFO[quickSetup.diff];
      renderLineup();
    });
    $('qOpp').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      quickSetup.opponents = +b.dataset.n; Audio2.play('tap');
      var idx = Array.prototype.indexOf.call($('qOpp').querySelectorAll('button'), b);
      $('qOpp').style.setProperty('--i', idx);
      $('qOpp').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderLineup();
    });
    $('qColor').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      quickSetup.color = +b.dataset.c; Audio2.play('tap');
      $('qColor').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    $('qStart').addEventListener('click', function () { Audio2.play('tap'); startQuick(); });

    function renderLineup() {
      var names = AI.names.slice().sort(function () { return Math.random() - 0.5; });
      var colors = [0, 1, 2, 3].filter(function (c) { return c !== quickSetup.color; }).slice(0, quickSetup.opponents);
      $('qLineup').innerHTML = colors.map(function (c, i) {
        return '<span class="ch">' + avatarHTML(names[i], (c + i * 3) % 8) +
          '<span>' + esc(names[i]) + '</span><span class="lvl">' + AI.levels[quickSetup.diff].name + '</span></span>';
      }).join('');
    }
    renderLineup();
  }
  function baseOf(c) { return Board.PLAYERS[c].base; }
  function lightOf(c) { return Board.PLAYERS[c].light; }

  function aiSeatsFor(colors, level) {
    var names = AI.names.slice().sort(function () { return Math.random() - 0.5; });
    return colors.map(function (c, i) {
      return { color: c, kind: 'ai', name: names[i], ai: level, avatar: (c * 3 + level) % 8 };
    });
  }

  function startQuick() {
    var aiColors = [0, 1, 2, 3].filter(function (c) { return c !== quickSetup.color; }).slice(0, quickSetup.opponents);
    var seats = [{ color: quickSetup.color, kind: 'human', name: profile.name, avatar: profile.avatar, ai: null }]
      .concat(aiSeatsFor(aiColors, quickSetup.diff));
    startMatch({
      mode: 'quick', seats: seats, rules: {},
      theme: profile.cosmetics.board, dice: profile.cosmetics.dice,
      tokenShape: profile.cosmetics.token, youColor: quickSetup.color
    }, null);
  }

  /* ---------- PASS & PLAY SETUP ---------- */
  function renderPass() {
    var scr = $('scr-pass');
    scr.innerHTML =
      '<div class="nav"><button class="navbtn" id="pBack">' + icon('back') + '</button><span class="title">Pass &amp; Play</span></div>' +
      '<div class="setup-body">' +
        '<div class="label">Players</div>' +
        '<div class="seg" id="pCount"' + segAttrs(3, passSetup.count - 2) + '><button data-n="2"' + (passSetup.count === 2 ? ' class="on"' : '') + '>2</button>' +
        '<button data-n="3"' + (passSetup.count === 3 ? ' class="on"' : '') + '>3</button>' +
        '<button data-n="4"' + (passSetup.count === 4 ? ' class="on"' : '') + '>4</button></div>' +
        '<div class="label">Seats</div>' +
        '<div id="pSeats"></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="pStart">' + icon('play') + 'Start Match</button>';
    $('pBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
    $('pCount').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var n = +b.dataset.n;
      Audio2.play('tap');
      while (passSetup.seats.length < n) {
        var i = passSetup.seats.length;
        var usedC = passSetup.seats.map(function (s) { return s.color; });
        var color = [0, 1, 2, 3].filter(function (c) { return usedC.indexOf(c) < 0; })[i - 2] || 0;
        passSetup.seats.push({ name: 'Player ' + (i + 1), avatar: (i * 5 + 2) % 8, color: color, kind: 'human' });
      }
      while (passSetup.seats.length > n) passSetup.seats.pop();
      passSetup.count = n;
      var idx = Array.prototype.indexOf.call($('pCount').querySelectorAll('button'), b);
      $('pCount').style.setProperty('--i', idx);
      $('pCount').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', +x.dataset.n === n); });
      renderSeats();
    });
    $('pStart').addEventListener('click', function () {
      Audio2.play('tap');
      var seats = passSetup.seats.map(function (s) {
        return { color: s.color, kind: s.kind, name: (s.name || 'Player').slice(0, 14), avatar: s.avatar, ai: s.kind === 'ai' ? 1 : null };
      });
      startMatch({
        mode: 'pass', seats: seats, rules: {},
        theme: profile.cosmetics.board, dice: profile.cosmetics.dice,
        tokenShape: profile.cosmetics.token, youColor: null
      }, null);
    });
    renderSeats();
  }

  function renderSeats() {
    var host = $('pSeats');
    host.innerHTML = '';
    passSetup.seats.forEach(function (seat, idx) {
      var row = document.createElement('div');
      row.className = 'seat-row';
      var usedColors = passSetup.seats.map(function (s) { return s.color; });
      row.innerHTML =
        '<button class="avbtn" data-i="' + idx + '" aria-label="Change avatar">' + avatarHTML(seat.name, seat.avatar) + '</button>' +
        '<input maxlength="14" value="' + esc(seat.name) + '" data-i="' + idx + '" aria-label="Player name"/>' +
        '<div class="mini-swatches">' + [0, 1, 2, 3].map(function (c) {
          var taken = usedColors.indexOf(c) >= 0 && seat.color !== c;
          return '<button class="mini-swatch' + (seat.color === c ? ' on' : '') + (taken ? ' taken' : '') + '" data-i="' + idx + '" data-c="' + c + '" style="background:' + baseOf(c) + '" aria-label="' + COLOR_NAMES[c] + '"></button>';
        }).join('') + '</div>' +
        '<button class="kind-btn' + (seat.kind === 'ai' ? ' ai-on' : '') + '" data-i="' + idx + '">' + (seat.kind === 'ai' ? 'AI' : 'Human') + '</button>';
      host.appendChild(row);
    });
    host.querySelectorAll('.avbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = passSetup.seats[+b.dataset.i];
        s.avatar = (s.avatar + 1) % Profile.AVATARS.length;
        Audio2.play('tap'); renderSeats();
      });
    });
    host.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('input', function () { passSetup.seats[+inp.dataset.i].name = inp.value; });
    });
    host.querySelectorAll('.mini-swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.i, c = +b.dataset.c;
        var other = passSetup.seats.findIndex(function (s, j) { return s.color === c && j !== i; });
        if (other >= 0) { passSetup.seats[other].color = passSetup.seats[i].color; }
        passSetup.seats[i].color = c;
        Audio2.play('tap'); renderSeats();
      });
    });
    host.querySelectorAll('.kind-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = passSetup.seats[+b.dataset.i];
        s.kind = s.kind === 'ai' ? 'human' : 'ai';
        Audio2.play('tap'); renderSeats();
      });
    });
  }

  /* ---------- START / RESUME MATCH ---------- */
  function startMatch(cfg, savedState, navMode) {
    lastGameCfg = cfg;
    var ok = navMode === 'replace' ? Nav.replace('scr-game', 'present') : Nav.push('scr-game', 'present');
    if (!ok && !(currentScreen && currentScreen.id === 'scr-game')) return;
    applyDiceTheme(cfg.dice);
    var canvas = $('board');
    var g = Game.start(canvas, cfg, savedState);
    wireGame(g, cfg);
    requestAnimationFrame(function () { g.resize(); });
    g.begin();
  }

  function applyDiceTheme(id) {
    var themes = {
      ivory: { f: '#FBF6EA', p: '#26211A' },
      obsidian: { f: '#23252B', p: '#F2F3F7' },
      crimson: { f: '#B3323B', p: '#FBEDE0' },
      jade: { f: '#1F7A54', p: '#EFFFF6' },
      galaxy: { f: '#2A2052', p: '#D9D6FF' }
    };
    var t = themes[id] || themes.ivory;
    document.documentElement.style.setProperty('--dice-face', t.f);
    document.documentElement.style.setProperty('--dice-pip', t.p);
  }

  /* ---------- GAME SCREEN WIRING ---------- */
  var cubeVal = 1, spinN = 0;
  function buildCube() {
    var cube = $('cube');
    if (cube.dataset.built) { setCube(cubeVal, true); return; }
    cube.dataset.built = '1';
    var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    var html = '';
    [1, 2, 3, 4, 5, 6].forEach(function (v) {
      html += '<div class="face f' + v + '">';
      for (var i = 0; i < 9; i++) html += PIPS[v].indexOf(i) >= 0 ? '<span class="pip"></span>' : '<span></span>';
      html += '</div>';
    });
    cube.innerHTML = html;
    setCube(1, true);
  }
  function setCube(v, instant) {
    cubeVal = v;
    var cube = $('cube');
    var orient = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] }[v];
    spinN += 1;
    var sx = 360 * (1 + (spinN % 2)), sy = 360 * (1 + ((spinN + 1) % 2));
    if (instant) {
      cube.style.transition = 'none';
      cube.style.transform = 'rotateX(' + orient[0] + 'deg) rotateY(' + orient[1] + 'deg)';
      void cube.offsetWidth;
      cube.style.transition = '';
    } else {
      cube.style.transform = 'rotateX(' + (orient[0] + sx) + 'deg) rotateY(' + (orient[1] + sy) + 'deg)';
    }
  }

  function wireGame(g, cfg) {
    var seats = cfg.seats;
    /* order HUD by engine seat order (color-sorted) */
    var engineSeats = g.st.seats;
    var hud = $('hud');

    function renderHUD(opts) {
      opts = opts || {};
      var st = g.st;
      hud.innerHTML = engineSeats.map(function (s, i) {
        var meta = seatMeta(cfg, s);
        var homes = st.tokens[i].filter(function (p) { return p === E.HOME; }).length;
        var active = i === st.turn && st.phase !== 'over';
        var think = opts.thinking && active;
        var glass = GLASS[s.color];
        return '<div class="pill' + (active ? ' active' : '') + '" style="color:' + COLOR_VARS[s.color] + ';' +
          (active ? 'background:' + glass.bg + ';box-shadow:inset 0 0 0 1px ' + glass.bd : '') + '">' +
          avatarHTML(s.name, meta.avatar) +
          '<div class="meta"><div class="name">' + esc(s.name) + '</div>' +
          '<div class="sub"><span class="homes">' + [0, 1, 2, 3].map(function (t) { return '<i class="' + (t < homes ? 'on' : '') + '"></i>'; }).join('') + '</span>' +
          '<span class="caps">' + icon('swords') + st.stats[i].captures + '</span>' +
          (think ? '<span class="thinking"></span>' : '') +
          '</div></div>' +
          '<span class="bar" style="background:' + COLOR_VARS[s.color] + '"></span></div>';
      }).join('');
    }
    function seatMeta(cfg, engineSeat) {
      var m = cfg.seats.filter(function (x) { return x.color === engineSeat.color; })[0];
      return m || { avatar: engineSeat.color % 8 };
    }
    function turnChip(mode, sub, seatIdx, dim) {
      var st = g.st;
      var s = engineSeats[seatIdx != null ? seatIdx : st.turn];
      var meta = seatMeta(cfg, s);
      $('turnChip').className = dim ? 'think' : '';
      $('turnChip').innerHTML = avatarHTML(s.name, meta.avatar) +
        '<div class="grow"><div class="t" style="color:' + (dim ? '' : COLOR_VARS[s.color]) + '">' + esc(mode) + '</div>' +
        (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
    }

    g.onHud = function (opts) {
      renderHUD(opts || {});
      if (cfg.mode === 'online' && mp.room) updateNetChipHost();
    };
    g.onTurn = function (ev) {
      renderHUD();
      var s = ev.seatInfo;
      turnChip(s.name, s.kind === 'ai' ? AI.levels[s.ai].name + ' AI' : 'Your move', ev.seat, s.kind === 'ai');
    };
    g.onDice = function (ev) {
      var btn = $('diceBtn'), hint = $('rollHint'), glow = $('diceGlow');
      btn.className = '';
      hint.className = '';
      glow.className = '';
      if (ev.state === 'ready') {
        btn.classList.add('ready');
        hint.classList.add('show');
        glow.classList.add('show');
        glow.style.background = 'radial-gradient(circle at 50% 44%, ' + glowColor(engineSeats[g.st.turn].color) + ' 0%, transparent 62%)';
        turnChip('Your turn', 'Tap the dice to roll', null, false);
      } else if (ev.state === 'ai-wait') {
        btn.classList.add('dim');
        turnChip(engineSeats[g.st.turn].name, 'thinking', null, true);
      } else if (ev.state === 'remote-wait') {
        btn.classList.add('dim');
        var rs = engineSeats[g.st.turn];
        turnChip(rs.name, rs.kind === 'ai' ? 'thinking' : 'playing on their device', null, true);
      } else if (ev.state === 'rolling') {
        btn.classList.add('busy');
        setCube(ev.value, false);
      } else if (ev.state === 'done') {
        setCube(ev.value, true);
      } else {
        btn.classList.add('dim');
      }
    };
    g.onToast = function (ev) { toast(ev.text, ev.kind, ev.kind === 'capture' ? 'swords' : 'info'); };
    g.onAnnounce = function (ev) {
      var live = $('sr-live');
      if (live && ev && ev.text) { live.textContent = ''; void live.offsetWidth; live.textContent = ev.text; }
    };
    if (cfg.mode === 'online') { $('netChip').classList.remove('hidden'); updateNetChip(); }
    else { $('netChip').classList.add('hidden'); }
    g.onHandoff = function (ev) {
      var s = ev.seatInfo, meta = seatMeta(cfg, s);
      var mode = profile.settings.handoff;
      if (mode === 'full') {
        var ov = $('handoffOverlay');
        ov.classList.remove('hidden');
        ov.innerHTML = '<div class="ho-card">' + avatarHTML(s.name, meta.avatar) +
          '<h2 style="color:' + COLOR_VARS[s.color] + '">' + esc(s.name) + '</h2>' +
          '<p>You\'re up — ' + COLOR_NAMES[s.color].toLowerCase() + ' pieces</p>' +
          '<div class="tapline">Tap to play</div></div>';
        ov.onclick = function () { ov.classList.add('hidden'); ov.onclick = null; Audio2.play('pass'); Audio2.haptic('pass'); g.ackHandoff(); };
      } else {
        var banner = $('handoffBanner');
        banner.classList.remove('hidden');
        banner.innerHTML = avatarHTML(s.name, meta.avatar) +
          '<span><span class="sub">Pass to</span><br/><span style="color:' + COLOR_VARS[s.color] + '">' + esc(s.name) + '</span></span>' +
          '<span class="sub" style="margin-left:6px">tap when ready</span>';
        banner.onclick = function () {
          banner.classList.add('hidden'); banner.onclick = null;
          Audio2.play('pass'); Audio2.haptic('pass');
          g.ackHandoff();
        };
      }
    };
    g.onEnd = function (results) { showEnd(g, cfg, results); };

    $('diceBtn').onclick = function () { Audio2.unlock(); Audio2.play('tap'); g.rollRequest(); };
    $('pauseBtn').onclick = function () { openPause(g, cfg); };

    renderHUD();
    buildCube();
  }
  function glowColor(c) {
    var map = ['rgba(225,90,82,.32)', 'rgba(52,174,108,.3)', 'rgba(239,166,47,.3)', 'rgba(74,130,238,.34)'];
    return map[c];
  }

  function openPause(g, cfg) {
    Audio2.play('tap');
    g.pause();
    var menu = $('pauseMenu');
    var confirmed = false;
    menu.classList.remove('hidden');
    function tile(cls, ic) { return '<span class="tile ' + cls + '">' + icon(ic) + '</span>'; }
    function row(id, tileCls, ic, t, s, val) {
      return '<button class="as-row" id="' + id + '">' + tile(tileCls, ic) +
        '<span class="grow"><span class="t">' + t + '</span>' + (s ? '<span class="s">' + s + '</span>' : '') + '</span>' +
        (val != null ? '<span class="val">' + val + '</span>' : '') + '</button>';
    }
    var online = cfg.mode === 'online';
    menu.innerHTML =
      '<div class="action-sheet">' +
        '<button class="btn btn-primary as-primary" id="pmResume">' + icon('play') + 'Resume match</button>' +
        '<div class="as-caption">Match paused</div>' +
        '<div class="as-group">' +
          (online ? '' : row('pmRestart', 't-orange', 'refresh', 'Restart match')) +
          row('pmSound', 't-pink', profile.settings.sound ? 'sound' : 'mute', 'Sound', null, profile.settings.sound ? 'On' : 'Off') +
          row('pmRules', 't-indigo', 'info', 'How to play') +
        '</div>' +
        '<div class="as-group">' +
          '<button class="as-row center" id="pmQuit">' + (online ? 'Leave match' : 'Save &amp; exit') + '</button>' +
        '</div>' +
      '</div>';
    $('pmResume').onclick = function () { closePause(); };
    var restartBtn = $('pmRestart');
    if (restartBtn) restartBtn.onclick = function () {
      if (!confirmed) {
        confirmed = true;
        restartBtn.querySelector('.t').textContent = 'Tap again to confirm';
        return;
      }
      closePause(true);
      Game.destroy();
      startMatch(JSON.parse(JSON.stringify(cfg)), null, 'replace');
    };
    $('pmSound').onclick = function () {
      profile.settings.sound = !profile.settings.sound;
      Profile.saveProfile(profile);
      Audio2.setEnabled(profile.settings.sound);
      var btn = $('pmSound');
      btn.querySelector('.val').textContent = profile.settings.sound ? 'On' : 'Off';
      btn.querySelector('.tile').className = 'tile ' + (profile.settings.sound ? 't-pink' : 't-gray');
      btn.querySelector('.tile').innerHTML = icon(profile.settings.sound ? 'sound' : 'mute');
    };
    $('pmRules').onclick = function () {
      menu.classList.add('hidden');
      renderRules('game');
      Nav.push('scr-rules');
    };
    $('pmQuit').onclick = function () {
      menu.classList.add('hidden');
      var g2 = Game.active();
      if (g2 && g2.netHost) { g2.netHost.close('host-left'); mpReset(); }
      else if (g2 && g2.netGuest) { g2.netGuest.leave(); mpReset(); }
      Game.destroy();
      renderHome();
      Nav.replace('scr-home', 'fade');
    };
    function closePause(silent) {
      menu.classList.add('hidden');
      if (!silent) g.resumePaused();
    }
    UI._closePause = closePause;
  }

  /* ---------- END SCREEN ---------- */
  function showEnd(g, cfg, r) {
    lastEnd = { cfg: cfg, r: r };
    var st = g.st;
    var youStats = r.youSeat != null ? r.stats[r.youSeat] : null;
    var won = r.youSeat != null && r.winner === r.youSeat;
    var winner = st.seats[r.winner];

    /* profile progression */
    var xpResult = null;
    var counts = r.youSeat != null && cfg.mode !== 'pass';
    var matchPayload = {
      mode: cfg.mode,
      winnerSeat: r.winner,
      youSeat: r.youSeat,
      seatCount: st.seats.length,
      maxAiLevel: r.maxAiLevel,
      hardWin: won && st.seats.some(function (s) { return s.kind === 'ai' && s.ai === 2; }),
      winnerName: winner.name,
      seatNames: st.seats.map(function (s) { return s.name; }),
      durationS: r.durationS,
      you: r.youSeat != null ? {
        captures: st.stats[r.youSeat].captures,
        sixes: st.stats[r.youSeat].sixes,
        timesCaptured: st.stats[r.youSeat].timesCaptured,
        turns: st.stats[r.youSeat].turns,
        homes: st.stats[r.youSeat].homes
      } : null
    };
    xpResult = Profile.applyMatchResult(profile, matchPayload);
    var meta = seatMeta2(cfg, winner);
    var lvl = Profile.levelFromXp(profile.xp);
    var scr = $('scr-end');
    scr.innerHTML =
      '<canvas id="confetti"></canvas>' +
      '<div class="end-head">' +
        '<div class="crown">' + iconLg('crown') + '</div>' +
        avatarHTML(winner.name, meta.avatar) +
        '<h2>' + esc(winner.name) + ' wins</h2>' +
        '<div class="sub">' + ({ quick: 'Quick Match', pass: 'Pass & Play', daily: 'Daily Challenge' })[cfg.mode] + ' · ' + fmtDur(r.durationS) + '</div>' +
      '</div>' +
      '<div class="end-body">' +
        '<div class="list" style="margin-bottom:12px">' +
          r.rankings.map(function (seatIdx, i) {
            var s = st.seats[seatIdx], m = seatMeta2(cfg, s);
            var homes = st.tokens[seatIdx].filter(function (p) { return p === E.HOME; }).length;
            return '<div class="rank-row" style="--d:' + i + '">' +
              '<span class="pos' + (i === 0 ? ' p1' : '') + '">' + (i + 1) + '</span>' +
              avatarHTML(s.name, m.avatar) +
              '<span class="t" style="color:' + COLOR_VARS[s.color] + '">' + esc(s.name) + '</span>' +
              '<span class="stat">' + icon('pawn') + ' ' + homes + '/4 · ' + icon('swords') + ' ' + st.stats[seatIdx].captures + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +
        (counts
          ? '<div class="end-stats">' +
            '<div class="end-stat"><div class="v">' + (youStats ? youStats.captures : 0) + '</div><div class="k">Captures</div></div>' +
            '<div class="end-stat"><div class="v">' + (youStats ? youStats.sixes : 0) + '</div><div class="k">Sixes</div></div>' +
            '<div class="end-stat"><div class="v">' + (youStats ? youStats.turns : 0) + '</div><div class="k">Turns</div></div>' +
          '</div>'
          : '') +
        (xpResult && xpResult.xpGained > 0
          ? '<div class="card xp-block" style="margin-top:12px">' +
            xpResult.breakdown.map(function (b) {
              return '<div class="xp-line"><span>' + esc(b.label) + '</span><b>+' + b.amount + '</b></div>';
            }).join('') +
            '<div class="xp-total"><span>XP earned</span><span>+' + xpResult.xpGained + '</span></div>' +
            '<div class="xp-bar"><i id="xpBar"></i></div>' +
            '<div class="prof-sub" style="margin-top:7px;display:flex;justify-content:space-between">' +
              '<span>Level ' + lvl.level + '</span><span>' + lvl.into + ' / ' + lvl.need + ' XP</span></div>' +
            (xpResult.leveledUp ? '<div class="levelup">' + icon('crown') + ' Level up — ' + xpResult.levelAfter + '</div>' : '') +
          '</div>'
          : '') +
        (xpResult && xpResult.newAchievements.length
          ? '<div class="label">Achievements</div><div class="list">' +
            xpResult.newAchievements.map(function (a) {
              return '<div class="ach-line">' + tile('t-gold', 'star') + '<span class="grow"><b>' + esc(a.name) + '</b><br/><span class="s">' + esc(a.desc) + '</span></span></div>';
            }).join('') + '</div>'
          : '') +
        (xpResult && xpResult.newCosmetics.length
          ? '<div class="label">Unlocked</div><div class="list">' +
            xpResult.newCosmetics.map(function (u) {
              var cls = u.cat === 'boards' ? 't-teal' : u.cat === 'dice' ? 't-red' : 't-indigo';
              var icn = u.cat === 'boards' ? 'board' : u.cat === 'dice' ? 'dice' : 'pawn';
              return '<div class="ach-line">' + tile(cls, icn) + '<span class="grow"><b>' + esc(u.item.name) + '</b><br/><span class="s">New ' + u.cat.slice(0, -1) + ' in Profile</span></span></div>';
            }).join('') + '</div>'
          : '') +
      '</div>' +
      '<div class="end-actions">' +
        '<button class="btn btn-tint" id="endHome">' + icon('home') + 'Home</button>' +
        (cfg.mode === 'online'
          ? '<button class="btn btn-primary" id="endLeaveMp">' + icon('close') + 'Leave room</button>'
          : '<button class="btn btn-primary" id="endRematch">' + icon('refresh') + 'Rematch</button>') +
      '</div>';

    Nav.push('scr-end', 'fade');
    setTimeout(function () {
      var bar = $('xpBar');
      if (bar) {
        bar.style.width = Math.round((lvl.into - (xpResult ? xpResult.xpGained : 0) + 0) / lvl.need * 100) + '%';
        void bar.offsetWidth;
        bar.style.width = Math.round(lvl.into / lvl.need * 100) + '%';
      }
    }, 120);
    if (xpResult && xpResult.newAchievements.length) {
      setTimeout(function () { Audio2.play('achieve'); toast('Achievement — ' + xpResult.newAchievements[0].name, 'good', 'star'); }, 600);
    }
    if (!won && r.youSeat != null) setTimeout(function () { Audio2.play('lose'); }, 250);

    $('endHome').onclick = function () {
      Audio2.play('tap');
      Game.destroy();
      renderHome();
      Nav.replace('scr-home', 'fade');
    };
    var rematchBtn = $('endRematch');
    if (rematchBtn) rematchBtn.onclick = function () {
      Audio2.play('tap');
      startMatch(JSON.parse(JSON.stringify(cfg)), null, 'replace');
    };
    var leaveBtn = $('endLeaveMp');
    if (leaveBtn) leaveBtn.onclick = function () {
      Audio2.play('tap');
      var g3 = Game.active();
      if (g3 && g3.netHost) { g3.netHost.close('host-left'); mpReset(); }
      else if (g3 && g3.netGuest) { g3.netGuest.leave(); mpReset(); }
      Game.destroy();
      renderHome();
      Nav.replace('scr-home', 'fade');
    };
    confetti(winner.color);
  }
  function seatMeta2(cfg, engineSeat) {
    var m = cfg.seats.filter(function (x) { return x.color === engineSeat.color; })[0];
    return m || { avatar: engineSeat.color % 8 };
  }

  function confetti(winnerColor) {
    var cv = $('confetti');
    var scr = $('scr-end');
    cv.width = scr.clientWidth * (devicePixelRatio > 1 ? 1.5 : 1);
    cv.height = scr.clientHeight * (devicePixelRatio > 1 ? 1.5 : 1);
    var ctx = cv.getContext('2d');
    var colors = [Board.PLAYERS[0].base, Board.PLAYERS[1].base, Board.PLAYERS[2].base, Board.PLAYERS[3].base, '#F3F4F6', '#E9BE55'];
    var parts = [];
    for (var i = 0; i < 130; i++) {
      parts.push({
        x: Math.random() * cv.width, y: -30 - Math.random() * cv.height * 0.5,
        w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
        c: colors[i % colors.length],
        vy: 2.2 + Math.random() * 3.4, vx: -1.4 + Math.random() * 2.8,
        rot: Math.random() * Math.PI, vr: -0.12 + Math.random() * 0.24
      });
    }
    var t0 = performance.now();
    (function tick(now) {
      var el2 = (now - t0) / 1000;
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (el2 > 3.4) return;
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - el2 / 3.2);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      requestAnimationFrame(tick);
    })(t0);
  }

  /* ---------- PROFILE ---------- */
  function renderProfile() {
    var lvl = Profile.levelFromXp(profile.xp);
    var s = profile.stats;
    var winPct = s.matches ? Math.round(s.wins / (s.wins + s.losses || 1) * 100) : 0;
    var circ = 2 * Math.PI * 31;
    var scr = $('scr-profile');
    scr.innerHTML =
      '<div class="nav"><button class="navbtn" id="prBack">' + icon('back') + '</button><span class="title">Profile</span></div>' +
      '<div class="card prof-head">' +
        '<span class="lvl-ring" style="width:74px;height:74px">' +
          '<svg width="74" height="74"><circle cx="37" cy="37" r="31" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="5"/>' +
          '<circle cx="37" cy="37" r="31" fill="none" stroke="#4A82EE" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + (circ * lvl.into / lvl.need) + ' ' + circ + '"/></svg>' +
          '<span class="n">' + lvl.level + '</span></span>' +
        '<div class="grow">' +
          '<div class="prof-name" id="profName"><span>' + esc(profile.name) + '</span>' + icon('edit') + '</div>' +
          '<div class="prof-sub">' + lvl.into + ' / ' + lvl.need + ' XP to level ' + (lvl.level + 1) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="label">Avatar</div>' +
      '<div class="color-row" id="avRow">' + Profile.AVATARS.map(function (a, i) {
        return '<button class="color-dot' + (profile.avatar === i ? ' on' : '') + '" data-a="' + i + '" style="width:44px;height:44px;border-radius:15px;background:linear-gradient(145deg,' + a.c1 + ',' + a.c2 + ')"></button>';
      }).join('') + '</div>' +
      '<div class="label">Statistics</div>' +
      '<div class="stat-grid">' +
        cell(s.matches, 'Matches') + cell(s.wins, 'Wins') + cell(winPct + '%', 'Win rate') +
        cell(s.captures, 'Captures') + cell(s.sixes, 'Sixes') + cell(s.bestStreak, 'Best streak') +
      '</div>' +
      '<div class="label">Achievements · ' + Object.keys(profile.achievements).length + '/' + Profile.ACHIEVEMENTS.length + '</div>' +
      '<div class="ach-grid">' + Profile.ACHIEVEMENTS.map(function (a) {
        var got = !!profile.achievements[a.id];
        return '<div class="ach-card' + (got ? '' : ' locked') + '"><div class="top">' + tile(got ? 't-gold' : 't-gray', got ? 'star' : 'lock') + '<span class="n">' + esc(a.name) + '</span></div><div class="d">' + esc(a.desc) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="label">Cosmetics</div>' +
      '<div class="seg" id="cosTabs"' + segAttrs(3, 0) + '><button data-t="boards" class="on">Boards</button><button data-t="dice">Dice</button><button data-t="tokens">Tokens</button></div>' +
      '<div id="cosGrid" style="padding-top:12px"></div>' +
      '<div class="label">Match history</div>' +
      '<div class="list">' + (profile.history.length
        ? profile.history.slice(0, 12).map(function (h) {
            var d = new Date(h.t);
            return '<div class="hist-row">' +
              '<span class="res ' + (h.mode === 'pass' ? 'p' : h.won ? 'w' : 'l') + '">' + (h.mode === 'pass' ? 'P&P' : h.won ? 'WIN' : 'LOSS') + '</span>' +
              '<span class="grow"><span class="t">' + esc(h.winner) + ' won</span><br/><span class="s">' + h.seats.map(esc).join(' · ') + '</span></span>' +
              '<span class="when">' + fmtDur(h.durationS) + '<br/>' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
            '</div>';
          }).join('')
        : '<div class="hist-row"><span class="s">No matches yet</span></div>') +
      '</div>';

    function cell(v, k) { return '<div class="stat-cell"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>'; }

    $('prBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
    $('avRow').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      profile.avatar = +b.dataset.a; Profile.saveProfile(profile);
      Audio2.play('tap'); renderProfile();
    });
    $('profName').addEventListener('click', function () {
      var host = $('profName');
      host.innerHTML = '<input id="nameInput" maxlength="16" value="' + esc(profile.name) + '"/>';
      var inp = $('nameInput');
      inp.focus(); inp.select();
      function commit() {
        var v = inp.value.trim().slice(0, 16);
        if (v) profile.name = v;
        Profile.saveProfile(profile);
        renderProfile();
      }
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
    });
    $('cosTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Audio2.play('tap');
      var idx = Array.prototype.indexOf.call($('cosTabs').querySelectorAll('button'), b);
      $('cosTabs').style.setProperty('--i', idx);
      $('cosTabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderCosmetics(b.dataset.t);
    });
    renderCosmetics('boards');
  }

  function renderCosmetics(cat) {
    var grid = $('cosGrid');
    var items = Profile.COSMETICS[cat];
    var selKey = { boards: 'board', dice: 'dice', tokens: 'token' }[cat];
    grid.innerHTML = '<div class="cosm-grid">' + items.map(function (item) {
      var unlocked = Profile.isUnlocked(item, profile);
      var cond = !item.unlock ? '' : item.unlock.level ? 'Level ' + item.unlock.level :
        'Achievement';
      return '<button class="cosm-tile' + (profile.cosmetics[selKey] === item.id ? ' on' : '') + (unlocked ? '' : ' locked') + '" data-id="' + item.id + '" data-cat="' + cat + '">' +
        '<span class="art">' + cosmeticArt(cat, item.id) + '</span>' +
        '<span class="n">' + esc(item.name) + '</span>' +
        (unlocked ? (profile.cosmetics[selKey] === item.id ? '<span class="cond eq">Equipped</span>' : '') : '<span class="cond">' + cond + '</span>' +
          '<span class="lock-tag">' + icon('lock') + '</span>') +
      '</button>';
    }).join('') + '</div>';
    grid.querySelectorAll('.cosm-tile').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id, c = b.dataset.cat;
        var item = Profile.COSMETICS[c].filter(function (x) { return x.id === id; })[0];
        if (!Profile.isUnlocked(item, profile)) { Audio2.play('noMove'); toast('Locked — ' + (item.unlock.level ? 'reach level ' + item.unlock.level : 'finish the achievement'), 'info', 'lock'); return; }
        profile.cosmetics[{ boards: 'board', dice: 'dice', tokens: 'token' }[c]] = id;
        Profile.saveProfile(profile);
        Audio2.play('unlock');
        renderCosmetics(c);
      });
    });
  }

  function cosmeticArt(cat, id) {
    if (cat === 'boards') {
      var t = Board.THEMES[id];
      return '<svg width="52" height="52" viewBox="0 0 52 52"><rect x="1.5" y="1.5" width="49" height="49" rx="12" fill="url(#th-' + id + ')"/>' +
        '<defs><linearGradient id="th-' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + t.frameA + '"/><stop offset="1" stop-color="' + t.frameB + '"/></linearGradient></defs>' +
        '<rect x="9" y="9" width="15.5" height="15.5" rx="5" fill="' + Board.PLAYERS[1].base + '" opacity=".9"/>' +
        '<rect x="27.5" y="9" width="15.5" height="15.5" rx="5" fill="' + Board.PLAYERS[2].base + '" opacity=".9"/>' +
        '<rect x="9" y="27.5" width="15.5" height="15.5" rx="5" fill="' + Board.PLAYERS[0].base + '" opacity=".9"/>' +
        '<rect x="27.5" y="27.5" width="15.5" height="15.5" rx="5" fill="' + Board.PLAYERS[3].base + '" opacity=".9"/>' +
        '<circle cx="26" cy="26" r="5" fill="' + t.cell + '"/></svg>';
    }
    if (cat === 'dice') {
      var d = { ivory: ['#FBF6EA', '#26211A'], obsidian: ['#23252B', '#F2F3F7'], crimson: ['#B3323B', '#FBEDE0'], jade: ['#1F7A54', '#EFFFF6'], galaxy: ['#2A2052', '#D9D6FF'] }[id];
      var pips = [[17, 17], [35, 17], [17, 35], [35, 35], [26, 26]];
      return '<svg width="46" height="46" viewBox="0 0 52 52"><rect x="4" y="4" width="44" height="44" rx="12" fill="' + d[0] + '" stroke="rgba(0,0,0,.25)"/>' +
        pips.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.4" fill="' + d[1] + '"/>'; }).join('') + '</svg>';
    }
    /* tokens */
    var tint = { classic: '#F5897F', orb: '#77CD9C', gem: '#F9CB7B', regal: '#86AEF2' }[id];
    return '<svg width="34" height="46" viewBox="0 0 34 46"><ellipse cx="17" cy="40" rx="13" ry="4.5" fill="rgba(0,0,0,.35)"/>' +
      '<path d="M8 38c-4-2-6-6-6.5-10h31c-.5 4-2.5 8-6.5 10z" fill="' + tint + '"/>' +
      '<path d="M10.5 30c-4.5-2.5-6-7-4.5-11.5C7.5 14 12 12 17 12s9.5 2 11 6.5C29.5 23 28 27.5 23.5 30z" fill="' + tint + '"/>' +
      '<circle cx="17" cy="10" r="7.5" fill="' + tint + '"/>' +
      '<circle cx="14.5" cy="7.5" r="2.4" fill="rgba(255,255,255,.65)"/></svg>';
  }

  /* ---------- DAILY ---------- */
  function renderDaily() {
    var daily = Profile.dailyFor();
    var done = !!profile.daily.done[daily.key];
    var reward = Profile.dailyReward(profile.daily.streak);
    var strip = '';
    for (var i = 6; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000);
      var key = Profile.dateKey(d);
      var isDone = !!profile.daily.done[key];
      var isToday = i === 0;
      strip += '<div class="streak-cell ' + (isDone ? 'done' : '') + (isToday ? ' today' : '') + '">' +
        (isDone ? icon('check') : '<span style="font-size:13px;opacity:.5">' + (d.getDate()) + '</span>') +
        '<span>' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()] + '</span></div>';
    }
    $('scr-daily').innerHTML =
      '<div class="nav"><button class="navbtn" id="dBack">' + icon('back') + '</button><span class="title">Daily Challenge</span></div>' +
      '<div class="card daily-card">' +
        '<div class="type">' + Profile.dateKey() + '</div>' +
        '<h2>' + esc(daily.name) + '</h2>' +
        '<div class="desc">' + esc(daily.desc) + '</div>' +
        '<div class="reward">' + icon('star') + ' +' + reward + ' XP · streak ' + profile.daily.streak + '</div>' +
      '</div>' +
      '<div class="label">Last 7 days</div>' +
      '<div class="streak-strip">' + strip + '</div>' +
      '<div style="flex:1"></div>' +
      (done
        ? '<button class="btn btn-primary" id="dPlay" style="background:rgba(50,181,104,.2);color:#6FCE97;box-shadow:inset 0 0 0 1px rgba(50,181,104,.4)">' + icon('check') + 'Completed — replay</button>'
        : '<button class="btn btn-primary" id="dPlay">' + icon('play') + 'Play challenge</button>');

    $('dBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
    $('dPlay').addEventListener('click', function () {
      Audio2.play('tap');
      var seats = daily.seats.map(function (s) {
        if (s.kind === 'human') return { color: s.color, kind: 'human', name: profile.name, avatar: profile.avatar, ai: null };
        return { color: s.color, kind: 'ai', name: s.name, avatar: (s.color * 5 + 2) % 8, ai: s.ai };
      });
      startMatch({
        mode: 'daily', seats: seats, rules: daily.rules,
        theme: profile.cosmetics.board, dice: profile.cosmetics.dice,
        tokenShape: profile.cosmetics.token, youColor: 0, dailyKey: daily.key
      }, null);
    });
  }

  /* ---------- RULES ---------- */
  function renderRules(from) {
    var rules = [
      ['t-blue', 'flag', 'Goal', 'Bring all four of your tokens home first. The first player to get every token into the center wins.'],
      ['t-teal', 'dice', 'Rolling', 'Tap the dice to roll. Every roll — for humans and AI alike — comes from your device\u2019s cryptographic random generator. Nothing is rigged.'],
      ['t-orange', 'six', 'Sixes', 'A six releases a token from the yard and grants another roll. Three sixes in a row and the turn passes immediately.'],
      ['t-red', 'swords', 'Captures', 'Land on an opponent\u2019s cell to send their token back to the yard — and earn an extra roll. Whole stacks get captured together.'],
      ['t-green', 'shield', 'Safe cells', 'Start cells and star cells protect every token standing on them. No captures happen there, ever.'],
      ['t-indigo', 'pawn', 'Coming home', 'After a full lap, tokens climb their colored lane. The final step needs an exact roll — and landing a token home grants an extra roll.'],
      ['t-pink', 'refresh', 'Extra turns', 'Rolling a six, capturing, or bringing a token home each grant one extra roll. Chain them well.'],
      ['t-gold', 'crown', 'Winning', 'When one player finishes all four tokens, remaining players are ranked by how far their tokens traveled.']
    ];
    $('scr-rules').innerHTML =
      '<div class="nav"><button class="navbtn" id="rBack">' + icon('back') + '</button><span class="title">How to Play</span></div>' +
      '<div class="list" style="padding:4px 12px">' +
      rules.map(function (r) { return '<div class="rule">' + tile(r[0], r[1]) + '<div><div class="t">' + r[2] + '</div><div class="d">' + r[3] + '</div></div></div>'; }).join('') +
      '</div>';
    $('rBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
  }

  /* ---------- SETTINGS ---------- */
  function renderSettings() {
    var s = profile.settings;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    $('scr-settings').innerHTML =
      '<div class="nav"><button class="navbtn" id="sBack">' + icon('back') + '</button><span class="title">Settings</span></div>' +
      '<div class="list">' +
        '<div class="list-row">' + tile('t-pink', 'sound') + '<span class="grow"><span class="t">Sound</span><br/><span class="s">Dice, moves, captures</span></span><button class="toggle' + (s.sound ? ' on' : '') + '" id="setSound" role="switch" aria-checked="' + s.sound + '"></button></div>' +
        '<div class="list-row">' + tile('t-teal', 'buzz') + '<span class="grow"><span class="t">Haptics</span><br/><span class="s">Vibration feedback</span></span><button class="toggle' + (s.haptics ? ' on' : '') + '" id="setHaptics" role="switch" aria-checked="' + s.haptics + '"></button></div>' +
      '</div>' +
      '<div class="label">Animation speed</div>' +
      '<div class="seg" id="setSpeed"' + segAttrs(2, s.animSpeed === 'fast' ? 0 : 1) + '><button data-v="fast"' + (s.animSpeed === 'fast' ? ' class="on"' : '') + '>Fast</button><button data-v="relaxed"' + (s.animSpeed !== 'fast' ? ' class="on"' : '') + '>Relaxed</button></div>' +
      '<div class="label">Pass &amp; Play handoff</div>' +
      '<div class="seg" id="setHandoff"' + segAttrs(2, s.handoff === 'full' ? 1 : 0) + '><button data-v="quick"' + (s.handoff !== 'full' ? ' class="on"' : '') + '>Quick banner</button><button data-v="full"' + (s.handoff === 'full' ? ' class="on"' : '') + '>Full screen</button></div>' +
      '<div class="label">App</div>' +
      '<div class="list" id="installList">' +
        '<button class="list-row" id="setInstall">' + tile('t-blue', 'download') + '<span class="grow"><span class="t">Install app</span><br/><span class="s">Works fully offline</span></span>' + icon('chev') + '</button>' +
        '<button class="list-row" id="setExport">' + tile('t-teal', 'share') + '<span class="grow"><span class="t">Export my data</span><br/><span class="s">Profile, stats, cosmetics — as a file</span></span></button>' +
        '<button class="list-row" id="setImport">' + tile('t-indigo', 'download') + '<span class="grow"><span class="t">Import data</span><br/><span class="s">Restore from an export file</span></span></button>' +
        '<input type="file" id="setImportFile" accept="application/json,.json" class="hidden" aria-label="Backup file"/>' +
      '</div>' +
      '<div class="list" style="margin-top:14px">' +
        '<button class="list-row btn-danger" id="setWipe">' + tile('t-red', 'trash') + '<span class="grow"><span class="t" style="color:var(--danger)">Erase all data</span><br/><span class="s">Profile, stats, saved match</span></span></button>' +
      '</div>' +
      '<div class="label" style="text-align:center;margin-top:26px">Ludora 1.0 · no account, no tracking</div>';

    $('sBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
    $('setSound').addEventListener('click', function () {
      s.sound = !s.sound; Profile.saveProfile(profile); Audio2.setEnabled(s.sound);
      Audio2.play('tap'); renderSettings();
    });
    $('setHaptics').addEventListener('click', function () {
      s.haptics = !s.haptics; Profile.saveProfile(profile); Audio2.setHaptics(s.haptics);
      Audio2.haptic('tap'); renderSettings();
    });
    $('setSpeed').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      s.animSpeed = b.dataset.v; Profile.saveProfile(profile);
      var idx = Array.prototype.indexOf.call($('setSpeed').querySelectorAll('button'), b);
      $('setSpeed').style.setProperty('--i', idx);
      $('setSpeed').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      Audio2.play('tap');
    });
    $('setHandoff').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      s.handoff = b.dataset.v; Profile.saveProfile(profile);
      var idx = Array.prototype.indexOf.call($('setHandoff').querySelectorAll('button'), b);
      $('setHandoff').style.setProperty('--i', idx);
      $('setHandoff').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      Audio2.play('tap');
    });
    $('setInstall').addEventListener('click', function () {
      Audio2.play('tap');
      if (installEvt) { installEvt.prompt(); installEvt = null; renderSettings(); return; }
      if (isIOS) {
        toast('Safari: Share → Add to Home Screen', 'info', 'download');
      } else {
        toast('Use your browser menu → Install app', 'info', 'download');
      }
    });
    $('setExport').addEventListener('click', function () {
      Audio2.play('tap');
      try {
        var json = Persist.exportAll();
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'ludora-backup-' + Profile.dateKey() + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('Backup file created', 'good', 'check');
      } catch (e) {
        toast('Could not create the file here — use a different browser', 'info', 'info');
      }
    });
    $('setImport').addEventListener('click', function () {
      Audio2.play('tap');
      $('setImportFile').click();
    });
    $('setImportFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = Persist.importAll(String(reader.result || ''));
        if (res.ok) {
          UI.reloadProfile();
          toast('Data restored', 'good', 'check');
          renderSettings();
        } else {
          toast(res.error || 'That file is not a valid backup', 'info', 'info');
        }
      };
      reader.onerror = function () { toast('Could not read that file', 'info', 'info'); };
      reader.readAsText(f);
      e.target.value = '';
    });
    $('setWipe').addEventListener('click', function (e) {
      var b = e.currentTarget;
      if (b.dataset.confirm) {
        Store.remove(Store.keys.profile);
        Store.remove(Store.keys.match);
        profile = Profile.defaultProfile();
        Profile.saveProfile(profile);
        Game.destroy();
        toast('All data erased', 'info', 'trash');
        UI.goHome();
      } else {
        b.dataset.confirm = '1';
        b.querySelector('.t').textContent = 'Tap again to erase everything';
      }
    });
  }

  /* ---------- module ---------- */

  /* ======================================================================
     ONLINE MULTIPLAYER (serverless, peer-to-peer)
     Host is authoritative; guests render snapshots. Connection setup is
     human-carried: invite/reply codes move via copy, native share or QR.
     ====================================================================== */
  var mp = { room: null, guest: null, role: null, view: null, invite: {} };

  function mpReset() { mp.room = null; mp.guest = null; mp.role = null; mp.view = null; mp.invite = {}; }
  function mpTearDownIfAbandoned() {
    /* leaving the mp screens without a game running abandons the room */
    var inGame = $('scr-game').classList.contains('active') || $('scr-end').classList.contains('active');
    if (inGame) return;
    if (mp.room) { mp.room.close('host-left'); mpReset(); }
    else if (mp.guest) { try { mp.guest.leave(); } catch (e) {} mpReset(); }
  }

  function mpCopy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied', 'good', 'check'); },
                                                 function () { toast('Copy failed — select the code manually', 'info', 'info'); });
        return;
      }
    } catch (e) {}
    toast('Copy not available — select the code manually', 'info', 'info');
  }
  function mpShare(text) {
    try {
      if (navigator.share) {
        navigator.share({ title: 'Ludora room invite', text: text }).catch(function () {});
        return;
      }
    } catch (e) {}
    mpCopy(text);
  }
  function mpQR(host, code) {
    var box = $(host);
    if (!box) return;
    var url = location.origin + location.pathname + '#j=' + code;
    var qr = url.length <= 850 ? QR.encodeText(url) : null;
    if (!qr) {
      box.innerHTML = '<div class="mp-note" style="text-align:center;padding-top:84px">Invite too long for a QR code — use copy or share.</div>';
      return;
    }
    box.innerHTML = '<canvas width="424" height="424" aria-label="Invite QR code"></canvas>';
    var cv = box.querySelector('canvas');
    var ctx = cv.getContext('2d');
    QR.drawCanvas(qr, ctx, 424, '#0B0C10', '#FFFFFF');
  }

  /* ---------- connection indicator ---------- */
  function updateNetChip(state, rtt) {
    var chip = $('netChip');
    if (!chip || chip.classList.contains('hidden')) return;
    var cls = 'dot on', label = '';
    if (state === 'lost') { cls = 'dot off'; label = 'offline'; }
    else if (state === 'warn') { cls = 'dot warn'; label = 'weak'; }
    if (rtt != null && state !== 'lost') label = rtt + ' ms';
    chip.innerHTML = '<span class="' + cls + '"></span>' + (label ? '<span>' + label + '</span>' : '');
  }
  function netChipFromRtt(rtt) {
    updateNetChip(rtt == null ? 'ok' : (rtt > 400 ? 'warn' : 'ok'), rtt);
  }
  function updateNetChipHost() {
    var room = mp.room;
    if (!room) return;
    var worst = -1, anyDown = false, peers = 0;
    room.seats.forEach(function (s) {
      if (s.kind !== 'remote') return;
      peers++;
      if (!s.connected) anyDown = true;
      else if (typeof s.rtt === 'number' && s.rtt > worst) worst = s.rtt;
    });
    if (anyDown) updateNetChip(peers > 1 ? 'warn' : 'lost', worst >= 0 ? worst + ' ms' : null);
    else updateNetChip(worst > 400 ? 'warn' : 'ok', worst >= 0 ? worst : null);
  }

  /* ---------- MP hub ---------- */
  var mpSize = 2;
  function renderMp() {
    var prefilled = '';
    try {
      var h = location.hash || '';
      if (h.indexOf('#j=') === 0) prefilled = decodeURIComponent(h.slice(3));
    } catch (e) {}
    $('scr-mp').innerHTML =
      '<div class="nav"><button class="navbtn" id="mpBack" aria-label="Back">' + icon('back') + '</button><span class="title">Multiplayer</span></div>' +
      '<div class="card" style="animation:fadeUp .5s var(--ease) both">' +
        '<div class="row">' + tile('t-teal', 'people') +
          '<div class="grow"><div class="t" style="font-size:16px;font-weight:700">Direct peer-to-peer</div>' +
          '<div class="s" style="font-size:12.5px;color:var(--text-2);margin-top:3px;line-height:1.45">No accounts, no game server. You and your friends exchange a short connection code once — after that everything flows directly between devices, even on the same Wi-Fi.</div></div></div>' +
      '</div>' +
      '<div class="label">Host a room</div>' +
      '<div class="card">' +
        '<div class="row" style="margin-bottom:12px"><span class="t" style="font-size:15px;font-weight:650">Room size</span></div>' +
        '<div class="seg" id="mpSize"' + segAttrs(3, mpSize - 2) + '><button data-n="2"' + (mpSize === 2 ? ' class="on"' : '') + '>2 players</button>' +
        '<button data-n="3"' + (mpSize === 3 ? ' class="on"' : '') + '>3</button>' +
        '<button data-n="4"' + (mpSize === 4 ? ' class="on"' : '') + '>4</button></div>' +
        '<button class="btn btn-primary" id="mpCreate" style="margin-top:14px;width:100%">' + icon('play') + 'Create Room</button>' +
      '</div>' +
      '<div class="label">Join a room</div>' +
      '<div class="card">' +
        '<textarea class="mp-input" id="mpJoinCode" placeholder="Paste the invite code you received" aria-label="Invite code"></textarea>' +
        '<input class="mp-text" id="mpJoinName" maxlength="16" placeholder="Your name" aria-label="Your name" style="margin-top:10px" value="' + esc(profile.name) + '"></input>' +
        '<button class="btn btn-primary" id="mpConnect" style="margin-top:12px;width:100%">' + icon('download') + 'Connect</button>' +
        '<div class="mp-note" id="mpJoinNote">You will get a short reply code to send back to the host — that completes the connection.</div>' +
      '</div>';

    $('mpBack').addEventListener('click', function () { Audio2.play('tap'); Nav.back(); });
    $('mpSize').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      mpSize = +b.dataset.n; Audio2.play('tap');
      var idx = Array.prototype.indexOf.call($('mpSize').querySelectorAll('button'), b);
      $('mpSize').style.setProperty('--i', idx);
      $('mpSize').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    $('mpCreate').addEventListener('click', function () { Audio2.play('tap'); hostCreateRoom(); });
    if (prefilled) {
      var inp = $('mpJoinCode');
      inp.value = prefilled;
      toast('Invite loaded — press Connect', 'good', 'people');
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    }
    $('mpConnect').addEventListener('click', function () {
      Audio2.play('tap');
      guestConnect($('mpJoinCode').value, $('mpJoinName').value);
    });
  }

  /* ---------- HOST: create + lobby ---------- */
  function hostCreateRoom() {
    mpReset();
    mp.role = 'host';
    mp.room = new Mp.Room({
      size: mpSize, hostName: profile.name, hostAvatar: profile.avatar,
      onEvent: hostRoomEvent
    });
    renderRoomHost();
    show('scr-room', 'push');
    try { history.pushState({ s: 'scr-room' }, ''); } catch (e) {}
  }

  function hostRoomEvent(name, data) {
    if (name === 'seats') { if (mp.view === 'room') renderRoomHost(); updateNetChipHost(); }
    else if (name === 'disconnect') hostDisconnectSheet(data);
    else if (name === 'reconnect') toast(data.name ? data.name + ' is back' : 'Player reconnected', 'good', 'people');
    else if (name === 'violation') { /* logged host-side; repeated abuse auto-kicks */ }
  }

  function seatCardHtml(s, isHostUi) {
    var stateHtml;
    if (s.kind === 'host') stateHtml = '<span class="state"><span class="dot on"></span>Host</span>';
    else if (s.kind === 'ai') stateHtml = '<span class="state">' + AI.levels[s.ai].name + ' AI</span>';
    else if (s.kind === 'remote' && s.connected) stateHtml = '<span class="state"><span class="dot on"></span>' + (s.ready ? 'Ready' : 'Not ready') + '</span>';
    else if (s.kind === 'remote' && !s.connected && s.name) stateHtml = '<span class="state"><span class="dot off"></span>Disconnected</span>';
    else stateHtml = '<span class="state"><span class="dot"></span>Empty</span>';
    var av = s.kind === 'remote' || s.kind === 'host'
      ? avatarHTML(s.name || '?', s.avatar || 0)
      : '<span class="avatar" style="background:linear-gradient(145deg,#7d828f,#4c505b)">' + icon('pawn') + '</span>';
    return '<div class="seat-card">' + av +
      '<div class="grow"><div class="role">' + COLOR_NAMES[s.color] + ' · seat ' + (s.seat + 1) + '</div>' +
      '<div class="t">' + (s.name ? esc(s.name) : (s.kind === 'ai' ? 'Computer' : 'Waiting for player')) + '</div></div>' +
      stateHtml + '</div>';
  }

  function renderRoomHost() {
    if (mp.role !== 'host' || !mp.room) return;
    mp.view = 'room';
    var room = mp.room;
    var inv = mp.invite;
    var scr = $('scr-room');
    scr.innerHTML =
      '<div class="nav"><button class="navbtn" id="rBack" aria-label="Leave room">' + icon('back') + '</button><span class="title">Room Lobby</span></div>' +
      '<div style="text-align:center;animation:fadeUp .5s var(--ease) both">' +
        '<span class="room-id-chip">' + esc(room.id) + '</span>' +
        '<div class="code-actions" style="max-width:300px;margin:10px auto 0">' +
          '<button class="btn btn-tint" id="rCopyId">' + icon('edit') + 'Copy ID</button>' +
          '<button class="btn btn-tint" id="rShareId">' + icon('share') + 'Share</button>' +
        '</div>' +
        '<div class="mp-note" style="margin-top:8px">The Room ID is for humans. Players actually connect with the seat invite codes below.</div>' +
      '</div>' +
      '<div class="label">Seats</div>' +
      '<div id="rSeats">' + room.seats.map(function (s) { return seatCardHtml(s, true); }).join('') + '</div>' +
      '<div id="rSeatActions" style="display:flex;flex-direction:column;gap:8px;margin-top:12px"></div>' +
      '<div style="flex:1"></div>' +
      '<button class="btn btn-primary" id="rStart"' + (room.allReady() ? '' : ' disabled') + '>' + icon('play') + 'Start Match</button>' +
      '<div class="mp-note" style="text-align:center;margin-top:8px">Every connected player must be ready. Empty seats can be filled by AI.</div>';

    $('rBack').addEventListener('click', function () {
      Audio2.play('tap');
      mp.room.close('host-left'); mpReset();
      renderHome(); Nav.replace('scr-home', 'fade');
    });
    $('rCopyId').addEventListener('click', function () { Audio2.play('tap'); mpCopy(room.id); });
    $('rShareId').addEventListener('click', function () { Audio2.play('tap'); mpShare('Join my Ludora room ' + room.id); });
    $('rStart').addEventListener('click', function () {
      if (!room.allReady()) return;
      Audio2.play('tap');
      hostStartMatch();
    });

    var actions = $('rSeatActions');
    room.seats.forEach(function (s) {
      if (s.seat === 0) return;
      var row = document.createElement('div');
      row.className = 'card';
      if (s.kind === 'remote' && s.connected) {
        row.innerHTML = '<div class="row">' + tile('t-green', 'people') +
          '<span class="grow t" style="font-size:14.5px;font-weight:650">' + esc(s.name || 'Player') + ' connected</span>' +
          (room.state === 'lobby' ? '<button class="kind-btn" id="drop' + s.seat + '">Remove</button>' : '') + '</div>';
      } else if (s.kind === 'remote' && !s.connected && s.name) {
        row.innerHTML = '<div class="row">' + tile('t-gold', 'refresh') +
          '<span class="grow"><span class="t" style="font-size:14.5px;font-weight:650">' + esc(s.name) + ' disconnected</span><br/><span class="s" style="font-size:12px;color:var(--text-3)">Invite again to let them rejoin mid-match</span></span>' +
          (room.state === 'lobby' ? '<button class="kind-btn" id="drop' + s.seat + '">Clear</button>' : '') + '</div>' +
          '<button class="btn btn-tint" id="again' + s.seat + '" style="width:100%;height:44px;font-size:14px;margin-top:10px">' + icon('refresh') + 'Re-invite</button>';
      } else if (s.kind === 'ai') {
        row.innerHTML = '<div class="row">' + tile('t-indigo', 'pawn') +
          '<span class="grow t" style="font-size:14.5px;font-weight:650">AI · ' + AI.levels[s.ai].name + '</span>' +
          '<button class="kind-btn" id="ai' + s.seat + '">Level</button>' +
          '<button class="kind-btn" id="human' + s.seat + '">Open</button></div>';
      } else {
        row.innerHTML = '<div class="row">' + tile('t-blue', 'download') +
          '<span class="grow"><span class="t" style="font-size:14.5px;font-weight:650">Seat ' + (s.seat + 1) + ' — invite a friend</span></span>' +
          '<button class="kind-btn ai-on" id="ai' + s.seat + '">Add AI</button></div>' +
          '<button class="btn btn-tint" id="invite' + s.seat + '" style="width:100%;height:44px;font-size:14px;margin-top:10px">' + icon('people') + 'Create invite</button>' +
          '<div id="inviteBox' + s.seat + '"></div>';
      }
      actions.appendChild(row);
    });

    room.seats.forEach(function (s) {
      var seat = s.seat;
      var invBtn = $('invite' + seat);
      if (invBtn) invBtn.addEventListener('click', function () { Audio2.play('tap'); hostInvite(seat); });
      var againBtn = $('again' + seat);
      if (againBtn) againBtn.addEventListener('click', function () { Audio2.play('tap'); hostInvite(seat, true); });
      var aiBtn = $('ai' + seat);
      if (aiBtn) aiBtn.addEventListener('click', function () {
        Audio2.play('tap');
        if (s.kind === 'ai') room.setAiSeat(seat, (s.ai + 1) % 3);
        else room.setAiSeat(seat, 1);
        renderRoomHost();
      });
      var humanBtn = $('human' + seat);
      if (humanBtn) humanBtn.addEventListener('click', function () {
        Audio2.play('tap'); room.setAiSeat(seat, null); renderRoomHost();
      });
      var dropBtn = $('drop' + seat);
      if (dropBtn) dropBtn.addEventListener('click', function () {
        Audio2.play('tap'); room.kick(seat, 'bye'); renderRoomHost();
      });
    });
  }

  function hostInvite(seat, isReinvite) {
    var box = $('inviteBox' + seat) || (function () {
      var b = document.createElement('div'); b.id = 'inviteBox' + seat;
      var row = $('again' + seat) && $('again' + seat).parentElement;
      (row || document.body).appendChild(b);
      return b;
    })();
    box.innerHTML = '<div class="mp-note" style="padding-top:10px">Creating invite — gathering connection info…</div>';
    var room = mp.room;
    room.inviteSeat(seat).then(function (res) {
      mp.invite[seat] = { code: res.code, token: res.token };
      box.innerHTML =
        '<div class="label" style="margin:12px 0 8px">1 · Send this invite code</div>' +
        '<div class="code-box" id="invCode' + seat + '">' + esc(res.code) + '</div>' +
        '<div class="code-actions">' +
          '<button class="btn btn-tint" id="invCopy' + seat + '">Copy</button>' +
          '<button class="btn btn-tint" id="invShare' + seat + '">Share</button>' +
        '</div>' +
        '<div class="qr-frame" id="invQr' + seat + '"></div>' +
        '<div class="label" style="margin:16px 0 8px">2 · Paste their reply code</div>' +
        '<textarea class="mp-input" id="invAns' + seat + '" style="min-height:64px" placeholder="Reply code starts with LUD" aria-label="Reply code"></textarea>' +
        '<button class="btn btn-primary" id="invLink' + seat + '" style="width:100%;height:46px;margin-top:10px">' + icon('check') + 'Link player</button>';
      $('invCopy' + seat).addEventListener('click', function () { Audio2.play('tap'); mpCopy(res.code); });
      $('invShare' + seat).addEventListener('click', function () { Audio2.play('tap'); mpShare(res.code); });
      $('invLink' + seat).addEventListener('click', function () {
        var ans = $('invAns' + seat).value.trim();
        if (!ans) return;
        var peer = room.seats[seat].peer;
        if (!peer) { toast('Invite expired — create a new one', 'info', 'info'); return; }
        peer.acceptAnswer(ans).then(function () {
          toast('Linking seat ' + (seat + 1) + '…', 'good', 'people');
        }).catch(function (err) {
          toast(err.message || 'Could not link that reply code', 'info', 'info');
        });
      });
      mpQR('invQr' + seat, res.code);
    }).catch(function (err) {
      box.innerHTML = '<div class="mp-note" style="padding-top:10px;color:var(--danger)">' + esc(err.message || 'Could not create the invite (WebRTC unavailable)') + '</div>';
    });
  }

  function hostStartMatch() {
    var room = mp.room;
    var cfg = room.buildCfg({ board: profile.cosmetics.board, dice: profile.cosmetics.dice, token: profile.cosmetics.token });
    cfg.seats[0].name = profile.name;
    cfg.seats[0].avatar = profile.avatar;
    mp.view = 'game';
    startMatch(cfg, null);
    var g = Game.active();
    g.netHost = room;
    room.match = g;
    room.started();
  }

  function hostDisconnectSheet(data) {
    var menu = $('pauseMenu');
    var room = mp.room;
    if (!room || !menu) return;
    menu.classList.remove('hidden');
    menu.innerHTML =
      '<div class="action-sheet">' +
        '<button class="btn btn-primary as-primary" id="dcWait">' + icon('pause') + 'Wait for reconnect</button>' +
        '<div class="as-caption">' + esc(data.name) + ' disconnected · their turns are skipped meanwhile</div>' +
        '<div class="as-group">' +
          '<button class="as-row" id="dcAi">' + tile('t-indigo', 'pawn') + '<span class="grow"><span class="t">Replace with AI</span><span class="s">Medium difficulty — keeps the match moving</span></span></button>' +
          '<button class="as-row danger center" id="dcEnd">End match by progress</button>' +
        '</div>' +
      '</div>';
    $('dcWait').addEventListener('click', function () { menu.classList.add('hidden'); });
    $('dcAi').addEventListener('click', function () {
      menu.classList.add('hidden');
      room.convertToAi(data.seat, 1);
      toast('Seat taken over by AI', 'good', 'pawn');
    });
    $('dcEnd').addEventListener('click', function () {
      menu.classList.add('hidden');
      room.endMatchByHost();
    });
  }

  /* ---------- GUEST: join + lobby ---------- */
  function guestConnect(codeText, name) {
    var note = $('mpJoinNote');
    if (!codeText || codeText.trim().length < 10) { toast('Paste the invite code first', 'info', 'info'); return; }
    mpReset();
    mp.role = 'guest';
    name = Mp.sanitizeName(name || profile.name);
    var peer = new Net.Peer({ label: 'guest' });
    mp.guest = new Mp.Guest({ peer: peer, name: name, avatar: profile.avatar, onEvent: guestEvent });
    note.textContent = 'Building your reply code…';
    peer.acceptOffer(codeText.trim()).then(function (answerCode) {
      mp.view = 'answer';
      renderGuestAnswer(answerCode, name);
      show('scr-room', 'push');
      try { history.pushState({ s: 'scr-room' }, ''); } catch (e) {}
    }).catch(function (err) {
      note.textContent = '';
      toast(err.message || 'That invite code did not work', 'info', 'info');
      mpReset();
    });
  }

  function renderGuestAnswer(answerCode, name) {
    mp.view = 'answer';
    $('scr-room').innerHTML =
      '<div class="nav"><button class="navbtn" id="gBack" aria-label="Cancel">' + icon('back') + '</button><span class="title">Almost there</span></div>' +
      '<div class="card" style="animation:fadeUp .5s var(--ease) both">' +
        '<div class="row">' + tile('t-gold', 'edit') +
          '<div class="grow"><div class="t" style="font-size:16px;font-weight:700">Send this reply to the host</div>' +
          '<div class="s" style="font-size:12.5px;color:var(--text-2);margin-top:3px;line-height:1.45">The host pastes it under their seat invite. The link opens the moment they do.</div></div></div>' +
        '<div class="code-box" style="margin-top:12px">' + esc(answerCode) + '</div>' +
        '<div class="code-actions">' +
          '<button class="btn btn-tint" id="gCopy">Copy</button>' +
          '<button class="btn btn-tint" id="gShare">Share</button>' +
        '</div>' +
        '<div class="qr-frame" id="gQr"></div>' +
        '<div class="row" style="margin-top:14px;justify-content:center;gap:8px"><span class="thinking"></span><span class="s" style="font-size:13px;color:var(--text-2)">Waiting for the host to link you…</span></div>' +
      '</div>';
    $('gBack').addEventListener('click', function () {
      Audio2.play('tap');
      if (mp.guest) mp.guest.leave();
      mpReset();
      Nav.back();
    });
    $('gCopy').addEventListener('click', function () { Audio2.play('tap'); mpCopy(answerCode); });
    $('gShare').addEventListener('click', function () { Audio2.play('tap'); mpShare(answerCode); });
    mpQR('gQr', answerCode);
  }

  function guestEvent(name, data) {
    switch (name) {
      case 'welcome':
        mp.view = 'guest-lobby';
        renderGuestLobby(data);
        netChipFromRtt(null);
        break;
      case 'seats':
        if (mp.view === 'guest-lobby') renderGuestLobby({ seats: data });
        break;
      case 'start':
        startGuestMatch(data);
        break;
      case 'sync':
        {
          var g = Game.active();
          if (g && g.netGuest) g.netApply(data);
        }
        break;
      case 'status':
        toast(data.text, 'info', 'people');
        break;
      case 'rtt':
        netChipFromRtt(data.rtt);
        break;
      case 'connection':
        if (data.up === false) guestLost(data.why);
        break;
      case 'closed':
        guestClosedByHost(data.reason);
        break;
      case 'staleSeq':
        /* duplicate/stale snapshot correctly ignored */
        break;
    }
  }

  function renderGuestLobby(info) {
    mp.view = 'guest-lobby';
    var seats = info.seats || [];
    var me = mp.guest;
    var mySeat = seats.filter(function (s) { return s.seat === me.seat; })[0];
    var ready = mySeat ? !!mySeat.ready : false;
    $('scr-room').innerHTML =
      '<div class="nav"><button class="navbtn" id="glBack" aria-label="Leave room">' + icon('back') + '</button><span class="title">' + esc(mp.guest.room || 'Room') + '</span></div>' +
      '<div style="text-align:center;animation:fadeUp .5s var(--ease) both">' +
        '<span class="room-id-chip">' + esc(mp.guest.room || '· · ·') + '</span>' +
        '<div class="mp-note" style="margin-top:8px">Connected peer-to-peer. Waiting for the host to start.</div>' +
      '</div>' +
      '<div class="label">Players</div>' +
      '<div>' + seats.map(function (s) { return seatCardHtml(s, false); }).join('') + '</div>' +
      '<div style="flex:1"></div>' +
      '<button class="btn ' + (ready ? 'btn-tint' : 'btn-primary') + '" id="glReady" style="width:100%" aria-pressed="' + ready + '">' +
        icon(ready ? 'check' : 'play') + (ready ? 'Ready — waiting for host' : 'I am ready') + '</button>' +
      '<div class="mp-note" style="text-align:center;margin-top:8px">' + esc(me.name) + ' · seat ' + ((me.seat != null ? me.seat : 0) + 1) + '</div>';

    $('glBack').addEventListener('click', function () {
      Audio2.play('tap');
      mp.guest.leave(); mpReset();
      renderHome(); Nav.replace('scr-home', 'fade');
    });
    $('glReady').addEventListener('click', function () {
      Audio2.play('tap');
      mp.guest.setReady(!ready);
    });
  }

  function startGuestMatch(data) {
    mp.view = 'game';
    var cfg = data.cfg;
    cfg.netSeat = data.yourSeat;
    startMatch(cfg, data.st);
    var g = Game.active();
    g.netGuest = mp.guest;
    g.netSeq = data.seq || 1;
    g.legal = [];
    g.emit('hud');
  }

  function guestLost(why) {
    var g = Game.active();
    if (!g || !g.netGuest) { toast('Connection lost', 'info', 'people'); return; }
    updateNetChip('lost');
    var menu = $('pauseMenu');
    menu.classList.remove('hidden');
    menu.innerHTML =
      '<div class="action-sheet">' +
        '<div class="as-caption" style="padding:6px 0 2px">Connection lost' + (why ? ' · ' + esc(String(why).slice(0, 24)) : '') + '</div>' +
        '<div class="as-group"><div class="as-row" style="pointer-events:none">' +
          tile('t-gold', 'refresh') +
          '<span class="grow"><span class="t">You can rejoin</span><span class="s">Ask the host to re-invite your seat, then join again with this device — your name and progress carry over.</span></span></div></div>' +
        '<button class="btn btn-primary as-primary" id="glLeave">Leave match</button>' +
      '</div>';
    $('glLeave').addEventListener('click', function () {
      menu.classList.add('hidden');
      mp.guest.leave(); mpReset();
      Game.destroy();
      renderHome(); Nav.replace('scr-home', 'fade');
    });
  }

  function guestClosedByHost(reason) {
    var menu = $('pauseMenu');
    toast(reason === 'host-left' ? 'Host left — room closed' : 'Room closed', 'info', 'people');
    mpReset();
    Game.destroy();
    renderHome(); Nav.replace('scr-home', 'fade');
  }

  UI.init = function () {
    profile = Profile.loadProfile();
    Audio2.setEnabled(profile.settings.sound);
    Audio2.setHaptics(profile.settings.haptics);
    ['hud', 'boardWrap', 'board', 'diceDock', 'turnChip', 'diceBtn', 'pauseBtn'].forEach(function (id) { el[id] = $(id); });
    renderHome();
    show('scr-home', 'fade');

    /* ---- history wiring: restore where the user was after a reload ---- */
    var RENDERERS = {
      'scr-quick': renderQuick, 'scr-pass': renderPass, 'scr-profile': renderProfile,
      'scr-daily': renderDaily, 'scr-rules': renderRules, 'scr-settings': renderSettings
    };
    var st0 = null;
    try { st0 = history.state; } catch (e) {}
    if (st0 && st0.s && RENDERERS[st0.s]) {
      RENDERERS[st0.s]();
      show(st0.s, 'fade');
      navStack = ['scr-home', st0.s];
    } else {
      try { history.replaceState({ s: 'scr-home' }, ''); } catch (e) {}
    }
    window.addEventListener('popstate', onPopState);

    /* ---- edge-swipe back (secondary screens) ---- */
    var edgeSwipe = null;
    document.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      var curId = currentScreen ? currentScreen.id : '';
      if (!PUSH_SCREENS[curId] || !Nav.canBack()) return;
      if (t.clientX > 30 || t.clientY < 70) return;
      edgeSwipe = { x: t.clientX, y: t.clientY, t: performance.now() };
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!edgeSwipe) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - edgeSwipe.x, dy = t.clientY - edgeSwipe.y, dt = performance.now() - edgeSwipe.t;
      edgeSwipe = null;
      if (dx > 55 && Math.abs(dy) < 46 && dt < 650) { Audio2.play('tap'); Nav.back(); }
    }, { passive: true });

    /* board taps */
    $('board').addEventListener('pointerdown', function (ev) {
      var g = Game.active();
      if (g) g.pointerDown(ev);
    });
    /* keyboard */
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Escape') {
        if (!$('pauseMenu').classList.contains('hidden')) { if (UI._closePause) UI._closePause(); return; }
        if (currentScreen && currentScreen.id === 'scr-game') {
          var gp = Game.active();
          if (gp) openPause(gp, gp.cfg);
          return;
        }
        if (currentScreen && PUSH_SCREENS[currentScreen.id]) Nav.back();
        return;
      }
      if (currentScreen && currentScreen.id !== 'scr-game') return;
      var g = Game.active();
      if (!g) return;
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); Audio2.unlock(); g.rollRequest(); }
      else if (e.key >= '1' && e.key <= '4') g.diceForSelection(+e.key);
    });
    /* audio unlock on first gesture */
    var unlock = function () { Audio2.unlock(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock);
    /* auto-pause when app goes to background mid-match */
    document.addEventListener('visibilitychange', function () {
      var g = Game.active();
      if (!g || $('scr-game').classList.contains('active') === false) return;
      if (document.hidden) {
        if ($('pauseMenu').classList.contains('hidden')) openPause(g, g.cfg);
      }
    });
    window.addEventListener('pagehide', function () {
      var g = Game.active();
      if (g) g.save();
    });
    window.addEventListener('resize', function () {
      var g = Game.active();
      if (g) g.resize();
    });
  };

  UI.refreshHome = function () { renderHome(); };
  UI.profile = function () { return profile; };
  UI.setInstallEvent = function (e) { installEvt = e; };
  UI.toast = toast;
  UI.show = show;
  UI.nav = Nav;
  UI._mpState = function () { return mp; };   // test/inspection hook
  UI.reloadProfile = function () {
    profile = Profile.loadProfile();
    Audio2.setEnabled(profile.settings.sound);
    Audio2.setHaptics(profile.settings.haptics);
    if (currentScreen && (currentScreen.id === 'scr-home' || PUSH_SCREENS[currentScreen.id])) {
      var map = { 'scr-quick': renderQuick, 'scr-pass': renderPass, 'scr-profile': renderProfile,
                  'scr-daily': renderDaily, 'scr-rules': renderRules, 'scr-settings': renderSettings, 'scr-mp': renderMp };
      if (map[currentScreen.id]) map[currentScreen.id]();
    }
  };
  UI.goHome = function () {
    navStack = ['scr-home'];
    try { history.replaceState({ s: 'scr-home' }, ''); } catch (e) {}
    renderHome();
    show('scr-home', 'fade');
  };

  global.LudoraUI = UI;
})(window);
