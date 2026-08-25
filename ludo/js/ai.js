/* =========================================================================
   Ludora — ai.js
   Strategic, non-cheating AI opponent. Operates solely on legal engine
   states — the AI never predicts or controls dice, picking exclusively
   among the legal moves provided by the engine.

   Personality & Difficulty Profiles:
     0 Easy / Casual    — Playful, higher noise, explores casual moves
     1 Medium / Balanced — Solid positional fundamentals, moderate noise
     2 Hard / Strategist — Deep threat modelling, safe-star holding, optimal endgame
   ========================================================================= */
(function (global) {
  'use strict';
  var E = global.LudoraEngine;

  /* Probability an opponent can land on ring cell `abs` next roll (1..6 behind). */
  function threatAt(st, seatIdx, abs) {
    if (abs === null || E.SAFE[abs]) return 0;
    var p = 0;
    for (var s = 0; s < st.seats.length; s++) {
      if (s === seatIdx) continue;
      for (var t = 0; t < 4; t++) {
        var pos = st.tokens[s][t];
        if (pos < 0 || pos > E.LAST_RING_POS) continue; // yard / lane / home can't hit
        var oppAbs = E.absCell(st.seats[s].color, pos);
        var dist = (abs - oppAbs + 52) % 52;
        if (dist >= 1 && dist <= 6) {
          // opponent must not overshoot its own ring exit with that roll
          if (pos + dist <= E.LAST_RING_POS) p += 1 / 6;
        }
      }
    }
    return Math.min(1, p);
  }

  function tokenValue(pos) {
    return 4 + pos * 0.10;
  }

  function boardCount(st, seatIdx) {
    var n = 0;
    for (var t = 0; t < 4; t++) {
      var p = st.tokens[seatIdx][t];
      if (p >= 0 && p <= E.LAST_RING_POS) n++;
    }
    return n;
  }

  function evaluate(st, seatIdx, move, level) {
    var score = 0;
    var to = move.to, from = move.from != null ? move.from : -1;

    // Captures: the deeper the victim had traveled, the better the capture
    for (var i = 0; i < move.captures.length; i++) {
      var cap = move.captures[i];
      var victimPos = st.tokens[cap.seat][cap.token];
      score += 30 + (victimPos + 1) * 0.55;
    }

    if (move.home) score += 32; // Finish a token into center
    if (to >= E.FIRST_LANE_POS && from < E.FIRST_LANE_POS && from >= 0) score += 13; // Safe in home lane

    if (move.release) {
      score += boardCount(st, seatIdx) === 0 ? 24 : (level === 2 ? 11 : 7);
    }

    // Progress: prefer advancing tokens that are already ahead
    score += (to - (from < 0 ? -1 : from)) * 0.32;
    score += to * 0.10;
    if (to >= E.FIRST_LANE_POS) score += (to - E.FIRST_LANE_POS + 1) * 0.35;

    // Destination Safety
    if (to <= E.LAST_RING_POS) {
      var abs = E.absCell(st.seats[seatIdx].color, to);
      if (E.SAFE[abs]) score += 5;
      var danger = threatAt(st, seatIdx, abs);
      score -= danger * (tokenValue(to) + 5);
    }

    // Escaping an existing threat
    if (from >= 0 && from <= E.LAST_RING_POS) {
      var fromAbs = E.absCell(st.seats[seatIdx].color, from);
      score += threatAt(st, seatIdx, fromAbs) * (tokenValue(from) + 4) * 0.85;
    }

    // Endgame prioritization
    var done = 0;
    for (var t2 = 0; t2 < 4; t2++) {
      if (st.tokens[seatIdx][t2] > E.LAST_RING_POS) done++;
    }
    if (level === 2 && done >= 2 && move.home) score += 8;

    return score;
  }

  var NOISE_OVERRIDE = null;
  function noise(level) {
    if (NOISE_OVERRIDE !== null) return NOISE_OVERRIDE;
    if (level === 0) return (Math.random() + Math.random() + Math.random()) * 14 - 21;
    if (level === 1) return (Math.random() * 2 - 1) * 6.5;
    return (Math.random() * 2 - 1) * 0.4;
  }

  function thinkDelay(level) {
    if (level === 0) return 300 + Math.random() * 300;
    if (level === 1) return 380 + Math.random() * 340;
    return 440 + Math.random() * 380;
  }

  function chooseMove(st, seatIdx, roll, level) {
    var moves = E.legalMoves(st, roll);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var sc = evaluate(st, seatIdx, moves[i], level) + noise(level);
      if (sc > bestScore) {
        bestScore = sc;
        best = moves[i];
      }
    }
    return best;
  }

  global.LudoraAI = {
    chooseMove: chooseMove,
    evaluate: evaluate,
    threatAt: threatAt,
    thinkDelay: thinkDelay,
    setNoise: function (v) { NOISE_OVERRIDE = v; },
    levels: [
      { id: 0, name: 'Easy', title: 'Casual', desc: 'Relaxed opponent, misses tactics.' },
      { id: 1, name: 'Medium', title: 'Balanced', desc: 'Solid positional play with occasional slips.' },
      { id: 2, name: 'Hard', title: 'Strategist', desc: 'Sharp, tactical, threat-aware.' }
    ],
    names: ['Aria', 'Rohan', 'Mila', 'Kabir', 'Zara', 'Dev', 'Nina', 'Arjun', 'Tara', 'Vikram']
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraAI;
})(typeof window !== 'undefined' ? window : globalThis);
