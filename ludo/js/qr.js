/* =========================================================================
   Ludora — qr.js
   Minimal, dependency-free QR Code encoder (Model 2, byte mode,
   error correction level L, versions 1–20, all 8 masks with penalty
   selection). Built for sharing multiplayer invite codes without any
   external library. Returns a boolean module matrix.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---- EC level L block structure per version (1–20):
     [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] (ISO/IEC 18004) ---- */
  var BLOCKS_L = {
    1: [7, 1, 19, 0, 0], 2: [10, 1, 34, 0, 0], 3: [15, 1, 55, 0, 0],
    4: [20, 1, 80, 0, 0], 5: [26, 1, 108, 0, 0], 6: [18, 2, 68, 0, 0],
    7: [20, 2, 78, 0, 0], 8: [24, 2, 97, 0, 0], 9: [30, 2, 116, 0, 0],
    10: [18, 2, 68, 2, 69], 11: [20, 4, 81, 0, 0], 12: [24, 2, 92, 2, 93],
    13: [26, 4, 107, 0, 0], 14: [30, 3, 115, 1, 116], 15: [22, 5, 87, 1, 88],
    16: [24, 5, 98, 1, 99], 17: [28, 1, 107, 5, 108], 18: [30, 5, 120, 1, 121],
    19: [28, 3, 113, 4, 114], 20: [28, 3, 107, 5, 108]
  };
  var ALIGN = {
    1: [6], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
    15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78],
    18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90]
  };
  /* remainder bits after the final codeword */
  var REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0,
    11: 0, 12: 0, 13: 0, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 3, 20: 3 };
  var MAX_VERSION = 20;

  /* ---- GF(256) arithmetic (primitive polynomial 0x11D) ---- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* ---- Reed–Solomon: generator polynomial of length n ---- */
  function rsGen(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    return poly;   // highest-degree-first coefficients... (built reversed below)
  }
  /* standard synthetic division: data (MSB first) → ec codewords */
  function rsEncode(data, ecLen) {
    /* generator, highest degree first */
    var gen = [1];
    for (var i = 0; i < ecLen; i++) {
      var g2 = new Array(gen.length + 1).fill(0);
      for (var j = 0; j < gen.length; j++) {
        g2[j] ^= gen[j];
        g2[j + 1] ^= gmul(gen[j], EXP[i]);
      }
      gen = g2;
    }
    var rem = data.slice().concat(new Array(ecLen).fill(0));
    for (var k = 0; k < data.length; k++) {
      var f = rem[k];
      if (f === 0) continue;
      for (var m = 0; m < gen.length; m++) {
        rem[k + m] ^= gmul(gen[m], f);
      }
    }
    return rem.slice(data.length);
  }

  /* ---- pick the smallest version whose EC-L capacity fits ---- */
  function capacityOf(v) {
    var b = BLOCKS_L[v];
    return b[1] * b[2] + b[3] * b[4];
  }
  function pickVersion(byteLen) {
    for (var v = 1; v <= MAX_VERSION; v++) {
      var ccBits = v <= 9 ? 8 : 16;
      var need = 4 + ccBits + byteLen * 8;         // mode + count + payload
      var cap = capacityOf(v) * 8;
      if (need <= cap) return v;
    }
    return null;                                    // too large for QR
  }

  /* ---- bit buffer ---- */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  function encodeText(text) {
    var bytes;
    try { bytes = new TextEncoder().encode(text); }
    catch (e) {
      bytes = [];
      for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (c < 128) bytes.push(c);
        else { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }  // latin1-ish
      }
    }
    return encodeBytes(bytes);
  }

  function encodeBytes(bytes) {
    var v = pickVersion(bytes.length);
    if (!v) return null;
    var b = BLOCKS_L[v];
    var totalData = capacityOf(v);

    /* --- build the data bit stream --- */
    var bb = new BitBuf();
    bb.put(4, 4);                                   // byte mode
    bb.put(bytes.length, v <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);
    /* terminator */
    var cap = totalData * 8;
    var term = Math.min(4, cap - bb.bits.length);
    bb.put(0, Math.max(0, term));
    while (bb.bits.length % 8 !== 0) bb.bits.push(0);
    var dataCw = [];
    for (var j = 0; j < bb.bits.length; j += 8) {
      var by = 0;
      for (var k = 0; k < 8; k++) by = (by << 1) | bb.bits[j + k];
      dataCw.push(by);
    }
    /* pad codewords */
    var pad = 0xec;
    while (dataCw.length < totalData) { dataCw.push(pad); pad = pad === 0xec ? 0x11 : 0xec; }

    /* --- split into blocks, compute EC, interleave --- */
    var blocks = [], ecBlocks = [], pos = 0;
    var g1n = b[1], g1d = b[2], g2n = b[3], g2d = b[4];
    for (var g = 0; g < 2; g++) {
      var n = g === 0 ? g1n : g2n, d = g === 0 ? g1d : g2d;
      if (!n) continue;
      for (var bi = 0; bi < n; bi++) {
        blocks.push(dataCw.slice(pos, pos + d)); pos += d;
        ecBlocks.push(rsEncode(blocks[blocks.length - 1], b[0]));
      }
    }
    var maxD = Math.max(g1d, g2d || 0), final = [];
    for (var d2 = 0; d2 < maxD; d2++) {
      for (var bl = 0; bl < blocks.length; bl++) if (d2 < blocks[bl].length) final.push(blocks[bl][d2]);
    }
    for (var e2 = 0; e2 < b[0]; e2++) {
      for (var bl2 = 0; bl2 < ecBlocks.length; bl2++) final.push(ecBlocks[bl2][e2]);
    }
    /* remainder bits */
    for (var r = 0; r < (REMAINDER[v] || 0); r++) final_bits_pad.push(0); // (kept minimal; see placeData)
    return build(v, final);
  }
  var final_bits_pad = [];   // remainder bits are simply unwritten modules (left dark=false→handled in build)

  /* ---- matrix construction ---- */
  function build(version, codewords) {
    var size = version * 4 + 17;
    var mod = [], fn = [];                          // module colors + function-pattern map
    for (var i = 0; i < size; i++) { mod.push(new Uint8Array(size)); fn.push(new Uint8Array(size)); }

    function setFn(r, c, v) { mod[r][c] = v ? 1 : 0; fn[r][c] = 1; }
    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                     (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                     (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          setFn(rr, cc, dark);
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    /* timing patterns */
    for (var t = 8; t < size - 8; t++) {
      setFn(6, t, t % 2 === 0); setFn(t, 6, t % 2 === 0);
    }
    /* alignment patterns */
    var ap = ALIGN[version];
    for (var a1 = 0; a1 < ap.length; a1++) {
      for (var a2 = 0; a2 < ap.length; a2++) {
        var r0 = ap[a1], c0 = ap[a2];
        if (fn[r0][c0]) continue;                   // overlapping finder — skip
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            var dark2 = Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1;
            setFn(r0 + dr2, c0 + dc2, dark2);
          }
        }
      }
    }
    /* format info placeholders (dark module + reserved) */
    setFn(size - 8, 8, 1);
    for (var f = 0; f < 9; f++) { if (!fn[8][f]) setFn(8, f, 0); if (!fn[f][8]) setFn(f, 8, 0); }
    for (var f2 = 0; f2 < 8; f2++) { if (!fn[8][size - 1 - f2]) setFn(8, size - 1 - f2, 0); if (!fn[size - 1 - f2][8]) setFn(size - 1 - f2, 8, 0); }
    if (!fn[8][8]) setFn(8, 8, 0);
    /* version info (v ≥ 7) */
    if (version >= 7) {
      var vbits = bchVersion(version);
      var vi = 0;
      for (var vr = 0; vr < 6; vr++) {
        for (var vc = 0; vc < 3; vc++) {
          var bit = (vbits >>> vi) & 1; vi++;
          setFn(vr, size - 11 + vc, bit);
          setFn(size - 11 + vc, vr, bit);
        }
      }
    }

    /* --- place data with zigzag, then mask --- */
    var bitIndex = 0, totalBits = codewords.length * 8;
    var dirUp = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                          // skip timing column
      for (var step = 0; step < size; step++) {
        var row = dirUp ? size - 1 - step : step;
        for (var half = 0; half < 2; half++) {
          var c2 = col - half;
          if (fn[row][c2]) continue;
          var bit2 = 0;
          if (bitIndex < totalBits) bit2 = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
          bitIndex++;
          mod[row][c2] = bit2 ? 2 : 3;               // 2/3 = data modules (light/heavy)
        }
      }
      dirUp = !dirUp;
    }

    /* choose the mask with the lowest penalty */
    var best = null, bestPen = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var m = applyMask(mod, fn, size, mask);
      var fmt = bchFormat(mask);
      placeFormat(m, fn, size, fmt);
      var pen = penalty(m, size);
      if (pen < bestPen) { bestPen = pen; best = m; bestMask = mask; }
    }
    return { size: size, mask: bestMask, version: version, modules: best };
  }

  function maskFn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      case 7: return ((r * c) % 3 + (r + c) % 2) % 2 === 0;
    }
    return false;
  }
  function applyMask(mod, fn, size, mask) {
    var out = [];
    for (var r = 0; r < size; r++) {
      var row = new Uint8Array(size);
      for (var c = 0; c < size; c++) {
        var v = mod[r][c];
        if (v === 2 || v === 3) {
          var dark = v === 2;
          if (maskFn(mask, r, c)) dark = !dark;
          row[c] = dark ? 1 : 0;
        } else row[c] = v ? 1 : 0;
      }
      out.push(row);
    }
    return out;
  }
  function bchFormat(mask) {
    var data = (1 << 3) | mask;                      // EC level L = 01
    var rem = data << 10;
    for (var i = 4; i >= 0; i--) {
      if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
    }
    return ((data << 10) | rem) ^ 0x5412;
  }
  function bchVersion(v) {
    var rem = v << 12;
    for (var i = 5; i >= 0; i--) {
      if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i;
    }
    return (v << 12) | rem;
  }
  function placeFormat(m, fn, size, bits) {
    var bitAt = function (i) { return (bits >>> i) & 1; };
    /* around the top-left finder */
    var spotsA = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
                  [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for (var i = 0; i < 15; i++) {
      var s = spotsA[i];
      m[s[0]][s[1]] = bitAt(14 - i);
    }
    /* second copy: bits 14..8 down the right of the bottom-left finder,
       bits 6..0 across row 8 beside the top-right finder (bit 7's slot is
       the always-dark module) */
    for (var j = 0; j < 7; j++) m[size - 1 - j][8] = bitAt(14 - j);
    for (var k = 0; k < 7; k++) m[8][size - 7 + k] = bitAt(6 - k);
    m[size - 8][8] = 1;                                                    // always-dark module
  }
  function penalty(m, size) {
    var pen = 0, r, c;
    /* rule 1: runs */
    for (r = 0; r < size; r++) {
      var run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) pen += 3; else if (run > 5) pen++; }
        else run = 1;
      }
    }
    for (c = 0; c < size; c++) {
      var run2 = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) { run2++; if (run2 === 5) pen += 3; else if (run2 > 5) pen++; }
        else run2 = 1;
      }
    }
    /* rule 2: 2×2 blocks */
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) pen += 3;
      }
    }
    /* rule 3: finder-like patterns */
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (r = 0; r < size; r++) {
      for (c = 0; c <= size - 11; c++) {
        var ok1 = true, ok2 = true;
        for (var i2 = 0; i2 < 11; i2++) {
          if (m[r][c + i2] !== pat1[i2]) ok1 = false;
          if (m[r][c + i2] !== pat2[i2]) ok2 = false;
        }
        if (ok1 || ok2) pen += 40;
      }
    }
    for (c = 0; c < size; c++) {
      for (r = 0; r <= size - 11; r++) {
        var ok3 = true, ok4 = true;
        for (var i3 = 0; i3 < 11; i3++) {
          if (m[r + i3][c] !== pat1[i3]) ok3 = false;
          if (m[r + i3][c] !== pat2[i3]) ok4 = false;
        }
        if (ok3 || ok4) pen += 40;
      }
    }
    /* rule 4: dark ratio */
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m[r][c];
    var ratio = Math.abs(dark * 100 / (size * size) - 50) / 5;
    pen += Math.floor(ratio) * 10;
    return pen;
  }

  /* draw into a canvas 2D context (quiet zone included) */
  function drawCanvas(qr, ctx, px, dark, light) {
    if (!qr) return false;
    var n = qr.size, quiet = 4, total = n + quiet * 2, cell = px / total;
    ctx.fillStyle = light || '#FFFFFF';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = dark || '#0B0C10';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect(Math.floor((c + quiet) * cell), Math.floor((r + quiet) * cell),
                       Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
    return true;
  }

  global.LudoraQR = { encodeText: encodeText, encodeBytes: encodeBytes, drawCanvas: drawCanvas,
                      _pickVersion: pickVersion, _capacityOf: capacityOf, _rsEncode: rsEncode,
                      _bchFormat: bchFormat, _bchVersion: bchVersion };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraQR;
})(typeof window !== 'undefined' ? window : globalThis);
