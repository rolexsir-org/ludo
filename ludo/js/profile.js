/* =========================================================================
   Ludora — profile.js
   Local player profile: XP/levels, real statistics, achievements,
   unlockable cosmetics, daily challenges. Everything persists via store.js.
   ========================================================================= */
(function (global) {
  'use strict';
  var Store = global.LudoraStore;
  var E = global.LudoraEngine;

  /* ---------- levels & xp ---------- */
  function xpForNext(level) { return 100 + 60 * (level - 1); }
  function levelFromXp(xp) {
    var lvl = 1, rem = xp;
    while (rem >= xpForNext(lvl)) { rem -= xpForNext(lvl); lvl++; if (lvl > 999) break; }
    return { level: lvl, into: rem, need: xpForNext(lvl) };
  }

  /* ---------- avatars (id → palette index) ---------- */
  var AVATARS = [
    { id: 0, c1: '#FF6B6B', c2: '#C64444' }, { id: 1, c1: '#4ECDC4', c2: '#2B9D8F' },
    { id: 2, c1: '#FFD93D', c2: '#D9A514' }, { id: 3, c1: '#6A8DFF', c2: '#3D5CD6' },
    { id: 4, c1: '#B28DFF', c2: '#7A5BC7' }, { id: 5, c1: '#FF9F68', c2: '#D6552B' },
    { id: 6, c1: '#7ED957', c2: '#3F9A2E' }, { id: 7, c1: '#F472B6', c2: '#C2417E' }
  ];

  /* ---------- cosmetics ---------- */
  var COSMETICS = {
    boards: [
      { id: 'ivory',   name: 'Classic Ivory', unlock: null },
      { id: 'walnut',  name: 'Walnut',        unlock: { level: 4 } },
      { id: 'midnight',name: 'Midnight',      unlock: { level: 7 } },
      { id: 'sakura',  name: 'Sakura',        unlock: { level: 10 } },
      { id: 'arctic',  name: 'Arctic',        unlock: { level: 13 } },
      { id: 'canyon',  name: 'Canyon',        unlock: { level: 16 } },
      { id: 'emerald', name: 'Emerald',       unlock: { level: 19 } },
      { id: 'aurora',  name: 'Aurora',        unlock: { level: 22 } },
      { id: 'royal',   name: 'Royal',         unlock: { ach: 'wins-50' } }
    ],
    dice: [
      { id: 'ivory',    name: 'Ivory',   unlock: null },
      { id: 'obsidian', name: 'Obsidian', unlock: { level: 5 } },
      { id: 'crimson',  name: 'Crimson',  unlock: { level: 8 } },
      { id: 'jade',     name: 'Jade',     unlock: { level: 11 } },
      { id: 'galaxy',   name: 'Galaxy',   unlock: { ach: 'sixes-100' } }
    ],
    tokens: [
      { id: 'classic', name: 'Classic', unlock: null },
      { id: 'orb',     name: 'Orb',     unlock: { level: 3 } },
      { id: 'gem',     name: 'Gem',     unlock: { level: 6 } },
      { id: 'regal',   name: 'Regal',   unlock: { ach: 'mastermind' } }
    ]
  };

  function isUnlocked(item, profile) {
    if (!item.unlock) return true;
    if (item.unlock.level) return levelFromXp(profile.xp).level >= item.unlock.level;
    if (item.unlock.ach) return !!profile.achievements[item.unlock.ach];
    return false;
  }

  /* ---------- achievements ----------
     cond(ctx): ctx = {profile, match} — match is null for out-of-match checks */
  var ACHIEVEMENTS = [
    { id: 'first-win',  name: 'Opening Gambit', desc: 'Win your first match',            cond: function (c) { return c.profile.stats.wins >= 1; } },
    { id: 'wins-10',    name: 'Contender',      desc: 'Win 10 matches',                  cond: function (c) { return c.profile.stats.wins >= 10; } },
    { id: 'wins-50',    name: 'Champion',       desc: 'Win 50 matches',                  cond: function (c) { return c.profile.stats.wins >= 50; } },
    { id: 'wins-200',   name: 'Legend',         desc: 'Win 200 matches',                 cond: function (c) { return c.profile.stats.wins >= 200; } },
    { id: 'captures-25',name: 'Hunter',         desc: 'Capture 25 tokens',               cond: function (c) { return c.profile.stats.captures >= 25; } },
    { id: 'captures-250',name: 'Predator',      desc: 'Capture 250 tokens',              cond: function (c) { return c.profile.stats.captures >= 250; } },
    { id: 'sixes-100',  name: 'Lucky Six',      desc: 'Roll 100 sixes',                  cond: function (c) { return c.profile.stats.sixes >= 100; } },
    { id: 'streak-3',   name: 'On a Roll',      desc: 'Win 3 matches in a row',          cond: function (c) { return c.profile.stats.bestStreak >= 3; } },
    { id: 'streak-7',   name: 'Unstoppable',    desc: 'Win 7 matches in a row',          cond: function (c) { return c.profile.stats.bestStreak >= 7; } },
    { id: 'flawless',   name: 'Flawless',       desc: 'Win without losing a token',      cond: function (c) { return c.match && c.match.won && c.match.you && c.match.you.timesCaptured === 0; } },
    { id: 'mastermind', name: 'Mastermind',     desc: 'Beat a Hard AI in a duel',        cond: function (c) { return c.match && c.match.won && c.match.hardWin && c.match.seatCount === 2; } },
    { id: 'fullhouse',  name: 'Full House',     desc: 'Win a 4-player match',            cond: function (c) { return c.match && c.match.won && c.match.seatCount === 4; } },
    { id: 'blitz',      name: 'Blitz',          desc: 'Win in under 40 of your turns',   cond: function (c) { return c.match && c.match.won && c.match.you && c.match.you.turns < 40; } },
    { id: 'daily-3',    name: 'Regular',        desc: '3-day daily challenge streak',    cond: function (c) { return c.profile.daily.streak >= 3; } },
    { id: 'daily-7',    name: 'Devoted',        desc: '7-day daily challenge streak',    cond: function (c) { return c.profile.daily.streak >= 7; } },
    { id: 'collector',  name: 'Collector',      desc: 'Own 8 cosmetics',                 cond: function (c) { return c.profile.cosmetics.owned.length >= 8; } }
  ];

  /* ---------- daily challenges ----------
     Deterministic from the date: everyone plays the same challenge each day. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  var DAILY_TYPES = [
    {
      id: 'duel', name: 'The Duel',
      desc: function (c) { return 'Beat ' + c.aiName + ' (Hard) heads-up. No second place.'; },
      build: function (rng, names) {
        return { rules: {}, seats: [
          { color: 0, kind: 'human', name: 'You' },
          { color: 2, kind: 'ai', name: names[0], ai: 2 }
        ]};
      }
    },
    {
      id: 'headstart', name: 'The Comeback',
      desc: function (c) { return 'Two Hard AI start ahead of you. Chase them down and win.'; },
      build: function (rng, names) {
        return { rules: { headStart: { 1: [12, 8, 5, 0], 3: [12, 8, 5, 0] } }, seats: [
          { color: 0, kind: 'human', name: 'You' },
          { color: 1, kind: 'ai', name: names[0], ai: 2 },
          { color: 3, kind: 'ai', name: names[1], ai: 2 }
        ]};
      }
    },
    {
      id: 'hunt', name: 'The Hunt',
      desc: function (c) { return 'First to capture 3 tokens wins — against three rivals.'; },
      build: function (rng, names) {
        return { rules: { firstToCaptures: 3 }, seats: [
          { color: 0, kind: 'human', name: 'You' },
          { color: 1, kind: 'ai', name: names[0], ai: 1 },
          { color: 2, kind: 'ai', name: names[1], ai: 1 },
          { color: 3, kind: 'ai', name: names[2], ai: 2 }
        ]};
      }
    },
    {
      id: 'gauntlet', name: 'The Gauntlet',
      desc: function (c) { return 'A 4-player free-for-all with two Hard opponents.'; },
      build: function (rng, names) {
        return { rules: {}, seats: [
          { color: 0, kind: 'human', name: 'You' },
          { color: 1, kind: 'ai', name: names[0], ai: 2 },
          { color: 2, kind: 'ai', name: names[1], ai: 0 },
          { color: 3, kind: 'ai', name: names[2], ai: 2 }
        ]};
      }
    }
  ];

  function dailyFor(dateStr) {
    var key = dateStr || dateKey();
    var rng = mulberry32(hashStr('ludora-' + key));
    var idx = Math.floor(rng() * DAILY_TYPES.length);
    var type = DAILY_TYPES[idx];
    var names = global.LudoraAI.names.slice();
    // deterministic shuffle of AI names
    for (var i = names.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = names[i]; names[i] = names[j]; names[j] = tmp;
    }
    var cfg = type.build(rng, names);
    return { key: key, type: type.id, name: type.name, desc: type.desc({ aiName: cfg.seats[1].name }), seats: cfg.seats, rules: cfg.rules };
  }

  function dailyReward(streak) { return 150 + 20 * Math.min(streak || 0, 7); }

  /* ---------- profile ---------- */
  function defaultProfile() {
    return {
      v: 2,
      name: 'Player',
      avatar: 3,
      createdAt: Date.now(),
      xp: 0,
      stats: {
        matches: 0, wins: 0, losses: 0, captures: 0, timesCaptured: 0,
        sixes: 0, homes: 0, streak: 0, bestStreak: 0,
        onlineMatches: 0, onlineWins: 0
      },
      daily: { streak: 0, best: 0, done: {}, last: null },
      achievements: {},            // id → date achieved
      cosmetics: { owned: ['ivory-b', 'ivory-d', 'classic-t'], board: 'ivory', dice: 'ivory', token: 'classic' },
      history: [],                 // newest first, capped 30
      settings: { sound: true, haptics: true, animSpeed: 'fast', handoff: 'quick', theme: 'auto' }
    };
  }

  function validateProfile(p) {
    if (!p || (p.v !== 1 && p.v !== 2) || typeof p.name !== 'string') return null;
    if (typeof p.xp !== 'number' || p.xp < 0) return null;
    if (!p.stats || typeof p.stats.matches !== 'number') return null;
    if (!p.daily || !p.achievements || !p.cosmetics || !Array.isArray(p.history)) return null;
    if (!p.settings || typeof p.settings.sound !== 'boolean') return null;
    if (p.settings.theme != null && ['auto', 'light', 'dark'].indexOf(p.settings.theme) < 0) throw new Error('bad theme');
    ['board','dice','token'].forEach(function (k) {
      if (typeof p.cosmetics[k] !== 'string') throw new Error('bad');
    });
    return p;
  }

  function loadProfile() {
    var p = Store.load(Store.keys.profile, validateProfile);
    return p || defaultProfile();
  }

  function saveProfile(p) { p.v = 2; return Store.save(Store.keys.profile, p); }

  /* Apply an ended match to the profile. Returns what changed.
     match: {mode, seats, winnerSeat, youSeat|null, seatCount, hardWin,
             you:{captures,sixes,timesCaptured,turns,homes}|null, durationS} */
  function applyMatchResult(profile, match) {
    var out = { xpGained: 0, breakdown: [], newAchievements: [], newCosmetics: [], levelBefore: levelFromXp(profile.xp).level, daily: false, dailyXp: 0 };
    var d = defaultProfile();
    profile.stats = Object.assign({}, d.stats, profile.stats);
    profile.daily = Object.assign({}, d.daily, profile.daily);
    profile.cosmetics = Object.assign({}, d.cosmetics, profile.cosmetics);

    profile.stats.matches++;
    var won = match.youSeat !== null && match.winnerSeat === match.youSeat;
    var countsForYou = match.youSeat !== null && (match.mode === 'quick' || match.mode === 'daily' || match.mode === 'online');

    if (match.mode === 'online') {
      profile.stats.onlineMatches++;
    }

    if (countsForYou) {
      if (won) {
        profile.stats.wins++;
        if (match.mode === 'online') profile.stats.onlineWins++;
        profile.stats.streak++;
        profile.stats.bestStreak = Math.max(profile.stats.bestStreak, profile.stats.streak);
        profile.stats.captures += match.you.captures;
        profile.stats.timesCaptured += match.you.timesCaptured;
        profile.stats.sixes += match.you.sixes;
        profile.stats.homes += match.you.homes;
        var base = [60, 90, 130][match.maxAiLevel] || 60;
        if (match.seatCount === 4) base = Math.round(base * 1.3);
        addXp(out, base, 'Victory');
      } else {
        profile.stats.losses++;
        profile.stats.streak = 0;
        profile.stats.captures += match.you.captures;
        profile.stats.timesCaptured += match.you.timesCaptured;
        profile.stats.sixes += match.you.sixes;
        profile.stats.homes += match.you.homes;
        addXp(out, 25, 'Match played');
      }
      var capXp = Math.min(24, match.you.captures * 4);
      if (capXp) addXp(out, capXp, match.you.captures + ' captures');
      var sixXp = Math.min(12, match.you.sixes);
      if (sixXp) addXp(out, sixXp, match.you.sixes + ' sixes');
    } else if (match.mode === 'pass') {
      addXp(out, 20, 'Pass & Play match');
    }

    // daily completion
    if (match.mode === 'daily' && won) {
      var key = dateKey();
      if (!profile.daily.done[key]) {
        profile.daily.done[key] = true;
        var yesterday = dateKey(new Date(Date.now() - 86400000));
        profile.daily.streak = profile.daily.last === yesterday ? profile.daily.streak + 1 : 1;
        profile.daily.last = key;
        profile.daily.best = Math.max(profile.daily.best, profile.daily.streak);
        var dr = dailyReward(profile.daily.streak);
        out.daily = true; out.dailyXp = dr;
        addXp(out, dr, 'Daily challenge');
      }
    }

    profile.xp += out.xpGained;
    out.levelAfter = levelFromXp(profile.xp).level;
    out.leveledUp = out.levelAfter > out.levelBefore;

    // achievements
    var ctx = { profile: profile, match: {
      won: won, you: match.you, hardWin: !!match.hardWin, seatCount: match.seatCount
    }};
    ACHIEVEMENTS.forEach(function (a) {
      if (!profile.achievements[a.id]) {
        var ok = false;
        try { ok = a.cond(ctx); } catch (e) { ok = false; }
        if (ok) { profile.achievements[a.id] = Date.now(); out.newAchievements.push(a); }
      }
    });

    // cosmetics ownership
    ['boards', 'dice', 'tokens'].forEach(function (cat) {
      COSMETICS[cat].forEach(function (item) {
        var ownId = item.id + '-' + cat[0];
        if (isUnlocked(item, profile) && profile.cosmetics.owned.indexOf(ownId) < 0) {
          profile.cosmetics.owned.push(ownId);
          out.newCosmetics.push({ cat: cat, item: item });
        }
      });
    });

    // history
    profile.history.unshift({
      t: Date.now(), mode: match.mode, won: won, winner: match.winnerName,
      seats: match.seatNames, seatCount: match.seatCount,
      captures: match.you ? match.you.captures : null, durationS: match.durationS
    });
    if (profile.history.length > 30) profile.history.length = 30;

    saveProfile(profile);
    return out;
  }

  function addXp(out, amount, label) {
    out.xpGained += amount;
    out.breakdown.push({ amount: amount, label: label });
  }

  global.LudoraProfile = {
    xpForNext: xpForNext, levelFromXp: levelFromXp,
    AVATARS: AVATARS, COSMETICS: COSMETICS, ACHIEVEMENTS: ACHIEVEMENTS,
    isUnlocked: isUnlocked,
    dailyFor: dailyFor, dailyReward: dailyReward, dateKey: dateKey,
    defaultProfile: defaultProfile, validateProfile: validateProfile,
    loadProfile: loadProfile, saveProfile: saveProfile,
    applyMatchResult: applyMatchResult
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraProfile;
})(typeof window !== 'undefined' ? window : globalThis);
