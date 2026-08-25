/* =========================================================================
   Ludora — mp.js
   Host-authoritative online multiplayer protocol over WebRTC DataChannels.

   Trust model (honest, client-side only — there is no server):
   · The HOST owns the only authoritative game state. It is created and
     mutated exclusively through the existing rules engine (engine.js).
   · Guests render snapshots; their inputs are REQUESTS that the host
     validates (right seat? right phase? legal move?) before applying.
   · Every state message carries a monotonically increasing sequence
     number; stale or duplicate snapshots are ignored by guests.
   · Dice are generated on the host with the existing crypto RNG and ride
     the same synchronized stream — no client ever picks its own roll.
   · Messages are strict JSON with whitelisted shapes, bounds checks and
     flood limits. No executable data, no HTML, no eval — rendering goes
     through the existing escaping.
   · Each seat has its own secret embedded in that seat's invite code;
     possession of a code is room access (share codes carefully). This is
     session authentication, NOT a claim of server-side anti-cheat.
   ========================================================================= */
(function (global) {
  'use strict';
  var Net = global.LudoraNet, E = global.LudoraEngine;

  var PROTO = 1;
  var PING_EVERY = 2500, PING_TIMEOUT = 9000;
  var MAX_NAME = 16;
  /* protocol clock — injectable so tests get deterministic keepalive/flood behavior */
  var nowMs = function () { return Date.now(); };

  function sanitizeName(s) {
    s = String(s == null ? '' : s)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME);
    return s || 'Player';
  }
  function isInt(v, lo, hi) { return typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi; }

  /* ======================================================================
     Room — host side
     ====================================================================== */
  function Room(opts) {
    opts = opts || {};
    this.id = opts.id || Net.roomId();
    this.size = isInt(opts.size, 2, 4) ? opts.size : 2;
    this.peerFactory = opts.peerFactory || null;      // injectable (tests)
    this.onEvent = opts.onEvent || function () {};    // UI hook
    this.seats = [];
    this.state = 'lobby';                             // lobby | playing | closed
    this.seq = 0;
    this.match = null;                                // host Match once playing
    this._pingTimer = null;
    this._flood = {};
    for (var i = 0; i < this.size; i++) {
      this.seats.push({
        seat: i, color: i,
        kind: i === 0 ? 'host' : (opts.aiSeats && opts.aiSeats[i] ? 'ai' : 'open'),
        ai: (opts.aiSeats && isInt(opts.aiSeats[i], 0, 2)) ? opts.aiSeats[i] : 1,
        name: i === 0 ? (opts.hostName || 'Host') : null,
        avatar: i === 0 ? (opts.hostAvatar || 0) : null,
        ready: i === 0 ? true : false,
        connected: i === 0,
        token: i === 0 ? Net.secret() : null,
        peer: null, disconnectedAt: 0
      });
    }
    this._startPing();
  }

  Room.prototype.emit = function (name, data) { try { this.onEvent(name, data); } catch (e) {} };
  Room.prototype.seatsPublic = function () {
    return this.seats.map(function (s) {
      return { seat: s.seat, color: s.color, kind: s.kind, ai: s.ai, name: s.name,
               avatar: s.avatar, ready: s.ready, connected: s.connected };
    });
  };
  Room.prototype.broadcast = function (msg) {
    this.seats.forEach(function (s) {
      if (s.kind === 'remote' && s.connected && s.peer) s.peer.send(msg);
    });
  };
  Room.prototype.isSeatLive = function (seatIdx) {
    var s = this.seats[seatIdx];
    return !s || s.kind !== 'remote' ? true : s.connected;
  };

  /* ---- invite lifecycle ---- */
  Room.prototype.inviteSeat = function (seatIdx) {
    var self = this;
    var s = this.seats[seatIdx];
    if (!s || s.kind !== 'open') return Promise.reject(new Error('Seat is not open'));
    if (s.peer) { try { s.peer.close(); } catch (e) {} s.peer = null; }
    var token = Net.secret();
    var peer = this.peerFactory ? this.peerFactory() : new Net.Peer({ label: 'seat' + seatIdx });
    s.pendingToken = token;
    return peer.createOffer({ room: this.id, seat: seatIdx, secret: token }).then(function (code) {
      s.peer = peer;
      s.pendingKind = 'remote';
      self._wirePeer(s, peer, token);
      return { code: code, token: token };
    });
  };
  /* tests / reinvite: attach an already-paired transport to a seat */
  Room.prototype.bindPeer = function (seatIdx, peer, token) {
    var s = this.seats[seatIdx];
    if (!s || s.kind === 'closedSeat') return;
    s.kind = 'remote';
    s.token = token;
    s.peer = peer;
    this._wirePeer(s, peer, token);
  };
  Room.prototype._wirePeer = function (s, peer, token) {
    var self = this;
    s.token = token;
    peer.onmessage = function (raw) { self._onGuestRaw(s, raw); };
    peer.onclose = function () { self._seatDisconnected(s); };
    if (peer.open && !s.connected) {
      /* transport already open (virtual net) — wait for hello like normal */
    }
  };
  Room.prototype._seatDisconnected = function (s) {
    if (this.state === 'closed' || !s.connected) return;
    s.connected = false;
    s.ready = false;
    s.disconnectedAt = nowMs();
    this.emit('seats', this.seatsPublic());
    this.broadcast({ m: 'seats', seats: this.seatsPublic() });
    if (this.state === 'playing') {
      this.broadcast({ m: 'status', text: s.name + ' disconnected', seat: s.seat });
      this.emit('disconnect', { seat: s.seat, name: s.name });
      /* if they owed the current action, free the turn shortly after */
      var self2 = this;
      var seatIdx = s.seat;
      setTimeout(function () {
        if (self2.state === 'playing' && self2.match && self2.match.netAdvanceDisconnected) {
          self2.match.netAdvanceDisconnected(seatIdx);
        }
      }, 1400);
    }
  };

  /* ---- guest message intake: validate everything, trust nothing ---- */
  Room.prototype._onGuestRaw = function (s, raw) {
    if (typeof raw !== 'string' || raw.length > Net.MAX_MSG) return this._strike(s, 'oversize');
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return this._strike(s, 'malformed'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return this._strike(s, 'malformed');
    var t = msg.m;
    var ok =
      t === 'hello' || t === 'ready' || t === 'roll' || t === 'move' ||
      t === 'pong' || t === 'leave';
    if (!ok) return this._strike(s, 'unknown-type');

    /* flood guard */
    var now = nowMs();
    var f = this._flood[s.seat] = this._flood[s.seat] || { n: 0, t: now };
    if (now - f.t > 1000) { f.n = 0; f.t = now; }
    if (++f.n > 25) return this.kick(s.seat, 'flood');

    if (t === 'hello') {
      if (typeof msg.token !== 'string' || msg.token !== s.token) return this._strike(s, 'bad-token');
      if (msg.v !== PROTO) { s.peer.send({ m: 'error', code: 'version' }); return; }
      var name = sanitizeName(msg.name);
      var avatar = isInt(msg.avatar, 0, 7) ? msg.avatar : 0;
      var isReconnect = s.kind === 'remote' && s.name && !s.connected;
      s.kind = 'remote';
      s.name = isReconnect ? s.name : name;
      s.avatar = isReconnect ? s.avatar : avatar;
      s.connected = true;
      s.disconnectedAt = 0;
      s.peer.send({ m: 'welcome', room: this.id, seat: s.seat, seats: this.seatsPublic(),
                    resume: isReconnect, proto: PROTO });
      this.emit('seats', this.seatsPublic());
      this.broadcast({ m: 'seats', seats: this.seatsPublic() });
      if (isReconnect) {
        this.emit('reconnect', { seat: s.seat });
        if (this.state === 'playing' && this.match) {
          s.peer.send({ m: 'start', cfg: this.match.cfg, st: this.match.st,
                        yourSeat: s.seat, seq: this.seq, resume: true });
        }
        this.broadcast({ m: 'status', text: s.name + ' reconnected', seat: s.seat });
      }
      return;
    }
    if (t === 'leave') { this.kick(s.seat, 'bye'); return; }
    if (!s.connected) return;   // must hello first

    if (t === 'pong') { s.lastPong = nowMs(); s.rtt = isInt(msg.t, 0, 1e12) ? Math.max(0, nowMs() - msg.t) : -1; return; }
    if (t === 'ready') {
      if (this.state !== 'lobby' || typeof msg.on !== 'boolean') return;
      s.ready = msg.on;
      this.emit('seats', this.seatsPublic());
      this.broadcast({ m: 'seats', seats: this.seatsPublic() });
      return;
    }
    if (this.state !== 'playing' || !this.match) return this._strike(s, 'wrong-state');
    var st = this.match.st;
    if (st.seats[st.turn].color !== s.color) return;            // not your turn → ignore
    if (t === 'roll') {
      if (st.phase !== 'roll') return;
      this.match.netGuestRoll(s.seat);
    } else if (t === 'move') {
      if (st.phase !== 'move') return;
      if (!isInt(msg.token, 0, 3)) return this._strike(s, 'bad-move');
      var legal = E.legalMoves(st, st.lastRoll).filter(function (mv) { return mv.token === msg.token; });
      if (!legal.length) { this.emit('invalidMove', { seat: s.seat }); return; }  // rejected
      this.match.netGuestMove(s.seat, legal[0]);
    }
  };
  Room.prototype._strike = function (s, why) {
    s.strikes = (s.strikes || 0) + 1;
    s.strikeLog = s.strikeLog || [];
    s.strikeLog.push(why);
    this.emit('violation', { seat: s.seat, why: why });
    if (s.strikes >= 5) this.kick(s.seat, 'protocol');
  };
  Room.prototype.kick = function (seatIdx, reason) {
    var s = this.seats[seatIdx];
    if (!s) return;
    if (s.peer) { try { s.peer.send({ m: 'closed', reason: reason }); } catch (e) {} try { s.peer.close(); } catch (e) {} }
    if (s.kind === 'remote') {
      s.connected = false; s.ready = false;
      if (reason === 'bye') { s.name = null; s.kind = 'open'; s.token = null; }
      this.emit('seats', this.seatsPublic());
      this.broadcast({ m: 'seats', seats: this.seatsPublic() });
    }
  };

  /* ---- keepalive ---- */
  Room.prototype._startPing = function () {
    var self = this;
    this._pingTimer = setInterval(function () {
      if (self.state === 'closed') return;
      var now = nowMs();
      self.seats.forEach(function (s) {
        if (s.kind !== 'remote') return;
        if (s.connected) {
          s.peer.send({ m: 'ping', t: now, r: typeof s.rtt === 'number' && s.rtt >= 0 ? s.rtt : -1 });
          if (s.lastPong && now - s.lastPong > PING_TIMEOUT) self._seatDisconnected(s);
        } else if (self.state === 'playing' && self.match && self.match.netAdvanceDisconnected &&
                   self.match.st.turn === s.seat) {
          self.match.netAdvanceDisconnected(s.seat);   // dead seat owing a roll → skip
        }
      });
    }, PING_EVERY);
  };

  /* ---- lobby actions ---- */
  Room.prototype.setAiSeat = function (seatIdx, level) {   // level: null → open for humans
    var s = this.seats[seatIdx];
    if (!s || this.state !== 'lobby' || seatIdx === 0) return;
    if (s.connected) return;
    if (level === null) { s.kind = 'open'; s.ai = 1; }
    else { s.kind = 'ai'; s.ai = isInt(level, 0, 2) ? level : 1; s.ready = true; s.name = null; }
    this.emit('seats', this.seatsPublic());
    this.broadcast({ m: 'seats', seats: this.seatsPublic() });
  };
  Room.prototype.allReady = function () {
    return this.seats.every(function (s) {
      if (s.kind === 'ai' || s.kind === 'host') return true;
      if (s.kind === 'remote') return s.connected && s.ready;
      return false;                                       // open seat → not ready
    });
  };
  /* Build the match cfg. The host UI starts its own Match, then calls started(). */
  Room.prototype.buildCfg = function (cosmetics) {
    var seats = this.seats.map(function (s) {
      if (s.kind === 'host') return { color: s.color, kind: 'human', name: s.name || 'Host', avatar: s.avatar, remote: false };
      if (s.kind === 'ai') return { color: s.color, kind: 'ai', name: s.name || ('AI ' + (s.seat + 1)), ai: s.ai, avatar: (s.color * 3 + 2) % 8, remote: false };
      return { color: s.color, kind: 'human', name: s.name || ('Seat ' + s.seat), avatar: s.avatar || 0, remote: true };
    });
    var c = cosmetics || {};
    return {
      mode: 'online', seats: seats, rules: {},
      theme: c.board || 'ivory', dice: c.dice || 'ivory', tokenShape: c.token || 'classic',
      youColor: 0, netSeat: 0
    };
  };
  Room.prototype.started = function () {                   // host match is live
    this.state = 'playing';
    this.seq = 1;
    this.seats.forEach(function (s) {
      if (s.kind === 'remote' && s.connected) {
        s.peer.send({ m: 'start', cfg: this.match.cfg, st: this.match.st,
                      yourSeat: s.seat, seq: this.seq });
      }
    }, this);
    /* seed every guest with the first turn so their dice arms immediately */
    this.sync('turn', { seat: this.match.st.turn, extra: false });
    this.emit('start', {});
  };
  /* host Match calls this after every authoritative transition */
  Room.prototype.sync = function (tag, fx) {
    if (this.state !== 'playing' || !this.match) return;
    this.seq++;
    this.broadcast({ m: 'sync', seq: this.seq, tag: tag, fx: fx || {}, st: this.match.st });
  };
  /* replace a disconnected human seat with an AI mid-match */
  Room.prototype.convertToAi = function (seatIdx, level) {
    var s = this.seats[seatIdx];
    if (!s || this.state !== 'playing' || !this.match) return false;
    if (s.kind !== 'remote') return false;
    if (s.peer) { try { s.peer.close(); } catch (e) {} s.peer = null; }
    s.kind = 'ai';
    s.ai = isInt(level, 0, 2) ? level : 1;
    s.connected = false;
    var mst = this.match.st;
    mst.seats[seatIdx].kind = 'ai';
    mst.seats[seatIdx].ai = s.ai;
    this.sync('turn', { seat: mst.turn });
    this.emit('seats', this.seatsPublic());
    this.broadcast({ m: 'seats', seats: this.seatsPublic() });
    this.emit('converted', { seat: seatIdx, level: s.ai });
    return true;
  };
  /* host ends the match early: leader by progress wins */
  Room.prototype.endMatchByHost = function () {
    if (this.state !== 'playing' || !this.match) return;
    var st = this.match.st;
    var leader = 0, best = -1;
    st.seats.forEach(function (s, i) {
      var p = E.progress(st, i);
      if (p > best) { best = p; leader = i; }
    });
    st.winner = leader;
    st.rankings = E.rankPlayers(st, leader);
    st.phase = 'over';
    this.sync('end', { winner: leader, rankings: st.rankings });
    this.match.finish();
  };
  Room.prototype.endMatch = function () {
    if (this.state === 'playing') { this.state = 'lobby'; this.emit('seats', this.seatsPublic()); }
  };
  Room.prototype.close = function (reason) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearInterval(this._pingTimer);
    this.seats.forEach(function (s) {
      if (s.peer) { try { s.peer.send({ m: 'closed', reason: reason || 'host-left' }); } catch (e) {} try { s.peer.close(); } catch (e) {} }
    });
    this.emit('closed', { reason: reason || 'host-left' });
  };

  /* ======================================================================
     Guest side
     ====================================================================== */
  function Guest(opts) {
    opts = opts || {};
    this.peer = opts.peer || new Net.Peer({ label: 'guest' });
    this.room = null; this.seat = null; this.token = opts.token || null;
    this.name = sanitizeName(opts.name || 'Player');
    this.avatar = isInt(opts.avatar, 0, 7) ? opts.avatar : 0;
    this.state = 'idle';                     // idle | lobby | playing | closed
    this.lastSeq = 0; this.rtt = null;
    this.onEvent = opts.onEvent || function () {};
    this._pingTimer = null;
    this._staleSeq = 0;
    var self = this;
    this.peer.onmessage = function (raw) { self._onHostRaw(raw); };
    this.peer.onclose = function (why) {
      if (self.state !== 'closed') {
        self.state = self.state === 'playing' ? 'lost' : 'idle';
        self.emit2('connection', { up: false, why: why });
      }
    };
  }
  Guest.prototype.emit2 = function (name, data) { try { this.onEvent(name, data); } catch (e) {} };

  Guest.prototype._onHostRaw = function (raw) {
    if (typeof raw !== 'string' || raw.length > Net.MAX_MSG) return;
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.m) {
      case 'welcome':
        this.room = msg.room; this.seat = isInt(msg.seat, 0, 3) ? msg.seat : null;
        this.state = 'lobby';
        this._startPong();
        this.emit2('welcome', { room: msg.room, seat: msg.seat, seats: msg.seats, resume: !!msg.resume });
        break;
      case 'seats':
        this.emit2('seats', msg.seats || []);
        break;
      case 'start':
        if (!msg.cfg || !E.validateState(msg.st)) return;
        this.lastSeq = isInt(msg.seq, 0, 1e9) ? msg.seq : 0;
        this.state = 'playing';
        this.emit2('start', { cfg: msg.cfg, st: msg.st, yourSeat: msg.yourSeat, seq: this.lastSeq });
        break;
      case 'sync':
        if (!isInt(msg.seq, 0, 1e9)) return;
        if (msg.seq <= this.lastSeq) { this._staleSeq++; this.emit2('staleSeq', { got: msg.seq, have: this.lastSeq }); return; }
        if (!E.validateState(msg.st)) return;
        this.lastSeq = msg.seq;
        this.emit2('sync', { seq: msg.seq, tag: msg.tag, fx: this._checkFx(msg.fx), st: msg.st });
        break;
      case 'ping':
        this.peer.send({ m: 'pong', t: msg.t });
        if (isInt(msg.r, -1, 60000)) {
          this.rtt = msg.r >= 0 ? msg.r : null;
          this.emit2('rtt', { rtt: this.rtt });
        }
        this.emit2('ping', { t: msg.t });
        break;
      case 'status':
        this.emit2('status', { text: String(msg.text || '').slice(0, 80), seat: msg.seat });
        break;
      case 'closed':
        this.state = 'closed';
        clearInterval(this._pingTimer);
        this.emit2('closed', { reason: String(msg.reason || 'closed') });
        try { this.peer.close(); } catch (e) {}
        break;
      case 'error':
        this.emit2('hostError', { code: String(msg.code || 'error') });
        break;
    }
  };
  Guest.prototype._checkFx = function (fx) {
    if (!fx || typeof fx !== 'object') return {};
    var out = {};
    if (isInt(fx.value, 1, 6)) out.value = fx.value;
    if (typeof fx.outcome === 'string' && fx.outcome.length < 12) out.outcome = fx.outcome;
    if (isInt(fx.seat, 0, 3)) out.seat = fx.seat;
    if (fx.move && isInt(fx.move.token, 0, 3) && isInt(fx.move.from, -1, 56) && isInt(fx.move.to, 0, 56)) {
      out.move = { token: fx.move.token, from: fx.move.from, to: fx.move.to };
    }
    if (Array.isArray(fx.captures) && fx.captures.length <= 12) {
      out.captures = fx.captures.filter(function (c) { return c && isInt(c.seat, 0, 3) && isInt(c.token, 0, 3); })
        .slice(0, 12).map(function (c) { return { seat: c.seat, token: c.token }; });
    }
    if (typeof fx.home === 'boolean') out.home = fx.home;
    if (typeof fx.win === 'boolean') out.win = fx.win;
    if (typeof fx.extra === 'boolean') out.extra = fx.extra;
    if (isInt(fx.winner, 0, 3)) out.winner = fx.winner;
    if (Array.isArray(fx.rankings) && fx.rankings.length <= 4) {
      out.rankings = fx.rankings.filter(function (r) { return isInt(r, 0, 3); });
    }
    return out;
  };
  Guest.prototype._startPong = function () {
    var self = this;
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(function () {
      if (self.state === 'closed' || self.state === 'idle') { clearInterval(self._pingTimer); return; }
      self.emit2('tick', { rtt: self.rtt, state: self.state });
    }, 2000);
  };
  /* actions (all validated again host-side) */
  Guest.prototype.hello = function () { this.peer.send({ m: 'hello', v: PROTO, token: this.token, name: this.name, avatar: this.avatar }); };
  Guest.prototype.setReady = function (on) { this.peer.send({ m: 'ready', on: !!on }); };
  Guest.prototype.requestRoll = function () { if (this.state === 'playing') this.peer.send({ m: 'roll' }); };
  Guest.prototype.requestMove = function (tokenIdx) {
    if (this.state === 'playing' && isInt(tokenIdx, 0, 3)) this.peer.send({ m: 'move', token: tokenIdx });
  };
  Guest.prototype.leave = function () {
    try { this.peer.send({ m: 'leave' }); } catch (e) {}
    this.state = 'closed';
    clearInterval(this._pingTimer);
    try { this.peer.close(); } catch (e) {}
    this.emit2('closed', { reason: 'left' });
  };
  Guest.prototype.destroy = function () {
    clearInterval(this._pingTimer);
    try { this.peer.close(); } catch (e) {}
    this.state = 'closed';
  };

  global.LudoraMp = { Room: Room, Guest: Guest, PROTO: PROTO, sanitizeName: sanitizeName,
                       _setNow: function (fn) { nowMs = fn; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraMp;
})(typeof window !== 'undefined' ? window : globalThis);
