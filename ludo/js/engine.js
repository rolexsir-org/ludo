/* =========================================================================
   Ludora — engine.js
   Pure Ludo rules engine. No DOM, no timers, no randomness policy:
   dice values are supplied by the caller so the UI can use crypto-grade
   randomness and tests can be deterministic.

   Coordinate model
   ----------------
   15×15 grid. A 52-cell ring, each player enters at its start cell,
   walks 51 ring cells (pos 0..50), then its 5-cell home lane
   (pos 51..55), then HOME (pos 56). YARD is pos -1.

   Ring index 0 = red start (bottom-left, cell 6,13). Each next player
   starts 13 cells later. Safe cells = the four starts + the four cells
   eight steps after each start.
   ========================================================================= */
(function (global) {
  'use strict';

  var COLORS = ['red', 'green', 'yellow', 'blue'];
  /* [col,row] pairs, clockwise. Verified: 52 unique cells. */
  var RING = [
    [6,13],[6,12],[6,11],[6,10],[6,9],            // 0-4   red arm, left column (0 = red start)
    [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],          // 5-10  bottom row of left arm
    [0,7],                                        // 11    left tip   (green pre-lane)
    [0,6],[1,6],[2,6],[3,6],[4,6],[5,6],          // 12-17 top row of left arm (13 = green start)
    [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],          // 18-23 left column of top arm
    [7,0],                                        // 24    top tip    (yellow pre-lane)
    [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],          // 25-30 right column of top arm (26 = yellow start)
    [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],     // 31-36 top row of right arm
    [14,7],                                       // 37    right tip  (blue pre-lane)
    [14,8],                                       // 38
    [13,8],[12,8],[11,8],[10,8],[9,8],            // 39-43 bottom row of right arm (39 = blue start)
    [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],     // 44-49 right column of bottom arm
    [7,14],                                       // 50    bottom tip (red pre-lane)
    [6,14]                                        // 51    → wraps to 0
  ];
  var START  = [0, 13, 26, 39];
  var SAFE   = { 0:true, 8:true, 13:true, 21:true, 26:true, 34:true, 39:true, 47:true };
  var LANE = [
    [[7,13],[7,12],[7,11],[7,10],[7,9]],   // red    (bottom)
    [[1,7],[2,7],[3,7],[4,7],[5,7]],       // green  (left)
    [[7,1],[7,2],[7,3],[7,4],[7,5]],       // yellow (top)
    [[13,7],[12,7],[11,7],[10,7],[9,7]]    // blue   (right)
  ];
  var YARD = -1, HOME = 56, LAST_RING_POS = 50, FIRST_LANE_POS = 51;
  var MODES = ['quick', 'pass', 'daily', 'online'];

  function absCell(colorIdx, pos) {
    if (pos < 0 || pos > LAST_RING_POS) return null;
    return (START[colorIdx] + pos) % 52;
  }

  /* Grid cell [col,row] for a token position (pos 56 → null, use homePoint). */
  function posToCell(colorIdx, pos) {
    if (pos === YARD) return null;
    if (pos === HOME) return null;
    if (pos <= LAST_RING_POS) return RING[absCell(colorIdx, pos)];
    return LANE[colorIdx][pos - FIRST_LANE_POS];
  }

  /* Interpolated path positions a token travels from → to (inclusive). */
  function pathPositions(from, to) {
    if (from === YARD) return [0];
    var out = [];
    for (var p = from + 1; p <= to; p++) out.push(p);
    return out.length ? out : [to];
  }

  function newStats() {
    return { rolls:0, sixes:0, captures:0, timesCaptured:0, turns:0, homes:0 };
  }

  /* seats: [{color:0..3, kind:'human'|'ai', name, ai:0|1|2|null}] (2..4, unique colors) */
  function createGame(cfg) {
    if (!cfg || !Array.isArray(cfg.seats) || cfg.seats.length < 2 || cfg.seats.length > 4) {
      throw new Error('engine: need 2-4 seats');
    }
    var seats = cfg.seats
      .map(function (s, i) {
        return {
          i: i, color: s.color | 0, kind: s.kind === 'ai' ? 'ai' : 'human',
          name: String(s.name || ('Player ' + (i + 1))).slice(0, 18),
          ai: s.kind === 'ai' ? (s.ai | 0) : null
        };
      })
      .sort(function (a, b) { return a.color - b.color; })
      .map(function (s, i) { s.i = i; return s; });
    var colors = seats.map(function (s) { return s.color; });
    for (var c = 0; c < colors.length; c++) {
      if (colors[c] < 0 || colors[c] > 3 || colors.indexOf(colors[c]) !== c) {
        throw new Error('engine: seat colors must be unique 0..3');
      }
    }
    var st = {
      v: 1,
      mode: MODES.indexOf(cfg.mode) >= 0 ? cfg.mode : 'quick',
      rules: {
        firstToCaptures: (cfg.rules && cfg.rules.firstToCaptures) || 0,
        daily: !!(cfg.rules && cfg.rules.daily),
        headStart: (cfg.rules && cfg.rules.headStart) || null
      },
      seats: seats,
      tokens: seats.map(function (s) { return [YARD, YARD, YARD, YARD]; }),
      turn: 0,
      phase: 'roll',            // 'roll' | 'move' | 'over'
      lastRoll: null,
      sixChain: 0,              // consecutive sixes within the current turn
      winner: null,
      rankings: null,
      stats: seats.map(function () { return newStats(); }),
      moveNo: 0,
      startedAt: Date.now()
    };
    if (st.rules.headStart) {
      var hs = st.rules.headStart; // { seatColor: [4 positions] }
      seats.forEach(function (s) {
        if (hs[s.color]) {
          for (var t = 0; t < 4; t++) {
            var p = hs[s.color][t];
            if (typeof p === 'number' && p >= YARD && p <= LAST_RING_POS) st.tokens[s.i][t] = p;
          }
        }
      });
    }
    return st;
  }

  function clone(st) { return JSON.parse(JSON.stringify(st)); }

  function tokenAbs(st, seatIdx, tokenIdx) {
    return absCell(st.seats[seatIdx].color, st.tokens[seatIdx][tokenIdx]);
  }

  /* All legal moves for the current player + a dice value.
     Returns [{ token, from, to, captures:[{seat,token}], home, release }] */
  function legalMoves(st, roll) {
    if (st.phase === 'over' || st.winner !== null) return [];
    var seatIdx = st.turn, color = st.seats[seatIdx].color;
    var out = [];
    for (var t = 0; t < 4; t++) {
      var from = st.tokens[seatIdx][t];
      if (from === HOME) continue;
      if (from === YARD) {
        if (roll === 6) out.push(makeMove(st, seatIdx, t, 0));
        continue;
      }
      var to = from + roll;
      if (to <= HOME) out.push(makeMove(st, seatIdx, t, to));
    }
    return out;
  }

  function makeMove(st, seatIdx, tokenIdx, to) {
    var from = st.tokens[seatIdx][tokenIdx];
    var captures = [];
    if (to <= LAST_RING_POS) {
      var c = absCell(st.seats[seatIdx].color, to);
      if (!SAFE[c]) {
        for (var s = 0; s < st.seats.length; s++) {
          if (s === seatIdx) continue;
          for (var t = 0; t < 4; t++) {
            if (st.tokens[s][t] >= 0 && st.tokens[s][t] <= LAST_RING_POS &&
                tokenAbs(st, s, t) === c) {
              captures.push({ seat: s, token: t });
            }
          }
        }
      }
    }
    return {
      token: tokenIdx, from: from, to: to, captures: captures,
      home: to === HOME, release: from === YARD
    };
  }

  /* Applies a move from legalMoves(). Returns resolution events. */
  function applyMove(st, move) {
    var seatIdx = st.turn;
    st.moveNo++;
    st.tokens[seatIdx][move.token] = move.to;
    move.captures.forEach(function (cap) {
      st.tokens[cap.seat][cap.token] = YARD;
      st.stats[seatIdx].captures++;
      st.stats[cap.seat].timesCaptured++;
    });
    if (move.home) st.stats[seatIdx].homes++;
    var events = {
      seat: seatIdx, move: move, path: pathPositions(move.from, move.to),
      captures: move.captures, home: move.home,
      win: false, rankings: null
    };
    if (isWin(st, seatIdx)) {
      st.winner = seatIdx;
      st.phase = 'over';
      st.rankings = rankPlayers(st, seatIdx);
      events.win = true;
      events.rankings = st.rankings;
    }
    return events;
  }

  function isWin(st, seatIdx) {
    var target = st.rules.firstToCaptures;
    if (target && st.stats[seatIdx].captures >= target) return true;
    var toks = st.tokens[seatIdx];
    return toks[0] === HOME && toks[1] === HOME && toks[2] === HOME && toks[3] === HOME;
  }

  function progress(st, seatIdx) {
    var sum = 0;
    st.tokens[seatIdx].forEach(function (p) {
      sum += (p === YARD ? 0 : (p === HOME ? 57 : p + 1));
    });
    return sum;
  }

  /* Winner first, everyone else by progress (max 228). */
  function rankPlayers(st, winnerIdx) {
    var rows = st.seats.map(function (s, i) {
      return { seat: i, progress: progress(st, i), captures: st.stats[i].captures };
    });
    rows.sort(function (a, b) {
      if (a.seat === winnerIdx) return -1;
      if (b.seat === winnerIdx) return 1;
      return (b.progress - a.progress) || (b.captures - a.captures) || (a.seat - b.seat);
    });
    return rows.map(function (r) { return r.seat; });
  }

  /* Register a roll value. Returns {forfeit} when a third consecutive six
     burns the turn (classic rule — the third six is void, no move happens). */
  function registerRoll(st, value) {
    st.stats[st.turn].rolls++;
    st.lastRoll = value;
    if (value === 6) {
      st.stats[st.turn].sixes++;
      st.sixChain++;
    } else {
      st.sixChain = 0;
    }
    if (st.sixChain >= 3) {
      st.sixChain = 0;
      return { value: value, forfeit: true };
    }
    return { value: value, forfeit: false };
  }

  /* Move the turn along. extra=true keeps the seat (six / capture / home). */
  function endTurn(st, extra) {
    if (st.phase === 'over') return;
    if (extra) {
      st.phase = 'roll';
      return;
    }
    st.sixChain = 0;
    st.turn = (st.turn + 1) % st.seats.length;
    st.phase = 'roll';
  }

  function beginsTurn(st) { st.stats[st.turn].turns++; }

  /* ---------- persistence validation ---------- */
  function validateState(obj) {
    try {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.v !== 1) return null;
      if (MODES.indexOf(obj.mode) < 0) return null;
      if (!Array.isArray(obj.seats) || obj.seats.length < 2 || obj.seats.length > 4) return null;
      var seen = {};
      var prevColor = -1;
      for (var s = 0; s < obj.seats.length; s++) {
        var seat = obj.seats[s];
        if (!seat || typeof seat.name !== 'string') return null;
        if (seat.kind !== 'human' && seat.kind !== 'ai') return null;
        if (typeof seat.color !== 'number' || seat.color < 0 || seat.color > 3) return null;
        if (seat.color <= prevColor) return null;          // seats stored color-sorted, unique
        prevColor = seat.color;
        if (typeof seat.i !== 'number' || seat.i !== s) return null;
        if (seat.kind === 'ai' && typeof seat.ai !== 'number') return null;
        if (seen[seat.color]) return null;
        seen[seat.color] = true;
      }
      if (!Array.isArray(obj.tokens) || obj.tokens.length !== obj.seats.length) return null;
      for (var p = 0; p < obj.tokens.length; p++) {
        if (!Array.isArray(obj.tokens[p]) || obj.tokens[p].length !== 4) return null;
        for (var t = 0; t < 4; t++) {
          var pos = obj.tokens[p][t];
          if (typeof pos !== 'number' || !isFinite(pos) || pos < -1 || pos > 56 ||
              Math.floor(pos) !== pos) return null;
        }
      }
      if (typeof obj.turn !== 'number' || obj.turn < 0 || obj.turn >= obj.seats.length) return null;
      if (['roll', 'move', 'over'].indexOf(obj.phase) < 0) return null;
      if (obj.lastRoll !== null && (obj.lastRoll < 1 || obj.lastRoll > 6)) return null;
      if (typeof obj.sixChain !== 'number' || obj.sixChain < 0 || obj.sixChain > 2) return null;
      if (obj.winner !== null && (typeof obj.winner !== 'number' || obj.winner >= obj.seats.length)) return null;
      if (typeof obj.moveNo !== 'number' || obj.moveNo < 0) return null;
      if (typeof obj.startedAt !== 'number') return null;
      if (!Array.isArray(obj.stats) || obj.stats.length !== obj.seats.length) return null;
      for (var k = 0; k < obj.stats.length; k++) {
        var st = obj.stats[k];
        ['rolls','sixes','captures','timesCaptured','turns','homes'].forEach(function (f) {
          if (typeof st[f] !== 'number' || st[f] < 0 || Math.floor(st[f]) !== st[f]) throw 'bad';
        });
      }
      if (obj.phase === 'over' && obj.winner === null) return null;
      return obj;
    } catch (e) { return null; }
  }

  global.LudoraEngine = {
    COLORS: COLORS, RING: RING, START: START, SAFE: SAFE, LANE: LANE,
    YARD: YARD, HOME: HOME, LAST_RING_POS: LAST_RING_POS, FIRST_LANE_POS: FIRST_LANE_POS,
    createGame: createGame, clone: clone,
    absCell: absCell, posToCell: posToCell, pathPositions: pathPositions,
    legalMoves: legalMoves, applyMove: applyMove, registerRoll: registerRoll,
    endTurn: endTurn, beginsTurn: beginsTurn,
    progress: progress, rankPlayers: rankPlayers, isWin: isWin,
    validateState: validateState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraEngine;
})(typeof window !== 'undefined' ? window : globalThis);
