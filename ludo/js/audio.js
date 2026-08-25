/* =========================================================================
   Ludora — audio.js
   Premium WebAudio synthesizer (zero external assets, 100% offline-first)
   + coordinated haptic feedback engine.
   Safely handles browser autoplay policies and audio context suspensions.
   ========================================================================= */
(function (global) {
  'use strict';

  var ctx = null, master = null, sfxGain = null, musicGain = null;
  var soundOn = true, musicOn = false, hapticsOn = true, unlocked = false;
  var ambientTimer = null, ambientPlaying = false;

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = soundOn ? 1.0 : 0.0;
      sfxGain.connect(master);

      musicGain = ctx.createGain();
      musicGain.gain.value = musicOn ? 0.35 : 0.0;
      musicGain.connect(master);

      return ctx;
    } catch (e) {
      ctx = null;
      return null;
    }
  }

  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') {
      try { c.resume(); } catch (e) {}
    }
    unlocked = true;
    if (musicOn && !ambientPlaying) startAmbient();
  }

  /* Core oscillator tone synthesis */
  function tone(freq, dur, type, gain, delay, slideTo) {
    if (!ctx || !soundOn) return;
    try {
      var t0 = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) {
        o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      }
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain == null ? 0.4 : gain, t0 + Math.min(0.012, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
      o.connect(g);
      g.connect(sfxGain || master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    } catch (e) {}
  }

  /* Core noise synthesis for percussive textures */
  function noise(dur, gain, delay, hp, lp) {
    if (!ctx || !soundOn) return;
    try {
      var t0 = ctx.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
      }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = hp ? 'highpass' : 'bandpass';
      f.frequency.value = hp || lp || 1200;
      var g = ctx.createGain();
      g.gain.setValueAtTime(gain == null ? 0.3 : gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(sfxGain || master);
      src.start(t0);
    } catch (e) {}
  }

  /* Procedural ambient musical pulse (when music setting is on) */
  function startAmbient() {
    if (!ctx || !musicOn || ambientPlaying) return;
    ambientPlaying = true;
    var chordIndex = 0;
    var chords = [
      [261.63, 329.63, 392.00, 523.25], // C Major
      [220.00, 261.63, 329.63, 440.00], // A Minor
      [174.61, 220.00, 261.63, 349.23], // F Major
      [196.00, 246.94, 293.66, 392.00]  // G Major
    ];

    function playChord() {
      if (!musicOn || !ctx || !ambientPlaying) {
        ambientPlaying = false;
        return;
      }
      try {
        var chord = chords[chordIndex % chords.length];
        chordIndex++;
        var t0 = ctx.currentTime;
        chord.forEach(function (freq, idx) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, t0);
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.035 / (idx + 1), t0 + 1.2);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.8);
          o.connect(g);
          g.connect(musicGain || master);
          o.start(t0);
          o.stop(t0 + 5.0);
        });
      } catch (e) {}
      ambientTimer = setTimeout(playChord, 5200);
    }

    playChord();
  }

  function stopAmbient() {
    ambientPlaying = false;
    if (ambientTimer) {
      clearTimeout(ambientTimer);
      ambientTimer = null;
    }
  }

  /* Sound Palette */
  var SOUNDS = {
    tap: function () {
      tone(1400, 0.035, 'sine', 0.15, 0, 700);
    },
    roll: function () {
      // Crisp tumble rattle sequence
      noise(0.18, 0.22, 0, 1500);
      tone(220, 0.04, 'triangle', 0.28, 0.02, 140);
      tone(280, 0.04, 'triangle', 0.24, 0.08, 180);
      tone(340, 0.05, 'sine', 0.22, 0.14, 200);
    },
    land: function (v) {
      var val = typeof v === 'number' ? v : 3;
      tone(180 + val * 24, 0.08, 'triangle', 0.45);
      tone(110, 0.09, 'sine', 0.5, 0.01, 70);
      noise(0.04, 0.16, 0, 2200);
    },
    step: function (i) {
      var stepIdx = typeof i === 'number' ? i : 0;
      var baseFreq = 523.25; // C5
      var scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
      var semitone = scale[stepIdx % scale.length] + Math.floor(stepIdx / scale.length) * 12;
      var f = baseFreq * Math.pow(2, semitone / 12);
      tone(f, 0.045, 'sine', 0.22);
      tone(f * 0.5, 0.03, 'triangle', 0.12);
    },
    landing: function () {
      tone(160, 0.06, 'sine', 0.35, 0, 80);
      noise(0.02, 0.12, 0, 1800);
    },
    capture: function () {
      // Heavy impact punch + explosion sweep
      tone(520, 0.14, 'sawtooth', 0.32, 0, 90);
      noise(0.12, 0.38, 0.01, 600);
      tone(90, 0.20, 'sine', 0.65, 0.03, 35);
      tone(180, 0.10, 'triangle', 0.35, 0.06);
    },
    safe: function () {
      tone(659.25, 0.08, 'sine', 0.28);
      tone(987.77, 0.14, 'sine', 0.25, 0.06);
    },
    home: function () {
      // Harmonic crystal arpeggio
      var notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach(function (f, idx) {
        tone(f, 0.14, 'sine', 0.38, idx * 0.07);
        tone(f * 1.5, 0.10, 'triangle', 0.15, idx * 0.07);
      });
    },
    six: function () {
      tone(880.00, 0.07, 'sine', 0.34);
      tone(1318.51, 0.14, 'sine', 0.32, 0.07);
      tone(1760.00, 0.16, 'sine', 0.25, 0.12);
    },
    win: function () {
      // Celebratory orchestral fanfare
      var fanfare = [
        { f: 523.25, d: 0.12, t: 0 },
        { f: 659.25, d: 0.12, t: 0.10 },
        { f: 783.99, d: 0.14, t: 0.20 },
        { f: 1046.50, d: 0.35, t: 0.34 },
        { f: 880.00, d: 0.12, t: 0.55 },
        { f: 1046.50, d: 0.12, t: 0.68 },
        { f: 1318.51, d: 0.50, t: 0.82 }
      ];
      fanfare.forEach(function (item) {
        tone(item.f, item.d, 'triangle', 0.42, item.t);
        tone(item.f * 0.5, item.d, 'sine', 0.30, item.t);
      });
    },
    lose: function () {
      tone(392.00, 0.18, 'sine', 0.30);
      tone(349.23, 0.20, 'sine', 0.30, 0.14);
      tone(293.66, 0.32, 'sine', 0.32, 0.30);
    },
    pass: function () {
      tone(360, 0.05, 'triangle', 0.24, 0, 260);
    },
    achieve: function () {
      [739.99, 932.33, 1108.73, 1479.98].forEach(function (f, idx) {
        tone(f, 0.15, 'sine', 0.32, idx * 0.07);
      });
    },
    levelUp: function () {
      [587.33, 739.99, 880.00, 1174.66, 1479.98].forEach(function (f, idx) {
        tone(f, 0.18, 'triangle', 0.35, idx * 0.08);
      });
    },
    unlock: function () {
      tone(587.33, 0.09, 'triangle', 0.34);
      tone(880.00, 0.09, 'triangle', 0.32, 0.08);
      tone(1174.66, 0.18, 'triangle', 0.30, 0.16);
    },
    daily: function () {
      [659.25, 783.99, 987.77, 1318.51].forEach(function (f, idx) {
        tone(f, 0.14, 'sine', 0.35, idx * 0.08);
      });
    },
    noMove: function () {
      tone(240, 0.08, 'sine', 0.28, 0, 190);
      tone(200, 0.10, 'sine', 0.28, 0.08, 160);
    }
  };

  function play(name, arg) {
    if (!soundOn || !unlocked) return;
    ensure();
    var s = SOUNDS[name];
    if (s) {
      try { s(arg); } catch (e) {}
    }
  }

  /* Coordinated Haptic Feedback */
  var HAPTIC_PATTERNS = {
    tap: 8,
    roll: [12, 20, 14],
    land: 14,
    step: 5,
    landing: 8,
    capture: [20, 35, 25, 55],
    safe: [12, 18],
    home: [14, 22, 14, 25, 40],
    six: [25, 30],
    win: [35, 45, 35, 50, 70, 90],
    levelUp: [30, 40, 50, 60],
    daily: [25, 35, 45],
    pass: 10,
    noMove: [8, 22]
  };

  function haptic(name) {
    if (!hapticsOn) return;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    try {
      var pattern = HAPTIC_PATTERNS[name] || 8;
      navigator.vibrate(pattern);
    } catch (e) {}
  }

  var LudoraAudio = {
    unlock: unlock,
    play: play,
    haptic: haptic,

    setEnabled: function (v) {
      soundOn = !!v;
      if (sfxGain && ctx) {
        try { sfxGain.gain.setValueAtTime(soundOn ? 1.0 : 0.0, ctx.currentTime); } catch (e) {}
      }
    },

    setSound: function (v) {
      this.setEnabled(v);
    },

    setMusic: function (v) {
      musicOn = !!v;
      if (musicGain && ctx) {
        try { musicGain.gain.setValueAtTime(musicOn ? 0.35 : 0.0, ctx.currentTime); } catch (e) {}
      }
      if (musicOn && unlocked) {
        startAmbient();
      } else {
        stopAmbient();
      }
    },

    setHaptics: function (v) {
      hapticsOn = !!v;
    },

    isEnabled: function () { return soundOn; },
    isSoundEnabled: function () { return soundOn; },
    isMusicEnabled: function () { return musicOn; },
    isHapticsEnabled: function () { return hapticsOn; }
  };

  global.LudoraAudio = LudoraAudio;
  if (typeof module !== 'undefined' && module.exports) module.exports = LudoraAudio;
})(typeof window !== 'undefined' ? window : globalThis);
