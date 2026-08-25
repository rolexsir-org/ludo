/* =========================================================================
   Ludora — board.js
   Premium tabletop canvas rendering: precision geometry, luxury materials,
   dimensional lighting, 3D pawns, squash & stretch landing physics,
   radiant halos, particle shockwaves, and rich cosmetics.
   Pure drawing functions on a 2D context — safe in browser and Node tests.
   ========================================================================= */
(function (global) {
  'use strict';
  var E = global.LudoraEngine;

  var PLAYERS = [
    { name: 'Red',    base: '#E5484D', light: '#FF7D82', lighter: '#FFD4D7', dark: '#B3262D', deep: '#6B1116' },
    { name: 'Green',  base: '#30A46C', light: '#62C58E', lighter: '#C8F3DB', dark: '#1F6B45', deep: '#0F3E26' },
    { name: 'Yellow', base: '#F5A623', light: '#F9CB70', lighter: '#FDEBC8', dark: '#B87212', deep: '#6E3F06' },
    { name: 'Blue',   base: '#3A86FF', light: '#7BB1FF', lighter: '#D3E5FF', dark: '#2558B8', deep: '#122E6E' }
  ];

  var THEMES = {
    ivory: {
      name: 'Classic Ivory',
      frameA: '#5C3E26', frameB: '#2E1E12', frameHighlight: 'rgba(255,230,190,.18)',
      field: '#F3ECDA', cell: '#FAF6EB',
      line: 'rgba(80,60,35,.14)', yardLine: 'rgba(0,0,0,.20)',
      starColor: 'rgba(90,68,36,.55)'
    },
    walnut: {
      name: 'Walnut Wood',
      frameA: '#422A1A', frameB: '#1E120A', frameHighlight: 'rgba(240,190,140,.15)',
      field: '#EADBC3', cell: '#F6EEDE',
      line: 'rgba(70,48,25,.16)', yardLine: 'rgba(0,0,0,.22)',
      starColor: 'rgba(75,52,28,.60)'
    },
    midnight: {
      name: 'Midnight Glass',
      frameA: '#2A303F', frameB: '#121620', frameHighlight: 'rgba(120,160,255,.20)',
      field: '#1E2330', cell: '#282E3E',
      line: 'rgba(255,255,255,.07)', yardLine: 'rgba(0,0,0,.35)',
      starColor: '#6B9DF5'
    },
    sakura: {
      name: 'Sakura Blossom',
      frameA: '#7A3F55', frameB: '#441C2C', frameHighlight: 'rgba(255,190,210,.22)',
      field: '#F8ECEE', cell: '#FCF5F6',
      line: 'rgba(115,55,75,.14)', yardLine: 'rgba(0,0,0,.18)',
      starColor: '#D46386'
    },
    cyber: {
      name: 'Cyber Neon',
      frameA: '#1A1C28', frameB: '#090A10', frameHighlight: 'rgba(0,240,255,.28)',
      field: '#10121B', cell: '#171B28',
      line: 'rgba(0,240,255,.12)', yardLine: 'rgba(0,0,0,.5)',
      starColor: '#00E5FF'
    },
    arctic: {
      name: 'Arctic Frost',
      frameA: '#33587A', frameB: '#162C42', frameHighlight: 'rgba(180,230,255,.25)',
      field: '#E9F2F7', cell: '#F5FAFC',
      line: 'rgba(38,68,96,.13)', yardLine: 'rgba(0,0,0,.20)',
      starColor: '#3A82B8'
    },
    canyon: {
      name: 'Canyon Sunset',
      frameA: '#944826', frameB: '#54240F', frameHighlight: 'rgba(255,180,130,.20)',
      field: '#F6EAE0', cell: '#FCF4EE',
      line: 'rgba(110,60,28,.15)', yardLine: 'rgba(0,0,0,.22)',
      starColor: '#C45D2D'
    },
    emerald: {
      name: 'Emerald Forest',
      frameA: '#1C543D', frameB: '#0B291C', frameHighlight: 'rgba(140,240,190,.20)',
      field: '#EBF4ED', cell: '#F5FAF6',
      line: 'rgba(24,78,52,.14)', yardLine: 'rgba(0,0,0,.20)',
      starColor: '#288C5E'
    },
    aurora: {
      name: 'Aurora Borealis',
      frameA: '#2F2656', frameB: '#120D26', frameHighlight: 'rgba(160,130,255,.24)',
      field: '#EEEBF8', cell: '#F7F5FC',
      line: 'rgba(54,42,108,.14)', yardLine: 'rgba(0,0,0,.22)',
      starColor: '#7E5CEF'
    },
    royal: {
      name: 'Royal Velvet',
      frameA: '#7D5C22', frameB: '#422F0D', frameHighlight: 'rgba(255,225,120,.32)',
      field: '#F3EEDB', cell: '#FAF6EA',
      line: 'rgba(92,72,24,.18)', yardLine: 'rgba(0,0,0,.25)',
      starColor: '#C89726'
    },
    obsidian: {
      name: 'Obsidian Chrome',
      frameA: '#222329', frameB: '#0D0E12', frameHighlight: 'rgba(255,255,255,.20)',
      field: '#14161C', cell: '#1E212A',
      line: 'rgba(255,255,255,.09)', yardLine: 'rgba(0,0,0,.4)',
      starColor: '#E2E5F0'
    }
  };

  /* ---------- Geometry & Coordinate Math ---------- */
  function metrics(S) {
    var frame = S * 0.038;
    var cell = (S - frame * 2) / 15;
    return { S: S, frame: frame, cell: cell, ox: frame, oy: frame };
  }

  function cx(m, col) { return m.ox + (col + 0.5) * m.cell; }
  function cy(m, row) { return m.oy + (row + 0.5) * m.cell; }

  function cellRect(m, col, row) {
    var g = m.cell * 0.055;
    return {
      x: m.ox + col * m.cell + g,
      y: m.oy + row * m.cell + g,
      w: m.cell - g * 2,
      h: m.cell - g * 2,
      r: m.cell * 0.20
    };
  }

  var YARD_REGIONS = [[0.5, 9.5], [0.5, 0.5], [9.5, 0.5], [9.5, 9.5]]; // Grid [col, row]
  function yardDocks(m, colorIdx) {
    var reg = YARD_REGIONS[colorIdx];
    var midC = reg[0] + 3, midR = reg[1] + 3;
    var d = 1.42;
    return [
      { x: cx(m, midC - d), y: cy(m, midR - d) },
      { x: cx(m, midC + d), y: cy(m, midR - d) },
      { x: cx(m, midC - d), y: cy(m, midR + d) },
      { x: cx(m, midC + d), y: cy(m, midR + d) }
    ];
  }

  var TRI_DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // Red bottom, Green left, Yellow top, Blue right
  function homeSlots(m, colorIdx) {
    var dir = TRI_DIRS[colorIdx], perp = [-dir[1], dir[0]];
    var ctr = { x: cx(m, 7), y: cy(m, 7) };
    var slots = [];
    var rows = [0.52, 1.05];
    for (var i = 0; i < 4; i++) {
      var side = (i % 2 === 0) ? -1 : 1;
      var along = rows[Math.floor(i / 2)];
      slots.push({
        x: ctr.x + dir[0] * along * m.cell + perp[0] * side * 0.52 * m.cell,
        y: ctr.y + dir[1] * along * m.cell + perp[1] * side * 0.52 * m.cell
      });
    }
    return slots;
  }

  function pointForPos(m, colorIdx, pos, tokenIdx, homeOrder) {
    if (pos === E.HOME) return homeSlots(m, colorIdx)[homeOrder != null ? homeOrder : tokenIdx];
    if (pos === E.YARD) return yardDocks(m, colorIdx)[tokenIdx];
    var c = E.posToCell(colorIdx, pos);
    return { x: cx(m, c[0]), y: cy(m, c[1]) };
  }

  /* ---------- Canvas Drawing Primitives ---------- */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function lg(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }

  function rg(ctx, x, y, r0, x1, y1, r1, stops) {
    var g = ctx.createRadialGradient(x, y, r0, x1, y1, r1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }

  /* 8-point and 4-point decorative stars */
  function star(ctx, x, y, R, rSmall, points) {
    points = points || 4;
    var step = Math.PI / points;
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var rad = (i % 2 === 0) ? R : rSmall;
      var a = i * step - Math.PI / 2;
      var px = x + Math.cos(a) * rad;
      var py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  var YARD_INITIALS = ['R', 'G', 'Y', 'B'];

  /* ---------- Static Board Renderer ---------- */
  function drawStatic(ctx, m, themeId) {
    var th = THEMES[themeId] || THEMES.ivory;
    var S = m.S, cell = m.cell;
    ctx.clearRect(0, 0, S, S);

    /* Luxury Outer Frame */
    rr(ctx, 1, 1, S - 2, S - 2, S * 0.065);
    ctx.fillStyle = lg(ctx, 0, 0, S, S, [[0, th.frameA], [0.5, th.frameA], [1, th.frameB]]);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.stroke();

    /* Inner Metallic Bevel */
    rr(ctx, cell * 0.10, cell * 0.10, S - cell * 0.20, S - cell * 0.20, S * 0.056);
    ctx.lineWidth = Math.max(1.2, cell * 0.048);
    ctx.strokeStyle = th.frameHighlight || 'rgba(255,255,255,.14)';
    ctx.stroke();

    /* Main Board Field */
    var f = m.frame;
    rr(ctx, f, f, S - f * 2, S - f * 2, cell * 0.35);
    ctx.fillStyle = th.field;
    ctx.fill();
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.stroke();

    /* Track Cells (The Plus-Shaped Cross) */
    for (var col = 0; col < 15; col++) {
      for (var row = 0; row < 15; row++) {
        var inCross = (col >= 6 && col <= 8) || (row >= 6 && row <= 8);
        if (!inCross) continue;
        var r = cellRect(m, col, row);
        rr(ctx, r.x, r.y, r.w, r.h, r.r);
        ctx.fillStyle = th.cell;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = th.line;
        ctx.stroke();
      }
    }

    /* Colored Tracks (Lanes, Starts, Tip Turn-Ins) */
    for (var c = 0; c < 4; c++) {
      var pc = PLAYERS[c];
      var cells = [];
      cells.push(E.posToCell(c, 0)); // Start cell
      for (var lp = E.FIRST_LANE_POS; lp <= 55; lp++) {
        cells.push(E.posToCell(c, lp)); // 5-cell lane
      }
      cells.push(E.RING[(E.START[c] + 50) % 52]); // Arm tip
      cells.forEach(function (cc) {
        var r = cellRect(m, cc[0], cc[1]);
        rr(ctx, r.x, r.y, r.w, r.h, r.r);
        ctx.fillStyle = lg(ctx, r.x, r.y, r.x, r.y + r.h, [[0, pc.light], [0.55, pc.base], [1, pc.dark]]);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,.16)';
        ctx.stroke();

        /* Inner subtle highlight */
        rr(ctx, r.x + 1, r.y + 1, r.w - 2, (r.h - 2) * 0.45, r.r * 0.8);
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        ctx.fill();
      });
    }

    /* Safe Star Cells: 4 Starts + 4 Neutral Safe Stars */
    [8, 21, 34, 47].forEach(function (idx) {
      var cc = E.RING[idx];
      var sx = cx(m, cc[0]), sy = cy(m, cc[1]);
      star(ctx, sx, sy, cell * 0.32, cell * 0.12, 4);
      ctx.lineWidth = Math.max(1.5, cell * 0.055);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = th.starColor || 'rgba(90,68,36,.55)';
      ctx.stroke();
      ctx.fillStyle = th.starColor ? 'rgba(255,255,255,.25)' : 'rgba(255,215,0,.35)';
      ctx.fill();
    });

    for (var sc = 0; sc < 4; sc++) {
      var stc = E.posToCell(sc, 0);
      var sx2 = cx(m, stc[0]), sy2 = cy(m, stc[1]);
      star(ctx, sx2, sy2, cell * 0.32, cell * 0.12, 4);
      ctx.fillStyle = 'rgba(255,255,255,.94)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.04);
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.stroke();
    }

    /* Center Home Square: Four Triangular Inlays */
    var x0 = m.ox + 6 * cell, y0 = m.oy + 6 * cell;
    var x1 = m.ox + 9 * cell, y1 = m.oy + 9 * cell;
    var mxv = (x0 + x1) / 2, myv = (y0 + y1) / 2;
    var tris = [
      [x0, y1, x1, y1, PLAYERS[0]], // Red bottom
      [x0, y0, x0, y1, PLAYERS[1]], // Green left
      [x0, y0, x1, y0, PLAYERS[2]], // Yellow top
      [x1, y0, x1, y1, PLAYERS[3]]  // Blue right
    ];

    tris.forEach(function (t) {
      ctx.beginPath();
      ctx.moveTo(t[0], t[1]);
      ctx.lineTo(t[2], t[3]);
      ctx.lineTo(mxv, myv);
      ctx.closePath();
      ctx.fillStyle = lg(ctx, t[0], t[1], mxv, myv, [[0, t[4].base], [0.65, t[4].dark], [1, t[4].deep]]);
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, cell * 0.045);
      ctx.strokeStyle = th.field;
      ctx.stroke();
    });

    /* Center Victory Diamond */
    ctx.save();
    ctx.translate(mxv, myv);
    ctx.rotate(Math.PI / 4);
    rr(ctx, -cell * 0.32, -cell * 0.32, cell * 0.64, cell * 0.64, cell * 0.12);
    ctx.fillStyle = 'rgba(255,255,255,.32)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, cell * 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.stroke();
    ctx.restore();

    /* Yards */
    for (var yc = 0; yc < 4; yc++) {
      drawYard(ctx, m, yc, th);
    }

    /* Subtle Field Vignette */
    rr(ctx, f, f, S - f * 2, S - f * 2, cell * 0.35);
    ctx.fillStyle = rg(ctx, mxv, myv, S * 0.22, mxv, myv, S * 0.78,
      [[0, 'rgba(0,0,0,0)'], [0.75, 'rgba(0,0,0,0)'], [1, 'rgba(10,8,4,.12)']]);
    ctx.fill();
  }

  function drawYard(ctx, m, colorIdx, th) {
    var pc = PLAYERS[colorIdx], cell = m.cell, reg = YARD_REGIONS[colorIdx];
    var x = m.ox + reg[0] * cell + cell * 0.42, y = m.oy + reg[1] * cell + cell * 0.42;
    var w = 6 * cell - cell * 0.84, h = w, r = cell * 0.95;

    rr(ctx, x, y, w, h, r);
    var midX = x + w / 2, midY = y + h / 2;
    ctx.fillStyle = rg(ctx, midX - w * 0.15, midY - h * 0.18, w * 0.08, midX, midY, w * 0.74,
      [[0, pc.light], [0.55, pc.base], [1, pc.dark]]);
    ctx.fill();
    ctx.lineWidth = Math.max(2, cell * 0.09);
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.stroke();

    /* Yard Bevel */
    rr(ctx, x + cell * 0.09, y + cell * 0.09, w - cell * 0.18, h - cell * 0.18, r * 0.92);
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.stroke();

    /* Soft Top Specular Sheen */
    ctx.beginPath();
    ctx.ellipse(midX, y + h * 0.25, w * 0.38, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.11)';
    ctx.fill();

    /* Yard Letter Initial for Non-Color Vision */
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.font = '800 ' + Math.round(cell * 1.15) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(YARD_INITIALS[colorIdx], x + cell * 0.26, y + cell * 0.20);
    ctx.restore();

    /* 4 Token Docks */
    yardDocks(m, colorIdx).forEach(function (d) {
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + cell * 0.07, cell * 0.62, cell * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.24)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(d.x, d.y, cell * 0.60, 0, Math.PI * 2);
      ctx.fillStyle = pc.deep;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(d.x, d.y, cell * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = rg(ctx, d.x - cell * 0.2, d.y - cell * 0.22, cell * 0.05, d.x, d.y, cell * 0.6,
        [[0, pc.dark], [1, pc.deep]]);
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.04);
      ctx.strokeStyle = 'rgba(255,255,255,.26)';
      ctx.stroke();
    });
  }

  /* Dynamic Active Yard Ambient Glow */
  function drawYardGlow(ctx, m, colorIdx, t) {
    var pc = PLAYERS[colorIdx], cell = m.cell, reg = YARD_REGIONS[colorIdx];
    var x = m.ox + reg[0] * cell, y = m.oy + reg[1] * cell, w = 6 * cell;
    var pulse = 0.5 + 0.5 * Math.sin(t * 3.2);

    rr(ctx, x + cell * 0.3, y + cell * 0.3, w - cell * 0.6, w - cell * 0.6, cell * 0.9);
    ctx.lineWidth = cell * (0.16 + 0.12 * pulse);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + 0.18 * pulse).toFixed(3) + ')';
    ctx.stroke();

    rr(ctx, x + cell * 0.18, y + cell * 0.18, w - cell * 0.36, w - cell * 0.36, cell * 0.95);
    ctx.lineWidth = cell * 0.12;
    ctx.strokeStyle = pc.light;
    ctx.save();
    ctx.globalAlpha = 0.38 + 0.28 * pulse;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 3D Token Renderer with Physics & Cosmetics ---------- */
  function drawToken(ctx, x, y, r, colorIdx, shape, o) {
    o = o || {};
    var pc = PLAYERS[colorIdx];
    var lift = o.lift || 0;
    var scale = o.scale || 1;
    var squashX = o.squashX || 1;
    var squashY = o.squashY || 1;
    var yy = y - lift * r * 1.35;

    if (o.alpha != null) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
    }

    ctx.save();
    ctx.translate(x, yy);
    ctx.scale(scale * squashX * (1 + lift * 0.10), scale * squashY * (1 + lift * 0.10));

    /* Ground Shadow */
    var shadowLiftFactor = Math.max(0, 1 - lift * 0.42);
    ctx.beginPath();
    ctx.ellipse(0, (y - yy) + r * 0.92, r * 0.94 * shadowLiftFactor, r * 0.32 * shadowLiftFactor, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,10,5,' + (0.34 * shadowLiftFactor).toFixed(3) + ')';
    ctx.fill();

    var lw = Math.max(1, r * 0.065);

    if (shape === 'orb') {
      /* Luminous Crystal Sphere */
      ctx.beginPath();
      ctx.ellipse(0, r * 0.62, r * 1.0, r * 0.38, 0, 0, Math.PI * 2);
      ctx.fillStyle = lg(ctx, 0, r * 0.3, 0, r, [[0, pc.base], [1, pc.dark]]);
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,.30)';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -r * 0.42, r * 0.88, 0, Math.PI * 2);
      ctx.fillStyle = rg(ctx, -r * 0.3, -r * 0.72, r * 0.08, 0, -r * 0.42, r * 0.96,
        [[0, pc.lighter], [0.25, pc.light], [0.70, pc.base], [1, pc.dark]]);
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,.32)';
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(-r * 0.28, -r * 0.75, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.fill();
    } else if (shape === 'gem') {
      /* Precision Faceted Gemstone */
      var top = -r * 1.74, girdle = -r * 0.80, bottom = r * 0.68;
      var gw = r * 1.0, tw = r * 0.54;

      ctx.beginPath();
      ctx.moveTo(-tw, top); ctx.lineTo(tw, top); ctx.lineTo(gw, girdle); ctx.lineTo(0, bottom); ctx.lineTo(-gw, girdle);
      ctx.closePath();
      ctx.fillStyle = lg(ctx, -gw, 0, gw, 0, [[0, pc.light], [0.5, pc.base], [1, pc.dark]]);
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,.32)';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-tw, top); ctx.lineTo(tw, top); ctx.lineTo(gw * 0.6, girdle); ctx.lineTo(-gw * 0.6, girdle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.38)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-gw, girdle); ctx.lineTo(0, bottom); ctx.lineTo(0, girdle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(gw, girdle); ctx.lineTo(0, bottom); ctx.lineTo(0, girdle);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fill();
    } else if (shape === 'cyber') {
      /* Cyber Futuristic Mech Pawn */
      ctx.beginPath();
      ctx.ellipse(0, r * 0.58, r * 1.0, r * 0.36, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1A1D26';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = pc.light;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-r * 0.85, r * 0.50);
      ctx.lineTo(-r * 0.40, -r * 0.90);
      ctx.lineTo(r * 0.40, -r * 0.90);
      ctx.lineTo(r * 0.85, r * 0.50);
      ctx.closePath();
      ctx.fillStyle = lg(ctx, 0, -r, 0, r * 0.5, [[0, pc.base], [1, '#1A1D26']]);
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
      ctx.stroke();

      /* Glowing Neon Eye Core */
      var hy2 = -r * 1.30;
      ctx.beginPath();
      ctx.arc(0, hy2, r * 0.48, 0, Math.PI * 2);
      ctx.fillStyle = pc.light;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, hy2, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    } else if (shape === 'star') {
      /* Champion Star Crest Token */
      drawClassicPawn(ctx, r, pc, lw);
      ctx.save();
      var hys = -r * 1.34;
      star(ctx, 0, hys, r * 0.38, r * 0.16, 5);
      ctx.fillStyle = '#FFE170';
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.strokeStyle = '#996600';
      ctx.stroke();
      ctx.restore();
    } else {
      /* Classic & Regal Pawn */
      drawClassicPawn(ctx, r, pc, lw, shape === 'regal');
    }

    ctx.restore();
    if (o.alpha != null) ctx.restore();
  }

  function drawClassicPawn(ctx, r, pc, lw, isRegal) {
    /* Weighted Base */
    ctx.beginPath();
    ctx.ellipse(0, r * 0.58, r * 0.98, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fillStyle = lg(ctx, 0, r * 0.25, 0, r * 0.95, [[0, pc.base], [0.55, pc.dark], [1, pc.deep]]);
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.stroke();

    /* Curving Body Stem */
    ctx.beginPath();
    ctx.moveTo(-r * 0.96, r * 0.52);
    ctx.bezierCurveTo(-r * 0.96, -r * 0.16, -r * 0.46, -r * 0.28, -r * 0.42, -r * 0.92);
    ctx.lineTo(r * 0.42, -r * 0.92);
    ctx.bezierCurveTo(r * 0.46, -r * 0.28, r * 0.96, -r * 0.16, r * 0.96, r * 0.52);
    ctx.quadraticCurveTo(0, r * 0.86, -r * 0.96, r * 0.52);
    ctx.closePath();
    ctx.fillStyle = lg(ctx, -r, 0, r, 0, [[0, pc.light], [0.45, pc.base], [1, pc.dark]]);
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.stroke();

    /* Collar Ring */
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.92, r * 0.44, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = pc.dark;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.stroke();

    if (isRegal) {
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.90, r * 0.48, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fillStyle = lg(ctx, -r * 0.5, 0, r * 0.5, 0, [[0, '#F7DE8B'], [0.5, '#E9BE55'], [1, '#B8871E']]);
      ctx.fill();
    }

    /* Head Sphere */
    var hy = -r * 1.34, hr = r * 0.52;
    ctx.beginPath();
    ctx.arc(0, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = rg(ctx, -hr * 0.35, hy - hr * 0.40, hr * 0.10, 0, hy, hr * 1.15,
      [[0, pc.lighter], [0.35, pc.light], [0.75, pc.base], [1, pc.dark]]);
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(0,0,0,.30)';
    ctx.stroke();

    if (isRegal) {
      /* Gold Crown */
      var cy0 = hy - hr - r * 0.05;
      ctx.beginPath();
      ctx.moveTo(-r * 0.32, cy0 + r * 0.18);
      ctx.lineTo(-r * 0.32, cy0 - r * 0.03);
      ctx.lineTo(-r * 0.16, cy0 + r * 0.09);
      ctx.lineTo(0, cy0 - r * 0.12);
      ctx.lineTo(r * 0.16, cy0 + r * 0.09);
      ctx.lineTo(r * 0.32, cy0 - r * 0.03);
      ctx.lineTo(r * 0.32, cy0 + r * 0.18);
      ctx.closePath();
      ctx.fillStyle = lg(ctx, 0, cy0 - r * 0.1, 0, cy0 + r * 0.2, [[0, '#FFE89E'], [0.5, '#E9BE55'], [1, '#B8871E']]);
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.045);
      ctx.strokeStyle = '#8A5E10';
      ctx.stroke();
    }

    /* Specular Light Reflection */
    ctx.beginPath();
    ctx.ellipse(-hr * 0.32, hy - hr * 0.38, hr * 0.26, hr * 0.17, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fill();
  }

  /* Pulsing Radiant Halo for Movable Legal Tokens */
  function drawHalo(ctx, x, y, r, t, colorIdx) {
    var pc = PLAYERS[colorIdx];
    var pulse = 0.5 + 0.5 * Math.sin(t * 5.4);
    ctx.save();

    /* Soft Glow Disc */
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r * (1.4 + 0.2 * pulse), r * (0.65 + 0.1 * pulse), 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.28 + 0.24 * pulse).toFixed(3) + ')';
    ctx.fill();

    /* Outer Ring */
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r * (1.55 + 0.25 * pulse), r * (0.72 + 0.12 * pulse), 0, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2.0, r * 0.11);
    ctx.strokeStyle = pc ? pc.light : 'rgba(255,255,255,.9)';
    ctx.stroke();

    ctx.restore();
  }

  /* Destination Cell Target Outline */
  function drawTarget(ctx, m, colRow, t) {
    var pulse = 0.5 + 0.5 * Math.sin(t * 5.4);
    var r = cellRect(m, colRow[0], colRow[1]);
    rr(ctx, r.x + r.w * 0.08, r.y + r.h * 0.08, r.w * 0.84, r.h * 0.84, r.r * 0.85);
    ctx.lineWidth = Math.max(2.2, m.cell * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.45 + 0.35 * pulse).toFixed(3) + ')';
    ctx.stroke();
  }

  /* Stacked Tokens Count Badge */
  function drawCountBadge(ctx, x, y, n, cell) {
    var r = Math.max(9.5, cell * 0.31);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18,13,7,.86)';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 ' + Math.round(r * 1.18) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + r * 0.06);
  }

  /* Capture Impact Shockwave & Shard Particles */
  function drawBurst(ctx, x, y, cell, colorIdx, p) {
    var pc = PLAYERS[colorIdx];
    var ease = 1 - Math.pow(1 - p, 2.8);

    /* Expanding Shockwave Ring */
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, cell * (0.3 + p * 1.6), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, cell * 0.15 * (1 - p));
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * (1 - p)).toFixed(3) + ')';
    ctx.stroke();
    ctx.restore();

    /* Flying Shard Particles */
    var n = 12, i;
    for (i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + p * 1.4;
      var dist = ease * cell * 1.85;
      var px = x + Math.cos(ang) * dist;
      var py = y + Math.sin(ang) * dist - p * p * cell * 0.6;
      var s = cell * 0.15 * (1 - p * 0.72);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang + p * 5.5);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.8, s * 0.7);
      ctx.lineTo(-s * 0.8, s * 0.7);
      ctx.closePath();
      ctx.globalAlpha = Math.max(0, 1 - p * 1.15);
      ctx.fillStyle = i % 3 === 0 ? '#FFFFFF' : pc.light;
      ctx.fill();
      ctx.restore();
    }
  }

  /* Home Arrival Ripple & Sparkle Wave */
  function drawRipple(ctx, x, y, r0, p) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r0 * (0.45 + p * 1.8), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r0 * 0.30 * (1 - p));
    ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, 0.85 * (1 - p)).toFixed(3) + ')';
    ctx.stroke();

    /* Secondary Soft Wave */
    if (p > 0.15) {
      var p2 = (p - 0.15) / 0.85;
      ctx.beginPath();
      ctx.arc(x, y, r0 * (0.3 + p2 * 1.5), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, r0 * 0.20 * (1 - p2));
      ctx.strokeStyle = 'rgba(255,215,0,' + Math.max(0, 0.65 * (1 - p2)).toFixed(3) + ')';
      ctx.stroke();
    }
    ctx.restore();
  }

  global.LudoraBoard = {
    PLAYERS: PLAYERS,
    THEMES: THEMES,
    metrics: metrics,
    cx: cx,
    cy: cy,
    cellRect: cellRect,
    yardDocks: yardDocks,
    homeSlots: homeSlots,
    pointForPos: pointForPos,
    drawStatic: drawStatic,
    drawYardGlow: drawYardGlow,
    drawToken: drawToken,
    drawHalo: drawHalo,
    drawTarget: drawTarget,
    drawCountBadge: drawCountBadge,
    drawBurst: drawBurst,
    drawRipple: drawRipple,
    rr: rr
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LudoraBoard;
})(typeof window !== 'undefined' ? window : globalThis);
