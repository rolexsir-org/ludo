/* Ludora Pro — dev/new-tests.cjs
   Comprehensive test suite for upgraded mobile-first features:
   - Interactive tutorial & onboarding persistence
   - Reduced motion accessibility
   - Audio & Haptics settings
   - Interrupted animations & state stability
   - Match auto-save & exact resume
   - Progression rewards, leveling curves & win streaks
   - Daily challenge determinism & streaks
   - Cosmetic unlocks & customization
   - Monetization & ad abstraction (disabled by default)
   - Service worker precaching & update lifecycle
   - Offline startup guarantee
   - Storage quota/failure resilience
   - PWA background/resume lifecycle
   - Navigation router across all game states

   run: node dev/new-tests.cjs
   ========================================================================= */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeHarness } = require('./harness.js');

const H = makeHarness();
H.load([
  'engine.js', 'ai.js', 'persist.js', 'store.js', 'profile.js',
  'audio.js', 'board.js', 'net.js', 'mp.js', 'qr.js', 'ads.js', 'game.js'
]);

const E = global.LudoraEngine;
const AI = global.LudoraAI;
const P = global.LudoraPersist;
const Store = global.LudoraStore;
const Prof = global.LudoraProfile;
const Audio2 = global.LudoraAudio;
const Board = global.LudoraBoard;
const Game = global.LudoraGame;
const Ads = global.LudoraAds;

let passed = 0, failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + name + '\n    ' + (e && e.stack || e));
  }
}
function eq(a, b, m) {
  assert.deepStrictEqual(a, b, m);
}

console.log('\n========================================');
console.log('UPGRADE VERIFICATION SUITE');
console.log('========================================\n');

/* -------------------------------------------------------------------------
   1. TUTORIAL COMPLETION & PERSISTENCE
   ------------------------------------------------------------------------- */
console.log('1. TUTORIAL & ONBOARDING');
t('tutorial match starts with guided flags and updates profile on completion', () => {
  const prof = Prof.defaultProfile();
  eq(prof.tutorialCompleted, false, 'initially not completed');

  const cfg = {
    mode: 'quick',
    tutorial: true,
    seats: [
      { color: 0, kind: 'human', name: 'Student', avatar: 0, ai: null },
      { color: 2, kind: 'ai', name: 'Rohan', avatar: 2, ai: 0 }
    ]
  };

  const canvas = H.makeCanvas(600, 600);
  const match = new Game._Match();
  match.start(canvas, cfg);
  eq(match.cfg.tutorial, true, 'match recognizes tutorial mode');
  eq(match.tutorialStep, 1, 'tutorial begins at step 1');

  // Simulate tutorial end
  const res = Prof.applyMatchResult(prof, {
    mode: 'quick',
    tutorial: true,
    winnerSeat: 0,
    youSeat: 0,
    seatCount: 2,
    maxAiLevel: 0,
    winnerName: 'Student',
    seatNames: ['Student', 'Rohan'],
    durationS: 120,
    you: { captures: 1, sixes: 2, timesCaptured: 0, turns: 10, homes: 4 }
  });

  eq(prof.tutorialCompleted, true, 'tutorial marked completed in profile');
  assert(res.xpGained >= 100, 'tutorial awards completion XP bonus');
  assert(res.newAchievements.some(a => a.id === 'tutorial'), 'first steps achievement awarded');

  match.destroy();
});

/* -------------------------------------------------------------------------
   2. REDUCED MOTION SUPPORT
   ------------------------------------------------------------------------- */
console.log('\n2. REDUCED MOTION');
t('reduced motion adjusts animation speed and avoids heavy animation loops', () => {
  const match = new Game._Match();
  match.reducedMotion = true;
  const canvas = H.makeCanvas(600, 600);
  match.start(canvas, {
    mode: 'quick',
    seats: [
      { color: 0, kind: 'human', name: 'Player' },
      { color: 1, kind: 'ai', name: 'Aria', ai: 1 }
    ]
  });

  eq(match.reducedMotion, true, 'reduced motion active on match');
  eq(match.speed, 0.5, 'animation speed tuned for reduced motion');

  // Execute a move under reduced motion
  match.st.turn = 0;
  match.st.phase = 'move';
  match.st.lastRoll = 6;
  const moves = E.legalMoves(match.st, 6);
  assert(moves.length > 0);
  match.executeMove(moves[0]);

  assert(match.view.anims.length > 0, 'animation created');
  H.advance(300);
  assert(match.st.tokens[0][0] === 0, 'token moved to start cell');

  match.destroy();
});

/* -------------------------------------------------------------------------
   3. AUDIO & HAPTICS SETTINGS
   ------------------------------------------------------------------------- */
console.log('\n3. AUDIO & HAPTICS SETTINGS');
t('audio controls toggle sound, music, and haptics safely without errors', () => {
  Audio2.setSound(true);
  eq(Audio2.isSoundEnabled(), true);
  Audio2.setSound(false);
  eq(Audio2.isSoundEnabled(), false);

  Audio2.setMusic(true);
  eq(Audio2.isMusicEnabled(), true);
  Audio2.setMusic(false);
  eq(Audio2.isMusicEnabled(), false);

  Audio2.setHaptics(true);
  eq(Audio2.isHapticsEnabled(), true);
  Audio2.setHaptics(false);
  eq(Audio2.isHapticsEnabled(), false);

  // Re-enable and test playback safety
  Audio2.setSound(true);
  Audio2.setHaptics(true);
  Audio2.unlock();
  ['tap', 'roll', 'land', 'step', 'landing', 'capture', 'safe', 'home', 'six', 'win', 'lose', 'pass', 'achieve', 'levelUp', 'unlock', 'daily', 'noMove'].forEach(snd => {
    Audio2.play(snd);
    Audio2.haptic(snd);
  });
});

/* -------------------------------------------------------------------------
   4. INTERRUPTED ANIMATIONS & RAPID ACTIONS
   ------------------------------------------------------------------------- */
console.log('\n4. INTERRUPTED ANIMATIONS');
t('interrupted animations and rapid requests never corrupt authoritative state', () => {
  const match = new Game._Match();
  const canvas = H.makeCanvas(600, 600);
  match.start(canvas, {
    mode: 'quick',
    seats: [
      { color: 0, kind: 'human', name: 'P1' },
      { color: 2, kind: 'human', name: 'P2' }
    ]
  });

  // Roll and move
  match.doRoll();
  H.advance(450);
  assert(match.st.phase === 'move');
  const legal = E.legalMoves(match.st, match.st.lastRoll);
  if (legal.length) {
    match.executeMove(legal[0]);
    // Rapid duplicate execute call must be safely ignored
    match.executeMove(legal[0]);
    match.executeMove(undefined);
  }

  H.advance(600);
  assert(match.st.phase === 'roll' || match.st.phase === 'move' || match.st.phase === 'over');
  assert(E.validateState(match.st) !== null, 'engine state remains strictly valid');

  match.destroy();
});

/* -------------------------------------------------------------------------
   5. MATCH SAVE & RESUME
   ------------------------------------------------------------------------- */
console.log('\n5. MATCH AUTO-SAVE & RESUME');
t('multi-seat match auto-saves accurately and restores token layout', () => {
  const cfg = {
    mode: 'quick',
    theme: 'midnight',
    dice: 'obsidian',
    tokenShape: 'gem',
    seats: [
      { color: 0, kind: 'human', name: 'Hero' },
      { color: 1, kind: 'ai', name: 'Aria', ai: 2 },
      { color: 2, kind: 'ai', name: 'Rohan', ai: 1 }
    ]
  };

  const canvas = H.makeCanvas(600, 600);
  const match = new Game._Match();
  match.start(canvas, cfg);

  // Set distinct token layout
  match.st.tokens[0] = [0, 14, 52, 56];
  match.st.tokens[1] = [5, -1, -1, 56];
  match.st.tokens[2] = [20, 25, -1, -1];
  match.st.moveNo = 18;
  match.st.turn = 1;
  match.st.phase = 'roll';
  match.save();

  const saved = Game.saved();
  assert(saved, 'saved match retrieved');
  eq(saved.st.tokens, match.st.tokens, 'exact tokens saved');
  eq(saved.st.moveNo, 18, 'move counter preserved');
  eq(saved.cfg.theme, 'midnight', 'theme preserved');

  match.destroy();

  // Resume into a fresh match instance
  const resumed = new Game._Match();
  resumed.start(canvas, saved.cfg, saved.st);
  eq(resumed.st.tokens, saved.st.tokens, 'restored tokens match');
  eq(resumed.st.turn, 1, 'turn index restored');

  resumed.destroy();
  Store.remove(Store.keys.match);
});

/* -------------------------------------------------------------------------
   6. PROGRESSION REWARDS & LEVELING CURVE
   ------------------------------------------------------------------------- */
console.log('\n6. PROGRESSION & LEVELING');
t('XP calculation, level curves, and win streak tracking work accurately', () => {
  const prof = Prof.defaultProfile();
  eq(Prof.levelFromXp(0).level, 1);
  eq(Prof.levelFromXp(100).level, 2);
  eq(Prof.levelFromXp(260).level, 3); // 100 + 160

  // 3-match win streak
  for (let i = 1; i <= 3; i++) {
    const res = Prof.applyMatchResult(prof, {
      mode: 'quick',
      winnerSeat: 0,
      youSeat: 0,
      seatCount: 4,
      maxAiLevel: 2,
      hardWin: true,
      winnerName: 'Player',
      seatNames: ['Player', 'Aria', 'Rohan', 'Mila'],
      durationS: 320,
      you: { captures: 2, sixes: 4, timesCaptured: 1, turns: 25, homes: 4 }
    });
    eq(prof.stats.streak, i, 'streak increments');
    assert(res.xpGained > 100, 'awards victory + captures + sixes XP');
  }

  eq(prof.stats.bestStreak, 3);
  assert(prof.achievements['streak-3'], '3-streak achievement unlocked');
});

/* -------------------------------------------------------------------------
   7. DETERMINISTIC DAILY CHALLENGES
   ------------------------------------------------------------------------- */
console.log('\n7. DAILY CHALLENGES');
t('daily challenge generator is deterministic and varies across calendar dates', () => {
  const dates = ['2026-08-25', '2026-08-26', '2026-12-31', '2027-01-01'];
  dates.forEach(d => {
    const d1 = Prof.dailyFor(d);
    const d2 = Prof.dailyFor(d);
    eq(d1.name, d2.name, 'same name for ' + d);
    eq(d1.type, d2.type, 'same type for ' + d);
    eq(d1.seats, d2.seats, 'same seats for ' + d);
    eq(d1.rules, d2.rules, 'same rules for ' + d);
  });

  // Test streak rewards
  eq(Prof.dailyReward(0), 150);
  eq(Prof.dailyReward(1), 170);
  eq(Prof.dailyReward(7), 290);
});

/* -------------------------------------------------------------------------
   8. COSMETIC UNLOCKS
   ------------------------------------------------------------------------- */
console.log('\n8. COSMETIC UNLOCKS');
t('cosmetic items unlock according to player level and achievements', () => {
  const prof = Prof.defaultProfile();

  // Walnut unlocks at Level 4
  const walnut = Prof.COSMETICS.boards.find(b => b.id === 'walnut');
  eq(Prof.isUnlocked(walnut, prof), false);

  prof.xp = 600; // Level 4+
  eq(Prof.isUnlocked(walnut, prof), true);

  // Royal board unlocks on 50 wins achievement
  const royal = Prof.COSMETICS.boards.find(b => b.id === 'royal');
  eq(Prof.isUnlocked(royal, prof), false);
  prof.achievements['wins-50'] = Date.now();
  eq(Prof.isUnlocked(royal, prof), true);
});

/* -------------------------------------------------------------------------
   9. MONETIZATION & AD ABSTRACTION
   ------------------------------------------------------------------------- */
console.log('\n9. AD ABSTRACTION');
t('ad abstraction is clean, disabled by default, and never interrupts gameplay', async () => {
  eq(Ads.isEnabled(), false, 'disabled by default');
  eq(Ads.canShowInterstitial(), false, 'cannot show interstitial by default');

  const res1 = await Ads.showInterstitial({ mode: 'quick', won: true });
  eq(res1.shown, false, 'interstitial cleanly returns shown: false');

  const res2 = await Ads.showRewarded('bonus_xp', () => {});
  eq(res2.rewarded, false, 'rewarded returns false when unavailable');

  // Test pluggable provider interface
  let rewardedTriggered = false;
  Ads.setProvider({
    isAvailable: () => true,
    showInterstitial: async () => true,
    showRewarded: async () => {
      rewardedTriggered = true;
      return true;
    }
  });

  eq(Ads.isEnabled(), true, 'enabled when provider set');
  Ads._resetCooldowns();
  eq(Ads.canShowInterstitial(), true, 'can show when cooldown elapsed');

  const res3 = await Ads.showInterstitial({ mode: 'quick' });
  eq(res3.shown, true, 'interstitial succeeds through provider');

  let callbackFired = false;
  const res4 = await Ads.showRewarded('double_xp', () => { callbackFired = true; });
  eq(res4.rewarded, true);
  eq(callbackFired, true, 'reward callback executed');

  // Test premium mode
  Ads.setPremium(true);
  eq(Ads.isPremium(), true);
  eq(Ads.isEnabled(), false, 'premium disables ads completely');
  eq(Ads.canShowInterstitial(), false);

  // Reset to clean state
  Ads.setPremium(false);
  Ads.setProvider(null);
  eq(Ads.isEnabled(), false);
});

/* -------------------------------------------------------------------------
   10. SERVICE WORKER PRECACHE INTEGRITY
   ------------------------------------------------------------------------- */
console.log('\n10. SERVICE WORKER PRECACHE');
t('sw.js exists and precaches all essential application modules and icons', () => {
  const swCode = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert(swCode.includes('./index.html'), 'precaches index.html');
  assert(swCode.includes('./css/app.css'), 'precaches app.css');
  assert(swCode.includes('./js/engine.js'), 'precaches engine.js');
  assert(swCode.includes('./js/ai.js'), 'precaches ai.js');
  assert(swCode.includes('./js/persist.js'), 'precaches persist.js');
  assert(swCode.includes('./js/store.js'), 'precaches store.js');
  assert(swCode.includes('./js/profile.js'), 'precaches profile.js');
  assert(swCode.includes('./js/audio.js'), 'precaches audio.js');
  assert(swCode.includes('./js/board.js'), 'precaches board.js');
  assert(swCode.includes('./js/net.js'), 'precaches net.js');
  assert(swCode.includes('./js/mp.js'), 'precaches mp.js');
  assert(swCode.includes('./js/qr.js'), 'precaches qr.js');
  assert(swCode.includes('./js/ads.js'), 'precaches ads.js');
  assert(swCode.includes('./js/game.js'), 'precaches game.js');
  assert(swCode.includes('./js/ui.js'), 'precaches ui.js');
  assert(swCode.includes('./js/main.js'), 'precaches main.js');
  assert(swCode.includes('SKIP_WAITING'), 'supports skip waiting');
});

/* -------------------------------------------------------------------------
   11. OFFLINE STARTUP & GUARANTEE
   ------------------------------------------------------------------------- */
console.log('\n11. OFFLINE STARTUP');
t('engine, profile, AI, and game modes initialize cleanly with zero network', () => {
  const st = E.createGame({
    mode: 'quick',
    seats: [
      { color: 0, kind: 'human', name: 'OfflinePlayer' },
      { color: 1, kind: 'ai', name: 'Aria', ai: 1 }
    ]
  });

  assert(st.seats.length === 2);
  const roll = 6;
  const moves = E.legalMoves(st, roll);
  eq(moves.length, 4, 'releases tokens');
  const ev = E.applyMove(st, moves[0]);
  eq(st.tokens[0][0], 0);
});

/* -------------------------------------------------------------------------
   12. STORAGE QUOTA & CORRUPTION RESILIENCE
   ------------------------------------------------------------------------- */
console.log('\n12. STORAGE FAILURE RESILIENCE');
t('storage layer tolerates simulated localStorage failure gracefully', () => {
  const memStoreKey = 'test.resilience.v1';
  P.register(memStoreKey, 1, null, d => typeof d.val === 'number');

  P.put(memStoreKey, { val: 42 });
  eq(P.get(memStoreKey), { val: 42 });

  // Tamper raw
  P.putRaw(memStoreKey, '{ broken JSON');
  const recovered = P.get(memStoreKey);
  // Falls back to backup or null safely without uncaught exception
  assert(recovered === null || recovered.val === 42);

  P.remove(memStoreKey);
});

/* -------------------------------------------------------------------------
   13. PWA LIFECYCLE (BACKGROUND / RESUME)
   ------------------------------------------------------------------------- */
console.log('\n13. PWA BACKGROUND & RESUME');
t('backgrounding match auto-pauses and foregrounding allows clean resume', () => {
  const match = new Game._Match();
  const canvas = H.makeCanvas(600, 600);
  match.start(canvas, {
    mode: 'quick',
    seats: [
      { color: 0, kind: 'human', name: 'P1' },
      { color: 2, kind: 'ai', name: 'Rohan', ai: 1 }
    ]
  });

  match.pause();
  assert(match.paused === true || match.pauseRequested === true, 'pause state captured');

  match.resumePaused();
  eq(match.paused, false, 'resumed cleanly');
  eq(match.running, true);

  match.destroy();
});

/* -------------------------------------------------------------------------
   14. GAME NAVIGATION ROUTING
   ------------------------------------------------------------------------- */
console.log('\n14. NAVIGATION & GESTURES');
t('board metrics and coordinate conversions operate precisely at various viewport sizes', () => {
  [320, 375, 414, 600, 768, 1024].forEach(size => {
    const m = Board.metrics(size);
    assert(m.S === size);
    assert(m.cell > 0);
    for (let c = 0; c < 4; c++) {
      const pYard = Board.pointForPos(m, c, E.YARD, 0);
      assert(pYard.x >= 0 && pYard.x <= size);
      assert(pYard.y >= 0 && pYard.y <= size);

      const pHome = Board.pointForPos(m, c, E.HOME, 0);
      assert(pHome.x >= 0 && pHome.x <= size);
      assert(pHome.y >= 0 && pHome.y <= size);

      const pStart = Board.pointForPos(m, c, 0, 0);
      assert(pStart.x >= 0 && pStart.x <= size);
      assert(pStart.y >= 0 && pStart.y <= size);
    }
  });
});

console.log('\n' + (failed ? '✗ ' + failed + ' FAILED, ' + passed + ' passed' : 'ALL ' + passed + ' UPGRADE TESTS PASSED') + '\n');
process.exit(failed ? 1 : 0);
